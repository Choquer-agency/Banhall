---
title: 'Internal project access rejects anonymous and role-less users'
type: 'bugfix'
created: '2026-08-25'
status: 'blocked'
baseline_revision: '95819ce6872d9c9a262fc620669791459b151a24'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** `requireInternalProjectAccess` (used by ~80 project-scoped mutations and queries, including `updateReportContent` and `applyProposal`) only checks that a `users` row exists for the caller. Anonymous auth records and users with no `role` therefore pass, so any signed-in identity can mutate report prose (audit CAP-1).

**Approach:** Make `requireInternalProjectAccess` apply the same gate as its sibling `getInternalProjectAccessOrNull` (reject when `user.isAnonymous === true` or `!user.role`), throwing the existing `NOT_AUTHORIZED` domain error. Add `convex/reportAuthz.test.ts` proving anonymous and role-less identities cannot call `updateReportContent` or `applyProposal`, while a role-holding writer still can.

## Boundaries & Constraints

**Always:** Keep every public `api.*` function name and argument shape unchanged. Unauthenticated callers keep receiving `NOT_AUTHENTICATED`; anonymous or role-less callers receive `NOT_AUTHORIZED` (matches `requireRole`). Use `domainError` from `convex/lib/contracts.ts`; no new error codes. Tests use `convex-test` + `t.withIdentity({ subject })` like `convex/projects.test.ts`; `applyProposal` tests register the agent component via `agentTest.register(t)` like `convex/chatTurns.test.ts`.

**Block If:** An existing test in `npm test` depends on a role-less or anonymous user succeeding through `requireInternalProjectAccess` and the fix cannot be reconciled without changing product behavior beyond CAP-1.

**Never:** Change `getProjectAccess` client-review semantics, `requireRole`, `getInternalProjectAccessOrNull`, or any caller of `requireInternalProjectAccess`. Do not touch CAP-2 through CAP-11. Do not add a code path where an AI tool writes report prose.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Writer edits | user `{role: "writer"}`, `updateReportContent` with matching `expectedRevisionNumber` | returns new revision; report content patched | No error expected |
| Anonymous edits | user `{isAnonymous: true, role: "writer"}` calls `updateReportContent` | report unchanged | `ConvexError` data `code: "NOT_AUTHORIZED"` |
| Role-less edits | user with no `role` calls `updateReportContent` | report unchanged | `ConvexError` data `code: "NOT_AUTHORIZED"` |
| Anonymous applies | anonymous user calls `applyProposal` on a pending `edit` proposal | proposal stays `pending`, report unchanged | `code: "NOT_AUTHORIZED"` |
| Role-less applies | role-less user calls `applyProposal` | proposal stays `pending`, report unchanged | `code: "NOT_AUTHORIZED"` |
| No identity | no `withIdentity`, `updateReportContent` | report unchanged | `code: "NOT_AUTHENTICATED"` |
| Missing project | role holder, project id deleted | unchanged | `code: "NOT_FOUND"` |

</intent-contract>

## Code Map

- `convex/lib/auth.ts:33-42` -- `getInternalProjectAccessOrNull`: reference gate (`!user || user.isAnonymous === true || !user.role`).
- `convex/lib/auth.ts:44-52` -- `requireInternalProjectAccess`: the primary edit. Keep `requireCurrentUser` first so no-identity still yields `NOT_AUTHENTICATED`; then reject anonymous/role-less with `NOT_AUTHORIZED`; then `NOT_FOUND` on missing project.
- `convex/lib/auth.ts:79-90` -- `requireRole`: message/code precedent for the anonymous rejection.
- `convex/reports.ts:42-71` -- `updateReportContent`: loads report, calls `requireInternalProjectAccess(ctx, report.projectId)`; requires `expectedRevisionNumber === report.revisionNumber ?? 0`.
- `convex/chatV2.ts:297-424` -- `applyProposal`: `requireInternalProjectAccess` runs before state checks; needs a `chatProposals` row (`agentThreadId`, `projectId`, `reportId`, `kind: "edit"`, `targetText`, `newText`, `state: "pending"`, `createdAt`) and a report whose `content` contains `targetText`.
- `convex/schema.ts:28` -- `users.isAnonymous` optional boolean; `role` optional.
- `convex/projects.test.ts:1-86` -- setup/`asActor` helper pattern to mirror.
- `convex/chatTurns.test.ts:1-16` -- `agentTest.register(t)` needed because `chatV2.ts` imports `@convex-dev/agent`.
- `convex/users.test.ts:11-19` -- precedent for anonymous and role-less user fixtures.
- `tests/projectReviewAccess.test.ts` -- read-only: existing bun-style tests around access; do not modify.

## Tasks & Acceptance

**Execution:**
- `convex/lib/auth.ts` -- after `requireCurrentUser`, reject `user.isAnonymous === true || !user.role` with `domainError("NOT_AUTHORIZED", "This action requires an active internal role")` -- mirrors `getInternalProjectAccessOrNull`.
- `convex/reportAuthz.test.ts` -- new convex-test suite covering every I/O matrix row for `updateReportContent` and the anonymous/role-less/writer rows for `applyProposal` -- proves CAP-1.
- Run the full `npm test` and `npm run check`; if any pre-existing test now fails because it relied on a role-less user passing, evaluate against **Block If**.

**Acceptance Criteria:**
- Given a user row with `isAnonymous: true`, when it calls `api.reports.updateReportContent` or `api.chatV2.applyProposal`, then the call rejects with `code: "NOT_AUTHORIZED"` and the report and proposal are unchanged.
- Given a user row with no `role`, when it calls either mutation, then the same rejection occurs.
- Given a user with `role: "writer"`, when it calls `updateReportContent`, then the mutation succeeds and `revisionNumber` increments.
- Given no identity, when `updateReportContent` is called, then `code: "NOT_AUTHENTICATED"`.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- reportAuthz` -- expected: all new tests pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.

## Auto Run Result

Status: blocked
Blocking condition: no subagents
Details: Planning completed and the spec passed the READY FOR DEVELOPMENT gate (status was set to ready-for-dev, then in-progress with baseline_revision 95819ce6872d9c9a262fc620669791459b151a24). Step-03 requires spawning a synchronous implementation subagent, but no Agent/Task tool is available in this runtime (ToolSearch found only SendMessage/ListAgents/TaskStop). Per workflow.md "Subagents", the run halts with `no subagents`. No source files were modified; this spec is ready to resume from step-03 when a subagent-capable runtime dispatches story 1 again (status should be reset to ready-for-dev by the caller, or re-planned).
