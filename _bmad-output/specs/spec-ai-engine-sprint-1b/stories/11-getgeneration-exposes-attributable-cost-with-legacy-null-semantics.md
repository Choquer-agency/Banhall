---
title: 'getGeneration exposes attributable cost with legacy null semantics'
type: 'feature'
created: '2026-09-02'
status: 'done'
baseline_revision: 'a8def0280ea8b0276d940c6e211892585a35395f'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
warnings: ['oversized']
deferred:
  - summary: >-
      getGeneration now takes a read dependency on the whole aiUsage
      by_generationId range, so every scheduled logUsage insert invalidates the
      live GenerationProgress subscription and re-pushes the full generation
      document to every viewer.
    evidence: |-
      src/lib/components/generation/GenerationProgress.svelte:19 subscribes to
      api.generations.getGeneration for the duration of a run, and logUsage is
      scheduled per provider call (tens per generation). The in-query sum is
      required by this story's intent ("computed inside the same query", partial
      sum while in flight), so it is not fixable here; a stored running total on
      the generation row, or a separate cost query the progress card does not
      subscribe to, would remove the churn.
    location: >-
      convex/generations.ts:180
    severity: medium
  - summary: >-
      Per-generation dollar cost is now readable by any internal role while the
      aggregate usageReport stays admin-gated, and the widening is recorded only
      in this story file, not in docs/product-domain.md.
    evidence: |-
      getInternalProjectAccessOrNull (convex/lib/auth.ts:33-42) admits writer,
      manager, and admin for any project, whereas convex/aiUsage.ts gates
      usageReport behind usageViewerOrNull. The story forbids adding a gate, so
      the code is correct as specified, but the domain contract should say who
      may see spend at generation granularity.
    location: >-
      docs/product-domain.md
    severity: medium
  - summary: >-
      No function in convex/generations.ts declares a returns validator, so the
      convex-lint hook warns on every edit to the file.
    evidence: |-
      Pre-existing and file-wide, not introduced by this story; adding one to
      getGeneration alone would have been a non-additive change outside scope.
      Worth a focused pass over the file.
    location: >-
      convex/generations.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Story 10 records `promptVersion`, `learningDigestIds`, and generation-attributed `aiUsage` rows, but no read surface exposes them, so provenance and recorded attributable cost for a generation cannot be observed by any authorized caller.

**Approach:** Extend the existing `getGeneration` query to return `promptVersion`, `learningDigestIds`, and `cost`, where `cost` is the sum of `costUsd` on `aiUsage` rows read through `aiUsage.by_generationId`, computed inside the same query, with all three fields `null` for untracked (legacy or not-yet-stamped) generations.

## Boundaries & Constraints

**Always:** Treat presence of a non-empty `promptVersion` string on the generation row as the sole tracked marker (D-4). For a tracked row return `promptVersion` verbatim, `learningDigestIds` as recorded so far (`[]` when the union is empty or the field is absent), and `cost` as the arithmetic sum of `costUsd` over every `aiUsage` row whose `generationId` equals this generation, read through the `by_generationId` index inside this query — including rows from calls whose generation later failed, timed out after usage, or was retried, and rows written while the generation is still in flight. Sum in the unit already stored on `aiUsage`: `costUsd`, US dollars. For an untracked row return `null` for all three fields, never `0`, and do not read the index at all. Keep the existing authorization gate exactly as it is: `getInternalProjectAccessOrNull` already admits every internal role including `admin` for any project, so an authorized reader sees the new fields and an unauthorized one keeps getting `null` for the whole document. Keep the query's existing shape otherwise: same args, same returned keys, additive only. Document on the field that `cost` is recorded attributable cost, not exact total provider spend or invoice completeness.

**Block If:** Reading every `aiUsage` row for one generation in a single query cannot be shown to stay inside Convex query read limits (see Design Notes for the bound analysis that must hold), or `aiUsage.by_generationId` / `costUsd` are absent or carry a different unit than Story 10 recorded.

