---
title: 'DW-92 blocking QA native follow-up'
type: 'chore'
created: '2026-09-04'
status: 'in-review'
baseline_revision: '86a43d9d500ceab34245744d223d4453eba7b667'
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

**Native ledger ownership:** Do not author, revert, regenerate, or manually change deferred-work ledger entries. The orchestrator can update the ledger between dev and review. During native finalization, stage and commit its exact unchanged bytes when the native journal/state or invocation snapshot establishes their provenance; verify the working-tree bytes and staged blob match that snapshot and retain the evidence. Do not stage unexplained ledger changes. Preserving native bookkeeping does not itself establish final acceptance.

**Never:** Author deferred-work ledger changes or edit native control state, integration checkout, old crashed/deferred runs, the original nested spec, frontend/QA rail, generated Convex files, protected learn/chat epic files, or outstanding product choices. Do not synthesize receipts, bind another spec, infer acceptance from old evidence, add a linguistic classifier or mandatory fresh AI pass, or use test-timeout CLI overrides. Do not push, open a PR, or deploy.

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
- Given completed review and verification, when this worker finalizes, then committed new evidence and the native Auto Run Result reside in this flat spec while original history, frontend, generated files and native control state are unchanged. There are no worker-authored ledger changes; any native-owned ledger bytes are preserved unchanged and may be committed after the provenance and equality checks above.

## Spec Change Log

- 2026-09-04: Resolve the native review finalization conflict by distinguishing ledger authorship from staging exact orchestrator-produced bytes. This operational correction follows the user's authorization to repair native loops and commit verified work. Product policy and prior blocked evidence are unchanged; native rearm owns active status, baseline and terminal-marker changes.

## Fresh Native Invocation

The native task is already bound to this flat spec and rearmed ready-for-dev. This invocation follows that binding, captures baseline `86a43d9d500ceab34245744d223d4453eba7b667`, retains all prior review history below, and records fresh evidence in `.audit/DW-92-native-fresh/`. Prior checklist completion and passing gates are historical; current acceptance requires this invocation's review and verification. Previous workflow baseline was `89b4eeb50e40b38cc7acd42215ab4b9876e35cab`.

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

### 2026-09-04: Rearmed native fresh review
- intent_gap: 0
- bad_spec: 0
- patch: 11: (high 3, medium 3, low 5)
- defer: 0
- reject: 1: (high 0, medium 0, low 1)
- addressed_findings:
  - `[high]` `[patch]` Preserve preceding substantive uncertainty when the first recognized 242 heading appears late, while excluding the identifiable generated title.
  - `[high]` `[patch]` Preserve branching inline-wrapper cohesion for uncertainty markers and valid because explanations, retaining real block separation and heap traversal.
  - `[high]` `[patch]` Repair the title fix's leading-H1 section-boundary regression; retain a registered before/after gate test.
  - `[medium]` `[patch]` Verify non-iterative current sections244/246; a temporary frozen-value mutation fails the new assertion.
  - `[medium]` `[patch]` Extend alternate-writer and destination-copy tests through readiness and atomic publish rejection.
  - `[medium]` `[patch]` Capture untracked runtime inputs in verification source identity.
  - `[low]` `[patch]` Qualify the initial inspection after reviewers found counterexamples.
  - `[low]` `[patch]` Compare source and revision before and after each command.
  - `[low]` `[patch]` Include root build configuration in source identity.
  - `[low]` `[patch]` Retain unique per-run logs and manifests across repairs.
  - `[low]` `[patch]` Map provider, retry, current-section and cleanup proof to exact executed test identities.

All four independent layers completed against fresh artifacts and the full historical QA implementation/repairs. The edge reviewer confirmed both extraction cases fit the frozen contract. A subsequent verification review found the leading-H1 regression and confirmed its final repair. Detailed triage and retained failures are in `.audit/DW-92-native-fresh/review.md` and `evidence.md`. No product-policy expansion or new deferral. Follow-up recommendation true: high 3, medium 3, low 5; weighted medium/low score 14. Native acceptance remains subsequent orchestrator work.

### 2026-09-04: Native supplied-spec final review
- intent_gap: 0
- bad_spec: 0
- patch: 9: (high 2, medium 2, low 5)
- defer: 0
- reject: 4: (high 0, medium 2, low 2)
- addressed_findings:
  - `[high]` `[patch]` Preserve generated-title exclusion after blank paragraphs without discarding actual H1 section boundaries.
  - `[high]` `[patch]` Preserve nested list/table block separation so unrelated explanations cannot satisfy uncertainty text.
  - `[medium]` `[patch]` Add mutation-sensitive registered nested-block coverage.
  - `[medium]` `[patch]` Require exact ordinary and focused command identities during final verification.
  - `[low]` `[patch]` Capture native close provenance and equality for the current ledger snapshot.
  - `[low]` `[patch]` Add a current-invocation checker that separates native ledger provenance from protected product paths.
  - `[low]` `[patch]` Retain tool versions and safe environment-control hashes.
  - `[low]` `[patch]` Preserve historical completion evidence while emitting the current unique terminal result.
  - `[low]` `[patch]` Fence verification timestamps and source revisions to this native review invocation.

All four independent layers completed. Six registered boundary failures reproduced on the entry extractor before repair. Two mutation checks proved existing inline-marker and new block-separation coverage. Final ordinary verification passed 1,765 tests and focused verification passed 166 tests; both type checks and uploader harnesses passed. Detailed triage and raw proof reside in `.audit/DW-92-native-review-followup/`. No product-policy decision or new deferral. The existing native ledger close is preserved unchanged and does not establish orchestrator acceptance.

## Verification

**Commands:**
- `bash scripts/loop-verify.sh`: Convex TypeScript, Svelte check, npm test and both uploader harnesses pass.
- `npx vitest run convex/ai/qaChecks.test.ts convex/projects.test.ts convex/qaBlocking.test.ts`: original exact focused gate passes.
- `git diff --check`: no whitespace errors.
- Compare original nested spec, `src/` and `convex/_generated/` against captured follow-up baseline: unchanged. Compare ledger working-tree bytes and staged blob against the invocation snapshot, accounting only for independently proven native writes; no worker-authored ledger changes.

