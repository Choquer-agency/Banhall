# PSOS-20 — Branch tabs UI: switch, rename, duplicate, archive, make active, generate-another-model

## Work control

- **Status:** `not_started`
- **Phase:** P4
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
**Problem**: Users need visible, safe navigation between alternative drafts.
**Context**: Report editor route (`src/routes/project/[id]` report view); design system
tabs — dense text tabs, not cards; BNH-53 full-screen editor must coexist.
**In scope**: Tab strip listing branches (name, source model, status badge, updated);
actions per branch: rename, duplicate (new branch copying current content + fresh
snapshot lineage note), archive (hidden by default, "Show archived" reveal), make
active, promote (with confirm stating meaning); "Generate another model" entry creating
a new candidate branch via existing generation flow; active-branch indicator; promoted
badge.
**Critical safety**: switching active branch must not cross-contaminate autosave:
editor binds to branch's reportId explicitly; autosave mutation takes reportId +
expectedRevision (OCC) — a stale autosave from branch A after switching to B must
fail/no-op, never write into B (this is the corruption class to kill).
**Out of scope**: Comparison view (PSOS-21).
**UX/a11y**: Tabs keyboard-navigable (arrow keys, roving tabindex); actions in an
overflow menu with text labels; confirm dialogs for archive/promote; mobile: tabs
become a select/sheet; loading state while switching; unsaved-changes guard.
**Acceptance criteria**:
- [ ] Rapid switch during pending autosave: content lands only in originating branch
      (automated test with delayed mutation).
- [ ] Rename/duplicate/archive/make-active each write one audit event and update UI
      reactively.
- [ ] Duplicate copies content + starts new snapshot history with provenance note.
- [ ] Generate-another-model creates branch tied to new generation; failure surfaces
      via PSOS-05 patterns.
- [ ] Archived branches hidden by default, recoverable, never deleted.
- [ ] Keyboard + mobile + reduced-motion verified.
**Dependencies**: PSOS-18/19. **Rollout**: behind same flag as PSOS-19.

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