**Never:** Do not paginate, `take(n)`, cap, or otherwise truncate the usage read — a truncated sum would silently under-report cost. Do not synthesize, backfill, or write any row from this query. Do not add a separate authorization gate, role check, or Admin-only branch. Do not change `getGenerationRecovery`, `getGenerationInput`, `listGenerations`, or any Story 10 writer. Do not add or change UI: `GenerationProgress.svelte` keeps its current markup even though the query it already subscribes to gains fields. Do not edit `convex/_generated/`. Do not migrate or rewrite legacy rows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Tracked with usage rows | Generation has `promptVersion`; three `aiUsage` rows carry its `generationId` with `costUsd` values, one from a failed call and one from a retried call | `cost` equals the exact sum of those three `costUsd` values; `promptVersion` and `learningDigestIds` returned as stored | No error expected |
| Tracked, no usage rows | Generation has `promptVersion`; no `aiUsage` row carries its `generationId` | `cost` is `0` (a number, not `null`); `learningDigestIds` is the stored array or `[]` | No error expected |
| Legacy generation | Row predates the provenance contract: no `promptVersion` | `promptVersion`, `learningDigestIds`, and `cost` are all `null`; no index read occurs | No error expected |
| Reserved, not yet stamped | New-format reservation with `learningDigestIds: []` but `promptVersion` still absent | All three fields `null` — untracked until `beginGeneration` stamps the hash | No error expected |
| In-flight tracked | Generation is `running`; some usage rows written, more calls pending; digest union partially grown | `cost` is the sum of rows written so far; `learningDigestIds` is the union recorded so far | No error expected |
| Other generation's rows | `aiUsage` rows exist for a different generation and rows exist with no `generationId` | Neither contributes to this generation's `cost` | No error expected |
| Admin reads any generation | Caller holds role `admin` and did not create the project | Full document including the three fields | No error expected |
| Unauthorized or missing | Anonymous, role-less, or unmapped caller, or a nonexistent generation id | Query returns `null` for the entire document, as today | Existing null-return behavior preserved |

</intent-contract>

## Code Map

- `convex/generations.ts:156-182` -- `getGeneration`: the only file to change. It loads the row, gates on `getInternalProjectAccessOrNull(ctx, generation.projectId)`, returns `null` on missing/unauthorized, then returns an explicit field projection. Add the three fields to that projection and the index read above it.
- `convex/lib/auth.ts:33-42` -- `getInternalProjectAccessOrNull`: admits any signed-in, non-anonymous user with any `role` (`writer` | `manager` | `admin`, `convex/schema.ts:23-24`). Read-only evidence that acceptance (5) needs no code change: Admin is already covered and no per-project ownership check exists here.
- `convex/schema.ts:465-486` -- `aiUsage` carries optional `generationId`, `candidateRunId`, `durationMs` and required `costUsd: v.number()`; index `by_generationId` on `["generationId"]` exists (Story 10). `convex/schema.ts:618-624` -- `generations.promptVersion` (optional string) and `learningDigestIds` (optional `array(id("learningDigests"))`).
- `convex/aiUsage.ts:214-232,264` -- `logUsage` inserts the row and is scheduled via `ctx.scheduler.runAfter(0, ...)`; `costUsd` is US dollars (Story 10 Code Map). Rows therefore land shortly after the provider call, which is what makes the in-flight sum "so far".
- `convex/generationAttribution.test.ts` -- the Story 10 test file, and the home for this story's tests. Reuse `insertProjectFixture` (line 172, inserts a `writer` user with `authId: AUTH_ID` plus project and transcript), `insertDigest` (line 198), and the `t.withIdentity({ subject: AUTH_ID })` pattern (lines 446, 644). Existing `by_generationId` assertions at lines 681-706 and 931-1010 show the row shape to seed directly with `t.run(ctx => ctx.db.insert("aiUsage", ...))`.
- `src/lib/components/generation/GenerationProgress.svelte:19` -- the only consumer of `api.generations.getGeneration`. Read-only: it destructures named fields, so extra keys are inert. Confirms "no UI" is achievable without touching the frontend.

## Tasks & Acceptance

