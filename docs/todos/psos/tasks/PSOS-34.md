# PSOS-34 — Claim-period workspace: source uploads, personnel/hour review, allocation, costing outputs

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

**Priority**: P2.
**Problem**: The actual financial workflow — upload payroll/timesheet sources, review
personnel and hours, allocate to PDs, produce costing outputs tied to technical
reports — has no claim-period home.
**Context**: Claim-period detail route `src/routes/financial/[claimPeriodId]`; existing
extraction in `convex/financial.ts` (uploads, timesheet parsing) reused at new scope;
technical report links via `claimPeriodProjects` → projects → promoted branch/outcome
(Phases 4–5 give the deliverable identity).
**In scope**: Source uploads at claim-period level (receipt UX per PSOS-04 pattern);
personnel list with extracted hours, review/approve per person (reviewer, timestamp,
audit); allocation UI: distribute person-hours across the period's PDs (percent or
hours; validation sums ≤ total; draft vs approved allocation states); costing outputs
summary per PD + period (feeding claim docs); links to each PD's technical report
(promoted branch); export of costing summary (CSV first).
**Out of scope**: Tax-form generation; external accounting integrations.
**UX**: Ledger tables, inline validation with explicit messages, autosave with OCC on
allocation rows, keyboard-friendly numeric entry; failure states for unreadable
sources reuse PSOS-04 statuses.
**Acceptance criteria**:
- [ ] Upload→extract→review→allocate→costing flow completable end-to-end on fixture
      data.
- [ ] Allocation validation: over-allocation blocked with plain message; totals
      recompute reactively.
- [ ] Approvals audited (who/when); edits after approval require re-approval.
- [ ] CSV export matches on-screen totals (test).
- [ ] All mutations financial.write-gated.
**Dependencies**: PSOS-32/33. **Risks**: extraction quality on new source types —
receipt statuses make gaps visible rather than silent.

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
