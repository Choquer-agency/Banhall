# PSOS-10 implementation plan — workflow metadata and controls

**Planning model:** Claude Code Opus 5
**Planning verdict:** **PLAN READY**
**Prepared:** 2026-07-28
**Scope:** Planning only; no implementation, deployment, commit, or push in this pass.

## 1. Objective

Make the human workflow legible and safely editable without turning the report workspace or dashboard into a generic CRM:

- show **Stage**, **Owner**, **With**, and **Due** as separately labelled data;
- distinguish immutable Creator history from accountable Owner;
- expose only server-authorized ownership and stage actions;
- preserve the existing dashboard's company → fiscal-year grouping and project cards;
- remain truthful before work items, branches, and production outcomes ship.

## 2. Approved product and implementation decisions

1. **Dashboard cards, not a new table.** The ticket's “project list rows gain Owner + Stage columns” requirement is implemented as labelled Owner and Stage slots in the existing `ProjectCard`. The company → fiscal-year disclosure hierarchy, flat recency card grid, filters, sorting, and bulk selection remain unchanged.
2. **Creator is labelled truthfully.** Existing `projects.writer` display metadata is relabelled **Created by** where it currently appears as “Consultant.” It is not used as Owner.
3. **Prerequisite-gated transitions remain visible but unavailable.** Matrix-valid transitions that PSOS-09 must currently reject are shown disabled with a plain-language reason:
   - `ready_for_delivery` requires a promoted branch;
   - `delivered` requires an exact delivery/filing outcome;
   - `on_hold → internal_review` requires an active review handoff. *(Superseded 2026-08-17: the open-matrix amendment removed the `review_handoff` requirement; `internal_review` is enterable without an active handoff.)*
4. **The server supplies viewer authority.** The client does not independently infer Owner, Manager, Admin, or future handoff-assignee authority. UI filtering is an affordance only; mutations remain authoritative.
5. **With and Due are truthful empties.** Until PSOS-12 introduces work items and `currentHandoffId`, both values are `null` and render as an em dash. They are never inferred from Owner, Creator, legacy writer, interviewer, stage, or status.
6. **OCC version is captured when an action opens.** Transfer/stage dialogs submit the version the user reviewed. A stale response shows conflict recovery copy. Mutation result `noop` produces neutral “No change” feedback, never a success message.
7. **One workflow bar serves every project state.** A focused `ProjectWorkflowBar` is rendered once immediately below `PageBar`, outside the route's report-state branches, so it remains visible during generation, failure, iterative drafting, candidate selection, and report editing.
8. **New-project owner/stage writes remain a follow-up.** Projects created after PSOS-08 may have no stored owner or stage. PSOS-10 displays `Owner —` and effective stage `Intake`; it does not silently expand into `createProject`. A dedicated follow-up must make future project creation write owner/stage before production rollout is considered complete.

No amendment to `docs/product-domain.md` is required: no vocabulary, transition, capability, branch, outcome, notification, or visibility rule changes.

## 3. Current-state risks the implementation must address

### Critical/high

- The dashboard has cards, not list rows. Building a table would pre-empt PSOS-11 and PSOS-38 and remove the approved BNH-36 hierarchy.
- Current “Consultant” UI is derived from historical creator/writer metadata, not `ownerId`.
- Existing project queries expose `ownerId` but no live Owner label, eligible transfer roster, or server-derived viewer authorities.
- Six matrix edges are guaranteed to fail until PSOS-12, PSOS-18/19, or PSOS-22/23 provide their prerequisites.
- Handoff-assignee authority is intentionally inactive until work-item storage exists.
- Component tests require presentational components with props/callbacks; Convex subscriptions must stay in a container.
- The current metadata snippet is absent in several project states, so the workflow bar cannot be placed inside it.

### Medium

- Human-readable stage labels and descriptions do not exist.
- Legacy `Badge` is for `projects.status` and must not represent workflow stage.
- Shared `Button` and `SelectInput` do not guarantee the ticket's 44px mobile targets in all variants.
- `ProjectCard`'s absolute action menu can overlap a denser wrapped footer.
- `listProjects` still performs the broad fetch/N+1 behavior owned by PSOS-11; PSOS-10 must not worsen it with per-card queries.
- Same-state mutation results may be `noop`; feedback must reflect that result.

