---
title: 'Generations record prompt version hash and learning digest ids'
type: 'feature'
created: '2026-09-01'
status: 'done'
review_loop_iteration: 0
followup_review_recommended: true
baseline_revision: '3198cc726d3c7d2c1eaf14326e26f1d0c5182c09'
baseline_commit: 'e5cc1dc82fc28212a9efd837c01c3791d7783b20'
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
warnings: ['oversized']
deferred:
  - summary: >-
      A deployment can change the live prompt program while an already-started generation is still running.
    evidence: >-
      The approved design stamps promptVersion atomically at beginGeneration and intentionally does not re-verify it at later provider handoffs, so a mid-flight generation may finish under mixed deployed code while retaining its start-time hash.
    location: >-
      convex/ai/pipeline.ts, convex/ai/iterative.ts, convex/ai/instrument.ts
    severity: low
  - summary: >-
      Generation-owned Voyage query-embedding and rerank usage remains outside Story 10 attribution.
    evidence: >-
      The existing Brain retrieval path writes aiUsage rows but does not pass generationId or durationMs; candidateRunId is not applicable because retrieval occurs before candidate runs.
    location: >-
      convex/ai/brainRetrieval.ts, convex/ai/brain/retrieve.ts
    severity: high
  - summary: >-
      Digest provenance can grow after terminal status through post-QA or late in-flight calls.
    evidence: >-
      The approved story design permits completed post-QA attribution, and the union mutation has no terminal fence, so late ghost calls can also extend the union.
    location: >-
      convex/generations.ts, convex/ai/postQa.ts, convex/ai/pipeline.ts
    severity: high
  - summary: >-
      Partial candidate retries do not define ownership for copied candidate provenance and usage.
    evidence: >-
      retryFailedCandidates can copy a successful candidate into a newly hashed generation while its original usage and report provenance remain keyed to the prior generation.
    location: >-
      convex/generations.ts
    severity: high
  - summary: >-
      The prompt-program manifest does not cover every stable provider-visible rule.
    evidence: >-
      Review found omitted deterministic QA rendering, structured validation summaries, CRA science-code labels, and recovery routes, plus descriptive fields that runtime code does not consume.
    location: >-
      convex/ai/promptProgram.ts, convex/ai/qaChecks.ts, convex/ai/structured.ts, shared/craScienceCodes.ts
    severity: high
  - summary: >-
      Usage persistence and attribution integrity remain best effort in rare failure or caller-error paths.
    evidence: >-
      A simultaneous scheduler and fallback mutation failure drops returned usage, and logUsage does not validate generation, candidate, and project relationships.
    location: >-
      convex/ai/instrument.ts, convex/aiUsage.ts
    severity: high
  - summary: >-
      Some generation entry and artifact boundaries lack full integration coverage.
    evidence: >-
      Iterative stamping and style-digest restoration, scheduled candidate arguments, retrieval usage, and provider-to-index persistence are covered at component seams rather than one complete flow.
    location: >-
      convex/generationAttribution.test.ts, convex/ai/instrument.test.ts
    severity: medium
  - summary: >-
      Fourteen legacy tests/*.test.ts files still import bun:test and are executed by no script or CI job.
    evidence: |-
      package.json defines no bun test script, vitest.config.ts includes only convex, shared, src, and the explicitly added tests/aiUsage.test.ts, and CI runs only npm run check and npm test, so those suites never run anywhere. Pre-existing; surfaced while reviewing the single-file Vitest migration.
    location: >-
      tests/*.test.ts, vitest.config.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** Generation rows do not identify the stable prompt program or the learning digests actually disclosed to providers, and provider usage cannot be joined reliably to its generation or candidate run.

**Approach:** Stamp each new generation with a deterministic prompt-program hash, record digest provenance transactionally at the provider handoff boundary, and carry optional generation attribution and elapsed time through every generation-owned provider call that returns usage.

## Boundaries & Constraints

**Always:** Treat `promptVersion` presence as the tracked-generation marker. New reservations start with `learningDigestIds: []`, and their entry action writes `promptVersion` before any provider call. Hash one deployment-level prompt-program definition, including every supported static branch and routing rule, rather than runtime branch selections. Use the canonical algorithm and exact input list in Design Notes. Pair each digest id with its content through assembly, submit only ids for nonblank digest content present in that exact payload, and await a transactional union mutation immediately before every generation-owned provider handoff that includes digest content. For a tracked row, that mutation unions the ids under Convex optimistic concurrency and stores them deduplicated in deterministic order. It does not compare prompt hashes and does not refuse ids after terminal status: post-QA on a completed generation is generation-owned and may extend the union. Every generation-owned logical Anthropic or OpenRouter call with genuine returned usage writes one `aiUsage` row immediately after the response, before downstream decoding, with `generationId`, `durationMs`, and `candidateRunId` only for `generationCandidateRuns`. Duration covers the whole logical SDK or transport call, including its internal retries and backoff. Preserve a provider's explicit zero counters as genuine usage, but distinguish missing, empty, or malformed usage. Use optional schema fields and the exact index name `by_generationId`. Cost remains the existing `costUsd` field in US dollars. Dependencies are none; Story 11 consumes this story's index and fields.

**Block If:** The digest union cannot be awaited at the last application boundary before the provider SDK or transport receives the payload, an identified provider path cannot propagate attribution without changing its public behavior, or runtime prompt builders cannot share their real definitions with the hash manifest. Do not replace any of these guarantees with best-effort logging, source-text hashing, or a duplicated prompt corpus.

**Never:** Do not hash project data, titles, science codes, report or analysis text, transcripts, document names or content, Brain queries or exemplars, digest ids or content, writer free-text instructions, regeneration guidance, provider output, usage, timestamps, call-site labels, or other per-call user content. Do not record a digest merely because it was fetched, overwrite a prior digest union, synthesize zero-token rows, add usage rows when no usage object was returned, backfill legacy rows, make new fields required, edit `convex/_generated/`, implement Story 11's `cost` reader, add usage recording to Brain embedding or rerank calls (deferred to a follow-up story; they write no usage rows today), or change report prose and proposal workflows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|---------------------------|----------------|
| Stable prompt program | Two new generations use different projects, reports, transcripts, and digest content on the same deployed prompt program | Both rows receive the same value matching `sha256:[0-9a-f]{64}` before their first provider call | No error expected |
| Program change | One named static template, schema, instruction, routing rule, or request-affecting configuration value changes | Canonical serialization produces a different hash | Test the manifest directly, without editing production source during the test |
| Fetched but unsent digest | A digest is fetched, but its content is blank, its call is skipped, or execution fails before client `create` | Its id is absent; a tracked generation with no sent digest retains `[]` | Generation follows its existing failure or advisory behavior |
| Multi-call digest use | A style digest is sent in a section payload, then a QA digest is sent, repeated, repaired, or raced by another candidate | Stored ids grow from `[]` to the sorted deduplicated union of only those payload ids | Convex retries conflicting union mutations |
| Post-terminal QA | Automatic or manual QA runs after terminal status with a calibration digest | The digest id is unioned before handoff like any other; stored ids may grow after terminal status only through generation-owned post-QA calls | No error expected |
| Mid-generation deployment | A child action runs after a deployment changed the prompt program | The row keeps the `promptVersion` stamped at `beginGeneration`; later calls are not re-verified (recorded limitation) | No error expected |
| Completed post-QA | QA runs after terminal status and a newer live calibration exists | Live-calibration selection is unchanged for tracked and legacy rows; the id actually sent is unioned | Existing advisory QA handling |
| Usage then downstream failure | Provider returns genuine usage, then parsing, validation, candidate completion, or generation completion fails | One attributed row survives with nonnegative elapsed milliseconds | Preserve the original downstream failure |
| No usage response | Abort, transport failure, or a successful response with absent, empty, or wholly malformed usage | No usage row is written; explicit valid zero counters still write one row | Preserve existing provider error and retry behavior |
| Legacy and retry rows | A predeployment row lacks `promptVersion`; a failed generation is retried into a new row | Legacy provenance fields stay absent and compatible; the retry gets its own hash, empty union, and independently attributed usage | No migration or backfill |

</intent-contract>

## Code Map

- `convex/schema.ts:466-481,596-696` contains `aiUsage` and `generations`. Add only optional `generationId`, `candidateRunId`, `durationMs`, `promptVersion`, and `learningDigestIds`, plus `aiUsage.by_generationId`.
- `convex/generations.ts:51-57,303-453,663-679` defines terminal statuses, the sole generation reservation insert, and `beginGeneration`. Initialize the digest array at reservation; use its presence to distinguish a new-format reservation and stamp the hash atomically with its `reserved` to `running` transition.
- `convex/generations.ts:868-904,1307-1499,1562-1595,1962-1983` allows late ghost completion, rebuilds iterative and post-QA input, permits completed-generation QA reruns, and terminalizes before scheduling iterative post-QA. No terminal fence or calibration-lookup change is required; only ensure post-QA and late-ghost provider calls go through the attributed client so their digest ids and usage are recorded.
- `convex/lib/contracts.ts:243-248` is the existing UTF-8 Web Crypto SHA-256 helper. Reuse its full lowercase hex result.
- `convex/ai/prompts.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/section242Agent.ts`, `convex/ai/section244Agent.ts`, `convex/ai/section246Agent.ts`, `convex/ai/qaAgent.ts`, and `convex/ai/chronologyAgent.ts` own production prompt builders, request scaffolds, tools, and schemas. Extract reusable pure definitions; do not maintain hash-only copies.
- `convex/ai/structured.ts:44-100` owns the forced-tool request and second-attempt repair instruction. Both attempts are separate provider calls and inherit the call-specific digest and usage attribution.
- `convex/ai/pipeline.ts:54-155,233-333,340-514,517-626` owns compression, one-shot setup, digest fetch, candidate scheduling, and the analyzer, section, QA, chronology call graph. Keep ids paired with fetched content and create call-specific clients at actual assembly sites.
- `convex/ai/iterative.ts:54-239,242-350` owns iterative setup, frozen style guidance, ghost scheduling, section drafting, compression, and regenerations. Persist the nonblank style digest id beside guidance in the existing `brain_blocks` JSON artifact and restore it for later section payloads.
- `convex/ai/postQa.ts:24-156` fetches a live calibration after completion. Keep that behavior; union the sent digest id before the handoff.
- `convex/learning.ts:140-182` proves `getActiveDigest` returns an immutable row with both `_id` and `content`. Whitespace-only content is fetched but not sent and contributes no id.
- `convex/ai/providers.ts:94-112`, `convex/ai/instrument.ts:8-144`, `convex/ai/openrouter.ts:59-185`, and `convex/ai/openrouterCore.ts:256-280` are the common Anthropic and OpenRouter boundaries. Carry typed attribution, union learned ids, measure one logical call, and schedule only genuine usage.
- `convex/ai/brainRetrieval.ts:49-179` and `convex/ai/brain/retrieve.ts`: the retrieval brief goes through the common client and receives attribution like any other call; embedding and rerank calls write no usage rows today and are out of scope (deferred).
- `convex/aiUsage.ts:14-16,117-240` estimates and inserts costs. `costUsd` is US dollars, using USD-per-million-token rates or OpenRouter's native dollar cost; extend validators and inserts without changing pricing.
- `shared/generationModels.ts:1-160`, `shared/styleOverrides.ts`, `convex/lib/lineLimits.ts:12-29,244-246`, `convex/ai/model.ts:52-71`, and `convex/ai/brain/embeddings.ts:19-28` contain prompt-affecting model routing, style variants, budget, length, embedding, and rerank configuration for the manifest.
- `tests/aiUsage.test.ts:1-35` exists with three passing Bun pricing tests but is outside `npm test`; `vitest.config.ts:14-49` includes only `convex`, `shared`, and `src`. Convert this one file to Vitest and include it explicitly, without enabling the other legacy `tests/**` files.
- `convex/ai/openrouterCore.test.ts:320-341` currently expects synthetic zeros for absent usage and must be corrected. `convex/ai/openrouterRetryLoop.test.ts:79-220` already proves retry, abort, timeout, and zero-write behavior at the real transport loop.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/promptProgram.ts`, `convex/ai/prompts.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/section242Agent.ts`, `convex/ai/section244Agent.ts`, `convex/ai/section246Agent.ts`, `convex/ai/qaAgent.ts`, `convex/ai/chronologyAgent.ts`, and `convex/ai/structured.ts`: expose one JSON-compatible provider-facing definition bundle, canonical serializer, `hashPromptProgram`, and memoized `currentPromptVersion`; make runtime requests consume the same definitions so changing a real template, schema, branch, or configuration changes the hash.
- [x] `convex/schema.ts` and `convex/generations.ts`: add only the approved optional fields and `by_generationId`; initialize new unions, stamp the current version on new-format reservations before first provider work, and add the OCC-safe digest-union mutation (dedupe, deterministic order, no hash comparison, no terminal refusal). Preserve old rows and new retry isolation.
- [x] `convex/ai/providers.ts`, `convex/ai/instrument.ts`, `convex/ai/openrouter.ts`, `convex/ai/openrouterCore.ts`, and `convex/aiUsage.ts`: thread one optional typed attribution object, union call-specific learned ids at the provider boundary, measure elapsed time, persist optional attribution, and suppress only missing or invalid usage while retaining explicit zero usage.
- [x] `convex/ai/pipeline.ts`, `convex/ai/section242Agent.ts`, `convex/ai/section244Agent.ts`, `convex/ai/section246Agent.ts`, `convex/ai/qaAgent.ts`, and `convex/ai/iterative.ts`: compute the current program before `beginGeneration`, carry digest ids with content from fetch through each exact payload, use per-call clients so only section and QA requests declare the ids they include, and freeze the iterative style id with its artifact. Analyzer, compression, chronology, retrieval, and omitted or blank digest branches declare no digest ids.
- [x] `convex/generations.ts` and `convex/ai/postQa.ts`: route post-QA and late-ghost provider calls through the attributed client so their digest ids and usage are recorded; do not change calibration selection.
- [x] `tests/aiUsage.test.ts` and `vitest.config.ts`: retain the three pricing and provider-body tests under Vitest, explicitly add only this root test to the Convex project, and cover canonical hash stability, runtime exclusions, template sensitivity, key-order independence, exact hash shape, and manifest completeness.
- [x] `convex/generationAttribution.test.ts`, `convex/ai/instrument.test.ts`, `convex/ai/openrouterCore.test.ts`, and `convex/ai/openrouterRetryLoop.test.ts`: cover persistence and index reads, all digest matrix rows including post-terminal QA, both transports, structured repair, downstream failure, candidate attribution, explicit-zero versus absent usage, retries, and legacy compatibility.

**Acceptance Criteria:**
- Given any generation reserved after deployment, when its first generation action can proceed, then `promptVersion` is stored before its first provider call as `sha256:` plus the full 64-character lowercase SHA-256 of the canonical stable prompt program, and `learningDigestIds` starts as `[]`.
- Given two generations with different runtime project, report, transcript, Brain, writer free-text, and digest content, when their deployed prompt definition is unchanged, then their prompt hashes match; given any hashed template or configuration input changes, then the hash differs.
- Given a digest is fetched, when no provider payload includes nonblank content from it, then its id is absent; when section and QA payloads include learned content over one or many calls, then the generation stores exactly the sorted deduplicated union immediately before each handoff, including generation-owned post-QA calls after terminal status.
- Given any generation-owned Anthropic or OpenRouter logical call returns genuine usage, when instrumentation handles the response, then exactly one `aiUsage` row is scheduled before downstream work with its `generationId`, nonnegative `durationMs`, and applicable `candidateRunId`, even if later processing or the generation fails or retries.
- Given a provider call returns no usable usage object, when instrumentation handles success, abort, or failure, then it writes no row and creates no synthetic zero-token event; given explicit valid zero counters, then it writes one genuine row.
- Given a legacy generation or usage row lacks the new optional fields, when existing readers and writers run, then the row remains unchanged and valid; given a retry generation, then it has independent provenance and usage attribution.
- Given the schema and generated API checks run, when this story is complete, then `aiUsage.by_generationId` exists with existing naming, no backfill or migration exists, and `convex/_generated/` has no hand edits.

## Spec Change Log

- 2026-09-01 plan checkpoint (Claude Fable 5.1, reviewer): approved with amendments. (1) Removed the program-mismatch fence: later handoffs do not re-verify `promptVersion`; a mid-flight deployment is a recorded limitation, not a failure. (2) Removed the terminal digest fence and the tracked-row calibration change: post-QA keeps live calibration for all rows and unions the id it sends, so the union may grow after terminal status only via generation-owned post-QA (approved reading of "final at terminal status"). (3) Brain embedding and rerank attribution removed: those paths write no usage rows today; adding them needs pricing and is deferred to a follow-up story. (4) Hash manifest simplified to the template constants and configuration the builders compose from, not a combinatorial expansion of builder variants. Reason: the plan had grown into a pipeline refactor with new production failure modes beyond CAP-9a; the retrospective warned CAP-9-shaped stories loop when oversized.

## Review Triage Log

### 2026-09-02 — Review pass

- intent_gap: 3: (high 3, medium 0, low 0)
- bad_spec: 10: (high 7, medium 3, low 0)
- patch: 4: (high 1, medium 3, low 0)
- defer: 1: (high 0, medium 1, low 0)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - none
- blocking_questions:
  - Does "every provider call made on behalf of a generation" include the existing Voyage query-embedding and rerank calls, with `generationId` and `durationMs` attribution?
  - Must `learningDigestIds` become immutable at terminal status, or may generation-owned post-QA and late in-flight calls extend it afterward?
  - When `retryFailedCandidates` carries successful candidates into a new generation, which generation owns their prompt, digest, and usage provenance?

### 2026-09-02: Operator-directed final pass

- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 1, medium 1, low 1)
- defer: 6: (high 5, medium 1, low 0)
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[high]` `[patch]` Missing generations now fail the required digest handoff instead of silently allowing the provider call.
  - `[medium]` `[patch]` Auxiliary-only OpenRouter usage is rejected instead of producing a synthetic zero-token row.
  - `[low]` `[patch]` New tracked generations reject malformed prompt-version hashes before leaving reserved status.

### 2026-09-02 — Review pass (follow-up on done spec)

- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 3, low 4)
- defer: 1: (high 0, medium 0, low 1)
- reject: 23: (high 0, medium 0, low 23)
- addressed_findings:
  - `[medium]` `[patch]` `buildQaSystemPrompt` had gained two leading spaces before the Structure Compliance block during constant extraction, silently changing provider-visible QA prompt bytes; indentation restored to the baseline text.
  - `[medium]` `[patch]` `anthropicUsage` accepted a cache-counter-only usage object and wrote a 0/0 token row while `openRouterUsage` rejects the equivalent shape; both primary counters absent or malformed now yields no row, with a cache-only case added to the no-synthetic-usage table.
  - `[medium]` `[patch]` The iterative style-digest freeze/restore hop had no test; added convex-test coverage that `saveIterativeArtifacts` plus `getIterativeSectionInput` round-trips `draftStyleDigestId`, and that legacy, blank, and malformed artifacts restore none. The `generateSection` handoff hop stays under ledger DW-9.
  - `[low]` `[patch]` `currentPromptVersion` memoized a rejected promise for the life of the isolate; the memo now clears on rejection.
  - `[low]` `[patch]` `generateReport` and `startIterativeGeneration` awaited the hash and `beginGeneration` outside their try block, so a throw left the row `reserved`; both now fail the generation on that path.
  - `[low]` `[patch]` `unionLearningDigestIds` silently dropped ids for a new-format row whose `promptVersion` was not yet stamped; it now logs a warning before the no-op.
  - `[low]` `[patch]` The "runtime content is excluded" test asserted only that invented strings were absent and carried a dead variable; it now verifies every declared runtime slot is a `{{runtime.*}}` sentinel and no unevaluated template remains in the manifest.

### 2026-09-02 — Review pass (second follow-up on done spec)

- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 19: (high 0, medium 0, low 19)
- addressed_findings:
  - `[medium]` `[patch]` The only production entries into `runPipelineForModel` and the iterative section drafter were untested end to end, so swapped or dropped digest ids at `generateCandidate` or `generateSection` would pass every suite; convex-test cases now drive both real actions through the stubbed OpenRouter transport and assert the stored union, which request bodies carried each digest, and the `aiUsage` rows read back through `by_generationId` with `candidateRunId` only on the candidate path.
  - `[medium]` `[patch]` The fragment-table refactor of prompt scaffolds had no exact-output test (one byte drift was already caught by reading); `convex/ai/promptScaffolds.test.ts` pins `lengthBudgetBlock`, every `buildStyleGuidance` branch, `priorSectionsBlock`, `numberParagraphs`, and `buildContextBlock` to the pre-split literals. The three private builders are now exported for that purpose.
  - `[low]` `[patch]` Both entry actions reported any `beginGeneration` failure as "Prompt program version unavailable" from a duplicated block; `beginTrackedGeneration` in `convex/ai/pipeline.ts` now names the failing phase, and `convex/generationEntryFailure.test.ts` proves both actions fail the row and release the project for a rejected hash and a rejected begin.
  - `[low]` `[patch]` `unionLearningDigestIds` silently dropped ids for a row with `promptVersion` but no union array; it now warns for that inconsistent state too.
  - `[low]` `[patch]` `parseOpenRouterResearchResponse` lost a provider-reported cost when the token counters were absent; the cost is kept with zero local counters, with a test.
  - `[low]` `[patch]` Test quality: the vacuous `blankFetchedId` assertion was replaced by a comment naming where that guarantee lives, the brittle `not.toContain("undefined")` manifest check became a `canonicalSerialize` no-throw assertion, and the stamping test now asserts the science-code failure it relies on.

## Design Notes

`promptVersion` is a program-definition hash, not an execution-instance fingerprint. Runtime selectors choose branches already represented in the program and do not enter the hash. This makes generations on the same deployed prompt program comparable while still changing the version whenever a supported prompt branch or routing definition changes.

The exact canonical hash input is a JSON-compatible value rooted at contract id `banhall.generation-prompt-program/v1` and containing:

1. Static topology for single, compare, and iterative flows, including retrieval fallback and rerank, candidate analyzer, parallel sections, compression squeezes `[1, 0.85]`, QA, chronology, iterative review and redraft, ghost, post-QA, and the two-attempt structured-output branch.
2. For retrieval brief, analyzer, sections 242/244/246, compression, QA, chronology, and structured repair: exact system text; fixed user-message scaffolds with named runtime sentinels; role order; tool name, description, schema, and choice; model-selector rule; token cap; and thinking setting.
3. The template and scaffold constants each builder composes from: system text, user scaffolds with named sentinels, instruction blocks, the three section and three length-target budget blocks, digest and writer-instruction slot wrappers, compression instructions, and the structured repair instruction. Builders must read these from exported constants that the manifest also reads; the manifest hashes the constants, not the builders' combinatorial outputs. Runtime selectors (style masks, first-person flag, prior-section state, calibration presence, transcript presence) choose among hashed constants and do not enter the hash.
4. Request-affecting configuration: `MODEL`; each `CANDIDATE_MODELS` entry projected to id, gateway, reasoning, and maximum completion tokens; default and unknown-model routing; mode resolution; registered-model section budgets and reasoning headroom outputs; retrieval-brief, embedding, and rerank models; Brain query limits, thresholds, chunk context, top-N cap, and relevance floors; `CHARS_PER_LINE`, `LINE_LIMITS`, `WORD_CAPS`, and `LENGTH_TARGETS`; plus OpenRouter system-role and tool conversion rules.

Canonicalization recursively sorts object keys lexicographically, removes no meaningful values, rejects `undefined`, preserves semantic array order, explicitly sorts set-like collections by their stable key, and preserves exact prompt bytes, line endings, and Unicode without trimming or normalization. Serialize the canonical value with JSON, then SHA-256 hash the UTF-8 bytes of `banhall.generation-prompt-program/v1\n` followed by that JSON. Store `sha256:` followed by all 64 lowercase hexadecimal characters. Never use `Function.toString()`, source files, build paths, timestamps, or a truncated digest.

Digest recording uses a mutation that reads and patches the generation in one transaction. Concurrent candidates are safe because Convex retries write conflicts. The provider wrapper awaits that mutation with the exact nonblank digest ids for its one payload. A transport failure after the union retains the id because the learned content was handed off even when no usage returned.

The present `learningDigestIds: []` marker lets `beginGeneration` distinguish reservations created by this story from an older reserved row. Each entry action computes the current hash first; `beginGeneration` stamps only the new-format row while changing it to `running`. Later handoffs do not re-verify the hash: a deployment that changes the prompt program while a generation is in flight is a recorded limitation (record under deferred, low). A legacy row without `promptVersion` remains a compatibility no-op and gains no provenance fields.

Post-QA after `completed` keeps its current live-calibration lookup for every row; the id of the calibration actually sent is unioned before the handoff, so `learningDigestIds` can grow after terminal status only through generation-owned post-QA. This is the approved reading of the story's "final at terminal status" (see Spec Change Log).

G-7 is verified: `aiUsage.costUsd` stores US dollars. Provider-native OpenRouter cost is already treated as dollars; otherwise pricing uses dollars per million tokens and divides by `1_000_000`. Story 11 must describe the sum as recorded attributable cost. Its D-4 single-query premise cannot rely on the initial pipeline count because iterative redrafts at `generations.ts:1988-2032` and completed QA reruns at `:1562-1595` have no attempt cap. Scheduled usage writes are also asynchronous, so terminal cost can lag briefly. Story 10 records all required rows and the index but does not choose Story 11's read-bounding policy.

## Verification

**Commands:**
- `npx vitest run --project convex tests/aiUsage.test.ts convex/generationAttribution.test.ts convex/ai/instrument.test.ts convex/ai/openrouterCore.test.ts convex/ai/openrouterRetryLoop.test.ts`: expected: prompt, provenance, persistence, provider, retry, and no-synthetic-usage cases pass under the CI runner.
- `npm test`: expected: the integrated Vitest suite is green and the specifically included root usage file is discovered.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: expected: zero TypeScript or Svelte errors and legacy callers compile with optional fields.
- `npx tsc --noEmit -p convex`: expected: backend types pass without casts or generated-file edits.
- `git diff --check`: expected: no whitespace errors.
- `git diff --exit-code -- convex/_generated`: expected: no generated files changed.

## Auto Run Result

Status: done

Summary: Second follow-up review pass over the committed Story 10 change (baseline `3198cc726d3c7d2c1eaf14326e26f1d0c5182c09`). Four review layers ran; six findings were patched, none deferred, and nineteen rejected as intent-excluded, already tracked in ledger entries DW-3 through DW-10, consistent with existing patterns, or noise. The prompt-program hash, digest provenance, and usage attribution behavior is unchanged; this pass hardened the entry guard and closed the verification gaps at the real action boundaries.

Files changed in this pass:

- `convex/ai/pipeline.ts`: new `beginTrackedGeneration` entry guard naming the failing phase; `generateReport` uses it.
- `convex/ai/iterative.ts`: `startIterativeGeneration` uses the shared guard; `priorSectionsBlock` exported.
- `convex/ai/qaAgent.ts` and `convex/ai/analyzerAgent.ts`: `numberParagraphs` and `buildContextBlock` exported for exact-output tests.
- `convex/generations.ts`: `unionLearningDigestIds` warns on a prompt version without a union array.
- `convex/ai/research/core.ts` and `convex/ai/research/core.test.ts`: provider cost preserved when token counters are absent.
- `convex/generationAttribution.test.ts`: real `generateCandidate` and `generateSection` handoff coverage with usage rows via `by_generationId`; three assertion fixes.
- `convex/generationEntryFailure.test.ts` (new): hash-unavailable and begin-rejected paths for both entry actions.
- `convex/ai/promptScaffolds.test.ts` (new): scaffold bytes pinned to the pre-refactor literals.
- `tests/aiUsage.test.ts`: manifest undefined check via `canonicalSerialize`.

Review findings: 6 patches applied (high 0, medium 2, low 4), 0 deferred, 19 rejected. Rejections include the Voyage usage premise and attribution (intent Never clause; DW-4), partially malformed usage coercion (the matrix defines the no-row condition as wholly malformed, and dropping the row would discard a real OpenRouter cost), manifest descriptive-field and coverage gaps (DW-7, approved simplification in the Spec Change Log), the retrieval section key being hashed (a routing definition, not a call-site label), single-literal manifest comparisons (a changed literal is a TypeScript no-overlap compile error, not a silent runtime change), `failGeneration` rejecting inside the entry catch (matches every existing failure path), a misread blank tool-description guard, seed data inserting legacy-shaped generations (no consequence), the positional-argument refactor (the new integration test covers the hazard), module-load prompt rendering cost, the `"use node"` directive (required by the agent-module imports), documentation updates, OCC convergence and SDK-internal retry timing (Convex and SDK semantics), and items already listed under DW-9. Follow-up score: 2 × 3 medium + 4 low = 10, so `followup_review_recommended` is true.

Verification performed:

- Targeted suite (`tests/aiUsage.test.ts`, `convex/generationAttribution.test.ts`, `convex/generationEntryFailure.test.ts`, `convex/ai/promptScaffolds.test.ts`, `convex/ai/instrument.test.ts`, `convex/ai/openrouterCore.test.ts`, `convex/ai/openrouterRetryLoop.test.ts`, `convex/ai/research/core.test.ts`, `convex/ai/prompts.test.ts`): 9 files, 128 tests passed.
- `npm test`: 113 files, 1,084 tests passed.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: 0 errors, 0 warnings.
- `npx tsc --noEmit -p convex`: passed.
- `git diff --check`: passed for code; the only warning was the spec file's trailing blank line, resolved by this section.
- `git diff --exit-code -- convex/_generated`: no generated changes.

Residual risks: the integration tests partially cover ledger entry DW-9 (scheduled candidate arguments and provider-to-index persistence are now exercised through the real actions); the ledger entry itself was left for the orchestrator. The `promptVersion` value is unchanged by this pass: no hashed constant or manifest field was edited. Remaining limitations stay tracked in the frontmatter `deferred` list and ledger entries DW-3 through DW-10.
