# Adversarial review: ARCHITECTURE-SPINE.md (Banhall, 2026-09-03)

Verdict: the spine is accurate about what exists but several ADs are worded as lists of call sites rather than as rules over shared data shapes, so two compliant units can still collide on report identity, project insertion, digest scope, and uploader identity. Evidence cites HEAD `5a5f61c`.

## CRITICAL

### C1. AD-3 is factually wrong about the fence, so "current report" has two definitions
Pair: **a new "financial narrative" section agent** (copies `approveSectionDraft`, fences on `attempt`) vs **chat `proposeEdit` / `applyProposal`** (fences on target-text uniqueness).
- Compliance: both call `requireReportEditAccess`, snapshot, bump `revisionNumber`, clear `provenanceId`; both can be added to the seven-writer list.
- Reality: AD-3 says all seven "take `expectedRevisionNumber`". Only `updateReportContent`, `markProposalApplied`, `restoreSnapshot` do (`reports.ts:47`, `chatV2.ts:547`, `snapshots.ts:266`). `applyProposal` (`chatV2.ts:381`), `acceptEdit` (`comments.ts:143`), `approveSectionDraft` (`generations.ts:1893`, fences on `attempt`), `selectReportCandidate` (fences on generation status) do not.
- Incompatibility: a section approval and a proposal apply interleave with no shared version; neither snapshot records which revision the proposal was authored against. Worse, `createGeneratedReportArtifacts` (`generations.ts:929`) and `duplicateProject` (`projects.ts:913`) insert *new* `reports` rows with `revisionNumber: 0`, while `getLatestReport` picks newest by `_creationTime` and `applyProposal` loads `proposal.reportId`. A proposal written against report A applies silently to A after a new generation makes B current. Two definitions of "the report": newest row vs the row a proposal names.
- Close: rewrite AD-3 Rule: "Every writer fences on `(reportId, expectedRevisionNumber)`; content-shape fences (`attempt`, target uniqueness) are additional, never substitutes. `reports` rows are inserted only by `createGeneratedReportArtifacts`; the current report is `projects.currentReportId` (widen now, ahead of `reportBranches`), and `chatProposals`, `writerReviews`, `reviewDecisions`, `reportEditDistance` must all name `(reportId, revisionNumber)`." Enforcing test: an allowlist test asserting every file that writes `revisionNumber:` on `reports` is in the list and its validator has `expectedRevisionNumber`.

### C2. AD-2 governs patches, not inserts; `stageCounts` has two authors and two meanings
Pair: **a bulk-ops/CSV import module inserting projects** vs **dashboard `stageCounts`**.
- Compliance: the import never patches `workflowStage` (obeys "written only by `patchProjectWorkflowStage`"); it inserts `workflowStage: "intake"` like `projects.ts:745`, `ingestionPort.ts:177`, `reviewFromProject.ts:128`.
- Incompatibility: the counter is moved on insert only if the module also sets `dashboardCompanyCounted: true` *and* calls `upsertDashboardCompany(..., 1, "intake")` (`ingestionPort.ts:205`). Nothing in AD-2 says so. Also `ownerBackfill.ts:223` is a third stage writer not in the "two sanctioned callers", and `dashboard.getFacets` (`dashboard.ts:416`) computes a second, scan-based `stageCounts` with a `legacy` bucket. Same name, different truth.
- Close: AD-2 Rule add: "`projects` rows are inserted only through `insertProject(ctx, fields)` in `lib/dashboardProjection.ts`, which sets `dashboardCompanyCounted`, upserts the company bucket, and appends the initial event. Callers: `createProject`, `ingestionPort`, `duplicateProject`, `reviewFromProject`, `seed`. Stage writers: `setWorkflowStage`, `workItems.create`, `ownerBackfill`." Name `dashboardStageCounts.test.ts` as enforcing and add a source-grep test forbidding `db.insert("projects"` outside the helper.

## HIGH

### H1. AD-13 binds nomination but not ingestion; hash/ragKey computed on different bytes
Pair: **a new ingestion source** (`ingestion.finalizeApproval` → `importSource` with `approve: true`) vs **`brain.nominateFromReport`**.
- Compliance: nomination runs `deidentify` per AD-13 Binds ("Brain nomination"). Ingestion is bound by AD-6 only; its Binds line does not name it, and `approve: true` skips `pending` (Q6).
- Incompatibility: `importSource` dedups on `sourceHash = contentHash(content)` and sets `ragKey = kind:hash` (`brain.ts:130-160`). If nomination hashes de-identified text and ingestion hashes raw text, the same PD lands twice with different `ragKey`s; revoking one leaves the other retrievable, defeating "revoked source still retrievable" prevention. Ingestion titles are `${clientName} ${fiscalYearLabel} ${name}` (`ingestion.ts:198`), and `title` flows into `brainProvenance` and `formatBrainExemplars`.
- Close: AD-13 Binds := "every `importSource` caller and every digest distiller input". Rule: "`importSource` is the only `brainSources` insert; it calls `deidentify` on `content` and `title` itself; `sourceHash` is computed on the de-identified text." AD-6: "`approve: true` requires `actorKind: admin` and an `approve` audit row" (closes Q6 or makes it explicit).

