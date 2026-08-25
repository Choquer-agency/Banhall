---
title: 'Brain feedback scoped to accessible reports and projects'
type: 'bugfix'
created: '2026-08-25'
baseline_revision: '838cbcc1c912a06a4cb49dd5851dd800a7562f79'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred:
  - summary: >-
      Unscoped brain feedback (no reportId, no projectId) has no internal-role gate, so an anonymous or role-less authenticated account can enqueue feedback.
    evidence: |-
      submitBrainFeedback only checks getCurrentUserOrNull on the unscoped path; the intent contract explicitly keeps that path unchanged ("Feedback with neither id keeps today's behavior"), so this is pre-existing and outside CAP-5. Raised by edge-case-hunter and blind-hunter.
    location: >-
      convex/brain.ts submitBrainFeedback (unscoped branch)
    severity: medium
  - summary: >-
      body and suggestedRule are stored unbounded, unlike the sibling insert in convex/research.ts which truncates to 40_000 chars.
    evidence: |-
      Pre-existing behaviour of the mutation, not introduced by this story; a cap would change the public contract of the queue row.
    location: >-
      convex/brain.ts submitBrainFeedback insert
    severity: low
---

<intent-contract>

## Intent

**Problem:** `submitBrainFeedback` (`convex/brain.ts`) stores any caller-supplied `reportId`/`projectId` on the `brainFeedbackQueue` row after only an "is there a user" check, so a writer can attach feedback to reports and projects they cannot read, and a `reportId` can be paired with an unrelated `projectId` (audit CAP-5).

**Approach:** Before inserting, resolve the scope: when `reportId` is given, load the report (`NOT_FOUND` if missing) and take its `projectId`; when `projectId` is also given it must equal the report's project (`NOT_AUTHORIZED` otherwise). Then gate the resolved project with `requireInternalProjectAccess` from `convex/lib/auth.ts` (the story-1 helper; its anonymous/role-less rejection lands with story 1). Feedback with neither id keeps today's behavior. Extend `convex/brainFeedback.test.ts` to prove the rejections and the accepted scoped submission.

## Boundaries & Constraints

**Always:** Keep the `api.brain.submitBrainFeedback` name, argument shape (`body`, `suggestedRule?`, `reportId?`, `projectId?`), and return value (`Id<"brainFeedbackQueue">`) unchanged. The unscoped path (no `reportId`, no `projectId`) still requires a signed-in user and still throws `Error("Not authenticated")` when there is none, so `convex/learning.test.ts` and the existing `brainFeedback.test.ts` cases pass unmodified. Store the resolved `projectId` on the row when a `reportId` was given so approved feedback is always attributable to a project. Use `domainError` from `convex/lib/contracts.ts` for the scoped rejections; no new error codes. Tests use `convex-test` with the `setup()` helper already in `convex/brainFeedback.test.ts`.

**Block If:** An existing test in `npm test` submits feedback with a `reportId` or `projectId` the caller cannot access and cannot be updated without changing behavior beyond CAP-5.

**Never:** Change `requireInternalProjectAccess`, `getCurrentUserOrNull`, `reviewFeedback`, the `brainFeedbackQueue` schema, or any frontend file (no `src/` caller of this mutation exists). Do not touch CAP-1 through CAP-4 or CAP-6 through CAP-11. Do not add a code path where an AI tool writes report prose.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unscoped feedback | writer, `body` only | row inserted with `fromUserId`, `status: "pending"`, no `reportId`/`projectId` | No error expected |
| Scoped by project | writer with role, existing `projectId` | row inserted with that `projectId` | No error expected |
| Scoped by report | writer, existing `reportId`, no `projectId` | row inserted with `reportId` and `projectId` = `report.projectId` | No error expected |
| Report and matching project | writer, `reportId` whose `projectId` equals the supplied `projectId` | row inserted with both ids | No error expected |
| Report and foreign project | writer, `reportId` from project A, `projectId` = project B | no row inserted | `ConvexError` data `code: "NOT_AUTHORIZED"` |
| Unknown report | writer, `reportId` that was deleted | no row inserted | `code: "NOT_FOUND"` |
| Unknown project | writer, `projectId` that was deleted | no row inserted | `code: "NOT_FOUND"` |
| Unauthenticated scoped | no identity, `projectId` supplied | no row inserted | throws `Not authenticated` |
| Unauthenticated unscoped | no identity, `body` only | no row inserted | throws `Not authenticated` (unchanged) |

