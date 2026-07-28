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
| **Owner** | The consultant accountable for the project across its lifecycle, even while another person performs a temporary review or action. | Planned `projects.ownerId: Id<"users">`; initially optional during widen/backfill, then required for active projects. Ownership changes create immutable `projectEvents`. | Owner and Current handoff are separate. Ownership transfer never changes `createdBy`. |
| **Work item** | A concrete action requested from a person, with type, assignee, assigner, due date, instructions, blocking status, lifecycle, and completion history. | Planned `workItems` row and immutable `workItemEvents`. | Do not model the work system as one mutable `assignedTo` field. Work items are never hard-deleted during their normal lifecycle. |
| **Current handoff** | The one open blocking work item that answers “who has the next action on this project?” | Planned `projects.currentHandoffId: Id<"workItems">` as a denormalized pointer maintained transactionally; canonical details remain on `workItems`. | At most one open blocking handoff per project. Multiple open non-blocking work items are allowed. “With” in the UI means the current handoff assignee, not the Owner. |
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
| `intake` | `abandoned` | O, M, A | Reason required; cancel open work items. |
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
| Create a project | Yes | Yes | Yes | No |
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

## Amendment process

A change to vocabulary, an invariant, a transition edge, or a decision above requires:

1. a dated amendment in this document;
2. affected PSOS tickets listed;
3. migration and compatibility impact recorded;
4. authorization/test impact recorded; and
5. approval by the product owner before implementation relies on the change.
