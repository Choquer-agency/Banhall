---
key: slop-2-dead-helpers-and-deps
status: todo
kind: refactor
deps: [perf-1-parser-timers-editor-index]
touches: [src, package.json, package-lock.json]
risky: []
verify: [npx vitest run src/lib/workspace/projectIntentHandoff.test.ts src/lib/workspace/stageRankGroups.test.ts src/lib/dashboard/stageFilter.test.ts, npx vitest run --config vitest.component.config.ts src/routes/project/new/newProjectPrefill.component.test.ts src/lib/components/workspace/ProjectsClientGroups.component.test.ts src/lib/components/workspace/ProjectsTableView.component.test.ts src/lib/components/workspace/ProjectsDisplayMenu.component.test.ts, npx vitest run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts]
done_when: ["! rg -q 'stashProjectIntent|takeProjectIntent|groupRowsByStageRank|visibleStageGroups|matchesStageFilter|stageFilterItems\\(|countProjectsByStage|extractSections' src", "! rg -q '\"(docx|svelte-exmarkdown|tippy\\.js|eslint)\"' package.json", npx vitest run src/lib/workspace/projectIntentHandoff.test.ts src/lib/workspace/stageRankGroups.test.ts src/lib/dashboard/stageFilter.test.ts, "! rg -q 'import Underline|^    Underline,' src/lib/tiptapConfig.ts"]
title: "Delete test-only helper exports (intent wrappers, stage grouping, stage filtering, extractSections) and four unused dependencies"
plan: 20260904-code-quality-sweep
ui: false
updated: "2026-09-05T06:29:26.993Z"
---
## Intent
For the reader of four live modules: the functions that exist only so their own tests have something to call are gone, and the tests exercise the API production uses. `stashProjectIntent`/`takeProjectIntent` (`src/lib/workspace/projectIntentHandoff.ts:51-57`) wrap `stashProjectStart`/`takeProjectStart`, which every live caller already uses; `groupRowsByStageRank`/`visibleStageGroups` (`stageRankGroups.ts:83,156`) and `matchesStageFilter`/`stageFilterItems` (`stageFilter.ts:14,48`) describe retired UI; `extractSections` (`reportSections.ts:267`) has no caller at all. Four dependencies (`docx`, `svelte-exmarkdown`, `tippy.js`, `eslint`) have no import anywhere and no config (`slop-audit.md:55-59`; re-checked in `research.md`). The maintainer inherits smaller modules, tests that pin the real contract, and a lockfile without dead packages. Principle: [5 minimize reader load]: one-caller and zero-caller wrappers collapse; [4 subtract before you add].

## Acceptance
- AC1: `stashProjectIntent` and `takeProjectIntent` are deleted. `src/lib/workspace/projectIntentHandoff.test.ts` and `src/routes/project/new/newProjectPrefill.component.test.ts` call `stashProjectStart({ title })` and read `takeProjectStart()?.title`; the cases still pin title normalization and bounding, one-time consumption, TTL expiry, transcript transfer and duplicate-start precedence. The test named "preserves the title-only compatibility wrappers" (`projectIntentHandoff.test.ts:34`) is renamed to what it now pins.
- AC2: `groupRowsByStageRank`, `visibleStageGroups`, and every type or helper only they used are deleted from `src/lib/workspace/stageRankGroups.ts`; `verifiedStageCounts` (`:67-75`) and the module comment that describes it stay. `stageRankGroups.test.ts` keeps its two `verifiedStageCounts` cases (`:73-87`) and loses the rest. `ProjectsClientGroups.svelte:32,124` compiles unchanged.
- AC3: `matchesStageFilter`, `stageFilterItems`, `stageFilterKey` and `countProjectsByStage` are deleted from `src/lib/dashboard/stageFilter.ts`; `stageFilterItemsFromCounts`, `StageFilter`, `LEGACY_STAGE_FILTER` and `stageFilterLabel` stay. The three cases in `stageFilter.test.ts` are rewritten against `stageFilterItemsFromCounts` and still assert: only populated stages appear, stage-less rows land in the labelled legacy bucket, and totals count every project once.
- AC4: `extractSections` and the `ReportSections` interface are deleted from `src/lib/reportSections.ts`; `parseCanonicalReport` and `reportSectionMetrics` are untouched. Delete only the explicit Underline import and array item from `src/lib/tiptapConfig.ts`: StarterKit 3.28.0 already registers the same extension. Keep StarterKit settings and the direct dependency declaration. Actual editable and read-only editor configurations register underline once, preserve underline JSON and editable toggle commands, and emit no duplicate-underline warning. The baseline registers it twice; use the recorded headless proof below and the Editor browser suite inherited from perf-1.
- AC5: `docx`, `svelte-exmarkdown`, `tippy.js` and `eslint` are removed from `package.json`; `package-lock.json` is regenerated (`npm install`); `npm ci` from a clean `node_modules` succeeds; `npm run check`, `npm test`, `npm run build` pass. `@tiptap/extension-bubble-menu`, `@tiptap/extension-floating-menu` and `convex-helpers` stay (peers).
- AC6: `git diff --stat` shows net deletion in every touched source file; no new export, file or abstraction is introduced.