### H2. AD-11 `uploadedBy` is a string with two encodings; "role at upload time" is not stored
Pair: **CAP-3 uploader trust** vs **`ingestionPort` / `duplicateProject` / `reviewFromProject` document writers**.
- Compliance: all write `projectDocuments.uploadedBy: v.string()` (`schema.ts:1019`). `documents.ts:146` writes `user._id`; `projects.ts:867`, `reviewFromProject.ts:190`, `ingestionPort.ts:233` write `userDisplayLabel(user)`.
- Incompatibility: the spec says "join `uploadedBy` to `users.role`; no uploader → client trust". Display-label rows fail the join and are silently demoted to client trust; the writer's own scoping notes become "unreliable narrator". And `users.role` is current role, not role at upload.
- Close: AD-11 Rule add: "`projectDocuments` widen: `uploadedByUserId: v.optional(v.id("users"))`, `uploaderTrust: v.optional('internal' | 'client')` stamped at insert by the single `insertProjectDocument` helper; trust is read from the stamp, never derived later." Backfill under AD-10.

### H3. AD-11 contradicts itself on writer instructions
Rule lists "personal instructions" among client-sourced text (data block) while also saying "system prompt is static policy plus writer style" and AD-16 puts waived-rule text and `customInstructions` in the system prompt (`chatAgentV2.ts:386-410`). Two sprint-2 implementers will place `customInstructions` in different roles, and "byte-stable across turns for the same writer" breaks the moment a waiver changes mid-thread. Close: "System prompt = policy + `styleOverrides` projection only, byte-stable per `(writerId, styleOverridesHash)`; `customInstructions` are a `writer_style` data block with internal trust."

### H4. AD-6/AD-12: per-writer digest scope vs publication ledger
Pair: **a per-writer memory feature** (`learningDigests.userId` rows, already in schema) vs **`learningDigestSelections`**.
- Compliance: memory feature never publishes globally (`getActiveDigest` drops `userId` rows, `learning.ts:180`); it wants a selection event per AD-6.
- Incompatibility: the ledger is indexed `by_kind` only, with no `userId`/scope. A writer-scoped `select` row becomes `latestSelection(kind)` for the firm and silently replaces the global digest. Alternatively the feature bypasses the ledger, violating AD-6. Also AD-12's "two writers" is uncountable: `qaItemFeedback.userId`/`candidateScores.userId` are strings, `sectionEditEvents.userId` optional Id, `proposalWordingEditEvents.userId` Id.
- Close: "`learningDigestSelections` carries `scope: 'global' | 'writer'` and `userId`, indexed `by_kind_and_scope_and_userId`; `getActiveDigest(kind, scope, userId?)`. Writer identity on every learning signal is `Id<"users">` (extend CAP-9)."

## MEDIUM

- **M1. AD-4 has two `agentThreadId` vocabularies.** `research.saveReviewResult` inserts `chatProposals` directly with synthetic `research:${id}` (`research.ts:733`), bypassing the stop fence and target-in-report check in `saveProposal`. A QA-agent proposal producer will pick either path. Close: "`saveProposal` is the only `chatProposals` insert; `agentThreadId` is a component thread id; non-chat producers pass `origin`."
- **M2. AD-12 PED baseline undefined for iterative.** `postEditDistance` diffs against the `reason: "generated"` snapshot; iterative assembles after writers already edited sections in the stepper, so PED ≈ 0. Rule must name the baseline: `sourceRevisionNumber 0` snapshot for `report.generationId`, plus `sectionEditEvents.distance` for iterative.
- **M3. AD-13 strips firm names.** "people names from the project record" includes `writer`/`interviewer`, but `writerName` drives tier weighting (Tracy 1.0). Scope to client-side identities (`clientName`, `interviewees`, `sredTitle`). `privacyReviewed: true` is an argument, not a ledger column; add it to `learningDigestSelections`.
- **M4. Deferred `reportBranches`.** Row says "no data at risk", but CAP-7 `reviewDecisions`, CAP-2 `reportEditDistance`, and `writerReviews` are being keyed on `reportId` now while generation already creates one `reports` row per generation. Whether a branch is a `reports` row or a sub-entity must be decided before sprint 2, or every new table hard-codes "row = branch". Promote to a decision.
- **M5. Deferred `clients` normalization** conflicts with AD-13: `deidentify` strips the free-text `clientName`; the same client under two spellings leaks. Note the dependency.
- **M6. Deferred chat spend budget vs AD-11 token budget:** two budgets, no shared unit; state that AD-11's token budget is the only input cap and spend is observed from `aiUsage`.

## LOW

- **L1. "Documented only" ADs.** AD-1 layer rule: add an import-boundary vitest (grep `shared/` and `convex/lib` for forbidden imports) or `eslint no-restricted-imports`. AD-14: add a grep test that `createdBy:` appears only in `db.insert` calls. AD-10 and AD-15 are process rules; acceptable with a PR checklist. AD-2 and AD-3 claim helper enforcement but nothing prevents a bare `ctx.db.patch(..., { workflowStage })` or a new `reports` writer; add source-allowlist tests (see C1, C2).
- **L2. AD-11 "injection fixtures in both pipelines"** omits research (`core.ts` builds external briefs from client text) and PD review. Say "every model call site that reads client content".
- **L3. AD-7 "own requires caller in ownedBy"** is silent on generation (Q3); a section agent implementer will copy `selectReportCandidate` (`requireReportEditAccess`) while `requestGeneration` uses `requireCurrentUser`. Pick one now.
