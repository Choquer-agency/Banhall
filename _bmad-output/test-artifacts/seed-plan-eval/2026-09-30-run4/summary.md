# Step by step release suite, 2026-09-30

Deployment `local`, commit `e8112000`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 18 | pass | AI judges (delegated by the owner) |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 25 pass, 0 fail | 17 | pass | AI judges (delegated by the owner) |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 14 pass, 1 fail | 18 | pass | AI judges (delegated by the owner) |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 11 pass, 1 fail | 16 | pass | AI judges (delegated by the owner) |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 13 pass, 0 fail | 20 | pass | AI judges (delegated by the owner) |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 12.0 s (placeholder 12 s: over), p95 23.9 s (placeholder 30 s: within), over 70 Batches.
- Foreground dispatch to first render: median 15.1 s, p95 17.7 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 136.4 s, p95 154.0 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 18, 17, 18, 16, 20 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.67 in all, $2.19 of it in the seed stage.

Raw data for every fixture is in `results.json`.

## Judgment, 2026-09-30 (run 13)

Judged on the product owner's instruction by two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), under the AGENTS.md reviewer rule, and by the lead (Claude Opus 5.5). The judges agreed on every verdict: 5 pass. The release gate (checklist step 3) is **met** at commit `e8112000`, which adds the owner-approved fifth amendment (Hypothesis and Work plan record the uncertainties they test).

The fifth amendment worked live in changed-advancement-links: run 12's hypothesis omission is fixed, and the refusals for a dropped uncertainty fired at Hypothesis, Experimentation, Specific advancements, Advancement to science and goal improvements. No signed-off work was removed in any fixture.

Majors for the consultant (none misleads CRA on a fact; every sourced figure checked matches the sources):

- changed-advancement-links: the dropped uncertainty's story survives through steps that carry no uncertainty link (objective, a limitation and the project status), confirmed by the writer after the drop.
- carried-old-selections: Line 246 claims capture and thermal shock results with no Line 244 work behind them; the Rule B check missed it.
- exclusion-conflict (Judge B major, Judge A minor): a Confidence Map repair softened signed-off item 13 toward the sources.

Follow-ups, after the owner's call: a link or a sign-off notice for Objective, Limitations and Project status; extend the "COVER item wins" guard to Confidence Map repairs and re-verify a shortened repair; tune the Rule B, targets and consistency checks; prove the figure acknowledgement live.
