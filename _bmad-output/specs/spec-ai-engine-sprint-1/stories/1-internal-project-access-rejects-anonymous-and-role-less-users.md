---
title: 'Internal project access rejects anonymous and role-less users'
type: 'bugfix'
created: '2026-08-25'
status: 'done'
baseline_revision: 'a2347c2ac3f717503533f904ffd07dd1eb3cb98f'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: []
deferred:
  - summary: >-
      getProjectAccess still classifies any authenticated user, including anonymous
      auth records and role-less users, as an internal collaborator.
    evidence: |-
      convex/lib/auth.ts getProjectAccess returns { kind: "internal" } for any
      getCurrentUserOrNull hit with no isAnonymous/role check, so an anonymous
      Better Auth session without a share token gets internal-level access to
      reports.getLatestReport, comments.listComments/addComment, and reportViews.
      Pre-existing and explicitly out of scope for this story (intent: "Never
      change getProjectAccess client-review semantics"). Note docs/product-domain.md
      records a 2026-08-06 decision that preserved role-less read visibility on
      dashboard queries, so a product decision is needed before gating the read
      branch; the write branch (addComment) is the riskier half.
    location: >-
      convex/lib/auth.ts:98-117
    severity: high
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

### 2026-08-25 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 0, low 6)
- defer: 1: (high 1, medium 0, low 0)
- reject: 13
- addressed_findings:
  - `[low]` `[patch]` Precedence of the role gate over the project lookup was undocumented and untested; added a test asserting anonymous + deleted project yields NOT_AUTHORIZED.
  - `[low]` `[patch]` Only `writer` and `undefined` isAnonymous exercised the accept path; added a `manager` fixture with explicit `isAnonymous: false` and a passing updateReportContent test.
  - `[low]` `[patch]` No manager/admin role covered the gate (a `role === "writer"` regression would pass); covered by the same manager test.
  - `[low]` `[patch]` applyProposal NOT_FOUND branch of the gate unverified; added a deleted-project test for applyProposal asserting NOT_FOUND and proposal still pending.
  - `[low]` `[patch]` Anonymous fixture carrying a role was uncommented; added a comment stating it proves isAnonymous wins over a present role.
  - `[low]` `[patch]` `agentTest.register(t)` was unexplained; added a comment that chatV2.ts imports @convex-dev/agent.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- reportAuthz` -- expected: all new tests pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.

## Auto Run Result

**Summary:** `requireInternalProjectAccess` now rejects anonymous auth records (`isAnonymous === true`) and role-less users with the existing `NOT_AUTHORIZED` domain error, after `requireCurrentUser` (so no identity still yields `NOT_AUTHENTICATED`) and before the project lookup (so role holders on a deleted project still get `NOT_FOUND`). This mirrors `getInternalProjectAccessOrNull` and closes audit CAP-1 for every caller of the helper, including `updateReportContent` and `applyProposal`.

**Files changed:**
- `convex/lib/auth.ts` -- six-line gate added to `requireInternalProjectAccess`.
- `convex/reportAuthz.test.ts` -- new convex-test suite (11 tests) covering the I/O matrix for `updateReportContent` and `applyProposal`, plus gate-precedence, explicit `isAnonymous: false` manager, and applyProposal NOT_FOUND cases added at review.

**Review findings:** 6 patches applied (all low), 1 deferred (high: `getProjectAccess` still treats anonymous/role-less users as internal; intent forbids touching it), 13 rejected (refactor/extraction suggestions that would change sibling helpers the intent protects, style-only test idioms, assertions outside the matrix, docs update not requested, pre-existing applyProposal check ordering in a caller the intent forbids changing).

**Follow-up review recommendation:** true. Patched counts: high 0, medium 0, low 6; score = 3x0 + 1x6 = 6 (>= 5).

**Verification:**
- `npm test -- reportAuthz` -- 11/11 passed.
- `npm test` -- 102 files, 932 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:** The deferred `getProjectAccess` gap means anonymous/role-less sessions retain internal-level read (and `addComment` write) access on the shared-review endpoints until a product decision covers the read branch (see docs/product-domain.md D1 note on role-less read visibility). Any project-scoped endpoint that bypasses `requireInternalProjectAccess` (calling `requireCurrentUser` directly) is not covered by this change.
