# Slop audit, 2026-09-04

Read-only audit against root checkout `11bfe3e`; no product edits. Read `.factory/AGENTS.factory.md`, TypeScript skill and Convex guidelines. Production import graph covered 610 TS/JS/MJS/Svelte files across src/shared/convex/scripts (178 test files, excluding tests/ from this first inventory), with all route/backend/script modules treated as roots. Refined resolution for `.js` imports to `.ts`; then verified dead candidates with repository-wide symbol/path searches. This is evidence for narrowly scoped deletion tickets, not a claim every statement was manually reviewed.

## S1, P2: Remove abandoned frontend ports, 9 files, 810 lines

These files have no imports from routes, live source, tests, styleguide, scripts, or barrel exports, except CommentThread which is imported only by the dead CommentSidebar. Every file can be deleted in full:

- `src/lib/components/comments/CommentHighlight.ts:1` (29 lines)
- `src/lib/components/comments/CommentSidebar.svelte:1` (212)
- `src/lib/components/comments/CommentThread.svelte:1` (184)
- `src/lib/components/editor/GapCallout.svelte:1` (35)
- `src/lib/components/editor/SectionDivider.svelte:1` (4)
- `src/lib/components/generation/ReportViewer.svelte:1` (207; its header explicitly calls it a temporary pre-Tiptap viewer)
- `src/lib/components/ui/Header.svelte:1` (70)
- `src/lib/components/ui/InsightTile.svelte:1` (31)
- `src/lib/components/ui/MenuToggleIcon.svelte:1` (38)

Retain active `MarginComments`, `CommentOverlay`, `CommentInput`, `ReadOnlyEditor`, `Editor` and the current page/header primitives. Do not remove shared CSS by component-name inference: `.comment-highlight` is used by live editor decorations.

Verification: run baseline component tests before component changes; after deletion `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`, `npm test`, `npm run test:component`, and `npm run build`. Rerun `rg -n 'CommentHighlight|CommentSidebar|CommentThread|GapCallout|SectionDivider|ReportViewer|components/ui/Header|InsightTile|MenuToggleIcon' src shared convex scripts --glob '!**/_generated/**'` (expected empty after deletion). Deleted unreachable files need no new behavioral test.

## S2, P2: Delete the retired My Work presentation island, 8 files, 506 lines

- `src/lib/components/mywork/MyWorkGroup.svelte:1` (83 lines), no imports.
- `src/lib/components/mywork/MyWorkRow.svelte:1` (95), referenced only by its own test and fixture.
- `src/lib/components/mywork/MyWorkRowFixture.svelte:1` (26), test-only for dead row.
- `src/lib/components/mywork/MyWorkRow.component.test.ts:1` (67), 3 tests for dead row.
- `src/lib/mywork/laneSort.ts:1` (69), referenced only by its tests and dead preferences module.
- `src/lib/mywork/laneSort.test.ts:1` (86), tests dead functionality.
- `src/lib/mywork/myWorkPreferences.ts:1` (32), referenced only by own tests.
- `src/lib/mywork/myWorkPreferences.test.ts:1` (48), tests dead functionality.

`MyWorkView.svelte:4-8` now renders HomeStartProject, WithYouBand and RecentProjectsRail; `CurrentMyWorkView.svelte:1-18` has its own retained rollback table/ledger. No runtime consumer remains for these eight files. **Keep** `MyWorkLaneSort.component.test.ts:11-14`: despite its stale filename, it checks the current Home's bounded subscription and queue-control removal. Also keep CurrentWorkLedgerFixture, its tests, and CurrentMyWorkView. This deletion island does not overlap any specific file in escalated `workspace-2-drop-dead-gate-branches` (checked ticket scope); do not modify WorkspaceGate, workspaceExperience, workspace route tests, projectRoute tests or product-domain.

Verification: baseline component tests before changes; after deletion check + unit + component + build. `rg -n 'MyWorkGroup|MyWorkRow|myWorkPreferences|sortLaneRows|parseLaneSortMode' src` must be empty. Preserve `MyWorkLaneSort.component.test.ts`, `MyWorkHome.component.test.ts`, `CurrentWorkLedgerFixture.component.test.ts`, and `HomeParity.component.test.ts` passing.

## S3, P1 verification debt: 14 orphan Bun test files are a mixed bag, not all useless

`vitest.config.ts:33` includes only `tests/aiUsage.test.ts` from tests/. Fourteen other suites import `bun:test`; this debt is already listed in `docs/system-map.md:414`. Ran the exact command below, on the current artifact, with Bun 1.3.14:

```
bun test tests/exportValidation.test.ts tests/lineLimits.test.ts tests/qaScoring.test.ts tests/diff.test.ts tests/brainScienceRouting.test.ts tests/teamRoster.test.ts tests/generationMode.test.ts tests/craScienceCodes.test.ts tests/projectReviewAccess.test.ts tests/reportSections.test.ts tests/reportEdits.test.ts tests/snapshots.test.ts tests/chatProposals.test.ts tests/industries.test.ts
```

Actual result: exit 1; 105 pass, 11 fail, 308 assertions, 116 tests across 14 files, 958ms.

- `tests/snapshots.test.ts:127` expects old single-transcript lineage; implementation correctly includes `sourceTranscriptIds: ['transcript']`. Existing `convex/lib/snapshots.test.ts:72,91,107,126` covers current full-set/legacy/provenance semantics. Retention and milestone-picker cases earlier in the old suite need mapping before deleting whole file.
- Ten failures in `tests/chatProposals.test.ts`: stale fixture at `:245` spreads absent tables in its homemade DB, so current writerProfiles/houseStyle/workItems reads crash; valid-save test at `:599` expects success without current turn state and receives `{ok:false, stopped:true, reason:'The writer stopped this reply.'}`. Failing apply cases include audit tuple, research checkpoint, repeated-target uniqueness, staleness, idempotence, deletions, ordered replacement list, unrelated writer permissions. **Do not modify product code to satisfy obsolete expectations**, especially unrelated-writer permissions.
- Current `convex/chatProposals.test.ts:177,222,265,288,310,336` covers transactionally applied editor steps, expectedRevisionNumber, replay, auth, JSON validation and pending-state rules with convex-test, but does not justify deleting every old assertion without mapping.
- Keep/migrate valuable passing pure coverage: diff exact reconstruction and bounded fallback; canonical report hard-break boundaries; immutable export preflight and Schedule 60 validation; report replacement casing; model mode selection; Brain science-code routing; CRA vocabulary; industry authorization. These are behavior tests, not slop. `tests/lineLimits.test.ts` and current `convex/lib/lineLimits.test.ts` overlap on some cap cases, but the current suite concentrates on GAP stripping while the old suite has broader physical wrapping boundaries.

Recommendation: separate small tickets for pure-suite Vitest migration and for retirement of handmade DB fixtures after missing unique cases are migrated to convex-test. DX audit owns discovery/CI wiring. Do not keep a second Bun runner merely to avoid migration. Do not remove @types/bun before all bun:test suites migrate/retire.

## S4, P2: Unused dependencies, with peer-dependency exclusions

No production, test, script or config imports found for `docx` (`package.json:50`), `svelte-exmarkdown` (`:57`), `tippy.js` (`:62`). Active DOCX export at `src/lib/exportTemplateDocx.ts:1` uses JSZip and edits the template XML. Remove these direct dependencies and update the canonical lockfile in a narrow ticket; verify clean install, typecheck, unit/component tests and build. Do not claim browser bundle reduction without measuring: dead dependencies may already be tree-shaken.

`eslint` (`package.json:78`) has no configured ESLint runner/config; `lint` currently aliases svelte-check. This can be removed unless the DX ticket chooses to establish an actual lint loop.

Critical false positives rejected by reading installed package manifests:

- Keep `convex-helpers`: @convex-dev/agent, rag, workflow and workpool require it as a peer.
- Keep Tiptap bubble-menu and floating-menu: svelte-tiptap requires both as peers.
- StarterKit supplies code-block, horizontal-rule and link internally; their direct declarations are redundant candidates, but prioritize the clearer dead packages and retain editor behavior through browser/build checks.
- Keep @types/bun while orphan suites remain.

## S5, P3: Source-text tests freeze spelling and class order

`src/lib/components/project/projectPageBoundary.test.ts:61-70` asserts exact class-list prefixes and `<Disclosure id={...} open={...}>` text. Equivalent attribute order, class ordering or a renamed local variable fails without user-visible regression. `src/routes/admin/adminWorkspaceRoutes.test.ts:11` likewise pins an exact import string. Migrate layout/disclosure/immutable project-type checks to existing browser component coverage; remove the exact source-string assertions only once behavioral coverage proves the invariant.

Keep genuine architectural/boundary checks until replaced deliberately: current/preview rollback separation in projectPageBoundary, and formControlContract's AST walk enforcing centralized form styling. A static architectural rule is not useless solely because it reads source. `formControlContract.test.ts:90-101` CSS spelling checks are smaller future browser-computed-style candidates, not urgent test deletion targets.

## S6, P3: Duplicate file-type and proposal-reference logic

`src/lib/components/chat/AgentChatPanel.svelte:124-136` duplicates `src/lib/components/project-new/shared.ts:18-31` but omits image detection. It is called on parse failure at AgentChatPanel `:553`, while shared implementation is used by new project and PD review upload paths. Consolidate into a neutral upload/parser helper after explicitly retaining the intended image-vs-other behavior; do not silently call these identical functions.

