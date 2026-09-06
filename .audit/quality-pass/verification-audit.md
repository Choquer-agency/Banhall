# Canonical verification artifact audit

Read-only source audit of the new quality-pass checkout, baseline main ed79a296039109fe1a2bf5dd867f9e5af22f2967. Parent owns baseline install/gate; no tests or filesystem repairs were performed by this audit.

## Concrete cause and smallest remedy

Two browser files explicitly write historical .audit paths: `src/lib/components/chat/OptimisticSend.component.test.ts` (seven screenshot call sites, one retry parameterization produces two files) and `src/routes/admin/learning/LearningHealth.component.test.ts` (six call sites). These are artifact captures, not snapshot comparison assertions. Thus 13 literal/template call sites target 14 historical filenames; the known ten changed tracked PNGs are the bytes that differed during prior runs, not the whole writer scope. Migrate every one of these historical destinations, not only the ten known differing files.

Reuse the existing `ChatFeedback.component.test.ts:51` convention: explicit `../../../../.vitest-attachments/...png`. Replace the `.audit` prefix with `.vitest-attachments` in the two offending suites, retaining existing story/fix subdirectories, filenames and all screenshot options/assertions. Both directories are four levels below root. No helper or wrapper is needed for this literal path substitution. Existing RegenerateTurn captures already use ignored `__screenshots__` paths and need no change. `.gitignore` already ignores `.vitest-attachments/` and `**/__screenshots__/`; adding broad exclusions is unnecessary and would not stop tracked .audit files from being overwritten.

Installed `@vitest/browser/dist/index.js:644–655` resolves a custom screenshot path relative to the test file directory BEFORE consulting browser.screenshotDirectory. Merely setting a global screenshot directory would not repair these explicit historical paths. Installed browser-playwright takeScreenshot creates the parent directory recursively and writes through the supported screenshot API, so the proposed existing convention needs no mkdir helper or custom command.

Fresh outputs are discoverable under `.vitest-attachments/story-7`, `/story-8`, `/DW-98-fix`, `/published-status-fix`. These are latest-run output locations; they need not invent a permanent run archive or timestamp protocol. If retaining each run is required, collect them as CI artifacts or copy them to an intentionally named evidence directory after verification.

## Directly relevant documentation and CI

Update only the AGENTS Running and verifying bullet that currently instructs restoring historical screenshots: document ignored fresh output locations and that canonical verification should leave tracked history/source unchanged. Preserve all other policy and native-ledger guidance. scripts/loop-verify.sh already invokes the canonical suite; it needs no capture/restore stage.

`.github/workflows/ci.yml` currently has no artifact upload step. To make hosted outputs downloadable, a small `actions/upload-artifact` step after the component test, guarded with `if: always()`, can collect `.vitest-attachments/` and `src/**/__screenshots__/`. Hidden-file inclusion must be explicit for .vitest-attachments with current upload-artifact behavior; restrict the paths, never upload whole .audit or the checkout. If hosted download is outside this repair scope, local output location documentation alone remains useful; do not claim existing CI already uploads captures.

The previous `.audit/branch-consolidation/run_gate.py` snapshots all tracked bytes in memory, runs the gate, copies changed known captures and rewrites their old bytes. This is historical operational evidence, not a production helper to port. Correcting writers removes the need to repeat that restoration protocol and avoids masking unintended edits. No unrelated performance issue is established by this read-only audit; browser screenshot duration has not been profiled here.

## Meaningful proof, without wrapper/test scaffolding

1. Parent baseline gate: preserve raw exit/log, pre-run Git status and NUL-delimited tracked-path hash manifest; capture the observed overwritten filenames/hashes. Do not extrapolate ten differing files into ten total writer destinations.
2. After the two-suite path-only patch and narrow docs/optional CI adjustment, capture tracked working-tree bytes and Git status as the candidate baseline. Run the actual `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` directly. Do not restore screenshot paths during that proof.
3. Compare every previously tracked path hash before/after, including all historical .audit PNGs, plus status/index. Candidate source edits must remain exactly as they were before the gate. Preserve unrelated pre-existing dirty bytes rather than compare solely with HEAD or git restore.
4. Record fresh screenshot paths, mtimes/sizes/hashes; use `git check-ignore` to prove their ignored destinations. Show all intended captures were produced and original historical hashes stayed identical. Keep original screenshot/DOM assertions and suite counts. This genuine gate/byte check is sufficient; no test that merely mirrors a path constant is needed.
5. If CI artifact collection is included, verify the actual hosted artifact contains only the declared output directories. Local YAML review alone is not hosted upload proof.

## Inspected source binding

- `AGENTS.md` SHA-256 `cee8d25679a1d0c2fe982c223d41a19ab92d57a3c6d6a0cd0935bb19505b9e35`
- `scripts/loop-verify.sh` SHA-256 `abf20d3bdafca2c6cbb59f9026ae0749727f0b4e6b610cc09ccebbba43da8bac`
- `.gitignore` SHA-256 `04476c9e9a4f1ce8097237c6de8e26af5b5abd2c5f289617b2b10ceec91e29a0`
- `.github/workflows/ci.yml` SHA-256 `c57242059b66b492bb844b3ee7263bba14829c8299de85d6a4f327295d0c4693`
- `src/lib/components/chat/OptimisticSend.component.test.ts` SHA-256 `bac4cc1945a42182c2060b30401b2e94914e6662fa868d4bb68bc4f01de192ad`
- `src/routes/admin/learning/LearningHealth.component.test.ts` SHA-256 `1134413fd641dce9410614e824d5c359fc74e89e536378af343cbd1c913cb0da`
- `src/lib/components/chat/ChatFeedback.component.test.ts` SHA-256 `3ee6982f7704d160dce573e5b4618d653415ed014908bc67f2a321b896e7a055`
