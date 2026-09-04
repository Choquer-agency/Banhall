---
title: 'Trusted-context module for generation input'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: 'e42312b3364a6291a166853dddc1701aaf793d88'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Brain exemplars are appended to the analyzer user message after
      buildTrustedContext has finished, so they are neither delimited nor
      charged against the context budget.
    evidence: |-
      runAnalyzerAgent concatenates `brainExemplars` onto the prebuilt
      userMessage. The budget therefore bounds frozen source characters, not
      the bytes actually sent. Pre-existing (BNH-10 retrieval path), but it is
      the one remaining hole in "worst-case analyzer input is bounded".
    location: >-
      convex/ai/analyzerAgent.ts (runAnalyzerAgent)
    severity: medium
  - summary: >-
      Nothing surfaces context-budget truncation to a human: no query, no UI,
      and no field on the generations row exposes generationSources.contextBudget.
    evidence: |-
      A writer can receive a report generated from a halved transcript or with
      documents dropped and see only the progress-log document count. The data
      is persisted per source row but has no read side.
    location: >-
      convex/generations.ts (recordContextBudget) / no consumer
    severity: medium
  - summary: >-
      Chat and research still assemble their own context inline, so plan Phase 2's
      "one trusted-context module shared by chat, generation and research" is only
      half met after this story.
    evidence: |-
      convex/ai/chatAgentV2.ts still builds its own grounding block with a literal
      20k-char slice per document, different delimiters, no END marker and no
      guidance; convex/ai/research/* is untouched. Chat is CAP-4 (story 4);
      research has no story in this epic.
    location: >-
      convex/ai/chatAgentV2.ts, convex/ai/research/
    severity: medium
  - summary: >-
      CONTEXT_INPUTS_GUIDANCE still says "the materials below" and "each
      attached material is wrapped" when it is emitted with zero documents.
    evidence: |-
      The intent requires the guidance on every analyzer call, and it now is;
      the prose in convex/ai/prompts.ts was written for the documents-present
      case and was not adjusted (prompts.ts is untouched by this story on
      purpose — its test must pass unmodified). Harmless but slightly
      misleading on a transcript-only project.
    location: >-
      convex/ai/prompts.ts (CONTEXT_INPUTS_GUIDANCE)
    severity: low
---

<intent-contract>

## Intent

**Problem:** Analyzer input is assembled ad hoc in `buildContextBlock`: the transcript is undelimited, the data-not-instructions guidance is dropped whenever a project has zero documents, and nothing bounds the total — `getGenerationInput` can hand the analyzer ~10.5 MB of frozen text with no per-source or total budget and no record of what was cut.

**Approach:** Add `convex/ai/trustedContext.ts` (CAP-2), one non-node module that classifies every generation source, wraps the transcript and each document in BEGIN/END data markers, always emits the guidance, spends a configured token budget in trust order, and returns a truncation report. The analyzer builds its user message from it; `getGenerationInput` supplies the budget and per-source ids; a new internal mutation records the outcome on `generationSources`.

## Boundaries & Constraints

**Always:**
- `convex/ai/trustedContext.ts` has NO `"use node"` and no Node built-ins — it is imported from queries/mutations (`convex/generations.ts`) and from `"use node"` actions alike.
- The guidance (`CONTEXT_INPUTS_GUIDANCE`) is emitted on every analyzer call, including zero documents and no transcript.
- All source text reaches the model inside `--- BEGIN [...] ---` / `--- END [...] ---` markers, transcript included, reusing the existing delimiter constants so the guidance's marker promise stays literally true.
- Budget resolution order is fixed and deterministic: transcript parts in frozen order first, then documents in `ANALYZER_CATEGORY_ORDER` trust order then insertion order.
- Budget values come from `appSettings` with the module's constant fallbacks; an absent, unparseable or non-positive setting falls back silently (mirror `defaultModelId`'s "stale setting must not break generations" rule).
- Schema changes are additive and optional only; existing `generationSources` rows without the new field stay valid.
- `input.transcript` (the joined, unbudgeted text) keeps its current callers — quote validation in `claimDrafts` and the ETA word count. Only the analyzer call consumes the budgeted text.
- Follow `convex/_generated/ai/guidelines.md`: validators on every registered function, `Id<"...">` not `string`, no `undefined` in stored values.

**Block If:**
- Bounding the analyzer would require changing what `mapClaimToPart`/provenance sees (it must not).

**Never:**
- Do not touch `convex/ai/chatAgentV2.ts` or `convex/chatV2.ts` — chat evidence is CAP-4 / story 4.
- Do not derive trust from the uploader's role or add `uploaderRole` anywhere — that is CAP-3 / story 3. This story keeps category-derived trust, but exposes the `TrustLevel` seam story 3 will re-derive.
- Do not add relevance-based document selection (plan Phase 2 item 5) — bounded count + trust order only.
- Do not backfill `generationSources`, and do not rewrite a row's `content`, `contentHash`, `truncated` or `originalLength` (capture-time facts).
- Do not add `cache_control` or analyzer-once behaviour (CAP-10 / story 10).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Zero documents | one transcript, no `project_document` sources | user message = transcript prefix + marker-wrapped transcript + guidance; no `# ATTACHED CONTEXTUAL MATERIALS` heading | No error expected |
| No transcript | zero transcript parts, ≥1 document | `withoutTranscript` scaffold + guidance + materials heading + doc blocks; no transcript markers | No error expected |
| Trust order | docs `other` then `writer_notes` | `writer_notes` block precedes `other` block | No error expected |
| Per-document cap | one doc larger than `perDocumentTokens` | content cut to the cap, truncation notice inside the doc's markers, report entry `truncated: true` with `includedLength` < original | No error expected |
| Total budget exhausted | docs whose cumulative size exceeds `totalTokens` | earlier (higher-trust) docs kept, later docs omitted from the prompt with report entries `included: false, includedLength: 0` | No error expected |
| Document count cap | 15 eligible docs, `maxDocuments` 12 | first 12 in trust order rendered; docs 13-15 reported `included: false` | No error expected |
| Transcript over budget | transcript parts exceeding `transcriptTokens` | parts budgeted in order, tail cut with a notice inside the transcript markers, later parts dropped and reported | No error expected |
| Setting absent/bad | no `appSettings` row, or value `"abc"` / `"0"` / `"-5"` | module constant defaults used (150000 / 100000 / 10000 / 12) | Silent fallback, no throw |
| Budget recording | pipeline finishes building context | `recordContextBudget` patches each named `generationSources` row's `contextBudget`; rows not in the report keep it absent | Unknown/foreign-generation source id is skipped, not thrown |
| Legacy row | `generationSources` row written before this story | reads fine, `contextBudget` undefined | No error expected |

</intent-contract>

## Code Map

- `convex/ai/analyzerAgent.ts` -- `"use node"`. Owns `ContextDoc` (`:9-18`), `ANALYZER_CATEGORY_LABELS` (`:20-26`), `ANALYZER_CATEGORY_ORDER` (`:29-35`), `buildContextBlock` (`:37-55`), `ANALYZER_REQUEST` incl. `userScaffolds.documentDelimiters` / `contextHeading` / `documentSeparator` / `withTranscriptPrefix` / `withoutTranscript` (`:129-157`), and `runAnalyzerAgent` (`:159-185`, user message assembled at `:168-174`). The four context-assembly exports move to `trustedContext.ts`; this file re-exports them so existing importers keep compiling.
- `convex/ai/prompts.ts` -- NOT `"use node"`. `CONTEXT_INPUTS_GUIDANCE` at `:834-847`; its `:845` sentence already promises `--- BEGIN ... ---` markers on "document or transcript content", which today is a lie for the transcript. Safe to import from a non-node module.
- `convex/ai/promptProgram.ts:288-299` -- `"use node"`. `calls.analyzer` embeds `contextGuidance`, `contextCategoryLabels`, `contextCategoryOrder`, `request: ANALYZER_REQUEST`. New scaffolds/budget constants surfacing here move `promptVersion` — intended, and `generationAttribution.test.ts` computes the hash at runtime (`:15`) so it does not pin a literal.
- `convex/ai/pipeline.ts` -- `toContextDocs` (`:176-194`, unknown category → `"other"`); `generateReport` reads input at `:414-433`; `input.transcript` captured at `:488` and used for the ETA word count (`:505-513`) and, via `runPipelineForModel(:257,:276)`, for `claimDrafts`' quote validation (`:206-211`) and `mapClaimToPart(input.transcriptParts, …)` (`:681`) — all must keep the unbudgeted text. `runAnalyzerAgent` also called at `:667-668`.
- `convex/ai/iterative.ts:85,150,207` -- second `runAnalyzerAgent` caller; same `toContextDocs` + `input.transcript` shape.
- `convex/generations.ts` -- `reserveGeneration` (`:361-512`) writes the transcript sources (`:470-482`) and document sources (`:483-503`, `.take(50)`, label encoded `category:fileName`, 200k-char slice). `getGenerationInput` (`:798-876`): `toPart` already returns `sourceId` (`:815-820`); `contextDocs` (`:863-874`) splits the label but drops `_id`. Add `sourceId` there plus the resolved budget; add the new internal mutation nearby.
- `convex/schema.ts:1370-1392` -- `generationSources`: `truncated`/`originalLength` are capture-time, required, already written by all three insert sites (`generations.ts` ×2, `transcriptDigests.ts:173-186`). Add one optional `contextBudget` object. `appSettings` at `:1904-1914` stores string values only — numeric settings must be parsed.
- `convex/appSettings.ts:48-61` -- `defaultModelId(ctx: QueryCtx | MutationCtx)` is the read-helper pattern to copy: `by_key` unique lookup, validity check, constant fallback. Keys are module-private consts (`:14-17`).
- `convex/lib/transcripts.ts` -- non-node home for size constants (see its `:26-31` comment: constants live here, not in the `"use node"` prompt program). Exports `buildTranscriptPromptText(parts)` (`:135-144`, `=== Transcript N: label ===`) — reuse it on the budgeted parts. `FROZEN_TRANSCRIPT_CHARS` 500k, `TRANSCRIPT_BUDGET_CHARS` 200k.
- `convex/ai/promptScaffolds.test.ts:81-98` -- pins `buildContextBlock([]) === ""` and the exact composed bytes with `CONTEXT_INPUTS_GUIDANCE` interpolated. This case must be rewritten for the new builder (reason recorded below); the rest of the file is unrelated.
- `convex/ai/prompts.test.ts` -- does NOT touch `CONTEXT_INPUTS_GUIDANCE` or the analyzer block; it must pass untouched. There are no vitest snapshots anywhere in the repo; the SPEC's "snapshot" constraint lands on `promptScaffolds.test.ts`.
- `convex/generationInput.test.ts` -- existing convex-test fixture for `getGenerationInput`; extend it rather than building a new harness.
- Read-only: `convex/reports.ts:89-90`, `convex/debugTools.ts:257`, `convex/transcriptDigests.ts` — other `generationSources` readers/writers; none may change.

## Tasks & Acceptance

**Execution:**
- `convex/ai/trustedContext.ts` -- new, no `"use node"`. Export `ContextDocCategory`/`ContextDoc`, `TrustLevel` (`"internal" | "client"`), `ANALYZER_CATEGORY_LABELS`, `ANALYZER_CATEGORY_ORDER`, `CONTEXT_SCAFFOLDS` (the `userScaffolds` literals moved here, plus new `transcriptLabel`/marker pieces), `CHARS_PER_TOKEN` + `estimateTokens`, `DEFAULT_CONTEXT_BUDGET` (`{ totalTokens: 150_000, transcriptTokens: 100_000, perDocumentTokens: 10_000, maxDocuments: 12 }`), `type ContextBudget`, `type TrustedContextSource`/`TrustedContextReport`, and `buildTrustedContext(input): { userMessage: string; report: TrustedContextReport }`. Classification is `documentTrust(category)` (`writer_notes` → `internal`, everything else → `client`) so story 3 re-derives one function, not the shape. -- one module owns classification, delimiting, budgeting and the truncation report.
- `convex/ai/analyzerAgent.ts` -- delete `buildContextBlock`, `ContextDoc`, the category tables and `userScaffolds`' context literals; import them from `trustedContext.ts` and re-export `ContextDoc`, `ANALYZER_CATEGORY_LABELS`, `ANALYZER_CATEGORY_ORDER` so `promptProgram.ts`/`pipeline.ts`/`iterative.ts` imports are unchanged; set `ANALYZER_REQUEST.userScaffolds = CONTEXT_SCAFFOLDS`. Change `runAnalyzerAgent`'s 2nd/3rd params to a single prebuilt `userMessage: string` (brain exemplars still appended here). -- the agent stops assembling context; it only sends it.
- `convex/ai/promptProgram.ts` -- add the budget defaults to `calls.analyzer` (or `configuration`) alongside `contextGuidance`, mirroring how `configuration.transcripts` publishes the transcript sizes. -- the budget is part of the disclosed prompt contract, so it moves `promptVersion`.
- `convex/schema.ts` -- add to `generationSources`: `contextBudget: v.optional(v.object({ budgetTokens: v.number(), included: v.boolean(), includedLength: v.number(), truncated: v.boolean() }))`, with a comment that it is budget-application (not capture) metadata and absent on legacy rows. -- per-source truncation and the total budget applied become queryable without mutating frozen text.
- `convex/appSettings.ts` -- add module-private keys `ai.analyzerContextBudgetTokens`, `ai.analyzerTranscriptBudgetTokens`, `ai.analyzerDocumentBudgetTokens`, `ai.analyzerMaxContextDocuments` and one exported `analyzerContextBudget(ctx: QueryCtx | MutationCtx): Promise<ContextBudget>` that reads all four in the `defaultModelId` style, parsing each as a positive integer and falling back per-field to `DEFAULT_CONTEXT_BUDGET`. -- admin-tunable with fallbacks, no new admin UI.
- `convex/generations.ts` -- `getGenerationInput`: add `sourceId: source._id` to each `contextDocs` entry and return `contextBudget: await analyzerContextBudget(ctx)`. Add `export const recordContextBudget = internalMutation({ args: { generationId, budgetTokens, applied: v.array(v.object({ sourceId, included, includedLength, truncated })) } })` that patches `contextBudget` onto each row, skipping any row that is missing or whose `generationId` does not match. -- the action gets ids and a budget; the outcome lands back on the frozen rows.
- `convex/ai/pipeline.ts` -- `toContextDocs` carries `sourceId` through; in `generateReport`, build the analyzer context once from `input.transcriptParts`, the context docs and `input.contextBudget`, call `internal.generations.recordContextBudget` once before candidate fan-out, and pass the resulting `userMessage` to both `runAnalyzerAgent` call sites (`:276` via `runPipelineForModel`, `:667`). `input.transcript` stays as-is for the ETA and quote validation. -- one build, one recording, unchanged provenance.
- `convex/ai/iterative.ts` -- same: build once, record once, pass the `userMessage` to `runAnalyzerAgent` at `:207`. -- both analyzer paths go through the module.
- `convex/ai/trustedContext.test.ts` -- new pure unit suite covering every I/O matrix row (guidance with zero docs and with no transcript, transcript markers, trust order, per-document cap + notice, total-budget exhaustion, document-count cap, transcript part budgeting, and that the report's included-token total never exceeds `totalTokens`). Include one fixture whose document body contains an instruction override, asserting it lands strictly between its BEGIN/END markers. -- the module's contract is deterministic and testable without Convex.
- `convex/generationInput.test.ts` -- extend: `getGenerationInput` returns a `sourceId` per context doc and a budget; the settings rows override the defaults while a garbage value falls back; `recordContextBudget` patches the named rows and leaves `content`/`contentHash`/`truncated`/`originalLength` untouched and unrelated rows without `contextBudget`. -- pins the recording path end to end.
- `convex/appSettings.test.ts` -- add cases for `analyzerContextBudget` parsing and per-field fallback. -- the silent-fallback rule is fenced.
- `convex/ai/promptScaffolds.test.ts` -- replace the `buildContextBlock` case (`:81-98`) with the equivalent `buildTrustedContext` case pinning the new composed bytes (guidance always present, transcript markers, trust order). -- the byte-pinning fence survives the refactor.

**Acceptance Criteria:**
- Given a generation with a transcript and zero documents, when the analyzer user message is built, then it contains `CONTEXT_INPUTS_GUIDANCE` verbatim and the transcript sits between BEGIN/END markers.
- Given `grep -rn '"use node"' convex/ai/trustedContext.ts`, when run, then it returns no matches, and `convex/generations.ts` imports the module without a runtime error in `npm test`.
- Given any source set, when `buildTrustedContext` returns, then `report.includedTokens <= budget.totalTokens` and every input source appears exactly once in `report.sources`.
- Given a generation whose context was built, when its `generationSources` rows are read, then every row named in the report carries `contextBudget` with the applied `budgetTokens`, and no row's `content` or `contentHash` changed.
- Given `npx vitest run convex/ai/prompts.test.ts`, when run, then it passes with the file unmodified.
- Given a full `npm test` and `PUBLIC_CONVEX_URL=placeholder npm run check`, when both complete, then both are green with no new type errors.

## Spec Change Log

- 2026-09-04 (review pass 1): the Tasks sketch said to "pass the resulting `userMessage` to both `runAnalyzerAgent` call sites". The shipped code instead has `generateReport` build the context once to record the outcome before fan-out, while each `generateCandidate` (a separate action that re-reads the frozen input) rebuilds identical bytes from `buildAnalyzerContext`. The deviation is deliberate: threading a multi-hundred-KB string through the scheduler payload was the alternative. Constraint: `buildAnalyzerContext` must stay deterministic in the frozen rows plus the resolved budget, and the pipeline-level fence added in `generationAttribution.test.ts` (analyzer request body contains the guidance and both BEGIN/END pairs) must survive re-derivation - without it the whole delimiting guarantee can be disconnected with a green suite.
- 2026-09-04 (review pass 1): marker neutralization was not in the original Tasks. `neutralizeMarkers`/`sanitizeFileName` must survive: without them a client document whose body contains a `--- END [...] ---` line closes its own wrapper, which defeats exactly the containment `CONTEXT_INPUTS_GUIDANCE` promises and that CAP-5 will test against.

## Review Triage Log

### 2026-09-04 - Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 2, medium 2, low 6)
- defer: 3
- reject: 12
- addressed_findings:
  - `[high]` `[patch]` Source text or a file name containing a `--- BEGIN [` / `--- END [` line could close its own wrapper, so client data escaped the delimiters the guidance promises are inescapable - added `neutralizeMarkers` (line-anchored rewrite) and `sanitizeFileName`, applied to transcript bodies, transcript part labels and document bodies/names; four fixtures in `convex/ai/trustedContext.test.ts`.
  - `[high]` `[patch]` No test proved the pipeline actually sends the trusted-context message: swapping `buildAnalyzerContext(input).userMessage` for `input.transcript` left every suite green, i.e. the whole delimiting/guidance guarantee could ship disconnected - extended the `generateCandidate` fetch-observing test with a document source and assertions on guidance plus both BEGIN/END pairs in the real analyzer request body.
  - `[medium]` `[patch]` No test proved `recordContextBudget` runs on a real generation (deleting both call sites broke nothing) - added a parameterized entry-action test over `generateReport` and `startIterativeGeneration` asserting the frozen rows carry `contextBudget`.
  - `[medium]` `[patch]` When the budget kept no transcript part, the message fell back to "There is NO interview transcript for this project" - a false statement about the input; now the transcript prefix and block survive with a whole-transcript truncation notice.
  - `[low]` `[patch]` The `getGenerationInput` comment claimed the budget is resolved once per generation, but `generateCandidate` re-runs that query per candidate - comment corrected to state the real behaviour.
  - `[low]` `[patch]` The two `runPipelineForModel` fixtures pinned a hand-written analyzer message the production path can no longer produce - they now build it through `buildTrustedContext`.
  - `[low]` `[patch]` `estimateTokens` was exported and tested but unused, with the same arithmetic re-implemented inline - both now route through `tokensForChars`.
  - `[low]` `[patch]` `readPositiveInt` accepted `1e9` and `0x2710`, so a setting could silently mean a different number than the admin typed - now requires plain decimal digits and a safe integer.
  - `[low]` `[patch]` Character slicing could split a UTF-16 surrogate pair and leave a lone surrogate in the request body - `cutToBudget` backs the cut off one code unit.
  - `[low]` `[patch]` The "Using N frozen contextual document(s)" progress line counted pre-budget documents - it now reports the post-budget included count.

Rejected (12): freezing the budget onto the `generations` row (a design change beyond the intent; the corrected comment records the real semantics); disclosing the effective rather than default budget in `promptProgram` (the program discloses deployment constants throughout, e.g. `configuration.models.defaultModelId` and `configuration.transcripts`); an admin write mutation / UI for the four keys (the intent says "read from appSettings with fallbacks"); an `appSettings` duplicate-key guard (same `.unique()` shape as the existing `defaultModelId`); upper clamps on the budget settings (admin authority); rendering an explicit trust marker per block or deleting `TrustLevel` (the seam story 3 re-derives); a branded type for the analyzer message parameter (the missing pipeline fence was the real risk and is now closed); persisting `report.includedTokens` and per-source drop reasons; batching `recordContextBudget` (at most 70 patches, far under the mutation limits); `buildTranscriptPromptText` renumbering when parts are dropped (cosmetic, and provenance maps against the full frozen part list, not the budgeted text); a minimum-useful-allowance floor before rendering a nearly empty document block; docs/changelog entries (not asked for by the intent, and no sibling story in this epic added one).

### 2026-09-04 — Review pass (follow-up)
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 0, medium 6, low 5)
- defer: 1
- reject: 19
- addressed_findings:
  - `[medium]` `[patch]` `neutralizeMarkers` was line-anchored and matched exactly three dashes, so `---- END [INTERVIEW TRANSCRIPT] ---` or a mid-line `--- END [...] ---` kept the exact marker substring alive inside client text - the regex now matches any run of three or more dashes anywhere and separates every dash in the run; two new forgery fixtures.
  - `[medium]` `[patch]` A frozen transcript that was merely blank (whitespace only, nothing cut) rendered a false `[TRUNCATED: 3 of 3 characters omitted]` notice instead of the docs-only scaffold the old `transcript.trim()` branch produced - the notice now fires only when characters were actually omitted, restoring the "no transcript" framing for blank input.
  - `[medium]` `[patch]` Nothing told the writer when the budget shortened or dropped a source; a gap caused by the budget would read as a gap in the interview - `describeContextCuts` produces one progress line naming shortened and left-out sources, logged by both entry flows.
  - `[medium]` `[patch]` Each `generateCandidate` re-resolved the budget from `appSettings`, so an admin retune mid-generation made a candidate send bytes the recorded `contextBudget` rows did not describe - `generateReport` now passes the budget it recorded under through the scheduled payload (`contextBudget` arg) and the candidate prefers it; a test proves the payload wins over the settings.
  - `[medium]` `[patch]` No test carried an `ai.analyzer*` override through an entry action, so making the budget inert (`budget: DEFAULT_CONTEXT_BUDGET`) left every suite green - parameterized entry-action test with a 100-token total and a 1-token document cap asserting the recorded rows, the truncated document in the iterative analyzer body, and both progress lines.
  - `[medium]` `[patch]` The iterative flow's analyzer request body was never inspected, so passing the raw `input.transcript` there would have gone unnoticed - the recording test now captures requests and asserts guidance plus transcript and document markers on the iterative path.
  - `[low]` `[patch]` `sanitizeFileName` only folded CR/LF, leaving U+2028/U+2029/VT/FF able to split a marker line - all line terminators are folded; fixture added.
  - `[low]` `[patch]` A one-code-unit allowance in front of a surrogate pair kept nothing yet reported the source `included: true` with an empty block - zero-length keeps are now reported as omitted and render no block.
  - `[low]` `[patch]` `toLocaleString("en-US")` in the truncation notice depended on the runtime's ICU data, so candidate bytes could differ from the recorded build - replaced with a plain regex thousands formatter; fixture pins `8,345 of 12,345`.
  - `[low]` `[patch]` Deleting `contextBudget` from the disclosed prompt program broke no test, so a default retune could silently stop moving `promptVersion` - `promptScaffolds.test.ts` pins `calls.analyzer.contextBudget` to `DEFAULT_CONTEXT_BUDGET`.
  - `[low]` `[patch]` The schema comment listed two reasons `contextBudget` can be absent but not the third: full-text transcript rows superseded by digest rows in digest mode - comment now names it.

Rejected (19): rejecting `[`/`]`/`BEGIN`/`END` inside file names (dash collapsing already breaks the marker grammar and the marker line itself is scaffolding-owned); disclosing the effective rather than default budget in `promptProgram`, an admin setter/UI for the four keys, a minimum floor on the total, and a branded analyzer-message type (all rejected in pass 1 for the same reasons); reconciling the context budget with the condense-window budget (a design question outside the intent); charging scaffolding overhead against the budget (fixed, small, and the ledger already records the exemplar hole); `Promise.all` over the four setting reads and a `charsForTokens` helper (cosmetic); the duplicate `toContextDocs` for the ETA word count (the ETA deliberately counts frozen, unbudgeted words); docs/changelog updates and the `loop-verify.sh` commit (unchanged from pass 1); a file-name length cap (labels come from `reserveGeneration`, already bounded); NaN budget fields (only the validated `appSettings` path and typed callers supply budgets); unknown categories in the sort (`toContextDocs` maps them to `other` and the type forbids others); `try/catch` around `recordContextBudget` in both flows (a failing mutation means the deployment is broken, and hiding it would hide the cause); `includedLength` range validation in the internal mutation (trusted caller); a trust-label rewording (story 3); the assorted missing-fixture list (boundary-exact document, single-category count cap) as not changing any decision.

### 2026-09-04 — Review pass (follow-up 2)
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 2, low 8)
- defer: 0
- reject: 24
- addressed_findings:
  - `[medium]` `[patch]` Source text was charged against the budget before `neutralizeMarkers` ran, and every neutralized dash run grows (`---` → `- - -`), so a hostile document of repeated forgeries could send close to twice its allowance while the report claimed the budget held - bodies are now neutralized first and the neutralized bytes are what is cut and charged; fixture pins sent length ≤ allowance for a 100× `---BEGIN[` body.
  - `[medium]` `[patch]` No test ran a digest-mode generation through either entry action, so hoisting `buildAnalyzerContext` above the condense block (sending the over-budget full text and recording the outcome on the wrong rows, contrary to the schema comment) left every suite green - parameterized entry-action test with a stored digest asserting `contextBudget` lands on the `transcript_digest` row and not the superseded full-text row, and (iterative) that the analyzer body carries the digest inside the transcript markers and never the full text.
  - `[low]` `[patch]` `neutralizeMarkers` matched only upper-case `BEGIN`/`END` and hyphen-minus, so `--- end [INTERVIEW TRANSCRIPT] ---` or an em-dash run survived verbatim - the match is now case-insensitive over hyphen-minus, en/em/figure/horizontal-bar dashes and the minus sign; fixture added.
  - `[low]` `[patch]` When documents were frozen but the budget kept none (a transcript that spends the whole total), the guidance and the no-transcript scaffold pointed at "materials below" that were not there - the materials heading now carries an `[All N attached document(s) were omitted …]` notice in that case; fixture added.
  - `[low]` `[patch]` Two or more whitespace-only transcript parts produced a transcript block of bare `=== Transcript N ===` headers instead of the no-transcript scaffold, because blankness was judged on the joined text - it is now judged on the parts; fixture added.
  - `[low]` `[patch]` `describeContextCuts` interpolated raw client file names, so a name carrying a line break split the progress-log sentence - labels are line-folded (shared `foldLines` helper); fixture added.
  - `[low]` `[patch]` `sanitizeFileName` collapsed any `--`, renaming `report--final.txt` in the marker line although only a run of three or more dashes can start a marker - now `-{3,}` only; fixture added.
  - `[low]` `[patch]` A candidate scheduled without `contextBudget` falling back to the frozen input's admin-tuned budget was untested (`args.contextBudget ?? DEFAULT_CONTEXT_BUDGET` left every suite green) - test writes a 1-token document cap and calls `generateCandidate` without the arg, asserting the truncated block in the analyzer body.
  - `[low]` `[patch]` The `DEFAULT_CONTEXT_BUDGET` comment claimed the outcome is "reproducible from the frozen rows alone", which is false once an admin tunes a per-source cap - reworded to "plus the budget they were recorded under".
  - `[low]` `[patch]` `generationAttribution.test.ts` imported `./ai/trustedContext` on two separate lines - merged.

Rejected (24): forging `=== Transcript N: … ===` headers or the `[TRUNCATED: …]` notice inside a body (both sit inside the source's own BEGIN/END markers, which the guidance already declares to be data); persisting the full resolved budget per row or disclosing the effective budget in `promptProgram` (rejected in passes 1 and 2; the comment fix above records the real semantics); the ETA word count on unbudgeted documents (pass 2: the ETA deliberately counts frozen words); rendering `TrustLevel`, an admin setter/UI, docs/changelog, and the `loop-verify.sh` `npm ci` vs `bun.lock` question (all rejected in earlier passes for the same reasons); brain exemplars uncharged, no read side for `contextBudget`, and the guidance prose presupposing materials (all already in the deferred-work ledger; not re-deferred); backing a cut off to a word boundary (changes pinned byte semantics for a cosmetic gain); `estimateTokens` unused in production (pass 1 routed the arithmetic through one helper; the export is the module's documented estimate); recording after the analyzer returns or stamping a run id (a retry reserves a new generation with its own rows); NaN/fractional/non-finite budget fields and very long file names (pass 2: only validated settings and typed callers supply budgets; labels are bounded at reservation); a whitespace-only part dropped at zero allowance producing a notice (requires earlier blank parts to have spent a sub-token budget); analyzer quotes of marker-shaped transcript lines failing exact-quote validation (a line that looks like our own delimiter is adversarial by construction, and weakening containment to preserve its citation is the wrong trade); `.unique()` on duplicate `appSettings` keys and `try/catch` around `recordContextBudget` / `analyzerContextBudget` (passes 1 and 2); the intent auditor's partial-fill-versus-omit reading of the total-budget row (both behaviours satisfy "earlier kept, later omitted"; accepted in passes 1 and 2), its note that `+5000` is rejected (pass 1 deliberately tightened parsing), and an explicit legacy-row read test (every pre-existing fixture already reads rows without the field through `getGenerationInput`); capping the number of names in the cut sentence (at most 62 sources).

## Design Notes

**Why the budget is applied in the action, not at reserve time.** Reserve time is tempting (it already reads `appSettings` and writes the rows), but digest mode replaces the transcript rows *after* reservation (`transcriptDigests.ts`), so a reserve-time budget would miss exactly the largest inputs. Building in the action and patching an additive `contextBudget` field keeps the frozen capture facts (`content`, `contentHash`, `truncated`, `originalLength`) immutable while still recording budget outcome on the row it describes.

**Token estimation.** No token counter exists in the repo. `estimateTokens(text) = ceil(text.length / 4)` is an approximation and a guardrail, not accounting — say so in the module comment. Truncation cuts at `tokens * CHARS_PER_TOKEN` characters.

**Budget derivation.** SPEC Assumptions pin only the total (150k) and the document count (12). The two per-source caps are derived to stay consistent with them: the transcript is the primary source so it gets the largest single share (100k), and a document cap of 10k × 12 docs sums past the remainder, so the total budget — not the per-document cap — is what actually binds a document-heavy project. Allocation is strictly sequential in trust order, so the outcome is reproducible from the frozen rows alone.

**Assembly shape** (guidance stays after the transcript, before the materials heading, so the guidance's "materials below" wording remains accurate):

```
Here is the interview transcript to analyze:

--- BEGIN [INTERVIEW TRANSCRIPT] ---
=== Transcript 1: kickoff ===
…
[TRUNCATED: 4,120 of 210,000 characters omitted to fit the context budget.]
--- END [INTERVIEW TRANSCRIPT] ---

<CONTEXT_INPUTS_GUIDANCE>

# ATTACHED CONTEXTUAL MATERIALS
--- BEGIN [WRITER'S NOTES (unreliable narrator)] notes.md ---
…
```

## Verification

**Commands:**
- `npx vitest run convex/ai/trustedContext.test.ts convex/ai/promptScaffolds.test.ts convex/ai/prompts.test.ts convex/generationInput.test.ts convex/appSettings.test.ts convex/generationAttribution.test.ts` -- expected: all pass, `convex/ai/prompts.test.ts` unmodified
- `grep -n 'use node' convex/ai/trustedContext.ts` -- expected: no output
- `grep -rn 'buildContextBlock' convex/ src/ shared/` -- expected: no output
- `npm test` -- expected: green
- `PUBLIC_CONVEX_URL=placeholder npm run check` -- expected: no new errors versus the pre-change baseline
- `git diff --stat convex/chatV2.ts convex/ai/chatAgentV2.ts` -- expected: no output (chat is story 4)

## Auto Run Result

Status: done
Blocking condition: none

**Implemented change.** Second follow-up review pass over CAP-2's trusted-context boundary (the story was `done` with `followup_review_recommended: true`). Four review layers ran against the full diff since the baseline; ten findings were patched, none deferred, twenty-four rejected, no intent gaps and no spec loopbacks. The budget now bounds the bytes actually sent (neutralization happens before the cut and the charge), marker forgery is caught regardless of case or dash codepoint, the model is told when every frozen document was dropped, and the digest-mode path is fenced end to end through both entry actions.

**Files changed (this pass).**
- `convex/ai/trustedContext.ts` — neutralize-then-cut-then-charge for transcript parts and documents; case-insensitive, Unicode-dash marker regex; `foldLines` helper shared by `sanitizeFileName` (now collapsing only `-{3,}`) and `describeContextCuts`; `omittedMaterialsNotice` under the materials heading when documents were frozen but none included; blankness judged on parts not joined text; comment wording on reproducibility.
- `convex/ai/trustedContext.test.ts` — 6 new cases (lower-case/Unicode-dash forgery, growth-bounded hostile body, double-dash file name, several blank parts, all-documents-omitted notice, line-broken label in the cut sentence).
- `convex/generationAttribution.test.ts` — merged duplicate import; `reservedGenerationWithSources` takes an `inputMode` and seeds a reusable `transcriptDigests` row; parameterized digest-mode entry-action test; candidate-without-budget fallback test.

**Review findings.** 10 patches (high 0, medium 2, low 8), 0 deferred, 24 rejected, 0 intent gaps, 0 bad_spec.

**Follow-up review recommended: true.** Patched by severity: high 0, medium 2, low 8. Score = 3×2 + 1×8 = 14, above the threshold of 5. No high-severity patch this pass.

**Verification.**
- `npx vitest run convex/ai/trustedContext.test.ts convex/ai/promptScaffolds.test.ts convex/ai/prompts.test.ts convex/generationInput.test.ts convex/appSettings.test.ts convex/generationAttribution.test.ts` — 6 files, 117 tests, all pass; `convex/ai/prompts.test.ts` unmodified.
- `npm test` — 124 files, 1256 tests, all pass.
- `PUBLIC_CONVEX_URL=placeholder npm run check` — 5840 files, 0 errors, 0 warnings.
- `npx tsc -p convex/tsconfig.json --noEmit` — exit 0.
- Gates: `grep -n 'use node' convex/ai/trustedContext.ts` empty; `grep -rn 'buildContextBlock' convex/ src/ shared/` empty; `git diff --stat` against the baseline for `convex/chatV2.ts convex/ai/chatAgentV2.ts convex/ai/prompts.ts convex/ai/prompts.test.ts` empty.

**Residual risks.**
- `report.originalLength` and the truncation notice count neutralized characters for a body that contained forgeries, so for such a body the notice's "of M" can differ slightly from the frozen row's `originalLength`; benign bodies are unaffected.
- The budget bounds source characters plus the neutralization rewrite; scaffolding and brain exemplars remain uncharged (existing ledger entry).
- Truncation is persisted per source row and surfaced as one progress-log line, but there is still no query or UI read side for `contextBudget` (existing ledger entry).


