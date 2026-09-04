# Currency / Reality Review: ARCHITECTURE-SPINE.md (Banhall, 2026-09-03)

Reviewer lens: was every committed decision checked against the repo and the live ecosystem, or asserted from memory?
Repo HEAD `5a5f61c`, local Node v22.22.3, review date 2026-09-03. Spine not modified.

Method:
- Stack table: every row compared to `node_modules/<pkg>/package.json` via `node -p`.
- Latest releases: npm registry (`registry.npmjs.org/<pkg>` dist-tags and publish dates), not training data.
- Model ids: Anthropic model overview and deprecation pages, Voyage embeddings and reranker pages, OpenRouter `/api/v1/models` live listing.
- Platform limits: `docs.convex.dev/production/state/limits`, `svelte.dev/docs/kit/adapter-vercel`.
- Agent deep-import question: unpacked `@convex-dev/agent@0.7.1` tarball and diffed `dist/` layout and export map against the installed 0.6.4.

## Verdict

The stack table is accurate to `node_modules` (no version mismatches), and every model id the spine names exists on its provider today. The currency gaps are ecosystem-level: the whole AI SDK layer (`ai`, `@ai-sdk/*`, `@convex-dev/agent`, `@convex-dev/rag`) sits on the v6 maintenance line while the current major is v7 and the two Convex components the spine depends on have already crossed over; the spine does not say so, and its `@convex-dev/rag 0.7.x` row hides a patch release that flips the AI SDK peer major. A few platform claims (action limit runtime, transaction write cap versus AD-5 frozen-input sizes, "SPA") are stated more loosely than the sources support.

## Findings

### Critical

None. Nothing in the spine points at a retired model, a removed API, or a version that does not exist.

### High

**H1. AI SDK major migration pending and unacknowledged.** `ai` 7.0.0 shipped 2026-06-25; latest stable is 7.0.92 (2026-09-03). The repo is on `ai@6.0.230`, `@ai-sdk/anthropic@3.0.98`, `@ai-sdk/voyage@1.0.17`, all now served under the `ai-v6` maintenance dist-tag (6.0.276 / 3.0.116 / 1.0.27). `@convex-dev/agent` 0.7.0 (2026-08-17) and 0.7.1 require `ai ^7`, `@ai-sdk/provider ^4`, `@ai-sdk/provider-utils ^5`, and Node 22+, and its MIGRATION.md renames `system` to `instructions` (the repo uses both, `chatAgentV2.ts:241,410`). The spine's Stack table lists `ai 6.0.x` and `@ai-sdk/anthropic 3.0.x` as if current. AD-9 and AD-4 both lean on the agent component; the spine should name the v6 pin as a decision with a migration owner, or it will be read as "latest".

**H2. `@convex-dev/rag 0.7.x` is not one line.** 0.7.5 (installed, 2026-05-19) depends on `ai ^6`; 0.7.6 (latest, 2026-08-14) moved `ai` to a peer at `^7.0.0`. A routine `npm update` inside the caret `^0.7.5` would pull 0.7.6 and mix AI SDK majors, which the agent MIGRATION.md explicitly warns produces incompatible model/tool/message types. The spine's `0.7.x` row should be `0.7.5 (last ai-v6 release)`.

**H3. Deep imports of `@convex-dev/agent/dist/*` break on the next minor, and one of them already has a public export.** Installed 0.6.4 ships `dist/deltas.js`, `dist/UIMessages.js`, `dist/shared.js`. In 0.7.1 the first two moved to `dist/vercel/deltas.js` and `dist/vercel/UIMessages.js`; `dist/shared.js` stayed. Neither 0.6.4 nor 0.7.1 exports `deriveUIMessagesFromDeltas`, `getParts`, `blankUIMessage`, `statusFromStreamStatus`, or `combineUIMessages` from the root or `./react` entry, so no public equivalent exists for those five. `sorted` IS exported from the root entry in both versions (`export { extractText, isTool, sorted } from "../shared.js"`), so `src/lib/chat/agentInternal.ts` should import it from `@convex-dev/agent` today. The spine says the version is "pinned in `src/lib/chat/agentInternal.ts`"; `package.json` has `^0.6.4` (caret), which is safe only because 0.x caret stops at the minor. Worth stating precisely.

