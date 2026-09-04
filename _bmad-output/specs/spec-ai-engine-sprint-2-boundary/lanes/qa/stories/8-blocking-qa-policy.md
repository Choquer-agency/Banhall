---
title: 'Blocking QA policy'
type: 'feature'
created: '2026-09-04'
status: 'done'
baseline_revision: 'f122b086d745acc40b4decca26b9aaafc7257f6a'
review_loop_iteration: 0
followup_review_recommended: true
context: ['{project-root}/convex/_generated/ai/guidelines.md', '{project-root}/.factory/AGENTS.factory.md']
warnings: ['oversized']
deferred:
  - summary: >-
      The existing because detector treats multiple recognized uncertainties in one sentence as one statement.
    evidence: |-
      Baseline f122b086d745acc40b4decca26b9aaafc7257f6a convex/ai/qaChecks.ts uses uncertaintyMarkers.some and one /because/i check per sentence. One because clause can therefore satisfy another uncertainty in the same sentence. The new gate reuses that existing detector rather than adding a linguistic classifier.
    location: >-
      convex/ai/qaChecks.ts:93
    severity: medium
---

<intent-contract>

## Intent

**Problem:** QA results are advisory JSON; an unresolved substantive QA failure does not block filing readiness or client publishing. CAP-8 requires persistent findings and an absolute, non-waivable gate on the current report revision.

**Approach:** Persist deterministic findings and explicit CRA methodology failures as report-bound rows. Share the current-content QA blocker evaluation between filing readiness and publish. Human edits are the only route to fixing the underlying content; no waiver, feedback, score, or role bypass clears blocking findings.

## Boundaries & Constraints

**Always:**
- The user's 2026-09-04 resolution is absolute, including manager/admin and writer `reportSkeleton` overrides. Record this approved amendment in `docs/product-domain.md`, superseding only the conflicting blocking-QA portion of the 2026-09-01 skeleton amendment.
- `because_clause` findings block regardless of style overrides. Detect the existing uncertainty markers throughout section 242, independent of paragraph position, so a custom skeleton does not evade the substantive check.
- CRA methodology means explicit false `cra_compliance.why_how_why_intact` or `cra_compliance.uncertainties_distinguished` in the existing validated QA scorecard; persist these as `cra_methodology` blocking findings. Do not classify freeform issue text with heuristics. Missing compliance data is not itself a failure.
- House-style `cra_opener`/`verbiage_present`, banned words and repetition remain advisory and retain existing style waivers.
- Findings are pinned to report id, revision number (legacy default 0), and actual content hash. Findings for old revisions or other reports cannot block the current one. Delayed QA must never attach old results to newly edited content.
- Persist deterministic rows on report creation/content writes and QA storage using a shared service; evaluate current deterministic content at the readiness/publish boundary too, so legacy rows without stored QA cannot bypass a detected failure. No backfill job.
- Existing public API paths and required argument shapes remain stable; new fields on existing tables/args are optional. New tables are additive. No generated file edits.
- Existing capability checks run before the publish gate. Publish adds only the QA gate, not all filing prerequisites. Rejection must make no publish/status writes.

**Block If:** Implementation reveals an unresolved product-policy decision beyond the absolute rule and the categories defined above.

**Never:** No waiver mutation, no feedback-as-resolution, no AI prose mutation, no changes to human workflow stages/ownership. Do not restyle or modify QA rail/components. Do not edit protected learn/chat epic files (`convex/learning.ts`, `convex/ai/learning.ts`, `convex/brain.ts`, chat components, admin brain routes). No new linguistic methodology detector and no requirement for an AI QA pass where none existed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Because failure | Current report contains a recognized uncertainty statement lacking because, with any style overrides | Persisted blocking because row; readiness contains QA_BLOCKING; publish refuses without writes | QA_BLOCKING |
| CRA methodology | Current report has validated QA with either substantive compliance flag false | Persisted blocking cra_methodology row; readiness and publish blocked | QA_BLOCKING |
| Advisory only | Only style findings or false verbiage_present, no substantive failures | Findings do not add QA_BLOCKING; otherwise-authorized publish succeeds | Existing unrelated readiness blockers retained |
| Waiver attempt | reportSkeleton/all style waivers, manager/admin, or dismissed QA feedback | Substantive failures still block; no mutation for waiver | QA_BLOCKING |
| Human correction | Report is edited to remove the defect and revision changes | Old finding stays historical; current deterministic findings reflect new content; old AI finding cannot block corrected revision | Existing edit authorization/OCC retained |
| Late QA | QA starts on revision N, human saves N+1, old QA completes | No N finding is labeled N+1 or blocks N+1 | Stale completion ignored or retained only as historical |
| Legacy/no rows | Legacy current report has no hash/revision/QA rows, but a detectable because failure | Readiness and publish still detect the current failure | QA_BLOCKING |
| Other report | Finding belongs to a different report or different content at the same revision number | Does not affect requested report | Existing cross-project publish rejection retained |
| QA retry | Same report revision is scored again | No duplicate active finding accumulation; same-revision blocking result cannot be waived by feedback or a later passing score | No error expected |

