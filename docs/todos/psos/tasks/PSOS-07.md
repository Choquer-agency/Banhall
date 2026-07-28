# PSOS-07 — Schema: ownerId, workflowStage, workflowUpdatedAt + audit events + indexes

## Work control

- **Status:** `ready`
- **Phase:** P2
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
