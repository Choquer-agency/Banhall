# After-review verification contract evidence

This record supersedes the implementation-status and final-source statements in `evidence.md`. The earlier logs/manifests remain preserved as before-review evidence. Baseline remains `dd787d4287bcdf970aa3bcb25f0781dc765e030c`; no commit, push, merge, native ledger change, or frozen-spec change was made by the implementer. Coordinator owns final independent acceptance and private commit.

## Retained review patches

| Review ID | Change | Before/after proof |
| --- | --- | --- |
| 1 | Optional preflight now uses supported `chromium.launch({headless:true, timeout:15000})`, closes the browser, and has a 20-second watchdog. Errors retain Chromium/install guidance including Linux system dependencies. Default mode performs no browser launch. | `before-review-regular-only-launch.log` failed 1 while old gate reached injected next-command exit 37. Working headless-only launch passed 0 while old gate incorrectly failed 1. After patch, regular-only gate fails 1 and headless-only gate reaches 37. `before-review-controls-summary.log`, `after-review-controls-summary.log`. |
| 2 | Git test enumeration uses raw `execFileSync` output with `ls-files -z`, splitting only NUL without trimming filename bytes. Three exact archive entries remain unchanged. | Canonical Vitest listing discovers a filename containing Unicode, a quote and newline in both probes (`before-review-path-fixture.json`, `after-review-path-fixture.json`). Old guard falsely exits 1; patched guard exits 0. Existing genuine `.audit` orphan still fails 1 and removal restores 0. |
| 3 | Git is an early required tool with install guidance. | Bounded PATH contains node/npm/pwsh/dirname but no Git: actual script exits 1 at step 1, names Git and installer, never reaches step 2 (`after-review-missing-git.log`). Missing pwsh, empty Chromium cache and injected Convex exit37 controls also pass. |
| 5 | README, AGENTS verification section, and current BMAD verification guidance explicitly require checkout-local `npm ci` for fresh checkouts and after dependency changes. | Documentation states that existing `node_modules` is not validated for ownership or freshness. Dependency files and installed versions unchanged. |
| 6 | Linux setup includes `npx playwright install --with-deps chromium`. | All three verification docs plus failed browser preflight hint; existing CI already uses this command. |
| 7 | Actual default full gate runs with `VERIFY_COMPONENT` unset and an empty temporary `PLAYWRIGHT_BROWSERS_PATH`. | Exit 0; eight steps; temporary cache empty both before and after (`after-review-default-empty-cache-gate.log`, `.exit`, `default-empty-cache-identity.json`). |
| 8 | Verification docs explain existing tracked screenshot side effects and preserving unrelated work when restoring historical outputs. | The optional run rewrote nine historical PNGs. Exact baseline bytes were restored; original/generated/restored identities are recorded in `after-review-component-screenshot-restoration.json`. Final immutable verification passes. |
| 9 | Immutable helper verifies actual object kind and Git executable mode for every baseline path, in addition to unmodified content checks. | Toggling README executable mode and replacing the authorized `.nvmrc` addition with a symlink each fail; restoration passes (`after-review-immutable-mode-control.log`, `after-review-immutable-type-control.log`, `after-review-immutable-restored.log`). |
| 10 | Immutable helper inventories visible new files against three exact authorized additions and inventories every own-audit file with type/mode. | Unexpected nonignored file control fails; removal restores success (`after-review-immutable-addition-control.log`, `after-review-immutable-restored.log`). Final inventory: `after-review-immutable-source.json`. |

## Commands and retained counts

`python3 .audit/verification-contract/review-controls.py before` ran against preserved starting sources before edits. The original sources are copied to `loop-verify-before-review.sh` and `check-test-discovery-before-review.mjs` for review. `python3 .audit/verification-contract/review-controls.py after` exercised patched sources. `python3 .audit/verification-contract/verify-controls.py` retained all original controls and added missing-Git; all expected outcomes passed (`after-review-original-controls-summary.log`).

| Gate | Convex / Svelte | Unit suite | Discovery | Build | PowerShell / Bash uploaders | Components | Exit |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` | pass / 0 errors, 0 warnings | 154 files, 1,970 tests | 214 executable files + 3 archives | pass | 50 / 18 passed | 60 files, 463 tests | 0 |
| `bash scripts/loop-verify.sh` with isolated empty browser cache and `VERIFY_COMPONENT` unset | pass / 0 errors, 0 warnings | 154 files, 1,970 tests | 214 executable files + 3 archives | pass | 50 / 18 passed | omitted as contracted | 0 |

Full outputs and explicit exits are `after-review-unified-gate.log/.exit` and `after-review-default-empty-cache-gate.log/.exit`. Build chunk-size guidance and Svelte component warnings remain visible and did not fail the gate.

## Isolation and identity

Partial-cache fixtures use temporary `PLAYWRIGHT_BROWSERS_PATH` directories containing symlinks to existing locations reported by the public `npx playwright install --dry-run chromium` CLI. No cache paths or SDK internals are hardcoded into production preflight. Empty-cache controls use separate temporary empty directories. The quoted-path and orphan fixtures use a copied temporary `GIT_INDEX_FILE`, not the real worktree index. Fixtures are removed after each probe.

`python3 .audit/verification-contract/verify-cache-identity.py` repeated the after-review cache/filename controls while hashing every file/symlink under the three CLI-reported shared regular Chromium, FFmpeg, and headless-shell installations. All 363 content/type/mode records match before/after (`cache-identity-before.json`, `cache-identity-after.json`, `cache-identity-result.json`). This byte-preservation claim covers that measured repeat only; earlier full-gate runs did not have a shared-cache before snapshot. No browser installation command ran; the CLI invocation was dry-run.

The repeated probe records equal real-index SHA-256 values in `cache-identity-review-index-identity.json`; the original orphan control also asserts unchanged real-index hash. The default gate's temporary browser cache remained empty, then was removed (`default-empty-cache-identity.json`). Historical QA source/archive bytes, canonical configs, package files, product code and native ledger bytes match baseline. The enhanced helper checks all 4,560 baseline modes/types and content of all 4,555 paths outside authorized existing-file edits. Final source hashes: `after-review-verified-source-hashes.json`.

`git diff --check` and final `python3 .audit/verification-contract/verify-immutable.py` pass. Remote CI acceptance/branch protection and private finalization remain coordinator-owned; YAML alone does not establish hosted required-check behavior.