**Execution:**
- `convex/generations.ts` -- in `getGeneration`, after the authorization gate, branch on `typeof generation.promptVersion === "string" && generation.promptVersion.length > 0`; when tracked, read `ctx.db.query("aiUsage").withIndex("by_generationId", q => q.eq("generationId", generation._id)).collect()` and reduce `costUsd` to a number; add `promptVersion`, `learningDigestIds` (`?? []`), and `cost` to the returned projection; when untracked, return all three as `null` and skip the index read. Add a doc comment on the returned `cost` stating it is the sum of recorded `aiUsage` rows — recorded attributable cost, not exact total provider spend or invoice completeness. -- This is the CAP-9b read surface; the branch is what keeps legacy `null` distinct from tracked `0`.
- `convex/generationAttribution.test.ts` -- add a `getGeneration` describe block covering every I/O matrix row: tracked-with-rows exact sum including a failed-call row and a retried-call row, tracked-with-no-rows `0`, legacy all-`null`, reserved-not-yet-stamped all-`null`, in-flight partial sum with partially grown `learningDigestIds`, isolation from another generation's rows and from rows with no `generationId`, an `admin`-role reader on a project created by someone else, and an unauthorized reader still receiving `null`. -- Deterministic coverage of the matrix using seeded rows, no provider mocking needed.

**Acceptance Criteria:**
- Given a tracked generation and `n` seeded `aiUsage` rows keyed to it, when `getGeneration` runs, then `cost` strictly equals the sum of those rows' `costUsd` and does not change when rows keyed to other generations or rows without a `generationId` are also present.
- Given a caller whose role is `admin` and who did not create the project, when they read any generation, then they receive the same three fields as any other authorized caller; given an anonymous or role-less caller, then the query still returns `null` for the whole document.
- Given the change is complete, when `npm run check` and `npm test` run, then both pass with no new failures, the query still accepts only `generationId`, and no schema file, writer, other query, or frontend file was modified.

## Spec Change Log

- 2026-09-02 plan checkpoint (Claude Fable 5.1, reviewer): approved without amendment. Verified on `main` dfda3fc: `getInternalProjectAccessOrNull` admits any non-anonymous user with a role regardless of project, so Admin-on-any-project needs no code; `aiUsage.by_generationId` and `costUsd` exist from story 10; `getGeneration` is an explicit projection so the three fields are additive. The G-7 bound analysis (low hundreds of rows) justifies `.collect()` over pagination; a truncated read is the wrong failure mode.

## Review Triage Log

### 2026-09-02 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 3: (high 0, medium 2, low 1)
- reject: 15: (high 0, medium 0, low 15)
- addressed_findings:
  - `[low]` `[patch]` `tracked` was a plain boolean, so the returned `promptVersion` inferred as `string | undefined | null` and forced callers to handle an impossible state. Hoisted the field into a local so the check narrows it; the query's return type is now `string | null`.
  - `[low]` `[patch]` `cost` was derived from `usage ? ... : null`, making the tracked-`0` vs legacy-`null` distinction depend on `[]` being truthy. Rebranched `cost` on the `tracked` marker; the un-truncated `.collect()` and the sum are unchanged.
  - `[low]` `[patch]` The `cost` doc comment omitted that `logUsage` falls back to `estimateCostUsd` when the provider reports no cost. Extended it to say individual rows may themselves be estimated from token counts.
  - `[low]` `[patch]` Test gaps: the only unattributed noise row carried no `projectId`, so a regression aggregating by project would still have passed, and the failed/retried requirement was expressed only through `callSite` labels the query never reads. Widened `seedUsage` with an optional `projectId` and seeded a project-keyed `chat` row; added a tracked generation with `status: "failed"` whose recorded rows still sum.

### 2026-09-02 — Review pass (follow-up on done spec)
- intent_gap: 0
- bad_spec: 0
- patch: 1: (high 0, medium 0, low 1)
- defer: 0
- reject: 21: (high 0, medium 0, low 21)
- addressed_findings:
  - `[low]` `[patch]` The reservation-then-stamp test invoked `beginGeneration` without checking its boolean result, so a failed handoff would have surfaced later as a confusing `promptVersion` mismatch. Wrapped the call in `await expect(...).resolves.toBe(true)`.

## Design Notes

