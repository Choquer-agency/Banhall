# Extract: current step-by-step ("iterative") PD generation code

Subagent extraction, 2026-09-16, against `main` at e5f2476. Read-only.

## 1. Generation modes

- `CandidateMode = "compare" | "single" | "iterative"` — `convex/ai/model.ts:18`; routing `CANDIDATE_MODE_ROUTING` `:20-37` (`iterative` resolves as `single`, one model). Model registry `shared/generationModels.ts:28` (`CANDIDATE_MODELS`), `MODEL = "claude-sonnet-5"`, gateway `gatewayForModel` `:130`.
- Schema enum `generations.candidateMode` — `convex/schema.ts:694-702`.
- Entry `requestGeneration` — `convex/generations.ts:571-611`; `reserveGeneration` `:390-569`, dispatch `:560-566` (`iterative` → `internal.ai.iterative.startIterativeGeneration`, else `internal.ai.pipeline.generateReport`).
- UI mode selectors, three drifted copies: `src/routes/project/new/+page.svelte:99, 987`; `src/lib/components/project/CurrentProjectPage.svelte:658, 1865`; `src/lib/components/project/PreviewProjectPage.svelte:814, 2221`. Label "Section by section".
- Separate ungated ordered mode for single/compare (AD-24): `productionOrder`, `stopRequestedAt`, `stoppedAfterSection` (`schema.ts:775-781`), `convex/ai/orderedGeneration.ts`.

## 2. Schema tables

| Table | Line | Key fields |
|---|---|---|
| `generations` | `schema.ts:658-801` | status(reserved\|running\|awaiting_selection\|awaiting_input\|completed\|failed\|superseded), candidateMode, promptVersion, learningDigestIds, agentOutputs, currentStep, progressLog[], briefId, briefOutcome, productionOrder, writerSettings, lastProgressAt |
| `generationSectionRuns` | `:1512-1549` | generationId, projectId, section(s242\|s244\|s246), status(pending\|queued\|running\|awaiting_review\|approved\|failed\|drafted), draftText, approvedText, qa, metrics, model, attempt, guidance, error, candidateRunId, orderIndex, selfCheck, slotCounts |
| `generationCandidateRuns` | `:1477-1506` | ghost: boolean, consistencyCheckedAt |
| `generationArtifacts` | `:1554-1558` | kind("analysis"\|"brain_blocks"), content (frozen) |
| `generationSources` | `:1561-1621` | frozen inputs incl. writer_storyline, uploaderRole, contextBudget |
| `generationBriefs` / `generationBriefEntries` | `:2231`, `:2278` | Generation Brief |
| `complianceNotes` | `:2356-2367` | section, paragraphIndex (0-based), source, instruction, outcome, tier, reason, repaired |
| `sectionEditEvents` | `:1970-1981` | draftText, approvedText, ghostText, editRatio, userId (learning input) |
| `chatProposals` / `chatProposalItems` | `:930-1030` | kind, state(pending\|applied\|rejected\|stale), items carry section + paragraphNumber (1-based) |
| `reportSnapshots`, `reportProvenance`, `reportEditDistance`, `qaFindings`, `pdReviews` | `:1365`, `:1623`, `:1418`, `:535`, `:1861` | post-assembly |

## 3. Convex functions

