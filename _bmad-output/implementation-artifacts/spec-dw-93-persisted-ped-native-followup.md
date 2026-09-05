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


### 2026-09-04: Native follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 6: (high 0, medium 2, low 4)
- defer: 0
- reject: 0
- addressed_findings:
  - `[medium]` `[patch]` Separated historical ledger preservation from current native invocation bytes; retained closure provenance without editing ledger content.
  - `[medium]` `[patch]` Required the complete unique protected inventory.
  - `[low]` `[patch]` Cross-checked snapshot baseline against retained native dispatch evidence.
  - `[low]` `[patch]` Matched tamper diagnostics and expanded isolated normal/optimized integrity cases.
  - `[low]` `[patch]` Narrowed formula helper output to the textual check it actually performs.
  - `[low]` `[patch]` Scoped historical completion receipts to their revision and supplied current terminal/staging evidence.

All four independent layers completed; the edge reviewer independently confirmed the repairs and 22 passing integrity cases. See `.audit/DW-93/review-followup/reviews.md`. No production repair, product decision or new deferral was identified.

### 2026-09-04: Current review pass
- intent_gap: 0
- bad_spec: 0
- patch: 7: (high 0, medium 1, low 6)
- defer: 0
- reject: 5: (high 0, medium 0, low 5)
- addressed_findings:
  - `[medium]` `[patch]` Validate staged equality for all five protected artifacts, with six reproduced false-success cases fixed.
  - `[low]` `[patch]` Test missing and wrong-bundle native closure rejection.
  - `[low]` `[patch]` Test invocation inventory, hash and blob rejection.
  - `[low]` `[patch]` Test successful staged verification in both Python modes.
  - `[low]` `[patch]` Reject unknown and abbreviated verifier arguments.
  - `[low]` `[patch]` Retain executable finalization checks and actual output.
  - `[low]` `[patch]` Bind historical manifests and receipts to their fixed canonical commit.

All four independent layers completed; the edge reviewer independently passed all 44 repaired integrity cases. Details: `.audit/DW-93/review-current/reviews.md`. No production defect or human decision was identified.

## Verification

- `npx vitest run convex/lib/editDistance.test.ts convex/reportEditDistance.test.ts`: all formula and persisted public-surface tests pass.
- `bash scripts/loop-verify.sh`: all ordinary required gates pass, no timeout overrides.
- `git diff --check`: no whitespace errors.
- Compare original story and ledger bytes against the invocation snapshot; verify generated API provenance against preserved codegen evidence and full canonical revisions.

## Auto Run Result

Status: done

Completed the fresh review of persisted PED and its verification evidence. Seven audit patches strengthen staged preservation, command validation, regression coverage and receipt traceability. No production repair was necessary. This review began at `a338f6a08274e7a26b3f0195fb15424f7f30a1ed`; the done-spec route retains workflow baseline `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`.

Files changed:
- `.audit/DW-93/verify-preservation.py`: checks all five protected staged paths and rejects unknown/abbreviated flags.
- `.audit/DW-93/test-preservation.py`: expands normal and optimized integrity coverage from 22 to 44 cases.
- `.audit/DW-93/evidence.md`, `decisions.tsv`, and `review-current/`: fresh reviews, invocation snapshot, reproduction, passing gates, stable historical references and executable finalization checks.
- This spec: current review triage and terminal result.

Review breakdown: seven patches (high 0, medium 1, low 6), zero deferrals, five rejected findings. Follow-up review recommended: true; score = 3 * 1 + 6 = 9. All four independent review layers completed.

Verification: ordinary full gate passed before and after repairs with no timeout overrides. Post-repair results: zero Svelte errors/warnings, 1,772 tests across 148 files, uploader suites of 50 and 18 passes; existing PowerShell dotfile platform sub-case skipped. Focused PED tests passed all 35 cases. The audit regression reproduced six old failures, then all 44 cases passed after repair and in independent recheck. Preservation/provenance and staged finalization checks are retained under `.audit/DW-93/review-current/`.

Residual risks: frozen structural candidate-path coverage and historical product decisions remain unchanged. Original story, generated artifacts and invocation ledger bytes remain identical. This session did not write or stage the ledger, and did not write or revert sprint status. The result is committed locally without push. Native acceptance belongs to the orchestrator and is not established by an existing ledger close.
