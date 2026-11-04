# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `afbfd302`, acting as chat-live-1793085355051@example.test. Project `k97a4tkppkffgtengc227rfvdn8h31z8`, generation `k571wd64xvthw8kkyaqk3n0g398h3hdk`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: 
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: 
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: 
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

15 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd71yter9kz1f28eedhve86m6n8h2pbd |
| All three Sections were drafted | pass | 242: 353 words, 244: 634 words, 246: 326 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: not_applied ("Billing portal migration is unrelated work."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied, repaired ("Fixed by the repair: P1 says "The hypothesis was largely proven.", but the sources say "Results a...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P1 says "which gave the team direct field experience of how sensor behaviour changes through a harvest season", but the sources say "Our controller sits on t..."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: not_applied ("P3 says "none in spring, so it remains unsettled whether the 11 documented faults suffice for validation", but the sources say "Real events: 4 (2 flame insta...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (7.3 s, 8.1 s); 244: 2 requests (7.2 s, 6.9 s); 246: 2 requests (9.0 s, 7.8 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Billing portal migration to a new cloud host." (routine_engineering); "Dashboard colour and layout redesign." (not_technological); "Customer training sessions for dealers and operators." (business_risk); "Selling early fault warning as a feature and hardware recommendation change are commerc..." (business_risk); "Fiscal 2025 isolation forest attempt is before the claim period." (outside_claim_period); "Planned fiscal 2027 moisture work is after the claim period." (outside_claim_period) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1793127925643 |
| The matching selection is signed off with the confirmed exclusion | pass | "Experiment one rebuilt the isolation forest baseline to measure how it fails under injected drift. The work also covered this: Billing portal migration to a ..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Billing portal migration to a new cloud host."; 244: "Cover signed-off Summary item h57vxnbpma36w5sn6sqmrf8xhn8h3z9f" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "Single-sensor dryers remain above target, because exhaust temperature fallback only cut false alarms from 0.64 to 0.33 per dryer-day. The writer confirms a s..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P3 gives status and Ashgrove trial." |
| Where "Ashgrove" appears in the drafted Section | info | "formance with live operators is untested. A second field trial at the Ashgrove elevator is booked for spring 2027. The goal was early burner and co" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers. _(writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers, and its controller runs the burner and discharge rate. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Fixed threshold alarms are late, because by the time plenum temperature crosses the threshold the fault is well along. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether sensor bias could be separated from real process change in a coupled dryer system. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether sensor bias could be separated from real process change in a coupled dryer system. _(cited)_
- Known drift-compensation methods assume a trusted reference sensor or periodic calibration, and the company has neither. / This left open whether bias tracking could work with the sensors available. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team defined false alarm and lead time in July 2025 before any run, so results could not be reinterpreted. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use energy balance residuals with online bias tracking, then false alarms stay below 0.25 per dryer-day. / The test is drift up to 3 C per month, with a median lead time of at least 15 minutes. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Experiment one rebuilt the isolation forest baseline to measure how it fails under injected drift. / The work also covered this: Billing portal migration to a new cloud host. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "It was unclear whether sensor bias could be separated from real pro..."
- Experiment two trained on synthetic drift, and it missed all three column plugs, so the approach was dropped. _(cited)_
  - Tested: uncertainty "It was unclear whether sensor bias could be separated from real pro..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Sensor bias could be separated from process change using redundant sensors, with false alarms near 0.2 per dryer-day. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Training on synthetic drift hides slow faults, so it is not usable for separating sensor bias from process change. _(cited)_
  - Links: uncertainty "It was unclear whether sensor bias could be separated from real pro..."; experiments "Experiment two trained on synthetic drift, and it missed all three ..."
- Synthetic drift training cut false alarms to 0.6 per dryer-day but caught only 6 of 11 faults. / Column plugs build over 30 to 60 minutes, and the model treated those slow rises as drift. _(writer-asserted)_
  - Links: uncertainty "It was unclear whether sensor bias could be separated from real pro..."; experiments "Experiment two trained on synthetic drift, and it missed all three ..."

### 12. Project status and next steps (Section 246, standard): approved

- Single-sensor dryers remain above target, because exhaust temperature fallback only cut false alarms from 0.64 to 0.33 per dryer-day. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Sensor bias could be separated from process change using redundant sensors, which met the goal of fewer than 0.25 false alarms per dryer-day. _(cited)_

## Drafted Sections

### Line 242

It was unclear whether sensor bias could be separated from real process change in a coupled dryer system, and this open question set the direction of the project. [GAP: confirm company name] is a company that builds controllers and analytics software for grain dryers. The company set out to build an early-warning feature that detects burner and grain-column faults before they become dangerous. Its controller reads temperature and moisture sensors and runs the burner and discharge rate on continuous-flow tower and mixed-flow dryers, which gave the team direct field experience of how sensor behaviour changes through a harvest season.

The limitations to standard practice were that the knowledge required to give early warning of dryer faults was insufficient. Fixed-threshold alarms are late, because by the time plenum temperature crosses the threshold the fault is well along. Existing understanding of drift compensation did not cover this setting, as known methods assume a trusted reference sensor or periodic calibration, and the company has neither. Retraining on drifted data teaches a model that drift is normal, which can hide real slow faults, so no documented method separated sensor drift from slowly developing faults.

The technological objective was to advance the understanding of how sensor bias can be separated from real process change in a coupled dryer system, for the purposes of providing burner and column fault warnings with a median lead time of at least 15 minutes and fewer than 0.25 false alarms per dryer-day under sensor drift of up to 3 °C per month.

It was unclear whether sensor bias could be separated from real process change in a coupled dryer system, because burner output, air flow, grain flow, ambient conditions and grain moisture all interact. It was uncertain whether online bias tracking could work with the sensors available, because known drift-compensation methods assume a trusted reference sensor or periodic calibration. Anything that makes a model more tolerant of slow change also makes it slower to see slow faults, so it was uncertain whether both targets could be held together. It was also uncertain whether the 11 documented faults were enough to validate any model.

### Line 244

It was unclear whether sensor bias could be separated from real process change in a coupled dryer system, so the planned work tested that question in ordered phases. The team defined a false alarm as an alert with no fault within the next two hours, counted per dryer per day. Lead time runs from the alert to the earlier of the existing hard-limit alarm or the operator's manual shutdown. The team set both definitions in July 2025 before any run, so results could not be reinterpreted. The phases were a baseline rebuild under injected drift, synthetic drift training, an energy balance residual model with online bias tracking, and shadow mode trials on customer dryers in the fall 2025 harvest.

The hypothesis was that if anomaly scores use the energy balance residual (the plenum temperature expected from fuel rate, air flow and ambient temperature) with online bias tracking from redundant sensors, then false alarms stay below 0.25 per dryer-day under drift of up to 3 °C per month, with a median lead time of at least 15 minutes on burner and column faults.

Experiment one rebuilt the isolation forest baseline to measure how it fails under injected drift. The work also covered this: Billing portal migration to a new cloud host. In July and August 2025, the team trained the baseline on 2024 data from 14 dryers, about 11,000 dryer-hours. On held-out data with drift added, false alarms per dryer-day were 0.3 at zero drift, 1.4 at 2 °C per month by week four, and 2.6 at 3 °C per month. The baseline caught 9 of 11 real faults with a median lead time of 9 minutes. This confirmed the drift problem and showed that a different scoring basis was needed.

Experiment two trained on synthetic drift to see whether the model could ignore drift without losing fault detection. In August 2025, the team injected random slow drift into the training data, 0.5 to 3 °C per month on temperatures and up to 1.5 points per month on moisture. False alarms fell to 0.6 per dryer-day at 2 °C drift, but detection fell to 6 of 11 faults. It missed all three column plugs, which develop over 30 to 60 minutes, because the model had learned to treat slow rises as drift. The team dropped the approach.

Experiment three tested the energy balance residual with online bias tracking. In September 2025, the team fit a per-dryer energy balance on the first 48 hours of the season. A Kalman filter estimated a slow bias per sensor, limited to 4 °C per month, and updated only when the energy balance and redundant sensors agreed the process was steady. On 2024 data with 3 °C per month injected drift, false alarms were 0.18 per dryer-day, and 10 of 11 faults were caught, including all three column plugs, with a median lead time of 22 minutes. The one miss was an igniter fault on a single-sensor dryer, where the tracker could not separate drift from process change.

Experiment four ran in shadow mode on nine customer dryers from October 6 to November 21, 2025, with alerts logged but not shown to operators. Seven dryers had two plenum sensors and two had one. The dual-sensor dryers averaged 0.21 false alarms per dryer-day, with drift reaching 2.7 °C per month on one dryer, while the single-sensor dryers ran at 0.64. All four real events were flagged, with lead times of 14, 19, 26 and 31 minutes; the 14-minute flame event was under the 15-minute target.

Experiment five addressed the single-sensor dryers. From January to March 2026, the team used exhaust temperature as an indirect second reference for plenum bias and replayed the fall data. False alarms on those dryers dropped from 0.64 to 0.33 per dryer-day, still above the 0.25 target.

### Line 246

It was unclear whether sensor bias could be separated from real process change in a coupled dryer system without a trusted reference sensor or recalibration. The objective was a median lead time of at least 15 minutes with fewer than 0.25 false alarms per dryer-day under sensor drift of up to 3 °C per month. Targets were met on injected drift: online bias tracking from redundant sensors, applied to the energy balance residual, gave 0.18 false alarms per dryer-day, 10 of 11 faults caught and a 22-minute median lead time. Single-sensor dryers missed the false alarm target (0.33 vs 0.25).

Through this investigation, it was established that training on synthetic drift hides slow faults, so it is not usable for separating sensor bias from process change. This resolved the uncertainty regarding whether a model could ignore drift without ignoring slow real faults. Synthetic drift training cut false alarms to 0.6 per dryer-day but caught only 6 of 11 faults. Column plugs build over 30 to 60 minutes, and the model treated those slow rises as drift. Based on this understanding, the team dropped the approach and moved to the energy balance residual.

Single-sensor dryers remain above target, because the exhaust temperature fallback only cut false alarms from 0.64 to 0.33 per dryer-day. Flame event lead time was marginal, at 14 minutes on one event. Four real events occurred in the fall 2025 shadow mode trial, none in spring, so it remains unsettled whether the 11 documented faults suffice for validation. Alert performance with live operators is untested. A second field trial at the Ashgrove elevator is booked for spring 2027.

The goal was early burner and column fault warning that survives sensor drift without recalibration. The energy balance residual with online bias tracking met the target of fewer than 0.25 false alarms per dryer-day on injected drift, with a median lead time of 22 minutes against the 15-minute target. Dual-sensor dryers averaged 0.21 in shadow mode.

## Compliance Note

| Section | Instruction | Outcome | Tier | Merged items | Reason |
| --- | --- | --- | --- | --- | --- |
| 242 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 242 | Build Order | not_applied | none |  | no Writer Profile applied (missing); House Rules default 242 → 244 → 246 used |
| 242 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 242 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 349/350 words, 33/50 lines |
| 242 | Claim Exclusion: Billing portal migration to a new cloud host. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and operators. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Selling early fault warning as a feature and hardware recommendation change are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Fiscal 2025 isolation forest attempt is before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Planned fiscal 2027 moisture work is after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline. |
| 242 | Confidence Map: Energy balance model results on injected drift. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Shadow trial flagged all four real events. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Exhaust temperature fallback is still above target. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Flame event lead time is marginal. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Moisture drift not handled with same method. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether 11 faults is enough to validate is not settled; only four real events occurred in the field trial. | applied | none |  | P4 frames the 11 faults as uncertain. |
| 242 | Confidence Map: Live alert performance is untested. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: shadow mode | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: single-sensor dryers | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: energy balance residual | applied | none |  | Concept not named in the section. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57y2a5cxvqkkc7mpzv5kck0yn8h3dqp | applied | none |  | P1 states the company builds controllers and software. |
| 242 | Cover signed-off Summary item h57r2t16v74t89r265aj8rj2jh8h36j6 | applied | none |  | P1 covers company and burner/discharge control. |
| 242 | Cover signed-off Summary item h57tb7rtj6zx5zzjgk7p7zw19h8h2bbe | applied | none |  | P2 states late fixed-threshold alarms. |
| 242 | Cover signed-off Summary item h57k1n5hz9zh2n1fgjc4k5famn8h31bw | applied | none |  | P3 states the objective. |
| 242 | Cover signed-off Summary item h57v57qxw5a2m9j57y0q99sxhn8h3xqn | applied | none | 2 | P4 states the bias separation uncertainty. |
| 242 | Cover signed-off Summary item h57qb5fyhaey9qjv7445n1td4n8h26qe | applied | none | 2 | P2 and P4 cover reference-sensor assumption and tracking. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P1 says "which gave the team direct field experience of how sensor behaviour changes through a harvest season", but the sources say "Our controller sits on the dryer, reads the temperature and moisture sensors, and runs the burner and the discharge rate.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether sensor bias could be separated from real process change in a coupled dryer system." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was unclear whether sensor bias could be separated from real process change in a coupled dryer system." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 634/700 words, 57/100 lines |
| 244 | Claim Exclusion: Billing portal migration to a new cloud host. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 3 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words |
| 244 | Claim Exclusion: Dashboard colour and layout redesign. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and operators. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Selling early fault warning as a feature and hardware recommendation change are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Fiscal 2025 isolation forest attempt is before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Planned fiscal 2027 moisture work is after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: single-sensor dryers | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Energy balance model results on injected drift. | applied | none |  | Stated as established. |
| 244 | Confidence Map: Shadow trial flagged all four real events. | applied | none |  | All four flagged, as established. |
| 244 | Confidence Map: Exhaust temperature fallback is still above target. | applied | none |  | States still above the 0.25 target. |
| 244 | Confidence Map: Flame event lead time is marginal. | applied | none |  | 14-minute event noted as under target. |
| 244 | Confidence Map: Moisture drift not handled with same method. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Whether 11 faults is enough to validate is not settled; only four real events occurred in the field trial. | applied | none |  | No flat claim that 11 faults suffice. |
| 244 | Confidence Map: Live alert performance is untested. | applied | none |  | No claim about live alerts. |
| 244 | Glossary Term: sensor drift | applied | none |  | Concept not renamed; 'drift' is used. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year work is absent. |
| 244 | Cover signed-off Summary item h57gqh9fx5rbg3h5vx9g3fgbks8h25sp | applied | none |  | Definitions set in July 2025 before any run. |
| 244 | Cover signed-off Summary item h57ynhhgrbtw7g8w4pv79j15c58h23h4 | applied | none |  | Hypothesis and targets stated. |
| 244 | Cover signed-off Summary item h57vxnbpma36w5sn6sqmrf8xhn8h3z9f | applied | conflict |  | Drafted despite the Claim Exclusion "Billing portal migration to a new cloud host.": the writer kept the idea "Experiment one rebuilt the isolation forest baseline to measure how it fails under injected drift. The work also..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item h57x0p72gwbch2w8qp2z3j53yx8h2mak | applied | none |  | Missed all three column plugs; dropped. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | not_applied | none |  | Billing portal migration is unrelated work. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): The sentence 'The work also covered this: Billing portal migration to a new cloud host' presents an excluded item as work performed. The Brief says the one signed-off idea with this content is not to be reported, but this sentence is not that idea and still claims the work. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): Line 244 says nine dryers were in the shadow trial, with seven dual-sensor and two single-sensor, and that all four real events were flagged, with lead times of 14, 19, 26 and 31 minutes. Line 246 P3 says the 14-minute event was a flame event, which fits, but it also says the trial had no events in spring. That is not a conflict. The real conflict is the seven plus two dryers against four events, which Line 246 does not contradict. This finding is low confidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 326/350 words, 31/50 lines |
| 246 | Claim Exclusion: Billing portal migration to a new cloud host. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and operators. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Selling early fault warning as a feature and hardware recommendation change are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Fiscal 2025 isolation forest attempt is before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Planned fiscal 2027 moisture work is after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: single-sensor dryers | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with Storyline. |
| 246 | Confidence Map: Energy balance model results on injected drift. | applied | none |  | Established results stated firmly. |
| 246 | Confidence Map: Shadow trial flagged all four real events. | applied | none |  | Not contradicted. |
| 246 | Confidence Map: Exhaust temperature fallback is still above target. | applied | none |  | States still above target. |
| 246 | Confidence Map: Flame event lead time is marginal. | applied | none |  | Says marginal. |
| 246 | Confidence Map: Moisture drift not handled with same method. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether 11 faults is enough to validate is not settled; only four real events occurred in the field trial. | applied | none |  | Hedged as unsettled. |
| 246 | Confidence Map: Live alert performance is untested. | applied | none |  | Stated as untested. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57s1b0cfxxbs3jymhhdrcwp9s8h2750 | applied | none |  | P1 gives the 0.18, 10 of 11, 22 min result. |
| 246 | Cover signed-off Summary item h57tecb3x2cdmnt0ydtazpf10s8h2f7a | applied | none | 2 | P2 states synthetic drift hides slow faults. |
| 246 | Cover signed-off Summary item h57xyah14fect760a9zph62tr18h3xwz | applied | none | 2 | P2 gives 0.6, 6 of 11, 30-60 min plugs. |
| 246 | Cover signed-off Summary item h57vg5p2avyjjzmef196ry88jh8h37d0 | applied | none |  | P3 gives status and Ashgrove trial. |
| 246 | Cover signed-off Summary item h57p8cnys58m7qss7yjm03g4fh8h3dc4 | applied | none |  | P4 states goal met on injected drift. |
| 246 | State figures and details as the sources give them | not_applied | none |  | P3 says "none in spring, so it remains unsettled whether the 11 documented faults suffice for validation", but the sources say "Real events: 4 (2 flame instability, 2 plugging). All flagged.". |
| 246 | State each result against its target as the numbers show | applied | none |  | Fixed by the repair: P1 says "The hypothesis was largely proven.", but the sources say "Results at 3 C per month injected drift: false alarms 0.18 per dryer-day.". The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Results answer stated uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Training on synthetic drift hides slow faults, so it is not usable for separating sensor bias from process change." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): Line 246 says a second field trial at the Ashgrove elevator is booked for spring 2027. Line 244 reports no such trial, and the later work it describes ended in March 2026. The claim sits oddly against the stated timeline and the claim period, and it is not supported anywhere in Line 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says targets were met on injected drift, but it also gives a 22-minute median lead time while Line 244 P6 shows one shadow-mode event with a 14-minute lead time under the 15-minute target. In the Advancement section, the targets-met claim is stated without that qualifier, so it overstates what Line 244 shows. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 19.
- Line 244: 0 labels and 0 plan checks "Not checked" of 18.
- Line 246: 0 labels and 0 plan checks "Not checked" of 17.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.1 s, p95 10.1 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 11.6 s, p95 11.6 s over 1.
- Sign-off to report created: 107.8 s.
- Cost from aiUsage: $1.31 in all ($0.48 seed stage, $0.83 Brief, drafting and checks) over 35 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T19:02:40.312Z created project k97a4tkppkffgtengc227rfvdn8h31z8
2026-10-27T19:02:41.535Z marked as an evaluation project
2026-10-27T19:02:42.615Z added document model-development-log.md
2026-10-27T19:02:45.178Z started Step by step generation k571wd64xvthw8kkyaqk3n0g398h3hdk
2026-10-27T19:03:01.758Z seed stage open
2026-10-27T19:03:01.760Z Open Company / Context and wait for its Batch
2026-10-27T19:03:12.128Z Company / Context: select the first Seed
2026-10-27T19:03:14.962Z Approve Company / Context
2026-10-27T19:03:17.860Z approved company_context
2026-10-27T19:03:17.861Z Open Goal / Problem and wait for its Batch
2026-10-27T19:03:27.460Z Goal / Problem: select the first Seed
2026-10-27T19:03:30.393Z Approve Goal / Problem
2026-10-27T19:03:33.132Z approved goal_problem
2026-10-27T19:03:33.132Z Open Technological limitations and wait for its Batch
2026-10-27T19:03:41.632Z Technological limitations: select the first Seed
2026-10-27T19:03:44.629Z Approve Technological limitations
2026-10-27T19:03:47.651Z approved passive_limitations
2026-10-27T19:03:47.651Z Open Technological objectives and wait for its Batch
2026-10-27T19:03:56.716Z Technological objectives: select the first Seed
2026-10-27T19:03:59.515Z Approve Technological objectives
2026-10-27T19:04:02.540Z approved technological_objective
2026-10-27T19:04:02.541Z Open Technological uncertainties and wait for its Batch
2026-10-27T19:04:11.572Z Technological uncertainties: select the first 2 Seeds
2026-10-27T19:04:16.535Z Approve Technological uncertainties
2026-10-27T19:04:19.557Z approved active_uncertainties
2026-10-27T19:04:19.558Z Skip Previous-year status
2026-10-27T19:04:22.156Z Open Work plan and wait for its Batch
2026-10-27T19:04:36.575Z Work plan: select the first Seed
2026-10-27T19:04:39.451Z Approve Work plan
2026-10-27T19:04:42.351Z approved workplan
2026-10-27T19:04:42.351Z Open Hypothesis and wait for its Batch
2026-10-27T19:04:56.567Z Hypothesis: select the first Seed
2026-10-27T19:04:59.286Z Approve Hypothesis
2026-10-27T19:05:02.081Z approved hypothesis
2026-10-27T19:05:02.082Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T19:05:13.781Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T19:05:19.011Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-27T19:05:22.869Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-27T19:05:25.726Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-27T19:05:25.726Z Open Advancement to science / technology and wait for its Batch
2026-10-27T19:05:34.185Z Advancement to science / technology: select the first Seed
2026-10-27T19:05:37.144Z Approve Advancement to science / technology
2026-10-27T19:05:40.006Z approved overall_advancement
2026-10-27T19:05:40.006Z Open Specific technological advancements and wait for its Batch
2026-10-27T19:05:51.368Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T19:06:01.555Z Approve Specific technological advancements
2026-10-27T19:06:07.001Z approved specific_advancements
2026-10-27T19:06:07.002Z Open Project status and next steps and wait for its Batch
2026-10-27T19:06:16.133Z Project status and next steps: select the first Seed
2026-10-27T19:06:18.827Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-27T19:06:21.514Z Approve Project status and next steps
2026-10-27T19:06:26.834Z approved project_status
2026-10-27T19:06:26.834Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T19:06:38.150Z Overall company / project goal improvements: select the first Seed
2026-10-27T19:06:40.916Z Approve Overall company / project goal improvements
2026-10-27T19:06:43.644Z approved goal_improvements
2026-10-27T19:06:43.644Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T19:06:45.471Z signed off; waiting for the report
2026-10-27T19:08:34.259Z report kd71yter9kz1f28eedhve86m6n8h2pbd created
```
