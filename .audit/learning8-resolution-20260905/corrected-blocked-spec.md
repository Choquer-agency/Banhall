---
title: 'Admin learning-health page'
type: 'feature'
created: '2026-09-05'
status: 'blocked'
baseline_revision: '1b0511611f0766f90b61bb01afea011085fcc4cf'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Administrators lack a learning-health view for report editing, Brain exemplar usage and rerank fallback.

**Approach:** CAP-3 calls for `/admin/learning`, 30/90-day PED trends, exemplar usage by Brain source joined to writer reviews and candidate scores, and the user-approved measured fallback rate from tested queries in `convex/learningHealth.ts`. Add prospective terminal outcome instrumentation independent of billed usage; compute fallback / (success + fallback) for completed logical attempted reranks, excluding intentional skips. Show old unmeasured history unavailable and preserve current retrieval and cost semantics. Follow existing AdminWorkspacePage/PageBar layout and use simple SVG sparklines in the design system palette.

## Boundaries & Constraints

**Always:** Preserve domain authority, administrator-only access, human publication, existing PED formula and source provenance. Represent absent measurements honestly. Keep reads bounded with visible coverage limitations. Respect the epic's protected modules and use supported code generation only.

**Block If:** Implementation requires changing the approved measurement definition, retrieval/provider behavior, privacy, permissions, publication or a protected boundary. The user resolved the former population/history gap: failed rerank attempts divided by all rerank attempts; exclude deliberate skips; add prospective tracking now and show older unmeasured history unavailable. Do not substitute a billing proxy.

**Never:** Infer failures from missing `rerankScore` or from the difference between embedding and rerank billing counts. Fabricate historical failure events, modify report prose, repurpose `projects.createdBy`, or edit native deferred-work ledger entries.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Recorded PED | Persisted readings in the selected 30/90-day range | Display measured PED with observable coverage | Missing readings are unavailable, never invented zeros |
| Source use | Multiple chunks/sections referencing a Brain source | Group by source identity and retain honest review/score attribution | Missing provenance is explicitly unavailable |
| Successful rerank | Terminal successful logical attempt, with or without billed token metadata | Count once in denominator; retain independent truthful billing | Empty surviving slate is still success |
| Failed rerank | Existing final attempted-rerank failure returns vector order | Count once in numerator and denominator through new operational tracking | Preserve existing retry/fallback behavior |
| Skipped rerank | Candidate count does not exceed k | Excluded from numerator and denominator | Separate from failure |
| Missing billing | Rerank succeeds but response lacks token usage | Successful terminal outcome still counts in denominator | Never fabricate billed tokens or classify as fallback |
| Historical/no attempts | Billing-only history or zero measured completed attempts | Unavailable rate with coverage/count labels | Missing data is not zero failures |
| Measured example | 8 successes, 2 fallbacks, 5 intentional skips | 20%, based on 10 attempts and 2 fallbacks | Existing HTTP retries do not inflate logical counts |

</intent-contract>

## Code Map

- `convex/ai/brain/retrieve.ts:280`: reranking is conditional on candidate count. Lines 289-303 schedule successful usage only when billed tokens are available. Lines 327-328 log failure to console only. Lines 331-337 share the vector-order exit between skipped and failed reranks. This is the blocking evidence.
- `convex/schema.ts:467`: aiUsage stores billing tokens/cost/callSite/timestamp, with no rerank outcome; `by_createdAt` supports window reads.
- `convex/aiUsage.ts:156`: usageArgs and logUsage persist billed provider responses. Adding failure events needs a defined operational measurement contract that preserves billing semantics.
- `convex/schema.ts:741`: generations.brainProvenance contains optional sourceId and rerankScore per chunk/section. Missing rerankScore means skipped or failed, not a reliable failure label.
- `convex/schema.ts:787`: candidateScores retains generationId and 1-10 human scores after candidate deletion; do not depend on deleted candidate rows.
- `convex/schema.ts:1569`: writerReviews carries reportId and 0-100 scores, but no generationId. Resolve through report lineage with honest handling of missing historical attribution.
- `convex/schema.ts:1320`, `convex/reportEditDistance.ts:21,64`: CAP-2 persistence exists; current report/writer series cap at 200/500 without coverage metadata. Preserve owner-at-reading attribution and optional generationId. Story 3 leaves historical backfill and pagination limitations for later work; do not silently present capped arrays as complete firm-wide data.
- `src/lib/components/admin/AdminWorkspacePage.svelte`: presentation-only shell delegates normal navigation to WorkspaceChrome and uses PageBar in the current-presentation branch.
- `src/lib/components/workspace/WorkspaceRail.svelte:118`: actual shared administrator navigation. CAP-3's AdminWorkspacePage navigation anchor has drifted; reuse this navigation rather than inventing a second list in the shell.
- `src/routes/admin/usage/+page.svelte`: existing query/access/layout pattern; `src/routes/admin/adminWorkspaceRoutes.test.ts:4` owns the route inventory.

