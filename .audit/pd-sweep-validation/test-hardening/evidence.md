# PD sweep test hardening: DW-121/DW-122 and DW-112

- Branch `factory/pd-sweep-test-hardening`, base `2b6e59d`. Only test files changed: `convex/candidateScopedBoundedReads.test.ts` (+235 lines) and `convex/ai/brief.test.ts` (+221 lines). No other source file changed.
- Env: node from `node -v` in each log header. `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud` and `PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site`, the same placeholders `scripts/loop-verify.sh` preflight uses.
- Harness: `run-mutation.sh <gap> <mutation|pass> <test file>` applies one exact-match string mutation from `mutate.py` (each mutation requires exactly one match), saves `git diff` as `mutation-<name>.diff`, and runs `npx vitest run --config vitest.config.ts --reporter=verbose <file>`. It then restores with `git checkout -- <file>` and records `restored source diff empty: yes` at the end of each log. It refuses to start if `git diff -- 'convex/*.ts' ':!*.test.ts'` is not empty.
- Each mutation run covers the whole focused test file, so the logs also show which existing tests catch the same mutation.

## Gap A: DW-121/DW-122 (`convex/candidateScopedBoundedReads.test.ts`)

New describe block: `candidate-scoped bounded reads: guards within scoped reach`. Each fixture keeps 3 section rows reachable through `by_candidateRunId_and_section`, well under `take(30)`, and asserts that reach with `scopedRowCount(...) === 3`. The empty result therefore depends on the named guard, not on the row limit.

| Line | Test | Mutation(s) that make it fail (and nothing else among the new tests) | Failure |
|---|---|---|---|
| 447 | returns no rows for a checked candidate run and its drafts that both belong to another generation | `ownership-both` (drops the parent-run `generationId` check and the row `generationId` filter) | `expected [3 rows] to deeply equal []` |
| 486 | rejects a candidate run owned by another generation even when its section rows name the requested generation | `parent-run-generation-check` (`if (!candidateRun \|\| candidateRun.generationId !== generation._id)` becomes `if (!candidateRun)`); also `ownership-both` | `expected [3 rows] to deeply equal []` |
| 514 | drops section rows owned by another generation even when the requested candidate run belongs to this generation | `row-generation-filter` (removes `row.generationId === generation._id &&`); also `ownership-both` | `expected [3 rows] to deeply equal []` |
| 538 | returns no rows for an explicit candidate whose parent run is missing, although its drafts are within reach | `missing-parent-guard` (a null run no longer returns `[]`) | `expected [2 rows] to deeply equal []` (the last section is withheld as unchecked) |
| 559 | returns no rows for an explicit failed candidate run whose checked drafts are within reach | `failed-run-filter` (`runStatus !== "failed"` is neutralized to always true) | `expected [3 rows] to deeply equal []` |
| 586 | scopes Compliance Notes to the first candidate run when two runs share the selected candidateId | `duplicate-unique` (`.first()` becomes `.unique()`) and `duplicate-last-match` (`.order("desc").first()`) | `unique() query returned more than one result`; `expected [[second run note]] to deeply equal [[first run note]]` |

Result mapping, read from the `×` lines in each log:
- `pass.raw.log`: 10/10 passed, exit 0.
- `mutation-parent-run-generation-check.raw.log`: 1 failed (line 486 only).
- `mutation-row-generation-filter.raw.log`: 1 failed (line 514 only).
- `mutation-ownership-both.raw.log`: 4 failed (lines 447, 486 and 514, plus the pre-existing `finds a requested section candidate after more than 30 older rows…`).
- `mutation-missing-parent-guard.raw.log`: 2 failed (line 538 plus the same pre-existing test).
- `mutation-failed-run-filter.raw.log`: 2 failed (line 559 plus the same pre-existing test).
- `mutation-duplicate-unique.raw.log`: 1 failed (line 586).
- `mutation-duplicate-last-match.raw.log`: 1 failed (line 586).

Correction to the earlier validation gap statement: the "no test fails when the guard is removed" finding came from a baseline-tree probe. At the fixed source, the scoped index already reaches the pre-existing test's rows. That test does fail when both ownership checks are removed together, when the missing-parent guard is removed, or when the failed-run filter is removed. It did not catch either ownership check removed alone, and it had no duplicate-`candidateId` coverage. The new tests close those gaps and give each guard its own isolated test.

