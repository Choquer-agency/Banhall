---
title: 'Reversible client-edit acceptance and post-write Brain nomination'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
baseline_revision: '236b0a435867ba2690b6246bdda8c0b9eb42ae75'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: [oversized]
deferred:
  - summary: >-
      submitWriterReview nominates under the reviewer's display name, not the report author's, so a manager/admin rating a writer's report attributes the Brain nomination to the reviewer.
    evidence: |-
      convex/reviews.ts derives writerName from the user returned by requireInternalProjectAccess (the caller) and passes it to internal.brain.nominateFromReport. Pre-existing; the story only reorders the schedule call.
    location: >-
      convex/reviews.ts:56
    severity: low
  - summary: >-
      Restoring the pre-edit snapshot reverts the client's suggested edit but leaves the comment resolved: true, so the writer gets no signal the edit is gone.
    evidence: |-
      restoreSnapshot only rewrites report content/lineage; it never touches comments. Same holds for every other restore path today, so this is a product gap in restore semantics rather than in acceptEdit.
    location: >-
      convex/snapshots.ts:261
    severity: low
  - summary: >-
      acceptEdit on an already-resolved comment re-applies the replacement (if the highlight still matches once) and writes another checkpoint.
    evidence: |-
      convex/comments.ts acceptEdit has no comment.resolved guard; pre-existing behavior, now also producing a duplicate pre_chat_edit snapshot. Adding a guard changes behavior outside this story's intent.
    location: >-
      convex/comments.ts:143
    severity: low
  - summary: >-
      CommentSidebar.svelte and MarginComments.svelte call acceptEdit without catching STALE_REVISION/INVALID_INPUT, so rejections surface as unhandled promise rejections with no user copy.
    evidence: |-
      Both callers await the mutation with no .catch or error state, unlike CurrentMyWorkView/WorkspaceRolloutCard which map STALE_REVISION to recovery copy. Pre-existing; Svelte callers are on this story's Never list.
    location: >-
      src/lib/components/comments/CommentSidebar.svelte
    severity: low
---

<intent-contract>

## Intent

**Problem:** `acceptEdit` (`convex/comments.ts`) patches report content in place without a pre-edit snapshot, so accepting a client's suggested edit is the only prose mutation with no restore point. `submitWriterReview` (`convex/reviews.ts`) schedules `internal.brain.nominateFromReport` before the `writerReviews` row is written, so the nomination is not sequenced after the persisted review (audit CAP-4).

**Approach:** In `acceptEdit`, insert a `reportSnapshots` row of the report's current content before the patch, built exactly the way `applyProposal` does (`snapshotAuditFields` + `pruneSnapshots` from `convex/lib/snapshots.ts`), so `restoreSnapshot` can return the prior text. In `submitWriterReview`, move the nomination scheduling below the `writerReviews` insert/patch so it runs only once the write has been issued. Add convex-test suites for both mutations.

## Boundaries & Constraints

**Always:** Keep `api.comments.acceptEdit` and `api.reviews.submitWriterReview` names, argument shapes, and return values unchanged. The snapshot uses `reason: "pre_chat_edit"`, `label: "Before client edit"`, `createdByRole: "system"`, `sourceRevisionNumber: report.revisionNumber ?? 0`, and the spread of `snapshotAuditFields(ctx, report)`; the existing `revisionNumber + 1`, `contentHash`, `provenanceId: undefined`, and `resolved: true` writes stay as they are. The snapshot is written only after every existing validation (missing comment, no suggested edit, access, foreign report, invalid JSON, `applied.count !== 1`) has passed, so a rejected accept leaves no snapshot. Nomination still fires only for `score >= 85` with the same `{ reportId, writerName, score }` args. Tests use `convex-test` with `t.withIdentity({ subject })` and `import.meta.glob("./**/*.ts")` like `convex/brainFeedback.test.ts`; scheduled work is observed through `ctx.db.system.query("_scheduled_functions")`.

**Block If:** Any existing test in `npm test` asserts the exact count or ordering of `reportSnapshots` rows after `acceptEdit`, or asserts nomination ordering in `submitWriterReview`, and cannot be updated without changing behavior beyond CAP-4.

