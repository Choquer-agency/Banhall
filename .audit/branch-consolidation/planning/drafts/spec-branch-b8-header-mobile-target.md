---
title: Restore the mobile New project target without changing desktop geometry
type: bugfix
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized integration; parent owns dispatch">

## Intent

**Problem:** WorkspaceHeader's compact New project action applies its desktop height at mobile widths, below the approved 44px touch-target floor.

**Approach:** Apply local mobile minimum dimensions with responsive resets, preserving the existing shared Button and desktop toolbar geometry. Pin actual control bounds before and after.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping requirements do not replace this authorized workflow. Work at the parent-assigned baseline, preserving current main and preceding batches. Change only WorkspaceHeader.svelte, its component test and bounded Button/WorkspaceRail proof additions. Preserve theme classes, href, far-right placement, focus behavior and desktop 32px height. Follow existing approved mobile target policy without introducing a new breakpoint contract.

**Ask First:** Escalate any required navigation, shared Button, token or breakpoint-policy change to the parent. Repair is authorized.

**Never:** The worker must not stage, launch reviewers, commit, push, merge, edit another worktree, or mutate native state/ledgers. Do not change global controls, dependencies, backend, role/publication behavior or browser instance routing. Do not transplant the historical whole test, weaken geometry assertions, emulate pointer state, introduce fixed sleeps or overwrite historic captures. No worker staging, reviews, commits, remotes or ledger mutations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Mobile | 390px viewport, action present | Link itself has width and height at least 44px | Fail actual geometry assertion |
| Desktop | 1440px viewport | Preserve 32px height and compact width behavior | No global enlargement |
| Hidden action | Existing showNewProject=false | No duplicate creation action | Existing behavior |
| Navigation | Visible action | Existing /project/new href and placement | No route changes |
| Appearance | Theme/focus/reduced motion | Existing semantic classes and focus behavior | Preserve current tests |
| Integration | Ordinary suite plus pointer contexts | Header executes once in ordinary Chromium | No instance duplication |

</frozen-after-approval>

## Code Map

- `src/lib/components/workspace/WorkspaceHeader.svelte`: New project Button around the audited size=xs declaration. Add local min-h-11/min-w-11 and sm:min-h-0/sm:min-w-0; preserve other props/classes.
- `src/lib/components/workspace/WorkspaceHeader.component.test.ts`: current 390/1440 geometry case incorrectly expects 32px at both widths. Adapt only responsive geometry expectations and preserve all newer assertions.
- `src/lib/components/ui/Button.component.test.ts`: add source `4cc4a85fa06cfedcc460dc5527e815ca539b708e` anchor-height regression for explicit min-h-11; retain all current motion/theme/reduced-motion cases.
- `src/lib/components/workspace/WorkspaceRail.component.test.ts`: port the two actual Home-to-Projects-to-Admin DOM-order assertions and the all-destination SVG presence check, including current Learning health, from `e581436f28c104b3159ab03be3418be228b188cd`; preserve current admin/learning URLs, role/keyboard and appearance cases.
- Read-only provenance: `d7036f7551f1438c64fea5330dc77327ab7c99eb`; detailed audit `.audit/branch-consolidation/planning/B8.md`. Current main's header matched the historical pre-change component during planning; recheck at dispatch.

## Tasks & Acceptance

**Execution:**
- [ ] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [ ] Confirm baseline/ownership and capture intended file hashes plus protected Button implementation, styles and browser configuration.
- [ ] Correct mobile/desktop geometry expectations first with component unchanged; execute actual browser tests and retain genuine mobile failure, command and exit.
- [ ] Add only local responsive minimum dimensions. Include the actual shared Button anchor assertion: explicit min-h-11 yields height >=44. Measure controls, not wrappers.
- [ ] Rerun the same browser case and shared Button suite; retain actual mobile/desktop bounds and final source hashes.
- [ ] Preserve href/theme/ml-auto/focus assertions, omission cases and all unrelated header coverage. Use actual layout readiness if needed, never sleep-based settling.
- [ ] Recover both Home→Projects and Projects→Admin-container ordering assertions with connected, non-null nodes. While expanded, assert the exact nine ADMIN_DESTINATIONS links then one `[data-admin-icon-tone] svg` per anchor, including Learning health; no vacuous every on an empty list. Preserve CORE_TOKENS/motion/keyboard coverage.
- [ ] Hand diff/evidence to parent for independent BMAD review, fixes, gate and integration.

**Acceptance Criteria:**
- Given the unchanged baseline component, corrected mobile assertions fail; with the narrow patch, the same assertions pass and desktop remains 32px.
- Given the final diff, no shared Button/token or pointer suite/configuration bytes change.
- Given canonical component discovery, the header retains one ordinary execution and existing fine/coarse controls remain independent.

## Spec Change Log

## Design Notes

Parent additionally authorized the `4cc4a85fa06cfedcc460dc5527e815ca539b708e` anchor-height pin; shared Button implementation stays untouched. Historical receipts measured roughly 41x32 becoming 44x44 at mobile and unchanged 121.67x32 desktop. They explain the defect but do not count as new results or mandate a fixed desktop width. Assert the approved mobile floor and existing desktop height, allowing text width to remain intrinsic. Any new before/after images belong to owned audit space with source hashes; restore only generated historical screenshot outputs.

## Verification

**Commands:** The three affected suites execute once in ordinary Chromium; parent gate retains separate fine/coarse pointer proof.
- Before source edit and after: `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts`.
- Parent coordinates `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` and `git diff --check` on final reviewed source; no whole-suite retries or exemption changes.

Retain actual bounds, hashes/commands/exits. Drafting ran no checks; parent owns approval/review/gate/ship.

Worker evidence: retain actual commands, exit codes, source identities and limits under `.audit/branch-consolidation/B8/`, with `evidence.md` for parent review. Parent owns fresh review layers, final admission and shipping.
