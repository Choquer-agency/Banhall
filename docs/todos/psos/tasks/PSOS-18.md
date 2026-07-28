# PSOS-18 — reportBranches schema + backfill of existing reports/candidates

## Work control

- **Status:** `not_started`
- **Phase:** P4
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
**Problem**: Candidate selection is destructive: unselected model drafts are deleted.
Alternatives must become durable, independently editable branches.
**Context**: `convex/reports.ts`, `reportCandidates` (by_generationId, by_projectId),
`reportSnapshots`, `modelSelections`, `candidateScores`; new module
`convex/reportBranches.ts`. Related board work to preserve: BNH-48 (per-option
scoring), BNH-47 (QA panel), BNH-56 (named snapshots), BNH-19 (diff view).
**In scope** (widen + backfill; behavior change lands PSOS-19):
- `reportBranches`: projectId, reportId (the editable doc per branch — reuse `reports`
  rows as branch content or add branch-scoped report rows; decide with existing report
  editor coupling, document choice in ticket), name, sourceModel?, sourceGenerationId?,
  status (`active_candidate`, `working`, `archived`, `promoted`), createdBy, createdAt,
  archivedAt?. Indexes: `by_projectId_and_status`, `by_reportId`,
  `by_sourceGenerationId`.
- `projects.activeBranchId` + `projects.promotedBranchId` (optional, widen).
- Backfill: each existing selected report → one `promoted`/`working` branch; surviving
  candidates (if any) → `active_candidate` branches; snapshots remain attached to their
  report (per-branch history preserved automatically since snapshots key on reportId).
- Immutable branch events (reuse `projectEvents` with branch types: created, renamed,
  archived, promoted, made_active).
**Acceptance criteria**:
- [ ] Backfill idempotent + batched; every project with a report has ≥1 branch and
      `activeBranchId` set; counts reported.
- [ ] No candidate/report/snapshot rows deleted by this ticket.
- [ ] Schema green; existing editor unaffected (fields optional).
**Dependencies**: PSOS-07 (events table). **Rollout**: deploy + backfill before PSOS-19.

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
