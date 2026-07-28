# PSOS-11 — Indexed, paginated dashboard projection queries (retire broad fetch + N+1)

## Work control

- **Status:** `not_started`
- **Phase:** P2
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

**Priority**: P1 (performance foundation for Phase 3 lanes).
**Problem**: Dashboard fetches all projects then filters client-side, with per-project
generation lookups (N+1). New lanes multiply this cost.
**Context**: Current queries in `convex/projects.ts` / `convex/reportViews.ts`;
guidelines mandate `withIndex` + `paginationOptsValidator` + bounded reads. Related:
BNH-49 (sort/filter) — its filters should move onto these queries.
**In scope**: New query module (e.g. `convex/dashboard.ts`) returning row projections
(id, title, client, fiscalYear, ownerId+name, workflowStage, dueAt?, latest generation
status denormalized) via indexes: `by_ownerId_and_workflowStage`, `by_workflowStage`,
plus a denormalized `latestGenerationStatus` field on projects maintained by generation
mutations (eliminates N+1). All lane queries paginated. Existing all-projects
company→fiscal-year view converted to the projection (grouping client-side per page is
acceptable given grouped ordering index or per-company query — document choice).
**Out of scope**: Lane UI (Phase 3), saved views (Phase 8).
**Acceptance criteria**:
- [ ] No dashboard query calls `.collect()` on projects or does per-row `db.get` loops
      for generation status.
- [ ] Each lane query uses a named index and paginates; page size configurable.
- [ ] `latestGenerationStatus` kept consistent by generation lifecycle mutations
      (test: create→run→fail→retry updates projection).
- [ ] Backfill populates `latestGenerationStatus` for existing projects (idempotent).
- [ ] Perf check: dashboard initial load reads ≤ page-size project docs.
**Dependencies**: PSOS-07. **Rollout**: run old + new queries in parallel behind a
switch during verification, then remove old path.

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