</intent-contract>

## Code Map

- `convex/brain.ts:383-404` -- `submitBrainFeedback`: the only production edit. Currently `getCurrentUserOrNull` then insert. Keep the user check first, add scope resolution + `requireInternalProjectAccess` before `ctx.db.insert`, and write the resolved `projectId`.
- `convex/brain.ts:18` -- imports from `./lib/auth`: add `requireInternalProjectAccess`. Add `import { domainError } from "./lib/contracts"`.
- `convex/lib/auth.ts:44-52` -- `requireInternalProjectAccess(ctx, projectId)`: `NOT_AUTHENTICATED` when no user, `NOT_FOUND` when the project is missing, returns `{ project, user }`. Story 1 adds the anonymous/role-less `NOT_AUTHORIZED` gate here; this story only consumes it. Read-only.
- `convex/lib/contracts.ts` -- `domainError(code, message)` throws a `ConvexError` whose `data.code` is the error code; codes in use: `NOT_AUTHENTICATED`, `NOT_AUTHORIZED`, `NOT_FOUND`.
- `convex/schema.ts:1516-1530` -- `brainFeedbackQueue`: `reportId` and `projectId` are already optional ids; no change.
- `convex/schema.ts:489-501` -- `reports`: `projectId` is the field used to derive the scope from a report.
- `convex/brainFeedback.test.ts:1-33` -- `setup()` creates an admin (`brain-admin`) and a writer (`brain-writer`, `role: "writer"`); extend `setup()` (or a new helper) to insert two `projects` rows and one `reports` row under the first project. Project fixture fields follow `convex/projects.test.ts` (`name`, `status`, `createdBy`, `createdAt`, `updatedAt`); report fixture follows `convex/schema.ts:489-501` (`projectId`, `content`, `version`, `generatedAt`, `updatedAt`).
- `convex/brainFeedback.test.ts:239-258` -- `review is admin-only`: precedent for `rejects.toThrow(/not authenticated/i)` against `t.mutation` with no identity.
- `convex/learning.test.ts:396` -- unscoped `submitBrainFeedback` caller; must keep passing unchanged.
- `convex/projects.test.ts:1-90` -- `setup()`/`asActor` precedent for `projects` fixtures and for asserting `ConvexError` codes (`error.data.code`).

## Tasks & Acceptance

**Execution:**
- `convex/brain.ts` -- in `submitBrainFeedback`, after the user check: if `args.reportId`, `ctx.db.get` the report (`domainError("NOT_FOUND", "Report not found")` when null) and set `projectId = report.projectId`; if `args.projectId` is also present and differs, `domainError("NOT_AUTHORIZED", "Report does not belong to that project")`; else `projectId = args.projectId`. If `projectId` is defined, `await requireInternalProjectAccess(ctx, projectId)`. Insert with `projectId` (resolved) instead of `args.projectId` -- scopes feedback to accessible reports/projects.
- `convex/brainFeedback.test.ts` -- add project/report fixtures and a new `describe("brain feedback scope")` covering every I/O matrix row, asserting `ConvexError` `data.code` for the domain-error rows and the stored `projectId` for the accepted rows -- proves CAP-5.
- Run `npm test` and `PUBLIC_CONVEX_URL=http://placeholder npm run check`; evaluate any other failing suite against **Block If**.

