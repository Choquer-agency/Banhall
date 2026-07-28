# PSOS-08 — Ownership/stage backfill: writer matching, creator fallback, ambiguity queue

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

**Priority**: P1.
**Problem**: Existing projects need Owners and stages without destroying legacy data or
guessing wrong silently.
**Context**: Legacy `writer` free-text on projects (BNH-22 added interviewer/writer
fields); `users` table with `by_email`; migration patterns per convex-migration-helper
(batched, idempotent, self-rescheduling mutations).
**In scope**:
- Backfill mutation (batch + `ctx.scheduler.runAfter` continuation): match legacy
  `writer` text → user (exact email, then exact normalized full-name, unique matches
  only) → set `ownerId` + `ownership_transferred` event with `note: "backfill:writer"`;
  else fall back to `createdBy` with `note: "backfill:creator-fallback"`.
- Ambiguous/no-match projects flagged into a review queue (field
  `ownerBackfillStatus: "needs_review"` or dedicated table) with admin UI list to
  resolve manually (simple table under `src/routes/admin`).
- Stage backfill heuristic: delivered-ish signals (exported/published) →
  `delivered`? NO — default conservative: projects with a selected report →
  `drafting`, else `intake`; record heuristic in event note; admins can correct.
- Legacy `writer` field retained untouched (narrow later, separate decision).
**Acceptance criteria**:
- [ ] Backfill idempotent (re-run produces zero new events) and resumable mid-batch.
- [ ] Every project ends with ownerId + workflowStage or `needs_review` flag; counts
      logged/reported.
- [ ] No legacy field deleted or overwritten.
- [ ] Admin review queue lists ambiguous projects with candidate matches and one-click
      assign (writes audited transfer).
- [ ] Tests: matcher unit tests (exact/ambiguous/none), idempotency, batching.
**Dependencies**: PSOS-07. **Rollout**: run in prod off-hours; monitor via counts.
**Risks**: name collisions; wrong-owner assignment is recoverable via audited transfer.

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
