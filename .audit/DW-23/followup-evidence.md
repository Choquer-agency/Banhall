# DW-23 fresh follow-up evidence

Invocation HEAD: `8b5fd8ccb0ae1a790b454cd7a9a266eeba5d22d2`. Implementation: `b7b1ea8aa7b8b82c8a1a00e10f9e69670d80fe94`. Baseline: `b3d36d2992aaf2d8c3b975a47f749d184b6eb543`.

The production writer and matrix tests are unchanged from invocation HEAD, verified with `git diff --exit-code 8b5fd8ccb0ae1a790b454cd7a9a266eeba5d22d2 -- convex/lib/snapshots.ts convex/snapshots.test.ts` (exit 0). The earlier red reproduction remains historical evidence in `baseline-red.log`; this invocation independently executes the passing implementation.

## Acceptance mapping

- Both reasons and all seven matrix inputs: `convex/snapshots.test.ts:153`, persisted row reads after the writer transaction.
- Invalid references preserve content, lineage, revision, reason, role and timestamp: `convex/snapshots.test.ts:245`; source report equality at line 259.
- Valid researched proposal integration: `convex/preEditSnapshot.test.ts:191`, through `api.chatV2.applyProposal`.

## Native ledger provenance

`followup-provenance.json` retains the native journal path and this bundle's events. The journal records `sweep-bundle-closed` for DW-23 at 1788574683.704872, before the review session start at 1788574683.7091. The invocation's sole ledger diff is that DW-23 native closure. Its exact bytes have been preserved throughout this review.

Invocation ledger Git blob: `1760beb602c912641c0e516c3517b3dd6b1923bf`.
Invocation ledger SHA-256: `a726f4d6fc3e8e3b2a333b45d68af16e5612c0bcabc44cb87e5c4e9b4c609410`.

The full working-tree ledger was compared byte for byte with the invocation snapshot before staging. AGENTS.md's Native BMAD ledger finalization rule authorizes committing these unchanged native bytes with retained provenance. Committing this existing close does not establish final native acceptance. No ledger content or status was authored, regenerated, rewritten or reverted by this review. No sprint-status file was written or reverted.

## Review

Four reviewers completed; individual findings and independent classifications are retained in `followup-review.md`. Four low documentation patches, eight low rejected observations, zero deferred items. Follow-up score 4; recommendation false. No product code change or human decision was required.

## Limits

No deployment or browser verification was performed; the changed boundary is server-side persistence. The PowerShell uploader harness skips its AC4 dotfile sub-case on this platform. Existing history is not migrated by the ownership guard. Native final acceptance remains the orchestrator's responsibility.

## Fresh command results after documentation corrections

`npm test -- convex/snapshots.test.ts convex/preEditSnapshot.test.ts convex/lib/snapshots.test.ts` exited 0. Output: `followup-focused.log`.

```text
Test Files  3 passed (3)
Tests  37 passed (37)
```

`bash scripts/loop-verify.sh > .audit/DW-23/followup-full-gate.log 2>&1` exited 0. It runs Convex tsc, Svelte check, all non-browser tests and both uploader harnesses.

```text
svelte-check found 0 errors and 0 warnings
Test Files  148 passed (148)
Tests  1846 passed (1846)
SKIP  AC4 dotfile sub-case - this platform hides dotfiles from Get-ChildItem without -Force
50 passed, 0 failed
18 passed, 0 failed
```

## Finalization checks

`git diff --check` exited 0. Before commit, `git show :_bmad-output/implementation-artifacts/deferred-work.md` was compared byte for byte with both the working-tree file and the invocation snapshot: equal. `git rev-parse :_bmad-output/implementation-artifacts/deferred-work.md` returned `1760beb602c912641c0e516c3517b3dd6b1923bf`, matching the recorded invocation blob. SHA-256 also matched `a726f4d6fc3e8e3b2a333b45d68af16e5612c0bcabc44cb87e5c4e9b4c609410`.

The raw focused test log ends with Vitest output blank lines. The staged default whitespace check flags only its terminal blank line; raw command output is intentionally retained. `git -c core.whitespace=-blank-at-eof diff --cached --check` validates staged artifacts while allowing that raw log formatting.
