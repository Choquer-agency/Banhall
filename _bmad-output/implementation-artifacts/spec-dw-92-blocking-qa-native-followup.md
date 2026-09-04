---
title: 'DW-92 blocking QA native follow-up'
type: 'chore'
created: '2026-09-04'
status: 'done'
baseline_revision: '9da55bece5948da12129720dd2330a3032c985bf'
review_loop_iteration: 0
followup_review_recommended: true
context: ['{project-root}/convex/_generated/ai/guidelines.md', '{project-root}/.factory/AGENTS.factory.md']
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** The previous QA follow-up crashed before native review acceptance because discovery bound an unrelated result spec. Preserved repairs and old green gates do not resolve DW-92.

**Approach:** Independently review the original blocking-QA implementation and all subsequent repairs, fix verified in-scope defects, and produce fresh ordinary verification and review evidence. Use this flat follow-up spec as the sole new RESULT artifact and emit the normal workflow Auto Run Result here.

## Boundaries & Constraints

**Always:** Treat `_bmad-output/specs/spec-ai-engine-sprint-2-boundary/lanes/qa/stories/8-blocking-qa-policy.md` and its frozen contract, original implementation baseline `f122b086d745acc40b4decca26b9aaafc7257f6a`, existing deferral and prior review history as authoritative context. Retain that file unchanged. Review core implementation and repairs including `f1a61c44f80268df68b5ebd29bc848eee23490a2` and `a62e1760a9931c9451c34baa2df8af29fa1e9538`. Capture this follow-up baseline normally. Commit genuine new review and command evidence, explicitly staging ignored audit artifacts. Honor the approved absolute QA amendment in `docs/product-domain.md:1605`: non-waivable because/methodology findings block current-reference readiness and publish, with atomic rejection; style remains advisory. Preserve the exact-content policy and sentence-level detector limitations already accepted by the original contract. Native final acceptance remains an orchestrator operation after this worker result.

**Block If:** A verified defect requires a new product-policy decision outside the original contract, or mandatory native review/verification cannot be completed.

**Never:** Edit the deferred-work ledger, native control state, integration checkout, old crashed/deferred runs, the original nested spec, frontend/QA rail, generated Convex files, protected learn/chat epic files, or outstanding product choices. Do not synthesize receipts, bind another spec, infer acceptance from old evidence, add a linguistic classifier or mandatory fresh AI pass, or use test-timeout CLI overrides. Do not push, open a PR, or deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Current substantive failure | Recognized section 242 uncertainty without because, or validated explicit false methodology flag | Exact report/revision/hash findings; readiness and publish blocked even with style waivers | QA_BLOCKING before writes |
| Noncurrent or advisory evidence | Old revision, foreign report/hash, style-only findings, absent compliance | No added substantive blocker; existing authorization preserved | Existing domain errors |
| Human correction and retry | Changed content, identical-content save/restore, delayed QA or passing retry | Reevaluate changed content; retain established same-content failures; stale results never relabeled | Stale completion fenced |
| Follow-up completion | Historical acceptance absent | Fresh reviews, ordinary gates and committed evidence; flat native result marker | Block with concrete evidence if required work cannot finish |

</intent-contract>

## Code Map

- Original nested QA spec above: complete frozen matrix, prior triage, implementation baseline and deferral. `.audit/sweep-spec-recovery/operator-recovery.md` and `report.md`: authoritative recovery routing; old `.audit/CAP-8/` and `.audit/DW-92/` are historical evidence only.
- `convex/lib/qaFindings.ts`: report reference, deterministic/methodology persistence, deduplication, same-content carry-forward and current-content gate. `convex/schema.ts` and `convex/lib/contracts.ts`: additive table and typed QA_BLOCKING.
- `convex/lib/tiptapReport.ts`: rich-text/legacy extraction and three preserved DW-92 repairs. `convex/ai/qaChecks.ts`, `convex/ai/prompts.ts`: detector and substantive policy.
- Canonical persistence: `convex/reports.ts:72`, `convex/comments.ts:197`, `convex/chatV2.ts:518,615`, `convex/snapshots.ts:314`, `convex/projects.ts:934`, `convex/generations.ts:1041`. Review only original QA responsibilities; no unrelated refactors.
- `convex/generations.ts:1641`, `convex/ai/postQa.ts:157`: current input, captured identity and stale-attempt fence. `convex/lib/auth.ts:140`, `convex/projects.ts:1047`: readiness and publish boundaries.
- `convex/qaBlocking.test.ts`, `convex/qaFindingsCleanup.test.ts`, `convex/generationAttribution.test.ts`, generation lifecycle tests, extraction/detector/projects tests: registered boundary and pure regression coverage.
- QA history: `b13d5ce9f93fe00ad0d02e15294954a20961b69d`, `5b2bed6a0f129af3c9799f8bc80e0fa3ec1e3a01`, `40d34059ae38b891023681ac00989d040f9fc973`, then the two DW-92 commits above. Baseline-to-current diff also includes unrelated integrated stories, which are context rather than new follow-up scope.
- `scripts/loop-verify.sh`: ordinary gate. `.audit/DW-92-native-followup/`: new decision trail, review reports, provenance, preservation proof and raw command logs.

## Tasks & Acceptance

