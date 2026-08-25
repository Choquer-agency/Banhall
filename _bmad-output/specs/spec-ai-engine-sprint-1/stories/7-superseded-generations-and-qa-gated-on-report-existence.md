---
title: 'Superseded generations and QA gated on report existence'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
baseline_revision: '4c309ae95f2c84bda15cddeea2bde50ad218eae0'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The generation status union is hand-copied in four places (schema, generationStatusValidator, recovery.ts, GenerationStatusChip.svelte) with no shared type or exhaustiveness guard.
    evidence: |-
      Pre-existing duplication; generationStatusValidator in convex/lib/contracts.ts has no consumer, and both frontend unions are string literals rather than Doc<"generations">["status"]. The next status addition can drift silently.
    location: >-
      src/lib/generation/recovery.ts:39, src/lib/components/generation/GenerationStatusChip.svelte:7, convex/lib/contracts.ts:73
    severity: low
---

<intent-contract>

## Intent

**Problem:** `retryFailedCandidates` (`convex/generations.ts:523`) marks the original partial generation `completed` even though it never produced a report, so it is indistinguishable in history from a real completion, and `requestReportQa` (`:1514`) accepts any `completed` generation, including such reportless ones (audit finding 13, CAP-7).

**Approach:** Add `superseded` as a new terminal value of `generations.status`; `retryFailedCandidates` writes it instead of `completed`. Every consumer that treats a generation as terminal or filters history handles the new value (superseded rows are excluded from `listGenerations`; stats never read `generations.status`). `requestReportQa` additionally requires a `reports` row linked by `by_generationId` and throws a typed `INVALID_STATE` domain error otherwise. Record the new canonical state in `docs/product-domain.md` as an approved amendment.

## Boundaries & Constraints

**Always:**
- Schema change is additive only: one new literal `superseded` in `convex/schema.ts:599-608` and the mirrored `generationStatusValidator` in `convex/lib/contracts.ts:73-80`; no backfill, no new fields.
- `superseded` is terminal: `updateGenerationStatus` (`generations.ts:2299-2309`) never resurrects it; the ghost late-finish branch (`:812-816`) and the orphaned-run reaper (`:2185-2190`) treat it exactly like `completed`/`failed` for run terminalization; the report-attach branch at `:823` stays `completed`-only.
- `retryFailedCandidates` keeps every other side effect (project reset, linked retry via `reserveGeneration`, candidate/run copying, `progressLog`) and its transactional restore branch (`:552-556`) still restores `awaiting_selection`.
- `requestReportQa` keeps its argument shape, its `requireInternalProjectAccess` gate, the `completed` check, and the `postQaStatus === "running"` idempotency short-circuit; the report check runs after the status check and before the idempotency check. "Report exists" means `ctx.db.query("reports").withIndex("by_generationId", ...)` finds a row (the link every completion path writes via `createGeneratedReportArtifacts`, `:739-790`).
- Typed errors use `domainError` from `convex/lib/contracts.ts` with existing codes only (`INVALID_STATE`, `INVALID_INPUT`); no new code literal.
- Frontend status unions that mirror the schema (`src/lib/generation/recovery.ts:39`, `src/lib/components/generation/GenerationStatusChip.svelte:7`) gain `superseded` with authored copy; no ad-hoc hex, no font weight above 500.
- Public `api.generations.*` names and argument shapes are unchanged.

**Block If:** Implementing the gate requires reading a report by anything other than `reports.by_generationId` (e.g. a project-level fallback) to keep an existing test green; that would widen the intent and needs a human decision.

