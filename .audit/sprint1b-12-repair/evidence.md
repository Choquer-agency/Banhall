# Sprint1b story12 bounded review repair

Baseline is recorded verbatim in baseline.txt. Production files changed: convex/brain.ts only; no schema or frontend changes.

## Reproduction

`npx vitest run convex/brainUnlearn.test.ts convex/brainErase.test.ts --maxWorkers=2`

`red.log` records an incomplete import attempt before Svelte sync generated the fresh worktree tsconfig. It is not defect evidence. After `npx svelte-kit sync`, `red-reproduction.log` reproduces both defects against unchanged production code: expected one confirmation, received four; expected absent ragEntryId, received entry_fixture_1. Two failed, 23 passed.

## Focused verification

The same command after the patch passes 25/25 tests across both files (`focused-green.log`).

| Acceptance | Executed coverage |
| --- | --- |
| Duplicate pre-drain revokes and repeated delivery | repeated pre-drain revokes and confirmation deliveries confirm an entry once |
| Stale failure after successful remediation | successful remediation fences a stale failure without losing earlier evidence |
| Source and entry independence | confirmation fence is scoped to both source and exact entry |
| First late compensation with never-held id | (f1) a late embed on a revoked source is compensated and confirmed |
| Failure bookkeeping after reapproval | failed erasure after reapproval never restores an id or writes failure evidence |
| Pending hits excluded before ranking | (g) and (g') include high-scoring e_pending |
| Erasure confirmation positive reads | brainErase.test.ts existing three seam tests |

## Final verification and review

`bash scripts/loop-verify.sh` completed exit 0: Convex tsc, Svelte check (0 errors/0 warnings), 1,364 tests across 127 files, PowerShell 50/50 checks and Bash 18/18 checks. See native-gate.log.

Review refinements landed while the native gate was in typechecking. Its full test phase ran the final patch. To close that timing gap, the focused suite was rerun (27/27, focused-final.log), and Convex tsc was rerun separately (convex-tsc-final.log).

Three fresh BMAD review layers completed; retained patches and dispositions are in review.md. The final historical-row test protects matching stale-handle cleanup and existing audit compatibility. The overlapping-action test releases an earlier failed erase only after another action confirms.

`git diff --check` passed. No frontend or schema changes. Ledger entries were not edited. Source audit iteration can hit transaction limits on exceptionally large source histories; under the unchanged-schema constraint, safe transactional failure is preferred over truncating the fence lookup.

Verified source commit: `901446a381eafeae815a4fe134ff3fb08ed9feae`. Following evidence-only commit records this identifier; production source and tests are unchanged. Raw log/diff artifacts retain command whitespace; the source/spec diff check is clean.
