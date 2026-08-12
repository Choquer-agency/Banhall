# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Banhall's primary daily users are SR&ED consultants and writers producing, reviewing, revising, and delivering project descriptions. Their default workspace should emphasize assigned work, blocking handoffs, due dates, and the report they need to move forward.

Managers oversee team capacity, assignments, quality, financial context, and delivery readiness. Administrators manage users, roles, settings, governed Brain feedback, and operational exceptions. Client-facing participants use explicitly shared review experiences rather than the internal workspace.

## Product Purpose

Banhall is a professional-services production system for SR&ED work. It organizes project intake, source material, report generation and editing, internal and client review, accountable handoffs, financial evidence, and delivery history.

Success means the responsible person can identify the next action, work on the correct report and evidence, hand responsibility to the next person, and preserve an auditable production history without relying on disconnected spreadsheets, chat messages, or generic sales-CRM stages.

## Positioning

Banhall combines CRM-style record navigation and operational visibility with a report-and-document-centered production workflow. The Project and its report remain primary; workflow stages and work items represent accountable professional-services work rather than leads, opportunities, or sales deals.

## Operating Context

- Projects move through the canonical human workflow defined in `docs/product-domain.md`.
- Owner is durable accountability; current handoff identifies who has the blocking next action.
- Work items drive personal queues and review/revision handoffs.
- Reports, source documents, transcripts, comments, research, QA, snapshots, and exports belong to project production.
- Users need dense, scan-friendly project and work views during daily desktop use, with functional mobile access.
- A future Futurlabs ERP integration is under discovery. System-of-record ownership, approved entities, field mappings, and the production synchronization protocol require an explicit product-domain amendment before implementation.

## Capabilities and Constraints

- Frontend: SvelteKit 2 and Svelte 5 runes. Do not introduce React, JSX, Next.js APIs, or legacy Svelte syntax.
- Backend: Convex with server-enforced authentication, capabilities, bounded indexed queries, optimistic concurrency where required, and append-only product-significant events.
- The first workspace release covers the dashboard and project-record surfaces behind a remote feature flag.
- The first production cohort is an Admin-managed user allowlist. The feature defaults OFF and must fail closed.
- The current production interface remains the immediate rollback target at the same canonical routes.
- The dashboard hierarchy is consultant/writer-first: My Work is the primary daily destination; Projects is the dense repository view.
- Obvious is the primary interaction reference for calm workspace composition, compact navigation, project discovery, active-context toolbars, and conversation adjacent to project work. Twenty CRM and the supplied Mobbin screenshots remain secondary density references. None of them are domain or branding sources.
- Do not introduce leads, opportunities, sales pipelines, generic CRM automation, or unsupported Email/Calendar objects.
- Do not treat normalized free-text client names or `dashboardCompanies` as durable Client identity. Durable Clients and claim periods remain governed by PSOS-31/32.
- Do not imply persistent report branches or production outcomes before their existing PSOS prerequisites ship.
- Feature flags control exposure, never authorization.

## Brand Commitments

- Product name: Banhall.
- Preserve the established "Ledger paper" system in `docs/design-system.md` and `src/routes/layout.css`.
- Use the fir navigation surface, lagoon interaction accent, pale ledger canvas, white work surfaces, teal-cast neutral ramp, DM Sans UI typography, Georgia report prose, and Geist Mono data roles.
- The new workspace may adopt Obvious's calm workspace composition and active-context interaction architecture, plus Twenty/Mobbin density where useful, but must remain recognizably Banhall and must not copy their branding, generic artifact model, or sales terminology.
- **2026-08-06 reconciliation with the workspace shell scopes:** the flagged dashboard workspace (`WorkspaceDashboard` on `/my-work` and `/projects`) is the **light bounded workspace** (`docs/design-system.md`, `[data-workspace-theme="light"]`): a pure-white working plane with the **fir navigation surface** (`--color-shell: #0A3A38`) as the brand anchor, light labelled stage badges, single-surface white cards, and AA lagoon pairs (`primary-selected` under white text on the plane). The scoped Obvious-dark shell (`[data-workspace-theme="dark"]`) remains recorded for the `WorkspaceChrome` utility pages, the navigation drawer, and the preview report surfaces — its rail is likewise fir; Obvious's monochrome charcoal rail is not copied — and it is the light retheme's rollback seam. Ledger Paper remains the default system everywhere outside these scopes, and the two documents must not disagree; a change to either requires updating both. The 2026-08-06 second product-domain amendment (queue-first My Work, Client → Status grouping with client lanes/focus, same-tone columns, hide-empty display option, navigation-only creation affordances) is reflected in both governed documents; Obvious remains an interaction reference, never a domain source.
- Status must never be communicated by color alone. Workflow stage badges remain the primary project-state badges.

## Evidence on Hand

- Canonical product contract: `docs/product-domain.md`.
- Design authority: `docs/design-system.md`, `src/routes/layout.css`, and `/styleguide`.
- Svelte conventions: `docs/svelte-migration.md`.
- Work queue and implementation evidence: `docs/todos/psos/`, `ROADMAP.md`, source code, tests, and Git history.
- Meeting evidence: `/tmp/banhall-friday-meeting-transcript.txt` and meeting-derived repository documents. Transcript requirements require formal amendment when they change the canonical domain contract.
- Interaction references: authenticated Obvious product inspection on 2026-08-04, public Obvious help and product imagery, and five local Twenty/Mobbin screenshots supplied on 2026-08-04.
- No verified Futurlabs business-data ERP API contract, sandbox contract, webhook schema, or approved field mapping is currently stored in the repository.

## Product Principles

1. Keep the report and accountable next action at the center of the experience.
2. Adopt CRM information architecture without importing sales-CRM semantics.
3. Use one canonical record and workflow model across legacy and new interfaces.
4. Make release exposure fail closed, remotely reversible, and independent from authorization.
5. Prefer dense, truthful operational views over decorative cards or invented relationships.

## Accessibility & Inclusion

All new workspace surfaces must support keyboard navigation, visible focus, semantic landmarks and tables, non-color status labels, reduced motion, 200% zoom, and touch targets of at least 44px where the interface becomes touch-oriented. Drag interactions must have a complete non-drag alternative.
