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

### 2026-09-04 Follow-up review pass
- intent_gap: 0
- bad_spec: 0
- patch: 4: (high 0, medium 0, low 4)
- defer: 0
- reject: 8: (high 0, medium 0, low 8)
- addressed_findings:
  - `[low]` `[patch]` Qualify the evidence document's ledger comparisons as implementation-stage observations.
  - `[low]` `[patch]` Qualify the spec's ledger comparison with the same stage boundary.
  - `[low]` `[patch]` Name the exact existing documentation commit in the evidence.
  - `[low]` `[patch]` Disclose the platform-specific PowerShell dotfile sub-case skip.

Four fresh reviewers completed. No production defect or human decision was identified. Individual current-pass findings and dispositions are retained in `.audit/DW-23/followup-review.md`. Native ledger authorship is established separately from acceptance by the recorded journal closure before review invocation.

## Verification

**Commands:**
- `npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts`: all ownership matrix and integration tests pass.
- `PUBLIC_CONVEX_URL=https://placeholder.convex.cloud npm run check`: no errors.
- `npm test`: all non-browser tests pass.
- Implementation invocation only: `git diff --exit-code -- _bmad-output/implementation-artifacts/deferred-work.md` exited 0 before native closure. This review preserves the later native closure bytes; see `.audit/DW-23/followup-provenance.json`.

## Auto Run Result

Status: done

DW-23 validates both report and project ownership before copying research metadata into pre-edit history. Missing or foreign sessions retain the recovery checkpoint and receive the default label; valid sessions preserve their count and researched label. Fresh review required no production changes or human decision.

Files changed since baseline:
- `convex/lib/snapshots.ts`: one ownership validation controls research fields and label.
- `convex/snapshots.test.ts`: fourteen persisted matrix cases across both reasons.
- `.audit/DW-23/`: historical red/green evidence, fresh verification, review dispositions and native closure provenance.
- This spec: current review triage and terminal result.
- `deferred-work.md`: exact pre-existing native closure staged for finalization; no worker content edits.

Current review: four low documentation patches, eight low rejected findings, zero deferrals. Patched severity counts: high 0, medium 0, low 4. Follow-up score 4; recommendation false.

Fresh verification after review corrections:
- Focused suites: exit 0, 37 tests passed.
- `bash scripts/loop-verify.sh`: exit 0; Convex typecheck passed; Svelte check reported 0 errors and 0 warnings; 148 files and 1,846 tests passed; uploader harnesses reported 50 and 18 passing cases. PowerShell skipped its platform-specific AC4 dotfile sub-case.
- `git diff --check`: exit 0.
- Native ledger bytes match the invocation snapshot; working-tree and staged comparison evidence is retained in `.audit/DW-23/followup-evidence.md`.

Residual risks: no deployment was exercised and existing snapshots are not migrated. Native ledger status and this local commit do not establish final native run acceptance; the orchestrator owns that decision. Sprint status was not written or reverted. No push was performed.
