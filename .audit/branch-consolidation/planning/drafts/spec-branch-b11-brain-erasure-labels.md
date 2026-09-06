---
title: Render truthful Brain unlearn request, attempt and confirmation labels
type: bugfix
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized frontend recovery; parent owns dispatch">

## Intent

**Problem:** Brain audit labels revocation already unlearned before asynchronous erasure, then renders raw outcome slugs.

**Approach:** Correct three mappings and prove actual route rendering with valid current events and a separately qualified forward-compatibility probe.

## Boundaries & Constraints

**Always:** User-selected BMAD supersedes generic factory engine/shipping restrictions. Preserve current main, prior batches and approved policies. Scope is only `src/routes/admin/brain/+page.svelte` (three label mappings) and new adjacent `BrainAudit.component.test.ts`. Preserve other labels, fallback, reasons/times, actor rendering, auth and query gates. This audited integration is authorized; parent owns canonical approval, dispatch, review and shipping.

**Ask First:** Refer expanded behavior or policy requirements to parent; no renewed approval for these labels/tests.

**Never:** Change backend/schema/permissions, shared stubs/config, actor attribution or retry behavior; infer exhaustion or source state; import historical backend; mock matchMedia; replace rendered proof with source matching. Worker must not stage, spawn review, commit, use remotes, edit other worktrees or mutate ledgers/native state.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Request | revoke | Revoked (unlearn requested) | No completion claim |
| Confirmation | unlearn_confirmed | Erasure confirmed | Recorded event fact |
| Failure | unlearn_failed | Erasure attempt failed | No terminal inference |
| Recovery | Same source request, failure, confirmation | Preserve each label; newest first | No stale failure after confirmation |
| Other events | ingest/approve/reject/reweight/revert | Imported/Approved/Rejected/Reweighted/Reverted | Preserve copy |
| Row details | Present/omitted reason and numeric at | Exact reason/fallback and localized time | Preserve actor display |
| Unknown boundary | Separate unrecognized action at query stub | Raw slug fallback | Not a valid persisted event |
| Tabs | Queue → Audit log → Queue | Audit subscriptions 0 → 1 with {} → 0 | Existing query gates |
| Signed out | Auth false, loading false | Audit skipped; login navigation | No backend-auth claim |
| Access denied | Authenticated; brainStats null | Admin access only; tabs absent | Existing render gate |

</frozen-after-approval>

## Code Map

- Route: mappings 17-24, query gates 34-49, redirect 51-55, access gate 77-89, cells 180-190. Svelte key `_id` is not a DOM row ID.
- New suite imports actual route and existing shell/auth/page/query stubs. Reuse reset/admin-shell setup from `src/routes/admin/learning/LearningHealth.component.test.ts:61-73` with `/admin/brain`.
- Read-only: `convex/schema.ts:1758-1776` closed eight-action union; `convex/brain.ts:376-398` request/confirmation, 505-530 failed-attempt/retry guards, 801-827 audit/stats query results. Preserve `convex/brainUnlearn.test.ts`.
- Recovery `186dc570967a0eaa388c72595376d41ba8a9b5d8` is frontend only; historical backend is superseded. Planning/B11.md and B11-preflight.md hold audit rationale. Structural adminWorkspaceRoutes tests alone do not prove rendered copy.

## Tasks & Acceptance

- [ ] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [ ] Confirm parent baseline and hashes; retain protected backend/stub/config identities.
- [ ] Add browser regression before changing mappings. Reset page/navigation/auth/Convex between cases, seed existing admin/owner shell user and myWork view config, set URL/viewport. Seed `brain:brainStats` with `{approved:0,pending:0,byIndustry:{}}` and `brain:listBrainSources` with `[]`; click real Audit log tab.
- [ ] Type normal audit fixtures as `NonNullable<FunctionReturnType<typeof api.brain.listBrainAudit>>`. Include distinct `_id`, `_creationTime`, action, actorId and at; only optional sourceId/feedbackId/reason/revertOf are registered. No attempt/exhausted/status/createdAt fields. Use shared sourceId, increasing request→failure→confirmation times, descending query-result order. Retry count belongs in reason.
- [ ] Assert action cells using unique reason cells or ordered `tbody tr` cells, never nonexistent DOM IDs. Exercise all eight labels, populated/omitted reason, and times computed with browser `new Date(at).toLocaleString()`. Keep system-as-admin rendering untouched.
- [ ] Separately clone a valid row and replace only action with an unknown slug through existing `__setQueryData(name, data: unknown)`. Never cast that boundary probe to a backend return type or claim it is schema-valid. Render actual route and assert raw fallback.
- [ ] Exercise every gate row using `__activeQueryCount` and `__activeQueryArgs`; settle effects for navigation assertions. Authenticated loading alone does not skip queries. Stable source data may remain cached when skipped. Browser assertions prove rendering/subscription wiring, not execution of backend adminOrNull.
- [ ] Run unchanged-route regression; retain actual red output for old revoke wording/raw outcome slugs and source hash. Change only revoke wording and add the two outcome mappings, then rerun identical suite and existing backend outcome tests.
- [ ] Deliver all executed matrix evidence to parent for independent review, staging/discovery and integration disposition.

**Acceptance:** Same rendered regression is red before and green after. Every matrix row executes. History distinguishes request, attempt failure and confirmation without aggregate-state inference. New suite is discovered once in ordinary Chromium, never pointer instances; protected files remain unchanged.

## Spec Change Log

Draft preflight correction: valid event shape/chronology, DOM selectors, explicit unknown boundary and existing route gates; no expanded production scope.

## Design Notes

Only “Revoked (unlearn requested)”, “Erasure confirmed” and “Erasure attempt failed” change. Preserve `ACTION_LABEL[a.action] ?? a.action`. No retries-exhausted field exists. Backend suppresses stale failures after confirmation, so fixtures must not invent that chronology. Actor attribution remains outside scope.

## Verification

Before/after: `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/routes/admin/brain/BrainAudit.component.test.ts`.
After: `node node_modules/vitest/vitest.mjs run convex/brainUnlearn.test.ts`.
Parent after staging: `node scripts/check-test-discovery.mjs`, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, `git diff --check`.

Keep commands, exits, matrix results and source hashes under `.audit/branch-consolidation/B11/evidence.md`; optional screenshots must be fresh and source-bound. Draft revision ran no tests. Parent owns review, admission and shipping.
