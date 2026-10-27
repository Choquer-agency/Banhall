# Step by step release suite, 2026-10-27

Deployment `local`, commit `8acd61e2`, acting as chat-live-1793085355051@example.test. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 15 pass, 0 fail | 16 |  |  |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 5.9 s (placeholder 12 s: within), p95 15.2 s (placeholder 30 s: within), over 13 Batches.
- Foreground dispatch to first render: median 11.3 s, p95 11.3 s over 1 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 86.3 s, p95 86.3 s over 1.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 16 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $1.23 in all, $0.47 of it in the seed stage.

Raw data for every fixture is in `results.json`.
