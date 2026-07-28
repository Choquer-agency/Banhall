# PSOS-19 — Non-destructive candidate materialization + explicit branch promotion

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
**Problem**: Selecting a model draft currently deletes the others and conflates
"chosen to edit" with "final".
**Context**: Selection flow in `convex/generations.ts` / `convex/reports.ts` +
option-selection screen (`src/routes/project/...` selection step; BNH-48 scoring UI
lives here). `modelSelections`/`candidateScores` provenance must survive.
**In scope**:
- On generation completion: materialize each viable candidate as a persistent
  `active_candidate` branch (stop deleting alternatives).
- Replace destructive "select" with **Make active** (choose working branch; others
  remain) and **Promote** (mark branch as the deliverable line; single promoted branch
  pointer, atomic swap with event; previous promoted branch auto-status `working`,
  never deleted).
- Preserve report-scoped chat threads, research sessions, comments, snapshots,
  provenance (`sourceModel`, `sourceGenerationId`), and revision semantics per branch —
  all existing `by_reportId` scoping keeps working because each branch owns a reportId.
- Migration/compat: old flow's API removed only after new flow verified (parallel
  period behind flag).
**Acceptance criteria**:
- [ ] Given 3 completed candidates, selection screen produces 3 persistent branches;
      zero deletions (db assertion in test).
- [ ] Promote is atomic: pointer + statuses + event in one mutation; concurrent double
      promote → one winner via OCC (expectedVersion).
- [ ] Chat/comments/research/snapshots on branch A never appear on branch B (isolation
      test).
- [ ] Scores (`candidateScores`) and `modelSelections` remain queryable per branch.
- [ ] Old destructive path removed at cleanup; flag documented.
**Dependencies**: PSOS-18. **Rollout**: flag `persistentBranches`; verify on staging
projects, run parallel one release, then remove legacy. **Risks**: storage growth →
retention policy per PSOS-01 (archived branches).

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
