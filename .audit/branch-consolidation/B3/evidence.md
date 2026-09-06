# B3 implementation evidence

Baseline: `0d481e2b76390e0eff3208d91f1f47d83b173474`, matching the approved spec. Work stayed in the parent checkout. Initial status contained only the untracked input spec. No staging, commits, remotes, installs, ledger edits, other-worktree changes or review dispatch occurred. Audit files are retained locally under this ignored directory.

## Change

`convex/documents.ts` evaluates the existing nonblank dedupe eligibility before collecting project documents. Blank content is stored exactly without reading unrelated bodies. Nonblank uploads retain the full collection and exact name/content comparison. Access/report checks and all storage, receipt, status, attribution and insertion branches remain unchanged.

`convex/documents.test.ts` adds eight executed cases (including parameterized cases). Existing assertions and tests are preserved byte-for-byte; `convex/uploadAttempts.test.ts` is unchanged.

## Acceptance evidence

| Requirement | Executed proof |
| --- | --- |
| Registered mutation, all four minimal fixtures, real transaction metrics | `empty and whitespace uploads keep document reads constant`; seed and verification run in separate transactions; registered upload called through `writer.mutation` / `ctx.runMutation`; metrics captured before verification. |
| Exact blank content and truthful image eligibility | Same test asserts exact persisted content, `reference_only`, `image_reference` for all four fixtures. |
| Separate blanks and resolved receipts | Existing `two unreadable files with the same name stay separate rows`, `each unreadable upload resolves only its own attempt`, whitespace dedupe test, and unchanged upload-attempt lifecycle suite. |
| Anonymous blank/whitespace rejects without writes | Both parameterized `anonymous blank upload` cases assert Authentication required and empty document/attempt tables. |
| Foreign report rejects without document/attempt changes | Both parameterized foreign-report cases seed another project/report, use a fresh attempt key, assert INVALID_INPUT and compare tables before/after. |
| Archived legacy exact duplicate preserves archive/trust and backfills status | Archived legacy case checks same ID, absence of uploaderRole before/after, and exact row equality except status/detail backfill. Existing tests also cover attributed role preservation and no status churn. |
| Text-only duplicate gains live blob/MIME | Storage upgrade case checks same ID, persisted blob/MIME, system metadata, live URL and original bytes. |
| Already-backed duplicate deletes only new orphan | Separate storage case checks unchanged original document, surviving original metadata/URL/bytes, null orphan metadata/URL. |
| Readable insertion/status, validators, replacement and receipts preserved | All original document tests and read-only uploadAttempts suite execute and pass. |
| Protected files and prior batches unchanged | `baseline-hashes.json`, `final-hashes.json`, `scope-check.txt`; SHA-256 comparisons of all tracked files allow only the two intended changes. |

## Observed before and after

| Content | Existing 100,000-character bodies | Baseline queries / reads / bytes | Fixed queries / reads / bytes |
| --- | ---: | --- | --- |
| Empty | 0 | 3 / 2 / 371 | 2 / 2 / 371 |
| Empty | 3 | 3 / 5 / 301046 | 2 / 2 / 371 |
| Whitespace | 0 | 3 / 2 / 371 | 2 / 2 / 371 |
| Whitespace | 3 | 3 / 5 / 301046 | 2 / 2 / 371 |

`baseline-red.log` retains all four measurements before assertions and the expected failure (exit 1), with documents.ts verified against its baseline SHA-256 before running. `fixed-metrics-visible.log` retains the identical regression's four post-fix measurements and pass (exit 0). The test code was unchanged between these runs. The default reporter suppressed passing console output, so the final metrics capture uses `--disableConsoleIntercept` without changing configuration or tests. An intermediate `--silent=false` attempt also passed but did not expose output.

`fixed-suites.log`: requested repaired-source command passed both files, 41 tests, exit 0.

`typecheck.log`: `node node_modules/typescript/bin/tsc -p convex/tsconfig.json --noEmit`, exit 0 (no diagnostics).

`diff-check.log`: `git diff --check`, exit 0 (no whitespace errors).

`commands.txt` records exact test/typecheck/diff commands and exit codes. The test run summaries and metrics above are from live runs, not historical planning evidence.

## Handoff and limits

Implementation and focused verification are ready for parent review. Per the spec, independent review and `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` remain parent-owned and were not run here. Nothing is staged or committed. This proves minimal blank-upload read independence, not nonblank dedupe capacity, deployment behavior or browser transport. Supported report/receipt/storage arguments may legitimately add reads. The pre-existing full nonblank collection remains intentionally unbounded.

## Intended file hashes

- `convex/documents.ts` baseline SHA-256 `3ab18a85774fc3bcdd44d68d680831ade83cbc15b1b08ea06c3c214167c8eab9`; final SHA-256 `a2efac59f3d8644b6778e3323112babd921ed35e19c34ef68d1eb0c7bb755753`.
- `convex/documents.test.ts` baseline SHA-256 `1f3d5562ba0dd5a2421529f7be86e8c3087720065aad983706ad00a80e689c73`; final SHA-256 `5a107f0ab57c0aff74a510381229a01f2280e012ba65ec83f0f670853d94eead`.
- `convex/uploadAttempts.test.ts` baseline SHA-256 `ea4e50bdec7322926f26efa6d724136eca2968aa26c2c0c267726c8993647a96`; final SHA-256 `ea4e50bdec7322926f26efa6d724136eca2968aa26c2c0c267726c8993647a96`.

## Parent acceptance

Three fresh Astra6 medium review layers completed. Root triage found no current-change defect; pre-existing storage cleanup is recorded separately as open DW-103 (native-deferral.json). Full canonical gate passed,2028 unit/481 browser tests plus typechecks, discovery, build and50+18 uploader harness assertions; gate/result.json binds the exact log and verifies5394 tracked paths. No source changes after focused verification/review. Nine generated historical captures were saved and restored by the gate helper. SPEC completion, native deferral and evidence packaging are subsequent metadata changes only.
