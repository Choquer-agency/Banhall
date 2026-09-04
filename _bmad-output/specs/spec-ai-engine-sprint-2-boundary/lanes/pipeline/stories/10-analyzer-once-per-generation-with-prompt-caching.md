---
title: 'Analyzer once per generation with prompt caching'
type: 'feature'
created: '2026-09-04'
status: blocked
baseline_revision: 'ffd761de7d7fe59e4f111d374f663775d68dfb0d'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - convex/_generated/ai/guidelines.md
  - .factory/AGENTS.factory.md
warnings: [oversized]
deferred:
  - summary: >-
      End-to-end provider chains can exceed the Convex action deadline; shared analysis now joins the entry chain, as it already does in iterative generation.
    evidence: |-
      convex/ai/condense.ts:124-139 reserves only non-request time after condensation. Brain retrieval and analysis then execute sequentially. convex/ai/providers.ts:32-48 explicitly documents that provider timeout bounds apply to one slot rather than a complete action; stale-generation recovery remains the fallback. Durable per-phase scheduling is a broader existing pipeline limitation.
    location: >-
      convex/ai/pipeline.ts:679
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Compare candidates each pay for a separate analysis of the same frozen generation input. Anthropic generation requests do not mark the shared system and transcript prefix for caching.

**Approach:** Mirror iterative.ts: analyze once in generateReport, persist generationArtifacts analysis, and pass the validated result to every candidate. Mark cacheable generation prefixes at the direct Anthropic boundary while preserving OpenRouter request behavior.

## Boundaries & Constraints

**Always:** Preserve frozen context budgets, provenance and usage attribution, candidate fencing, advisory QA, and candidate-specific drafting models. Use the existing default MODEL for shared analysis, making it independent of pair ordering; single mode may retain its selected model. Reuse saveIterativeArtifacts for storage with its existing brain-block envelope. Preserve public API paths. All changes follow Convex guidelines. Keep older queued candidate payloads usable with an optional analysis argument and the existing analyzer fallback only when that argument is absent.

**Block If:** The shared analysis requires a schema migration or changes to workflow authority or report-edit policy.

**Never:** Edit generated files, human workflow policy, frontend components, learning.ts, brain.ts, or chat surfaces. No provider calls in tests. No push, PR, or deployment.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Compare | Frozen input, two candidate models, valid stubbed analysis | One analyzer request, one analysis artifact write before scheduling, both completed candidates contain the identical analysis and use their own drafting models | Existing candidate completion behavior |
| Analysis failure | Analyzer provider rejects | Generation fails; no candidate is scheduled | Existing failGeneration path |
| Legacy candidate | Queued payload lacks analysis | Candidate runs the existing analyzer path successfully | Existing candidate failure reporting |
| Invalid shared analysis | Candidate receives malformed analysis JSON | No drafting provider request | Candidate marked failed through existing completion path |
| Anthropic caching | Generation-owned direct request with string system and transcript user message | System and transcript text blocks carry ephemeral cache_control; input text/order retained | Existing provider error propagation |
| Other traffic | OpenRouter request or non-generation direct Anthropic request | Request semantics unchanged; no newly injected caching in non-generation traffic | Existing provider error propagation |

</intent-contract>

## Code Map

- `convex/ai/pipeline.ts`: runPipelineForModel currently analyzes at entry (around line 350); generateReport builds/records trusted context and retrieves Brain once, then schedules candidates (around line 720). generateCandidate rebuilds analyzer context and calls runPipelineForModel. Add optional shared analysis handoff, preserving legacy fallback. No frontend callers change.
- `convex/ai/iterative.ts`: analyzer-once precedent around line 215, followed by saveIterativeArtifacts. Existing model selection is the precedent for single mode.
- `convex/generations.ts:1350`: saveIterativeArtifacts upserts analysis and brain_blocks by generation/kind; reuse as-is. Its envelope includes blocks, styleGuidance and styleOverrides. No schema changes needed.
- `convex/ai/analyzerAgent.ts`: analysisSchema validates provider data and defaults optional lists; expose a validated parser/schema for shared JSON instead of a cast.
- `convex/ai/instrument.ts`: direct SDK boundary, generation attribution, usage/cache counters and handoff recording. Add caching only to generation-owned requests, leaving existing explicit block/cache payloads intact and respecting the provider's four-breakpoint limit.
- `convex/ai/providers.ts`: direct versus OpenRouter routing, timeout documentation and sequential call count; update documentation/count only where needed to reflect shared analysis while acknowledging legacy candidates.
- `convex/ai/openrouterCore.ts`: string-only gateway contract; leave unchanged if direct instrumentation handles cache blocks.
- `convex/ai/instrument.test.ts`: stub SDK create method and inspect exact outgoing requests. Existing usage attribution and cache-counter assertions must continue passing.
- `convex/generationAttribution.test.ts`: preserve analyzer boundary/role/budget/digest assertions when adapting entry orchestration; update fixtures for the new entry analyzer. Existing CAP-2/3/4/5 stories are done. Their context, uploader-role trust and chat boundary policies remain unchanged.
- `convex/ai/structured.ts`: valid stub tool output avoids repair requests; real analyzer validation must run in compare proof.
- `convex/ai/trustedContext.ts`: CAP-2/CAP-3 delimiter, budget and trust contract remains authoritative. CAP-10 row in lane touchpoints.md confirms pipeline/iterative/provider boundaries.

