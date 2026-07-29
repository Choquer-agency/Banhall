# PSOS-11 — Indexed, paginated dashboard projection queries (retire broad fetch + N+1)

## Work control

- **Status:** `done`
- **Phase:** P2
- **Current owner:** Main coding agent
- **Started:** 2026-07-29
- **Completed:** 2026-07-29
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** Complete on the development deployment. Company-first/child pagination, flat bounded search/filter results, denormalized generation activity and report-view recency, bounded facets, resumable projection backfill, retained bulk selections, and responsive hierarchy QA have shipped to development after Opus/Codex review remediation.

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

- [ ] Work through every acceptance criterion below individually and attach evidence in the work log.
- [ ] Add or update unit, integration, and regression coverage required by this ticket.
- [ ] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work.

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

**Priority**: P1 (performance foundation for Phase 3 lanes).
**Problem**: Dashboard fetches all projects then filters client-side, with per-project
generation lookups (N+1). New lanes multiply this cost.
**Context**: Current queries in `convex/projects.ts` / `convex/reportViews.ts`;
guidelines mandate `withIndex` + `paginationOptsValidator` + bounded reads. Related:
BNH-49 (sort/filter) — its filters should move onto these queries.
**In scope**: New `convex/dashboard.ts` projections with company-first pagination for the default company→fiscal-year hierarchy and flat paginated project results when text search, attribute filters, stage filters, or recency sorts are active. The default hierarchy paginates company summaries and loads each expanded company's projects through a bounded indexed child query so groups never split after page slicing. Search/filter results are flat and bounded. The project projection includes only current dashboard data; `dueAt` remains out of scope until PSOS-12. Technical activity is denormalized as the behavior-preserving `generationActivity`, not a misleading latest historical status. `lastViewedAt` is denormalized to remove the second report-view N+1. Owner names are joined from one bounded team-roster query rather than per-project reads.
**Out of scope**: Lane UI (Phase 3), saved views (Phase 8).
**Acceptance criteria**:
- [x] No dashboard query calls `.collect()` on projects or performs per-row generation or report-view lookups.
- [x] Company headers, company children, and flat result queries use named indexes and bounded pagination; page sizes are server-clamped and configurable by the client.
- [x] `generationActivity` stays consistent through active lifecycle transitions, cancellation/stale recovery, and legacy pointerless fallback.
- [x] Backfill populates dashboard ordering/search/activity/view fields for existing projects and is idempotent/resumable through a durable run key and counted marker.
- [x] The default hierarchy never splits a company across top-level pages; flat search/filter results expose load-more and bounded-scan messaging.
- [x] Perf check: company, child, search, and flat queries have clamped page sizes; flat filters use one paginate call with an 8× maximum read budget.
- [x] Stage/Owner/industry/science facets and totals come from a separate bounded projection with visible `+` approximation when truncated; tags retain the bounded taxonomy query rather than scanning projects.
- [x] Bulk selection persists with retained row data across pages/views and group selection applies only to fully loaded child rows; the existing 200-project server cap remains explicit.
**Dependencies**: PSOS-07. **Rollout**: run old + new queries in parallel behind a
switch during verification, then remove old path.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-29 | Paginate company headers, then load bounded project children per expanded company. | A company must never be split across project-row pages; this also prepares the query boundary PSOS-38 needs without inventing Project-group semantics. | Product owner |
| 2026-07-29 | Text search, stage/attribute filters, and non-client recency sorts use a flat paginated result grid. | Native bounded search/filter pagination cannot preserve complete company groups and arbitrary sort semantics simultaneously. | Product owner |
| 2026-07-29 | Group bulk selection applies only to fully loaded child rows; selected project IDs persist across pages. | Prevents silent partial-company edits and preserves the existing 200-ID mutation boundary. | Product owner |
| 2026-07-29 | The Consultant filter means durable Owner (`projects.ownerId`). Historical writer text remains a display fallback only. | Owner is the canonical accountability identity established by PSOS-07–09. | Product owner |
| 2026-07-29 | Fiscal grouping uses UTC year, and blank company names sort last. | Gives every user a deterministic hierarchy and keeps compatibility rows behind named companies. | Product owner |
| 2026-07-29 | Denormalize `generationActivity`, not a latest historical generation status. | Dashboard UI shows active technical activity; completed/failed history is not a current activity badge, and legacy pointerless active fallback must be preserved. | Claude Opus/Codex architecture recommendation accepted by product owner |
| 2026-07-29 | Amend the initial-load read criterion to cover each paginated projection independently; global facets use a separate bounded query with a truncation flag. | Exact global counts and options cannot be derived from one project page, and Convex has no free count operator. | Product owner through approval of the recommended architecture |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-29 | Convex performance audit traced `projects.listProjects`, `findActiveGeneration`, `reportViews.getLastViewedMap`, dashboard filtering/grouping, and generation lifecycle writers. | Confirmed an unbounded projects read, generation N+1, report-view N+1, per-row live-label lookups, and page-global client assumptions. Runtime Insights were unavailable because the configured deployment credential is a deploy key rather than a team-user login. |
| 2026-07-29 | Claude Code Opus 5 mandatory planning pass and independent Codex architecture audit completed. | Both required explicit pagination/search/selection decisions before implementation and recommended additive derived fields, bounded indexed projections, dual-read verification, and idempotent backfill. |
| 2026-07-29 | Product owner approved all six prompted dashboard decisions. | PSOS-11 moved to `in_progress`; implementation may proceed without changing the company→fiscal-year default hierarchy or inventing PSOS-37 grouping semantics. |
| 2026-07-29 | Implemented additive dashboard projection fields, company summaries, bounded indexed queries, generation/report-view denormalization, durable backfill, and company-first/flat-result Svelte flows. | Broad dashboard project and report-view N+1 reads are no longer mounted by the dashboard. |
| 2026-07-29 | Development backfill `psos11-dashboard-v2-live` completed and was verified. | 30 projects scanned, 0 missing projections, 10 company rows, and company totals exactly 30. |
| 2026-07-29 | Mandatory Opus/Codex adversarial reviews found pagination, selection, backfill, facet, disclosure, and company-rename issues; all in-scope findings were resolved. | Final targeted checks passed; pre-existing bulk metadata authorization and create-time Owner/Stage remain separate follow-up scope. |
| 2026-07-29 | Installed-Chrome/CDP QA at 1440/1024/768/375/320. | 30 projects and 10 company disclosures render with no horizontal overflow or console errors; expanded groups have valid ARIA references and bounded child cards; flat search remains responsive. |

## Completion record

- **Pull request/commit:** Not committed; the workspace remains intentionally dirty.
- **Deployment:** Development Convex deployment `energized-salamander-237`; production untouched.
- **Follow-up tickets:** PSOS-12 for current handoff/due data; PSOS-14 for My Work lanes; PSOS-37/38 for approved logical Project groups; authorization audit remains PSOS-27.
- **Known limitations accepted at closure:** Facets are bounded at 1,000 and visibly approximate beyond that bound. Sparse client-side attribute filters may require Load more because Convex permits one paginate call per query. Search uses indexed project/writer/interviewer text; live Owner-name search requires a future owner-name projection if product demand warrants it.
