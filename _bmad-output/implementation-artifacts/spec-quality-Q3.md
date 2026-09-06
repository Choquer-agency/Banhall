---
title: 'Q3: Immediately retry copied running PD reviews'
type: 'bugfix'
created: '2026-09-05'
status: done
review_loop_iteration: 0
baseline_commit: 5f1998c9e486130e62569849a917ee1b79442791
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Copying a project copies its running PD reviews without scheduling a corresponding review action. The copied review prevents immediate retry until the current 15-minute stale reaper eventually fails it.

**Approach:** Convert only copied running reviews to failed at copy time, with an explanatory error, completion timestamp, and a system failure event for the new row. Preserve source records and historical provenance.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Preserve project access checks, immutable creator identity, transcript sets, revision/hash fields including zero/empty values, and non-running review copy behavior. Use the existing `review_failed` event contract with actor `system`, new destination review ID, destination project ID, explanatory detail and copy timestamp. Copying is not an AI execution failure in the source project; the detail must say the source was still running when duplicated. Record evidence under `.audit/quality-pass/Q3/`.

**Ask First:** A change to authorization or human workflow semantics requires root escalation; ordinary implementation and tests are already authorized.

**Never:** Edit source worktrees, commit, stage, push, install dependencies, change ledgers, alter the reaper, schedule copied AI work automatically, copy source event history, or change human workflow stage. Root owns independent three-lens review and final full gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Running source | Copy authorized source with running review | Destination failed immediately; error explains duplication; completedAt equals copy time; one system failure event references destination | Source row/events unchanged |
| Retry copy | Retry copied failed row with active nonempty copied PD | Normal retry creates new running review and schedules existing action | Existing configuration/access requirements remain |
| Historical rows | Completed/failed source, with optional provenance | Preserve status/result/model/error/completion and revision/hash values | No synthetic failure event |
| Restricted copy | Caller lacks existing source/destination access | Existing denial and atomic rollback | No copied rows/events |

</frozen-after-approval>

## Code Map

- `convex/projects.ts:828` `copyProjectInputRows` is shared by current `prepareProjectContentCopy` at 979 and legacy `copyProjectDocuments` at 1013. Its review insertion at 950 currently copies status at 959 and does not copy events.
- `convex/projects.ts:953` uses explicit undefined checks for revisionNumber/contentHash; preserve them.
- `convex/pdReviews.ts:85` `retryPdReview` checks terminal status and latest running row; use this real mutation to prove immediate retry. `failPdReview` at 343 and reaper at 308 establish terminal timestamp and system `review_failed` audit semantics.
- `convex/schema.ts:1722` defines existing event fields/action; no schema change needed.
- `convex/projects.test.ts:368` existing copy fixture and lines 459–468 provenance assertions; transcript-set tests begin at 1183. `convex/reaperIntegration.test.ts:28` provides provider configuration and scheduled-action testing patterns.

## Tasks & Acceptance

**Execution:**
- [x] `convex/projects.test.ts` — add actual mutation regression before production edits; capture failing destination-status/immediate-retry result against dispatched baseline.
- [x] `convex/projects.ts` — specialize copied running status/error/completedAt and retain inserted review ID for exactly one destination failure event; retain other row semantics.
- [x] `convex/projects.test.ts` — cover matrix, event linkage/cardinality, unchanged source, mixed historical rows, zero/empty provenance and actual retry; execute shared legacy entry point at least once.
- [x] `.audit/quality-pass/Q3/evidence.md` — record baseline SHA, commands, old failure and new pass, changed files and limitations. Root appends acceptance decisions to the canonical quality-pass decisions.tsv.

**Acceptance Criteria:**
- Given mixed source reviews, when either supported copy entry point completes, then only newly copied running rows receive synthetic terminal events and source project state remains unchanged.
- Given current provenance and transcript-set regressions, when targeted tests run after repair, then all remain green with no weakening of assertions.

## Spec Change Log

## Design Notes

The event is a truthful destination terminal-state audit using an existing system action, not copied historical activity. Set its timestamp and completedAt to the same captured copy time. Preserve non-running completion fields exactly as the current implementation does; do not broaden into historical timestamp cleanup. The copy is still one atomic mutation.

## Verification

**Commands:**
- `npm test -- convex/projects.test.ts convex/reaperIntegration.test.ts convex/pdReviewProjection.test.ts` — targeted new regression first fails on baseline, then all pass.
- `npx tsc --noEmit -p convex/tsconfig.json` — Convex types pass using root-provisioned dependencies.
- `git diff --check` — no whitespace errors; root runs repository full gate and independent review before finalization.

## Suggested Review Order

- Make copied running reviews immediately retryable without changing source history.
  [projects.ts:949](../../convex/projects.ts#L949)

- Prove remapping, timestamps, preserved transcripts and actual retry through both entry points.
  [projects.test.ts:477](../../convex/projects.test.ts#L477)
