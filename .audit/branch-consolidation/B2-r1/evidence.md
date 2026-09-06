# B2 revision 1 implementation evidence

Baseline and owned workspace: `b2d5db5b63c0a70bce20d86df56e11ffbe89fad9`, `/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation`. Initial status contained only the supplied untracked spec. Read the complete spec, its sole frontmatter context AGENTS.md, factory rules, B2 planning and five-file preservation manifest before implementation. The spec governs scope and reserves staging and final integration verification to the parent.

## Changes and preservation

Restored the five preserved source snapshots, then added two actual-Editor caller cost tests, distinct duplicate replacement identities, unchanged-prose/explicit-save checks and accurate zero-walk comments. Editor and benchmark exactly match their preserved snapshots. Helper changes beyond the snapshot are documentation only; golden cases remain unchanged. `final-preservation.json` records all five final and reference hashes. `baseline-hashes.json` hashes all existing tracked files; comparison confirms only Editor.svelte changed among them. Parser repairs, backend authority, dependencies, configuration, native ledger/state and historical screenshots are unchanged. No staging, commits, dependency installation or other worktree mutation occurred.

## Acceptance evidence

- Fresh baseline: four rendered pins passed in one ordinary Chromium instance. Benchmark counted 600 walks at both 22,790 and 91,490 characters.
- Final benchmark: 30 walks for 30 builds with 20 pairs at both sizes. Both baseline/final match-position SHA256 values are `97e33b1b41e05229838b63cdc1f9bde97b8d265c7e4138f0dfee37303cf85397`. Source hashes are embedded in benchmark output. Timings are observations, not thresholds; parser appendix is unchanged and is not PDF integration proof.
- Final and restored runs: 12 helper tests and six actual Editor tests pass. Browser output selects Editor once in ordinary Chromium, with no pointer-instance execution. Preserved four behavior pins cover merged strikes, per-pair widgets, clearing, casing/sorting, explicit range edits and reference fallback. New preview cost expects two walks (batch plus existing scroll lookup); new findReplaceMatches cost expects one walk, with blank and distinct duplicate replacement slots.
- Authority and stepped-edit pins: 33 tests pass across convex/chatProposals.test.ts and tests/chatProposals.test.ts.
- Four separate deliberate controls fail at the intended cost assertion: preview per-needle caller 21 versus 2 walks; find caller 20 versus 1; per-needle helper 20 walks/folds versus 1; omitted empty guard 1 versus 0 walks. Caller controls keep the helper batched. `run-proofs.py` restores original bytes in finally blocks and asserts exact restoration after each control. Final restored suites pass. Control sources use `.snapshot`, not executable historical test copies. Test-name filtering explains skipped tests in control receipts; no maintained tests are skipped or relaxed.
- Initial probes are retained under `initial-save-probe/`: a prototype spy did not observe the bundled editor's document, so the final test spies directly on the mounted instance. An initial expectation incorrectly treated explicit flush as a no-op; inspection of flushPendingSave established that explicit flush saves current JSON. Final tests assert no save before flush and unchanged seed JSON after explicit flush.
- `npm run check` initially lacked PUBLIC_CONVEX_URL. The environment-qualified rerun uses public placeholders, matching repository preflight practice. See its exit below.

## Commands and raw receipts

Commands ran from the owned workspace. Each JSON receipt retains exact command and exit; final/control receipts also retain source hashes. Baseline source identity is recorded by baseline hashes and benchmark context; baseline test and benchmark bytes came from the hash-validated preservation manifest.

| Command | Exit | Raw output |
| --- | --- | --- |
| `node node_modules/vitest/vitest.mjs run convex/chatProposals.test.ts tests/chatProposals.test.ts --expect.requireAssertions` | 0 | `authority.log` |
| `node scripts/bench/editor-search.mjs` | 0 | `baseline-bench.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 0 | `baseline-browser.log` |
| `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions -t "does not walk"` | 1 | `control-empty.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions -t "batches actual findReplaceMatches"` | 1 | `control-find.log` |
| `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions -t "batch cost"` | 1 | `control-helper.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions -t "batches actual preview"` | 1 | `control-preview.log` |
| `git diff --check` | 0 | `diff-check.log` |
| `node scripts/bench/editor-search.mjs` | 0 | `final-bench.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 0 | `final-browser.log` |
| `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 0 | `final-unit.log` |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 0 | `restored-browser.log` |
| `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 0 | `restored-unit.log` |
| `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud PUBLIC_CONVEX_SITE_URL=https://placeholder.convex.site npm run check` | 0 | `typecheck-env.log` |
| `npm run check` | 1 | `typecheck.log` |

## Parent handoff and limitations

Ready for independent review. Per spec, worker did not stage new files or run the parent-owned post-staging discovery/canonical gate. Parent must stage reviewed files, run `node scripts/check-test-discovery.mjs`, and coordinate `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on final source. `git diff --check` passes. Full integration acceptance remains pending those steps. Existing duplicate Underline warning remains intentionally for B5. No Unicode/hardBreak matching expansion or authenticated browser interaction claim is made.

## Parent final review and patches

The second three-layer BMAD review found no verification gaps. Root triaged each finding, registered proven inherited Unicode/hardBreak defects through native API as DW-101/102 for B13, corrected one inaccurate fixture comment, added zero empty haystack-fold assertions and made the counter fixture-length assumption executable. All12 helper tests passed after patches. Root-reviewed-source.json binds final five-file bytes. The original worker log and dispatch metadata were preserved by its receipt reorganization under initial-save-probe, not deleted. Canonical staged discovery and the full gate follow before commit.

## Parent final gate

`VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed all nine steps (exit0; 170.317 seconds): 1,992 unit and 469 browser tests, both typechecks, build, discovery, 50 PowerShell and 18 shell harness assertions. `gate/result.json` binds the raw log and verifies 4,969 tracked files with no unexpected changes. Parent rechecked every hash in `root-reviewed-source.json` before marking the spec done.
