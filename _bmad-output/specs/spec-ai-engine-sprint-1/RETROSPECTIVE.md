---
date: 2026-08-25
verdict: accepted-with-open-items
criteria: declared
headless: true
mode: stories
spec_folder: _bmad-output/specs/spec-ai-engine-sprint-1
epic_label: ai-engine-sprint-1
pending_stories: []
---

> **Provenance note (2026-09-01).** This retrospective covers the loop run on branch `bmad-loop` (worktree `Banhall-bmad-loop`, commits `a2347c2..fca23fd`). That branch was never merged; `main` shipped its own Sprint 1 implementation in `4ea1bb9` and the two now conflict in 20 files. Findings about *process* and the action-item list still apply; file:line references point at the `bmad-loop` branch, not `main`.

# Retrospective: ai-engine-sprint-1 (close the boundary)

Headless run (`-H`) over the stories-mode epic at `_bmad-output/specs/spec-ai-engine-sprint-1`. Verdict rendered on the evidence alone; every assumption made without a human is listed in the Assumptions section at the end.

## Epic summary

- **Epic:** SPEC-ai-engine-sprint-1, eleven capabilities CAP-1..CAP-11 delivered as eleven stories on branch `bmad-loop`, worktree `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop`.
- **Stories completed:** 11 of 11. `stories.yaml` list order 1..11; every `stories/<id>-*.md` frontmatter carries `status: done`. `pending_stories` is empty.
- **Diff range (union):** `a2347c2..fca23fd` (first story baseline to HEAD), 22 commits, 0 merges. Per-story ranges are each story's `baseline_revision` to the next story's baseline; the last story's range end (`HEAD` = `fca23fd`) is inferred, not recorded.

| Story | CAP | Range (baseline → end) | Story commit |
|---|---|---|---|
| 1 | CAP-1 | `a2347c2..a2a033c` | `4cdfaca` |
| 2 | CAP-3 | `a2a033c..236b0a4` | `870c4fe` |
| 3 | CAP-4 | `236b0a4..838cbcc` | `ef44e75` |
| 4 | CAP-5 | `838cbcc..4e6afe2` | `467dbad` |
| 5 | CAP-2 | `4e6afe2..b46bfe9` | `6692365` (plus spec loop-back `dbf0d58`) |
| 6 | CAP-6 | `b46bfe9..4c309ae` | `30a3057` |
| 7 | CAP-7 | `4c309ae..5135f00` | `a22fe5f` |
| 8 | CAP-8 | `5135f00..de2c649` | `9bb8425` |
| 9 | CAP-9 | `de2c649..c9ca6c4` | `8813063` |
| 10 | CAP-10 | `c9ca6c4..2ad494c` | `186dc57` |
| 11 | CAP-11 | `2ad494c..HEAD` (inferred) | `fca23fd` |

- **Change volume** (`git_evidence.py`, non-merge commits, union range): 60 files, +5673 / -111. Production code is 1640 diff lines across 27 files; the rest is tests (14 test files, ~3300 lines added) and story specs. Largest production deltas: `convex/chatV2.ts` +123 net, `convex/brain.ts` +84, `convex/generations.ts` +77, `src/lib/components/project/fencedProposalMark.ts` +52 (new).
- **Evidence inventory**
  - Available: `SPEC.md` (declared capabilities with success criteria, constraints, success signal, open questions), `touchpoints.md`, `stories.yaml`, 11 story artifacts with Intent, I/O matrix, Review Triage Log, Auto Run Result, `deferred` frontmatter; full git history and diff; `git_evidence.py` output per range; orchestrator per-story result records and the post-loop verify record (supplied by the invoking orchestrator); `docs/product-domain.md` and `docs/ai-engine-audit-2026-08-25.md` as the domain and source documents.
  - Missing: no `sprint-status.yaml` (stories mode; completeness gate taken from story frontmatter instead); no session logs or conversation records for the eleven implementation sessions (the orchestrator result summaries and the spec triage logs are the only record of why a session took a turn); no previous retrospective for this spec folder; no `_bmad-output/planning-artifacts` PRD or architecture file (the audit document and `docs/ai-architecture-plan.md` reference stand in).
  - Narrowed: sub-agents and the `bmad-review` skill were not available to this run, so the diff-scope lenses ran inline over the cross-story boundaries only (see Findings, section C). Runtime behavior was not exercised against a live Convex deployment (see Behavior verification).

