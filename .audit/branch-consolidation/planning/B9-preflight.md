# B9 documentation and factory smoke preflight

Read-only inspection at HEAD 1d6053388326fe4fde43a86177955157f11ce588. Reviewed planning/B9.md, drafts/spec-branch-b9-current-documentation.md, current documents and installed parser/adapter/CLI source. No tests, provisioning, installs, factory invocation, source/config/canonical edits or other-worktree changes.

## Corrections required before promotion

1. Do not copy the historical env.example backend-declaration paragraph verbatim. It implies all backend names except BRAIN_CONTEXTUAL are declared in convex/convex.config.ts. Actual declared optional names are ANTHROPIC_API_KEY, VOYAGE_API_KEY, OPENROUTER_API_KEY, MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_DRIVE_ID, MS_ROOT_PATH and INGEST_API_KEY. SITE_URL and BETTER_AUTH_TRUSTED_ORIGINS are direct reads in convex/auth.ts (lines 115 and 24), BETTER_AUTH_SECRET is consumed by installed better-auth, and BRAIN_CONTEXTUAL is a direct ingest.ts:13 read. None of those four is declared in the app env schema. Separate the groups explicitly.
2. Spell PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL in full in the draft matrix. Its shorthand PUBLIC_CONVEX_URL/SITE_URL is ambiguous because SITE_URL is a distinct backend auth base URL. Remove NEXT_PUBLIC_AGENT_CHAT without inventing a required PUBLIC_AGENT_CHAT setting: the only current source match is a test stub, not production.
3. The [qa].smoke same-line comment must cease claiming “no servers”: Vitest browser mode starts a local server and Chromium. Say local browser component proof, requiring installed Chromium, without shared deployments. Do not claim the factory permission is limited to exactly one npm command: actual parser derives Bash(npm run*) from its first two words. This is existing parser behavior, not a reason to change roles or parser within B9.
4. README's entire current Verification section must remain. Historical README statements that CI/local “cannot drift” and that a cached dependency tree suffices are not equivalent to current own-npm-ci, browser-readiness, three-archive and screenshot guidance. Add only setup context. The historical Hermetic instance section is explicitly unbuilt and must not become executable setup instructions.

## Confirmed setup evidence

- src/routes/+layout.svelte:11 imports PUBLIC_CONVEX_URL. Installed node_modules/@mmailaender/convex-better-auth-svelte/dist/sveltekit/index.js:3 imports both PUBLIC_CONVEX_URL and PUBLIC_CONVEX_SITE_URL; lines 99/107/109 use/check them. scripts/client-uploader/setup.sh:39 also reads PUBLIC_CONVEX_SITE_URL from .env.local.
- Installed node_modules/convex/src/cli/lib/envvars.ts:185-192 detects @sveltejs/kit and selects PUBLIC_CONVEX_URL/PUBLIC_CONVEX_SITE_URL in .env.local. Copy env.example before provisioning to avoid blanking generated values; retain CONVEX_DEPLOYMENT. No real env file or credential values were inspected.
- src/lib/components/BuildStamp.svelte reads env.PUBLIC_BUILD_TIME, hides blank/invalid values, and formats valid timestamps in America/Vancouver. Describe an optional timestamp supplied at build/deploy time; do not assert that Vercel automatically generates it. No automatic population was established.
- convex/ai/brain/embeddings.ts defines voyage-3-large with 1024 dimensions and rerank-2.5; use names or source paths, not historical line numbers. Provider/auth/ingest names belong in Convex-side comments, not frontend assignments.
- Current README pins Node 24 and owns npm ci per checkout; CI uses .nvmrc in both jobs. Preserve its existing branch-protection distinction and actual browser preflight wording.

## Retired references and system-map limits

After B4, remove only MyWorkGroup from docs/design-system.md:403 and ui/Header/ui/MenuToggleIcon from docs/svelte-migration.md:77. Historical migration Verify instructions at lines 84-90 include Bun commands, assumed running server, no Convex changes and no commits; label the whole recipe historical and point to current Verification. Its opening stack still lists Bun, and post-cutover notes describe NEXT_PUBLIC_AGENT_CHAT to PUBLIC_AGENT_CHAT: qualify these as historical rather than current required setup. Preserve surviving Svelte/Convex conventions.

Q8 in docs/system-map.md:417 still asks whether 14 dead Bun tests should be ported and component tests added to CI. Update with actual completed B6/B7 status, current discovery and two CI jobs after admission, without implying branch-protection settings. Preserve current learning-health/PED/rerank arrows at lines 360-368 and the observational, non-causal interpretation.

Additional stale examples in the same document must not be silently adopted as present truth: line 427 says Node 22 in CI while current CI uses .nvmrc (24); lines 389/398 call the learning loop blind and provenance/post-edit distance write-only despite lines 360-368 documenting their live read surface. These are concrete existing contradictions, not permission for whole-file architecture replacement. Parent should either authorize narrow corrections/historical qualification or retain them as explicit known limits of Q8-only scope. Do not change measured-not-causal policy.

## Factory parser semantics

Resolved /opt/homebrew/bin/factory to /opt/homebrew/lib/node_modules/@conquerthecrowns/factory/bin/factory.mjs. Installed src/lib/util.mjs:5,19 uses smol-toml. src/v2/config.mjs:26 overlays factory.qa on defaults; line 34 adds each smoke command's first-two-word Bash prefix only when roles.qa.allow is absent. Current roles.toml [qa] has no explicit allow override, so the proposed npm run test:component yields Bash(npm run*). src/v2/engine.mjs:257 passes smoke joined with && into the QA prompt. It does not add this command to deterministic verify.commands or execute it merely by reading the configuration. Future QA receives the smoke instruction; no current BMAD run restart or claim of an executed smoke is implied.

The exact authorized mutation remains one [qa].smoke value plus its same-line comment; preserve all other config bytes, roles, engine, native policy and browser-free default gate. The parser's current semantics support that proposal with the permission-prefix caveat above. Chromium/dependency readiness remains an existing execution prerequisite, not something B9 provisions.

## Recommendation

Promote after correcting the declaration grouping and precise environment/QA wording; parent should decide the explicitly identified system-map historical contradictions. Preserve current Verification and architecture text. Source-backed prose review and diff validation are adequate B9 proof; no runtime success is claimed here.
