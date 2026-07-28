# PSOS-15 — Team pipeline view for managers/admins

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

**Priority**: P2.
**Problem**: Managers can't see load and stuck projects across the team.
**Context**: Manager/admin-only lane on dashboard; role check server-side in query.
**In scope**: Pipeline table grouped by owner: per-owner counts by stage, open blocking
handoffs with age, overdue items; drill-in to a person's queue (read-only reuse of My
work lanes parameterized by user); paginated indexed queries (`by_ownerId_and_
workflowStage`, `by_assigneeId_and_status`).
**Out of scope**: Capacity planning (Phase 8).
**Acceptance criteria**:
- [ ] Consultant role gets permission error on pipeline queries (server-enforced).
- [ ] Counts match lane contents (test fixture with known distribution).
- [ ] Stuck indicator: blocking handoff open > N days shows age text.
- [ ] Paginated; no `.collect()` over all projects.
**Dependencies**: PSOS-12/14; role gate hardened later by PSOS-27 (helper indirection
now). **Rollout**: additive tab visible only to manager/admin.

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
