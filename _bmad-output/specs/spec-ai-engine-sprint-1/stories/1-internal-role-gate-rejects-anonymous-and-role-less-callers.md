---
title: 'Internal role gate rejects anonymous and role-less callers'
type: 'bugfix'
created: '2026-08-31'
status: 'done'
review_loop_iteration: 0
baseline_revision: '5912eb2435fd015831e3402312cddf5bcb8cd613'
followup_review_recommended: true
context:
  - 'docs/product-domain.md'
  - 'convex/_generated/ai/guidelines.md'
  - '_bmad-output/specs/spec-ai-engine-sprint-1/SPEC.md'
  - '_bmad-output/specs/spec-ai-engine-sprint-1/stories/1-caller-inventory.md'
---

<frozen-after-approval reason="human-owned intent; do not modify unless human renegotiates">

## Intent

**Problem:** `requireInternalProjectAccess` accepts mapped users whose records are anonymous or have no internal role, unlike the nullable helper. Most inherited paths therefore treat an invalid internal actor as eligible; paths already guarded by capabilities lack consistent defense-in-depth.

**Approach:** Enforce the same actor eligibility as `getInternalProjectAccessOrNull` and tighten every existing helper caller, including 60 mutations, four queries, and two actions. Verify helper parity, representative write boundaries, and read/action smoke paths.

## Boundaries & Constraints

**Always:** No identity, unmapped identity, or stored-anonymous user returns `NOT_AUTHENTICATED`; mapped role-less returns `NOT_AUTHORIZED`; eligible `writer`, `manager`, or `admin` plus missing project preserves `NOT_FOUND`. Keep public paths and arguments unchanged. All inventoried writes remain guarded before their first write.

**Ask First:** Any error-code change, pre-guard write, or newly discovered helper caller whose approved contract permits anonymous or role-less access.

**Never:** Replace this fix with capability migration; change `requireCurrentUser`, dashboard visibility, or share-token behavior; repurpose `projects.createdBy`; broaden consultant edit authority beyond existing object-level rules.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error |
|---|---|---|---|
| Eligible actor | Mapped internal role; project exists | Both helpers return same project/user | None |
| No internal identity | No JWT or no mapped user | Reject before project access | `NOT_AUTHENTICATED` |
| Stored anonymous | `isAnonymous: true`, even with role | Reject | `NOT_AUTHENTICATED` |
| Role-less | Mapped user without role | Reject | `NOT_AUTHORIZED` |
| Missing project | Eligible actor | Preserve failure | `NOT_FOUND` |

</frozen-after-approval>

## Code Map

- `convex/lib/auth.ts:15-51` -- change only `requireInternalProjectAccess`; mirror nullable eligibility with typed errors before project lookup.
- `convex/lib/roleCapabilities.ts:39-50`, `convex/workItems.ts:86-90` -- precedent for anonymous versus role-less error codes.
- `convex/schema.ts:14-40` -- optional `role` and `isAnonymous` support explicit fixtures.
- `convex/reports.ts:42-70`, `convex/chatV2.ts:297-424` -- representative write boundaries; both guard before patch/insert operations.
- `convex/projectDuplication.ts:32-87`, `convex/reviewFromProject.ts` -- two affected action paths; review creation already has a capability check.
- `_bmad-output/specs/spec-ai-engine-sprint-1/stories/1-caller-inventory.md` -- complete verified caller list and unaffected boundaries.
- `tests/projectReviewAccess.test.ts` -- Bun helper reference only; excluded from active Vitest projects.
- `convex/workItems.test.ts`, `vitest.config.ts:13-38` -- real `convex-test` identity fixtures and active test placement.

## Tasks & Acceptance

**Execution:**
- [x] `convex/lib/auth.ts` -- add stored-anonymous and missing-role guards with existing domain codes/messages -- close the shared eligibility gap without changing valid internal access.
- [x] `convex/reportAuthz.test.ts` -- add `convexTest` helper matrix for no/unmapped identity, stored anonymous with role, role-less, all valid roles, and missing project -- prove parity and typed errors.
- [x] `convex/reportAuthz.test.ts` -- invoke `updateReportContent` and `applyProposal` with rejected actors and owner or Manager/Admin positive controls -- compare full report/proposal rows and snapshot ids around rejection.
- [x] `convex/reportAuthz.test.ts` -- smoke-test role-less and stored-anonymous rejection through `listMessages`, `getReadiness`, `preflightExport`, `getMyQaItemFeedback`, `copyProjectContent`, and `createReviewFromProject` -- prove the approved whole-helper blast radius.