## Tasks & Acceptance

**Execution (not started):**
- [ ] `convex/learningHealth.ts`: implement administrator-only bounded metric queries after the fallback measurement contract is resolved.
- [ ] `convex/learningHealth.test.ts`: prove date windows, source/review joins, access, unavailable data and the resolved fallback numerator/denominator.
- [ ] `src/routes/admin/learning/+page.svelte`: render query-backed metrics, range controls, empty/error/coverage states and token-colored SVG sparklines under AdminWorkspacePage.
- [ ] `src/lib/components/workspace/WorkspaceRail.svelte`, `src/routes/admin/adminWorkspaceRoutes.test.ts`: expose the route through existing navigation and extend route coverage.
- [ ] `src/routes/admin/learning/learningHealth.component.test.ts`: exercise the real page, range changes, access/loading/error behavior and keyboard interaction; retain inspected browser evidence.

**Acceptance Criteria:**
- Given an administrator and recorded learning signals, when `/admin/learning` opens, then measured PED and source usage with review/score context appear in the existing admin layout.
- Given 30/90-day controls, when the administrator changes range, then visible values and sparkline coverage correspond to the selected window.
- Given rerank outcomes under the resolved measurement contract, when the query and page execute, then the displayed rate is fallback / (success + fallback) for measured terminal logical attempted reranks, skips are excluded, and missing history/no attempts are not misclassified as zero failures.
- Given a caller without administrator access, when the page or public metrics query is requested, then learning data is not disclosed.

## Spec Change Log

- 2026-09-05: User answered yes to the recommended attempted-rerank failure definition, exclusion of deliberate skips, prospective instrumentation and historical unavailable coverage, and requested resuming through the preceding confirmation. See the approved measurement companion. This former blocked plan still requires fresh native planning/readiness validation.

## Review Triage Log

## Verification

Planning evidence only: inspected the real producer, storage schema, readers and admin shell. No product code was changed and no test pass is claimed. Before implementation resumes, resolve the questions below and complete the ready-for-development gate. Required implementation gates remain `npm run test:component` before component edits and at completion, `npm test`, and `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`.

## Auto Run Result

Status: blocked
Blocking condition: intent gap

The requested rerank fallback rate cannot be calculated from current aiUsage data. The producer stores only some successful reranks, does not store failed attempts, and legitimately skips reranking for short slates. Neither billing ratios nor absent provenance scores distinguish these states.

Unanswered measurement questions:
1. Is fallback rate failed attempted reranks divided by all attempted reranks, or vector-order retrievals divided by all Brain retrievals (including intentional skips)? These produce observably different values; the contract does not choose the population.
2. Should this story introduce outcome telemetry and show a prospective rate with historical coverage marked unavailable, or should the requested panel explicitly report the rate unavailable until a separate telemetry change lands? Existing historical billing rows cannot reconstruct either rate accurately.

Recommended resolution for human/orchestrator consideration: record success/failure outcomes for attempted reranks independently of billed token availability, keep intentional skips outside the denominator, preserve cost reporting, and label pre-instrumentation history unavailable. This recommendation has not been adopted as an approved contract or implemented.

The rendered workflow's step-02 instruction 5 requires HALT on unresolved intent gaps. No implementation/review dispatch occurred. The native deferred-work ledger remains untouched. Evidence and the exact inspected revision are retained in `.audit/story-8/evidence.md`.
