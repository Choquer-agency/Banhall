---
title: 'Admin learning-health page'
type: 'feature'
created: '2026-09-05'
status: 'done'
baseline_revision: '64ee37c8d7498318232f6367b55c7f638e8b830e'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/product-domain.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/docs/design-system.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/decisions/rerank-fallback-measurement-2026-09-05.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Administrators cannot see persisted learning trends, associate Brain source use with writer judgments, or measure rerank fallbacks independently of billing.

**Approach:** Deliver CAP-3 at `/admin/learning`, with 30/90-day PED trends, Brain source usage joined to writer reviews and candidate scores, and prospective operational rerank measurement. Follow the shared admin frame and navigation, using simple SVG sparklines in the design-system palette.

## Boundaries & Constraints

**Always:** Follow the approved rerank measurement companion. Count one terminal logical result after existing retries: fallback / (success + fallback). Exclude deliberate skips and overall search failures; display their counts separately. Success without billing metadata or surviving exemplars remains success. Recording failures must not change retrieval behavior. Preserve existing billing, attribution, provider retries, eligibility, governance, retention, privacy and publication semantics. Admin-only access must be enforced in every public metrics query and in route visibility. Display actual samples, windows, missing data and bounded-query truncation honestly. Preserve PED formula and separate review score scales. Use Svelte 5, type roles, semantic palette, maximum new font weight 500, existing primitives and primary-fill/white active range controls. Keep query logic in the new backend module and page content route-owned under AdminWorkspacePage.

**Block If:** Delivery requires changing authority, report prose, publication policy, forbidden files, or inferring missing operational outcomes. If supported codegen cannot run, report the actual failure rather than hand-edit generated files.

**Never:** Edit `convex/ai/chatAgentV2.ts`, `convex/chatV2.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/pipeline.ts`, `convex/lib/auth.ts`, `convex/projectWorkflow.ts`, `convex/ai/qaChecks.ts`, or `convex/reports.ts`. Do not backfill telemetry from aiUsage, create fake cost events, conflate missing scores with zero, merge different source identities by title, or change native deferred-work ledger content/status. Do not push, open PRs or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| PED window | Recorded samples inside/outside 30/90 days, including zero and multiple milestones | Chronological measured trend, sample/report counts and correct selected bounds; missing days are not zero | Empty samples explicitly unavailable |
| Source joins | Repeated source across passages/sections, retained candidate scores, writer reviews on linked reports | Unique generation/source use plus passage count; candidate mean /10 and review mean /100 with separate sample counts | Missing joins remain unavailable |
| Historical sources | Missing sourceId, malformed/deleted IDs, equal titles, absent provenance, incompatible known review reportVersion | Stable distinct identities or explicitly unattributed use; coverage caveats, no fabricated joins | Invalid IDs do not crash query |
| Rerank arithmetic | 8 successes, 2 fallbacks, 5 skips | 10 attempts, 2 fallbacks, 20%; skips excluded | Search failures separately excluded |
| Actual success | Existing retrieval completes with no billed tokens or zero surviving exemplars | One success outcome and unchanged retrieval/billing behavior | No invented cost row |
| Retry terminal | Existing retry succeeds or ends in fallback | One logical outcome reflecting final behavior, same provider retry settings and returned results | Intermediate retries not counted |
| No attempts | Old billing-only history, skips-only, or empty outcomes | Null rate, zero attempts, historical coverage unavailable | Measured successes with zero fallbacks instead show 0% |
| Recording failure | Outcome persistence throws after success, fallback, skip or search failure | Same retrieval result as without telemetry; diagnostic and visible best-effort coverage caveat | Never turns retrieval success into fallback |
| Bounds and access | Over-limit data, non-admin/anonymous/roleless caller, invalid time bounds | Partial results identified; unauthorized callers receive no metrics; invalid bounds rejected | No uncapped scans |
| Page lifecycle | Loading/error/empty/measured query states; range change and refreshed clock | Accessible distinct states; selected range never labels stale data as fresh; 30/90 switches change query window | Recoverable error and refresh affordance |
| Browser/layout | Desktop/narrow, keyboard range control, workspace/current presentation | One main/h1, working admin link and PageBar rollback, readable contained table and token-colored sparkline | No document horizontal overflow |

</intent-contract>

## Code Map

