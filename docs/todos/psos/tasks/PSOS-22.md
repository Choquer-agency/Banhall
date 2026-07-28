# PSOS-22 — productionOutcomes schema + record/correct mutations

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
**Problem**: Nothing records what actually happened to a draft; export is treated as
delivery, which is wrong.
**Context**: New `convex/productionOutcomes.ts`; export flow (BNH-46 .docx export)
provides the evidence hook; branches from Phase 4 give the exact artifact.
**In scope**: `productionOutcomes` table: projectId, branchId, reportId,
snapshotId/revision (exact revision), outcome (`delivered_to_client`, `used_in_filing`,
`abandoned_quality`, `abandoned_scope`, `superseded`, `test_only`), reasonCode?,
reasonNote?, actorId, at, supersededBy? (correction chain), correctedAt?. Indexes
`by_projectId`, `by_branchId`, `by_outcome`. Outcomes are **immutable**; corrections
append a new row linking the old via `supersededBy` (no update/delete). Recording
mutation validates actor authority (delivery authority per PSOS-01) and that
branch/revision exist. Non-use reason codes structured (quality: hallucination,
tone, structure; scope: descoped, client-cancelled; etc. — enumerate from PSOS-01).
**Acceptance criteria**:
- [ ] Outcome rows immutable; correction chain preserves both rows and orders by time.
- [ ] Recording ties to exact branch + revision (test: later edits don't change what
      the outcome references).
- [ ] Unauthorized actor rejected for delivery outcomes.
- [ ] Multiple outcomes per project allowed where sensible (test_only then
      delivered_to_client on different branches) but contradictions on same branch
      require correction flow.
**Dependencies**: PSOS-18/19 (branch identity), PSOS-01 (authority + reason codes).

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
