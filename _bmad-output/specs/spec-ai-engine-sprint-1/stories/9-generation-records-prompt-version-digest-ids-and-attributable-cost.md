---
title: 'Generation records prompt version, digest ids, and attributable cost'
type: 'feature'
created: '2026-08-26'
status: 'done'
baseline_revision: 'de2c649e7a06d24ea83a5c1563cd7e4899059c76'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-1/SPEC.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** CAP-9. A generation does not record which prompt text or which published learning digests produced it, and `aiUsage` rows carry no `generationId`, so per-generation cost and latency are unknowable (audit T3, finding 18).

**Approach:** Add optional provenance fields to `generations` (`promptVersion`, `learningDigestIds`) written by the two generation actions; add optional `generationId`, `candidateRunId`, `durationMs` to `aiUsage` with a `by_generationId` index, threaded through the instrumented provider clients; have `getGeneration` return the provenance plus cost summed from the indexed `aiUsage` rows.

## Boundaries & Constraints

**Always:**
- Schema changes are additive and optional; no backfill; index named per guidelines (`by_generationId`).
- `promptVersion` is derived from prompt content (not hand-bumped): `sha256` of the default-build prompt corpus, so editing any generation prompt changes it and identical text yields an identical value.
- `learningDigestIds` is written whenever the digest fetch completes, including `[]` when no digest is published, so "ran without guidance" is distinguishable from a legacy row (field absent).
- Usage logging keeps its never-fail contract: attribution fields ride on the existing `scheduleUsage` event; a missing `generationId` still inserts the row.
- `durationMs` is measured by the instrumentation wrapper around the whole provider call (SDK retries / OpenRouter attempt loop included), never by callers.
- Public function paths and existing return fields of `getGeneration` are unchanged; new fields are additive so `GenerationProgress.svelte` keeps working untouched.
- `getGeneration` keeps its `getInternalProjectAccessOrNull` gate; cost is visible to any internal user with project access (admins included), no new role gate.

**Block If:**
- Adding `learningDigestIds` requires changing how `learning.getActiveDigest` selects digests (it must not).
- Any change would require an AI tool to write report prose.