### Medium

**M1. `voyage-3-large` is now a previous-generation model.** Voyage's embeddings page lists the `voyage-4` family (Jan 2026) as current and moves `voyage-3-large` under "Older models ... still accessible ... we recommend using the new models". Still served, same 1024d default, so nothing is broken. The code comment in `convex/ai/brain/embeddings.ts` already anticipates a voyage-4 re-embed; the spine's Stack row presents `voyage-3-large` as a plain fact with no lifecycle note. `rerank-2.5` remains the GA recommendation (`rerank-3` is in preview), so that half is current.

**M2. `@anthropic-ai/sdk` is five months and 41 minor releases behind.** Installed 0.82.0 (2026-04-01); latest 0.123.0 (2026-09-01). The SDK is pre-1.0 so minors can carry breaking changes, and Sonnet 5 / Opus 4.8 (both used) post-date the installed SDK. Model ids are strings so calls work, but newer request surfaces (adaptive thinking, effort) may be absent from the installed types. Also verified: Anthropic now rejects non-default `temperature`/`top_p`/`top_k` on Opus 4.7 and later with a 400; `rg` finds no such usage under `convex/ai`, so the repo is clean on that deprecation.

**M3. AD-9 "one routing point" is contradicted by the research path, and an Anthropic id is routed through OpenRouter.** `convex/ai/research/core.ts:12-16` sets `reviewer: "anthropic/claude-sonnet-5"` and `research/actions.ts` calls `callOpenRouterResearch` directly (three call sites), never `clientForModel`. `gatewayForModel("anthropic/claude-sonnet-5")` would return `anthropic` (unknown id fallback), yet the call goes to OpenRouter. It is still metered (`openrouter.ts` routes through `instrument.ts`), so the "every call metered" half holds; the "only routing point" and "Anthropic ids go direct" halves do not. The spine's Alternate-models row also omits the reviewer model.

**M4. Convex transaction caps versus AD-5 frozen inputs.** Convex docs: per mutation 16 MiB written, 16 MiB read, 16,000 documents written, 1 MiB per document. `reserveGeneration` copies up to 20 transcripts x 500k chars plus 50 documents x 200k chars into `generationSources` in one mutation: up to 20M chars written (and read), above the 16 MiB cap, and a 500k-char non-ASCII transcript can exceed the 1 MiB document cap. Divergence 10 already notes `MAX_TOTAL_TRANSCRIPT_CHARS` is unreferenced; the spine should cite the platform cap as the reason the total bound is required, not only as a prompt-budget concern.

**M5. `better-auth` is held below 1.7 by the Convex adapter.** `@convex-dev/better-auth@0.12.5` (latest, 2026-06-27) peers on `better-auth >=1.6.11 <1.7.0`. `better-auth` 1.7.2 is latest (2026-08-26). The `~1.6.15` tilde in `package.json` is the right guard; the spine's `1.6.x` row is accurate but does not say the ceiling is imposed by the adapter.

**M6. Convex action limit wording.** Convex docs now list two limits: Convex runtime actions 30 minutes, Node runtime actions 10 minutes. Every `convex/ai/**` action carries `"use node"`, so the spine's "Convex 600 s action limit" (AD-9, `providers.ts:33`) is correct for the current code, but it is a Node-runtime number. If any filter is ever moved to the Convex runtime the budget arithmetic in `providers.test.ts` becomes 5x too conservative rather than wrong; state the runtime.

**M7. `claude-haiku-4-5-20251001` may leave the window soon.** Anthropic lists it Active with retirement "not sooner than October 15, 2026", six weeks from the spine date. It is in `CANDIDATE_MODELS` (not named in the spine). Not a spine defect, but the model list the spine points to will need a review before that date.

### Low