- `tsconfig.json`: explicit root-relative includes preserve all generated SvelteKit include coverage and add shared modules, fixing native test-transformer configuration discovery.

## Tasks & Acceptance

**Execution:**
- [x] `convex/ai/pipeline.ts`, `convex/ai/analyzerAgent.ts`: move analysis before candidate fanout, persist and hand off validated analysis; preserve legacy payload compatibility and model-specific downstream work.
- [x] `convex/ai/instrument.ts`, `convex/ai/instrument.test.ts`: mark generation system/transcript prefixes with safe ephemeral caching and prove non-generation behavior is unchanged.
- [x] `convex/ai/pipeline.compare.test.ts`: exercise generateReport and both scheduled generateCandidate actions with stubbed provider clients, real agents and artifact persistence; cover matrix failures and legacy compatibility. Prefer convex-test for storage and actions, mocking only network integrations. Record the baseline failing analyzer-count test before implementation.
- [x] `.audit/CAP-10/decisions.tsv`, `.audit/CAP-10/evidence.md`: append decisions and baseline/final evidence, map ACs to tests, record exact revision and command output tails.

**Acceptance Criteria:**
- Given a two-model compare generation, when its entry action and both candidate actions run with a stubbed client, then exactly one analyzer request occurs, one persisted analysis row exists, and both candidates use that same analysis.
- Given Anthropic generation requests, when dispatched to the stubbed SDK, then system and transcript carry cache_control without changing their bytes or usage attribution.
- Given the completed changes, when npm test and PUBLIC_CONVEX_URL=http://localhost npm run check run, then both pass.

## Spec Change Log

- 2026-09-04: Added explicit root-relative TypeScript includes after normal Vitest failed with `TSCONFIG_ERROR`; all generated SvelteKit include coverage is preserved and shared modules are added. No runtime behavior or feature scope changed.

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 0, medium 1, low 7)
- defer: 1: (high 0, medium 1, low 0)
- reject: 3: (high 0, medium 1, low 2)
- addressed_findings:
  - `[medium]` `[patch]` Entry attribution lacked a real-action fence. Added assertions for actual analyzer cache markers, one generation-owned analyzer usage row with exact counters, and separately owned candidate usage.
  - `[low]` `[patch]` Added mixed Anthropic/OpenRouter compare coverage through the real gateway adapter, asserting shared analysis and unchanged string-only OpenRouter messages.
  - `[low]` `[patch]` Executed the single-model candidate and verified automatic report promotion.
  - `[low]` `[patch]` Inspected all section requests for both candidates to prove the shared analysis is used in drafting.
  - `[low]` `[patch]` Made the multimodal preservation fixture carry actual image and document blocks.
  - `[low]` `[patch]` Added explicit top-level and later-message cache-policy preservation cases.
  - `[low]` `[patch]` Documented synchronization of root includes with SvelteKit generated coverage.
  - `[low]` `[patch]` Retained all referenced diagnostic and verification logs for the final audit artifact.

The intent auditor confirmed that CAP-10's explicit compare and cache-marker contract is exercised at the real action and SDK surfaces. Live provider cache hits and a global exactly-once guarantee across historical queued or iterative ghost work are not claimed. Three rejected findings concerned inert artifacts after cancellation (candidate execution remains fenced), unchanged seeded-retry semantics, and redundant structured-repair coverage of the already tested analyzer rejection path. The broader action-chain deadline limitation is recorded in frontmatter.

