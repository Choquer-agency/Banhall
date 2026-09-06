---
title: Delete proven abandoned UI islands while preserving current views
type: refactor
created: 2026-09-05
status: done
review_loop_iteration: 0
baseline_commit: d11195e5fdf6fb40baf27cacff86eaad6bf69ef6
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="user authorized audited all-branch integration; parent promotes and dispatches sequentially">

## Intent

**Problem:** Seventeen abandoned presentation/helper files remain despite current implementations replacing their callers. Their obsolete tests and imports obscure the live application.

**Approach:** Revalidate the closed reference set at dispatch, then remove only those files. Prove retained neighboring views behave identically; defer documentation cleanup to B9.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping requirements do not replace this authorized workflow. Use the assigned checkout/baseline; preserve prior batches/main. Capture before/after proof. Parent owns reviews, final gate and shipping.

**Ask First:** Report a newly discovered live caller or policy conflict to the parent before extending scope. Routine implementation is already authorized.

**Never:** No worker staging, reviews, commits, remotes, installs, other-worktree changes, loop/native-state changes or generated-file edits. No product permission, publication or domain changes. No test skips, weakened assertions, canonical configuration changes or broad discovery exclusions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Reference discovery | Static imports, barrels and dynamic imports | Only deleted island members reference removed symbols | Stop deletion if a live caller exists |
| My Work | Current tabs and assigned-only Home; retired sort controls absent | Four retained My Work component suites and HomeParity pass unchanged | Preserve current empty/error handling |
| Reports/editor compatibility | Current and Preview route loading/cohort wiring, actual Editor rendering/replacement/decorations, generation recovery | projectRoute, Editor and GenerationRecoveryPanel component suites pass unchanged; static isolation preserves current comment implementation | Preserve recovery paths; these suites do not prove comment add/resolve interactions |
| Test discovery | Seventeen explicit removals | Removed tests accounted; retained files discovered | Genuine orphan remains a gate failure |

</frozen-after-approval>

## Code Map

Exact deletion allowlist:
- `src/lib/components/comments/CommentHighlight.ts`, `CommentSidebar.svelte`, `CommentThread.svelte`: abandoned comments island, not current comments.
- `src/lib/components/editor/GapCallout.svelte`, `SectionDivider.svelte`: unused editor presentation.
- `src/lib/components/generation/ReportViewer.svelte`: unused viewer; current recovery remains.
- `src/lib/components/mywork/MyWorkGroup.svelte`, `MyWorkRow.svelte`, `MyWorkRow.component.test.ts`, `MyWorkRowFixture.svelte`: retired presentation and its own test fixture.
- `src/lib/components/ui/Header.svelte`, `InsightTile.svelte`, `MenuToggleIcon.svelte`: obsolete UI islands.
- `src/lib/mywork/laneSort.ts`, `laneSort.test.ts`, `myWorkPreferences.ts`, `myWorkPreferences.test.ts`: retired helper contracts only.
- Read-only current neighbors: the 15 component suites and two unit suites explicitly selected below, including current Editor, MyWorkLaneSort, HomeParity, project route and GenerationRecoveryPanel. Keep these files and assertions.
- Read-only provenance: `ae27b5c6c5597d214d045b4792a102f352d62dec` and `28c0c0cca253b57f1171b632046f58d0a5c825a0`; precise planning in `.audit/branch-consolidation/planning/B4.md`. Main inspection matched deletion parents; recheck after earlier batches.

## Tasks & Acceptance

**Execution:**
- [x] Record dispatched baseline, seventeen file hashes and current reference inventory, including dynamic/barrel references and directly stale documentation references.
- [x] Execute the retained neighbor selections before deletion; retain commands, outputs, exits and case names.
- [x] Delete exactly the allowlist. Do not restore old five-lane or sort-control UI, replace current components, or alter tests outside the deleted island.
- [x] Execute the identical retained selections afterward and compare runtime outcomes. Record which deleted suites/cases explain count changes.
- [x] Inspect exact diff and discovery membership, deliver source manifest and receipts to parent for review and combined gate.

