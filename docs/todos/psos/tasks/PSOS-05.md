# PSOS-05 — Generation failure & recovery surface in project header

## Work control

- **Status:** `ready`
- **Phase:** P1
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
**Problem**: When one model in a multi-model generation fails or a generation stalls,
users see confusing partial states and cannot recover without support.
**Context**: `convex/generations.ts` (statuses reserved/running/awaiting_selection/
awaiting_input/completed/failed; existing retry + stale-generation cleanup — reuse,
don't rebuild), `reportCandidates`, project page under `src/routes/project`. Related:
BNH-21 (loading screen), BNH-52 (duplicate-run prevention).
**In scope**: Project-header status chip for active/failed generations; failure panel
listing per-model outcome, retaining completed model results while showing failed ones
with "Retry failed model(s)" and "Continue with completed results" actions; wire to
existing retry mutation; stall detection surfaced via existing stale cleanup.
**Out of scope**: Branch materialization (Phase 4); new generation engine work.
**UX**: One obvious next action; plain-language failure text ("Claude's draft didn't
complete. Two other drafts are ready."); no provider error dumps or model internals
beyond friendly model names; chip is text+shape, not color-only.
**Technical notes**: query by `generations.by_projectId_and_status`; retry must be
idempotent (reuse guards from BNH-52 work); header component in project layout.
**Acceptance criteria**:
- [ ] Given 3-model run with 1 failure, header shows partial-failure state; completed
      candidates remain selectable; retry re-runs only the failed model.
- [ ] Given full failure, user can retry all from header without navigating to logs.
- [ ] Retry is idempotent under double-click (single new generation attempt).
- [ ] Stale (stuck >threshold) generations surface as failed-with-retry, not spinner.
- [ ] Tests: retry idempotency; partial-state query; component states (running/partial/
      failed/recovered).
**Dependencies**: none. **Rollout**: pure additive UI + query.

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
