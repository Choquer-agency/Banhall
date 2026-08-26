---
title: 'Reaper reads projects by status index'
type: 'bugfix'
created: '2026-08-26'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The orphaned-project sweep in `failStaleGenerations` reads `ctx.db.query("projects").take(500)` with no index, then filters `status === "generating"` in memory. Once the table passes 500 rows, projects stuck in `generating` beyond the cap are never freed and stay locked forever (CAP-11).

**Approach:** Add an additive `by_status_and_updatedAt` index on `projects` and have the sweep read only `status = "generating"` rows with `updatedAt < cutoff` through that index, iterating the query without a `take` cap. Everything downstream of the read (active-generation check, `previousProjectStatus` restore, activity refresh) stays as is.

## Boundaries & Constraints

**Always:**
- Schema change is additive: a new index only. Keep the existing `by_status` index untouched (it is unused, and removing it is out of scope).
- Read the sweep candidates via `.withIndex("by_status_and_updatedAt", (q) => q.eq("status", "generating").lt("updatedAt", cutoff))` and iterate with `for await (const project of query)` per `convex/_generated/ai/guidelines.md` (no `.collect()`, no `.take(n)`). The in-memory `status`/`updatedAt` guards become redundant and are removed.
- The per-project body (`findActiveGeneration` with the four live statuses, `by_projectId` latest generation, patch to `previousProjectStatus ?? "draft"`, `refreshProjectGenerationActivity`, `freed += 1`) and the `{ failed, freed, orphanedRuns }` return shape are unchanged.
- Sibling reapers (`generations` `by_status_and_startedAt`, `generationCandidateRuns`) keep their existing `take(100)` reads; this story touches only the `projects` sweep.
- Follow `convex/_generated/ai/guidelines.md` for every `convex/` edit.

**Block If:**
- Adding the index makes `npm run check` or `convex-test` schema validation fail for a reason not fixable in the reaper (e.g. a conflicting index name already registered).

