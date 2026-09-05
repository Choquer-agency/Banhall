# Story 8 / CAP-3 metrics readiness

**PED and Brain-source associations have usable persisted inputs, subject to explicit coverage and join limits. Existing aiUsage cannot supply a truthful rerank fallback numerator or denominator.** That is a measurement prerequisite inside the original remaining capability, not a reason to invent a rate or reopen unrelated deferred work.

Read-only inspection at exact accepted target `70705c26f288755afb0bc267f8fef7eb9a25fdfd` (abbreviated `70705c2` below), which contains accepted story5 `1fd71dcfc63e9c7a7ba083ae646ff1ad8486c4c5`. The inspected telemetry, PED and schema inputs have no diff between those commits. All source references below are **70705c2:path:line**, obtained through immutable git show/grep in the existing isolated browser checkout. No active worker, source, spec, policy, ledger or target was edited; no tests, installation, native loop, deployment query or external research ran. This report is the only new artifact.

## BMAD routing and method

`bmad-help` resolved English/project docs and the installed catalog: [RV] `bmad-review` is the read-only readiness route; [BD] `bmad-build` remains the implementation workflow when native story8 dispatches. Applied the verification-gap lens to runtime source and frozen behavior, with an independent lens agent. Both findings are prerequisite measurement/verification gaps, not regressions attributed to an unimplemented story. No new product decision was made.

## Frozen requirements and actual readiness

- `SPEC.md:33-35` requires `/admin/learning`, PED 30/90-day trend, exemplar usage by Brain source joined to writerReviews and candidateScores, and rerank fallback rate **from aiUsage Brain call sites**, all query-backed/tested. `stories.yaml:49-58` routes new queries to convex/learningHealth.ts, uses existing admin layout, and calls for simple SVG sparklines. `touchpoints.md:9` supplies source anchors, not an exhaustive implementation specification. These paths are under `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/`.
- There is no generated story8 spec at this commit. CAP-3 does not define a numerical denominator, unavailable-state contract, sample truncation rule or instrumentation shape. `SPEC.md:73` still explicitly expects the rate to be visible; an unavailable-only implementation cannot silently be declared complete against that success criterion.
- The frozen companion `docs/ai-architecture-plan.md:430` explicitly requires tracking reranker fallback as an operational quality metric; `:436` requires observable fallback. `docs/the-brain.md:159-164` describes provider-error fallback to vector order. Those requirements support implementing measurement, although they do not define its storage schema.
- Existing “unavailable” requirements in story4/diversity policy and story5 concern digest provenance and chat source metadata. They are not an approved replacement of CAP-3's numeric metric. Truthfully representing historical missing data remains necessary, but should be documented as coverage handling, not presented as a previously approved waiver.

## Why aiUsage counts cannot yield the fallback rate

| Runtime path | Persisted evidence | Meaning for the metric |
| --- | --- | --- |
| Search returns positive embedding usage | `brain:query_embedding[:label]` billing row, `convex/ai/brain/retrieve.ts:241-252` | Neither rerank eligibility nor attempt count. Zero-token searches have no such row. |
| Filtered candidate count is at most k | Rerank skipped, same raw-score return path as fallback, `retrieve.ts:130-140,274,280,331-335` | An intentional skip is not a failed rerank. |
| Rerank succeeds with valid billed tokens | `brain:rerank[:label]` row, `retrieve.ts:289-301` | Count of recorded billed responses; not all attempts. Valid zero-token usage is accepted too. |
| Rerank succeeds without valid billed tokens | Console message only; ranking continues, `retrieve.ts:289-305`; `providers.ts:119-137` | Missing usage is not failure or fallback. |
| Rerank branch throws | Console message then vector-order fallback, `retrieve.ts:327-335` | No persisted fallback event/numerator. The catch surrounds post-response ranking too, so it describes branch failure, not solely provider failure. |
| Overall search fails | Empty exemplars and degraded:true, `retrieve.ts:337-339` | A search outage is distinct from a reranker fallback. |
| Usage scheduling and direct-write fallback both fail | Console message only, `convex/ai/instrument.ts:59-83` | Even an otherwise eligible billing row can be absent. |

