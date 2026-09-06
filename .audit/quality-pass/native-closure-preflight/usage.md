# Native closure helper usage

Prepared `.audit/quality-pass/native-close.py`; **not executed against the real ledger**. No native run, heartbeat, ledger, source, index, or git refs were changed. `synthetic-selfcheck.json` records only in-memory comparisons using105 synthetic entries; it is not a closure receipt. The public native mutator was never called during preparation.

Run from `/Users/johnnynguyen/Documents/Repos/Banhall-quality-pass` using the installed native interpreter:

```
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python -B .audit/quality-pass/native-close.py prepare --acceptance .audit/quality-pass/final-acceptance.json
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python -B .audit/quality-pass/native-close.py execute
```

Root runs these only after Q8 is accepted and the final complete gate passes. Later, after root independently stages the verified native ledger bytes:

```
/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python -B .audit/quality-pass/native-close.py finalize
```

The helper never stages or commits. Finalize expects the invocation HEAD to remain current; use it before committing. Execute refuses an index change since prepare. Finalize allows staging changes but reruns source/evidence checks and compares the actual index ledger blob to the native after snapshot.

## Acceptance input contract

Root supplies one JSON object with these fields, derived from actual final gate/review evidence:

- `root`: exact absolute assigned checkout.
- `head`: exact final-gate HEAD.
- `date`: actual closure date `YYYY-MM-DD`.
- `q8_accepted`: true only after actual acceptance.
- `exclusive_ledger_writer`: true only after confirming no concurrent writer will run.
- `errors`: exactly `{"gate":[],"code":[],"index":[],"path":[]}`. This is root's review/error attestation, not evidence that the helper performs a new code review.
- `notes`: JSON object ordered DW-103, DW-104, DW-105, each a nonempty single-line exact resolution note with evidence references. All three must be eligible; the helper intentionally has no arbitrary-ID or partial-closure option.
- `source_hashes`: mapping of checkout-relative paths to SHA256 for every path returned by `git ls-files -z --cached --others --exclude-standard`, deduplicated, excluding `.audit/` and `_bmad-output/implementation-artifacts/deferred-work.md`. Capture this at final gate verification, not by relabeling a later snapshot as gate evidence. Includes manifests, tests, configuration and specifications; source change after prepare invalidates execution.
- `evidence_hashes`: nonempty relative-path/SHA256 mapping including final gate result, gate log and each target's actual review/runtime evidence.
- `target_evidence`: object mapping each of the three target IDs to a nonempty array of paths present in evidence_hashes.
- `gate_result`, `gate_log`, `gate_source_before`, `gate_source_after`: relative paths also present in evidence_hashes. The source manifests must come from the strengthened actual final gate. Their non-audit coverage and hashes must match source_hashes exactly, including symlink target hashes. Gate HEAD must match acceptance HEAD.

The actual gate-result JSON must contain `command: "VERIFY_COMPONENT=1 bash scripts/loop-verify.sh"`, numeric exit_code0, unexpected_changed_paths[], tracked_and_nonignored_paths_verified greater than0 and index_unchanged true, and log_sha256 matching the supplied hashed log. These match the existing quality-pass gate receipt shape. The helper does not manufacture a new successful gate receipt or infer acceptance from per-test counts.

All evidence path inputs must remain inside this checkout, be regular files, and not be symlinks. Source entries also support tracked symlinks: hash the UTF-8 target bytes from gate manifests, without following the link. Source file coverage is exact; added/deleted files invalidate it. It also independently rejects unmerged index entries and failing working/staged `git diff --check`. This is stricter than checking only declared errors.

## What each phase produces

`prepare` checks native module identity, HEAD/source/evidence/gate/path/index conditions,105 unique native-parsed ledger IDs, and all three target entries open. It saves full before bytes and an invocation JSON binding exact inputs, native module identity/version, helper hash, ledger SHA/git blob and index hash. No ledger write.

`execute` revalidates the invocation and current source/index/ledger hashes, writes an exclusive durable attempt marker, calls public `mark_done_many` **once**, snapshots actual after bytes and returned IDs, and requires the exact ordered IDs. It verifies every other102 raw entry bodies unchanged and compares the complete resulting ledger to an in-memory expected text containing only native status-line replacements and resolution insertions. The expected text is never written to the ledger. Full-text equality also proves preamble, gaps and other text outside target spans unchanged. After source/evidence checks still pass, closure.json records native provenance and verified delta.

`finalize` requires closure.json, verifies invocation binding and all current source/evidence conditions, compares working bytes and actual `git show :...` staged bytes to the native snapshot, rechecks preservation, and emits finalization.json. It performs no staging.

## Limits and interruption handling

The installed native module is pinned to the source hash inspected in the closure plan. A native upgrade stops the helper for re-review. No private native functions, ledger rewrites, state resumes, archive operations, or external native locks are used. The native lock is non-reentrant and provides atomic ledger publication only; it does not transact gate snapshots and evidence files. The operator must retain exclusive ledger ownership between prepare and execute; concurrent changes may be detected after publication and cannot be safely auto-rolled back.

Every evidence output uses exclusive creation and is flushed/fsynced. A previous attempt/partial output intentionally blocks retries. If the process stops after native publication, preserve all bytes and inspect the attempt marker, snapshots, and native-return receipt. Do not delete markers and rerun blindly, manually restore the ledger, or claim closure.json exists when it was not produced. Recovery of an interrupted invocation is deliberately a separate root investigation. Directory fsync and whole multi-file transaction recovery are not implemented.

The helper trusts root-authored acceptance facts and gate-time manifest provenance. It verifies binding/current bytes and concrete gate receipt fields; it cannot establish that supplied notes are semantically sufficient or that a root-generated hash manifest was actually collected during the gate. Root retains that evidentiary responsibility. The helper does not declare a completed native run accepted merely because these three entries close.

Root integration correction before any real invocation: updated the gate receipt field name, requires clean index and exact gate HEAD, directly binds both persisted gate source manifests, and supports the repository's13 tracked directory symlinks without dereferencing them. No real closure was run for this correction.