**Execution:**
- [x] `.audit/DW-92-native-followup/`: record exact follow-up and historical revisions, independently inspect full QA implementation and repairs, record review evidence and triage.
- [x] QA files in Code Map: reproduce and repair any verified in-scope defects with registered-boundary regression tests; otherwise preserve product source.
- [x] `.audit/DW-92-native-followup/evidence.md`: map the frozen QA matrix to fresh runtime proofs; run ordinary required gates and preserve actual output, plus original spec/ledger/frontend/generated preservation checks.
- [x] This flat spec: complete standard review, commit fresh evidence with explicit ignored-file staging, and emit genuine native Auto Run Result through normal workflow finalization.

**Acceptance Criteria:**
- Given the original QA implementation and later repairs, when independent reviewers inspect their full behavior and history, then every verified in-scope defect is repaired or a concrete blocker is recorded, with all original product boundaries preserved.
- Given current canonical content and the original QA matrix, when registered readiness, publish, content-write and QA boundaries run, then exact-reference persistence and non-waivable atomic enforcement satisfy the frozen contract.
- Given current code, when ordinary required gates run without timeout overrides, then full tests, both type checks and uploader harnesses pass with fresh retained output.
- Given completed review and verification, when this worker finalizes, then committed new evidence and the native Auto Run Result reside in this flat spec while original history, ledger, frontend, generated files and native control state are unchanged.

## Spec Change Log

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 5: (high 1, medium 2, low 2)
- defer: 0
- reject: 6: (high 0, medium 5, low 1)
- addressed_findings:
  - `[high]` `[patch]` Deeply nested valid report JSON overflowed recursive extraction and silently erased uncertainty. Replaced block/inline recursion with explicit stacks and narrowed the catch to JSON parsing; two registered boundary regressions reproduced baseline failure and now pass.
  - `[medium]` `[patch]` Iterative artifact style waivers lacked a runtime fence. Added canonical assembly coverage for advisory exclusion with substantive persistence; disabling the artifact lookup makes the test fail.
  - `[medium]` `[patch]` Atomic publish rejection lacked scheduler-state assertions. Shared registered-boundary helper now checks no scheduled-function changes as well as no project changes.
  - `[low]` `[patch]` Acceptance evidence lacked exact test identifiers. New evidence maps every frozen matrix row to executed test titles.
  - `[low]` `[patch]` Silent type-check success lacked explicit provenance. Final verification wrapper records commands, revision, diff/script hashes, timestamps, exit statuses and a separate explicit Convex tsc invocation.

All four independent review layers completed. Full historical QA implementation and subsequent repairs were reviewed as context. No new product decision or deferral; detailed independent finding evaluations are in `.audit/DW-92-native-followup/review.md`. Final repaired-source verification subsequently passed: ordinary gate 1732 tests, focused gate 147 tests, both type checks and uploader harnesses. Exact command provenance is retained in the audit manifest.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh`: Convex TypeScript, Svelte check, npm test and both uploader harnesses pass.
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: original exact focused gate passes.
- `git diff --check`: no whitespace errors.
- Compare original nested spec, ledger, `src/` and `convex/_generated/` against captured follow-up baseline: unchanged.

## Auto Run Result

Status: done

Fresh DW-92 worker review, repairs and ordinary verification are complete. The reviewed repair and audit evidence were committed as `df97838bd97ee68ea6a923c310b3d4ae139556e1` before this terminal write-back. This standard flat spec is the sole new RESULT artifact. Original nested QA contract, original implementation baseline, prior reviews and deferral remain unchanged; native orchestrator acceptance and ledger resolution remain subsequent orchestrator responsibilities.

Files changed:
- `convex/lib/tiptapReport.ts`: replace recursive block/text extraction with iterative traversal and catch only JSON parse errors, preventing deep valid content from silently losing uncertainty.
- `convex/qaBlocking.test.ts`: two deep-nesting registered-boundary regressions and assertions that rejected publishing leaves scheduled functions unchanged.
- `convex/generationAttribution.test.ts`: iterative canonical assembly proves artifact-sourced advisory waivers retain exact-reference substantive findings.
- `.audit/DW-92-native-followup/`: genuine new four-layer review, red/green logs, mutation proof, exact acceptance mapping, command/source provenance, preservation proof and cross-model trail audit, explicitly staged despite ignore rules.
- This flat spec: fresh baseline, review triage and native Auto Run Result.

Review: 5 patches (high 1, medium 2, low 2), 0 new deferrals, 6 rejected findings. Follow-up review recommended: true because a high finding was patched; medium/low score is 8. Independent repair inspection found no additional issues. Cross-model trail audit found two premature wording statements; both were corrected before evidence commit.

Verification on final repaired source:
- `bash scripts/loop-verify.sh`: exit 0; 148 files / 1732 tests; Svelte 0 errors and warnings; Convex TypeScript; PowerShell 50/50 and Bash 18/18.
- Exact original focused gate: exit 0; 147 tests in three files.
- Explicit `npx tsc -p convex/tsconfig.json --noEmit`: exit 0, recorded in final command manifest.
- Two deep-nesting cases failed on baseline, then passed with 91 targeted tests after repair. Disabling iterative artifact lookup made its new assertion fail; restoring original source made it pass. Final full gate ran all these tests without name filtering or timeout overrides.
- Protected-path preservation and staged whitespace checks passed; verified source hashes match final gate input.

Residual limits: original sentence-level uncertainty detection and exact-content methodology policy remain as specified. The PowerShell harness reports one platform-specific dotfile subcase skip. Local gates and this genuine worker result do not claim external native acceptance; no control state, old runs, integration checkout or deferred ledger was edited.
