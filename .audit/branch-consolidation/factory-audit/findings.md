# Outstanding factory branch work against shipped main

Read-only BMAD preparation, 2026-09-05. Exact revisions are recorded in integration-batches.json: origin/main cc6b706c3b43f971d944cb703a4174eabf3134d9, sprint2-boundary5ec93e594eda60c28da2cfdbf27fb668fd55eb3d, workspace2c2211d0. No tests, implementation, merges, loop invocation, ledger or source writes were performed. Only this audit directory was written. BMAD Help catalog routes the actual reconciliation through bmad-build and its independent review, which parent owns; this is source/evidence inventory, not a completed build or acceptance verdict.

## Material missed work

Main is not merely missing history labels. Its relevant blobs exactly equal the parents of the following unmerged fixes:

- PDF parsing leaves deadline timers alive until the shared minute expires. f82f2b0 retains and clears each race timer. Historical real parser/fake-clock evidence reports7/1/2/5 outstanding timers in four failing baseline cases.
- Editor preview/find-replace rebuilds a document search index per needle. e4495a5 batches the index and lowercase pass once; historical600→30 walks with identical position hash. New actual Editor suite and benchmark are absent from main.
- Empty supporting-file uploads still read all previous bodies before deciding they cannot be deduplicated.18f383c moves the blank predicate before the query; historical real mutation counters stay2queries/2docs/375bytes independent of three existing bodies.
- Seventeen abandoned components/My Work island files remain; immutable main import searches show only their own island/tests referencing them. Nine-file and eight-file deletions remain substantive cleanup, not replacement of current views.
- Test-only helpers, duplicate Underline registration, four unused direct dependencies and Bun artifacts remain. Preserve supported helper APIs while removing only the ticket’s enumerated dead exports.
- Header New project action still has the exact pre-fix product bytes: its main browser test at src/lib/components/workspace/WorkspaceHeader.component.test.ts:157-169 explicitly pins32px at390px. d7036f7 proves44px mobile floor while preserving32px desktop. This is a concrete intended-contract reconciliation, not permission to weaken geometry tests.
- Real endpoint proposal/access/roster coverage is partially missing, but its old deletion plan is stale on main: main tests/chatProposals.test.ts now runs actual convex-test and contains later provenance/authorization coverage.
- Workspace dead resolver branches still exist. Backend workspace1 prerequisite is already present: main convex/workspaceRollout.ts:getAccess requires project.readInternal and returns available:true. d0669fe removes callerless resolveWorkspaceExperience and never-used localDevelopment override, preserving query-error/current rollback behavior.

## Ordered integration plan

The machine-readable integration-batches.json provides ten coherent batches, exact full commit IDs, complete required source-file unions, dependencies, intended behavior, gate requirements and conflicts. Suggested execution order B1→B2→B3→B4→B5→B6→B7→B8→B9→B10 minimizes file overlap; independent batches can be reviewed separately. Use source commits, not whole ticket-status/planning commits. Do not call them cherry-pick-clean solely from blob equality: this audit did not execute an index merge.

1. Parser timer repair plus sequential deadline fixture (f82f2b0,d381a68 parser hunks).
2. Batched Editor search/benchmark/component proof (9ee49b2,1e84c27,e4495a5, remaining d381a68 fixture hunk).
3. Blank upload read avoidance (18f383c).
4. Dead component/My Work islands (ae27b5c,28c0c0c), with directly stale doc references.
5. Dead helpers/duplicate Underline (fb6c6b5,0017ee6), after Editor integration.
6. Current real proposal/access/roster coverage (0fdcacf,d9ee062,c755e00), preserving main’s newer real tests.
7. Unused dependencies/Bun cleanup (8649315, selected ad9952f), after tests/helpers.
8. Mobile Header sizing (d7036f7) with adapted current assertions.
9. Remaining env/setup/historical-doc corrections from DX commit chain, selected hunks only.
10. Workspace dead branches/amendment (d0669fe,76f9aca), retaining current stubs and routing proofs.

## Already incorporated or superseded

