# PSOS-06 — Verify highlighted-text research entry in uploaded-PD review mode

## Work control

- **Status:** `ready`
- **Phase:** P1
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Dependency-free and ready after PSOS-05. Program audit pre-verified a real gap: `PdReviewReport.svelte` has no highlight/research entry, while current research sessions require a generated `reportId`; implementation must first resolve document-scoped versus generated-comparison scoping without inventing behavior.

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

**Priority**: P2 (verification/small-fix ticket).
**Problem**: Research-from-highlight is expected to work when reviewing an uploaded PD
(review mode), not only on generated reports; current behavior unverified.
**Context**: Research sessions in `convex/research.ts` (`researchSessions.by_reportId`),
review mode via `convex/pdReviews.ts` and `src/routes/review`; research UI components in
`src/lib/components`.
**In scope**: Test matrix (generated report vs uploaded PD; selection in each pane);
fix entry-point wiring if broken; ensure research session scoping uses the correct
report/document ID in review mode.
**Out of scope**: New research capabilities.
**Acceptance criteria**:
- [ ] Given uploaded-PD review mode, when user highlights text, then research entry
      action appears and opens a session scoped to that document.
- [ ] Session lists correctly under that review context on revisit.
- [ ] Regression test or documented manual test script committed.
**Dependencies**: none. **Risks**: may be pure verification (timebox; close if working).

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
