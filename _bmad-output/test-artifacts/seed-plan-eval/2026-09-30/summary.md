# Step by step release suite, 2026-09-30

Deployment `local`, commit `67be8f06`, acting as e2e-audit@banhall.local. The suite is release-blocking (CAP-13): every fixture must be judged pass by the reviewing manager before release. Record each verdict in its fixture file and in the table below.

| Fixture | Semantic case | Automatic checks | Seed requests | Verdict (pass or fail) | Judged by |
| --- | --- | --- | --- | --- | --- |
| [carried-old-selections](carried-old-selections.md) | Carried old selections | 14 pass, 0 fail | 16 | pass | AI judges (delegated by the owner) |
| [changed-advancement-links](changed-advancement-links.md) | Changed advancement links | 16 pass, 1 fail | 16 | fail | AI judges (delegated by the owner) |
| [exclusion-conflict](exclusion-conflict.md) | Exclusion-matching selection | 15 pass, 0 fail | 15 | pass | AI judges (delegated by the owner) |
| [skipped-role-supported](skipped-role-supported.md) | Skipped role supported by the Brief | 12 pass, 0 fail | 14 | pass | AI judges (delegated by the owner) |
| [withdrawn-feedback](withdrawn-feedback.md) | Corrected then withdrawn Feedback | 12 pass, 1 fail | 18 | pass | AI judges (delegated by the owner) |

## CAP-14 numbers (placeholders are reported against, never changed here)

- Dispatch to validated result: median 11.7 s (placeholder 12 s: within), p95 22.3 s (placeholder 30 s: within), over 69 Batches.
- Foreground dispatch to first render: median 15.3 s, p95 15.6 s over 5 (unthresholded; script-observed, so it includes the script's polling).
- Sign-off to report created: median 162.9 s, p95 209.6 s over 5.
- Single-mode baseline not measured (run with --single-baseline).
- Seed-stage requests per generation: 16, 16, 15, 14, 18 (notice at 40; counter-metric median at most 20, p95 under 40).
- Cost from aiUsage: $5.27 in all, $1.87 of it in the seed stage.

Raw data for every fixture is in `results.json`.

## Judgment, 2026-09-30

Judged on the product owner's instruction by two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), under the AGENTS.md reviewer rule (models interchangeable, recorded), and by the lead (Claude Opus 5.5 at extra-high effort), who found the main defect independently and checked the judges' evidence against the pack and `results.json`. The judges agreed on every verdict: 4 pass, 1 fail. The release gate (checklist step 3: every fixture must pass) is **not met**.

All three run 6 defects are fixed where they were found: Feedback now governs a Glossary Term in every Line (withdrawn-feedback), a confirmed exclusion pick is drafted and checked (exclusion-conflict), and the Seed-stage link rule refuses experiments and advancements for a dropped uncertainty (changed-advancement-links).

The one failure is a product defect, systematic rather than model variance:

1. **changed-advancement-links.** Drafting is never told which uncertainties the writer kept, so the Brief's Storyline and Confidence Map put the dropped uncertainty (seed fraction at 6 C) back: Line 244 narrates its unticked trial and Line 246 paragraph 3 claims its result. Lines 244 and 246 also describe dosing and sensor work for uncertainties Line 242 never states. Run 6 reached the same symptom through the Seed link rule; run 10 reaches it through the Brief.

Majors a consultant would fix: Line 246 "This became the start-up method for biofilters commissioned below 10 C" is in no source (changed-advancement-links); Line 244 covers only Trials 1 to 3 while Line 246 says the capture and thermal shock objective was largely met (carried-old-selections, following the scripted writer's picks); Lines 244 and 246 claim a reference-channel advancement for an uncertainty Line 242 states only as a limitation (skipped-role-supported). Every sourced figure the judges checked matches the fixture sources.

The two failed automatic checks: the changed-advancement-links coverage row ("P6 cites 9-10 weeks untreated") is a Self-check false negative, since the paragraph is plan item 13 word for word and interview line 13 says "9 to 10 weeks"; the withdrawn-feedback Subsection 9 heuristic reports that those Seeds name the tool with neither term, which is not a breach.

Next: tie drafting to the uncertainties the writer kept, so no Line states, tests or resolves another, checked by the Self-check; then rerun all five fixtures at the fixed commit and judge again.

Research both judges applied (sources in their reports): T4088 and CRA's Claim Review Manual (Line 244 is work on the Line 242 uncertainties and Line 246 the advancements from that work; an advancement not tied to a stated uncertainty is a red flag); SR&ED firms have a specialist review every draft and trace claims to evidence; regulated-domain AI vendors grade against expert rubrics where one missing critical element fails a case, measure groundedness separately, use several raters, and retest after every change (Harvey BigLaw Bench, Microsoft Foundry groundedness, Stanford RegLab, NIST AI 600-1).
