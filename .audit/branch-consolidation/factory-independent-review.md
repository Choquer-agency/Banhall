# Independent factory history reconciliation review

Read-only cross-check on 2026-09-05. Captured baseline `cc6b706c3b43f971d944cb703a4174eabf3134d9`; observed consolidation HEAD `b2d5db5b63c0a70bce20d86df56e11ffbe89fad9`. Scope is the two captured tips `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d` and `c2211d0e198a78b65ffbb18bd441d17bfe79f4fc`. No tests, implementation, specs, ledger or refs changed. Only this report is written.

## Finding: LOW, one useful assertion hunk remains unmapped

`e581436f28c104b3159ab03be3418be228b188cd` is classified wholly already incorporated/superseded. Most of its behavior is better covered by current main, but its actual navigation-order regression is absent. Historical `src/lib/components/workspace/WorkspaceRail.component.test.ts`, case “moves the Admin records group below the primary workspace links”, replaces the `mt-5` token assertion with:

```ts
expect(projects.compareDocumentPosition(admin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
expect(navLink("Home")!.compareDocumentPosition(projects) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Current same case at lines 212–216 asserts only `mt-5`; the first navigation test at 51–59 checks hrefs but not relative order. Read-only search of workspace and route component suites found no equivalent ordering assertion. Current production markup has the correct order, so this is a recovered verification obligation, not a reported product bug. Add these two semantic assertions to the pending UI batch using current eligible fixture and destinations. Preserve current Learning health destination, seven-role exposure matrix, keyboard expand/collapse, geometry and theme assertions. Do not transplant the historical file. Until mapped, withdraw the blanket “no useful hunk omitted” claim for this one commit. No implementation is performed here.

## Additional LOW assertion gap in the same superseded test commit

The historical `e581436f28c104b3159ab03be3418be228b188cd` Admin destination case additionally asserts `links.every((link) => link.querySelector("[data-admin-icon-tone] svg"))`. Current rail suite checks the complete destination list, icon-tile count and distinct computed colors, but explicitly checks an SVG only for ingestion (lines 149–155). A different destination can lose its SVG without failing those assertions. The current product renders icons; this is useful lost regression coverage, not an observed rendering failure. Retain an all-current-destination SVG check in B8 using the current nine destinations, including Learning health, rather than the old eight-item list.

Parent accepted the Home → Projects → Admin DOM-order hunk into B8 during this review. Parent also accepted the all-current-destination SVG hunk into B8; its scope already permits WorkspaceRail.component.test.ts and preserves every existing assertion. Both belong to the same partially superseded commit; keep all stronger current keyboard, role, motion, geometry, focus and color assertions. No other unique missing assertion was found after reading the complete sign-out, route and Admin supersession diffs against current tests. Settings href from the old drawer test has a current standalone rail assertion; the same rail implements the drawer footer, so this does not require duplicating a new test.

## Independent completeness and classification checks

Recomputed `git rev-list <both captured tips> --not <captured baseline>`: exactly 124 distinct commits, identical to recorded SHA set. Recomputed first-parent changed paths for every commit: all 124 path sets match the inventory. Recomputed every merge's intersection of parent-to-result changed paths: all 14 match. Classification counts are 24 planned source units, 80 historical planning/status/evidence units, 14 merges, six already incorporated/superseded units.

The 80 historical units change only `.factory/plans/20260904-code-quality-sweep/`, `.factory/tickets/` and canonical deferred-work historical content. No application, active configuration or runtime file is concealed under that classification. The planning subtree does contain executable auxiliary evidence scripts, so “metadata” must not mean useless prose: four proof sources are explicitly retained in `auxiliary-verification-sources.json` and referenced by batch plans. `capture-final-proof.py` is a historical clone/log harness pinned to old 1516/292/191 counts and owns external process groups; it is not a missing application feature or appropriate current gate transplant. Preserve these artifacts as provenance without executing or importing old factory/ledger state.

The 24 planned units correspond to B1–B10's concrete parser/search/read-budget/dead-island/helper/actual-test/dependency/UI/docs/route changes. Earlier precise current-code plans remain necessary: a source-commit mapping is not permission to overwrite newer tests or policy. Newly recovered `4cc4a85fa06cfedcc460dc5527e815ca539b708e` Button `min-h-11` actual 44px assertion and `b9e09bc407d835c004b6dcf2ebaa3dc51261892e` `.factory/factory.toml` single QA smoke key are now explicitly accounted. They remain pending implementation/verification, not accepted merely by classification.

## Every merge checked

- `89db98b2af158f911b0c2649c386ab4838f757ce`: no path differs from every parent.
- `05b896ec42afcbada0b5da8877bf6cdb2b73f4ba`: _bmad-output/implementation-artifacts/deferred-work.md, convex/schema.ts.
- `e04ab9a9f05717b7607efe1137eac97795a41ed0`: _bmad-output/implementation-artifacts/deferred-work.md, _bmad-output/implementation-artifacts/spec-bmad-verification-resource-bound.md, tsconfig.json.
- `ed1d24fd919a28d940e19a8164f2ed5346398ab9`: no path differs from every parent.
- `82e7e011b3b547d8c37f492d7b62a591d5c5c08d`: no path differs from every parent.
- `9e3940db95673dc223adf17bc840cd932e2d4200`: no path differs from every parent.
- `7a32eeedc446f2ea853cf8515655f0326887d770`: no path differs from every parent.
- `7b9b01e03ecf9089ccf15b70c0e619ded7eb08b6`: no path differs from every parent.
- `4b6159fbb0ac695c4f4d5c3dc905fa33d1bc8663`: no path differs from every parent.
- `78e573cf94255aa2c38efa856768548398d23e92`: no path differs from every parent.
- `14e80a0b4fdce99deb48210240dc654ad69a24f3`: no path differs from every parent.
- `292e145985e420053b21b21712aae048f612be25`: no path differs from every parent.
- `acf55d94dcf71f88f1bf8fb954d6b2d846d04b91`: no path differs from every parent.
- `5583a2589e4421c2bc73cf9e5c4371fd7f062f07`: no path differs from every parent.

Twelve merge results have no path differing from every parent. Their incoming changes remain traced to separately captured parent commits; there is no independent resolution-only source blob to recover.

`05b896ec42afcbada0b5da8877bf6cdb2b73f4ba` combines schema parent blobs `33576f907c49ff20fdcac3f29198516e4015a553` and `59c1c250f3069c85842c6cce1e489e40ccc29338` into `6e5f8b35290c9877d2e1271265f8394ae5f4b5a0`. The combined source contains chat-spend project/time index, chat-turn optional user ID/user-status index, and review revision/hash fields plus writerReview user ID typing. Direct merge-result→captured-main schema diff contains additions only, with none of these fields removed or modified. Current HEAD schema is byte-identical to captured main. Concrete current anchors: project/time index486; chatTurns847–868; writerReviews1581–1589; qaItemFeedback1627–1630; pdReviews1697–1700. Therefore the useful parent-derived combination is preserved, not merely reachable in ancestry.

`e04ab9a9f05717b7607efe1137eac97795a41ed0` mechanically combines tsconfig includes and introduces a duplicate include key. `11bfe3ebcb79fd8be78e2e057b45ea69db0f88be` removes that duplicate. Current main has one include list retaining generated Svelte declarations, vite, src, tests and shared coverage. B7 removes only the separately audited obsolete singular test globs. Do not restore the broken merge result or overwrite current includes.

## Other superseded source checks

- `bbdd2b132c8bbdbe0208fcb5abcbb15b2747cffd`: current suites import Vitest; current runner separates pure Node tests from actual Convex tests. Current `tests/snapshots.test.ts:83` retains provenance assertions that the historical patch deleted. Preserve main, including real proposal suite.
- `ca79e7670ea53237ecb52e4977af0649051da4cc`: current workspaceRoutes:39–70 has stronger pathname/query-default/repeated Unicode parameter preservation. No missing routing assertion found.
- `494a57575dfe8fa1d3757edff1777994eae53625`: current WorkspaceChrome:73–138 strengthens sign-out layering, real hit tests, focus trapping, cancel/Escape recovery and no sign-out/no-navigation effects. Settings href exists in current rail suite. No missing sign-out behavior found.
- `e581436f28c104b3159ab03be3418be228b188cd`: current role matrix/keyboard exposure is stronger; the ordering and all-destination SVG assertion gaps above remain.
- `ab56b84364b43d00df1232a49ad36c526280e9f5`: current loop-verify:31–40 retains concise actionable installation hints, alongside newer real browser preflight and discovery protections.

## Limits and disposition

No additional missing product or active configuration change was found in this bounded cross-check. This is source/evidence reconciliation, not runtime acceptance or authority for an ancestry-only merge before pending batches pass. Parent must integrate the mapped work, including the LOW ordering and icon-presence test hunks, and verify combined source. Historical done statuses and stored logs are not current execution proof.

Reviewed inventory SHA-256: `933a9f4cd558e52c5e7f9d4d582861a0cf70ee64ad9eb40947c09720551f80da`.

Post-review disposition update: the inventory owner reclassified `e581436f28c104b3159ab03be3418be228b188cd` as partially required in B8. Updated counts are 25 planned, 80 historical, 14 merge-only and five superseded (still 124 total). Parent accepted both ordering and all-current-icon assertions. The initial reviewed counts/hash above intentionally describe the input that exposed the gap. Latest observed inventory SHA-256: `91743e60f8ae920de8e3e41b7c95c43c8471f0db0693ca274e0bcae6310cb4d6`. No other whole-test supersession gap was found.
