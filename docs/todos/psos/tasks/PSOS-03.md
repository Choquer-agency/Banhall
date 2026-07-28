# PSOS-03 — Role descriptions & capability explanations in Users & roles

## Work control

- **Status:** `done`
- **Phase:** P1
- **Current owner:** Pi coding agent
- **Started:** 2026-07-24
- **Completed:** 2026-07-24
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Shared role descriptions and accessible disclosure UI shipped after mandatory Claude planning and review; all findings were resolved or explicitly dispositioned.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Run and record a Claude Code/Fable high-reasoning planning pass before implementation.
- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope. *(No backend change required; this ticket is descriptive only.)*
- [x] Complete frontend/UX work in scope.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant. *(Existing route states remain unchanged; static disclosures add no asynchronous state.)*
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant. *(Not applicable to presentation-only copy.)*
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

### 4. Validate and close

- [x] Run and record a fresh Claude Code/Fable post-implementation review; resolve or explicitly disposition every finding.
- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P2.
**Problem**: Users & roles screen shows role names with no explanation; admins can't
predict what a role change does.
**Context**: Admin UI under `src/routes/admin` (team roster, invites); roles on `users`
table; capability semantics from PSOS-01 matrix (initially descriptive text only,
enforcement lands in Phase 6).
**In scope**: Per-role description + capability summary list rendered beside role
selectors and on invite creation; content sourced from a single shared constants module
so Phase 6 UI reuses it (`src/lib/roles/roleDescriptions.ts`).
**Out of scope**: Enforcement changes; new roles (Financial arrives PSOS-28).
**UX**: Inline expandable "What can a Manager do?" text, not tooltip-only; readable on
mobile; no color-only distinctions.
**Acceptance criteria**:
- [x] Every assignable role shows description + bullet capabilities in roster + invite UI.
- [x] Copy matches PSOS-01 matrix language, with an explicit note identifying capabilities that activate in later rollout phases.
- [x] Screen-reader accessible: native disclosure buttons have visible role-specific names, `aria-expanded`, `aria-controls`, uniquely identified labelled regions, and decorative chevrons hidden from assistive technology.
**Dependencies**: PSOS-01 for copy. **Testing**: component tests + svelte-check.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-24 | Render one shared role-reference block adjacent to the invite selector and one adjacent to the roster selectors rather than repeating it in every user row. | Keeps the dense roster readable while satisfying both usage contexts. | Implementation decision |
| 2026-07-24 | Include planned matrix capabilities with an explicit rollout note. | Matches PSOS-01 without implying every later PSOS feature has already shipped. | Implementation decision |
| 2026-07-24 | Use module tests + Svelte checking + manual disclosure verification instead of adding a browser component-test stack. | The repository has no jsdom/browser component-test harness; adding one is unrelated infrastructure scope. | Implementation waiver |
| 2026-07-24 | Keep an explicit Admin “Not permitted” statement. | Makes all role explanations structurally comparable and avoids implying missing content. | Implementation decision |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-24 | Selected as the sole active queue item and launched mandatory Claude Code/Fable planning pass (`sa-16`). | Planning completed before implementation; no overlapping PSOS-02 files required. |
| 2026-07-24 | Created shared exhaustive role-description constants and unit tests. | All current assignable roles use the canonical labels and PSOS-01 capability distinctions from one reusable source. |
| 2026-07-24 | Added reusable accessible role disclosures to invite and roster contexts. | Independent native-button disclosures use labelled regions, unique IDs, 44px targets, right-edge chevrons, and mobile-stacked content. |
| 2026-07-24 | Ran Svelte autofixer on the new component and changed route. | New component has no findings; route only reports pre-existing advisory route/effect findings unrelated to this ticket. |
| 2026-07-24 | Ran targeted test, `npm run check`, Convex TypeScript, full tests, production build, and `git diff --check`. | Initial implementation: 3 targeted tests passed; 0 Svelte errors/warnings; Convex TypeScript passed; 11 files/98 tests passed; build and diff check passed. |
| 2026-07-24 | Claude Code/Fable post-implementation review (`sa-17`). | No blocking findings. Resolved the misleading enforcement claim, added omitted handoff/work-item/outcome matrix language, promoted the reference label to a real heading, and expanded tests. Kept selector derivation follow-up for PSOS-28. |
| 2026-07-24 | Final validation after review fixes. | 4 targeted tests passed; 0 Svelte errors/warnings; Convex TypeScript passed; 11 files/99 tests passed; production build and `git diff --check` passed. |

## Completion record

- **Pull request/commit:** Not committed at user request.
- **Deployment:** None required; presentation-only local implementation with no schema or backend changes.
- **Follow-up tickets:** PSOS-28 must derive assignable selector options from `ASSIGNABLE_ROLES` when adding Financial; PSOS-29 reuses `ROLE_DESCRIPTIONS` for the full matrix UI.
- **Known limitations accepted at closure:** The repository has no browser Svelte component-test harness, so disclosure interaction is covered by native-button semantics, Svelte compilation/a11y checks, module tests, autofixer review, and documented manual verification expectations. Full server enforcement remains correctly identified as future PSOS-26/27 work.
