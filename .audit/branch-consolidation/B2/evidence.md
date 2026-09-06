# B2 implementation evidence

Baseline: `b2d5db5b63c0a70bce20d86df56e11ffbe89fad9`, branch `codex/branch-consolidation`, owned consolidation workspace. Read the complete spec, its sole frontmatter context file `AGENTS.md`, and `.factory/AGENTS.factory.md` before implementation. The spec takes precedence for workspace, scope, installation and parent-owned finalization. Initial status contained only the untracked spec.

Implementation is complete in the five allowed files. Acceptance remains pending browser execution and parent finalization. No staging, commits, installation, backend/config changes, ledger changes, other worktree changes or review workers.

Extracted position-aligned normalization/index/search into `docSearch.ts`, delegated single-needle search to the batch, and batched preview and `findReplaceMatches` consumers. The spec calls the latter `findReplaceAllMatches`; the actual existing exported name is preserved. Editor diff is exactly the scoped historical refactor. Corrected the historical inaccurate normalization comment. Added the maintained real-decoration benchmark, four browser pins (including empty search assertions), and 12 unit cases.

## Fresh acceptance evidence

| Criterion | Evidence | Result |
| --- | --- | --- |
| 30 walks per 30 builds, 20 pairs | baseline-bench.log, after-bench.log, benchmark-comparison.json | 600 to 30 at 22,790 and 91,490 characters; match-position SHA-256 identical at both sizes |
| Matching and batch matrix | after-unit.log | 12 tests pass, including golden offsets/casing, punctuation, whitespace, empty blocks, non-overlap, fallback, blank/duplicate slots, one walk and one fold |
| Rendered writer behavior | baseline-browser.log, after-browser.log | Blocked before tests: localhost listen EPERM; no rendered-pass claim |
| Ordinary Chromium selection only | unchanged vitest.component.config.ts | Editor falls under ordinary Chromium; both pointer instances include only WorkspaceChromePointer. Runtime selection remains unverified due to EPERM |
| Proposal authority and revision/snapshot regression pins | authority.log | 33 tests pass in the two specified suites |
| Counter sensitivity | per-needle.log, no-empty-guard.log | Per-needle control fails 3 count assertions (20/19 walks, 20 folds); guard-removal control fails both zero-walk assertions |
| Protected paths and parser appendix | baseline-hashes.json, protected-paths.json, after-bench.log | All tracked paths except Editor retain original bytes; parser appendix unchanged, 201 allocated timers and zero pending |
| Type checking | check-public-env.log | Zero errors and warnings using documented placeholder public URLs |
| Whitespace | diff-check.log | Exit 0 |

## Commands and exits

Commands ran from the owned workspace unless `--root` identifies an isolated temporary control directory. Each row links raw combined output. The control runner is retained as `run-controls.py`; it copies the exact test bytes, mutates only isolated helper copies, and removes temporary executable tests. Mutations are retained as non-test `.ts.snapshot` files. Production helper bytes never changed during controls.

| Receipt | Command | Exit |
| --- | --- | --- |
| [baseline-bench](baseline-bench.log) | `node scripts/bench/editor-search.mjs` | 0 |
| [baseline-browser](baseline-browser.log) | `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 1 |
| [after-unit](after-unit.log) | `node node_modules/vitest/vitest.mjs run src/lib/components/editor/docSearch.test.ts --expect.requireAssertions` | 0 |
| [after-bench](after-bench.log) | `node scripts/bench/editor-search.mjs` | 0 |
| [after-browser](after-browser.log) | `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts --expect.requireAssertions` | 1 |
| [authority](authority.log) | `node node_modules/vitest/vitest.mjs run convex/chatProposals.test.ts tests/chatProposals.test.ts --expect.requireAssertions` | 0 |
| [per-needle](per-needle.log) | `node /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/node_modules/vitest/vitest.mjs run --root /var/folders/95/nr9fdn1d7gdf3q7qtf4_v34r0000gn/T/b2-control-oby_0th2 --config /var/folders/95/nr9fdn1d7gdf3q7qtf4_v34r0000gn/T/b2-control-oby_0th2/vitest.config.mjs --expect.requireAssertions` | 1 |
| [no-empty-guard](no-empty-guard.log) | `node /Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation/node_modules/vitest/vitest.mjs run --root /var/folders/95/nr9fdn1d7gdf3q7qtf4_v34r0000gn/T/b2-control-em7siija --config /var/folders/95/nr9fdn1d7gdf3q7qtf4_v34r0000gn/T/b2-control-em7siija/vitest.config.mjs --expect.requireAssertions` | 1 |
| [check](check.log) | `npm run check` | 1 |
| [check-public-env](check-public-env.log) | `PUBLIC_CONVEX_URL=https://example.convex.cloud PUBLIC_CONVEX_SITE_URL=https://example.convex.site npm run check` | 0 |
| [diff-check](diff-check.log) | `git diff --check` | 0 |

The first plain `npm run check` failed only because PUBLIC_CONVEX_URL was absent. The successful second check supplies the same class of public placeholders documented for verification preflight; no environment files were edited.

## Hashes and provenance

All initial tracked hashes are in `baseline-hashes.json`; exact five-file final hashes are in `final-source-hashes.json`. `editor.diff` records the reviewed production change. Benchmark source hashes are embedded in raw logs. Baseline Editor was byte-identical to the historical pre-refactor source. Benchmark provenance: `9ee49b2`; browser pins: `1e84c27` plus only the corrected title from `d381a689`; refactor/unit provenance: `e4495a5`, with normalization wording correction and additional edge cases. No parser hunks were applied.

## Remaining work and limitations

Parent must independently review, stage the new files, run `node scripts/check-test-discovery.mjs`, and coordinate `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` plus final `git diff --check`. These parent-owned steps were not run. Browser baseline and final checks must run in an environment permitting localhost listeners. The four browser tests are added but have no fresh execution proof in this sandbox. Existing dependencies were used because the spec forbids installation; installation freshness was not independently established. The benchmark measures synthetic CPU work from the actual decoration builder, not authenticated interaction, ReadOnlyEditor, or PDF integration. Timings are observations, not acceptance thresholds. Historical screenshots remained byte-identical.

## Parent browser verification completed

The worker sandbox limit was resolved by direct execution on the authorized host in the same owned checkout. Root ran the identical actual four-case Editor browser suite against the exact prior Editor bytes and the final Editor bytes; both exited0 with4/4 cases. The production file was restored in a finally block and every final five-file hash was rechecked against final-source-hashes.json. See root-browser-results.json and root-browser-baseline/final logs. Both runs selected one ordinary Chromium test file. Existing private dependency provenance is B1/root-installation-provenance.json, with two subsequent passing full gates. Parent review and final gate remain pending; there is no remaining browser execution blocker.