## 4. Ordered implementation phases

### Phase A — Activate work control

- Change PSOS-10 to `in_progress` only when implementation actually begins.
- Update `docs/todos/psos/README.md` so PSOS-10 is the sole active implementation.
- Preserve all uncommitted PSOS-08/09 and July planning files; do not stage, revert, or mix them into unrelated edits.
- Record the release gate: PSOS-08/09 backend code must exist in the target environment before the PSOS-10 frontend.

### Phase B — Shared workflow presentation data

Add `shared/workflowLabels.ts` containing:

- `WORKFLOW_STAGE_LABELS: Record<WorkflowStage, string>`;
- `WORKFLOW_STAGE_DESCRIPTIONS: Record<WorkflowStage, string>` using the approved domain meanings;
- `TRANSITION_REQUIREMENT_BLOCKERS` for promoted branch, delivery outcome, and review handoff *(review-handoff blocker removed by the 2026-08-17 open-matrix amendment)*;
- shared `MAX_WORKFLOW_NOTE_CHARS = 2_000`;
- `effectiveWorkflowStage(stage)` returning `stage ?? "intake"`;
- a pure stage-option builder that:
  - reads only `WORKFLOW_TRANSITIONS`;
  - returns only matrix-valid next stages;
  - filters by server-returned authorities;
  - marks prerequisite-gated options disabled with a reason;
  - carries `requiresNote`, label, and description.

Add pure due formatting in `src/lib/workflow/due.ts`:

- input: `dueAt: number | null`, explicit `now`;
- output: absolute `en-CA` date, relative text, and overdue boolean;
- `null` remains `null` and displays as `—`.

