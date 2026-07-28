# PSOS internal work queue

This directory is the internal source of truth for executing the **Banhall Professional Services Operating System** plan one independently managed work item at a time.

- **Master product/ticket context:** [`../../futur-board-ticket-breakdown-psos.md`](../../futur-board-ticket-breakdown-psos.md)
- **Task specifications:** [`tasks/`](tasks/)
- **Total work items:** 36
- **Current work item:** **PSOS-04** — mixed-upload processing receipt with per-file statuses (`in_review`)
- **Next ready work item:** **PSOS-05** — generation failure & recovery surface in project header
- **Also dependency-ready:** PSOS-06, PSOS-07, PSOS-26, PSOS-30
- **Queue state:** PSOS-04 implementation and all local gates are complete; final Fable audit says SHIP WITH KNOWN LIMITATIONS. Awaiting signed-in Chrome release QA, scope-reviewed commit, and Convex-first deployment before `done`.

## Operating rules

1. **One active ticket by default.** Only one ticket may use `in_progress` unless this file explicitly records a parallel-work exception with non-overlapping files and dependencies.
2. **Claude Code plan and review are mandatory.** Before editing an active ticket, run a Claude Code/Fable high-reasoning planning pass and record its recommendations in the ticket. After implementation and local validation, run a separate Claude Code review pass; resolve or explicitly disposition every finding before closure.
3. **Pull work in dependency order.** A ticket becomes `ready` only when dependencies are done or a waiver is documented in that ticket's decision log.
4. **Acceptance criteria are the delivery contract.** Check criteria individually and record test, screenshot, query, or manual-verification evidence in the ticket.
5. **No hidden scope expansion.** New requirements become a follow-up ticket or an explicit amendment to the active ticket before implementation.
6. **Migrations use widen → backfill → narrow.** Narrowing/removal is a separate work item unless the ticket explicitly and safely covers it.
7. **Server authorization is mandatory.** UI hiding is never authorization.
8. **Close cleanly.** A ticket is not `done` until checks/tests/build pass, Claude Code's post-implementation review is resolved, rollout and rollback are documented, the work log is updated, and this queue reflects the result.
9. **Pause on product decisions.** Do not silently decide project visibility, delivery authority, notification provider, or other PSOS-01 decisions inside an implementation ticket.

## Status model

| Status | Meaning |
|---|---|
| `not_started` | Defined but not yet dependency-ready or selected. |
| `blocked` | Cannot proceed; blocker and owner must be recorded in the task file. |
| `ready` | Dependencies and decisions are complete; safe to pull next. |
| `in_progress` | The single actively implemented item. |
| `in_review` | Implementation complete; acceptance evidence/QA underway. |
| `done` | Acceptance criteria and definition of done satisfied. |
| `deferred` | Intentionally postponed with reason and revisit trigger. |

## How to start a work item

1. Select the highest-priority `ready` item from the execution order.
2. In its task file, set status to `in_progress`, owner, start date, and immediate progress note.
3. Update **Current work item** above and the status in the phase table below.
4. Run the Claude Code planning pass, record its output/decisions in the task, inspect current code, and update the task's decision log before changing implementation.
5. Execute its **Prepare → Implement → Verify → Validate and close** checklist.
6. Move to `in_review`, run a fresh Claude Code post-implementation review, resolve/disposition every finding, gather acceptance evidence, then mark `done` and unlock dependents.

## Definition of ready

- [ ] Dependencies are `done` or explicitly waived.
- [ ] Product decisions required by the ticket are resolved.
- [ ] Existing related BNH tickets have been checked to avoid duplicate work.
- [ ] Claude Code/Fable high-reasoning planning pass is complete and recorded.
- [ ] Scope, affected modules, rollout, and rollback are understood.
- [ ] Acceptance criteria are testable without inventing missing product behavior.

## Definition of done

- [ ] Every ticket acceptance criterion is checked with evidence.
- [ ] Authorization, audit, OCC/idempotency, migrations, and failure states were handled where relevant.
- [ ] Targeted and full required validation passed.
- [ ] Accessibility and responsive behavior were verified for UI changes.
- [ ] Rollout/backfill completed or has an explicitly owned deployment step.
- [ ] Documentation, task work log, queue status, and follow-ups are current.
- [ ] Claude Code/Fable post-implementation review is complete and every finding is resolved or explicitly accepted.
- [ ] No unrelated changes or secrets are present in the final diff.

## Recommended execution order

