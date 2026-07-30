# PSOS-12 — workItems + workItemEvents schema, invariants, transactional lifecycle

## Work control

- **Status:** `done`
- **Phase:** P3
- **Current owner:** Main coding agent
- **Started:** 2026-07-29
- **Completed:** 2026-07-29
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete on the development deployment after mandatory Opus planning/reviews and independent Codex audits. Additive work-item storage, immutable events, transactional current-handoff maintenance, versioned/idempotent lifecycle APIs, exact authorization, workflow integration, and project-state/delete guards are validated and ready for PSOS-13.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope. (No UI is in PSOS-12; PSOS-13 owns the composer.)
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work. (Not applicable: backend/domain ticket.)

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

**Priority**: P0 for phase.
**Problem**: No first-class actionable handoff exists; a single mutable field can't
carry kind/assigner/instructions/history.
**Context**: New module `convex/workItems.ts`; supersedes the data layer implied by
board ticket **BNH-40** (peer review assignment — fold its review-assignment semantics
into work item kind `internal_review`; note supersession on BNH-40 when adopted).
**In scope**:
- `workItems`: projectId, kind (`internal_review`, `revision`, `interview_followup`,
  `delivery_prep`, `financial`, `other`), assigneeId, assignerId, dueAt?, instructions,
  blocking (bool), status (`open`, `completed`, `declined`, `canceled`), completedAt?,
  completedBy?, resolutionNote?. Indexes: `by_assigneeId_and_status`,
  `by_projectId_and_status`, `by_status_and_dueAt`, `by_assignerId_and_status`.
- `workItemEvents` (immutable): workItemId, projectId, type (created/reassigned/
  blocking_changed/completed/declined/canceled/due_changed), actorId, at, detail. Indexes
  `by_workItemId`, `by_projectId`.
- Mutations: create, reassign, change blocking status, change due date, complete, decline (with reason), cancel — each atomic,
  each writing one event; **invariant: at most one open blocking work item per
  project**, enforced in-mutation (query `by_projectId_and_status` for open+blocking
  before insert/reassign-to-blocking; typed error `BLOCKING_EXISTS`).
- Denormalized pointer `projects.currentHandoffId` maintained by these mutations
  (nullable), so header "With" and lanes avoid joins.
- Completion history preserved (items are never deleted; cancel is a status).
**Authorization (pre-Phase-6)**: create = Owner/Manager/Admin; reassign, blocking changes, due changes, and cancel = original assigner/Owner/Manager/Admin; complete = current assignee or Manager/Admin with an audit note; decline = current assignee only. Encode through centralized capability helpers plus object-level facts.
**Acceptance criteria**:
- [x] Creating second blocking item on a project fails with typed error; non-blocking
      items unlimited.
- [x] Complete/decline/cancel are idempotent (second call no-ops or typed error, no
      duplicate events).
- [x] `currentHandoffId` always matches the open blocking item (property test across
      lifecycle sequences).
- [x] Permission-denial tests per operation per role.
- [x] Events immutable: no update/delete path exported.
**Dependencies**: PSOS-07/09. **Rollout**: additive tables; no backfill needed.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-29 | Keep PSOS-12 backend/domain-only; assignment composer, shortcut, and other UI remain PSOS-13. | Preserves the one-active-ticket boundary and allows additive storage/API rollout independently. | Queue dependency order |
| 2026-07-29 | Use the existing centralized capability presets and PSOS-09 workflow authority helpers rather than inventing parallel role logic. | Work-item authority must stay aligned with the approved product-domain matrix and later PSOS-27 hardening. | Existing product contract |
| 2026-07-29 | Authorized actors may change an open work item's blocking-handoff status. The mutation must use OCC, preserve the one-blocking-item invariant, update `currentHandoffId` transactionally, advance workflow authority/version when applicable, and write an immutable audit event. | Product prefers correcting/promoting an existing assignment without forcing a close-and-recreate workflow. | Product owner |
| 2026-07-29 | Work-item assignees must be active roster members with role `writer` (Consultant) or `manager`; Admins may administer work but are not assignable. | Aligns temporary assignment eligibility with accountable project Owner eligibility and avoids assigning operational work to administration-only accounts. | Product owner |
| 2026-07-29 | Until the Financial role/workspace ships, only Managers and Admins may create `financial` work items. Eligible Consultant/Manager assignees remain unchanged, and the item grants no financial-data access. | Allows controlled operational tracking without prematurely activating financial permissions or data visibility. | Product owner |
| 2026-07-29 | New work items are rejected for projects in `delivered` or `abandoned`; `on_hold` remains assignable. Any transition into `abandoned` must fail while open work items exist. | Delivered work must first be deliberately reopened to `revisions`; abandoned projects cannot receive or retain unfinished work. | Product owner |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-29 | Activated after PSOS-11 closure and inspected the domain contract, Convex guidance, schema, auth helpers, capability presets, workflow mutations, and test patterns. | Dependencies PSOS-07 and PSOS-09 are complete. |
| 2026-07-29 | Mandatory Opus plan and Codex audit completed; both identified exact authorization, idempotency, OCC, pointer, and workflow-integration requirements. | Four product questions were resolved before implementation: mutable blocking status, Consultant/Manager assignees, Manager/Admin-only financial creation, and no new work on Delivered/Abandoned projects. |
| 2026-07-29 | Added additive `workItems`, immutable typed `workItemEvents`, optional `currentHandoffId`, create-request fingerprints, item/workflow versions, lifecycle mutations, read APIs, and workflow-handoff validation. | Focused work-item/workflow/capability tests pass 28/28; Convex TypeScript and Svelte check are clean. |
| 2026-07-29 | Opus 5 and Codex adversarial reviews returned changes required. | Remediated anonymous/roleless access, read authorization, terminal no-op authorization, immutable create replay, Delivered handoff promotion, bounded pointer validation, timestamp/page validation, workflow authority coverage, and lifecycle property coverage. |
| 2026-07-29 | Opus/Codex re-review found two final correctness gaps plus acceptance-test gaps. | Added project-deletion guard for open work, exact invalid-timestamp replay validation, per-operation Consultant denial tests, stale-version tests, stronger pointer lifecycle sequences, and updated the domain contract from planned to implemented storage. |
| 2026-07-29 | Final Opus 5 and Codex reviews both returned **SHIP**. | No in-scope release blockers. Full suite 472/472, component suite 66/66, Svelte check 0/0, Convex TypeScript clean, production build successful, and `git diff --check` clean. |
| 2026-07-29 | Ran `npx convex dev --once`. | Development functions ready at `https://energized-salamander-237.convex.cloud`; additive schema requires no backfill. |

## Completion record

- **Pull request/commit:** Not committed yet; awaiting explicit release instruction.
- **Deployment:** Development Convex deployment `energized-salamander-237`; production untouched.
- **Follow-up tickets:** PSOS-13 assignment composer; PSOS-14 personal lanes; PSOS-27 capability migration/admin repair hardening.
- **Known limitations accepted at closure:** Closed work-item history remains if a project is deleted; future history views must tolerate a missing project or adopt an archival policy. Pointer inconsistencies caused only by out-of-band/manual writes fail closed and currently require developer repair. PSOS-14 lane-specific indexed query APIs remain in PSOS-14 rather than expanding this lifecycle ticket.
