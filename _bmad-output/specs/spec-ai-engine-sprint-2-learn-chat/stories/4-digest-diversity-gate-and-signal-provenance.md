---
title: 'Digest diversity gate and signal provenance'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: '8d00a441c61279fa8fdbcb0015db1d9e95880eec'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/docs/design-system.md'
  - '{project-root}/docs/svelte-migration.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/decisions/digest-diversity-policy-2026-09-04.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Firm-wide digests can currently derive from one producer or project and retain only aggregate input counts. Administrators cannot inspect exact inputs, producer contributions, or why generation skipped.

**Approach:** Apply the approved CAP-4 per-stream diversity policy before distillation. Save admitted provenance and exclusions with immutable candidates, retain skipped-run explanations separately, and display both on the admin reviews page.

## Boundaries & Constraints

**Always:** Apply existing meaningful-signal filters first. Exclude missing writer/project attribution, then independently require at least two distinct producers and two distinct projects in each stream. Omit failing streams without vetoing qualifying streams or pooling their diversity. Require at least five admitted records overall. Use precisely those admitted records for prompt payload, sourceCount, exact signal IDs, per-producer counts and freshness cutoff. An omitted-only change must not redistill unchanged admitted input. Attribute records to their producer, never project creator, owner, reviewer or a placeholder. Preserve original sources, immutable unpublished candidates, cutoff deduplication, compatibility freeze, privacy review, authorized separate admin publication and personal isolation. Keep attribution metadata out of provider payloads and use existing best-effort de-identification for client prose. Historical missing metadata is unavailable, never fabricated. Additional streams must reuse the same independent admission rule.

**Block If:** Implementation needs changes to project authority, report editing, publication permissions, or the epic's forbidden files. Any unresolved policy change must return blocked with evidence.

**Never:** Auto-publish, alter report prose, hand-edit generated APIs, backfill historical candidate metadata, delete excluded records, or edit `convex/ai/chatAgentV2.ts`, `convex/chatV2.ts`, `convex/ai/analyzerAgent.ts`, `convex/ai/pipeline.ts`, `convex/lib/auth.ts`, `convex/projectWorkflow.ts`, `convex/ai/qaChecks.ts`, or `convex/reports.ts`. Never manually author/change the native deferred-work ledger.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| One producer | Five eligible events, one writer, two projects | Stream omitted; no QA model call/candidate | Persist diversity exclusion explanation |
| One project | Five events, two writers, one project | Stream omitted | Same |
| Mixed streams | Six diverse comments plus one underdiverse edit | Only six comments affect prompt, sourceCount, provenance and cutoff | Report omitted edit |
| No pooling | Individually failing streams collectively span two writers/projects | All fail independently | Skip, preserve sources |
| Aggregate minimum | Four admitted records plus arbitrary omitted records | No model call/candidate | Persist below-minimum result |
| Shared minimum | Two qualifying streams, five total records | Distillation may save a candidate | Neither stream needs five individually |
| Missing attribution | Projectless approved feedback or legacy section event without writer | Exclude before diversity; no invented identity | Show missing writer/project counts |
| Omitted freshness | Only omitted records newer than last candidate | No model call; cutoff unchanged | Latest attempt still explains exclusions |
| Weak output | Diverse fresh inputs, model returns no supported rules | No candidate or publication change | Keep attempt outcome |
| Candidate history | New admitted candidate exists | Exact source IDs, per-producer counts and exclusions visible | Immutable snapshot |
| Empty/legacy UI | Skip-only data or historical digest lacking metadata | Skip visible even without candidates; legacy shows unavailable | No fabricated metadata |

</intent-contract>

## Code Map

