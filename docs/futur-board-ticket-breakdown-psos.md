# Banhall — Professional Services Operating System (PSOS) ticket breakdown

Import-ready ticket set for the Futurlabs ERP board (project **BNH**). The futur-board MCP
exposed to agents is read/status-only (no ticket-creation endpoint), so this file is the
canonical breakdown to import; each entry maps 1:1 to a board ticket. Ticket IDs here are
provisional (`PSOS-nn`); board refs will be assigned at import.

Conventions (matching current BNH board):
- Title prefix carries the phase (`PSOS P3 —`) because the board has no milestone/label field.
- Each ticket's **Phases** list maps to the board's phase checklist.
- The board has no priority field; priority is stated in-body (P0 blocker … P3 backlog).
- No assignees are proposed — board conventions never showed agent-set owners.
- "Standard rails" below apply to every implementation ticket and are incorporated by
  reference to keep tickets right-sized.

## Standard rails (apply to all implementation tickets)

- **Authorization**: every new/changed Convex query/mutation/action authenticates via the
  existing `users` identity mapping and enforces capability checks **server-side** (see
  PSOS-27 helpers once they land; until then follow existing internal-user + creator/admin
  patterns in `convex/projects.ts` / `convex/users.ts`). No client-only gating.
- **Audit**: state-changing operations on ownership, stage, work items, branches, outcomes
  and roles write immutable event rows (actor, timestamp, before→after) rather than
  overwriting history. `projects.createdBy` is never repurposed or mutated.
- **OCC / idempotency**: mutations that race (autosave, completion, promotion, notification
  send) take expected-version/idempotency-key args and are single atomic Convex mutations;
  no read-modify-write across multiple mutations.
- **Convex guidelines**: follow `convex/_generated/ai/guidelines.md` — `withIndex` never
  `.filter`, bounded reads (`.take`/`.paginate` with `paginationOptsValidator`), index
  names include all fields (`by_a_and_b`), no unbounded arrays in documents, child tables
  over embedded lists, batch+reschedule for bulk migrations, args/returns validators on
  every function, new function syntax.
- **Migration**: schema changes use widen → backfill (idempotent, batched, resumable) →
  narrow. Never destroy legacy fields/data in the same release that stops writing them.
- **Frontend**: SvelteKit 2 + Svelte 5 runes only; routes in `src/routes`, components in
  `src/lib/components`; design tokens from `src/routes/layout.css` and rules from
  `docs/design-system.md` (ledger aesthetic: dense ruled lists, DM Sans UI, Geist Mono
  metadata, no ad-hoc hexes, no card-grid sprawl). convex-svelte idioms per
  `docs/svelte-migration.md`.
- **Accessibility/responsive**: no hover-only actions, no icon-only ambiguity, no
  color-only meaning for dates/priority; ≥44px touch targets; keyboard/focus order and
  reduced-motion preserved; mobile gets cards/sheets where dense tables don't fit.
- **States**: explicit loading, empty, and failure states with plain-language copy; never
  expose provider IDs or generation internals to end users.
- **Testing per ticket**: `svelte-check` clean, Convex TS clean, unit/integration tests for
  invariants + permission denial, production build passes, keyboard/responsive spot-check.

---

## PHASE 0 — Product/architecture contract

### PSOS-01 · `PSOS P0 — Domain contract: vocabulary, workflow rules, capability matrix, decision log`
**Priority**: P0 — gates all later phases.
**Problem/user need**: The team lacks a durable, shared definition of Owner vs Creator vs
"With", workflow stages vs AI generation state, work items, branches, and outcomes.
Without it, later phases will encode conflicting semantics.
**Context**: Today `projects.createdBy` doubles as implicit ownership in UI copy; report
candidate selection is destructive; authorization is broadly internal-user. Docs live in
`docs/` (`design-system.md`, `svelte-migration.md`, `the-brain.md`).
**In scope**: New `docs/product-domain.md` (or `docs/psos/` set) covering:
- Canonical vocabulary: Creator (immutable `projects.createdBy`), Owner (`ownerId`,
  audited transfer), Work item, Current handoff (≤1 blocking per project), Workflow stage
  (intake, interview_complete, drafting, internal_review, client_review, revisions,
  ready_for_delivery, delivered, on_hold, abandoned), Generation state (reserved/running/
  awaiting_selection/awaiting_input/completed/failed — technical only), Draft branch,
  Outcome (delivered_to_client, used_in_filing, abandoned_quality, abandoned_scope,
  superseded, test_only).
- Stage transition matrix (allowed edges, who may perform, which are automatable later).
- Capability matrix draft: Consultant / Manager / Admin / Financial × operations.
- Decision log with explicit resolutions (or "deferred + default") for: project
  visibility (default: unchanged all-internal visibility; membership model deferred, see
  PSOS-30), ownership transfer authority (default: owner or manager/admin), delivery
  authority (who may mark delivered), stage automation triggers, financial data
  visibility (Financial + Admin), notification email provider selection, client-name
  normalization strategy, branch retention/archival policy, outcome capture timing
  (post-export prompt, non-blocking).
**Out of scope**: Any code.
**Acceptance criteria**:
- [ ] Doc merged; every vocabulary term above defined with its storage field.
- [ ] Stage transition matrix enumerates every allowed edge + authority.
- [ ] Capability matrix covers all four roles × (own/transfer, stage change, assign,
      complete others' items, promote branch, record outcome, financial read/write,
      role admin).
- [ ] Each of the nine listed decisions has a resolution or an explicit deferred default.
- [ ] AGENTS.md references the doc so agents/devs load it for domain work.
**Dependencies/rollout**: None; blocks PSOS-08+. **Risks/open questions**: The nine
decisions themselves — unresolved ones must be marked deferred, not silently assumed.

---

## PHASE 1 — Reliability/onboarding quick wins

### PSOS-02 · `PSOS P1 — Remove demo auto-login; normalize credentials; @banhall.com guidance`
**Priority**: P1 (security-adjacent).
**Problem**: Demo auto-login still fires in environments where real accounts are expected;
whitespace/case in credentials causes avoidable login failures; onboarding guidance for
`@banhall.com` accounts is inconsistent.
**Context**: Auth in `convex/auth.ts`, `convex/auth.config.ts`, login UI at
`src/routes/login`, signup at `src/routes/signup`, invites in `convex/invites.ts`.
Related board work: BNH-13 (account migration) — coordinate, don't duplicate its
env/key migration items.
**In scope**: Environment-gated removal/disable of auto-login (explicit allowlist env
var, default off); trim + lowercase-email normalization on login/signup/invite-accept
(server-side, plus input hygiene client-side; never normalize passwords beyond trim
decision — document choice); standardized copy telling users to use their
`@banhall.com` account, incl. invite emails and login error states.
**Out of scope**: Role changes (PSOS-27+), new providers.
**UX**: Login shows plain-language errors ("Check your @banhall.com email address"),
no stack traces; demo path invisible in production builds.
**Technical notes**: gate via Convex env var checked server-side, not build flag alone;
normalize in `convex/auth.ts` + `convex/invites.ts` accept path; update `by_email`
lookups to use normalized form; one-off backfill to normalize existing `users.email` /
`invites.email` (batched, idempotent).
**Acceptance criteria**:
- [ ] Given production env, when app loads, then no auto-login occurs and no demo
      credentials ship in the bundle.
