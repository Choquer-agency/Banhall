# PSOS-10 — Project header & list metadata: Stage, Owner, With, Due as labeled data

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
**Problem**: UI conflates creator with owner and hides who has the next action.
**Context**: Project page under `src/routes/project/[id]`, list under `src/routes/dashboard`
(current all-projects view; BNH-36 company→fiscal-year grouping preserved); header
components in `src/lib/components`.
**In scope**: Header block showing **Stage** (human label), **Owner** (avatar+name),
**With** (assignee of open blocking handoff, or "—" until Phase 3 lands; component reads
optional field so it lights up when PSOS-14 ships), **Due** (from handoff; absolute date
+ relative text, not color-only); owner transfer UI (dialog → PSOS-09 mutation) and
stage change control (only valid next stages offered; server still validates); project
list rows gain Owner + Stage columns.
**Out of scope**: New dashboard lanes (PSOS-11), work-item creation (Phase 3).
**UX**: Four separately labeled data slots, Geist Mono for metadata per design system;
transfer/stage dialogs keyboard-operable; failure state on rejected transition shows
server reason plainly.
**Acceptance criteria**:
- [ ] Header shows all four slots with graceful "—" empties; never shows createdBy as
      "Owner".
- [ ] Stage control offers only matrix-valid next stages; server rejection surfaces.
- [ ] Transfer writes audit event and updates header reactively.
- [ ] Mobile: header collapses to stacked rows, targets ≥44px.
- [ ] svelte-check + component tests for empty/loading/error.
**Dependencies**: PSOS-07/09. **Rollout**: ship behind nothing — additive display.

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
