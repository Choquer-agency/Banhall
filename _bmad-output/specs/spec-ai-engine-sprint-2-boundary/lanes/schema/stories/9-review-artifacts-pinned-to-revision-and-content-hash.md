---
title: 'Review artifacts pinned to revision and content hash'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: 'f122b086d745acc40b4decca26b9aaafc7257f6a'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A review records server state at submission, without proving that it is the content the reviewer previously viewed.
    evidence: |-
      submitWriterReview and saveQaItemFeedback accept target IDs without an expected revision or content hash. Existing callers may submit after another actor edits the report. CAP-9 preserves these public call shapes and records the current mutation-time target; caller observation fencing remains a separate existing workflow limitation.
    location: >-
      convex/reviews.ts:40;convex/reviews.ts:200
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Writer reviews, QA item feedback, and PD reviews lack durable identification of the content judged. Report IDs survive edits, so they cannot identify a revision alone.

**Approach:** Add optional revisionNumber and contentHash fields to the three review tables and populate them when reviews are submitted. Type writerReviews.userId as a users ID. Preserve compatibility with historical artifacts without a backfill.

## Boundaries & Constraints

**Always:** Derive provenance server-side from the reviewed target in the mutation that writes the review. Reports use their revisionNumber (default 0) and contentHash, computing SHA-256 of content if the stored hash is absent or empty. Candidates and documents have no revision lifecycle; use baseline revision 0 and SHA-256 of their content. Resubmissions update provenance alongside the judgment. Copying a historical PD review preserves its existing fields, including absence, because copying is not a new judgment. All three schema additions remain optional.

**Block If:** Implementation requires a new authority, workflow transition, or report prose mutation.

**Never:** No backfill, new revision lifecycle, stale-review rejection policy, new public API, required public argument, or UI change. Keep existing review upsert keys, QA candidate-to-report target-key continuity, scheduling, authorization, and result projections. Do not edit generated files or the epic's excluded learn/chat files (`convex/learning.ts`, `convex/ai/learning.ts`, `convex/brain.ts`, chat components, or admin brain routes).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Writer submission and resubmission | Report with revision/hash, then edited report | Same writer/report review row holds latest submission's revision/hash and typed actor ID | Existing auth rules |
| Legacy report | Missing revision and absent or empty hash | New writer/QA feedback stores revision 0 and SHA-256(content) | No new error |
| QA targets | Candidate, report, or selected report sharing a candidate target key | Insert/update pins actual submitted target content; candidate baseline is 0; report uses its revision | Existing auth rules |
| PD start/retry | Active document with plain-text content | Fresh review pins revision 0 and hash of document content | Existing guards |
| Review from project | Rich-text report serialized into a new uploaded PD | Review hashes the resulting document text, not rich-text source bytes | Existing guards |
| Historical PD copy | Attributed and unattributed old reviews | Copy preserves present provenance and legacy absence | No backfill |
| Old artifacts | Rows lacking both optional fields | Existing writer, QA, and PD queries still succeed | No new error |

</intent-contract>

## Code Map

