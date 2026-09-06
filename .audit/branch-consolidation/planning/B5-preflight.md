# B5 read-only preflight

2026-09-05. Inspected current source, B5 plan/draft, final historical changes, installed Tiptap implementation and immutable Underline proof blob. No tests, installs, source/canonical-spec changes or review dispatch. Parent is implementing B13 separately; B5 must preserve its files.

## Caller scope remains valid

Current src/convex/shared symbol search finds stashProjectIntent/takeProjectIntent only in their definitions and the two allowed test files. The live New Project page calls takeProjectStart at191. Removed stage filter wrappers and stage grouping functions likewise appear only in definitions/their own tests. Live AllProjectsView:142 and ProjectsTableView:328–329 consume stageFilterItemsFromCounts. ProjectsClientGroups imports verifiedStageCounts; keep it and both existing tests at stageRankGroups.test.ts:73–87. No new live caller blocks deletion.

Do not confuse frontend extractSections/ReportSections with live backend extractReportSections in convex/lib/tiptapReport.ts, used by QA and generation code. Delete only the former. The B5 wording “keep used rank API” is imprecise: after historical cleanup stageRankGroups retains verifiedStageCounts, not an independent used ranking function. Keep current shared workflowStages and production grouping unchanged.

## Concrete verification gap: aggregate formatting is not row classification

Current stageFilter.test.ts explicitly proves canonical workflowStage wins over disagreeing legacy status, then isolates stage-less rows. Historical replacement supplies `{drafting:2,on_hold:1,legacy:1}` directly, so it cannot prove either row-classification rule. Its title “totals every project once” also overclaims: stageFilterItemsFromCounts uses the separately supplied total and does not inspect projects or calculate counts.

The proposed read-only dashboardStageCounts.test.ts selection proves company aggregate maintenance, legacy transition, indexed company rows and backfill; its project fixture always assigns legacy status `draft` (line80). It does not exercise the actual dashboard.getFacets endpoint with the old disagreeing-status fixtures. Current dashboard.test.ts getFacets cases at224/240/250 concern access/positive total, not exact buckets. Actual dashboard.ts:401–422 is the live global facet path and counts `workflowStage ?? "legacy"`. Claiming the existing focused command fully replaces the deleted canonical-vs-legacy classification assertions is unsupported.

Recommended parent correction: permit a narrowly scoped addition to existing `convex/dashboard.test.ts` (a tenth test path), using registered authenticated getFacets with actual persisted projects containing canonical drafting/on_hold versus conflicting review/final legacy statuses and one stage-less row. Assert exact stageCounts and total on an otherwise isolated fixture. This is test recovery, no backend change. Add that suite to focused commands. If retaining nine paths is mandatory, explicitly label the deleted tests as retired dead-helper contracts and do not claim live facet-classification proof; adding the real endpoint case is the stronger audit-completion choice.

For the allowed stageFilter unit migration, title cases as formatting supplied aggregate counts. Assert populated order, legacy presence/absence, empty counts and **all** approximate bucket labels, not only the All stages label. Preserve supplied-total behavior rather than inventing a new summing or validation rule. Keep current company/backfill tests as complementary proof, not a substitute for global getFacets.

## Project title handoff: preserve actual one-use behavior

Current projectIntentHandoff.test.ts has three cases: full title/transcript normalization + consume once; title bound + compatibility wrappers; stale/empty reset. NewProjectPrefill proves title application/editability, transcript prefill and duplicate-project title precedence. Migrate wrapper calls mechanically to stashProjectStart({title}) and takeProjectStart().title, preserving full-object emptiness checks where feasible.

Use explicit deterministic now values in unit cases. Preserve the second consume assertion; do not consume the handoff in fixture setup after stashing but before rendering. Existing browser beforeEach clears by takeProjectStart before each fixture, which is correct. Duplicate route must still consume/discard Home handoff while showing the copied title. Keep title-only bound assertion and transcript/no-file field behavior; do not silently discard current transcript tests because wrappers were title-only.

The implementation is module memory, not sessionStorage/localStorage. `localStorage.clear()` alone does not reset it. No reload persistence test or storage API change is warranted. Existing stale test checks TTL+1, not the exact boundary; if documentation claims exact boundary proof, add a deterministic TTL-equal retained-value assertion and TTL+1 rejection within the existing file. Otherwise state the narrower current evidence honestly.

## Underline proof is usable, with evidence limits

Immutable proof blob `a24d9b656f774417664c97f9d5d440df2e96da04` resolves dependencies and actual tiptapConfig from process.cwd(), transpiles that file, creates actual Tiptap Editor with element:null and editable true/false, checks extension count/schema/initial mark/text, and toggles editable selection off/on. It does not mount browser DOM. Installed Editor.ts:125–154 initializes editor state independently of view and only mounts with an element. This supports the intended headless real-editor proof without installing jsdom or changing config.

Installed StarterKit src:263–264 registers Underline unless disabled; current tiptapConfig registers it explicitly as well. Preserve StarterKit settings/package. The baseline script can exit0 while reporting two registrations and one duplicate warning: it intentionally treats that as expected baseline. Its in-memory filtered candidate is a design control only, never proof of a changed production file. After the actual source edit, demand phase current, explicitEntriesInSource0, underlineRegistrations1 and duplicateWarnings0 for both modes, with initial mark and editable toggles retained. Capture source hash externally because the historical script reports only sourcePath.

The script checks mark presence and text, not exact full JSON equality or construction of ReadOnlyEditor.svelte. To claim exact JSON roundtrip, strengthen the owned audit script to compare expected document JSON, or word evidence narrowly as “initial underline mark survives serialization”. To claim actual UI construction, retain canonical Editor component runs; do not relabel the element:null proof as browser coverage. No need to add a second synthetic schema or broad UI suite.

## Specific draft corrections proposed

1. Replace “used rank API” with retained verifiedStageCounts/current shared stage metadata.
2. Distinguish formatting supplied facets from classification; authorize the single registered getFacets test above and add its command, or explicitly retire the dead-helper classification claim.
3. Preserve full one-use/transcript/duplicate-prefill assertions and deterministic TTL handling; do not reset by localStorage alone.
4. Require separate actual baseline/current Underline rows, source hashes and precise JSON/headless claims. Never use the in-memory candidate as post-edit acceptance.
5. Keep B13 caller regressions and existing Editor tests unchanged. Parent owns full gate/reviews; worker runs only the enumerated focused proof after dispatch.

No product defect is alleged by this preflight. These are scope/fixture/evidence corrections intended to prevent a misleading test migration receipt.
