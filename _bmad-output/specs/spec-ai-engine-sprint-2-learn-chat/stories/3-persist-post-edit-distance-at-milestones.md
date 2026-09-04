---
title: 'Persist post-edit distance at milestones (CAP-2)'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '44f3eed02df18eda7d913251dd7e9fd2d91e9294'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      deleteProject cascades to reports, comments, generations and pdReviews but
      not to reportEditDistance, so a deleted project's readings stay in a
      writer's series forever.
    evidence: |-
      convex/projects.ts:1140-1184 enumerates the cascade; reportEditDistance is
      absent. seriesForWriter (convex/reportEditDistance.ts) keys on
      writerUserId, not project access, so orphaned rows stay readable. Not
      routed as a patch because the same cascade already omits reportSnapshots,
      reportProvenance, writerReviews, candidateScores and modelSelections --
      this is a house-wide retention gap, and the story's intent-contract
      restricts convex/projects.ts to the scheduled publish call.
    location: >-
      convex/projects.ts:1140
    severity: medium
  - summary: >-
      A report whose content JSON fails to parse persists a bogus ped 1 reading
      instead of recording nothing.
    evidence: |-
      extractPlainText (convex/lib/reportEdits.ts:168-193) swallows JSON.parse
      failures and returns "". recordReportEditDistance then computes
      computeEditDistance(draft, "") = ped 1 and writes it as a legitimate
      "fully rewritten" data point; if both sides fail it writes ped 0. The
      read-time query has always had the same blind spot, but persistence makes
      the bogus point permanent in the trend.
    location: >-
      convex/lib/editDistance.ts
    severity: medium
  - summary: >-
      Prose that chatV2 applied from accepted AI proposals is counted as writer
      rework, inflating the metric that is supposed to measure draft quality.
    evidence: |-
      convex/chatV2.ts applies accepted proposals directly to reports.content, so
      the delta against the generated baseline mixes writer keystrokes with
      AI-applied edits. The row carries no way to separate them. Pre-existing in
      the PED formula, which CAP-2 explicitly leaves unchanged, but it bounds how
      the CAP-3 trend can be read.
    location: >-
      convex/lib/editDistance.ts
    severity: low
  - summary: >-
      docs/system-map.md still labels reports.postEditDistance a dead end that is
      "never stored".
    evidence: |-
      docs/system-map.md:359 reads
      `PED[reports.postEditDistance query] -.->|DEAD-END: computed on read, never
      stored, no UI caller| NW2((no reader))`. Half of that is now false. Left
      for CAP-3, which adds the UI reader and makes the other half false too, so
      the line can be rewritten once instead of twice.
    location: >-
      docs/system-map.md:359
    severity: low
  - summary: >-
      No PED reading is taken at project finalization, so client-review rework is
      never measured.
    evidence: |-
      The trigger union stops at client_publish. projects.finalizeProject
      (convex/projects.ts:1059) is the state where the writer has actually
      stopped editing; every round of client-review rework after first publish is
      invisible to the series. CAP-2's success criterion names only the three
      implemented triggers, so this is an extension, not a miss.
    location: >-
      convex/schema.ts reportEditDistance.trigger
    severity: low
  - summary: >-
      Reports that already hold a generated baseline start with an empty series
      and can never recover their candidate-selection origin point.
    evidence: |-
      recordReportEditDistance only runs at new triggers, so existing reports get
      their first row at the next milestone or publish. A one-shot internal
      backfill over existing reason:"generated" snapshots would seed the trend;
      the story's intent-contract explicitly excludes backfill.
    location: >-
      convex/reportEditDistance.ts
    severity: low
  - summary: >-
      The client_publish reading is taken by a scheduled mutation, so a report
      edited between publishForReview and the drain records post-publish content.
    evidence: |-
      convex/projects.ts calls ctx.scheduler.runAfter(0,
      internal.reportEditDistance.recordAtPublish, ...) and recordAtPublish
      re-reads the report at drain time. The intent-contract mandates exactly
      this scheduled shape, so tightening it (passing revisionNumber and
      refusing to record if it moved) is a change to the contract, not a patch.
    location: >-
      convex/reportEditDistance.ts recordAtPublish
    severity: low
  - summary: >-
      convex/_generated/api.d.ts carries a two-line hand edit registering
      reportEditDistance, which AGENTS.md forbids.
    evidence: |-
      npx convex codegen refuses in this worktree (No CONVEX_DEPLOYMENT set), so
      the module could not be registered by regeneration. The two added lines
      are byte-identical to codegen output and correctly sorted; a real
      npx convex dev supersedes them and will also add the still-missing
      lib/deidentify and lib/editDistance entries.
    location: >-
      convex/_generated/api.d.ts
    severity: low
  - summary: >-
      The generated-baseline lookup filters reason over the whole by_reportId
      range instead of using a [reportId, reason] index.
    evidence: |-
      convex/lib/editDistance.ts generatedBaseline and convex/reports.ts
      postEditDistance both run withIndex("by_reportId").filter(reason ===
      "generated").first(). On a report with many snapshots this scans the range
      inside every milestone and publish mutation. Pre-existing in reports.ts;
      persistence just puts it on two more write paths.
    location: >-
      convex/lib/editDistance.ts
    severity: low
  - summary: >-
      seriesForReport and seriesForWriter declare no returns validator, which a
      convex-lint hook flags.
    evidence: |-
      recordAtPublish declares returns: v.null(); the two queries in
      convex/reportEditDistance.ts do not. Adding them widens the diff beyond
      the intent-contract's described surface, so it belongs to a convention
      sweep rather than this story.
    location: >-
      convex/reportEditDistance.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Post-edit distance (PED) — the north-star "is the system improving" metric — is computed only on read inside `reports.postEditDistance`, has no caller, and is never stored, so no trend over time or per writer can be read.

