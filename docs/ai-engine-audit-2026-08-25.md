# AI engine architecture audit

**Date:** 2026-08-25
**Scope:** generation pipeline, review/QA and human oversight, continuous-learning loop (digests + Brain), AI chat.
**Method:** four independent read-only code reviews, each checked against `docs/ai-architecture-plan.md` (2026-08-17) and `docs/product-domain.md`, then synthesized. File:line cites are as of commit `66f131b` plus uncommitted working tree.
**Verdict on BMAD-METHOD:** not adopted. It would re-derive PRD/architecture docs this repo already has; the architect persona has no Convex, Brain, or SR&ED context. This audit is the check it would have produced, done against the real code.

---

## Bottom line

The architecture in `ai-architecture-plan.md` is sound and the code mostly honors its core invariant (agents propose, humans apply; Brain is admin-governed; generation inputs are frozen and hashed). Four things undercut it today:

1. **The final authorization boundary leaks.** `requireInternalProjectAccess` never checks role or `isAnonymous`, so any authenticated identity can mutate report prose. Two mutations bypass the apply safeguards outright.
2. **Plan Phase 2 (trusted context) has not started** in either generation or chat. Untrusted client content sits in the system prompt, trust is granted by an upload category field, and there is no total context budget. Same gap also drives the cost risk.
3. **The learn loop has no measurement.** Post-edit distance is computed but never stored or read, `brainProvenance` is write-only, no eval harness exists, and no generation records which prompt/digest version produced it. "Is the system improving?" cannot be answered.
4. **Domain contract pieces are missing** (report branches, production outcomes), which makes two workflow stages unreachable, blocks export for any human-edited report, and makes outcome-weighted learning impossible.

Counts by severity across the four reviews: **P0: 4, P1: 9, P2: 12, P3/low: 10.**

---

## Cross-cutting themes

### T1. Authorization at the final mutation boundary

- `requireInternalProjectAccess` (`convex/lib/auth.ts:44-52`) checks "signed in + project exists" only; the nullable sibling at `:33-41` rejects anonymous/role-less users. Every prose write gates on the weak one: `updateReportContent` (`reports.ts:42-69`), `applyProposal` (`chatV2.ts:305`), `acceptEdit` (`comments.ts:140-185`), `restoreSnapshot` (`snapshots.ts:261`), `submitWriterReview`, `saveQaItemFeedback`, `startPdReview`. Anonymous users exist (`reviewFromProject.ts:53` defends against them).
- `report.editProse` capability is defined (`shared/capabilities.ts:8,57,79,114`) and enforced nowhere in `convex/`.
- `markProposalApplied` (`chatV2.ts:426-434`) flips a proposal to `applied` with no snapshot, revision bump, uniqueness or scrub check.
- `publishForReview` uses `requireProjectCreatorOrAdmin` (`projects.ts:931`), i.e. `createdBy`, against the contract's Owner/Manager/Admin rule and its "do not repurpose `createdBy`" instruction.
- `submitBrainFeedback` (`brain.ts:383-404`) accepts any `reportId`/`projectId` without access check.

### T2. Trusted-context boundary (plan Phase 2, unbuilt)

- Generation: transcript is undelimited (`analyzerAgent.ts:141`); data-not-instructions guidance is omitted when a project has zero documents (`buildContextBlock` `:35`); `writer_notes` is "HIGHEST TRUST" (`prompts.ts:565`) but the category is plain metadata anyone can set on upload. Analyzer JSON and Brain exemplars enter section prompts without provenance labels (`section242Agent.ts:26`).
- Chat: report text, every project document (20k chars each, uncapped count), analyzer JSON, 75k-char personal instructions and prior decisions are all concatenated under `system:` (`chatAgentV2.ts:376-396`). `highlightPassages` auto-scrolls the editor with no human gate.
- Zero injection tests in the repo.

### T3. Unbounded context and cost