`convex/schema.ts:467-487` and `convex/aiUsage.ts:152-172` contain billing/token/cost/call-site attributes, not attempt identity, eligibility, outcome or fallback counts. `aiUsage.ts:172` describes one provider response's billed usage; `:278-280` counts rows as calls. Inserting fabricated zero-token billing events to stand for unknown failed attempts would change existing call/cost semantics and is not evidence of actual billed usage.

Do not calculate `(embedding calls - rerank calls) / embedding calls`, `1 - rerank/embed`, or an equivalent ratio. Neither absent rerankScore nor degraded is an alternative: `retrieve.ts:36-49` expressly conflates skipped/failed absence and says rerank failure is **not** degraded. Provenance stores returned exemplars only; successful rerank may return no survivors (`retrieve.ts:322-326`). Retries (`retrieve.ts:287`) also mean one logical rerank operation is not necessarily one provider HTTP attempt.

**Truthful present-day query results:** observed billed-rerank response count and recorded embedding count, labelled as such; fallback rate, fallback count and complete attempt count unavailable. Missing history is unknown, never zero. A future covered cohort with zero eligible attempts should have no rate (null plus count zero); a fully recorded cohort with attempts and zero fallbacks can truthfully report 0%.

## PED trend inputs and limits

`convex/schema.ts:1320-1339` persists report/project, optional generation and writer, revision, ped, computedAt and trigger. `convex/lib/editDistance.ts:42-53,82-89` defines PED as one minus word-multiset similarity, with 0 untouched and 1 rewritten. Do not change that formula (`SPEC.md:77`). A 30/90-day query can filter recorded `computedAt`, group/report the samples with counts, and state the milestone cohort being shown.

`recordReportEditDistance` (`editDistance.ts:98-158`) intentionally emits no reading for missing generated baseline, unparseable content, duplicate unchanged trigger/revision/PED or recording failure. Legacy owner/generation IDs can be absent. `convex/reportEditDistance.ts:20-51,59-113` already has bounded per-report/per-writer queries; writer attribution is ownerId at the reading, not creator/current owner inferred later. Existing caps are 200/500 (`:11-12`), so reusing them as a supposedly complete firm-wide trend would hide truncation. A new indexed bounded dashboard query is normal implementation work; it should expose sample and coverage/truncation metadata.

No reading is not PED zero. Multiple milestones from one report are multiple measurements, not independent generated reports. If summarizing per report/day/latest milestone, label and test that choice instead of silently overweighting frequently edited reports. `SPEC.md:73` cannot manufacture a historical origin point where the runtime retained none. Existing series may also retain rows for deleted reports/projects; skip or label invalid joins based on an explicit query rule, without changing retention policy in this dashboard task.

## Brain-source usage and review joins

`generations.brainProvenance` (`convex/schema.ts:735-753`) records per-section entries, optional sourceId/title and raw scores. `convex/generations.ts:2663-2684` stores that snapshot; `convex/ai/brainRetrieval.ts:134-153` writes it only when returned provenance is nonempty. An absent provenance array does not prove no retrieval or no Brain usage. Source IDs and source documents can be missing; report the unmatched/missing cohort without inventing a source identity.

Candidate ratings join directly through `candidateScores.generationId` (`schema.ts:787-803`). Human report reviews join through `writerReviews.reportId` and the linked report's generation when available; `writerReviews` does not itself store generationId (`schema.ts:1569-1586`). Reviews pin optional revision/contentHash and are updated in place (`convex/reviews.ts:59-94`), so avoid claiming historical generation/version attribution that those links cannot establish. Keep unmatched reviews distinct.