## Findings

Each finding cites its source. Dispositions: **fix now** (becomes an action item), **defer** (tracked, enough context to act later), **accept** (recorded so later runs stop re-flagging).

### A. Aggregate views

**A1. Snapshot writer duplicated a third time (duplication map).** The literal `ctx.db.insert("reportSnapshots", { ..., reason: "pre_chat_edit", ... })` block now exists in three mutations: `convex/chatV2.ts:431` (`applyProposal`, pre-existing), `convex/chatV2.ts:532` (`markProposalApplied`, story 5, commit `6692365`), and `convex/comments.ts:182` (`acceptEdit`, story 3, commit `ef44e75`). Each also calls `snapshotAuditFields` and `pruneSnapshots` from `convex/lib/snapshots.ts`, which exports the audit-field builder and the pruner but no writer. `stories.yaml` story 3 `invoke_dev_with` says "Reuse the snapshot helper applyProposal uses"; no such writer helper exists, so the session copied the block. Nine `reportSnapshots` inserts exist repo-wide (`convex/generations.ts:823,882,1900`, `convex/snapshots.ts:185,240,282`). Disposition: **fix now** (small): add a `writePreEditSnapshot(ctx, report, label)` writer to `convex/lib/snapshots.ts` and route the three `pre_chat_edit` sites through it. Upstream lesson: an `invoke_dev_with` hint must name a symbol that exists.

**A2. Internal-role predicate copied again (duplication map).** `user.isAnonymous === true || !user.role` now appears at `convex/lib/auth.ts:38` and `:52` (story 1, `4cdfaca`) and `convex/brain.ts:452` (story 4, `467dbad`), on top of nine pre-existing copies (`convex/projects.ts:613`, `convex/reviewFromProject.ts:53`, `convex/users.ts:30`, `convex/workItems.ts:518`, `convex/projectWorkflow.ts:93`, and others; `grep -rn 'isAnonymous === true' convex`). `convex/lib/roleCapabilities.ts:45-50` splits the same test into two different error codes (`NOT_AUTHENTICATED` for anonymous, `NOT_AUTHORIZED` for role-less) while `auth.ts:52` and `brain.ts:452` return `NOT_AUTHORIZED` for both. Disposition: **defer**: introduce one `isInternalUser(user)` predicate and decide the anonymous error code once; low severity, pre-existing pattern the epic followed rather than created.

**A3. CAP-9 provenance block duplicated across the two pipelines (duplication map).** The digest-fetch try block and the new `recordLearningDigests` try block are byte-for-byte parallel in `convex/ai/pipeline.ts:444-486` and `convex/ai/iterative.ts:139-176` (story 9, `8813063`). The fetch duplication predates the epic; the epic doubled it. Disposition: **defer**: extract `loadLearningGuidance(ctx, genId, log)` returning `{ qaCalibration, draftStyle, learningDigestIds }` once `generations.ts`/pipeline splitting is scheduled (SPEC Non-goals list "Splitting generations.ts" as Later).

**A4. Generation status union hand-copied in four places (pattern divergence).** Adding `superseded` required edits at `convex/schema.ts:611-618`, `convex/lib/contracts.ts:80` (`generationStatusValidator`, which has no consumer), `src/lib/generation/recovery.ts:39-46`, and `src/lib/components/generation/GenerationStatusChip.svelte:7-14` (story 7, `a22fe5f`), and the terminal-state test `completed || failed || superseded` is repeated at `convex/generations.ts:866`, `:2264`, and `:2386`. Already recorded as story 7 deferred (low). Disposition: **defer**: derive the frontend unions from `Doc<"generations">["status"]` and add an `isTerminalGenerationStatus` helper; the next status value will otherwise drift silently.

