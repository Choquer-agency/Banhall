# PSOS-40 — Backlog: client repository, historical reports, company chat, and analytics

## Work control

- **Status:** `deferred`
- **Phase:** P9 — advanced repository backlog
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** July 27, 2026 meeting transcript supplied directly by the product team
- **Progress note:** Deferred until durable clients, claim periods, outcomes, and visibility scope exist. This is a consolidation record, not permission to create competing repository schema.

## Product direction captured

The team sees Banhall evolving into the durable document and analysis hub for client work:

- completed historical reports and transcripts organized by client and fiscal year;
- exact completed revisions preserved and available for reference;
- multi-year project inheritance and change-over-time analysis;
- a client/company page containing reports, files, claim periods, and scoped chat;
- future ITC, project-count, payroll, claim-risk, and costing analytics.

## Transcript evidence

- **15:00–17:25:** Michael describes Banhall as a possible document repository with locked completed reports tied to client and fiscal year.
- **17:26–18:30:** historical reports could be linked across years for project-inheritance and change-over-time analysis.
- **18:31–20:54:** Bryce and Michael describe a company page/dashboard with company-scoped chat and future ITC, project-count, payroll, costing, and risk analytics.
- **21:01–21:26:** the direction is framed as repository plus analytics, expanding toward ERP/CRM capabilities rather than only PD generation.

## Dependencies and ownership boundaries

- PSOS-22–23 own exact delivered/used revision outcomes; “locked completed report” must build on those records rather than a second finality flag.
- PSOS-30 owns future membership/visibility decisions.
- PSOS-31 owns durable clients and normalization.
- PSOS-32 owns claim-period source material and financial lifting.
- PSOS-33–34 own financial landing and claim-period workspace.
- PSOS-18–20 own persistent report branches and archival.

## Revisit trigger

Reopen only after:

1. PSOS-31 durable clients and claim periods are deployed;
2. PSOS-22–23 exact revision outcomes exist;
3. PSOS-30 has resolved any visibility changes required for company-wide history;
4. representative historical report and source-document ingestion has measured volume, cost, and permissions.

## Acceptance criteria for future discovery

- [ ] Define a client/company page without duplicating claim-period financial workspaces.
- [ ] Define historical report import, provenance, immutable outcome linkage, and correction behavior.
- [ ] Define project-inheritance links without fuzzy auto-linking or repurposing project creator/owner fields.
- [ ] Define company-scoped chat retrieval boundaries and citation/provenance requirements.
- [ ] Define analytics sources and distinguish deterministic metrics from AI summaries.
- [ ] Preserve broad or narrowed visibility exactly as approved by PSOS-30.
- [ ] Produce separate implementation tickets; no monolithic repository/ERP ticket.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Defer implementation and make existing PSOS contracts the dependencies. | The meeting describes a strategic direction whose data foundations already have approved owners. | Claude Code/Fable and Opus planning reviews |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| 2026-07-28 | Long-term repository, historical inheritance, company chat, and analytics ideas consolidated. | Prevents them from being lost while avoiding premature client/outcome/financial schema. |

## Completion record

- **Revisit date/trigger achieved:** —
- **Implementation tickets:** —
- **Known limitations accepted at creation:** Strategic backlog only; no committed delivery date.
