# DW-121 and DW-122 Evidence

Baseline revision: `087c76b18a8ad462498653651a3fcb971e31baf4`.

Reviewed implementation and evidence commit: `9d899dc0372844db966a5029d96cbbe6610c6723`.

## Raw receipts

- `baseline-failure.raw.log`: live focused command against exact baseline production blobs. Exit 1, with the two intended regressions failing and the unresolved legacy fallback control passing.
- `focused-final.raw.log`: live focused command against fixed source hashes. Exit 0, 3 files and 39 tests passed.
- `full-gate-final.raw.log`: live canonical verification against the same fixed source hashes. Exit 0, all nine stages passed.
- `post-review-focused.raw.log`: live verification after the accepted review patches. Exit 0, 3 files and 40 tests passed.
- `post-review-full-gate.raw.log`: live canonical verification after the accepted review patches. Exit 0, all nine stages passed.

The raw files were persisted from the exact command output returned by the execution tool. Each file identifies the capture as live command output and includes the actual exit code. Their SHA-256 receipts are recorded in `manifest.sha256`.

## Acceptance mapping

| Acceptance criterion | Proof |
| --- | --- |
| A requested candidate after more than 30 earlier section rows returns only its eligible rows in production order | `convex/candidateScopedBoundedReads.test.ts:143`; red in `baseline-failure.raw.log`, green in both post-review receipts |
| A candidate run from another generation returns no rows | `convex/candidateScopedBoundedReads.test.ts:207`; green in both post-review receipts |
| A selected candidate after more than 10 earlier runs returns only its Compliance Notes | `convex/candidateScopedBoundedReads.test.ts:274`; red in `baseline-failure.raw.log`, green in both post-review receipts |
| Unscoped section aggregation remains bounded and unresolved selection retains the existing fallback | `convex/candidateScopedBoundedReads.test.ts:201`, `convex/candidateScopedBoundedReads.test.ts:329`, and `convex/candidateScopedBoundedReads.test.ts:376`; green in both post-review receipts |

## Matrix test audit

All three I/O matrix rows are covered by the registered `convex/candidateScopedBoundedReads.test.ts` suite. The post-review focused receipt proves all four tests ran and passed. The post-review canonical receipt proves the suite was discovered within 189 passing test files and 2,683 passing tests; the discovery guard accounted for 269 executable test files and three historical archives.

## Source identity

The baseline receipt shows production blobs `0db11945f0bb6b81735381a4db037f832662524b`, `282e0bb570236789fb7442352c353e3fb22edc5e`, and `5318b747b7a272ffde779d51e37a5794028774be`, matching the baseline revision for `convex/schema.ts`, `convex/generations.ts`, and `convex/complianceNotes.ts`.

Both final receipts identify fixed blobs `9f288fef17a97eed6f94992c5558e8fcd2728f5b`, `503f11077f979ab625e1698b33eb561525ab63ed`, `45f352ae4d8fd6cbf47f5ab3f6a76ed2f882306e`, and test blob `445ab678907291733c047905122306ac6923b8b7`.

The post-review receipts identify final blobs `9f288fef17a97eed6f94992c5558e8fcd2728f5b`, `9b74d5ab8330a35ffe11ecab7f01242a2591d1cb`, `45f352ae4d8fd6cbf47f5ab3f6a76ed2f882306e`, and test blob `599e980aa81ecce48cb4f50c66e3e5f37eaf1fa6`.

## Independent review

Four review-only CLIs used `gpt-6-astra` with `xhigh` reasoning, read-only sandboxing, the existing `/Users/johnnynguyen/.codex` context, and `BMAD_LOOP_TASK_ID` unset. Each raw log records the actual CLI header and exit 0. `review-input.diff` is the frozen review input; the four `review-prompt-*.md` files and `review-*.raw.log` files preserve prompts and results.

## Protected bytes

- Deferred-work ledger: baseline and working Git blob `e484d55a75dc4a801b7a70b0af5030d607af4828`.
- `convex/_generated/`: zero tracked paths differ from baseline.
- Historical tracked `.audit/` content outside `.audit/DW-121-DW-122/`: zero paths differ from baseline.
- Native state and run history received no write action from this workflow. Native final acceptance remains owned by the orchestrator.

`preservation-final.raw.log` is the retained live command receipt for these final checks. It records baseline and working ledger hashes, generated and historical tracked-audit diff counts, protected-path status, and exit 0 after asserting all three tracked preservation conditions.

## Trail audit

The first bounded trail audit found three evidence-only discrepancies: incomplete manifest coverage, stale test line anchors, and no retained final preservation command. Those artifacts were repaired. `trail-audit-followup.raw.log` records an independent Astra/xhigh follow-up verdict of `PASS` with no discrepancies and exit 0.
