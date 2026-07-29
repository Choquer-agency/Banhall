# PSOS-08 — Ownership/stage backfill: writer matching, creator fallback, ambiguity queue

## Work control

- **Status:** `done`
- **Phase:** P2
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** 2026-07-28
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete on the configured development deployment. Claude Code/Fable 5 planning verdict **PLAN READY** and adversarial review verdict **SHIP**. The bounded migration backfilled all 30 development projects, persisted exact run totals, wrote 60 immutable events, and left five creator-fallback rows for deliberate Admin review after one fallback was confirmed in signed-in Chrome. PSOS-04 remains a separate production-frontend release-QA item.

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
- [x] Deploy schema/functions, run development dry-run/live migration with an Admin actor and stable run key, verify the review queue in signed-in Chrome, then close this ticket.

## Ticket specification

**Priority**: P1.
**Problem**: Existing projects need Owners and stages without destroying legacy data or
guessing wrong silently.
**Context**: Legacy `writer` free-text on projects (BNH-22 added interviewer/writer
fields); `users` table with `by_email`; migration patterns per convex-migration-helper
(batched, idempotent, self-rescheduling mutations).
**In scope**:
- Backfill mutation (batch + `ctx.scheduler.runAfter` continuation): match legacy
  `writer` text → user (exact email, then exact normalized full-name, unique matches
  only) → set `ownerId` + `ownership_transferred` event with `note: "backfill:writer"`;
  else fall back to `createdBy` with `note: "backfill:creator-fallback"`.
- Ambiguous/no-match projects flagged into a review queue (field
  `ownerBackfillStatus: "needs_review"` or dedicated table) with admin UI list to
  resolve manually (simple table under `src/routes/admin`).
- Stage backfill heuristic: delivered-ish signals (exported/published) →
  `delivered`? NO — default conservative: projects with a selected report →
  `drafting`, else `intake`; record heuristic in event note; admins can correct.
