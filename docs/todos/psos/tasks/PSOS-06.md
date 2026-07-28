# PSOS-06 — Verify highlighted-text research entry in uploaded-PD review mode

## Work control

- **Status:** `in_review`
- **Phase:** P1
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Approved verification slice is complete and reviewed. Contextual research remains scoped to the generated comparison report, with the uploaded PD available only as private project evidence; direct source-document research is deferred to PSOS-18/19 imported branches. Added six Convex regressions, a committed installed-Chrome matrix, and PD-review provider-error projection hardening. Final Claude Code/Fable 5 verdict: SHIP. Awaiting production deployment smoke before `done`.

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
- [x] **Approved amendment:** In uploaded-PD review mode, contextual research becomes available after generating/selecting the editable comparison report. Highlighting report text opens a session scoped to that exact report revision; the uploaded PD is retrieved as private `project_document` evidence. Direct source-document selection is deferred to imported report branches in PSOS-18/19.
- [x] Session lists correctly under that generated review report on revisit.
- [x] Regression tests and an installed-Chrome manual test script are committed in the working change.
**Dependencies**: none. **Risks**: may be pure verification (timebox; close if working).

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Keep contextual research scoped to the generated comparison report; use the uploaded PD as private project evidence. Defer direct source-PD research until PSOS-18/19 can represent it as an imported report branch. | Research proposals, revisions, history, and session feeds are report-scoped by the approved domain contract. A direct document scope would require a new viewer, schema union, proposal suppression, and a contract amendment outside this verification ticket. | Product owner selected the recommended Claude Code plan option. |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code/Fable 5 completed the required read-only planning pass. | Verified that uploaded PD source documents have no selectable report surface and research is intentionally report/revision scoped. Plan recommended comparison-report verification with direct PD research deferred to imported branches. |
| 2026-07-28 | Product owner approved generated-comparison report scoping. | PSOS-06 activated as the sole implementation ticket; no product-domain amendment or schema migration is required. |
| 2026-07-28 | Added `convex/researchReviewMode.test.ts` and a committed installed-Chrome matrix. | Regressions prove report/revision scoping, revisit listing, duplicate-run fencing, internal access enforcement, and uploaded-PD retrieval as private `project_document` evidence without including its body in the external brief. |
| 2026-07-28 | Installed-Chrome review-mode verification found a historical raw Anthropic billing response in the PD-review Activity feed. | Hardened `getLatestPdReview` and `listPdReviewEvents` product projections while preserving stored forensic detail; `convex/pdReviewProjection.test.ts` prevents provider/error leakage. |
| 2026-07-28 | Deployed the projection fix to Convex development and repeated Chrome verification on project `k9705nbencz4b5wjaa04hgc93h8a3xbn`. | Source-PD review correctly offers no direct research control; historical failure now reads “The review did not complete.” with no provider, request ID, or billing text. Existing generated-report project `k97drrdvsmsm3gwvjareka1abs8aqnbz` retained its revisitable research feed. |
| 2026-07-28 | Claude Code/Fable 5 completed the mandatory adversarial post-implementation review. | Verdict: **SHIP**, no blockers. Acceptance wording was amended to match the approved decision; the unauthenticated mutation regression was tightened to require the authentication error. |
| 2026-07-28 | Final validation completed after review fixes. | 377/377 unit/integration tests, 38/38 browser-component tests, clean Svelte and Convex typechecks, successful production build, and clean `git diff --check`. |

## Completion record

- **Pull request/commit:** —
- **Deployment:** —
- **Follow-up tickets:** —
- **Known limitations accepted at closure:** —
