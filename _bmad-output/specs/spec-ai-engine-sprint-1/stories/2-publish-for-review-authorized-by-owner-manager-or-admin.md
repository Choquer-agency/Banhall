---
title: 'Publish-for-review authorized by Owner, Manager, or Admin'
type: 'bugfix'
created: '2026-08-25'
baseline_revision: 'a2a033ce00fe3d4bbd6c180587d3b56aa94563ad'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred:
  - summary: >-
      unpublishReview still authorizes by createdBy-or-admin while publishForReview now authorizes by ownerId/Manager/Admin, so a transferred owner can publish but not unpublish and a Manager can publish but not unpublish.
    evidence: |-
      convex/projects.ts unpublishReview calls requireProjectCreatorOrAdmin; convex/projects.test.ts "project review unpublishing" pins Manager denial. The intent for CAP-3 names only publishForReview and lists unpublishReview under Never, so the asymmetry is deliberate for this story (see Design Notes) but needs a follow-up story.
    location: >-
      convex/projects.ts:unpublishReview
    severity: medium
  - summary: >-
      Frontend canShare gate in CurrentProjectPage.svelte and PreviewProjectPage.svelte still computes publish eligibility as createdBy === user._id || role === "admin", diverging from the backend Owner/Manager/Admin rule.
    evidence: |-
      Managers and transferred owners never see the Share control even though publishForReview now permits them; an ex-owner creator (or writer creator on a legacy row without ownerId) sees the control and receives NOT_AUTHORIZED on click. No component test covers who sees the control. The intent lists both Svelte callers under Never, so this is out of scope for CAP-3 and needs a follow-up (derive canShare from ownerId/role or a server-computed capability, plus a component test).
    location: >-
      src/lib/components/project/CurrentProjectPage.svelte canShare; src/lib/components/project/PreviewProjectPage.svelte canShare
    severity: medium
---

<intent-contract>

## Intent

**Problem:** `publishForReview` (`convex/projects.ts`) authorizes by `requireProjectCreatorOrAdmin`, so the immutable `createdBy` audit identity decides who may share a report with the client. A Manager cannot publish, and a Creator who transferred ownership keeps publish rights, contradicting the `docs/product-domain.md` role matrix (Owner, Manager, or Admin) (audit CAP-3).

**Approach:** Replace the creator guard in `publishForReview` with `requireCapability(ctx, "project.setStage", { ownedBy })` from `convex/lib/roleCapabilities.ts`, where `ownedBy` is the project's current `ownerId` (the same strict owner test `workflowAuthorities` uses). Update `convex/projects.test.ts` so the publishing suite proves Owner, Manager, and Admin can publish, a non-owner Consultant cannot, and the original Creator cannot after `transferOwnership`.

## Boundaries & Constraints

**Always:** Keep the `api.projects.publishForReview` name, argument shape, and success side effects (`sharedReportId`, `status: "client_review"`, `updatedAt`) unchanged. Load the project once and keep the existing `NOT_FOUND` on a missing project and `NOT_AUTHORIZED` on a report from another project. Owner means `project.ownerId === user._id` exactly as `convex/projectWorkflow.ts:workflowAuthorities` does; never fall back to `createdBy`. Tests use the `setup()`/`asActor` helpers already in `convex/projects.test.ts` and `api.projectWorkflow.transferOwnership` (with `expectedVersion`) to move ownership rather than patching `ownerId` directly.

**Block If:** Another test suite in `npm test` relies on a Manager being denied publish, or on a non-owner Creator being allowed, and cannot be updated without changing behavior beyond CAP-3.