- Legacy `writer` field retained untouched (narrow later, separate decision).
**Acceptance criteria**:
- [x] Backfill idempotent (re-run produces zero new events) and resumable mid-batch.
- [x] Every project ends with ownerId + workflowStage; unresolvable present writer text is additionally flagged `needs_review`; final live-run counts can be persisted by stable run key.
- [x] No legacy field deleted or overwritten.
- [x] Admin review queue lists ambiguous/no-match projects with live candidate matches and one-click assign (writes audited transfer).
- [x] Tests: matcher unit tests (exact/ambiguous/none), idempotency, manual cursor batching, actual scheduled continuations, report counts, OCC, role validation, and review resolution.
**Dependencies**: PSOS-07. **Rollout**: run in prod off-hours; monitor via counts.
**Risks**: name collisions; wrong-owner assignment is recoverable via audited transfer.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | For present but unresolvable writer text, assign `createdBy` as the safe fallback **and** set `ownerBackfillStatus: "needs_review"`; absent/blank writer text falls back without a review flag. | Reconciles the ticket's fallback requirement with its ambiguity-queue requirement while ensuring no migrated project remains ownerless. | Claude Code/Fable plan; implementation default |
| 2026-07-28 | Stage backfill is `drafting` when any durable `reports` row exists, otherwise `intake`; legacy `status`, exports, and publications never infer `delivered`. | Selected candidates materialize as reports; the approved domain contract requires conservative stage inference. | Approved product-domain contract |
| 2026-07-28 | The internal backfill takes and validates an explicit Admin `actorId`, threaded through every continuation. | `projectEvents.actorId` is required and immutable; a synthetic system user would pollute the team roster and weaken attribution. | Claude Code/Fable plan |
| 2026-07-28 | Store only optional `ownerBackfillStatus: "needs_review"` on projects and recompute live candidate matches for the admin queue. | Stored candidate arrays would become stale after profile changes; the transfer event is the durable resolution audit. | Claude Code/Fable plan |
| 2026-07-28 | Backfill patches do not change `projects.updatedAt` or any legacy identity/status field. | A migration must not reorder the dashboard or masquerade as human project edits. | Claude Code/Fable plan |
| 2026-07-28 | Keep `createProject` behavior unchanged in this ticket; rerun the idempotent backfill before PSOS-10 and let PSOS-09 own future owner/stage writers. | Prevents scope overlap with validated transition/write APIs. | Claude Code/Fable plan |
| 2026-07-28 | The ambiguity queue and resolution mutations are Admin-only. | Matches existing `/admin` surfaces; Manager reassignment behavior belongs to PSOS-09/27 capability migration. | Claude Code/Fable plan |
| 2026-07-28 | Use the repository's bounded paginate/self-schedule migration pattern rather than adding `@convex-dev/migrations` mid-ticket. | `convex/emailMigration.ts` already provides a tested dry-run/resume precedent and no new dependency is required. | Claude Code/Fable plan |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | PSOS-04 release-QA status reconciled with queue sequencing. | It remains a separate production-frontend QA gate; PSOS-08 is allowed as the sole active implementation because the scopes do not overlap. |
| 2026-07-28 | Claude Code/Fable 5 completed a read-only adversarial planning pass. | **PLAN READY.** Eight implementation decisions recorded above; no blocker remains. |
| 2026-07-28 | Implemented optional review status/index, exact owner matcher, bounded dry-run/live migration, immutable events, stable run-summary records, and Admin review APIs/UI. | Legacy writer/creator/status/updatedAt remain untouched; no `delivered` inference; duplicate emails and names fail safely to creator plus review. |
| 2026-07-28 | Claude Code/Fable 5 completed the mandatory adversarial post-implementation review. | **SHIP.** No blocking defect. Resolved its operational recommendations: durable final totals, newly unique live candidates, role-less target rejection, and scheduler/report tests. |
| 2026-07-28 | Local validation completed. | 411/411 unit/integration tests, 43/43 browser-component tests, Svelte check 0 errors/warnings, clean Convex TypeScript, successful production build, Svelte autofixer clean, and `git diff --check` clean. |
| 2026-07-28 | Deployed Convex schema/functions to `energized-salamander-237` and ran bounded preflight plus complete dry run. | Preflight: 30 projects missing owner/stage, 9 roster users, no duplicate normalized emails. Dry run: 24 writer matches, 6 creator fallbacks/review flags, 22 `drafting`, 8 `intake`, 0 delivery inference. |
| 2026-07-28 | Ran the live self-scheduled migration with stable run key `psos08-dev-20260728-1519`. | Postflight: 0 missing owners, 0 missing stages, 6 review rows. Durable run summary matched dry run exactly. Audit table contained exactly 30 ownership and 30 stage events. A repeat dry run produced zero writes and skipped all 30 owner/stage fields. |
| 2026-07-28 | Signed-in Chrome 150/CDP verified `/admin/backfill` at desktop and 375×812. | Admin-only queue rendered six truthful rows; all new row actions measured ≥44px after replacing the compact shared combobox with a native select; table remained horizontally operable without body spill; no malformed `undefined`/`null` requests or alert state. Confirming one creator fallback removed exactly one row in real time without adding a fake ownership-transfer event. Final queue: five rows.

## Completion record

- **Pull request/commit:** Uncommitted at user request.
- **Deployment:** Convex development deployment `https://energized-salamander-237.convex.cloud`; migration run summary `psos08-dev-20260728-1519` completed successfully. Frontend was verified through the local Svelte development server against the deployed development backend.
- **Follow-up tickets:** PSOS-09 owns future project owner/stage writers and validated transition APIs; rerun this idempotent backfill immediately before PSOS-10 if projects were created in the interim.
- **Known limitations accepted at closure:** Five historical writer labels remain intentionally queued for human review; no automatic fuzzy matching is permitted. `createProject` remains unchanged until PSOS-09, so projects created after this run require a safe rerun.
