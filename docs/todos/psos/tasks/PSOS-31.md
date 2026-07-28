# PSOS-31 — clients + claimPeriods schema and normalization migration

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
**Problem**: Clients exist only as free-text names and fiscal years scattered on
projects; financial work is client+claim-period shaped, not project shaped.
**Context**: `projects` company/fiscal-year fields (BNH-36 grouping relies on them);
new module `convex/claimPeriods.ts`; normalization strategy per PSOS-01 decision.
**In scope**: `clients` table (name, normalizedName, createdBy, createdAt; index
`by_normalizedName`); `claimPeriods` (clientId, fiscalYearLabel, startDate?, endDate?,
status; index `by_clientId_and_fiscalYearLabel`); migration: derive distinct
normalized client names + fiscal years from projects (batched scan), create
clients/claimPeriods, write `projects.clientId` + `projects.claimPeriodId` (widen,
optional); ambiguity queue for near-duplicate names ("Acme Inc" vs "Acme Inc.") with
admin merge UI (merge re-points projects, audited); free-text fields retained
(narrow later).
**Acceptance criteria**:
- [ ] Idempotent, resumable backfill; every project linked or queued for review.
- [ ] Merge operation re-points all references atomically-per-batch and writes audit
      events; no orphan claimPeriods.
- [ ] BNH-36 grouping keeps working during transition (reads legacy fields until
      cutover flag).
- [ ] Tests: normalizer, merge, idempotency.
**Dependencies**: PSOS-01 normalization decision. **Rollout**: widen-migrate-narrow;
cutover flag for reads. **Risks**: bad merges → merges reversible via audit trail
(unmerge tool or manual re-point documented).

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
