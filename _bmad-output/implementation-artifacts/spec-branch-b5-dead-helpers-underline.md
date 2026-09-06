---
title: Remove unused helper surfaces and duplicate Underline registration
type: refactor
created: 2026-09-05
status: done
review_loop_iteration: 1
baseline_commit: d22e1fa0880512212865d7d60aeb8cfe600dbaa2
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="user authorized audited all-branch integration; parent promotes and dispatches sequentially">

## Intent

**Problem:** Test-only wrappers and retired grouping/filter helpers obscure the current APIs, while explicit Underline registration duplicates the extension supplied by StarterKit.

**Approach:** Remove only unused surfaces, migrate their useful assertions to current public helpers, and verify real editable/read-only editor construction retains underline behavior without duplicate warnings.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping requirements do not replace this authorized workflow. Use only the parent-assigned worker and baseline; preserve prior batches and current main contracts. Capture source identities and meaningful before/after proof. Parent owns final combined gate, independent reviews, commits and shipping. Return changes and receipts for that process.

**Ask First:** Report new live callers or policy conflicts to parent; routine audited migration is authorized.

**Never:** Install, stage, dispatch reviewers, commit, push, merge, edit other worktrees/generated files or native state/ledgers. No backend, policy, publication, dependency/config changes, skipped assertions or discovery exemptions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Project start | Title stored then consumed | One-use handoff and title fidelity | Existing TTL, empty and length handling |
| Stage counts | Aggregate counts, legacy bucket, truncated totals | Same labels/order and qualified total | Preserve server row classification |
| Stage counts trust | Exact versus inconsistent company totals | verifiedStageCounts remains | Preserve fail-honest behavior |
| Underline | Editable and read-only editors with underline JSON | Exactly one extension, preserved roundtrip | Zero duplicate-extension warnings |
| Toggle | Editable selection toggled underline | Mark updates and remains serializable | No editor schema change |

</frozen-after-approval>

## Code Map

Eleven allowed paths:
- `src/lib/workspace/projectIntentHandoff.ts` and `.test.ts`: remove stashProjectIntent/takeProjectIntent wrappers; retain stashProjectStart/takeProjectStart storage semantics.
- `src/routes/project/new/newProjectPrefill.component.test.ts`: exercise actual start title API instead of removed wrappers, retaining prefill behavior.
- `src/lib/workspace/stageRankGroups.ts` and `.test.ts`: remove groupRowsByStageRank/visibleStageGroups and unused structures; keep verifiedStageCounts; preserve shared stage metadata and current consumers.
- `src/lib/dashboard/stageFilter.ts` and `.test.ts`: remove matchesStageFilter/stageFilterKey/countProjectsByStage/stageFilterItems, retain stageFilterItemsFromCounts. Keep tests meaningful with supplied aggregate counts.
- `src/lib/reportSections.ts`: remove extractSections/ReportSections only; preserve live metrics/types.
- `src/lib/tiptapConfig.ts`: remove explicit Underline import/registration only.
- NEW `src/lib/tiptapConfig.test.ts`: ordinary src/node Vitest project already discovers it. Import actual Editor/getEditorExtensions; element:null needs no DOM/config change. Two explicit editable/read-only cases assert exactly1 underline registration, zero duplicate warnings, exact initial/final JSON and editable off/on toggles. Restore spies and destroy editors in finally. Expectations never infer baseline from source.
- `convex/dashboard.test.ts`: add one registered getFacets classification preservation case with actual persisted rows: canonical drafting/on_hold versus conflicting legacy review/final status and a stage-less row. Assert exact buckets/total in an isolated fixture.
- Read-only dashboardStageCounts.test.ts complements global facets with company maintenance/backfill proof. Preserve B13 helper/browser regressions unchanged. No package/backend changes.
- Sources `fb6c6b5d68e761cdab0b02975d9670c230f5e060` and final count-fixture test-title correction `0017ee6259fa2bdc4a23c3c13305273a2eee06de`; `.audit/branch-consolidation/planning/B5.md` and factory-audit auxiliary source manifest identify historical editor proof.

## Tasks & Acceptance

