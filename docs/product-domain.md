# Banhall product domain contract

**Status:** Approved baseline for PSOS implementation
**Effective:** 2026-07-24
**Applies to:** project workflow, assignments, report branches, production outcomes, notifications, role capabilities, and the future financial workspace

This document is the product and engineering contract for evolving Banhall into a professional-services production operating system. It defines the language and state boundaries that later implementation must preserve.

When this contract conflicts with an implementation shortcut, the contract wins unless a later decision record explicitly amends it.

## Product thesis

Banhall is an internal SR&ED professional-services production system, not a generic sales CRM. Its primary job is to make document work accountable and recoverable:

1. identify the consultant accountable for each project;
2. identify who has the next blocking action;
3. make the human workflow stage explicit;
4. preserve independently editable report alternatives;
5. record whether an exact report revision was actually used; and
6. direct each user to a restrained, understandable queue of work.

The report remains the primary workspace. Workflow controls support the report rather than turning Banhall into a decorative card or Kanban system.

## Canonical vocabulary and storage contract

| Term | Definition | Canonical storage | Invariants and non-goals |
|---|---|---|---|
| **Project** | One SR&ED technical narrative/PD for a client and fiscal period. | Existing `projects` row. | A project is the durable workflow container. It is not an assignment or a report branch. |
| **Creator** | The internal user who originally created the project. Historical audit identity only. | Existing immutable `projects.createdBy`. | Never relabel or repurpose this field as Owner. It does not change when responsibility is transferred. |
| **Owner** | The internal user accountable for the project across its lifecycle, even while another person performs a temporary review or action. A new project's initial Owner is always its authenticated Creator, including when that Creator is an Admin. | Planned `projects.ownerId: Id<"users">`; initially optional during widen/backfill, then required for active projects. Ownership changes create immutable `projectEvents`. | Owner and Current handoff are separate. Ownership transfer never changes `createdBy`. Project creation never accepts a different initial Owner from the client. |
| **Work item** | A concrete action requested from a person, with type, assignee, assigner, due date, instructions, blocking status, lifecycle, and completion history. | `workItems` row and immutable `workItemEvents`. | Do not model the work system as one mutable `assignedTo` field. Work items are never hard-deleted during their normal lifecycle. |
| **Current handoff** | The one open blocking work item that answers “who has the next action on this project?” | `projects.currentHandoffId: Id<"workItems">` as a denormalized pointer maintained transactionally; canonical details remain on `workItems`. | At most one open blocking handoff per project. Multiple open non-blocking work items are allowed. “With” in the UI means the current handoff assignee, not the Owner. |
| **Workflow stage** | The human production stage of the project. | Planned `projects.workflowStage` and `projects.workflowUpdatedAt`; transitions create immutable `projectEvents`. | Separate from legacy `projects.status` and from AI generation state. Do not infer ownership or assignment from stage. |
| **Generation state** | Technical lifecycle of an AI generation attempt. | Existing `generations.status`; canonical states are `reserved`, `running`, `awaiting_selection`, `awaiting_input`, `completed`, `failed`, and `superseded` (2026-09-01 amendment). | A generation failure does not itself determine the human workflow stage. Existing stale/retry fencing remains technical generation behavior. |
| **Draft branch** | A persistent, independently editable report alternative, such as a model draft, imported report, manual alternative, or duplicate. | Planned `reportBranches` row pointing to a branch-owned `reports` row; planned `projects.activeBranchId` and `projects.promotedBranchId`. | Branches are not snapshots. Switching branches never changes another branch’s content, revision, chat, comments, research, provenance, or snapshots. |
| **Snapshot** | Immutable version history inside one branch/report. | Existing `reportSnapshots` and report revision semantics, scoped by `reportId`. | A snapshot is not an independently editable alternative. |
| **Suggestion** | A proposed change against one branch/report revision. | Existing proposal records scoped to `reportId` and revision/target lineage. | A suggestion is not a branch and cannot silently change its canonical target. |
| **Outcome** | Human-authored disposition of an exact branch/report revision. | Planned immutable `productionOutcomes` row referencing project, branch, report, and exact snapshot or revision. | Export is evidence, not delivery. Corrections append linked records; they do not overwrite outcome history. |
| **Inbox notification** | A user-directed event informing them that something happened or needs attention. | Planned `notifications` row and optional delivery ledger. | Reading or archiving a notification never completes its work item. |
| **Capability** | A named server-enforced permission to perform an operation. | Planned centralized `roleCapabilities` definitions mapped from stored role presets. | UI visibility is not authorization. Initial presets are fixed; an arbitrary custom permission builder is out of scope. |
| **Client** | The durable company/account for which claim work is performed. | Planned `clients` row; current `projects.clientName` remains compatibility data until migration. | Do not silently merge similar free-text names. |
| **Claim period** | The client/fiscal-period container for financial source material and costing work across one or more projects. | Planned `claimPeriods` and `claimPeriodProjects`. | The financial workspace may have a different landing model, but it remains part of the same application and authorization system. |
| **Project type** | The kind of work product represented by a Project: `writing`, `review`, `background_research`, or `financial`. | Optional `projects.projectType` during widen; legacy `mode: review` reads as `review`, every other legacy row reads as `writing`. | Type does not change workflow authority, ownership, or artifact format by itself. |

## State model boundaries

Banhall currently has `projects.status` values `draft`, `generating`, `review`, `client_review`, and `final`. That field mixes artifact availability, technical generation, and human workflow. During migration it remains a compatibility field; new workflow behavior must use `workflowStage` after that field is introduced.

Rules for the migration period:

- Existing `projects.status` is not renamed or narrowed in the same release that introduces `workflowStage`.
- New screens may display legacy status only as a fallback when `workflowStage` is absent.
- Generation mutations continue to own `generations.status`; they must not silently advance human workflow stages.
- Backfill defaults are conservative: a project with a selected/current report may begin at `drafting`; otherwise it begins at `intake`. No historical export alone is enough to backfill `delivered`.
- Removing legacy status/write behavior requires a separate, measured narrow-phase decision after all consumers migrate.

## Workflow stages

| Stage | Meaning | Entry requirements | Normal next stages |
|---|---|---|---|
| `intake` | Project exists but interview/source intake is not confirmed complete. | Project created or conservatively backfilled without a working report. | `interview_complete`, `drafting`, `on_hold`, `abandoned` |
| `interview_complete` | Required interview/input collection is complete enough to begin drafting. | Human confirms readiness. | `drafting`, `on_hold`, `abandoned` |
| `drafting` | A consultant is producing or materially editing the report. | Owner or authorized collaborator begins drafting; a report may or may not already exist. | `internal_review`, `client_review`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `internal_review` | The report is with an internal reviewer or undergoing internal QA. | A review handoff normally exists, but stage and assignment remain separate records. | `edits`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `edits` | An internal review has returned to the writer and its requested edits are being incorporated. | Reviewer, Owner, Manager, or Admin explicitly returns the work for edits. | `internal_review`, `client_review`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `client_review` | A client-facing revision is published/shared for client review. | Authorized user deliberately sends/publishes a revision for client review. | `revisions`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `revisions` | Feedback or identified issues require writer changes. | Review completion, client feedback, or an explicit manual transition. | `internal_review`, `client_review`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `ready_for_delivery` (displayed as **Submitted**) | Internal work is complete, internal and client sign-off is complete where applicable, and the exact deliverable is ready for input/delivery. | A promoted branch exists and filing/readiness requirements applicable to the workflow are satisfied. | `delivered`, `revisions`, `on_hold`, `abandoned` |
| `delivered` | An exact report revision has been confirmed as delivered to the client or used in filing. | Authorized actor records the corresponding production outcome. | `revisions` for reopened work, or `on_hold` only for exceptional administrative correction |
| `on_hold` | Work is intentionally paused without abandonment. | Authorized actor records a reason. | Any active stage that reflects the resumed work; `abandoned` |
| `abandoned` | The project will not proceed in its current scope. | Authorized actor records a reason and handles open work items. | No normal next stage; reopening requires Manager/Admin authority and an audit note. |

## Transition matrix

**Open matrix (amended 2026-08-17).** Every stage may transition to every other stage; the "Normal next stages" column in the stage table above is descriptive guidance, not an allow-list. A mutation must still verify the caller’s project access, role capability, expected project version, and the per-edge policy below.

Authority labels:

- **O** — current Owner
- **H** — assignee of the open blocking current handoff
- **M** — Manager
- **A** — Admin

Per-edge policy is derived from the origin and destination stages:

| Rule | Edges | Policy |
|---|---|---|
| Default authority | All edges unless overridden below | O, M, A |
| Review completion | `internal_review` → `edits`, `internal_review` → `ready_for_delivery` | H additionally authorized (H, O, M, A); a reviewer decision (`return` for `edits`, `approve` for `ready_for_delivery`) must be recorded atomically against the project's latest report revision, else typed `REVIEW_DECISION_REQUIRED` |
| Reopen abandoned | `abandoned` → any stage | M, A only; audit note required |
| Delivered administrative correction | `delivered` → `on_hold` | M, A only; audit note required |
| Leaving delivered | `delivered` → any stage | Audit note required; existing outcome records remain immutable |
| Pausing / abandoning | any stage → `on_hold`, any stage → `abandoned` | Reason (audit note) required; abandoning additionally requires all open work items completed, declined, or canceled first |
| Delivery outcome | any stage → `delivered` | Must atomically reference or create `delivered_to_client` or `used_in_filing` for the exact branch/revision; fails closed until outcome storage applies |
| Readiness | any stage → `ready_for_delivery` | Requires a promoted branch and applicable readiness checks; fails closed until branch storage applies |

Entering `internal_review` no longer requires an active internal-review handoff: stage and assignment remain separate records, and "Send for internal review" may still atomically create the handoff and offer the stage change with user confirmation.

Same-stage transitions are idempotent no-ops and must not create duplicate audit events. Bulk stage changes follow the same policy and authority checks per project; partial success must be reported explicitly rather than hidden.

## Assignment lifecycle

Initial work-item states are:

- `open`
- `completed`
- `declined`
- `canceled`

Rules:

- Creating, reassigning, completing, declining, canceling, or changing a due date writes an immutable event.
- Terminal states do not return to `open`. Reopening means creating a new work item linked through context/audit notes.
- Completion is idempotent. Repeated requests do not create duplicate completion events.
- The assignee completes or declines their own item. The assigner, Owner, Manager, or Admin may cancel; Manager/Admin may administratively complete where justified and audited.
- Reassignment preserves history. It may update the same open item plus an event, but it never overwrites the original assigner/event record.
- A blocking reassignment atomically updates `projects.currentHandoffId`.
- A handoff target is a discriminated party: `internal_user` references a real active user; `external_client` references the project/client context plus a human-readable label. External client handoffs must never be implemented as dummy user accounts.
- Completing/canceling/declining the current handoff atomically clears that pointer unless a replacement handoff is created in the same mutation.
- Due and overdue states are derived from `dueAt`; no cron continually rewrites work item status merely because time passed.

## Report branch lifecycle

Initial branch states are:

- `candidate` — generated/imported alternative not selected as the working draft
- `active` — branch currently open as the project’s working draft
- `superseded` — retained alternative displaced from active/promoted use
- `archived` — hidden from the default tab list but recoverable

Rules:

- Every branch points to its own editable `reports` row.
- At most one `projects.activeBranchId` and one `projects.promotedBranchId` exist; they may reference the same branch.
- **Make active** changes the editing context. **Promote** designates the intended deliverable line. Neither deletes alternatives.
- Promotion is atomic and audited. Concurrent promotions use expected-version/OCC semantics.
- Autosave always includes the originating `reportId` and expected report revision. A delayed save from branch A can never write into branch B after the UI switches.
- Rename, duplicate, archive, restore, make active, and promote create branch/project events.
- Archiving is reversible. Permanent deletion is not part of the initial branch lifecycle.
- Candidate scores, model selection records, generation provenance, QA results, comments, research, chat, and snapshots remain queryable for the branch/report they were created against.

## Production outcome lifecycle

Canonical outcome values:

- `delivered_to_client`
- `used_in_filing`
- `abandoned_quality`
- `abandoned_scope`
- `superseded`
- `test_only`

Rules:

- An outcome identifies an exact `branchId`, `reportId`, and snapshot or revision number.
- Export alone never records `delivered_to_client` or `used_in_filing`.
- Moving a project to `delivered` requires an authorized explicit outcome for the exact promoted revision.
- Outcome records are immutable. Corrections append a new record linked to the superseded record.
- Structured non-use reasons should be captured when a branch is abandoned or superseded, with an optional human note.
- Outcomes are learning signals, not automatic Brain content. Abandoned report content is never auto-ingested. Any learning change still requires the existing governed review, provenance, and revert path.

### Governed behavioral learning amendment (2026-08-17)

