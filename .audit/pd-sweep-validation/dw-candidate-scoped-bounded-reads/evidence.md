# dw-candidate-scoped-bounded-reads (DW-121, DW-122): before/after evidence

- Fix commit: `8b00e6a24f09f098703e379eccf319bc8bc3c83b`. Baseline (first parent): `087c76b18a8ad462498653651a3fcb971e31baf4`. Final head: `e22a4b49c54252cc53010d36ea001bd13fc1b179` (ancestor; the test blob is `599e980a` at both the fix and the head, and the three production files are unchanged between them).
- Production changes:
  - `convex/schema.ts`: new index `generationCandidateRuns.by_generationId_and_candidateId`.
  - `convex/complianceNotes.ts` (`selectedCandidateRunId`): the compound-index `.first()` replaces `take(10)`+find, with a guard for a missing `candidateId`.
  - `convex/generations.ts` (`getOrderedSectionDrafts`): an explicit candidate is validated with `db.get`, read through the existing `by_candidateRunId_and_section` index before `take(30)`, and filtered by generation ownership.
- Test: `convex/candidateScopedBoundedReads.test.ts` (new). It uses convex-test with the real schema and the public queries `api.generations.getOrderedSectionDrafts` and `api.complianceNotes.listForGeneration`. The DB layer is not mocked.
- Env, worktree and wrapper are the same as the other bundles. Command: `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<label>.json convex/candidateScopedBoundedReads.test.ts`

## Runs

| Log | Tree | Exit | Result |
|---|---|---|---|
| `before.raw.log` | baseline 087c76b plus the test overlay (status `A`) | 1 | 3 failed / 1 passed / 4 |
| `before-subassert-probe.raw.log` | baseline plus `subassert-probe.test.ts`: test 1 with its 4 target-candidate assertions no-op'd, other tests skipped | 0 | 1 passed, 3 skipped |
| `after-fix.raw.log` | 8b00e6a, clean | 0 | 4 passed / 4 |
| `probe-fix-without-schema-index.raw.log` | 8b00e6a with only the new schema index line removed (`probe-no-index.diff`) | 1 | 2 failed / 2 passed |
| `after-head.raw.log` | e22a4b4, clean | 0 | 4 passed / 4 |

## Discriminating tests: 3 (all behavior-level assertion failures, none compile-level)

1. `finds a requested section candidate after more than 30 older rows and rejects a cross-generation run`. The baseline returns `[]` for the late candidate (`expected [] to deeply equal [['246',0],['242',1]]`, line 183). This is DW-121.
2. `finds a selected candidate after more than 10 older runs`. The baseline returns both candidates' notes (`length 1 but got 2`, line 324). This is DW-122.
3. `keeps the unscoped Compliance Notes fallback for a legacy selection without candidateId`. The baseline returns only `First absent-ID fallback note`, because an undefined `selection.candidateId` matched a run with undefined `candidateId`. This is an **intentional behavior change** documented in the spec Design Notes, not a preservation. The test title ("keeps the … fallback") is misleading, because the baseline did not have that behavior for absent IDs. Note that the original `.audit/DW-121-DW-122/baseline-failure.raw.log` used the older 3-test blob `445ab678` and does not show this test.

Non-discriminating (passes at the baseline): `keeps the unscoped Compliance Notes fallback for an unresolved legacy selection`. That is correct for a preservation guard.

## Sub-assertion discrimination inside test 1

At the baseline, test 1 fails on its first assertion, so its later checks never ran in `before.raw.log`. The probe no-ops the 4 `beforeConsistency`/`afterConsistency` assertions. The remaining checks all **pass at the baseline**: unscoped read length 30 and excluding the target, cross-generation run returns `[]`, deleted/missing parent run returns `[]`, and failed run returns `[]`. These are preservation guards only. The missing-parent and cross-generation checks pass at the baseline trivially, because their rows sit beyond the baseline `take(30)` window. They therefore do not independently prove the new `!candidateRun || candidateRun.generationId !== generation._id` guard or the `row.generationId === generation._id` filter. (No mutation test of those guards was done.)

## Schema index is really exercised

Removing only the new index from `schema.ts` at the fix commit makes 2 tests fail with `Error: Cannot use index "by_generationId_and_candidateId" for table "generationCandidateRuns" because it is not declared in the schema.`:
- `finds a selected candidate after more than 10 older runs`
- `keeps the unscoped Compliance Notes fallback for an unresolved legacy selection`

convex-test therefore enforces the index, and the bounded read goes through it, not through a mock. The absent-candidateId test still passes without the index, because it returns early before the lookup. Test 1 does not use the new index; it uses the pre-existing `by_candidateRunId_and_section`.

## AC to test map

| AC | Test | Discriminating? |
|---|---|---|
| AC1: a later candidate after more than 30 section rows returns only its eligible rows in production order | Test 1 (custom order, consistency withholding before and after, every row matches the target) | Yes |
| AC2: a cross-generation candidate run returns no rows | Test 1 (`other.candidateRunId` returns `[]`) | No (passes at the baseline, see probe) |
| AC3: a selected candidate after more than 10 runs returns only its notes | Test 2 | Yes |
| AC4: unchanged bounded aggregation and fallback with no explicit or resolvable candidate | Test 1 (unscoped length 30), `…unresolved legacy selection` (baseline pass), `…legacy selection without candidateId` (baseline **fail**, an intended change) | Mixed. The absent-ID case is a behavior change, not "unchanged". |

## Gaps and notes

- The spec also lists `convex/ai/promptProgram.test.ts` and `convex/chatDeviationInventory.test.ts` in its focused command. Neither was modified by 8b00e6a, and they were not rerun here (not in scope).
- The spec says a missing explicit parent "could surface orphaned non-final drafts" at the baseline. The fixture does not reproduce that, because it places the orphan beyond 30 rows, so the new missing-parent guard has no discriminating test.
- No duplicate-candidateId (first-match tolerance) test exists.
