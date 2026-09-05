---
title: 'DW-93 persisted PED native follow-up'
type: 'chore'
created: '2026-09-04'
status: 'done'
baseline_revision: 'bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
  - '{project-root}/_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/3-persist-post-edit-distance-at-milestones.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Persisted post-edit distance is implemented, but its earlier native finalization used a historical baseline inconsistent with that run. DW-93 requires a fresh review and ordinary verification before native acceptance.

**Approach:** Independently assess the entire existing CAP-2 implementation and supported codegen evidence against the original frozen story, repair verified in-scope defects, and commit fresh review and verification evidence. Use this flat follow-up spec as the sole new result artifact and capture the actual baseline through normal build-auto.

## Boundaries & Constraints

**Always:** Preserve the original nested story, its frozen contract, baseline `740008e1369faaf6eab001f95efeb10a9e52d1e5`, and all review history byte-for-byte. Assess formula parity, all three milestone hooks, failure isolation, dedupe, bounded series, access controls and generated API registration. Follow the original story's file boundaries and product choices. Retain genuine fresh ordinary gates and independent reviews under `.audit/DW-93/`. Native acceptance belongs to the orchestrator after this development result.

**Block If:** A verified defect requires changing the frozen contract or an unresolved product choice; required ordinary gates cannot pass within scope; provenance cannot be established.

**Never:** Edit the deferred-work ledger, native control state, integration checkout, original story, or generated files by hand. Manufacture receipts, adopt unrelated result specs, close old learn3 history, add UI/backfill/retention or permission changes, use test-timeout CLI overrides, or equate codegen closure with native finalization.

</intent-contract>

## Code Map

- `_bmad-output/specs/spec-ai-engine-sprint-2-learn-chat/stories/3-persist-post-edit-distance-at-milestones.md`: authoritative frozen contract, matrix, ACs and historical review decisions; read only.
- `.audit/sweep-spec-recovery/operator-recovery.md` and `report.md`: recovery provenance and flat discovery requirement; read only.
- `convex/lib/editDistance.ts`: pure word-multiset PED computation and shared recorder, first generated baseline, newest-row dedupe, owner attribution and caught failure.
- `convex/reportEditDistance.ts`: bounded authenticated report/writer queries and scheduled publish recorder.
- `convex/schema.ts`: persisted fields and report/project/writer-time indexes.
- `convex/generations.ts` (`createGeneratedReportArtifacts`), `convex/snapshots.ts` (`createMilestoneSnapshot`), `convex/projects.ts` (`publishForReview`): three production trigger paths; retain original touchpoint restrictions.
- `convex/reports.ts` (`postEditDistance`): original argument/auth/response contract delegates to shared computation.
- `convex/lib/editDistance.test.ts`, `convex/reportEditDistance.test.ts`: formula edge cases and public mutation/query integration tests.
- `convex/_generated/api.d.ts`, `.audit/CAP-2-story-3/codegen.log`, `evidence.md`: real prior supported generation evidence and current module registration; do not regenerate merely to manufacture fresh evidence.
- `scripts/loop-verify.sh`: ordinary full gate including Convex types, Svelte check, npm test and uploader tests.

## Tasks & Acceptance

**Execution:**
- [x] `.audit/DW-93/`: record full current-code assessment and codegen provenance with exact revisions; retain preservation hashes and append-only decisions.
- [x] Existing CAP-2 implementation and tests listed in Code Map: repair only verified frozen-contract defects, with baseline failure and new success evidence if any repair is necessary.
- [x] `.audit/DW-93/evidence.md` and command logs: run focused PED integration tests and ordinary full gate, map all original acceptance criteria to actual results, and commit fresh evidence.
- [x] This follow-up spec: complete independent build-auto review triage and terminal Auto Run Result using the newly captured run baseline; preserve the nested story and ledger.

