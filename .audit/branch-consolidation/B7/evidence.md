# B7 dependency prune evidence

Implemented in the assigned checkout `/Users/johnnynguyen/Documents/Repos/Banhall-branch-consolidation` at baseline `71e809f9f58e07b1b436fff95b2dbe6e9d05b27d`. The supplied spec and its complete frontmatter context (`AGENTS.md`) were read before implementation. Node `v24.19.0`, npm `11.17.0`, selected by the login shell; no runtime installation or selection change. Initial status contained only the untracked supplied spec. See `identity.txt` and `before-hashes.json`.

## Changes and acceptance evidence

- `package.json`: removed only direct `docx`, `svelte-exmarkdown`, `tippy.js`, `eslint`, and `@types/bun`. Every other manifest field/value remains identical. Before/after manifests are retained.
- `package-lock.json`: current inputs match the package and lock blobs at `8649315de144a7e424c12ff461046d5ec8e58ddd^` byte for byte. Used only the cumulative lock blob at `ad9952ff1ba107bfbf97955863d4dfcdf774a530`. No old discovery script was imported.
- Lock entries changed from 702 to 556 (including the root): 146 removed, zero added. All 555 surviving package entries retain their version, resolved URL, integrity, dependency and peer fields. Only `debug` and `ms` gain `dev: true`; root dependency maps reflect the five removals. `candidate-delta.json` records complete added/removed/changed sets and field differences. `before-lock-tuples.json` and `after-lock-tuples.json` retain all tuples.
- `verify-graph.py` resolves dependency, optional dependency and peer edges through nested node_modules ancestors, starting from retained production and development roots. All 556 retained entries are reachable; none of the 146 removed entries is reachable. `graph-proof.json` contains every traversed edge and unchanged missing-peer details. Final verification checks the actual post-install lock and manifest against the audited candidate, not only archived inputs.
- Deleted `bun.lock`. `consumer-scan.txt` and `active-import-scan.json` show no live imports of removed roots or `bun:test` in tracked application/config/scripts/tests. Other docx matches are document types/extensions; eslint matches are comments. Historical audit material remains intact.
- `tsconfig.json`: removed exactly `test/**/*.js`, `test/**/*.ts`, and `test/**/*.svelte`. Other bytes are unchanged, including generated Svelte declarations, src/tests/shared includes and compiler settings. Native transformer coverage remains untouched.
- `final-hash-delta.json`: only the four authorized tracked paths differ, with 5,716 other tracked files byte-identical, including gate, discovery, pointer configuration, CI, historical screenshots, archives and native state/ledgers. No staged changes. `implementation.diff` contains the complete patch.

## Actual commands and results

All logs are complete stdout/stderr captures; `.exit` files contain the actual child exit status. `run-check.py` additionally records argv, cwd, start time and exit in `.command.json` for post-install checks. Shell wrappers themselves return after recording the status; their outer exit is not substituted for a failing child status.

| Command | Exit | Receipt / result |
| --- | --- | --- |
| `node --version`; `npm --version`; `git rev-parse HEAD`; `git status --short` | 0 | `identity.txt` |
| `node node_modules/vitest/vitest.mjs run tests` before pruning | 0 | `baseline-tests.log`: 14 files, 137 tests passed |
| `npm ls --all` before pruning | 1 | `baseline-npm-ls.log`: existing missing React peer |
| `npm ci` after pruning | 0 | `npm-ci.log`: 455 packages installed, 456 audited |
| `npm ls --all` after pruning | 1 | `npm-ls.log`: same missing React peer; no invalid/extraneous required entries reported |
| `node node_modules/vitest/vitest.mjs run tests` | 0 | `focused-tests.log`: 14 files, 137 tests passed |
| `node node_modules/vitest/vitest.mjs run src/lib/tiptapConfig.test.ts --expect.requireAssertions` | 0 | `tiptap-tests.log`: 2 tests passed |
| `node node_modules/vitest/vitest.mjs run --config vitest.component.config.ts src/lib/components/editor/Editor.component.test.ts` | 0 | `editor-component.log`: 18 tests passed |
| `node .audit/branch-consolidation/B5-r1/underline-proof.mjs` | 0 | `underline-proof.log`: strict default; actual editable/read-only Editor JSON roundtrips, one Underline registration each, zero duplicate warnings, editable toggle off/on passes |
| `node scripts/check-test-discovery.mjs` | 0 | `discovery.log`: 214 executable files accounted for; exactly 3 historical archives |
| `python3 .audit/branch-consolidation/B7/verify-graph.py` | 0 | `final-graph.log`, `graph-proof.json` |
| `git diff --check` | 0 | `diff-check.log` |

The initial graph check rejected an assumption that the baseline had no missing required peers. Inspection identified the already-missing React peer. The final proof explicitly compares missing edges with the original graph and requires no new missing edges; it does not treat the pre-existing peer problem as a pass.

## Limits and parent handoff

`npm ls --all` remains nonzero because `@convex-dev/better-auth@0.12.5` requires absent `react@^18.3.1 || ^19.0.0`. Both baseline and post-install output show the same error. The repository already has `legacy-peer-deps=true`; this file was not changed. The lock graph confirms this is the only absent non-optional dependency/peer edge reachable from retained roots. This is a real pre-existing peer defect, not an unsupported optional platform package. No dependency was added to fix it because that exceeds B7 scope.

`npm-ls-optional-classification.json` separately classifies the 145 optional-missing occurrences: 95 platform-specific package occurrences and 50 optional peers. Fresh install also reports 11 audit vulnerabilities (1 low, 7 moderate, 3 high) and allow-scripts notices for esbuild/fsevents. No unpinned install, audit fix, or script-policy change was run. The required editor/runtime tests passed on the resulting modules.

All worker checks in the spec were executed. Parent-owned independent review, staged membership checks, final `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`, hosted two-job CI proof, final admission and shipping remain outstanding by design. This evidence does not claim a full combined gate pass or clean npm peer graph. No staging, commits, push, merge, reviewer dispatch, other-worktree edits, or ledger changes occurred. Evidence is retained in this ignored audit directory for parent review.

## Parent acceptance

Three fresh Astra6 medium review layers completed; per-item disposition is review-triage.md. Independent peer review and advisory audit distinguish inherited problems from this exact-version prune. Native DW-104/DW-105 remain open; all103 prior entries preserved. Final Node24 component-enabled gate passes all nine steps,2006 unit tests/153 files and478 browser tests/62 project files, with no unexpected tracked mutations. See gate/result.json and full log. Reproducible parent consumer/path inventory and script-policy receipts supplement worker evidence; final source hashes are parent-reviewed-source.json. Parent accepts the unchanged baseline peer exception explicitly, not a clean npm-ls/audit graph. No story_key, so sprint synchronization is a no-op. Hosted CI and final shipping remain pending.