**Acceptance Criteria:**
- Given any caller in the companion inventory, when its mapped actor is anonymous or role-less, then the helper rejects; every inventoried write path remains guarded before its first write.
- Given rejected `updateReportContent`, when state is re-read, then the full report row and snapshot-id list are unchanged.
- Given rejected `applyProposal`, when state is re-read, then the full report row, proposal row, and snapshot-id list are unchanged.
- Given an inherited query or action, when a stored-anonymous or role-less actor calls it, then it returns the helper's typed eligibility error rather than data or success.
- Given an eligible owner or elevated actor, when representative calls run, then existing object-level authorization and validation still apply.

## Spec Change Log

- 2026-08-31: Review found `projects.setProjectType` was added on the baseline branch but omitted from the planning inventory. Corrected the inherited mutation count from 59 to 60 and added it to the companion inventory. KEEP: the shared-helper-only production change and representative endpoint coverage.

## Review Triage Log

### 2026-08-31 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 2, low 0)
- defer: 0
- reject: 15
- addressed_findings:
  - `[medium]` `[patch]` Added `projects.setProjectType` to the caller inventory and synchronized the mutation count from 59 to 60 across Story 1 artifacts.
  - `[medium]` `[patch]` Added a stored-anonymous fixture without a role to prove `NOT_AUTHENTICATED` takes precedence over the role-less error across helper and representative rejection matrices.

## Design Notes

Keep resource lookup order unchanged: invalid resource ids may still return `NOT_FOUND` before project access. Helper-level `writer` eligibility does not grant edit authority outside ownership or assigned collaboration rules.

## Verification

**Commands:**
- `npx vitest run --project convex convex/reportAuthz.test.ts` -- expected: helper, write, query, and action matrices pass.
- `npm test` -- expected: integrated suite green; record verified unrelated baseline failures and require no new failures.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check` -- expected: zero new TypeScript or Svelte errors.

## Auto Run Result

Status: done
Execution workspace: isolated worktree on `bmad/story-1-auth-gate`.

**Changes**

- `convex/lib/auth.ts` -- `requireInternalProjectAccess` now rejects stored-anonymous actors with `NOT_AUTHENTICATED` and mapped role-less actors with `NOT_AUTHORIZED`, both before the project lookup, matching `getInternalProjectAccessOrNull`. Messages reuse the existing domain wording ("Authentication required", "An active internal role is required") from `requireCapability` / `workItems.requireInternalActor`. No other helper, argument, or public path changed.
- `convex/reportAuthz.test.ts` (new, 14 cases) -- helper parity matrix, including stored-anonymous actors with and without roles; `updateReportContent` and `applyProposal` write boundaries with full-row and snapshot-id comparisons; rejection smoke tests through `listMessages`, `getReadiness`, `preflightExport`, `getMyQaItemFeedback`, `copyProjectContent`, and `createReviewFromProject`; eligible-actor positive controls.
- `_bmad-output/specs/spec-ai-engine-sprint-1/stories/1-caller-inventory.md` -- verified 60-mutation, four-query, two-action inherited caller inventory.

**Review findings**

- Patches applied: 2 medium, 0 high, 0 low. Added the omitted `setProjectType` caller and the stored-anonymous-without-role case.
- Deferred: 0.
- Rejected: 15 findings that were out of frozen scope, already covered by the shared-helper design, or non-actionable review noise.
- Follow-up review recommendation: true. Patched findings: 0 high, 2 medium, 0 low. Score = `3 × 2 + 1 × 0 = 6`, which meets the workflow threshold of 5.

**Verification**

- `npx vitest run --project convex convex/reportAuthz.test.ts` -- 14 passed. With the `convex/lib/auth.ts` change stashed, 6 of the 14 fail, so the suite is not vacuous.
- `npm test` -- 102 files, 935 tests, all passing. No pre-existing failures observed on this baseline, so none are excluded.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check` -- 5865 files, 0 errors, 0 warnings.
- Guard-order audit over the 60 inventoried mutations: each path reaches `requireInternalProjectAccess` directly or transitively before its first database, scheduler, or storage write (60 checked, 0 problems). Static source inspection.
- Caller enumeration was rechecked after review; `projects.setProjectType` was added to the companion inventory and no further unlisted helper caller was found.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run lint` -- 0 errors, 0 warnings. The project lint command is the same Svelte check pipeline as `npm run check`.
- `npx tsc --noEmit -p convex` -- passed.

**Residual risks**

- Convex code generation was not run in the isolated worktree because it has no deployment environment and the changed test file does not enter generated API output. Existing generated files remained untouched.
- The source branch may gain new helper callers after this baseline. Recheck the companion inventory if implementation is rebased before merge.