**A5. God-class growth (size).** `convex/generations.ts` grew 2745 → 2822 lines, `convex/chatV2.ts` 864 → 987, `convex/brain.ts` 580 → 664 (`git show a2347c2:<file> | wc -l` vs. HEAD). No file crossed a new threshold; `generations.ts` was already the largest Convex module and SPEC Non-goals explicitly defer splitting it. `convex/generationRecovery.test.ts` grew to 981 lines (+399 net across stories 7 and 11), now the largest test file. Disposition: **accept** for this epic; the split is a recorded Later item.

**A6. Architecture delta.** No new cross-cutting dependency or cycle. New edges: `convex/comments.ts` → `convex/lib/snapshots.ts` (story 3), `convex/brain.ts` → `convex/lib/auth.requireInternalProjectAccess` and `convex/lib/contracts.domainError` (story 4), `convex/ai/prompts.ts` → `convex/lib/contracts.sha256` (story 9), `convex/ai/chatAgentV2.ts` → `@convex-dev/agent` `ContextOptions` type (story 8), and the two page components → the new `fencedProposalMark.ts` module (story 5). All point from feature modules into `convex/lib/*` or into a new leaf module, consistent with the existing layering. Derived by reading the import hunks of the production diff (`git diff a2347c2...HEAD -- convex src ':(exclude)*.test.ts'`); no dependency-graph tool is configured in the repo, so this view is inline and narrowed to changed files.

### B. Spec-to-implementation reconciliation

**B1. Constraint "frontend callers are unchanged except the one-by-one apply flow in `ProposalCard.svelte`" does not describe the as-built.** `ProposalCard.svelte` is untouched (`git diff --stat bmad-trial...HEAD` lists no such file). The one-by-one flow lives in `src/lib/components/project/CurrentProjectPage.svelte` and `PreviewProjectPage.svelte`, both changed (story 5), and stories 7, 8, and 10 changed `GenerationStatusChip.svelte`, `recovery.ts`, `AgentChatPanel.svelte`, and `src/routes/admin/brain/+page.svelte`. `AgentChatPanel.svelte` had to change because `api.chatV2.listProposals` gained required `startOrder`/`endOrder` args (`convex/chatV2.ts:118-129`): the path is stable but the signature is not, which the constraint "Public `api.*` function paths stay stable" did not anticipate although CAP-8's success line requires it. Story 5 Design Notes record why `ProposalCard.svelte` could not absorb the change. Disposition: **spec reconciliation** (proposed, not applied): reword the constraint to name the page components and list the UI touches CAP-7/8/10 require. `SPEC.md` was not edited by this run.

**B2. CAP-11 as written asks for an index that already existed.** `SPEC.md` CAP-11 success and `stories.yaml` story 11 say "Add `projects.by_status` index"; `projects.by_status` is present at the baseline (`git show a2347c2:convex/schema.ts`, line 165). Story 11 added `by_status_and_updatedAt` (`convex/schema.ts:166`) and uses it at `convex/generations.ts:2212-2216` with `.eq("status","generating").lt("updatedAt", cutoff)`; `docs/ai-engine-audit-2026-08-25.md:123` was updated to the real name (`fca23fd`). The take(500) cap is gone (`grep 'take(500)' convex/generations.ts` is empty). Disposition: **spec reconciliation**: update CAP-11 wording to the shipped index name.

**B3. CAP-7 success says "excluded from history and stats"; only history is excluded.** `listGenerations` filters `superseded` (`convex/generations.ts:204`). `modelStats` (`convex/generations.ts:2597-2662`) reads `modelSelections` and `candidateScores` and never inspects `generations.status`, and the story 7 domain amendment (`docs/product-domain.md`, 2026-08-25 entry) states "model statistics are unchanged". Scores recorded against a superseded partial's candidates therefore still count. Whether that is a defect or an acceptable reading of "stats" was never decided. Disposition: **open question / spec reconciliation**: either amend CAP-7 to "excluded from history (stats key off candidate scores, not generation status)" or add a story that filters superseded generations' candidates out of `modelStats`.

