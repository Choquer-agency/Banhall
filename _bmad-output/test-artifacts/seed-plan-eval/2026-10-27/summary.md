# Step by step release suite, 2026-10-27

Deployment `local`, commit `08a53a18`, acting as chat-live-1793085355051@example.test. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 20 |  |  |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 22 pass, 0 fail | 21 |  |  |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 13 pass, 2 fail | 16 |  |  |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 12 pass, 0 fail | 16 |  |  |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 6 pass, 7 fail | 21 |  |  |
| [writer-settings-document](writer-settings-document.md) | Writer settings document | 16 pass, 0 fail | 17 |  |  |

Settings rules broken (writer-settings-document): Line 242: 0 of 18; Line 244: 0 of 16; Line 246: 0 of 16; overall: 0 of 20.

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 6.0 s (placeholder 12 s: within), p95 12.9 s (placeholder 30 s: within), over 80 Batches.
- Foreground dispatch to first render: median 12.7 s, p95 16.9 s over 6 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 98.1 s, p95 107.9 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 20, 21, 16, 16, 21, 17 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $6.70 in all, $2.96 of it in the seed stage.

Raw data for every fixture is in `results.json`.
