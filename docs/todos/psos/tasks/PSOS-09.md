# PSOS-09 — Server-side ownership transfer + stage transition mutations with validation

## Work control

- **Status:** `done`
- **Phase:** P2
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** 2026-07-28
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete and deployed to the configured development environment. Claude Code/Fable 5 planning verdict **PLAN READY** and adversarial review verdict **SHIP**. PSOS-10 owns UI wiring.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope. *(No UI is in scope; PSOS-10 wires these APIs.)*
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant. *(Typed backend failure/conflict contracts completed.)*
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work. *(Not applicable: backend-only ticket.)*

### 4. Validate and close

- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P1.
**Problem**: Ownership and stage must only change through validated, authorized, audited
paths.
**Context**: New module `convex/projectWorkflow.ts` (do not grow `convex/projects.ts`);
transition matrix from PSOS-01; capability presets arrive Phase 6 — until then enforce:
transfer by current owner/manager/admin; stage change by owner/assignee-of-open-handoff/
manager/admin (encode in one helper so Phase 6 swaps implementation, not call sites).
**In scope**: `transferOwnership` (args: projectId, toUserId, note?, expectedVersion),
`setWorkflowStage` (args: projectId, toStage, note?, expectedVersion) — both single
atomic mutations writing `projectEvents`, updating `workflowUpdatedAt`; transition
matrix as data (shared const, exported for tests + UI); invalid edges rejected with
typed error codes; on_hold/abandoned reachable from any active stage; delivered requires
delivery-authority per PSOS-01 decision.
**Out of scope**: Automation (stage auto-advance) — record hooks but don't enable.
**Acceptance criteria**:
- [x] Every allowed edge in the matrix is recognized; immediately enforceable edges succeed, prerequisite-gated edges fail closed with typed errors, every disallowed edge is rejected, and a matrix-driven test covers all N×N pairs.
- [x] Unauthorized actor gets permission error (test per role).
- [x] Concurrent transfer with stale expectedVersion fails cleanly (OCC test).
- [x] Each success writes exactly one immutable event.
**Dependencies**: PSOS-07/08; PSOS-01 matrix. **Rollout**: additive; UI wires in PSOS-10.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Add optional `projects.workflowVersion`; absent means version 0, and every successful ownership or stage mutation increments one shared monotonic counter. | Millisecond timestamps are not collision-safe OCC tokens, while the contract explicitly requires an expected project version. | Claude Code/Fable plan; implementation default |
| 2026-07-28 | Keep `ready_for_delivery → delivered` in the shared matrix but fail closed with `OUTCOME_REQUIRED` until exact production outcomes exist. | The contract requires an exact delivered/filing outcome and explicitly sequences outcomes before treating `delivered` as reachable; PSOS-22/23 own that storage and capture flow. | Approved product-domain contract |
| 2026-07-28 | Treat a missing workflow stage as effective `intake` for mutation compatibility; omit `from` from the first stage event when storage was absent. | PSOS-07 widened fields optionally and future projects are not yet dual-written until later rollout work. | Claude Code/Fable plan |
| 2026-07-28 | Handoff-assignee authority remains a documented fail-closed hook until PSOS-12 introduces `workItems` and `currentHandoffId`; it can never grant ownership-transfer authority. | No handoff storage exists yet; the only H-authorized edges also permit Owner/Manager/Admin, so no approved edge becomes unreachable. Ownership transfer remains strictly Owner/Manager/Admin under D2. | Dependency boundary |
| 2026-07-28 | Notes are required for every transition to `on_hold` or `abandoned`, and every transition from `delivered` or `abandoned`; notes are trimmed and bounded to 2,000 characters. | Mirrors the transition-table reason/audit-note requirements and prevents unbounded audit text. | Approved product-domain contract |
| 2026-07-28 | Workflow mutations do not change legacy `status`, `updatedAt`, `writer`, or immutable `createdBy`. | Human workflow must remain separate from legacy status/generation state, and workflow changes must not appear as unrelated report edits or dashboard reorder. | Approved product-domain contract |
| 2026-07-28 | Transition requirements whose storage does not exist yet fail closed: `delivery_outcome` → `OUTCOME_REQUIRED`; `promoted_branch` and `review_handoff` → `INVALID_STATE`. | The contract requires transition-specific prerequisites. Recording hooks while allowing the transition would create invalid states before PSOS-12/18/19/22. | Adversarial review hardening |
| 2026-07-28 | Same-owner and same-stage calls are authorized idempotent no-ops even with a stale but structurally valid expected version; invalid negative/fractional versions are always rejected. | Retry-safe no-ops must not add events, while argument validation should never be bypassed. | Claude Code/Fable plan and review |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code/Fable 5 completed a read-only adversarial planning pass. | **PLAN READY.** Contract gaps around delivered outcomes, handoff authority, OCC versioning, and readiness dependencies were resolved without inventing workflow edges. |
| 2026-07-28 | Added the exact 41-edge shared transition matrix, optional monotonic `workflowVersion`, and atomic ownership/stage mutations in `convex/projectWorkflow.ts`. | Transfers are Owner/Manager/Admin only; target owners are active Consultants/Managers; same-state retries are event-free; legacy fields remain untouched. |
| 2026-07-28 | Added matrix-driven and authorization/OCC/event tests. | 8 focused tests cover all 100 stage pairs, exact authorities, all required-note edges, prerequisite failures, absent-stage compatibility, eligibility, idempotency, and stale versions. |
| 2026-07-28 | Claude Code/Fable 5 completed the mandatory adversarial post-implementation review. | **SHIP.** Resolved review recommendations by permanently excluding handoff-only authority from transfer, failing closed on promoted-branch/review-handoff prerequisites, validating no-op version shape, and expanding boundary tests. |
| 2026-07-28 | Completed validation and deployed to `energized-salamander-237`. | 419/419 tests, Svelte check 0 errors/warnings, Convex TypeScript clean, production build successful, and `git diff --check` clean. An unauthenticated CLI call returned typed `NOT_AUTHENTICATED`, confirming public mutation auth enforcement on deployment. |

## Completion record

- **Pull request/commit:** Uncommitted at user request.
- **Deployment:** Convex development deployment `https://energized-salamander-237.convex.cloud`.
- **Follow-up tickets:** PSOS-10 wires owner/stage controls; PSOS-12 activates handoff-assignee authority; PSOS-18/19 activate promoted-branch readiness; PSOS-22/23 activate exact delivery outcomes.
- **Known limitations accepted at closure:** Prerequisite-gated transitions fail closed until their owning storage tickets ship. New project creation remains unchanged until its dedicated consumer rollout, so absent workflow stages are interpreted as `intake`.
