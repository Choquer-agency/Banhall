# PSOS-01 — Domain contract: vocabulary, workflow rules, capability matrix, decision log

## Work control

- **Status:** `done`
- **Phase:** P0
- **Current owner:** Pi coding agent
- **Started:** 2026-07-24
- **Completed:** 2026-07-24
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Canonical domain contract completed, referenced from project instructions, acceptance-reviewed, and fully validated.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver.
- [x] Define the smallest safe rollout slice and rollback path.

Affected sources inspected: `convex/schema.ts`, `convex/lib/auth.ts`, `shared/roles.ts`, `convex/generations.ts`, relevant dashboard/project role and status consumers, and existing project instructions/docs.

Smallest rollout slice: documentation and instruction changes only. Rollback is deletion of `docs/product-domain.md` and removal of its `AGENTS.md` reference; no runtime/schema/data impact.

### 2. Implement

- [x] Complete backend/schema/domain work in scope. *(Documentation-only ticket; storage and invariants are specified, with no runtime code change.)*
- [x] Complete frontend/UX work in scope. *(Documentation-only ticket; interaction language and UX boundaries are specified.)*
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant. *(Captured as cross-cutting implementation rules for downstream tickets.)*
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant. *(Captured in the canonical contract.)*
- [x] Keep unrelated behavior and files unchanged.

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket. *(No runtime behavior changed; a structural contract validation script was run and the existing full suite passed.)*
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work. *(Not applicable: no UI implementation changed; the requirements are codified for downstream tickets.)*

### 4. Validate and close

- [x] Run targeted tests for the changed area. *(Contract structure assertions passed.)*
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`. *(`npm run check` is also the configured lint command; `git diff --check` passed.)*
- [x] Review the final diff for unrelated changes, unsafe migration behavior, and leaked secrets.
- [x] Update this file to `done`, record evidence, and update [`../README.md`](../README.md).

## Ticket specification

**Priority**: P0 — gates all later phases.
**Problem/user need**: The team lacks a durable, shared definition of Owner vs Creator vs
"With", workflow stages vs AI generation state, work items, branches, and outcomes.
Without it, later phases will encode conflicting semantics.
**Context**: Today `projects.createdBy` doubles as implicit ownership in UI copy; report
candidate selection is destructive; authorization is broadly internal-user. Docs live in
`docs/` (`design-system.md`, `svelte-migration.md`, `the-brain.md`).
**In scope**: New `docs/product-domain.md` (or `docs/psos/` set) covering:
- Canonical vocabulary: Creator (immutable `projects.createdBy`), Owner (`ownerId`,
  audited transfer), Work item, Current handoff (≤1 blocking per project), Workflow stage
  (intake, interview_complete, drafting, internal_review, client_review, revisions,
  ready_for_delivery, delivered, on_hold, abandoned), Generation state (reserved/running/
  awaiting_selection/awaiting_input/completed/failed — technical only), Draft branch,
  Outcome (delivered_to_client, used_in_filing, abandoned_quality, abandoned_scope,
  superseded, test_only).
- Stage transition matrix (allowed edges, who may perform, which are automatable later).
- Capability matrix draft: Consultant / Manager / Admin / Financial × operations.
- Decision log with explicit resolutions (or "deferred + default") for: project
  visibility (default: unchanged all-internal visibility; membership model deferred, see
  PSOS-30), ownership transfer authority (default: owner or manager/admin), delivery
  authority (who may mark delivered), stage automation triggers, financial data
  visibility (Financial + Admin), notification email provider selection, client-name
  normalization strategy, branch retention/archival policy, outcome capture timing
  (post-export prompt, non-blocking).
**Out of scope**: Any code.
**Acceptance criteria**:
- [x] Doc completed; every vocabulary term above is defined with its storage field. *(Not committed/merged at the user's instruction.)*
- [x] Stage transition matrix enumerates every allowed edge + authority.
- [x] Capability matrix covers all four roles × (own/transfer, stage change, assign,
      complete others' items, promote branch, record outcome, financial read/write,
      role admin).
- [x] Each of the nine listed decisions has a resolution or an explicit deferred default.
- [x] AGENTS.md references the doc so agents/devs load it for domain work.
**Dependencies/rollout**: None; blocks PSOS-08+. **Risks/open questions**: The nine
decisions themselves — unresolved ones must be marked deferred, not silently assumed.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-24 | Use the defaults already authorized in the PSOS plan for all nine decisions; mark visibility, financial scope, and email provider as deferred where implementation still needs a dedicated decision. | This ticket must prevent downstream teams from silently inventing behavior while avoiding unsupported claims of final implementation scope. | User-authorized PSOS plan |
| 2026-07-24 | Keep existing firm-wide internal read visibility until PSOS-30 explicitly changes it. | Current authorization grants broad internal access; changing it during ownership work would be a hidden security/product migration. | User-authorized PSOS plan |
| 2026-07-24 | Make documentation the entire rollout slice for PSOS-01. | Runtime/schema implementation is explicitly out of scope and belongs to downstream tickets. | Ticket scope |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Ready |
| 2026-07-24 | Inspected current project status, creator access, stored roles, generation states, and destructive candidate selection. | Confirmed the contract addresses actual code boundaries and known migration risks. |
| 2026-07-24 | Added `docs/product-domain.md`. | Vocabulary/storage contract, transition matrix, capability matrix, nine-decision register, lifecycle invariants, migration sequence, and amendment process documented. |
| 2026-07-24 | Updated `AGENTS.md` to require reading the domain contract for PSOS domain work. | Acceptance criterion implemented; downstream agents/developers receive the contract before editing. |
| 2026-07-24 | Ran structural assertions for canonical storage terms, all generation/outcome values, all four roles, all nine decisions, and the AGENTS reference. | All assertions passed. |
| 2026-07-24 | Ran `npm run check`, `npx tsc -p convex/tsconfig.json --noEmit`, `npm run test`, `npm run build`, and `git diff --check`. | 0 Svelte errors/warnings; Convex TypeScript passed; 7 test files/79 tests passed; production build passed; diff check passed. |

## Completion record

- **Pull request/commit:** Not committed at user request.
- **Deployment:** Not applicable; documentation-only change.
- **Follow-up tickets:** PSOS-02 through PSOS-36 are governed by this contract; PSOS-30 owns any future project-visibility restriction decision.
- **Known limitations accepted at closure:** Email provider, exact Financial read scope, and membership-based project visibility remain explicitly deferred; no runtime schema or authorization behavior changed in this ticket.
