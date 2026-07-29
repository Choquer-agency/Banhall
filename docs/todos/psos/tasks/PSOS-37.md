# PSOS-37 — Decision: logical project grouping, numbering, and primary-instance semantics

## Work control

- **Status:** `ready`
- **Phase:** P9 — meeting-directed portfolio organization
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** July 27, 2026 meeting transcript supplied directly by the product team
- **Progress note:** Highest-priority meeting-directed decision task for July 27–31. No implementation may begin until this ticket resolves how historical multi-row AI tests relate to the canonical Project and Branch models.

> This is a decision ticket. It must produce an approved domain amendment and implementation contract, not schema or UI code. Preserve the one-active-ticket rule.

## Problem

Writers currently create several separate project rows while testing models, prompts, or source-document combinations for one real SR&ED project. The all-projects dashboard then looks as though the client has many distinct projects. The team wants to keep those test rows independently recoverable while collapsing them into one logical dashboard group, assigning the real project a sortable accounting number, and bringing the chosen instance forward.

This request intersects existing approved concepts:

- one canonical **Project** is one durable PD workflow container;
- independently editable alternatives are planned as **Draft branches** in PSOS-18–20;
- intended deliverable selection is **branch promotion** in PSOS-19;
- actual use/delivery is a **production outcome** in PSOS-22–23;
- client and claim-period identity arrives in PSOS-31;
- indexed dashboard projections arrive in PSOS-11.

A new grouping feature must not create a competing definition of Project, Branch, promotion, or delivery.

## Transcript evidence

Direct evidence from the supplied transcript:

- **22:14–25:42:** Michael asks for multiple AI tests for the same real project to remain distinct internally but collapse into one dashboard/file-explorer group that can be expanded.
- **24:01–24:31:** Michael rejects a crowded in-project tab design for these existing rows and prefers keeping them distinct while grouping them at the list level.
- **25:46–27:10:** Michael asks for two-digit project numbers such as `01`, used to collect related instances, sort projects, and match financial/accounting work.
- **27:16–27:37:** Michael asks to identify the “final,” “good,” or “go with this one” instance and bring it to the front.
- **25:42–25:45 and 27:37:** Johnny agrees to investigate/work on the grouping and numbering request.

Interpretation recorded for decision, not yet approved:

- “Preferred/final/good” should be named **Primary instance** and should control display ordering only. It must not mean promoted branch, delivered revision, or legacy `projects.status = "final"`.

## Decisions required

### D37.1 — What is being grouped?

Choose one:

1. **Historical compatibility group over project rows.** Existing test projects remain independent `projects` rows but share optional group metadata for dashboard organization.
2. **Branch migration.** The rows are converted or superseded by PSOS-18–20 branches under one canonical project.
3. **Hybrid.** Existing rows may be grouped for compatibility, while future alternatives must use branches after PSOS-19 ships.

The recommended default is **Hybrid**: preserve historical rows without destructive migration, but do not encourage new project-row duplication after persistent branches ship.

### D37.2 — Meaning of Primary instance

Resolve and document:

- at most one Primary instance per group;
- Primary affects list ordering and the default row opened from the group;
- Primary grants no workflow, authorization, promotion, delivery, or learning semantics;
- Primary does not mutate `workflowStage`, legacy `status`, `promotedBranchId`, or production outcomes;
- changing Primary is audited and uses OCC.

### D37.3 — Project-number scope

Choose and document one scope:

- global;
- client;
- client + claim period/fiscal period.

Recommended default: **client + claim period**, because Michael tied the number to accounting forms and ordering within a client filing period. This choice would make PSOS-38 dependent on durable client/claim-period identity or require an explicitly temporary compatibility key with a migration plan.

Also decide:

- display format (`01`, `02`, …) and headroom beyond 99;
- whether the stored value is numeric with zero-padding applied only in UI;
- uniqueness and collision rules;
- whether numbers may be changed/reordered;
- whether abandoned/test-only numbers are reused;
- deterministic backfill ordering.

### D37.4 — Test-instance lifecycle guard

Decide whether grouped AI experiments are ordinary projects or explicitly `test_only`. If test-only identity is introduced, define whether those rows may enter `ready_for_delivery` or `delivered`, and coordinate with PSOS-22’s `test_only` outcome rather than creating a second outcome system.

### D37.5 — Dashboard and performance boundary

Decide whether PSOS-38 may ship before PSOS-11. The default is **no** for final production grouping because collapsing groups after client-side pagination creates incorrect counts and partial groups. A narrowly scoped compatibility release requires explicit proof that current result bounds are safe and a documented PSOS-11 migration.

## Acceptance criteria

- [ ] The product owner chooses project-row grouping, branch migration, or the hybrid model.
- [ ] `docs/product-domain.md` receives a dated, approved amendment defining **Project group**, **Project number**, and **Primary instance**, including migration, authorization, audit, and test impacts.
- [ ] Primary instance is explicitly display-only and cannot compete with branch promotion or production outcomes.
- [ ] Project-number scope, format, uniqueness, allocation, mutability, gap/reuse policy, and backfill order are resolved.
- [ ] The relationship to PSOS-11, PSOS-18–20, PSOS-22–23, and PSOS-31 is recorded.
- [ ] The relationship to duplicate-generation prevention is documented so intentional experiments and accidental duplicate runs are not conflated.
- [ ] The implementation ticket PSOS-38 is amended with approved storage, indexes, mutations, and rollout ordering.
- [ ] No schema, mutation, or UI implementation is included in this decision ticket.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Start with a decision ticket rather than adding group fields immediately. | The meeting request crosses the canonical Project, Branch, outcome, dashboard-pagination, and client/claim-period contracts. | Claude Code/Fable and Opus planning reviews |
| 2026-07-28 | Use “Primary instance” in planning, not “final version.” | “Final” already has legacy status, branch-promotion, and delivery meanings. | Planning default; product approval pending |
| 2026-07-28 | Treat the supplied transcript as direct source evidence. | The full transcript was supplied in this conversation, including timestamps and explicit assignment language. | Product team source |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| 2026-07-28 | July 27 transcript triaged against all 36 existing PSOS tasks and the approved product-domain contract. | No existing task safely owns the cross-project grouping decision. PSOS-18–20 remain the source of truth for future in-project draft alternatives. |
| 2026-07-28 | Claude Code/Fable and Opus independently reviewed ticket boundaries and semantic conflicts. | Both required decision-first handling. Fable recommended meeting-directed prioritization; Opus emphasized PSOS-11/18/31 dependencies and delivery-data risks. |

## Completion record

- **Approved decision:** —
- **Product-domain amendment:** —
- **Implementation ticket:** [PSOS-38](PSOS-38.md)
- **Known limitations at creation:** Project-number scope and test-instance lifecycle are unresolved and block implementation.
