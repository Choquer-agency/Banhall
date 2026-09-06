# B10 read-only preflight

2026-09-05. Read current helper/gate, actual route/component tests and stubs, backend getAccess, approved historical amendment and later current domain amendments. No source, canonical spec, ledger or runtime/test changes. Draft inspected: `planning/drafts/spec-branch-b10-workspace-branches.md`.

## Policy and scope

No conflicting approved policy found. Exact source `d0669fec95d4145b3be34a6f6b2b5e76db276cc7`, domain section “2026-09-03 (second) — The preview workspace is on for every internal role”, records project-owner approval and expressly preserves inner authorization, URLs/params, rollback and schema storage. Current `convex/workspaceRollout.ts:11–18` already requires project.readInternal and returns available:true; it has no cohort/master-switch read or product writer. No backend change is needed.

Append only that approved section before current Amendment process. Keep current later sections byte-identical: 2026-09-04 reviewer decision1560, absolute QA1605, selected knowledge privacy1615, digest diversity1677 (line anchors will shift after insertion). In particular preserve ownerId attribution, agents-propose/humans-apply, QA blocking and exclusion/provenance rules. The historical amendment's statement that old backend/admin tests were deleted describes earlier work; do not use it as authorization to delete unrelated current tests. Update obsolete line references only without changing the decision.

Current resolveWorkspaceExperience has no production caller; localDevelopment's only production argument is already literal false in WorkspaceGate. Removing them is behavior-preserving for actual callers. Historical `76f9aca3c973a805a32cc5466cacd11d61ca080e` Projects URL pin is already superseded by current stronger pathname/default/repeated/Unicode-param matrix. Preserve it, do not replace with raw URL equality or force layout=list when explicit layout=board/status grouping exists.

## Query stub: exact supported semantics

`__setQueryError(name,error:unknown)` at54 requires an explicit second argument and does not clear existing data. `__setQueryData` at49 clears an existing error. useQuery.error at169 suppresses errors when getArgs returns skip; data also becomes undefined and isLoading returns true while skipped. Gate checks error before data, so a stale available:true plus explicit error must resolve current. An omitted error silently fails to establish error, as earlier identified. Keep the shared stub byte-identical.

Current component tests import only __setQueryData. Add __setQueryError and existing __isQueryActive/__activeQueryCount/__activeQueryArgs as needed; no new stub API is necessary. Count **active** registrations, not useQuery construction: a skipped reactive query still registers a getter. The stub supports reactive URL changes via __setPageUrl and auth changes via __setAuthState.

## Concrete executable coverage gaps to close within allowed tests

1. Current WorkspaceGate case “keeps current subtree mounted on error and on an unavailable decision” at118 only seeds available:false; it never raises an error. Convert live failed-access cases to explicit Error fixtures and retain defensive false behavior in pure tests. Add error-with-stale-available:true to verify error precedence; later __setQueryData(true) must clear error and recover to preview where appropriate.
2. Current override tests seed workspace=current before mounting. They prove rendered outcome, not an active subscription becoming skipped mid-load/error. Add a same-mount transition: authenticated no override/loading has active access query; set workspace=current and assert active count0 plus current outcome; seed an error while skipped and confirm override persists. Remove override to assert the error takes effect without stale preview. Use snippet shape to avoid accidental navigation teardown while measuring subscription state.
3. Anonymous case must assert access inactive as well as login navigation. Add auth-loading state explicitly if claiming complete auth matrix: no subtree/redirect while auth loads, then signed-out login with replaceState and no access subscription. These are fixtures, not real capability execution proof.
4. Preserve both loading defaults. currentWhileLoading defaults true: compatibility current snippet mounts during unresolved access. Canonical currentHref routes and report currentWhileLoading=false show neutral pending state, no subtree or premature redirect. Do not “standardize” all loading to neutral; draft's shorthand must not erase this distinction.
5. Replace deleted resolver-to-resolver equivalence tests with explicit expected outputs. Recommended retained pure matrix: workspaceParam current/preview/null/empty/invalid crossed with loading/error/ready:false/ready:true. Current always wins; otherwise loading stays loading, ready:true preview, error/ready:false current. Test skip predicate for the same five params. Run this matrix before deletion with localDevelopment:false and after without the argument. Do not keep a removed helper in test-only code or compare two copies of the algorithm.

The defensive available:false pure case intentionally remains even though live backend is true-or-throws; route false fixtures should be renamed/replaced as failed-access paths instead of portraying a real unflagged cohort. A retained explicitly defensive component false test is acceptable if honestly labelled, but not necessary for the amendment's live path proof.

## Route and execution selection

Existing three component paths are correct and run in ordinary Chromium only under unchanged canonical configuration:

`node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts 'src/routes/project/[id]/projectRoute.component.test.ts'`

Retain current route param matrix including duplicate params/Unicode, exactly-one report subtree proof, current override and neutral loading. Current /dashboard maps view=all_projects to /projects, otherwise /my-work; it removes only view and preserves the other params. Canonical current fallback targets dashboard with appropriate view. New failed query tests should assert actual rendered branch/soft navigation options, not only stub state.

Existing settle helper uses50ms; no new fixed sleeps should be added. New positive transitions should await actual DOM/query/navigation readiness with bounded assertions. Parent owns the final unified gate and policy/spec approval. No need to edit component config's stale dev comment in this scope because config is protected; report it as a retained documentation-only limitation if desired rather than broadening files.

## Recommended draft corrections

Add the explicit stale-data/error/recovery and same-mount skip matrix, qualify three loading shapes, replace self-comparison with a fixed expected-state table, preserve current URL matrix, and use full source SHAs in provenance. Existing allowed test files and APIs can implement all corrections; no extra production/stub/backend path is needed. These are missing verification cases in the current draft, not newly discovered product behavior changes.
