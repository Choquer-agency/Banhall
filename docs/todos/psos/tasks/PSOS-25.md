# PSOS-25 — Outcomes as governed learning signals (no auto-ingest)

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
**Problem**: Outcome data should inform The Brain and model guidance, but abandoned or
delivered content must never bypass Brain review/provenance (guardrail).
**Context**: `convex/brain.ts`, `convex/learning.ts`, Brain queue governance (BNH-42
admin approval + revert log; BNH-3 reject→learn loop).
**In scope**: Emit outcome *signals* (references + metadata: model, reason codes,
scores) into the existing learning/review queue as candidate items requiring human
approval; explicit denylist: raw report content of abandoned branches never
auto-attached; provenance recorded on any approved item; documentation of signal
schema.
**Acceptance criteria**:
- [ ] Recording an outcome creates at most one queue signal (deduped); approving it is
      the only path to any Brain change.
- [ ] No code path writes report content into Brain storage without the BNH-42 approval
      flow (test asserting queue-only writes).
- [ ] Revert log covers signal-derived changes.
**Dependencies**: PSOS-22; BNH-42 (if unshipped, this ticket blocks on it — set
blocked flag).

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
