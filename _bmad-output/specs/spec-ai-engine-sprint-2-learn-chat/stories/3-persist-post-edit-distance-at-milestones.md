---
title: 'Persist post-edit distance at milestones (CAP-2)'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '740008e1369faaf6eab001f95efeb10a9e52d1e5'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      convex/_generated/api.d.ts was hand-edited to register the new
      reportEditDistance module because codegen cannot run in this worktree.
    evidence: |-
      `npx convex codegen` exits with "No CONVEX_DEPLOYMENT set, run `npx convex
      dev` to configure a Convex project". The two lines added (the
      `import type * as reportEditDistance from "../reportEditDistance.js";` at
      api.d.ts:106 and the `reportEditDistance: typeof reportEditDistance;` map
      entry at :226) match codegen's shape and sorted position, but the file
      should be regenerated on a machine with a deployment configured to confirm
      it byte-for-byte. `convex/lib/editDistance.ts` is deliberately absent from
      api.d.ts: it exports no Convex functions, matching how codegen already
      omits convex/lib/deidentify.ts.
    location: >-
      convex/_generated/api.d.ts:106
    severity: low
  - summary: >-
      deleteProject cascades to transcripts, reports, comments, generations and
      pdReviews but not to reportEditDistance, so a deleted project's readings
      stay in a writer's series forever.
    evidence: |-
      convex/projects.ts:1106 enumerates the cascade; reportEditDistance is
      absent. seriesForWriter keys on writerUserId, not project access, so
      orphaned rows stay readable. Not patched because the same cascade already
      omits reportSnapshots, reportProvenance, writerReviews, candidateScores
      and modelSelections -- a house-wide retention gap -- and the intent
      restricts convex/projects.ts to the scheduled publish call.
    location: >-
      convex/projects.ts:1106
    severity: medium
  - summary: >-
      A report whose content JSON fails to parse persists a bogus ped 1 reading
      instead of recording nothing.
    evidence: |-
      extractPlainText (convex/lib/reportEdits.ts:168) swallows JSON.parse
      failures and returns "". recordReportEditDistance then computes
      computeEditDistance(draft, "") = ped 1 and writes it as a legitimate
      "fully rewritten" point; if both sides fail it writes ped 0. The read-time
      query has always had the same blind spot, but persistence makes the bogus
      point permanent in the trend.
    location: >-
      convex/lib/editDistance.ts
    severity: medium
  - summary: >-
      The client_publish reading is taken by a scheduled mutation, so a report
      edited between publishForReview and the drain records post-publish
      content and revisionNumber.
    evidence: |-
      convex/projects.ts schedules internal.reportEditDistance.recordAtPublish
      with only reportId, and recordAtPublish re-reads the report at drain time.
      The intent (touchpoints CAP-2) mandates "add a scheduled internal mutation
      call only" in this file, so passing and enforcing a revision is a change
      to the contract, not a patch.
    location: >-
      convex/reportEditDistance.ts recordAtPublish
    severity: low
  - summary: >-
      The generated-baseline lookup is duplicated in two files and filters
      reason over the whole by_reportId range instead of using a
      [reportId, reason] index.
    evidence: |-
      convex/reports.ts postEditDistance and convex/lib/editDistance.ts
      recordReportEditDistance both run
      withIndex("by_reportId").filter(reason === "generated").first(). The
      duplication is now pinned by a test on both surfaces, but a shared
      findGeneratedBaseline helper plus a compound index would remove the range
      scan from two mutation paths. Pre-existing in reports.ts; persistence puts
      it on two more write paths.
    location: >-
      convex/lib/editDistance.ts
    severity: low
  - summary: >-
      Reports that already hold a generated baseline start with an empty series
      and can never recover their candidate-selection origin point.
    evidence: |-
      recordReportEditDistance only runs at new triggers, so existing reports
      get their first row at the next milestone or publish. The data to seed the
      trend exists (snapshotIdsToDelete never prunes reason:"generated"), so a
      one-shot internal backfill would work; the intent explicitly excludes
      backfill from this story.
    location: >-
      convex/reportEditDistance.ts
    severity: low
  - summary: >-
      docs/system-map.md still labels reports.postEditDistance a dead end that
      is "never stored".
    evidence: |-
      docs/system-map.md:359 reads `PED[reports.postEditDistance query]
      -.->|DEAD-END: computed on read, never stored, no UI caller| NW2((no
      reader))`. Half of that is now false. Left for CAP-3, which adds the UI
      reader and makes the other half false too, so the line can be rewritten
      once instead of twice.
    location: >-
      docs/system-map.md:359
    severity: low
  - summary: >-
      Neither restoreSnapshot nor finalizeProject takes a reading, so a restore
      and every round of client-review rework are invisible to the series.
    evidence: |-
      The trigger union stops at client_publish. snapshots.restoreSnapshot can
      move content arbitrarily far from the AI draft and the next recorded
      reading jumps with no row explaining why; projects.finalizeProject is
      where the writer has actually stopped editing. CAP-2's success criterion
      names only the three implemented triggers, so these are extensions.
    location: >-
      convex/schema.ts reportEditDistance.trigger
    severity: low
  - summary: >-
      Both series queries truncate silently at their caps with no cursor or
      truncated flag, so a long-lived report or writer shows a partial window
      presented as the full history.
    evidence: |-
      SERIES_FOR_REPORT_LIMIT 200 and SERIES_FOR_WRITER_LIMIT 500 keep the
      newest readings (tested), but neither query accepts a cursor nor reports
      that it dropped rows; for seriesForReport the dropped row is the ped-0
      candidate_selection origin point, so a capped trend appears to start
      mid-flight. Paging belongs to CAP-3, which owns the dashboard.
    location: >-
      convex/reportEditDistance.ts
    severity: low
  - summary: >-
      Only the selectReportCandidate candidate path is driven end to end; the
      single-candidate and iterative-approve paths are covered structurally,
      not by test.
    evidence: |-
      The recording hook sits in createGeneratedReportArtifacts, the sole
      production insert("reports") in convex/generations.ts, and all three
      callers (:1155 auto-select, :2051 iterative approve, :2778
      selectReportCandidate) route through it. Only the third is exercised by
      convex/reportEditDistance.test.ts, and nothing pins the invariant that no
      other path inserts a reason:"generated" snapshot for a report.
    location: >-
      convex/generations.ts:1005
    severity: low
  - summary: >-
      writerUserId is frozen at record time, so a mid-project owner change
      splits one report's series across two writers with no marker.
    evidence: |-
      recordReportEditDistance resolves writerUserId from project.ownerId at
      insert time (correct per PSOS-07). Nothing documents or tests what a
      later ownership transfer does to either writer's trend, and a writer
      reading their own series still sees reportId/projectId for projects since
      reassigned away from them, with no access re-check.
    location: >-
      convex/lib/editDistance.ts
    severity: low
  - summary: >-
      seriesForWriter hardcodes an admin/manager-or-self role check instead of
      going through the repo's roleCapabilities matrix.
    evidence: |-
      convex/projects.ts:27 imports requireCapability from ./lib/roleCapabilities
      and uses it two lines from the new scheduled call (:1028, :1053), and
      shared/capabilities.ts is the recorded permission surface. The new query
      instead reads user.role directly. The behaviour matches the intent's
      matrix, so it was not patched, but the permission is now invisible to the
      capability matrix and the /admin permission UI.
    location: >-
      convex/reportEditDistance.ts:58
    severity: medium
  - summary: >-
      reportEditDistance rows carry no formula version, so the first change to
      computeEditDistance silently mixes two incompatible scales on one trend.
    evidence: |-
      convex/schema.ts:1270 stores only the ped scalar; the intent contract
      enumerates the exact columns, so adding a version column was out of scope
      here. Once rows exist, adding one requires a backfill, and no consumer can
      tell a v1 reading from a v2 reading.
    location: >-
      convex/schema.ts:1270
    severity: medium
  - summary: >-
      reports.postEditDistance still returns PED to a client_review caller
      holding a share token, exposing an internal staff-quality metric.
    evidence: |-
      convex/reports.ts postEditDistance accepts shareToken and returns for
      access.kind === "client_review"; the new seriesForReport is internal-only,
      which makes the asymmetry visible. Pre-existing behaviour untouched by this
      story, and docs/product-domain.md does not record the exposure as reviewed.
    location: >-
      convex/reports.ts:411
    severity: medium
  - summary: >-
      reportEditDistance is append-only with no pruning and no cleanup when a
      report (rather than a project) is deleted.
    evidence: |-
      Distinct from the deleteProject cascade gap above: reportSnapshots has
      pruneSnapshots (convex/lib/snapshots.ts:237) while the new table has no
      retention at all, and seriesForReport returns null once the report is
      gone, so orphaned rows become unreachable but permanent.
    location: >-
      convex/schema.ts:1270
    severity: low
  - summary: >-
      seriesForReport caps by insertion order but presents the series ordered by
      computedAt, so the dropped row need not be the oldest row shown.
    evidence: |-
      by_reportId is _creationTime-ordered, so .order("desc").take(200) keeps the
      newest-inserted rows and the handler then re-sorts by computedAt. Today the
      two agree; a late-draining scheduled publish or any future backfill would
      break that. A [reportId, computedAt] index would make the cap exact.
    location: >-
      convex/reportEditDistance.ts:27
    severity: low
  - summary: >-
      The sinceDays window is anchored with Date.now() inside a reactive query,
      so a long-open dashboard keeps the window it had at subscription time.
    evidence: |-
      convex/reportEditDistance.ts computes `since` at execution time; a Convex
      query only re-runs when its reads change, so the window does not advance
      with wall-clock time. CAP-3 should either pass an explicit `since` or
      refresh deliberately.
    location: >-
      convex/reportEditDistance.ts:80
    severity: low
  - summary: >-
      The candidate-selection hook re-reads the report and re-queries the
      snapshot it just inserted even though the reading is ped 0 by construction.
    evidence: |-
      convex/generations.ts:1005 calls ctx.db.get(reportId) after the insert, and
      recordReportEditDistance then runs a baseline query, a dedupe query and the
      full text diff on every generation, all to produce ped 0 from two copies of
      the same candidate content. Correct but three avoidable round-trips on the
      generation hot path.
    location: >-
      convex/generations.ts:1005
    severity: low
  - summary: >-
      The repeat-trigger dedupe inspects only the single newest row, so
      alternating triggers with no edit record a redundant third reading.
    evidence: |-
      convex/lib/editDistance.ts compares (trigger, revisionNumber, ped) against
      by_reportId .order("desc").first(). publish then milestone then publish with
      no edit in between writes a third row because the newest row's trigger
      differs. This is the literal reading of the intent's repeat-trigger row; a
      per-trigger comparison would suppress it.
    location: >-
      convex/lib/editDistance.ts:120
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

- `convex/reports.ts:404-499` -- the code to move: `wordBag` (`:406`), `bagOverlap` (`:416`), `bagSize` (`:421`), `normalizePara` (`:427`), and the math inside the `postEditDistance` query (`:442`). The query keeps its `getProjectAccess` / `client_review` `sharedReportId` guard (`:448-460`) and its baseline lookup (`:462-467`); only the math after `extractPlainText` moves. `extractPlainText` comes from `./lib/reportEdits:168`.
- `convex/reports.ts:490-499` -- returned shape to preserve verbatim: `{ ped, wordSimilarity, draftWords, currentWords, paragraphsTotal, paragraphsUnchanged, draftLabel, baselineAt }`. The first six come from the extracted function; `draftLabel`/`baselineAt` stay in the query (snapshot fields).
- `convex/generations.ts:953-1004` -- `createGeneratedReportArtifacts`: the single choke point for every `reason: "generated"` baseline that belongs to a report. It early-returns an existing report id at `:967` (no baseline inserted, so no PED row). Its three callers are `:1155` (single-candidate completion), `:2051` (iterative approve), `:2778` (`selectReportCandidate`). Hook the recording once, after the `reportSnapshots` insert at `:987-1003`.
- `convex/generations.ts:1053` and `:2081` -- the two ghost "comparison" snapshots that also carry `reason: "generated"`. They are inserted *after* the real baseline so `.first()` still finds the real one (see the comment at `:2059-2062` and `convex/generationLifecycle.test.ts:912`). Do **not** record PED at these sites, and do **not** switch the baseline lookup to `.order("desc")`.
- `convex/snapshots.ts:205-262` -- `createMilestoneSnapshot`; `report` and `revisionNumber` are in scope. Record after the insert at `:243-256`; order relative to `pruneSnapshots` (`:257`) is irrelevant because `snapshotIdsToDelete` (`convex/lib/snapshots.ts:188`) never deletes `milestone` or `generated` rows.
- `convex/projects.ts:1017-1040` -- `publishForReview`; `report` is in scope after the ownership check at `:1030-1033`. Add `ctx.scheduler.runAfter(0, internal.reportEditDistance.recordAtPublish, { reportId: report._id })` after the `ctx.db.patch` at `:1034-1038`. `internal` is not yet imported here (`:1-25` imports only `_generated/server`, `convex/values`, `_generated/dataModel`, and local libs) — add `import { internal } from "./_generated/api";`.
- `convex/schema.ts:525` -- `reports` (has `revisionNumber`, `generationId`, `projectId`). `convex/schema.ts:1227-1264` -- `reportSnapshots` with `reason: "generated"` and index `by_reportId`. `convex/schema.ts:67-127` -- `projects.ownerId` is the durable accountable writer (PSOS-07); use it for `writerUserId`, never `createdBy`.
- `convex/lib/auth.ts:33` (`getInternalProjectAccessOrNull`), `:26` (`requireCurrentUser`) -- the auth helpers for the two queries. `users.isAnonymous` (`convex/schema.ts:28`) and `users.role` (`:23`) are the fields the elevated/self branch reads.
- `convex/lib/contracts.ts` -- `domainError(code, message)`, used throughout for typed failures.
- `convex/lib/snapshots.ts:237` -- `pruneSnapshots`; confirms baselines are retention-exempt, so a recorded PED row always has a surviving baseline.
- `convex/learning.test.ts:1-27` -- the `convexTest(schema, modules)` + `t.withIdentity({ subject })` fixture shape to copy. `convex/lib/deidentify.test.ts` -- the pure-helper test shape for `convex/lib/editDistance.test.ts`.
- `convex/aiUsage.ts:264` -- `ctx.scheduler.runAfter(0, internal.X.Y, args)` call precedent.
- `convex/_generated/api.d.ts` -- has no `reportEditDistance` entry and `npx convex codegen` needs a `CONVEX_DEPLOYMENT` this worktree does not have. Attempt codegen first; if it refuses, add the two lines (import + map entry) byte-identically to codegen output, in sorted position, and record it as deferred work.
- No existing caller of `postEditDistance` anywhere in `convex/` or `src/` (`docs/system-map.md:359` records it as a dead end), so the extraction has no consumer risk.

## Tasks & Acceptance

**Execution:**
- `convex/lib/editDistance.ts` -- new module. Export `computeEditDistance(draftText: string, currentText: string)` containing the moved `wordBag`/`bagOverlap`/`bagSize`/`normalizePara` helpers and returning `{ ped, wordSimilarity, draftWords, currentWords, paragraphsTotal, paragraphsUnchanged }`. Also export `recordReportEditDistance(ctx: MutationCtx, report: Doc<"reports">, trigger: EditDistanceTrigger): Promise<Id<"reportEditDistance"> | null>` which loads the `generated` baseline (returns `null` if absent), computes PED, applies the repeat-trigger dedupe, resolves `writerUserId` from the project, and inserts — wrapped so any unexpected failure logs and returns `null`. -- one pure math source of truth plus one write path shared by all three triggers.
- `convex/schema.ts` -- add `reportEditDistance` table: `reportId`, `projectId`, `generationId` (optional), `writerUserId` (optional `id("users")`), `revisionNumber`, `ped`, `computedAt`, `trigger` (union of `"candidate_selection" | "milestone" | "client_publish"`); indexes `by_reportId`, `by_projectId`, `by_writerUserId_and_computedAt`. -- persistence + index-only reads for both series.
- `convex/reports.ts` -- delete the four moved helpers; have `postEditDistance` call `computeEditDistance` and spread its result alongside `draftLabel`/`baselineAt`. No other change. -- keeps the read-time query and the persisted rows on one formula.
- `convex/reportEditDistance.ts` -- new module: `seriesForReport` query (arg `reportId`; `getInternalProjectAccessOrNull` on the report's project, `null` when denied or report missing; newest-capped read returned oldest-first), `seriesForWriter` query (args `writerUserId`, optional validated `sinceDays`; allowed for admin/manager or the writer themselves, never anonymous, else `NOT_AUTHORIZED`; newest-capped, oldest-first), and `recordAtPublish` internal mutation (arg `reportId`; no-op if the report is gone, else `recordReportEditDistance(..., "client_publish")`). -- the read surface CAP-3 consumes and the scheduler target for publish.
- `convex/generations.ts` -- in `createGeneratedReportArtifacts`, after the baseline `reportSnapshots` insert, load the new report and call `recordReportEditDistance(ctx, report, "candidate_selection")`. -- one hook covers all three candidate-selection paths.
- `convex/snapshots.ts` -- in `createMilestoneSnapshot`, after the snapshot insert, call `recordReportEditDistance(ctx, report, "milestone")`. -- milestone trigger.
- `convex/projects.ts` -- add the `internal` import and the single `ctx.scheduler.runAfter(0, internal.reportEditDistance.recordAtPublish, { reportId: report._id })` at the end of `publishForReview`. -- publish trigger with the minimum footprint the epic allows in this file.
- `convex/lib/editDistance.test.ts` -- new pure-function tests for `computeEditDistance`: identical text (`ped` 0, all paragraphs unchanged), fully rewritten text (`ped` near 1, 0 unchanged), both-empty (`wordSimilarity` 1), each asymmetric-empty direction, paragraph counting across `\n` and `\n\n` separators, and a failure-path case for `recordReportEditDistance` (stub ctx whose `db.query` throws → resolves `null`, logs once). -- covers the "Empty text" matrix row, locks the formula, and pins the never-throws Always.
- `convex/reportEditDistance.test.ts` -- new convex-test suite covering the remaining matrix rows: a row at candidate selection with `ped: 0`; a row with `ped > 0` after a milestone snapshot on edited content, including a fixture with a ghost `generated` snapshot proving the real baseline is the one used; a publish row via the scheduled mutation; no row when the report has no `generated` baseline; no duplicate row on a repeat publish with no edits; cross-trigger (milestone then publish → two rows); `seriesForReport` returning `null` without internal access and oldest-first rows with it; `seriesForWriter` for an admin, a manager, the writer themselves, an anonymous caller carrying `role: "admin"`, an unrelated writer (`NOT_AUTHORIZED`), an ownerless project, and invalid `sinceDays`; cap-direction cases for both queries asserting the oldest row is the one dropped. -- one test per matrix scenario plus the contracts a reviewer would otherwise find unpinned.

**Acceptance Criteria:**
- Given a project whose report was created by selecting a candidate, when an admin calls `seriesForReport`, then exactly one row is returned with `trigger: "candidate_selection"` and `ped` 0.
- Given a report with a `generated` baseline that has since been edited, when `createMilestoneSnapshot` succeeds, then a `reportEditDistance` row exists with `trigger: "milestone"`, the report's current `revisionNumber`, and `ped > 0`.
- Given a published-for-review report, when the scheduled functions drain, then a row with `trigger: "client_publish"` exists and its `writerUserId` equals the project's `ownerId`.
- Given a report with no `generated` snapshot, when any of the three triggers fires, then no row is written and the triggering mutation still succeeds.
- Given the same report text and baseline, when `reports.postEditDistance` and a persisted row are compared, then their `ped` values are identical and the query still returns exactly its eight documented keys.
- Given `npm run check` and `npm test`, when run after the change, then both pass with no new errors.

## Spec Change Log

## Review Triage Log

### 2026-09-04 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 2, low 2)
- defer: 10: (high 0, medium 2, low 8)
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[medium]` `[patch]` Both series queries hand-mapped a field subset that omitted `generationId`, so the column CAP-2's success criterion names — and the one CAP-3 needs to join `generations.brainProvenance` — was unreadable through the only read surface. Both projections now emit `generationId: row.generationId ?? null`, pinned by an extended assertion in each query's test.
  - `[medium]` `[patch]` The baseline lookup is duplicated in `convex/reports.ts` and `convex/lib/editDistance.ts`, and the ghost-`generated`-snapshot case only read back persisted rows: switching the query's lookup to `.order("desc").first()` left all 28 tests green while the two PED surfaces silently diverged on compare/iterative generations. The ghost case now also asserts `reports.postEditDistance` returns the real baseline's numbers and `draftLabel`; mutation-checked in both directions.
  - `[low]` `[patch]` Dedupe was tested only for over-firing (repeat publish, no edit) and never for under-firing. Added publish → edit → publish asserting two `client_publish` rows with distinct `ped`, so an over-eager dedupe cannot silently flatten the series.
  - `[low]` `[patch]` `seriesForReport`'s `_creationTime` tie-break was unexercised (the ordering test used distinct `computedAt` values). Added a two-row same-`computedAt` case asserting insertion order; mutation-checked.

