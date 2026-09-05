# Verification contract repair result

Private reviewed commit: **186029d408b418c4337ee0e772520629cdae937c** on `codex/bmad-verification-contract`, isolated checkout `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-verification-contract`, exact baseline `dd787d4287bcdf970aa3bcb25f0781dc765e030c`. Working tree is clean; committed whitespace check passes. No push, PR, merge, native/factory loop, ledger/state/policy mutation or original checkout edit was performed by this repair.

## Change and review

Ported the verified four-file infrastructure from `5ec93e594eda60c28da2cfdbf27fb668fd55eb3d` / isolated worker `125c6cd47e8b1068f39889855d2029a502e5a856`: unified gate, actual canonical discovery, two-job CI and Node24 pin. Updated only AGENTS verification section, concise README and current docs/bmad-loop.md verification guidance. Native ledger finalization/domain guidance, product code, dependencies, canonical Vitest configurations and all historical archive bytes remain intact.

Discovery accounts for exactly the three historical QA source copies. Unmodified upstream guard failed on those three before the patch; adapted guard succeeds, and a genuine undiscovered `.audit` test still fails through a temporary Git index. Fresh four-layer BMAD review found two medium mechanics defects plus seven low documentation/evidence refinements, all resolved. Three suggestions were dismissed with recorded scope/evidence reasoning. A fresh independent post-patch verifier found no remaining findings, matched all11 source and135 handoff evidence hashes, and independently compared4555 protected baseline contents/modes. No native ledger closure was performed.

The two source repairs were reproduced before fixing: (1) quoted Unicode/newline test filenames were actually discovered by unchanged canonical Vitest but rejected by Git's quoted path representation; raw NUL enumeration fixes this; (2) old preflight accepted regular-only Chromium while actual headless launch failed, and rejected usable headless-only installations. Optional preflight now launches/closes the actual supported headless browser with15-second launch/20-second watchdog bounds and actionable installation output. Missing Git is also diagnosed at preflight. Default remains browser-free.

## Actual final gates

| Gate | Result |
| --- | --- |
| `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` | Exit0, all9 steps |
| `bash scripts/loop-verify.sh` with isolated empty browser cache and VERIFY_COMPONENT unset | Exit0, all8 steps; cache remains empty |
| Convex / Svelte | Types pass;0 errors,0 warnings in both gates |
| Unit suite | **1970 tests /154 files**, both gates |
| Discovery | **214 executable files +3 explicit archives**, both gates |
| Production build | Pass in both gates |
| Uploader harnesses | **50 PowerShell +18 Bash**, both gates |
| Chromium components | **463 tests /60 files**, optional gate |
| Failure controls | Genuine orphan, missing pwsh/Git/browser, injected Convex exit37 all behave correctly |
| Source/whitespace |4555 protected baseline contents and4560 baseline modes/types preserved; final commit whitespace clean |

Authoritative retained evidence under the private commit's `.audit/verification-contract/`: `after-review-evidence.md`, `after-review-verified-source-hashes.json`, `after-review-unified-gate.log.gz` plus `.exit`, `after-review-default-empty-cache-gate.log.gz` plus `.exit`, review triage/fresh verification, real before/after probes, and `final-evidence-manifest.json`.

Seven authentic raw logs/diff contain original trailing whitespace. They are committed losslessly as deterministic gzip artifacts; `raw-evidence-compression.json` maps original paths and raw/archive hashes. Historical135-entry handoff inventory retains original decoded hashes. Coordinator verified all135 decoded handoff entries and all140 final committed evidence entries against staged bytes before committing. Use gzip decompression for referenced `.log`/`review.diff` paths whose committed representation is `.gz`; do not normalize their content. Other evidence remains plain text.

## Isolation and integration limits

Partial/empty browser caches use isolated `PLAYWRIGHT_BROWSERS_PATH`; Unicode/orphan controls use copied temporary `GIT_INDEX_FILE`. A measured repeat hashed363 file/symlink/type/mode records across CLI-reported shared Chromium/FFmpeg/headless installations and confirmed equality before/after. Real index hashes also match. This shared-cache identity proof is scoped to the measured repeat, not retroactively asserted for earlier unmeasured full gates. Temporary fixtures were removed. Existing component tests rewrote nine historical screenshots during the final optional run; their exact baseline bytes were restored with original/generated/restored hashes. All archive bytes match baseline at handoff.

Core final SHA-256 values:

- `scripts/loop-verify.sh`: `abf20d3bdafca2c6cbb59f9026ae0749727f0b4e6b610cc09ccebbba43da8bac`
- `scripts/check-test-discovery.mjs`: `dbd1ddfe3bf89d7ff84d45e8b0c80225423a5a35a2a667fa31820ab7248e3441`
- `.github/workflows/ci.yml`: `c57242059b66b492bb844b3ee7263bba14829c8299de85d6a4f327295d0c4693`
- `.nvmrc`: `68ca3fba3b7e864770cb61aeb306d4bd4354b68ab4dd38450860c5d823e42a53`

Upstream byte identity applies to the initial transplant; final reviewed gate/discovery mechanics intentionally have the above new hashes. No dependency/runner changes are needed for integration. Parent should verify source/evidence identities, integrate this one private commit, and obtain actual new hosted `Verification gate` and `Component suite (browser)` checks. YAML alone does not prove branch protection; parent has independently observed no protection/rules. Vercel's separately observed generic failure remains parent-owned and is not resolved by these local tests. No deployment readiness claim is made here.

BMAD own-root renderer/finalization provenance is retained. Standalone spec is done and contains a Suggested Review Order; VS Code command was unavailable. This report is a root-readable external receipt, not a new native status declaration.
