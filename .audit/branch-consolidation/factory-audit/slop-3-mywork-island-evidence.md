# Evidence · slop-3-mywork-island
commit: 28c0c0c   branch: factory/slop-3-mywork-island   baseline: ac69311b4521e6903b7461f46c61e7f61ab485a9   date: 2026-09-05   kind: refactor

## Coverage
- AC1 → `git diff --stat ac69311..HEAD`: exactly eight files, 506 deletions, 0 insertions. No import line needed removing because `npm run check` named none. ✓ [ladder 4]
- AC2 → `rg 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' src` exits 1 (no match). `MyWorkLaneSort.component.test.ts`, `MyWorkHome.component.test.ts`, `CurrentWorkLedgerFixture.component.test.ts`, `HomeParity.component.test.ts`, `CurrentMyWorkView.svelte` and `MyWorkView.svelte` are absent from the diff stat, so they are untouched. ✓ [ladder 4]
- AC3 → `bash scripts/loop-verify.sh` exit 0 (covers `npx tsc -p convex/tsconfig.json --noEmit`, `npm run check`, `npm test`, both uploader harnesses); `npm run build` exit 0; component verify drops from 6 files/22 cases to 5 files/19 cases with no new failure; `npx vitest run src/lib/mywork` passes the two remaining unit files. ✓ [ladder 4]

## Gates
| command | exit | note |
| `bash scripts/loop-verify.sh` | 0 | check 0 errors 0 warnings over 5864 files; `npm test` 127 files / 1409 tests |
| `npx vitest run --config vitest.component.config.ts src/lib/components/mywork src/lib/components/workspace/HomeParity.component.test.ts` | 0 | 5 files / 19 tests, was 6 / 22 |
| `npx vitest run src/lib/mywork` | 0 | 2 files / 5 tests, was 4 / 18 |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run build` | 0 | adapter-vercel done in 41.08s |

## Pin
The refactor pin is the two verify suites run on the baseline tree before any file was deleted. A typecheck is not a pin, so the pin is the suite counts on the real artifact.

### `npx vitest run --config vitest.component.config.ts src/lib/components/mywork src/lib/components/workspace/HomeParity.component.test.ts` (baseline, `.audit/slop-3-mywork-island/pin-component.log`)
```
 Test Files  6 passed (6)
      Tests  22 passed (22)
   Start at  00:55:26
   Duration  32.54s (transform 0ms, setup 1.01s, import 14.32s, tests 369ms, environment 0ms)
```

### `npx vitest run src/lib/mywork` (baseline, `.audit/slop-3-mywork-island/pin-unit.log`)
```
 Test Files  4 passed (4)
      Tests  18 passed (18)
   Start at  00:56:04
   Duration  346ms (transform 73ms, setup 0ms, import 136ms, tests 15ms, environment 0ms)
```

## After
The pin holds with exactly the predicted drop: the component run loses one file and three cases (`MyWorkRow.component.test.ts` held 3), the unit run loses two files and thirteen cases (`laneSort.test.ts` 10, `myWorkPreferences.test.ts` 3). Every surviving case still passes, so no live behavior moved.

### `npx vitest run --config vitest.component.config.ts src/lib/components/mywork src/lib/components/workspace/HomeParity.component.test.ts` (`.audit/slop-3-mywork-island/after-component.log`)
```
 Test Files  5 passed (5)
      Tests  19 passed (19)
   Start at  00:58:07
   Duration  18.41s (transform 0ms, setup 1.61s, import 13.49s, tests 307ms, environment 0ms)
```

### `npx vitest run src/lib/mywork` (`.audit/slop-3-mywork-island/after-unit.log`)
```
 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at  00:58:34
   Duration  177ms (transform 56ms, setup 0ms, import 75ms, tests 5ms, environment 0ms)
```

## Output tails

### `bash scripts/loop-verify.sh` (exit 0, `.audit/slop-3-mywork-island/gate-loop-verify.log`)
```
> banhall-app@0.1.0 check
> svelte-kit sync && svelte-check --tsconfig ./tsconfig.json

1788595041324 START "/Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/slop-3-mywork-island"
1788595041492 COMPLETED 5864 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

> banhall-app@0.1.0 test
> vitest run

 RUN  v4.1.10 /Users/johnnynguyen/Documents/Repos/Banhall/.factory/worktrees/slop-3-mywork-island

 Test Files  127 passed (127)
      Tests  1409 passed (1409)
   Start at  00:57:22
   Duration  21.90s (transform 5.71s, setup 0ms, import 10.54s, tests 11.34s, environment 3.93s)
