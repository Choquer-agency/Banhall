# PSOS-17 — Email notifications: preferences, delivery ledger, idempotent retries

## Work control

- **Status:** `blocked`
- **Phase:** P3
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Blocked by product-domain decision D6: no notification email provider has been selected. Build PSOS-16 in-app notifications first; do not introduce provider-specific schema, secrets, or delivery behavior without explicit approval.

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