Deduplicate source-by-generation exposure when describing “generations using this source”; count entry/section occurrences separately if useful. Otherwise multi-section chunks and multiple candidate scores multiply the same generation exposure. Keep candidate scores (1–10, `schema.ts:796`) and report review scores (0–100, `:1578`) separate or explicitly normalize; never average them raw. Associated human scores describe correlation with a shared source, not causal improvement attributable to that source. No frozen evaluation/Brain-on-off experiment is required here (`SPEC.md:68`).

## Implementation choices versus genuine human decisions

**Can be resolved in ordinary story8 planning under existing intent:** authenticated admin query/layout reuse; 30/90-day selection; query limits/indexes and honest truncation; joins and explicitly labelled aggregation units; missing/legacy/no-attempt states; safe prospective outcome instrumentation sufficient to compute the requested metric. A conventional, precisely labelled “fallbacks among measured rerank attempts” cohort distinguishes intentional skips from failures. The frozen text has not selected it, so the story spec must name its numerator, denominator, retry unit and coverage start; do not describe this report as human approval of a definition.

Implementing necessary instrumentation is supported by the requested metric and companion tracking requirement. Its concrete design must preserve the existing aiUsage billing meaning and the stated Brain-call-site source, record success even when billing usage is absent, record fallback independently, distinguish skipped/search-failed operations, and avoid double-counting retries. This can be done without changing retrieval results/eligibility, provider privacy, publication or authorization. `SPEC.md:63` forbids named parallel-boundary files; the shared `convex/ai/brain/retrieve.ts` and instrument/aiUsage boundaries are not in that list. Put new backend mechanics in new modules as required, with minimal caller hooks; no need to expand into those forbidden modules.

**Would genuinely require human scope/policy direction:** accepting permanent unavailable-only output instead of the required measured rate; relabelling intentional skips as failures to change the business meaning; reconstructing or fabricating historical rates; changing provider/fallback behavior, permissions, retention, or a forbidden boundary module. None of those is necessary merely to begin faithful story8 planning. The missing denominator is not by itself a mandate to stop and ask another product question.

## Verification needed at story8 implementation

The independent BMAD lens found no existing outcome-telemetry regression proof. `convex/ai/brain/retrieve.test.ts:18-63` and retrieveFloorEdges test floor/format mechanics; brainUnlearn tests exercise non-reranked slates; `tests/aiUsage.test.ts:27-42` covers pricing/token parsing. They cannot validate a nonexistent denominator.

Add query/measurement tests covering: actual rerank success, success without billing tokens, fallback, intentional skip, zero-result success, overall search failure, zero attempts, uncovered historical rows, retry counting, and mixed call-site suffixes. Verify numerator and denominator from recorded outcomes, not synthetic arithmetic over billing fixtures alone. Dashboard queries also need PED missing/multiple-milestone/capped windows and source join/dedup/missing-score tests, plus actual admin access and rendered empty/partial-data states. No such implementation or new verification was performed by this readiness check.

## Canonical BMAD lens findings

```json
[
  {
    "lens": "verification-gap",
    "gap_shape": "other",
    "location": "70705c2:_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/SPEC.md:35",
    "trigger_condition": "Required rerank fallback rate has neither persisted fallback numerator nor complete attempt denominator.",
    "guard_snippet": "Record explicit counted outcomes and a defined covered denominator; preserve historical unavailable state and separate billing usage.",
    "potential_consequence": "Embedding/rerank billing ratios conflate intentional skips, missing successful usage and actual fallback."
  },
  {
    "lens": "verification-gap",
    "gap_shape": "other",
    "location": "70705c2:convex/ai/brain/retrieve.ts:280",
    "trigger_condition": "Existing deterministic tests do not assert outcome/count persistence for rerank success, failure, skipped calls or missing usage.",
    "guard_snippet": "Exercise real retrieval outcomes plus dashboard query aggregation and coverage states during story8 implementation.",
    "potential_consequence": "Existing green tests cannot validate the requested numeric metric."
  }
]
```