- `convex/ai/brain/retrieve.ts:207`: searchBrainExemplars, shared generation/chat function. Single rerank call at 282 has existing retry behavior, nested fallback catch, outer search-error catch, and short-slate bypass. `brain:rerank${usageSuffix}` preserves label attribution. Record after computing the terminal return value, with a separately guarded telemetry helper; do not move the existing billing behavior.
- `convex/ai/brain/retrieve.test.ts`: existing pure retrieval helpers; add actual searchBrainExemplars tests mocking external RAG/provider boundaries while running real routing logic. Use SDK provider boundary for retry proof where feasible.
- `convex/schema.ts:740`: generations.brainProvenance has string sourceId, entryId, section and optional historical title. Add a by_startedAt index for bounded global generation windows. Deduplicate generation/source pairs; retain passage counts. Absent provenance does not establish no use.
- `convex/schema.ts:787`: candidateScores.by_generationId survives reportCandidates deletion; score is 1–10. Join directly, never through deleted candidates.
- `convex/schema.ts:1569`: writerReviews.by_reportId score is 0–100. Join generation to reports.by_generationId, then reviews; exclude known reportVersion mismatches and disclose legacy linkage limitations. Use generation-associated judgments rather than suggesting source-level causal quality.
- `convex/schema.ts:1320`, `convex/reportEditDistance.ts`: persisted PED computedAt/ped/reportId/generationId and optional writerUserId. Add global computedAt index; leave existing writer/report query contracts untouched. CAP-2 formula is `1 - word-multiset similarity`; paragraph counts do not affect PED. No backfill or recording changes.
- `convex/lib/roleCapabilities.ts`, `convex/lib/auth.ts` (read-only): reuse existing admin authorization helper, rejecting anonymous role holders; source strings must be normalized before database get. `convex/learning.test.ts` is the convex-test fixture precedent.
- `src/lib/components/admin/AdminWorkspacePage.svelte`: presentation-only frame owns WorkspaceChrome and current-presentation AppNav/PageBar. Reuse unchanged; do not add a second navigation list.
- `src/lib/components/workspace/WorkspaceRail.svelte:119`: actual ADMIN_LINKS; add learning destination using existing icon/tone mechanics and existing privilege visibility.
- `src/routes/admin/usage/+page.svelte`: auth-gated query and range pattern; improve explicit errors/loading for this new route rather than copying its legacy heavy font weights.
- `src/routes/admin/adminWorkspaceRoutes.test.ts`: extend route list. `src/lib/components/admin/AdminWorkspacePage.component.test.ts` and `src/lib/test/*stub*`: real browser shell with transport fixtures. Route browser tests can mount the actual page with these aliases; never add sveltekit() to component config.
- `docs/system-map.md:359`: stale PED dead-end annotation should name the new persisted dashboard reader.
- Prior stories 1–7 are done. CAP-2 series have known silent caps, clock freshness and historical missing-data limits; this new query must expose its own bounds. CAP-4/7 admission/publication remains unchanged. Browser baseline command is already running with `.audit/story-8/component-baseline.log`. Preserve unrelated test-generated historical screenshots. Native ledger hash is recorded in `.audit/story-8/ledger-baseline.sha256`.

## Tasks & Acceptance

