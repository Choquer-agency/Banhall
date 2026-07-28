# PSOS-32 — Lift financial data to client+claim-period scope (claimPeriodProjects, sources, entries, reviews)

## Work control

- **Status:** `not_started`
- **Phase:** P7
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

**Priority**: P1 for phase.
**Problem**: Financial uploads/timesheets/summaries hang off single projects
(`financialUploads`, `timesheetEntries`, `financialSummaries` all `by_projectId`), but
real claims span many PDs in one client fiscal year.
**Context**: `convex/financial.ts`; existing route `/project/[id]/financial` must keep
working during transition.
**In scope**: `claimPeriodProjects` join (claimPeriodId, projectId; indexes both
directions); widen financial tables with optional `claimPeriodId` (+ indexes
`by_claimPeriodId`); backfill: existing rows get claimPeriodId via their project's
link; new APIs are claim-period-scoped with project links preserved (allocation
records reference projectId); review/approval rows likewise lifted; compat layer:
project-financial route reads claim-period data filtered to that project.
**Acceptance criteria**:
- [ ] Existing `/project/[id]/financial` shows identical data before/after backfill
      (snapshot regression test on fixtures).
- [ ] New claim-period queries paginated + indexed; no cross-client leakage
      (authorization: financial.read).
- [ ] Backfill idempotent; rows without resolvable claim period queued, not guessed.
**Dependencies**: PSOS-31; PSOS-26 capabilities. **Rollout**: dual-read period, then
route new writes to claim-period scope.

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
