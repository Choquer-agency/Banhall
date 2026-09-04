---
title: 'Sprint1b story12 unlearn confirmation review repair'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'a0c78404a744bf75f4cc35e975b08c8292dd3fe5'
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval>

## Intent

**Problem:** Concurrent revokes and repeated completion delivery insert duplicate confirmations. A failure delivered after success restores an erased handle and queues needless remediation.

**Approach:** Use the existing source audit index and exact entry confirmation reason as a transactional terminal fence for both bookkeeping mutations.

## Boundaries & Constraints

**Always:** Preserve first compensation confirmation when the source never held the entry. Preserve source and entry independence, reapproval guards, deletion-only remediation, historical failure evidence, and source-less callers.

**Ask First:** A change requiring new product policy.

**Never:** Add schema fields or indexes, change public arguments, change frontend or embed retries, edit deferred ledger status, or push. Root owns integration.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Repeated revokes | Two revokes before drain | One revoke and one confirmation | None |
| Repeated delivery | Same source and erased entry | One confirmation | None |
| Stale failure | Success already recorded | No restored id, new failure record, or retry | Action still rethrows |
| Compensation | Revoked row never held id | First confirmation retained | None |
| Reapproval | Approved row without id receives failure | No id or failure audit | Action rethrows |
| Pending hit | High scoring pending result | Excluded before ranking | None |

</frozen-after-approval>

## Code Map

- `convex/brain.ts`: recordUnlearnConfirmed and recordUnlearnFailure own atomic bookkeeping; existing reason is `Erasure confirmed for entry ${id}`.
- `convex/schema.ts`: read-only brainAuditLog by_source index; reason is optional string.
- `convex/brainUnlearn.test.ts`: convex-test harness with mocked external erase seam and scheduled-job inspections.
- `convex/brainErase.test.ts`: existing positive-read erase contract tests.
- `.audit/sprint1b-12-review/review.md`: complete independent review, retained findings only.
- `_bmad-output/specs/spec-ai-engine-sprint-1b/stories/12-confirmed-unlearn-with-failure-evidence-and-retry-free-embeds.md`: original requirements; align contradictory AC with specified per-attempt failures and eventual exactly-one success only.

## Tasks & Acceptance

**Execution:**
- [x] `convex/brainUnlearn.test.ts`: reproduce duplicate and stale-failure defects before fixing; cover matrix and source/entry scope.
- [x] `convex/brain.ts`: reuse indexed audit lookup transactionally to deduplicate confirmation and stop stale failure bookkeeping.
- [x] Original story: clarify failure evidence exception and eventual confirmation without new policy.
- [x] `.audit/sprint1b-12-repair/`: preserve reproduction, focused and native gate evidence plus review.

**Acceptance Criteria:**
- Given repeated confirmation or revokes for an erased source-entry pair, when bookkeeping settles, then only one confirmation exists.
- Given a confirmed source-entry pair, when an older failure arrives, then its row stays erased and no further retry is scheduled.
- Given a different source or entry, when first confirmed, then unrelated evidence does not suppress that confirmation.
- Given a failed attempt followed by successful remediation, when it settles, then historical failure evidence remains and exactly one confirmation exists.

## Spec Change Log

- 2026-09-04: Bounded retained-review repair authorized by parent; existing user authorization supersedes confirmation checkpoints. No ledger edits.

## Design Notes

An exact match of action and existing reason prevents substring collisions and recognizes historical confirmations without migrating data. Iterate the source index until a match; never truncate the search and accidentally treat missing results as absence. Query and write occur in one Convex mutation, whose conflict detection protects repeated deliveries.

## Verification

- `npx vitest run convex/brainUnlearn.test.ts convex/brainErase.test.ts --maxWorkers=2`
- `bash scripts/loop-verify.sh`

## Review Triage

Three independent BMAD build layers completed. Retained: historical confirmation still clears an equal stale handle; centralize the persisted reason; cover truly overlapping failure delivery and historical audit compatibility. Review detail: `.audit/sprint1b-12-repair/review.md`. Native gate passed: 1,364 tests in 127 files, zero Svelte errors/warnings, and 68 uploader checks. Final focused suite passes 27 tests; Convex tsc rerun records final patch verification.

## Suggested Review Order

- Recognize persisted entry confirmations without adding schema fields.
  [brain.ts:439](../../convex/brain.ts#L439)

- Clear matching handles while deduplicating confirmation atomically.
  [brain.ts:476](../../convex/brain.ts#L476)

- Reject stale failure bookkeeping after a confirmed erasure.
  [brain.ts:503](../../convex/brain.ts#L503)

- Reproduce repeated revokes, overlapping delivery, and historical confirmation compatibility.
  [brainUnlearn.test.ts:296](../../convex/brainUnlearn.test.ts#L296)