**B4. Success signal "an admin can read cost and prompt version for any generation" is met at the query layer only.** `getGeneration` returns `promptVersion`, `learningDigestIds`, `costUsd`, `usageCalls` (`convex/generations.ts:105-142`) behind `getInternalProjectAccessOrNull`, which any internal role holder passes. No UI surfaces them; story 9 rejected a cost UI as out of intent scope (story 9 Review Triage Log). Disposition: **accept** for this epic and record that "read" was satisfied via query, not screen; propose a Sprint 2 learning-health/cost panel story if a screen was meant.

**B5. Both SPEC open questions are answered by the stories but still open in `SPEC.md`.** CAP-2: story 5 Design Notes "Choice: fence, not delete" with the UX reason (per-pair `applyProposal` cannot express keep-instance-2/replace-instance-3). CAP-3: story 2 implements Owner = strict `ownerId`, creator loses rights, per `docs/product-domain.md` role matrix (`convex/projects.ts:945-956`). Disposition: **spec reconciliation**: close both questions in `SPEC.md` with the recorded answers.

**B6. CAP-1 intent is broader than CAP-1 success, and the broader intent is not met.** CAP-1 intent: "Only signed-in users with an internal role can call project-scoped mutations." The success criterion names only `updateReportContent` and `applyProposal`, and those are covered (`convex/lib/auth.ts:52-54`, `convex/reportAuthz.test.ts`). But `getProjectAccess` (`convex/lib/auth.ts:98-117`) still returns `{ kind: "internal" }` for any `getCurrentUserOrNull` hit, including anonymous auth records, so `comments.addComment` (`convex/comments.ts:46-62`), a project-scoped mutation, remains callable by an anonymous session without a share token. Story 1 recorded this as its single **high**-severity deferred item and noted that `docs/product-domain.md` records a 2026-08-06 decision preserving role-less read visibility, so the read branch needs a product call; the write branch (`addComment`) does not. Disposition: **fix now** (product decision + write-branch gate), the highest-priority open item of the epic.

### C. Diff-scope review (inline, narrowed to cross-story boundaries)

`bmad-review` and sub-agents were unavailable; the adversarial, edge-case, and verification-gap lenses were applied inline to the seams where two stories touch the same code path. Each story's own review already produced 66 patches and 17 deferred items in aggregate (story frontmatter `deferred:` plus Review Triage Logs); those are not re-listed except where a boundary changes their weight.

**C1. Story 1 gate and story 4 gate agree; story 2's gate returns a different code for the same identity.** For an anonymous user, `requireInternalProjectAccess` (`auth.ts:52`) and `submitBrainFeedback` (`brain.ts:452`) throw `NOT_AUTHORIZED`; `publishForReview` via `requireCapability` throws `NOT_AUTHENTICATED` (`roleCapabilities.ts:45-47`). Frontend `userErrorMessage` mapping may render different copy for the same situation. Disposition: **defer** (folded into A2).

**C2. `publishForReview` closes the project-existence oracle; `unpublishReview` and `regenerateShareToken` do not.** `convex/projects.ts:945-956` authorizes before the NOT_FOUND check (story 2 patch). `unpublishReview` (`projects.ts:970-973`) and the caller at `projects.ts:1032` still use `requireProjectCreatorOrAdmin`, so a transferred owner or a Manager can publish but not unpublish, and the creator-or-admin rule survives in two places. Recorded as story 2 deferred (medium) and in its Design Notes as a deliberate follow-up. Disposition: **fix now** as a small story: move both remaining `requireProjectCreatorOrAdmin` callers to `requireCapability("project.setStage")`, and fix the `canShare` gate in `CurrentProjectPage.svelte`/`PreviewProjectPage.svelte` that still keys on `createdBy || admin` (story 2 deferred, medium) so Managers see the Share control they are now allowed to use.