**Execution:**
- [x] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [x] Confirm B2/B13 integration and source hashes; inventory removed-symbol callers. Add the getFacets case before deletion and retain its baseline pass: this proves preservation, not a backend fix.
- [x] Run current relevant helper/component selections and real editor construction control before modifying source. Capture baseline duplicate warning and extension count honestly.
- [x] Remove named surfaces; migrate supplied-count formatting assertions without claiming they classify rows. Assert populated order, legacy/empty cases and every approximate label.
- [x] Migrate handoff wrappers to stashProjectStart({title})/takeProjectStart().title. Keep full transcript payload, second-consume emptiness, editable title and duplicate-prefill precedence. Clear module state with takeProjectStart before stashing, not localStorage alone. Use deterministic unit times; prove TTL-equal admission and TTL+1 rejection.
- [x] Add the maintained Underline suite first; with baseline tiptapConfig unchanged it must fail fixed uniqueness/warning expectations. Remove duplicate registration; identical suite must pass, without dependencies, StarterKit/schema or config changes.
- [x] Strengthen existing formatter cases: total deliberately differs from bucket sum; explicit zero canonical/legacy buckets are omitted; reverse input-key order with delivered/on_hold still produces pipeline order.
- [x] Re-run the same focused cases. In owned audit proof compare full initial Editor JSON to the expected underline document, retain editable off/on toggles, and hash actual tiptapConfig before/after. Demand current rows with zero explicit entries, one registration and zero duplicate warnings in both modes.
- [x] Deliver narrow diff, source manifest, before/after outcomes and retired-case accounting to parent for review and combined verification.

**Acceptance Criteria:**
- Registered getFacets classification passes before/after; formatting tests consume supplied totals without recreating deleted algorithms. Current consumers and B13 tests remain intact.
- Both editor modes contain exactly one underline extension, emit no duplicate warning and preserve underline documents; editable toggling works.
- No dependency, publication, autosave, report mutation or domain behavior changes; B7 owns dependency removal.

## Spec Change Log

- Iteration1: review found source-inferred audit expectations and no maintained registration guard. Add unconditional registered test and explicit audit baseline mode. KEEP all ten-file cleanup, real facet classification, verifiedStageCounts, complete handoff/TTL/prefill, exact editor JSON/toggles, Node24 and B13 preservation. Prior source/spec/receipts are retained in B5; rederived receipts belong in B5-r1.

## Verification

**Commands:**
- Before removal: `node node_modules/vitest/vitest.mjs run src/lib/tiptapConfig.test.ts --expect.requireAssertions` must fail; run unchanged after removal and require pass. Retain exact commands/exits/source hashes.
- `node node_modules/vitest/vitest.mjs run src/lib/workspace/projectIntentHandoff.test.ts src/lib/workspace/stageRankGroups.test.ts src/lib/dashboard/stageFilter.test.ts convex/dashboardStageCounts.test.ts convex/dashboard.test.ts` before and after. The added case name is `getFacets classifies canonical stages independently of legacy status`; retain exact registered-endpoint assertions.
- Run the exact prefill/workspace/Editor component selection in planning/B5.md before/after with canonical component configuration.
- Run owned copy of Underline proof blob `a24d9b656f774417664c97f9d5d440df2e96da04`, strengthened for exact JSON equality and source hashes. Audit baseline mode must be explicit (--baseline); default is strict1/0 regardless of source. The maintained suite has no baseline mode and must fail original duplicates. Actual changed-source rows must show one/zero. In-memory filtered candidate is not post-edit proof. This element:null Editor proof is headless, not mounted ReadOnlyEditor/browser evidence.
- `git diff --check`; parent owns fresh independent review and final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`.

Drafting runs no tests. No cached pass substitutes for actual before/after evidence.

Worker evidence: retain actual commands, exit codes, source identities and limits under `.audit/branch-consolidation/B5-r1/`, with `evidence.md` for parent review. Parent owns fresh review layers, final admission and shipping.

## Suggested Review Order

- Use the single Underline provider already supplied by StarterKit.
  [tiptapConfig.ts:21](../../src/lib/tiptapConfig.ts#L21)

- Retain count trust while removing callerless grouping algorithms.
  [stageRankGroups.ts:9](../../src/lib/workspace/stageRankGroups.ts#L9)

- Require one registration and unchanged formatting in both editor modes.
  [tiptapConfig.test.ts:17](../../src/lib/tiptapConfig.test.ts#L17)

- Preserve actual canonical versus legacy endpoint classification.
  [dashboard.test.ts:378](../../convex/dashboard.test.ts#L378)

- Test supplied totals and presentation order independently of classification.
  [stageFilter.test.ts:9](../../src/lib/dashboard/stageFilter.test.ts#L9)

Both review rounds and gate artifact disposition are retained in B5/B5-r1. No sprint story key is present, so sprint synchronization is a no-op.