- [ ] Given `" User@Banhall.com "` at login/signup/invite, then it matches the stored
      normalized account.
- [ ] Backfill leaves zero mixed-case/whitespace emails; duplicate-after-normalization
      collisions surfaced in a report, not auto-merged.
- [ ] Tests: normalization unit tests; login flow integration; env-gating test.
**Rollout**: Backfill before enabling normalized lookup (widen-migrate-narrow).
**Risks**: normalization collisions between existing accounts → manual resolution list.

### PSOS-03 · `PSOS P1 — Role descriptions & capability explanations in Users & roles`
**Priority**: P2.
**Problem**: Users & roles screen shows role names with no explanation; admins can't
predict what a role change does.
**Context**: Admin UI under `src/routes/admin` (team roster, invites); roles on `users`
table; capability semantics from PSOS-01 matrix (initially descriptive text only,
enforcement lands in Phase 6).
**In scope**: Per-role description + capability summary list rendered beside role
selectors and on invite creation; content sourced from a single shared constants module
so Phase 6 UI reuses it (`src/lib/roles/roleDescriptions.ts`).
**Out of scope**: Enforcement changes; new roles (Financial arrives PSOS-28).
**UX**: Inline expandable "What can a Manager do?" text, not tooltip-only; readable on
mobile; no color-only distinctions.
**Acceptance criteria**:
- [ ] Every assignable role shows description + bullet capabilities in roster + invite UI.
- [ ] Copy matches PSOS-01 matrix language.
- [ ] Screen-reader accessible (expand/collapse buttons labelled).
**Dependencies**: PSOS-01 for copy. **Testing**: component tests + svelte-check.