**Never:** Add a new `reportSnapshots.reason` literal or any other schema change. Touch `applyProposal`, `markProposalApplied`, `restoreSnapshot`, `nominateFromReport`, `convex/lib/snapshots.ts`, or the Svelte callers (`CommentSidebar.svelte`, `MarginComments.svelte`, `QAScorePanel.svelte`). Do not touch CAP-1 through CAP-3 or CAP-5 through CAP-11. Do not add a code path where an AI tool writes report prose.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Accept then restore | writer, comment with `suggestedEdit`, `highlightText` occurs once in the report doc | one new `reportSnapshots` row (`reason: "pre_chat_edit"`, `label: "Before client edit"`, `createdByRole: "system"`, `content` = pre-accept content, `sourceRevisionNumber` = prior revision); report content contains the edit; `revisionNumber` +1; comment `resolved: true`. `restoreSnapshot(snapshotId, reportId, expectedRevisionNumber: prior+1)` returns `content` equal to the pre-accept text | No error expected |
| Ambiguous or missing highlight | `highlightText` occurs 0 or 2+ times | no snapshot row, report unchanged, comment unresolved | `ConvexError` `code: "STALE_REVISION"` |
| Comment has no suggested edit | `suggestedEdit` undefined | no snapshot, nothing written | `code: "INVALID_INPUT"` |
| Unauthenticated accept | no identity | no snapshot, nothing written | `code: "NOT_AUTHENTICATED"` |
| High review persisted | writer, `submitWriterReview` `score: 90` | `writerReviews` row exists with `score: 90`; exactly one `_scheduled_functions` job whose `name` includes `nominateFromReport`; the mutation returns the review id | No error expected |
| High review updated | second `submitWriterReview` by the same writer on the same report, `score: 95` | row patched to 95 (still one row); a second nomination job is scheduled | No error expected |
| Low review | `score: 60` | row exists; no nomination job | No error expected |
| Review rejected before write | report id that does not exist, `score: 90` | no `writerReviews` row, no nomination job | throws `Report not found` |

</intent-contract>

## Code Map

- `convex/comments.ts:140-185` -- `acceptEdit`: primary edit. Insert the snapshot between the `applied.count !== 1` guard (line 167) and `ctx.db.patch(report._id, ...)` (line 176); call `pruneSnapshots(ctx, report._id)` after the patches. Add imports `snapshotAuditFields`, `pruneSnapshots` from `./lib/snapshots`.
- `convex/chatV2.ts:383-416` -- `applyProposal` snapshot block: the reference to mirror (`snapshotAuditFields(ctx, report)` spread, `sourceRevisionNumber`, `reason: "pre_chat_edit"`, `createdByRole: "system"`, `createdAt: now`, then patch, then `pruneSnapshots`). Do not copy the `researchSessionId` branch.
- `convex/lib/snapshots.ts:51-129,191-204` -- `snapshotAuditFields` and `pruneSnapshots`; read-only.
- `convex/snapshots.ts:261-307` -- `restoreSnapshot(snapshotId, targetReportId, expectedRevisionNumber)`: writes a `pre_restore` row and sets content back; used by the test to prove reversibility. Requires `expectedRevisionNumber === report.revisionNumber`.
- `convex/schema.ts:1164-1195` -- `reportSnapshots` table: `reason` union already contains `pre_chat_edit`; `label` optional. No change.
- `src/lib/components/history/VersionHistory.svelte:37-44,298,322` -- renders `s.label ?? REASON_LABELS[s.reason]`, so the `"Before client edit"` label displays without a frontend change.
- `convex/reviews.ts:40-101` -- `submitWriterReview`: move lines 59-68 (the `score >= 85` scheduler block) to after the `existing` branch so both the patch path and the insert path schedule after the write; keep the early-return of `existing._id` by restructuring to compute `reviewId` then schedule then return.
- `convex/brain.ts:205-217` -- `internal.brain.nominateFromReport` args `{ reportId, writerName?, score }`; read-only.
- `convex/schema.ts:504-518` -- `comments` fields needed for fixtures: `projectId`, `reportId`, `commenterId`, `commenterType`, `highlightFrom`, `highlightTo`, `highlightText`, `body`, `suggestedEdit`, `resolved`, `createdAt`.
- `convex/schema.ts:489-502` -- `reports` fields: `projectId`, `content` (JSON string of a ProseMirror doc), `version`, `generatedAt`, `updatedAt`, optional `revisionNumber`.
- `convex/lib/reportEdits.ts` -- `applyReplacements(doc, [{ find, replaceWith }])`; test fixture content must be a `{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }` document so the replacement counts exactly once.
- `convex/brainFeedback.test.ts:1-52` -- setup pattern (users with `authId`, `t.withIdentity({ subject: authId })`) and the `_scheduled_functions` query to reuse.
- `convex/projects.test.ts:1-90` -- `setup()`/`asActor` precedent for inserting `projects` fixtures (`name`, `status`, `createdBy`, timestamps).

## Tasks & Acceptance

**Execution:**
- `convex/comments.ts` -- in `acceptEdit`, after the replacement count check, insert the `pre_chat_edit` snapshot of the current report (label `"Before client edit"`, `createdByRole: "system"`, audit fields, `sourceRevisionNumber`), then perform the existing patches, then `pruneSnapshots` -- makes acceptance reversible via `restoreSnapshot`.
- `convex/reviews.ts` -- in `submitWriterReview`, move the nomination `scheduler.runAfter` below the `writerReviews` patch/insert so it is issued only after the write, returning the same id as before -- sequences nomination after the persisted review.
- `convex/commentsAcceptEdit.test.ts` -- new convex-test suite covering the four `acceptEdit` matrix rows, including the restore round-trip through `api.snapshots.restoreSnapshot` -- proves reversibility.
- `convex/writerReviews.test.ts` -- new convex-test suite covering the four `submitWriterReview` matrix rows using `_scheduled_functions` -- proves nomination follows a persisted review.
- Run `npm test` and `PUBLIC_CONVEX_URL=http://placeholder npm run check`; evaluate any other failing suite against **Block If**.

