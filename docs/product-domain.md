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
| **Generation state** | Technical lifecycle of an AI generation attempt. | Existing `generations.status`; canonical states are `reserved`, `running`, `awaiting_selection`, `awaiting_input`, `completed`, and `failed`. | A generation failure does not itself determine the human workflow stage. Existing stale/retry fencing remains technical generation behavior. |
| **Draft branch** | A persistent, independently editable report alternative, such as a model draft, imported report, manual alternative, or duplicate. | Planned `reportBranches` row pointing to a branch-owned `reports` row; planned `projects.activeBranchId` and `projects.promotedBranchId`. | Branches are not snapshots. Switching branches never changes another branch’s content, revision, chat, comments, research, provenance, or snapshots. |
| **Snapshot** | Immutable version history inside one branch/report. | Existing `reportSnapshots` and report revision semantics, scoped by `reportId`. | A snapshot is not an independently editable alternative. |
| **Suggestion** | A proposed change against one branch/report revision. | Existing proposal records scoped to `reportId` and revision/target lineage. | A suggestion is not a branch and cannot silently change its canonical target. |
| **Outcome** | Human-authored disposition of an exact branch/report revision. | Planned immutable `productionOutcomes` row referencing project, branch, report, and exact snapshot or revision. | Export is evidence, not delivery. Corrections append linked records; they do not overwrite outcome history. |
| **Inbox notification** | A user-directed event informing them that something happened or needs attention. | Planned `notifications` row and optional delivery ledger. | Reading or archiving a notification never completes its work item. |
| **Capability** | A named server-enforced permission to perform an operation. | Planned centralized `roleCapabilities` definitions mapped from stored role presets. | UI visibility is not authorization. Initial presets are fixed; an arbitrary custom permission builder is out of scope. |
| **Client** | The durable company/account for which claim work is performed. | Planned `clients` row; current `projects.clientName` remains compatibility data until migration. | Do not silently merge similar free-text names. |
| **Claim period** | The client/fiscal-period container for financial source material and costing work across one or more projects. | Planned `claimPeriods` and `claimPeriodProjects`. | The financial workspace may have a different landing model, but it remains part of the same application and authorization system. |

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
| `internal_review` | The report is with an internal reviewer or undergoing internal QA. | A review handoff normally exists, but stage and assignment remain separate records. | `revisions`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `client_review` | A client-facing revision is published/shared for client review. | Authorized user deliberately sends/publishes a revision for client review. | `revisions`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `revisions` | Feedback or identified issues require writer changes. | Review completion, client feedback, or an explicit manual transition. | `internal_review`, `client_review`, `ready_for_delivery`, `on_hold`, `abandoned` |
| `ready_for_delivery` | Internal work is complete and the exact deliverable is ready for authorized delivery. | A promoted branch exists and filing/readiness requirements applicable to the workflow are satisfied. | `delivered`, `revisions`, `on_hold`, `abandoned` |
| `delivered` | An exact report revision has been confirmed as delivered to the client or used in filing. | Authorized actor records the corresponding production outcome. | `revisions` for reopened work, or `on_hold` only for exceptional administrative correction |
| `on_hold` | Work is intentionally paused without abandonment. | Authorized actor records a reason. | Any active stage that reflects the resumed work; `abandoned` |
| `abandoned` | The project will not proceed in its current scope. | Authorized actor records a reason and handles open work items. | No normal next stage; reopening requires Manager/Admin authority and an audit note. |

## Transition matrix

The table lists every allowed transition. Every other edge is disallowed. A mutation must still verify the caller’s project access, role capability, expected project version, and transition-specific requirements.

Authority labels:

- **O** — current Owner
- **H** — assignee of the open blocking current handoff
- **M** — Manager
- **A** — Admin
- **D** — delivery authority: Owner, Manager, or Admin, with an exact outcome record

