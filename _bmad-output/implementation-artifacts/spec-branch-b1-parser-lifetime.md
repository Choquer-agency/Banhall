---
title: 'Branch consolidation B1: parser resource lifetime and deadline proof'
type: 'bugfix'
created: '2026-09-05'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'cc6b706c3b43f971d944cb703a4174eabf3134d9'
authorization_basis: "User requested all remaining branches merged properly with thorough audit; this is the first coherent implementation unit within that authorization."
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="user-authorized branch consolidation; preserve existing parser contract">

## Intent

**Problem:** Current main retains the PDF parser implementation from before an already developed timer-lifetime fix. Its timeout race can leave a pending timer after parsing settles. The outstanding branch also contains a test proving PDF loading and page extraction consume sequential portions of one shared deadline; that useful proof is absent from main.

**Approach:** Integrate the narrow parser source and test changes from the audited branch, reproducing the old resource-lifetime failure and verifying the corrected behavior on the current main baseline. This is B1 of the branch-consolidation manifest. Other independent batches remain queued and are not deferred or abandoned.

## Boundaries & Constraints

**Always:** Preserve the single absolute 60-second parse deadline, the existing ParseTimeout identity and normal parsing output. Release the timer when either race participant settles, including rejection. Preserve all unrelated main tests. Work only in the Banhall-branch-consolidation checkout. Keep an actual before/after evidence record with exact source identities. The user explicitly chose BMAD and authorized implementation, verification and subsequent parent-managed merging; the generic factory requirement to use its engine does not replace this workflow.

**Ask First:** A change to timeout duration, supported documents, error contract or product behavior beyond resource cleanup requires an actual new intent decision. Report a conflict rather than inventing that decision.

**Never:** Change the current editor, AI/domain policies, native run state or deferred ledger. Do not import the Editor.component.test.ts portion of the sequential-proof commit; it belongs to B2. Do not read secrets, mutate another worktree, run remote operations, push, merge branches or commit from the implementation worker. The parent owns reviews, gates and commits.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Fulfilled operation | A wrapped operation settles before its deadline | Return its result and leave no timeout timer | No artificial timeout later |
| Rejected operation | The operation rejects before its deadline | Preserve the original rejection and release its timer | No swallowed error |
| Deadline expiration | The operation stays pending past remaining budget | Reject with the existing ParseTimeout contract | Timer resource is settled |
| Sequential PDF stages | Document load consumes part of the shared absolute budget | Page extraction receives only the remaining time | Eager or per-stage reset implementations fail the proof |

</frozen-after-approval>

## Code Map

- `src/lib/parseDocument.ts`: current parser is byte-identical to the pre-fix source; preserve public exports and shared-deadline architecture while changing the timer wrapper's cleanup.
- `src/lib/parseDocument.test.ts`: existing maintained parser tests; integrate the timer-count checks and sequential-stage proof into this current suite.
- `.audit/branch-consolidation/factory-audit/f82f2b0.diff`: exact source/test patch for commit f82f2b0a9c44b9f5475d6d5c31418ab368bd3c4c, useful input to inspect, not permission to expand scope.
- `.audit/branch-consolidation/factory-audit/d381a68.diff`: exact mixed patch for d381a689e74f0d30cd712134735eb58207835f00; only parser-test hunks apply here.
- `.audit/branch-consolidation/factory-audit/perf-1-parser-timers-editor-index-ticket.md` and `proof-1-parser-budget-sequence-ticket.md`: original intended behavior and acceptance; corresponding evidence files preserve historical observations but do not replace a current run.
- `.audit/branch-consolidation/factory-audit/integration-batches.json`: B1 scope and later B2 editor dependency. Keep all other batches untouched.
- `scripts/loop-verify.sh`: parent-run numbered gate. Current main uses canonical discovery and isolated fine/coarse browser contexts; retain them.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/parseDocument.test.ts`: add the applicable regression cases first and run them on unchanged main source; retain the actual baseline failures.
- [x] `src/lib/parseDocument.ts`: apply the narrow timer-lifetime repair while preserving deadline and error semantics.
- [x] `src/lib/parseDocument.test.ts`: integrate the sequential shared-budget proof; verify an intentionally eager or resetting control fails if practical without leaving the control in source.
- [x] `.audit/branch-consolidation/B1/`: record actual commands, exit status, concise observations and SHA256 source identities; report implementation readiness without claiming parent review or final merge completion.

**Acceptance Criteria:**
- Given each matrix input, when the actual parser wrapper is exercised, then the corresponding result/error and timer state are asserted by an executed test.
- Given main's parser before the fix, when the new timer regression executes, then it fails for the intended leaked-resource reason; the final implementation passes it.
- Given PDF loading has consumed part of the absolute deadline, when page extraction begins, then the test proves only remaining budget is available.
- Given the branch's mixed parser/editor proof commit, when B1 is complete, then no editor or unrelated tracked source file changed.

## Spec Change Log

## Verification

**Commands:**
- `npx vitest run src/lib/parseDocument.test.ts`: retain actual failing baseline and passing final output.
- `git diff --check`: no introduced whitespace defects.
- Parent follows with independent BMAD review and `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` on the reviewed source before admitting this batch. If sandbox restrictions prevent an implementation-worker test, report the exact failure so the parent can execute it directly; never claim a pass.

## Suggested Review Order

- Release settled timeout resources while retaining one shared deadline.
  [parseDocument.ts:64](../../src/lib/parseDocument.ts#L64)

- Prove sequential stages consume the remaining budget and catch eager page retrieval.
  [parseDocument.test.ts:231](../../src/lib/parseDocument.test.ts#L231)

- Assert successful and failed parsing release timer resources.
  [parseDocument.test.ts:217](../../src/lib/parseDocument.test.ts#L217)

## Parent Acceptance

Three fresh Astra 6 medium BMAD layers completed; per-item triage is retained in `.audit/branch-consolidation/B1/review-triage.md`. Root applied the getPage sequencing proof and a real production eager-page negative control. All 19 parser tests and the full nine-step gate passed (1,976 unit tests; 463 browser tests). All historical screenshot changes were retained separately and original tracked bytes restored. The pre-existing expired-entry rejection is recorded as DW-100 and scheduled immediately in B12. No sprint story key exists for this branch-reconciliation unit, so sprint synchronization is a no-op. The user already authorized push and proper merge after final cross-batch verification.
