# PSOS-26 — roleCapabilities module: presets + server helpers

## Work control

- **Status:** `ready`
- **Phase:** P6
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Dependencies satisfied by PSOS-01; ready to begin in queue order.

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
**Problem**: Authorization is scattered creator/admin checks; capabilities must be
centralized and declarative before hardening every function.
**Context**: New `convex/roleCapabilities.ts`; roles on `users`; capability matrix from
PSOS-01; the temporary helper from PSOS-09/12 gets replaced here (call sites unchanged).
**In scope**: Capability enum (e.g. `project.transferOwnership`, `project.setStage`,
`workItem.completeOthers`, `branch.promote`, `outcome.recordDelivery`,
`financial.read`, `financial.write`, `roles.manage`, `pipeline.view` …); presets
Consultant/Manager/Admin/Financial as data; helpers `requireCapability(ctx, cap,
scope?)` and `hasCapability` for UI hints; typed permission errors; export matrix for
tests + UI (PSOS-29).
**Explicit guardrail**: capability rollout must NOT change project visibility —
visibility remains as-is pending PSOS-30 decision.
**Acceptance criteria**:
- [ ] Single source of truth: presets defined once, imported by all call sites.
- [ ] Helper resolves role→capability in O(1) (no db scans per check beyond user row).
- [ ] Matrix test: table-driven role×capability expectations, all four roles.
- [ ] No custom-permission builder shipped (non-goal).
**Dependencies**: PSOS-01. **Rollout**: land helpers, then migrate call sites (PSOS-27).

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