**Never:**
- Do not change `getLatestGeneration` ordering or `findActiveGeneration` (`convex/lib/activeGeneration.ts`); superseded is not an active status and is never the newest row after a retry.
- Do not touch `modelStats`, `candidateScores`, or `modelSelections`; they do not read `generations.status`.
- Do not delete or rewrite the original generation's candidates, runs, or `retryOfGenerationId` chain; do not add a boolean flag instead of the status value.
- Do not edit `convex/_generated/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial retry | `awaiting_selection` compare generation with one failed run; `retryFailedCandidates` | returns retry id; original `status: "superseded"`, `completedAt` set; retry has `retryOfGenerationId` = original; project pointer moved to retry | No error expected |
| Retry the superseded row again | `retryFailedCandidates` on the superseded original | unchanged | `INVALID_STATE` "Only a partial generation can retry failed drafts" |
| History listing | project with a superseded original and its retry; `listGenerations` | retry present, superseded row absent | No error expected |
| QA on superseded | `requestReportQa` on a superseded generation | no patch, nothing scheduled | `INVALID_STATE` |
| QA on reportless completed | `status: "completed"`, no `reports` row with `generationId` | no patch, nothing scheduled | `INVALID_STATE` "This generation has no report to check" |
| QA on linked completed | `status: "completed"`, `reports` row with `generationId` | `postQaStatus: "running"`, `postQaStartedAt` set, `internal.ai.postQa.runReportQa` scheduled | No error expected |
| Ghost run finishes after supersede | ghost `generationCandidateRuns` row, generation `superseded`; `completeCandidateRun` | run row terminalized (`succeeded`/`failed`), no report snapshot written | No error expected |
| Pipeline status write after supersede | `updateGenerationStatus` targeting a superseded row | no-op | No error expected |

</intent-contract>

## Code Map

- `convex/schema.ts:596-608` -- `generations.status` union; add `v.literal("superseded")` after `failed`.
- `convex/lib/contracts.ts:73-80` -- `generationStatusValidator` mirrors the schema union; add the literal (currently unused elsewhere, keep in sync).
- `convex/generations.ts:472-598` -- `retryFailedCandidates`; the patch at `:523-527` is the primary edit (`status: "superseded"`, keep `currentStep: "Recovery started"`, `completedAt`). Restore branch `:552-556` unchanged.
- `convex/generations.ts:178-202` -- `listGenerations` (history): filter out `status === "superseded"` after the `take(50)`.
- `convex/generations.ts:41-99` -- `getLatestGeneration`: read-only; newest row by `_creationTime`, so a superseded original is never latest after a retry.
- `convex/generations.ts:133-176` -- `getGenerationRecovery`: returns `status` raw to the recovery panel; no filter, but the frontend union must accept the new value.
- `convex/generations.ts:812-830` -- `completeCandidateRun` ghost late-finish guard: extend to `superseded`; leave the inner `=== "completed"` report attach as is.
- `convex/generations.ts:1506-1530` -- `requestReportQa`: add the `reports.by_generationId` existence check after the `completed` check.
- `convex/generations.ts:2185-2190` -- orphaned-run reaper in `failStaleGenerations`: `superseded` counts as terminal.
- `convex/generations.ts:2285-2316` -- `updateGenerationStatus`: add `superseded` to the never-resurrect guard; its `status` arg validator stays without `superseded` (pipeline never writes it).
- `convex/lib/dashboardProjection.ts:200-206` -- `generationActivityFromStatus` already returns `undefined` for unknown statuses; read-only evidence dashboards are unaffected.
- `convex/projects.ts:79-91`, `convex/lib/activeGeneration.ts` -- active-status lists exclude `superseded` by construction; read-only.
- `convex/chatV2.ts:900-908` -- chat grounding fallback queries `completed` only; read-only.
- `convex/generations.ts:2520-2585` -- `modelStats` reads `modelSelections`/`candidateScores`, never `generations`; read-only evidence for "excluded from stats".
- `src/lib/generation/recovery.ts:38-51` -- `safeGenerationActivity` status union; add `superseded` returning "Replaced by a retry."
- `src/lib/components/generation/GenerationStatusChip.svelte:7` -- prop union; add `superseded` with label "AI · Replaced by retry" using the existing neutral tone.
- `src/lib/components/generation/GenerationProgress.svelte:46-50`, `src/lib/components/project/CurrentProjectPage.svelte:854`, `PreviewProjectPage.svelte:1309` -- read-only; they consume `getLatestGeneration`, where superseded never appears.
- `convex/generationRecovery.test.ts:14-79` (`setupPartial`), `:95-120` (asserts `original.status === "completed"` at `:112`, must flip), `:227-247` (`seedProject`), `:478-514` (inserts a `completed` generation with no report and expects QA to run; must insert a linked `reports` row).
- `docs/product-domain.md:34` -- canonical generation states list; `:249+` "Approved amendments" format to append to.
- `docs/ai-engine-audit-2026-08-25.md:93,119` -- source finding; read-only.

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add `v.literal("superseded")` to `generations.status` -- the one status value the epic allows.
- `convex/lib/contracts.ts` -- add the literal to `generationStatusValidator` -- keep the shared validator in sync with the schema.
- `convex/generations.ts` -- `retryFailedCandidates` writes `superseded`; `listGenerations` filters it; `completeCandidateRun` ghost guard, `failStaleGenerations` orphan guard, and `updateGenerationStatus` treat it as terminal; `requestReportQa` throws `domainError("INVALID_STATE", "This generation has no report to check")` when no `reports` row is linked -- closes finding 13 on both surfaces.
- `src/lib/generation/recovery.ts` -- extend the union and add the `superseded` copy branch -- `getGenerationRecovery` now emits it.
- `src/lib/components/generation/GenerationStatusChip.svelte` -- extend the prop union and add a `superseded` label -- typecheck and truthful chip copy.
- `convex/generationRecovery.test.ts` -- flip `:112` to `superseded`; update `:478-514` to insert a linked `reports` row (`projectId`, `generationId`, `content`, `version: 1`, `generatedAt`, `updatedAt`); add cases from the I/O matrix: history exclusion, QA on superseded, QA on reportless completed, QA on linked completed, ghost late-finish terminalization under `superseded`, `updateGenerationStatus` no-op on `superseded` -- CAP-7 success signal.
- `docs/product-domain.md` -- add `superseded` to the canonical states at `:34` and append an "Approved amendments" entry (origin: audit finding 13, SPEC-ai-engine-sprint-1 CAP-7, 2026-08-25) -- AGENTS.md policy requires the amendment record.

**Acceptance Criteria:**
- Given a compare generation in `awaiting_selection` with one failed run, when `api.generations.retryFailedCandidates` returns, then the original row has `status: "superseded"` and `api.generations.listGenerations` for the project lists the retry but not the original.
- Given a generation with `status: "completed"` and no `reports` row whose `generationId` matches, when `api.generations.requestReportQa` is called, then it rejects with a `ConvexError` whose `data.code` is `INVALID_STATE`, `postQaStatus` is unchanged, and no `runReportQa` job is scheduled.
- Given a `completed` generation with a linked report, when `requestReportQa` is called, then `postQaStatus` becomes `running` and `postQaStartedAt` is set (existing behavior preserved, including the stale-pass reaper test).
- Given the full suite, when `npm test` and `npm run check` run, then both pass with the new literal present in every mirrored union.

## Spec Change Log

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 2, low 6)
- defer: 1: (high 0, medium 0, low 1)
- reject: 16
- addressed_findings:
  - `[medium]` `[patch]` `listGenerations` filtered `superseded` after `.take(50)`, so retries shrank the visible history window; moved the exclusion into a query `.filter(q.neq(status, "superseded"))` before the cap.
  - `[medium]` `[patch]` Orphaned-run reaper's `superseded` acceptance had no test; added a `failStaleGenerations` case asserting a stale running run under a superseded generation is failed (`orphanedRuns === 1`) while the live retry's run is untouched.
  - `[low]` `[patch]` `requestReportQa` comment ("any completed generation can re-run QA") contradicted the new gate; reworded to state the linked-report requirement and the legacy-unlinked-report consequence, and recorded the same in the domain amendment's migration note.
  - `[low]` `[patch]` `GenerationStatusChip` `superseded` reused the in-flight dot; switched to a muted `bg-white/40` dot and `text-white/80` so a terminal replaced state does not read as generating.
  - `[low]` `[patch]` `safeGenerationActivity("superseded")` had no test; added one in `src/lib/generation/recovery.test.ts`.
  - `[low]` `[patch]` Ghost late-finish test only asserted no snapshot; now also asserts no report row, no `candidateId` on the run, status still `superseded`, and `candidatesDone` unchanged.
  - `[low]` `[patch]` Schema comment said `superseded` is "hidden from history" without noting by-id reads still return it; clarified in `convex/schema.ts` and the domain amendment.
  - `[low]` `[patch]` Domain amendment omitted the `chatV2` grounding narrowing and the meaning of `completedAt` on a superseded row; both recorded under "What is preserved".

## Auto Run Result

**Summary:** `generations.status` gains a terminal `superseded` value written by `retryFailedCandidates` on the original partial generation. Superseded rows are excluded from `listGenerations` (query-level filter before the 50-row cap), treated as terminal by `updateGenerationStatus`, the ghost late-finish branch of `completeCandidateRun`, and the orphaned-run reaper in `failStaleGenerations`. `requestReportQa` rejects superseded rows (`INVALID_STATE`) and completed rows with no `reports.by_generationId` link (`INVALID_STATE`, "This generation has no report to check"). Frontend status unions and copy extended; domain doc amended.

**Files changed:**
- `convex/schema.ts` -- add `superseded` literal with terminal/hidden-from-list comment.
- `convex/lib/contracts.ts` -- mirror the literal in `generationStatusValidator`.
- `convex/generations.ts` -- `retryFailedCandidates` writes `superseded`; `listGenerations` query-filters it before `take(50)`; terminal guards in `completeCandidateRun`, `failStaleGenerations`, `updateGenerationStatus`; `requestReportQa` superseded check + report-existence gate with updated comment.
- `convex/generationRecovery.test.ts` -- flipped `completed` -> `superseded` assertion; linked report seeded in the stale-QA test; new cases: pointer move + re-retry rejection, history exclusion, ghost late-finish (with no-side-effect assertions), reaper of stranded run under superseded generation, status-write no-op, QA on superseded, QA on reportless completed, QA on linked completed.
- `src/lib/generation/recovery.ts` -- union + "Replaced by a retry." copy.
- `src/lib/generation/recovery.test.ts` -- superseded copy test.
- `src/lib/components/generation/GenerationStatusChip.svelte` -- union + "AI · Replaced by retry" label with muted dot.
- `docs/product-domain.md` -- canonical states row + 2026-08-25 approved amendment.

**Review findings:** 8 patches applied (medium 2, low 6), 1 deferred, 16 rejected. Follow-up review score: 3 × 2 + 1 × 6 = 12 (>= 5) -> `followup_review_recommended: true`.

**Verification:**
- `npm test -- convex/generationRecovery.test.ts src/lib/generation/recovery.test.ts convex/reaperIntegration.test.ts` -- 27 passed.
- `npm test` -- 106 files, 997 tests passed.
- `PUBLIC_CONVEX_URL=http://localhost npm run check` -- 0 errors, 0 warnings.