- `convex/learning.ts:31-154`: five bounded signal queries currently strip attribution. Actual producer/project fields: `qaItemFeedback.userId/projectId`, `candidateScores.userId/projectId`, `sectionEditEvents.userId/projectId` (writer optional), `proposalWordingEditEvents.userId/projectId`, `brainFeedbackQueue.fromUserId/projectId` (project optional). Preserve approved-feedback audit approval timestamp fallback. Keep `_id`, attribution and timestamp separate from explicit prose payloads.
- `convex/ai/learning.ts:116,213`: QA and draft-style actions apply meaningful filters and five-row threshold, then newest-candidate cutoff freshness. Current maps remove only updatedAt: replacing with explicit payload projection is necessary to prevent metadata leakage.
- `convex/learning.ts:214`: `saveDigest` performs transactional cutoff dedupe and compatibility freeze; preserve both. `getDigestHistory` and `getDigestPublicationState` already guard admin access with settings.configure.
- `convex/schema.ts` learningDigests: optional metadata supports legacy rows. Separate latest-attempt table can retain skipped admission without creating a candidate. Keep reads bounded.
- `convex/lib/deidentify.ts`: existing pure helper takes project or null, preserves prose shape; apply on learning read side with per-query project cache. Prior CAP-1 only scrubbed proposal reads and section writes; read scrubbing protects the other current payloads and legacy sections while preserving sources.
- `src/routes/admin/reviews/+page.svelte:112`: top-level empty guard currently hides all learning UI when no digest/reviews; admit attempt-only data. Existing QA/style panels each have per-kind privacy checkbox and independent publication controls. Reuse in-page Svelte snippets for metadata if practical.
- `convex/learning.test.ts:452,548`: `anthropicToolResponse` plus stubbed fetch exercises actual internal actions and stores candidates in convex-test. Existing projectless single-writer approved-feedback fixture must become diverse project-linked input under the new contract.
- `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: actual browser page mount with Convex registry; extend for metadata, skip-only and legacy states while retaining privacy controls.
- Earlier stories: CAP-8 lifecycle fixtures and CAP-1 privacy protections are already committed. CAP-2 generated API repair was completed through real codegen. Do not reuse obsolete hand-edit guidance. Deferred ledgers remain orchestrator-owned.

## Tasks & Acceptance

**Execution:**
- `convex/lib/learningAdmission.ts`: add reusable typed per-stream admission mechanics and metadata validators/types. Model attribution independently from prompt payload; report unique omitted record counts and missing-writer/project/diversity reason counts with clear overlapping-reason semantics. Keep metadata bounded by existing source windows.
- `convex/schema.ts`: add optional candidate admission snapshot and a separate latest-attempt record per digest kind with timestamp, outcome and admission details. Index by kind; do not change selections or require metadata on legacy rows.
- `convex/learning.ts`: enrich the five signal queries with exact IDs/producer/project and explicitly separated sanitized payloads; reuse deidentify and project caching. Extend saveDigest to persist candidate admission and retain attempt results without changing publication semantics. Expose latest attempt to authorized administrators using the existing guarded publication-state query or a guarded new query in this module. Retain truthful outcomes for insufficient inputs, unchanged inputs, unsupported rules and saved/deduplicated candidates.
- `convex/ai/learning.ts`: feed all eligible streams through admission; derive every downstream artifact solely from admitted rows, apply freshness after admission, record attempts on early skip paths, and save immutable candidate snapshots only for supported rules. Use explicit payload projections and preserve prompt privacy/untrusted-data instructions.
- `src/routes/admin/reviews/+page.svelte`: render admitted source IDs, per-producer counts, excluded totals/reasons and latest skipped attempt for both kinds. Preserve privacy controls, make skip-only results reachable, render unavailable legacy metadata, and use type roles, semantic colors and max weight 500. No new input controls are needed.
- `convex/learning.test.ts`: cover every matrix case through actual actions/queries/mutations with only provider responses mocked. Inspect provider request content and database records, including exact identity/count/cutoff, source preservation, immutable selection, missing metadata compatibility and denied non-admin access. Update fixtures incompatible with the approved new policy without weakening unrelated assertions.
- `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: extend actual rendered-page tests for candidate details, skip-only empty state, both kinds, legacy unavailable, and retained privacy publication controls.
- `docs/product-domain.md`: record the already human-approved CAP-4 amendment, link its decision companion, and state admission/provenance semantics without introducing new permissions.
- `.audit/CAP-4-story-4/decisions.tsv` and `evidence.md`: retain append-only decisions, full canonical baseline/revisions, exact command output and AC mapping. Generated files may change only through supported codegen if required.