**Execution:**
- [x] `convex/schema.ts`, new `convex/learningHealth.ts`, optional new focused `convex/lib/rerankTelemetry.ts`: add bounded indexed operational storage, private recording and admin read queries, global PED/generation indexes. Use cap+1 detection and explicit partial flags for every bounded population/join. Define coverage as recorded observations, with earliest recorded timestamp and best-effort recording caveat, never deployment coverage.
- [x] `convex/ai/brain/retrieve.ts`: minimal telemetry hooks at existing terminal result paths; preserve all return and billing semantics. Record one outcome per logical invocation with duplicate protection if recording can retry, no prose/query payloads.
- [x] `convex/learningHealth.ts`: aggregate [start,end] windows from explicit validated finite bounds; 30/90-day UI uses a refreshed explicit clock. Show chronological PED samples (or clearly labelled daily sample means with counts), distinct reports and missingness. Join source usage and separately scaled judgments, null missing values, stable fallback identity and bounded coverage.
- [x] `convex/learningHealth.test.ts`, `convex/ai/brain/retrieve.test.ts` or new retrieval outcome test: cover every backend matrix row using real Convex storage/query APIs and actual retrieval paths at mocked external boundaries.
- [x] `src/routes/admin/learning/+page.svelte`, optional small `src/lib/components/admin/LearningSparkline.svelte`: implement shared-frame dashboard, 30/90 controls, simple accessible SVG, exact numeric summaries, source table, honest coverage and error/empty/loading/refresh states. Keep absent days visually missing; no fabricated zeros.
- [x] `src/lib/components/workspace/WorkspaceRail.svelte`, `src/routes/admin/adminWorkspaceRoutes.test.ts`, new `src/routes/admin/learning/LearningHealth.component.test.ts`: add and prove navigation, actual page interactions, query states and responsive browser matrix. Capture and inspect before/after screenshots in `.audit/story-8/`.
- [x] `convex/_generated/`: regenerate only via supported `npx convex codegen` with existing authorized configuration, never manual edits; codegen is documented by installed CLI as not modifying running deployment code. Do not expose credentials or run deployment commands.
- [x] `docs/system-map.md`, `.audit/story-8/decisions.tsv`, `.audit/story-8/evidence.md`: update stale reader map; retain append-only decisions, baseline/exact implementation revision, AC-to-test mapping, real command output and browser evidence. Preserve ledger hash. Commit reviewed story artifacts locally with story-8 named in message.

**Acceptance Criteria:**
- Given an authorized admin opens the actual learning route, when switching between 30 and 90 days by keyboard, then the queried bounds and visible measured PED/source/rerank evidence update together and the layout follows the existing admin frame.
- Given actual retrieval success/fallback/skip/search-error paths, when executed and recorded, then the dashboard queries report the approved denominator independently of billing and preserve retrieval behavior under recording failures.
- Given historical, empty, truncated or missing linked evidence, when the admin reads the page, then unavailable/partial data and observed coverage are explicit and no score or rate is fabricated.
- Given a non-admin or anonymous caller, when accessing route or direct metrics queries, then no learning metrics are exposed.
- Given the completed change, when canonical component tests, npm test, Svelte check and Convex typecheck run, then they pass and each matrix row has an executed passing test.

## Spec Change Log

## Review Triage Log

### 2026-09-05 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 1, medium 4, low 6)
- defer: 0
- reject: 6: (high 0, medium 1, low 5)
- addressed_findings:
  - `[high]` `[patch]` Bound full-document reads with a shared conservative byte budget and maximum-document headroom; enforced-limit tests reproduce the eager-read failure and prove partial success.
  - `[medium]` `[patch]` Expose oldest-first selection and actual loaded ranges for every main population.
  - `[low]` `[patch]` Distinguish unknown truncated PED intervals from confirmed unmeasured days.
  - `[low]` `[patch]` Label current associated judgments independently of the generation-start window and test later judgments.
  - `[medium]` `[patch]` Mark per-source candidate/review/source-metadata incompleteness separately from verified absence.
  - `[low]` `[patch]` Recover the first nonblank historical title for each stable source identity.
  - `[low]` `[patch]` Add visible token-colored 0% and 100% chart scale labels.
  - `[low]` `[patch]` Verify exact top-level, join, shared and passage caps do not falsely imply truncation.
  - `[low]` `[patch]` Verify live role revocation and sign-out remove metrics and subscriptions.
  - `[medium]` `[patch]` Test inclusive source cohort bounds and different 30/90-day populations.
  - `[medium]` `[patch]` Test sample-weighted source judgment means across unequal and unjudged generations.

All four independent layers completed. Duplicate byte-budget findings were counted once. The approved observational trend and current WorkspaceRail ownership remain preserved. The native ledger was neither edited nor staged. Full dispositions and evidence are in `.audit/story-8/review-triage.md` and `evidence.md`.


### 2026-09-05: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 1, low 8)
- defer: 0
- reject: 6: (high 0, medium 0, low 6)
- addressed_findings:
  - `[medium]` `[patch]` Gate metrics on settled administrator access; test stale/error/loading transitions and recovery with cached data.
  - `[low]` `[patch]` Describe oldest-created selection for capped candidate/report/review joins.
  - `[low]` `[patch]` Make the daily readings region keyboard accessible and prove vertical scrolling.
  - `[low]` `[patch]` Verify chart x positions and segments at non-midnight window boundaries.
  - `[low]` `[patch]` Prove horizontal keyboard scrolling reveals the narrow source table's last column.
  - `[low]` `[patch]` Use realistic byte-budget fixture values, including exhausted-budget observations.
  - `[low]` `[patch]` Identify earlier evidence checkpoints as historical.
  - `[low]` `[patch]` Link committed compressed logs and document decompression.
  - `[low]` `[patch]` Assert SVG heights for zero, intermediate and full-scale PED values.

