# PSOS-24 — Production analytics: funnel + per-model delivery/abandonment

## Work control

- **Status:** `not_started`
- **Phase:** P5
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
**Problem**: No visibility into generated→opened→edited→promoted→exported→delivered
funnel or which models produce delivered work.
**Context**: Sources: `generations`, `reportViews` (opens), snapshots/revisions
(edits), branch events (promotions), export events (BNH-46; add export event row if
missing), `productionOutcomes`; cost data via `aiUsage` (BNH-16 in progress — reuse its
aggregation, don't fork). Admin/manager surface under `src/routes/admin` or dashboard
analytics tab.
**In scope**: Funnel counts by period; per-model: delivery rate, abandonment by reason,
edit distance proxy (snapshot delta size or count), time-to-deliver, cost per delivered
PD where `aiUsage` allows; queries pre-aggregated via scheduled rollup table (no
dashboard-time full scans); role-gated (manager/admin).
**Out of scope**: Auto-selection changes (BNH-15 owns that), learning ingestion
(PSOS-25).
**Acceptance criteria**:
- [ ] Rollup cron maintains aggregates in bounded batches; dashboards read only
      aggregates.
- [ ] Per-model table shows delivery %, abandonment reasons breakdown, median
      time-to-deliver.
- [ ] Charts follow dataviz/design rails, values as text on hoverless devices.
- [ ] Consultant role denied (server-side).
**Dependencies**: PSOS-22/23; coordinate BNH-16. **Risks**: edit-distance fidelity —
mark proxy explicitly in UI.

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