</intent-contract>

## Code Map

- `vitest.config.ts`: use a 30-second timeout for source-contract tests that parse the complete Svelte tree, matching the existing backend timeout under worktree load, and cap workers at two to reduce contention in timing-sensitive tests; assertions stay unchanged.

- `tsconfig.json`: explicit include paths preserve the generated Svelte file set and add shared modules; Vite 8 failed to resolve inherited include paths for shared/frontend tests in this worktree.

- `convex/ai/qaChecks.ts:205-294`: `SectionFinding`, `sectionDeterministicFindings`; existing checks because_clause, cra_opener, banned_word, repetition, dash_connector. `checkBecauseClauses:87` scans P5 only; `runDeterministicChecks:301` currently waives because under reportSkeleton. Reuse detector and expose blocking classification.
- `convex/lib/tiptapReport.ts`: canonical heading-based Tiptap assembly. `convex/lib/reportEdits.ts`: plaintext extraction. Add/reuse a safe section extractor for current report content, preserving paragraph boundaries and marked inline text; support legacy plaintext without silently dropping recognized uncertainty statements.
- New `convex/lib/qaFindings.ts`: shared pure classification/read gate and transactional persistence mechanics; no Node runtime. `convex/schema.ts`: new indexed findings table; keep immutable identity and bounded scans.
- `convex/lib/contracts.ts`: both domain error and filing blocker unions need QA_BLOCKING. `convex/lib/auth.ts:142`: getFilingReadiness aggregates blockers; preserve unrelated prerequisites. `convex/projects.ts:1021`: publishForReview currently patches immediately after capability and report ownership checks.
- `convex/generations.ts:1000+`: createGeneratedReportArtifacts creates candidate/direct canonical reports; candidate agentOutputs contains initial QA. `:1437` completeSectionRun stores draft QA JSON (draft findings cannot be mistaken for canonical report findings). `:1606` getPostQaInput currently reads frozen generation sections, must use current report sections and return exact report/revision/hash. `:1717` saveReportQa needs optional captured ref and must reject stale attribution; legacy calls without ref must not attach old methodology to new content. `:2120` ghost report creation/final assembly also needs deterministic persistence.
- `convex/ai/postQa.ts`: pass captured ref from QA input to save. `shared/qaScorecard.ts`: runtime validation for scorecard. `convex/ai/qaAgent.ts`: explicit compliance fields. `convex/ai/prompts.ts:550+`: remove advisory-waiver wording for substantive methodology in QA prompt only; keep house-style architecture waivers. Update corresponding prompt test with reason: user's absolute CAP-8 resolution.
- Canonical content writers: `convex/reports.ts:updateReportContent`, `convex/chatV2.ts:applyProposal/markProposalApplied`, `convex/comments.ts:acceptEdit`, `convex/snapshots.ts:restoreSnapshot`, `convex/projects.ts` report copy, `convex/generations.ts` creation/assembly. Call shared deterministic persistence after canonical writes in the same transaction, without changing prose/auth/snapshot behavior.
- Existing fences: `convex/ai/qaChecks.test.ts`, `convex/projects.test.ts`, generation/post-QA tests located by symbol. Add `convex/qaBlocking.test.ts` for end-to-end persistence/readiness/publish/edit/race cases using convex-test.
- Cross-story constraints: snapshots are centralized in `writePreEditSnapshot`; CAP-7 reviewDecisions and shared transition logic remain untouched; trusted-context and prompt-boundary suites must remain green.

## Tasks & Acceptance