- Start: `internal.ai.iterative.startIterativeGeneration` `convex/ai/iterative.ts:69-320`: digest condense, `buildAnalyzerContext` + `recordContextBudget`, `retrieveBrainBlocks`, analyzer, `saveIterativeArtifacts`, Brief stage (`:263`), `createSectionRuns` (`:269`), ghost one-shot scheduled (`:277-302`), then `generateSection("s242")` (`:309`).
- Draft a step: `generateSection` `iterative.ts:337-452`: `claimSectionRun` → `getIterativeSectionInput` → section agent → scrub → `compressToFit` → metrics/findings → `completeSectionRun`.
- Fences (`convex/generations.ts`): `createSectionRuns:2210`, `claimSectionRun:2238`, `completeSectionRun:2267` (run→awaiting_review, generation→awaiting_input), `failSectionRun:2308`, `getIterativeSectionInput:2343` (analysis + brain block + frozen styleGuidance + approved prior sections).
- Read model: `getIterativeState` `:2732-2816` (sanitized via `userSafeStoredError`/`userSafeNarration`).
- Approve: `approveSectionDraft` `:2843-3087`. Guards: `requireIterativeGeneration:2819`, `requireReportEditAccess:2860`, generation awaiting_input, run awaiting_review, `attempt` fence `:2868`, earlier sections approved `:2874`, non-empty. Effects: run approved; `sectionEditEvents` insert `:2895-2918`; queue next `:2920-2946`; on final: `buildTiptapDocument` `:2958`, `agentOutputs` `:2966`, `createGeneratedReportArtifacts` `:2978`, ghost snapshot `:2990-3047`, project status review + clear activeGenerationId `:3057`, generation completed, schedule `postQa.runReportQa` `:3081`.
- Regenerate: `regenerateSectionDraft:3090-3135` (attempt+1, free-text guidance → styleGuidance suffix `iterative.ts:384-392`). Cancel: `cancelIterativeGeneration:3138`.
- Report writer: `convex/lib/tiptapReport.ts:79 buildTiptapDocument`, `sectionParagraphs:23`, `textToParagraphs:30`, `NOT_GENERATED_PLACEHOLDER:20`; `createGeneratedReportArtifacts` `generations.ts:1166`.
- Reaper `failStaleGenerations:3244`: `awaiting_input` never reaped (`schema.ts:673-675`).

## 4. AI layer

- Section agents `convex/ai/section242Agent.ts`/`244`/`246` (51 lines each): single `messages.create`, thinking disabled, `max_tokens = sectionAnswerTokenBudget(model)` (`shared/generationModels.ts:93,154`); user message = prefix + JSON(analysis) + brainExemplars + lengthBudget + styleGuidance + briefBlock.
- Prompts `convex/ai/prompts.ts`: `buildSection242SystemPrompt:274`, `244:383`, `246:484`; content roles not paragraph counts (`:296, :405, :511`).
- Scaffolds `convex/ai/promptDefinitions.ts`: `LENGTH_BUDGET_SCAFFOLD:7`, `COMPRESSION_REQUEST:22`, `STYLE_GUIDANCE_SCAFFOLDS:50`, `ITERATIVE_SECTION_TITLES:81`, `ITERATIVE_PROMPT_SCAFFOLDS:87`, `ORDERED_PROMPT_SCAFFOLDS:113`, `SELF_CHECK_REQUEST:138`/`SELF_CHECK_SCHEMA:162` (per-paragraph `[P1]` verdicts), `CONSISTENCY_REQUEST/SCHEMA:213/235`.
- Routing `convex/ai/providers.ts:119 clientForModel`; `ORDERED_SECTION_ACTION_SLOTS:87` (5 sequential calls/section worst case). Retrieval brief always Anthropic Haiku (`iterative.ts:106-114`).
- Structured output `convex/ai/structured.ts` `STRUCTURED_OUTPUT_PROGRAM:10` (2 attempts, forced named tool, repair scaffold).
- `promptVersion` = `hashPromptProgram` (`convex/ai/promptProgram.ts:553,566`); any prompt text change moves the hash (`promptScaffolds.test.ts:248,265`).
- Paragraph concepts: `sectionParagraphs`, `complianceNotes.paragraphIndex` (0-based), `chatProposalItems.paragraphNumber` (1-based, deliberately un-joinable, `schema.ts:1015-1019`), self-check `paragraph`, `convex/lib/passageEdits.ts`, `convex/lib/selfCheckRules.ts:160,434`.
- Budgets: `convex/lib/readBudget.ts:31 createReadBudget`; `convex/ai/trustedContext.ts DEFAULT_CONTEXT_BUDGET`; `convex/lib/lineLimits.ts` (s242 50/350, s244 100/700, s246 50/350).

## 5. Frontend

