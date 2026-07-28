# PSOS-36 — Backlog: assignment templates + automation rules (architecture-first)

## Work control

- **Status:** `not_started`
- **Phase:** P8
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

**Priority**: P3 backlog.
**Scope sketch**: Templates for common handoff sequences (e.g. draft→internal review→
revisions) and limited automation (stage change on handoff completion) — begins with a
written rules-engine-lite design honoring PSOS-01 automation decision; explicitly not
an arbitrary rule builder. Slack notifications, team capacity, custom roles,
project-level visibility restrictions (pending PSOS-30), and branch merge assistance
remain out until separately approved. **Dependencies**: PSOS-12/13, PSOS-30 decision.

---

## Dependency graph (summary)

```
PSOS-01 ─┬─▶ PSOS-02..06 (P1, mostly independent)
         ├─▶ PSOS-07 ─▶ PSOS-08 ─▶ PSOS-09 ─▶ PSOS-10
         │        └───────────────▶ PSOS-11 ─▶ PSOS-14 ─▶ PSOS-15
         │                          PSOS-12 ─▶ PSOS-13 ─▶ PSOS-14
         │                          PSOS-12 ─▶ PSOS-16 ─▶ PSOS-17*
         ├─▶ PSOS-18 ─▶ PSOS-19 ─▶ PSOS-20 ─▶ PSOS-21 (BNH-19)
         │                   └────▶ PSOS-22 ─▶ PSOS-23 ─▶ PSOS-24 (BNH-16)
         │                                        └─────▶ PSOS-25 (BNH-42)
         ├─▶ PSOS-26 ─▶ PSOS-27 ─▶ PSOS-28 ─▶ PSOS-33
         │        └───▶ PSOS-29    PSOS-27 ─▶ PSOS-30
         └─▶ PSOS-31 ─▶ PSOS-32 ─▶ PSOS-33 ─▶ PSOS-34
                          PSOS-35/36 backlog (after P3/P6 decisions)
* PSOS-17 blocked on provider decision in PSOS-01.
```

## Relations to existing BNH tickets (dedupe map)

| Existing | Relation |
|---|---|
| BNH-40 Peer review assignment & notification (backlog) | **Superseded by** PSOS-12/13/16 (generalized work items + inbox). Recommend closing BNH-40 in favor of these or converting it to the internal_review-kind acceptance ticket. |
| BNH-33 / BNH-34 upload warnings/.msg | **Extended by** PSOS-04 (receipt builds on whitelist + .msg support). |
| BNH-50 Multi-tenant user mgmt (backlog) | **Overlaps** PSOS-28 (roles) narrowly; BNH-50's multi-tenant/company scoping is broader and independent — kept as-is, referenced. |
| BNH-13 housekeeping/account migration | **Coordinates with** PSOS-02 (env gating of demo login belongs with env migration). |
| BNH-36 / BNH-49 project list grouping, sort/filter | **Preserved by** PSOS-11/14 (All projects view keeps hierarchy; filters move onto indexed queries). |
| BNH-19 diff view (in progress) | **Reused by** PSOS-21 (branch comparison extends it; coordinate to avoid duplicate diff engines). |
| BNH-56 named-milestone snapshots (in progress) | **Compatible with** PSOS-18 (snapshots stay per-report → per-branch automatically). |
| BNH-21 / BNH-52 loading screen, duplicate-run guard (done-ish/in progress) | **Reused by** PSOS-05 (retry idempotency + status surfaces). |
| BNH-47 / BNH-48 QA panel, per-option scoring (in progress) | **Preserved by** PSOS-19 (scores/provenance survive branch materialization). |
| BNH-16 token/cost reporting (in progress) | **Reused by** PSOS-24 (cost-per-delivered-PD reads its aggregates). |
| BNH-42 Brain feedback queue (backlog) | **Prerequisite for** PSOS-25 (governed learning signals flow through it). |
| BNH-15 A/B testing & auto-selection | **Consumer of** PSOS-24 analytics; unchanged. |

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