**Acceptance Criteria:**
- Given a signed-in writer, when they call `api.brain.submitBrainFeedback` with a `reportId` from project A and `projectId` of project B, then the call rejects with `code: "NOT_AUTHORIZED"` and `brainFeedbackQueue` has no new row.
- Given a signed-in writer, when they call it with only a `reportId`, then the stored row carries `projectId` equal to that report's `projectId`.
- Given the change lands, when `npm test` runs, then `convex/brainFeedback.test.ts` and `convex/learning.test.ts` are green without edits to their existing cases.

## Spec Change Log

## Review Triage Log

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 2: (high 0, medium 1, low 1)
- reject: 6
- addressed_findings:
  - `[medium]` `[patch]` Report lookup and report/project mismatch check ran before the role gate, letting anonymous or role-less accounts probe report existence and report-to-project mapping via NOT_FOUND vs NOT_AUTHORIZED. Added an up-front internal-role gate on the scoped path (before any lookup); unscoped path untouched.
  - `[medium]` `[patch]` No test observed the anonymous / role-less rejection through this mutation, so the CAP-5 gate could be removed with the suite staying green. Added `brain-anon` and `brain-norole` fixtures and three tests (anon by project, role-less by report, anon + deleted report ordering).
  - `[low]` `[patch]` Comment overstated "readable by the caller"; reworded to describe the actual guarantee (project exists, caller holds an active internal role).
  - `[low]` `[patch]` Orphan report (project row deleted) was untested; added "report whose project was deleted is NOT_FOUND".
  - `[low]` `[patch]` `codeOf` swallowed non-ConvexError rejections into `undefined`; it now rethrows when `data.code` is absent.
  - `[low]` `[patch]` Redundant `user?.name` optional chain after the `if (!user) throw` guard; dropped.
  - `[low]` `[patch]` NOT_FOUND / mismatch errors carried no ids; now pass `reportId` / `projectId` through `domainError` details.

## Auto Run Result

**Summary:** `submitBrainFeedback` now resolves its scope before inserting: a `reportId` pins the `projectId`, a supplied `projectId` must agree with it (`NOT_AUTHORIZED`), a missing report or project is `NOT_FOUND`, and any scoped submission requires an active internal role (gated before any lookup) plus `requireInternalProjectAccess` on the resolved project. The unscoped path is unchanged.

**Files changed:**
- `convex/brain.ts` -- scope resolution, up-front role gate on scoped submissions, resolved `projectId` stored, error details carry ids.
- `convex/brainFeedback.test.ts` -- project/report/anon/role-less fixtures and a `brain feedback scope` describe covering every matrix row plus role-gate and orphan-report cases.

**Review findings:** 7 patched (medium 2, low 5), 2 deferred, 6 rejected (mismatch-as-INVALID_INPUT, requireCurrentUser on unscoped path, per-project membership check, indexes/cleanup, frontend caller, product-domain doc entry -- all excluded by the intent contract or not this story's surface).

**Follow-up review recommendation:** true. Patched: high 0, medium 2, low 5; score 3*2 + 5 = 11 (>= 5).

**Verification:**
- `npm test -- brainFeedback` -- 23 passed.
- `npm test` -- 104 files, 963 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:** access is role-level, not per-project membership (the codebase has no per-project membership model; `requireInternalProjectAccess` is the shared gate). Unscoped feedback still has no role gate (deferred).

## Design Notes

Access is checked against the project rather than the report because every internal read path in the codebase is project-scoped (`requireInternalProjectAccess`, `getProjectAccess`); a report inherits its project's access. Deriving `projectId` from the report, and rejecting a mismatched pair, closes the second hole the audit implies (feedback filed under one project while pointing at another project's report) without a schema change. The unscoped path keeps the plain `Error("Not authenticated")` because that string is the existing public surface and `reviewFeedback` uses the same convention; switching to `NOT_AUTHENTICATED` for the unscoped case is a cosmetic change outside CAP-5.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- brainFeedback` -- expected: all existing and new cases pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.