**L1. "SvelteKit SPA" is a misnomer.** No `ssr = false` anywhere; `src/routes/+layout.server.ts` runs a server load; `convex-svelte` constructs `ConvexClient` with `disabled: !BROWSER` during SSR. So it is an SSR HTML shell with client-only subscriptions, which is what the deployment diagram ("HTML shell + chunks") already says. AD-18's text "the only `+page.server.ts` is the root layout auth state" should read `+layout.server.ts`.

**L2. `convex` 1.42.3 vs 1.45.0.** Three minors behind (1.43 2026-07-31, 1.44 2026-08-13, 1.45 2026-08-21). Nothing breaking in the changelog; 1.44 added `schema.doc()` and 1.45 added the AI gateway service token. `_generated/ai/guidelines.md` targets `^1.41.0`.

**L3. TypeScript 7 and Vitest 5 are out.** `typescript` latest is 7.0.2 (2026-07-08; the native compiler), installed 5.9.3; SvelteKit peers on `^5.3.3 || ^6.0.0`, so 5.x remains correct. `vitest` 5.0.0 published 2026-09-03 (today); installed 4.1.10. Spine rows `5.x` / `4.1.x` are accurate.

**L4. Node remains unspecified.** Confirmed: no `.nvmrc`, no `engines`. CI uses Node 22; local is 22.22.3; Vite 8 needs `^20.19 || >=22.12`; agent 0.7 needs 22+. Vercel Node version is set in the dashboard, not the repo, and `adapter-vercel`'s `runtime` option is now deprecated in favour of that dashboard setting, so the gap is real and worth an `engines` line.

**L5. Skew-handling claim verified.** `vite.config.ts:32` `version: { pollInterval: 60_000 }`, `+layout.svelte` `beforeNavigate` on `updated.current` plus `vite:preloadError` reload. SvelteKit docs confirm this pattern and note Vercel's cookie-based Skew Protection as a dashboard alternative; the spine does not claim that is enabled, which is correct.

**L6. Minor version staleness with no risk.** svelte 5.56.6 vs 5.57.0; kit 2.70.1 vs 2.70.3 (3.0.0-next exists); vite 8.1.5 vs 8.2.2; bits-ui 2.18.1 vs 2.19.0; workflow 0.4.4 vs 0.4.6; workpool 0.4.8 vs 0.4.11. tailwindcss 4.3.3, adapter-vercel 6.3.4, convex-svelte 0.14.0, svelte-tiptap 3.0.1, `@convex-dev/better-auth` 0.12.5 are all at latest.

## Reality table