**C3. `markProposalApplied` idempotent path returns a revision from an unvalidated report.** `convex/chatV2.ts:507-513`: when `proposal.state === "applied"`, the handler returns `report?.revisionNumber ?? 0` before the `!report || report.projectId !== proposal.projectId` check at `:522`. Reachable only for a deleted or moved report; the page `$effect` resync repairs `localRevision` (story 5 Auto Run Result, residual risks). Disposition: **accept**, with the story's own record as the source.

**C4. `listProposals` window is bounded by `take(200)` turns but `AgentChatPanel` loads 80 turns.** `convex/chatV2.ts:134-140` and the comment at `src/lib/components/chat/AgentChatPanel.svelte:338-340` ("newest-first, 80 items"). The server cap exceeds the client window, so nothing is dropped today; a client window larger than 200 would silently lose proposals for the oldest turns with no error. Disposition: **defer** (low): export the window size once and assert `take(N) >= window`.

**C5. Reaper restores `previousProjectStatus` that can itself be `generating`.** `convex/generations.ts:367` stores `project.status` verbatim when reserving; all restore sites use `previousProjectStatus ?? "draft"`, so a project that was already `generating` when a second generation was reserved is re-locked by the sweep every cron pass (story 11 deferred, medium, `generations.ts:367` and `:2232`). Story 11's indexed sweep (`:2212`) makes this row eligible on every run because the patch refreshes `updatedAt` but keeps `status: "generating"`. Disposition: **fix now** (small, backend): never store `"generating"` as a previous status; fall back to `"draft"` at reserve time.

**C6. Verification-gap: two behaviors are proven by inspection, not execution.** (a) The `contextOptions` wiring at the `streamText` call site is asserted by a source-text regex (`convex/chatTurns.test.ts:765`); (b) the page wiring of `runFencedProposalMark` in both project pages is verified by the helper's unit tests and the server test, not by a mounted component (story 5 Auto Run Result). Also (c) `generateReport` / `startIterativeGeneration` are not driven end to end by any test, so the `recordLearningDigests` wiring (`pipeline.ts:480`, `iterative.ts:170`) is verified by inspection (story 9 Auto Run Result). Disposition: **defer**: replace (a) with a `streamText` spy through `@convex-dev/agent/test`; add a component test for the one-by-one flow for (b); (c) stays until a pipeline harness exists.

**C7. Verification-gap, harness level: `tests/chatProposals.test.ts` is dead.** The file imports `bun:test`, is excluded by `vitest.config.ts:14-43` (only `convex/**`, `shared/**`, `src/**`), has no `package.json` script, and had 10 failures on the baseline (story 5 Spec Change Log, 2026-08-25 loop 1, and story 5 deferred, medium). `touchpoints.md` row CAP-2 pointed the story's tests at exactly this file, which cost one `bad_spec` loop (`dbf0d58`). Disposition: **fix now**: either port the ten cases to vitest under `convex/` or delete the file, and add a CI guard that fails on any test file outside the vitest projects.

