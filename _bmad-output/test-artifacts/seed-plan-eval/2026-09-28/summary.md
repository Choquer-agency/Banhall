# Step by step release suite, 2026-09-28

Deployment `local`, commit `681d8e7b`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 7 pass, 3 fail | 13 |  |  |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 12.6 s (placeholder 12 s: over), p95 16.6 s (placeholder 30 s: within), over 13 Batches.
- Foreground dispatch to first render: median 18.3 s, p95 18.3 s over 1 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 166.4 s, p95 166.4 s over 1.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 13 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $0.93 in all, $0.35 of it in the seed stage.

Raw data for every fixture is in `results.json`.