The first delivery train should proceed as follows:

1. **Contract:** PSOS-01.
2. **Parallel-safe reliability work after the contract:** PSOS-02 through PSOS-06, one at a time unless an explicit parallel exception is recorded.
3. **Core workflow foundation:** PSOS-07 → PSOS-08 → PSOS-09 → PSOS-10, with PSOS-11 after PSOS-07.
4. **Assignments:** PSOS-12 → PSOS-13; then PSOS-14; then PSOS-15/16; PSOS-17 only after the provider decision.
5. **Branches:** PSOS-18 → PSOS-19 → PSOS-20 → PSOS-21.
6. **Outcomes:** PSOS-22 → PSOS-23 → PSOS-24/25.
7. **Capabilities:** PSOS-26 → PSOS-27 → PSOS-28/29. PSOS-30 remains a decision task unless visibility scope is approved.
8. **Financial workspace:** PSOS-31 → PSOS-32 → PSOS-33 → PSOS-34.
9. **Backlog:** PSOS-35 and PSOS-36 only after real usage validates demand.

## Work queue

### P0 — Product and architecture contract

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-01](tasks/PSOS-01.md) | Domain contract: vocabulary, workflow rules, capability matrix, decision log | `done` | — |

### P1 — Reliability and onboarding

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-02](tasks/PSOS-02.md) | Remove demo auto-login; normalize credentials; @banhall.com guidance | `done` | PSOS-01 |
| [PSOS-03](tasks/PSOS-03.md) | Role descriptions & capability explanations in Users & roles | `done` | PSOS-01 |
| [PSOS-04](tasks/PSOS-04.md) | Mixed-upload processing receipt with per-file statuses | `in_review` | — |
| [PSOS-05](tasks/PSOS-05.md) | Generation failure & recovery surface in project header | `ready` | — |
| [PSOS-06](tasks/PSOS-06.md) | Verify highlighted-text research entry in uploaded-PD review mode | `ready` | — |

### P2 — Ownership and workflow foundation

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-07](tasks/PSOS-07.md) | Schema: ownerId, workflowStage, workflowUpdatedAt + audit events + indexes | `ready` | PSOS-01 |
| [PSOS-08](tasks/PSOS-08.md) | Ownership/stage backfill: writer matching, creator fallback, ambiguity queue | `not_started` | PSOS-07 |
| [PSOS-09](tasks/PSOS-09.md) | Server-side ownership transfer + stage transition mutations with validation | `not_started` | PSOS-01, PSOS-07, PSOS-08 |
| [PSOS-10](tasks/PSOS-10.md) | Project header & list metadata: Stage, Owner, With, Due as labeled data | `not_started` | PSOS-07, PSOS-09 |
| [PSOS-11](tasks/PSOS-11.md) | Indexed, paginated dashboard projection queries (retire broad fetch + N+1) | `not_started` | PSOS-07 |

### P3 — Assignments, My Work, and Inbox

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-12](tasks/PSOS-12.md) | workItems + workItemEvents schema, invariants, transactional lifecycle | `not_started` | PSOS-07, PSOS-09 |
| [PSOS-13](tasks/PSOS-13.md) | Assignment composer + "Send for internal review" shortcut | `not_started` | PSOS-09, PSOS-12 |
| [PSOS-14](tasks/PSOS-14.md) | My Work dashboard: lanes, dense ledger rows, mobile cards | `not_started` | PSOS-11, PSOS-12 |
| [PSOS-15](tasks/PSOS-15.md) | Team pipeline view for managers/admins | `not_started` | PSOS-12, PSOS-14 |
| [PSOS-16](tasks/PSOS-16.md) | In-app notifications & Inbox (unread/read/archive, dedup) | `not_started` | PSOS-09, PSOS-12 |
| [PSOS-17](tasks/PSOS-17.md) | Email notifications: preferences, delivery ledger, idempotent retries | `not_started` | PSOS-01 provider decision, PSOS-16 |

### P4 — Persistent draft branches

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-18](tasks/PSOS-18.md) | reportBranches schema + backfill of existing reports/candidates | `not_started` | PSOS-07 |
| [PSOS-19](tasks/PSOS-19.md) | Non-destructive candidate materialization + explicit branch promotion | `not_started` | PSOS-18 |
| [PSOS-20](tasks/PSOS-20.md) | Branch tabs UI: switch, rename, duplicate, archive, make active, generate-another-model | `not_started` | PSOS-18, PSOS-19 |
| [PSOS-21](tasks/PSOS-21.md) | Branch comparison flow | `not_started` | PSOS-20, BNH-19 |

