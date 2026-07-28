# PSOS-13 — Assignment composer + "Send for internal review" shortcut

## Work control

- **Status:** `not_started`
- **Phase:** P3
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Not started.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [ ] Re-read this ticket, its dependencies, and linked existing BNH work.
- [ ] Inspect the current implementation and record affected files before editing.
- [ ] Confirm unresolved decisions and assumptions; document any approved waiver.
- [ ] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [ ] Complete backend/schema/domain work in scope.
- [ ] Complete frontend/UX work in scope.
- [ ] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [ ] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [ ] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [ ] Work through every acceptance criterion below individually and attach evidence in the work log.
- [ ] Add or update unit, integration, and regression coverage required by this ticket.
- [ ] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

### 4. Validate and close

- [ ] Run targeted tests for the changed area.
- [ ] Run `npm run check`.
- [ ] Run the Convex TypeScript check.
- [ ] Run `npm run test`.
- [ ] Run `npm run build`.
- [ ] Run formatting/lint commands if present and `git diff --check`.
- [ ] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [ ] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

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
- [ ] Shortcut creates correct defaults in one click + confirm.
- [ ] Composer validates assignee/kind presence; due date optional but encouraged.
- [ ] BLOCKING_EXISTS error offers reassign path in-dialog.
- [ ] Stage-change offer only when transition valid; declining offer still creates item.
- [ ] Component tests: defaults, error path, keyboard flow.
**Dependencies**: PSOS-12; PSOS-09 for stage nudge. **Rollout**: additive.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| — | — | — | — |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |

## Completion record

- **Pull request/commit:** —
- **Deployment:** —
- **Follow-up tickets:** —
- **Known limitations accepted at closure:** —
