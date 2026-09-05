# Rerank fallback measurement decision, 2026-09-05

## Human decision

The user answered **yes** to this recommendation and resuming the run on 2026-09-05:

- Fallback rate = failed rerank attempts divided by all rerank attempts.
- Exclude deliberate skips.
- Add tracking now; show older, unmeasured history as unavailable.

This resolves CAP-3/story8's measurement population and prospective-instrumentation questions. It is not an unavailable-only waiver of the required metric. Preserve all other CAP-3 requirements and the approved privacy/publication rules.

## Testable measurement contract

Measure logical rerank operations that reach their existing terminal result after the current retry behavior. The displayed rate is recorded **fallback / (success + fallback)** for measured completed rerank attempts in the selected window. One logical rerank operation contributes at most one terminal outcome; existing HTTP retries are not separately counted. Label the metric and show the measured attempt/fallback counts and coverage period.

- Success counts in the denominator even when billed-token metadata is absent. A successful rerank returning no surviving exemplars is still success.
- An attempted rerank whose existing failure path returns vector-order results counts as fallback. Intentional short-slate skips and overall search failures are separate outcomes, outside this denominator; do not infer failures from missing rerank scores or billing rows.
- A measured cohort with attempts and zero fallbacks reports 0%. A cohort with zero measured attempts has no rate (unavailable/null), not a fabricated 0%. In-progress or unobserved terminal outcomes do not silently become failures or completed samples.
- Add prospective operational outcome tracking at the existing Brain rerank call sites. Preserve aiUsage's billed-token/cost meaning and existing call-site attribution. Storage/index shape is an implementation choice; do not create fake billing events or reconstruct historical outcomes from successful billing rows.
- Show pre-instrumentation history as unavailable. Describe measured coverage and any bounded-query truncation/known recording gaps honestly. An unknown record is not proof of success, failure, no use or no cost.
- Telemetry must not change rerank eligibility, provider retries, returned retrieval results, fallback behavior, cost reporting, privacy, authorization, retention or human publication. A telemetry write failure must not turn a successful retrieval into a failed rerank. Keep new backend mechanics in appropriate new modules with minimal allowed caller hooks, and use supported codegen.

These operational details make the approved measure testable while preserving existing behavior. They do not add a new provider or business policy.

## Required cases for native planning

| Scenario | Measured result |
| --- | --- |
| 8 successful attempts, 2 final fallbacks and 5 intentional skips | 10 measured attempts, 2 fallbacks, 20% |
| Success without billed-token metadata | Success still recorded; cost data is not fabricated |
| Short slate deliberately skips rerank | Excluded from attempt denominator, distinct from failure |
| Successful rerank has zero survivors | Successful attempt, not fallback |
| Existing retry succeeds or ends in fallback | One terminal logical outcome according to final behavior |
| No measured attempts | Rate unavailable/null with count zero |
| Measured attempts with no fallback | 0%, with sample count/coverage |
| Old billing-only history or missing/truncated outcome data | Honest unavailable/partial coverage, no inferred rate |
| Overall search failure | Separate from attempted rerank fallback |
| Outcome persistence failure | Retrieval behavior preserved; no invented metrics or hidden claim of complete coverage |

Exercise actual retrieval outcome paths and actual aggregation/page behavior. Billing-only arithmetic fixtures cannot establish the metric. PED trends, source/review joins, admin access and design-system/browser requirements stay in scope.

## Planning evidence and boundaries

The original blocked story stopped before its readiness gate and is preserved outside the replacement dispatch. Re-plan story8 from the canonical SPEC, this companion, touchpoints and current code. Resolve current admin navigation at WorkspaceRail rather than duplicating a stale AdminWorkspacePage navigation list. Preserve the existing PED formula, source identity, score scales and honest missing/partial data handling.

Read-only source research is retained at `/Users/johnnynguyen/Documents/Repos/Banhall-bmad-completion/.audit/learning-monitor-20260904/story8-metrics-readiness.md`. It is an investigation aid; this approved decision and the canonical SPEC define the contract. Its earlier pending-decision observations are superseded by the user approval above. Existing `docs/the-brain.md` describes rerank errors falling back to vector order; `docs/ai-architecture-plan.md` requires tracking fallback as an operational quality metric.
