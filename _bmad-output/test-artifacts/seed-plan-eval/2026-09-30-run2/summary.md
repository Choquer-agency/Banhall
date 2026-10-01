# Step by step release suite, 2026-09-30

Deployment `local`, commit `9de29da9`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 16 | pass | AI judges (delegated by the owner) |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 18 pass, 1 fail | 15 | pass | AI judges (delegated by the owner) |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 15 pass, 0 fail | 17 | pass | AI judges (delegated by the owner) |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 11 pass, 1 fail | 15 | pass | AI judges (delegated by the owner) |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 12 pass, 1 fail | 18 | pass | AI judges (delegated by the owner) |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 11.8 s (placeholder 12 s: within), p95 20.8 s (placeholder 30 s: within), over 69 Batches.
- Foreground dispatch to first render: median 15.3 s, p95 23.7 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 136.9 s, p95 170.2 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 16, 15, 17, 15, 18 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.01 in all, $1.88 of it in the seed stage.

Raw data for every fixture is in `results.json`.

## Judgment, 2026-09-30 (run 11)

Judged on the product owner's instruction by two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), under the AGENTS.md reviewer rule, and by the lead (Claude Opus 5.5 at extra-high effort), who checked the key evidence against the pack and `results.json`. The judges agreed on every verdict: 5 pass. The release gate (checklist step 3: every fixture must pass) is **met** at commit `9de29da9`.

Run 10's one failure is fixed. In changed-advancement-links the writer dropped a different uncertainty this run (whether acclimation works at all, and the seed fraction at 6 C); none of the Seeds that recorded it reaches any Line, and Line 246 claims no advancement for an uncertainty Line 242 does not state. The acclimation result Line 246 does state comes from signed-off items 10 and 13, which win under the 2026-09-30 (first) amendment. Every COVER row is applied in all five fixtures, and no leave-out or Rule B repair removed signed-off work.

The three failed automatic checks are not product defects: the changed-advancement-links Line 244 leave-out row flags a signed-off experiment (a Self-check false positive), the skipped-role-supported "Orion-1" heuristic matched one clause of context, and the withdrawn-feedback Subsection 9 heuristic reports Seeds that name the tool with neither term.

Majors a consultant would fix before filing (none misleads CRA on a fact the sources give):

- withdrawn-feedback: Line 246 says 97.8 and 2.6 percent came "close to but not exceeding" the 97 and 3 percent targets, which both were met. Recurring (runs 6 and 11): the Brief's "only approached" hedge about test four is applied to the final result.
- carried-old-selections and changed-advancement-links: Line 244 (or Line 246) covers work for an uncertainty Line 242 never states, where the writer never ticked it (recorded limitation: Rule B covers Line 246 only).
- carried-old-selections, withdrawn-feedback: Confidence Map and Storyline repairs write source-provenance phrases into the prose ("The two interviewees describe ...", "the test memo indicates").
- changed-advancement-links: two unsourced Line 246 sentences.

Follow-ups for after release, from both judges: keep the Brief's hedges off final results; keep source-provenance phrasing out of repairs; carry an uncertainty link on Advancement to science (Subsection 10), so a claim refused in Subsection 11 cannot survive there; extend the Line 242 chain rule to Line 244; and quiet the leave-out row when the flagged content is a COVER item.

Research both judges applied (sources in their reports): T4088 and CRA's Claim Review Manual (Line 244 is work on the Line 242 uncertainties and Line 246 the advancements from it; an advancement or work with no stated uncertainty is a red flag); SR&ED firms have someone off the project review every draft and trace claims to evidence; regulated-domain AI vendors grade against expert rubrics where a missing critical element fails a case, measure groundedness separately, use several raters and rerun after every change (Harvey BigLaw Bench, Stanford RegLab, Microsoft Foundry, NIST AI 600-1).
