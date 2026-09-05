# Persisted PED native acceptance audit

Result: no actionable product or acceptance defect found in the assigned range. DW-93 is genuinely native-accepted at `b984822a8aeb70b7eb48a5d617ed18846392b1d2`, merged by `1cd1eb50f343007b3060c72d6ccbfaf5e0b72f35`. This audit does not establish final main acceptance or close DW-95.

Read-only assessment used the BMAD code-review skill, its resolved workflow, and the DW-93 flat spec as context. The explicit bounded independent-review assignment controls scope: no extra subagents, interactive checkpoints, lifecycle edits, broad gates or product changes were made. Convex guidelines were read. Completion checkout was clean before and after checks. Only this report and its companion snapshot were written.

## Native evidence

The live run `.bmad-loop/runs/20260904-162523-6e72/state.json`, task `dw-persisted-ped-native-followup`, records phase done, baseline `bdf5d0e34cdd23dd17f74baf5be5f6d2ca32096d`, accepted commit `b984822a8aeb70b7eb48a5d617ed18846392b1d2`, three completed Astra sessions, both review results done, review cycle 2 and one follow-up spent. All three result markers retain the correct baseline and DW-93 identity. State and exact journal entries are preserved in `ped-native-acceptance-snapshot.json`.

Live journal lines 128-130 show ordinary `bash scripts/loop-verify.sh` exit 0, proceed, then native DW-93 closure. Lines 133 and 136 show both reviews done. Line 137 deliberately refiles the remaining recommendation as DW-95 after the cap; line 138 records story-done with the accepted commit; lines 139-140 record successful merge into `codex/bmad-completion`. Thus acceptance is supported by state, results, gates and merge events, rather than inferred from ledger status. Git confirms accepted commit parent is exactly the requested baseline, and the merge has accepted commit as its second parent.

## Changes and retained verification

`git diff --name-only bdf5d0e b984822` contains 52 files: 50 DW-93 audit artifacts, the flat result spec and the orchestrator ledger. Explicit product diff across `convex`, `src`, `scripts`, package manifest and lockfile is empty. The original nested story and generated API were unchanged. Frozen formula, milestone, permissions and structural coverage decisions are therefore not reopened by this follow-up.

Current retained post-repair gate evidence: `.audit/DW-93/review-current/post-repair-full-gate.log:8` records zero Svelte errors/warnings; lines 17-18 record 148 files and 1,772 tests passing; the same log records uploader suites of 50 and 18 passes and discloses the PowerShell dotfile platform skip. `post-repair-ped.log` records 35 focused tests and exit 0. Native dev verification stdout/stderr are independently present with no truncation or capture error according to journal line 128; their hashes, sizes and contents are retained in the snapshot. These are inspected historical gate receipts, not new broad gate runs by this auditor.

`.audit/DW-93/review-current/integrity-before.log` retains the six staged false successes that prompted repair. `integrity-after.log:45` records all 44 normal/optimized cases passing; `reviews.md` records independent recheck. The actual verifier uses explicit requirements rather than optimization-disabled assertions, rejects incomplete inventories and invocation mismatches, checks every protected index path at `verify-preservation.py:54`, and rejects unknown or abbreviated flags. The audited defect repair concerns evidence integrity, not PED behavior.

## Live bounded checks and their limits

Ran the real preservation verifier from the clean accepted completion checkout in normal and optimized Python, with and without `--staged`. All four reject the invocation ledger hash at `verify-preservation.py:50`. This is the expected consequence of native DW-95 insertion after review, not an acceptance or product regression: `review-followup/invocation-snapshot.json` preserves the earlier ledger hash `2ec099…`, while the accepted ledger includes DW-95 at `_bmad-output/implementation-artifacts/deferred-work.md:773`. The audit verifier is invocation-bound and must not be represented as a current post-native full-ledger success.

Both normal and optimized invocations reject `--stage` and `--unknown` with exit 2. Separately, an explicitly synthetic in-memory overlay supplied only the historical ledger bytes, hash-object result and index result from `a338f6a08274e7a26b3f0195fb15424f7f30a1ed`. All remaining reads and Git checks stayed live. The real verifier with `--staged` then passed in both modes, confirming original-story preservation, generated provenance, formula text checks and all five staged comparisons under its original ledger boundary. This replay is isolated explanatory evidence, not a live current-ledger gate or a claim to have rerun the full 44-case suite. Exact stdout, stderr, exit statuses and method are in the companion snapshot.

The retained `review-current/finalization.log` records a successful staged finalization of 19 files at invocation `a338f6a`. Its executable at `review-current/verify-finalization.py:27` requires the result spec to be staged. It is intentionally a pre-commit check; a clean accepted checkout cannot reproduce that staged state without reconstruction. No index or native worktree was recreated or changed. The native PED worktree has already been removed, consistent with completed native merging. Parent is responsible for preserving its intermediate worker tip.

## Remaining recommendation

DW-95 remains an open low-severity deliberate later audit at ledger lines 773-779. Current review score 9 and `followup_review_recommended: true` match the native damping/refile event. There is no observed unresolved product choice or verified production defect behind that marker. Retain it honestly in the final inventory; do not reinterpret it as a failed PED story or silently mark it done.
