# PSOS-28 — Financial role + role-aware landing/navigation

## Work control

- **Status:** `not_started`
- **Phase:** P6
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
**Problem**: Financial staff need financial surfaces without full consultant tooling;
nav shouldn't duplicate the app per role.
**Context**: Roles UI `src/routes/admin`; nav in root layout; financial route currently
`/project/[id]/financial`; Phase 7 will add client/claim-period workspace — this ticket
only prepares role + landing.
**In scope**: Add `financial` role value (widen users.role union); capability preset
(financial.read/write, limited project read, no generation/branch actions); role-aware
landing: financial users land on financial workspace (Phase 7 landing once built;
until then, a financial index listing projects with financial data); nav shows/hides
sections by capability via `hasCapability` hints (server still enforces); invite flow
supports the role (reuses BNH-50 concepts — note relation, BNH-50's multi-tenant scope
is broader and stays its own ticket).
**Acceptance criteria**:
- [ ] Financial user: sees financial nav + landing; denied consultant-only mutations
      (server tests).
- [ ] Consultant/Manager unaffected; Admin retains all.
- [ ] No duplicated app shell — same layout, capability-filtered nav.
- [ ] Role assignable in Users & roles with PSOS-03 description.
**Dependencies**: PSOS-26/27. **Rollout**: additive role; assign to pilot user first.

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