Do not alter the 41-edge matrix in `shared/workflowTransitions.ts`. *(Historical constraint for this ticket's scope. The matrix later grew to 47 edges with the 2026-08-14 `edits` stage, and the 2026-08-17 product-domain amendment replaced it with a generated open matrix — every stage to every other stage.)*

### Phase C — Backend projections and candidate query

Extend `convex/projectWorkflow.ts` with additive read APIs.

#### `getProjectWorkflowHeader`

Arguments:

```ts
{ projectId: v.id("projects") }
```

Strict result projection:

```ts
{
  workflowStage: WorkflowStage;
  stageIsFallback: boolean;
  workflowUpdatedAt: number | null;
  workflowVersion: number;
  owner: null | {
    userId: Id<"users">;
    label: string;
    initials: string;
  };
  ownerNeedsReview: boolean;
  createdByLabel: string;
  withLabel: null;
  dueAt: null;
  viewerAuthorities: TransitionAuthority[];
}
```

Rules:

- use internal project access and the same authority helper as PSOS-09 mutations;
- resolve Owner only from `ownerId`;
- resolve Creator separately from `createdBy`;
- absent stored stage projects as effective `intake` with `stageIsFallback: true`;
- absent workflow version returns `0`;
- return `withLabel: null` and `dueAt: null` without introducing work-item schema;
- use bounded direct document reads only; no table scan.

#### `listOwnerTransferCandidates`

- load only when the transfer dialog opens;
- require project transfer authority before returning roster data;
- bounded roster read, with a truncation flag;
- return only active non-anonymous users whose stored role is `writer` or `manager`;
- exclude the current owner;
- include `userId`, live label, initials, email, and role;
- sort by label, then stable ID;
- server mutation remains authoritative even if the roster changes after query time.

Move the shared 2,000-character note limit into the new shared module so server and UI cannot drift.

No schema changes are planned for PSOS-10.

### Phase D — Presentational Svelte components

All presentational files accept data and callbacks. They must not import `convex-svelte`, `$app/*`, or generated Convex APIs.

#### `src/lib/components/project/WorkflowMetaSlots.svelte`

- semantic `<dl>` with four primary slots: Stage, Owner, With, Due;
- stage rendered as human text, not the legacy status `Badge`;
- Owner renders initials avatar plus live name;
- With and Due render `—` when absent;
- due displays absolute and relative text, with overdue meaning in text rather than colour only;
- supports loading, query-error, and unavailable data states;
- Creator is presented separately and clearly as **Created by**, never inside Owner.

#### `src/lib/components/project/StageChangeDialog.svelte`

- official accessible dialog primitive already used by the project;
- options are 44px-minimum stacked controls, not the compact shared select;
- each option includes stage name and description;
- prerequisite-gated stages are disabled and show their blocker text;
- required-note transitions reveal a labelled textarea and character counter;
- submit disabled for missing/oversized required notes;
- busy state, plain server error, stale conflict recovery, Escape, focus trap, and focus return.

#### `src/lib/components/project/OwnerTransferDialog.svelte`

- 44px-minimum candidate rows with initials, name, email, and role;
- optional bounded note;
- candidate loading, empty, truncated, busy, mutation-error, and stale conflict states;
- explicit `Transfer ownership` action;
- no current-owner or ineligible-role option.

#### `src/lib/components/project/ProjectWorkflowBar.svelte`

This is the only new project workflow component that owns Convex queries/mutations.

- subscribe to `getProjectWorkflowHeader`;
- query candidates only while the transfer dialog is open;
- call PSOS-09 `transferOwnership` and `setWorkflowStage`;
- capture `workflowVersion` when opening an action;
- derive available stage options from shared logic plus server authorities;
- show actions only when the server projection gives applicable authority;
- render updated values through Convex reactivity after successful writes;
- handle `updated`, `noop`, `STALE_REVISION`, typed prerequisite failures, permission loss, and generic safe errors distinctly.

### Phase E — Project route integration

Modify `src/routes/project/[id]/+page.svelte` minimally:

- import `ProjectWorkflowBar`;
- render it exactly once after `PageBar`, outside report/generation state branches;
- relabel existing “Consultant” metadata to **Created by**;
- do not change editor, generation, export, files, chat, QA, or report-state behavior.

Responsive plan:

- desktop/large tablet: four labelled data slots in one restrained ledger row;
- narrow tablet/mobile: one-column stacked rows with full-width 44px actions;
- if progressive disclosure is used below 768px, Stage and Owner remain visible in the summary and the disclosure exposes all four slots; the right-edge chevron follows design-system disclosure rules;
- no horizontal scroll at 320px or above;
- reduced-motion users receive no authored expand/modal transition.

### Phase F — Dashboard metadata without redesign

Modify `ProjectCard.svelte`:

- add Owner and Stage as compact labelled data slots;
- relabel legacy writer metadata **Created by**;
- do not reuse workflow stage as legacy status `Badge`;
- reserve safe space for the absolute three-dot action menu at all wrap points;
- preserve existing status tint, tags, science code, selection, duplicate/delete actions, and card link.

Modify `src/routes/dashboard/+page.svelte` with one temporary bounded roster projection for Owner labels and pass resolved labels to both `ProjectCard` call sites.

Constraints:

- no per-card query;
- no additional project scan;
- no changes to company/fiscal-year grouping, recency layout, filters, search, sorting, or bulk selection;
- PSOS-11 later replaces the broad project fetch and temporary roster join with indexed paginated row projections.

## 5. Planned file map

### New

- `shared/workflowLabels.ts`
- `src/lib/workflow/due.ts`
- `src/lib/workflow/workflowLabels.test.ts`
- `src/lib/workflow/due.test.ts`
- `src/lib/components/project/WorkflowMetaSlots.svelte`
- `src/lib/components/project/StageChangeDialog.svelte`
- `src/lib/components/project/OwnerTransferDialog.svelte`
- `src/lib/components/project/ProjectWorkflowBar.svelte`
- component tests for each presentational workflow component
- `convex/projectWorkflowHeader.test.ts`

### Modified

- `convex/projectWorkflow.ts`
- `src/routes/project/[id]/+page.svelte`
- `src/lib/components/dashboard/ProjectCard.svelte`
- `src/routes/dashboard/+page.svelte`
- `docs/todos/psos/tasks/PSOS-10.md`
- `docs/todos/psos/README.md`
- generated Convex API types after codegen

### Explicitly outside implementation scope

- schema/work-item/current-handoff changes;
- production outcome or branch storage;
- dashboard pagination and N+1 removal;
- new dashboard rows/tables/lanes;
- filter semantics migration;
- `createProject` owner/stage writes;
- role-capability call-site migration;
- changes to legacy generation/report status semantics;
- existing PSOS-08 ambiguity-review implementation.

## 6. Test plan

### Pure unit tests

- every workflow stage has a label and description;
- effective missing stage is `intake`;
- stage options are a strict subset of matrix edges;
- owner/manager/admin authority filtering matches the returned server authority set;
- Manager/Admin-only reopen edges are absent for Owner-only authority;
- all prerequisite edges have disabled reasons;
- all reason-required edges require a note;
- due formatter covers absent, future, today, overdue, and exact boundary cases.

### Convex tests

- unauthenticated header query returns the established safe result;
- live Owner label updates after a user profile rename without project metadata rewrite;
- Owner is null when `ownerId` is absent, while Creator remains separately labelled;
- missing stage/version project returns `intake`/`0` with fallback marker;
- owner review state is projected truthfully;
- viewer authorities match Owner, Manager, Admin, unrelated Consultant, role-less, and anonymous fixtures;
- candidate query rejects unauthorized actors;
- candidate query excludes Admin, role-less, anonymous, and current Owner;
- candidate query includes only Consultant/Manager and remains bounded;
- successful PSOS-09 mutation causes the header projection to update and writes exactly one event.

### Component tests

- all four workflow labels and graceful em-dash empties;
- Creator value never appears in the Owner slot;
- loading and query-error states;
- due meaning is not colour-only;
- stage dialog renders only supplied matrix options;
- disabled prerequisite options expose visible reasons and cannot submit;
- note-required state, character limit, busy, error, and stale conflict states;
- candidate loading, empty, truncated, selection, busy, and error states;
- keyboard operation, Escape, focus return, dialog labelling;
- every interactive target measures at least 44px.

### Manual installed-Chrome QA

Verify signed-in at 320, 375, 768, 1024, and 1440 widths:

- no horizontal overflow;
- correct desktop and mobile workflow composition;
- workflow bar appears during generation, failure, iterative drafting, candidate selection, and editing;
- grouped dashboard structure is unchanged;
- ProjectCard action menu never overlaps Owner/Stage metadata;
- owner transfer updates header and dashboard reactively and writes one event;
- stage change updates header/card and writes one event;
- note-required transition cannot submit without a note;
- prerequisite-gated transition fires no mutation;
- two-tab stale OCC surfaces safe recovery;
- unauthorized controls are hidden and direct mutation still fails server-side;
- same-state result shows neutral no-change feedback and adds no event;
- owner-less project displays `Owner —` and fallback `Intake` truthfully;
- complete keyboard flow and reduced-motion behavior.

## 7. Rollout and rollback

### Rollout order

1. Keep this ticket at `ready` until implementation starts.
2. Ensure PSOS-08/09 backend code is present in the target deployment.
3. Deploy additive PSOS-10 Convex queries before any dependent frontend.
4. Verify the projection and candidate query against representative development projects.
5. Deploy the frontend.
6. Complete signed-in Chrome QA and audit-event checks.
7. Do not release the PSOS-10 production frontend until the uncommitted PSOS-08/09 backend dependency is committed and deployed to production.

### Rollback

- revert frontend first;
- additive unused backend queries may remain safely or be reverted after the frontend;
- PSOS-10 introduces no schema migration or canonical data rewrite;
- workflow events created through the already-approved PSOS-09 mutations remain legitimate immutable history and are never deleted.

## 8. Acceptance-criteria traceability

| Acceptance criterion | Planned evidence |
|---|---|
| Header shows Stage, Owner, With, Due with graceful empties; Creator is never Owner | Semantic metadata component tests; backend Owner-null/Creator-present fixture; mobile/desktop Chrome screenshots |
| Stage offers only matrix-valid next stages and surfaces rejection | Shared matrix option tests; disabled prerequisite component tests; stale/server-error Chrome checks |
| Transfer writes audit event and updates reactively | Convex mutation/projection test; signed-in Chrome event-count and live-update verification |
| Mobile stacks safely with ≥44px targets | Component geometry assertions; Chrome at 320/375; no horizontal overflow |
| Svelte check and empty/loading/error tests | `npm run check`, component test suite, Convex tests, full build/test evidence |

## 9. Release gate and known limitation

PSOS-10 may be implemented and verified against the configured development backend, but it must not be released to a frontend environment whose Convex deployment lacks PSOS-08/09. The current workspace still contains those dependencies as uncommitted files.

The absence of owner/stage writes in `createProject` remains a deliberate, visible limitation. A follow-up must close it before the workflow model can be considered complete for newly created projects.
