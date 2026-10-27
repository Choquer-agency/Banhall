# Step by step release suite, 2026-10-27

Deployment `local`, commit `08a53a18`, acting as chat-live-1793085355051@example.test. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 12 pass, 1 fail | 19 |  |  |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 5.2 s (placeholder 12 s: within), p95 11.6 s (placeholder 30 s: within), over 15 Batches.
- Foreground dispatch to first render: median 8.5 s, p95 8.5 s over 1 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 79.3 s, p95 79.3 s over 1.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 19 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $1.14 in all, $0.48 of it in the seed stage.

Raw data for every fixture is in `results.json`.