### PSOS-04 · `PSOS P1 — Mixed-upload processing receipt with per-file statuses`
**Priority**: P1.
**Problem**: When users upload a mixed batch (transcripts, PDFs, .msg, images, corrupt
files), outcomes are opaque; failures surface mid-generation or never. Low-tech users
need one obvious receipt.
**Context**: Uploads via `convex/documents.ts` / `projectDocuments` table (has extraction
metadata), transcripts in `convex/transcripts.ts`; prior art BNH-33 (unsupported-type
warning, done) and BNH-34 (.msg support). This ticket extends those into a full receipt.
**In scope**: After each upload batch, a processing receipt listing every file with one
status: **Ready for AI**, **Reference only**, **Ready — text truncated**, **Skipped —
unsupported type**, **Could not read**, **Upload failed**; per-status plain-language
explanation + suggested action; receipt reachable later from the project files panel
(not toast-only). Persist per-file processing status on `projectDocuments` if missing.
**Out of scope**: New extractors; changing generation behavior.
**UX**: Dense ruled list (ledger style), status as text badge + icon (not color-only);
retry/remove actions inline; batch summary line ("6 files: 4 ready, 1 reference only,
1 failed"). Loading state per file while extraction runs; empty state if no files.
**Technical notes**: widen `projectDocuments` with `processingStatus` +
`processingDetail` if not present; derive statuses in mutation/action that finalizes
extraction; receipt component `src/lib/components/upload/UploadReceipt.svelte`; reuse
whitelist from BNH-33.
**Acceptance criteria**:
- [ ] Given a batch with one unsupported, one unreadable, and two good files, receipt
      shows four rows with correct statuses and actions.
- [ ] Truncated extraction (size limits) shows "Ready — text truncated" with what that
      means for generation quality.
- [ ] Statuses persist and re-render on revisit; no provider/internal error strings leak.
- [ ] Upload failure (network) distinguishable from extraction failure.
- [ ] Tests: status derivation unit tests; component states; keyboard nav across rows.
**Dependencies**: none hard. **Rollout**: backfill `processingStatus` for existing docs
as best-effort (`Ready for AI` when extractedText present, else `Could not read`).

### PSOS-05 · `PSOS P1 — Generation failure & recovery surface in project header`
**Priority**: P1.
**Problem**: When one model in a multi-model generation fails or a generation stalls,
users see confusing partial states and cannot recover without support.
**Context**: `convex/generations.ts` (statuses reserved/running/awaiting_selection/
awaiting_input/completed/failed; existing retry + stale-generation cleanup — reuse,
don't rebuild), `reportCandidates`, project page under `src/routes/project`. Related:
BNH-21 (loading screen), BNH-52 (duplicate-run prevention).
**In scope**: Project-header status chip for active/failed generations; failure panel
listing per-model outcome, retaining completed model results while showing failed ones
with "Retry failed model(s)" and "Continue with completed results" actions; wire to
existing retry mutation; stall detection surfaced via existing stale cleanup.
**Out of scope**: Branch materialization (Phase 4); new generation engine work.
**UX**: One obvious next action; plain-language failure text ("Claude's draft didn't
complete. Two other drafts are ready."); no provider error dumps or model internals
beyond friendly model names; chip is text+shape, not color-only.
**Technical notes**: query by `generations.by_projectId_and_status`; retry must be
idempotent (reuse guards from BNH-52 work); header component in project layout.
**Acceptance criteria**:
- [ ] Given 3-model run with 1 failure, header shows partial-failure state; completed
      candidates remain selectable; retry re-runs only the failed model.
- [ ] Given full failure, user can retry all from header without navigating to logs.
- [ ] Retry is idempotent under double-click (single new generation attempt).
- [ ] Stale (stuck >threshold) generations surface as failed-with-retry, not spinner.
- [ ] Tests: retry idempotency; partial-state query; component states (running/partial/
      failed/recovered).
**Dependencies**: none. **Rollout**: pure additive UI + query.

### PSOS-06 · `PSOS P1 — Verify highlighted-text research entry in uploaded-PD review mode`
**Priority**: P2 (verification/small-fix ticket).
**Problem**: Research-from-highlight is expected to work when reviewing an uploaded PD
(review mode), not only on generated reports; current behavior unverified.
**Context**: Research sessions in `convex/research.ts` (`researchSessions.by_reportId`),
review mode via `convex/pdReviews.ts` and `src/routes/review`; research UI components in
`src/lib/components`.
**In scope**: Test matrix (generated report vs uploaded PD; selection in each pane);
fix entry-point wiring if broken; ensure research session scoping uses the correct
report/document ID in review mode.
**Out of scope**: New research capabilities.
**Acceptance criteria**:
- [ ] Given uploaded-PD review mode, when user highlights text, then research entry
      action appears and opens a session scoped to that document.
- [ ] Session lists correctly under that review context on revisit.
- [ ] Regression test or documented manual test script committed.
**Dependencies**: none. **Risks**: may be pure verification (timebox; close if working).

---

## PHASE 2 — Ownership & workflow foundation

### PSOS-07 · `PSOS P2 — Schema: ownerId, workflowStage, workflowUpdatedAt + audit events + indexes`
**Priority**: P0 for the initiative.
**Problem**: Projects have no durable accountable Owner distinct from Creator, and no
human workflow stage distinct from AI generation state.
**Context**: `convex/schema.ts` `projects` (indexes: by_createdBy, by_status,
by_shareToken, by_industry); `createdBy` is immutable audit identity — MUST NOT be
repurposed. Legacy free-text `writer` field exists on projects/reports metadata.
**In scope** (widen phase only — no behavior change):
- `projects.ownerId: v.optional(v.id("users"))`, `workflowStage: v.optional(v.union(...10
  literals...))`, `workflowUpdatedAt: v.optional(v.number())`.
- New `projectEvents` table (immutable): `projectId`, `type` (`ownership_transferred`,
  `stage_changed`, later reused for handoffs), `actorId`, `at`, `from`, `to`, `note`;
  indexes `by_projectId` and `by_projectId_and_type`.
- Project indexes: `by_ownerId`, `by_ownerId_and_workflowStage`, `by_workflowStage`.
**Out of scope**: Backfill (PSOS-08), transition rules (PSOS-09), UI (PSOS-10).
**Acceptance criteria**:
- [ ] Schema deploys with all fields optional (widen); existing mutations unaffected.
- [ ] Convex TS + existing test suite (`convex/projects.test.ts`) green.
- [ ] `projectEvents` has no update/delete mutations exported.
**Dependencies**: PSOS-01 vocabulary. **Rollout**: deploy before PSOS-08.

### PSOS-08 · `PSOS P2 — Ownership/stage backfill: writer matching, creator fallback, ambiguity queue`
**Priority**: P1.
**Problem**: Existing projects need Owners and stages without destroying legacy data or
guessing wrong silently.
**Context**: Legacy `writer` free-text on projects (BNH-22 added interviewer/writer
fields); `users` table with `by_email`; migration patterns per convex-migration-helper
(batched, idempotent, self-rescheduling mutations).
**In scope**:
- Backfill mutation (batch + `ctx.scheduler.runAfter` continuation): match legacy
  `writer` text → user (exact email, then exact normalized full-name, unique matches
  only) → set `ownerId` + `ownership_transferred` event with `note: "backfill:writer"`;
  else fall back to `createdBy` with `note: "backfill:creator-fallback"`.
- Ambiguous/no-match projects flagged into a review queue (field
  `ownerBackfillStatus: "needs_review"` or dedicated table) with admin UI list to
  resolve manually (simple table under `src/routes/admin`).
- Stage backfill heuristic: delivered-ish signals (exported/published) →
  `delivered`? NO — default conservative: projects with a selected report →
  `drafting`, else `intake`; record heuristic in event note; admins can correct.
- Legacy `writer` field retained untouched (narrow later, separate decision).
**Acceptance criteria**:
- [ ] Backfill idempotent (re-run produces zero new events) and resumable mid-batch.
- [ ] Every project ends with ownerId + workflowStage or `needs_review` flag; counts
      logged/reported.
- [ ] No legacy field deleted or overwritten.
- [ ] Admin review queue lists ambiguous projects with candidate matches and one-click
      assign (writes audited transfer).
- [ ] Tests: matcher unit tests (exact/ambiguous/none), idempotency, batching.
**Dependencies**: PSOS-07. **Rollout**: run in prod off-hours; monitor via counts.
**Risks**: name collisions; wrong-owner assignment is recoverable via audited transfer.

### PSOS-09 · `PSOS P2 — Server-side ownership transfer + stage transition mutations with validation`
**Priority**: P1.
**Problem**: Ownership and stage must only change through validated, authorized, audited
paths.
**Context**: New module `convex/projectWorkflow.ts` (do not grow `convex/projects.ts`);
transition matrix from PSOS-01; capability presets arrive Phase 6 — until then enforce:
transfer by current owner/manager/admin; stage change by owner/assignee-of-open-handoff/
manager/admin (encode in one helper so Phase 6 swaps implementation, not call sites).
**In scope**: `transferOwnership` (args: projectId, toUserId, note?, expectedVersion),
`setWorkflowStage` (args: projectId, toStage, note?, expectedVersion) — both single
atomic mutations writing `projectEvents`, updating `workflowUpdatedAt`; transition
matrix as data (shared const, exported for tests + UI); invalid edges rejected with
typed error codes; on_hold/abandoned reachable from any active stage; delivered requires
delivery-authority per PSOS-01 decision.
**Out of scope**: Automation (stage auto-advance) — record hooks but don't enable.
**Acceptance criteria**:
- [ ] Every allowed edge in the matrix succeeds; every disallowed edge rejected with
      typed error; matrix-driven test covers all N×N pairs.
- [ ] Unauthorized actor gets permission error (test per role).
- [ ] Concurrent transfer with stale expectedVersion fails cleanly (OCC test).
- [ ] Each success writes exactly one immutable event.
**Dependencies**: PSOS-07/08; PSOS-01 matrix. **Rollout**: additive; UI wires in PSOS-10.

### PSOS-10 · `PSOS P2 — Project header & list metadata: Stage, Owner, With, Due as labeled data`
**Priority**: P1.
**Problem**: UI conflates creator with owner and hides who has the next action.
**Context**: Project page under `src/routes/project/[id]`, list under `src/routes/dashboard`
(current all-projects view; BNH-36 company→fiscal-year grouping preserved); header
components in `src/lib/components`.
**In scope**: Header block showing **Stage** (human label), **Owner** (avatar+name),
**With** (assignee of open blocking handoff, or "—" until Phase 3 lands; component reads
optional field so it lights up when PSOS-14 ships), **Due** (from handoff; absolute date
+ relative text, not color-only); owner transfer UI (dialog → PSOS-09 mutation) and
stage change control (only valid next stages offered; server still validates); project
list rows gain Owner + Stage columns.
**Out of scope**: New dashboard lanes (PSOS-11), work-item creation (Phase 3).
**UX**: Four separately labeled data slots, Geist Mono for metadata per design system;
transfer/stage dialogs keyboard-operable; failure state on rejected transition shows
server reason plainly.
**Acceptance criteria**:
- [ ] Header shows all four slots with graceful "—" empties; never shows createdBy as
      "Owner".
- [ ] Stage control offers only matrix-valid next stages; server rejection surfaces.
- [ ] Transfer writes audit event and updates header reactively.
- [ ] Mobile: header collapses to stacked rows, targets ≥44px.
- [ ] svelte-check + component tests for empty/loading/error.
**Dependencies**: PSOS-07/09. **Rollout**: ship behind nothing — additive display.

### PSOS-11 · `PSOS P2 — Indexed, paginated dashboard projection queries (retire broad fetch + N+1)`
**Priority**: P1 (performance foundation for Phase 3 lanes).
**Problem**: Dashboard fetches all projects then filters client-side, with per-project
generation lookups (N+1). New lanes multiply this cost.
**Context**: Current queries in `convex/projects.ts` / `convex/reportViews.ts`;
guidelines mandate `withIndex` + `paginationOptsValidator` + bounded reads. Related:
BNH-49 (sort/filter) — its filters should move onto these queries.
**In scope**: New query module (e.g. `convex/dashboard.ts`) returning row projections
(id, title, client, fiscalYear, ownerId+name, workflowStage, dueAt?, latest generation
status denormalized) via indexes: `by_ownerId_and_workflowStage`, `by_workflowStage`,
plus a denormalized `latestGenerationStatus` field on projects maintained by generation
mutations (eliminates N+1). All lane queries paginated. Existing all-projects
company→fiscal-year view converted to the projection (grouping client-side per page is
acceptable given grouped ordering index or per-company query — document choice).
**Out of scope**: Lane UI (Phase 3), saved views (Phase 8).
**Acceptance criteria**:
- [ ] No dashboard query calls `.collect()` on projects or does per-row `db.get` loops
      for generation status.
- [ ] Each lane query uses a named index and paginates; page size configurable.
- [ ] `latestGenerationStatus` kept consistent by generation lifecycle mutations
      (test: create→run→fail→retry updates projection).
- [ ] Backfill populates `latestGenerationStatus` for existing projects (idempotent).
- [ ] Perf check: dashboard initial load reads ≤ page-size project docs.
**Dependencies**: PSOS-07. **Rollout**: run old + new queries in parallel behind a
switch during verification, then remove old path.

---

## PHASE 3 — Assignments, My Work, Inbox

### PSOS-12 · `PSOS P3 — workItems + workItemEvents schema, invariants, transactional lifecycle`
**Priority**: P0 for phase.
**Problem**: No first-class actionable handoff exists; a single mutable field can't
carry kind/assigner/instructions/history.
**Context**: New module `convex/workItems.ts`; supersedes the data layer implied by
board ticket **BNH-40** (peer review assignment — fold its review-assignment semantics
into work item kind `internal_review`; note supersession on BNH-40 when adopted).
**In scope**:
- `workItems`: projectId, kind (`internal_review`, `revision`, `interview_followup`,
  `delivery_prep`, `financial`, `other`), assigneeId, assignerId, dueAt?, instructions,
  blocking (bool), status (`open`, `completed`, `declined`, `cancelled`), completedAt?,
  completedBy?, resolutionNote?. Indexes: `by_assigneeId_and_status`,
  `by_projectId_and_status`, `by_status_and_dueAt`, `by_assignerId_and_status`.
- `workItemEvents` (immutable): workItemId, projectId, type (created/reassigned/
  completed/declined/cancelled/due_changed), actorId, at, detail. Indexes
  `by_workItemId`, `by_projectId`.
- Mutations: create, reassign, complete, decline (with reason), cancel — each atomic,
  each writing one event; **invariant: at most one open blocking work item per
  project**, enforced in-mutation (query `by_projectId_and_status` for open+blocking
  before insert/reassign-to-blocking; typed error `BLOCKING_EXISTS`).
- Denormalized pointer `projects.currentHandoffId` maintained by these mutations
  (nullable), so header "With" and lanes avoid joins.
- Completion history preserved (items are never deleted; cancel is a status).
**Authorization (pre-Phase-6)**: assignee/assigner/owner/manager/admin may act;
complete restricted to assignee + manager/admin; encode via the PSOS-09 helper.
**Acceptance criteria**:
- [ ] Creating second blocking item on a project fails with typed error; non-blocking
      items unlimited.
- [ ] Complete/decline/cancel are idempotent (second call no-ops or typed error, no
      duplicate events).
- [ ] `currentHandoffId` always matches the open blocking item (property test across
      lifecycle sequences).
- [ ] Permission-denial tests per operation per role.
- [ ] Events immutable: no update/delete path exported.
**Dependencies**: PSOS-07/09. **Rollout**: additive tables; no backfill needed.

### PSOS-13 · `PSOS P3 — Assignment composer + "Send for internal review" shortcut`
**Priority**: P1.
**Problem**: Assigning the next action must be one obvious, fast flow — especially the
dominant case: sending a draft for internal review.
**Context**: UI on project header/page (`src/routes/project/[id]`) and dashboard rows;
roster from `convex/users.ts`; supersedes BNH-40's "Send for Review" card action.
**In scope**: Composer dialog: Assignee (roster picker with search), Work type (kind),
Due date, Instructions (plain textarea), Blocking handoff toggle (default per kind);
"Send for internal review" one-click shortcut: kind=internal_review, blocking=true,
stage nudge → offers `internal_review` stage transition (user confirms; server
validates), due date default (+2 business days, configurable const); reassign and
cancel affordances on existing items.
**Out of scope**: Templates (Phase 8), email (PSOS-17).
**UX**: Shortcut visible on project header when stage ∈ {drafting, revisions};
composer keyboard-first (focus trap, Enter submits, Esc cancels); blocked-invariant
error rendered as guidance ("This project already has a handoff with Sidney — reassign
it instead?") with direct action; ≥44px targets; works as bottom sheet on mobile.
**Acceptance criteria**:
- [ ] Shortcut creates correct defaults in one click + confirm.
- [ ] Composer validates assignee/kind presence; due date optional but encouraged.
- [ ] BLOCKING_EXISTS error offers reassign path in-dialog.
- [ ] Stage-change offer only when transition valid; declining offer still creates item.
- [ ] Component tests: defaults, error path, keyboard flow.
**Dependencies**: PSOS-12; PSOS-09 for stage nudge. **Rollout**: additive.

### PSOS-14 · `PSOS P3 — My Work dashboard: lanes, dense ledger rows, mobile cards`
**Priority**: P0 for phase — this is the new default landing.
**Problem**: Default dashboard is an all-project gallery; consultants need a personal
queue answering "what do I do next?".
**Context**: `src/routes/dashboard`; queries from PSOS-11 + workItems indexes; design
system dense ruled lists; BNH-36/49 all-projects grouping/filtering preserved as its
own view.
**In scope**: Default view **My work** with lanes as tabs/sections: **Assigned to me**
(open work items by dueAt), **Owned by me** (projects by stage), **Reviews** (open
internal_review items assigned to me), **Due soon** (next 7 days, mine), **Waiting on
others** (items I assigned or on projects I own, open, assignee ≠ me), **All projects**
(existing company→fiscal-year hierarchy, kept for lookup/admin/bulk edit). Each lane:
paginated dense rows — project, client, stage, kind, due (absolute + relative text),
assigner/assignee; row click → project; inline complete/reassign on my items.
Explicit overdue text ("Overdue 3 days"), never color alone.
**Out of scope**: Team pipeline (PSOS-15), saved views (Phase 8), notifications UI
(PSOS-16).
**UX/a11y**: Table semantics with proper headers; mobile switches to stacked cards with
same data order; empty states per lane with one suggested action ("No handoffs — check
Owned by me"); loading skeletons; reduced motion respected.
**Acceptance criteria**:
- [ ] `/dashboard` defaults to My work; All projects one tap away and unchanged in
      capability.
- [ ] Each lane paginates via indexed queries only (no client-side global filtering).
- [ ] Overdue/due-today/due-soon rendered as text labels + non-color affordance.
- [ ] Inline complete updates lane + project `currentHandoffId` reactively.
- [ ] Keyboard: tab through rows/actions; mobile targets ≥44px; svelte-check clean.
- [ ] Empty/loading/error states per lane.
**Dependencies**: PSOS-11, PSOS-12. **Rollout**: feature-flag default-view switch;
revert path = flag flip.

### PSOS-15 · `PSOS P3 — Team pipeline view for managers/admins`
**Priority**: P2.
**Problem**: Managers can't see load and stuck projects across the team.
**Context**: Manager/admin-only lane on dashboard; role check server-side in query.
**In scope**: Pipeline table grouped by owner: per-owner counts by stage, open blocking
handoffs with age, overdue items; drill-in to a person's queue (read-only reuse of My
work lanes parameterized by user); paginated indexed queries (`by_ownerId_and_
workflowStage`, `by_assigneeId_and_status`).
**Out of scope**: Capacity planning (Phase 8).
**Acceptance criteria**:
- [ ] Consultant role gets permission error on pipeline queries (server-enforced).
- [ ] Counts match lane contents (test fixture with known distribution).
- [ ] Stuck indicator: blocking handoff open > N days shows age text.
- [ ] Paginated; no `.collect()` over all projects.
**Dependencies**: PSOS-12/14; role gate hardened later by PSOS-27 (helper indirection
now). **Rollout**: additive tab visible only to manager/admin.

### PSOS-16 · `PSOS P3 — In-app notifications & Inbox (unread/read/archive, dedup)`
**Priority**: P1.
**Problem**: Events (assigned, reassigned, completed, stage changed, generation failed)
reach no one; BNH-40 asked for scoped in-app notifications — this generalizes it.
**Context**: New `convex/notifications.ts`; Inbox surface on dashboard
(`src/routes/dashboard` inbox pane or `/dashboard/inbox`).
**In scope**: `notifications` table: userId, type, projectId?, workItemId?, actorId,
at, readAt?, archivedAt?, dedupeKey; indexes `by_userId_and_readAt`,
`by_userId_and_archivedAt`, `by_dedupeKey`. Emission from workItem/stage/ownership/
generation-failure mutations (in-transaction insert). Dedup: same dedupeKey within
window updates existing row instead of inserting. Inbox UI: stream of events, unread
badge count (denormalized counter per guidelines — no `.collect().length`), mark
read/unread, archive; **reading never completes the work item** (explicit rule; action
buttons deep-link to the item instead).
**Out of scope**: Email (PSOS-17), preferences beyond mute-nothing default.
**UX**: Ledger stream, newest first, plain sentences ("Bryce assigned you an internal
review on Acme 2025 — due Fri"); actor+action+object+due; no self-notifications;
keyboard operable; empty state "You're caught up."
**Acceptance criteria**:
- [ ] Every lifecycle mutation above emits exactly one notification to the right
      recipients (assignee on create/reassign; assigner on complete/decline; owner on
      stage change by others; no notification to the actor).
- [ ] Duplicate emission with same dedupeKey doesn't create a second row (test).
- [ ] Unread counter accurate under concurrent reads/marks (counter test).
- [ ] Reading/archiving never mutates work items.
- [ ] Paginated inbox; badge in nav.
**Dependencies**: PSOS-12; PSOS-09 events. **Rollout**: additive; backfill none.

### PSOS-17 · `PSOS P3 — Email notifications: preferences, delivery ledger, idempotent retries` *(conditional on provider decision)*
**Priority**: P2; blocked by PSOS-01 provider decision.
**Problem**: Off-app users miss handoffs; email must be restrained (no 700-notification
firehose) and observable.
**Context**: New `convex/notificationDelivery.ts`; send via Convex action + scheduler;
provider per PSOS-01 (e.g. Resend/Cloudflare Email — decision, not assumption); invites
already send email (`convex/invites.ts`) — reuse plumbing where possible.
**In scope**: Per-user preferences (immediate for blocking handoffs, off/daily for the
rest; default conservative: only blocking-handoff assignment + overdue reminder);
`notificationDeliveries` ledger: notificationId, channel, status (queued/sent/failed),
attempts, idempotencyKey, providerMessageId?, lastError?; indexes by notificationId +
by_status; retry with backoff via scheduler, idempotency key prevents double-send;
reminder scheduling (due-soon/overdue digests via cron in `convex/crons.ts`);
cleanup cron archiving old delivered rows; minimal observability query (failed sends
last 7 days) for admin.
**Out of scope**: Slack, rich digests (Phase 8).
**Acceptance criteria**:
- [ ] Given provider 500 then success, exactly one email delivered (ledger shows 2
      attempts, 1 sent) — idempotency test with mocked provider.
- [ ] Preferences honored; default sends only the conservative set.
- [ ] Overdue reminder fires once per item per day max (dedupe test).
- [ ] No secrets in logs/tickets; provider key via Convex env.
- [ ] Cleanup cron bounded batches.
**Dependencies**: PSOS-16, PSOS-01 decision. **Rollout**: enable per-user opt-in first,
then default-on for blocking assignments. **Risks**: provider unchosen → ticket stays
blocked, not assumed.

---

## PHASE 4 — Persistent draft branches

### PSOS-18 · `PSOS P4 — reportBranches schema + backfill of existing reports/candidates`
**Priority**: P0 for phase.
**Problem**: Candidate selection is destructive: unselected model drafts are deleted.
Alternatives must become durable, independently editable branches.
**Context**: `convex/reports.ts`, `reportCandidates` (by_generationId, by_projectId),
`reportSnapshots`, `modelSelections`, `candidateScores`; new module
`convex/reportBranches.ts`. Related board work to preserve: BNH-48 (per-option
scoring), BNH-47 (QA panel), BNH-56 (named snapshots), BNH-19 (diff view).
**In scope** (widen + backfill; behavior change lands PSOS-19):
- `reportBranches`: projectId, reportId (the editable doc per branch — reuse `reports`
  rows as branch content or add branch-scoped report rows; decide with existing report
  editor coupling, document choice in ticket), name, sourceModel?, sourceGenerationId?,
  status (`active_candidate`, `working`, `archived`, `promoted`), createdBy, createdAt,
  archivedAt?. Indexes: `by_projectId_and_status`, `by_reportId`,
  `by_sourceGenerationId`.
- `projects.activeBranchId` + `projects.promotedBranchId` (optional, widen).
- Backfill: each existing selected report → one `promoted`/`working` branch; surviving
  candidates (if any) → `active_candidate` branches; snapshots remain attached to their
  report (per-branch history preserved automatically since snapshots key on reportId).
- Immutable branch events (reuse `projectEvents` with branch types: created, renamed,
  archived, promoted, made_active).
**Acceptance criteria**:
- [ ] Backfill idempotent + batched; every project with a report has ≥1 branch and
      `activeBranchId` set; counts reported.
- [ ] No candidate/report/snapshot rows deleted by this ticket.
- [ ] Schema green; existing editor unaffected (fields optional).
**Dependencies**: PSOS-07 (events table). **Rollout**: deploy + backfill before PSOS-19.

### PSOS-19 · `PSOS P4 — Non-destructive candidate materialization + explicit branch promotion`
**Priority**: P0 for phase.
**Problem**: Selecting a model draft currently deletes the others and conflates
"chosen to edit" with "final".
**Context**: Selection flow in `convex/generations.ts` / `convex/reports.ts` +
option-selection screen (`src/routes/project/...` selection step; BNH-48 scoring UI
lives here). `modelSelections`/`candidateScores` provenance must survive.
**In scope**:
- On generation completion: materialize each viable candidate as a persistent
  `active_candidate` branch (stop deleting alternatives).
- Replace destructive "select" with **Make active** (choose working branch; others
  remain) and **Promote** (mark branch as the deliverable line; single promoted branch
  pointer, atomic swap with event; previous promoted branch auto-status `working`,
  never deleted).
- Preserve report-scoped chat threads, research sessions, comments, snapshots,
  provenance (`sourceModel`, `sourceGenerationId`), and revision semantics per branch —
  all existing `by_reportId` scoping keeps working because each branch owns a reportId.
- Migration/compat: old flow's API removed only after new flow verified (parallel
  period behind flag).
**Acceptance criteria**:
- [ ] Given 3 completed candidates, selection screen produces 3 persistent branches;
      zero deletions (db assertion in test).
- [ ] Promote is atomic: pointer + statuses + event in one mutation; concurrent double
      promote → one winner via OCC (expectedVersion).
- [ ] Chat/comments/research/snapshots on branch A never appear on branch B (isolation
      test).
- [ ] Scores (`candidateScores`) and `modelSelections` remain queryable per branch.
- [ ] Old destructive path removed at cleanup; flag documented.
**Dependencies**: PSOS-18. **Rollout**: flag `persistentBranches`; verify on staging
projects, run parallel one release, then remove legacy. **Risks**: storage growth →
retention policy per PSOS-01 (archived branches).

### PSOS-20 · `PSOS P4 — Branch tabs UI: switch, rename, duplicate, archive, make active, generate-another-model`
**Priority**: P1.
**Problem**: Users need visible, safe navigation between alternative drafts.
**Context**: Report editor route (`src/routes/project/[id]` report view); design system
tabs — dense text tabs, not cards; BNH-53 full-screen editor must coexist.
**In scope**: Tab strip listing branches (name, source model, status badge, updated);
actions per branch: rename, duplicate (new branch copying current content + fresh
snapshot lineage note), archive (hidden by default, "Show archived" reveal), make
active, promote (with confirm stating meaning); "Generate another model" entry creating
a new candidate branch via existing generation flow; active-branch indicator; promoted
badge.
**Critical safety**: switching active branch must not cross-contaminate autosave:
editor binds to branch's reportId explicitly; autosave mutation takes reportId +
expectedRevision (OCC) — a stale autosave from branch A after switching to B must
fail/no-op, never write into B (this is the corruption class to kill).
**Out of scope**: Comparison view (PSOS-21).
**UX/a11y**: Tabs keyboard-navigable (arrow keys, roving tabindex); actions in an
overflow menu with text labels; confirm dialogs for archive/promote; mobile: tabs
become a select/sheet; loading state while switching; unsaved-changes guard.
**Acceptance criteria**:
- [ ] Rapid switch during pending autosave: content lands only in originating branch
      (automated test with delayed mutation).
- [ ] Rename/duplicate/archive/make-active each write one audit event and update UI
      reactively.
- [ ] Duplicate copies content + starts new snapshot history with provenance note.
- [ ] Generate-another-model creates branch tied to new generation; failure surfaces
      via PSOS-05 patterns.
- [ ] Archived branches hidden by default, recoverable, never deleted.
- [ ] Keyboard + mobile + reduced-motion verified.
**Dependencies**: PSOS-18/19. **Rollout**: behind same flag as PSOS-19.

### PSOS-21 · `PSOS P4 — Branch comparison flow`
**Priority**: P2 (explicitly after basic switching/promotion).
**Problem**: Choosing between branches requires reading them side-by-side with
differences visible.
**Context**: Reuse track-changes diff machinery from **BNH-19** (in progress) rather
than a second diff engine; editor route.
**In scope**: Compare picker (any two branches), side-by-side or unified diff of
current content, per-section navigation, jump-to-difference; entry points from tab
strip and selection screen; promote directly from comparison.
**Out of scope**: Merge assistance (Phase 8 backlog).
**Acceptance criteria**:
- [ ] Any two non-archived branches comparable; diff renders within acceptable time on
      full-length PD (perf note in ticket).
- [ ] Diff read-only; promote from comparison uses PSOS-19 mutation.
- [ ] Accessible: differences conveyed with markers + text, not color alone.
**Dependencies**: PSOS-20; BNH-19 (coordinate — if BNH-19 ships first, extend it).

---

## PHASE 5 — Production outcomes & learning

### PSOS-22 · `PSOS P5 — productionOutcomes schema + record/correct mutations`
**Priority**: P1.
**Problem**: Nothing records what actually happened to a draft; export is treated as
delivery, which is wrong.
**Context**: New `convex/productionOutcomes.ts`; export flow (BNH-46 .docx export)
provides the evidence hook; branches from Phase 4 give the exact artifact.
**In scope**: `productionOutcomes` table: projectId, branchId, reportId,
snapshotId/revision (exact revision), outcome (`delivered_to_client`, `used_in_filing`,
`abandoned_quality`, `abandoned_scope`, `superseded`, `test_only`), reasonCode?,
reasonNote?, actorId, at, supersededBy? (correction chain), correctedAt?. Indexes
`by_projectId`, `by_branchId`, `by_outcome`. Outcomes are **immutable**; corrections
append a new row linking the old via `supersededBy` (no update/delete). Recording
mutation validates actor authority (delivery authority per PSOS-01) and that
branch/revision exist. Non-use reason codes structured (quality: hallucination,
tone, structure; scope: descoped, client-cancelled; etc. — enumerate from PSOS-01).
**Acceptance criteria**:
- [ ] Outcome rows immutable; correction chain preserves both rows and orders by time.
- [ ] Recording ties to exact branch + revision (test: later edits don't change what
      the outcome references).
- [ ] Unauthorized actor rejected for delivery outcomes.
- [ ] Multiple outcomes per project allowed where sensible (test_only then
      delivered_to_client on different branches) but contradictions on same branch
      require correction flow.
**Dependencies**: PSOS-18/19 (branch identity), PSOS-01 (authority + reason codes).

### PSOS-23 · `PSOS P5 — Outcome capture UX (post-export/promotion/delivery), non-blocking`
**Priority**: P1.
**Problem**: Outcomes must be captured at natural moments without adding friction —
export can never be blocked on paperwork.
**Context**: Export flow UI (BNH-46/55 export + validation), branch archive action
(PSOS-20), stage transition to `delivered` (PSOS-09/10).
**In scope**: Post-export non-blocking prompt ("Did this go to the client?" — Later /
Delivered / Just testing); promotion and archive prompts (archive asks structured
non-use reason); stage→delivered requires/creates a `delivered_to_client` outcome
(this is the one enforced link); project page Outcomes panel (ledger list of outcome
rows with actor/time/revision); "Export is evidence, not delivery" reflected in copy.
**Out of scope**: Analytics (PSOS-24).
**UX**: Prompt is a dismissible sheet, one question, plain options; Later leaves a
gentle nudge chip on project header, no nagging modal loops; reasons are select +
optional note; a11y per rails.
**Acceptance criteria**:
- [ ] Export completes fully even when prompt dismissed (never blocks).
- [ ] Marking stage delivered without outcome auto-opens capture and won't finalize
      until outcome recorded (Given/When/Then test).
- [ ] Archive with reason writes `abandoned_*` outcome referencing that branch.
- [ ] Outcomes panel shows chain incl. corrections.
**Dependencies**: PSOS-22, PSOS-09, PSOS-20.

### PSOS-24 · `PSOS P5 — Production analytics: funnel + per-model delivery/abandonment`
**Priority**: P2.
**Problem**: No visibility into generated→opened→edited→promoted→exported→delivered
funnel or which models produce delivered work.
**Context**: Sources: `generations`, `reportViews` (opens), snapshots/revisions
(edits), branch events (promotions), export events (BNH-46; add export event row if
missing), `productionOutcomes`; cost data via `aiUsage` (BNH-16 in progress — reuse its
aggregation, don't fork). Admin/manager surface under `src/routes/admin` or dashboard
analytics tab.
**In scope**: Funnel counts by period; per-model: delivery rate, abandonment by reason,
edit distance proxy (snapshot delta size or count), time-to-deliver, cost per delivered
PD where `aiUsage` allows; queries pre-aggregated via scheduled rollup table (no
dashboard-time full scans); role-gated (manager/admin).
**Out of scope**: Auto-selection changes (BNH-15 owns that), learning ingestion
(PSOS-25).
**Acceptance criteria**:
- [ ] Rollup cron maintains aggregates in bounded batches; dashboards read only
      aggregates.
- [ ] Per-model table shows delivery %, abandonment reasons breakdown, median
      time-to-deliver.
- [ ] Charts follow dataviz/design rails, values as text on hoverless devices.
- [ ] Consultant role denied (server-side).
**Dependencies**: PSOS-22/23; coordinate BNH-16. **Risks**: edit-distance fidelity —
mark proxy explicitly in UI.

### PSOS-25 · `PSOS P5 — Outcomes as governed learning signals (no auto-ingest)`
**Priority**: P2.
**Problem**: Outcome data should inform The Brain and model guidance, but abandoned or
delivered content must never bypass Brain review/provenance (guardrail).
**Context**: `convex/brain.ts`, `convex/learning.ts`, Brain queue governance (BNH-42
admin approval + revert log; BNH-3 reject→learn loop).
**In scope**: Emit outcome *signals* (references + metadata: model, reason codes,
scores) into the existing learning/review queue as candidate items requiring human
approval; explicit denylist: raw report content of abandoned branches never
auto-attached; provenance recorded on any approved item; documentation of signal
schema.
**Acceptance criteria**:
- [ ] Recording an outcome creates at most one queue signal (deduped); approving it is
      the only path to any Brain change.
- [ ] No code path writes report content into Brain storage without the BNH-42 approval
      flow (test asserting queue-only writes).
- [ ] Revert log covers signal-derived changes.
**Dependencies**: PSOS-22; BNH-42 (if unshipped, this ticket blocks on it — set
blocked flag).

---

## PHASE 6 — Roles & capability hardening

### PSOS-26 · `PSOS P6 — roleCapabilities module: presets + server helpers`
**Priority**: P1.
**Problem**: Authorization is scattered creator/admin checks; capabilities must be
centralized and declarative before hardening every function.
**Context**: New `convex/roleCapabilities.ts`; roles on `users`; capability matrix from
PSOS-01; the temporary helper from PSOS-09/12 gets replaced here (call sites unchanged).
**In scope**: Capability enum (e.g. `project.transferOwnership`, `project.setStage`,
`workItem.completeOthers`, `branch.promote`, `outcome.recordDelivery`,
`financial.read`, `financial.write`, `roles.manage`, `pipeline.view` …); presets
Consultant/Manager/Admin/Financial as data; helpers `requireCapability(ctx, cap,
scope?)` and `hasCapability` for UI hints; typed permission errors; export matrix for
tests + UI (PSOS-29).
**Explicit guardrail**: capability rollout must NOT change project visibility —
visibility remains as-is pending PSOS-30 decision.
**Acceptance criteria**:
- [ ] Single source of truth: presets defined once, imported by all call sites.
- [ ] Helper resolves role→capability in O(1) (no db scans per check beyond user row).
- [ ] Matrix test: table-driven role×capability expectations, all four roles.
- [ ] No custom-permission builder shipped (non-goal).
**Dependencies**: PSOS-01. **Rollout**: land helpers, then migrate call sites (PSOS-27).

### PSOS-27 · `PSOS P6 — Authorization audit & migration of all Convex functions + matrix tests`
**Priority**: P0 for phase.
**Problem**: Every relevant query/mutation/action must enforce capabilities
server-side; today enforcement is inconsistent.
**Context**: Audit surface: `projects.ts`, `reports.ts`, `generations.ts`,
`workItems.ts`, `projectWorkflow.ts`, `reportBranches.ts`, `productionOutcomes.ts`,
`notifications.ts`, `financial.ts`, `users.ts`, `invites.ts`, `brain.ts`,
`learning.ts`, `chat*/research*/comments/reviews/snapshots` modules, `http.ts` routes.
**In scope**: Inventory spreadsheet/table of every exported function → required
capability; migrate each to `requireCapability`; preserve current behavior for
internal-user reads (visibility unchanged); tighten known gaps (e.g. role management,
delivery, financial writes); share-token paths (`by_shareToken`, commenters) reviewed
explicitly and documented; authorization matrix integration tests: for each function ×
role, expected allow/deny (generated from the PSOS-26 matrix export where feasible).
**Acceptance criteria**:
- [ ] 100% of exported functions listed in the inventory with a decision (capability /
      public / share-token / internal).
- [ ] Matrix tests cover all state-changing functions × 4 roles; suite green.
- [ ] No visibility regressions: consultant still sees the same project set as before
      (regression test).
- [ ] Share-token surface documented with threat notes.
**Dependencies**: PSOS-26. **Rollout**: migrate module-by-module behind green tests;
deploy in ≥2 releases to bisect regressions. **Risks**: silent behavior drift → the
regression tests above are the gate.

### PSOS-28 · `PSOS P6 — Financial role + role-aware landing/navigation`
**Priority**: P2.
**Problem**: Financial staff need financial surfaces without full consultant tooling;
nav shouldn't duplicate the app per role.
**Context**: Roles UI `src/routes/admin`; nav in root layout; financial route currently
`/project/[id]/financial`; Phase 7 will add client/claim-period workspace — this ticket
only prepares role + landing.
**In scope**: Add `financial` role value (widen users.role union); capability preset
(financial.read/write, limited project read, no generation/branch actions); role-aware
landing: financial users land on financial workspace (Phase 7 landing once built;
until then, a financial index listing projects with financial data); nav shows/hides
sections by capability via `hasCapability` hints (server still enforces); invite flow
supports the role (reuses BNH-50 concepts — note relation, BNH-50's multi-tenant scope
is broader and stays its own ticket).
**Acceptance criteria**:
- [ ] Financial user: sees financial nav + landing; denied consultant-only mutations
      (server tests).
- [ ] Consultant/Manager unaffected; Admin retains all.
- [ ] No duplicated app shell — same layout, capability-filtered nav.
- [ ] Role assignable in Users & roles with PSOS-03 description.
**Dependencies**: PSOS-26/27. **Rollout**: additive role; assign to pilot user first.

### PSOS-29 · `PSOS P6 — Role/capability matrix UI`
**Priority**: P3.
**Problem**: Admins need to see exactly what each role can do, from the same source of
truth as enforcement.
**Context**: `src/routes/admin` (Users & roles); matrix export from PSOS-26; copy from
PSOS-03.
**In scope**: Read-only matrix table (capabilities × roles, ✓/— rendered with text
labels for a11y), grouped by domain (Projects, Work items, Branches, Outcomes,
Financial, Administration); linked from role descriptions.
**Acceptance criteria**:
- [ ] Matrix renders from PSOS-26 data export — no hand-maintained duplicate.
- [ ] Accessible table semantics; printable; mobile horizontal-scroll with sticky
      first column.
**Dependencies**: PSOS-26.

### PSOS-30 · `PSOS P6 — Decision ticket: membership-based project visibility (deferred)`
**Priority**: P3 — decision/architecture only; no implementation.
**Problem**: Capability hardening intentionally leaves visibility broad. Whether to
restrict projects to members/teams is a product decision with migration and UX cost.
**In scope**: Written proposal: membership model options (per-project members vs
client-team scoping), migration plan sketch, impact on share tokens, dashboards,
financial workspace, and search; explicit go/no-go recommendation for leadership.
**Acceptance criteria**:
- [ ] Doc with options, costs, risks, recommendation; decision recorded in PSOS-01
      decision log.
- [ ] No code.
**Dependencies**: PSOS-27 complete (know the enforced baseline). Guardrail: nothing in
Phases 2–7 may silently change visibility ahead of this decision.

---

## PHASE 7 — Client/claim-period financial workspace

### PSOS-31 · `PSOS P7 — clients + claimPeriods schema and normalization migration`
**Priority**: P1 for phase.
**Problem**: Clients exist only as free-text names and fiscal years scattered on
projects; financial work is client+claim-period shaped, not project shaped.
**Context**: `projects` company/fiscal-year fields (BNH-36 grouping relies on them);
new module `convex/claimPeriods.ts`; normalization strategy per PSOS-01 decision.
**In scope**: `clients` table (name, normalizedName, createdBy, createdAt; index
`by_normalizedName`); `claimPeriods` (clientId, fiscalYearLabel, startDate?, endDate?,
status; index `by_clientId_and_fiscalYearLabel`); migration: derive distinct
normalized client names + fiscal years from projects (batched scan), create
clients/claimPeriods, write `projects.clientId` + `projects.claimPeriodId` (widen,
optional); ambiguity queue for near-duplicate names ("Acme Inc" vs "Acme Inc.") with
admin merge UI (merge re-points projects, audited); free-text fields retained
(narrow later).
**Acceptance criteria**:
- [ ] Idempotent, resumable backfill; every project linked or queued for review.
- [ ] Merge operation re-points all references atomically-per-batch and writes audit
      events; no orphan claimPeriods.
- [ ] BNH-36 grouping keeps working during transition (reads legacy fields until
      cutover flag).
- [ ] Tests: normalizer, merge, idempotency.
**Dependencies**: PSOS-01 normalization decision. **Rollout**: widen-migrate-narrow;
cutover flag for reads. **Risks**: bad merges → merges reversible via audit trail
(unmerge tool or manual re-point documented).

### PSOS-32 · `PSOS P7 — Lift financial data to client+claim-period scope (claimPeriodProjects, sources, entries, reviews)`
**Priority**: P1 for phase.
**Problem**: Financial uploads/timesheets/summaries hang off single projects
(`financialUploads`, `timesheetEntries`, `financialSummaries` all `by_projectId`), but
real claims span many PDs in one client fiscal year.
**Context**: `convex/financial.ts`; existing route `/project/[id]/financial` must keep
working during transition.
**In scope**: `claimPeriodProjects` join (claimPeriodId, projectId; indexes both
directions); widen financial tables with optional `claimPeriodId` (+ indexes
`by_claimPeriodId`); backfill: existing rows get claimPeriodId via their project's
link; new APIs are claim-period-scoped with project links preserved (allocation
records reference projectId); review/approval rows likewise lifted; compat layer:
project-financial route reads claim-period data filtered to that project.
**Acceptance criteria**:
- [ ] Existing `/project/[id]/financial` shows identical data before/after backfill
      (snapshot regression test on fixtures).
- [ ] New claim-period queries paginated + indexed; no cross-client leakage
      (authorization: financial.read).
- [ ] Backfill idempotent; rows without resolvable claim period queued, not guessed.
**Dependencies**: PSOS-31; PSOS-26 capabilities. **Rollout**: dual-read period, then
route new writes to claim-period scope.

### PSOS-33 · `PSOS P7 — Financial landing: claim periods with counts, hours, reviews, costing status`
**Priority**: P2.
**Problem**: Financial users need a workspace listing claim periods, not a per-project
scavenger hunt.
**Context**: New route `src/routes/financial` (role-aware landing from PSOS-28 points
here); queries from PSOS-32.
**In scope**: Dense ledger table of claim periods: client, fiscal year, project count,
extracted hours total, pending personnel/hour reviews count, costing status
(not_started/in_progress/complete), last activity; filters by client/status;
pagination; drill into claim-period detail (PSOS-34); denormalized rollup fields on
claimPeriods maintained by financial mutations (avoid dashboard-time aggregation).
**Acceptance criteria**:
- [ ] Landing paginates via indexes; rollups consistent after upload/review mutations
      (test).
- [ ] Financial + Admin see it; Consultant denied (server).
- [ ] Empty/loading/error states; mobile cards; a11y rails.
**Dependencies**: PSOS-28/31/32.

### PSOS-34 · `PSOS P7 — Claim-period workspace: source uploads, personnel/hour review, allocation, costing outputs`
**Priority**: P2.
**Problem**: The actual financial workflow — upload payroll/timesheet sources, review
personnel and hours, allocate to PDs, produce costing outputs tied to technical
reports — has no claim-period home.
**Context**: Claim-period detail route `src/routes/financial/[claimPeriodId]`; existing
extraction in `convex/financial.ts` (uploads, timesheet parsing) reused at new scope;
technical report links via `claimPeriodProjects` → projects → promoted branch/outcome
(Phases 4–5 give the deliverable identity).
**In scope**: Source uploads at claim-period level (receipt UX per PSOS-04 pattern);
personnel list with extracted hours, review/approve per person (reviewer, timestamp,
audit); allocation UI: distribute person-hours across the period's PDs (percent or
hours; validation sums ≤ total; draft vs approved allocation states); costing outputs
summary per PD + period (feeding claim docs); links to each PD's technical report
(promoted branch); export of costing summary (CSV first).
**Out of scope**: Tax-form generation; external accounting integrations.
**UX**: Ledger tables, inline validation with explicit messages, autosave with OCC on
allocation rows, keyboard-friendly numeric entry; failure states for unreadable
sources reuse PSOS-04 statuses.
**Acceptance criteria**:
- [ ] Upload→extract→review→allocate→costing flow completable end-to-end on fixture
      data.
- [ ] Allocation validation: over-allocation blocked with plain message; totals
      recompute reactively.
- [ ] Approvals audited (who/when); edits after approval require re-approval.
- [ ] CSV export matches on-screen totals (test).
- [ ] All mutations financial.write-gated.
**Dependencies**: PSOS-32/33. **Risks**: extraction quality on new source types —
receipt statuses make gaps visible rather than silent.

---

## PHASE 8 — Advanced portfolio (backlog only)

### PSOS-35 · `PSOS P8 — Backlog: named saved views + email digests`
**Priority**: P3 backlog.
**Scope sketch**: Persist per-user named lane configurations (filters/sort/columns) on
My Work and All projects; optional daily/weekly digest email summarizing open handoffs,
due-soon, overdue (reuses PSOS-17 delivery ledger). Clearly scoped: no sharing/team
views in v1. **Acceptance sketch**: saved view CRUD + default-view selection; digest opt-in,
one email/day max, dedup ledger. **Dependencies**: PSOS-14, PSOS-17.

### PSOS-36 · `PSOS P8 — Backlog: assignment templates + automation rules (architecture-first)`
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
