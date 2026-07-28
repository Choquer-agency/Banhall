# PSOS-09 — Server-side ownership transfer + stage transition mutations with validation

## Work control

- **Status:** `not_started`
- **Phase:** P2
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
**Problem**: Ownership and stage must only change through validated, authorized, audited
paths.
**Context**: New module `convex/projectWorkflow.ts` (do not grow `convex/projects.ts`);
transition matrix from PSOS-01; capability presets arrive Phase 6 — until then enforce:
transfer by current owner/manager/admin; stage change by owner/assignee-of-open-handoff/
manager/admin (encode in one helper so Phase 6 swaps implementation, not call sites).
**In scope**: `transferOwnership` (args: projectId, toUserId, note?, expectedVersion),
`setWorkflowStage` (args: projectId, toStage, note?, expectedVersion) — both single
atomic mutations writing `projectEvents`, updating `workflowUpdatedAt`; transition
matrix as data (shared const, exported for tests + UI); invalid edges rejected with
typed error codes; on_hold/abandoned reachable from any active stage; delivered requires
delivery-authority per PSOS-01 decision.
**Out of scope**: Automation (stage auto-advance) — record hooks but don't enable.
**Acceptance criteria**:
- [ ] Every allowed edge in the matrix succeeds; every disallowed edge rejected with
      typed error; matrix-driven test covers all N×N pairs.
- [ ] Unauthorized actor gets permission error (test per role).
- [ ] Concurrent transfer with stale expectedVersion fails cleanly (OCC test).
- [ ] Each success writes exactly one immutable event.
**Dependencies**: PSOS-07/08; PSOS-01 matrix. **Rollout**: additive; UI wires in PSOS-10.

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
