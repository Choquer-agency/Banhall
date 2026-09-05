# Selective DW-96/97/98 disposition preparation

Read-only preparation, 2026-09-05. Installed `bmad-loop 0.11.1` inspected. No sweep, mutation, loop, code implementation, ledger edit or active-worker action was executed.

**Conclusion:** Neither the sweep CLI nor sweep skill supports selecting only these IDs. The installed native module does expose a selective, atomic public ledger-close primitive, `bmad_loop.deferredwork.mark_done_many`. It is suitable for recording these three verified dispositions after integration and combined gates, without executing deferred work. This is a programmatic native-module operation, **not a CLI subcommand or sweep run**; retain an explicit operator audit/commit because it does not create a native sweep journal.

## Why a scoped sweep is not available

- [SKILL.md](/Users/johnnynguyen/Documents/Repos/Banhall/.agents/skills/bmad-loop-sweep/SKILL.md:12) makes sweep automation-only and read-only for the agent. Steps2–3 require verifying and partitioning **every** open entry. [automation-mode.md](/Users/johnnynguyen/Documents/Repos/Banhall/.agents/skills/bmad-loop-sweep/automation-mode.md:56) requires `open_ids` exactly equal the ledger's open set, with every entry classified once. A three-ID result against a larger open ledger is invalid.
- [sweep.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/sweep.py:155) validates that full partition; [sweep.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/sweep.py:1243) constructs only `/bmad-loop-sweep` plus optional feedback, with no ID selection input. The [CLI parser](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/cli.py:4747) exposes project/no-prompt/decisions-only/max-bundles/repeat/max-cycles/dry-run/archive, no ID selector. `--max-bundles` limits execution, not triage scope.
- `--decisions-only` still calls full triage, closes all `already_resolved`, then processes decisions before skipping bundles ([sweep.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/sweep.py:700)). `--no-prompt` likewise does not limit classification or closure to selected IDs. `--dry-run` only inventories, so it cannot record disposition.
- `bmad-loop decisions` handles unanswered decisions from prior sweeps, not arbitrary review-followup rows ([cli.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/cli.py:3587)); it is not a selective close command. Do not coerce unrelated entries into skip/blocked/decisions or forge cached triage/state to manufacture selection.

## Native recording operation

The sweep's own resolved-entry phase calls `mark_done_many` with exactly the resolved IDs and per-entry evidence ([sweep.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/sweep.py:1251)). Its public implementation at [deferredwork.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py:960) changes selected open entries to `status: done <ISO date>` and adds a resolution note, returning the IDs actually changed. Missing/already-done IDs are skipped; per-ID note count is validated. It uses one cross-process locked read/edit/write and atomic replacement, preserving file mode and symlink semantics ([deferredwork.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py:892)). Do not wrap it in another `ledger_lock`: nested locking is prohibited ([deferredwork.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py:777)).

This primitive records triage outcomes only. It does not implement fixes, validate their correctness, rerun gates, commit files, push, process other decisions, or mark a native task completed. Those distinctions must remain explicit in the result report.

Safe sequence after root integrates the fixes and all combined gates pass:

1. Resolve the authoritative integrated ledger path from that project's configured implementation artifacts. Confirm no active writer remains, and that the checked integration commit contains all three repairs. Preserve the current ledger hash and inspect only DW-96/97/98 descriptions/statuses plus duplicate-ID validation.
2. Write a separate audit disposition plan for these three IDs. Each single-line evidence note should cite its independent follow-up review, integrated repair/source identity and exact combined gate receipts. Private commit hashes alone do not prove integration. This audit plan is not `deferred-sweep-triage/result.json`.
3. Use installed native Python and `deferredwork.classify(snapshot, ids)` to preflight the exact IDs ([deferredwork.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py:588)). Refuse unknown/malformed/duplicate target IDs; reconcile already-done entries instead of silently claiming a new close.
4. Call the public primitive **once**, with the real date and three evidence notes, after this preparation is satisfied:

```python
from pathlib import Path
from bmad_loop import deferredwork

ids = ["DW-96", "DW-97", "DW-98"]
# ledger is the resolved authoritative Path; closure_date is YYYY-MM-DD.
# evidence_notes contains one verified, single-line note per ID in this order.
changed = deferredwork.mark_done_many(
    ledger, ids, closure_date, "verified independent follow-up",
    notes=evidence_notes,
)
assert changed == ids
```

Run with `/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/bin/python`, which provides the inspected native package. A lock/state-root error is a refusal; do not replace it with an unlocked manual write. The assertion is a postcondition, not rollback: inspect an unexpected returned list before any further operation.

5. Inspect the resulting diff and parsed entries: exactly the selected status/resolution lines should change, with all unrelated entry bodies unchanged. Save changed IDs, before/after hashes and integration/gate evidence in root's audit, then commit only the concrete disposition change and its audit after source review. No sweep or unrelated backlog execution is needed.

## Other supported native mechanism, not appropriate retroactively

Normal native stories can declare `closes_deferred: [DW-96, DW-97, DW-98]` in their spec/manifest. The engine closes only declared IDs at the verified commit boundary, after review/checkpoints/pre-commit gates ([engine.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/engine.py:4304)); closure is never inferred from a code diff. The engine uses rollback-owned markers for that transaction ([engine.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/engine.py:4574)). Do not retrofit already accepted specs or start/replay a loop merely to annotate these independently integrated fixes. The ordinary `mark_done_many` deliberately omits rollback ownership and is the same final already-resolved path used by sweep; the reopenable variant is for an actual native transaction with a later rollback leg ([deferredwork.py](/Users/johnnynguyen/.local/share/uv/tools/bmad-loop/lib/python3.13/site-packages/bmad_loop/deferredwork.py:994)).

These steps are proposed for root's later execution. Nothing has been closed, and active story8 remains untouched.
