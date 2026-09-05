---
title: 'DW-23 snapshot research ownership'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
baseline_revision: 'b3d36d2992aaf2d8c3b975a47f749d184b6eb543'
review_loop_iteration: 0
followup_review_recommended: false
context: ['AGENTS.md', '.factory/AGENTS.factory.md', 'convex/_generated/ai/guidelines.md']
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** writePreEditSnapshot copies an unchecked research session ID and evidence count into report history. A missing or foreign session can therefore create misleading provenance.

**Approach:** Apply the existing snapshot ownership-filtering boundary to research sessions, requiring both report and project ownership before copying research metadata or selecting the researched label.

## Boundaries & Constraints

**Always:** Preserve snapshot creation, content, audit lineage, revision, reason, role and caller timestamp. Valid research sessions retain their count (including zero) and researched label. Invalid research provenance is omitted without preventing the recovery checkpoint.

**Block If:** Correctness requires new domain permissions or workflow transitions.

**Never:** Edit the deferred-work ledger, generated files, report prose mutation policy, or unrelated research behavior. Do not push, open a PR or deploy. The supplied native bundle is the authorized scope and the existing worktree is the intended isolate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid session | Matching report and project, count 3 | ID, count 3 and researched label persisted | No error |
| Valid zero count | Matching report and project, count 0 | ID, count 0 and researched label persisted | No error |
| No session | No supplied ID | No research fields; default label for reason | No error |
| Missing session | Supplied ID references deleted row | No research fields; default label for reason | No error |
| Foreign report | Same project, different report | No research fields; default label for reason | No error |
| Foreign project | Same report ID, different project | No research fields; default label for reason | No error |
| Fully foreign | Different report and project | No research fields; default label for reason | No error |

</intent-contract>

## Code Map

- `convex/lib/snapshots.ts:30`: validGeneration and adjacent transcript validators establish the pattern: load, check ownership, omit invalid references.
- `convex/lib/snapshots.ts:271`: writePreEditSnapshot is the sole pre-edit checkpoint writer; researchFields and label currently trust options.researchSessionId.
- `convex/snapshots.test.ts:152`: real convex-test coverage directly invokes the writer and reads persisted reportSnapshots; existing missing-session test intentionally pins the old behavior and must change.
- `convex/preEditSnapshot.test.ts:14`: applyProposal integration exercises researched edits through the shared writer.
- `convex/_generated/ai/guidelines.md`: read-only Convex API rules.
- `docs/product-domain.md`: domain policy remains unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `convex/snapshots.test.ts`: cover the matrix with persisted snapshot assertions for both supported reasons. Reproduce invalid provenance on baseline before implementation and retain output in `.audit/DW-23/`.
- [x] `convex/lib/snapshots.ts`: validate research session ownership once and derive both research fields and label from the validated session, reusing the adjacent ownership-filtering pattern.
- [x] `.audit/DW-23/decisions.tsv` and `.audit/DW-23/evidence.md`: record decisions, baseline revision, red/green evidence, acceptance mapping and verification output tails. Leave committing to the parent finalization step.

**Acceptance Criteria:**
- Given either pre-edit reason and any matrix input, when writePreEditSnapshot runs, then the persisted reportSnapshots row contains only valid research provenance and its corresponding label.
- Given an invalid session reference, when the writer creates the checkpoint, then its original report content, lineage, revision, reason, role and caller timestamp are preserved without throwing.
- Given a valid researched proposal, when applyProposal executes, then its existing checkpoint integration tests continue to pass.

## Spec Change Log

## Review Triage Log

### 2026-09-04 Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 12: (high 0, medium 0, low 12)
- addressed_findings:
  - none

Four review layers completed. Edge and verification reviewers returned no findings. Eleven blind-review suggestions were rejected as optional coverage/style changes or finalization bookkeeping already required by this workflow. The intent auditor's label observation was also rejected: the bundle explicitly calls for filtering foreign session references and research provenance, and the label denotes that provenance. A default label consistently reflects the absence of a valid session. The requested surface is the shared writer, so persisted-row tests exercise the correct boundary.

## Verification

**Commands:**
- `npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts`: all ownership matrix and integration tests pass.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: no errors.
- `npm test`: all non-browser tests pass.
- `git diff --exit-code -- _bmad-output/implementation-artifacts/deferred-work.md`: ledger unchanged.

## Auto Run Result

Status: done

Implemented DW-23 by validating both project and report ownership before copying a research session into a pre-edit snapshot. Missing and foreign sessions are omitted and receive the reason's default label; valid sessions retain their count and researched label.

Files changed:
- `convex/lib/snapshots.ts`: validates research ownership and derives fields and label from the validated row.
- `convex/snapshots.test.ts`: 14 persisted matrix cases across both reasons, preserving the full checkpoint and source report.
- `.audit/DW-23/`: baseline failure, focused success, full gate outputs and decision/evidence records.
- This specification: implementation contract, completed tasks and review result.

Review: 0 patches, 0 deferred items, 12 rejected observations. Patched severity counts: high 0, medium 0, low 0; follow-up score 0. Follow-up review recommended: false.

Verification:
- Baseline regression: 8 failed, 29 passed with unchanged baseline writer.
- Independent focused verification: 37 passed.
- `bash scripts/loop-verify.sh`: exit 0, including Convex typecheck, Svelte check (0 errors, 0 warnings), 148 files / 1,846 tests, and both uploader harnesses.
- `git diff --check`: exit 0.
- Deferred-work ledger unchanged; blob `4a044b3a4c95a8993b403729ab9188cc2f5940de`.

Residual risks: this is defensive validation for relationships not currently produced by normal research creation. No live deployment was exercised. The native orchestrator retains responsibility for ledger resolution and final run acceptance.
