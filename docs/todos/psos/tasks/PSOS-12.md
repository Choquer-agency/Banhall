# PSOS-12 — workItems + workItemEvents schema, invariants, transactional lifecycle

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

**Priority**: P0 for phase.
**Problem**: No first-class actionable handoff exists; a single mutable field can't
carry kind/assigner/instructions/history.
**Context**: New module `convex/workItems.ts`; supersedes the data layer implied by
board ticket **BNH-40** (peer review assignment — fold its review-assignment semantics
into work item kind `internal_review`; note supersession on BNH-40 when adopted).
**In scope**:
- `workItems`: projectId, kind (`internal_review`, `revision`, `interview_followup`,
  `delivery_prep`, `financial`, `other`), assigneeId, assignerId, dueAt?, instructions,
  blocking (bool), status (`open`, `completed`, `declined`, `cancelled`), completedAt?,
  completedBy?, resolutionNote?. Indexes: `by_assigneeId_and_status`,
  `by_projectId_and_status`, `by_status_and_dueAt`, `by_assignerId_and_status`.
- `workItemEvents` (immutable): workItemId, projectId, type (created/reassigned/
  completed/declined/cancelled/due_changed), actorId, at, detail. Indexes
  `by_workItemId`, `by_projectId`.
- Mutations: create, reassign, complete, decline (with reason), cancel — each atomic,
  each writing one event; **invariant: at most one open blocking work item per
  project**, enforced in-mutation (query `by_projectId_and_status` for open+blocking
  before insert/reassign-to-blocking; typed error `BLOCKING_EXISTS`).
- Denormalized pointer `projects.currentHandoffId` maintained by these mutations
  (nullable), so header "With" and lanes avoid joins.
- Completion history preserved (items are never deleted; cancel is a status).
**Authorization (pre-Phase-6)**: assignee/assigner/owner/manager/admin may act;
complete restricted to assignee + manager/admin; encode via the PSOS-09 helper.
**Acceptance criteria**:
- [ ] Creating second blocking item on a project fails with typed error; non-blocking
      items unlimited.
- [ ] Complete/decline/cancel are idempotent (second call no-ops or typed error, no
      duplicate events).
- [ ] `currentHandoffId` always matches the open blocking item (property test across
      lifecycle sequences).
- [ ] Permission-denial tests per operation per role.
- [ ] Events immutable: no update/delete path exported.
**Dependencies**: PSOS-07/09. **Rollout**: additive tables; no backfill needed.

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
