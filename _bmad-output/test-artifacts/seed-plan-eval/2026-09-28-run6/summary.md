# Step by step release suite, 2026-09-28

Deployment `local`, commit `c8ce1fe2`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 19 |  |  |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 12 pass, 0 fail | 19 |  |  |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 14 pass, 1 fail | 14 |  |  |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 11 pass, 1 fail | 16 |  |  |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 10 pass, 3 fail | 18 |  |  |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 12.3 s (placeholder 12 s: over), p95 24.7 s (placeholder 30 s: within), over 69 Batches.
- Foreground dispatch to first render: median 18.4 s, p95 26.4 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 157.1 s, p95 186.1 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 19, 19, 14, 16, 18 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.19 in all, $1.97 of it in the seed stage.

Raw data for every fixture is in `results.json`.