- `src/lib/components/generation/IterativeStepper.svelte` (495 lines): `SECTION_STEPS` `:3-13`; `getIterativeState` `:35`; `approveSectionDraft` `:38`, `regenerateSectionDraft` `:39`; textarea edit keyed section:attempt `:49-69`; guidance `:72-81`; live CRA meter via `sectionMetrics` `:24,:84`; `approve()` `:98-118`.
- Hosts: `CurrentProjectPage.svelte:936-939` (`showIterativeStepper`), page-bar label `:1190`, cancel `:1195`; lazy stepper in `PreviewProjectPage.svelte:1631-1637`. Routes `src/routes/project/[id]/+page.svelte`, `src/routes/project/new/+page.svelte`.
- Rail candidates: `src/lib/components/brief/BriefRail.svelte` + `BriefRailPanel.svelte` (bound to `briefGenerationId` during iterative run — `CurrentProjectPage.svelte:959-973, 1307, 1444`), `qa/QARailPanel.svelte` (`:1456`), `GhostCompareDialog.svelte`, `GenerationProgress.svelte`, `GenerationRecoveryPanel.svelte`.
- No store: `$state`/`$derived` + `useQuery`/`useMutation` (convex-svelte).

## 6. Tests

- `convex/generationLifecycle.test.ts:759-1170` (approveSectionDraft: queue next + edit event; final assembly + post-QA; ghost snapshot cases; refuses without editProse; stale attempt; out-of-order; empty text); `:652,716` ghost fan-in; `:1271` refuses selection on iterative.
- `convex/generationRecovery.test.ts:629, 333, 524`; `convex/sanitizationBoundary.test.ts:75`; `convex/generationAttribution.test.ts:907, 1194-1280, 1474`; `convex/ai/briefPipelineWiring.test.ts:344, 457`; `convex/ai/sectionAgents.test.ts:8-40`; `convex/ai/promptScaffolds.test.ts:34-265`; `tests/generationMode.test.ts:8`; `convex/orderedChainRecovery.test.ts`; `convex/qaBlocking.test.ts`.
- Component: `src/lib/components/project/ReportLoading.component.test.ts:86-88`. Harness: `scripts/loop-verify.sh`, `scripts/chat-behavior-eval.mjs`.

## 7. Target-architecture docs

- `docs/ai-architecture-plan.md:33` core invariant (agents may draft/propose, not activate learning or change authority); `:13-28` target pipeline includes "visible drafting plan and human review"; Phase 3 `:201-243` — evidence-readiness → gap classes → ranked questions one at a time → visible section evidence map → consultant approves/revises plan → draft only after approval; suggested tools `assess_evidence_readiness`, `find_project_evidence`, `rank_missing_information`, `prepare_section_plan`, `confirm_drafting_plan`, `propose_report_edit`; preserve-list `:50` "Iterative section drafting with human approval between dependent sections".
- `docs/ai-engine-audit-2026-08-25.md`: T3 unbounded context/cost, T4 no version provenance.
- `docs/product-domain.md`: role matrix `:173`; 2026-09-01 (second) `:1679-1718` (`report.editProse` at every prose mutation incl. `approveSectionDraft`; createdBy never consulted; superseded terminal); 2026-09-15 (second) `:2060-2131` content roles; style precedence `:1494-1678` (iterative gate at `:1636`); CAP-8 `:1844`; AD-28 `:1445-1494`. `docs/system-map.md:265-305` proposal state machine.

## 8. Risks / constraints

1. Agents propose, humans apply: no action writes report prose directly.
2. Every prose write calls `requireReportEditAccess` (`convex/lib/roleCapabilities.ts:116`); own = ownerId or open assigned workItem (`:82-100`); `createdBy` never consulted.
3. Fences: `project.activeGenerationId === generation._id` in claim/complete/approve; `attempt` fences regeneration; `awaiting_input` exempt from reaper. No `paragraphRuns` table; paragraph indices re-derived from text and unstable across edits.
4. Two paragraph numbering conventions (0-based `paragraphIndex`, 1-based `paragraphNumber`), deliberately un-joinable.
5. `promptVersion` hash moves on any prompt text change; scaffold tests assert verbatim text.
6. `convex/ai/*` are `"use node"`; `convex/lib/tiptapReport.ts` framework-free for default-runtime mutations. `exportTemplateDocx` not SSR-safe; never add `sveltekit()` to `vitest.component.config.ts`.
7. Cost/latency: ordered sections budget 5 sequential calls each; levers `sectionAnswerTokenBudget`, `compressToFit`, `createReadBudget`.
8. Mode selector + stepper gating duplicated in three components.
9. `approveSectionDraft` is the only producer of `sectionEditEvents`; learning loop must keep being fed.
10. CAP-8 blocking QA runs post-assembly only; ghost/one-shot comparison and `reportSnapshots` baseline semantics feed `reportEditDistance`.