- `getGenerationInput` (`generations.ts:619-663`) can return 500k + 50×200k chars (~10.5 MB) in one query result; no total budget or relevance selection.
- Compare mode re-runs analyzer, QA and chronology per candidate on identical frozen input (`pipeline.ts:238`); iterative mode already proves analyzer-once works (`iterative.ts:165`). No `cache_control` on the generation path.
- Anthropic client 8 min × 3 attempts (`providers.ts:587-588`) inside a single `generateCandidate` action; a slow call exceeds the 10-min action budget and sits `running` until the 30-min reaper.
- Chat: only caps are `stepCountIs(5)` and 16k output/step; no per-user/project budget, no rate limit on `sendMessage`; `getChatContextV2` collects all document bodies every turn; `listProposals` returns the whole thread's proposals reactively.
- `aiUsage` has no `generationId`/`candidateRunId`/latency (`schema.ts:466-482`), so cost per generation is unknowable.

### T4. No measurement, no provenance of versions

- Post-edit distance (`reports.ts:433-499`) computed on read, stored nowhere, read by no UI or job.
- `brainProvenance` has one writer (`brainRetrieval.ts:148-153`) and zero readers.
- Generations do not record `promptVersion` or which `learningDigests` were active (`pipeline.ts:445`, `iterative.ts:138`); digests record `sourceCount` and cutoff only, no signal ids.
- Tests cover recovery mutations, structured output, qaChecks, turnParts. Untested: `pipeline.ts`/`iterative.ts`/`postQa.ts` orchestration, `completeCandidateRun` fan-in, `approveSectionDraft` with ghost, `selectReportCandidate`, `reviews.ts`, `comments.acceptEdit`, `restoreSnapshot`, `markProposalApplied`, any Brain retrieval usefulness.
- Voyage rerank falls back on 429 regularly (3 rpm, no payment method) and the fallback rate is invisible.

### T5. Domain contract gaps

- No `reportBranches` table or `activeBranchId`/`promotedBranchId`; `ready_for_delivery` and `delivered` correctly fail closed (`projectWorkflow.ts:358-369`) and are therefore unreachable.
- No `productionOutcomes` table; `brainSources.craOutcome` is never written; outcome-weighted learning and negative examples (`cra_letter`, promised separate namespace) are stubs. `rag.ts:29` declares one namespace.
- `createProvenance` is called once (`pipeline.ts:600`); every human edit clears `provenanceId` (`reports.ts:64`, `chatV2.ts:414`, `comments.ts:180`) and nothing re-creates it, so an edited report is permanently `PROVENANCE_UNAVAILABLE` (`auth.ts:154-158`) and blocked at `authorizeExport`. Either export is impossible for edited reports in practice or the gate is bypassed somewhere.
- `setWorkflowStage` (`projectWorkflow.ts:316-411`) requires no review record or QA state on `internal_review → edits/ready_for_delivery`. AI QA is purely advisory; "never waivable" checks (`qaChecks.ts:8-9`) are prompt text, and the LLM's severity is the stored truth.

### T6. Client privacy inside firm-wide knowledge

- `nominateFromReport` copies the entire client report verbatim, project title included, into `brainSources.content` (`brain.ts:216-235`).
- Edit-mining events store up to 6,000 chars of client prose (`generations.ts:1732`); distillation sends 2,000 chars × 500 events to the model (`ai/learning.ts:74-98`). No redaction anywhere (`grep -i redact|deidentif|anonymi` is empty).
- Revocation is intent-only: no confirmed-erasure audit row, `ragEntryId` never cleared, retries on revoked sources (`brain.ts:329-357`, `ingest.ts:80`), and knowledge already distilled into a published digest is never unlearned. Revoked rows keep full content.

### T7. Structure

- `generations.ts` is 2,745 lines mixing reservation, candidate-run machine, iterative machine, post-QA, reapers, and selection/scoring. Module-private helpers block splitting.
- `progressLog: string[]` rewritten on every append (`generations.ts:2271`), against Convex guidelines.
- Reaper scans `projects.take(500)` unindexed every 10 min and ignores project 501+ (`generations.ts:2158`).
- Chat deep-imports `@convex-dev/agent` dist internals (`agentInternal.ts:11-18`); `chatMessages` table is write-dead but still in schema.

---

## Ranked findings