`AgentChatPanel.svelte:111-118` duplicates `shared/chatProposals.ts:19-24`; shared helper respects kind and filters references, while local code uses presence precedence. This is only a safe consolidation after testing legacy proposal shapes. Low priority compared with deletion islands; authorization/prose apply flow must remain untouched.

## Retained small abstractions

`src/lib/stableQuery.svelte.ts:18` is useful: it preserves prior query data while resubscribing and exposes refresh/loading separately. `src/lib/industries.ts:5` reexports shared vocabulary plus adds display fallback. `convex/lib/styleOverrides.ts:11` keeps Convex validators at runtime boundary while shared normalizers remain cross-runtime. Do not flatten these merely because they are small.

## S7, P2: Remove test-only compatibility wrappers, 3 files

Confirmed using a TypeScript AST export inventory plus whole-source identifier search: `src/lib/workspace/projectIntentHandoff.ts:51-57` exports `stashProjectIntent` / `takeProjectIntent`, but the only consumers are `projectIntentHandoff.test.ts:6,8,38-39` and `src/routes/project/new/newProjectPrefill.component.test.ts:7,62,67,90,101`. All live Home/new-project code uses `stashProjectStart` / `takeProjectStart` already. Delete the obsolete wrappers, update tests to call the actual public API (`stashProjectStart({title})`, `takeProjectStart().title`), and retain title normalization, one-time consumption, transcript transfer, TTL, and duplicate-project precedence behavior. No new abstraction is needed.

Verification: `npx vitest run src/lib/workspace/projectIntentHandoff.test.ts`; `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/project/new/newProjectPrefill.component.test.ts`; check/build. `rg -n 'stashProjectIntent|takeProjectIntent' src` must be empty after change. Does not overlap escalated workspace-2.

## S8, P2: More dead helper islands inside otherwise live modules

Separate two-file tickets keep reviewability; do not combine indiscriminately with the 8-file My Work cohort.

1. `src/lib/workspace/stageRankGroups.ts:83` (`groupRowsByStageRank`) and `:156` (`visibleStageGroups`) are used only by `stageRankGroups.test.ts`. The sole production importer is `ProjectsClientGroups.svelte:32,124`, which uses **only `verifiedStageCounts`**. Delete grouping/display functions, their exclusive helper/types/imports, stale module explanation, and dead-function test suites at `stageRankGroups.test.ts:31-71,89-end`. Retain `verifiedStageCounts` at `stageRankGroups.ts:67-75` and its two current tests at test `:73-87`, plus the production client-group component tests. This is test-maintained retired UI logic, about 150 source lines plus 100 tests.
2. `src/lib/dashboard/stageFilter.ts:14` (`matchesStageFilter`) and `:48` (`stageFilterItems`) have only test consumers; `stageFilterKey` and `countProjectsByStage` are dependencies solely of those dead functions. The current table uses `stageFilterItemsFromCounts`, the `StageFilter` type, `LEGACY_STAGE_FILTER`, and `stageFilterLabel`. Delete the local full-array filtering/counting branch; rewrite the three unit cases to exercise the actual count-based API with the same populated-stage/legacy/total guarantees. No runtime caller uses the deleted path. Verification: stageFilter unit and ProjectsTableView/ProjectsDisplayMenu component suites.
3. `src/lib/reportSections.ts:267-275` (`extractSections`) and its exclusive `ReportSections` interface at `:67` have no callers, including tests. The canonical parser and `reportSectionMetrics` are the live APIs. Delete just this stale compatibility projection; keep the real parser and orphan report/export tests while migrating them. Verification: report/export unit cases, typecheck, build.

Lower-value confirmed test-only exports not worth making a broad API churn ticket: `src/lib/mywork/relativeTime.ts:16` formatUpdatedRelative (formatOpenedRelative is live), `shared/humanProse.ts:85` isDashClean, `shared/workflowLabels.ts:55` effectiveWorkflowStage, and `shared/workflowTransitions.ts:109` allowedNextWorkflowStages. `convex/lib/auth.ts:66` requireProjectCreator has only a legacy Bun test caller, but auth is a policy boundary so prefer the dedicated authorization workstream over cosmetic deletion here. The escalated resolveWorkspaceExperience candidate is explicitly excluded.

## Orphan-suite coverage mapping addendum

See `orphan-test-map.md` in this plan directory for all 14 suites, existing counterpart test paths, unique proposal scenarios to preserve and current permission semantics. Correction/clarification to S3: `convex/chatProposals.test.ts` proves **markProposalApplied**, a different endpoint from the old **applyProposal** cases; same-endpoint transaction evidence instead lives in `convex/preEditSnapshot.test.ts` and `convex/reportAuthz.test.ts`. Do not treat markProposalApplied replay tests as coverage for applyProposal replay.