**C8. Deferred items the epic left open, by story** (source: each story's frontmatter `deferred:`; 17 items, 1 high, 7 medium, 9 low): story 1 (1 high: B6), story 2 (2 medium: C2), story 3 (4 low: reviewer-vs-author `writerName` in nomination `convex/reviews.ts:56`; restore leaves comment resolved `convex/snapshots.ts:261`; re-accept of a resolved comment `convex/comments.ts:143`; Svelte callers not catching `acceptEdit` errors), story 4 (1 medium: unscoped feedback has no role gate; 1 low: unbounded `body`), story 5 (1 medium: C7), story 6 (2 medium: per-action budget across sequential stages `convex/ai/pipeline.ts:515`; no timeout classification in `normalizeProviderError` `providers.ts:90`), story 7 (1 low: A4), story 10 (1 medium: failed vector delete leaves `ragEntryId` set with no audit and no retry `brain.ts:367-408`; 1 low: re-embed paths leave `ragEntryId` stale), story 11 (1 medium: C5; 1 low: stale `failStaleGenerations` JSDoc `generations.ts:2090`). All carry file anchors and are actionable without re-investigation. Note: the orchestrator result for story 5 reports `deferred: 0`; the story frontmatter records 1. The frontmatter is treated as authoritative.

### D. What the evidence confirms worked

- Every story's own review loop patched findings before close (66 patches across 11 stories; `Review Triage Log` sections). Only one `bad_spec` loop-back occurred in the whole epic (story 5, `dbf0d58`), and it caught a real harness defect (C7) rather than a wording issue.
- Domain contract discipline held: the one vocabulary change (`superseded`) is recorded as a dated amendment in `docs/product-domain.md` (2026-08-25 entry) with origin, additions, preservation, migration, and approval fields, per that document's amendment process.
- Schema changes stayed additive (`convex/schema.ts`: one status literal, one audit action literal, four optional fields, three indexes; no backfill), matching the SPEC constraint.
- The "agents propose, humans apply" constraint is intact: no new code path writes report prose from an AI tool; `markProposalApplied` explicitly never accepts content (`convex/chatV2.ts:543-551` comment and handler; args at `:495-498`).
- Test volume is real, not decorative: 1045 tests across 110 files at HEAD (was 932 across 102 at story 1's close, per story 1's Auto Run Result), and the new tests are on the executed vitest path (story 5 loop 1 forced that rule).

## Behavior verification

- `npm test` at HEAD `fca23fd`: 110 files, 1045 tests, all passed (6.6 s). `PUBLIC_CONVEX_URL=http://placeholder npm run check`: 5867 files, 0 errors, 0 warnings. Both re-run by this retrospective and consistent with the orchestrator's verify record.
- Runtime behavior was **not** exercised end to end. No Convex deployment or dev server was started in this headless run, so the anonymous-mutation rejection, the one-by-one replace flow with the fenced mark, the client-review publish by a Manager, the superseded chip, and the revoke → `unlearn_confirmed` flow were not observed in a running system. The SPEC success signal "an anonymous mutation attempt against a report fails" is therefore proven by convex-test (`convex/reportAuthz.test.ts`) only. Recommended before merge: a manual pass over those five flows against the dev deployment.

## Previous-retro follow-through

No previous retrospective exists for this spec folder (`_bmad-output/specs/spec-ai-engine-sprint-1/RETROSPECTIVE.md` did not exist before this run) and there is no `sprint-status.yaml` in stories mode, so there were no prior action items to follow through on. Nothing was proposed for `--set-action-status`, and the flag was not used.

## Action items

Proposed, not applied. Owners are roles; the human assigns names.

| # | Item | Kind | Source | Owner |
|---|---|---|---|---|
| 1 | Product decision on `getProjectAccess`: gate the write branch (`comments.addComment`) on an internal role now; decide whether the read branch keeps role-less visibility per the 2026-08-06 decision. | Remediation (fix now) | B6; `convex/lib/auth.ts:98-117`; story 1 deferred (high) | Product owner + backend |
| 2 | Finish CAP-3: move `unpublishReview` (`projects.ts:970`) and `projects.ts:1032` off `requireProjectCreatorOrAdmin`; derive `canShare` in both project pages from `ownerId`/role; add a component test for who sees Share. | Remediation (fix now) | C2; story 2 deferred (2 medium) | Backend + frontend |
| 3 | Never store `"generating"` as `previousProjectStatus` at reserve time so the reaper cannot re-lock a project on every pass. | Remediation (fix now) | C5; `convex/generations.ts:367`, `:2232` | Backend |
| 4 | Retire or port `tests/chatProposals.test.ts`; add a CI guard that fails when a `*.test.ts` file is outside the vitest projects. | Remediation (fix now) | C7; `vitest.config.ts:14-43` | Backend / CI |
| 5 | Add a `pre_chat_edit` snapshot writer to `convex/lib/snapshots.ts` and route `applyProposal`, `markProposalApplied`, `acceptEdit` through it. | Remediation (fix now, small) | A1 | Backend |
| 6 | Run the follow-up review pass the loop recommended: `followup_review_recommended: true` on stories 1, 3, 4, 5, 7, 8, 9, 10, 11 (9 of 11), none executed. | Process (fix now) | story frontmatter | Whoever runs the next `bmad-code-review` |
| 7 | Reconcile `SPEC.md`: constraint wording on frontend callers (B1); CAP-11 index name (B2); CAP-7 "and stats" (B3, needs the decision below); close the CAP-2 and CAP-3 open questions with the recorded answers (B5). | Spec reconciliation | B1, B2, B3, B5 | Spec owner |
| 8 | Deferred medium items to schedule as small stories: story 4 unscoped-feedback role gate; story 6 per-action provider budget and timeout classification; story 10 failed-unlearn audit/retry path. | Remediation (defer, tracked) | C8 | Backend |
| 9 | Deferred low items to batch: A2 predicate, A3 pipeline extraction, A4 status union derivation, C4 window constant, C6 execution-based tests, story 3's four low items, story 11 JSDoc. | Remediation (defer, tracked) | A2, A3, A4, C4, C6, C8 | Backend |

Process lessons (for the next spec, not code):

- **Touchpoints must name executable test surfaces.** `touchpoints.md` CAP-2 pointed at a bun-only file that CI never runs; the only `bad_spec` loop of the epic came from that row. Add "`npx vitest list <file>` returns the file" to the touchpoints checklist.
- **`invoke_dev_with` hints must name real symbols.** Story 3's "reuse the snapshot helper applyProposal uses" referred to a helper that does not exist, producing a third copy (A1).
- **Story sizing.** Six of eleven stories carry `warnings: [oversized]` (3, 5, 7, 8, 9, 10). The two that loop-backed or needed the most patches (5, 9) are in that set. Split CAP-9-shaped stories (schema + three call-site families + query) into schema/plumbing and exposure halves.
- **Spec constraints should be checked against the code map before the run.** B1 and B2 were both discoverable from the baseline tree; a five-minute constraint-vs-touchpoints pass would have caught them.
- **Record the epic-wide intent gap explicitly when a story narrows it.** CAP-1's intent covers all project-scoped mutations; story 1's contract narrowed it to two. That narrowing was correct for the story but left the epic's own intent unmet without any place in `SPEC.md` saying so (B6).
- **Story frontmatter uses the deprecated `baseline_revision` key** in all 11 artifacts; `evidence-gathering.md` names `baseline_commit` as current. Harmless today, but tooling that reads only the new key would lose every story's range.
- **Session logs were not captured.** Four "halted: no subagents" plan commits precede the real run (`ca165fd`, `3a28952`, `a5b50d7`, `b6ace26`); why the loop was restarted under a different runner is recoverable only from those commit subjects. Capture the orchestrator transcript alongside the spec folder next time.

## Acceptance verdict

**accepted-with-open-items** (criteria: **declared**).

- Completeness: all 11 stories `done`; `pending_stories` empty, so no forced rejection.
- Declared success criteria, CAP by CAP: CAP-1 met at the success line (`reportAuthz.test.ts`), intent partially met (B6). CAP-2 met (`chatV2.markProposalApplied.test.ts`, `fencedProposalMark.test.ts`; fence at `chatV2.ts:526`, snapshot at `:532-542`, bump at `:547-551`). CAP-3 met (`projects.test.ts`; Owner/Manager/Admin via `requireCapability`). CAP-4 met (`commentsAcceptEdit.test.ts`, `writerReviews.test.ts`; nomination scheduled after the write at `reviews.ts:94-100`). CAP-5 met (`brainFeedback.test.ts`). CAP-6 met (`providers.ts:36-37`: 2 × 240 s = 480 s < 600 s, pinned by `providers.test.ts`). CAP-7 met for history and QA gating (`generations.ts:204`, `:1570-1585`), not for "stats" (B3). CAP-8 met (`chatAgentV2.ts:222-225` and the call site at `:422`, `chatV2.ts:84-155`, `chatTurns.test.ts`). CAP-9 met at the query layer (`generations.ts:105-142`; five new test files). CAP-10 met (`brainUnlearn.test.ts`; `brain.ts:367-408`, `ingest.ts:83-89`). CAP-11 met (`generations.ts:2212`; no `take(500)`).
- Success signal: `npm test` green with new tests for CAP-1, 2, 3, 4, 7 (present); anonymous mutation against a report fails (convex-test proof only); admin can read cost and prompt version (query only, B4).
- Constraints: "agents propose, humans apply" held; schema additive; `api.*` paths stable, one signature changed (B1); the frontend-callers constraint as written was not met because it was written against the wrong file (B1).
- Open items that keep this from plain **accepted**: B6 (high, product decision), C2 and C5 (medium, small fixes), C7 (dead test harness), B3 (spec/behavior mismatch on stats), plus the 17 story-level deferred items in C8. None is a blocking defect in shipped behavior that the tests contradict, and none is an unfinished story, so the verdict is not **rejected**.
- No human decision was available; this is the machine verdict on the evidence.

## Open questions

1. Does "excluded from stats" in CAP-7 mean `modelStats`, and if so should scores on a superseded generation's candidates be dropped? (B3) A yes turns B3 into a small story; a no closes it by rewording.
2. Should anonymous or role-less authenticated sessions keep internal read access to reports and comments (the 2026-08-06 decision in `docs/product-domain.md`), given CAP-1's intent? (B6) The write branch can be gated either way.
3. Was "an admin can read cost and prompt version for any generation" meant to imply a screen? (B4) If yes, it belongs in the Sprint 2 learning-health panel.
4. Should `NOT_AUTHENTICATED` vs `NOT_AUTHORIZED` for anonymous sessions be unified across `requireCapability` and `requireInternalProjectAccess`? (C1) Affects frontend copy only.

## Assumptions

Recorded because this run was headless; no human confirmed any of them.

- **Epic selection:** taken from the invocation: spec folder `_bmad-output/specs/spec-ai-engine-sprint-1`, label `ai-engine-sprint-1`, date 2026-08-25. Stories mode was resolved because a folder was named. No `detect-epic` call was made (no `sprint-status.yaml` exists; stories mode has none), so the completeness gate was computed from `stories.yaml` list order plus each artifact's frontmatter `status`. Result: `pending_stories: []`.
- **Diff ranges:** per-story ranges built from each artifact's `baseline_revision` to the next story's baseline in list order; story 11's end was inferred as `HEAD` (`fca23fd`). The union range `a2347c2..fca23fd` excludes the four halted plan commits before story 1's baseline (`ca165fd`, `3a28952`, `a5b50d7`, `b6ace26`), which touched only spec files.
- **Machine verdict:** `accepted-with-open-items`, rendered with no human decision. Rule 2 of `acceptance-verdict.md` (fail with no human decision is recorded as not accepted) was not triggered because the declared success lines are met in the evidence; the gaps found are intent-level (B6), wording-level (B1, B2, B5), or one ambiguous word (B3).
- **Evidence weighting:** story frontmatter `deferred:` was treated as authoritative over the orchestrator result summaries where they disagree (story 5: 1 vs 0).
- **Narrowings:** `bmad-review` and sub-agents unavailable, lenses run inline over story boundaries only; no runtime behavior check; no session logs, so process lessons come from spec triage logs and commit history only; architecture delta derived from import hunks, not a dependency tool.
- **Proposed items:** action items 1 through 9 and the spec reconciliations in B1, B2, B3, B5 are proposals; nothing in `SPEC.md`, `stories.yaml`, or any story artifact was edited by this run. No `--set-action-status` transitions were proposed because no prior retro exists.
- **Persistent facts:** the customization's `file:{project-root}/**/project-context.md` glob matched no file; no standing facts were loaded.
