---
title: 'Blocking QA policy'
type: 'feature'
created: '2026-09-04'
status: 'in-review'
baseline_revision: '0dd0d6bd98c28e54107ae10fe06a90fd83c6dab2'
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


### 2026-09-04: Fresh review pass
- intent_gap: 0
- bad_spec: 0
- patch: 8: (high 3, medium 4, low 1)
- defer: 0
- reject: 6: (high 0, medium 5, low 1)
- addressed_findings:
  - `[high]` `[patch]` Recognize punctuation in section-heading subtitles so section 242 remains visible to the gate.
  - `[high]` `[patch]` Preserve uncertainty prose when the section 242 heading is renamed or removed while later headings remain.
  - `[high]` `[patch]` Normalize whitespace-only legacy blank lines so unrelated explanations cannot satisfy another paragraph's uncertainty.
  - `[medium]` `[patch]` Traverse rich-text containers while retaining paragraph and heading boundaries.
  - `[medium]` `[patch]` Settle stale QA attempts with an attempt-identity fence so retries recover without overwriting newer results.
  - `[medium]` `[patch]` Delete orphaned findings through bounded cleanup after authorized project deletion.
  - `[medium]` `[patch]` Add a runtime fence proving iterative QA receives all three current canonical sections and their exact reference.
  - `[low]` `[patch]` Remove an unused findings index.

The intent audit confirms the exact-evidence interpretation already recorded above: changed content receives deterministic reevaluation without requiring a fresh AI assessment; identical content cannot waive an established methodology failure. No existing deferred item or ledger status is changed.


### 2026-09-04: Second fresh review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 2, medium 2, low 0)
- defer: 0
- reject: 7: (high 0, medium 7, low 0)
- addressed_findings:
  - `[high]` `[patch]` Section labels could consume recognized uncertainty prose, including unpunctuated legacy labels and rich-text subtitles. Reuse the existing detector to preserve these statements as body prose.
  - `[high]` `[patch]` Split text nodes in code blocks broke uncertainty markers. Preserve inline cohesion for supported code blocks.
  - `[medium]` `[patch]` Punctuated legacy work labels were not recognized and incorrectly exposed section 244 prose to section 242 QA. Accept punctuation on established legacy labels while retaining substantive prose and cross-reference sentences.
  - `[medium]` `[patch]` Add candidate-selection coverage proving invalid stored scorecards cannot create methodology rows or block readiness and publishing.

The existing exact-content interpretation and existing deferred entries remain unchanged. Four gate failures were reproduced on the entry source before extraction repairs; a cross-reference regression in the initial repair was also reproduced and fixed. The invalid-scorecard case already passed and now guards that accepted behavior.

### 2026-09-04: Verification repair review
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 0, medium 0, low 9)
- defer: 0
- reject: 2: (high 0, medium 0, low 2)
- addressed_findings:
  - `[low]` `[patch]` Distinguish original implementation and repair-entry baselines.
  - `[low]` `[patch]` Describe host contention as a hypothesis rather than proven causation.
  - `[low]` `[patch]` Disclose the missing timestamp for the earlier load sample.
  - `[low]` `[patch]` Disclose that supplied feedback does not identify its exact source revision.
  - `[low]` `[patch]` Preserve the previous Auto Run Result as explicitly historical.
  - `[low]` `[patch]` Record scheduling provenance and the explicit slot-grant condition.
  - `[low]` `[patch]` Record a bounded diagnostic next step if the granted-slot gate times out again.
  - `[low]` `[patch]` Link to the repository-local retained failure artifact.
  - `[low]` `[patch]` Identify uploader harnesses as unreached in the failed gate.

All four review layers completed. Edge-case and verification-gap reviewers reported no findings. Intent review confirms this pass records diagnosis and a temporary hold; it does not yet establish successful native verification. Follow-up recommendation is true from nine low patches (score 9). Full verification remains pending under the operator scheduling instruction.

## Design Notes

Known methodology failures are carried to a new revision only when the same report has exactly the same content hash; this prevents no-op saves and restores from acting as waivers. Section identity participates in finding deduplication.

An open row is evidence of an unresolved failure for its exact content revision. Rows need no human-resolvable status: correcting content produces a new revision; retries may add newly found failures but must not waive an existing failure without a content correction. Deterministic boundary evaluation protects old/imported content while new writes persist their findings. No absence-of-QA blocker is introduced by this story.

## Verification

The following command results are historical implementation verification, as retained in the entry Git version. Current repair verification is pending below.

**Commands:**
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: all pass, including every matrix row.
- `npm test`: full suite passes.
- `PUBLIC_CONVEX_URL=placeholder npm run check`: no errors.
- `npx tsc -p convex/tsconfig.json --noEmit`: no errors.
- `git diff --name-only -- src/`: empty.


## Verification Repair Context