**Acceptance Criteria:**
- Given the original story and existing implementation, when independently assessed, then each original AC and matrix scenario has a current-code evidence mapping and all verified in-scope defects are repaired.
- Given the current generated API, when compared with preserved real codegen evidence and typechecked, then PED registration is present and provenance is recorded without hand editing generated files.
- Given this worktree, when focused PED tests and `bash scripts/loop-verify.sh` run with ordinary settings, then they pass without test-timeout overrides and their real output is retained.
- Given fresh reviews and passing gates, when the development workflow completes, then this flat spec contains its native Auto Run Result, the actual new baseline, and committed fresh evidence, while the original story and ledger remain byte-identical and native acceptance is left to the orchestrator.

## Spec Change Log

## Review Triage Log

### 2026-09-04: Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` Replaced optimization-disabled audit assertions with explicit fail-closed comparisons; normal and optimized tamper regressions now pass.
  - `[low]` `[patch]` Retained native journal/state evidence confirming the actual new baseline and DW-92-before-DW-93 dispatch.
  - `[low]` `[patch]` Validated snapshot Git blob and baseline-attestation metadata.
  - `[low]` `[patch]` Added complete staged-diff whitespace verification to finalization.
  - `[low]` `[patch]` Explained and linked required parent verification logs.
  - `[low]` `[patch]` Disclosed the PowerShell dotfile platform skip alongside passing totals.
  - `[low]` `[patch]` Added exact citations to preserved historical formula and candidate-path coverage decisions.

All four independent layers completed. The edge-case reviewer independently verified the repaired checker with eight passing cases. Detailed review and disposition: `.audit/DW-93/reviews.md`. No production repair or new product deferral was identified.


## Verification

- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts`: all formula and persisted public-surface tests pass.
- `bash scripts/loop-verify.sh`: all ordinary required gates pass, no timeout overrides.
- `git diff --check`: no whitespace errors.
- Compare original story and ledger bytes against the invocation snapshot; verify generated API provenance against preserved codegen evidence and full canonical revisions.

## Auto Run Result

Status: done

Completed fresh DW-93 development finalization: independently assessed the full existing PED implementation, verified supported codegen lineage, repaired the new audit verifier, and retained fresh ordinary gates and reviews. This flat spec is the follow-up RESULT artifact. Actual new baseline: `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`, captured by normal step-03 and independently matched to native state.

Files changed:
- This flat spec: fresh frozen follow-up intent, baseline, review triage and native Auto Run Result.
- `.audit/DW-93/assessment.md` and `evidence.md`: full implementation review and original AC/matrix mapping with explicit coverage limits.
- `.audit/DW-93/verify-preservation.py`, `test-preservation.py` and snapshot: repeatable byte/formula/provenance checks and optimized-Python tamper rejection.
- `.audit/DW-93/` review, provenance, decisions and command logs: genuine fresh review and verification evidence, including baseline verifier failures and repaired successes.

Review: seven patches (high 0, medium 1, low 6), zero deferrals, five rejected findings. Follow-up review recommended: true; score = 3 × 1 + 6 = 9.

Verification: final ordinary `bash -x scripts/loop-verify.sh` passed both type checks, 1,772 tests across 148 files, and uploader suites (50 and 18 passes; the PowerShell AC4 dotfile sub-case is explicitly skipped on this platform). The `-x` option only traces shell commands. No test-timeout overrides were used. Final focused PED suite passed all 35 tests. Preservation checks and eight normal/optimized verifier tests passed. Complete staged-diff whitespace and protected-path checks are retained in finalization-check.log. Fresh evidence and this result are committed locally; no push.

Residual risks: historical product decisions and structural-only coverage of single/iterative candidate paths remain unchanged. The original nested story, historical baseline `740008e1369faaf6eab001f95efeb10a9e52d1e5`, codegen artifacts, old learn3 history and deferred-work ledger are preserved. Native review acceptance and ledger resolution are subsequent orchestrator work; this development result does not claim either.