...
50 passed, 0 failed      (scripts/client-uploader/tests/run-tests.ps1)
18 passed, 0 failed      (scripts/client-uploader/tests/run-tests.sh)
```

### `PUBLIC_CONVEX_URL=... PUBLIC_CONVEX_SITE_URL=... npm run build` (exit 0, `.audit/slop-3-mywork-island/after-build.log`)
```
.svelte-kit/output/server/chunks/Streamdown.js                       131.06 kB │ gzip:  27.16 kB
.svelte-kit/output/server/chunks/WorkspaceDashboard.js               148.02 kB │ gzip:  29.54 kB
.svelte-kit/output/server/chunks/internal.js                         160.35 kB │ gzip:  41.89 kB
.svelte-kit/output/server/chunks/WorkspaceShellControls.js           169.98 kB │ gzip:  35.77 kB
.svelte-kit/output/server/chunks/lib.js                              197.26 kB │ gzip:  29.71 kB
.svelte-kit/output/server/entries/pages/project/_id_/_page.svelte.js 548.99 kB │ gzip: 110.61 kB

[PLUGIN_TIMINGS] Your build spent significant time in plugins. Here is a breakdown:
  - vite-plugin-sveltekit-guard (70%)
  - vite-plugin-sveltekit-virtual-modules (10%)
  - vite-plugin-svelte:load-custom (10%)
  - vite-plugin-svelte:compile (8%)
See https://rolldown.rs/reference/InputOptions.checks#plugintimings for more details.

✓ built in 41.08s

Run npm run preview to preview your production build locally.

> Using @sveltejs/adapter-vercel
  ✔ done
```

### `git diff --stat ac69311..HEAD`
```
 src/lib/components/mywork/MyWorkGroup.svelte       | 83 -------------------
 .../components/mywork/MyWorkRow.component.test.ts  | 67 ---------------
 src/lib/components/mywork/MyWorkRow.svelte         | 95 ----------------------
 src/lib/components/mywork/MyWorkRowFixture.svelte  | 26 ------
 src/lib/mywork/laneSort.test.ts                    | 86 --------------------
 src/lib/mywork/laneSort.ts                         | 69 ----------------
 src/lib/mywork/myWorkPreferences.test.ts           | 48 -----------
 src/lib/mywork/myWorkPreferences.ts                | 32 --------
 8 files changed, 506 deletions(-)
```

### done_when predicates, run in this session after the commit
```
$ for f in <the eight paths>; do test -e "$f" && echo "STILL EXISTS: $f"; done
(no output)
$ rg -q 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' src; echo $?
1
$ npx vitest run src/lib/mywork
exit 0
```

## Blast radius
`rg` over the repo (excluding `node_modules`, `.factory`, `.audit`) found every match of the six symbols inside the eight deleted files themselves. One match survives outside `src`: `docs/design-system.md:403` names MyWorkGroup as an adopter of the shared Disclosure motion. That is prose, not an import, and AC1 licenses editing another file only when `npm run check` names an import of a deleted file; check reports zero errors. It is recorded as deferred.

Deleting `MyWorkRow.svelte` orphans nothing downstream: its two non-type imports, `StageBadge.svelte` and `formatDue`, keep fifteen-plus other consumers (`rg -l 'formatDue|StageBadge' src`).

## Live surface
untested: no user-visible surface changes; the deleted files have no runtime consumer, which is the premise of the ticket and is what the `rg` predicate and the passing Home component suites establish. The nearest live check a human can run:
`PUBLIC_CONVEX_URL=<real> npm run dev` then open `/` and `/?workspace=current` and confirm Home still renders HomeStartProject, WithYouBand and RecentProjectsRail, and the current-work ledger still renders.

## Not proven
- Nothing outside this repository imports the deleted modules — not provable from here; a human should run `rg 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' .` across any long-lived branch before merging it, which is the edge case the ticket already anticipates.

## QA · 2026-09-05T08:08:33Z · claude-fable-5-1 (factory-qa)
commit: 23bcb286daea2561082b0783297f58ce7f2ffa8e   verdict: test-verified

| check | result | ladder | note |
| gates: `bash scripts/loop-verify.sh` | passed | 4 | exit 0; check 5864 files 0 errors 0 warnings; `npm test` 127 files / 1409 tests; uploader harnesses 50/0 and 18/0 |
| ticket verify: component suite | passed | 4 | exit 0; 5 files / 19 tests at HEAD |
| ticket verify: `npx vitest run src/lib/mywork` | passed | 4 | exit 0; 2 files / 5 tests at HEAD |
| ticket verify: `npm run build` (placeholder env) | passed | 4 | exit 0; `✓ built in 26.06s`, adapter-vercel `✔ done` |
| done_when: eight absence tests | passed | 4 | Glob of both dirs lists none of the eight paths |
| done_when: rg guard over `src` | passed | 4 | `rg -q` and plain `rg` both produce no match |
| smoke | skipped | 1 | none configured (`smoke=''`) |
| criteria coverage AC1–AC3 | passed | 4 | see below |
| evidence audit | passed | 4 | every tail matches; sha note below |
| kind proof: refactor pin rerun | passed | 4 | baseline 6/22 + 4/18 → HEAD 5/19 + 2/5; drop equals the 3+10+3 deleted cases exactly |
| live drive | skipped | 1 | `verify_skill=none`; ticket `ui: false`, no user-visible surface |

