# PSOS-14 — My Work dashboard: lanes, dense ledger rows, mobile cards

## Work control

- **Status:** `in_progress`
- **Phase:** P3
- **Current owner:** Implementation agent
- **Started:** 2026-07-29
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Implementation, adversarial review, automated validation, development backend rollout, backfill, and default-view enablement are complete. Authenticated live Chrome QA remains before closure.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant.
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

### 4. Validate and close

- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [ ] Update this file to `done`, record rollout evidence, and update [`../README.md`](../README.md).

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
- [x] `/dashboard` defaults to My work; All projects one tap away and unchanged in
      capability.
- [x] Each lane paginates via indexed queries only (no client-side global filtering).
- [x] Overdue/due-today/due-soon rendered as text labels + non-color affordance.
- [x] Inline complete updates lane + project `currentHandoffId` reactively.
- [x] Keyboard: tab through rows/actions; mobile targets ≥44px; svelte-check clean.
- [x] Empty/loading/error states per lane.
**Dependencies**: PSOS-11, PSOS-12. **Rollout**: feature-flag default-view switch;
revert path = flag flip.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-29 | Use a derived per-viewer oversight projection for exact Waiting on others pagination; owner-transfer fan-out must reconcile asynchronously with an explicit syncing state rather than an unbounded transaction. | Convex cannot paginate an exact OR across assigner and project Owner indexes with one cursor. | Opus plan + Codex verification |
| 2026-07-29 | Widen and dual-write `dueSortAt`/Stage-rank projections, backfill and exhaustively verify, then enable My Work reads. | Missing optional indexed values sort ahead of due values and cannot safely serve live lanes before backfill. | Opus plan + Codex verification |
| 2026-07-29 | Top-level view precedence is kill switch → explicit URL → browser-session preference → configured default. Never save the resolved flag default as a preference automatically. | Session memory respects user choice without permanently defeating future rollout defaults. | Product owner, refining Opus/Codex recommendation |
| 2026-07-29 | Due soon includes overdue work plus today and the next six `America/Vancouver` calendar dates; upper boundary is exclusive at the start of today + 7 days. | Keeps urgent missed work visible while giving a stable seven-date operating window. | Product owner |
| 2026-07-29 | Owned by me is one paginated pipeline list grouped and ordered by the canonical workflow sequence. | Gives an at-a-glance personal pipeline rather than requiring Stage-by-Stage navigation. | Product owner |
| 2026-07-29 | Superseded 2026-07-30: Consultant/Manager project creators initially defaulted Owner to themselves while Admin creation required explicit selection. | Retained as decision history; the product owner later simplified creation so every authenticated Creator, including an Admin, becomes the initial Owner. | Product owner |
| 2026-07-30 | Every new project's initial Owner is the authenticated Creator, including Admin creators; project creation has no Owner selector. A different Owner is assigned afterward through the audited transfer workflow. | Keeps creation simple while preserving immutable Creator history and explicit later ownership changes. | Product owner |
| 2026-07-29 | During ownership-transfer projection reconciliation, affected Waiting on others lanes show an explicit “Syncing assignments” state rather than stale or partial rows. | Avoids an unbounded transfer transaction and never presents incomplete data as authoritative. | Product owner |
| 2026-07-29 | Remember an explicitly selected My work / All projects view for the current browser session only. | Provides continuity within a session while allowing future configured defaults to take effect in new sessions. | Product owner |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-29 | Activated after PSOS-11/12 dependencies and PSOS-13 project-level assignment UX completed. | Claude Code Opus 5 planning started; implementation paused until independent Codex verification. |
| 2026-07-29 | Opus proposed indexed lane read models, transactional work-item projections, a derived Waiting union, a feature-flagged route split, dense desktop ledgers/mobile cards, and full migration/QA gates. | Implementation-ready direction established. |
| 2026-07-29 | Codex audited index ordering, cursor correctness, ownership-transfer fan-out, creation defaults, due-window semantics, feature flags, subscriptions, and migration safety. | Verdict `CHANGES REQUIRED`; corrections accepted into implementation. |
| 2026-07-29 | Added due-sort and Stage-rank projections, exact per-viewer Waiting rows, resumable ownership reconciliation, indexed lane queries, owner-safe project creation, and My Work/All projects view resolution. | Backend remains additive and feature-gated; All projects was extracted without capability changes. |
| 2026-07-29 | Added semantic desktop ledgers, mobile cards, explicit due text, inline Complete/Reassign, skeleton/empty/error/syncing states, ARIA lane tabs, session-only view memory, and Vancouver boundary refresh. | One active lane subscription at a time; action authority remains server-derived. |
| 2026-07-29 | Repeated Opus/Codex reviews remediated Waiting state loss, failed/chained rebuilds, dashboard fail-open, stale OCC loops, lifecycle-stage omission, rollout reachability, and Owned ledger metadata. | Final Opus and Codex verdicts **SHIP**. |
| 2026-07-29 | Deployed development Convex functions, completed live backfill `psos14-my-work-v1-live`, and enabled My work as the development default through the internal rollout mutation. | Backfill status `completed`; production untouched. |
| 2026-07-29 | Final automated gates before remediation review. | 486/486 unit/integration tests, 73/73 component tests (serial Chromium), Svelte check 0/0, Convex TypeScript clean, production build successful, `git diff --check` clean, detector `[]`. |
| 2026-07-29 | Fable 5 and Codex full-tree review identified roster authorization, object-oracle, durable backfill, readiness verification, terminal reconciliation, retry fingerprint, and abandonment-contract gaps. | All findings traced and remediated; product owner confirmed that abandonment must reject while open work remains, and the canonical contract now records the approved amendment. |
| 2026-07-29 | Final remediation validation and adversarial rereview. | 492/492 unit/integration tests, 74/74 component tests, Svelte check 0/0, Convex TypeScript and build clean, `git diff --check` clean; final Fable and Codex verdicts **SHIP**. |
| 2026-08-14 | Applied the approved Client → Fiscal year → Project repository amendment: richer identity cards, current-assignee and project-type filters, and explicit within-year sorting. | All-projects remains bounded and server-selected; loaded client pages are grouped by recorded fiscal year with unrecorded values clearly separated. Historical rows use the approved project-type dual-read fallback until backfill. |

## Completion record

- **Pull request/commit:** —
- **Deployment:** Development backend `energized-salamander-237`; backfill `psos14-my-work-v1-live`; default enabled. Production untouched.
- **Follow-up tickets:** —
- **Known limitations accepted at closure:** —
