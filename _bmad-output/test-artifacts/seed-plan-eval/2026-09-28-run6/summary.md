# Step by step release suite, 2026-09-28

Deployment `local`, commit `c8ce1fe2`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 19 | pass | AI judges (delegated by the owner) |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 12 pass, 0 fail | 19 | fail | AI judges (delegated by the owner) |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 14 pass, 1 fail | 14 | fail | AI judges (delegated by the owner) |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 11 pass, 1 fail | 16 | pass | AI judges (delegated by the owner) |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 10 pass, 3 fail | 18 | fail | AI judges (delegated by the owner) |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 12.3 s (placeholder 12 s: over), p95 24.7 s (placeholder 30 s: within), over 69 Batches.
- Foreground dispatch to first render: median 18.4 s, p95 26.4 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 157.1 s, p95 186.1 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 19, 19, 14, 16, 18 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.19 in all, $1.97 of it in the seed stage.

Raw data for every fixture is in `results.json`.

## Judgment, 2026-09-28

Judged on the product owner's instruction by two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each at its default reasoning effort, under the AGENTS.md reviewer rule (models interchangeable, recorded) and the lead, who checked the key evidence against the pack. The judges agreed on every verdict: 2 pass, 3 fail. The release gate (checklist step 3: every fixture must pass) is **not met**.

The three failures are product defects that no commit after `c8ce1fe2` fixes:

1. **changed-advancement-links.** The Subsection 11 link rule is structural only: an advancement links an allowed uncertainty id, but nothing checks that it resolves that uncertainty. Line 246 claims the dropped start-up uncertainty resolved.
2. **exclusion-conflict.** A writer-confirmed selection that matches a Claim Exclusion is not protected in drafting (left out of Must keep and repair) and was dropped, while the Compliance Note's conflict row is written without checking the text.
3. **withdrawn-feedback.** Active Feedback wording is not a protected term at drafting, so the Brief's Glossary Term replaced it in every Line.

Majors a consultant would fix, worth a look before the rerun: "Quillmere Client" in place of the company name (exclusion-conflict), "97.8 percent ... just under the 97 percent threshold" (withdrawn-feedback), Line 244 citing a third uncertainty Line 242 does not state (carried-old-selections, changed-advancement-links). Every sourced figure the judges checked matches the fixture sources.

Two automatic failures are addressed by later commits but not yet proven on a live run: the mistyped Self-check verdict list (`fe84a8f2`) and the one targeted length cut (`70132834`). After the three defects are fixed, rerun all five fixtures at the release commit and judge again.

Research both judges applied (sources in their reports): T4088 and CRA's Claim Review Manual (plain technical language, advancements tied to stated uncertainties and tested experiments, accurate descriptions); SR&ED firms and tools review every draft by specialists and trace sentences to sources; regulated-domain AI vendors (Harvey, Thomson Reuters CoCounsel) grade against expert rubrics where one missing critical detail fails a case, measure groundedness separately, use multiple raters, and rerun after fixes rather than trust one run.

