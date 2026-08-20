# PSOS-10 — Project header & list metadata: Stage, Owner, With, Due as labeled data

## Work control

- **Status:** `done`
- **Phase:** P2
- **Current owner:** Main coding agent
- **Started:** 2026-07-28
- **Completed:** 2026-07-28
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Implemented and development-deployed after mandatory Claude Code Opus 5 planning, adversarial review, remediation, re-review, and final **SHIP** verdict. The project workspace exposes truthful workflow metadata/actions; dashboard cards use Stage as the primary badge/theme without repeating Owner or Stage in the footer. Detailed plan: [`PSOS-10-implementation-plan.md`](PSOS-10-implementation-plan.md).

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
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P1.
**Problem**: UI conflates creator with owner and hides who has the next action.
**Context**: Project page under `src/routes/project/[id]`, list under `src/routes/dashboard`
(current all-projects view; BNH-36 company→fiscal-year grouping preserved); header
components in `src/lib/components`.
**In scope**: Header block showing **Stage** (human label), **Owner** (avatar+name),
**With** (assignee of open blocking handoff, or "—" until Phase 3 lands; component reads
optional field so it lights up when PSOS-14 ships), **Due** (from handoff; absolute date
+ relative text, not color-only); owner transfer UI (dialog → PSOS-09 mutation) and
stage change control (only valid next stages offered; server still validates); project
list rows gain Owner + Stage columns.
**Out of scope**: New dashboard lanes (PSOS-11), work-item creation (Phase 3).
**UX**: Four separately labeled data slots, Geist Mono for metadata per design system;
transfer/stage dialogs keyboard-operable; failure state on rejected transition shows
server reason plainly.
**Acceptance criteria**:
- [x] Header shows all four slots with graceful "—" empties; never shows createdBy as
      "Owner".