**Execution:**
- [x] `tsconfig.json`: preserve the generated Svelte include set explicitly and include shared modules so the required Vite test gate can execute.
- [x] `docs/product-domain.md`: record the narrow approved absolute-QA amendment before behavior changes.
- [x] `convex/ai/qaChecks.ts`, `convex/ai/prompts.ts`, related tests: enforce non-waivable because/methodology with unchanged style-waiver behavior.
- [x] `convex/schema.ts`, `convex/lib/qaFindings.ts`, section extraction helper: add report-revision findings persistence, exact-content identity and shared blocker service; retain historical findings and deduplicate retries.
- [x] Canonical writers listed in Code Map, `convex/generations.ts`, `convex/ai/postQa.ts`: persist deterministic findings, use current content for QA and fence completion; persist explicit initial candidate methodology and later QA failures.
- [x] `convex/lib/contracts.ts`, `convex/lib/auth.ts`, `convex/projects.ts`: typed QA_BLOCKING in readiness and pre-write publish gate.
- [x] `convex/ai/qaChecks.test.ts`, `convex/projects.test.ts`, `convex/qaBlocking.test.ts` and affected generation tests: cover every matrix row through real registered mutation/query boundaries, not source-text matching.
- [x] `.audit/CAP-8/decisions.tsv`, `.audit/CAP-8/evidence.md`: append decisions and acceptance-to-test evidence with exact canonical baseline revision and actual command tails.

**Acceptance Criteria:**
- Given generated or human-edited canonical content, when QA detects a deterministic finding, then database rows expose its check, blocking flag and exact report identity without relying on an AI echo of the check.
- Given an open blocking finding on the current report revision, when callers query readiness or publish, then readiness reports QA_BLOCKING and publish throws that typed code with project state unchanged.
- Given stale, advisory, or foreign findings, when the current report is evaluated, then they do not add QA_BLOCKING; existing authorization and filing prerequisites continue to work.
- Given the completed change, when full tests and type checks run, then they pass and `src/` has no changes.

## Spec Change Log

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 2, medium 6, low 3)
- defer: 1: (high 0, medium 1, low 0)
- reject: 7: (high 0, medium 3, low 4)
- addressed_findings:
  - `[high]` `[patch]` Heading-like body paragraphs could hide blocking uncertainty text. Preserve Tiptap node kinds and prove rejection through readiness/publish.
  - `[medium]` `[patch]` Generated title/preamble entered section 242 QA. Exclude preamble when real section headings are present.
  - `[medium]` `[patch]` Single-newline legacy section headers were not split correctly. Parse standalone heading lines independently of paragraph separation.
  - `[low]` `[patch]` Empty valid Tiptap documents became raw JSON QA text. Preserve empty sections and return no post-QA input in both generation modes.
  - `[high]` `[patch]` No-op saves could lose a methodology blocker by advancing revision. Carry known same-report/same-hash failures onto the new reference, including restores; add mutation-level gates.
  - `[medium]` `[patch]` Alternate content writers lacked durable-row fences. Add exact-reference persistence assertions for proposal apply, stepped apply, accepted comments, restoration, project copy, and iterative assembly.
  - `[low]` `[patch]` Identical advisory findings in different sections collapsed. Persist section identity and include it in retry deduplication.
  - `[medium]` `[patch]` Skeleton-waiver QA prose could excuse missing substantive content. Clarify the distinction between waived position and mandatory substance.
  - `[low]` `[patch]` A detector test name still implied a five-paragraph minimum. Rename it and add short-section pass/fail cases.
  - `[medium]` `[patch]` Direct storage tests could not detect a missing capturedRef in the post-QA action. Test a provider false flag through runReportQa, persisted findings, readiness, and publish.
  - `[medium]` `[patch]` The first legacy parser repair split soft line wraps into separate paragraphs. Preserve wrapped body text and add a regression case.

Review interpretation: CAP-8 explicitly scopes stored blockers to the current report revision, so it does not mandate a fresh AI assessment after every change. Exact unchanged content still retains established failures. The two existing structured substantive compliance flags provide the machine-readable methodology surface; freeform issue-text classification was not invented. Read-side display remains optional. Ghost output is a snapshot; canonical iterative assembly already uses the shared creation helper. Tooling changes were needed to execute the required gate. Interim status/evidence observations are completed during finalization.


