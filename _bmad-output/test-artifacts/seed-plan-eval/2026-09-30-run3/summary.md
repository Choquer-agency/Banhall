# Step by step release suite, 2026-09-30

Deployment `local`, commit `c17f2494`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 17 | pass | AI judges (delegated by the owner) |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 20 pass, 1 fail | 20 | pass | AI judges (delegated by the owner) |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 15 pass, 0 fail | 15 | pass | AI judges (delegated by the owner) |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 12 pass, 0 fail | 19 | pass | AI judges (delegated by the owner) |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 13 pass, 0 fail | 21 | pass | AI judges (delegated by the owner) |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 11.6 s (placeholder 12 s: within), p95 23.8 s (placeholder 30 s: within), over 71 Batches.
- Foreground dispatch to first render: median 15.0 s, p95 25.6 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 152.0 s, p95 153.0 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 17, 20, 15, 19, 21 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.81 in all, $2.20 of it in the seed stage.

Raw data for every fixture is in `results.json`.

## Judgment, 2026-09-30 (run 12)

Judged on the product owner's instruction by two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), under the AGENTS.md reviewer rule, and by the lead (Claude Opus 5.5 at extra-high effort), who checked the key evidence against the pack and `results.json`. The judges agreed on every verdict: 5 pass. The release gate (checklist step 3: every fixture must pass) is **met** at commit `c17f2494`, which carries the owner's "fix all" round (amendments 2026-09-30 second, third and fourth).

Run 11's majors: the "close to but not exceeding" target sentence, the source-provenance phrases, the Brief-only sensor experiment in Line 244, the exclusion row wording, the Line 242 "floating head" row, the Glossary grammar slips and the scripted goal switch are fixed; the capture chain gap did not reproduce. No leave-out, Rule B or Rule C repair removed signed-off work.

The one failed automatic check (changed-advancement-links, Line 244): signed-off Hypothesis item 8 is a dosing hypothesis, carried and confirmed after the writer dropped the dosing uncertainty, and Line 244 states the Brief's acclimation hypothesis instead. Both judges: not a blocker (stating it would have been an orphan hypothesis, which CRA flags; the Compliance Note reports it), but a major systematic product defect.

Follow-ups, from both judges:

- Give Hypothesis (and Work plan) an uncertainty link with the fourth amendment's refusal, and do not let "a COVER item wins" force an item whose only subject is a dropped uncertainty.
- Keep a dropped uncertainty's next steps out of Line 246 unless a signed-off item holds them.
- Tune the targets check (6 of 10 not-applied rows were false positives) and the consistency pass (false contradictions in every fixture); both are Compliance Note noise, neither changed a Line.
- Keep unsourced reasons and unmeasured field results out of Line 246 (carried-old-selections paragraph 6, a major for the consultant).
- Prove the fourth amendment's refusal and acknowledgement paths live: in this run no result pick answered the dropped uncertainty, so they did not fire.

Every sourced figure the judges checked matches the fixture sources.
