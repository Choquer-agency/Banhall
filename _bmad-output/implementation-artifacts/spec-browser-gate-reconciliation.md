---
title: 'Reconcile workspace browser coverage with approved UI behavior'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_commit: '717c75897cc04256c008a2ed42747df66f6fc6b5'
review_loop_iteration: 0
context:
  - '{project-root}/docs/svelte-migration.md'
---

<frozen-after-approval reason="human-owned intent; existing authorization covers failed browser test repair">

## Intent

**Problem:** The integrated browser gate has eight failures across five suites. Existing assertions and fixtures predate deliberate workspace navigation, account, and shared-button changes, preventing the broader BMAD completion gate from establishing trustworthy regression coverage.

**Approach:** Reproduce the five suites at the recorded baseline and reconcile them against product-domain amendments and exact introducing commits. Preserve approved application behavior while repairing stale fixtures/assertions and strengthening their corresponding behavior checks. Fix production code only if a reproducible violation of the approved contract emerges.

## Boundaries & Constraints

**Always:** Work only in Banhall-bmad-browser-fix on codex/bmad-browser-fix. Preserve existing accessibility and authorization coverage, shared design tokens, Svelte conventions, and the real Chromium runner. Record evidence for every revised expectation. The root agent owns integration, all native BMAD runs, final type/unit gates, and review orchestration.

**Ask First:** A genuine ambiguity in product policy or a production behavior change not already covered by the approved contract requires escalation to the root agent while independent work continues.

**Never:** Revert intentional UI improvements to appease old assertions; remove tests or weaken assertions to existence-only checks; modify Convex, native runs, ledgers, sprint state, integration files, or remote refs. Do not run full unit/type gates. No push or merge.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Canonical navigation | Flagged Projects route, explicit layout and unknown params | Home preserves params; Projects preserves explicit choices and adds missing client grouping | No redirect while preview renders |
| Admin exposure | Admin with developer or workspace Owner flag | Eight distinct destinations; desktop starts expanded, drawer compact; disclosure remains keyboard accessible | Role-only admin and flagged non-admin do not gain admin navigation |
| Rail footer | Mobile drawer open, Sign out invoked | Confirmation above drawer, 44px controls, cancellation returns focus without signing out | Escape retains drawer access |
| Shared controls | Anchor/button and header creation action | Theme tokens and anchor/button parity; explicit color/opacity transition, reduced motion; compact 32px header button | Disabled button stays disabled; links retain canonical href |
| Rail motion | Drawer/desktop navigation | 150ms color-only transition and reduced-motion escape; touch drawer rows retain 44px minimum | Existing unavailable-Home prevention remains covered |

</frozen-after-approval>

## Code Map

- `src/routes/workspaceRoutes.component.test.ts`: stale Projects href expects no default group. `WorkspaceDashboard.svelte:viewHref` adds missing layout=list/group=client while retaining explicit values; introduced by `0b094ed4f5500f3401164cdbe0449bbc996bc951`.
- `src/lib/components/workspace/WorkspaceRail.component.test.ts`: role-only fixtures no longer expose admin navigation. `docs/product-domain.md:1259` requires admin AND developer/Owner. Eight links include House rules in `66f131b00482af027bc83b9786d85d9050a6dec4`.
- `src/lib/components/workspace/WorkspaceRail.svelte:rowBase`: 150ms color transitions intentionally introduced by `c7167fb59d3eb46b7a21aafbad6a292ed25ea0df`. Older blanket 300ms design prose is superseded for these controls by this exact source history.
- `src/lib/components/workspace/WorkspaceChrome.component.test.ts`: obsolete Settings popup was replaced by independent Settings link and Sign out confirmation in `UserMenu.svelte`, commit `66f131b00482af027bc83b9786d85d9050a6dec4`. Preserve real portal layering and drawer focus coverage using current confirmation.
- `src/lib/components/ui/Button.component.test.ts`: `113ef7c77479552d0b254110ff05bf7c5f1a2cb6` deliberately transitions opacity plus colors over 200ms, with reduced-motion fallback. Assert browser computed style rather than obsolete transition-colors token.
- `src/lib/components/workspace/WorkspaceHeader.component.test.ts`: `d0f659e654d0571ba1d8e00ca97402fd8c23c099` introduced shared xs size, h-8, for 49px toolbars. Retain primary token assertions and validate actual geometry/name.
- `.audit/browser-gate-repair/before.log`: focused baseline output. Run starts after `npx svelte-kit sync`; initial missing generated tsconfig caused optimizer startup failure, not a test result.
- `vitest.component.config.ts`: serial Chromium runner with faithful route/auth stubs. Do not add sveltekit plugin or alter suite discovery.

