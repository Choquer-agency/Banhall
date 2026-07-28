# PSOS-07 — Schema: ownerId, workflowStage, workflowUpdatedAt + audit events + indexes

## Work control

- **Status:** `in_review`
- **Phase:** P2
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Strict widen-only implementation and validation complete: optional ownership/workflow fields, typed immutable event storage, shared stage vocabulary, and indexes; no backfill, mutations, or UI. Claude Code/Fable planning verdict PLAN READY and adversarial review verdict SHIP. Awaiting backend-first production deployment before `done`.

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

**Priority**: P0 for the initiative.
**Problem**: Projects have no durable accountable Owner distinct from Creator, and no
human workflow stage distinct from AI generation state.
**Context**: `convex/schema.ts` `projects` (indexes: by_createdBy, by_status,
by_shareToken, by_industry); `createdBy` is immutable audit identity — MUST NOT be
repurposed. Legacy free-text `writer` field exists on projects/reports metadata.
**In scope** (widen phase only — no behavior change):
- `projects.ownerId: v.optional(v.id("users"))`, `workflowStage: v.optional(v.union(...10
  literals...))`, `workflowUpdatedAt: v.optional(v.number())`.
- New `projectEvents` table (immutable): `projectId`, `type` (`ownership_transferred`,
  `stage_changed`, later reused for handoffs), `actorId`, `at`, `from`, `to`, `note`;
  indexes `by_projectId` and `by_projectId_and_type`.
- Project indexes: `by_ownerId`, `by_ownerId_and_workflowStage`, `by_workflowStage`.
**Out of scope**: Backfill (PSOS-08), transition rules (PSOS-09), UI (PSOS-10).
**Acceptance criteria**:
- [ ] Schema deploys with all fields optional (widen); existing mutations unaffected.
- [ ] Convex TS + existing test suite (`convex/projects.test.ts`) green.
- [ ] `projectEvents` has no update/delete mutations exported.
**Dependencies**: PSOS-01 vocabulary. **Rollout**: deploy before PSOS-08.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Use the exact ten workflow-stage literals from the approved product-domain contract. | Keeps human workflow distinct from legacy project status and generation state. | Approved domain contract |
| 2026-07-28 | Model `projectEvents` as a closed discriminated union for `ownership_transferred` and `stage_changed`; future tickets widen it with their own typed variants. | Immutable history needs type-safe before/after values; a free-form string shape could preserve corrupt audit data forever. | Claude Code/Fable plan |
| 2026-07-28 | Require `actorId` and `to`; allow `from` to be absent for first assignment/backfill. | Preserves accountable audit history while supporting PSOS-08 initialization. | Claude Code/Fable plan |
| 2026-07-28 | Keep all three specified project indexes, including the owner-only prefix index. | Matches the ticket contract and provides an explicit backfill/query surface at negligible current write cost. | Claude Code/Fable plan |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code/Fable 5 completed the required read-only planning pass. | PLAN READY; no blockers. Scope confirmed as additive schema only with zero behavior change. |
| 2026-07-28 | Added shared workflow-stage vocabulary, optional project fields/indexes, and typed append-only project event storage. | Legacy project inserts remain valid; ownership and stage events cannot mix identifier and stage values. |
| 2026-07-28 | Claude Code/Fable 5 completed the mandatory adversarial post-implementation review. | Verdict: **SHIP**, no blockers. Added its recommended negative event-shape and remaining index regressions. |
| 2026-07-28 | Final gates completed. | 383/383 unit/integration tests, 38/38 browser-component tests, 24 focused schema/project tests, clean Svelte and Convex typechecks, successful production build, and clean diff check. |

## Completion record

- **Pull request/commit:** —
- **Deployment:** —
- **Follow-up tickets:** —
- **Known limitations accepted at closure:** —