| Item | Spine says | Reality | Source |
| --- | --- | --- | --- |
| svelte | 5.56.6 | installed 5.56.6; latest 5.57.0 (2026-08-28) | `node_modules/svelte/package.json`; registry.npmjs.org/svelte |
| @sveltejs/kit | 2.70.1 | installed 2.70.1; latest 2.70.3 (2026-08-18); `next` 3.0.0-next.25 | `node_modules/@sveltejs/kit/package.json`; registry |
| @sveltejs/adapter-vercel | 6.3.x | installed 6.3.4 = latest (2026-06-18); `next` 7.0.0-next.8 | node_modules; registry |
| vite | 8.1.5 | installed 8.1.5; latest 8.2.2 (2026-08-20) | node_modules; registry |
| typescript | 5.x | installed 5.9.3; latest 7.0.2 (2026-07-08); kit peer `^5.3.3 \|\| ^6.0.0` | node_modules; registry; `@sveltejs/kit` peerDependencies |
| tailwindcss | 4.3.3 | installed 4.3.3 = latest | node_modules; registry |
| bits-ui | 2.18.x | installed 2.18.1; latest 2.19.0 (2026-08-20); `shadcn-svelte` not a package (vendored) | node_modules; registry |
| svelte-tiptap | 3.0.x | installed 3.0.1 = latest (2025-10-28); `@tiptap/core` 3.28.0 | node_modules; registry |
| convex | 1.42.3 | installed 1.42.3; latest 1.45.0 (2026-08-21); guidelines target `^1.41.0` | node_modules; registry; `convex/_generated/ai/guidelines.md:3`; github.com/get-convex/convex-js/blob/main/CHANGELOG.md |
| convex-svelte | 0.14.x | installed 0.14.0 = latest | node_modules; registry |
| @convex-dev/agent | 0.6.4, deep imports pinned | installed 0.6.4 (`^0.6.4` caret); latest 0.7.1 (2026-08-20) needs `ai ^7`, Node 22+; 0.7 moves `deltas.js`/`UIMessages.js` to `dist/vercel/`; `sorted` is public in both; five other helpers public in neither | `package.json:22`; `src/lib/chat/agentInternal.ts`; 0.7.1 tarball `dist/`, `MIGRATION.md`; registry peerDependencies |
| @convex-dev/rag | 0.7.x | installed 0.7.5 (`ai ^6` dep); latest 0.7.6 (2026-08-14) peers `ai ^7`; `alpha` 0.8.0-alpha.0 | registry versions 0.7.5 / 0.7.6 |
| @convex-dev/workflow | 0.4.x | installed 0.4.4; latest 0.4.6 | node_modules; registry |
| @convex-dev/workpool | 0.4.x | installed 0.4.8; latest 0.4.11 | node_modules; registry |
| @convex-dev/better-auth | 0.12.x | installed 0.12.5 = latest (2026-06-27); peer `better-auth >=1.6.11 <1.7.0` | node_modules; registry peerDependencies |
| better-auth | 1.6.x | installed 1.6.23 (`~1.6.15`); latest 1.7.2 (2026-08-26), blocked by adapter peer | node_modules; registry |
| ai | 6.0.x | installed 6.0.230; latest 7.0.92 (2026-09-03); 7.0.0 shipped 2026-06-25; `ai-v6` tag 6.0.276 | node_modules; registry dist-tags |
| @ai-sdk/anthropic | 3.0.x | installed 3.0.98; latest 4.0.49 (ai v7); `ai-v6` tag 3.0.116 | node_modules; registry |
| @ai-sdk/voyage | not listed | installed 1.0.17; latest 2.0.36 (ai v7); `ai-v6` tag 1.0.27 | node_modules; registry |
| @anthropic-ai/sdk | 0.82.x | installed 0.82.0 (2026-04-01); latest 0.123.0 (2026-09-01) | node_modules; registry |
| vitest | 4.1.x | installed 4.1.10; latest 5.0.0 (2026-09-03) | node_modules; registry |
| Node | unspecified | confirmed: no `.nvmrc`, no `engines`; CI `node-version: 22`; local v22.22.3; vite 8 engines `^20.19.0 \|\| >=22.12.0` | `.github/workflows/ci.yml:26`; `node_modules/vite/package.json` engines |
| `claude-sonnet-5` default | Anthropic direct | `shared/generationModels.ts:1` `MODEL = "claude-sonnet-5"`; Anthropic: Active, API id `claude-sonnet-5`, retirement not sooner than 2027-06-30 | platform.claude.com/docs/en/about-claude/model-deprecations; .../models/overview |
| `claude-opus-4-8`, `claude-haiku-4-5-20251001` | not named (in code) | both Active; Haiku 4.5 retirement not sooner than 2026-10-15 | same deprecation page |
| `temperature`/`top_p`/`top_k` | not mentioned | deprecated, 400 on Opus 4.7+ for non-default; no usage under `convex/ai` | same page; `rg` over `convex/ai` |
| `openai/gpt-5.6-sol` | research via OpenRouter | present on OpenRouter (created 2026-07-09, ctx 1.05M, max out 128k) | openrouter.ai/api/v1/models |
| `perplexity/sonar-deep-research` | research via OpenRouter | present (created 2025-03-07, ctx 128k) | openrouter.ai/api/v1/models |
| `anthropic/claude-sonnet-5` reviewer | not mentioned | `research/core.ts:15` routes an Anthropic id via OpenRouter through `callOpenRouterResearch`, not `clientForModel`; present on OpenRouter | `convex/ai/research/core.ts`, `research/actions.ts:38,57,237`, `research/openrouter.ts:5` |
| `openai/gpt-5.6-luna`, `google/gemini-3.1-pro-preview`, `google/gemini-3.5-flash` | "openai/*, google/* via OpenRouter" | all present on OpenRouter | openrouter.ai/api/v1/models |
| `voyage-3-large` 1024d | Embeddings | `embeddings.ts:20` uses it; Voyage lists it under "Older models" (previous generation); `voyage-4-large` current since 2026-01-15; still served | docs.voyageai.com/docs/embeddings |
| `rerank-2.5` | Rerank | `embeddings.ts:28`; current GA recommendation; `rerank-3` in preview | docs.voyageai.com/docs/reranker |
| Action limit 600 s | "Convex 600 s action limit" | Node runtime actions 10 min; Convex runtime actions 30 min; all `convex/ai/**` actions are `"use node"` | docs.convex.dev/production/state/limits; `rg '"use node"' convex` |
| Anthropic budget (1+1)x240+60<600 | AD-9 | `providers.ts:33-56` matches; `openrouterCore.ts:126` `OPENROUTER_MAX_RETRIES=1`, `openrouter.ts:40` 180 s | repo |
| Transaction bounds | frozen copies 20x500k + 50x200k chars | Convex: 16 MiB written / 16 MiB read / 1 MiB per document per mutation; worst case exceeds all three | docs.convex.dev/production/state/limits; `convex/generations.ts:449-486` |
| Reaper 30 min vs action | AD-5 | consistent (30 min > 10 min Node limit) | `convex/crons.ts`; Convex limits page |
| Embed workpool maxParallelism 1 | AD-9 | `convex/brain.ts:29` | repo |
| Only server file is root layout | "+page.server.ts" | it is `src/routes/+layout.server.ts`; `hooks.server.ts` scopes JWT only | `fd '\+(page\|layout)\.server' src` |
| SvelteKit "SPA" | Paradigm table, AD-18 | SSR on; `convex-svelte` disables client during SSR (`disabled: !BROWSER`) | `node_modules/convex-svelte/dist/client.svelte.js:35` |
| Deploy skew: 60 s poll + preloadError | Operational envelope | `vite.config.ts:32`, `+layout.svelte:31-48`; SvelteKit docs confirm `updated.current`; Vercel Skew Protection is a separate dashboard option | svelte.dev/docs/kit/adapter-vercel#Skew-protection |
| adapter-vercel config | Vercel via adapter | adapter passed inside `sveltekit({...})` in `vite.config.ts` (no `svelte.config.js`); `vercel.json` sets build command; adapter `runtime` option now deprecated (dashboard Node version) | `vite.config.ts`; `vercel.json`; svelte.dev/docs/kit/adapter-vercel |
| Runes forced | `vite.config.ts:24-25` | lines 24-26, `runes: true` outside node_modules | `vite.config.ts` |
| Components in use | rag, agent, workpool, workflow, betterAuth | `convex/convex.config.ts:37-45` | repo |

