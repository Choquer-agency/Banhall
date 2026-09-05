# Story 8 measurement decision proposal

Pending human decision. This proposal has not amended the frozen spec, written a resolution marker, rearmed the story or changed product code.

## Recommended contract

Measure **rerank fallbacks among measured attempted reranks**: logical rerank operations that end by falling back to vector order divided by all measured logical rerank operations that were actually attempted. Intentional rerank skips are outside both numerator and denominator. For example, 10 attempted reranks with 2 final fallbacks produce 20%, regardless of 5 additional intentional skips.

Add prospective outcome tracking as part of this story, independently of billed-token availability. Count one logical operation after its existing retry behavior, not each HTTP retry. Successful operations count even if billed usage is missing; provider or rerank-branch failure that actually triggers vector-order fallback counts as fallback. A successful rerank returning no surviving exemplars is still successful. Overall search failure and intentional skip remain distinct from rerank fallback. Do not change retrieval eligibility/results, fallback/provider retry behavior, cost-reporting semantics, privacy, permissions, retention or publication rules.

Show the measured period, attempt count, fallback count and coverage start. A window with no measured attempts has an unavailable rate, not zero. Historical billing rows cannot be backfilled into outcome events; pre-instrumentation history is unavailable. Disclose partial or unavailable telemetry instead of implying complete measurements. Add real outcome-path, aggregation and UI coverage tests as part of normal native planning/implementation.

PED trends, source-score joins and admin-page requirements retain their existing scope. This is a concrete measurement recommendation, not a claim that the user previously approved its population.

## Alternatives for the human

1. **Recommended:** failure fallback divided by attempted reranks, measured prospectively, with deliberate skips excluded and historical coverage unavailable. Measures operational reliability of the rerank step.
2. **Vector-only retrieval share:** count intentional skips plus failure fallbacks among Brain retrievals. This produces a different metric and requires a precisely labelled retrieval population, including separate handling of search failure.
3. **Defer instrumentation:** keep the rate unavailable until a later telemetry story. This reduces the current CAP-3 acceptance scope and cannot silently count as completion of its required measured rate.

## Why the decision is explicit now

The readiness investigation established that adding telemetry can be ordinary implementation work within original CAP-3 scope. It did not establish a human-approved numerator/denominator. Native planning has now frozen a blocked story listing the two population/history questions. No existing approval in this task explicitly selects between those observable dashboard outcomes. The resolver skill requires getting the human's decision before amending the frozen contract. The evidence supports the recommendation above; it does not turn it into an approval.

Source evidence: ../learning-monitor-20260904/story8-metrics-readiness.md, this folder's context.json and worker-evidence/evidence.md, frozen SPEC CAP-3, docs/ai-architecture-plan.md:430 and docs/the-brain.md:159-164. The deployed/historical outcome dataset was not queried and no new test pass is claimed in this resolution preparation.

## Native re-drive requirements after the decision

Preserve the blocked worker and evidence. The current blocked story is an incomplete plan, because planning halted before its readiness gate. Update canonical SPEC plus a decision companion or manifest with the approved measurement contract; carry that corrected intent to pinned sprint2-learn-chat. Prefer the supported zero-match fresh-planning route used for story4, with the incomplete blocked spec preserved outside the dispatch pattern. Native resolve and resume own task status/baseline/result stripping; never hand-edit those fields or use restore_patch under worktree isolation. Verify current policy/bootstrap/config and a fresh Astra6 medium session consuming the approved decision. Keep the already reviewed DW96 and DW97 private fixes separate until their combined integration is verified.