**Acceptance Criteria:**
- Given the matrix fixtures, when either actual digest action runs, then only independently qualifying streams can contribute and all skip/save results match the approved policy.
- Given a saved candidate, when an administrator opens its QA or style history, then exact admitted IDs, producer counts and exclusion reasons match stored input snapshots; global guidance stays selected until a separate privacy-confirmed admin publication.
- Given a generation that cannot save a candidate and no previous review/digest rows, when an admin opens reviews, then its exclusion explanation is visible without any candidate being fabricated.
- Given attribution metadata and omitted/private text, when the intercepted provider request is inspected, then metadata IDs and omitted records are absent and known project identifiers are scrubbed on a best-effort basis.
- Given historical digests without metadata or an unauthorized caller, when history/attempts are requested, then legacy metadata remains unavailable and non-admin callers cannot read internal admission data.
- Given the final patch, when backend tests, browser page tests and type/Svelte checks run, then all pass, forbidden files and native ledger bytes remain unchanged.

## Spec Change Log

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 4, low 3)
- defer: 0
- reject: 9: (high 0, medium 4, low 5)
- addressed_findings:
  - `[medium]` `[patch]` Assert exact admitted section/proposal payloads in the provider request. Both controlled empty-payload mutations now fail the test.
  - `[low]` `[patch]` Correct fixtures to use actual submitting user IDs and coherent per-project related records; assert a producer is aggregated once across comments and edits. Production writers already store users document IDs.
  - `[low]` `[patch]` Describe unchanged-input skips precisely as no admitted feedback newer than the candidate cutoff.
  - `[medium]` `[patch]` Collapse long signal and producer lists behind accessible disclosures while keeping counts and reasons visible.
  - `[medium]` `[patch]` Add backward-compatible argument-specific query fixtures and verify distinct QA/style panels cannot share each other's data.
  - `[medium]` `[patch]` Persist safe failed-attempt admission for provider and structured-output exceptions, then rethrow the original error. Both kinds preserve candidate/publication state.
  - `[low]` `[patch]` Clarify that displayed counts cover recent bounded windows after meaningful-signal filtering.

Four independent review layers completed. Nine findings were rejected after deduplication: current production identity mismatch was disproved by all three write sites; optional internal compatibility saves have no production generator omitting admission; per-signal attribution maps and version fingerprints exceed the requested exact IDs/counts; navigation convenience, policy versioning and a live authenticated integration environment are not required for this contract; latest-attempt retention satisfies the approved explanation requirement; actual retained command evidence resolves the diff-only workflow-evidence limitation. No native ledger entries were authored or changed.