**Approach:** Extract the PED math into a pure `convex/lib/editDistance.ts`, add a `reportEditDistance` table, write one row at three milestones (candidate selection, milestone snapshot, `client_review` publish), and expose per-report and per-writer series queries from a new `convex/reportEditDistance.ts`.

## Boundaries & Constraints

**Always:**
- `reports.postEditDistance` keeps its exact current argument shape, auth behaviour, and returned object shape; the only permitted change to `convex/reports.ts` is deleting the moved helpers and delegating to the extracted module.
- The PED formula is unchanged: word-multiset Sørensen–Dice similarity plus unchanged-paragraph ratio against the first `reason: "generated"` snapshot for the report (`.first()` on the `by_reportId` index).
- Recording never throws into its caller's path: a report with no `generated` baseline records nothing and the caller proceeds.
- Every recorded row carries `projectId` and `writerUserId` (`project.ownerId`) so the per-writer series is an index read, not a scan.
- Convex rules from `convex/_generated/ai/guidelines.md`: object-form functions, argument validators on every function, index names listing all their fields.

**Block If:**
- The extraction cannot preserve `postEditDistance`'s returned shape byte-for-byte.

**Never:**
- Do not edit `convex/reports.ts` beyond the extraction/delegation described above.
- Do not edit `convex/ai/chatAgentV2.ts`, `convex/chatV2.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/pipeline.ts`, `convex/lib/auth.ts`, `convex/projectWorkflow.ts`, or `convex/ai/qaChecks.ts`.
- No UI in this story (`/admin/learning` is CAP-3). No backfill of historical reports. No change to snapshot retention.
- `convex/projects.ts` gains only the `internal` import and a single scheduled internal-mutation call inside `publishForReview`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Candidate selection | `selectReportCandidate` (or single-candidate / iterative completion) materializes a report + its `generated` baseline | One `reportEditDistance` row: `ped: 0`, `revisionNumber: 0`, `trigger: "candidate_selection"` | No error expected |
| Milestone snapshot | `snapshots.createMilestoneSnapshot` on a report whose content diverged from the baseline | One row with `ped > 0`, `revisionNumber` = report's, `trigger: "milestone"` | No error expected |
| Client publish | `projects.publishForReview` | Scheduled internal mutation writes one row with `trigger: "client_publish"` | No error expected |
| No baseline | Report predating baseline snapshots reaches any trigger | No row written; the trigger's own work still completes | No error expected |
| Repeat trigger | `publishForReview` called twice with no edit in between | Second call writes no row (same trigger + revisionNumber + ped as the report's newest row) | No error expected |
| Per-report read, no access | Anonymous or non-internal caller calls `seriesForReport` | `null` | No error expected |
| Per-writer read, wrong actor | Writer requests another writer's series | Throws `NOT_AUTHORIZED` | `domainError("NOT_AUTHORIZED", ...)` |
| Empty text | Baseline and current both extract to empty plain text | `similarity` 1, `ped` 0 (unchanged from today) | No error expected |

</intent-contract>

## Code Map

- `convex/reports.ts:404-499` -- the code to move: `wordBag`, `bagOverlap`, `bagSize`, `normalizePara`, and the body of the `postEditDistance` query (`:442`). The query keeps its `getProjectAccess` / `client_review` `sharedReportId` guard and its baseline lookup; only the math after `extractPlainText` moves. `extractPlainText` comes from `./lib/reportEdits:168`.
- `convex/reports.ts` returned shape to preserve verbatim: `{ ped, wordSimilarity, draftWords, currentWords, paragraphsTotal, paragraphsUnchanged, draftLabel, baselineAt }`. The first six come from the extracted function; `draftLabel`/`baselineAt` stay in the query (snapshot fields).
- `convex/generations.ts:953-1004` -- `createGeneratedReportArtifacts`: the single choke point for every `reason: "generated"` baseline that belongs to a report. It early-returns an existing report id at `:967` (no baseline, so no PED row). Its three callers are `:1155` (single-candidate completion), `:2051` (iterative approve), `:2778` (`selectReportCandidate`). Hook the recording once, after the `reportSnapshots` insert at `:988-1003`.
- `convex/generations.ts:1043-1057` and `:2071-2086` -- the two ghost "comparison" `generated` snapshots. They are inserted *after* the real baseline so `.first()` still finds the real one (see the comment at `:2059-2062`). Do **not** record PED at these sites.
- `convex/snapshots.ts:205-262` -- `createMilestoneSnapshot`; `report` and `revisionNumber` are in scope. Record after the insert, before/after `pruneSnapshots` (order irrelevant — `snapshotIdsToDelete` at `convex/lib/snapshots.ts:195-200` never deletes `milestone` or `generated` rows).
- `convex/projects.ts:1017-1040` -- `publishForReview`; `report` and `args.reportId` in scope after the ownership check at `:1030-1033`. Add `ctx.scheduler.runAfter(0, internal.reportEditDistance.recordAtPublish, { reportId })` after the `ctx.db.patch`. `internal` is not yet imported here (`:1-25` imports only `_generated/server`, `convex/values`, `_generated/dataModel`, and local libs) — add `import { internal } from "./_generated/api";`.
- `convex/schema.ts:525-540` -- `reports` (has `revisionNumber`, `generationId`, `projectId`). `convex/schema.ts:1227-1264` -- `reportSnapshots` with `reason: "generated"` and index `by_reportId`. `convex/schema.ts:67-127` -- `projects.ownerId` is the durable accountable writer (PSOS-07); use it for `writerUserId`.
- `convex/lib/auth.ts:33-42` (`getInternalProjectAccessOrNull`), `:91-101` (`requireRole`), `:26-30` (`requireCurrentUser`) -- the auth helpers for the two queries.
- `convex/lib/contracts.ts` -- `domainError(code, message)`, used throughout for typed failures.
- `convex/lib/snapshots.ts:237-250` -- `pruneSnapshots`; confirms baselines are retention-exempt, so a recorded PED row always has a surviving baseline.
- `convex/learning.test.ts:1-27` -- the `convexTest(schema, modules)` + `t.withIdentity({ subject })` fixture shape to copy. `convex/lib/deidentify.test.ts` -- the pure-helper test shape for `convex/lib/editDistance.test.ts`.
- `convex/aiUsage.ts:264` -- `ctx.scheduler.runAfter(0, internal.X.Y, args)` call precedent.
- No existing caller of `postEditDistance` anywhere in `convex/` or `src/` (`docs/system-map.md:359` records it as a dead end), so the extraction has no consumer risk.

## Tasks & Acceptance

**Execution:**
- `convex/lib/editDistance.ts` -- new module. Export `computeEditDistance(draftText: string, currentText: string)` containing the moved `wordBag`/`bagOverlap`/`bagSize`/`normalizePara` helpers and returning `{ ped, wordSimilarity, draftWords, currentWords, paragraphsTotal, paragraphsUnchanged }`. Also export `recordReportEditDistance(ctx: MutationCtx, report: Doc<"reports">, trigger: EditDistanceTrigger): Promise<Id<"reportEditDistance"> | null>` which loads the `generated` baseline (returns `null` if absent), computes PED, applies the repeat-trigger dedupe, resolves `writerUserId` from the project, and inserts. -- one pure math source of truth plus one write path shared by all three triggers.
- `convex/schema.ts` -- add `reportEditDistance` table: `reportId`, `projectId`, `generationId` (optional), `writerUserId` (optional `id("users")`), `revisionNumber`, `ped`, `computedAt`, `trigger` (union of `"candidate_selection" | "milestone" | "client_publish"`); indexes `by_reportId`, `by_projectId`, `by_writerUserId_and_computedAt`. -- persistence + index-only reads for both series.
- `convex/reports.ts` -- delete the four moved helpers; have `postEditDistance` call `computeEditDistance` and spread its result alongside `draftLabel`/`baselineAt`. No other change. -- keeps the read-time query and the persisted rows on one formula.
- `convex/reportEditDistance.ts` -- new module: `seriesForReport` query (arg `reportId`; `getInternalProjectAccessOrNull` on the report's project, `null` when denied or report missing; rows ascending by `computedAt`), `seriesForWriter` query (args `writerUserId`, optional `sinceDays`; allowed for admin/manager or the writer themselves, else `NOT_AUTHORIZED`), and `recordAtPublish` internal mutation (arg `reportId`; no-op if the report is gone, else `recordReportEditDistance(..., "client_publish")`). -- the read surface CAP-3 consumes and the scheduler target for publish.
- `convex/generations.ts` -- in `createGeneratedReportArtifacts`, after the baseline `reportSnapshots` insert, load the new report and call `recordReportEditDistance(ctx, report, "candidate_selection")`. -- one hook covers all three candidate-selection paths.
- `convex/snapshots.ts` -- in `createMilestoneSnapshot`, after the snapshot insert, call `recordReportEditDistance(ctx, report, "milestone")`. -- milestone trigger.
- `convex/projects.ts` -- add the `internal` import and the single `ctx.scheduler.runAfter(0, internal.reportEditDistance.recordAtPublish, { reportId: report._id })` at the end of `publishForReview`. -- publish trigger with the minimum footprint the epic allows in this file.
- `convex/lib/editDistance.test.ts` -- new pure-function tests for `computeEditDistance`: identical text (`ped` 0, all paragraphs unchanged), fully rewritten text (`ped` near 1, 0 unchanged), both-empty (`wordSimilarity` 1), and paragraph counting across `\n` and `\n\n` separators. -- covers the "Empty text" matrix row and locks the formula.
- `convex/reportEditDistance.test.ts` -- new convex-test suite covering the remaining matrix rows: a row at candidate selection with `ped: 0`; a row with `ped > 0` after a milestone snapshot on edited content; a publish row via the scheduled mutation; no row when the report has no `generated` baseline; no duplicate row on a repeat publish with no edits; `seriesForReport` returning `null` without internal access and ascending rows with it; `seriesForWriter` returning the owner's rows for an admin and throwing for an unrelated writer. -- one test per matrix scenario.

**Acceptance Criteria:**
- Given a project whose report was created by selecting a candidate, when an admin calls `seriesForReport`, then exactly one row is returned with `trigger: "candidate_selection"` and `ped` 0.
- Given a report with a `generated` baseline that has since been edited, when `createMilestoneSnapshot` succeeds, then a `reportEditDistance` row exists with `trigger: "milestone"`, the report's current `revisionNumber`, and `ped > 0`.
- Given a published-for-review report, when the scheduled functions drain, then a row with `trigger: "client_publish"` exists and its `writerUserId` equals the project's `ownerId`.
- Given a report with no `generated` snapshot, when any of the three triggers fires, then no row is written and the triggering mutation still succeeds.
- Given the same report text and baseline, when `reports.postEditDistance` and a persisted row are compared, then their `ped` values are identical.
- Given `npm run check` and `npm test`, when run after the change, then both pass with no new errors.

## Spec Change Log

## Review Triage Log

### 2026-09-04 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 26: (high 0, medium 0, low 26)
- addressed_findings:
  - `[low]` `[patch]` Baseline selection was correct only by construction: iterative generations insert a ghost comparison snapshot that also carries `reason: "generated"`, and no fixture had two such rows, so switching `generatedBaseline` to `.order("desc")` passed the suite. Added a `withGhost` fixture and a milestone case asserting the persisted `ped` equals the real-baseline distance and differs from the ghost's; mutation-checked.
  - `[low]` `[patch]` The "cap keeps the NEWEST readings" contract of `seriesForReport` / `seriesForWriter` was unpinned (no test exceeded 500 / 1000 rows, so dropping `.order("desc")` + `.reverse()` passed). Exported `REPORT_ROW_LIMIT` / `WRITER_ROW_LIMIT` and added LIMIT+1 cases asserting the oldest row is the one dropped; mutation-checked.
  - `[low]` `[patch]` The telemetry-swallow guarantee in `recordReportEditDistance` had no failure-path test, so deleting the try/catch passed. Added a unit case with a stub `MutationCtx` whose `db.query` throws, asserting the call resolves `null` and logs once; mutation-checked.
  - `[low]` `[patch]` `convex/lib/editDistance.test.ts` referenced "recorded deferred work" with no locator; the comment now names DW-44 and the ledger path.

### 2026-09-04 — Review pass (resumed run)
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 1, low 5)
- defer: 4: (high 0, medium 0, low 4)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` The Block-If (postEditDistance keeps its returned shape) was unpinned: both assertions on the query read only `.ped`, so renaming or dropping any of the other seven forwarded keys passed the suite. Added a case asserting the exact eight-key set and the six metric values against `computeEditDistance` on the same plain text.
  - `[low]` `[patch]` `seriesForReport` took the OLDEST 500 rows (ascending index + `.take`), dropping the newest readings past the cap — the opposite of `seriesForWriter`'s policy; now reads `.order("desc").take(...)` and restores oldest-first.
  - `[low]` `[patch]` `seriesForReport`'s ordering was `computedAt` alone, undefined for a milestone and an immediately-drained publish sharing a millisecond; ties now break on `_creationTime`.
  - `[low]` `[patch]` `sinceDays` rejected non-finite and non-positive values but not finite-but-huge ones (`1e308` overflowed to `since = -Infinity` at the index bound); now capped at `MAX_SINCE_DAYS` 36500.
  - `[low]` `[patch]` `seriesForWriter`'s oldest-first contract was unobservable — every case saw at most one row after filtering, so deleting the `.reverse()` passed. Added a three-row in-range case, mutation-checked to fail without the reverse.
  - `[low]` `[patch]` `convex/lib/editDistance.test.ts` covered both-empty and fully-rewritten but neither asymmetric-empty direction; added empty-draft and edited-to-empty cases pinning current behaviour.

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 4, low 1)
- defer: 6: (high 0, medium 2, low 4)
- reject: 14: (high 0, medium 0, low 14)
- addressed_findings:
  - `[medium]` `[patch]` `seriesForReport` / `seriesForWriter` used unbounded `.collect()`; bounded to 500 / newest 1000 rows while preserving the oldest-first contract.
  - `[medium]` `[patch]` `seriesForWriter`'s self branch skipped the anonymous check the elevated branch applied; anonymous callers are now rejected before the branch, matching `requireInternalProjectAccess`.
  - `[medium]` `[patch]` `recordReportEditDistance` violated the spec's "never throws into its caller's path" Always for every failure except a missing baseline; the body is now wrapped so a failure logs and returns null.
  - `[medium]` `[patch]` Test gaps let real regressions ship silently; added cross-trigger (milestone then publish → two rows), a manager caller, an anonymous record carrying `role: "admin"`, and an ownerless project, and tightened the milestone `ped` assertion to exact equality.
  - `[low]` `[patch]` `sinceDays` reached the index bound unvalidated (negative → future cutoff, NaN/Infinity passed through); now rejected with `INVALID_INPUT`.

## Design Notes

Extraction boundary — the query keeps I/O and auth, the module keeps math:

```ts
// convex/lib/editDistance.ts
export type EditDistanceResult = {
  ped: number; wordSimilarity: number; draftWords: number;
  currentWords: number; paragraphsTotal: number; paragraphsUnchanged: number;
};
export function computeEditDistance(draftText: string, currentText: string): EditDistanceResult { /* moved verbatim */ }
```
```ts
// convex/reports.ts postEditDistance, after the baseline lookup
const result = computeEditDistance(extractPlainText(baseline.content), extractPlainText(report.content));
return { ...result, draftLabel: baseline.label, baselineAt: baseline.createdAt };
```

Repeat-trigger dedupe: read the report's newest row (`by_reportId`, `.order("desc").first()`) and skip the insert when its `trigger`, `revisionNumber`, and `ped` all match the row about to be written. This suppresses a double `publishForReview` while still recording a milestone that legitimately lands on the same revision as a prior publish with a different trigger.

`writerUserId` is `project.ownerId` — the durable accountable owner (PSOS-07), not `createdBy`, which the domain contract forbids repurposing. It stays optional because `ownerId` is still optional on legacy projects; those rows simply never appear in a per-writer series.

## Verification

**Commands:**
- `PUBLIC_CONVEX_URL=http://localhost npm run check` -- expected: no new type or svelte-check errors.
- `npm test -- convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts` -- expected: all new tests pass.
- `npm test` -- expected: full backend suite green, with `convex/reports.test.ts`, `convex/snapshots.test.ts`, `convex/generationLifecycle.test.ts`, and `convex/projects.test.ts` unaffected.

## Auto Run Result

Status: done

**Summary.** Follow-up review pass on the completed CAP-2 story (post-edit distance
persisted at candidate selection, milestone snapshots and `client_review` publish, with
`seriesForReport` / `seriesForWriter` read surfaces). No implementation change was
needed; the pass closed four verification gaps in the test suite and re-ran the full gate.

**Files changed (this pass)**
- `convex/reportEditDistance.ts` — `REPORT_ROW_LIMIT` / `WRITER_ROW_LIMIT` exported so
  the cap tests cannot drift from the constants. No behaviour change.
- `convex/reportEditDistance.test.ts` — `withGhost` fixture + ghost-baseline milestone
  case; two cap-direction cases (LIMIT+1 rows, oldest dropped).
- `convex/lib/editDistance.test.ts` — failure-path case for `recordReportEditDistance`
  (stub ctx throws → resolves `null`, logs once); DW-44 reference in the asymmetric-empty
  comment.

**Review findings.** 4 patched (all low), 0 deferred, 26 rejected, 0 intent gaps,
0 spec defects. Rejected findings were either intent-mandated behaviour (`.first()` on
`by_reportId`, newest-row dedupe key, `null` vs `NOT_AUTHORIZED` contracts, verbatim
formula), already tracked in `_bmad-output/implementation-artifacts/deferred-work.md`
(DW-43 cascade, DW-44 unparseable content, DW-49 publish skew, DW-50 generated edit,
DW-51 baseline index, DW-52 returns validators), or cosmetic.

**Follow-up review recommended: false.** Patched this pass: high 0, medium 0, low 4;
score = 3x0 + 1x4 = 4, below the threshold of 5.

**Verification.**
- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts` —
  29 passed.
- Mutation checks, each reverted: `generatedBaseline` with `.order("desc")` fails only
  the ghost case; `seriesForWriter` without desc/reverse fails only the writer cap case;
  `recordReportEditDistance` without try/catch fails the swallow case.
- `bash scripts/loop-verify.sh` — rc=0: `npx tsc -p convex/tsconfig.json --noEmit`,
  `npm run check`, `npm test` (126 files / 1284 tests passed), client-uploader harnesses
  (50 and 18 passed). A first gate run hit a 5s timeout in
  `src/lib/components/ui/formControlContract.test.ts` (a source-scan test unrelated to
  this story, ~4s alone); it passed in isolation and on the clean re-run.

**Residual risks.** Unchanged from the prior pass and all tracked in the ledger
(DW-43 to DW-52). The ghost-baseline ordering is guaranteed by insertion order in
`convex/generations.ts`, now pinned by a test but not by a stronger lookup key (DW-51
covers the index shape).