Notes:
- Tests 486 and 514 use deliberately inconsistent rows, where the row's `generationId` disagrees with its parent run's. These are defense-in-depth fixtures. The two ownership checks are redundant for consistent data, so a consistent cross-generation fixture (test 447) can only catch removing both. The spec requires generation ownership to be kept on the explicit path (Design Notes). It does not say which of the two checks carries it.
- Duplicate `candidateId`: the spec says `.first()` keeps the "current tolerant first-match behavior" and that `.unique()` would add a failure mode. The baseline was `take(10)` over `by_generationId` followed by `find`, which picks the earliest-created run. The new index breaks ties by creation time, so "first" means earliest-created. That is inferred from the baseline code; the spec does not say "earliest" literally.

## Gap B: DW-112 (`convex/ai/brief.test.ts`, describe `Generation Brief publication idempotency (DW-112)`)

Intended same-key behavior, taken from the spec and not guessed:
- I/O matrix "Existing same-key version": return and stamp the latest same-key version without publishing candidates, with no project-baseline retry.
- Always: the authoritative row is the latest stored version for that key.
- Never: create version 2 for a duplicate derivation, or change writer-edit/version semantics.

A writer edit (`briefs.saveEntryEdit`) keeps `inputsHash`, so it is a same-key version. The pre-DW-112 DW-107 expectation was retry, then a derived version 3 diffed against the edit, or throw after `BRIEF_PUBLISH_ATTEMPTS`. That expectation is intentionally superseded for same-key races. It still holds for changed-input keys, which the existing DW-107 tests cover.

| Line | Test | Mutations that make it fail |
|---|---|---|
| 1285 | adopts a same-key writer edit that lands between baseline pin and publish, without a retry or a new version | `no-same-key-adoption`, `fence-before-adoption`, `oldest-same-key-adopted`, `adoption-without-stamp` |
| 1365 | never exhausts publish attempts when every attempt races a same-key writer edit | `no-same-key-adoption` (throws after 3 attempts), `fence-before-adoption` (throws), `oldest-same-key-adopted`, `adoption-without-stamp` |
| 1427 | adopts a same-key version that appears on the last attempt after different-key versions moved the fence | `no-same-key-adoption` (throws), `fence-before-adoption` (throws), `adoption-without-stamp` |

Mutations, all in `persistDerivedBrief` in `convex/generations.ts`:
- `no-same-key-adoption`: the adoption branch is disabled.
- `fence-before-adoption`: the project fence runs before the same-key lookup.
- `oldest-same-key-adopted`: the persistence lookup is `.order("asc")`. `findReusableBrief` is left untouched.
- `adoption-without-stamp`: adoption returns the id without patching `generations.briefId`.

Results:
- `pass.raw.log`: 42/42 passed, exit 0.
- `mutation-no-same-key-adoption.raw.log`: 6 failed (the 3 new tests plus the 3 pre-existing DW-112 tests).
- `mutation-fence-before-adoption.raw.log`: 4 failed (the 3 new tests plus the pre-existing `adopts the latest same-key Brief before a stale project fence…`).
- `mutation-oldest-same-key-adopted.raw.log`: 3 failed (lines 1285 and 1365 plus the same pre-existing test). Line 1427 has only one same-key row, so it is not expected to catch this mutation.
- `mutation-adoption-without-stamp.raw.log`: 6 failed (the 3 new tests and the 3 pre-existing DW-112 tests).

Every failure is an assertion failure or the publish-exhaustion `Error` the test awaits a result from. None is an import or compile error.

The new tests add coverage the pre-existing DW-112 tests did not have. They are the only tests that drive the adoption-before-fence ordering through `publishDerivedBrief`'s retry loop. The pre-existing test catches `fence-before-adoption` only through a direct `persistDerivedBrief` call. The new tests also pin that a same-key writer edit, not only a derived row, is adopted, and that same-key races neither exhaust retries nor create a version. Tests 1285 and 1365 are caught by the same mutation set. They are kept as the two scenarios the gap names: a single writer edit, and repeated edits, which are the same-key counterpart of the DW-107 retry-exhaustion test.

Ambiguities:
- None on the pinned outcomes; each assertion follows a stated spec row.
- Not tested, because it is outside the stated contract: whether `deriveOrReuseBrief` should report an adopted Brief as `derived` or `reused`. The spec only says outcome kinds are preserved.
- A derivation that adopts a writer edit discards its own model output. The spec states this ("without publishing candidates"), so it is recorded as intended, not as a bug.

## Full verification (unmodified source plus the new tests)

| Log | Command | Result |
|---|---|---|
| `full-unit-suite.raw.log` | `npx vitest run` | 189 files, 2692 tests passed, exit 0 |
| `convex-typecheck.raw.log` | `npx tsc -p convex/tsconfig.json --noEmit` (loop-verify step 2) | exit 0 |
| `test-discovery.raw.log` | `node scripts/check-test-discovery.mjs` | 270 executable test files discovered, exit 0 |

## Bugs

None. Every new test passed against unmodified source, and nothing was placed under `bugs/`.
