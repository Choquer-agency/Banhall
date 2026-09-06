---
title: 'Q6: Restore Settings navigation in the avatar menu'
type: 'bugfix'
created: '2026-09-05'
status: done
baseline_commit: bea7e2d218ea06743f94b2c5fd5e1755e5fd98e8
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
  - '/Users/johnnynguyen/.agents/skills/typescript-best-practices/SKILL.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Legacy AppNav pages still mount an avatar account menu, but that menu contains identity and sign-out only. The all-role Settings capability lacks its expected account-menu entry on those pages.

**Approach:** Add an avatar-only Settings menu action that navigates through the existing SvelteKit routing convention. Preserve the newer rail's persistent Settings link and separate confirmed sign-out action.

## Boundaries & Constraints

**Always:** Work only in `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass`. Make the avatar Settings entry available to existing authenticated writer, manager and admin roles without adding permission logic. Reuse bits-ui dropdown primitives and current spacing/type/color roles, with new weight at most 500. Preserve identity, avatar sign-out behavior, rail confirmation/focus behavior and all-role Flag issue. Record evidence under `.audit/quality-pass/Q6/`.

**Ask First:** Authentication, settings-route access changes or rail redesign require root escalation; ordinary navigation implementation and tests are authorized.

**Never:** Restore the obsolete rail dropdown, restrict Flag issue by role, modify layout.css or WorkspaceRail behavior, copy whole Cownose menu/tests, edit other checkouts, commit, stage, push, install, or change ledgers. Root owns independent three-lens review and final full gate. Do not attempt nested reviewer fan-out from the ephemeral implementation session.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Avatar pointer | Authenticated role opens menu and selects Settings | Exactly one Settings action; goto resolved `/settings`; menu closes | Existing navigation behavior |
| Avatar keyboard | Focus trigger, open menu, activate Settings using keyboard | Same navigation and accessible menu behavior | No click-only handler |
| Rail | triggerVariant rail | Sign-out dialog still opens; cancel restores focus | No avatar Settings menu inserted |
| Identity/sign-out | Avatar menu before/after change | Identity and existing sign-out remain reachable | Existing signingOut disable state |

</frozen-after-approval>

## Code Map

- `src/lib/components/ui/UserMenu.svelte:151` avatar dropdown branch; line 180 identity section followed by sign-out item is narrow insertion seam. Rail branch at line 81 must remain intact.
- `src/lib/components/ui/UserMenu.component.test.ts` current two tests cover confirmed rail sign-out and avatar identity; extend rather than replace.
- `src/lib/components/ui/AppNav.svelte:90` renders NavActions, whose `NavActions.svelte:103` renders avatar UserMenu. `CurrentProjectPage.svelte:948`, questionnaire and financial pages remain real AppNav consumers.
- `src/lib/components/workspace/WorkspaceRail.svelte:349` persistent Settings link and rail UserMenu at 364 establish behavior to preserve.
- `src/lib/test/app-navigation-stub.ts` exports `__navigationCalls`, `__resetNavigation`; goto also updates reactive URL. Use these to assert actual component navigation boundary after interaction.
- `src/routes/settings/+page.ts` and `src/routes/settings/+layout.svelte` are read-only route destination evidence; use SvelteKit resolve/goto convention already used in project, without changing routes.
- `docs/product-domain.md:539` defines all-role Settings; line 1264 defines all-user Flag issue.

## Tasks & Acceptance

**Execution:**
- [x] `UserMenu.component.test.ts` — add parameterized writer/manager/admin real-menu test, fail on baseline missing Settings, and record output before production edits.
- [x] `UserMenu.svelte` — add avatar-only Settings action with existing menu styling and SvelteKit routing; no changes in rail branch.
- [x] `UserMenu.component.test.ts` — select actual menu item by pointer and keyboard, assert recorded destination/menu closure, preserve identity and confirmed rail cancel/focus behavior. Do not settle for body-text presence.
- [x] `.audit/quality-pass/Q6/` — save before/after avatar screenshots, baseline failure/new pass, evidence.md with role/input matrix, with root-owned canonical decision logging.

**Acceptance Criteria:**
- Given any existing internal role, when Settings is activated from the actual avatar menu, then the component requests the correct resolved settings route exactly once.
- Given rail mode, when sign-out is opened then cancelled, then no sign-out occurs and focus returns to its trigger; current persistent Settings/all-role flag coverage remains green.

## Spec Change Log

## Verification

**Commands:**
- Root has completed the full browser baseline before component work: Q4/verification-result.json records the full2044-unit/499-browser gate. Q4 test-only review patches pass11focused; Q5 two-line table key repair passes7focused (Q5/root-review-checks.json). Unaffected source/config/dependency bytes are checked in Q5/root-broad-baseline-check.json. Verify that evidence, then run this unit's actual component regression against unchanged production source before editing it; rerun full baseline only if new evidence invalidates it.
- `npm run test:component -- src/lib/components/ui/UserMenu.component.test.ts src/lib/components/workspace/WorkspaceRail.component.test.ts` — baseline missing entry fails, repaired navigation and unchanged rail tests pass.
- `npm run check` — Svelte/TypeScript checks pass.
- `git diff --check` — clean diff; root owns final full gate and independent review.

## Suggested Review Order

- Review the avatar Settings action and rejection feedback.
  [UserMenu.svelte:182](../../src/lib/components/ui/UserMenu.svelte#L182)

- Verify real-menu navigation, keyboard behavior and pending sign-out.
  [UserMenu.component.test.ts:143](../../src/lib/components/ui/UserMenu.component.test.ts#L143)