**Never:** Touch `unpublishReview`, `deleteProject`, `requireProjectCreatorOrAdmin`, `requireProjectCreator`, `shared/capabilities.ts` presets, or the frontend callers in `PreviewProjectPage.svelte` / `CurrentProjectPage.svelte`. Do not add a new capability literal. Do not touch CAP-1, CAP-2, CAP-4 through CAP-11.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Owner publishes | caller `role: "writer"`, `project.ownerId === caller._id`, report belongs to project | project patched: `sharedReportId`, `status: "client_review"` | No error expected |
| Manager publishes | caller `role: "manager"`, not owner, not creator | same success | No error expected |
| Admin publishes | caller `role: "admin"`, not owner, not creator | same success | No error expected |
| Non-owner Consultant | caller `role: "writer"`, `ownerId` is another user | project unchanged (`status: "review"`, no `sharedReportId`) | `NOT_AUTHORIZED` |
| Creator after transfer | caller is `createdBy`; `transferOwnership` moved `ownerId` to another writer | project unchanged | `NOT_AUTHORIZED` |
| Transferred owner | caller received ownership via `transferOwnership`, is not `createdBy` | success | No error expected |
| Legacy row without `ownerId` | `project.ownerId` undefined, caller `role: "writer"` (even the creator) | project unchanged | `NOT_AUTHORIZED`; Manager/Admin still succeed |
| No identity / unmapped identity | no auth, or subject without a `users` row | project unchanged | `NOT_AUTHENTICATED` |
| Foreign report | authorized caller, `report.projectId !== projectId` | project unchanged | `NOT_AUTHORIZED` |
| Missing project | authorized role, unknown `projectId` | nothing written | `NOT_FOUND` |

</intent-contract>

## Code Map

- `convex/projects.ts:942-957` -- `publishForReview`: the only edit site. Currently `await requireProjectCreatorOrAdmin(ctx, args.projectId)` then report ownership check and patch. Replace the guard with `ctx.db.get(args.projectId)` + `NOT_FOUND` + `requireCapability`.
- `convex/projects.ts:15,25` -- imports: `requireProjectCreatorOrAdmin` stays imported (still used by `unpublishReview` line 964 and `deleteProject` line 1023); `requireCapability` is already imported from `./lib/roleCapabilities`.
- `convex/lib/roleCapabilities.ts:39-61` -- `requireCapability(ctx, capability, { ownedBy })`: rejects no user/anonymous with `NOT_AUTHENTICATED`, role-less with `NOT_AUTHORIZED`; `all` level passes, `own` level passes only when `ownedBy` includes `user._id`; empty `ownedBy` fails closed.
- `shared/capabilities.ts` -- `project.setStage` preset: writer `own`, manager `all`, admin `all`. This is the matrix row "Change workflow stage" that a client-review publish exercises; reuse it, no new literal.
- `convex/projectWorkflow.ts:87-100` -- `workflowAuthorities`: precedent that Owner is strictly `project.ownerId === user._id`.
- `convex/projectWorkflow.ts:253-315` -- `transferOwnership` mutation (`projectId`, `toUserId`, `expectedVersion`, optional `note`); requires caller Owner/Manager/Admin; target must have role writer or manager. Use in the test to move ownership from the creator.
- `convex/lib/auth.ts:65-77` -- `requireProjectCreatorOrAdmin` (read-only; not modified).
- `convex/projects.test.ts:1-90` -- `setup()`, `authIds`, `asActor`, `getProject`. Fixture `projectId` has `createdBy: ownerId` but no `ownerId`; `otherProjectId` has `createdBy: writerId`.
- `convex/projects.test.ts:401-475` -- `describe("project review publishing")`: currently allows creator + admin, denies writer + manager. Rewrite this block per the matrix.
- `convex/projects.test.ts:718-758` -- `describe("project review unpublishing")` publishes as `"owner"` in its arrange step; that call must keep succeeding (see task 2).
- `convex/projectWorkflow.test.ts:366-470` -- examples of calling `transferOwnership` with `expectedVersion`.

## Tasks & Acceptance

**Execution:**
- `convex/projects.ts` -- in `publishForReview`, load the project, `domainError("NOT_FOUND", "Project not found")` when missing, then `await requireCapability(ctx, "project.setStage", { ownedBy: project.ownerId ? [project.ownerId] : [] })`; leave the report check and patch untouched -- authorizes by capability instead of creator identity.
- `convex/projects.test.ts` -- add `ownerId: ownerId` to the `projectId` fixture in `setup()` (creator is initial Owner per the domain contract) so the `"owner"` actor is a real Owner; if any unrelated test in this file breaks from that fixture change, instead patch `ownerId` on `projectId` inside the publishing and unpublishing describes only -- keeps the arrange step of the unpublishing suite valid.
- `convex/projects.test.ts` -- rewrite `describe("project review publishing")` to cover every matrix row: allow owner/manager/admin; deny non-owner writer; creator denied after `api.projectWorkflow.transferOwnership` to `writerId` (`expectedVersion: 0`) while the new owner succeeds; legacy row without `ownerId` denies the writer creator but allows manager; keep the existing unauthenticated, unmapped, and foreign-report tests -- proves CAP-3.
- Run `npm test` and `npm run check`; evaluate any other failing suite against **Block If**.