- Activity-derived QA calibration and drafting-style digests are immutable learning candidates, not automatically active instructions.
- Only an administrator with `settings.configure` may publish a global digest, disable global learned guidance, or restore an older reviewed version.
- Publication, disable, and rollback are append-only selection events. The original candidate content and prior selections remain auditable.
- Automatic distillation may continue producing candidates while guidance is disabled; it never overrides the administrator's explicit selection.
- Before the first post-amendment candidate is saved, the system freezes the pre-amendment active digest (or explicit absence) so deployment cannot silently change production behavior.
- Personal digests cannot be published globally. Per-writer activation requires a separately approved scope and privacy contract.
- Brain sources remain governed separately. Digest publication does not ingest report content into the Brain or alter deterministic CRA scoring rules.
- The [2026-09-04 privacy amendment](#2026-09-04-privacy-at-selected-firm-wide-knowledge-boundaries-cap-1) defines the approved de-identification boundaries and the privacy review required to publish a digest.

## Role and capability matrix

The current stored role literal `writer` continues to display as **Consultant**. **Financial** is a planned additive role and must not be written until its schema, invite, admin, navigation, and authorization support ship together.

Legend:

- **Own** — allowed for projects/items the user owns or is directly assigned to
- **All** — allowed across the internal workspace
- **Read** — view only
- **No** — not permitted
- **Planned** — capability becomes active only when the corresponding feature ships

| Operation | Consultant (`writer`) | Manager | Admin | Financial (planned) |
|---|---|---|---|---|
| Create a project | Yes; creator becomes Owner | Yes; creator becomes Owner | Yes; creator becomes Owner | No |
| Read internal projects | All, under the current visibility default | All | All | Read only as required for linked financial work; exact scope lands with the role |
| Edit report prose | Own and assigned collaboration contexts | All | All | No by default |
| Edit project details (titles, client name, project number, industry, science code, tags, fiscal year-end) | Own project or assigned collaboration context (the dashboard bulk edit stays own-project only as a mass-change safeguard) | All | All | No |
| Transfer project ownership | Own project to another eligible Consultant/Manager | All | All | No |
| Change workflow stage | Own project; or current handoff where the transition matrix permits | All | All | Linked financial stages only if later introduced; no technical-report stage changes initially |
| Create/assign a work item | Own project | All | All | Own financial work items when the financial workspace ships |
| Complete own assigned item | Yes | Yes | Yes | Yes for financial items |
| Complete another user’s item | No | Yes, with audit note | Yes, with audit note | No |
| Cancel/reassign an item | Items assigned by them or on projects they own | All | All | Financial items assigned by them |
| View team pipeline | No | Yes | Yes | No |
| Make a branch active | Own project | All | All | No |
| Promote a branch | Own project, subject to readiness rules | All | All | No |
| Record non-delivery outcome | Own project/branch | All | All | No |
| Record delivery/filing outcome | Own project, exact revision required | All | All | `used_in_filing` only if explicitly granted in the Financial role implementation |
| Read financial data | No by default; project-linked summaries may be added later | Yes | Yes | Yes |
| Write/review financial data | No by default | Yes | Yes | Yes |
| Manage users, invites, and roles | No | No | Yes | No |
| Configure models, tags, Brain, and global settings | No | No | Yes | No |
| View operational alerts and usage administration | No | Manager analytics only where explicitly granted | Yes | No |

All permissions must be enforced in Convex functions. Shared/client-review token flows remain separately scoped public capabilities and must not inherit internal role permissions.

## Decision register

These decisions provide defaults so implementation does not invent product behavior. A later ticket may amend a decision through a dated record and migration plan.

| ID | Decision | Status | Default/resolution | Consequence |
|---|---|---|---|---|
| D1 | Internal project visibility | **Deferred with default** | Preserve current firm-wide visibility for authenticated internal users. Do not introduce memberships or row-level project restriction during ownership/assignment work. PSOS-30 owns the future decision. | Capability hardening must preserve current read visibility unless separately approved and tested. |
| D2 | Ownership transfer authority | **Resolved** | The current Owner may transfer their project to another eligible Consultant or Manager. Managers/Admins may reassign any project. Creator identity is unchanged. | Transfer mutation requires expected-version/OCC and an immutable event. |
| D3 | Delivery authority | **Resolved** | Owner, Manager, or Admin may mark delivered, but only while recording an exact `delivered_to_client` or `used_in_filing` outcome. | Export does not grant delivered state. Financial filing authority may be added explicitly with the Financial role. |
| D4 | Stage automation | **Resolved for initial release** | No invisible automatic workflow transitions. Common actions may propose or atomically perform a clearly confirmed stage change. Technical generation changes never silently change workflow stage. | Keeps lifecycle understandable and recoverable for less technical users. |
| D5 | Financial visibility | **Deferred with default** | Admin and Manager can read/write existing financial data. The planned Financial role receives client/claim-period financial access plus only the technical-report context required for that work; Consultants have no broad financial access by default. | Exact field/query scope is finalized in PSOS-28 and PSOS-31/32 before the role is enabled. |
| D6 | Notification email provider | **Deferred** | Build in-app notifications first. Email delivery remains blocked until the provider is explicitly selected. If Resend is selected, use provider idempotency keys and a delivery ledger. | PSOS-17 stays blocked; no provider-specific schema or secrets are assumed. |
| D7 | Client-name normalization | **Resolved migration strategy** | Introduce durable `clients`, suggest normalized matches, and require human review for ambiguous names. Preserve `projects.clientName` through compatibility rollout. Never auto-merge fuzzy matches. | Client/claim-period migration uses widen → review/backfill → dual read/write → later narrow. |
| D8 | Branch retention and archival | **Resolved for initial release** | Preserve all materialized branches. Archived branches are hidden by default but recoverable. No automatic or permanent deletion in the initial release. Revisit after storage/usage evidence exists. | Candidate selection becomes non-destructive; storage growth is monitored rather than preemptively deleting work. |
| D9 | Outcome capture timing | **Resolved** | Ask non-blockingly after export, promotion displacement, or archive. Require an exact outcome when transitioning the project to `delivered`. A dismissed export prompt leaves a restrained reminder, not a blocking loop. | Outcome collection adds evidence without obstructing document export. |

## Cross-cutting engineering rules

- Schema rollout uses widen → idempotent/resumable backfill → consumer migration → later narrow.
- State-changing mutations validate expected revisions/versions where concurrent writes can conflict.
- Retryable operations and notification delivery use stable idempotency keys.
- State history is append-only for ownership, workflow transitions, work-item lifecycle, branch lifecycle, outcomes, and role-sensitive administrative changes.
- Indexed, paginated server queries power dashboard lanes; do not collect all projects and filter them in the browser.
- Denormalized pointers/counters are maintained in the same transaction as canonical rows.
- Failure states use typed, user-safe errors. Raw provider or Convex request strings are not end-user copy.
- UI follows the Ledger paper design system: dense ruled lists, explicit labels, one obvious next action, no generic card-heavy CRM, no color-only state, no hover-only controls, and mobile touch targets of at least 44px.
- Empty, loading, permission-denied, conflict, retry, and partial-success states are part of each feature’s acceptance criteria.

## Migration sequence

1. Establish this contract and reference it from project instructions.
2. Add optional ownership/workflow fields and immutable event storage.
3. Backfill conservatively and expose an ambiguity review queue.
4. Move reads and writes to the new workflow fields while preserving legacy compatibility.
5. Add work items/current handoff and indexed personal queues.
6. Add persistent branch storage before removing any destructive candidate-selection path.
7. Add outcomes before treating `delivered` as a valid terminal workflow stage.
8. Centralize capabilities, then migrate Convex functions module by module with role-matrix tests.
9. Introduce durable clients/claim periods through a separate reviewed migration.
10. Narrow or remove legacy fields only after measured verification and a dedicated decision.

## Approved amendments

### 2026-08-17 — Open workflow transition matrix

Domain amendment replacing the 47-edge explicit transition matrix with an
open matrix: every workflow stage may transition to every other stage,
with per-edge policy derived from origin/destination (see the rewritten
"Transition matrix" section).

- **Origin:** in-app flag from mobregon@banhall.com (2026-08-14) on
  project `k9749p01ks19rmy6nhjgq9yzzn8cem40`: stage changes were limited
  to adjacent matrix edges (e.g. Intake could not move directly to
  Internal review), forcing multi-hop workarounds. Product owner directed
  the fix on 2026-08-17.
- **What is widened:** all stage-to-stage edges are now allowed, including
  direct jumps (e.g. `intake` → `internal_review`) and exits from
  `delivered`/`abandoned` to any stage.
- **What is preserved:** authority checks (O/M/A default; M/A-only for
  reopening `abandoned` and for `delivered` → `on_hold`; H on the two
  internal-review completion edges); audit notes required when entering
  `on_hold`/`abandoned` and when leaving `delivered`/`abandoned`; the
  fail-closed `delivery_outcome` and `promoted_branch` requirements; the
  open-work check before `abandoned`; OCC versioning; append-only
  `projectEvents` audit records; idempotent same-stage no-ops.
- **What is removed:** the `review_handoff` requirement on
  `on_hold` → `internal_review`. Stage and assignment remain separate
  records; `internal_review` is enterable without an active handoff.
- **Implementation:** `shared/workflowTransitions.ts` generates the full
  matrix from these rules; `convex/projectWorkflow.setWorkflowStage` and
  the stage-change dialog consume it unchanged.

### 2026-08-14 (third) — rail micro-geometry and Home atmosphere restoration

Presentation-only owner direction from the three annotated Home comments and
live authenticated Attio inspection. No schema, query, mutation, workflow,
permission, authorization, route, or storage semantics change.

- The desktop workspace rail may use Attio-measured 8px gutters, 28px rows,
  48px identity placement, and a transparent 24px collapse target. The
  collapse glyph may crossfade to a library square-arrow glyph; the full rail
  still hides/restores through the existing persisted preference contract.
- Admin remains role-gated and server authorization remains authoritative.
  Its disclosure and all links retain their destinations and keyboard/ARIA
  behavior; only spacing, sentence-case hierarchy, and icon rhythm change.
- Home may restore the previously approved 40%-opacity token-derived shader
  wash behind intake. It is decorative, pointer-inert, aria-hidden, and adds
  no query, user data, project data, action, or product meaning.
- Tests cover shader presence/inertness, rail control wiring, and unchanged
  canonical Home/Projects links. Approval: the product owner requested these
  refinements on 2026-08-14.

### 2026-08-14 (second) — authenticated rail calibration and List-first ordering

Presentation-only owner direction from the two browser annotations. No schema,
query, mutation, workflow, permission, authorization, or storage semantics
change.

- The desktop workspace rail may adopt the measured Obvious 256px default,
  retain Attio-style full collapse, and narrow its browser-local resize range
  to 240-288px. Existing persisted widths clamp fail-closed. Navigation,
  capabilities, and route availability are unchanged.
- The rail may remove the redundant `Workspace` label and combine New project
  plus Search into one compact action row. Home, Projects, utilities, admin
  gating, and current-dashboard escape remain the same actions.
- The Projects layout toggle orders List before Board. The already-approved
  client-grouped List default remains authoritative; explicit URL or stored
  Board selections remain supported.
- Tests cover the new rail bounds, List-first toggle order, default List
  parsing, collapse/resize accessibility, and unchanged route behavior.
- Approval: the product owner explicitly requested Attio/Obvious-exact sidebar
  calibration and “list first and default” on 2026-08-14.

### 2026-08-14 — Authenticated Attio/Obvious layout-density pass

Presentation-only owner direction. No schema, query, mutation, workflow,
permission, authorization, or storage semantics change.

- The client-grouped Projects List may expose verified per-client `stageCounts`
  in each collapsed row so the repository remains informative without opening
  a per-client subscription. Missing or divergent counts remain explicitly
  pending; the six-open-section budget and disclosure query gate are unchanged.
- Home may render one always-visible `/projects` repository navigation card
  below intake. Device-local recents remain additive and explicitly qualified;
  the card does not represent a project, pin, server result, template, or
  activity feed. `With you` remains Home's only operational subscription.
- The workspace rail may group Home/Projects under a presentation label and
  move Settings into the utility region. Route availability and server-side
  authorization remain unchanged.
- Tests cover the truthful no-recents repository continuation, stage summaries
  from verified counts, pending-count treatment, and unchanged disclosure/query
  gating. Approval: the product owner requested the authenticated Attio and
  Obvious redesign/rethink pass on 2026-08-14.

### 2026-08-12 — Client Focus drill-in removed; flat client card lanes; inline hidden-stages disclosure retired

Owner-directed presentation amendment to the client-grouped Projects board.
No schema, query, mutation, or authorization change; the server projections
(`dashboard.listCompanies`, `dashboard.listCompanyProjectsByStageRank`) and
their honesty contracts are untouched.

- **Focus drill-in removed (owner direction).** The focused single-client
  board (`ProjectsClientFocusBoard`), its `?client=` board deep link, the
  "All clients" breadcrumb, the lane "Focus" links, and the mobile
  "Stage N of M" selector are deleted. This supersedes the 2026-08-06
  second amendment's focused-board clauses (drill-in state, `?client=`
  deep-link resolution, and the focused board as fallback default). The
  retired `?client=` param on `/projects` is now ignored — it never
  resolves to a focused surface. The **`/project/new?client=` wizard
  prefill is a different, unrelated parameter and remains supported**, as
  does the client-scoped "+ New project" quick-create on lane/section
  headers (editable recorded-name prefill; omitted for "No client
  recorded").
- **Lanes render the standard stage-column board per client, showing all
  loaded projects.** Each expanded client lane renders the SAME kanban
  anatomy as the ungrouped `/projects` board (the shared `ProjectsBoard`
  component): same-tone stage columns at the governed width, tinted-shell
  cards (client line suppressed — the section band names the client),
  horizontal snap scroll with the edge cue, and per-column "+ Add new"
  creation footers carrying that client's recorded-name prefill (the
  wizard's own `?client=` param; omitted for "No client recorded"). Columns
  take natural height — the grouped board's outer vertical scroller owns
  the vertical axis. Per-client hide-empty honors that client's OWN
  verified exact `stageCounts` (absent or sum-divergent = nothing hidden,
  loaded-only counts with honest qualifiers — the existing count ladder).
  The 2026-08-06 three-card-per-column preview and the "Show N more in
  Focus" remainder navigation are retired: ALL loaded projects render, and
  when the server page is bounded the lane ends with an honest in-place
  "+N more" load-more control (recorded `projectCount` minus loaded rows) —
  never a navigation. Subscription budget (six live sections, LRU
  eviction), the collapsed zero-subscription contract, the recorded-name
  qualifier, and the backfill notice are unchanged.
- **Inline hidden-stages disclosure retired (all surfaces).** The
  "N empty stages hidden — Show" affordance is removed from the stage-first
  board and the client-grouped list: hidden empty stages simply do not
  render, and the Display menu's persisted "Hide empty stages" switch is
  the ONLY reveal control. This supersedes the 2026-08-06 second
  amendment's "always disclosed by a visible, focusable affordance" clause
  and the matching 2026-08-10 clause. The truth criteria are unchanged
  (bounded facet counts globally, verified exact per-client counts on
  client surfaces, never loaded-rows-zero), as is the honest disabled
  pre-backfill client control. The Display menu's client hide-empty switch
  remains available in grouped Board mode, where it governs every
  per-client board's columns at once.
- **Tests:** superseded contracts rewritten in the same change
  (`ProjectsTableViewGrouping`, `ProjectsClientGroup(s)` component tests,
  `projectsTablePreferences` unit tests — focus-param helpers deleted);
  the wizard `?client=` prefill and lane keyboard reachability remain
  covered.
- **Approval:** product owner directed the removal and the lane redesign in
  the 2026-08-12 request.

### 2026-08-11 (second) — Review projects created from an existing project

Additive amendment approved from the client meeting (owner top priority).
The client's request, paraphrased from the meeting: from a written PD
project, trigger PD-review mode that inherits the title, writer, and ALL
supporting documents so nothing is re-collected; the review lives as an
associated project; review mode must show the PD in the text editor
alongside the AI feedback.

- **Affected tickets:** BNH-39 (PD review mode) follow-up; no PSOS workflow
  ticket — workflow-stage semantics are untouched.
- **Storage:** `projects.sourceProjectId` (optional `Id<"projects">`, no
  index) on the REVIEW project points at the source project whose report it
  reviews (review → source). The association is **navigational only**: no
  workflow, ownership, stage, handoff, or outcome coupling crosses it in
  either direction, and neither project's lifecycle constrains the other's.
  `createdBy` remains immutable audit identity and is not repurposed.
- **Creation:** `reviewFromProject.createReviewFromProject` (action) is the
  one sanctioned writer of the association. It requires the same authority
  as project creation (`project.create` plus an active internal role) and
  read access to the source project, and fails closed (`INVALID_INPUT`)
  when the source has no report. It creates the review project with the
  wizard path's insert conventions — mode `review`, initial stage `intake`,
  creation events, dashboard company/stage counting in the same transaction
  — and the authenticated caller becomes Creator **and** initial Owner per
  the 2026-07-30 amendment (never the source project's Owner). It then
  copies the source's transcript, support documents, archived documents,
  review PDs, and original file bytes through the existing duplicate-flow
  internals (`projects.prepareProjectContentCopy` /
  `finishProjectContentCopy`), serializes the source's **latest report** to
  plain text as a `projectDocuments` row with source `review_pd` — the
  report snapshot becomes the written PD under review — and starts the AI
  review through the same guarded insert-and-schedule path as
  `startPdReview` (including the already-running guard).
- **Presentation:** the report workbench header gains a ghost "Start AI
  review" icon action; a review project's metadata grid renders a "Reviews"
  link to its source project; and review-mode projects **with** a report
  render the AI feedback report in the workbench's supporting panels, so
  the PD (in the editor) and the feedback are visible together.
- **Migration and compatibility:** widen-only optional field; no backfill
  (existing review projects legitimately have no source), no index, no
  narrow phase. Deleting the source project may leave the pointer dangling;
  consumers treat an unresolvable source as "no association to show" rather
  than an error.
- **Authorization and tests:** no new permission surface — creation reuses
  `project.create` + internal project access, and the content copy keeps
  its existing access checks. Convex tests cover the created association
  (`sourceProjectId`, creator-as-Owner, intake stage), the inherited
  `review_pd` document serialized from the report, the running `pdReviews`
  row, the copied documents, and the no-report failure.
- **Approval:** product owner directed this as the top-priority client
  request on 2026-08-11.

### 2026-08-11 — Per-company project numbering with draft-letter identity

(Owner clarification, same day: number and letter identities COMPOSE — a
project may be labelled `2A`, `3B`, etc. Validation is `1–20`, `A–Z`, or
`<1–20><A–Z>`; normalization stays trimmed-uppercase.)

Additive storage amendment approved from the owner meeting. Meeting
rationale, quoted: "final projects are numbered sequentially with no gaps
1..N (≤20 per company); uncertain/draft projects carry a LETTER identity
(A..Z) that can later be converted to a number; conversion preserves the
project and all its associations — it is just a label change."

- **Storage:** `projects.projectNumber` (optional string, no index) holds
  either a final number `"1"`..`"20"` or a draft letter `"A"`..`"Z"`.
  Absent means "not yet assigned". Values are stored trimmed and
  uppercased. No other project field is repurposed; `createdBy` and all
  workflow/ownership semantics are untouched.
- **Mutation:** `projects.setProjectNumber` is the one sanctioned writer.
  Authorization is `requireInternalProjectAccess` (same as sibling project
  metadata mutations). It validates `/^([1-9][0-9]?|[A-Z])$/` and rejects
  numeric values above 20 (`INVALID_INPUT`); empty/omitted clears the
  field. It bumps `updatedAt` like sibling metadata mutations and does not
  touch the dashboard projection (the field feeds no projection-derived
  value; it is a raw-doc pass-through on `dashboardProjectRow`).
- **Conversion semantics:** converting a letter project to a number is
  exactly a `setProjectNumber` call — a label change only. The project
  document, its `_id`, and every association (transcripts, reports, work
  items, tags, workflow history) are preserved; no copy/recreate flow
  exists or is permitted.
- **Sequencing honesty:** the "sequential with no gaps 1..N per company"
  rule is an operator practice this amendment records; the system does not
  yet enforce cross-project uniqueness or gap-freeness per company (no
  index, no counter). Enforcement, if wanted, is a future amendment.
- **Presentation:** the Preview project metadata grid gains an inline-edit
  "Project #" field; board cards render the value as a faint mono data
  chip (`#3` / `#A`) — identity only, never a status or priority signal.

### 2026-08-10 (third) — Chrome-less Home plane; persistent rail creation anchor

Presentation-only amendment. **No domain vocabulary, workflow transition,
permission, query-semantic, or storage change.** Supersedes two clauses:
the 2026-08-08 rail clause "the duplicate rail action is shown only in the
Projects workspace", and Home's use of the compact in-plane toolbar.

- **Affected tickets:** PSOS-14 presentation follow-up; no backend ticket.
- **Home chrome:** `/my-work` renders no in-plane toolbar (Obvious Home
  parity: the content plane opens directly with the greeting/intake hero).
  The workspace rail is Home's chrome: it carries the persistent
  "New project" creation anchor on **every** view (Obvious's sidebar "New")
  and the search control. The drawer hamburger (below 1280px) and the
  rail-restore control (while the rail is hidden) float over the plane's
  top-left so navigation stays reachable; both render nothing against an
  expanded desktop rail. Projects keeps the existing toolbar unchanged.
- **Search from Home:** search remains project discovery. Invoking it on
  Home (rail button or ⌘K/Ctrl K — Home owns the shortcut while no header
  is mounted) navigates to `/projects` with a one-shot, TTL-bounded focus
  handoff so the caret lands in the Projects search field after the
  remount. The typed-query handoff, canonical URLs, `/dashboard`
  compatibility, and `?workspace=current` rollback are unchanged.
- **Migration and tests:** No schema or data change. The superseded
  HomeParity "duplicate New project" assertion updates in the same change
  (rail anchor now expected on Home; no header element on Home; floating
  controls present); focus-handoff unit tests added.
- **Prompt-box intake (same date, follow-up direction):** the Home start
  form presents as one quiet prompt container (Obvious prompt anatomy):
  borderless title/transcript fields inside a rounded container that owns
  the focus treatment via `focus-within` border shift; the fields opt out
  of the global input focus ring through the `input-chromeless` utility
  (layout.css), which must never be used outside a container providing its
  own visible focus state. Field labels remain in the DOM as `sr-only`;
  attach and Start project act as accessibly-named icon buttons in the
  prompt toolbar row. Behavior is unchanged: still pure navigation into
  the wizard with the same one-use in-memory handoff.
- **Approval:** Product owner directed removing Home's nav bar while
  keeping the sidebar creation button, matching the authenticated Obvious
  board/home evidence, and the prompt-box input treatment in the
  2026-08-10 requests.

### 2026-08-10 (fourth) — Rail utility IA; wash/radius presentation

Presentation-only amendment. **No permission, query, or storage change** —
server-enforced authorization is untouched; rail visibility gating is
presentation on top of it.

- **Rail IA:** the workspace rail's bottom utility group gains Settings
  (all roles), Admin (`/admin/users`, rendered only for the admin role —
  visibility only; admin routes keep their server checks), Flag issue
  (raises the existing ErrorMonitor manual dialog via a window event; the
  global floating button hides while a workspace shell is mounted), and
  the contract-required current-dashboard escape (unchanged semantics,
  now a direct row). The **More menu is retired**; Self-Serve intake
  remains reachable at `/project/questionnaire` (current-dashboard entry
  points unchanged). **Rail recents are removed** — Home's "Recently
  opened" band is the single device-local recency surface; the recents
  storage contract is unchanged.
- **Wash:** Home shader band at 40% opacity; backing-store resizes are
  debounced (the per-tick buffer clear flashed during rail drags) and the
  first frame renders unconditionally so mounts never flash blank.
- **Radius:** Home containers align to the board-card `rounded-xl` scale;
  pill/circular treatments remain reserved for pill chips and icon
  buttons.
- **Approval:** product owner directed all three in the 2026-08-10
  requests.
- **Board light-card anatomy (same date, follow-up direction):** measured
  live against Obvious's LIGHT theme (white `bg-surface` card, 1px
  rgba(0,0,0,.04) hairline, soft shadow; stage colour only in the column
  label chip). Board cards drop the stage-tinted shell/footer band
  (supersedes that clause of the 2026-08-08 design-system amendment);
  paused keeps the dashed cue; the column chips remain the labelled stage
  colour carrier, so text+colour state is preserved. Cards gain distinct
  client (building) vs owner (person) icons, dates join the shared sans
  row type, and metadata rhythm tightens. Toolbar filter/group/display
  controls present as Obvious-style borderless ghost chips. **Hide empty
  stages defaults ON for the global board** (supersedes the 2026-08-06
  board-OFF default); the visible "N empty stages hidden — Show"
  disclosure remains the truth affordance.

### 2026-08-10 (second) — Board-card current-handoff projection; card-preview and Home-feed rejections

This amendment lifts the deferral recorded in the 2026-08-08 board-card
metadata amendment ("Current-handoff assignee/kind on board cards is
deliberately deferred: it requires a bounded per-page server projection …
reviewed as its own backend change — never per-card subscriptions"). That
reviewed backend change is this amendment.

- **Affected tickets:** PSOS-14 presentation follow-up and the PSOS-11
  projection work.
- **Backend:** The shared per-page row projection used by the four dashboard
  list queries (`listFlatProjects`, `searchProjects`, `listCompanyProjects`,
  `listCompanyProjectsByStageRank`) additionally resolves each row's
  `projects.currentHandoffId` — one deduplicated `workItems` get per
  pointered row on the already-bounded page, with assignee labels resolved in
  the same batch as owner labels. The projected `currentHandoff` field
  carries kind, assignee id/label, blocking, and dueAt. Defensive truth: a
  stale pointer (missing item, non-`open` status, or an item belonging to a
  different project) projects nothing rather than a wrong "With". No new
  query, no per-card subscription, no schema change, no mutation change; D1
  read visibility is unchanged.
- **Presentation:** Board cards (stage-first board, client lanes, focused
  client board — all consumers of the shared card) render the projection as
  a "With" field: assignee label, work-item kind label, and due date when
  recorded. Canonical vocabulary is enforced: "With" is the current-handoff
  assignee, never the Owner; the Owner row is unchanged. Cards without an
  open blocking handoff render no handoff row — never a placeholder.
- **Rejected interpretations (recorded so absence is a decision):**
  (a) **Report-snippet card previews** (Obvious's live artifact thumbnails)
  are rejected: a per-page read of report content would couple dashboard
  subscriptions to report autosave invalidation, and a denormalized snippet
  field would put dashboard writes on the autosave hot path — both violate
  the report-primacy and subscription-budget rules; cards must summarize
  accountable state, not preview prose. (b) A **Home activity feed** is
  rejected: the 2026-08-10 Home simplification deliberately released Home's
  operational subscriptions; per-project activity remains served by the
  existing bounded `projectActivity.listProjectActivity` timeline on the
  project's Workflow details rail.
- **Migration and tests:** No schema or data change. Convex tests cover the
  projected handoff (kind/assignee label/blocking/dueAt) and the
  stale-pointer nothing-projected cases; board-card component tests cover
  the rendered "With" row and its absence without a handoff.
- **Approval:** Product owner directed implementation of the remaining
  Obvious-parity ideas in the 2026-08-10 request; this amendment records the
  domain-truthful scope of that direction.

### 2026-08-10 — Home start-project prompt

Presentation-only amendment approved from the supplied Customer.io Agent and
Obvious Home references. `/my-work` may place a large start-project prompt
above the existing operational queue, provided it remains navigation into the
existing project wizard rather than an assistant, chat, or generation action.

- Home accepts an editable internal project title plus an optional interview
  transcript. The transcript may be pasted or parsed browser-side from a Teams
  Word `.docx`; only the extracted text and optional filename cross the route.
  These values cross only the immediate client-side navigation through a
  one-use, five-second in-memory handoff; they are not placed in the URL,
  browser history, durable browser storage, Convex, or application data.
- Home performs no upload. The wizard receives editable values and continues to
  own project creation, transcript persistence, validation, and generation.
- Empty submission opens the ordinary blank wizard. Duplicate-project prefill
  remains authoritative when present, and client-name prefill remains a
  separate editable field.
- The canonical `/my-work` URL, feature gate, and
  `/dashboard?workspace=current` rollback are unchanged. A later approved Home
  simplification removes the loaded insight strip and the Next actions, Owned
  by me, and Waiting on others projections from this route, releasing their
  subscriptions rather than hiding still-live data.
- Device-local recents may remain beneath the prompt. No AI assistant,
  artifacts, templates, inline report generation, fake metrics, or unsupported
  object types are introduced.


### 2026-08-07 — Admin workspace-shell presentation expansion

Presentation-only amendment approved in the 2026-08-07 admin-shell redesign
request. **No domain vocabulary, workflow transition, permission, query,
mutation, authorization, or storage semantics change.**

- The authenticated admin routes `/admin/usage`, `/admin/reviews`,
  `/admin/brain`, `/admin/models`, `/admin/tags`, `/admin/users`, and
  `/admin/backfill` may use the shared fir-railed workspace chrome with a
  light, normally scrolling operational content plane. Admin destinations
  remain in the account utility menu rather than becoming primary workspace
  navigation.
- Route pages continue to own their existing queries, mutations, access
  checks, and content. `AdminWorkspacePage` owns presentation only: one page
  heading, compact header/actions, content width, gutters, and scroll
  containment. It must not duplicate an experience subtree or own business
  authorization.
- `/my-work` and `/projects` remain the canonical global destinations. The
  desktop rail remains browser-locally resizable with a 255px default; below
  1280px the navigation remains a modal drawer with focus trapping, Escape,
  scroll lock, and focus return. Nested account menus must render above the
  drawer and retain 44px touch rows.
- `?workspace=current` selects the prior AppNav/PageBar presentation for the
  same admin URL without changing or duplicating route data behavior. This is
  a UI-only rollback contract and does not depend on a backend rollout gate.
- Mobile table/tabs containment and localized touch-target corrections are
  presentation fixes only. Existing server-enforced admin permissions remain
  authoritative and unchanged.

**Migration and tests:** no schema, data, or Convex change. Component/route
tests cover landmarks, canonical shell links, admin content widths/actions,
drawer menu layering, and the `?workspace=current` branch. **Approval:** the
product owner explicitly approved this presentation expansion in the
2026-08-07 implementation request.

### 2026-08-08 (second) — Obvious-parity presentation: Home boundary/recents and Preview project intake workbench

Presentation-only amendment. **No domain vocabulary, workflow transition,
permission, query-semantic, or storage change is made by this amendment.**
Evidence: the completed AUTHENTICATED comparative audit of app.obvious.ai
(direct desktop, 2560×1266) recorded 2026-08-07/08 — the first amendment in
this document backed by live authenticated Obvious evidence rather than
recorded research alone.

- **Affected tickets:** PSOS-14 presentation follow-up and the preview
  report-workbench work; no backend ticket (zero Convex changes ship).
- **Home:** content centers in a `--container-shell` boundary; a
  "Recently opened · on this device" horizontal module renders from the
  existing browser-local `recentProjects` list only (no new queries, no
  server pins; absent recents render nothing). Queue primacy, the five
  accountability meanings, scope-chip query swapping, truthful loaded-only
  counts, all subscriptions, canonical URLs, `/dashboard` compatibility,
  and the `?workspace=current` rollback are unchanged.
- **Preview project route (preview subtree only):** the no-report/intake
  state presents as a desktop split workbench — left contextual pane
  (files evidence + interview transcript), right primary intake/generation
  surface — with independent pane scrolling, a persisted resizable
  separator, and narrow-screen Work/Context switches. The generated-report
  state keeps its Agent-left/Report-right split and query gating. All
  generation states, dialogs, OCC/autosave behavior, exports, comments,
  workflow controls, and report primacy are preserved. `CurrentProjectPage`
  and the `?workspace=current` rollback remain untouched.
- **Explicit domain deviations from Obvious (rejected interpretations):**
  no freeform AI achievement composer, artifact shortcut chips, idea
  templates, or pinned apps on Home; no fabricated chat/report on projects
  without one; no artifact tabs, drag/drop, or "Add new" column/card
  mutations; Obvious accessibility defects are not reproduced.
- **Migration and tests:** no schema or data change. New browser component
  tests cover the Home boundary/recents module, the intake split and its
  narrow-screen modes, heading naming, Files disclosure semantics, and the
  view-toggle tab sequence; the rollback-purity sentinel, route/gate, and
  existing workspace tests remain in force.
- **Approval:** product owner approved implementing the Obvious-inspired
  redesign from the authenticated audit in the 2026-08-08 implementation
  request ("copy exactly", qualified by the recorded trademark/domain-truth/
  accessibility deviations above).

### 2026-08-08 — Home presentation of /my-work, board-card metadata, workspace-rail ergonomics

Presentation-only amendment. **No domain vocabulary, workflow transition, permission, query-semantic, or storage change is made by this amendment.** The five accountability meanings, their indexed queries, the subscription budget, WorkspaceGate, `/dashboard` compatibility, unknown-param preservation, and the `?workspace=current` rollback all remain exactly as recorded in the 2026-08-06 amendments.

- **Affected tickets:** PSOS-14 presentation follow-up; no backend ticket (no Convex change ships with this amendment).
- **Home rename:** The default daily destination presents as **"Home"** in the workspace rail and content header. Its canonical URL remains `/my-work` (the 2026-08-06 canonical-URL clause is unchanged — this renames the label, nothing else). `/dashboard?view=my_work` compatibility, soft-redirects, and `?workspace=current` behave exactly as before. Kill-switch/readiness downgrade copy references Home.
- **Home composition:** Home renders a restrained time-of-day greeting (identity from the existing `users.getCurrentUser` query — deduplicated client-side with the rail's subscription; no new server load), the start-project intake, and optional device-local recents. **2026-08-10 simplification:** the loaded-insight strip and the Next actions, Owned by me, and Waiting on others regions are removed from Home; their paginated subscriptions and reconciliation-state subscription are released on this route rather than retained invisibly.
- **Board-card metadata:** Projects-board cards add the created date (from the projected `createdAt`, falling back to `_creationTime`; rows lacking both omit the field rather than inventing a date) beside the updated date, both in the mono date role. Canonical Owner display rules are unchanged (legacy writer only with its explicit "Writer · legacy" qualifier). **Current-handoff assignee/kind on board cards is deliberately deferred**: it requires a bounded per-page server projection (workItems + assignee label resolution across the four dashboard list queries) reviewed as its own backend change — never per-card subscriptions. This deferral is recorded here so the absence is a decision, not an oversight.
- **Stage-related card presentation:** governed by the design-system amendment of the same date (stage-toned border + tinted footer band from the canonical `STAGE_CARD_THEMES` tier; text labels always accompany colour; no drag-to-transition, no invented priority field, no arbitrary state changes — boards remain navigational projections).
- **Workspace-rail ergonomics:** The desktop rail is pointer- and keyboard-resizable (min 220 / default 255 / max 360) and fully hide/showable from a persistent, accessible header control; width and hidden state are **browser-local presentation preferences** (fail-closed parse, like the layout preference) — never server state. The mobile drawer is independent and unchanged.
- **Migration and tests:** No schema or data change. Superseded presentation assertions ("My work" rail/header label) update in the same change; new unit/browser tests cover rail preference parsing/clamping/persistence, resize/hide interactions, disclosure animation + aria lifecycle, Home greeting/insight truth, and card created/owner hierarchy.
- **Approval:** Product owner approved this workspace overhaul (Home rename + composition, polished status board with restrained stage-toned cards, resizable/hidable rail, motivated disclosure transitions) in the 2026-08-08 implementation request. No authenticated live Obvious evidence informs this amendment (Chrome control was unavailable); the evidence base is recorded Mobbin research, prior recorded Obvious evidence, and the supplied sprint-board screenshot.

### 2026-08-06 (second amendment) — Client → Status grouping, hide-empty display option, queue-first My Work, same-tone column anatomy, scoped creation affordances

This amendment supersedes four clauses of the earlier 2026-08-06 amendment and one clause of 2026-08-05: (a) "The Projects Board stays stage-first and gains no client/company axis"; (b) the unconditional rendering of all ten stage columns with the "No loaded projects in this stage." empty-body copy; (c) "My Work keeps exactly the five canonical accountability lanes … does not add a grouping axis"; (d) "Add-new affordances … deliberately NOT copied." All other clauses of both amendments — canonical URLs, `?workspace=current` precedence, current-interface freeze, report boundary, scoped shell extension, pipeline-order correction, frozen persisted ranks — remain in force.

- **Affected tickets:** PSOS-14, PSOS-11 (projection), the workspace-preview rollout work; a new backend widen ticket for the stage-ranked client projection.
- **Board client axis:** The Projects Board may group by client **as a display grouping of recorded client names** (identical D7 language and caveats as the approved List grouping — never a durable Client/Company entity, no merge affordances, no client pages implied; the recorded-name qualifier and the backfill-completeness warning carry verbatim onto every client-grouped surface). Chosen interpretation: **stacked per-client lanes** (each lane a horizontal row of stage columns for that client, lanes collapsible and paginated A–Z), with a **single-client focused board** as the drill-in state reachable from every lane and by URL (a `?client=` deep link alone resolves to the focused board — never an inert parameter). The focused board is the approved fallback default if lane review at production client counts fails. Lane stage columns keep the governed 360px width and preview at most three cards; the truthful remainder is disclosed as a "Show N more in Focus" link into the focused board — lanes never grow an inner vertical scroller or a viewport-tall stack (correction 2026-08-06). At most **six** client sections hold live per-section queries simultaneously — user toggles and the bounded, honestly labelled "Expand first 6" control included; opening a section beyond the cap releases the least-recently-opened one (correction 2026-08-06). Projects with no recorded client name render in a conditional "No client recorded" lane/section that appears only while its count is non-zero; its creation link carries **no** name prefill. Below the `md` breakpoint the grouped board presents as the grouped List; the focused board presents one stage column at a time with an explicit "Stage N of M" indicator and an accessible stage selector that scrolls/focuses the chosen column (presentation navigation only — never a mutation). Grouped-board mode uses an outer vertical scroll owner with one horizontal scroller per expanded lane and no per-column vertical scroll; the stage-first and focused boards keep the existing containment chain.
- **Hide-empty:** All ten canonical stages remain the **default** on the stage-first board. A user-controlled, persisted display option ("Hide empty stages") may collapse zero-count stages. Truth criteria: on the global board, a stage is empty only when the bounded facet count is 0 (when facets are truncated, the control's label carries the bound qualifier); on client-scoped surfaces, only when the **verified** exact per-client `stageCounts` value is 0 — a record is trusted only while its sum equals the maintained `projectCount`; an empty or sum-divergent record is treated as not-backfilled (correction 2026-08-06). Loaded-rows-zero is never a hide criterion. Hidden stages are always disclosed by a visible, focusable "N empty stages hidden — show" affordance; client-scoped surfaces default the option ON (structural sparsity), the global board defaults it OFF. Before verified per-client counts exist, client-scoped hiding is disabled **and the control itself presents disabled with the copy "Available after client counts finish backfilling"** — never an active-looking switch that hides nothing (correction 2026-08-06); the control stays present (honestly stated) in focus mode too. All columns then render with loaded-only counts and `+` qualifiers; a bounded/unknown zero renders `0` with an explicit "not fully loaded" note — never `0+` and never a false exact zero.
- **My Work:** The five canonical accountability **meanings** — my open assignments, my ownership, my review duty, my due/overdue pressure, work I am waiting on — and their existing indexed queries are the invariant; the five-equal-stacked-sections **layout** is not. My Work presents one primary due-ordered queue fed by `listAssignedToMe`, with Reviews and Due soon as scopes that swap the subscribed indexed query (never client-side filters) — **only the active scope carries a count** (its truthful loaded count); inactive scopes are labels without counts, because exact inactive counts would require standing subscriptions or a `userWorkCounters` denormalization, which remains a recorded later option and is deliberately not part of this change (correction 2026-08-06; no count is promised that the budget does not pay for). The scope chips are a plain `role="group"` of `aria-pressed` toggle buttons, not a `tablist` (they do not implement the APG tabs keyboard contract). Owned by me / Waiting on others remain compact secondary regions. Each meaning stays individually reachable, labelled, and truthful; one visible row per work item per scope. Work-item actions, server-computed permissions, expected-version checks, STALE_REVISION recovery copy, idempotent completion, bounded-count semantics, and the waiting-lane reconciliation notes are unchanged. The My Work Board/List presentation toggle is retired; the stored preference parses fail-closed to the queue.
- **Column anatomy:** Board columns are same-tone containers on the workspace canvas — column fill equals the canvas token, structural radius retained, no border, no contrast well, no tint. Empty columns render header (and footer only where a creation affordance is defined) with no empty-state body box; the bounded-scan truth ("0", `N+`, "none loaded yet") lives in the header. Non-intake columns terminate after their last card. `docs/design-system.md` is updated in the same change (PRODUCT.md reconciliation clause).
- **Creation affordances:** All creation affordances are navigation into the existing wizard; the board itself never mutates. Approved placements: the global New project action; a client-scoped "+ New project" on client lane/section headers navigating to `/project/new?client=<recorded name>` (an editable free-text prefill — no durable-Client implication); an intake-column-only "+ New project" footer (truthful: creation always enters intake). Per-status "create here" on any other column is explicitly rejected — `createProject` accepts no stage and the transition matrix governs stage entry. Creator-becomes-Owner and no-foreign-owner rules are unchanged.
- **Migration and compatibility:** Widen-only schema change: new `projects` index `by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt` and optional `dashboardCompanies.stageCounts` (record of canonical stage literals + `"legacy"`, invariant `sum(stageCounts) === projectCount`), maintained in the same transaction by **every** `workflowStage` writer through the single sanctioned helper (`patchProjectWorkflowStage` — stage transitions, the confirmed-stage-change work-item path, and the stage-heuristic owner backfill; correction 2026-08-06 after the B1 drift finding), plus project create/delete and client-name reassignment. Idempotent, resumable, `runKey`-fenced backfill with a rank-presence verification pass first (a non-zero missing-rank count **hard-fails a live run** with a recorded remediation; it never writes on an unverified base), a per-company sum-vs-`projectCount` guard in the counting pass (divergent companies are recorded, never written — `{}` is never persisted on a counted row), one company per scheduled transaction, a stale-run takeover window plus an explicit `force`, and a per-bucket verification pass after. Consumers treat absent **or sum-divergent** `stageCounts` as not-yet-backfilled and fail honest (loaded-only counts, no hiding). No narrow phase in this release. All existing queries, the current interface, `/dashboard` compatibility, and `?workspace=current` remain intact as the rollback target.
- **Authorization and tests:** No permission changes; feature flags continue to gate exposure only. Per D1, every dashboard read query — including the new `getCompany` and `listCompanyProjectsByStageRank` — keeps the pre-existing authenticated-internal-user read visibility of `listCompanies`/`listCompanyProjects`; a capability-based read hardening that denied previously-visible roleless signed-in users was reverted on 2026-08-06 as unapproved scope creep (mutation-side authorization is unchanged and unweakened). Superseded test contracts change in this same PR: `ProjectsBoard.component.test.ts` (well/empty-box/no-Add-new/all-ten-unconditional assertions → same-tone anatomy, header-carried truth, hide-empty criteria + disclosure, intake-footer semantics, all-ten default), `ProjectsTableViewGrouping.component.test.ts` ("board never gains client axis" → lane/focus contracts + caveats), `MyWorkLaneSort.component.test.ts` and My Work view tests (five-stacked-lanes → five-meaning reachability, scope-chip server-query swap, unchanged action permissions/OCC copy). New tests: `stageCounts` maintenance and sum invariant, backfill idempotency/verification, stage-ranked query ordering (including missing-rank and legacy-rank rows), no-op transition leaves the company row untouched, wizard `?client=` prefill, hide-empty disclosure a11y, lane keyboard traversal. Unchanged and must stay green: WorkspaceGate/route tests, `?workspace=current` precedence, param preservation, truthful-count qualifiers, owner ladder and legacy qualifiers, work-item action permissions, viewport containment (amended only for the grouped board's outer-scroll chain).
- **Rejected interpretations:** client × stage matrix cells; per-cell live subscriptions; hiding stages on loaded-rows-zero; reusing global facets for per-client truth; per-status creation; drag-to-transition; client grouping on My Work; editing `WORKFLOW_STAGE_PERSISTED_RANK`; any durable Client entity or fuzzy-name merging.
- **Approval:** Product owner approved the full redesign contract on 2026-08-06 (§G of the 2026-08-06 synthesis: amendment as a whole; client lanes with focus as the primary Board form; retirement of the My Work Board/List toggle; the intake-column-only creation footer). The local Convex data backfill is tooling-only until separately requested: no data-changing backfill or rollout mutation runs with this change.
- **Corrections (2026-08-06, post-review):** This amendment's clauses above were corrected after the independent implementation review and authenticated live QA of the same date, to describe shipped behavior truthfully: centralized stage-writer counter maintenance (B1), the live-backfill missing-rank hard gate and divergence guard (H2/H3), the six-section live-subscription cap, bounded lane previews at the governed 360px column width, the mobile client-scoped creation affordance, the honest disabled pre-backfill hide-empty control (all surfaces, focus included), the mobile focused-board stage indicator/selector, the "No client recorded" label with no prefill, active-count-only My Work scope chips as a toggle group, the `0` + "not fully loaded" treatment replacing `0+`, and the reverted read-authorization hardening. The lanes + Focus architecture itself is unchanged.

### 2026-08-06 — Canonical workspace URLs and always-visible canonical board columns

- **Affected tickets:** PSOS-14 and the workspace-preview rollout work.
- **Canonical URLs:** The flagged workspace's destinations gain canonical routes: `/my-work` is the
  canonical URL of the default daily destination (My Work remains the default destination — this
  names its URL, nothing more) and `/projects` is the canonical URL of the dense repository view.
  `/dashboard` is preserved **permanently** as the compatibility entry (bookmarks, emails, and the
  rollback target keep working at the same canonical route). For users in the preview cohort,
  `/dashboard` soft-navigates (client-side `replaceState`) to the canonical route — `/projects` when
  `?view=all_projects`, otherwise `/my-work` — preserving `layout`, `workspace`, and unknown query
  params. Users outside the cohort see `/dashboard` unchanged, and requests to `/projects` or
  `/my-work` soft-redirect to `/dashboard?view=…` with params preserved — never a 404, never a
  preview flash (a neutral loading state renders while the rollout decision loads).
  `?workspace=current` wins on every gated route, including mid-load and on query error. No
  destination, lane, stage, permission, or query semantics change; the rollout gate
  (master switch AND per-user access, fail-closed) is reused unchanged, and feature flags continue
  to control exposure, never authorization. No email address appears in source.
- **Board columns:** Clarifying the 2026-08-05 projections amendment: the Projects board renders
  **all ten canonical workflow stages** in `WORKFLOW_STAGE_PIPELINE_ORDER`, full width, including
  zero-count stages. `WORKFLOW_STAGE_PIPELINE_ORDER` itself is corrected (2026-08-06) to match the
  canonical stage table above: `… ready_for_delivery → delivered → on_hold → abandoned`. Delivery
  completes the pipeline; the paused/terminal exceptions (`on_hold`, `abandoned`) present after it.
  The constant previously placed `on_hold` before `delivered`; that ordering was an implementation
  artifact, never an approved contract. **Persisted sort ranks are unchanged:** the stored
  `projects.workflowStageRank` values (indexed by
  `by_ownerId_and_workflowStageRank_and_updatedAt`) keep their historical numbering
  (`on_hold` = 7, `delivered` = 8), frozen in an explicit map in `shared/workflowStages.ts`, so this
  correction mutates no data and keeps stored rows, new writes, and backfill verification
  byte-consistent. Consequence until a future audited re-rank: the My Work "Owned by me" lane, which
  sorts by the stored rank, orders a member's `on_hold` projects before `delivered` ones; realigning
  those two ranks requires the existing `myWorkBackfill` re-rank plus its own amendment note, and is
  deliberately out of scope here. No stage semantics, transitions, or permissions change. Only the explicitly qualified `Legacy status` compatibility column is
  conditional — it renders only while legacy rows or counts exist, so an emptied compatibility
  column does not advertise an artifact forever. Empty columns state "No loaded projects in this
  stage." (a bounded-scan truth, never a completeness claim); header counts keep the `+` qualifier
  whenever facets are truncated or pagination is not exhausted; when a facet count exists but no
  rows are loaded, the header carries a "none loaded yet" subtext. Column headers are focusable
  and labelled ("«Stage», N projects") so the full column track is keyboard-traversable. Lane
  backgrounds stay neutral; stage tone remains confined to the header chip and card shell, with
  keyboard `focus-within` receiving the same affordance as hover.
- **Client-name inspection:** Projects List may use the indexed, paginated PSOS-11 projection
  (`dashboard.listCompanies` → `dashboard.listCompanyProjects`) to group by the recorded client name.
  The UI must describe this as a display grouping of client names as entered on projects, not as a
  durable Company or Client record; D7 and PSOS-31/32 remain unchanged. Cross-group ordering is client
  name A–Z and each group retains the server's fiscal-year-rank order. The Projects Board stays
  stage-first and gains no client/company axis. Until production backfill completeness is verified,
  the grouped view explicitly warns that older projects may not appear.
- **My Work sorting:** My Work keeps exactly the five canonical accountability lanes and their indexed
  queries. The preview may reorder only the rows already loaded in each lane by Recently updated or
  Client name A–Z, with the explicit qualifier “Sorts loaded items only.” It does not add a grouping
  axis or client-side filter and does not change work-item actions, expected-version checks, or counts.
- **Scoped shell extension:** The flagged fir/dark workspace chrome may wrap `/settings`, `/alerts`,
  `/requests`, and `/changelog` after their content uses theme-aware semantic tokens. Each route mounts
  exactly one experience through the same fail-closed gate, and `?workspace=current` restores its
  existing AppNav/PageBar interface. Admin routes, project creation/questionnaire, public review,
  print, and export surfaces remain outside this rollout.
- **Current-interface freeze and report boundary:** The current dashboard keeps its original tabbed,
  one-lane-at-a-time My Work ledger and active-lane query gating; the preview's five-section Board/List
  projection is a separate component. The report route also branches through the same rollout gate:
  the committed report workspace is the current/rollback subtree, while the previously reviewed
  Agent-left/report-right workbench is the preview subtree. `?workspace=current` restores the current
  report immediately. While the server rollout decision is pending, the report route renders a neutral
  loading surface instead of mounting either query-heavy report subtree, preventing transient duplicate
  subscriptions and a current-to-preview composition flash. This gates composition only; report queries, mutations, permissions, autosave,
  QA, generation, exports, and report primacy remain shared and unchanged.
- **Rejected interpretations:** This amendment does not introduce “Company” as a domain entity,
  company×stage board cells, My Work company lanes, client-side filtering of incomplete pages,
  drag-to-transition, a hardcoded pilot email, or a one-release theme sweep across every route.
- **Migration and tests:** No schema or data migration. The My Work projection adds only an `updatedAt`
  display field; rollout admin reads are bounded and additive. Route/gate behavior, param preservation,
  `?workspace=current` precedence, all-columns rendering, grouped-list truthfulness, five-lane
  preservation, well neutrality, and focusability are covered by unit and browser component tests.
- **Approval:** Product owner explicitly approved the canonical routes, fir-branded rail,
  always-visible canonical columns, client-name inspection, bounded My Work sort, admin-only pilot,
  and the scoped internal-page rollout on 2026-08-06.

### 2026-08-05 — Personal board/list workspace projections

- **Affected tickets:** PSOS-14 and future report-workspace fidelity work.
- **Decision:** My Work remains the default dashboard destination. My Work and Projects each offer personal **Board** and **List** projections, with Board as the default presentation and a one-click accessible toggle. Projects board columns use only canonical workflow stages plus an explicitly qualified legacy-status compatibility column. My Work board columns use the five canonical accountability lanes already exposed by the indexed My Work queries. The projections do not redefine Project, Owner, Current handoff, Work item, Workflow stage, Generation state, Creator, or Outcome.
- **Interaction boundary:** Initial boards are navigational and operational projections only. Cards are not draggable and a visual move never changes workflow stage, assignment, ownership, or work-item lifecycle. Existing confirmed mutations, expected-version checks, transition rules, and authorization remain authoritative. List views remain available and preserve the same truthful fields.
- **Report primacy and design compatibility:** The report remains the primary project workspace. Compact ruled cards may summarize existing server-projected rows without turning the product into a generic CRM; Ledger paper tokens, explicit labels, text-plus-color states, 44 px touch targets, and restrained actions remain required.
- **Migration and tests:** No schema or data migration is required for the first frontend-only release. Per-user layout preference is browser-local and fails closed to the documented default. Tests cover preference parsing, canonical column labels/order, owner/legacy qualifiers, and unchanged work-item action permissions. Per-column server pagination, current-handoff projection on Projects, or drag-to-transition require separate backend review.
- **Approval:** Product owner explicitly approved the Obvious-inspired board default and retained list toggle on 2026-08-05.

### 2026-07-30 — Project Creator is the initial Owner

- **Affected tickets:** PSOS-09, PSOS-10, PSOS-13, and PSOS-14.
- **Decision:** Every newly created project automatically sets `ownerId` to the authenticated Creator, including Consultant, Manager, and Admin creators. Project-creation screens do not ask users to select an Owner. A different initial Owner cannot be supplied by the client; responsibility may be transferred afterward through the audited ownership workflow.
- **Compatibility and migration:** No data migration or schema change is required. Existing ownership and historical `createdBy` values remain unchanged. During the compatibility window, the optional `ownerId` mutation argument may be accepted only when it equals the authenticated Creator; a different value fails closed rather than being silently ignored.
- **Authorization and tests:** Project creation still requires an active internal role and `project.create`. Tests must prove each permitted role becomes both Creator and initial Owner, client-supplied ownership cannot assign another user, and the immutable initial-ownership event identifies the Creator.
- **Approval:** Product owner approved creator-owned project creation and Admin ownership on 2026-07-30.

### 2026-07-29 — Abandonment requires closing open work first

- **Affected tickets:** PSOS-12, PSOS-13, and subsequent workflow-stage surfaces.
- **Decision:** A project cannot enter `abandoned` while any open work item remains. Authorized users must complete, decline, or cancel open work before changing the Stage.
- **Compatibility and migration:** No data migration is required. Existing projects and work-item history remain unchanged; the mutation continues to fail closed when open work exists.
- **Authorization and tests:** Existing Stage authority remains unchanged. Workflow tests must cover rejection with open work and success after all work is closed.
- **Approval:** Product owner confirmed this policy on 2026-07-29 and reconfirmed it during the PSOS-12/13/14 remediation review.

### 2026-08-14 — Attio-informed workspace rail is presentation-only

- **Affected ticket/scope:** PSOS-14 presentation follow-up; no backend ticket.
- **Decision:** the preview workspace may use the authenticated Attio rail's
  measured 275px frame, 28px row rhythm, global-search/creation control row,
  grouped navigation, full-width account footer, and animated full collapse.
  Every visible destination remains an existing Banhall route or action. The
  Admin group may mirror Attio's Records presentation with a left disclosure
  chevron and differentiated icon colours; it remains named Admin and does not
  introduce a Records domain object.
- **Domain and authorization impact:** none. Admin links remain role-gated;
  route-side and server-side authorization remain authoritative. Alerts and
  changelog badges continue to report their existing bounded queries. Project
  creation still enters Intake through the existing wizard. No CRM Records,
  Lists, Chats, trial, or onboarding domain concepts are introduced.
- **Migration and compatibility:** no schema, data, query, mutation, workflow,
  or permission change. Rail width/collapse remain browser-local presentation
  preferences; the mobile drawer retains accessible 44px targets. Existing
  canonical URLs and `?workspace=current` rollback behavior are unchanged.
- **Tests:** rail preference clamping/persistence, resize/collapse restoration,
  route links, Admin disclosure, search palette, and account menu are covered
  by component and signed-in browser verification.
- **Approval:** product owner requested the sidebar closely match the signed-in
  Attio reference on 2026-08-14, with Banhall's honest content and behavior.

### 2026-08-14 — Home chrome and transcript-source selector are presentation-only

- **Affected ticket/scope:** PSOS-14 Home presentation follow-up; no backend
  ticket.
- **Decision:** Home omits the redundant title toolbar and presents Paste versus
  Attach file as mutually exclusive input tabs with Paste selected by default.
  Mobile navigation and desktop rail restoration remain reachable through an
  unframed control cluster.
- **Domain impact:** none. Both modes still populate the same browser-local
  project-intent handoff and open the existing project wizard. No project is
  created from Home; creation still occurs in Intake under the existing
  mutation, ownership, permission, and workflow contracts.
- **Migration and compatibility:** no schema, data, query, mutation, route, or
  permission change. `.docx` validation/parsing and pasted transcript handling
  are unchanged. Switching modes does not persist a new preference.
- **Approval:** product owner requested removal of Home's header and a clear,
  Paste-default exclusive source selector on 2026-08-14.

### 2026-08-14 — Developer tools exposure and Home creation paths

- **Affected ticket/scope:** PSOS-14 workspace follow-up and user-profile
  exposure metadata.
- **Developer exposure:** `users.isDeveloper` is an optional, additive profile
  flag managed by administrators. It controls whether the workspace rail shows
  the developer utilities group (Alerts, Feature requests, What's new, Current
  dashboard, and Flag issue) and whether their badge queries subscribe. It is
  not a role, capability, or authorization grant. Route-side and server-side
  authorization remain authoritative. Existing users without the flag fail
  closed to no developer utilities.
- **Home creation paths:** the composer shortcut requires a non-empty internal
  title and an active transcript source (pasted text or a successfully parsed
  `.docx`) before it can continue. A separate `Start a blank project` action
  opens the existing project wizard with an empty browser-local intent. Neither
  path creates a project from Home; creation still occurs in Intake through the
  existing mutation and creator-becomes-Owner contract.
- **Account menu:** the workspace account popup contains identity and sign-out
  only. Settings remains a persistent rail utility; Admin destinations remain
  in the role-gated Admin group.
- **Migration and compatibility:** optional-field schema widening only; no data
  backfill is required. Administrators may opt existing and future accounts in
  explicitly. No URL, workflow, project, role, or capability semantics change.
- **Approval:** product owner requested developer-only utilities, an explicit
  blank-project path, validated composer submission, and a simplified account
  menu on 2026-08-14.

### 2026-08-14 (fourth) — direct rail utilities and card-based client repository

- **Affected ticket/scope:** PSOS-14 presentation follow-up; no workflow or
  backend behavior change.
- **Rail presentation:** developer utilities are direct links/actions at the
  bottom of the rail, without a `Developer` label or disclosure. Flagged
  developer accounts see Alerts, Feature requests, What's new, Current
  dashboard, and Flag issue. Other authenticated accounts see What's new only.
  The Admin records group sits lower than the primary Home/Projects links but
  keeps its existing role gate and disclosure behavior.
- **Projects presentation:** client grouping keeps the same indexed queries,
  exact-count validation, six-subscription cap, project creation links, and
  stage order. Its always-visible grouping explanation, backfill notice,
  global expand control, column header, and loaded-client footer are removed
  from the visual canvas. The same qualifier remains attached to the region as
  screen-reader context. Collapsed client rows show only client identity,
  client-scoped creation, and a right-edge disclosure; project totals and stage
  summaries are omitted. The identity and chevron both open the section, and
  the body mounts or unmounts immediately so the gated section query releases
  without an exit delay. Each opened client in List mode renders the existing
  project cards in stage-grouped responsive grids; Board mode continues to use
  the existing stage-column board. List remains the default and the compact,
  icon-only List/Board switch remains one click away with accessible names and
  tooltips.
- **Header contract:** workspace pages that carry a title bar share the same
  49px page-header geometry. Home remains the approved exception because its
  greeting is the page heading.
- **Migration, authorization, and tests:** no schema, data, query, mutation,
  route, capability, or workflow change. Component tests cover the developer
  and non-developer rail variants, local client expansion and subscription cap,
  card rendering, removed visual chrome, labelled layout switch, and shared
  page-header contract.
- **Approval:** product owner requested these rail and Projects corrections in
  the annotated signed-in workspace on 2026-08-14.

### 2026-08-14 (fifth) — Stage and Owner filters in client grouping

- **Affected ticket/scope:** PSOS-14 Projects repository follow-up.
- **Decision:** the existing Stage and Owner filter UI remains available when
  the Projects repository is grouped by recorded client name. Client headings
  remain the stable, paginated A-Z projection. Filters apply to projects within
  each expanded section; unmatched client headings are not removed because the
  current client projection cannot prove an Owner-filtered distinct-client set.
  An expanded section with no matching rows states the filtered empty result.
- **Query and schema impact:** `dashboard.listCompanyProjectsByStageRank`
  accepts optional Stage and Owner filters. Stage-only reads constrain the
  existing client/stage-rank index. Owner reads use the additive compound index
  `by_client_owner_stage_rank_updated`; Stage + Owner further constrains that
  same index. Pagination, frozen stage-rank order, owner labels, and the
  six-live-section subscription cap remain unchanged. Filtered sections do not
  reuse unfiltered `dashboardCompanies.projectCount` or `stageCounts` as
  filtered totals.
- **Authorization and migration:** read visibility remains D1 (authenticated
  internal users), with no new capability, mutation, workflow transition, or
  durable Client concept. The schema change adds one index and requires no data
  backfill; the development deployment builds it from existing project fields.
- **Tests:** Convex coverage proves Stage-only and Stage + Owner results;
  component coverage proves the grouped List exposes Filters and passes the
  applied condition to its expanded-client query; signed-in browser QA proves
  the active condition chip and filtered project cards.
- **Approval:** product owner requested restoration of the missing filter UI
  and functionality in the Client-grouped List on 2026-08-14.

### 2026-08-14 (sixth) — fiscal repository hierarchy, project types, and workflow language

- **Affected ticket/scope:** PSOS-14 repository follow-up, PSOS-09 workflow
  contract, PSOS-12 future external-handoff widening, and PSOS-41 historical
  Brain ingestion discovery.
- **Repository hierarchy:** the default Projects repository is Client → Fiscal
  year → Project. The client heading remains a normalized display projection
  of `projects.clientName`, not a durable Client record. Within each loaded
  fiscal-year section the default order is project number, with Created and
  Last updated alternatives. Project-number ordering is natural (`1`, `2`,
  `2A`, `10`, letters, then unnumbered). Since each open client query remains
  bounded and paginated, sorting and the fiscal-year sections describe the
  loaded client page; a continuation control remains visible while more rows
  exist.
- **Card identity:** repository cards show the internal title, distinct SR&ED
  title when present, project number, fiscal year, project type, Stage, Owner,
  and current handoff when available. Client-scoped sections do not repeat the
  client name on every card. Created and updated dates remain secondary.
- **Project types:** `writing`, `review`, `background_research`, and `financial`
  are the canonical values. `projects.projectType` widens storage; legacy
  `mode: review` dual-reads as `review` and all other legacy rows dual-read as
  `writing`. New generate/review projects write the corresponding type.
  Project type is descriptive and does not silently choose a workflow,
  artifact format, role, or permission.
- **Filters:** Stage and Owner remain distinct. Project type and Current
  assignee are additive repository conditions. Current assignee means the
  assignee of the validated open blocking current handoff, never the Owner.
  Conditions are applied to the bounded server page and the surface remains
  qualified while pagination is incomplete; client headings remain the stable
  A–Z projection.
- **Workflow language:** `edits` is a new canonical stage between internal
  review and the next review/submission step. The stored stage
  `ready_for_delivery` remains unchanged during compatibility rollout but its
  product label is **Submitted**. `delivered` remains separate and still
  requires an exact production outcome; relabelling Submitted never records
  delivery.
- **External handoffs:** “With client” is modelled as an `external_client`
  handoff target in the future work-item widen, not as a fake account. The
  current implementation continues to create internal-user work items only;
  external target storage, events, authorization, and UI require a dedicated
  widen/backfill ticket before writes are enabled.
- **Migration and compatibility:** additive optional `projectType` plus
  dual-read fallback; no destructive rewrite. `edits` uses frozen persisted
  rank `3.5`, between Internal review (`3`) and Client review (`4`), so existing
  ranks stay untouched. The existing dashboard backfill may materialize the
  canonical project type, but consumers do not depend on it. No work-item
  schema change ships from the external-handoff decision.
- **Authorization and tests:** project read visibility is unchanged. Project
  type updates use existing internal project access. Workflow mutations apply
  the amended transition matrix and existing OCC/audit rules. Tests cover
  dual-read type mapping, fiscal grouping/sorting, card identity, repository
  conditions, the Edits transition edges, and Submitted presentation.
- **Approval:** product owner explicitly requested these transcript-derived
  changes on 2026-08-14.

### 2026-08-14 (seventh) — client and fiscal disclosure hierarchy

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** Client rows are single, full-width disclosure controls and no
  longer repeat a client-scoped New project action; the repository toolbar and
  grouped-board stage footers remain the creation entry points. Open clients
  present recorded fiscal years as nested folder headers without a decorative
  vertical rule. Projects without a fiscal year appear last in a visually
  distinct dashed folder row labelled
  **Fiscal year not set**.
- **Motion and performance:** Client and fiscal bodies unmount immediately on
  close. Opening uses only a short opacity/translate entrance; intrinsic height
  is not animated, avoiding long or laggy accordion motion for large groups.
  Reduced-motion users receive no entrance animation.
- **Domain, authorization, and migration:** presentation only. No query,
  schema, workflow, permission, project-creation, or durable Client semantics
  change. The existing global creation route and board-prefilled stage actions
  are unchanged.
- **Tests:** component coverage verifies the unified 44px client disclosure,
  absence of per-client creation actions, independent fiscal disclosure, and
  the distinct unrecorded-year fallback.
- **Approval:** product owner requested these hierarchy and transition changes
  in the annotated Projects repository on 2026-08-14.

### 2026-08-15 — contained fiscal folders and stable loading geometry

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** Fiscal-year disclosures place the folder icon and label on the
  left and the disclosure chevron at the right edge. An open fiscal year is one
  restrained bordered surface: its project cards or stage board remain inside
  that same folder boundary, separated from the header by a hairline. The
  unrecorded-year variant retains its dashed boundary and explicit
  **Fiscal year not set** label.
- **Motion and loading:** This supersedes only the seventh amendment's
  fiscal-body immediate-unmount/opacity-only clause. Fiscal bodies use the
  shared short grid-row disclosure transition so surrounding content moves
  continuously instead of snapping; closing content becomes inert and
  unmounts after the transition. A newly opened client paints no visual
  skeleton. Its real resolved hierarchy enters once with a 260ms eased vertical
  reveal, collapsing to zero duration for reduced-motion users. Closing the
  outer client still releases its query immediately and the six-section
  subscription budget is unchanged.
- **Domain, authorization, and migration:** presentation only. No query,
  schema, workflow, permission, project-creation, sorting, pagination, or
  durable Client semantics change.
- **Tests:** component coverage verifies the right-edge fiscal chevron,
  contained folder boundary, shared disclosure motion/inert lifecycle, and
  absence of a visible first-load skeleton.
- **Approval:** product owner requested the fiscal-folder containment and
  stable, skeleton-free opening transition on 2026-08-15.

### 2026-08-15 (second) — disclosure emphasis and contextual fiscal labels

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** An open client disclosure uses a stronger lagoon wash and
  boundary than its collapsed state. An open fiscal folder uses a lighter
  lagoon wash and boundary so the nested active levels remain distinct.
  Project cards nested inside a fiscal folder omit the repeated fiscal-year
  chip because the enclosing folder is the labelled context. Cards on
  ungrouped/global boards retain the fiscal-year chip.
- **Domain, authorization, and migration:** presentation only. Fiscal-year
  storage, filtering, grouping, query behavior, workflow, permissions, and
  durable Client semantics are unchanged.
- **Tests:** component coverage verifies contextual fiscal-chip suppression
  in both list and lane folder presentations while the standalone card and
  board defaults retain it.
- **Approval:** product owner requested the active disclosure color refinement
  and removal of repeated FY labels on 2026-08-15.

### 2026-08-16 — distinct fiscal-folder state and simplified client heading

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** The open client disclosure remains the brand-selected level.
  Open fiscal folders use the neutral chrome fill, neutral text/icon treatment,
  and standard boundary instead of repeating the client's lagoon selection
  color. Client disclosure headings show the recorded client name directly and
  omit the decorative initial badge; the right-edge chevron remains.
- **Domain, authorization, and migration:** presentation only. Client-name and
  fiscal-year projections, grouping, queries, workflows, permissions, and
  durable Client semantics are unchanged.
- **Tests:** component coverage verifies the two-column client trigger without
  the initial badge and the neutral open-folder treatment.
- **Approval:** product owner requested clearer visual separation between
  client and fiscal disclosures on 2026-08-16.

### 2026-08-16 (second) — page-level project creation action

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** The global New project action moves from the repository control
  row into the Projects page header. The repository row is reserved for view,
  grouping, filtering, display, and sorting controls. The header action uses
  the shared Button default variant and its semantic, theme-aware brand role.
  Existing rail and board-footer creation navigation remains unchanged.
- **Domain, authorization, and migration:** presentation only. The action still
  navigates to `/project/new`; intake entry, creator ownership, permissions,
  queries, workflow, and storage are unchanged.
- **Tests:** component coverage verifies the header placement, absence from the
  repository control row, and light/dark default-button brand pairs.
- **Approval:** product owner requested the page-header placement and
  theme-aware default action treatment on 2026-08-16.

### 2026-08-16 (third) — compact project classification and header spacing

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** On column-less project cards, the labelled Stage and project
  Type share one compact metadata row. Fiscal-folder triggers retain the 44px
  mobile touch target but use the 32px compact control height from `sm` upward.
  The page-level New project action remains pinned to the far-right edge of the
  Projects header, including widths where the centered search field is hidden.
- **Domain, authorization, and migration:** presentation only. Stage, project
  type, fiscal year, creation navigation, queries, workflow, permissions, and
  storage are unchanged.
- **Tests:** component coverage verifies shared Stage/Type row parentage,
  responsive fiscal-trigger density, and persistent right-edge header spacing.
- **Approval:** product owner requested these card-density and header-alignment
  refinements on 2026-08-16.

### 2026-08-16 (fourth) — stable project-card minimum height

- **Affected ticket/scope:** PSOS-14 Projects repository presentation follow-up.
- **Decision:** The shared project card has a 160px minimum height across
  grouped list and stage-board presentations. Its neutral inset panel expands
  through unused vertical space so cards with fewer optional metadata rows
  retain the same material anatomy and align with neighboring cards. Cards
  with additional truthful metadata may still grow beyond the minimum.
- **Domain, authorization, and migration:** presentation only. Card fields,
  project data, queries, workflow, permissions, and storage are unchanged.
- **Tests:** component coverage verifies the minimum rendered geometry for
  both full and client-scoped card variants.
- **Approval:** product owner requested consistently aligned default project
  card heights on 2026-08-16.

### 2026-08-16 (fifth) — stage-colored card identity and LAN-safe request IDs

- **Affected ticket/scope:** PSOS-14 project-card presentation and PSOS-04
  client request/upload compatibility.
- **Decision:** Project-card titles and project-number chips use the same
  labelled workflow-stage tone as the card's status treatment. Text remains a
  label in addition to color. Client-generated upload attempt and work-item
  request IDs use the shared UUID-v4-compatible generator: native
  `crypto.randomUUID()` when available, `crypto.getRandomValues()` on LAN HTTP
  origins, and a UUID-shaped last-resort fallback for constrained runtimes.
- **Domain, authorization, and migration:** no schema or data migration. Stage
  values, transitions, project numbers, request idempotency, UUID validation,
  permissions, and storage semantics are unchanged.
- **Tests:** coverage verifies stage-colored title/number classes, native and
  fallback UUID paths, UUID version/variant format, and absence of direct
  client-side `crypto.randomUUID()` calls.
- **Approval:** product owner requested stage-colored card identity and
  reported the LAN project-view compatibility failure on 2026-08-16.

### 2026-08-16 (sixth) — responsive card identity and project-number badge

- **Affected ticket/scope:** PSOS-14 project-card presentation follow-up.
- **Decision:** The project number is a distinct, labelled stage-tinted badge
  with its own opaque surface, border, padding, and monospace treatment so it
  cannot read as part of the project title. Project and SR&ED titles use
  single-line ellipsis truncation based on their available card width. Client
  names, Owners, current handoffs, generation activity, and legacy qualifiers
  use bounded two-line wrapping at narrow card widths. Short,
  predictable created/updated dates remain single-line. Classification chips
  continue wrapping as a group.
- **Domain, authorization, and migration:** presentation only. Project-number,
  title, workflow, handoff, query, authorization, and storage semantics are
  unchanged.
- **Tests:** browser-component coverage verifies badge semantics, project and
  SR&ED title truncation, narrow-width containment, two-line metadata wrapping,
  and absence of horizontal overflow.
- **Approval:** product owner requested clearer project numbering and complete
  responsive card behavior on 2026-08-16.

### 2026-08-18 — historical projects ported from OneDrive ingestion

- **Affected ticket/scope:** BNH-17 ingestion follow-up (client meeting
  2026-08-18): approved historical PDs in the ingestion review queue may be
  ported into the Projects repository so a client+fiscal-year card exists
  holding last year's PD (e.g. for QA review when a rollover project starts).
- **Storage:** `ingestionItems.portedProjectId` / `portedDocumentId` /
  `portedAt` / `portedBy` (all optional; widen-only, no backfill, no index).
  No new `projects` field; the association is navigational only, like
  `projects.sourceProjectId`. `createdBy` and ownership semantics are
  untouched.
- **Creation:** `ingestionPort.portItemToProject` (admin-only action) is the
  one sanctioned writer. Matching is exact-normalized `dashboardCompanyKey`
  plus fiscal year via the existing dashboard index; ambiguous multi-matches
  fail closed (D7 — never auto-merge). A created project follows the wizard's
  insert conventions: the porting admin is Creator and initial Owner, initial
  stage `intake`, `projectType: "writing"`, creation events (the stage event
  notes `creation:ingestion-port`) and dashboard company counting in the same
  transaction. Porting never sets `ready_for_delivery`, `delivered`, or any
  outcome — historical submission is not evidence of delivery under this
  system's outcome rules.
- **Document:** the PD's extracted text becomes a `projectDocuments` row
  (`source: "ingestion_port"`, `category: "previous_pd"`) with the original
  bytes copied into a project-owned storage blob. Brain approval remains a
  separate gate; porting neither requires nor performs Brain ingestion beyond
  the already-approved source.
- **Idempotency:** re-porting a ported item is a no-op returning the existing
  project; a second PD in the same client+fiscal-year group attaches to the
  same historical project as an additional `previous_pd` document.
- **Deferred:** `projectNumber`-aware matching, an ambiguity picker,
  transcript/supporting-document porting, and the submitted/WIP visibility
  flag that will hide historical cards from the default explorer.
- **Approval:** product owner asked in the 2026-08-18 meeting for ingested
  historical PDs to become project cards per client and fiscal year.

### 2026-08-19 — automatic project-number lettering and workspace exposure flags

- **Affected ticket/scope:** follow-ups from the 2026-08-18 client meeting
  (duplicate project numbers) and 2026-08-19 owner direction (navigation
  exposure).
- **Numbering:** amends the 2026-08-11 numbering decision. Applying a bare
  number that already exists within the same client + fiscal year
  (dashboardCompanyKey + dashboardFiscalYearRank scope) stores the next free
  letter automatically: the existing bare "1" reads as the "1A" slot, so the
  new project stores "1B", then "1C", alphabetically. Explicit lettered input
  is stored as typed. A different fiscal year is a different scope, so a
  rollover "1" stays "1". Enforced in `projects.setProjectNumber` and
  `projects.createProject`; all 26 letters taken fails closed.
- **Exposure flags:** `users.isOwner` joins `users.isDeveloper` as a
  presentation-only flag (never a role or capability; distinct from a
  project's Owner). The admin navigation renders only for admins who are
  developers or workspace Owners; the Developer and Owner columns on
  `/admin/users` render for — and their mutations accept — developers and
  workspace Owners only. Flag issue in the rail is visible to all users.
- **Approval:** product owner raised duplicate-number distinctness in the
  2026-08-18 meeting; exposure changes are 2026-08-19 owner direction.

### 2026-08-24 — Per-writer house-style overrides (two-tier writing standard)

Storage **and** generation-behavior amendment — not presentation-only. The
PD writing standard is now explicitly two-tier, and the house-style tier is
per-writer overridable.

- **Affected ticket/scope:** PSOS-49. Origin: writer feedback from
  lrinaldo@banhall.com (2026-08-23, project
  `k972k8w75nbq658480fe577h6n8d0ve2`) that their "PD Writing Customized
  Settings" document was silently overridden by the built-in style rules.
  Industry pattern (Writer.com, Grammarly Business, legal playbook tools)
  is tiered rules with per-rule overrides; conflicts are resolved before
  prompt assembly, never delegated to the model.
- **Tier table:**

  | Tier | Rules | Overridable |
  |---|---|---|
  | Locked CRA compliance | Three-line skeleton (242/244/246) and paragraph roles; passive-vs-active uncertainty distinction; because-clause in 242 P5; if/then hypothesis with measurable then-clause; knowledge-first framing in 246; CRA line/word limits (`convex/lib/lineLimits.ts`); no-fabrication/[GAP] rules (superseded: the skeleton became waivable on 2026-09-01 and content-role based, with openers off by default, on 2026-09-15 — see those amendments) | Never |
  | House style | Five categories: `bannedWords`, `paragraphDensity`, `sentenceConstruction`, `repetitionCaps`, `openingClauses` (canonical list in `shared/styleOverrides.ts`) | Per writer, per category |

- **Storage:** `writerProfiles.styleOverrides` (optional object of five
  booleans; widen-only, no backfill, no index). Legacy rows normalize to
  all-false — exactly the prior behavior. No other field is repurposed.
- **Behavior:** when a category is waived on an **enabled** profile, that
  category's rule text is omitted from drafting/QA/chat prompt assembly;
  programmatic enforcement is skipped for that writer (`scrubBannedWords`
  across pipeline/iterative/compression/chat edit tools/research proposals
  for `bannedWords`; the qaChecks banned scan, repetition count, and CRA
  opener detection report `WAIVED`); and the QA agent is instructed not to
  deduct for the waived category while still verifying the underlying CRA
  content (limitations stated, if/then hypothesis, knowledge-first
  advancements — only literal phrasing/density/vocabulary is freed). The
  writer's free-text instructions become authoritative for waived
  categories and stay lowest-priority elsewhere. Overrides are frozen at
  generation start for iterative section runs (stored in the generation
  artifacts JSON); in-flight generations keep the overrides they started
  with, and the ghost comparison draft receives the same overrides.
- **Authorization:** none changed — the existing profile-edit permission
  model applies (writer edits their own profile via settings; admin via
  `/admin/users`).
- **Tests:** `shared/styleOverrides.test.ts`, `convex/ai/prompts.test.ts`,
  `convex/ai/qaChecks.test.ts`, `convex/writerProfiles.test.ts`, plus
  pipeline `buildStyleGuidance` coverage.
- **Recorded residual tensions:** (1) the locked CRA-verbiage presence
  check still expects terms like "technological uncertainty"; a custom
  document banning those exact terms conflicts by design. (2) The global
  `draft_style` learning digest is not per-writer; the prompt states writer
  waivers outrank it for waived categories, but digest content itself is
  global. (3) Save-time conflict linting of the free-text instructions is a
  recommended follow-up, not implemented.
- **Approval:** product owner approved the tiered-override contract in the
  PSOS-49 implementation request (2026-08-24).

### 2026-08-24 — House-rule governance modes and instruction analysis (PSOS-50)

Storage **and** generation-behavior amendment — not presentation-only.
Builds directly on the PSOS-49 two-tier standard: each of the five waivable
house-style categories now carries an org-wide governance mode, the
house-rule texts are visible in-app to admins, and writers get an
analyze-my-instructions flow at save time.

- **Affected ticket/scope:** PSOS-50. Origin: product owner direction
  2026-08-24 following the lrinaldo feedback — admins/owner must be able to
  see and adjust the rules in-app, and writer preferences should apply
  without checkbox hunting. Pattern follows Grammarly Business
  locked-preferences and Writer.com org style guides.
- **Governance modes (per category):**

  | Mode | Meaning |
  |---|---|
  | `writer_choice` (default) | Enforced unless the writer waives it — exactly the PSOS-49 behavior. |
  | `enforced` | Always enforced; writer waivers are ignored. |
  | `off` | Waived for everyone — including users with no writer profile and legacy generations with no recorded requester. |

- **Storage:** one new `appSettings` key, `houseStyle.modes` (string JSON);
  no schema table changes, no backfill. Normalization lives in
  `shared/styleOverrides.ts` (`normalizeHouseRuleModes` +
  `resolveEffectiveOverrides`): missing or malformed config always degrades
  to `writer_choice` — i.e. config-absent is exactly the prior (PSOS-49)
  behavior, and a corrupt value can never lock writers out or silently
  disable rules beyond their own toggles.
- **Behavior:** resolution happens inside
  `writerProfiles.getProfileForGeneration` (now accepts an optional
  `userId` and returns **effective** overrides); all generation/chat/QA
  consumers inherit it, `convex/research.ts` resolves the same way, and
  iterative generations freeze the effective value at start exactly as
  PSOS-49 froze writer overrides. Precedence order is now: **locked CRA
  tier > org mode > writer toggle > house default.** The house-rule prompt
  texts moved verbatim to `shared/houseRules.ts` (`HOUSE_RULE_TEXTS` +
  `LOCKED_RULES` catalog); the new admin page `/admin/house-rules` renders
  the locked CRA tier, each house rule's full text, per-category mode
  controls, and the banned-word tables (read-only — term-level editing is a
  recorded follow-up). A new action
  (`convex/ai/styleAnalysis.ts` `analyzeMyInstructions`) classifies a
  writer's pasted instructions against the five categories, suggests and
  pre-ticks waivers for categories the document legislates, and quotes
  parts conflicting with the locked CRA tier; the settings page renders a
  ✓/–/🔒 report, with toggles under mode `enforced` locked-unchecked
  ("Managed by your organization") and mode `off` locked-checked ("Disabled
  for everyone").
- **Authorization:** `houseStyle.setModes` and `houseStyle.getConfig` are
  admin-only (`requireRole`); `houseStyle.getModesForMe` is available to
  any authenticated user; `analyzeMyInstructions` is authenticated. No
  existing permission is loosened.
- **Tests:** `shared/styleOverrides.test.ts` (mode normalization +
  resolution matrix), `convex/houseStyle.test.ts`,
  `convex/writerProfiles.test.ts` additions (`enforced` beats a writer
  waiver; `off` applies with no profile), and `convex/ai/styleAnalysis`
  prompt/schema unit tests.
- **Recorded residual notes:** (1) banned-word term editing in-app is
  deferred (follow-up candidate PSOS-51); the admin tables are read-only.
  (2) The instruction analysis is advisory LLM output — it suggests and
  pre-ticks, but never un-ticks a manual choice, and the writer confirms
  the toggles before anything is saved.
- **Approval:** product owner directed and approved the governance-mode
  contract on 2026-08-24 as the follow-on to PSOS-49.

### 2026-09-01 — Writer-defined report skeleton (`reportSkeleton` waiver)

Generation-behavior amendment that re-tiers the PSOS-49 writing standard.
The built-in section skeleton is no longer locked: it becomes a sixth
waivable category, and when waived the writer's own preferences document is
the authority for report architecture.

- **Affected ticket/scope:** follow-on to PSOS-49/PSOS-50. Origin: flag from
  lrinaldo@banhall.com (2026-08-31, project
  `k9707a4y5wexp3bx4dq3w4shvd8dkybr`): with all five house-style categories
  waived, their "PD Writing Customized Settings" document still could not
  change paragraph count or roles (line 246 kept three mandated advancement
  paragraphs instead of the document's consolidated architecture; the
  default skeleton itself stopped prescribing counts on 2026-09-15, see
  that amendment). Owner
  direction 2026-09-01: the only rule that must stay is the per-line word
  count, because that is what fits on the finalized form.
- **Tier table (supersedes the PSOS-49 table; itself superseded by the
  2026-09-15 (second) amendment, which keeps the Locked row and re-describes
  the default skeleton):**

  | Tier | Rules | Overridable |
  |---|---|---|
  | Locked | CRA line/word limits (`convex/lib/lineLimits.ts`, compression pass); no-fabrication/[GAP] and evidence-tracing rules; human-prose dash scan; voice consistency | Never |
  | Waivable | Six categories: `bannedWords`, `paragraphDensity`, `sentenceConstruction`, `repetitionCaps`, `openingClauses`, **`reportSkeleton`** (canonical list in `shared/styleOverrides.ts`) | Per writer, per category; org mode via PSOS-50 |

  `reportSkeleton` covers everything previously listed as "locked CRA
  compliance" except the length limits and integrity rules: the three-line
  paragraph counts and roles, ordering, the passive/active split, because-
  clauses, if/then hypothesis content, knowledge-first framing, and the
  default narrative arcs. The three CRA lines themselves (242/244/246) are
  form fields and remain.
- **Storage:** `writerProfiles.styleOverrides.reportSkeleton` (optional
  boolean, widen-only, no backfill); `houseStyle.modes.reportSkeleton`
  defaults to `writer_choice`. Legacy rows and frozen generation artifacts
  normalize to `false` — exactly the prior behavior.
- **Behavior when waived (on an enabled profile, subject to org mode):**
  the section builders in `convex/ai/prompts.ts` emit a writer-defined
  architecture prompt (`writerArchitectureBlock`) instead of the fixed
  paragraph roles; the writer's preferences block in `buildStyleGuidance`
  is marked authoritative for architecture; the QA prompt waives Structure
  Compliance and keyword visibility, downgrades the methodology checks to
  advisory warnings, and keeps faithfulness/prose/gap checks; the
  deterministic BECAUSE and opener scans report `WAIVED`; the chat
  skeleton block defers to the writer's architecture on "redo it all"
  requests. Other toggles keep governing their own blocks independently.
- **Authorization:** none changed.
- **Tests:** `convex/ai/prompts.test.ts` (`reportSkeleton waiver` block),
  `convex/ai/qaChecks.test.ts`, existing key-driven suites extended.
- **Recorded residual tensions:** (1) QA scores under the waiver reflect
  faithfulness and prose more than CRA methodology; calibration text still
  describes senior-writer edit time. (2) The global `draft_style` digest
  yields to the writer document when the skeleton is waived. (3) The
  `RULES_VOICE_CONSISTENCY` block still names default paragraph positions
  as examples; it is conditional on first-person use and harmless under a
  custom architecture.
- **Approval:** product owner approved on 2026-09-01 ("Lets allow this";
  "The only rule we need is the word count for each line").

### 2026-09-14 — Zero-edit Coordinated Revision (AD-28 amendment)

Storage-behavior amendment to AD-28 (the Completion Report, architecture
spine).

- **Owner decision (approved 2026-09-14, option A):** a Coordinated Revision
  proposal may carry zero edits when it has at least one finding and every
  finding is `blocked` or `conflicting`. It has nothing to apply. A
  `resolved` finding still has to claim an edit, and a proposal with no
  findings and no edits stays invalid. The finding coverage rules are
  unchanged. Agents propose, humans apply, unchanged: no code path changes
  report prose for such a proposal.
- **Implementation decisions (recorded, not separately approved):**
  - `saveProposal` still makes the only `chatProposals` insert and writes
    the `chatProposalItems` rows in the same transaction. A zero-edit
    proposal is stored as `kind: replacements`, `replacements: []` (exactly
    empty; a non-empty list that yields no passage is refused),
    `requireUniqueTargets: true`, in the terminal `applied` state. This
    reuses the state a highlight (`references`) proposal already takes at
    creation under AD-4 ("locate/highlight only, no state machine"): there
    is nothing for a human to apply or reject. No new status, transition or
    permission is introduced.
  - `applyProposal`, `markProposalApplied`, `rejectProposal`,
    `updateProposalWording` and `sendMessage`'s `refineProposalId` refuse a
    zero-edit proposal ("nothing to apply / reject / reword"); it is
    excluded from the assistant's PRIOR EDIT DECISIONS memory.
  - A new query `chatV2.listProposalItems(proposalId)` returns a proposal's
    Completion Report rows, bounded by the tool's findings cap, for the card.
  - The card lists the blocked and conflicting findings with their evidence
    and offers no action at all, Refine included ("Nothing to apply. These
    findings need a writer's decision."). The assistant's reply opens with
    "Nothing to apply" rather than "Proposed".
- **Affected tickets:** DW-135 (deferred-work ledger), from Greptile finding
  "All-blocked reports cannot persist" on PR #12.
- **Migration and compatibility:** none. No schema change. Existing rows are
  unaffected: the zero-edit predicate requires `requireUniqueTargets: true`
  and zero replacement pairs, a shape no earlier producer could store
  (`saveProposal` refused empty passage sets).
- **Authorization and test impact:** `listProposalItems` is gated by
  `requireInternalProjectAccess`, the same gate as `listProposals` (absent
  identity NOT_AUTHENTICATED, roleless NOT_AUTHORIZED, any active internal
  role reads). Enforcing tests: `convex/lib/completionReport.test.ts` (zero
  edits accepted only when every finding is blocked or conflicting),
  `convex/chatProposalItems.test.ts` (rows persisted, every apply / reject /
  reword / refine path refused, report untouched, decisions memory, query
  gate), `convex/chatToolBodies.test.ts`, `convex/ai/prompts.test.ts`,
  `src/lib/chat/turnParts.test.ts`,
  `src/lib/components/chat/NothingToApply.component.test.ts`.

### 2026-09-11 — Four-tier style precedence, no silent tier, settings documents, and the effort ceiling

Generation-behavior **and** storage amendment. It restates the PSOS-50
precedence sentence ("locked CRA tier > org mode > writer toggle > house
default", 2026-08-24 above) as four named tiers. It adds the rule that no tier
applies silently, and it makes a customized-settings document supplied per
project behave exactly like a saved Writer Profile.

- **Affected ticket/scope:** SPEC-pd-generation story 3 (Precedence and Writer
  Profile fidelity), CAP-6 and CAP-8, building on PSOS-49/50 and the
  2026-09-01 `reportSkeleton` amendment. Origin: writers keep a "PD Writing
  Customized Settings" document and supply it as Writer's Notes or an
  attachment. Until now only a saved profile reached drafting, so House Rules
  silently won over the document.
- **Tier table:**

  | Tier | Rules | Beats |
  |---|---|---|
  | 1. Locked Rules | the three CRA line identities (242/244/246) and their line/word caps (the skeleton's paragraph architecture is not Locked: waivable since the 2026-09-01 amendment, content-role based with openers off by default since 2026-09-15 (second)); caps s242 50 lines/350 words, s244 100/700, s246 50/350 (`convex/lib/lineLimits.ts`); no fabrication | everything |
  | 2. Enforced Org Mode | a House Rule category an admin set to `enforced` | Writer Profile, House Rules |
  | 3. Writer Profile | the saved profile, or a settings document applied as the profile for that generation | House Rules in a category it waives under `writer_choice` |
  | 4. House Rules | the six waivable categories at their defaults | — |
  | Org Mode `off` | a House Rule category an admin set to `off` | waived for everyone: no tier applies it, with or without a Writer Profile |

  `off` is not a fifth tier: it removes the category's House Rule for every
  writer, so tiers 2 to 4 have nothing to decide. Because the organization
  decided it, an `off` category's Compliance Note rows carry
  `tier: org_enforced`. The tier is computed in one place,
  `getEffectiveWriterStyle` (`categoryOutcomes[].tier`). The Self-check
  (`convex/lib/selfCheckRules.ts`) copies it and never recomputes it.
- **No silent tier:** every section's Compliance Note keeps a Writer Profile
  row, which reads "no Writer Profile applied (disabled|missing)" when none
  applies. When an `enforced` mode overrides a waiver the profile asked for,
  that waiver gets its own row: `Writer Profile waiver: <category>`,
  `not_applied`, `org_enforced`. Every cap rule, stored or extracted, is
  measured, clipped to the Locked caps and reported (`tier: conflict`). Each
  generation records the settings it ran under on `generations.writerSettings`
  (profile state, source, save offer). `writerProfiles.getGenerationWriterSettings`
  reads it for the Brief's "No Writer Profile applied — House Rules in full."
  line.
- **Settings documents and the trust floor:** a document qualifies only when
  it is a frozen `project_document` source row, carries an `uploaderRole`, and
  its file name (extension stripped, `_`/`-` read as spaces) or first
  non-empty line (up to 200 characters) is a settings title. A candidate is
  read with a typographic apostrophe as a straight one, lowercased, and with
  leading heading marks, bullets and list numbering stripped. The rule is
  title-only, and both parts must hold: the candidate names writing settings
  ("customized (PD) (writing) settings", "PD writing (customized) settings",
  "writing settings", "writing preferences", "writer's settings", "writer's
  profile", "writer's preferences", "writing style settings", "writing style
  guide"), and with that phrase removed at most one other word remains
  beyond filler (PD, SR&ED or SRED, my, our, the, a, for, of, and, document,
  doc, file, final, draft, copy, version, updated, latest, rev, a version
  number such as "v3", digits and dates including month names, and a
  possessive such as "Larry's"). So "PD Writing Customized
  Settings", "Larry's PD Writing Customized Settings", "Customised settings",
  "Writer's settings" and "Writing preferences - Tracy (final)" match. A bare
  "PD settings" (a proportional-derivative controller's gains, common in
  SR&ED control projects), "PD controller settings", "Style settings v3" and
  a note that merely mentions writing preferences ("Remember the client's
  writing preferences are formal") never do. `uploaderRole` holds only
  internal roles, so an absent role is client trust and never qualifies. A
  client-uploaded document never becomes instructions. At most one document
  applies: Writer's Notes before other attachments, then frozen row order.
  Its frozen text, trimmed and sliced to `MAX_INSTRUCTIONS_CHARS`, is applied
  as the Writer Profile for that generation, and truncation is recorded.
- **Supersede versus match:** when the document's whitespace-normalized text
  equals an enabled saved profile's instructions (`matchesProfile`), the saved
  profile applies unchanged and nothing is offered. A document that differs
  replaces the saved profile for that generation; the two are never merged.
  The Writer Profile row then says the saved profile was superseded. The
  document is never saved to a profile automatically. The offer only prefills
  `/settings/writing?fromGeneration=<id>`, and the writer decides whether to
  save. The offer carries the document text, whether it was truncated, and
  the categories the classifier found it legislates. Those categories are
  recorded on `generations.writerSettings.addressedCategories` when the
  generation resolves and are the offer's only source; the analysis cache is
  never re-read for the offer, so a failed cache write or a later classifier
  version cannot drop the waivers the generation applied. The page pre-ticks
  those waivers where the org mode is `writer_choice` (the Analyze flow's
  rule, never turning a waiver off), so saving the prefill keeps the
  document's waivers. Unsaved edits on the page are kept, never overwritten.
- **Classifier caching and the `generation:settings` slot:** a document's
  House Rule waivers come from the PSOS-50 style classifier
  (`convex/ai/styleAnalysis.ts`), reused verbatim and declared in the prompt
  program as `calls.settingsAnalysis`. It runs at most once per
  `(projectId, contentHash)` for a given classifier version, and the result is
  cached in `settingsDocumentAnalyses` keyed by `classifierVersion`. That
  version is a stable hash of every input that decides the classifier's
  answer: its system text, its user template (which carries the House Rule
  and Locked catalogs), its tool schema, tool name, tool description, output
  token limit and input character limit, and its model id. A row from another
  version is never served, so a classifier change re-analyses instead of
  serving stale waivers. The call carries the AD-27 slot
  `generation:settings`, whose allowance of 1 is recorded, never enforced. It
  makes one attempt (no repair pass), which keeps the worst case inside
  `generateReport`'s 600 s action. A cache hit makes no call. If the
  classifier fails, nothing is cached (the next generation retries), the text
  still applies with no Writer Profile waivers (a category an admin set to
  `off` stays waived for everyone), and the category rows and the progress
  log say the document could not be analysed for waivers.
- **Extraction and Locked clipping:** a deterministic extractor
  (`convex/lib/settingsExtraction.ts`) reads the Build Order and line/word cap
  rules from the effective instruction text, whether a profile or a document,
  in the same way. It fills only what the source does not hold structurally,
  and an explicitly stored empty list stays empty. It is conservative,
  because a false cap shortens a section through repair while a missed one
  costs nothing. A number is a maximum only when an upper-bound cue sits
  directly before it ("at most", "no more than", "max", "up to", "under",
  "within", with only "a total of" or "of" between), a trailing cue sits
  directly after its unit ("maximum", "or less"), or it continues a list of
  maxima ("max 40 lines and 300 words"). A lower bound, before the number
  ("at least 200 words") or after its unit ("300 words minimum", "300 words
  at least", "300 words or more"), and a negated cue ("not under 200 words")
  are ignored, never continue a list of maxima, and never shorten a section.
  A cap binds a whole section, so a statement about any part of one gives no
  cap at all, wherever in the statement that part is named: a per-item limit
  ("100 words each", "each paragraph, no more than 100 words", "100 words
  per paragraph"), a sub-unit ("keep sentences under 25 words", "bullets of
  no more than 20 words") or a part of the section ("at most 100 words in
  the first paragraph", "opening under 50 words"). Missing a real cap is the
  accepted cost. A unit followed by "of" ("40
  lines of code") is prose, not a cap. A comma thousands separator ("1,500
  words") reads as one number; an ambiguous number, a decimal ("2.5 lines")
  or a period- or space-grouped run ("1.500 words", "1 500 words"), is never
  a cap. A Build Order is the bounded run of at most three
  section numbers directly after a build-order cue, so a cap stated on the
  same line is never read into it. A partial run, even a single section
  ("Build order: 246 first."), is never dropped silently: the default order
  applies and the progress log gives the fallback reason. A stored Build
  Order or stored Self-check rules win over extraction field by field, so a
  profile storing only one still gets the other from its text. This applies to legacy saved profiles
  too. A cap above a Locked cap is clipped and reported. Open Question 1
  (whether the Section 246 complaint is a disagreement with the cap) is
  recorded: the Section 246 caps stay Locked. A request for more is applied
  up to the cap and reported, never honoured beyond it.
- **Effort ceiling:** the Dump is the maximum required input. No capability
  requires a writer to author an artifact. A saved profile, a settings
  document and a Storyline are all optional, and generation completes with
  none of them.
- **Behavior on failure:** if the resolver fails, generation continues on the
  saved-profile read and the reason is logged to the generation progress log.
  Iterative mode's gate, `applyProposal`, report prose paths and chat's
  profile resolution are unchanged.
- **Migration and compatibility:** widen only. New optional fields are
  `generations.writerSettings` (with its optional `addressedCategories`, at
  most one entry per category), `categoryOutcomes[].requested`, and
  `profileReason`/`waiverAnalysisFailed` on the ordered profile context. There
  is one new table, `settingsDocumentAnalyses`
  (`by_projectId_and_contentHash_and_classifierVersion`), which carries
  `projectId` (AD-19). Nothing is backfilled: a legacy generation has no
  record, and the query returns null for it. Already-scheduled chain payloads
  still validate.
- **Authorization:** no capability cell changes. `getGenerationWriterSettings`
  uses the Compliance Note read gate (internal project access; outsiders get
  null). Each new record has exactly one database writer, and both are
  internal mutations that no client can call:
  `generations.recordWriterSettings` writes `generations.writerSettings`, and
  `writerProfiles.recordSettingsAnalysis` writes `settingsDocumentAnalyses`.
- **Tests:** `convex/writerProfiles.test.ts` (six categories × `writer_choice`
  / `enforced`, waiver rows, cap clipping from profile text, mixed stored
  fields (a stored Build Order or stored Self-check rules win and extraction
  fills the other), match and supersede, trust floor, a stale
  `classifierVersion` never served, query auth, no-profile line, and the
  offer's truncation and categories),
  `convex/ai/writerSettings.test.ts` (identical Compliance Notes across the
  three supply paths, one `generation:settings` call then none on rerun,
  classifier failure still completes after one attempt, a document equal to
  the profile makes no call, truncation recorded, a failed cache write still
  applies the waivers, a client-uploaded document beside an enabled saved
  profile leaves the profile ruling, the classifier version moves with each
  of its inputs, the writer-facing progress-log lines for applied style,
  waivers, supersede and classifier failure, resolver degrade),
  `convex/lib/settingsDocument.test.ts`, `convex/lib/settingsExtraction.test.ts`,
  `convex/ai/instrument.test.ts` (slot and allowance),
  `convex/ai/promptScaffolds.test.ts` and `tests/aiUsage.test.ts` (manifest),
  `src/lib/settingsPrefill.test.ts`, and
  `src/routes/settings/writing/settingsPrefill.component.test.ts` (the page
  prefill from `?fromGeneration`, run by `npm run test:component`).
- **Approval:** approved by reference to the SPEC-pd-generation Constraints
  (the four tiers restate what PSOS-49/50 put in production; Locked Rules are
  unchanged; the Dump is the maximum required input; every prose change stays
  a human-applied Proposal). No Locked Rule changes, so no `Ask First`
  amendment is required.

### 2026-09-01 (second) — `superseded` generation state and capability enforcement at the mutation boundary

Technical-state amendment plus enforcement of cells the matrix already
approved. Origin: AI engine sprint 1 (`_bmad-output/specs/spec-ai-engine-sprint-1`,
stories 2 through 8 and 13) and the 2026-09-01 audit.

- **Generation state:** `generations.status` gains `superseded`. Set only by
  `retryFailedCandidates` on an `awaiting_selection` comparison generation when
  a linked recovery generation is reserved (link: the recovery row's
  `retryOfGenerationId`). Terminal. Excluded from generation history and from
  latest/active/completed/failed/in-progress readers and stats. Never carries a
  report, so post-assembly QA cannot be requested on it. Replaces the previous
  behavior of marking the original `completed` without a report.
- **Publish for client review:** `publishForReview` and `unpublishReview`
  authorize on the current Owner (`projects.ownerId`), Manager, or Admin via
  the `project.setStage` capability. `createdBy` is not consulted. A legacy row
  without `ownerId` can be published only by a Manager or Admin until ownership
  is backfilled. `deleteProject` is unchanged (still creator-or-admin) pending a
  separate decision.
- **Report prose (`report.editProse`):** enforced at every prose-writing
  mutation (`updateReportContent`, `applyProposal`, `markProposalApplied`,
  `acceptEdit`, `restoreSnapshot`, `approveSectionDraft`,
  `selectReportCandidate`). "Own" for a Consultant means the project's
  `ownerId` or an OPEN work item on the project assigned to them (the matrix's
  "assigned collaboration contexts"). Managers and Admins: all.
- **Financial data (`financial.read` / `financial.write`):** enforced on the
  financial queries (empty result for Consultants) and mutations (typed
  `NOT_AUTHORIZED`), per decision D5. The financial page shows an explicit
  permission state for Consultants.
- **Bulk project edits:** `bulkUpdateProjects` requires an active internal
  role and updates only projects the actor owns unless the actor is a Manager
  or Admin; other selected projects are counted as skipped.
- **Reversibility:** `acceptEdit` writes a `pre_client_edit` snapshot and
  `markProposalApplied` writes the content, a `pre_chat_edit` snapshot, and the
  revision bump in one transaction with an `expectedRevisionNumber` fence.
- **Authorization:** no new capability cells; existing cells are now enforced
  where they were previously UI-only.
- **Tests:** `convex/projects.test.ts`, `convex/projectAccess.test.ts`,
  `convex/reportEditAccess.test.ts`, `convex/chatProposals.test.ts`,
  `convex/comments.test.ts`, `convex/reviews.test.ts`,
  `convex/brainFeedback.test.ts`, `convex/generationRecovery.test.ts`,
  `convex/generationReaper.test.ts`, `convex/ai/providers.test.ts`.
- **Approval:** proposed 2026-09-01 from the approved sprint spec; awaiting
  product-owner confirmation of the `superseded` state name and of the
  legacy-row publish consequence.

### 2026-09-03 — Multiple transcripts per project

Data-model amendment. Origin: the 2026-08-26 client meeting (Tracy attaches
several interview transcripts to one project, and a two-hour transcript
exceeds the model's context window). Landed additively by the
`transcripts-1` ticket; the writers, generation, provenance and UI that use
it follow in `transcripts-2` through `transcripts-7`.

- **Cardinality:** a project has zero or more transcripts, not exactly one.
  They are ordered (`transcripts.position`, 0-based) and labelled
  (`transcripts.label`: the uploaded file name, or `Pasted transcript N`).
  Transcript text stays immutable once written; changing the text means a new
  row, never an edit. At most `MAX_TRANSCRIPTS_PER_PROJECT` = 20 rows and at
  most `MAX_TOTAL_TRANSCRIPT_CHARS` = 2 000 000 combined characters per
  project (`convex/lib/transcripts.ts`). The second cap exists because
  `reserveGeneration` freezes every transcript into `generationSources` rows
  inside one mutation and Convex bounds the bytes one transaction writes.
  Writers enforce both caps in `transcripts-3`; the read helper returns the
  first 20 rows in order.
- **One definition of "a project's transcripts":** `listProjectTranscripts`
  in `convex/lib/transcripts.ts` — ordered by `position`, then `createdAt`,
  then `_id`, with empty-content rows (ingestion placeholders) dropped. Two
  direct `transcripts` table queries are permanent exceptions, because neither
  wants that definition: `deleteProject`'s cascade
  (`convex/projects.ts:1055-1059`), which must also delete the empty rows, and
  the admin orphan scan (`convex/debugTools.ts:201`), which reads rows whose
  project is gone. Four legacy readers still take the project's first row
  directly and are migrated by `transcripts-4`:
  `convex/pdReviews.ts:256-259`, `convex/reviewFromProject.ts:87-90`,
  `convex/projects.ts:557-560` (`getScienceCodeSuggestionContext`) and
  `convex/debugTools.ts:45-48`. Once they move, the helper is the only
  project-scoped reader. Clients never subscribe to transcript text in bulk:
  `listTranscripts` returns metadata only and `getTranscriptContent` returns
  one body at a time.
- **Digest artifact:** `transcriptDigests` holds a condensed stand-in for one
  transcript, keyed by `(transcriptId, sourceContentHash, condenseVersion)`.
  A digest is never regenerated for the same key, and any change to the
  condense prompt, the digest schema or the size constants bumps
  `CONDENSE_VERSION` in the same commit. A digest is generation input, not
  report prose; it enters the pipeline only as a frozen `generationSources`
  row of kind `transcript_digest`, never as live text.
- **Provenance shape:** every existing single-id field
  (`generations.transcriptId`, `reports.sourceTranscriptId`,
  `reportSnapshots.sourceTranscriptId`,
  `reportProvenance.sourceTranscriptId`) keeps being written with the first
  transcript of the set, so readers that have not migrated see no change. The
  lists (`transcriptIds`, `sourceTranscriptIds`, `digestIds`) and
  `generations.inputMode` (`full` | `digest`) sit alongside them and are
  optional. Claim citation is unchanged: every claim is still validated
  byte-for-byte against one frozen source row.
- **Migration and compatibility:** widen only, per the schema rollout rule
  (`:226`) and the D7 precedent (`:220`). Every new field is optional, no
  backfill runs, and no legacy field is narrowed or removed here; the one
  non-additive change, `generations.transcriptId` required → optional, lands
  in `transcripts-2` together with the two readers that dereference it.
  Narrowing anything else remains a separate, dedicated decision (`:247`).
- **Authorization:** no new capability cells. `listTranscripts` and
  `getTranscriptContent` use the same internal-project-access check and the
  same silent-`null`/empty-result policy as the `getTranscript` query they
  extend; `getTranscriptContent` authorizes through the transcript's own
  `projectId`, so an id from an unreadable project returns `null`.
- **Tests:** `convex/transcripts.test.ts` (ordering, legacy label default,
  empty rows dropped, metadata shape and absence of content, the 20-row cap,
  access policy on all three queries, prompt assembly and quote location).
  Later tickets add `convex/generationInput.test.ts` (prompt parts and claim
  mapping), `convex/projects.test.ts` (create with many transcripts),
  `convex/lib/snapshots.test.ts` and `convex/reports.test.ts` (provenance
  sets), `convex/ai/condenseAgent.test.ts` and
  `convex/transcriptDigests.test.ts` (condensation decision, digest
  persistence and reuse).
- **Approval:** product owner requested several transcripts per project and a
  working two-hour transcript at the 2026-08-26 client meeting; recorded here
  before any code relies on the contract.

### 2026-09-04 — Recorded reviewer decision on internal-review completion

Transition-policy amendment. Origin: AI engine sprint 2 boundary spec
(`_bmad-output/specs/spec-ai-engine-sprint-2-boundary`, story 7). Leaving
`internal_review` was an unaudited stage flip: nothing recorded who judged the
report, what they decided, or which revision they had actually read.

- **What changes:** the two internal-review completion edges
  (`internal_review` → `edits` and `internal_review` → `ready_for_delivery`)
  carry a new `review_decision` requirement in the transition matrix. A
  `setWorkflowStage` call across either edge must supply
  `reviewDecision: { decision }`, and the decision must agree with the
  destination — `edits` ⇒ `return`, `ready_for_delivery` ⇒ `approve`. Supplying
  a decision on any other edge is a typed `INVALID_INPUT` rather than a silent
  drop. No authority rule, note rule, OCC semantics, open-work check before
  `abandoned`, or same-stage no-op changes; every other edge behaves exactly as
  before.
- **Implementation:** additive `reviewDecisions` table (`projectId`,
  `reportId`, `reviewerId`, `revisionNumber`, `contentHash`, `decision`,
  `toStage`, optional `note`, `createdAt`; `by_projectId` and `by_reportId`
  indexes). `setWorkflowStage` resolves the project's latest report and writes
  one decision row in the same transaction as the stage patch and the
  `stage_changed` event — no second mutation, no scheduler hop. The row pins
  `report.revisionNumber ?? 0` and `report.contentHash ?? sha256(content)`, so
  a legacy report is pinned to revision 0 with a freshly computed hash. The
  requirement is checked before the fail-closed `promoted_branch` check so it
  is observable on the `ready_for_delivery` edge too. This story writes the
  record only; no reader, query, or UI panel yet.
- **New typed error:** `REVIEW_DECISION_REQUIRED` when the decision is absent
  on a completion edge.
- **No-report consequence:** a project in `internal_review` with no `reports`
  row cannot leave through either completion edge — typed `INVALID_STATE`,
  because a judgement cannot be pinned to a revision that does not exist. Such
  a project can still move to any other stage (for example back to `drafting`)
  under the unchanged default policy.
- **Migration:** additive; no backfill and no field added to an existing table.
  Historical completions have no decision row.
- **Tests:** `convex/projectWorkflow.test.ts` (N×N matrix, missing decision on
  both edges, contradictory decision, decision on an unrelated edge, missing
  report, legacy report, happy path asserting the stored row and the single
  `stage_changed` event); `convex/dashboardStageCounts.test.ts` and
  `convex/workItems.test.ts` pass unmodified.
- **Approval:** proposed 2026-09-04 from the approved sprint spec; recorded
  here before the behavior change ships.

### 2026-09-04: absolute blocking QA (CAP-8)


The user approved CAP-8 as an absolute gate on filing readiness and client publishing for the current report revision and actual content. Missing because clauses on recognized uncertainty statements anywhere in section 242 and explicit false `cra_compliance.why_how_why_intact` or `cra_compliance.uncertainties_distinguished` in validated QA are non-waivable, including manager/admin and writer `reportSkeleton` overrides. This supersedes only the conflicting blocking-QA portion of the 2026-09-01 skeleton amendment. House-style opener/verbiage, banned words and repetition remain advisory with existing style waivers. Feedback and later passing scores cannot resolve a failure on unchanged content; human content corrections produce a new revision. Saving or restoring byte-identical content retains its known methodology failures on the resulting revision. Missing QA or missing compliance data alone is not a blocker.

- **Scope and approval:** sprint 2 boundary CAP-8, story 8; product-owner invocation on 2026-09-04 explicitly resolved the policy as absolute, with no waiver.
- **Compatibility:** additive `qaFindings` rows, no backfill; legacy reports are checked deterministically at readiness/publish. New post-QA revision references are optional for older callers, whose unpinned results cannot establish methodology findings.
- **Authorization:** existing role/capability checks remain; `QA_BLOCKING` rejects publish before writes. Human workflow stages are unchanged.
- **Tests:** `convex/qaBlocking.test.ts`, detector/prompt/extraction suites and existing project authorization tests.

### 2026-09-04: Privacy at selected firm-wide knowledge boundaries (CAP-1)

Records the approved [story 2 contract](../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md)
for [CAP-1](../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md#capabilities).
The documentation obligation originated as DW42 in the learn/chat run; that
run-local label is not a canonical ticket identifier.

- **De-identification:** `convex/lib/deidentify.ts` applies best-effort,
  project-record and regex matching, without a model call. The identifier set
  is `clientName`, `title`, `sredTitle`, `writer`, `interviewer`, and
  `interviewees`. Every project-record identifier string is trimmed; blank
  values and values shorter than three characters are ignored, including
  titles. Email and phone patterns are applied separately. Replacements use `[redacted]`,
  `[redacted email]`, and `[redacted phone]`, preserving prose layout rather
  than collapsing whitespace. False negatives are accepted in this sprint;
  this is not a guarantee that all client identifiers are removed.
- **Write boundaries:** `nominateFromReport` scrubs the report's plain-text
  content and the project-title portion of its label before importing a
  `brainSources` candidate. It still enters the pending approval queue.
  `approveSectionDraft` scrubs `sectionEditEvents.draftText` and
  `approvedText` before insertion and scrubs `ghostText` when patched later.
  The edit ratio continues to use raw prose, and report/section prose itself
  is unchanged by this scrub.
- **Read boundary:** `proposalWordingEditEvents` retain their raw stored
  `originalText` and `editedText`. `getProposalWordingEditsForDigest` scrubs
  those fields when returning learning input, using the current project
  record. If the project no longer exists, email and phone patterns still
  apply. A renamed project's previous identifiers may survive this read.
- **Digest instruction:** both QA-calibration and drafting-style distillation
  prompts require generic rules and prohibit carrying company names, person
  names, project titles, email addresses, or phone numbers from events into
  rules, including identifiers missed by the best-effort scrub.
- **Publication precondition:** an administrator with `settings.configure`
  must explicitly submit `privacyReviewed: true` to `selectDigest` for every
  non-null `digestId`, confirming review for client identifiers. This also
  applies when restoring an older version or selecting the same version.
  An absent or false flag rejects the publish operation before a selection
  event is written. `digestId: null` still disables guidance, including a
  rollback to no guidance, without privacy attestation; authorization and
  the current-selection concurrency check still apply. The reviews page
  holds a separate checkbox for each digest kind, gates its publish buttons,
  and clears that kind's checkbox after successful publication. Disable
  guidance is not gated by the privacy checkbox.
- **Governance and compatibility:** candidates remain immutable and inactive
  until administrator selection; personal digests cannot be published
  globally. Existing selection-history and Brain-approval governance remain
  unchanged. No schema field or persisted privacy-attestation field is added
  to `learningDigestSelections`. Scrubbing is forward-only for the nomination
  and section-event write boundaries; existing stored content is not
  backfilled. CAP-1 does not extend scrubbing to other Brain import paths or
  other free-text learning streams. Their residual privacy exposure remains
  recorded in [story 2's deferred findings](../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/2-de-identification-before-firm-wide-knowledge.md).
- **Verification pointers:** `convex/lib/deidentify.test.ts`,
  `convex/brainFeedback.test.ts`, `convex/generationLifecycle.test.ts`, and
  `convex/learning.test.ts` cover the helper, nomination, section writes,
  proposal reads, and publication gate. The per-kind checkbox and reset are
  covered by `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`.
- **Approval:** records the already approved CAP-1 contract in AI engine
  sprint 2 learn/chat story 2, as authorized for the 2026-09-04 failed-story
  repair ([authorization record](../.audit/DW42/evidence.md#authorization-and-source-provenance)). No additional product
  policy or capability is introduced by this documentation amendment.

### 2026-09-04: Digest diversity and signal provenance (CAP-4)

Records the [human-approved CAP-4 decision](../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/decisions/digest-diversity-policy-2026-09-04.md)
and [story 4 contract](../_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/4-digest-diversity-gate-and-signal-provenance.md).

- Each stream reads a bounded recent window of up to 500 records before
  applying meaningful-signal filters. Admission and exclusion counts cover only
  records remaining after those filters, not the full feedback history.
- Apply existing meaningful-signal filters first, then exclude records missing
  writer or project attribution. The producer is the signal's author, never
  the project creator, owner, approving administrator, or a placeholder.
- Each stream independently needs at least two distinct producers and two
  distinct projects among its attributed records. Omit streams that fail;
  they cannot veto qualifying streams or pool their diversity with another
  stream. Additional streams must use this same rule.
- At least five admitted records are required overall. This minimum is shared
  across qualifying streams. Below it, generation skips the model call and
  creates no candidate.
- The same admitted records determine prompt input, source count, exact signal
  IDs, per-producer contributions, and freshness cutoff. Excluded records
  remain intact and cannot advance the cutoff or cause redistillation when
  admitted inputs have not changed. Existing cutoff deduplication remains.
- Immutable candidates retain their admitted provenance and exclusion snapshot.
  Excluded totals count unique records; missing-writer and missing-project
  reason counts can overlap. Insufficient-diversity counts describe attributed
  records omitted because their stream failed diversity.
- A separate latest-attempt record per digest kind exposes admission details
  and outcomes for insufficient inputs, no admitted feedback newer than the
  last candidate cutoff, unsupported model rules, saved candidates, cutoff
  deduplication, and failed generation. Generation failures record a safe
  generic attempt outcome and rethrow the original failure for operational
  handling; provider errors and secrets are not exposed in admission details. Administrators can inspect
  it even when no candidate exists. Historical metadata stays unavailable;
  it is never fabricated or backfilled.
- Attribution IDs stay internal and are excluded from provider payloads.
  Learning reads apply existing best-effort project-aware de-identification to
  QA feedback, candidate comments, section edits, proposal wording edits, and
  approved feedback prose. This extends CAP-1's read protection while retaining
  source records and the helper's documented limitations.
- Supported rules create unpublished candidates only. Compatibility freeze,
  personal isolation, `settings.configure` access, separate administrator
  selection, and per-publication privacy confirmation remain in force.
  This amendment introduces no new permission or report-editing authority.

### 2026-09-03 (second) — The preview workspace is on for every internal role

Rollout amendment. Origin: the 2026-08-26 client meeting (the writers were
still on the old UI and Michael could not reproduce their bugs) plus owner
direction 2026-09-03. Landed by the `workspace-1-gate-on-for-everyone` and
`workspace-2-drop-dead-gate-branches` tickets.

- **Affected ticket/scope:** `workspace-1-gate-on-for-everyone` (backend gate,
  admin rollout card and its tests) and `workspace-2-drop-dead-gate-branches`
  (the dead resolver branches and the browser cases that modelled the retired
  cohort). No other ticket depends on the rollout gate.
- **Decision:** exposure of the preview workspace is no longer a rollout
  decision. `workspaceRollout.getAccess` returns `{ available: true }` to any
  authenticated caller holding `project.readInternal`, and denies everyone
  else by throwing, which the client reads as the `error` state. There is no
  internal cohort that sees the current dashboard by default.
- **Supersedes:** the 2026-08-06 canonical-URLs clause "the rollout gate
  (master switch AND per-user access, fail-closed) is reused unchanged"
  (see “Canonical workspace URLs and always-visible canonical board columns”) no longer describes the system. Every other clause of that
  amendment stands: `/dashboard` is still the permanent compatibility entry,
  `/projects` and `/my-work` are still the canonical URLs, params are still
  preserved, and a decision of `current` still soft-redirects rather than
  404s. The 2026-08-11 "admins always" short-circuit was never an amendment —
  it existed only in code comments (`workspaceRollout.ts` and
  `WorkspaceGate.svelte`) and is recorded here only so a reader who finds it
  in git history knows it carried no contract.
- **Domain impact:** none on vocabulary, invariants, transitions or
  permissions. Exposure is not authorization: every read and write inside the
  workspace still passes its own capability check, unchanged. `?workspace=current`
  remains the rollback surface — it wins on every gated route, mid-load and on
  query error, and the access query is not even subscribed when it is present.
  The route state is now a function of `?workspace=current` and the access
  query outcome alone: `current`, `loading` while it is pending, `preview`
  when it resolves available, `current` on error.
- **Migration and compatibility:** no schema change and no backfill. The two
  rollout tables (`workspaceDashboardAccess`, `workspaceDashboardRolloutEvents`)
  and the `workspace.dashboard.v1.enabled` `appSettings` master row remain in
  place and are no longer read as a gating input. Removing them is a separate,
  narrow decision under the schema rollout rule (see “Cross-cutting engineering rules” and “Migration sequence”); until it is
  taken, nothing writes to them from the product surface. `getAccess` keeps its
  `{ available: boolean }` return shape, so a future narrowing needs no client
  change.
- **Authorization/test impact:** no new or changed capability cells. Superseded
  test contracts: the `workspaceRollout` gate tests, the admin rollout card
  test and the resolver's `localDevelopment` cases are deleted; the browser
  suites (`WorkspaceGate.component.test.ts`, `workspaceRoutes.component.test.ts`,
  `projectRoute.component.test.ts`) reach the `current` outcome through
  `?workspace=current` or a failed access query instead of an unflagged user.
  Unchanged and green: `?workspace=current` precedence, the neutral loading
  state, param preservation on every soft-redirect, and the fail-closed
  `current` fallback on error.
- **Approval:** product owner direction 2026-09-03, from the 2026-08-26 client
  meeting ("the writers need the new dashboard"); recorded here in the same
  wave as the code that relies on it.

### 2026-09-15 — Project metadata edit scope

Authorization amendment. It adds one row to the role and capability matrix
and changes no vocabulary, invariant, transition, or storage.

- **Affected ticket/scope:** untracked owner decision (no BNH ticket); lands
  with the client-name field in Project details and the review-mode PD upload
  prefill. Origin: product owner direction 2026-09-15 (lhouse@banhall.com):
  the people allowed to write a project's report are the people allowed to
  correct its details, and a writer handed a project through an open work
  item should not need the Owner to fix a title or a fiscal year-end.
- **What changes:** the matrix gains "Edit project details (titles, client
  name, project number, industry, science code, tags, fiscal year-end)":
  Consultant — own project or assigned collaboration context; Manager and
  Admin — all; Financial — no. "Own" reuses the report-prose definition (the
  durable Owner via `projects.ownerId`, or a Consultant with an OPEN work item
  on the project assigned to them). `createdBy` is never consulted.
- **Bulk edit stays owner-only for Consultants:** the dashboard bulk edit
  (`bulkUpdateProjects`) keeps its 2026-09-01 (second) scope — a Consultant
  changes only projects they currently own; other selected projects are
  counted as skipped, assigned ones included. This is deliberate: a mass
  change across a selection is a different risk from a single-project
  correction, and the assignment context is per project.
- **Storage:** none. No new capability key; the row is enforced through
  `report.editProse`.
- **Behaviour/implementation:** one gate, `requireProjectMetadataAccess` in
  `convex/lib/roleCapabilities.ts`, shares the report-prose decision
  (`reportEditLevelAllows`) and differs only in its error message. It guards
  every single-project metadata mutation in `convex/projects.ts`
  (`updateProjectTitle`, `updateProjectTitles`, `updateProjectClientName`,
  `updateProjectIndustry`, `updateProjectScienceCode`, `setProjectNumber`,
  `updateProjectTags`, `updateProjectFiscalYear`). Client name gains a
  single-project mutation with the same trim/non-empty rule as the bulk
  branch. Outsiders and Financial users receive a typed `NOT_AUTHORIZED`.
- **Authorization:** one new matrix row; no existing cell is loosened.
  Shared/client-review tokens do not inherit it.
- **Tests:** `convex/projects.test.ts` (Owner, open-item assignee, unassigned
  Consultant, Manager/Admin, closed item; bulk-edit skip count unchanged).
- **Recorded residual tensions:** (1) When the work item closes, the
  collaborator loses metadata access at the same moment they lose prose
  access; a correction after handoff needs the Owner or a Manager. (2)
  `deleteProject` remains creator-or-admin (2026-09-01 second) and is not part
  of this row.
- **Approval:** product owner direction 2026-09-15.

### 2026-09-15 (second) — Default report structure: content roles, not paragraph counts; opening clauses off by default

Generation-behaviour amendment. It supersedes the tier table in the
2026-09-01 "Writer-defined report skeleton" amendment and re-describes what
the default (unwaived) skeleton prescribes. No storage table or authorization
changes.

- **Affected ticket/scope:** untracked owner decision; follow-on to
  PSOS-49/PSOS-50, the 2026-09-01 `reportSkeleton` amendment and the
  2026-09-11 four-tier precedence. Origin: the same writer's flags of
  2026-08-23, 2026-08-31 and 2026-09-01 (lrinaldo@banhall.com — the house
  openers and the fixed paragraph architecture kept overriding their settings
  document) and the product owner direction of 2026-09-15: the built-in
  structure should say what each line must contain, not how many paragraphs
  it takes or which words they open with.
- **Owner rule:**
  1. The three CRA lines (242/244/246) and the content each must cover
     remain. They are form fields.
  2. Mandated opening clauses are OFF by default for every writer. The
     house-rule mode for `openingClauses` defaults to `off` with no stored
     row. An admin may still set the category to `writer_choice` or
     `enforced` on `/admin/house-rules`, and a stored value wins.
  3. The default skeleton no longer prescribes exact paragraph counts or
     numbered paragraph roles ("242 P5", "three advancement paragraphs").
     The roles are content the line must cover, in a sensible order, in as
     many paragraphs as the material warrants.
  4. These stay as content rules of the default skeleton (waivable only via
     `reportSkeleton`): the passive/active uncertainty split, because-clauses
     on recognized uncertainties, the if/then hypothesis with a measurable
     then-clause, and the experimentation/iteration elements of line 244
     (problem, approach, result or learning, conclusion).
  5. Per-line line/word limits and no-fabrication/[GAP] stay Locked.
  6. QA identifies paragraphs by role, not by ordinal, and never deducts for
     a paragraph count.
- **Tier table (supersedes the 2026-09-01 table):**

  | Tier | Rules | Overridable |
  |---|---|---|
  | Locked | The three CRA line identities (242/244/246); CRA line/word limits (`convex/lib/lineLimits.ts`, compression pass); no-fabrication/[GAP] and evidence-tracing rules; human-prose dash scan; voice consistency | Never |
  | Default skeleton (`reportSkeleton`) | Per-line content roles in a sensible order; passive/active split; because-clauses; if/then hypothesis with measurable then-clause; iteration elements; knowledge-first framing in 246. No paragraph counts, no ordinal roles. | Per writer; org mode via PSOS-50 |
  | House style | `bannedWords`, `paragraphDensity`, `sentenceConstruction`, `repetitionCaps`, `openingClauses` (canonical list in `shared/styleOverrides.ts`) | Per writer, per category; org mode via PSOS-50. `openingClauses` defaults to org mode `off` |

- **Storage:** no new table or field. The catalog default for
  `openingClauses` in `shared/styleOverrides.ts` (`DEFAULT_HOUSE_RULE_MODES`)
  becomes `off`; a missing or malformed `houseStyle.modes` row degrades to the
  catalog default, which for the other five categories is still
  `writer_choice`. This narrows the PSOS-50 sentence "missing or malformed
  config always degrades to `writer_choice`" to "degrades to the catalog
  default" for this one category. Stored rows are honoured unchanged; no
  backfill.
- **Behaviour:** the section builders in `convex/ai/prompts.ts` describe each
  line's roles as content to cover rather than numbered paragraphs; the
  opener rule text is omitted from drafting/QA/chat assembly unless an admin
  has set `openingClauses` to `enforced`, or to `writer_choice` and the
  writer has not waived it; the deterministic opener scan reports `WAIVED`
  under `off`; QA's Structure Compliance checks role presence and order, not
  count; CAP-8 (2026-09-04) is unchanged — missing because-clauses and an
  unmade passive/active distinction still block. When `reportSkeleton` is
  waived the writer's document remains the authority exactly as on
  2026-09-01.
- **Authorization:** none changed.
- **Tests:** `shared/styleOverrides.test.ts` (default mode for
  `openingClauses`, resolution matrix), `convex/houseStyle.test.ts`,
  `convex/ai/prompts.test.ts`, `convex/ai/qaChecks.test.ts`.
- **Recorded residual tensions:** (1) Under the 2026-09-11 rule an `off`
  category's Compliance Note rows carry `tier: org_enforced`; with `off` now
  the default for openers, that label appears without an admin having decided
  anything, and the Brief's "No Writer Profile applied — House Rules in
  full." line overstates what applied. (2) The PSOS-49 residual tension about
  the locked CRA-verbiage presence check still stands. (3)
  `RULES_VOICE_CONSISTENCY` (recorded 2026-09-01) is resolved in this batch:
  the block now names paragraph roles, not positions. (4) A writer whose saved
  profile waived `openingClauses` now carries a redundant waiver; nothing to
  migrate.
- **Approval:** product owner direction 2026-09-15.

### 2026-09-17 — Step-by-step mode: idea seeds before prose (Summary sign-off gate)

Generation-behaviour amendment for the gated mode only. Origin: the
owner's brief of 2026-09-16, the product design handoff (Google Doc
`1cbfdHVOVqQkzLZAM7IDMEGDiRYc040oFKiwb_Mnb2_E`), PRD
`_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/prd.md` (§10),
feature spine
`_bmad-output/planning-artifacts/architecture/architecture-Banhall-2026-09-16-step-by-step-seeds/ARCHITECTURE-SPINE.md`,
and the owner's answers of 2026-09-17 recorded in
`_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`.
Single and compare modes are unchanged.

- **Owner rule:**
  1. The gated generation mode (`candidateMode: iterative`, relabelled
     "Step by step") gains a seed stage: for each of thirteen fixed
     Subsections of the PD template the AI proposes three to five Idea
     Seeds (one or two bullets, positioning tags, cited excerpts); the
     writer selects, edits, gives feedback, regenerates, skips Optional
     Subsections and approves; a Running Summary accumulates; prose is
     written only after the writer signs off the Summary.
  2. The gate for a seed generation is the Summary sign-off. The
     per-section prose approval of the previous gated flow is retired for
     generations that carry the seed workflow; generations reserved before
     this change keep their section-approval surfaces (workflow recorded on
     the generation at reservation; absent resolves to section approval).
  3. Seed-stage requests are metered and reported per generation and are
     **never refused on usage**: the writer may regenerate, give feedback
     and retry until the PD is done. An informational notice appears at 40
     requests. This keeps the existing alert-only spend stance.
  4. A signed-off Seed Selection that matches a Claim Exclusion is drafted
     and the Compliance Note records the conflict (`tier: conflict`); it is
     not repaired away. The writer is warned at approval and the
     confirmation is recorded.
  5. Content precedence in drafting: Locked Rules, then the signed-off
     Seed Selections, then Brief entries. Style precedence (2026-09-11) is
     unchanged; Glossary Terms normalize wording only.
  6. Subsections are content roles (2026-09-15 second amendment), never
     headings and never paragraph counts; the report keeps exactly three
     Lines. Seeds are not prose and never enter the report, a Proposal or
     the Brief; the report is created through the existing creation path.
  7. The Brief version and generation settings are frozen per generation
     for the seed stage; a Brief edit mid-run applies to the next
     generation; "Regenerate with this Brief" is unavailable while a
     generation is active.
  8. The ghost one-shot comparison draft is not run for seed generations;
     their edit-distance baseline is the generated report's first snapshot,
     as in single mode. Seed generations do not produce
     `sectionEditEvents`; the draft-style digest labels the mode as not
     included until seed decisions are distilled.
- **Storage:** new project-scoped tables (`seedSubsections`, `seedBatches`,
  `seedBatchContext`, `seeds`, `seedProvenance`, `seedSelections`,
  `seedFeedbackRequests`, `seedStaleEpisodes`, `summaryVersions`,
  `summaryItems`, `seedDecisionEvents`), optional fields on `generations`
  (`gatedWorkflow`, `seedStageVersion`, `briefVersionId`,
  `summaryVersionId`, `originGenerationId`, `sourceIdMap`,
  `seedRequestsReserved`, `seedStageError`), an optional `planRef` on
  `complianceNotes`, and the project-scoped table registry the 2026-09-03
  spine named as a target. No `generations.status` value is added; the seed
  stage waits in `awaiting_input`. Widen-only; no backfill.
- **Authorization:** no new capability cells. Starting, working and
  signing off a seed generation require `report.editProse` as enforced on
  2026-09-01; `createdBy` is never consulted. The seed-decision events
  record a user reference or `system`, never a free-text identity.
- **Tests:** enforcing tests are named per AD in the feature spine
  (`convex/seeds.test.ts`, `convex/seedRuns`-backed lifecycle tests in
  `convex/generationLifecycle.test.ts`, `convex/lib/seedContract.test.ts`,
  `convex/lib/seedRevisions.test.ts`, `convex/lib/gatedWorkflow.test.ts`,
  `convex/projectErasure.test.ts`, `convex/learningHealth.test.ts`,
  `convex/ai/contextBoundary.test.ts` seed fixtures, component tests under
  `src/lib/components/seeds/`), plus a release-blocking semantic suite
  judged by the reviewing manager.
- **Affected tickets:** none in futur-board yet; build slices 0–8 are
  listed in `_bmad-output/specs/spec-step-by-step-seeds/build-sequence.md`.
- **Recorded residual tensions:** (1) the 2026-09-09 spec's 2x cost
  ceiling does not apply to the seed stage (metered, reported, uncapped);
  (2) latency placeholders (12 s median / 30 s p95 per Batch) are
  unmeasured until build slice 7; (3) whether writers discover the
  relabelled mode is open (PRD OQ-7).
- **Approval:** product owner direction 2026-09-17 (chat), answering the
  nine PRD open questions; items 2 and 4 are the parent-spine amendments
  the feature spine lists as C2 and C4.

### 2026-09-24: Hand off from the Details panel names a person and a stage

Workflow amendment for the project Details panel (story 5-6 owner amendment of 2026-09-24; `_bmad-output/specs/spec-step-by-step-seeds/ui-design-final.md` section 8; owner decisions 16 and 18 in `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`).

- **Owner rule:** a handoff made from the Details panel names a person and a stage. When the chosen stage differs from the current stage, pressing Hand off is the user's confirmation of that stage change, and the work item and the stage change are written in one mutation. This widens the earlier rule under which only "Send for internal review" could carry a stage change.
- **Stage change:** follows the transition matrix unchanged. The actor needs authority for the edge; for edges that require an audit note the handoff note is the audit note and an empty note is refused; edges with requirements that cannot be met (delivery outcome, promoted branch) fail closed and the UI shows them disabled; the internal-review completion edges, which need a recorded reviewer decision, are not offered from Hand off.
- **Work item:** always blocking. Its type is derived from the chosen stage: `internal_review` gives `internal_review`; `edits` or `revisions` give `revision`; `intake` or `interview_complete` give `interview_followup`; `ready_for_delivery` or `delivered` give `delivery_prep`; any other stage gives `other`. `dueAt` is not set from this surface (existing due dates stay stored). Instructions may be empty.
- **Replacement:** an open blocking handoff is canceled in the same mutation with a system reason naming the new assignee, and `projects.currentHandoffId` points to the new item (the existing replacement rule).
- **Authority:** unchanged. Only the Owner, a Manager or an Admin can hand off; a current handoff assignee who is not one of those cannot.
- **Migration and compatibility:** none; one additive mutation. `workItems.create`, "Send for internal review" and every other work-item surface keep their behaviour.
- **Tests:** each derived type, replacement of an existing handoff, a note-required edge with and without a note, fail-closed edges, refused authority, and idempotent retry by request id.
- **Tickets:** none (feature branch `feat/seeds-5-6-ui`).
- **Approval:** product owner, 2026-09-24.

### 2026-09-24: Stop after sign-off, background QA and "Draft the rest"

Generation-behaviour amendment for Step-by-step prose generation (PRD FR-26, FR-42, FR-43, FR-44; SPEC CAP-13, CAP-17, CAP-18; owner decision 20 in `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`).

- **Background QA:** a signed-off seed generation completes and creates its report as soon as its Sections are drafted and the consistency pass has run. QA and chronology then run once, in the background post-QA job, under the calibration and writer instructions frozen at generation start. Other generation modes are unchanged.
- **Stop:** `stopOrderedGeneration` also accepts a signed-off seed generation. It needs report edit access and records a `stop` seed event. The Section being written finishes and is kept; no later Section starts; the report is created with the drafted Sections and a `[NOT GENERATED]` body ("Not drafted") for the rest; no QA is scheduled. Once every Section is drafted, Stop is refused (`DRAFT_COMPLETE`) and the complete draft finishes with its QA. Before sign-off the generation is still cancelled, never stopped.
- **Generation state:** unchanged. A stopped seed generation is `completed`. "Draft the rest" is a sub-state (`generations.redraft`) of that completed row, never a new transition.
- **Draft the rest:** `redraftMissingSections` needs report edit access. It drafts only the Sections whose report body is still exactly the untouched placeholder (a Section an earlier attempt drafted but never wrote into the report is written without drafting it again), from the same frozen Summary version and inputs, and writes them into the same report in one mutation against its latest saved content: every other node, including the writer's edits, is kept, a Section the writer started typing in is left alone, a pre-edit snapshot is taken and the revision is bumped. One attempt runs at a time; a repeated call joins it. Each attempt schedules its own expiry after 15 minutes without progress, which settles it as failed (drafted Sections are kept) so a retry can start. Completion is read from the report: when no Section body is still the placeholder, including Sections the writer filled by hand, QA runs in the background. This is the writer's own action finishing the interrupted report-creation path, not an AI tool editing prose, so it does not go through proposals.
- **Migration and compatibility:** additive only (`stop` event kind, optional `generations.redraft` and `generations.postQaCompletedAt`). No backfill.
- **Tests:** `convex/generationSeedSignoff.test.ts` (background QA, progress, Stop, Stop during the last Section and the consistency pass, redraft, permissions, fencing) and `convex/lib/tiptapReport.test.ts`.
- **Tickets:** none (feature branch `feat/seeds-5-6-ui`).
- **Approval:** product owner, 2026-09-24 (decision 20 and the FR-43 amendment).

### 2026-09-24: Home tables and Continue working

Presentation and read amendment for Home (`/my-work`), from the owner-approved final UI (`_bmad-output/specs/spec-step-by-step-seeds/ui-design-final.md` section 9, boards 1.1 and 1.2). It replaces the start-project composer, the shader wash and the Projects card on Home, and lifts the 2026-08-14 rule that "With you" is Home's only operational read.

- **Layout:** a top bar (page icon, "Home", greeting, bell, New project) and one panel with two tables (Name, Client, Stage, Last edited) on the left and "Continue working" on the right. No due dates, no agenda, no search on Home; the repository stays on Projects.
- **With you:** unchanged meaning and source: open work items assigned to the viewer (`myWork.listAssignedToMe`), shown once per project in due-first order. "Last edited" is the project's `updatedAt`, which the row now carries as `projectUpdatedAt`.
- **Recently opened:** the projects this viewer opened on this device (the existing browser-local list), read live by `myWork.listRecentProjects` (at most 10 ids; malformed, missing or deleting projects drop out). With no local history the table is labelled "Recently edited" and shows the latest edited projects in the workspace (`dashboard.listFlatProjects`, sorted by update). No per-user server record of opens is added.
- **Continue working:** the last project opened on this device, otherwise the most recently edited project with the viewer, read by `myWork.getContinueWorking`: client, fiscal year, project number, stage, edit time and the count of pending edit proposals on its latest report (bounded to the 200 newest proposals). "Resume report" opens the project. The company documents card on the board is not built: documents belong to projects and no company-level read exists.
- **Creation:** New project in the top bar opens the existing wizard, which owns title and transcript entry.
- **Authority:** read visibility matches the other My Work reads (`project.readInternal`). No mutation, permission or transition changes.
- **Migration and compatibility:** none; two additive queries and one additive row field.
- **Tests:** Convex tests for both queries and the new field; component tests for the tables, empty states, stage chips and Continue working.
- **Approval:** product owner, 2026-09-24 (final UI contract).

### 2026-09-24: Automatic model catalog and role switching

- **Decision:** owner decision 21 (`_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`): a daily job keeps the app on the best current models and switches them on its own, with guardrails.
- **Vocabulary:** a *model role* is a named job the app gives a model: `writing` (default generation model, seeds and redrafts), `structured_helper`, `chat`, `condense`, `retrieval_brief` and `analysis`. The *model catalog* is every model the app can run or evaluate (`modelCatalog`), seeded from `CANDIDATE_MODELS` and refreshed daily from OpenRouter.
- **New actor:** the system may switch a role's model, but only when a candidate passes every evaluation gate on that role's own production task (100 percent of first-attempt outputs valid against the declared tool schema, contract pass rate at least the current model's, judged rubric at least the current model's plus 0.5 with a valid grade for every judged task on both sides, cost within the role's cap) or when the role's switched model fails more than 20 percent of at least 20 requests in a day (rollback, counted as at most one outcome per request: a request that fails in a way that says nothing about the model, such as billing, auth, a rate limit, a network fault or the action's own time limit, records none, and so does an answer cut off at the output limit whose step still succeeds). Every switch writes an immutable `modelSwitchEvents` row and an admin notice on the alerts board.
- **Role tasks:** each role serves specific call sites, and a role switches on its own only when every call site it serves has an evaluation task with a fixture and a contract. Writing: seeds, a section draft and QA. Condense: a digest that keeps named facts and verbatim quotes. Retrieval brief: four name-free technical queries. Style analysis: the settings-document classifier. Release notes: the daily changelog JSON. PD review: flags a planted ineligible claim. Timesheet extraction: known hours and eligibility from a chat log. Brain context: a one or two sentence blurb naming company and section. Chat, learning digests, science code suggestions and feedback summaries have no fixed right answer or no evaluation yet, so they keep their current models, switch only by an admin's choice, and the admin page says why. A role split out of an older one starts from the older role's customised model, if any, and moves independently after that. It keeps the older role's rollback watch on that model: the model to roll back to, the switch time the error window counts from and the last error notice. A rollback the older role made before the split still counts for the split role: while the split role keeps the carried-over model, the error check never flips it back, and the model the older role rolled back from is never evaluated for it again, even after the split role's own later switches. A split role that already has its own model keeps it.
- **Spend:** each evaluation reserves the most its full request envelope can cost against the monthly budget when it starts, pricing each OpenRouter request at its max_price (the most any provider may charge it). Evaluation requests carry the max_price production sends for the role, so they reach the same providers, with one exception: the writing model also judges, and when it is also the model evaluated or replaced, all its requests carry one max_price, the higher of the writing cap and the role's cap, since a model's requests in one evaluation cannot carry two. It is reserved at that higher cap too. Each evaluation is counted in the month it is claimed and, while it runs, against every month until it settles; it then releases the reservation to its actual spend; a request that ends without a reported charge keeps its maximum cost as spend; a judge request over the reserved judge input is never sent (the evaluation is incomplete); a budget lowered below the reservation stops queued evaluations. An evaluation stopped before it starts spends nothing and does not use up its candidate's turn. One the budget refused records the reservation it needed, and until the budget can cover that, planning passes over the candidate and tries the role's next one.
- **Rollback counting:** outcomes are counted per request for the model that actually answered (an OpenRouter fallback counts for itself), after schema validation for structured calls and after parsing for financial extraction, exactly within the window that starts at the later of the switch and 24 hours ago. A model a role was rolled back from is never evaluated for that role again, however many switches follow; an evaluation of it that was already queued or running when the rollback happened never starts or never promotes it; and it is never the role's OpenRouter fallback. The error check never rolls a role back to such a model either, even one an admin chose again since: it tells admins instead, once a day while the model keeps failing, and again right away when automatic switching is turned back on. A direct Anthropic model and its OpenRouter listing count as one model here, matched by the canonical slug OpenRouter gives both; if OpenRouter re-dates that slug, the direct model follows its listing to the new one.
- **Invariants:** a generation freezes every model it uses at reservation (`generations.modelFreeze`); retries and Summary recovery inherit that freeze; a running generation never reads a role again. `promptVersion` hashes only the generation's frozen models, so other catalog changes never move it. Condense digests stay keyed by `CONDENSE_VERSION`, not by model. Model switching never touches report prose, so agents-propose/humans-apply is unchanged.
- **Authority:** Admin only (the existing "Configure models" right): the kill switch (`models.autoSwitch`, which stops every automatic switch and rollback), per-role cost caps, the monthly evaluation budget, manual role assignment and one-call rollback on `/admin/models`. Chat accepts direct Anthropic models only. (Owner decision 30, 2026-09-25: "direct" here means the Anthropic gateway; the chat assistant's streamed turns still go straight to Anthropic on either transport. See the note below.)
- **Confidentiality:** Artificial Analysis scores are internal: shown only on the admin page with the attribution line, never on a client surface or API.
- **Migration and compatibility:** additive tables (`modelCatalog`, `modelRoleAssignments`, `modelSwitchEvents`, `modelEvaluations`, `modelCallBuckets`, `modelCallOutcomes`) and an optional `generations.modelFreeze`. No backfill: rows without a freeze resolve from the seed exactly as before. A split role assignment written before its inherited history was recorded, and still marked as carried over, gets it at the next refresh or switch, from its predecessor up to its own assignment time. One that has switched since it was split no longer carries the marker and keeps only its own history. Phase 2 has not been deployed, so no such assignments exist. The legacy `defaultModel` setting is honoured until the writing role is first assigned.
- **Tests:** fixture-driven catalog parsing and diffing, prefilter and promotion gates, kill switch, cost cap, rollback, production error rollback (including split roles carried over from a failing or rolled-back role), frozen models per generation, prompt version stability, OpenRouter request fields at the HTTP boundary, and the admin page component.
- **Review fixes (2026-09-25, fix/review-b; approved 2026-09-25, the owner delegated the call to the lead):**
  - *Thinking room.* On the direct Anthropic gateway, a model whose thinking is always on (Opus 5.5, Fable 5.1, Mythos 5.1) is sent `max_tokens` of its answer budget times 4, within its output cap (128K), the room OpenRouter reasoning models already get. QA, Self-check, consistency and chronology keep their 4,096-token answer budgets and every answer byte limit; only the request's ceiling grows. Every other model's request is sent byte for byte as before, and the evaluation spending ceiling counts the room.
  - *Action time limit.* Every generation action (start, drafting inputs, seed initialization retry, sections, finalize, redraft, QA) records a deadline when it starts: all its provider requests must end within 540 s, leaving 60 s of Convex's 600 s limit for its own writes. A request is not sent with less than 20 s left, its timeout is cut to the time left, and a transport retry is sent only when it fits. When time runs out the step fails through its usual failure path with "This step ran out of time before the AI could finish, so it was stopped. Try again, or choose a faster model if it keeps happening." That failure, and a request timeout the deadline cut short, is not a model fault and is not counted in the rollback error rate. Request bodies are unchanged.
- **Final review follow-ups (2026-09-25, fix/final-p3; approved 2026-09-25, the owner delegated the call to the lead):**
  - *Each Anthropic retry is decided when it happens.* Under an action's time limit the SDK is sent no retry of its own; the gateway wrapper retries as the SDK would (a dropped connection, a timeout, 408, 409, 429 and 5xx, 529 overloaded included) when a useful attempt of at least 20 s still fits after the backoff or the provider's Retry-After wait, with each attempt's timeout cut to the time left. Before, a retry was allowed only when two full 240 s attempts fitted, so after an action's first 52 s one fast 500 or 529 failed the step. Requests from an action without a time limit are sent exactly as before, and request bodies are unchanged.
  - *A failure the time limit caused is not a model fault (fix-g, review P2-2).* A request that still fails after every retry it was allowed counts in the rollback error rate on both gateways, as it did before this branch series: a 408, 409 or 5xx answer (529 included), a dropped Anthropic connection, or a timeout. (An OpenRouter request that never connects reads as a network fault and is not counted, as before.) The one exception is a failure the action's own time limit caused: a timeout the deadline cut short, or a retryable failure whose retry the deadline refused because too little time was left after the wait. So a request that ran to its full timeout counts when it had no retry left or its retry also ran to a full timeout; on the direct Anthropic gateway, when the retry's timeout was cut to the time left (with less than about 480 s left) and ran out, nothing is counted. OpenRouter never retries a timeout, so a full OpenRouter timeout always counts. An earlier draft of this note excluded every 408, 409, 5xx and dropped connection; that was withdrawn, since a model that keeps failing after it was switched in must still roll back. A retry refused because the provider's Retry-After wait (about 520 s or more) could not fit even a fresh action is not the time limit's doing, so that failure counts (P3 sweep, 2026-09-25; approved 2026-09-25, the owner delegated the call to the lead). The exception for a refused retry is new; it was approved with decision 37 on 2026-09-25.
  - *Tests:* `convex/ai/actionDeadline.sdk.test.ts` (the real SDK and OpenRouter transport with `fetch` stubbed: a fast 500 late in an action is retried, a 529 then an answer is used, a 529 that outlasts its retry counts, a wait that does not fit is not retried, a full timeout is retried with a cut timeout; on both gateways a model that always answers 500 counts on each of 20 requests and would be rolled back, and a failure whose retry the deadline refused counts nothing), `convex/ai/actionDeadline.test.ts`.
- **OpenRouter transport for the Anthropic gateway (owner decision 30, 2026-09-25; the switch-on is pending the owner's OpenRouter account steps):**
  - *Decision.* Every model goes through OpenRouter as the target, billed to OpenRouter credits rather than our own Anthropic key. Anthropic models are pinned to Anthropic's own endpoint with no fallback host. The report chat assistant moves later, not in this change. The direct Anthropic path stays behind a switch for rollback.
  - *The switch.* `ANTHROPIC_TRANSPORT` on the Convex deployment. Unset or `direct`: api.anthropic.com with `ANTHROPIC_API_KEY`, byte for byte as before. `openrouter`: OpenRouter's Anthropic-compatible Messages endpoint (`https://openrouter.ai/api/v1/messages`) with `OPENROUTER_ANTHROPIC_API_KEY` when set, otherwise `OPENROUTER_API_KEY`. Any other value is a configuration error: Anthropic models show as unavailable and calls fail before anything is sent. The value is read when each client is built; nothing is frozen per generation.
  - *What changes on the wire.* Only the endpoint, the key (sent as a bearer token; `ANTHROPIC_API_KEY` is never sent to OpenRouter), the model id (`claude-sonnet-5` becomes `anthropic/claude-sonnet-5`, and so on, from `shared/anthropicTransport.ts`) and one added field, `provider: { only: ["anthropic"], allow_fallbacks: false }`. Never `zdr: true`, which would remove first-party Anthropic. `cache_control` (1-hour TTL included), `thinking`, `output_config.effort`, forced and unforced `tool_choice`, `system` blocks and citations documents pass through unchanged. A model with no OpenRouter id fails as a configuration error.
  - *Anthropic models the catalog finds.* The pin also covers every Anthropic model that reaches OpenRouter as an OpenRouter row (`gateway: "openrouter"`), such as a model the daily catalog found. It is read from the `anthropic/` vendor prefix of the request id, not from a list, and applies whether or not the switch is set, since these rows always go through OpenRouter. OpenRouter applies provider preferences to every model on a request, so a helper role's fallback on the other side of the pin is not sent (a non-Anthropic fallback behind an Anthropic model, or an Anthropic fallback behind another model). Such rows still use chat completions, which drop `thinking`; that is unchanged.
  - *What does not change.* `gateway: "anthropic"` and every policy keyed on it (answer budgets, citations fact extraction, compare pools, the chat role, cost ceilings), frozen generations (no migration), prompt versions and every pinned direct request hash. Retries, timeouts and the action time limit are the same on both transports.
  - *Usage and rollback counting.* Each `aiUsage` row of an OpenRouter call keeps the app model id and adds `transport: "openrouter"`, `servedProvider` (the provider OpenRouter reports, expected "Anthropic"; any other value logs a warning) and OpenRouter's exact charge as `costUsd` with `costSource: "native"`; a call without a reported charge is priced from the table as before. On the `openrouter` transport only:
    - OpenRouter's routing answers are not model faults: a 404 (the pin matched no endpoint) and a 403 (a key guardrail) are not counted in the rollback error rate.
    - A 402 for the in-flight spending budget is temporary. It is recognised by its `Retry-After` header (OpenRouter sends it on no other 402), by `limit_source: openrouter_in_flight_budget`, or by the documented in-flight message in the Anthropic error envelope this endpoint returns. It is retried once after the Retry-After wait when that wait is a minute or less and still leaves a useful attempt before the action's deadline; otherwise, or when the retry is refused again, the step fails with the rate-limit message. It is never counted. A 402 for one request larger than the whole budget stays billing.
    - The switch's own configuration errors (an unknown value, a missing OpenRouter key, a model with no OpenRouter id) are not counted.
  - *With the switch off,* counting and wording are as on b8e97f0a: a missing `ANTHROPIC_API_KEY` still counts toward rollback, and an OpenRouter 402 for an OpenAI or Google model still reads as billing (`convex/ai/anthropicTransport.switchOff.sdk.test.ts`, which passes unchanged on b8e97f0a).
  - *Chat.* The report chat assistant (`convex/ai/chatAgentV2.ts`) keeps streaming straight to Anthropic and needs `ANTHROPIC_API_KEY` on either transport; its helper calls follow the switch.
  - *Before switching (owner).* In the OpenRouter account:
    - Turn off "Input & Output Logging" and "OpenRouter Use of Inputs/Outputs" (both off by default; confirm them under the workspace observability and privacy settings). If logging is ever turned on, prompts are kept for at least 3 months.
    - Leave the account-level Anthropic ZDR toggle off. Leave ZDR off for Anthropic in every guardrail too: a guardrail on the key (or on a member) that enforces ZDR for Anthropic models also removes Anthropic's own endpoint, and every request then fails.
    - The account-wide allowed providers, if set, must include `anthropic`, and the ignored providers must not list it. Otherwise every pinned request fails with a 404.
    - Keep the credit balance above OpenRouter's in-flight budget threshold, or ask OpenRouter to exempt the account. Below it, parallel steps (seed batches, the three section drafts) can be refused with the in-flight 402; each is retried only once.
    - OpenRouter documents an anonymous sampling of prompts for categorization with no opt-out setting, so ask OpenRouter support to exclude the account before real client traffic.
    - Prefer a dedicated key for `OPENROUTER_ANTHROPIC_API_KEY` whose guardrail allows the Anthropic provider only.
  - *Rollback.* Set `ANTHROPIC_TRANSPORT=direct`, or remove it. A Convex environment change may need a redeploy or a restart of running functions before new calls see it; an action already running keeps the transport of the clients it has built. Once the change is picked up, new Anthropic-gateway calls go to api.anthropic.com. Keep `ANTHROPIC_API_KEY` set until the direct path is retired. Expect one cache rewrite per live prompt prefix. Reverting this code after any OpenRouter usage row exists must keep the widened `aiUsage` fields.
  - *Migration and compatibility.* Widen-only: optional `aiUsage.transport` and `aiUsage.servedProvider`, no backfill. `ANTHROPIC_TRANSPORT` and `OPENROUTER_ANTHROPIC_API_KEY` are declared in `convex/convex.config.ts`; the generated `Env` type gains them at the next codegen, which is committed with the merge.
  - *Affected tickets.* None assigned yet; the owner assigns the switch-on.
  - *Follow-ups, not in this change.* The 5.5 percent fee OpenRouter takes when credits are bought is in no usage row or cost cap; the usage report script (`scripts/ai-usage-report.mjs`) now notes it on the OpenRouter credit spend and groups by transport and served provider (P3 sweep, 2026-09-25). An OpenRouter 404 is read as `network` and not counted, including "Model not found" for a model OpenRouter delisted, so such a model never rolls back; consider reading it as `model_access`.
  - *Tests.* `convex/ai/anthropicTransport.sdk.test.ts` (the real Anthropic SDK with `fetch` stubbed: direct wire hashes captured on b8e97f0a, including a request whose attempt timeout the deadline cut; OpenRouter endpoint, auth, body, pin, usage and cost, the served-provider warning, retries, the in-flight 402, error mapping and the action deadline), `convex/ai/anthropicTransport.switchOff.sdk.test.ts`, `convex/ai/modelRouting.test.ts` (the pin on a catalog-found Anthropic model), `shared/anthropicTransport.test.ts`, `shared/modelCatalog.test.ts`, `convex/lib/providerConfig.test.ts`. The direct hashes include the SDK version header, so an `@anthropic-ai/sdk` upgrade needs them recaptured.
  - *Not yet verified against live traffic.* That `usage.input_tokens` excludes cache reads and writes as Anthropic's does, cache hit rates on OpenRouter's capacity, citations and thinking behavior end to end, the request body size limit, the exact 404 and 402 bodies on this endpoint, latency, and whether a Convex environment change takes effect without a redeploy.
- **P3 sweep notes (2026-09-25, fix/p3-sweep; the counting changes were approved 2026-09-25, the owner delegated the call to the lead):**
  - *Stop reason on usage rows.* Every `aiUsage` row keeps the stop reason the provider reported (`aiUsage.stopReason`: Anthropic `stop_reason`, OpenRouter `finish_reason`), so an answer cut off at the output limit ("max_tokens", "length") is visible. Widen only: optional, absent on older rows and when the provider sent none.
  - *A cut-off answer counts only when it fails its step, the same on both gateways.* A structured or text answer cut off at the output limit is refused (fix/cutoff-citations). A cut-off answer records one `output_limit` failure per request on both gateways only where the cut makes its step fail: a section draft (refused, which fails its section), a structured call (fails after its one repair, the same for financial extraction) and a science code suggestion (unusable when cut). Before, OpenRouter recorded a cut structured answer as `malformed_output`, and Anthropic recorded a cut section draft as a success before its reader refused it. As the rollback counting rule above already says for structured calls, a cut answer that would pass schema validation is a failure, not a success. Every other text call site records no outcome for a cut-off on either gateway, and its usage row still keeps the stop reason: a compression keeps the section it was given, a repair keeps the draft it was fixing, a Brain context blurb and a feedback summary are used as they are, and the changelog summary falls back to a plain listing. On OpenRouter the adapter refuses any cut answer, so there the feedback summary and changelog steps fail on a cut; they are still not counted, so the count is the same on both gateways. The list of text call sites that count is kept in `convex/ai/providers.ts` (`cutOffCounts`). The section draft rule and the compression exclusion were approved in the P3 sweep, the repair exclusion in 82005dfd and the narrowing to steps that fail in fix/cutoff-count, all on 2026-09-25 (the owner delegated the call to the lead). A cut-off Self-check still counts, as a structured call, although an unrun check never blocks its section.
  - *A Retry-After wait no action could fit counts.* See the fix-g note on failures the time limit caused. Approved 2026-09-25 (the owner delegated the call to the lead).
  - *Follow-up, not in this change (sweep review P3-3).* The seed revive enables every retired seed row, including one retired while OpenRouter no longer lists it (`missingSince` set), and no gone notice follows, so writers could pick a model whose calls 404 (read as `network`, not counted). Rare: a build drops a seed, OpenRouter delists it, and a later build restores it. Options: revive such a row only when its gateway is not `openrouter`, or raise the gone notice on revive.
  - *Tests:* `convex/ai/cutOff.sdk.test.ts` (both gateways: a cut-off section draft, tool answer or science code suggestion is counted; a cut-off compression, repair, Brain context blurb, feedback summary or changelog summary is not), `convex/ai/actionDeadline.sdk.test.ts`, `convex/ai/actionDeadline.test.ts`.
- **Approval:** product owner, 2026-09-24 (decision 21).

### 2026-09-24: Transcript method (turns, speaker roles, verified facts, placeholders)

Data-model and generation-input amendment for phase 3 of the generation work (owner decision 22). Owner decisions 24 to 27 (`_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`) are binding and restated below.

- **Add, replace and remove after creation:** a project's transcripts can change after the project exists. Anyone who can upload a document to the project (`documents.uploadDocument`'s internal project access check, `requireInternalProjectAccess`) can add a transcript, replace one or remove one. Transcript text stays immutable: Replace writes a new row in the old row's position and archives the old row (`archivedAt`, `supersededById`); Remove archives the row. Archived rows are not "a project's transcripts" (`listProjectTranscripts` skips them) and are kept for the generations that froze them. Add, Replace and Remove are refused while a generation is active; a frozen generation never reads live rows, so it is unaffected.
- **Limits:** one transcript holds at most 500 000 characters (`MAX_TRANSCRIPT_CHARS`, equal to `FROZEN_TRANSCRIPT_CHARS`, so freezing never cuts a new transcript and every stored offset stays valid on the frozen row). An uploaded original file is at most 25 MB. The 20-row and 2 000 000-character project caps are unchanged and count active rows only. Adding text whose `contentHash` matches an active transcript of the same project is refused as "already added". A project's transcript history holds at most 200 rows, active and archived; Add and Replace are refused at that cap. Archived rows are counted on the project (optional `projects.archivedTranscriptCount`) and project reads go through the index `transcripts.by_projectId_and_archivedAt`, so no read of a project's transcripts loads archived text.
- **Formats and originals:** the wizard and the project page accept Teams and Otter `.docx`, `.vtt`, `.srt` and `.txt` (Zoom, Google Meet, Otter or plain). The browser extracts the text; VTT and SRT are rendered to one canonical verbatim form (`Name [hh:mm:ss]: text`). The original bytes may be kept in file storage (`transcripts.originalStorageId`); `transcripts.sourceFormat` and `transcripts.parserVersion` record what was detected. A file another row already holds is refused as an original. The browser uploads the original before the server checks the change, so when Add, Replace or project creation is refused it releases that upload again (`transcripts.discardTranscriptOriginals`, internal actors only, which deletes only files no row holds that were uploaded in the last hour). A daily sweep (`transcripts.sweepUnreferencedStorage`, cron "release unreferenced files") looks at every stored file that is more than a day old and that no row holds through any storage field of the schema (`STORAGE_REFERENCE_FIELDS` in `convex/lib/storage.ts`), such as an original whose save never ran (a closed tab, a dropped connection, a failed release). It covers every file, not only transcripts. **It ships in report mode:** the admin setting `storage.sweepUnreferenced` is `report` unless changed, and in that mode the sweep deletes nothing; it records each run (`storageSweepRuns`: files counted, total bytes, oldest and newest upload time, a sample of up to 20 file ids; admins read it through `transcripts.getStorageSweepStatus`), logs a line, and raises a notice on the alerts board when the count changes. The notice carries counts only: the alerts board is open to every signed-in user, so the sample file ids stay on the admin-only run row. A save attaches only a file uploaded in the last hour (`documents.uploadDocument`, and transcript originals), so no project can claim an old orphan. It deletes those files only after an admin sets the mode to `delete` (`appSettings.setStorageSweepMode`, or `setStorageSweepModeInternal` from the dashboard); `off` stops it. The mode is read on every page, so switching away from `delete` stops a run's deletions at once. The sweep's safety rests on every stored file id living in one of the five storage fields: tests fail when the schema gains a storage field that is not listed, when a module that creates stored files or uploads through an upload URL is not listed, or when app code stores files through the chat agent component, whose own file table the sweep cannot see. The server re-parses the stored text itself; turns are never taken from the client.
- **New project-scoped tables:** `transcriptTurns` (one row per speaker turn, character offsets into the verbatim `content`), `transcriptSpeakers` (one role per speaker label: interviewer, client, other or unknown, with its source: heuristic, model or consultant), `transcriptFacts` (verified SR&ED facts with their quotes) and `transcriptFactRuns` (one row per extraction attempt, with counts and usage). All four carry `projectId` and are registered in `convex/lib/projectScopedTables.ts`, so project erasure deletes them. The transcript's original file is released with its row.
- **Facts are generation input, never report prose:** a fact is extracted once per transcript text and `FACTS_VERSION` on the `condense` model role, and only kept when at least one quote is found in the verbatim transcript and checked byte for byte. A fact enters a generation only as a frozen `generationSources` row of the new kind `transcript_facts` (one rendered fact pack per transcript, next to the full `transcript` row). Every citation, including a Seed that cites a fact, is validated against the frozen transcript row, never the pack. Facts never change report prose; agents propose and humans apply as before.
- **Speaker roles warn, never block (decision 24):** roles come from rules first (the project's interviewer and interviewees, the firm roster, question share, talk share), then one `structured_helper` call for the speakers the rules could not place. A transcript stays "Needs a check" until a consultant confirms the roles in the Speakers popover. Generation runs with the detected roles either way.
- **Only client turns back a claim (decision 25):** a quote located only in interviewer turns, or in the turns of another speaker such as a vendor or a note taker (role `other`), is never evidence. A fact drawn only from such words is kept as context without a citation. A turn whose speaker has no role yet (`unknown`, which includes every turn of a transcript without speaker labels) stays citable, and what it backs is marked for a speaker check: frozen fact spans and Seed citations carry `needsSpeakerCheck`, and the quote card shows a gray "Needs a check: speaker not confirmed" note (decision 24, warn only). This reading of `unknown` was approved on 2026-09-25 (the owner delegated the call to the lead). An extraction records the speakers whose words it left out (`transcriptFactRuns.excludedLabels`); when one of them becomes a client or loses its role, the stored facts are stale and the next request or generation extracts again.
- **Placeholders for every model (decision 26):** before a generation-owned provider call, and before every extraction and speaker-role call, the names held on the project record (client, interviewer, interviewees, writer) and the speaker labels that look like names become placeholders such as `[CLIENT_1]` and `[PERSON_2]`. The map is frozen per generation (`generations.placeholders`), is reversible byte for byte, and every model output is restored before it is stored or shown. Verbatim quotes are restored before they are located, so citation offsets and byte checks are unaffected. This applies to Claude and every other model alike, and to the PD review. Each extraction hides and restores names with one map, built from the project record and the speakers of every transcript of the generation (or the project). A map reads the speakers' names from the transcripts' text each time it is built, with the parser the turn build uses, as well as from the stored speaker rows, so a draft, extraction or PD review that starts before the scheduled turn build has written those rows still hides every speaker (review 2026-09-25: three demo drafts started 28 to 53 ms after their transcript was saved had sent the speakers' names). A label as written ("Shah, Priya") and an organization in a label's brackets ("Acme" in "Priya Shah (Acme)") are hidden too. A map is renumbered past any placeholder-style token already present in the texts its calls send, so a transcript redacted by hand never has its tokens restored into names; a variant the model invents (such as `[PERSON_2_FIRST]` for a one-word name) restores through its base token. The client's name is also hidden as people say it ("Verdant Grid" for "Verdant Grid Technologies Inc."). Report chat is not covered (its answers stream to the browser and cannot be restored yet), so it reads no fact packs: it keeps reading the analyzer's analysis, as today, until chat supports placeholders (review 2026-09-25).
  - **Bare placeholders (2026-09-25):** a model sometimes writes a placeholder without its brackets (`CLIENT_1`, `CLIENT_1_BRAND`, "led by PERSON_2"); an offline replay with fictional projects showed such ids surviving into the analysis and the Brief. The one shared restore now also turns a bare id back into its name, but only when the generation's map issued exactly that id, suffix included, and only as a whole id: the characters on either side may not be a letter, a digit or an underscore, so `XCLIENT_1`, `CLIENT_10` and an unissued `CLIENT_1_OTHER` stay as written. Bare ids are matched in capitals only (`client_1` stays), a spaced form such as `[CLIENT 1]` is not restored, and a bare id gets no variant fallback. Restoring is one pass. A transcript that already holds a literal bare id the map would restore renumbers the map the same way a bracketed one does. What a model is sent is unchanged. Rows stored before this change are not repaired. Bare ids restore only under a map built after this change: each entry of such a map carries `bare: true` (an optional field on `generations.placeholders`). A generation reserved before the change was never renumbered past literal bare ids in its sources, so its map, and the copy Summary recovery carries forward, restores bracketed tokens only, as before. Maps built outside a generation (speaker roles, fact extraction, the PD review) are built fresh on each call and follow the new rule. Before a production deploy, scan stored text for literal bare ids (`\b(CLIENT|PERSON)_\d+` in reports, Brain entries, `generationArtifacts` and fact runs) and repair or strip them: a model that echoes one from text outside the collision check (Brain text from another project, fact packs extracted before the fix, writer edits made after reservation) would now have it restored into this project's name (review P3-B2). A very long literal id (22 digits or more) no longer breaks renumbering: numbers are added exactly, so a token never reads like `[PERSON_1e+23]`.
- **Facts for long transcripts, full text for small projects (decision 27):** the admin setting `transcripts.factsMode` decides where facts replace digests: `off` (default, today's path), `long` (projects over the 200 000-character budget read fact packs instead of digests) and `all` (small projects too). Small projects move to `all` only after the offline evaluation (`scripts/transcript-facts-eval.mjs`) on three real transcripts shows facts match digests on verified-quote rate and fact recall. A generation freezes its choice at reservation (`generations.transcriptFacts`). When facts are missing or failed for any transcript, the generation falls back to today's digest or full-text path.
- **Who reads facts (plan steps 7 and 8):** a generation reads facts only when it froze a pack for every transcript; a pack frozen by an extraction that stopped part way is ignored everywhere. Extraction inside a generation runs only when it, today's fallback and one full analyzer call (kept free for the analyzer and the Brief that follow in the same action) all fit the time left, counted from the exact windows each call would make; otherwise the generation reads the transcripts the usual way and the missing transcripts are queued for background extraction. A pack keeps spans only for the facts it shows, and a pack row over 900 KB is not frozen (today's path again). Reading facts: Seeds see the packs in the transcripts' places and cite a transcript by fact id or a document by an exact excerpt, resolved on the server to verbatim offsets on the frozen row, and each stored citation keeps the fact id and the turn's speaker, role and time; the analyzer and the Brief read the packs, a Brief quote is cited on the transcript row only inside a verified span, and a Brief derived from packs is never reused for a draft that reads transcripts (or the other way round); report sections cite the packs' verified quotes on the transcript row; the Brain query is built from the facts with names dropped, with no model call; the PD review reads the live packs under the same `transcripts.factsMode` rule when every transcript has ready facts, and the transcript text otherwise. Report chat reads none (see decision 26 above).
- **Migration and compatibility:** widen only. Every new `transcripts` field and every new `generations`, `generationSources` (including `factSpans`, the verified spans behind each fact id of a pack), `transcriptFactRuns` (`excludedLabels`, and `parserVersion`: a run is stale once the transcript's turns are rebuilt with another parser version, extraction never reads turns of mixed versions, and a pack never mixes them) and `seedProvenance` (including `needsSpeakerCheck`) field is optional, and `transcript_facts` is a new literal. `FACTS_VERSION` 2 (2026-09-25) re-extracts facts stored under 1 on next use. Parser v4 (`TRANSCRIPT_PARSER_VERSION` 4, 2026-09-25) reads speaker labels differently: a bracket after a name (pronouns, a company, a role) is left off the label, so different people never share one; "Shah, Priya" is read as "Priya Shah"; text copied from the Teams transcript pane keeps its speakers; and heading words ("Result:") and plain "Name:" labels without a speaker pattern across the transcript name no one. Turn and speaker rows keep their shape; rows built under v3 stay readable until `transcripts.backfillTranscriptStructure` rebuilds them, and a speaker row whose label the new parse no longer finds is replaced (its role carries over, see the 2026-09-25 review note below). A batched, self-rescheduling internal mutation (`transcripts.backfillTranscriptStructure`) parses turns and heuristic roles for existing rows with no model call; it is idempotent, and it leaves a row alone while a build holds it (an upload's, say). Turns count as ready for facts only when the current parser version built them: with `transcripts.factsMode` on, opening a transcript or reserving a generation that reads facts schedules a rule-only rebuild of a stale row (once, however often it is asked), and that draft falls back to today's path for it. An upload's request for the model's look at speakers is kept on the row (`transcripts.structureModelRoles`) until its build finishes, whichever build finishes it. Facts are extracted lazily, on the next generation that needs them or when a consultant opens the transcript. `transcriptDigests`, `transcript_digest` rows, old Seeds, provenance and snapshots are untouched and keep working.
- **Authorization:** no new capability cells. Add, Replace, Remove and the Speakers popover use the internal project access check of `uploadDocument`. Reads keep the silent-`null` and empty-result policy of `listTranscripts`. The two admin settings use the existing "Configure models, tags, Brain, and global settings" right.
- **Tests:** parser fixtures per format; every stored span slice equals its excerpt; normalized quote matching maps to verbatim offsets; placeholder round trip including quotes; a fact citation passes `validateCitation`; interviewer-only quotes never become evidence; the fact pack is byte-identical across runs; fallback when facts are missing or failed; idempotent backfill; caps, dedupe, add and replace authorization; erasure covers the new tables; the citations-mode request and response at the SDK boundary with HTTP stubbed; component tests for add and replace, format detection and the Speakers popover.
- **Not in this amendment:** stopping digest creation (plan step 9) waits until facts are on everywhere.
- **Review fixes (2026-09-25, fix/review-b; approved 2026-09-25, the owner delegated the call to the lead):**
  - *Roles survive a parser rebuild.* A role a consultant set or the model placed on a label the new parse no longer finds moves to the new label whose lines were written as it (the label as written, the name before its brackets, the brackets' content, "Shah, Priya"): kept as it was when one old label becomes one new label; given as a rule's guess at 0.6, below the model threshold, when one old label becomes several people (or several old labels disagree), and only where the new rules could not place the speaker themselves. A role with no new label to go to (a heading word, a label buried in prose) sets the transcript to "Needs a check". The rebuild still makes no model call.
  - *Parser v5* (`TRANSCRIPT_PARSER_VERSION` 5): "Acme (Priya Shah)", one word then a full name in brackets, is Priya Shah of Acme, unless the same bracketed name follows several one-word names ("Dana (Verdant Grid)", "Sam (Verdant Grid)"), which makes it their company. A full name in a label's brackets is hidden as a person, word by word too, as parsers before v4 hid it; a company's name ("Northwind Labs") or one bracketed word is hidden as an organization; job titles and departments ("CTO", "Engineering") are not hidden.
  - *Which roles exclude words (decision 25).* A speaker's words are left out of the evidence only when a consultant set the role or its confidence is at least the model threshold (0.7), whoever placed it. A weaker guess reads as a speaker with no role yet: the words stay citable and are marked for a speaker check where a field exists (fact spans, Seed citations). This holds for facts mode and for Seeds, Brief entries and report claims outside it. Outside facts mode the check reads only turns the current parser version built; turns an older parser built give today's byte check alone until the rebuild.
  - *Moving a quote (decision 25).* A quote whose place is only the interviewer's or another speaker's words moves to another place of the same words only when it is at least 6 words and 30 characters long, and only to a place on the same transcript row within 3 turns of the old one (the client's answer, or the client's words the interviewer repeated). A shorter quote, or one with no such place, is dropped and counted as before. Glossary terms still move to any place the client used the term, since a term the client used is theirs.
  - *Reused Briefs are checked too.* When a stored Brief is reused (the same inputs), an entry whose quote is only the interviewer's or another speaker's words under the current roles is dropped into a new version of that Brief (the next version number, everything else copied) and counted on it in `droppedEntryCount`, as a fresh derivation counts it. No model call and no re-derivation; a Brief with nothing to drop is reused as it is, and the Step-by-step start pins the checked version. This covers Briefs derived before the check and Briefs whose speaker roles changed since.
  - *Names kept by the build.* The build stores the other names the labels hold on the row (`transcripts.speakerNames`, optional, with its parser version; absent when over 200). A placeholder map reads them and the speaker rows when the current parser built the row and no rebuild is running, and parses the text otherwise, so a draft started before the build still hides every speaker and a generation start no longer parses up to 2,000,000 characters.
- **Final review follow-ups (2026-09-25, fix/final-p3; approved 2026-09-25, the owner delegated the call to the lead):**
  - *Parser v6* (`TRANSCRIPT_PARSER_VERSION` 6): brackets count as a job title, and are not hidden, only when every word is a title or department word or a connector ("VP Engineering", "Head of R&D", "Chief Technology Officer"). Under v5 one such word was enough, so "Northwind Engineering", "Pacific Research", "Acme Design", "Acme (Jonathan Head)" and "Acme (Pedro Sales)" were sent unmasked. A company name ending in a department word ("Northwind Engineering", "Pacific Research") is now hidden as an organization, and "Acme (Jonathan Head)" is Jonathan Head of Acme. Compared over the transcript fixtures, the Helios kit and the earlier review cases, v6 hides everything v3, v4 and v5 hid, apart from the titles and heading words those parsers hid by mistake. The bump makes rows v5 built store their names again at the next backfill.
  - *Parser v7* (`TRANSCRIPT_PARSER_VERSION` 7, fix-g, review P3-1): brackets that end in a job noun ("Plant Manager", "Lab Technician", "Principal Investigator", "Research Associate", "Senior Mechanical Engineer") are a job title too. Under v6, "Dana (Plant Manager)" made the title the speaker and hid "Dana" as a company, and bare "Dana:" lines became a second speaker; now Dana is the speaker and the title is hidden as nothing. After a full name ("Priya Shah (Senior Mechanical Engineer)") the title is no longer hidden as a person, so "Senior" and "Engineer" in the text stay as written. Job nouns that are also surnames ("Head", "Owner", "Partner", "Chief", "General", "Foreman") are left out, so "Acme (Jonathan Head)" is still Jonathan Head of Acme. Compared over the transcript fixtures, the Helios kit and the earlier review cases, v7 matches v6 everywhere else; it unhides only these titles. A job noun ends a title only after title words, connectors and job modifiers ("Plant", "Lab", "Field", "Mechanical" and similar), so a name or company before it stays hidden ("Acme (Jane Lead)", "Acme (Farokh Engineer)", "Priya Shah (Siemens Field Engineer)"), and each comma part of a bracket is read on its own, so "Acme (Jane Smith, Engineer)" hides Jane Smith, which every earlier parser left visible (fix-g review P2-1 and P2-2). The bump makes every stored structure stale again: run `transcripts:backfillTranscriptStructure` right after deploy (the same step as v6 if v6 was never deployed).
  - *The project record before the roster (decision 24).* The role rules match the project's own interviewer, writer and interviewees first, then a full name on the firm roster (0.95). A full name means the label and the roster name both have at least two name parts and every part of the roster name is in the label, ignoring case, accents, initials and titles such as "Dr." (fix-g, review P2-1). Bracketed words on a label never count toward a full name, so "Dana (Whitfield Consulting)" is not staff member Dana Whitfield (P3 sweep, 2026-09-25). A near miss of the same person is not a full name either: a compound name written with a space for its hyphen ("Jean Philippe Roy" for Jean-Philippe Roy), a middle name only on the roster ("Mary Smith" for Mary Anne Smith), one half of a hyphenated surname, a suffix or credential only on the roster ("Jr", "P.Eng."), or an email roster label ("dana.whitfield@firm.com"). It matches as a first name does, at 0.6, so the model decides. A compound given name is one part, so "Jean-Philippe" or "Mary Anne" alone is only a first name for Jean-Philippe Roy or Mary Anne Smith, and a one-word roster name ("Dana", or "Dana W." once the initial is dropped) never matches in full. A label that matches the roster by a first name alone ("Dana" and staff member "Dana Whitfield") only leans toward interviewer, at 0.6, below the 0.7 threshold that leaves words out of the evidence, so the model looks at it. So sharing a first name with someone on the roster no longer excludes a client's words. A first name that matches the project's own interviewer or writer still places the speaker at 0.95; that rule is unchanged.
  - *Names past the speaker row cap.* A transcript keeps speaker rows for its first 100 labels; the build now stores the labels past that cap with the other names (`transcripts.speakerNames`), within the same 200-name limit, so the placeholder map still hides them when it reads the stored names.
  - *Reused Briefs check only derived entries.* The speaker check on a reused Brief copies an entry a writer edited (`edited`) and every Storyline question unchecked, like removal markers and generated output: they are writer-asserted content and Self-check artifacts, not model-derived evidence.
  - *Tests:* `shared/transcriptParse.test.ts`, `convex/generationPlaceholders.test.ts` (the placeholder map and the outgoing request body with HTTP stubbed, before and after the build; a transcript with 105 speakers), `convex/transcriptStructure.test.ts`, `convex/citationSpeakers.test.ts`.
- **P3 sweep notes (2026-09-25, fix/p3-sweep):**
  - *A turn index for cited spans.* `transcriptTurns.by_transcriptId_and_charStart` lets the speaker check outside facts mode (decision 25, `convex/lib/citationSpeakers.ts`) read only the turns a cited span touches, not every turn of the transcript. Additive index, no backfill.
  - *Roster near misses (decision 24).* See the project record before the roster above. Bracketed words on a label no longer count toward a full roster name. A near miss of a roster full name (a hyphen or a space, a middle name only on the roster, a suffix or credential, an email roster label) only leans toward interviewer at 0.6, below the 0.7 threshold, so the model decides; an exact full name stays at 0.95. An earlier draft placed near misses at 0.95; that was withdrawn. Approved 2026-09-25 as adjusted (the owner delegated the call to the lead). Tests: `convex/transcriptStructure.test.ts`.
- **Approval:** product owner, 2026-09-24 (decisions 22 and 24 to 27).

### 2026-09-25: Generation transition table

Technical-state amendment from the 2026-09-24 generation-structure audit (phase 4, branch `ui/generation-structure`). It writes down the generation moves the code already makes and refuses every other one. No state is added and no move is added or removed.

- **Owner rule:** `generations.status` changes only through one helper, `transitionGeneration` (`convex/lib/generationTransitions.ts`), which checks the declared table in `shared/generationTransitions.ts` and refuses any other move with `INVALID_TRANSITION`, writing nothing. `updateGenerationStatus` accepts only the moves the table declares for the row's flow (in practice `running -> running`, a progress update); it still ignores a terminal row and refuses any other move.
- **Flows:** a row's allowed moves depend on its flow, read from the row before the write: `compare` (also legacy rows without `candidateMode`), `single`, `sections` (iterative without the seed workflow), `seed_stage` (seed workflow before Summary sign-off) and `seed_drafting` (after sign-off, including Summary recovery rows).
- **Status moves** (`from -> to`: flows):
  - `reserved -> running`: all flows (the pipeline claims its reservation).
  - `running -> running`: all flows (a progress update that restates the status).
  - `running -> awaiting_selection`: compare.
  - `running -> awaiting_input`: sections, seed_stage (a section waits for the writer; the seed stage opens).
  - `running -> completed`: single, seed_drafting.
  - `awaiting_selection -> completed`: compare, single (single rows only from before single mode completed on its own).
  - `awaiting_selection -> superseded`: compare (CAP-7 recovery).
  - `awaiting_input -> awaiting_input`: seed_stage (seed initialization restates the open stage).
  - `awaiting_input -> running`: sections (next or redrafted section), seed_stage (Summary sign-off).
  - `awaiting_input -> completed`: sections (last section approved).
  - Every active status (`reserved`, `running`, `awaiting_selection`, `awaiting_input`) `-> failed`: all flows, so project deletion is never refused.
  - `completed`, `failed` and `superseded` are terminal. Nothing re-enters `reserved`; rows are inserted in it.
- **Post-QA sub-state** (`postQaStatus`, absent reads as `none`): `none`, `done` or `failed -> running` only on a `completed` row (at assembly, on request, or when a redraft leaves no Section Not drafted); `running -> done` or `failed`. `saveReportQa` called without an attempt id (legacy callers) may settle `none`, `done` or `failed` to `done` or `failed`.
- **Redraft sub-state** (`redraft.status`, absent reads as `none`), only on a `completed` seed_drafting row: `none`, `completed` or `failed -> running` (a new attempt); `running -> running` (progress, or a fresh attempt replacing a stale one); `running -> completed` or `failed`.
- **Behaviour changes:** none for any move the code makes today. `retryFailedCandidates` no longer writes a restore patch after a failed reservation; the mutation throws and Convex discards all its writes, which is what already happened. `approveSectionDraft` starts post-QA in the same write that completes the generation instead of a second write in the same mutation.
- **Migration and compatibility:** none. No schema change and no backfill; old rows keep their states.
- **Authorization:** unchanged.
- **Tests:** `shared/generationTransitions.test.ts` (every allowed and every refused move of the three tables), `convex/generationTransitions.test.ts` (the helpers, each call site's move, a source check that no module writes these fields directly, and end-to-end moves of the internal mutations).
- **Tickets:** none (phase 4 generation structure).
- **Approval:** the product owner approved merging phase 4 into `feat/seeds-5-6-ui` on 2026-09-25 ("we can put all the work onto the branch for 5173, so that's phase 4"). Merged as part of 9085f3ce; the four backfills ran on the local test deployment the same day.

### 2026-09-25 (second): Generation storage structure (widen, migrate, dual read)

Data-model amendment from the same audit. It changes where generation data is stored, not what it means. The schema is only widened: no field is removed or made required, and no data is deleted. Two parts are not purely additive and are recorded here: one `qaFindings` index is removed (see Indexes), and the moved fields stop being written at deploy (see Rollback).

- **Typed JSON columns:** `generationSectionRuns` gains `metricsData`, `qaData`, `selfCheckData` and `slotCountsData`, and `transcriptDigests` gains `structuredData`: typed copies of the JSON strings next to them. New rows carry both (dual write). Readers take the typed field first and parse the string only when it is absent (dual read). A string that does not convert exactly keeps being read as a string. The strings stay written so code that predates the typed fields keeps working; they can be dropped only in a later narrow step.
- **Indexes:** `seedProvenance.by_generationId_and_seedId`, `summaryItems.by_generationId` and `candidateScores.by_model_and_updatedAt` (model comments are read newest first from one model's range, at most 50 comments from at most 2 000 rows, instead of reading every score). The `qaFindings` index that carried the finding message text (`by_reportId_and_contentHash_and_check_and_message_and_blocking`) is removed from the schema in the same deploy, not kept alongside, and replaced by `by_reportId_and_contentHash_and_check_and_blocking`; the message is matched on the rows of one check. Removing an index deletes no data, and nothing on this branch or in `src` reads the old one.
- **Progress narration:** each line of a generation's progress log is a row of the new project-scoped table `generationProgress` (`generationId`, `projectId`, `at`, `message`, `kind`: info, success or failure from the line's leading check or cross; index `by_generationId_and_at`), written without touching the live generation row. The row's `progressLog` array is no longer written and not kept as a tail: the queries read the child rows. Reads return the newest 50 lines (`getLatestGeneration` returned the whole array before; the stepper shows the last 6). Until a row's array is copied, a read returns the array followed by the child rows; the backfill copies it (the newest 500 lines, stamped at the request time so they sort first) and stamps `generations.progressLogCopiedAt`, after which readers use the child rows alone. The array itself is kept. Project deletion removes the rows (`convex/lib/projectScopedTables.ts`), and no line is written for a project in deletion.
- **Ordered-chain payload:** the chain's frozen payload (analysis, Brain blocks, style inputs, Writer Profile context and, for a signed-off seed run, the Summary version) is stored once per candidate chain as a `generationArtifacts` row of the new kind `ordered_payload` (typed field `orderedPayload`, the row's `candidateRunId`), and every scheduled step of the chain receives its id (`payloadId`) instead of the whole payload. A "Draft the rest" attempt reuses its chain's row. The chain functions still accept `payload` for chains scheduled before this change and forward whichever form they received, so no in-flight chain breaks. Summary recovery copies only the two frozen inputs (`analysis`, `brain_blocks`), never a chain's payload row. No backfill: a finished chain's payload is not needed again.
- **Generation outputs off the live row:** the agent outputs JSON, the Brain exemplar provenance and the retrieval brief move from `generations.agentOutputs`, `brainProvenance` and `brainRetrievalBrief` to `generationArtifacts` rows of the new kinds `agent_outputs`, `brain_provenance` (typed field `brainProvenance`) and `brain_retrieval_brief`, one per generation and kind. `generations.outputsInArtifactsAt` says where a row's outputs live: every new generation sets it at reservation; an older row gets it from the backfill or from its first output write, which copies the row's values into artifact rows first. With it set, every reader (the project page and generation queries, report chat grounding, the QA input and merge, the deterministic QA findings, "Draft the rest" and learning health) reads the artifact rows through `convex/lib/generationOutputs.ts`; without it, the row fields. The row fields are never written again for a moved row and are not cleared; no reader needs them after the move, so they are not kept populated. `getLatestGeneration` and `getGeneration` keep returning `agentOutputs`, so the report page and its QA panel, chronology and section scores read exactly what they read before.
- **QA results keyed to the report revision:** each settled post-assembly QA pass that captured the revision it scored writes a row of the new project-scoped table `generationQaResults` (report, revision number, content hash, status, the scorecard and chronology JSON, score, completion time). The new query `generations.getGenerationQaResult` returns the newest result and whether the report is still at that revision with the same bytes (`current`), so a scorecard shown after the writer edited the report no longer goes stale silently. The panel's own display is unchanged in this step. Older results carry no revision and are not backfilled.
- **Rollback:** progress lines, agent outputs, Brain provenance and retrieval briefs written after the deploy exist only in child rows; the row fields are not dual-written. Rolling back to pre-phase-4 code (with the widened schema kept) therefore shows generations created after the deploy with no progress log, no QA scorecard, chronology or section scores, and no Brain provenance in learning health, and report chat loses their analysis grounding, because the older code reads only the row fields. Generations untouched since the deploy are unaffected: their row fields are kept. A generation that received progress or outputs after the deploy (in flight at deploy, re-scored by post-QA, completed or redrafted later) shows its pre-deploy values after a rollback, without what was written since, such as a newer QA scorecard.
- **Project deletion:** generation artifacts now carry the heavy bytes, and older rows moved by the backfill carry their outputs twice, so one purge page could read past Convex's transaction limits (this was already possible before phase 4 for enough older generations with outputs on the row). Each purge page now runs under a read guard (`convex/lib/purgeBudget.ts`) that covers the whole transaction: the project row, the parent page, every child read and the second read Convex charges for every delete and patch. Before each child read and each row delete or patch it checks the transaction's real usage (`ctx.meta.getTransactionMetrics()`: bytes and documents read, documents and bytes written, index ranges) and stops when a maximum-size read and its delete, plus the deletes owed for rows already read and a margin, would no longer fit; where the runtime cannot report usage, it charges every read by size against 14 MiB instead. A stopped page keeps the row it was working on (and any children not yet deleted) and the next page resumes from the same cursor; every page removes at least one row.
- **Migrations to run once, in any order:** `generations:backfillSectionRunData`, `transcriptDigests:backfillStructuredData`, `generations:backfillGenerationProgress` and `generations:backfillGenerationOutputs`, each started with `{}`. Each pages through its table, reschedules itself and is idempotent (a second run writes nothing); `dryRun: true` reports one page without writing. A failed page ends that chain: start it again from the cursor it returned, with a smaller `pageSize` if the page was too large (the progress and outputs backfills read at most 4 MiB a page, since each writes a copy of what it reads).
- **Tests:** `convex/generationTypedFields.test.ts` (strict conversion, dual write, dual read of legacy and typed-only rows, idempotent backfills, the index-backed reads and the methodology carry-forward through the new index); `convex/generationProgress.test.ts` (child-row writes that leave the generation row alone, the deletion fence, dual read of legacy arrays through the public queries, the read bound, and the idempotent, order-preserving backfill); `convex/orderedPayloadStore.test.ts` (one stored payload per chain scheduled by id, forwarding of the id and of a legacy payload, refusal of a step with neither, and a section action whose payload cannot be loaded failing its candidate without drafting); `convex/generationOutputs.test.ts` (artifact-row writes for new generations, dual read of legacy rows and their move on first write, Brain provenance and brief, learning health and report chat over both forms, the idempotent outputs backfill, and QA results keyed to the scored revision); `convex/projectErasure.test.ts` and `convex/lib/purgeBudget.test.ts` (with Convex's transaction limits enforced in the test harness: backfilled older generations with 200 KB outputs on the row and in an artifact copy, older generations with near-maximum rows and children, the pre-phase-4 shape with 100 older generations, light generations with heavy artifacts, and one generation whose eight 1 MB artifacts take two pages with the parent kept after page one; every page stays under the limits and removes a row, and nothing is left; plus the guard's checks in both modes).
- **Approval:** the product owner approved merging phase 4 into `feat/seeds-5-6-ui` on 2026-09-25 ("we can put all the work onto the branch for 5173, so that's phase 4"). Merged as part of 9085f3ce; the four backfills ran on the local test deployment the same day.

### 2026-09-25 (third): Reordered Step-by-step start (owner decision 32)

Generation-behaviour amendment for Step-by-step (seed) generations only. It moves when two frozen inputs are made, not what they are. Origin: the 2026-09-25 speed research (`HANDOFF-banhall-files/research/speed-1-profile.md`, `speed-2-enterprise-architecture.md`) and owner decision 32 in `_bmad-output/planning-artifacts/prds/prd-Banhall-2026-09-16/DECISIONS-2026-09-17.md`. Single, compare and section-approval generations are unchanged.

- **Owner rule:**
  1. Seeds read the Brief, the frozen sources, the frozen writer style and the writer's decisions, never the transcript analysis or the Brain exemplars. So once a seed generation's sources are frozen, the Brief starts at once, beside the writer style, and the seed stage opens as soon as both exist.
  2. The retrieval brief, the Brain searches and the transcript analysis run in the background while the writer works the Seeds. They still run once per generation, on that generation's frozen inputs, with the same provider requests as before.
  3. Summary sign-off needs them: sign-off is refused while they are still being prepared (`INVALID_STATE`, reason `DRAFTING_INPUTS_PREPARING`) or after they failed (reason `DRAFTING_INPUTS_FAILED`). The Summary bar says "Preparing the transcript analysis…" with a spinner while they run, and names a failure with a "Try again" action. A failure never fails the generation or closes the seed stage.
  4. Not in this change: faster compression, deriving the Brief at upload, drafting Sections in parallel.
- **Writer style on its own:** the style Seeds read (style guidance, Writer Profile context, waivers and learned digests) is frozen as a `generationArtifacts` row of the new kind `writer_style` before the seed stage opens. `brain_blocks` keeps its documented shape (`{ blocks, ...style }`, built from the same style object, byte for byte as before) so every drafting, QA and recovery reader is unchanged. Seeds read `writer_style` and fall back to the style inside `brain_blocks` for generations started before this change.
- **New sub-state** (`generations.draftingInputs`: `status`, `attempt`, `startedAt`, `settledAt`; absent reads as `none`), a fourth machine in `shared/generationTransitions.ts`, written only through `transitionDraftingInputs`, and only on a `seed_stage` row whose status is `running` or `awaiting_input`:
  - `none -> preparing` (`generations.startDraftingInputs` at startup, attempt 1; `generations.initializeSeedStage` when a retry opens a stage whose startup died before that) or `none -> ready` (the same sites, when both inputs already exist, as after a startup that ran on the old code);
  - `preparing -> ready` (`generations.completeDraftingInputs`, which freezes `analysis` and `brain_blocks` in the same write);
  - `preparing -> failed` (`generations.failDraftingInputs`; `generations.expireDraftingInputs` when an attempt gives no answer within 15 minutes, longer than Convex's action limit; `generations.retryDraftingInputs` when the writer retries an attempt still preparing past that lease, just before it starts the next one);
  - `failed -> preparing` (`generations.retryDraftingInputs`, the writer's retry, attempt + 1).
  Every write is fenced by `attempt`, so a stale or cancelled attempt never freezes anything. No `generations.status` move is added: the seed stage still opens with `running -> awaiting_input` and sign-off still moves `awaiting_input -> running`.
- **Cancel, deletion and races:** the background action checks that its attempt still counts before each paid call and drops its result otherwise (a cancel, a project deletion, sign-off or a newer attempt). Seed initialization stays idempotent, so the seed stage opens once; sign-off checks the sub-state and re-reads both inputs in its own transaction, so drafting never starts without the analysis.
- **Migration and compatibility:** widen only (one optional field, one artifact kind); no backfill. Seed stages opened before the deploy have no sub-state and read as ready: they froze both inputs before they opened. A generation whose startup was mid-flight at deploy finishes on the old code path, which saves both inputs before initialization; initialization then records them as ready. `retryInitializeSeedStage` now needs the frozen writer settings and style (or the older `brain_blocks`), not the analysis.
- **Rollback:** keep the widened schema (rows carry the new field and artifact kind). Pre-reorder code reads the style only from `brain_blocks` and has no background step, so a seed generation started after the deploy that has not yet reached `ready` cannot draw new Seeds or sign off on that code; it needs a cancel and a new generation. Generations that reached `ready`, and generations started before the deploy, are unaffected.
- **Authorization:** `retryDraftingInputs` needs `report.editProse`, like sign-off; `createdBy` is never consulted.
- **Tests:** `convex/seedStartupOrder.test.ts` (the Brief and first Seeds before the analysis runs; provider request hashes per stage pinned to the pre-reorder bytes; analysis failure and retry, with authorization; lease expiry and a dropped late result; cancel before and during the background step; the seed stage opens once; generations from before the reorder), `convex/generationSeedSignoff.test.ts` (sign-off refused while preparing and after a failure, with no writes, then signed off after a retry), `shared/generationTransitions.test.ts` and `convex/generationTransitions.test.ts` (the fourth table, its helper and call sites), `convex/ai/promptProgram.test.ts` (the declared stage order), `src/lib/components/seeds/SeedSummaryReview.component.test.ts` (the preparing and failed bar states).
- **Tickets:** none (speed research phase 1).
- **Approval:** owner approved 2026-09-25, decision 32 ("Reorder the start").
- **2026-09-25 note: a failed background step, and a cut-off analysis (approved 2026-09-25, the owner delegated the call to the lead).** Found in the integration review (P2): with the cut-off fix, an analysis cut off at its 16,000-token output limit fails the background step after the writer has done seed work, and a retry sent the same request. No transition, state or permission is added.
  - **Why it failed is stored.** `draftingInputs.failureCode` holds a normalized code only, never provider or model text: `output_limit`, `timed_out` (the lease ran out), `billing`, `rate_limited`, `authentication`, `model_access`, `network` or `unknown`. `seeds.getOutline` returns it with the status.
  - **Shown when it happens.** The Seed workspace shows the failure above the Seeds as soon as the step fails, with the same "Try again" as the Summary (edit access only). A cut-off analysis says "The transcript analysis was too long to finish. Your work is saved. Try again to run a shorter analysis before you sign off."; any other failure says "We couldn't finish reading the transcript for drafting. Your work is saved. Try again before you sign off." The Summary bar shows the same message and "Transcript analysis needs another try". A viewer without edit access gets no button, so both places tell them only what happened: "The transcript analysis was too long to finish. It needs another try before sign-off." or "We couldn't finish reading the transcript for drafting. It needs another try before sign-off." The message is spoken through a live region that is on the page before the failure arrives. The Summary's preparing line now says "transcript analysis" too (rule 3 above quoted "drafting context").
  - **The retry after a cut-off asks for a shorter analysis.** Once an attempt fails with `output_limit`, the generation keeps `draftingInputs.shorterAnalysis`, and every later attempt appends `ANALYZER_REQUEST.shorterRetryNote` to the analyzer's user message: three sentences or fewer per text field, at most 8 items per list, at most 8 experiments, at most 10 quotes under 40 words each. A full answer under those caps is about half the limit. The output limit, timeouts, repair, model and system prompt stay the same, so the retry's worst-case time is the first attempt's, and attempt 1 is unchanged (its request hash is still pinned). The note is not the only way a retry can differ: every attempt reads the project's live title, industry and science code, so if the writer changed one of them after attempt 1, the retry's retrieval brief, Brain filter and fallback query (and so the exemplars the analyzer is sent) follow the new values. This also qualifies rule 2's "same provider requests as before" for retries.
  - **Why not a larger allowance.** Every model on the list could send 32,000 tokens (the direct Anthropic models allow 64,000 to 128,000; OpenRouter clamps to each model's own cap), but the time does not fit. The 240 s request timeout already holds an answer to about 24,000 tokens at 100 tokens a second, so 32,000 tokens needs a longer timeout, and the analyzer then runs up to four such calls (the repair, each with one transport retry). The worst case of the step today (the retrieval brief, then two analyzer calls, each allowed 2 x 240 s) is already above Convex's 600 s action limit; a run that slow is killed and the 15-minute lease fails it. A larger allowance would make that the likely outcome for exactly the long answers it is meant to save.
  - **A step stuck preparing.** An attempt still `preparing` past its 15-minute lease (the lease check failed, or the functions were missing after a rollback) reads as failed with `timed_out`, and "Try again" settles it `preparing -> failed` and then starts the next attempt `failed -> preparing` in one write, the same recovery as an expired lease.
  - **Brain provenance is fenced by attempt.** The background step no longer writes the Brain exemplar provenance and retrieval brief when it retrieves them; `completeDraftingInputs` writes them with the analysis, so a stale or cancelled attempt records no provenance either.
  - **Rollback:** a code-only rollback must keep the widened `draftingInputs` validator, including its two new optional fields `failureCode` and `shorterAnalysis`. Rows written after the deploy carry them, so a schema without them would not deploy.
  - **Not changed:** retries have no count limit. Only one attempt runs at a time (a retry is refused while one is preparing), so spending stays one attempt at a time; a cap would leave cancel as the only way out.
  - **Tests:** `convex/seedStartupOrder.test.ts` (the cut-off failure, its code and the shorter retry; a later failure keeps the shorter request; the stuck-preparing recovery; provenance only with the current attempt; codes for a provider failure and an expired lease), `src/lib/components/seeds/SeedWorkspace.component.test.ts` and `SeedSummaryReview.component.test.ts` (the notices, the retry and a refused retry, the viewer's status without an instruction, and the live region that announces a failure).
  - **Final review follow-ups (2026-09-25, fix/final-p3; approved 2026-09-25, the owner delegated the call to the lead):**
    - *A step that ran out of time is `timed_out`.* The action's own time limit, or a request that ran to its full timeout, is stored as `timed_out` instead of `unknown`, the code an expired lease already uses.
    - *A shorter analysis after any sign it was too long.* The next attempt asks for a shorter analysis when any analyzer answer in the attempt was cut off at the output limit, even if its one repair then failed for another reason (a rate limit, say) or the time limit refused the repair. It also does so when the analyzer of a model that always thinks (Opus 5.5, Fable 5.1, Mythos 5.1) runs out of time: that model is given four times the answer budget as thinking room, so a long analysis ends in a timeout instead of a cut-off. The analyzer request's own template, output limit and caps are unchanged; as with any retry, the attempt reruns Brain retrieval and reads the project's live title, industry and science code, so the exemplars it is sent can differ (see the shorter-analysis rule above). A timeout during Brain retrieval does not ask for a shorter analysis, but one where the time limit refused to send the analyzer at all does, since the model is chosen before the call. This widens rule 2's "same provider requests as before" beyond `output_limit`.
    - *The note names no cause (fix-g).* The appended note said an earlier analysis "was cut off at the output token limit", which is not true after a timeout. It now says the earlier analysis "was too long to finish", true after either. Only retry requests carry the note, so attempt 1's request is unchanged (its hash is still pinned).
    - *Plain server errors.* A refused retry says "The transcript analysis has not failed, so there is nothing to try again"; sign-off refused while it runs or after it failed says "The transcript analysis is still running. Sign off when it finishes" and "The transcript analysis did not finish. Try it again before you sign off". The reasons (`DRAFTING_INPUTS_PREPARING`, `DRAFTING_INPUTS_FAILED`) are unchanged.
    - *Tests:* `convex/seedStartupOrder.test.ts` (a cut-off whose repair then fails another way; `timed_out` for Sonnet 5 and Opus 5.5, with the shorter request only for Opus 5.5; the action's real hand-off of Brain provenance and the retrieval brief, and none after a cancel during retrieval; the shorter retry equal to attempt 1's request apart from the note), `convex/actionDeadline.action.test.ts` (a cut analysis whose repair the time limit refused), `convex/ai/actionDeadline.test.ts`.
  - **Approval:** approved 2026-09-25 (the owner delegated the call to the lead). The shorter retry request qualifies rule 2's "same provider requests as before", which the owner approved.

### 2026-09-25 (fourth): Duplicate copy scope (owner decision 35)

Presentation and behaviour amendment for Duplicate (owner decision 28, extended by owner decision 35 on 2026-09-25). It records what a duplicate copies, what the writer can leave behind, and when the original's report comes along as last year's report. It closes review F3 from the 2026-09-25 Duplicate review and records F2. No workflow stage, transition or permission is added.

- **Two entry points, one copy:** the card or row Duplicate opens `/project/new?from=<id>&drafts=iterative` (a duplicate made to draft again), and the old dashboard's plain `?from=<id>` link makes a full clone. Both prefill the wizard from the original and copy through `projectDuplication.copyProjectContent` after `createProject`.
- **What comes along:** every active transcript, in order, with its label, confirmed speaker roles and facts, and now its original file (.docx, .vtt, .srt), cloned to new bytes; every file in every category, including archived files (still archived), chat uploads and ported PDs, with cloned bytes; and identity evidence, except rows tied to a file that was left behind. A plain-link duplicate and a Review PD duplicate also copy the written PDs reviewed and their PD reviews.
- **What stays behind:** on a card duplicate, the old report and its QA findings (except as last year's report, below), and on a Generate PD card duplicate the written PDs reviewed and their reviews. On every duplicate: Financial page uploads and what is built from them (they are Manager and Admin only, and a draft never reads them), all generation state, and the project number.
- **Tick boxes:** every copied transcript and file has a tick box, ticked by default; each file group has one too, showing the mixed state. Anything unticked stays behind. An unticked transcript stays in the list marked "Not copied" and is not sent to `createProject`. Unticked files go to the copy as a leave-out list (`excludeDocumentIds`), so an empty list, or a list sent before the file list loads, copies everything. The server refuses an id from another project (`INVALID_INPUT`, nothing written), ignores an id for a file deleted since, and refuses more than 250. Leaving out a written PD reviewed also leaves its reviews behind. Each tick row's name is the tick box's label and the whole row toggles it, at least 44px tall on touch screens (review D-6).
- **Ported PDs:** on a duplicate whose fiscal year is not later than the original's, a PD ported in for the original's year starts unticked ("PD for FY {year}, the same year as this project"). Once the fiscal year moves forward it starts ticked.
- **Last year's report:** a card duplicate in Generate PD offers the original's latest report as a Previous-year report only when both projects have a fiscal year-end, the new project's fiscal year is later than the original's, and the report has readable text. It shows ticked in the Previous-year reports group, and a note under the transcripts says they are from the original's fiscal year. The server enforces the same rule (`previousYearReport`): it refuses a same or missing fiscal year, a Review PD project, or a copy that also brings the report as the report. The file is the report as plain text under the same first line the wizard writes above a previous-year upload, category `previous_pd`, source `context_input`, uploaded by the person duplicating. A same-year duplicate never gets it, because the AI would read this year's work as last year's.
- **Review PD:** a copy of a Review PD project stays a Review PD project. Generate PD is shown but not selectable ("A copy of a Review PD project stays a Review PD project."), so Step by step is never offered, and create starts a PD review, not a generation.
- **Files-only duplicate (review F2):** a duplicate with no transcript can be created when a ticked, readable file remains, under the Jul-17 rule. With everything unticked and nothing added, the wizard blocks create: "Tick a transcript or file from {source}, or add your own."
- **Failed copy (review F1, D-2):** if the copy fails after the project is created, the wizard still saves the files the writer added and their written PD, starts no generation or review, and opens the project. It says "Some files from {source} were not copied." When none of the writer's own files were saved (or they added none), it goes on "Duplicate again, or add them on the project page.", then "These files you added were not saved either: {names}." if any failed. When some were saved, a new duplicate would not have them, so it says "Add them on the project page. The files you added here were saved in this project, so a new duplicate would not include them." ("Some of the files you added here were saved…" when some failed, followed by "These were not saved: {names}."). On a Review PD duplicate whose PD was saved it adds "Start the PD review on the project page once the missing files are added." File bytes cloned before the failure are deleted (wording change after review P3-3, approved 2026-09-25 by delegation to the lead).
- **A fresh wizard on a new query:** the wizard reads its query once, so a same-route navigation (New project from the command menu while on a duplicate) now mounts a fresh wizard instead of keeping the duplicate's prefill. While the project is saving, the wizard cancels any navigation it did not start and says "Your project is still being saved. It opens when it is ready.", so a save is not abandoned half done (review D-3). Closing the tab or reloading gets the browser's own leave prompt. A save that has run for 30 seconds may have stalled (offline, for example), so a navigation held after that says "Saving is taking longer than usual. If you leave now, the project may be only partly saved and its draft may not start." with a "Leave anyway" action. Leaving for another page destroys the wizard, which stops the save before it starts a generation or a PD review, so a half-copied project is never drafted. The root layout's deploy-update reload skips a navigation while a save holds it (`src/lib/workspace/saveHold.ts`), instead of turning it into a full page load that leaves anyway (review P3-1 and P3-2, approved 2026-09-25 by delegation to the lead).
- **Copy internals:** `projects.prepareProjectContentCopy` and `projects.finishProjectContentCopy` are internal mutations, and the legacy public `projects.copyProjectDocuments` is removed, so every storage id the copy attaches was made by the copy action. The public action writes only into a project the caller created that has no report, files or identity evidence yet; anything else, including a project with a generation already reserved, running, or waiting on a choice or on the writer (`reserved`, `running`, `awaiting_selection` or `awaiting_input`, review D-11), is refused (`NOT_AUTHORIZED` or `INVALID_STATE`), which also stops a second run from copying every row again. The transcript a copied report cites must be one of the new project's (`INVALID_INPUT` otherwise, review D-7). A copied transcript records the row it came from (`copiedFromTranscriptId`), and only that row's original file is cloned onto it, so pasted text that merely matches a source transcript gets no file (review D-12). The originals are found by the internal query `projects.planTranscriptOriginalCopies` after prepare, which reads only the new project's transcripts and each copy's source row, so prepare reads only the one transcript row a copied report cites (review D-4, D-7). The plan reads at most 20 transcripts of the new project and their 20 source rows. Each project's transcript text is capped at 2,000,000 characters, so the plan reads at most about 4,000,000 characters. That is a character count, not bytes: as UTF-8 it is up to about 12 MB for non-Latin text, still under Convex's 16 MiB read limit per transaction. `createReviewFromProject` (2026-08-11 second amendment) uses the same internals without that check, because it adds its written PD first; it now also clones transcript original files.
- **Wizard query:** `projects.getDuplicateSourceReport` returns only the latest report's version and whether it has text, for internal project readers.
- **Migration and compatibility:** one optional field, `transcripts.copiedFromTranscriptId`, with no backfill. A row copied before it existed has none, so its original is not paired; the copy runs straight after `createProject`, so only a duplicate caught mid-deploy is affected, and it keeps its text. The new copy arguments are optional and the plain link sends none of them.
- **Authorization:** unchanged for who may duplicate. The copy is narrower: it writes only into the caller's new project and never accepts a storage id from a client.
- **Tests:** `convex/duplicateIterativeGeneration.test.ts` (leave-out list, empty list, foreign and deleted ids, internal copy functions, the fresh-project check, last year's report and its refusals and freezing, transcript originals, the drafting and cited-transcript refusals, pasted text getting no original, clones released after a failed copy and a spare clone released in finish, the 250 cap, last year's report on a Review PD project or with no report), `convex/reviewFromProject.test.ts` (originals cloned into the review project), `convex/reportAuthz.test.ts` (the new arguments in the rejected-actor matrix), `src/routes/project/new/newProjectDuplicateDrafts.component.test.ts` (with the failed-copy saves and the tick-row labels and touch targets), `newProjectTranscripts.component.test.ts` and `newProjectRouteReset.component.test.ts` (with navigation held while saving, the browser leave prompt and the way out of a stalled save), `src/lib/workspace/saveHold.test.ts` (the hold the root layout's deploy-update reload reads). The fresh-project check is tested for every non-terminal generation status.
- **Tickets:** none (owner decisions 28 and 35).
- **Approval:** product owner, owner decision 35, 2026-09-25 (copy every transcript and file with tick boxes; the old report only as last year's report when the fiscal year moves forward; ported PDs unticked on a same-year duplicate; Financial page uploads stay behind; transcript originals cloned; Review PD stays Review PD).
- **2026-09-25 note: last year's report is never the only source (decision 42, approved 2026-09-25, the owner delegated the call to the lead).** A draft must never be built from last year's report alone, or last year's work would be written up as this year's claim. No transition, state or permission is added.
  - **The rule.** A generation needs at least one current-year source: an interview transcript, or a readable file (not archived, with text) outside the Previous-year reports category (`previous_pd`). Files in that category never count on their own: previous-year uploads and notes, PDs ported in, and the original's report brought along by a duplicate as last year's report. Chat uploads and other files with no category count as current. With a transcript, previous-year files are read as before. The Jul-17 files-only rule is otherwise unchanged, and a project with no readable source at all keeps its old message.
  - **Where it is enforced.** `reserveGeneration` checks it in the same transaction that would reserve the generation and schedule its start, so nothing is written and no paid call runs. That covers every way a generation is reserved: `generations.requestGeneration` in Compare, Single and Step by step (a card duplicate and a fresh New project start their draft this way; the plain `?from=` copy starts no draft), `generations.retryGeneration` and `generations.retryFailedCandidates`. It refuses with `INVALID_INPUT`, reason `PREVIOUS_YEAR_ONLY_SOURCES`, and the message "Add a transcript or a current file. Last year's report alone can't be the source for this year's report." (`shared/previousYear.ts`). `generations.retryFromSummary` is not checked: it reruns a signed-off generation on the sources that generation already froze. `createProject` and `copyProjectContent` start no generation and are unchanged.
  - **In the wizard.** In Generate PD, when no transcript and no current file is ticked or added and only previous-year files or last year's report remain, Generate Report is disabled with the same message beside it. This holds for a card duplicate and a fresh New project, and for consistency on a plain `?from=` copy in Generate PD, although that copy starts no draft itself (review P3). With nothing readable at all the older messages stay ("Tick a transcript or file from {source}, or add your own." or "Add a transcript or at least one context document first.").
  - **Review PD is unaffected.** A PD review reads the written PD, not a draft's sources, so `pdReviews.startPdReview` does not check this rule.
  - **Migration and compatibility:** none. No schema change; a project that already has a generation keeps it.
  - **Tests:** `convex/previousYearSourceGuard.test.ts` (refused in each Drafts mode on a fresh project, and with only archived or empty current files; the card duplicate with only last year's report and a previous-year file; `retryGeneration` and `retryFailedCandidates` refused with the partial generation kept; allowed with writer's notes, with an uncategorized chat upload, with a transcript beside previous-year files, and on a duplicate that keeps a current file or its transcript; the Jul-17 message kept; a Review PD project's review starts), `src/routes/project/new/newProjectPreviousYearOnly.component.test.ts` (the disabled button and message on a fresh project, a card duplicate and a plain `?from=` copy, and Generate enabled again once a transcript or a current file is added or ticked).

## Amendment process

A change to vocabulary, an invariant, a transition edge, or a decision above requires:

1. a dated amendment in this document;
2. affected PSOS tickets listed;
3. migration and compatibility impact recorded;
4. authorization/test impact recorded; and
5. approval by the product owner before implementation relies on the change.


### Report chat reliability and confidentiality, September 8, 2026

The approved chat hardening request preserves agents-propose/humans-apply and all existing role rights. Enabled saved writing preferences participate even when no house-style waiver is active, subject to the existing enforced-rule precedence. A profile lookup failure stops the reply rather than silently proceeding without the profile.

A coordinated passage revision is one pending proposal (except a zero-edit revision, see 2026-09-14). Every original target must remain unique and non-overlapping at creation and apply. The ordinary individual replacement stepper cannot apply that proposal. The writer may edit candidate wording in the card, then apply the whole revision after server validation.

Ordinary report chat can initiate a Brain search only when the sender explicitly enables it for that message. This governs new retrieval, not previously visible conversation history or the separate Contextual Research flow. Private model reasoning and raw tool arguments/results do not belong in the browser response. The assistant may explain visible product behavior and report evidence, while declining extraction of private implementation instructions or unrelated information.

See [the scoped workflow pilot](chat-workflow-pilot.md) for verification commands and remaining limits.
