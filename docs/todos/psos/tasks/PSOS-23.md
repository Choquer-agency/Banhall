# PSOS-23 — Outcome capture UX (post-export/promotion/delivery), non-blocking

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

**Priority**: P1.
**Problem**: Outcomes must be captured at natural moments without adding friction —
export can never be blocked on paperwork.
**Context**: Export flow UI (BNH-46/55 export + validation), branch archive action
(PSOS-20), stage transition to `delivered` (PSOS-09/10).
**In scope**: Post-export non-blocking prompt ("Did this go to the client?" — Later /
Delivered / Just testing); promotion and archive prompts (archive asks structured
non-use reason); stage→delivered requires/creates a `delivered_to_client` outcome
(this is the one enforced link); project page Outcomes panel (ledger list of outcome
rows with actor/time/revision); "Export is evidence, not delivery" reflected in copy.
**Out of scope**: Analytics (PSOS-24).
**UX**: Prompt is a dismissible sheet, one question, plain options; Later leaves a
gentle nudge chip on project header, no nagging modal loops; reasons are select +
optional note; a11y per rails.
**Acceptance criteria**:
- [ ] Export completes fully even when prompt dismissed (never blocks).
- [ ] Marking stage delivered without outcome auto-opens capture and won't finalize
      until outcome recorded (Given/When/Then test).
- [ ] Archive with reason writes `abandoned_*` outcome referencing that branch.
- [ ] Outcomes panel shows chain incl. corrections.
**Dependencies**: PSOS-22, PSOS-09, PSOS-20.

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