- [x] Stage control offers only matrix-valid next stages; server rejection surfaces.
- [x] Transfer writes audit event and updates header reactively.
- [x] Mobile: header collapses to stacked rows, targets ≥44px.
- [x] svelte-check + component tests for empty/loading/error.
**Dependencies**: PSOS-07/09. **Rollout**: ship behind nothing — additive display.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Implement dashboard Owner + Stage as labelled metadata inside the existing `ProjectCard`, not as a new row/table view. Preserve company → fiscal-year grouping, recency cards, filters, sorting, and bulk selection. | The dashboard has no list-row presentation; a table would expand into PSOS-11/38 and replace approved BNH-36 behavior. | Product owner |
| 2026-07-28 | Relabel legacy writer/creator-derived UI from “Consultant” to **Created by** where Owner is introduced; never use `createdBy` or historical `writer` as Owner. | Current display metadata represents immutable origin history, not accountable ownership. | Approved product-domain contract |
| 2026-07-28 | Show prerequisite-gated workflow stages disabled with explicit reasons rather than hiding them or sending guaranteed-failure mutations. | Keeps the lifecycle understandable while respecting PSOS-09 fail-closed requirements for handoffs, promoted branches, and outcomes. | Claude Code Opus 5 plan |
| 2026-07-28 | Return viewer workflow authorities from the server helper used by mutations; client-side filtering remains an affordance only. | Prevents authorization drift when handoff and capability work ships. | Claude Code Opus 5 plan |
| 2026-07-28 | Until work items exist, **With** and **Due** are explicit `null` values rendered as `—`; do not infer either from Owner, Creator, writer, interviewer, stage, or legacy status. | PSOS-12 owns work-item and current-handoff storage. | Approved product-domain contract |
| 2026-07-28 | Capture `expectedVersion` when a dialog opens; stale changes require explicit retry. A mutation `noop` gets neutral feedback and no success claim. | Preserves OCC meaning and truthful idempotency feedback. | PSOS-09 contract |
| 2026-07-28 | Render one focused workflow bar immediately below `PageBar`, outside report-state branches, with responsive disclosure/stacking below 768px. | Workflow metadata must remain visible during generation, failure, iterative drafting, candidate selection, and editing without bloating the route. | Claude Code Opus 5 plan |
| 2026-07-28 | Keep future `createProject` owner/stage writes out of PSOS-10. New owner-less projects display `Owner —`; missing stage remains effective `Intake` only for server transition compatibility and displays as **Legacy status only** until explicitly persisted. | Avoids silently expanding this UI ticket into a new mutation contract while preserving truthful storage state. | Scope boundary |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code Opus 5 completed a read-only adversarial review of the ticket, current dashboard/report surfaces, PSOS-09 APIs, responsive constraints, tests, and dirty workspace boundaries. | **PLAN READY**, conditional on recorded decisions and backend-before-frontend rollout. No files were implemented or deployed. |
| 2026-07-28 | Product owner selected the recommended dashboard direction. | Owner + Stage will be added as labelled slots in existing project cards; no row/table redesign. |
| 2026-07-28 | Added `PSOS-10-implementation-plan.md`. | Ordered backend, shared logic, component, route, dashboard, validation, Chrome QA, rollout, and rollback plan recorded. |
| 2026-07-28 | Product owner requested implementation. | PSOS-10 moved to `in_progress` as the sole active implementation; approved scope and dirty-workspace boundaries preserved. |
| 2026-07-28 | Added shared workflow labels/options and bounded Convex header/candidate projections; wired PSOS-09 mutations through a focused Svelte container. | Owner derives only from `ownerId`; With/Due remain truthful nulls; authority is server-derived; OCC version is captured at action-open. |
| 2026-07-28 | Added responsive workflow metadata, stage/transfer dialogs, dashboard Owner + Stage slots, and Created-by relabelling. | Existing company → fiscal-year grouping and report workspace behavior remain intact; mobile uses a 50px collapsed disclosure and ≥44px actions. |
| 2026-07-28 | Initial Opus adversarial review returned **CHANGES REQUIRED**. | Resolved conflicting Creator surfaces, rail alignment, mobile height, grid rules, keyboard radiogroups, truthful owner/unavailable states, and query failure states. |
| 2026-07-28 | Re-review found a shared-OCC violation in PSOS-08 ownership review writes. | `ownerBackfill` and `assignOwnerFromReview` now advance `workflowVersion`; stale PSOS-10 transfer dialogs fail `STALE_REVISION` and preserve the reviewed owner. |
| 2026-07-28 | Validation and signed-in installed-Chrome/CDP QA completed. | 436/436 unit/integration tests, 53/53 component tests, Svelte check 0/0, Convex TypeScript clean, production build successful, `git diff --check` clean. Chrome at 1440/768/375/320 showed no project overflow, correct 1152px rail, 50px mobile summary, one Creator label, 44px controls, accessible disabled prerequisite reasons, and no console errors. |
| 2026-07-28 | Final Claude Code Opus 5 adversarial review. | **SHIP** — no blockers; development backend deployed to `energized-salamander-237`. |
| 2026-07-28 | Follow-up semantic review identified that the legacy Draft/Review/Final badge still competed with canonical workflow Stage. | Implemented the contract-compatible correction: Stage is now the sole primary project badge/theme when present, AI activity is explicitly secondary, stage filters replace legacy-status filters, and the workspace follows the same hierarchy. |
| 2026-07-29 | Codex and Opus post-implementation standards review returned **CHANGES REQUIRED**. | Fixed stage-less records falsely displaying Intake across cards, workflow metadata, and the stage dialog; visible/contrasting legacy qualification; dark-header badge contrast; mobile AppNav crowding; AI-chip hierarchy/live status; the mobile stage-filter target; owner-less loading; and real component regressions. Restored exact indexed active-generation fallback after review rejected a bounded full-document read. |
| 2026-07-29 | Final Opus and Codex re-reviews completed after all blockers and contrast findings were resolved. | Both returned **SHIP**. Final gates: 448 unit/integration tests plus the pointerless legacy-generation regression, 64 component tests, Svelte check 0/0, Convex TypeScript clean, production build successful, and development Convex functions ready. |
| 2026-07-29 | Product owner removed the repeated Owner and Stage slots from dashboard report/PD cards. | Stage is already communicated by the canonical header badge/card theme, and ownership remains available in the project workflow surface; the card footer now retains only Created by and Updated metadata. |
| 2026-07-29 | Product owner approved the Opus/Codex workflow-bar review recommendation. | Replaced the permanent four-slot workflow strip with a compact PageBar disclosure. Stage remains the sole persistent AppNav state; the disclosure shows Stage and Owner, omits pre-PSOS-12 With/Due placeholders, preserves authority/OCC dialogs, and adds authenticated retry plus note-preserving stale-value recovery. |
| 2026-07-29 | Claude Code Opus 5 planned and reviewed the workflow disclosure implementation; Codex independently reviewed and re-reviewed remediation. | Final verdicts: **SHIP**. Chrome/CDP at 1440/1024/768/375/320 confirmed the PageBar remains 44px, no old strip or overflow, Stage/Owner-only details, and no console errors. Final gates: 449 unit/integration tests, 66 component tests, Svelte check 0/0, Convex TypeScript clean, production build successful, detector clean, and development Convex functions ready. |

## Completion record

- **Pull request/commit:** Uncommitted at user request; no push performed.
- **Deployment:** Convex development — `https://energized-salamander-237.convex.cloud`
- **Follow-up tickets:** PSOS-11 owns indexed/paginated dashboard projections and eliminating the temporary bounded roster join; PSOS-12/14 populate With/Due; the create-project path still needs an owner/stage write follow-up.
- **Known limitations accepted at closure:** `ready_for_delivery` and `delivered` remain intentionally unavailable until promoted-branch and exact-outcome storage ships; `on_hold → internal_review` remains unavailable until an active review handoff exists *(superseded 2026-08-17: the open-matrix amendment removed the review-handoff requirement)*. Newly created projects may use an explicitly labelled legacy-status fallback until create-time workflow writes are implemented. Publish/share, finalization, and duplication still update legacy `projects.status` without silently advancing workflow stage; their future confirmed stage prompts belong to separate workflow action tickets. Production frontend rollout remains gated on the uncommitted PSOS-08/09/10 backend stack being committed and deployed to production first.