All four review layers completed without an intent or spec repair loop. Dispositions are in `.audit/story-8/followup-review-triage.md`. This pass changed no deferred list or native ledger entry. Follow-up score: 3 × 1 + 8 = 11; recommendation remains true.

### 2026-09-05: Third review pass
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 0, low 9)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[low]` `[patch]` Distinguish historical entry identity from an unrecorded source ID.
  - `[low]` `[patch]` Describe unattributed rows as generation-associated judgments without an identified source.
  - `[low]` `[patch]` Label source generation and passage columns as loaded counts.
  - `[low]` `[patch]` Describe estimated budget consumed, including authorization allowance.
  - `[low]` `[patch]` Wrap long unbroken source titles and verify narrow browser containment.
  - `[low]` `[patch]` Verify mixed evidence populations consume one shared byte budget and leave later joins incomplete.
  - `[low]` `[patch]` Verify well-formed IDs from another table cannot supply source metadata.
  - `[low]` `[patch]` Verify capped candidate means select oldest-created scores with a reversed-order failing control.
  - `[low]` `[patch]` Complete the system map's rerank data flow and remove contradictory write-only descriptions.

All four layers completed. Dispositions are in `.audit/story-8/third-review-triage.md`. No intent or spec repair loop was needed. Existing deferred-work ledger content and status remain unchanged. Follow-up score: 9; recommendation true.

## Design Notes

Usage is observational association: one generation using a source counts once, even with many chunks/sections. Passage count is separate. Display candidate and report judgments separately with their native scales and denominators. The PED chart labels its sample aggregation rather than implying an outcome per unmeasured historical report. Telemetry reports only recorded terminal observations; an unknown or in-progress operation is neither a failure nor a completed sample.

## Verification

- `npm run test:component`: full canonical Chromium suite, before component edits and after; actual page/browser matrix passes, screenshots inspected.
- `npm test`: full nonbrowser suite passes, including actual retrieval and aggregation matrix cases.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: zero errors and warnings.
- `npx tsc -p convex/tsconfig.json --noEmit`: passes.
- `git diff --check`: passes.
- `shasum -a 256 -c .audit/story-8/ledger-baseline.sha256`: unchanged native ledger.

## Auto Run Result

Status: done

The existing `/admin/learning` implementation passed a fresh four-layer review. This pass clarified historical source identities, unattributed judgments, loaded counts and read-budget wording, contained long source titles, strengthened backend boundary/cohort tests, and completed the system-map data flow.

Files changed:
- `src/routes/admin/learning/+page.svelte`: precise evidence labels and long-title wrapping.
- `src/routes/admin/learning/LearningHealth.component.test.ts`: three actual-page regression cases covering five UI findings.
- `convex/learningHealth.test.ts`, `convex/learningHealthBytes.test.ts`: wrong-table identity, oldest-created cohort selection and mixed byte-budget regressions.
- `docs/system-map.md`: rerank producer/storage/reader edges and corrected measurement descriptions.
- `.audit/story-8/`: third-review dispositions, command logs, screenshots, restoration hashes, append-only decisions and verification evidence.
- This story: review triage and terminal result.

Review: 9 patches (high 0, medium 0, low 9), 0 deferred, 5 rejected. Follow-up review recommended: true; score = 9. No intent/spec repair loop.

Verification: final full suites passed 152 files / 1,955 nonbrowser tests and 60 files / 451 browser tests. Svelte check returned zero errors/warnings and Convex typecheck exited 0. Three new browser cases failed against the prior page and passed after patching. Reversing the real candidate query made the new cohort test fail; restoring the exact production query made it pass. Screenshots were inspected. Whitespace and original ledger checksum checks passed. Exact outputs and AC evidence are in `.audit/story-8/evidence.md`.

Residual limits: telemetry is prospective and best-effort; bounded source associations do not establish causality. Local fixtures do not establish deployed end-to-end behavior. Existing deferred-work ledger content and status remain untouched. Local completion does not establish native run acceptance. No push or deployment.