**Residual risks:**
- Legacy `reports` rows with no `generationId` can no longer retrigger QA from the panel (by design per the Block If clause); documented in the amendment.
- Pre-existing `completed` partial originals are not backfilled to `superseded` (intent: no backfill); they remain in history and are rejected by the QA gate.
- Status union duplication across four sites remains (deferred).

## Design Notes

`superseded` is a status value, not a flag, per the SPEC assumption; it is terminal and never active, so `findActiveGeneration` lists, `generationActivityFromStatus`, and the project pointer logic need no edits. "Excluded from stats" is satisfied by evidence: `modelStats` aggregates `modelSelections` and `candidateScores`, neither of which a superseded original can acquire (selection requires `awaiting_selection` and moves the row to `completed`). The QA gate uses only `reports.by_generationId` because every completion path (`completeCandidateRun` single mode, `approveSectionDraft`, `selectReportCandidate`) writes that link through `createGeneratedReportArtifacts`; a legacy report without `generationId` is out of scope and is the Block If trigger if a test depends on it. The existing test at `:478` seeds a reportless `completed` generation only because nothing gated on it; linking a report there keeps its purpose (stale-pass unblock) intact.

Gate shape:

```ts
if (generation.status !== "completed") {
  domainError("INVALID_INPUT", "The report must be completed before QA can run");
}
const report = await ctx.db
  .query("reports")
  .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
  .first();
if (!report) domainError("INVALID_STATE", "This generation has no report to check");
if (generation.postQaStatus === "running") return null;
```

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- convex/generationRecovery.test.ts` -- expected: all cases pass, including the six new ones.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://localhost npm run check` -- expected: zero errors (catches any status union left without `superseded`).

**Manual checks (if no CLI):**
- `grep -rn '"completed" | "failed"\|literal("failed")' convex src --include='*.ts' --include='*.svelte'` returns no generation-status union that lacks `superseded`.
