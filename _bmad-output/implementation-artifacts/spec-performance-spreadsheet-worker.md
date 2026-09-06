---
title: Responsive spreadsheet extraction
type: refactor
created: 2026-09-06
status: done
baseline_commit: 201e46bd72c89ac2d59ad41022102b88b3f8433f
review_loop_iteration: 0
context:
  - "{project-root}/AGENTS.md"
  - "{project-root}/docs/svelte-migration.md"
---
<frozen-after-approval reason="User authorized implementing and pushing audited performance improvements">
## Intent
Remove the reproduced multisecond browser freeze during XLS/XLSX extraction while preserving extracted output and errors. Run spreadsheet work in a browser worker, returning capped text only. User has authorized implementation, verification and push; no additional spec approval is needed.
## Boundaries & Constraints
Always preserve XLS/XLSX/CSV support, sheet ordering/headings, whitespace normalization, blank-row handling and current truncation marker semantics. Use a transferred ArrayBuffer and terminate workers on completion, failure or cancellation. Keep worker tasks bounded rather than multiplying memory usage across arbitrary concurrent files. Existing non-spreadsheet extraction is unchanged.
Ask first only for new domain permissions or loss of supported file formats. Never upload fixtures, change Convex/schema, hand-edit generated files, or silently fall back to synchronous browser XLSX parsing after a worker failure.
## I/O & Edge-Case Matrix
| Scenario | Input | Expected | Error handling |
|---|---|---|---|
| Workbook | XLS or XLSX, blank and formatted/quoted cells, multiple sheets | Exact existing output | Preserve extraction errors |
| Large workbook | 20k rows by 20 text columns | Existing capped output while main thread stays responsive | No silent truncation changes |
| Abort | pre-aborted or aborted pending request | AbortError, worker terminated, no stale result | Caller must not continue uploading on abort |
| Worker failure | load/runtime or malformed message | Request rejects, resources released | No synchronous browser fallback |
</frozen-after-approval>
## Code Map
- src/lib/parseDocument.ts:234: synchronous XLSX.read/sheet_to_csv; cap happens after conversion. Existing tests in src/lib/parseDocument.test.ts.
- .audit/performance-audit-20260906/parser-profile.json: baseline CPU4 large workbook longest task 4923–4930 ms; existing harness fixtures and parser-profile.mjs available read-only.
- FilesPanel, AgentChatPanel and new/review intake callers catch extraction errors and may proceed with empty text: preserve ordinary failure contracts, bypass them on AbortError if cancellation is wired.
## Tasks & Acceptance
- [x] Extract shared spreadsheet conversion and worker protocol/client; use browser worker from parseDocument. Non-browser test execution may call shared conversion directly.
- [x] Support AbortSignal and truthful phase progress. Wire cancellation to owning upload lifecycle where practical without inventing new visual flows; protect stale results.
- [x] Add meaningful exact-output parity tests for XLS/XLSX, blanks/formatting/truncation and actual browser worker lifecycle/error/abort coverage. Do not rely solely on mocked Workers.
- [x] Create rerunnable production responsiveness probe and evidence under .audit/performance-improvements (never overwrite baseline).
Acceptance: Given representative workbooks, worker and baseline output match exactly. Given a large synthetic workbook, browser can animate/accept input during extraction and parser-induced main-thread tasks are below 100ms in calibrated CPU4 profile after module warmup. Given abort/failure, request settles and worker resources are released without a stale success.
## Spec Change Log
## Verification
Run focused parser and worker browser tests. Record actual test commands and results. Parent runs full canonical and component gates after sequential implementation units. Do not commit or push from the implementation subtask. Do not edit outside parser-related implementation/tests/callers or overwrite other evidence. Report any unmet acceptance explicitly.

## Final Verification

All nine steps of `VERIFY_COMPONENT=1 bash scripts/loop-verify.sh` passed on the final implementation: 2,090 unit tests, 580 browser component tests, both typechecks, discovery guard, production build and both uploader harnesses. Focused independent review findings were resolved and reinspected. Final sequential benchmark results, source hashes, limitations and reproduction commands are committed in [performance evidence](../../docs/performance-improvements-2026-09-06/README.md).

## Suggested Review Order

**Worker ownership**

- Transfer one workbook at a time; cancel, time out, and release resources.
  [spreadsheetClient.ts:47](../../src/lib/spreadsheetClient.ts#L47)

**Extraction parity**

- Keep sheet formatting and output limits identical.
  [spreadsheetText.ts:6](../../src/lib/spreadsheetText.ts#L6)

**Upload lifecycle**

- Capture the upload owner before asynchronous work.
  [extractionScope.svelte.ts:3](../../src/lib/extractionScope.svelte.ts#L3)

- Guard upload completion before generation or navigation.
  [+page.svelte:619](../../src/routes/project/new/+page.svelte#L619)

**Verification**

- Exercise actual workers, parity, cancellation, timeouts, and queue recovery.
  [spreadsheet.component.test.ts:1](../../src/lib/spreadsheet.component.test.ts#L1)

- Reproduce main-thread responsiveness with synthetic workbooks.
  [spreadsheet-probe.mjs:5](../../scripts/performance/spreadsheet-probe.mjs#L5)

## Astra High Review Findings

- [x] [Review][Patch] Quote YAML context paths.
- [x] [Review][Patch] Clear cancelled chat upload receipts and retained files.
- [x] [Review][Patch] Guard late replacement failure handling after owner cancellation.
- [x] [Review][Patch] Cover actual replacement consumers at read and mutation boundaries.
- [x] [Review][Patch] Preserve pending extraction across unchanged-owner rerenders.

Astra high follow-up: all patch findings above are resolved. The complete nine-step gate and independent reinspection passed; [review and verification record](../../docs/performance-improvements-2026-09-06/astra-high-review.md).
