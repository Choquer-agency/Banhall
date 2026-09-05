# Verification contract evidence

Baseline: `dd787d4287bcdf970aa3bcb25f0781dc765e030c` on private branch `codex/bmad-verification-contract`. All commands ran in `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract`. No commit made by implementer; coordinator owns fresh review and private finalization.

## Source and scope

The four infrastructure files were transplanted from `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d`; their starting bytes match independent worker `125c6cd47e8b1068f39889855d2029a502e5a856`. See `upstream-hashes.json` and coordinator `upstream-source-identity.json`. Only the discovery script then received exact accounting for the three named archives. Final infrastructure, docs, canonical config and dependency hashes are in `verified-source-hashes.json`.

`python3 .audit/verification-contract/verify-immutable.py` exited 0 (`immutable-source.log`, `.exit`, `.json`). It compares all 4,555 baseline tracked files outside the five authorized existing-file changes, including product/dependency/config/generated/archive/ledger bytes. AGENTS policy/native-ledger text and adjacent native integration guidance are compared separately. An initial version of this audit helper treated tracked symlinks as file contents and failed on `.claude/skills/brandkit`; the corrected helper hashes symlink targets as Git does, then passed. No source adaptation resulted from that helper error. After the component run, the same immutable check caught eight tracked historical PNGs rewritten by existing screenshot tests. Only those generated outputs were restored to their exact baseline bytes; `component-screenshot-restoration.json` records before-restoration and restored SHA-256 values. The final immutable check then exited 0.

`npm ci --no-audit --no-fund` exited 0 and created this worktree's own nonsymlink `node_modules` directory (`npm-ci.log`, `dependency-ownership.txt`). Dependencies and both canonical Vitest configs were untouched.

## Acceptance results

| Contract | Actual command and result | Evidence |
| --- | --- | --- |
| Baseline archives fail | Unmodified `node scripts/check-test-discovery.mjs`: exit 1, names exactly the three specified QA copies | `discovery-baseline.log`, `.exit` |
| Executable discovery succeeds | Adapted real guard: exit 0; 214 executable files and 3 historical archives | `discovery-adapted.log`, `.exit` |
| Genuine orphan fails closed | Real guard with temporary `GIT_INDEX_FILE` and `.audit/verification-contract/orphan-control.test.ts`: exit 1 naming the orphan; fixture removal restores exit 0; real index SHA-256 unchanged | `verify-controls.py`, `discovery-orphan.log`, `discovery-restored.log` |
| Missing PowerShell fails first | Actual gate with bounded PATH lacking pwsh: exit 1 at preflight, names pwsh and install hint; no step 2 | `missing-pwsh.log`, `.exit` |
| Command failures propagate | Actual gate with only npx replaced by exit-37 fixture: names Convex typecheck, exits 37; no step 3 | `convex-exit-37.log`, `.exit` |
| Missing browser fails first | Actual gate with `VERIFY_COMPONENT=1` and empty temporary browser cache: exit 1, names Chromium and install command; no step 2 | `missing-chromium.log`, `.exit` |
| Combined gate passes | `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh`: exit 0, all nine steps passed | `unified-gate.log`, `.exit` |
| Narrow diff | `git diff --check`: exit 0; immutable verification passes | `diff-check.log`, `.exit`, `immutable-source.json` |
| CI contract | `.github/workflows/ci.yml` defines two independent PR/main jobs; both use Node24 via `.nvmrc` and public placeholders; component installs Chromium; no optional-failure suppression | `.github/workflows/ci.yml`, `upstream-hashes.json` |

Reproduce the negative controls with `python3 .audit/verification-contract/verify-controls.py`; it executes the unchanged canonical list commands through the actual guard. `controls-summary.log` records all expected exits.

## Full gate retained results

1. Preflight: Node v24.19.0, both public placeholders, Chromium found.
2. Convex typecheck: exit 0.
3. Svelte check: 0 errors, 0 warnings.
4. Unit tests: 154 files, 1,970 tests passed.
5. Discovery: 214 executable test files, 3 historical archives accounted.
6. Production build: exit 0.
7. PowerShell uploader harness: 50 passed, 0 failed.
8. Bash uploader harness: 18 passed, 0 failed.
9. Chromium components: 60 files, 463 tests passed, exit 0.

The component suite writes historical screenshot evidence in place; future full runs require checking/restoring those generated outputs when archive preservation applies. Build chunk-size guidance and component Svelte configuration/derived-inert warnings remain in the raw successful log. They did not fail the gate and are outside this infrastructure reconciliation. Local results do not establish remote branch-protection settings or a hosted CI run.

## Handoff

Implementation and runtime acceptance are complete. Fresh independent four-layer BMAD review, resolution of any concrete review findings, and coordinator private commit remain outstanding. No pushes, PRs, merges, native/factory loops, private deployment operations, or ledger edits were performed.