- `convex/schema.ts:1506,1550,1619`: writerReviews, qaItemFeedback, pdReviews. Only writerReviews.userId changes from string to v.id("users").
- `convex/reviews.ts:40`: submitWriterReview upserts by user/report. Stamp both insert and patch; preserve nomination scheduling and reviewId.
- `convex/reviews.ts:138,191`: resolveQaTarget and saveQaItemFeedback. Derive from actual report/candidate, not targetKey (selected reports reuse candidate keys). Avoid adding hash computation to read-only feedback queries when not needed.
- `convex/lib/contracts.ts:244`: existing SHA-256 helper. `convex/projectWorkflow.ts` and CAP-7 establish report revision 0 and empty-hash fallback.
- `convex/pdReviews.ts:25,81`: start/retry insert running reviews. getReviewInput reads the source document; completion does not replace provenance.
- `convex/reviewFromProject.ts:182,207`: creates plain-text PD from extractPlainText(report.content), then starts its review. Hash pdText.
- `convex/projects.ts:936`: copyProjectInputRows duplicates historical pdReviews. Carry existing fields conditionally without inventing missing historical values.
- `convex/schema.ts:753,960`: candidates/documents have content but no revision counters. Document editing in documents.ts changes archive state, not content.
- `convex/reviews.test.ts`: existing writer mutation harness (touchpoints' writerReviews.test.ts does not exist). Add QA target coverage here or in a focused adjacent test file.
- `convex/pdReviewProjection.test.ts`, `convex/reviewFromProject.test.ts`, `convex/projects.test.ts`: PD starts, project conversion, legacy projections, and duplication harnesses.

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts`: add optional numeric revisionNumber and string contentHash on all three tables; narrow writerReviews.userId to v.id("users"); document baseline and historical absence.
- [x] `convex/reviews.ts`: stamp writer and QA inserts/updates using actual reviewed target; reuse sha256 and preserve existing API behavior.
- [x] `convex/pdReviews.ts`, `convex/reviewFromProject.ts`: stamp every newly started or retried PD review from its document bytes.
- [x] `convex/projects.ts`: preserve provenance through historical review duplication.
- [x] `convex/reviews.test.ts`, `convex/pdReviewProjection.test.ts`, `convex/reviewFromProject.test.ts`, `convex/projects.test.ts`: cover every matrix row through real Convex functions and stored rows, including resubmission after edits, candidate selection key reuse, legacy absence, empty hashes, and copy provenance. Update any legitimate users-ID fixtures required by the narrowed validator.
- [x] `.audit/CAP-9/evidence.md`: map acceptance/matrix coverage to tests and record actual verification outputs and canonical revision.

**Acceptance Criteria:**
- Given each public review creation/update path, when it commits, then the stored artifact identifies its reviewed content with revision and hash as described in the matrix.
- Given pre-change artifacts, when existing queries or historical-copy paths run, then optional-field absence remains valid without a backfill.
- Given the completed backend change, when repository verification runs, then checks and tests pass with no frontend or public argument changes.

## Spec Change Log

- 2026-09-04: Verification-only deviation: `vitest.config.ts` uses inline OXC compiler options after the unchanged `shared/workflowStages.test.ts` reproduced automatic tsconfig discovery failure in this nested worktree. Convex tsc and Svelte check remain unchanged. See `.audit/CAP-9/unchanged-runner-repro.log`.

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8 (high 0, medium 0, low 8)
- defer: 1 (high 0, medium 1, low 0)
- reject: 6 (high 0, medium 2, low 4)
- addressed_findings:
  - `[low]` `[patch]` Exercise legacy writer/QA resubmission, preserving IDs and adding provenance.
  - `[low]` `[patch]` Cover first submission against an already revisioned report with a stored hash.
  - `[low]` `[patch]` Cover independently absent report revision and hash fields.
  - `[low]` `[patch]` Change document content before retry and verify fresh provenance without changing the original review.
  - `[low]` `[patch]` Verify PD failure preserves the recorded revision and hash.
  - `[low]` `[patch]` Cover revision-only and hash-only historical PD copies.
  - `[low]` `[patch]` Preserve referenced verification logs and diagnostic configuration with the audit artifact.
  - `[low]` `[patch]` Append an explicit correction marking both initial decision timestamps unknown; preserve append-only history.

## Design Notes

CAP-7 already uses baseline revision 0 for legacy reports. Candidates and uploaded documents have no independent revision counter, so revision 0 plus their content hash identifies their baseline without adding a new lifecycle. Historical duplication carries evidence forward, like CAP-3 uploader provenance; missing historical evidence stays missing. New start/retry events always receive both fields. Current-time server pinning follows CAP-7; caller expected-revision fencing remains outside this additive schema story.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh`: Convex typecheck, application check, full unit suite, and uploader harnesses pass.
- `git diff --check`: no whitespace errors.
- `git diff --name-only`: no frontend, generated files, or excluded epic files changed.

## Auto Run Result

Status: done

Implemented optional revisionNumber/contentHash fields on writerReviews, qaItemFeedback, and pdReviews, and typed writerReviews.userId as a users ID. Writer and QA inserts/resubmissions pin the actual mutation-time target. PD start, retry, and report-conversion paths hash document text with baseline revision 0. Historical copies preserve both recorded provenance and absence.

Files changed:
- `convex/schema.ts`: optional provenance fields and typed writer user ID.
- `convex/reviews.ts`: writer/QA provenance on insert and update.
- `convex/pdReviews.ts`: document provenance at start/retry.
- `convex/reviewFromProject.ts`: provenance of the generated plain-text PD.
- `convex/projects.ts`: preserve historical review provenance through copies.
- `convex/reviews.test.ts`, `convex/pdReviewProjection.test.ts`, `convex/reviewFromProject.test.ts`, `convex/projects.test.ts`: matrix coverage and review hardening.
- `vitest.config.ts`: inline unit-test compiler options repair a reproduced automatic configuration-discovery failure.
- `.audit/CAP-9/`: evidence, decision trail, and referenced verification artifacts.

Independent review: eight low-severity patches applied, one medium-severity pre-existing limitation deferred, six findings rejected. No intent gaps or spec repair loopbacks. Follow-up review recommended: true; patched severity counts are high 0, medium 0, low 8, so the configured score is 8.

Verification: `bash scripts/loop-verify.sh` passed after the final patches: Convex typecheck, Svelte check with 0 errors and 0 warnings, 127 test files and 1,366 tests, PowerShell uploader 50 passed, Bash uploader 18 passed. One existing platform-specific PowerShell dotfile sub-case was skipped. `git diff --check` passed. No frontend, generated Convex, or excluded parallel-epic files changed.

Residual limitation: provenance identifies server content at submission time; it does not establish that a reviewer viewed that revision before submitting. This existing limitation is recorded in frontmatter for later work. Historical PD copies legitimately retain missing provenance.