### 2026-09-04 — Review pass (repair iteration)
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 0, medium 0, low 5)
- defer: 8: (high 0, medium 3, low 5)
- reject: 17: (high 0, medium 0, low 17)
- addressed_findings:
  - `[low]` `[patch]` Deterministic verification failed at `npx tsc -p convex/tsconfig.json`: `convex/reportEditDistance.test.ts` typed its three helpers as `ReturnType<typeof convexTest>`, which drops the schema type parameter, so `ctx.db.query("reportEditDistance").withIndex("by_reportId", ...)` resolved against `SystemIndexes`. Adopted the repo's existing `type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>` convention (`convex/transcriptDigests.test.ts:19`, `convex/generationInput.test.ts:11`). The two `convex/researchReviewMode.test.ts` module-resolution errors in the same failure were environmental: this worktree had no `node_modules`; `npm install` resolved them.
  - `[low]` `[patch]` `computeEditDistance`'s docstring described v1 as "word-multiset similarity (Sørensen–Dice) + unchanged-paragraph ratio" while `ped` is `1 - similarity` only — the paragraph counts are reported but never folded in. Now that the number is persisted as the north-star trend, the comment states the formula exactly and says the paragraph counts are deliberately excluded.
  - `[low]` `[patch]` `seriesForWriter` validated `sinceDays` before `requireCurrentUser`, so an unauthenticated caller could probe argument validation, and the guard (`<= 0`) accepted fractional values the error message rules out. Authentication now runs first and the guard is `Number.isInteger` + 1..3650; pinned by a new "authenticates before it validates sinceDays" test and a `0.5` case added to the invalid-input loop.
  - `[low]` `[patch]` `recordReportEditDistance`'s catch logged `"recordReportEditDistance failed"` with the error alone, so an operator could not tell which report lost a reading — and the function returns `null` for both "no baseline" (expected) and "broken" (not). The log now carries `reportId`, `projectId` and `trigger`.
  - `[low]` `[patch]` Two doc comments overclaimed: `seriesForReport` said it renders "without a error boundary" and did not mention the missing-report `null`; `reports.postEditDistance` claimed the two PED surfaces "can never drift apart" when the `"generated"` baseline lookup is still duplicated (DW-47) and only the ghost-snapshot tests hold them together. Both corrected to what the code actually guarantees.

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

