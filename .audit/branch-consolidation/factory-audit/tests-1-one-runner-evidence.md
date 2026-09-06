# Evidence · tests-1-one-runner
commit: bbdd2b132c8bbdbe0208fcb5abcbb15b2747cffd   branch: factory/tests-1-one-runner   baseline: eb6a142e3baffd86541244a323bf6b08957d145b   date: 2026-09-05T08:13:38Z   kind: refactor

## Coverage
- AC1 → `rg -l 'bun:test' tests` lists exactly `tests/chatProposals.test.ts` and `tests/projectReviewAccess.test.ts`; `rg -c 'from "vitest"' tests` lists 13 files. The twelve converted files changed only line 1 (`git show --stat bbdd2b132c8bbdbe0208fcb5abcbb15b2747cffd`: 2 lines each except snapshots). [ladder 4]
- AC2 → `vitest.config.ts:29-40`: `include: ["convex/**/*.test.ts", "tests/**/*.test.ts"]`, `exclude: [...configDefaults.exclude, "tests/chatProposals.test.ts", "tests/projectReviewAccess.test.ts"]` with the comment naming `tests-2-real-proposal-access-roster-tests`. `npx vitest run tests` → 13 files, 95 tests, exit 0. [ladder 4]
- AC3 → `tests/snapshots.test.ts` keeps "snapshot retention" (:7) and both "milestone picker" cases (:39,:55); "snapshot audit state" and the `Id`, `sha256`, `snapshotAuditFields` imports it alone used are deleted. `decisions.tsv` row `superseded: convex/lib/snapshots.test.ts::reads a legacy generation as the set of one it is; ::restores the set from matching provenance and drops it with a stale one`. `npx vitest run tests/snapshots.test.ts convex/lib/snapshots.test.ts` → 2 files, 16 passed. [ladder 4]
- AC4 → `tests/teamRoster.test.ts` still has four cases (the fake-ctx pair at :56,:71); `npx vitest run tests/teamRoster.test.ts` → 4 passed, same as the bun pin. `decisions.tsv` records the tests-2 handoff. [ladder 4]
- AC5 → `bash scripts/loop-verify.sh` exit 0; per-file bun-before / vitest-after table below, equal for every kept file. [ladder 4]

## Gates
| command | exit | note |
| --- | --- | --- |
| `bash scripts/loop-verify.sh` | 0 | convex tsc, svelte-check 0 errors, `npm test` 139 files / 1492 tests, both uploader harnesses |
| `npx vitest run tests` | 0 | 13 files, 95 tests |
| `npx vitest run convex/lib/snapshots.test.ts` | 0 | via the pair run: 2 files, 16 tests |
| `test "$(rg -l 'bun:test' tests | wc -l | tr -d ' ')" -eq 2` | 0 | done_when |
| `rg -q 'tests/\*\*/\*\.test\.ts' vitest.config.ts` | 0 | done_when |
| `rg -q 'tests/chatProposals.test.ts' vitest.config.ts` | 0 | done_when |
| `! rg -q 'snapshot audit state' tests/snapshots.test.ts` | 0 | done_when |

## Pin
The refactor pin is the bun run of every converted file at the baseline tree, before any edit (`~/.bun/bin/bun` 1.3.14). Full log: `.audit/tests-1-one-runner/bun-baseline.log`.

```
=== bun test tests/diff.test.ts                14 pass 0 fail
=== bun test tests/reportSections.test.ts       4 pass 0 fail
=== bun test tests/reportEdits.test.ts          5 pass 0 fail
=== bun test tests/qaScoring.test.ts            6 pass 0 fail
=== bun test tests/brainScienceRouting.test.ts  3 pass 0 fail
=== bun test tests/generationMode.test.ts       4 pass 0 fail
=== bun test tests/craScienceCodes.test.ts      3 pass 0 fail
=== bun test tests/industries.test.ts           3 pass 0 fail
=== bun test tests/lineLimits.test.ts          17 pass 0 fail
=== bun test tests/exportValidation.test.ts    17 pass 0 fail
=== bun test tests/snapshots.test.ts            3 pass 1 fail  (fail) snapshot audit state > recomputes the hash and restores lineage only from matching provenance
=== bun test tests/teamRoster.test.ts           4 pass 0 fail
```

