# B9 documentation reconciliation evidence

Baseline: `9d83ffd3091c1e801285149622c879abe0087556`. The supplied spec and its sole frontmatter context file, `AGENTS.md`, were read fully before implementation. The working tree initially had only the supplied untracked spec. BMAD implementation was performed within the supplied handoff; its explicit six-path, no-reviewer, no-state-edit and no-test restrictions supersede generic workflow finalization.

## Runtime and prerequisite admission

Before verification, the login shell resolved Node to `/Users/johnnynguyen/.nvm/versions/node/v24.19.0/bin/node` and npm to the adjacent `bin/npm`: Node `v24.19.0`, npm `11.17.0`. No installation or environment-value inspection was performed. See `baseline.txt`.

`git merge-base --is-ancestor` passed for all prerequisite commits:

- B4: `d22e1fa0880512212865d7d60aeb8cfe600dbaa2`
- B6: `71e809f9f58e07b1b436fff95b2dbe6e9d05b27d`
- B7: `d28cfc0bc0a34e78683152553143179fac2682c7`

The retired Header, MenuToggleIcon and MyWorkGroup component paths and `bun.lock` are absent. The exact ancestor proof is in `preservation-proof.json`. Existing B4 `gate-node24/result.json`, B6 `gate/result.json` and B7 `gate/result.json` all record successful component-enabled gates; their log SHA-256 values were checked against the retained logs. B7's log records 62 component files and 478 tests passed at lines 937-938. These are prior receipts, not B9 test runs.

## Before contradictions and source-backed corrections

The exact before/after content is retained in `implementation.diff`; source hashes are in `source-identities.json`.

| Acceptance / matrix row | Before | Current source and correction |
| --- | --- | --- |
| Public setup | Obsolete NEXT_PUBLIC_CONVEX_URL; missing site URL; dead agent flag | `src/routes/+layout.svelte:11`, installed auth adapter `dist/sveltekit/index.js:3,99,107,109`, uploader `scripts/client-uploader/setup.sh:39`. Example now assigns both public URLs and retains CONVEX_DEPLOYMENT. `rg` over src/convex finds PUBLIC_AGENT_CHAT only in `src/lib/test/env-static-public-stub.ts:8`; no new production flag prescribed. |
| Setup order | README had verification only | Installed Convex `src/cli/lib/envvars.ts:185` selects SvelteKit names; `:345` selects existing .env.local. Copy example first, let provisioning populate values, never copy blanks afterward. `package.json:7` establishes port 3001 and npm dev. |
| Build stamp | No optional timestamp guidance | `src/lib/components/BuildStamp.svelte:10,15,36` reads supplied PUBLIC_BUILD_TIME, returns empty on invalid date, hides blank values. No automatic Vercel timestamp claim. |
| Backend names | Backend assignments mixed into frontend example | `convex/convex.config.ts:18` declares exactly nine optional names. `convex/auth.ts:24,115` directly reads trusted origins and SITE_URL; `convex/ai/brain/ingest.ts:13` reads BRAIN_CONTEXTUAL. Installed better-auth `dist/context/create-context.mjs:70` consumes BETTER_AUTH_SECRET. All are now comments, split by schema/direct/library source; SITE_URL is explicitly distinct from public Convex site URL. Voyage constants are in `convex/ai/brain/embeddings.ts:19,20,29`. |
| Retired UI and surviving idioms | Dead adopter/reuse names and unqualified Bun/server/rename history | B4 ancestor and absent paths verified. Removed only retired adopter/reuse names; labelled old migration stack, verify and cutover instructions historical, pointing to README. Surviving Svelte/Convex idioms retained. |
| Architecture / Q8 | Dead-test question, Node 22 CI claim, blind/write-only claims | B6/B7 ancestors establish admitted recovery/prune. `scripts/check-test-discovery.mjs:41` lists exactly three archives; `.github/workflows/ci.yml` defines verify and component jobs, both reading `.nvmrc` (24). Branch protection remains separate. `convex/learningHealth.ts:33,47,50,74` reads bounded rerank/PED/provenance; `src/routes/admin/learning/+page.svelte:17` consumes it. Existing system-map learning arrows and later sections are preserved. Observations and associated judgments remain noncausal; prompt/digest attribution unmeasured, CRA signals schema only. |
| Factory QA | Empty smoke with incorrect no-servers comment | `package.json:14` points to browser Vitest config; `vitest.component.config.ts` requires headless Chromium. One smoke line now describes local server and installed Chromium prerequisites without shared deployments. |

## Verification results

- `git diff --check`: exit 0, no output (`diff-check.txt`). The full six-path diff was inspected and retained in `implementation.diff`.
- Installed `smol-toml` parsed before and after configuration. Deep comparison after normalizing qa.smoke to its baseline proves that qa.smoke is the only semantic change. `toml-before.json` and `toml-proof.json` retain results.
- Byte comparison proves only factory line 25 changed, including its comment. Every other factory line is identical.
- Installed factory `loadConfig` returned smoke `["npm run test:component"]`, derived `Bash(npm run*)`, and unchanged deterministic verify `["bash scripts/loop-verify.sh"]`. Current roles.qa has no allow override. Source `src/v2/config.mjs:34` derives the first-two-word prefix; engine `src/v2/engine.mjs:257` passes smoke into the QA prompt, while `:199` uses verify commands for gates. Reading config does not run tests. No exact-command-only permission is claimed.
- SHA-256 comparison against `before-hashes.json` proves only the six approved tracked paths changed; all 5,876 protected tracked files remain identical, including gate, CI, generated files, AGENTS, roles, native state and ledger. README's complete Verification section is byte-identical. See `preservation-proof.json`.

## Scope and remaining work

B9's implementation and documentation checks are complete. No new tests, component rerun, full gate, install, provisioning, provider call, restart, staging, commit, merge, push, reviewer or native state/ledger edit was performed. The spec itself is unchanged. Parent owns independent review, admission and shipping. The smoke remains an instruction for future QA and requires existing dependencies and installed Chromium; no new runtime success is claimed.

## Parent acceptance

Three fresh Astra6 medium layers completed; review-triage.md records every finding. Parent guarded the initial example copy and restored the contextualization cost/default explanation. Exact documented copy command passed absent/existing temporary-file fixtures; the first cp -n candidate returned1 for existing files and was replaced, with the result preserved. No real env values inspected. Independent standard-library tomllib comparison confirms only qa.smoke changes; README Verification remains byte-identical after patches. Final hashes are parent-reviewed-source.json. No application tests or full gate were rerun for this documentation/config-only batch; prior B8 gate and subsequent combined verification are distinct evidence. No story_key or native ledger changes. Hosted CI/final shipping remain pending.
