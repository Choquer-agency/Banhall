# B5 implementation evidence

Baseline: `d22e1fa0880512212865d7d60aeb8cfe600dbaa2` on `codex/branch-consolidation`.
Runtime: Node `v24.19.0`, npm `11.17.0`, selected by the login shell without installation.

The complete spec and its sole frontmatter context file, `AGENTS.md`, were read before implementation. The spec controls scope and reserves independent review, the combined gate, commits and shipping to the parent. No staging, installs, dependency/config changes, backend implementation edits or native state/ledger edits were performed.

## Source receipts

`source-manifest.json` records both historical source commits, their path blob identities, B2/B13 ancestry, unchanged B13 reviewed hashes and protected file hashes. `baseline-hashes.json` and `after-hashes.json` identify actual source bytes. The registered facet fixture was added before deletion and remained identical for both runs; its identity is also in the manifest. `review.diff` is the narrow ten-path patch. The spec remains unchanged.

The owned `underline-registration-proof.mjs` derives from blob `a24d9b656f774417664c97f9d5d440df2e96da04`, identified by planning/B5.md and factory-audit/auxiliary-verification-sources.json. It adds full initial/final JSON equality and actual tiptapConfig SHA-256, and removes the synthetic in-memory candidate variant. Both runs construct actual current-source `Editor` instances with `element: null`, editable true and false.

## Acceptance results

| Evidence | Before | After |
| --- | --- | --- |
| Exact specified helper/backend selection | 5 files, 47 tests passed | 5 files, 40 tests passed |
| Exact planning/B5.md component selection | 5 files, 47 tests passed | 5 files, 47 tests passed |
| Underline explicit entries, both modes | 1 | 0 |
| Underline registrations, both modes | 2 | 1 |
| Duplicate warnings per editor, both modes | 1 | 0 |
| Full initial and final JSON equality, both modes | true | true |
| Editable underline off/on | true/true | true/true |
| Convex TypeScript check | Not run | exit 0 (`after-convex-typecheck.log`) |
| git diff --check | Not needed before source edits | exit 0 |

`commands.jsonl` retains exact commands, durations and exits. Full outputs are `before-unit.log`, `after-unit.log`, `before-component.log`, `after-component.log`, `before-underline.log`, and `after-underline.log`. The baseline underline proof correctly exits 0 because it validates the observed duplicate condition, not acceptance of that condition after the fix. Post-edit proof consumes changed disk source, not filtered candidate extensions. The browser selection also lost its duplicate-extension warnings.

The new registered case `getFacets classifies canonical stages independently of legacy status` inserts four real projects in an isolated convex-test database, then queries `api.dashboard.getFacets`. Exact output is drafting 2, on_hold 1, legacy 1, total 4, truncated false, and empty owner/industry/science facets. It passed before and after source removal, demonstrating preservation with no backend fix.

## Retired-case accounting

- Eight tests for deleted grouping/display algorithms were retired: three groupRowsByStageRank cases (pipeline remapping, loaded-run completeness, missing-rank behavior) and five visibleStageGroups cases (exact-zero hiding, absent-count qualification, zero/unverified presentation, loaded-row precedence, conditional legacy). These algorithms have no live consumers; `callers-before.txt` inventories every reference. Both verifiedStageCounts cases and their exact/inconsistent/undefined/empty assertions remain unchanged. Existing workspace browser tests and company count maintenance/backfill tests remain intact and pass.
- The three row-based stage-filter helper tests became three supplied-count formatting tests. Canonical versus legacy row classification is now asserted at the registered backend endpoint, while formatting asserts populated ordering, empty and legacy cases, exact supplied total labels, and every emitted approximate label. Formatting tests make no row-classification claim.
- The title wrapper case now calls stashProjectStart/takeProjectStart. Full transcript payload and second-consume emptiness remain, with deterministic times and module-state clearing. One additional case proves admission exactly at TTL and one-use consumption. The existing stale case proves TTL+1 rejection, and empty/length cases remain.
- All five prefill component cases remain, including editable title, transcript payload and duplicate-project precedence. Each beforeEach clears the module through takeProjectStart before stashing.
- ReportSections/extractSections and explicit Underline registration are removed without changing live metrics, shared stage metadata, StarterKit settings or dependencies.

The selection count changes by minus eight retired grouping cases plus one TTL case: 47 to 40. The new backend preservation test was already present in the 47-test baseline.

## Limits and parent handoff

The underline proof is headless editor construction, not mounted ReadOnlyEditor browser evidence. The component suite exercises the actual editable Editor and wizard/workspace components. No full-app navigation claim is made. No tracked historical screenshot changes were produced by these component runs. Protected B13 helper/browser regressions and package files match their baseline hashes.

Parent still owns fresh independent reviews and `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, final admission, commits and shipping. These are intentionally pending under the spec, not claimed complete by the focused receipts. Audit artifacts live under the repository-ignored `.audit/branch-consolidation/B5/` directory and must be retained by the parent handoff.
