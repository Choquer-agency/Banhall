# PSOS-05 — Generation failure & recovery surface in project header

## Work control

- **Status:** `in_review`
- **Phase:** P1
- **Current owner:** Pi coding agent
- **Started:** 2026-07-28
- **Completed:** —
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Implementation, Convex development deployment, and signed-in live recovery QA are complete. A user-safe recovery projection, failed-model-only linked retries, preserved ready candidates, header status chip, partial/full recovery UX, and raw-error sanitization shipped locally. Final Claude Code/Fable 5 verdict: SHIP. Green gates: 371 unit/integration tests, 38 installed-Chromium component tests, clean Svelte/Convex typechecks, production build, diff check, and installed-Google-Chrome CDP validation of a genuine partial failure through successful recovery. Awaiting commit/push and production frontend rollout before `done`.

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
**Problem**: When one model in a multi-model generation fails or a generation stalls,
users see confusing partial states and cannot recover without support.
**Context**: `convex/generations.ts` (statuses reserved/running/awaiting_selection/
awaiting_input/completed/failed; existing retry + stale-generation cleanup — reuse,
don't rebuild), `reportCandidates`, project page under `src/routes/project`. Related:
BNH-21 (loading screen), BNH-52 (duplicate-run prevention).
**In scope**: Project-header status chip for active/failed generations; failure panel
listing per-model outcome, retaining completed model results while showing failed ones
with "Retry failed model(s)" and "Continue with completed results" actions; wire to
existing retry mutation; stall detection surfaced via existing stale cleanup.
**Out of scope**: Branch materialization (Phase 4); new generation engine work.
**UX**: One obvious next action; plain-language failure text ("Claude's draft didn't
complete. Two other drafts are ready."); no provider error dumps or model internals
beyond friendly model names; chip is text+shape, not color-only.
**Technical notes**: query by `generations.by_projectId_and_status`; retry must be
idempotent (reuse guards from BNH-52 work); header component in project layout.
**Acceptance criteria**:
- [ ] Given 3-model run with 1 failure, header shows partial-failure state; completed
      candidates remain selectable; retry re-runs only the failed model.
- [ ] Given full failure, user can retry all from header without navigating to logs.
- [ ] Retry is idempotent under double-click (single new generation attempt).
- [ ] Stale (stuck >threshold) generations surface as failed-with-retry, not spinner.
- [ ] Tests: retry idempotency; partial-state query; component states (running/partial/
      failed/recovered).
**Dependencies**: none. **Rollout**: pure additive UI + query.

## Claude Code/Fable planning pass

The 2026-07-28 high-reasoning audit reviewed all 36 PSOS tasks, current code, Git history, the domain contract, Svelte migration rules, and Convex guidelines. It recommended PSOS-05 next because recent generation-alert fixes reduce provider failures but do not implement the meeting-requested recovery surface.

### Verified starting point

- `generationCandidateRuns` already stores one durable row per model with queued/running/succeeded/failed state.
- `retryGeneration` handles full failures, while `reserveGeneration` and `activeGenerationId` fence overlapping whole generations.
- `failStaleGenerations` converts stranded runs to recoverable failed states.
- `GenerationProgress.svelte` has a full-failure retry button, but renders stored raw errors.
- Partial failures end in `awaiting_selection`; `CandidateSelection.svelte` does not acknowledge failed models, and the existing retry mutation rejects this state.

### Smallest safe implementation slice

1. Add a bounded, access-controlled generation recovery projection that returns friendly model labels and statuses but never raw provider errors.
2. Add an idempotent mutation for retrying only failed non-ghost candidate models while preserving every successful candidate. Retry work is represented by a fresh linked generation containing only the failed models; the original successful candidates remain selectable and immutable.
3. Add user-safe shared generation-status copy and replace raw stored errors in product UI, including the visible activity log.
4. Add a dense partial/full failure panel and header status chip, with one obvious retry action and an explicit “Continue with ready drafts” path.
5. Cover partial, full, stale, double-submit, authorization, unknown/legacy payload, keyboard, touch-target, and responsive states.
6. Deploy Convex before any frontend depending on the new projection/mutation. Rollback is frontend-first; additive server functions and linked retry rows are safe to leave in place.

### Explicit scope boundaries

- No report-branch materialization or preservation change; PSOS-18/19 still own persistent alternatives after selection.
- No human workflow-stage updates; generation state remains technical per the domain contract.
- No new provider engine behavior; recent provider-budget/structured-output fixes remain separate failure-prevention work.
- Ghost iterative comparison runs are excluded from recovery counts and retries.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Sanitize the activity log as part of PSOS-05 rather than exposing stored provider strings behind “Show activity.” | The product-domain contract prohibits raw provider/Convex strings in end-user copy; leaving the expandable log unsanitized would violate the same acceptance goal as the failure panel. | Existing approved domain contract |
| 2026-07-28 | Retry failed models in a new linked generation instead of mutating terminal candidate-run rows in place. | Candidate-run rows are durable attempt history; a linked retry preserves auditability, uses existing scheduling/fencing, and avoids resetting immutable evidence. Successful candidates in the original generation remain available. | Implementation decision |
| 2026-07-28 | A partial-retry generation may contain one or more explicitly persisted compare models. | The existing compare-mode pipeline is model-list driven; allowing a bounded non-empty retry subset avoids rerunning successful models without introducing a new generation mode. | Implementation decision |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-28 | Claude Code/Fable 5 program audit and independent Codex code-reality audit completed. | Both audits recommended PSOS-05 next and verified the same missing recovery/UI paths; no implementation edits preceded planning. |
| 2026-07-28 | Ticket selected as the sole active queue item; queue/dependency metadata reconciled. | Implementation started under the one-active-ticket rule. |
| 2026-07-28 | Added the authenticated bounded recovery projection and linked failed-model retry mutation. | Successful candidates and original attempt rows remain intact; only failed non-ghost models are scheduled in a fresh generation. Legacy model pairs are proven from durable runs or rejected without random fallback. |
| 2026-07-28 | Added `GenerationRecoveryPanel`, `GenerationStatusChip`, safe activity copy, and CandidateSelection recovery controls. | Partial and full failures have plain-language next actions; product UI no longer renders compare-generation provider errors or raw progress logs. |
| 2026-07-28 | Added Convex, unit, and browser-component regressions. | Covers projection privacy, authentication, linked retry idempotency, legacy rollback, seeded retry success/re-failure math, copy, statuses, 44px targets, and partial/full UI. |
| 2026-07-28 | Claude Code/Fable post-implementation review found two blockers. | Fixed the remaining raw-error status line and prevented legacy retries from falling through to a random compare pair; added seeded terminalization tests. Final re-review verdict: **SHIP**, no blockers. |
| 2026-07-28 | Final validation and Convex development deployment completed. | 371/371 unit/integration tests, 38/38 component tests, `npm run check` 0 errors/warnings, Convex TypeScript clean, production build passed, `git diff --check` clean. Installed Google Chrome was launched directly with CDP on port 9222; `/styleguide` loaded with the current Svelte bundle and no undefined-resource failures. |
| 2026-07-28 | Signed in through installed Google Chrome as an administrator and opened genuine partial generation `k579qgcv1e69acsrpaxam2cmgs8b9cqa` for project `k97cdf1xg9x6dqenftwe59ncq98b9rt3`. | Header showed “Some drafts need retry”; Opus 4.8 remained fully selectable; Sonnet 5 showed “Needs retry”; recovery copy exposed no provider details. |
| 2026-07-28 | Activated “Retry failed drafts” once in the live development UI. | Created linked generation `k574pkzy3favphj2vqat820a7x8bcqwd`, persisted `retryModelIds: [claude-sonnet-5]`, seeded the completed Opus candidate, and scheduled only Sonnet 5. |
| 2026-07-28 | Waited for the exact live retry to terminalize and reloaded the project in Chrome. | Recovery reached `awaiting_selection` with `candidatesDone: 2`, `candidatesFailed: 0`; both Sonnet 5 and Opus 4.8 were selectable, header returned to “Ready for your review,” original generation history remained linked, and no raw provider error appeared. |

## Completion record

- **Pull request/commit:** Uncommitted implementation pending scope-reviewed integration.
- **Deployment:** Convex development functions deployed to `energized-salamander-237` with `npx convex dev --once`; frontend production not deployed.
- **Follow-up tickets:** PSOS-18/19 remain responsible for persistent branches and non-destructive post-selection alternatives. Iterative-mode raw internal error copy is a separate pre-existing hardening follow-up.
- **Known limitations accepted at closure:** Ticket remains `in_review` only because the implementation is uncommitted and the frontend has not been rolled out to production. Signed-in live partial-failure recovery QA passed in installed Google Chrome against Convex development.