## Recommended spine edits (for the author, not applied)

1. Stack table: add a "Line" note that `ai`, `@ai-sdk/*`, `@convex-dev/agent`, `@convex-dev/rag` are held on the AI SDK v6 line; pin `@convex-dev/rag` to `0.7.5` exactly; record "AI SDK v7 migration" under Deferred with the agent MIGRATION.md as the source.
2. `agentInternal.ts`: import `sorted` from the public root; keep the other five deep imports but name the 0.7 path change (`dist/vercel/`) in the comment.
3. AD-9: either route research through `clientForModel` or amend the rule to name `callOpenRouterResearch` as a second sanctioned path, and decide whether `anthropic/claude-sonnet-5` should go direct.
4. AD-5: cite the 16 MiB / 1 MiB Convex mutation caps and promote divergence 10 (total input bound) from "prompt budget" to "platform correctness".
5. AD-9: say "Node-runtime action limit (10 min)".
6. Embeddings row: mark `voyage-3-large` as previous generation with a planned re-embed to `voyage-4-large` (requires a new RAG namespace, per `embeddings.ts`).
7. Add `engines.node >= 22` to `package.json` and cite it in the Stack table.
8. AD-18: `+layout.server.ts`, and "SSR shell + client subscriptions" instead of "SPA".