## Tasks & Acceptance

**Execution:**
- [x] `src/routes/workspaceRoutes.component.test.ts`: reconcile URL defaults and preserve explicit/unknown query values.
- [x] `src/lib/components/workspace/WorkspaceRail.component.test.ts`: correct authorized fixtures, check exact eight destinations and positive/negative exposure cases, retain disclosure/touch/motion coverage.
- [x] `src/lib/components/workspace/WorkspaceChrome.component.test.ts`: exercise real sign-out confirmation layering, touch controls, cancellation, and focus restoration.
- [x] `src/lib/components/ui/Button.component.test.ts` and `src/lib/components/workspace/WorkspaceHeader.component.test.ts`: reconcile transition and compact-size assertions with computed geometry/style and existing tokens.
- [x] `.audit/browser-gate-repair/evidence.md`: retain baseline failures, focused pass and full component outcome with exact commands. Report unverified claims candidly.

**Acceptance Criteria:**
- Given baseline tests, when the five suites run, then all eight known failures reproduce before edits.
- Given repaired suites, when focused Chromium runs, then all matrix behaviors pass without skipped tests.
- Given the candidate, when the full component suite runs once, then every component passes or remaining failures are reported with raw evidence and resolved before completion.
- Given a test-only repair, when the diff is inspected, then production behavior remains unchanged; any necessary production change requires real before/after screenshots and review.

## Spec Change Log

## Verification

**Commands:**
- `npm run test:component -- src/routes/workspaceRoutes.component.test.ts src/lib/components/ui/Button.component.test.ts src/lib/components/workspace/WorkspaceChrome.component.test.ts src/lib/components/workspace/WorkspaceHeader.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts`: record red baseline and green focused result.
- `npm run test:component`: one full candidate browser gate after focused pass.

Root conducts three independent step-04 reviewers after handoff. Candidate remains in-review until that process completes; this repair does not mark the broader task done.

## Review and completion evidence

Three independent Astra medium reviewers completed BMAD step04. All ten bounded patch findings were addressed. Final focused Chromium60/60, full Chromium311/311 across52suites, and local Svelte check0errors/0warnings passed at code5a3aad0f109749d3257e16424e0cc51ee3d8855e. Production files are unchanged. Evidence and raw logs are in `.audit/browser-gate-repair/`. `story_key` is unset, so sprint synchronization is correctly skipped. Root still owns full integration, native recovery, and shipping.

## Suggested Review Order

**Account boundaries and interaction**

- Prove modal focus, hit-testing, cancellation, pointer sizing, and confirmed sign-out.
  [WorkspaceChrome.component.test.ts:73](../../src/lib/components/workspace/WorkspaceChrome.component.test.ts#L73)

**Navigation and access**

- Pin eight destinations and test the complete admin presentation boundary.
  [WorkspaceRail.component.test.ts:32](../../src/lib/components/workspace/WorkspaceRail.component.test.ts#L32)

- Preserve explicit defaults, repeated parameters, and encoded values across canonical navigation.
  [workspaceRoutes.component.test.ts:39](../../src/routes/workspaceRoutes.component.test.ts#L39)

**Shared visual behavior**

- Verify actual transitions, reduced motion, and disabled behavior.
  [Button.component.test.ts:52](../../src/lib/components/ui/Button.component.test.ts#L52)

- Preserve the approved compact creation control across viewport sizes.
  [WorkspaceHeader.component.test.ts:157](../../src/lib/components/workspace/WorkspaceHeader.component.test.ts#L157)
