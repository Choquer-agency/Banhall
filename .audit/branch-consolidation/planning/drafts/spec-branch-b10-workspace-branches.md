---
title: Retire dead workspace branches while preserving query and override behavior
type: refactor
created: 2026-09-05
status: ready-for-dev
review_loop_iteration: 0
baseline_commit: PARENT_SETS_BASELINE
context:
  - "{project-root}/AGENTS.md"
---

<frozen-after-approval reason="authorized integration and approved workspace amendment">

## Intent

**Problem:** Unused local-development/two-state branches obscure a live query that returns available:true for authorized users or throws.

**Approach:** Remove dead branches, use actual error/override fixtures and append the approved 2026-09-03 amendment, preserving access/navigation.

## Boundaries & Constraints

**Always:** The user selected BMAD; generic factory engine/shipping requirements do not replace this authorized workflow. Preserve main, prior batches, canonical URLs/params, auth skip/login effects, neutral loading and currentWhileLoading. ?workspace=current wins during loading/error and skips access subscription. Successful available selects preview; errors and defensive ready with available:false select current. Inner operations retain server capabilities. Append approved decision text without overwriting later QA/privacy/diversity/publication amendments.

**Ask First:** Escalate actual routing, permission or domain-decision changes to parent. Integration is authorized.

**Never:** Install, stage, dispatch reviews, commit, push, merge, edit other worktrees/native state/ledgers or restart loops. Keep Convex stub/backend/schema/rollout storage/browser config unchanged. No smaller historical test transplant or new sleeps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Override | workspace=current during any query state | Current route, no access subscription | Preserve all other params |
| Loading | Authenticated, unresolved access | Neutral/currentWhileLoading behavior | No premature redirect |
| Success | ready with available:true | Preview | Existing capability enforcement |
| Defensive compatibility | ready with available:false | Current | Preserve pure resolver case |
| Query error | Explicit truthy error object | Current route/navigation | Do not seed undefined error |
| Anonymous | Unauthenticated | Existing skip/login flow | No access subscription |
| Project links | Client group/List params | Pathname and parameters remain correct | Avoid raw URL ordering assertions |

</frozen-after-approval>

## Code Map

- `src/lib/dashboard/workspaceExperience.ts` and `.test.ts`: remove resolveWorkspaceExperience and localDevelopment argument/branch; preserve three-state resolver and skip predicate.
- `src/lib/workspace/WorkspaceGate.svelte`: remove dev import/false argument and stale cohort comments, retaining loading/auth/navigation behavior.
- Its component test, `src/routes/workspaceRoutes.component.test.ts`, and `src/routes/project/[id]/projectRoute.component.test.ts`: explicit failed-access/current fixtures plus existing route coverage.
- `src/routes/dashboard/+page.svelte`, `src/routes/my-work/+page.svelte`, `src/routes/projects/+page.svelte`: corresponding stale cohort/dev comments or call context only.
- `src/lib/test/app-environment-stub.ts`: remove obsolete WorkspaceGate explanation only; keep exports/alias for other consumers.
- `docs/product-domain.md`: append only approved 2026-09-03(second) exposure amendment before Amendment process; preserve all later reviewer-decision, QA, privacy and diversity text.
- Provenance: `d0669fec95d4145b3be34a6f6b2b5e76db276cc7`, `76f9aca3c973a805a32cc5466cacd11d61ca080e`; planning `.audit/branch-consolidation/planning/B10.md`. Current workspaceRollout.getAccess already requires project.readInternal and returns available:true.

## Tasks & Acceptance

**Execution:**
- [ ] Record actual Node/npm versions before verification; use installed repository Node24, not the non-login shell Node22. No install is needed for runtime selection.
- [ ] Confirm baseline/ownership; hash intended files and protected stub/backend/config/ledger boundaries.
- [ ] Add/run the fixed25-observation table below before deletion with localDevelopment:false, then after without it. Use explicit expected values, not resolver-to-resolver comparison; retain outputs/hashes.
- [ ] Remove dead resolver/argument/import and update only associated comments/call context. Keep defensive ready with available:false behavior.
- [ ] Use `__setQueryError("workspaceRollout:getAccess", new Error("Access denied"))`; omission stores undefined. Seed available:true then error to prove error precedence; `__setQueryData("workspaceRollout:getAccess", { available: true })` must clear error and recover. Preserve defensive false in pure cases.
- [ ] Same mounted snippet gate: start authenticated/loading with one active query, set workspace=current via __setPageUrl, assert __activeQueryCount0/__activeQueryArgs[] and current branch. Seed error while skipped; override persists. Remove override to observe error; recover via data setter. Count active getters, not hook construction.
- [ ] With __setAuthState({isLoading:true,isAuthenticated:false}), assert neutral auth/no redirect/inactive query; settle signed-out and assert login replaceState/no subtree/no access. Preserve authenticated fixture defaults.
- [ ] Prove compatibility current snippet mounts while loading by default; canonical currentHref and report currentWhileLoading=false remain neutral without premature redirect. Await actual DOM/query/navigation readiness; add no fixed sleeps.
- [ ] Preserve stronger URL matrix: explicit layout/group values, only missing List/client defaults, repeated/Unicode params. Assert actual branch and soft-navigation options, not stub values alone.
- [ ] Append only the approved amendment and rerun truth table/browser proof. Hand final diff/receipts to parent for review, gate, staging/commit and integration.

**Acceptance Criteria:**
- Given retained inputs, before/after output tables match; only the unused localDevelopment:true branch and callerless resolver disappear.
- Given real route query fixtures, current override/error/loading/success cases render and navigate correctly with unchanged subscription semantics.
- Given final boundaries, the shared Convex stub and backend are byte-identical, while approved decision text and later amendments coexist.

## Spec Change Log

## Design Notes

Fixed table: each parameter has four route assertions and one skip assertion:20 resolver plus5 query observations.

| workspaceParam | loading | error | ready:false | ready:true | shouldQuery |
|---|---|---|---|---|---|
| current | current | current | current | current | false |
| preview | loading | current | current | preview | true |
| null | loading | current | current | preview | true |
| empty string | loading | current | current | preview | true |
| banana | loading | current | current | preview | true |

Error takes precedence over stale data; skipping suppresses both. Use existing stub APIs unchanged. Preserve distinct snippet/canonical loading; amendment changes exposure only.

## Verification

**Commands:**
- `node node_modules/vitest/vitest.mjs run src/lib/dashboard/workspaceExperience.test.ts`.
- `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts 'src/routes/project/[id]/projectRoute.component.test.ts'`.
- Parent coordinates `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` and `git diff --check` on reviewed final source.

Retain fresh tables, commands/exits, source hashes and limits in `.audit/branch-consolidation/B10/evidence.md`. Historical receipts are not current proof. Drafting ran no tests; parent owns review, gate and shipping.
