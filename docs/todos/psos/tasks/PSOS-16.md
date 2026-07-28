# PSOS-16 — In-app notifications & Inbox (unread/read/archive, dedup)

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

**Priority**: P1.
**Problem**: Events (assigned, reassigned, completed, stage changed, generation failed)
reach no one; BNH-40 asked for scoped in-app notifications — this generalizes it.
**Context**: New `convex/notifications.ts`; Inbox surface on dashboard
(`src/routes/dashboard` inbox pane or `/dashboard/inbox`).
**In scope**: `notifications` table: userId, type, projectId?, workItemId?, actorId,
at, readAt?, archivedAt?, dedupeKey; indexes `by_userId_and_readAt`,
`by_userId_and_archivedAt`, `by_dedupeKey`. Emission from workItem/stage/ownership/
generation-failure mutations (in-transaction insert). Dedup: same dedupeKey within
window updates existing row instead of inserting. Inbox UI: stream of events, unread
badge count (denormalized counter per guidelines — no `.collect().length`), mark
read/unread, archive; **reading never completes the work item** (explicit rule; action
buttons deep-link to the item instead).
**Out of scope**: Email (PSOS-17), preferences beyond mute-nothing default.
**UX**: Ledger stream, newest first, plain sentences ("Bryce assigned you an internal
review on Acme 2025 — due Fri"); actor+action+object+due; no self-notifications;
keyboard operable; empty state "You're caught up."
**Acceptance criteria**:
- [ ] Every lifecycle mutation above emits exactly one notification to the right
      recipients (assignee on create/reassign; assigner on complete/decline; owner on
      stage change by others; no notification to the actor).
- [ ] Duplicate emission with same dedupeKey doesn't create a second row (test).
- [ ] Unread counter accurate under concurrent reads/marks (counter test).
- [ ] Reading/archiving never mutates work items.
- [ ] Paginated inbox; badge in nav.
**Dependencies**: PSOS-12; PSOS-09 events. **Rollout**: additive; backfill none.

### PSOS-17 · `PSOS P3 — Email notifications: preferences, delivery ledger, idempotent retries` *(conditional on provider decision)*
**Priority**: P2; blocked by PSOS-01 provider decision.
**Problem**: Off-app users miss handoffs; email must be restrained (no 700-notification
firehose) and observable.
**Context**: New `convex/notificationDelivery.ts`; send via Convex action + scheduler;
provider per PSOS-01 (e.g. Resend/Cloudflare Email — decision, not assumption); invites
already send email (`convex/invites.ts`) — reuse plumbing where possible.
**In scope**: Per-user preferences (immediate for blocking handoffs, off/daily for the
rest; default conservative: only blocking-handoff assignment + overdue reminder);
`notificationDeliveries` ledger: notificationId, channel, status (queued/sent/failed),
attempts, idempotencyKey, providerMessageId?, lastError?; indexes by notificationId +
by_status; retry with backoff via scheduler, idempotency key prevents double-send;
reminder scheduling (due-soon/overdue digests via cron in `convex/crons.ts`);
cleanup cron archiving old delivered rows; minimal observability query (failed sends
last 7 days) for admin.
**Out of scope**: Slack, rich digests (Phase 8).
**Acceptance criteria**:
- [ ] Given provider 500 then success, exactly one email delivered (ledger shows 2
      attempts, 1 sent) — idempotency test with mocked provider.
- [ ] Preferences honored; default sends only the conservative set.
- [ ] Overdue reminder fires once per item per day max (dedupe test).
- [ ] No secrets in logs/tickets; provider key via Convex env.
- [ ] Cleanup cron bounded batches.
**Dependencies**: PSOS-16, PSOS-01 decision. **Rollout**: enable per-user opt-in first,
then default-on for blocking assignments. **Risks**: provider unchosen → ticket stays
blocked, not assumed.

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
