# DW-23 implementation evidence

Historical scope: all results below through the exact implementation revision were recorded by the implementation invocation before the native orchestrator closed DW-23. Its ledger comparisons describe that invocation only. The fresh review and native finalization evidence are in `followup-evidence.md` and `followup-provenance.json`.

Baseline commit: `b3d36d2992aaf2d8c3b975a47f749d184b6eb543` (confirmed by `git rev-parse HEAD`). The implementation commit is recorded below after local finalization.

Authorized scope: `_bmad-output/implementation-artifacts/spec-dw-23-snapshot-research-ownership.md`. All frontmatter context files were read before implementation. No domain amendment is required.

## Baseline reproduction

Added the seven-case matrix for both pre-edit reasons before modifying the writer. `git diff --exit-code b3d36d2992aaf2d8c3b975a47f749d184b6eb543 -- convex/lib/snapshots.ts` exited 0; its empty output is retained in `baseline-writer-diff.log`.

Command: `npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts`

Exit 1. Full output: `baseline-red.log`. All eight invalid-reference cases failed on researched label and research field presence. Valid sessions, zero count, and absent IDs passed; preservation assertions passed before the research assertions.

```text


 Test Files  1 failed | 2 passed (3)
      Tests  8 failed | 29 passed (37)
   Start at  19:11:55
   Duration  719ms (transform 500ms, setup 0ms, import 413ms, tests 465ms, environment 128ms)

```

## Acceptance mapping

| Acceptance | Proof |
| --- | --- |
| Both reasons and every ownership matrix input persist only valid research metadata and corresponding label | `convex/snapshots.test.ts:153`, 14 cases with post-transaction persisted row reads and explicit absence assertions |
| Invalid references preserve checkpoint content, audit lineage, revision, reason, role and caller timestamp without throwing | `convex/snapshots.test.ts:245`, independent fixture assertions for hash, provenance, generation and transcript IDs, revision 7, and fixed timestamp; original report equality at line 259 |
| Valid researched applyProposal integration remains passing | Existing `convex/preEditSnapshot.test.ts` included in focused green run |
| Validate ownership once and derive fields and label from the validated row | `convex/lib/snapshots.ts:39` and `convex/lib/snapshots.ts:292` |

## Focused verification

Command: `npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts`

Exit 0. Full output: `focused-green.log`.

```text


 Test Files  3 passed (3)
      Tests  37 passed (37)
   Start at  19:12:19
   Duration  694ms (transform 508ms, setup 0ms, import 424ms, tests 451ms, environment 129ms)

```

`git diff --check` exited 0 with no output.

`git diff --exit-code -- _bmad-output/implementation-artifacts/deferred-work.md` exited 0 with no output. The ledger was not edited.

## Parent verification and review

`npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts` exited 0 in the parent session: 3 files, 37 tests passed. Output: `parent-focused.log`.

`bash scripts/loop-verify.sh > .audit/DW-23/full-gate.log 2>&1` exited 0 in the parent session. This command runs Convex tsc, `npm run check`, `npm test`, PowerShell uploader tests and Bash uploader tests. Full output is retained in `full-gate.log`.

```text
svelte-check found 0 errors and 0 warnings
Test Files  148 passed (148)
Tests  1846 passed (1846)
```

All 14 matrix cases ran in both focused and full verification. Both uploader harnesses passed their executed cases. The PowerShell AC4 dotfile sub-case was skipped because this platform hides dotfiles from Get-ChildItem without -Force. No component files changed.

Four independent review layers completed. Edge and verification reviews found no issues. Blind review supplied eleven optional test/style or finalization observations; these required no code fix. The intent auditor confirmed persistence-surface alignment and noted label interpretation: the same ownership boundary controls all research provenance, including its label. Final bookkeeping is completed here and in the spec; no review patches or deferred findings remain.

The initial six decision rows share their recording timestamp, not execution timestamps; actual test execution times are retained in their command logs. Baseline comparison command and exit status are explicitly recorded above; its empty output reflects success, not standalone evidence.

The ledger's initial and final Git blob is `4a044b3a4c95a8993b403729ab9188cc2f5940de`. `git diff --exit-code -- _bmad-output/implementation-artifacts/deferred-work.md` exited 0. Ledger content and status are owned by the native orchestrator.

## Exact implementation revision

Verified implementation commit: `b7b1ea8aa7b8b82c8a1a00e10f9e69670d80fe94`. This commit contains the production fix and its tests; documentation commit `8b5fd8ccb0ae1a790b454cd7a9a266eeba5d22d2` records the implementation invocation evidence. No push was performed.
