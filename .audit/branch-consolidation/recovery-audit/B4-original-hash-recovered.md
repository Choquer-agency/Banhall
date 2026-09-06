# B4: delete only proven abandoned UI islands

Inspection baseline cc6b706c3b43f971d944cb703a4174eabf3134d9. Planning only: no installs, tests, source/spec/ledger edits or branch mutations. Recheck current HEAD and overlapping paths after earlier batches. Parent owns BMAD build/review and final gates.

## Exact source and file set

- `ae27b5c6c5597d214d045b4792a102f352d62dec`: nine abandoned React-port components.
- `28c0c0cca253b57f1171b632046f58d0a5c825a0`: eight retired My Work presentation/helper/test files.

Delete exactly:

- `src/lib/components/comments/CommentHighlight.ts`
- `src/lib/components/comments/CommentSidebar.svelte`
- `src/lib/components/comments/CommentThread.svelte`
- `src/lib/components/editor/GapCallout.svelte`
- `src/lib/components/editor/SectionDivider.svelte`
- `src/lib/components/generation/ReportViewer.svelte`
- `src/lib/components/mywork/MyWorkGroup.svelte`
- `src/lib/components/mywork/MyWorkRow.component.test.ts`
- `src/lib/components/mywork/MyWorkRow.svelte`
- `src/lib/components/mywork/MyWorkRowFixture.svelte`
- `src/lib/components/ui/Header.svelte`
- `src/lib/components/ui/InsightTile.svelte`
- `src/lib/components/ui/MenuToggleIcon.svelte`
- `src/lib/mywork/laneSort.test.ts`
- `src/lib/mywork/laneSort.ts`
- `src/lib/mywork/myWorkPreferences.test.ts`
- `src/lib/mywork/myWorkPreferences.ts`

Main blobs match the original deletion parents. Immutable `git grep` finds references only within these islands and their own tests, not current production callers. Re-run import/reference search on actual post-B1/B2 source before deleting; dynamic imports, barrels and docs need accounting. The nine-file group includes810deleted lines; eight-file group506historically. Counts are review context, not acceptance by themselves.

## Preserve behavior

Current Comment handling, Current/PreviewProjectPage, generation recovery, active My Work tabs and assigned-only Home remain. Deleted MyWorkRow and laneSort tests cover their own retired implementation, not current Home contract. Do not restore retired five-lane/sort-control UI to justify old files. Product-domain permits loaded-row reordering; it does not require the retired sort control. Preserve MyWorkLaneSort.component.test.ts, HomeParity and current view tests. No backend/schema/permission changes.

Two directly stale documentation hunks can accompany deletions or be reserved for B9: remove MyWorkGroup from docs/design-system.md adopter list and ui/Header/ui/MenuToggleIcon from docs/svelte-migration.md reuse list (source b9e09bc). Do not replace entire historical docs.

## Meaningful proof

Before/after source reference inventory and exact deleted-file list, then current real neighbor tests:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts 'src/routes/project/[id]/projectRoute.component.test.ts' src/lib/components/generation/GenerationRecoveryPanel.component.test.ts src/lib/components/ui/PageBar.component.test.ts src/lib/components/ui/Disclosure.component.test.ts src/lib/components/ui/StageBadge.component.test.ts src/lib/components/ui/ViewModeToggle.component.test.ts src/lib/components/ui/SelectInput.component.test.ts src/lib/components/ui/Input.component.test.ts src/lib/components/ui/UserMenu.component.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/mywork src/lib/components/workspace/HomeParity.component.test.ts
node node_modules/vitest/vitest.mjs run src/lib/mywork
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
git diff --check
```

Use the exact same retained-suite selection before and after when proving runtime parity. Deleted suite counts must be explicitly subtracted from discovery totals, not presented as coverage regression or hidden by broad exclusions. `git ls-files -z` plus canonical listing after staging should contain no deleted file and no new orphan. Historical tests/build prove only original integrated branch; rerun on current. No real authenticated application navigation was present in original evidence.