| From | To | Authority | Automation policy and notes |
|---|---|---|---|
| `intake` | `interview_complete` | O, M, A | Manual confirmation only in the initial release. |
| `intake` | `drafting` | O, M, A | Manual shortcut allowed when intake/interview completion is implicit or legacy. |
| `intake` | `on_hold` | O, M, A | Reason required. |
| `intake` | `abandoned` | O, M, A | Reason required; all open work items must be completed, declined, or canceled first. |
| `interview_complete` | `drafting` | O, M, A | May later be suggested after generation starts, but no invisible automatic transition initially. |
| `interview_complete` | `on_hold` | O, M, A | Reason required. |
| `interview_complete` | `abandoned` | O, M, A | Reason required. |
| `drafting` | `internal_review` | O, M, A | “Send for internal review” may atomically create the handoff and offer this transition; user confirms. |
| `drafting` | `client_review` | O, M, A | Requires an explicit client-review publish/share action. |
| `drafting` | `ready_for_delivery` | O, M, A | Requires a promoted branch and applicable readiness checks. |
| `drafting` | `on_hold` | O, M, A | Reason required. |
| `drafting` | `abandoned` | O, M, A | Reason required. |
| `internal_review` | `revisions` | H, O, M, A | Completing review may offer this transition, but user confirms it. |
| `internal_review` | `ready_for_delivery` | H, O, M, A | Reviewer/owner confirms no revision cycle is required; readiness checks apply. |
| `internal_review` | `on_hold` | O, M, A | Reason required. |
| `internal_review` | `abandoned` | O, M, A | Reason required. |
| `client_review` | `revisions` | O, M, A | May be suggested when client feedback arrives; no invisible transition initially. |
| `client_review` | `ready_for_delivery` | O, M, A | Explicit confirmation after client review. |
| `client_review` | `on_hold` | O, M, A | Reason required. |
| `client_review` | `abandoned` | O, M, A | Reason required. |
| `revisions` | `internal_review` | O, M, A | May create/replace the blocking review handoff in the same transaction. |
| `revisions` | `client_review` | O, M, A | Requires explicit publish/share action. |
| `revisions` | `ready_for_delivery` | O, M, A | Readiness checks apply. |
| `revisions` | `on_hold` | O, M, A | Reason required. |
| `revisions` | `abandoned` | O, M, A | Reason required. |
| `ready_for_delivery` | `delivered` | D | Must atomically reference or create `delivered_to_client` or `used_in_filing` for the exact branch/revision. |
| `ready_for_delivery` | `revisions` | O, M, A | Used when readiness review finds additional changes. |
| `ready_for_delivery` | `on_hold` | O, M, A | Reason required. |
| `ready_for_delivery` | `abandoned` | O, M, A | Reason required. |
| `delivered` | `revisions` | O, M, A | Reopens work; audit note required. Existing outcome remains immutable. |
| `delivered` | `on_hold` | M, A | Exceptional administrative correction; audit note required. |
| `on_hold` | `intake` | O, M, A | Resume to the stage that truthfully reflects work. |
| `on_hold` | `interview_complete` | O, M, A | Resume to the stage that truthfully reflects work. |
| `on_hold` | `drafting` | O, M, A | Resume to the stage that truthfully reflects work. |
| `on_hold` | `internal_review` | O, M, A | Resume only when the review handoff remains valid or is recreated. |
| `on_hold` | `client_review` | O, M, A | Resume only when client review is actually active. |
| `on_hold` | `revisions` | O, M, A | Resume to active revision work. |
| `on_hold` | `ready_for_delivery` | O, M, A | Re-run applicable readiness checks. |
| `on_hold` | `abandoned` | O, M, A | Reason required. |
| `abandoned` | `intake` | M, A | Explicit reopen with audit note. |
| `abandoned` | `drafting` | M, A | Explicit reopen with audit note. |

Same-stage transitions are idempotent no-ops and must not create duplicate audit events. Bulk stage changes follow the same matrix and authority checks per project; partial success must be reported explicitly rather than hidden.

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

## Amendment process

A change to vocabulary, an invariant, a transition edge, or a decision above requires:

1. a dated amendment in this document;
2. affected PSOS tickets listed;
3. migration and compatibility impact recorded;
4. authorization/test impact recorded; and
5. approval by the product owner before implementation relies on the change.