Repair-entry canonical baseline and workflow `baseline_revision`: `0dd0d6bd98c28e54107ae10fe06a90fd83c6dab2`. Original implementation baseline: `f122b086d745acc40b4decca26b9aaafc7257f6a`.

Resume repair requested after deterministic verification failed. Evidence: [retained native failure feedback](../../../../../../.audit/CAP-8/verification-repair-failed-feedback.md). The failed run's exact source revision is unknown from that feedback. The full gate timed out in the form-control source scan at 46,638ms against a 30,000ms limit; 128 other test files passed. The uploader harnesses were not reached because `npm test` failed under the gate's `set -e`. Repair verification reliability without modifying the frozen intent contract or src/.

Scheduling provenance: operator message on 2026-09-04. Full-suite and full type checks remain held until the operator grants the verification slot. Current status: in-review, verification pending. Review proceeds during this temporary hold; verification is not waived. Observed high host load supports a contention hypothesis, not a confirmed cause of the timeout. No timeout increase is justified solely by that hypothesis.

Next step: on explicit slot grant, run `bash scripts/loop-verify.sh` and preserve native evidence. If the timeout recurs, diagnose the targeted scan with contemporaneous host metrics before choosing a repair.

Targeted diagnostic: `npx vitest run src/lib/components/ui/formControlContract.test.ts --maxWorkers=1` exited 0, three tests passed in 12.63s with unchanged timeout and assertions. [Native log](../../../../../../.audit/CAP-8/verification-repair-targeted.log). Full native verification remains pending the scheduling slot.

## Historical Auto Run Result

The following result is retained verbatim from the repair-entry Git version (`0dd0d6bd98c28e54107ae10fe06a90fd83c6dab2`). Its done status describes the earlier implementation run, not this pending verification repair.

Status: done

The current-report QA gate retains the absolute because/methodology policy. This review repaired section extraction so recognized uncertainty cannot disappear inside heading labels or split code-block text, and punctuated legacy work labels remain separate from uncertainty without treating cross-reference sentences as boundaries. Candidate-selection coverage proves invalid stored scorecards do not become blocking methodology evidence.

Files changed in this pass:
- `convex/lib/tiptapReport.ts`: preserve recognized statements and code-block inline text; distinguish established punctuated legacy labels from prose.
- `convex/qaBlocking.test.ts`: six runtime regression cases exercise persistence, readiness, publishing, and candidate selection.
- `.audit/CAP-8/decisions.tsv`, `.audit/CAP-8/evidence.md`, and second-review logs: append decisions, before/after failures, and verification evidence.
- This story spec: record triage and completed verification.

Review: 4 patches (2 high, 2 medium, 0 low); 0 new deferrals; 7 rejected findings. Follow-up review recommended: true, because high findings were patched; weighted medium/low score is 6. Existing ledger entries and the existing story deferral were preserved exactly.

Verification:
- Focused QA, projects, and extraction suites: 152 tests passed in four files.
- `bash scripts/loop-verify.sh`: exit 0; 129 test files and 1,414 tests passed; both type checks passed; PowerShell 50/50 and Bash 18/18 harness cases passed.
- Repeated against final source: `npx tsc -p convex/tsconfig.json --noEmit` exited 0; `PUBLIC_CONVEX_URL=placeholder npm run check` exited 0 with no errors or warnings.
- `git diff --check`: passed; no baseline-relative frontend or generated Convex changes.

Residual limits: the existing sentence-level uncertainty detector and exact-content methodology evidence policy remain as specified. No new linguistic classifier or fresh-AI-pass requirement was introduced.

## Auto Run Result

Status: in-review
Blocking condition: operator verification slot pending.

Targeted diagnosis and all four BMAD review layers are complete. No product code, test assertions, timeout or concurrency settings changed. The frozen intent and existing deferral match the repair-entry revision exactly.

Files changed: this story records the pending repair and review; `.audit/CAP-8/evidence.md` and `decisions.tsv` retain diagnosis and decisions; `verification-repair-failed-feedback.md` preserves operator feedback verbatim; targeted and host logs retain native observations. The new audit artifacts are currently ignored by Git and must be explicitly included during finalization after successful verification.

Review: nine low audit-clarity patches, zero deferrals, two rejected findings. Follow-up review recommended: true (0 high, 0 medium, 9 low; score 9).

Verification: the isolated source-contract file passed all three tests in 12.63s using one worker and the existing timeout; `git diff --check` passed; frozen-intent and deferral comparisons passed; product/test/config diff was empty. The original failure artifact matches supplied feedback byte for byte.

Required remaining work: after explicit slot grant, run `bash scripts/loop-verify.sh` and the spec-focused command, record outcomes, then finalize and commit locally. Full-suite and full type checks have not been launched during this repair. No verification requirement is waived. If the native gate times out again, perform targeted diagnosis with contemporaneous metrics before choosing any repair.
