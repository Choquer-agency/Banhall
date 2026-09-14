# DW-121 / DW-122 follow-up evidence

Invocation HEAD: `3d51a3d457a3f98f213db80f299d4e0da8b09b97`.
Implementation commit reused unchanged: `9d899dc0372844db966a5029d96cbbe6610c6723`.
Review baseline: `087c76b18a8ad462498653651a3fcb971e31baf4`.

## Review

All four independent review CLIs selected `gpt-6-astra` at `xhigh` and exited 0. They used the existing `/Users/johnnynguyen/.codex` context, read-only sandboxing, and unset `BMAD_LOOP_TASK_ID`. `review-input.full.diff`, `review-source.diff`, prompt files, input hashes, raw CLI logs, result files, and `review-results.json` retain the reviewed content and outcomes. No empty or wrong-checkout source diff was used.

`triage.md` individually maps 13 distinct findings: 2 low documentation/evidence patches, 11 low rejections, and no deferrals or unresolved decisions. The source was retained. The spec now explicitly distinguishes the intended absent-ID and missing-parent behaviors from accidental baseline behavior. Fresh installation evidence resolves the other patch. The latest-pass recommendation score is `3 * 0 + 2 = 2`, below the threshold; `followup_review_recommended` is false.

The bounded independent Astra/xhigh audit in `trail-audit-result.md` passed without flags. Its scope was the review trail and native ownership evidence. It did not claim final gate or staged-byte verification, which remain owning-parent checks.

## Verification

Sol/high performed the test-execution role. Existing fixed source hashes matched prior passing receipts. The earlier baseline control remains retained unchanged at `../baseline-failure.raw.log`: exit 1 with exactly the two intended regressions failing.

The first live focused check passed 3 files and 40 tests. A bounded historical transcript search did not establish checkout-local installation provenance, so a fresh `npm ci` was performed with unchanged package-lock bytes. After installation, the exact focused command passed 3 files and 40 tests again. The canonical `bash scripts/loop-verify.sh` gate completed with exit 0 and all nine stages passing: Convex typecheck, Svelte check with 0 errors/0 warnings, 189 unit files and 2,683 tests, discovery, production build, and both uploader harnesses. The fresh discovery count is 270 executable files and three archives. Uploader totals are PowerShell 93 passed/0 failed and Bash 47 passed/0 failed.

Receipts: `focused-live.raw.log`, `npm-ci-live.raw.log`, `focused-after-install.raw.log`, `full-gate-live.raw.log`, and `verification-receipt.json`. The full-gate receipt preserves the available tool output and discloses 3,784 tokens omitted from the middle of the build output by the tool. It is not complete stdout. Stage results and the successful exit were captured, so the passing gate was not repeated solely to replace build chatter.

| Acceptance criterion | Evidence |
| --- | --- |
| Explicit late section candidate after more than 30 earlier rows returns only its eligible sections in production order | `convex/candidateScopedBoundedReads.test.ts:143`; baseline failure receipt; fresh focused and canonical pass |
| Explicit candidate from another generation returns no rows | `convex/candidateScopedBoundedReads.test.ts:207`; fresh focused and canonical pass |
| Selected candidate after more than 10 earlier runs returns only its Compliance Notes | `convex/candidateScopedBoundedReads.test.ts:274`; baseline failure receipt; fresh focused and canonical pass |
| No explicit candidate retains bounded section aggregation; unresolved selection retains intended unscoped fallback | `convex/candidateScopedBoundedReads.test.ts:201`, `convex/candidateScopedBoundedReads.test.ts:329`, and `convex/candidateScopedBoundedReads.test.ts:376`; fresh focused and canonical pass; unchanged no-candidate branch in the source diff |

## Ownership and preservation

`invocation-snapshot.json` captures the pre-existing working bytes before this pass changed the spec. `native-ledger-provenance.json` links the exact ledger SHA-256 `e2a9e2589c56d9fcb6d107d76407f631c30c1e4fa8c08678db160f4aea09d18a` to native journal line 337, the orchestrator's close of DW-121 and DW-122. Those unchanged bytes may be staged under the supplied native-finalization rule. No ledger status, resolution, native state, or board entry was authored or rewritten by this pass.

The earlier `../preservation-final.raw.log` is historical evidence of the original implementation pass before the native close. It is not the reference hash for the later ledger bytes. This pass uses its invocation snapshot instead. `preservation-before-finalization.json` confirms all original tracked source and historical evidence bytes remain unchanged except the intended spec edit. `staged-preservation.json` confirms final working-tree and staged ledger bytes equal this invocation snapshot, and all original tracked source and historical evidence remain unchanged except the intended spec update.

The implementation retains the 30-row per-candidate section bound and first-match tolerance for duplicate present candidate IDs. No production-data audit or migration was performed. No UI component was changed. No push, deployment, or native acceptance is claimed.