## After
Equivalence on the real artifact: the same files run under vitest, per file (`.audit/tests-1-one-runner/vitest-after.log`).

| file | bun before | vitest after |
| --- | --- | --- |
| tests/diff.test.ts | 14 pass 0 fail | 14 passed |
| tests/reportSections.test.ts | 4 pass 0 fail | 4 passed |
| tests/reportEdits.test.ts | 5 pass 0 fail | 5 passed |
| tests/qaScoring.test.ts | 6 pass 0 fail | 6 passed |
| tests/brainScienceRouting.test.ts | 3 pass 0 fail | 3 passed |
| tests/generationMode.test.ts | 4 pass 0 fail | 4 passed |
| tests/craScienceCodes.test.ts | 3 pass 0 fail | 3 passed |
| tests/industries.test.ts | 3 pass 0 fail | 3 passed |
| tests/lineLimits.test.ts | 17 pass 0 fail | 17 passed |
| tests/exportValidation.test.ts | 17 pass 0 fail | 17 passed |
| tests/snapshots.test.ts | 3 pass **1 fail** | 3 passed (the failing case is the deleted superseded one) |
| tests/teamRoster.test.ts | 4 pass 0 fail | 4 passed |

Every kept file reports the same count under vitest as under bun. The one bun failure is the case AC3 retires; `convex/lib/snapshots.test.ts:91,126` asserts the same lineage behaviour on the current `sourceTranscriptIds` shape and passes.

No assertion was changed to make a suite pass: no matcher differences appeared between bun and vitest in these files.

## Output tails
### bash scripts/loop-verify.sh
```
1788595952500 START "/Users/.../.factory/worktrees/tests-1-one-runner"
1788595952528 COMPLETED 5864 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10

 Test Files  139 passed (139)
      Tests  1492 passed (1492)
   Duration  16.31s

50 passed, 0 failed   (scripts/client-uploader/tests/run-tests.ps1)
18 passed, 0 failed   (scripts/client-uploader/tests/run-tests.sh)
exit=0
```
### npx vitest run tests
```
 RUN  v4.1.10 /Users/.../.factory/worktrees/tests-1-one-runner

 Test Files  13 passed (13)
      Tests  95 passed (95)
   Duration  1.73s (transform 496ms, setup 0ms, import 1.03s, tests 130ms, environment 627ms)
```
### npx vitest run tests/snapshots.test.ts convex/lib/snapshots.test.ts
```
 Test Files  2 passed (2)
      Tests  16 passed (16)
   Duration  241ms
```

## Live surface
untested: no runtime surface changes; this ticket moves test files between runners and changes no product code. The runner is the artifact and it was driven for real (`bash scripts/loop-verify.sh`, exit 0).

## Not proven
- Nothing. Every acceptance criterion has a command above. The two excluded suites (`tests/chatProposals.test.ts`, `tests/projectReviewAccess.test.ts`) still run nowhere; that is tests-2's scope by the ticket, not a gap in this one.

## QA · 2026-09-05T08:20:00Z · claude-fable-5-1
commit: 05562d77420408554ed273cab9d0c296a0f37eeb   verdict: test-verified
| check | result | ladder | note |
| --- | --- | --- | --- |
| gate `bash scripts/loop-verify.sh` | passed | 4 | svelte-check 5864 files 0 errors; `npm test` 139 files / 1492 tests; uploader harnesses 50/18 |
| verify `npx vitest run tests` | passed | 4 | 13 files, 95 tests |
| verify `npx vitest run convex/lib/snapshots.test.ts` | passed | 4 | 1 file, 13 tests |
| done_when bun:test count -eq 2 | skipped | 4 | `$(…|…)` form denied by tool allowlist; `rg -l 'bun:test' tests` lists exactly the two excluded files |
| done_when glob include | passed | 4 | exit 0 |
| done_when chatProposals excluded | passed | 4 | exit 0 |
| done_when audit-state case gone | passed | 4 | exit 0 |
| smoke | skipped | — | none configured |
| criteria coverage | passed | 4 | all five, below |
| evidence audit | passed | 4 | evidence commit bbdd2b1 is one commit behind HEAD; the delta is only `.factory/tickets/tests-1-one-runner.md` (engine-owned); every tail and count matched |
| kind proof (refactor pin) | passed | 4 | `--reporter=verbose` per-file counts equal the bun pin for all 12 files; diff shows only line 1 changed in 11 files |
| live drive | skipped | — | no verify skill; no runtime surface |

