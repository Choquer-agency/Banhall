# dw-brief-derivation-concurrency (DW-112): before/after evidence

## Commits
- Fix: `f5f27ae`. Baseline (parent): `d73df4b`. Head: `e22a4b4`.
- Test file: `convex/ai/brief.test.ts`. Its sha at the fix is `71f8aafa…`; at head it is `0baa06d4…` (later bundles changed it).

## Environment
The environment is the same as for bundle 1: node v22.22.3, vitest 4.1.10, the placeholder Convex URLs, and `../run-phase.sh`. The command was `npx vitest run --config vitest.config.ts --reporter=verbose --reporter=json --outputFile.json=<phase>.json convex/ai/brief.test.ts`.

## Results
| Phase | Tree | Result | Log |
|---|---|---|---|
| before | d73df4b + f5f27ae test | 3 failed / 36 passed (39), EXIT 1 | before.raw.log |
| after-fix | f5f27ae | 39 passed, EXIT 0 | after-fix.raw.log |
| after-head | e22a4b4 | 39 passed, EXIT 0 | after-head.raw.log |
| repeat | `-t "DW-112"` 3x before, 3x after-fix | before 3 failed each run, after 3 passed each run | repeat-dw112.raw.log |
| fixture check | f5f27ae source + d73df4b (pre-fix) test file | 10 failed / 26 passed (36), EXIT 1 | fix-source-with-pre-fix-tests.raw.log |

Comparison: `comparison.txt`.

## The 3 discriminating tests
All 3 are behavior-level. They are deterministic across 3 repeats and use only APIs that exist at baseline.
1. `publishes one first version when two same-key derivations reach persistence together`. At baseline the second publisher returns a different Brief id (`expected '…10010generationBriefs' to be '…10008generationBriefs'`), so two version-1 Briefs exist.
2. `adopts the first publication when it becomes the current baseline before the second baseline read`. At baseline the persistence call does not match `{ baselineBriefId: first, result: first }`.
3. `adopts the latest same-key Brief before a stale project fence or candidate processing`. At baseline it returns `null` instead of the latest same-key id.

The committed `.audit/DW-112/failing-control.log` shows 38 tests with 2 failed. Test 2 was added after that control, and my run confirms it is also red at baseline.

## Non-discriminating: 36 tests
They pass both before and after. The list is in `comparison.txt`.

## Acceptance criteria → tests
| AC | Test(s) | Before-proof |
|---|---|---|
| AC1: racing first publications → exactly one v1 Brief, both generations reference it | test 1 (also test 2 for the sequential-adoption variant) | Behavior |
| AC2: same-key Brief exists at persistence start → return and stamp latest same-key, no inserts | test 3 (also test 2 replay) | Behavior |
| AC3: only a different-key Brief invalidates the pinned baseline → `null`, writes nothing, retry preserved | `diffs against every live row of an over-bound baseline, and a stale fence writes nothing` (baseline `inputsHash: "previous-hash"`, `baselineBriefId: null` → `toBeNull()` and unchanged tables); `re-reads and re-publishes when a writer edit lands…`; `gives up after BRIEF_PUBLISH_ATTEMPTS…` | Non-discriminating (pass before and after), as expected for a "preserve" AC |
| Verification: loop-verify, typecheck, ledger hash | not run (scope) | GAP (scope) |

## Findings
- **The fix changed pre-existing DW-107 test fixtures (6 deleted lines in brief.test.ts).** `derivationFixture.derive` now uses `inputsHash: "<hash>:derivation-N"` per call, and the at-bound re-derive hash was renamed from `at-bound-hash` to `at-bound-next-hash`. Run against the new source, the old fixture fails 10 DW-107/DW-118 tests: the removed-marker and returning-key tests, the question carry-forward test, the exact-bound baseline test, the writer-edit re-publish test, retry exhaustion, the interrupted page read, the retained-row fallback marker, the invalid-reference abort, and the duplicate-candidate stamping test.
  - This is consistent with the intended semantic change: a same-key publish now adopts the stored Brief instead of creating version N+1. In production a same-key re-derivation is normally short-circuited by `findReusableBrief`.
  - The cost is that those DW-107 tests now prove diff/fence/retry behavior only for changed-input keys. Same-key retry-exhaustion and writer-edit races are no longer covered by those tests; test 2 covers only same-key adoption.
  - A reviewer should confirm that no reachable flow re-derives against a same-key baseline whose newest version is a writer edit and expects a new version.
- No flakiness in the DW-112 tests (3/3 consistent in each direction).
