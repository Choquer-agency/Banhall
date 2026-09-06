# Verified performance improvements

Implemented against main `201e46bd72c89ac2d59ad41022102b88b3f8433f` on 2026-09-06. [Machine-readable evidence](evidence.json) includes source hashes, final serial samples, and verification counts. These results describe the combined implementation.

## Changes

- Spreadsheet extraction runs in a worker, preserving existing XLS/XLSX text formatting and limits. One active workbook limits concurrent memory use; a 120-second active deadline and owner cancellation release the queue and stop stale upload work.
- Reports load only the selected workspace cohort. Assistant code and subscriptions start on first visible use after saved preferences are restored; the instance remains mounted afterward to preserve drafts and active responses. Optional tools and unopened detail queries wait until needed.
- Chat consumes accepted chunks through one persistent official AI SDK parser per stream, with frame-coalesced publication. Exact protocol parity, queued delivery, errors, cursor handling, and lifecycle cancellation are covered.
- Usage starts with the last 30 local calendar days. Explicit All time and custom ranges retain their existing exact queries.

## Measured results

The production spreadsheet harness tested 5,000/20,000 rows × 20 columns, two samples at each page CPU setting, after warmup. All eight samples preserved exact text and accepted input during parsing. At 20,000 rows with page CPU4, synchronous baseline main-thread tasks were 4,490–4,808 ms; worker runs had no observed tasks at or above the browser's 50 ms long-task threshold. Page CPU throttling does not equally throttle workers. This demonstrates responsiveness, not equivalent-CPU extraction speed.

For a standard framed 5,000-chunk chat stream in 50-chunk batches, full replay took 4,889–5,051 ms total versus 173–184 ms persistently. Largest batches were 179–201 ms versus 8–11 ms. All batches in nine samples matched the authoritative replay output. These are desktop Node v24.19.0 processing measurements, excluding network and browser rendering. Growing SDK snapshots still cost work.

The baseline report closure was 597,544 bytes of offline gzip. Each row below includes the shared route shell and selected report cohort; desktop rows also include the default open assistant.

| Report state | Estimated gzip bytes | Reduction |
|---|---:|---:|
| Current · assistant closed | 458,839 | 23.2% |
| Current · default desktop assistant open | 556,912 | 6.8% |
| Preview · assistant closed | 487,026 | 18.5% |
| Preview · default desktop assistant open | 583,540 | 2.3% |

These are static production module closures and per-file gzip estimates, not network transfer or measured route-ready latency. The shell-only number is intentionally not used as the report saving. Signed-in production navigation and field INP were not measured. Usage query latency was not benchmarked.

## Verification and reproduction

All nine canonical steps passed: Convex typecheck, zero Svelte errors/warnings, 2,090 unit tests, discovery guard, production build, 50 PowerShell uploader checks, 18 bash uploader checks, and 562 real browser component tests across 75 files, plus preflight. Browser tests use local Convex/auth stubs and actual components/workers; they do not certify live backend latency. Expected fixture error logs and existing development warnings remain in the test output.

Run from the repository root with Node 24, PowerShell 7, installed dependencies, and Playwright Chromium. Run these commands sequentially, with no concurrent tests/builds during timing probes:

```sh
VERIFY_COMPONENT=1 bash scripts/loop-verify.sh
node scripts/performance/report-bundles.mjs
node scripts/performance/spreadsheet-probe.mjs
node scripts/performance/streaming-probe.mjs
```

The scripts write local generated results under `.audit/performance-improvements`; fixtures never leave the machine. The bundle script uses the committed earlier audit as its baseline. Independent Astra review checked streaming and upload boundaries; Sol review checked parser/report changes and the decision trail. Review findings were resolved with cancellation/deadline fixes and queued/attached-file regression tests. No Convex schema or backend code changed. Original blob upload and metadata creation remain separate transactions, so a POST accepted before cancellation can still leave orphaned storage bytes.

BMAD records contain acceptance criteria and linked review order: [spreadsheet worker](../../_bmad-output/implementation-artifacts/spec-performance-spreadsheet-worker.md), [report loading](../../_bmad-output/implementation-artifacts/spec-performance-report-loading.md), [streaming and usage](../../_bmad-output/implementation-artifacts/spec-performance-streaming-and-usage.md).
