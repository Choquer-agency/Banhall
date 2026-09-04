---
title: 'DW1 DW10 restore excluded legacy test coverage'
type: 'bugfix'
created: '2026-09-04'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'c7075572f14e51433b524026db55d5520eddde03'
context:
  - '{project-root}/convex/_generated/ai/guidelines.md'
---

<frozen-after-approval>

## Intent

**Problem:** Fourteen tests/*.test.ts suites import bun:test and are omitted by the normal Vitest command. The proposal suite has ten known failures. Its fake database omits writer policy tables, and one successful-save fixture seeds an already completed turn. The full legacy run also exposes a stale snapshot lineage expectation and an unresolved Bun alias.

**Approach:** Preserve existing behavioral assertions while executing them through the maintained Vitest configuration. Replace the proposal fake database with convex-test and genuine schema fixtures. Align stale fixture/expectation assumptions with already implemented contracts, without changing production behavior.

## Boundaries & Constraints

**Always:** Preserve access, proposal-only editing, canonical target, report pinning, snapshots, lineage, idempotency, deletion and ordered replacements assertions. Preserve all fourteen suites in normal automated discovery. Reproduce before modifying tests; record baseline failures and every migration adjustment.

**Ask First:** A genuine production defect requiring a policy change.

**Never:** Silently remove tests or weaken assertions. No product policy, schema, generated API, unrelated worktree, ledger or existing story-status edits. No push. Root owns final integration. Full-suite/typecheck gates wait for root resource authorization; focused tests may run.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Internal access | Manager/admin/unrelated writer | Existing proposal access preserved | Anonymous denied |
| Valid creation | Running turn and canonical unique target | Saved with tool/prompt association and unique target flag | No report mutation |
| Stopped creation | Completed/aborted turn | No proposal insertion | Structured refusal |
| Invalid target | Unapplied suggestion wording | No new proposal | Structured refusal |
| Human apply | Pending proposal to pinned report | Correct content/hash/revision and pre-edit snapshot; newer report untouched | Invalid/ambiguous target rejected or marked stale |
| Wording update | Edit/replacement proposal | Wording changes, canonical find target preserved, learning event recorded | Changed target rejected |
| Retry/reject | Applied or pending proposal | Apply idempotent, rejection state correct | Anonymous rejected |
| Snapshot lineage | Matching/stale provenance and legacy generation | Exact valid lineage retained including ordered transcript set | Invalid provenance omitted |
| Discovery | Standard npm test | All previously excluded suites execute | Existing browser separation preserved |

</frozen-after-approval>

## Code Map

- `tests/chatProposals.test.ts`:22 original cases and a brittle `_handler`/FakeDb harness. Migrate to convex-test with real queries/mutations; keep all original scenarios.
- `convex/chatProposals.test.ts`: existing convex-test fixture conventions; independent markProposalApplied coverage stays intact.
- `convex/chatV2.ts`: read-only saveProposal stop fence and human apply/snapshot paths. Existing production behavior defines the corrected fixtures.
- `convex/lib/snapshots.ts`: read-only snapshotAuditFields now returns sourceTranscriptIds derived from generation; tests/snapshots.test.ts lacks that field in expected objects.
- `tests/*.test.ts`: fourteen Bun-only suites; other than harness incompatibilities, migrate test imports without changing their cases.
- `vitest.config.ts`: maintained alias plus edge-runtime convex project, src node project, browser exclusion and maxWorkers2. Add legacy unit discovery without duplicating tests/aiUsage.test.ts.
- `tests/exportValidation.test.ts`: imports DOCX module and validates generated document; assign runtime based on actual Node dependencies without adding browser work to npm test.

## Tasks & Acceptance

**Execution:**
- [x] `tests/chatProposals.test.ts`: replace fake database with schema-backed calls; preserve original22 cases and add stop-fence control.
- [x] `tests/*.test.ts`: migrate fourteen Bun imports and repair demonstrated stale snapshot expectation.
- [x] `vitest.config.ts`: integrate previously excluded coverage into default test discovery.
- [x] `.audit/proposal-tests`: preserve red/green logs, migration coverage mapping, review and decisions.

**Acceptance Criteria:**
- Given baseline excluded suites, when their original Bun runner executes, then actual failures are recorded before edits.
- Given migrated suites, when filtered normal Vitest runs execute, then all legacy cases run and pass without skips or weakening their original behavioral checks.
- Given an active proposal save fixture, when it executes through real Convex transactions, then it saves; given a stopped fixture, then it refuses and writes nothing.
- Given unchanged production policy, when this diff is reviewed, then it contains only tests, test configuration and evidence/spec documents.

## Spec Change Log

- 2026-09-04: Parent authorized bounded DW1/DW10 repair, isolated branch and existing checkpoint approvals; keep all fourteen related suites in scope.

- 2026-09-04: Real Convex authorization exposed one stale unrelated-writer apply success expectation. The approved 2026-09-01 domain amendment (docs/product-domain.md, capability report.editProse) requires ownership or open assignment. Replace that stale outcome with denial plus unchanged state and retain the complete success audit assertions for an owning writer. No production permission changes.

## Verification

- Baseline `bun test tests/chatProposals.test.ts`:12 pass,10 fail.
- Baseline explicit fourteen-file `bun test` invocation:88 pass,12 fail,1 import error.
- Focused `npx vitest run tests/ --maxWorkers=2` after Svelte config generation.
- Final `bash scripts/loop-verify.sh` only when root releases a verification slot.

- Reviewed focused command:15 files133tests passed; `git diff --check` passed. Full gate/typecheck remains pending.

## Review outcome

Three independent BMAD layers completed. Restored both original cross-paragraph ambiguity cases, retained same-paragraph controls, and strengthened candidate, save-association and no-mutation assertions. See `.audit/proposal-tests/triage.md` for every finding. The candidate stays in-review until the root completes the final integrated native gate; focused green is not a full-gate claim.

## Suggested Review Order

- Real schema-backed transactions replace the incomplete fake database.
  [chatProposals.test.ts:15](../../tests/chatProposals.test.ts#L15)

- Both ambiguity layouts preserve document-wide uniqueness and unchanged-state assertions.
  [chatProposals.test.ts:214](../../tests/chatProposals.test.ts#L214)

- Current approved writer permissions retain denial and full authorized audit coverage.
  [chatProposals.test.ts:289](../../tests/chatProposals.test.ts#L289)

- Normal test discovery now includes the fourteen excluded legacy suites.
  [vitest.config.ts:20](../../vitest.config.ts#L20)

- Snapshot expectations match the implemented lineage contract.
  [snapshots.test.ts:132](../../tests/snapshots.test.ts#L132)


## Integrated verification acceptance

At integrated revision `717c75897cc04256c008a2ed42747df66f6fc6b5`, the standard `bash scripts/loop-verify.sh` exited 0: Convex typechecking passed, Svelte reported 0 errors and 0 warnings, all 1,726 tests in 148 files passed, and uploader harnesses passed 50 and 18 checks. Source changes from this repair are present in that ancestry; the merged snapshot tests separately passed 9 cases and integrated legacy/Unicode checks passed 233 cases. Evidence: `.audit/ledger-reconciliation/integrated-full-gate.log` and `integrated-repair-focused.log`. This supersedes the prior verification hold for this repair. Native original-story ledger closure, browser verification and remaining learning stories are tracked separately; no native run state was hand-edited.