**G-7 bound (single-query read is safe).** `aiUsage` rows per generation are bounded by the pipeline's generation-owned provider calls. Per candidate model (`convex/ai/pipeline.ts:266,285-287,314-315,434` and `convex/ai/iterative.ts:98,182,343`): one retrieval brief, one analyzer, three section calls (each up to two provider attempts via the structured repair path in `convex/ai/structured.ts:11-24,83-132` (`attempts: 2` plus one repair retry)), up to two compression passes per overflowing section (`convex/ai/pipeline.ts:141-162,297-301`), one QA, one chronology — roughly 20 rows. `CANDIDATE_MODELS` has five entries (`shared/generationModels.ts:28-88`) and compare mode selects a pair, so a generation lands in the tens of rows; post-QA adds at most a few more (`convex/ai/postQa.ts:116,130`), and iterative per-section regenerations add a few per user action. Even a heavily regenerated generation stays in the low hundreds, far under the Convex query document-read limit, so `.collect()` is correct and truncation is never needed. If a future pipeline change made this unbounded, the fix is a stored running total, not a truncated read — a `take(n)` here would report a wrong number silently.

**Why the tracked check is `promptVersion`, not `learningDigestIds`.** Story 10 initializes `learningDigestIds: []` at reservation but stamps `promptVersion` later, during `beginGeneration` (`convex/generationAttribution.test.ts:442-460`). D-4 defines tracked as `promptVersion` present, so a reserved-but-unstamped row reads as untracked and returns `null`s until it begins. That is deliberate: before the stamp there is no prompt program to attribute cost to.

## Verification

**Commands:**
- `PUBLIC_CONVEX_URL=placeholder npm run check` -- expected: no new type errors.
- `npx vitest run convex/generationAttribution.test.ts` -- expected: all tests pass, including the new `getGeneration` block.
- `npm test` -- expected: green, or only failures already present on the baseline commit.

## Auto Run Result

Status: done
Blocking condition: none

**Implemented change.** Follow-up review pass over the Story 11 change already on `main` (`d57a116`): `getGeneration` returns `promptVersion`, `learningDigestIds`, and `cost` behind the unchanged `getInternalProjectAccessOrNull` gate, with a non-empty `promptVersion` as the sole tracked marker, an un-truncated `aiUsage.by_generationId` read for tracked rows, and `null` for all three fields on untracked rows. This pass changed no production code.

**Files changed (this pass).**
- [../../../../convex/generationAttribution.test.ts](../../../../convex/generationAttribution.test.ts) — the reservation-then-stamp test now asserts `beginGeneration` resolved `true` before reading the stamped view.

**Review findings breakdown.** Four reviewers (blind hunter, edge-case hunter, verification-gap, intent-alignment) produced 22 findings after dedup: 1 patch applied (low), 0 deferred, 21 rejected. Rejections were, in the main: items already held in the deferred ledger as DW-12 (subscription churn), DW-13 (spend visibility by role, domain-contract doc), and DW-14 (no `returns` validators file-wide), which this run was instructed not to re-open; choices the intent mandates (no `take`/cap, no extra gate, field named `cost`, arithmetic float sum in stored USD, `[]` for an absent digest array, non-empty-string tracked marker); speculative additions outside the intent (overflow warning, row counts, estimated-row flags, superseded/candidateRunId tests); and cosmetic test-structure remarks. The verification-gap reviewer found no gaps; the intent auditor found the diff implements the single reading the Never clauses leave open, with divergences only in the surface at which some clauses are phrased (I/O, live subscription, writer provenance) versus the query-return surface the tests exercise.

**Follow-up review recommendation.** `false`. Patched findings this pass: high 0, medium 0, low 1. Score = 3×0 + 1×1 = 1, below the threshold of 5, and no patched finding was high severity.

**Verification performed.**
- `PUBLIC_CONVEX_URL=placeholder npm run check` — 5864 files, 0 errors, 0 warnings.
- `npx vitest run convex/generationAttribution.test.ts` — 21/21 pass.
- `npm test` — 113 files, 1091 tests, all pass.

**Residual risks.**
- `cost` is an IEEE-754 float sum; consumers must format for display (e.g. `0.2 + 0.3`). Rounding at the boundary would depart from the intent's "arithmetic sum in the unit already stored", so it stays unrounded.
- The "no index read for untracked rows" clause is satisfied in code but not observable from the test harness's return-value assertions.
- The live `GenerationProgress` subscription invalidates on every usage insert (DW-12), a direct consequence of the in-query sum the intent requires.