**Never:**
- No cost UI, dashboards, or `usageReport` grouping changes (Sprint 2+).
- No changes to `PRICING`, `estimateCostUsd`, or the chat (`chatAgentV2.ts`) usage path; chat has no generation.
- No new `generations` status values; no edits under `convex/_generated/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cost sum | generation G; three `aiUsage` rows with `generationId: G` (`costUsd` 0.1, 0.2, 0.3) and one row for another generation | `getGeneration(G).costUsd` is 0.6 (`toBeCloseTo`), `usageCalls` is 3 | No error expected |
| No usage yet | generation G with no `aiUsage` rows | `costUsd: 0`, `usageCalls: 0` | No error expected |
| Legacy row | generation inserted without provenance fields | `promptVersion` and `learningDigestIds` are `undefined` in the response; other fields unchanged | No error expected |
| Attributed log | `internal.aiUsage.logUsage` with `generationId`, `candidateRunId`, `durationMs: 1234` | inserted row carries all three verbatim and is found via `by_generationId` | No error expected |
| Unattributed log | `logUsage` without the new args | row inserts exactly as today; new fields absent | No error expected |
| Begin records prompt version | `beginGeneration({ generationId, promptVersion })` on a `reserved` generation | row patched to `running` with `promptVersion` set | Returns `false`, no patch, when not `reserved` (existing) |
| Digest record | `recordLearningDigests({ generationId, learningDigestIds: [d1] })` | `generations.learningDigestIds` equals `[d1]`; `[]` stores an empty array | Missing generation: no-op, no throw |
| Prompt version stability | `currentPromptVersion()` called twice | identical strings; differs from the sha256 of a modified corpus | No error expected |

</intent-contract>

## Code Map

- `convex/schema.ts:466-482` -- `aiUsage` table: add `generationId: v.optional(v.id("generations"))`, `candidateRunId: v.optional(v.id("generationCandidateRuns"))`, `durationMs: v.optional(v.number())`; add `.index("by_generationId", ["generationId"])` after `by_projectId`.
- `convex/schema.ts:596-696` -- `generations` table: add `promptVersion: v.optional(v.string())` and `learningDigestIds: v.optional(v.array(v.id("learningDigests")))` next to `brainRetrievalBrief` (`:688`).
- `convex/ai/instrument.ts:8-22` -- `UsageEvent`: add `generationId?`, `candidateRunId?`, `durationMs?`. `:85-96` -- `instrumentedAnthropic` meta: add `generationId?`, `candidateRunId?`. `:101-140` -- the proxied `create`: take `Date.now()` before `Reflect.apply`, compute `durationMs` after, spread the three fields into `scheduleUsage` like `projectId` is spread today.
- `convex/ai/openrouter.ts:60-71` -- `openRouterChatCompletion` input: add `generationId?`, `candidateRunId?`. `:152-163` -- the `scheduleUsage` call: add the fields plus `durationMs` measured from before the attempt loop (`:78`). `:166-172` -- `instrumentedOpenRouter` meta: same two fields.
- `convex/ai/providers.ts:54-71` -- `clientForModel` meta type: add `generationId?`, `candidateRunId?`; it already spreads `meta` into both clients.
- `convex/aiUsage.ts:155-170` -- `usageArgs`: add the three optional args. `:190-231` -- `logUsage` insert: spread `generationId`, `candidateRunId`, `durationMs` (validated `>= 0` finite, like `billableTokens`) when present.
- `convex/ai/prompts.ts` -- add `promptCorpus()` (concatenation of `ANALYZER_SYSTEM_PROMPT`, `buildSection242SystemPrompt()`, `buildSection244SystemPrompt()`, `buildSection246SystemPrompt()`, `buildQaSystemPrompt()` default builds, joined by a fixed separator) and `currentPromptVersion(): Promise<string>` returning `` `sha256:${(await sha256(promptCorpus())).slice(0, 16)}` `` using `sha256` from `convex/lib/contracts.ts:241`.
- `convex/generations.ts:608-622` -- `beginGeneration`: add `promptVersion: v.optional(v.string())` arg; include it in the patch when supplied. Add a sibling `recordLearningDigests` internalMutation (`generationId`, `learningDigestIds: v.array(v.id("learningDigests"))`) that patches the field when the generation exists.
- `convex/generations.ts:102-129` -- `getGeneration`: after the access gate, `for await` over `aiUsage.withIndex("by_generationId", q => q.eq("generationId", generation._id))` summing `costUsd` and counting rows; return additional `promptVersion`, `learningDigestIds`, `costUsd`, `usageCalls`.
- `convex/ai/pipeline.ts:341-343` -- `generateReport` begin call: pass `promptVersion: await currentPromptVersion()`. `:371-376` -- `retrievalBriefClient`: add `generationId: args.generationId`. `:445-467` -- after the digest `Promise.all`, call `internal.generations.recordLearningDigests` with the non-null digest `_id`s (inside the existing try so learning still never breaks generation). `:548-553` -- `generateCandidate` `clientFor`: add `generationId: args.generationId`, `candidateRunId: args.candidateRunId`.
- `convex/ai/iterative.ts:57-59` -- `startIterativeGeneration` begin call: pass `promptVersion`. `:80-93` -- `clientFor` and `briefClient`: add `generationId: genId`. `:138-155` -- digest fetch: record ids the same way. `:279-284` -- section `clientFor`: add `generationId: args.generationId`.
- `convex/ai/postQa.ts:42-47` -- `clientFor`: add `generationId: args.generationId` (QA pass cost attributes to its generation).
- `convex/ai/brain/retrieve.ts:91-101` -- `BrainSearchArgs` gains `generationId?: Id<"generations">`; `:136-145,183-195` -- spread it into both `scheduleUsage` calls; `:228-243` -- `retrieveBrainContext` internalAction args gain `generationId: v.optional(v.id("generations"))`. `convex/ai/brainRetrieval.ts:118-131` -- the `ctx.runAction(internal.ai.brain.retrieve.retrieveBrainContext, {...})` call: add `generationId: params.generationId`. Other callers (`chatAgentV2.ts:163`, `research/actions.ts:109`) are read-only.
- `convex/generationRecovery.test.ts:1-79` -- convex-test fixture precedent (`users` with `authId`, `projects`, `transcripts`, `generations`, `generationCandidateRuns`); `vi.stubEnv` for provider keys; `t.withIdentity({ subject: authId })` for the `getGeneration` query.
- `convex/ai/prompts.test.ts:1-30` -- vitest home for the prompt-version determinism test.
- `tests/aiUsage.test.ts` -- read-only: bun-only harness not run by `npm test` (vitest projects are `convex/**`, `shared/**`, `src/**`). New convex-test coverage goes in `convex/generationAttribution.test.ts`.
- `src/lib/components/generation/GenerationProgress.svelte:19` -- sole `getGeneration` consumer; read-only, additive fields only.
- `convex/ai/chatAgentV2.ts:258`, `convex/ai/brain/ingest.ts:129` -- other usage emitters; read-only (no generation context).

## Tasks & Acceptance

**Execution:**
- `convex/schema.ts` -- add the three optional `aiUsage` fields + `by_generationId` index; add `promptVersion`, `learningDigestIds` to `generations` -- additive schema per constraints.
- `convex/ai/prompts.ts` -- add `promptCorpus()` and `currentPromptVersion()` -- content-derived version.
- `convex/aiUsage.ts` -- extend `usageArgs` and the `logUsage` insert -- persist attribution.
- `convex/ai/instrument.ts`, `convex/ai/openrouter.ts`, `convex/ai/providers.ts` -- thread `generationId`/`candidateRunId` through meta types and measure `durationMs` in the wrappers -- both gateways attribute identically.
- `convex/ai/brain/retrieve.ts`, `convex/ai/brainRetrieval.ts` -- carry `generationId` through `retrieveBrainContext` args onto Voyage usage rows -- retrieval cost is part of generation cost.
- `convex/generations.ts` -- `beginGeneration` `promptVersion` arg; new `recordLearningDigests`; `getGeneration` provenance + cost sum -- exposure surface.
- `convex/ai/pipeline.ts`, `convex/ai/iterative.ts`, `convex/ai/postQa.ts` -- pass `promptVersion` at begin, record digest ids after the fetch, add `generationId`/`candidateRunId` to every client factory -- every generation call site attributes.
- `convex/generationAttribution.test.ts` -- new convex-test file covering every I/O matrix row except prompt-version stability; run `beginGeneration`/`recordLearningDigests`/`logUsage` via `t.mutation(internal...)` and `getGeneration` via `t.withIdentity(...).query(api.generations.getGeneration, ...)`.
- `convex/ai/prompts.test.ts` -- add the prompt-version stability test -- guards the derivation.

**Acceptance Criteria:**
- Given a generation started by `generateReport` or `startIterativeGeneration` with one published `draft_style` digest, when it finishes, then its row has `promptVersion` matching `/^sha256:[0-9a-f]{16}$/` and `learningDigestIds` containing that digest id.
- Given a candidate model call made through `clientForModel` with `generationId` and `candidateRunId` in meta, when the provider responds, then the scheduled `aiUsage` row carries both ids and a non-negative `durationMs`.
- Given an internal user with access to generation G, when they call `api.generations.getGeneration`, then the response includes `promptVersion`, `learningDigestIds`, `costUsd`, and `usageCalls` alongside every field returned today.
- Given the full test suite, when `npm test` and `npm run check` run, then both pass with no changes to `src/`.

## Spec Change Log

## Review Triage Log

### 2026-08-26 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 4, low 4)
- defer: 0
- reject: 18
- addressed_findings:
  - `[medium]` `[patch]` `recordLearningDigests` sat inside the digest-fetch `try`, so a fetch failure left `learningDigestIds` absent (indistinguishable from a legacy row) and a write failure was logged as "fetch failed". Moved the record call outside the fetch guard in `convex/ai/pipeline.ts` and `convex/ai/iterative.ts`: ids collected in a local, `[]` on fetch failure, own `try/catch` with a "record failed" message.
  - `[low]` `[patch]` `beginGeneration.promptVersion` was optional and spread only when truthy, so a forgetful call site or an empty string would silently produce a legacy-looking row. Made the arg required (`v.string()`) and patched unconditionally in `convex/generations.ts`; both action call sites are now enforced by the type check.
  - `[medium]` `[patch]` Anthropic wrapper attribution (`generationId`/`candidateRunId`/`durationMs` on the scheduled `logUsage` payload) was never executed by a test. Added `convex/ai/instrument.test.ts` driving the real proxy with a stubbed SDK client.
  - `[medium]` `[patch]` OpenRouter attribution and the retry-inclusive `durationMs` passed the retry-loop suite unobserved. Extended `convex/ai/openrouterRetryLoop.test.ts` with a 429→200 case asserting both ids and `durationMs` across the loop, plus an unattributed case.
  - `[medium]` `[patch]` Brain retrieval attribution (Voyage embedding + rerank rows) was unverified. Added `convex/ai/brain/retrieveAttribution.test.ts` driving `searchBrainExemplars` with stubbed search/rerank and asserting `generationId` on both rows.
  - `[low]` `[patch]` `logUsage` sanitisation of negative / non-finite `durationMs` had no test. Added a case to `convex/generationAttribution.test.ts`.
  - `[low]` `[patch]` `currentPromptVersion` test was self-referential. Added a case asserting the corpus contains each constituent generation prompt and excludes the chat prompt.
  - `[low]` `[patch]` `promptCorpus()` scope (what is and is not hashed) and the `generations.promptVersion` schema comment did not say the value fingerprints default-build prompt text rather than the exact per-generation prompt. Documented in `convex/ai/prompts.ts` and `convex/schema.ts`.

## Auto Run Result

**Summary:** CAP-9 provenance and attribution. `generations` gains `promptVersion` (content-derived `sha256:<16 hex>` of the default-build generation prompt corpus, written at the `reserved -> running` fence) and `learningDigestIds` (recorded once the digest fetch settles, `[]` when nothing is published or the fetch failed). `aiUsage` gains `generationId`, `candidateRunId`, `durationMs` with a `by_generationId` index; both provider wrappers measure `durationMs` around the whole call (retries included) and forward the ids from every generation call site (candidate runs, iterative section runs, retrieval brief, post-QA, Brain embedding/rerank). `getGeneration` additionally returns `promptVersion`, `learningDigestIds`, `costUsd`, `usageCalls`.

**Files changed:**
- `convex/schema.ts` -- optional `aiUsage` attribution fields + `by_generationId`; `generations.promptVersion` / `learningDigestIds`.
- `convex/aiUsage.ts` -- `logUsage` accepts and persists the attribution fields (`durationMs` only when finite and `>= 0`).
- `convex/generations.ts` -- `beginGeneration` requires `promptVersion`; new `recordLearningDigests`; `getGeneration` sums indexed usage and exposes provenance.
- `convex/ai/prompts.ts` -- `promptCorpus()` and `currentPromptVersion()` with documented scope.
- `convex/ai/instrument.ts`, `convex/ai/openrouter.ts`, `convex/ai/providers.ts` -- ids threaded through meta; `durationMs` measured in the wrappers.
- `convex/ai/pipeline.ts`, `convex/ai/iterative.ts`, `convex/ai/postQa.ts` -- pass `promptVersion` at begin, record digest ids outside the fetch guard, attribute every client factory.
- `convex/ai/brain/retrieve.ts`, `convex/ai/brainRetrieval.ts` -- `generationId` carried onto Voyage usage rows.
- Tests: `convex/generationAttribution.test.ts` (new), `convex/ai/instrument.test.ts` (new), `convex/ai/brain/retrieveAttribution.test.ts` (new), `convex/ai/prompts.test.ts`, `convex/ai/openrouterRetryLoop.test.ts`.

**Review findings:** 8 patched (0 high, 4 medium, 4 low), 0 deferred, 18 rejected (intent-scoped exclusions such as cost UI, role gating, `candidateRunId` index, post-QA re-run versioning, backfill; spec-directed choices such as the `sha256:` prefix and the `lib/contracts` hash helper; and non-issues such as streaming duration with no streaming callers, NaN `costUsd` already sanitised, and section runs living in `generationSectionRuns` rather than `generationCandidateRuns`).

**Follow-up review recommendation:** true. Patched by severity: high 0, medium 4, low 4; score = 3 x 4 + 1 x 4 = 16 (threshold 5).

**Verification:**
- `npm test -- generationAttribution prompts instrument openrouterRetryLoop retrieveAttribution` -- 5 files, 51 tests passed.
- `npm test` -- 109 files, 1027 tests passed.
- `PUBLIC_CONVEX_URL=http://placeholder npm run check` -- 0 errors, 0 warnings.

**Residual risks:**
- `generateReport` / `startIterativeGeneration` are still not driven end-to-end by a test; the `promptVersion` hand-off is enforced by the now-required mutation arg, but the `recordLearningDigests` wiring is verified by inspection only.
- `promptVersion` fingerprints default-build prompt text; per-generation runtime inputs (style overrides, writer flavor, waivers) are not part of the hash by design.
- `getGeneration` scans every `aiUsage` row for the generation on each reactive evaluation; row counts are bounded by provider calls per generation, but a long compare-mode run re-evaluates on every logged call.
- Historical generations (pre-deploy) report `costUsd: 0`, `usageCalls: 0` because no backfill was performed.

## Design Notes

Provenance lands in two writes rather than one because `beginGeneration` is the `reserved -> running` fence and runs before the digest fetch (`pipeline.ts:445`, `iterative.ts:138`); moving the fetch ahead of the fence would run queries for generations that lose the race. `promptVersion` is known before begin (pure function of prompt text) so it rides on the fence patch; digest ids are recorded immediately after they are resolved. `currentPromptVersion` reuses the existing async `sha256` helper instead of a new sync hash; the actions already await mutations before the provider work starts, so one extra await is free. `durationMs` is measured in the wrappers because that is the only place both gateways share, and it makes latency per call comparable across Anthropic and OpenRouter rows.

## Verification

**Commands:**
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- generationAttribution` -- expected: all new cases pass.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test -- prompts` -- expected: prompt-version test passes with existing suite.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && npm test` -- expected: green.
- `cd /Users/johnnynguyen/Documents/Repos/Banhall-bmad-loop && PUBLIC_CONVEX_URL=http://placeholder npm run check` -- expected: 0 errors.
