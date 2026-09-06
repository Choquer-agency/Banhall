B5 revision 1 implementation evidence

Baseline: d22e1fa0880512212865d7d60aeb8cfe600dbaa2, branch codex/branch-consolidation. The full spec, its sole frontmatter context AGENTS.md, and .factory/AGENTS.factory.md were read before implementation. The spec controls the worker scope. Login-shell runtime was checked before verification: Node v24.19.0, npm 11.17.0. No installation occurred.

Changes:
- Removed only the named title wrappers, retired grouping/filter helpers and structures, report-section projection/type, and explicit Underline import/registration.
- Migrated title and browser prefill assertions to stashProjectStart/takeProjectStart, preserving full transcript payload, one-use consumption, editable title and duplicate-project precedence. Unit setup consumes module state with deterministic time. Added TTL-equal admission; retained TTL+1 rejection, empty normalization and length coverage.
- Formatter tests use supplied aggregates. Total 12 deliberately differs from bucket sum 7. Reverse input keys include delivered/on_hold and assert pipeline order. Explicit zero canonical/legacy buckets and absent buckets are omitted. All approximate labels are asserted.
- Added the isolated registered getFacets fixture with four persisted rows: drafting/review, on_hold/review, drafting/final and stage-less/review. Exact endpoint result asserts drafting 2, on_hold 1, legacy 1, total 4, non-truncated and empty other facets. This passed before deletion and after; no backend fix was made.
- Added the ordinary src/node Underline suite using actual Editor/getEditorExtensions and element:null. Both modes assert exactly one registration, zero duplicate warnings and full initial/final JSON; editable mode checks off/on toggles and exact unmarked JSON. Finally blocks destroy editors and restore console spies.

Fresh verification:

| Proof | Before | After | Receipts |
| --- | --- | --- | --- |
| Spec's five helper/backend files, including new registered facet case | 47 pass | 40 pass | baseline-helpers.log, after-helpers.log |
| Exact planning/B5 prefill/workspace/Editor browser selection | 47 pass | 47 pass | baseline-components.log, after-components.log |
| Unchanged maintained Underline suite, requireAssertions enabled | 2 fail, four uniqueness/warning failures | 2 pass | baseline-underline.log, after-underline.log |
| Owned real Editor proof | Both modes: explicit 1, registrations 2, duplicate warnings 1 | Both modes: explicit 0, registrations 1, duplicate warnings 0 | baseline-proof.log, after-proof.log |
| Preserved B13 actual-schema helper regressions | Source unchanged | 40 pass | preserved-b13-helper.log, final-hashes.json |
| Convex typecheck | Not needed for failure control | Exit 0 | convex-typecheck.log |
| npm run check with repository public placeholders | Not needed for failure control | 0 errors, 0 warnings | app-check.log |
| git diff --check | | Exit 0 | diff-check.log |

commands.jsonl contains exact argv, timestamps and exit codes for every verification run. Baseline failure is intentional and retained. The maintained suite was not edited between its failing and passing runs. The baseline getFacets fixture also remained unchanged.

Proof provenance:
- source-manifest.json records both specified historical commit identities and affected blobs, the exact historical proof blob, runtime and current baseline.
- B2 commit 1d6053388326fe4fde43a86177955157f11ce588 and B13 commit 0d481e2b76390e0eff3208d91f1f47d83b173474 are confirmed ancestors. Their four editor source/test files and convex/dashboardStageCounts.test.ts retain baseline hashes.
- baseline-hashes.json and final-hashes.json identify source content. final-source contains reviewable snapshots of the eleven changed source/test files and preserved controls. final.diff contains tracked changes; the new maintained test is also retained in final-source/src/lib/tiptapConfig.test.ts.
- historical-proof.mjs is unchanged blob a24d9b656f774417664c97f9d5d440df2e96da04, confirmed by factory-audit/auxiliary-verification-sources.json. underline-proof.mjs is the owned strengthened derivative. Only explicit --baseline selects expected duplicate behavior. Default expectations are unconditional zero explicit entries, one registration, zero duplicate warnings. No filtered candidate is used.
- Actual tiptapConfig SHA-256 before: aeda054d505e409986b73b9e3bf0e965b5050e656c8e50a84459eb0ddd6ad104.
- Actual tiptapConfig SHA-256 after: f0739d78e76bb085e8d09ed30e8f0d11fba70e7064ae686605397e7feac4571d.
- callers-before.txt shows only definitions and test callers. callers-after.txt is empty; callers-after-result.json records rg exit 1 as no matches.

Retired-case accounting:
- Eight cases exclusively exercising retired groupRowsByStageRank/visibleStageGroups were removed with those APIs: three grouping cases and five display cases. The two verifiedStageCounts cases remain unchanged.
- Three old filter tests were migrated into three supplied-count formatter cases. Canonical-versus-legacy row classification now has real registered endpoint coverage, passing before deletion. These formatter tests do not claim to classify rows.
- Three handoff unit cases remain with wrapper assertions migrated; one TTL-boundary case was added. All five prefill browser cases remain.
- Thus the focused helper/backend selection changes from 47 to 40: eight retired grouping cases removed, one TTL case added. The new facet case is included in both totals.
- test-case-accounting.json records every before/after test title, including unchanged backend and B13 controls. No skip, discovery exemption or dependency/config change was added.

Limits and handoff:
- No implementation item remains incomplete. Fresh independent reviews and the final VERIFY_COMPONENT=1 bash scripts/loop-verify.sh remain parent-owned, as required by the spec. No commit, stage, push, merge, reviewer dispatch or native ledger/state edit occurred.
- Underline read-only evidence is real headless Editor construction, not a mounted ReadOnlyEditor browser test or full-app navigation claim. The separate canonical browser selection exercises the editable Editor and workspace/prefill paths.
- Canonical browser runs emit the existing no-Svelte-config informational warning. Duplicate Underline warnings appeared before and disappeared after.
- Git status after browser runs showed no changed historical screenshots. The incoming untracked spec remains untouched. Audit evidence is under the repository's ignored .audit directory and must be deliberately retained by the parent.

Parent acceptance: all three fresh review layers completed; no remaining source/verification gap. Full Node24.19.0/npm11.17.0 command passed2011 unit and478 browser tests, typechecks, discovery, build and50+18 uploader harness assertions. Wrapper separately detected an extra historical capture. It was traced to OptimisticSend.component.test.ts:579, inspected, decoded and restored: all911 shared rows identical, only19 white baseline rows differ. Both images/raw result preserved; gate/acceptance.json documents closure without relabeling wrapper exit1. Product source did not change; staged candidate remains intact. Both B5 attempts are losslessly archived with manifests.
