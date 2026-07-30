# PSOS-13 — Assignment composer + "Send for internal review" shortcut

## Work control

- **Status:** `done`
- **Phase:** P3
- **Current owner:** Main coding agent
- **Started:** 2026-07-29
- **Completed:** 2026-07-29
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete on the development deployment. The project workflow disclosure now provides assignment composition, atomic internal-review handoff + optional Stage change, truthful With/Due/open-work metadata, BLOCKING_EXISTS recovery, and existing-item reassign/cancel actions after multiple Opus/Codex review rounds.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

### 4. Validate and close

- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P1.
**Problem**: Assigning the next action must be one obvious, fast flow — especially the
dominant case: sending a draft for internal review.
**Context**: UI on project header/page (`src/routes/project/[id]`) and dashboard rows;
roster from `convex/users.ts`; supersedes BNH-40's "Send for Review" card action.
**In scope**: Composer dialog: Assignee (roster picker with search), Work type (kind),
Due date, Instructions (plain textarea), Blocking handoff toggle (default per kind);
"Send for internal review" one-click shortcut: kind=internal_review, blocking=true,
stage nudge → offers `internal_review` stage transition (user confirms; server
validates), due date default (+2 business days, configurable const); reassign and
cancel affordances on existing items.
**Out of scope**: Templates (Phase 8), email (PSOS-17).
**UX**: Shortcut visible on project header when stage ∈ {drafting, revisions};
composer keyboard-first (focus trap, Enter submits, Esc cancels); blocked-invariant
error rendered as guidance ("This project already has a handoff with Sidney — reassign
it instead?") with direct action; ≥44px targets; works as bottom sheet on mobile.
**Acceptance criteria**:
- [x] Shortcut creates correct defaults in one click + confirm.
- [x] Composer validates assignee/kind presence; due date optional but encouraged.
- [x] BLOCKING_EXISTS error offers reassign path in-dialog.
- [x] Stage-change offer only when transition valid; declining offer still creates item.
- [x] Component tests: defaults, error path, keyboard flow.
**Dependencies**: PSOS-12; PSOS-09 for stage nudge. **Rollout**: additive.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-29 | Preserve the compact PageBar workflow disclosure and add assignment actions inside that existing project-scoped control rather than creating a permanent row. | Avoids reversing the approved PSOS-10 disclosure redesign or adding persistent chrome. | Existing design-system contract |
| 2026-07-29 | Treat PSOS-13 as a narrow extension of the incumbent ledger-paper Operate UI; no replacement visual world or unrelated page redesign. | The project workspace is established and the ticket adds a focused operational flow. | Existing design system |
| 2026-07-29 | When the user confirms “Also move to Internal review,” creation of the blocking review item, current-handoff pointer, Stage change, and both audit events must occur in one Convex transaction with one workflow-version increment. Declining the Stage option creates only the item. | Prevents partial “sent for review” state and ambiguous browser-coordinated retries. | Product owner |
| 2026-07-29 | Work-item due dates use the `America/Vancouver` firm timezone. Business days mean Monday–Friday; statutory holidays remain out of scope. | Keeps due dates, +2-business-day defaults, DST behavior, and overdue labels consistent across viewers. | Product owner |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-29 | Activated after PSOS-12 closure and reviewed the Svelte migration guide, design system, project PageBar workflow disclosure, workflow dialogs, roster APIs, and work-item lifecycle APIs. | Dependencies PSOS-12 and PSOS-09 are complete. |
| 2026-07-29 | Opus 5 planning and Codex audit completed; product approved atomic confirmed Stage changes and `America/Vancouver` due-date semantics. | The shortcut uses one transaction when Stage change is confirmed and remains truthful when declined. |
| 2026-07-29 | Added project work-panel and eligible-assignee projections, atomic shortcut support, Vancouver business-day helpers, composer/reassign/cancel sheets, and With/Due/open-work disclosure content. | Assignment actions stay inside the compact PageBar disclosure; no persistent row or PSOS-14 dashboard scope was added. |
| 2026-07-29 | Opus/Codex adversarial reviews found and drove fixes for query lifetime, OCC snapshot/replay, pointer truncation, false loading/error facts, conflict copy, search keyboard traps, busy dismissal, stale recovery, and timezone display. | Final Opus verdict **SHIP**; Codex focused verdict **SHIP**. |
| 2026-07-29 | Final validation and development deployment completed. | 479/479 unit/integration tests, 71/71 browser-component tests, Svelte check 0/0, Convex TypeScript clean, build successful, `git diff --check` clean, detector `[]`; Chrome responsive disclosure smoke at 1440/768/375/320 had no overflow or console errors. |

## Completion record

- **Pull request/commit:** Not committed yet; awaiting explicit release instruction.
- **Deployment:** Development Convex deployment `energized-salamander-237`; production untouched.
- **Follow-up tickets:** PSOS-14 My Work lanes; PSOS-16 notifications; PSOS-36 templates/automation.
- **Known limitations accepted at closure:** Assignee candidates are a bounded 200-user roster with a truncation notice. Statutory-holiday calendars are out of scope; business days mean Monday–Friday in `America/Vancouver`. The work disclosure projects at most 50 open items and prioritizes the current handoff; PSOS-14 owns larger paginated personal/project work views.
