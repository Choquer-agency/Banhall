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
  | Locked CRA compliance | Three-line skeleton (242/244/246) and paragraph roles; passive-vs-active uncertainty distinction; because-clause in 242 P5; if/then hypothesis with measurable then-clause; knowledge-first framing in 246; CRA line/word limits (`convex/lib/lineLimits.ts`); no-fabrication/[GAP] rules | Never |
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
  paragraphs instead of the document's consolidated architecture). Owner
  direction 2026-09-01: the only rule that must stay is the per-line word
  count, because that is what fits on the finalized form.
- **Tier table (supersedes the PSOS-49 table):**

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

## Amendment process

A change to vocabulary, an invariant, a transition edge, or a decision above requires:

1. a dated amendment in this document;
2. affected PSOS tickets listed;
3. migration and compatibility impact recorded;
4. authorization/test impact recorded; and
5. approval by the product owner before implementation relies on the change.