Both series queries are bounded (`.order("desc").take(LIMIT)` then restored to oldest-first) so the cap keeps the *newest* readings; export the limit constants so tests cannot drift from them. `seriesForReport` breaks `computedAt` ties on `_creationTime`, because a milestone and an immediately-drained publish can share a millisecond.

`writerUserId` is `project.ownerId` — the durable accountable owner (PSOS-07), not `createdBy`, which the domain contract forbids repurposing. It stays optional because `ownerId` is still optional on legacy projects; those rows simply never appear in a per-writer series.

## Verification

**Commands:**
- `PUBLIC_CONVEX_URL=http://localhost npm run check` -- expected: no new type or svelte-check errors.
- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts` -- expected: all new tests pass.
- `npm test` -- expected: full backend suite green, with `convex/reports.test.ts`, `convex/snapshots.test.ts`, `convex/generationLifecycle.test.ts`, and `convex/projects.test.ts` unaffected.


## Auto Run Result

Status: done

**Implemented change.** CAP-2: post-edit distance is now persisted at the three milestones. The read-time formula moved out of `reports.postEditDistance` into `convex/lib/editDistance.ts` (`computeEditDistance` plus the `recordReportEditDistance` write path), a `reportEditDistance` table with three indexes was added, and the three triggers hook it: candidate selection at the `createGeneratedReportArtifacts` choke point, milestone inside `createMilestoneSnapshot`, and client publish through a scheduled `internal.reportEditDistance.recordAtPublish`. `seriesForReport` and `seriesForWriter` are the bounded read surfaces CAP-3 will consume.

This run was a repair iteration: the working tree from the previous session failed deterministic verification. See the second triage-log entry for what was repaired.

**Files changed**
- `convex/lib/editDistance.ts` — new: the moved formula plus the shared, never-throwing record path (baseline lookup, repeat-trigger dedupe, `writerUserId` from `project.ownerId`).
- `convex/lib/editDistance.test.ts` — new: pure-function tests plus the never-throws Always against a stub ctx.
- `convex/reportEditDistance.ts` — new: `seriesForReport`, `seriesForWriter`, `recordAtPublish`.
- `convex/reportEditDistance.test.ts` — new: convex-test suite covering every I/O matrix row; this run fixed its `convexTest` typing and added two `sinceDays` cases.
- `convex/schema.ts` — new `reportEditDistance` table and its three indexes.
- `convex/reports.ts` — four helpers deleted; `postEditDistance` delegates to `computeEditDistance` and keeps its eight-key shape.
- `convex/generations.ts`, `convex/snapshots.ts`, `convex/projects.ts` — one recording hook each (publish via scheduler).
- `convex/_generated/api.d.ts` — two hand-added lines registering the new module; codegen cannot run in this worktree (DW-43).

**Review findings breakdown (this pass).** 5 patches applied (all low), 8 items deferred (3 medium, 5 low), 17 rejected. No intent gap and no bad-spec loopback. The first pass on this spec applied 4 patches and deferred 11.

**Follow-up review recommendation:** `true`. Patched this pass: high 0, medium 0, low 5 → score `3×0 + 1×5 = 5`, which meets the threshold of 5.

**Verification performed.** `bash scripts/loop-verify.sh` → rc 0 (`npx tsc -p convex/tsconfig.json --noEmit`, `npm run check`, `npm test` at 126 files / 1286 tests, plus both client-uploader harnesses at 50 and 18 passing). `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts` → 31 tests passing. Matrix audit: every I/O matrix row has a covering test in those two files and all of them ran.

**Residual risks.** `convex/_generated/api.d.ts` was hand-edited and should be regenerated where a Convex deployment is configured (DW-43). The metric is now durable but has no formula-version column, so any future change to `computeEditDistance` mixes scales on one trend. The `client_publish` reading is taken at scheduler drain, so an edit landing in that window is attributed to the publish (DW-46). Unparseable report content persists a bogus `ped` rather than recording nothing (DW-45).