### 2026-09-04: Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 3, low 1)
- defer: 0
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` Assert exact admitted QA provider payload fields and count.
  - `[medium]` `[patch]` Verify mixed attributable and unattributed rows within one stream preserve only valid admitted inputs.
  - `[medium]` `[patch]` Verify private admitted section/proposal prose is scrubbed across every payload field while original sources remain unchanged.
  - `[low]` `[patch]` Correct the verification commands to distinguish canonical browser startup failure from passing Chromium tests with the audit wrapper.

### 2026-09-04: Additional follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 3: (high 0, medium 2, low 1)
- defer: 0
- reject: 9
- addressed_findings:
  - `[medium]` `[patch]` Assert the complete ordered scoring provider payload, including six distinct sanitized comments, valid human scores and QA scores. A controlled one-record payload mutation fails the new assertion.
  - `[medium]` `[patch]` Use distinct admitted prose in QA, section, proposal and approved-feedback payload assertions so duplicate records cannot satisfy provenance verification.
  - `[low]` `[patch]` Retain exact commands and explicit exit codes alongside fresh verification logs, including silent TypeScript output.

Four independent review layers completed. No production changes or new deferrals were required. Existing deferred-work ledger entries remain untouched.

## Design Notes

Use one admission result as the source of truth. Candidate metadata is an immutable snapshot, while latest attempt information is operational and may update per kind. Keep total excluded records distinct from reason counters because a single missing-attribution record can lack both fields. Streams already removed by the existing meaningful filters need not become admitted signal or influence cutoffs. Preserve approved-feedback approval-time freshness. Provider payload contains only its existing prose/scoring fields, with no IDs or producer metadata.

## Verification

**Commands:**
- `npx vitest run convex/learning.test.ts`: all policy/action/storage cases pass.
- `npx vitest run --config vitest.component.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: canonical command fails during Rolldown dependency optimization before tests execute.
- `npx vitest run --config .audit/CAP-4-story-4/component-diagnostic.config.ts --no-file-parallelism src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: actual Chromium page metadata/skip/legacy/privacy cases pass using the isolated audit wrapper.
- `npx tsc -p convex/tsconfig.json --noEmit`: no errors.
- `PUBLIC_CONVEX_URL=https://example.convex.cloud npm run check`: zero errors/warnings.
- `npm test`: full non-browser suite passes. If host-load timeouts occur, retain failure and a command-local extended-timeout rerun without changing repository timeout policy.
- `git diff --check`: clean. Inspect complete diff and unchanged native ledger bytes before committing.

## Auto Run Result

Status: done

The implementation independently admits diverse streams, derives prompt and provenance from the same admitted records, preserves immutable unpublished candidates, and exposes candidate and latest-attempt explanations to administrators. This follow-up pass strengthens provider-payload regression tests; production behavior is unchanged.

Files changed across the reviewed baseline:
- `convex/lib/learningAdmission.ts`: reusable admission and provenance mechanics.
- `convex/learning.ts`, `convex/ai/learning.ts`, and `convex/schema.ts`: sanitized signal envelopes, independent admission, immutable snapshots and operational attempts.
- `src/routes/admin/reviews/+page.svelte`: administrator provenance and attempt inspection.
- `convex/learning.test.ts`: action, privacy, provenance and publication coverage; this pass adds distinct ordered payload proof across all five streams.
- `src/lib/test/convex-svelte-stub.svelte.ts` and `src/routes/admin/reviews/reviewsPublishGate.component.test.ts`: argument-specific page fixtures and browser coverage.
- `docs/product-domain.md`: approved CAP-4 policy amendment.
- This story and `.audit/CAP-4-story-4/`: review record, decisions, command exit codes, regression evidence and protected-file hashes.

Review: three patches (zero high, two medium, one low), zero deferred, nine rejected. Follow-up review recommended: true; patched score = 3 × 2 + 1 = 7.

Verification: 36 focused tests, 1870 tests across 148 non-browser files, and 11 actual Chromium page tests passed. Convex TypeScript passed; Svelte checks found zero errors/warnings. The canonical browser command reproduces the existing Rolldown startup failure before tests execute; the documented isolated audit wrapper passes. A controlled scoring-payload truncation fails the new assertion, and production bytes were restored exactly. Full commands and exit codes are retained in `.audit/CAP-4-story-4/rereview-commands.json`.

Residual risks: existing browser optimizer limitation, best-effort de-identification, bounded input windows and timestamp-based freshness remain. Forbidden files, generated APIs and existing native deferred-work ledger bytes are unchanged. Native final run acceptance remains the orchestrator's responsibility. No push or deployment was performed.