### Output tails
`bash scripts/loop-verify.sh` (exit 0):
```
1788595608267 COMPLETED 5864 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
 Test Files  127 passed (127)
      Tests  1409 passed (1409)
50 passed, 0 failed
18 passed, 0 failed
[exited with code 0]
```
Component suite at HEAD (exit 0):
```
 Test Files  5 passed (5)
      Tests  19 passed (19)
   Start at  01:07:18
```
Unit suite at HEAD (exit 0):
```
 Test Files  2 passed (2)
      Tests  5 passed (5)
   Start at  01:06:19
```
Build (exit 0):
```
✓ built in 26.06s
> Using @sveltejs/adapter-vercel
  ✔ done
```
Pin at baseline ac69311 (detached checkout, then restored to branch; tree clean, HEAD 23bcb28 after):
```
 Test Files  4 passed (4)      Tests  18 passed (18)    Start at  01:08:14
 Test Files  6 passed (6)      Tests  22 passed (22)    Start at  01:08:15
```

### Criteria coverage (verified)
- AC1 → `git diff --stat ac69311..HEAD -- src`: exactly the eight named paths, 506 deletions, 0 insertions; no import-line edits anywhere in `src` ✓   [4]
- AC2 → `rg 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' src` returns nothing; the six protected files are present and absent from the diff stat ✓   [4]
- AC3 → gate, component suite, unit suite and build all exit 0; component run is one file / three cases fewer than the baseline pin I reran myself, unit run two files / thirteen fewer; surviving Home suites (`MyWorkHome`, `MyWorkLaneSort`, `HomeParity`, `HomeStartProject`, `CurrentWorkLedgerFixture`) still assert Home renders without lane rows ✓   [4]

### Live drive
- none: `verify_skill=none` and the diff has no user-visible surface. Principle 19 (confidence ladder): nothing reproduced in the running app, so the verdict stays at test-verified and is not rounded up.

### Evidence audit notes
- Evidence header pins commit 28c0c0c; HEAD is 23bcb28. The delta is one `deferred:` line in the engine-owned ticket file, which is outside the boundary audit. The `src` diff is identical at both SHAs and every gate above ran on 23bcb28, so the claim is accepted with this note rather than failed. Principle 22 (a new head SHA voids the old verdict): satisfied by this rerun, not by the implementer's header.
- review-0 consider (docs/product-domain.md:797 "My Work sorting" now implementation-less) is still not in the ticket `deferred:` list. Not an acceptance criterion; recorded here so the doc-sync ticket inherits it. Principle 25 (name what the next maintainer inherits).

### Skipped / needs operator
- smoke — none configured — n/a
- live drive — no verify skill, `ui: false` — nearest human check: `PUBLIC_CONVEX_URL=<real> npm run dev`, open `/` and `/?workspace=current`, confirm Home and the current-work ledger render.

## Orchestrator QA record

Canonical [qa-0.md](qa-0.md) is done/test-verified at 23bcb28, source 28c0c0c, merged as 4b6159f with done status eb6a142. QA independently checked out baseline ac69311 and reran both before and after pins: component 6 files/22 cases to 5/19; unit 4/18 to 2/5. It restored the branch and clean tree, passed the full 127-file/1409-test gate, production build and all predicates. Independent audit_slop review also approved the exact eight-file/506-line deletion with protected views and tests byte-identical. The stale design-system adopter citation is assigned to pending dx-1. The reviewer’s product-domain sorting observation is being checked against later superseding amendments before classification; do not treat it as an approved behavior change. Full authenticated app navigation was not exercised.

### Product-domain review disposition

The slop-3 reviewer’s low/consider claim about docs/product-domain.md:797 is dismissed after context review. The clause says the preview may reorder only loaded rows, a permission/constraint rather than an obligation to keep a sort control. Lines 736–741 supersede the five-lane layout; lines 727 and 634–638 record approved removal of those Home regions/subscriptions; the approved August 14 amendment at 330–340 makes With you the only operational Home subscription. Retained MyWorkLaneSort.component.test.ts:25–45 explicitly requires the assigned-only subscription and no sort control; CurrentMyWorkView retains its frozen accountability tabs. Independent audit_slop review reached the same conclusion. No new product-domain amendment, implementation, or deferred obligation is warranted by this deletion.
