---
title: 'Publish-for-review authorized by Owner, Manager, or Admin'
type: 'bugfix'
created: '2026-08-25'
baseline_revision: 'ca165fd0890edd537cc998653ab2c8ea3957e50d'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred: []
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

## Design Notes

`project.setStage` is reused rather than adding a `report.publishForReview` capability because the domain contract's `client_review` stage row ("Authorized user deliberately sends/publishes a revision for client review") and its role matrix ("Change workflow stage": Own / All / All) already encode exactly Owner, Manager, Admin. Owner is strict `ownerId`: an un-backfilled legacy row (no `ownerId`) is publishable only by Manager/Admin, which matches `workflowAuthorities` and the D2 decision that Owner, not Creator, carries authority. `unpublishReview` remains creator-or-admin because CAP-3 names only publish; the asymmetry (a Manager can publish but not unpublish) is deliberately left for a follow-up story.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- projects.test` -- expected: publishing, unpublishing, and all other suites in the file pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.