**Acceptance Criteria:**
- Given a report with a client comment carrying a suggested edit, when a writer calls `api.comments.acceptEdit` and then `api.snapshots.restoreSnapshot` with the snapshot created by that call, then the report `content` equals the content from before `acceptEdit`.
- Given `submitWriterReview` with `score >= 85`, when the mutation completes, then a `writerReviews` row with that score exists and exactly one `nominateFromReport` job is scheduled; when the mutation throws before writing, then neither exists.
- Given the change lands, when `npm test` runs, then every existing suite is still green.

## Spec Change Log

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 4: (high 0, medium 0, low 4)
- reject: 24
- addressed_findings:
  - `[medium]` `[patch]` Snapshot audit lineage (contentHash, generationId, sourceTranscriptId) was unasserted; the happy-path test now seeds a transcript + generation on the report, asserts them on the snapshot, and asserts they return to the report after restoreSnapshot.
  - `[medium]` `[patch]` pruneSnapshots on the acceptEdit path was unobserved (removing the call kept tests green); added a test seeding 55 manual snapshots + a milestone and asserting the recovery stream is capped at 50, the milestone survives, the oldest row is gone, and the new checkpoint is present.
  - `[low]` `[patch]` Authorization boundary untested beyond unauthenticated; added a NOT_AUTHORIZED case (authenticated user without internal role) asserting no snapshot/no patch.
  - `[low]` `[patch]` Cross-project report reference untested; added a NOT_FOUND case (comment.projectId != report.projectId) asserting no snapshot/no patch.
  - `[low]` `[patch]` Restore round-trip asserted only content; now asserts return value 5, revisionNumber 5, and that pre_chat_edit + pre_restore rows coexist; also asserts contentHash/provenanceId on the post-accept report.
  - `[low]` `[patch]` writerReviews.test.ts matched scheduled jobs by substring; now exact `brain:nominateFromReport`. Removed the no-op `as Id<"reports">` cast.
  - `[low]` `[patch]` Fixture highlightFrom/highlightTo offsets are not the real position; added a comment stating they are intentionally unused by acceptEdit.

## Auto Run Result

**Summary:** `acceptEdit` now writes a `pre_chat_edit` / "Before client edit" recovery snapshot (with `snapshotAuditFields` lineage) before patching the report and thins the stream with `pruneSnapshots`, mirroring `applyProposal`; `submitWriterReview` schedules `internal.brain.nominateFromReport` only after the `writerReviews` insert/patch. Two convex-test suites cover both mutations.

**Files changed:**
- `convex/comments.ts` -- acceptEdit: pre-edit snapshot insert + pruneSnapshots after the patches.
- `convex/reviews.ts` -- submitWriterReview: nomination scheduling moved below the review row write; return value unchanged.
- `convex/commentsAcceptEdit.test.ts` -- new: happy path with lineage + restore round-trip, prune retention, STALE_REVISION (0/2+ matches), INVALID_INPUT, NOT_AUTHORIZED, cross-project NOT_FOUND, NOT_AUTHENTICATED.
- `convex/writerReviews.test.ts` -- new: high/updated/low review persistence and nomination scheduling, missing-report rejection.

**Review findings:** 7 patched (medium 2, low 5), 4 deferred, 24 rejected, 0 intent_gap, 0 bad_spec.

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 5; score = 3*2 + 1*5 = 11 (>= 5).

**Verification:**
- `npm test -- commentsAcceptEdit writerReviews` -- 12 passed.
- `npm test` -- 104 files, 950 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:** Convex commits scheduled jobs only with the mutation, so the CAP-4 reorder is a code-sequence guarantee that no test can discriminate from the prior order (documented in Design Notes). The `pre_chat_edit` reason is shared with AI edits; only `label` distinguishes client-edit checkpoints. Re-submitting a high score schedules another nomination each time (dedup happens in `importSource`). Deferred items listed in frontmatter.

## Design Notes

The snapshot reuses `reason: "pre_chat_edit"` rather than adding a `pre_client_edit` literal because the epic constraint limits schema changes to optional fields, one new `generations.status` value, and indexes; the `label` field already carries the human-facing distinction and `VersionHistory.svelte` prefers `label` over the reason label. Convex mutations are transactional, so a throw anywhere already discards a queued `scheduler.runAfter`; the reorder is still made so the code states the intended sequence (write, then nominate) and so a future non-throwing failure branch cannot nominate an unpersisted review. The convex-test suite observes nomination through `_scheduled_functions` rows, matching `convex/brainFeedback.test.ts`.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- commentsAcceptEdit writerReviews` -- expected: all new tests pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.