- bbdd2b1’s pure Bun-to-Vitest imports are already on main: nine compared pure suite blobs exactly match sprint tip; current main has all215 executable files discovered. Main’s legacy-unit/node plus Convex/edge projects intentionally differ from branch’s all-tests-edge arrangement. Retain that architecture unless a specific new runtime need proves otherwise.
- 11bfe3e’s duplicate include repair is structurally already resolved; main has one include block. Branch tsconfig changes are not a reason to replace broader generated declaration coverage.
- Unified numbered gate, public placeholders, two CI jobs and Node24 are already integrated and strengthened by186029d. CI and .nvmrc blobs equal sprint tip; main discovery guard additionally preserves raw NUL paths and exactly3 archives. Main preflight launches the supported headless browser; original branch guard must not overwrite these repairs.
- ca79e76 Projects URL fixture,494a575 sign-out flow and e581436 admin eligibility intent are superseded by stronger passing current browser suites. Preserve later keyboard/focus/admin exposure cases, learning-health destination, and c925697 isolated pointer instances. 4cc4a85’s removal of literal class inventory is optional test simplification, not evidence of a currently failing contract; its added actual Button44px assertion can be ported without deleting current reduced-motion checks.
- All current boundary/learning product code, QA absolute-block policy, privacy/diversity admission, feedback read bounds and original-error identity repairs, pending research and optimistic origin routing remain authoritative. No source commit in these factory batches calls for changing those semantics.

## Concrete conflict boundaries

- tests/chatProposals.test.ts: branch deletes an old fake-db file; main has replaced it with real authenticated endpoint tests. Keep it. Add unique cases from final new convex/chatProposalsApply.test.ts, adapting fixtures to current provenance/PED lifecycle. tests/reportEdits.test.ts extraction edge cases and tests/snapshots.test.ts newer lineage assertions must also survive. Deleting fake access/roster cases needs exact current case-name replacement mapping, not the historical34-case aggregate alone.
- src/lib/test/convex-svelte-stub.svelte.ts: main already supports __setQueryError at54 and skip-aware error getter at169-170 plus stale/variant/subscription behavior. workspace2 adds an older simpler error model. Reuse current helper; never replace file wholesale.
- docs/product-domain.md: append only workspace2’s approved55-line amendment before Amendment process. Main’s September4 absolute QA/privacy/diversity amendments at1560+ are absent from branch; preserve all of them. No rollout table deletion/schema migration is authorized by workspace2.
- docs/system-map.md: select Q8 closed row only. Branch whole-file content would falsely revert actual live learning-health/PED/rerank arrows to dead ends and AD12 to unimplemented.
- Header current test at165 conflicts with requested mobile floor; adapt mobile assertion while retaining desktop/theme/href/focus behavior. Branch WorkspaceRail test would remove current keyboard, unique-icon and role-matrix coverage; preserve these. Branch WorkspaceChrome would remove isolated pointer suite support if transplanted together with its config.
- package-lock and tsconfig changes overlap dependency cleanup and runner cleanup. Apply cumulative intended deletion against current graph; do not downgrade versions or overwrite native transformer generated include fixes.
- .factory status files are not source acceptance: workspace2 tip ticket is todo and was reported escalated by sibling audit, even though local evidence says test-verified. Root must reconcile actual outstanding source markers before any status change. This audit does not assert it is native/factory complete.

## Evidence and limits

commit-inventory.json inventories every non-merge commit with non-planning source changes, full source/tip/main/parent blob IDs and equivalence flags. Per-commit .diff files preserve exact source patch provenance. Copied twelve factory tickets provide full frozen acceptance/deferred obligations. Historical local evidence.md files were present only in ignored original .audit, not branch trees; copies and SHA256 provenance are in local-evidence-source-manifest.json. They are historical claims inspected here, not fresh executions.

Historical deficits remain explicit: parser proof does not exercise real PDFs in a browser; Editor benchmark does not prove ReadOnlyEditor search performance; nonblank upload collect remains; deletion proof does not cover unrelated branches or authenticated full app; workspace truth-table generator was discarded and live authenticated navigation was not performed; some QA command allowlists blocked controls but root/engine receipts later resolved named gaps. The proposal mapping count was corrected to34old cases rather than physical rows. Main integration must rerun the applicable unified gate and genuine before/after controls where the changed source fixes a demonstrated bug.

Required auxiliary verification scripts live under original .factory/plans/20260904-code-quality-sweep/: underline-registration-proof.mjs, upload-read-baseline.mjs and performance-benchmark.mjs (maintained benchmark is scripts/bench/editor-search.mjs). Preserve/copy only exact needed controls as audit tooling after review; do not import capture-final-proof.py, old raw gate logs or factory planning/status wholesale. verify-gate-preflight.mjs is older than current guard repairs and not authority over them. .factory/factory.toml’s smoke=[npm run test:component] is a factory engine setting; parent owns whether to reconcile it, with no loop restart.

## Recommended next action

Freeze a parent BMAD integration spec from the ten-batch manifest, preserving current main invariants and explicit evidence deficits. Integrate clean coherent patches in that private checkout, resolve the specific overlaps above, review/prove each behavior and finish with canonical combined nine-step Linux/GitHub acceptance. Preserve original branch refs until all actual source work and historical receipt obligations are accounted. Do not equate an ancestry-only merge or an all-ours resolution with completion.