### P5 — Production outcomes and learning

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-22](tasks/PSOS-22.md) | productionOutcomes schema + record/correct mutations | `not_started` | PSOS-01, PSOS-18, PSOS-19 |
| [PSOS-23](tasks/PSOS-23.md) | Outcome capture UX (post-export/promotion/delivery), non-blocking | `not_started` | PSOS-09, PSOS-20, PSOS-22 |
| [PSOS-24](tasks/PSOS-24.md) | Production analytics: funnel + per-model delivery/abandonment | `not_started` | PSOS-22, PSOS-23, BNH-16 |
| [PSOS-25](tasks/PSOS-25.md) | Outcomes as governed learning signals (no auto-ingest) | `not_started` | PSOS-22, BNH-42 |

### P6 — Roles and capability hardening

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-26](tasks/PSOS-26.md) | roleCapabilities module: presets + server helpers | `ready` | PSOS-01 |
| [PSOS-27](tasks/PSOS-27.md) | Authorization audit & migration of all Convex functions + matrix tests | `not_started` | PSOS-26 |
| [PSOS-28](tasks/PSOS-28.md) | Financial role + role-aware landing/navigation | `not_started` | PSOS-26, PSOS-27 |
| [PSOS-29](tasks/PSOS-29.md) | Role/capability matrix UI | `not_started` | PSOS-01, PSOS-26, PSOS-28 |
| [PSOS-30](tasks/PSOS-30.md) | Decision ticket: membership-based project visibility (deferred) | `ready` | PSOS-01 |

### P7 — Client and claim-period financial workspace

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-31](tasks/PSOS-31.md) | clients + claimPeriods schema and normalization migration | `not_started` | PSOS-01, PSOS-26 |
| [PSOS-32](tasks/PSOS-32.md) | Lift financial data to client+claim-period scope (claimPeriodProjects, sources, entries, reviews) | `not_started` | PSOS-31 |
| [PSOS-33](tasks/PSOS-33.md) | Financial landing: claim periods with counts, hours, reviews, costing status | `not_started` | PSOS-28, PSOS-31, PSOS-32 |
| [PSOS-34](tasks/PSOS-34.md) | Claim-period workspace: source uploads, personnel/hour review, allocation, costing outputs | `not_started` | PSOS-32, PSOS-33 |

### P8 — Advanced portfolio backlog

| ID | Work item | Status | Dependencies |
|---|---|---|---|
| [PSOS-35](tasks/PSOS-35.md) | Backlog: named saved views + email digests | `not_started` | PSOS-14, PSOS-16, PSOS-17 |
| [PSOS-36](tasks/PSOS-36.md) | Backlog: assignment templates + automation rules (architecture-first) | `not_started` | PSOS-12, PSOS-13 |

## Parallel-work exceptions

None. Add an entry before starting more than one PSOS ticket simultaneously:

| Date | Tickets | Why parallel is safe | File/domain boundaries | Approved by |
|---|---|---|---|---|
| — | — | — | — | — |

## Program decision log

| Date | Decision | Affected tickets | Rationale |
|---|---|---|---|
| — | Use this repository queue until Futurlabs ERP exposes ticket creation/editing through MCP. | All | Futur-board MCP is currently read/status-only. |

## Program progress log

| Date | Event | Result |
|---|---|---|
| — | Internal PSOS queue created from the reviewed meeting plan. | 36 individually managed task files created. |
| 2026-07-24 | PSOS-01 started. | Canonical domain contract drafted and linked from project instructions. |
| 2026-07-24 | PSOS-01 completed. | Vocabulary/storage contract, full stage transition matrix, four-role capability matrix, and all nine product decisions documented; full validation passed; no commit or deployment performed. |
| 2026-07-24 | PSOS-02 urgent authentication slice started. | Removed demo auto-login/client credentials and stabilized sign-out/login rendering. |
| 2026-07-24 | PSOS-02 completed after Claude plan and review. | Canonical auth/invite/user email handling, collision-safe migration tooling, 16 new tests, and clean development-deployment report/dry-runs completed; no commit or production deployment. |
| 2026-07-24 | PSOS-03 completed after Claude plan and review. | Shared Consultant/Manager/Admin descriptions now appear as accessible disclosures in invite and roster contexts; 4 focused tests added; 99 full-suite tests pass; no commit or deployment. |