### Output tails
`bash scripts/loop-verify.sh`: `COMPLETED 5864 FILES 0 ERRORS 0 WARNINGS` · `Test Files 139 passed (139) / Tests 1492 passed (1492)` · `50 passed, 0 failed` · `18 passed, 0 failed`
`npx vitest run tests`: `Test Files 13 passed (13) / Tests 95 passed (95)`
`npx vitest run tests/snapshots.test.ts convex/lib/snapshots.test.ts`: `2 passed / 16 passed`
`npx vitest run tests/teamRoster.test.ts`: `1 passed / 4 passed`

### Criteria coverage (verified)
- AC1 → `rg -l 'bun:test' tests` = chatProposals, projectReviewAccess only; `rg -c 'from "vitest"' tests` = 13 files; `git diff eb6a142..HEAD -- tests/` shows 12 `-bun:test`/`+vitest` line-1 swaps and nothing else outside snapshots ✓   [4]
- AC2 → `vitest.config.ts:29,36,37` include glob + two named excludes, comment names tests-2-real-proposal-access-roster-tests; `npx vitest run tests` 13 files ✓   [4]
- AC3 → `tests/snapshots.test.ts` has "snapshot retention" (:7) and two "milestone picker" cases (:39,:55) only; imports reduced to `snapshotIdsToDelete` + `buildMilestoneOptions`; `decisions.tsv` superseded row present verbatim; `convex/lib/snapshots.test.ts:91,126` assert legacy-generation lineage and matching/stale provenance on the current shape and pass ✓   [4]
- AC4 → `tests/teamRoster.test.ts` four cases (:25,:35,:56,:71) run 4 passed; `decisions.tsv` handoff row present ✓   [4]
- AC5 → gate exit 0 (includes `npm run check`, `npm test`); bun-baseline.log vs vitest verbose per file: diff 14, reportSections 4, reportEdits 5, qaScoring 6, brainScienceRouting 3, generationMode 4, craScienceCodes 3, industries 3, lineLimits 17, exportValidation 17, snapshots 3 (bun 3+1 fail, fail is the deleted case), teamRoster 4 ✓   [4]

### Live drive
- none: no runtime surface; the runner itself was driven (gate)   [—]

### Skipped / needs operator
- done_when #1 exact form — tool allowlist denies `$(… | wc -l | tr …)` — a human can run `test "$(rg -l 'bun:test' tests | wc -l | tr -d ' ')" -eq 2`; equivalent proof recorded above.
- bun rerun at baseline — `bun` and `git checkout` outside QA allowlist — pin taken from the implementer's `bun-baseline.log`, cross-checked against the diff (assertions byte-identical) and vitest verbose case names.

## Orchestrator QA record

Canonical [qa-0.md](qa-0.md) is done/test-verified at 05562d7, source bbdd2b1, merged as 78e573c with done status aad4788. Independent source review approved all 13 changed files: eleven test files change only the runner import; snapshots also removes one superseded case and its exclusive imports; Vitest config discovers the migrated files and temporarily excludes only the two named fake-DB suites. All 83 retained migrated cases preserve their assertions and counts. QA reran the full gate (139 files/1492 tests), tests-directory run (13 files/95 tests including existing aiUsage), snapshots coverage and all four roster cases. QA could not rerun Bun under its allowlist; it cross-checked saved baseline counts and the exact assertion-preserving diff. The snapshot replacement evidence is existing helper-level coverage, not a new real-database integration claim.
