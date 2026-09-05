---
key: slop-3-mywork-island
status: todo
kind: refactor
deps: []
touches: [src]
risky: []
verify: [npx vitest run --config vitest.component.config.ts src/lib/components/mywork src/lib/components/workspace/HomeParity.component.test.ts, npx vitest run src/lib/mywork]
done_when: [! test -e src/lib/components/mywork/MyWorkGroup.svelte, ! test -e src/lib/components/mywork/MyWorkRow.svelte, ! test -e src/lib/components/mywork/MyWorkRowFixture.svelte, ! test -e src/lib/components/mywork/MyWorkRow.component.test.ts, ! test -e src/lib/mywork/laneSort.ts, ! test -e src/lib/mywork/laneSort.test.ts, ! test -e src/lib/mywork/myWorkPreferences.ts, ! test -e src/lib/mywork/myWorkPreferences.test.ts, "! rg -q 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' src", npx vitest run src/lib/mywork]
title: "Delete the retired My Work lane presentation: eight files kept alive only by their own tests"
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T05:52:56.203Z"
---
## Intent
For the reader of `src/lib/mywork` and `src/lib/components/mywork`: the lane sort, lane preferences and row/group components that the current Home replaced (`MyWorkView.svelte:4-8` renders `HomeStartProject`, `WithYouBand`, `RecentProjectsRail`; `CurrentMyWorkView.svelte` has its own retained ledger) stop looking like live code. `laneSort.ts` is imported only by its test and `myWorkPreferences.ts`; `myWorkPreferences.ts` only by its test; `MyWorkRow.svelte` only by its fixture and its test; `MyWorkGroup.svelte` by nothing (`slop-audit.md:23-36`, re-checked with `rg` in `research.md`). `MyWorkLaneSort.component.test.ts` has a stale name but tests the current Home's bounded subscription and stays. Nothing a user sees changes. Principle: [4 subtract before you add]; [1 laziness protocol].

## Acceptance
- AC1: The eight files in `done_when` are deleted with `git rm`; no other file is edited unless `npm run check` names an import of a deleted file, in which case only that import line goes.
- AC2: `rg 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode|DEFAULT_LANE_SORT' src` returns nothing. `MyWorkLaneSort.component.test.ts`, `MyWorkHome.component.test.ts`, `CurrentWorkLedgerFixture.component.test.ts`, `HomeParity.component.test.ts`, `CurrentMyWorkView.svelte` and `MyWorkView.svelte` are untouched.
- AC3: `npm run check`, `npm test` and `npm run build` pass; the `verify` component run reports one fewer file and three fewer cases (`MyWorkRow.component.test.ts` had 3) and no new failure; `npx vitest run src/lib/mywork` reports the remaining unit files passing.

## Verification
- AC1 → `git diff --stat`: eight deletions, at most import-line removals.
- AC2 → the `done_when` `rg` predicate.
- AC3 → gate; `npm run build` tail; `verify` tails before and after with the `Test Files` / `Tests` lines.
Refactor pin: the `verify` run before deletion; after deletion the counts drop by exactly one file and three cases.

## Implementation notes
- `git rm` the eight paths. Nothing else.
- Do not touch the workspace-2 files listed in slop-1.
- Chromium once (`npx playwright install chromium`) for the `verify` command.

## Edge cases
- A branch elsewhere still imports a deleted file: `npm run check` names it on rebase.
- Run twice: idempotent.
