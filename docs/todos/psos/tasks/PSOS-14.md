# PSOS-14 — My Work dashboard: lanes, dense ledger rows, mobile cards

## Work control

- **Status:** `not_started`
- **Phase:** P3
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

**Priority**: P0 for phase — this is the new default landing.
**Problem**: Default dashboard is an all-project gallery; consultants need a personal
queue answering "what do I do next?".
**Context**: `src/routes/dashboard`; queries from PSOS-11 + workItems indexes; design
system dense ruled lists; BNH-36/49 all-projects grouping/filtering preserved as its
own view.
**In scope**: Default view **My work** with lanes as tabs/sections: **Assigned to me**
(open work items by dueAt), **Owned by me** (projects by stage), **Reviews** (open
internal_review items assigned to me), **Due soon** (next 7 days, mine), **Waiting on
others** (items I assigned or on projects I own, open, assignee ≠ me), **All projects**
(existing company→fiscal-year hierarchy, kept for lookup/admin/bulk edit). Each lane:
paginated dense rows — project, client, stage, kind, due (absolute + relative text),
assigner/assignee; row click → project; inline complete/reassign on my items.
Explicit overdue text ("Overdue 3 days"), never color alone.
**Out of scope**: Team pipeline (PSOS-15), saved views (Phase 8), notifications UI
(PSOS-16).
**UX/a11y**: Table semantics with proper headers; mobile switches to stacked cards with
same data order; empty states per lane with one suggested action ("No handoffs — check
Owned by me"); loading skeletons; reduced motion respected.
**Acceptance criteria**:
- [ ] `/dashboard` defaults to My work; All projects one tap away and unchanged in
      capability.
- [ ] Each lane paginates via indexed queries only (no client-side global filtering).
- [ ] Overdue/due-today/due-soon rendered as text labels + non-color affordance.
- [ ] Inline complete updates lane + project `currentHandoffId` reactively.
- [ ] Keyboard: tab through rows/actions; mobile targets ≥44px; svelte-check clean.
- [ ] Empty/loading/error states per lane.
**Dependencies**: PSOS-11, PSOS-12. **Rollout**: feature-flag default-view switch;
revert path = flag flip.

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