### 2026-09-04: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 2: (high 0, medium 0, low 2)
- defer: 0
- reject: 10: (high 0, medium 0, low 10)
- addressed_findings:
  - `[low]` `[patch]` Assert project status restoration and active-generation clearing after shared analyzer failure.
  - `[low]` `[patch]` Exercise an otherwise populated shared analysis with a wrongly typed nested experiment result; assert failure before any provider request.

Four independent review layers found no material intent divergence. The existing action-deadline concern was recognized without reopening or editing its deferred entry. Additional suggested coverage and live cache-hit proof did not establish another defect in the explicit action/SDK-boundary contract. No new deferred items were added. Existing deferred-work ledger edits belong to the orchestrator and remain untouched.

### 2026-09-04: Rearmed verification review
- intent_gap: 0
- bad_spec: 0
- patch: 10: (high 0, medium 0, low 10)
- defer: 0
- reject: 0
- addressed_findings:
  - `[low]` `[patch]` Retain ignored verification logs in the reviewed artifact and final commit.
  - `[low]` `[patch]` Rerun the unmodified default gate to distinguish it from the serial verification command.
  - `[low]` `[patch]` Describe machine contention as suspected and avoid attributing success to one of multiple runner adjustments.
  - `[low]` `[patch]` Preserve installation output and correct its evidence pointer.
  - `[low]` `[patch]` Distinguish ancestor dependency provenance and rerun focused proof locally.
  - `[low]` `[patch]` Add source references for the independent implementation inspection.
  - `[low]` `[patch]` Include concise command output tails.
  - `[low]` `[patch]` Distinguish reproduction, implementation and verification revisions.
  - `[low]` `[patch]` Explain resolution of the prior dirty-tree block at the current clean baseline.
  - `[low]` `[patch]` Identify the unrelated 100 ms timing assertion precisely.

Four review layers found no runtime gap. Twelve documentation suggestions were deduplicated into ten low-severity corrections. No implementation or test edits were needed; existing deferred entries remain unchanged.

## Design Notes

Pass serialized analysis in an optional internal action argument to avoid a new database query surface and retain old queued payloads. Parse using the analyzer's runtime contract. The normal fanout never invokes the fallback. One analyzer run means one logical invocation; existing structured-output repair and SDK retry behavior remains in place on malformed responses or transport errors.

## Verification

- `npx vitest run --project convex convex/ai/pipeline.compare.test.ts convex/ai/instrument.test.ts`
- `npm test`
- `PUBLIC_CONVEX_URL=http://localhost npm run check`
- `git diff --check`


## Auto Run Result

Status: blocked
Blocking condition: patch verification failed. The unmodified `npm test` gate repeatedly times out in unrelated chat-context and form-control source-contract tests on this host.

The existing implementation already mirrors iterative generation: analyze once, persist the analysis before fanout, pass validated analysis to both candidates, and mark generation-owned Anthropic prefixes for caching. No runtime or test changes were required in this run.

Files changed:
- This story: current baseline, review triage, follow-up flag and blocked verification result.
- `.audit/CAP-10/evidence.md`: source inspection, revision provenance, matrix mapping and fresh gate results.
- `.audit/CAP-10/decisions.tsv`: append-only inspection and verification decisions.
- `.audit/CAP-10/rearm-*.log`: retained installation, failing attempts and passing command output.

Review: 10 low documentation/evidence patches applied, 0 medium, 0 high; 0 new deferred items and 0 rejected items after deduplication. Follow-up review recommended: true (score 10 under the workflow formula). Four layers identified no runtime gap.

Verification: local focused suite passed 27 tests; serial full suite passed all 1376 tests in 128 files with `npm test -- --maxWorkers=1 --testTimeout=30000`; type check passed with zero errors and warnings. Latest unmodified `npm test` passed 1374 tests and timed out in 2. The redundant post-documentation type check was stopped after that failure. Diff whitespace verification passed.

The six matrix cases are covered by executed tests. The existing action-chain deadline risk remains deferred; live provider cache hits are not claimed. See [verification evidence](../../../../../../.audit/CAP-10/evidence.md) for exact revisions, commands and output tails. No push, PR or deployment was performed.