**Never:**
- Do not change the cron cadence or `olderThanMinutes` default in `convex/crons.ts`.
- Do not touch the stale-generation or stale-run sections of `failStaleGenerations`, or any other `projects` read site (`dashboardBackfill.ts`, `debugTools.ts`).
- Do not add a self-rescheduling batch loop; projects in `generating` are bounded by in-flight work, and the sweep must stay a single mutation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Orphan freed | Project `status: "generating"`, `activeGenerationId` unset, `updatedAt` older than cutoff, no live generation | Patched to `status: "draft"` (or last generation's `previousProjectStatus`), `activeGenerationId` cleared, `freed` incremented | No error expected |
| Beyond old cap | 520 such orphaned projects | All 520 freed in one `failStaleGenerations` call; `freed === 520` | No error expected |
| Fresh generating | `status: "generating"`, `updatedAt` newer than cutoff | Not read, not patched | No error expected |
| Live generation | `status: "generating"`, stale `updatedAt`, a `reserved`/`running`/`awaiting_selection`/`awaiting_input` generation exists | Untouched | No error expected |
| Non-generating | `status: "draft"`, `"review"`, `"client_review"`, `"final"` with stale `updatedAt` | Not read, not patched | No error expected |
| Healthy deployment | No `generating` projects | Index range is empty; `freed === 0` | No error expected |

</intent-contract>

## Code Map

- `convex/schema.ts:67-206` -- `projects` table. Index chain at `:164-202`; `by_status` at `:165` (exists, unused by any `convex/*.ts` caller), `updatedAt: v.number()` at `:162`. Add `.index("by_status_and_updatedAt", ["status", "updatedAt"])` next to `by_status`. Same shape as `:379` and `:407` on other tables.
- `convex/generations.ts:2093-2269` -- `failStaleGenerations` (`internalMutation`, `olderThanMinutes` default 30, `cutoff` at `:2096`). The primary edit is `:2204-2232`: the comment block, `take(500)` at `:2208`, the `status`/`updatedAt` `continue` guards at `:2211-2212`, and the loop body to preserve.
- `convex/generations.ts:2098-2111` -- mirror pattern: `generations` read via `by_status_and_startedAt` with `q.eq("status", ...).lt("startedAt", cutoff)`; reuse the same predicate shape on `projects`.
- `convex/lib/activeGeneration.ts` (`findActiveGeneration`, imported at `generations.ts:33`) -- read-only; live-generation check used by the loop body.
- `convex/crons.ts:5-10` -- cron caller with `{ olderThanMinutes: 30 }`; read-only.
- `convex/generationRecovery.test.ts:1-79` -- `convexTest(schema, modules)` harness, `setupPartial` inserts a `generating` project (`:22-29`); `:394-565` `describe("failStaleGenerations candidate-run terminalization")` is the reaper test group to extend with a new `describe`. Tests invoke `t.mutation(internal.generations.failStaleGenerations, { olderThanMinutes })`.
- `convex/reaperIntegration.test.ts:93-110` -- second reaper harness; read-only reference.
- `convex/_generated/ai/guidelines.md:245-250` -- bounded-read rule and `for await` iteration guidance that governs this change.
- `docs/ai-engine-audit-2026-08-25.md` -- source finding for CAP-11; read-only.

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `.index("by_status_and_updatedAt", ["status", "updatedAt"])` to `projects` after `by_status` -- lets the sweep range on status and staleness without a table scan.
- `convex/generations.ts` -- in `failStaleGenerations`, replace the `take(500)` read and the two in-memory `continue` guards with a `for await` iteration over `ctx.db.query("projects").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "generating").lt("updatedAt", cutoff))`; update the comment to say the read is indexed and uncapped; keep the loop body verbatim -- removes the 500-row ceiling (CAP-11).
- `convex/generationRecovery.test.ts` -- add `describe("failStaleGenerations orphaned-project sweep")` covering the I/O matrix: (a) 520 stale orphaned `generating` projects all freed with `freed === 520`, (b) a fresh `generating` project and a stale `draft` project untouched, (c) a stale `generating` project with a `running` generation untouched -- proves the cap is gone and the filter moved to the index without behaviour drift.

**Acceptance Criteria:**
- Given more than 500 projects sit in `status: "generating"` with no live generation and stale `updatedAt`, when `internal.generations.failStaleGenerations` runs once, then every one of them is returned to `draft` and the result reports `freed` equal to their count.
- Given the reaper runs on a deployment with no `generating` projects, when `failStaleGenerations` runs, then no `projects` row is patched and `freed` is `0`.
- Given the source, when `grep -n 'query("projects").take(500)' convex/generations.ts` runs, then it matches nothing, and the `projects` sweep uses `withIndex("by_status_and_updatedAt", ...)`.
- Given the whole suite, when `npm test` runs, then it is green, including the existing `failStaleGenerations` cases.

## Spec Change Log

## Review Triage Log

## Design Notes

`by_status` already exists on `projects` (schema `:165`) but the reaper never used it; the audit's "add `by_status`" wording predates that index. A compound `by_status_and_updatedAt` index is preferred over reusing `by_status` because it moves the `updatedAt < cutoff` predicate into the index range, so the every-10-minute cron reads zero rows on a healthy deployment, mirroring how the stale-generation read already uses `by_status_and_startedAt`. Only in-flight projects are ever in `generating`, so the uncapped `for await` iteration stays well inside mutation read limits.

Read shape to use:

```ts
const staleProjects = ctx.db
  .query("projects")
  .withIndex("by_status_and_updatedAt", (q) =>
    q.eq("status", "generating").lt("updatedAt", cutoff)
  );
for await (const project of staleProjects) {
  // existing body unchanged
}
```

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- convex/generationRecovery.test.ts` -- expected: all cases pass, including the three new sweep cases.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://localhost npm run check` -- expected: zero errors (the index name must typecheck in `withIndex`).
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && grep -n 'take(500)' convex/generations.ts` -- expected: no output.