## Design Notes

Known methodology failures are carried to a new revision only when the same report has exactly the same content hash; this prevents no-op saves and restores from acting as waivers. Section identity participates in finding deduplication.

An open row is evidence of an unresolved failure for its exact content revision. Rows need no human-resolvable status: correcting content produces a new revision; retries may add newly found failures but must not waive an existing failure without a content correction. Deterministic boundary evaluation protects old/imported content while new writes persist their findings. No absence-of-QA blocker is introduced by this story.

## Verification

**Commands:**
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: all pass, including every matrix row.
- `npm test`: full suite passes.
- `PUBLIC_CONVEX_URL=placeholder npm run check`: no errors.
- `npx tsc -p convex/tsconfig.json --noEmit`: no errors.
- `git diff --name-only -- src/`: empty.

## Auto Run Result

Status: done

### Implemented change

Blocking QA is persisted and enforced at current-revision filing readiness and client publish with `QA_BLOCKING`. Because findings ignore writer waivers; the existing structured substantive methodology failures are also blocking. Known failures survive byte-identical saves/restores. Current-content QA uses a captured report/revision/hash, so late completion cannot relabel an edited report. Findings retain section identity, and the QA rail is unchanged.

### Files changed

- `convex/ai/qaChecks.ts`: non-waivable because checks across section 242 paragraphs.
- `convex/ai/prompts.ts`: substantive methodology remains mandatory under custom skeletons.
- `convex/lib/qaFindings.ts`: indexed persistence, retry identity, exact-content carry, and shared blocking evaluation.
- `convex/lib/tiptapReport.ts`: safe current-section extraction for Tiptap and legacy text.
- `convex/schema.ts`: additive findings table with exact-reference indexes.
- `convex/lib/contracts.ts`: typed QA_BLOCKING codes.
- `convex/lib/auth.ts`: filing-readiness blocker.
- `convex/projects.ts`: pre-write publish gate and copied-report persistence.
- `convex/reports.ts`, `convex/chatV2.ts`, `convex/comments.ts`, `convex/snapshots.ts`: transactional findings on human content writes.
- `convex/generations.ts`: canonical creation persistence and captured current-content QA input/storage.
- `convex/ai/postQa.ts`: captured reference forwarded through action completion.
- `convex/qaBlocking.test.ts`: persistence, publish, revision, waiver, parser, copy and alternate-writer regressions.
- `convex/generationAttribution.test.ts`: real provider-to-gate and iterative-assembly persistence assertions.
- `convex/ai/qaChecks.test.ts`, `convex/ai/prompts.test.ts`, `convex/lib/tiptapReport.test.ts`: detector, prompt and extraction fences.
- `docs/product-domain.md`: approved absolute-QA amendment and compatibility notes.
- `tsconfig.json`, `vitest.config.ts`: explicit source includes and stable verification scheduling/timeouts for this worktree.
- This story and `.audit/CAP-8/`: completed tasks, decisions, acceptance mapping and retained runtime evidence.

### Review findings

Eleven patches applied: high 2, medium 6, low 3. One pre-existing detector limitation deferred; seven findings rejected. The Review Triage Log records the decisions. Follow-up review recommended: true, because two patches were high severity and the weighted score is 3 × 6 + 3 = 21.

### Verification

- `bash scripts/loop-verify.sh`: exit 0. Convex TypeScript passed; application check reported 0 errors and 0 warnings; `npm test` passed 128 files and 1393 tests; PowerShell uploader harness passed 50 cases; Bash uploader harness passed 18 cases.
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: 3 files, 129 tests passed after review fixes.
- Review-focused provider/extraction/persistence batch: 5 files, 123 tests passed. Final extraction/QA regression rerun: 2 files, 36 tests passed.
- `git diff --check`: clean. No changes under `src/` or `convex/_generated/`.
- Evidence: `.audit/CAP-8/evidence.md`, `.audit/CAP-8/gate-reviewed.log`, `.audit/CAP-8/decisions.tsv`.

### Residual risks

The existing detector treats multiple recognized uncertainty clauses in one sentence as one statement and can consider one because clause sufficient; recorded in `deferred`. Methodology findings rely on the two explicit validated compliance flags, not a new freeform-text classifier. A fresh AI assessment after every changed revision is not required by this story; exact unchanged content retains its known findings.