**Acceptance Criteria:**
- Given a project whose ownership was transferred from its creator to another Consultant, when the creator calls `api.projects.publishForReview`, then the call rejects with `code: "NOT_AUTHORIZED"` and when the new owner calls it, then `status` becomes `client_review` and `sharedReportId` is set.
- Given a Manager who neither created nor owns the project, when they call `publishForReview`, then it succeeds.
- Given `unpublishReview` and `deleteProject`, when the change lands, then their authorization behavior and tests are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 0, low 3)
- defer: 2: (high 0, medium 2, low 0)
- reject: 21
- addressed_findings:
  - `[low]` `[patch]` Loading the project before the capability check turned publishForReview into an existence oracle (unauthenticated caller with a bogus id got NOT_FOUND instead of NOT_AUTHENTICATED; the previous requireProjectCreatorOrAdmin checked identity first). Reordered: requireCapability runs first with `ownedBy: project?.ownerId ? [...] : []`, then NOT_FOUND. Added test "does not reveal whether a project exists to an unauthenticated caller".
  - `[low]` `[patch]` Handler comment claimed the check "matches projectWorkflow.workflowAuthorities" although that helper also honors the handoff assignee. Reworded to say only the owner test is shared and the handoff assignee is deliberately not an authority here.
  - `[low]` `[patch]` Matrix row "Legacy row without ownerId: Manager/Admin still succeed" was only asserted for Manager. Parametrized the legacy-row test over manager and admin.

## Design Notes

`project.setStage` is reused rather than adding a `report.publishForReview` capability because the domain contract's `client_review` stage row ("Authorized user deliberately sends/publishes a revision for client review") and its role matrix ("Change workflow stage": Own / All / All) already encode exactly Owner, Manager, Admin. Owner is strict `ownerId`: an un-backfilled legacy row (no `ownerId`) is publishable only by Manager/Admin, which matches `workflowAuthorities` and the D2 decision that Owner, not Creator, carries authority. `unpublishReview` remains creator-or-admin because CAP-3 names only publish; the asymmetry (a Manager can publish but not unpublish) is deliberately left for a follow-up story.

## Auto Run Result

**Summary:** `publishForReview` now authorizes by `requireCapability(ctx, "project.setStage", { ownedBy: [project.ownerId] })` (strict Owner, Manager, or Admin) instead of `requireProjectCreatorOrAdmin`. Authorization runs before the `NOT_FOUND` check so callers cannot probe project existence. Name, args, and success side effects are unchanged.

**Files changed:**
- `convex/projects.ts` -- `publishForReview` guard swapped to capability-based authorization; project loaded once; authorize-then-NOT_FOUND ordering.
- `convex/projects.test.ts` -- `setup()` fixture gives the primary project `ownerId`; publishing suite rewritten to cover the full I/O matrix (owner/manager/admin allowed, non-owner writer denied, creator denied after `transferOwnership` while new owner succeeds, legacy row without `ownerId` denies writer creator and allows manager and admin, unauthenticated/unmapped, foreign report, missing project NOT_FOUND, no existence oracle for unauthenticated callers).

**Review findings:** 3 patches applied (all low), 2 deferred (medium: `unpublishReview` asymmetry; frontend `canShare` gate divergence), 21 rejected (intent-excluded scope such as handoff assignee, new capability literal, `workflowStage`/`projectEvents` writes, `expectedVersion` guard, status-transition guard, `unpublishReview`/`deleteProject` migration, docs edits, fixture nitpicks, dashboard projection which derives `status` from the project doc at read time).

**Follow-up review recommendation:** false. Patched counts: high 0, medium 0, low 3; score = 3 x 0 + 1 x 3 = 3 (< 5).

**Verification performed:**
- `npm test -- projects.test` -- 54 tests passed.
- `npm test` -- 102 files, 938 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:**
- UI still gates the Share control on `createdBy`/admin (deferred); Managers cannot reach the new permission from the UI until the follow-up lands.
- `unpublishReview` remains creator-or-admin (deferred); publish/unpublish authority is asymmetric after an ownership transfer.
- A writer holding only `own` gets `NOT_AUTHORIZED` (not `NOT_FOUND`) for a missing project id, by design of the authorize-first ordering.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- projects.test` -- expected: publishing, unpublishing, and all other suites in the file pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.