**Acceptance Criteria:**
- No current production import resolves through any removed file.
- Identical retained real component suites pass before and after; current Home, project route/editor compatibility and recovery behavior remains covered within the limits below.
- Every deletion is explicitly authorized and all other tracked source bytes remain unchanged. Lower test counts are transparently mapped to retired implementations.

## Spec Change Log

- 2026-09-05: Parent-requested preflight correction in this audit draft: explicit identical retained selections and honest Reports/editor coverage limits. The earlier correction was mistakenly applied only to planning/B4.md; see planning/B4-draft-correction-provenance.json. Canonical SPEC is unchanged.

## Verification

**Commands:** Run these exact retained selections before and after deletion:

```sh
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts 'src/routes/project/[id]/projectRoute.component.test.ts' src/lib/components/editor/Editor.component.test.ts src/lib/components/generation/GenerationRecoveryPanel.component.test.ts src/lib/components/ui/PageBar.component.test.ts src/lib/components/ui/Disclosure.component.test.ts src/lib/components/ui/StageBadge.component.test.ts src/lib/components/ui/ViewModeToggle.component.test.ts src/lib/components/ui/SelectInput.component.test.ts src/lib/components/ui/Input.component.test.ts src/lib/components/ui/UserMenu.component.test.ts
node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/mywork/MyWorkLaneSort.component.test.ts src/lib/components/mywork/MyWorkHome.component.test.ts src/lib/components/mywork/HomeStartProject.component.test.ts src/lib/components/mywork/CurrentWorkLedgerFixture.component.test.ts src/lib/components/workspace/HomeParity.component.test.ts
node node_modules/vitest/vitest.mjs run src/lib/mywork/homeGreeting.test.ts src/lib/mywork/relativeTime.test.ts
```

The selection is 15 retained component suite files and two retained unit suite files. It excludes MyWorkRow.component.test.ts, laneSort.test.ts and myWorkPreferences.test.ts on both sides. Their static case counts are 3, 9 and 4 respectively; capture actual runtime case identities separately. Do not use directory selectors as an identical retained-suite comparison.

Run `git diff --check`; parent runs staged canonical discovery and `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on final combined source. Preserve current Editor tests and assertions from the dispatched baseline; prior editor batches are accepted and stable before this sequential dispatch.

**Coverage limits:** Existing component inventory contains no direct CommentOverlay/CommentInput add/resolve interaction suite. The retained Editor suite executes real editor rendering, replacement and decoration behavior; projectRoute principally checks loading/cohort wiring and imports. Combine those executable compatibility tests with the no-caller/static-isolation proof for the abandoned comments files. Do not claim full comment lifecycle testing.

Drafting ran no tests. Missing prerequisites go to parent; do not borrow another runtime.

Worker evidence: retain actual commands, exit codes, source identities and limits under `.audit/branch-consolidation/B4/`, with `evidence.md` for parent review. Parent owns fresh review layers, final admission and shipping.

## Suggested Review Order

- Review the exact deletion identities before inspecting removed source.
  [source-manifest.json:1](../../.audit/branch-consolidation/B4/source-manifest.json#L1)

- Confirm all resolved references stay inside the retired islands.
  [resolved-reference-inventory.json:1](../../.audit/branch-consolidation/B4/resolved-reference-inventory.json#L1)

- Compare preserved behavior, retired contracts and runtime limitations.
  [review-evidence-addendum.md:1](../../.audit/branch-consolidation/B4/review-evidence-addendum.md#L1)

- Inspect identical retained cases and the complete Node24 gate.
  [result.json:1](../../.audit/branch-consolidation/B4/gate-node24/result.json#L1)

Deleted code is identified by baseline hashes in the source manifest; links target retained evidence. No sprint story key is present, so sprint synchronization is a no-op.
