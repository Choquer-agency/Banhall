# B10 implementation evidence

## Authority and ownership

Implemented the complete spec at `_bmad-output/implementation-artifacts/spec-branch-b10-workspace-branches.md`; read its sole frontmatter context file, `AGENTS.md`, and `.factory/AGENTS.factory.md` before edits. Spec restrictions supersede the generic factory workflow. No install, stage, review dispatch, commit, push, merge, other-worktree edit, native-state/ledger edit, or loop restart was performed.

Initial checkout: `codex/branch-consolidation`, HEAD `8511662cb8fd9748d02f413c633bf21b5cdec9ee`, exactly the spec baseline. Initial status contained only the untracked spec. Existing prior batches were preserved. Before verification, the login shell reported Node `v24.19.0` and npm `11.17.0`; no runtime installation was needed.

## Changes and acceptance proof

- Removed callerless `resolveWorkspaceExperience`, the unused `localDevelopment` branch/argument, and the unused gate `dev` import. Retained the three-state resolver and skip predicate. `workspaceExperience.test.ts` explicitly checks the fixed 20 route and 5 query observations, including defensive ready/false.
- Corrected only associated gate/route/environment-stub comments. Auth effects, navigation computation, loading defaults, query handling, inner components, and capabilities remain unchanged.
- Browser tests seed available data followed by an explicit `new Error("Access denied")`. Current paths now exercise actual query errors or overrides. A single mounted snippet gate proves loading with one active query, override with zero active queries and empty args, persistence of a skipped error, resubscription to that error, and recovery to preview through `__setQueryData`.
- Auth test proves neutral pending authentication, no subtree/navigation/subscription, then signed-out login navigation with `replaceState: true` and no subtree/subscription. Auth fixture defaults remain authenticated.
- Browser coverage preserves default compatibility loading, neutral canonical/report loading, real report snippet identity, Projects List/client defaults, explicit layout/group, repeated parameters, and Unicode. Navigation spies check actual calls, parsed pathname/parameters, and soft-navigation options. No new fixed sleeps; existing sleeps in the touched suites were replaced with DOM polling/Svelte tick.
- Appended the exact approved 2026-09-03 (second) amendment from `d0669fec95d4145b3be34a6f6b2b5e76db276cc7`, updating only stale line-number references to section names as permitted by planning. `boundaries.log` proves removing the inserted amendment reproduces the entire baseline document, including later reviewer, QA, privacy, and diversity amendments.

## Commands and receipts

All commands ran in the repository root with installed Node 24.

1. `node node_modules/vitest/vitest.mjs run src/lib/dashboard/workspaceExperience.test.ts --reporter=verbose`
   - Before deletion, with explicit `localDevelopment: false`: exit 0, 25/25 passed, `truth-before.log`.
   - After deletion, without the argument: exit 0, 25/25 passed, `truth-after.log`.
   - The pre-deletion source and test bytes are retained as `before-workspaceExperience.ts` and `before-workspaceExperience.test.ts`.
2. Fresh executable observation receipts (replayed against the saved pre-deletion source and final source):
   - `node .audit/branch-consolidation/B10/observe.mjs .audit/branch-consolidation/B10/before-workspaceExperience.ts before > .audit/branch-consolidation/B10/table-before.tsv` (exit 0).
   - `node .audit/branch-consolidation/B10/observe.mjs src/lib/dashboard/workspaceExperience.ts after > .audit/branch-consolidation/B10/table-after.tsv` (exit 0).
   - `cmp .audit/branch-consolidation/B10/table-before.tsv .audit/branch-consolidation/B10/table-after.tsv` (exit 0).
   - Each table contains 25 actual results asserted against explicit expectations. Both SHA-256 hashes: `01ccd135ebe5ca516834ac451ec852ad47f91cccc0fc928262a25df8a3092e1a`.
3. `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/workspace/WorkspaceGate.component.test.ts src/routes/workspaceRoutes.component.test.ts 'src/routes/project/[id]/projectRoute.component.test.ts'`
   - Final exit 0: 3 files, 32 tests passed in Chromium; `browser.log`.
   - Initial instrumentation run exited 1 (8 failed, 21 passed), `browser-initial-failed.log`: auto-spying cloned the exported navigation-call array. Assertions were corrected to inspect the actual `goto` spy; no production or shared stub changes were needed.
4. `npm run check` initially exited 1 because `PUBLIC_CONVEX_URL` was unset, producing two missing generated public-env export diagnostics (`check-missing-env.log`). Repeated with the verification harness's public placeholder convention:
   `PUBLIC_CONVEX_URL=https://verify-placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://verify-placeholder.convex.site npm run check`
   Final exit 0: `svelte-check found 0 errors and 0 warnings`, recorded in `check.log`.
5. `git diff --check`: exit 0, `diff-check.log`.
6. SHA-256 boundary comparison: exit 0, `boundaries.log`. Of 5,923 tracked baseline files, only the 11 spec-authorized source files differ. The 1,436 protected tracked backend/stub/config/ledger/audit files remain byte-identical. No tracked historical screenshot changed. `baseline-hashes.json`, `protected-hashes.json`, and `final-source-hashes.json` retain the receipts. Native ignored state was never accessed for mutation; the tracked-file manifest is not a claim of before/after coverage of ignored native state.

## Limits and handoff

The implementation and targeted browser/pure proof are complete. As explicitly assigned by the spec, the parent still owns review, `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, staging/commit, and integration. No full gate, deployment, or live Convex authorization test was run. Browser suites exercise real Svelte routes in Chromium with the existing shared query/auth stubs. The protected browser config retains its old dev-related comment because the spec requires it unchanged. Audit receipts are in the ignored `.audit` tree and were not staged.

## Parent review and patched proof

Three independent review layers and all thirteen blind finding dispositions are in review-triage.md. Parent strengthened goto assertions to require exactly one call, same origin, exact pathname, parameter multiplicities and replaceState:true, with readiness polling; the expected pure table now has a fixed four-state tuple. Final targeted receipts in parent-patched-final.json show25 pure tests and32 Chromium cases passing.

Strict navigation initially exposed the same second call on candidate and exact baseline, proven by parent-navigation-comparison.json. Scoped mocks now observe requested navigation without retaining a source route after a simulated destination URL update. These are source-route component proofs with query/auth stubs, not live destination-router or backend-authorization proofs. Raw failing probes are retained.

Independent policy comparison preserves every existing policy byte and repairs only two stale historical references; see policy-audit-final-conclusion.md and retained raw comparison exit1. Parent full gate is recorded separately under gate/result.json when complete.

## Parent acceptance

Full Node24 gate passed all nine steps:2020 unit tests and482 Chromium cases, typechecks, discovery, build and both uploader harnesses. gate/result.json binds the log SHA256,165.54-second run and5,937 tracked-file comparison; zero unexpected changes. Eight regenerated maintained historical captures were saved under gate/captures and original bytes restored. No standalone B9 runtime run is invented; this is the combined B9+B10 proof.