## Verification
- AC1 → `! rg -q 'stashProjectIntent|takeProjectIntent' src`; `npx vitest run src/lib/workspace/projectIntentHandoff.test.ts`; `npx vitest run --config vitest.component.config.ts src/routes/project/new/newProjectPrefill.component.test.ts`.
- AC2 → `! rg -q 'groupRowsByStageRank|visibleStageGroups' src`; `npx vitest run src/lib/workspace/stageRankGroups.test.ts`; `ProjectsClientGroups.component.test.ts`.
- AC3 → `! rg -q 'matchesStageFilter|stageFilterItems\(|countProjectsByStage|stageFilterKey' src`; `npx vitest run src/lib/dashboard/stageFilter.test.ts`; `ProjectsTableView` and `ProjectsDisplayMenu` component suites.
- AC4 → `! rg -q 'extractSections|ReportSections\b' src`; `npm run check`.
- AC5 → `! rg -q '"(docx|svelte-exmarkdown|tippy\.js|eslint)"' package.json`; `rm -rf node_modules && npm ci` output tail; gate; `npm run build` tail.
- AC6 → `git diff --stat` in evidence.
Refactor pin: run the `verify` commands before any edit and paste the case names and counts; after the edit the kept cases pass with unchanged names, the rewritten `stageFilter` cases pass with names that say what they assert, the deleted cases are listed in `decisions.tsv` with `deleted: tests retired UI`.

## Implementation notes
- `projectIntentHandoff.ts`: delete lines 51-57 only. In the component test, replace `stashProjectIntent("Solar tracker prototype")` with `stashProjectStart({ title: "Solar tracker prototype" })` and `expect(takeProjectIntent()).toBe("")` with `expect(takeProjectStart()).toBeNull()` or the equivalent the live API returns after consumption (read `takeProjectStart` first; do not guess the empty value).
- `stageRankGroups.ts`: after deleting the two functions, delete any type, constant or import that `npm run check` or `rg` shows is now unused inside the file. Keep the file if `verifiedStageCounts` remains; do not move it.
- `stageFilter.ts`: same. `stageFilterItemsFromCounts` has two live callers, `src/lib/components/dashboard/AllProjectsView.svelte:142` and `src/lib/components/workspace/ProjectsTableView.svelte:328-329`; the rewritten tests build a counts record the way those call sites do. The old "canonical stage wins over legacy status" case (`stageFilter.test.ts:18-23`) tests `stageFilterKey`, a client classification with no live caller once the two functions go; check `convex/dashboardStageCounts.test.ts` pins the server-side rule and record `deleted: pinned server-side at <file>::<case>` in `decisions.tsv`, or `deleted: rule has no live implementation` if it does not.
- `reportSections.ts:66-274`: delete the comment, the function and the interface at `:67-71`.
- Dependencies: `npm uninstall docx svelte-exmarkdown tippy.js eslint`. `@types/bun` and `bun.lock` are tests-3's; do not touch either here. Do not remove the redundant `@tiptap/extension-{code-block,horizontal-rule,link}` lines (inventory #6: transitively pinned anyway).
- Do not touch files owned by `workspace-2-drop-dead-gate-branches` (listed in slop-1).

## Edge cases
- `takeProjectStart` after `stashProjectStart({ title })` with a blank title: the live API's normalization applies; the test asserts the live behaviour, not the wrapper's `""`.
- A component test that only passed because a wrapper stored a bare string: adapt the fixture to the object shape; do not reintroduce a wrapper.
- `npm ci` warns about peer ranges after removal: the four removed packages are leaves; a peer warning naming one of them means a package still depends on it, which contradicts the audit; stop and record it in `deferred` rather than reinstalling.
- Run twice: uninstalling an absent package is a no-op; predicates are idempotent.

## Executed runtime cleanup addendum

The real Editor browser characterization at the perf-1 baseline emitted a duplicate `underline` warning. `src/lib/tiptapConfig.ts:5,46` adds Underline explicitly while installed `@tiptap/starter-kit/src/starter-kit.ts:263-264` already includes it. Both Editor and ReadOnlyEditor use this shared configuration. The independently executed `underline-registration-proof.mjs` in the plan directory resolves actual packages/source from the current checkout, transpiles in memory and instantiates actual headless Tiptap editors with JSON content. Its recorded baseline is two underline registrations and one duplicate warning in both editable modes. Removing only the explicit top-level registration in the diagnostic harness yields one registration, no duplicate warning, preserved text/underline JSON, and working toggle-off/toggle-on commands. See `underline-registration-proof.md`.

Run `node .factory/plans/20260904-code-quality-sweep/underline-registration-proof.mjs` before and after the two deletions, preserving output in ticket evidence. Afterward the current configuration itself must have one underline extension, no duplicate warning, and pass the command/JSON checks. Also run the existing `Editor.component.test.ts` suite from perf-1 and record absence of the baseline duplicate-underline warning. No new permanent source test, export or wrapper is needed for this reversible two-line removal. Direct `@tiptap/extension-underline` dependency stays, consistent with the transitively pinned Tiptap inventory. This adds one implementation file (11 total), keeps six criteria and one refactor verification set. The explicit perf-1 dependency supplies the real editor browser characterization before slop-2 begins.

## QA output for this run

The configured QA tool allowlist permits the verification commands but denies Edit/Write to audit files. The factory engine itself persists the QA structured summary and checks as `.audit/<ticket>/qa-<loop>.md` (engine.mjs, QA stage). Return the complete truthful QA report through those structured fields; the engine-written file is the canonical QA output for this run. The orchestrator links it from root evidence after merge. Do not spend retries attempting manual evidence writes or require a human merely to append this report. This changes no runtime verification requirement or tool permission. Actual failures, missing evidence and unverified behavior must still be reported accurately.