| # | Sev | Area | Finding | Where |
|---|---|---|---|---|
| 1 | P0 | Review | Any authenticated identity, incl. anonymous/role-less, can mutate report prose | `lib/auth.ts:44-52` + all callers |
| 2 | P0 | Review/Chat | `markProposalApplied` bypasses snapshot, revision bump, scrub, uniqueness | `chatV2.ts:426-434` |
| 3 | P0 | Gen/Chat | Untrusted content in system prompt; trust granted by upload category; no injection tests | `chatAgentV2.ts:376-396`, `prompts.ts:565`, `analyzerAgent.ts:141` |
| 4 | P0 | Gen | Unbounded generation input (~10.5 MB worst case), no total budget | `generations.ts:619-663` |
| 5 | P1 | Learn | Client PII enters Brain and digests with no de-identification | `brain.ts:216-235`, `learning.ts:74-98` |
| 6 | P1 | Learn | No measurement: PED unused, provenance write-only, no evals | `reports.ts:433`, `brainRetrieval.ts:148` |
| 7 | P1 | Gen | Provider timeout × retries exceeds action budget | `providers.ts:587-588`, `pipeline.ts:515` |
| 8 | P1 | Review | Provenance dies on first human edit; edited reports cannot export | `pipeline.ts:600`, `reports.ts:64`, `auth.ts:154` |
| 9 | P1 | Review | Review outcomes decoupled from workflow transitions | `projectWorkflow.ts:316-411` |
| 10 | P1 | Review | AI QA advisory-only, no blocking policy for non-waivable checks | `qaChecks.ts:8-9`, `reports.ts:318` |
| 11 | P1 | Review | `publishForReview` authority = `createdBy`, contradicts contract | `projects.ts:931` |
| 12 | P1 | Chat | Unbounded chat context growth and cost; no budgets or rate limits | `chatV2.ts:828-831`, `chatAgentV2.ts:352-358` |
| 13 | P1 | Gen | `retryFailedCandidates` marks original `completed` with no report | `generations.ts:526-530` |
| 14 | P2 | Learn | Revocation intent-only; no confirmed erasure; retries on revoked | `brain.ts:329-357`, `ingest.ts:80` |
| 15 | P2 | Learn | Digests lack signal provenance and writer/project diversity gate | `ai/learning.ts:31`, `schema.ts:1592` |
| 16 | P2 | Learn | Negative-signal path is a stub (`cra_letter`, `craOutcome`) | `brain.ts:75,85`, `rag.ts:29` |
| 17 | P2 | Gen | Compare mode duplicates analyzer/QA per candidate; no prompt caching | `pipeline.ts:238` |
| 18 | P2 | Gen | Cost not attributable to generation | `schema.ts:466-482` |
| 19 | P2 | Gen | No prompt/digest version on generations | `pipeline.ts:445` |
| 20 | P2 | Review | `acceptEdit` patches by text find/replace without snapshot | `comments.ts:164-166` |
| 21 | P2 | Review | Review artifacts not pinned to revision/content hash | `schema.ts:1396` |
| 22 | P2 | Chat | `listProposals` unbounded; `listMessages` throws on missing thread | `chatV2.ts:84-121` |
| 23 | P2 | Chat | No regenerate/retry on failed or completed turns; no optimistic bubble | `AgentChatPanel.svelte:434-466` |
| 24 | P2 | Domain | No report branches or production outcomes; two stages unreachable | `schema.ts`, `projectWorkflow.ts:358-369` |
| 25 | P2 | Gen | `generations.ts` 2,745 lines; `progressLog` rewrite; unindexed reaper scan | `generations.ts` |

---

## Recommended sequence

### Sprint 1: close the boundary (all S, ~1 week)

