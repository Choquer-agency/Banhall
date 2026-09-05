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

### 2026-09-04: Supplied-spec follow-up review
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 2, low 5)
- defer: 0
- reject: 5: (high 0, medium 3, low 2)
- addressed_findings:
  - `[low]` `[patch]` Clarified historical completion claims and restored the actual terminal result in this flat spec.
  - `[medium]` `[patch]` Require a unique terminal marker and consistent mandatory result fields.
  - `[low]` `[patch]` Include protected learn/chat source in preservation checks.
  - `[medium]` `[patch]` Detect untracked additions beneath protected paths.
  - `[low]` `[patch]` Bind retained raw command logs to SHA-256 digests.
  - `[low]` `[patch]` Execute final comparisons against verified source hashes and the entry commit.
  - `[low]` `[patch]` Use explicit verification failures that remain active under Python optimization.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh`: Convex TypeScript, Svelte check, npm test and both uploader harnesses pass.
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: original exact focused gate passes.
- `git diff --check`: no whitespace errors.
- Compare original nested spec, ledger, `src/` and `convex/_generated/` against captured follow-up baseline: unchanged.

## Auto Run Result

Status: done

Fresh four-layer review and ordinary verification completed against product-source commit `c94860f7e2bf37d863acc1446692fc622f236bc4`. No new product defect or product-policy decision was identified. Prior QA repairs remain unchanged. Historical audit claims are distinguished from this invocation's fresh command evidence and actual terminal marker.

Files changed:
- This flat spec: append current triage and the genuine worker result.
- `.audit/DW-92-native-followup/recheck/`: retain fresh review input, review triage, command logs/provenance, source and protected-file checks, and evidence.
- `.audit/DW-92-native-followup/decisions.tsv`: append this invocation's decisions.

Review: seven audit patches (high 0, medium 2, low 5), zero deferrals, five rejected findings. Follow-up review recommended: true; weighted score 11.

Verification: ordinary gate exited zero with 1,732 tests, both type checks, PowerShell 50/50 and Bash 18/18. Focused gate passed 147 tests. Explicit Convex TypeScript exited zero. Final source and preservation checks compare actual artifacts. Missing terminal marker was reproduced as a failing final check before this write. Detailed results are in `.audit/DW-92-native-followup/recheck/evidence.md` and the actual raw logs.

Residual risks: the accepted sentence-level detector and exact-content methodology limits remain. Native final acceptance is still the orchestrator's operation. The orchestrator-owned ledger was dirty at invocation and has been preserved without staging or modification; its status is neither a defect nor evidence of verification.
