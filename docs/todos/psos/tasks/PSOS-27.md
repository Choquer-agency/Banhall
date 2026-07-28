# PSOS-27 — Authorization audit & migration of all Convex functions + matrix tests

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

**Priority**: P0 for phase.
**Problem**: Every relevant query/mutation/action must enforce capabilities
server-side; today enforcement is inconsistent.
**Context**: Audit surface: `projects.ts`, `reports.ts`, `generations.ts`,
`workItems.ts`, `projectWorkflow.ts`, `reportBranches.ts`, `productionOutcomes.ts`,
`notifications.ts`, `financial.ts`, `users.ts`, `invites.ts`, `brain.ts`,
`learning.ts`, `chat*/research*/comments/reviews/snapshots` modules, `http.ts` routes.
**In scope**: Inventory spreadsheet/table of every exported function → required
capability; migrate each to `requireCapability`; preserve current behavior for
internal-user reads (visibility unchanged); tighten known gaps (e.g. role management,
delivery, financial writes); share-token paths (`by_shareToken`, commenters) reviewed
explicitly and documented; authorization matrix integration tests: for each function ×
role, expected allow/deny (generated from the PSOS-26 matrix export where feasible).
**Acceptance criteria**:
- [ ] 100% of exported functions listed in the inventory with a decision (capability /
      public / share-token / internal).
- [ ] Matrix tests cover all state-changing functions × 4 roles; suite green.
- [ ] No visibility regressions: consultant still sees the same project set as before
      (regression test).
- [ ] Share-token surface documented with threat notes.
**Dependencies**: PSOS-26. **Rollout**: migrate module-by-module behind green tests;
deploy in ≥2 releases to bisect regressions. **Risks**: silent behavior drift → the
regression tests above are the gate.

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