- Make `requireInternalProjectAccess` reject anonymous/role-less users; test that anonymous cannot call `updateReportContent`/`applyProposal`. (`lib/auth.ts`)
- Route one-by-one apply through `applyProposal` per pair, or make `markProposalApplied` require `expectedRevisionNumber` and write a snapshot. (`chatV2.ts`, `ProposalCard.svelte`)
- Switch `publishForReview` to Owner/Manager/Admin via `requireCapability`. (`projects.ts`)
- Snapshot before `acceptEdit`; move Brain nomination after the review write. (`comments.ts`, `reviews.ts`)
- Validate access in `submitBrainFeedback`. (`brain.ts`)
- Provider retry budget: `maxRetries: 1`, 4-min timeout so timeout × attempts fits the action. (`providers.ts:587`)
- `superseded` status for `retryFailedCandidates`; gate `requestReportQa` on report existence. (`generations.ts:526,1516`)
- Chat `contextOptions: { recentMessages: 30, excludeToolMessages: true }`; bound `listProposals`; return `[]` from `listMessages`. (`chatAgentV2.ts:391`, `chatV2.ts:84-121`)
- Record `promptVersion` + `learningDigestIds` on generations; add `generationId`/`candidateRunId`/`durationMs` to `aiUsage` with `by_generationId` index. (`pipeline.ts`, `iterative.ts`, `aiUsage.ts`, `schema.ts`)
- `unlearn_confirmed` audit action; clear `ragEntryId`; `embedSource` no-ops on non-approved rows. (`brain.ts:352`, `ingest.ts:80`)
- `projects.by_status` index; drop `take(500)` scan. (`schema.ts`, `generations.ts:2158`)

### Sprint 2: trusted context + measurement (M, ~2-3 weeks)

- `convex/ai/trustedContext.ts`: context classes, per-source and total budgets, trust from uploader role not category, BEGIN/END on transcript, guidance always emitted, truncation recorded on `generationSources`. Used by analyzer and chat. Chat moves evidence out of `system` into one labeled user-role evidence message; static policy prefix stays first so caching works. Injection test suite. (plan Phase 2)
- Analyzer once per generation in compare mode; `cache_control` on system + transcript for Anthropic models.
- Enforce `report.editProse` via a single `requireReportEditAccess` helper across all prose-writing mutations.
- `reviewDecisions` table written atomically with `internal_review → edits/ready_for_delivery`; require it on those edges.
- QA policy: persist deterministic findings as rows, mark `because_clause`/CRA-methodology blocking, surface `QA_BLOCKING` in `getFilingReadiness` and client publish.
- Pin `writerReviews`, `qaItemFeedback`, `pdReviews` to `revisionNumber` + `contentHash`; type `userId` as `v.id("users")`.
- De-identification pass before nomination and before edit events reach the distiller; privacy note in digest prompt; admin checkbox on publication.
- Persist PED at snapshot milestones; admin "learning health" panel (PED trend, exemplar usage by source, rerank fallback rate from `aiUsage`). Diversity gate in `generateDraftStyleDigest` (≥2 writers, ≥2 projects).
- Chat UX: regenerate/retry on turns, optimistic user bubble, Brain source chips, wire `FeedbackBar` into learning ledger.
- Deterministic orchestration tests: `completeCandidateRun` fan-in, `approveSectionDraft` ± ghost, `selectReportCandidate`, `reviews.ts`, `restoreSnapshot`.

### Later: contract completion (L)

- Split `generations.ts` into `convex/generation/{lifecycle,candidateRuns,iterative,postQa,selection,reaper}.ts` with a re-export shim.
- Provenance re-derivation after human edits (`needs_review` provenance row from frozen `generationSources`) so edited reports can export.
- `reportBranches` + `productionOutcomes` tables per the domain contract; make `ready_for_delivery`/`delivered` reachable; wire `craOutcome` and a `cra_negative` namespace.
- Brain reconciliation cron (approved-without-vector, revoked-with-vector, orphan GC).
- Frozen eval set (20-30 de-identified pairs), Brain-on/off and digest-on/off runs scored by the QA agent + PED.

---

## Things to preserve

Frozen inputs with hashes; claim-mutation CAS fencing on every action; proposal-not-edit chat tools with human apply, pre-edit snapshots and applier-policy re-scrub; admin-gated Brain with revoke path and late-completion fence; append-only digest publication ledger with kill switch and rollback; OCC on report saves, workflow, and snapshots; real token streaming with three stop fences and a stale-turn reaper; partial-failure recovery UI; per-call usage instrumentation.
