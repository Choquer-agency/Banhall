# Native deferred-work closure plan

Planning only. No ledger, native state, journal, heartbeat, or runtime tool configuration was changed. DW-103 implementation is reported by root; Q8/DW-104/DW-105 remains pending. This document does not assert acceptance for any of them.

## Authority and precedent

`AGENTS.md:63–65` assigns ledger content/status to the native BMAD orchestrator and permits finalization of unchanged orchestrator-written bytes when journal/state **or invocation snapshot** establishes provenance. Calling a Python API does not grant an implementation worker ownership: root must perform this as the authorized orchestrator finalization, with an invocation receipt. Workers must not write the ledger.

Existing local precedents:

- `.audit/branch-consolidation/B12/deferred-closure.json`: native `bmad_loop.deferredwork.mark_done`, DW-100, before/after hashes and preservation result. B12 evidence records closure only after the complete gate.
- `.audit/branch-consolidation/B13-r2/native-closure.json`: closes DW-101/102 using native API with per-ID notes, gate receipt, hashes and preservation of other entries. This is the closure receipt; the earlier B13 folder records rederivation, not final closure.
- `.audit/branch-consolidation/B7/native-deferral.json`: native `append_entries` created DW-104/105, preserving 103 existing entries. Do not append replacements or duplicates now.
- `.audit/DW-88/followup/invocation-snapshot.json` and `.audit/DW-48-DW-66/native-finalization.json`: ledger invocation SHA/blob, native closure provenance and working-tree/staged-byte equality.

## Installed supported primitive

Read-only `bmad-loop --version` reports **0.11.1**. Launcher interpreter: `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python`.

Installed source: `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py`, SHA-256 `170c14c0e2d874238d73ad060bf59b49050e73713a853ef7dc7fb7271cc9d872` at inspection.

Use public **`mark_done_many(path, dw_ids, date, note, *, notes=None) -> list[str]`** (`deferredwork.py:960`). It supports per-ID notes, validates their count before I/O, folds changes in memory and publishes through one native cross-process locked atomic write (`:892–991`). `mark_done` at1015 delegates to this primitive for one ID. This batch API is preferable to sequential closes because a later failure cannot leave only an earlier write applied. It only changes matching open statuses and inserts resolution notes; it does not regenerate the ledger.

Important semantics: missing/already-done IDs are skipped, not rejected. Atomic publication is **not** a guarantee all requested IDs were eligible. Prevalidate every intended ID and assert the returned IDs match the request. `ledger_lock` at777 is non-reentrant: never wrap the public mutator in an external `ledger_lock`; it acquires its own. Do not use private helpers. The ordinary API emits no undo marker; `mark_done_many_reopenable` is for transactions with a later rollback leg, unnecessary here after acceptance.

Read-only help exposes no standalone close-by-ID CLI. `confirm` handles stories parked awaiting operator actions; `decisions` answers existing pending decisions. Neither represents this closure. `run`, `sweep`, `resume`, `resolve`, or heartbeat activation would initiate unrelated orchestration and must not be invoked. No engine run/journal event needs to be forged.

## Preconditions and invocation

1. Root completes final canonical gates against the reviewed final source/lock bytes. Bind those hashes, exact commit, commands, exit codes, review conclusions and receipts to each passed ID. DW-103 requires actual storage mutation/reference preservation evidence; DW-104 requires installed peer satisfaction plus auth/client module evidence; DW-105 requires bounded graph resolution, compatibility checks and fresh audit result. Do not include either dependency ID while Q8 is pending.
2. Confirm no live orchestrator/session is authorized to mutate this ledger concurrently. Leave completed run state and paused automation state unchanged. The native lock serializes a write, but external snapshots are not a multi-file transaction.
3. Persist an audit-only invocation record **before** calling the API: absolute checkout and ledger path, UTC timestamp/date, HEAD, native version/source hash, intended passed IDs and exact per-ID notes, gate/evidence hashes, and complete before-ledger snapshot plus SHA-256/git blob. Preserve source/test hashes binding acceptance. Do not modify ledger text to prepare it.
4. Parse current ledger with native `parse_ledger`; verify unique IDs, requested entries open and expected starting ledger hash unchanged since snapshot. At inspection there are105 entries; DW-103/104/105 are open. Current ledger SHA-256 is `8bbab6e2c480a197cea4585e9d2d678b80ffd1439013df604500cfd1a24f630f`. Recompute at actual invocation, never assume this remains current.
5. Invoke installed interpreter with `-B` and public API once, using verified values loaded from the persisted invocation record. The essential call is:

```python
from pathlib import Path
from bmad_loop.deferredwork import mark_done_many
closed = mark_done_many(
    Path(invocation['ledger_path']),
    invocation['passed_ids'], invocation['date'], '',
    notes=invocation['resolution_notes'],
)
assert closed == invocation['passed_ids']
```

For the intended final all-pass state, `passed_ids` is exactly `["DW-103", "DW-104", "DW-105"]`; notes have the same positional order and cite actual evidence. If only DW-103 is accepted, submit only that ID, preserve104 other entries, and leave dependency IDs open. Do not put presumed success in notes. This is recommended future code, not an executed invocation.

## Post-write verification and provenance

Immediately snapshot the resulting ledger bytes and persist a completion receipt containing returned IDs, before/after SHA/blob, invocation identity and native API/source identity. Native API plus the recorded invocation is the provenance; do not label an agent-authored receipt an engine journal event.

Compare native parsed entries by ID: entry count and ordered IDs identical; every non-target body byte-for-byte identical. For all three closures, this preserves the other102 entries, including their historical open statuses. For each target, allow only the actual status-line update and inserted resolution note, preserving heading/origin/location/reason/source specification. Also compare text outside target spans to preserve preamble, headings, spacing, and non-entry content. Confirm target statuses are done with the recorded date and exact notes.

The ledger write and evidence receipt are not one atomic transaction. If execution is interrupted, inspect persisted pre-invocation data and actual ledger before retrying. Already-done skips must not be mistaken for new successful closures. Reconcile native-generated bytes and recover the receipt; never manually undo/rewrite the ledger to make evidence match. Unexpected differences stop staging and require investigation.

During later authorized git finalization, stage the exact native result only after validating provenance. Compare working ledger and `git show :_bmad-output/implementation-artifacts/deferred-work.md` byte-for-byte to the after-invocation snapshot, recording both hashes/blob IDs. Confirm no completed-run, journal, heartbeat, or unrelated ledger entry changed. A ledger-only metadata close does not retroactively prove code gates; gate source hashes must still match final source, and committing this close does not establish native run acceptance.
