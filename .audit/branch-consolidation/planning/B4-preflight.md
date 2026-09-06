# B4 deletion preflight

Read-only inspection at HEAD `1d6053388326fe4fde43a86177955157f11ce588`. No tests, installs, source edits, deletions, staging or ref mutations. This is static reachability evidence, not a runtime pass. Root has concurrent editor work outside the allowlist; rerun affected proof after integration.

## Finding

No concrete live-caller risk found for the exact 17-file allowlist in B4.md. All 17 are tracked, present, byte-identical to their original deletion-parent blobs and unchanged in the inspected working tree. The original nine-file deletion is `ae27b5c6c5597d214d045b4792a102f352d62dec`; the eight-file deletion is `28c0c0cca253b57f1171b632046f58d0a5c825a0`.

Source searches of target module basenames/paths and exported helper identifiers find only self references and these closed internal edges: CommentSidebar to CommentThread; MyWorkRowFixture to MyWorkRow; MyWorkRow.component.test to MyWorkRow and its fixture; myWorkPreferences to laneSort; the two helper tests to their helpers. No external consumer of CommentHighlight exports, laneSort exports or preferences exports was found. Header-name substring matches for WorkspaceHeader and BoardColumnHeader are distinct retained modules.

Dynamic import and barrel searches in src/scripts/config find no loader or barrel exporting these targets. Source dynamic imports load document-parsing packages, exportTemplateDocx and file-saver; the chat primitives barrel exports other modules. No import.meta.glob, require.context, componentMap/componentRegistry or svelte:component loader was found in the relevant source/config search. These checks cover repository source, not hypothetical external consumers.

CurrentProjectPage and PreviewProjectPage import and render the retained CommentOverlay. CommentOverlay imports retained CommentInput. The current Editor creates comment decorations internally and imports CommentRange from retained editor/types; it does not import abandoned CommentHighlight. GenerationRecoveryPanel and current Home/MyWork view contracts remain outside the allowlist.

Two known stale documentation references remain: docs/design-system.md's MyWorkGroup adopter and docs/svelte-migration.md's ui/Header/ui/MenuToggleIcon reuse list. Remove those exact references in B4 or tracked B9; they are not runtime callers.

## Required selection correction

The draft's directory selectors include MyWorkRow.component.test.ts before deletion, and laneSort.test.ts plus myWorkPreferences.test.ts before deletion. They therefore do not express the promised identical retained-suite comparison. Use the following explicit existing files both before and after. This preserves MyWorkLaneSort.component.test.ts: despite its historical name, it asserts assigned-only Home queries and absence of retired queue/sort controls.

```sh
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts 'src/routes/project/[id]/projectRoute.component.test.ts' src/lib/components/generation/GenerationRecoveryPanel.component.test.ts src/lib/components/ui/PageBar.component.test.ts src/lib/components/ui/Disclosure.component.test.ts src/lib/components/ui/StageBadge.component.test.ts src/lib/components/ui/ViewModeToggle.component.test.ts src/lib/components/ui/SelectInput.component.test.ts src/lib/components/ui/Input.component.test.ts src/lib/components/ui/UserMenu.component.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/mywork/MyWorkLaneSort.component.test.ts src/lib/components/mywork/MyWorkHome.component.test.ts src/lib/components/mywork/HomeStartProject.component.test.ts src/lib/components/mywork/CurrentWorkLedgerFixture.component.test.ts src/lib/components/workspace/HomeParity.component.test.ts
node node_modules/vitest/vitest.mjs run src/lib/mywork/homeGreeting.test.ts src/lib/mywork/relativeTime.test.ts
```

This is 14 retained browser suite files and two retained unit suite files. Static source counts in deleted suites are three MyWorkRow cases, nine laneSort cases and four preferences cases. Report these three intentionally retired suite files separately from runtime discovery totals; none was executed here.

The project route suite principally proves route/loading/cohort wiring and importability, not functional comment interaction. Do not cite it as evidence that comment editing was exercised. The static dependency proof establishes why deleting these islands does not remove the current comment implementation. Retain the current Editor.component.test.ts and its broader final component gate coverage; parent owns its concurrent changes and verification. Full authorized loop verification, diff validation and a final no-reference scan remain necessary after deletion. No additional live-caller blocker or missing neighbor suite path was found.

## Exact allowlist blob evidence

Every row matched both the original deletion parent and the current working file.

| Path | HEAD Git blob |
| --- | --- |
| `src/lib/components/comments/CommentHighlight.ts` | `9f4a727e13715f58eed3dbcfc1ec5c2e355f4505` |
| `src/lib/components/comments/CommentSidebar.svelte` | `e17eff8f4cef1ed5cb2c92d2e3402c57229d2a31` |
| `src/lib/components/comments/CommentThread.svelte` | `6dd76f0de98775b1cb29c7c3af93237f431dabc1` |
| `src/lib/components/editor/GapCallout.svelte` | `d60cc3d2bdb976c77e865b8e2d6da21dc98e3fbb` |
| `src/lib/components/editor/SectionDivider.svelte` | `2cdeb5591959e30b47948007da0f5a4960e5a98e` |
| `src/lib/components/generation/ReportViewer.svelte` | `03eeb543ddbb6c4667f5afc50ce2dddab74e2281` |
| `src/lib/components/ui/Header.svelte` | `00c72a9e6ed321448c3eedadef25e3ffe73aac30` |
| `src/lib/components/ui/InsightTile.svelte` | `988e5d8966ff39043e7dffc4bdf3e31466816016` |
| `src/lib/components/ui/MenuToggleIcon.svelte` | `a021955eecda7924857ef3861470043557e1e96f` |
| `src/lib/components/mywork/MyWorkGroup.svelte` | `7a31839f583f0d3f40b838d7a814425ac8c5999d` |
| `src/lib/components/mywork/MyWorkRow.component.test.ts` | `13464de35ce8cc661c19eaf41563e7d3762e5b22` |
| `src/lib/components/mywork/MyWorkRow.svelte` | `e7790c9a7691766025bceec97d98476b9b7590cb` |
| `src/lib/components/mywork/MyWorkRowFixture.svelte` | `451684dda566d6c8d8d02dc48a078cf68ddf402d` |
| `src/lib/mywork/laneSort.test.ts` | `9e24b6262ce41f2c7b09d7926b0afbd8d2206e6c` |
| `src/lib/mywork/laneSort.ts` | `041aa0ef2e48f6360c8d4a365460eb136a6dd818` |
| `src/lib/mywork/myWorkPreferences.test.ts` | `6eafb78b6639c1a24fc94b6f633c5ba691d68e2c` |
| `src/lib/mywork/myWorkPreferences.ts` | `7afe5cba00ce676962c9c5b3da148bb1eb12adc2` |
