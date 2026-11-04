# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `8acd61e2`, acting as chat-live-1793085355051@example.test. Project `k978bz2brb6635gq8vbn0c83zn8h2m0c`, generation `k579vfjkbm95gcxr74mmwmv8ns8h3gqj`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd74r85pbyhjrnt6c83stsr1z98h383p |
| All three Sections were drafted | pass | 242: 297 words, 244: 685 words, 246: 343 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: not_applied ("Billing portal migration is neither stated nor needed evidence."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P1 says "which gave the team direct experience of how sensors behave across a harvest", but the sources say "Our controller sits on the dryer, reads the temp..."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Single-sensor dryers did not meet the limit."...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (6.8 s, 7.8 s); 244: 2 requests (6.6 s, 7.3 s); 246: 2 requests (7.1 s, 6.1 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Billing portal migration to a new cloud host" (routine_engineering); "Dashboard colour and layout redesign" (not_technological); "Customer training sessions" (not_technological); "Fiscal 2025 isolation forest attempt falls before the claim period" (outside_claim_period); "Planned fiscal 2027 moisture work" (outside_claim_period); "Selling early warning as a feature and competitive position" (business_risk) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1793121672905 |
| The matching selection is signed off with the confirmed exclusion | pass | "The team did not know if sensor bias separates from real process change, so it rebuilt an isolation forest baseline. The work also covered this: Billing port..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Billing portal migration to a new cloud host"; 244: "Glossary Term: false alarms per dryer-day"; 244: "Cover signed-off Summary item h57mz1599edaefm8wjnhdv4rkx8h3m0g" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model still needs a full season with alerts live, so live-alert performance is untested. The writer confirms a second field trial at the Ashgrove elevato..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P4 covers status and Ashgrove trial." |
| Where "Ashgrove" appears in the drafted Section | info | "ther the validation sample is sufficient. A second field trial at the Ashgrove elevator is booked for spring 2027. The knowledge gained answers the" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The goal is early fault warning on grain dryers, ideally 15 minutes or more before a fault becomes dangerous. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Fixed threshold alarms are late, because plenum temperature crosses the threshold when the fault is well along. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether a model could separate slow sensor drift from real faults that also develop slowly. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unknown whether the team could separate sensor bias from real process change in that coupled system. _(cited)_
- Real faults were rare, so it was unclear whether the data could validate any model. / The team had 11 documented faults with good data from the 2024 season. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned to learn whether sensor bias separates from real process change, using a physics-based energy balance. / The plan tracked each sensor's bias online with a Kalman filter, using redundancy between sensors. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use residuals of a physics-based energy balance with online bias tracking, then false alarms will stay below 0.25 per dryer-day. / The target holds with drift up to 3 degrees C per month, which tests whether sensor bias separates from real process change. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team did not know if sensor bias separates from real process change, so it rebuilt an isolation forest baseline. / The work also covered this: Billing portal migration to a new cloud host _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "It was unknown whether the team could separate sensor bias from rea..."
- Training with synthetic drift cut false alarms to 0.6 per dryer-day, but caught only 6 of 11 faults. / All 3 column plugs missed, so the team dropped the approach and changed direction. _(cited)_
  - Tested: uncertainty "It was unknown whether the team could separate sensor bias from rea..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team could not tell if sensor bias separates from real process change, and residual-based detection with bias tracking resolved it. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The team learned that a baseline isolation forest fails under drift, with 2.6 false alarms per dryer-day at 3 C per month. _(cited)_
  - Links: uncertainty "It was unknown whether the team could separate sensor bias from rea..."; experiments "The team did not know if sensor bias separates from real process ch..."
- Training on synthetic drift hides slow faults, because the model treated slow rises as drift. / It caught only 6 of 11 faults and missed all three column plugs. _(cited)_
  - Links: uncertainty "It was unknown whether the team could separate sensor bias from rea..."; experiments "Training with synthetic drift cut false alarms to 0.6 per dryer-day..."

### 12. Project status and next steps (Section 246, standard): approved

- The model still needs a full season with alerts live, so live-alert performance is untested. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team could not tell if sensor bias separates from real process change, and the energy balance with bias tracking answered it. / False alarms reached 0.18 per dryer-day at 3 C per month injected drift, against the 0.25 goal. _(cited)_

## Drafted Sections

### Line 242

Prairie Dryer Controls is a company that builds controllers and analytics software for grain dryers. The company set out to build an early warning feature that detects dryer faults at least 15 minutes before they become dangerous. Its controllers sit on continuous-flow and mixed-flow dryers and read plenum temperature, moisture and burner data, which gave the team direct experience of how sensors behave across a harvest.

The limitations to standard practice were that the knowledge to detect slow faults early on uncalibrated, drifting sensors was insufficient. Fixed threshold alarms are late, because plenum temperature crosses the threshold when the fault is well along. Published drift-compensation methods assume a trusted reference sensor or periodic calibration. No documented method existed for dryers with neither. No established basis showed whether sensor bias could be separated from real process change in a process coupled through burner output, air flow, grain flow and ambient conditions.

The technological objective was to advance the understanding of how sensor drift can be separated from real faults that also develop slowly. This had to work without labelled drift examples or a reference sensor. The purpose was to provide early burner and grain-column fault warning on grain dryers, with low false alarms per dryer-day and long lead time.

It was uncertain whether an energy balance residual, combined with online bias tracking, could separate sensor bias from real process change in that coupled system. A slow plugging column and a drifting sensor both raise temperature gradually. It was also uncertain whether low false alarms per dryer-day could be kept without losing lead time, because any tolerance for slow change delays detection of slow faults. Real faults were rare, so it was unclear whether the 11 documented faults with good data from the 2024 season could validate any model.

### Line 244

Prior to any testing, the team did not know whether sensor drift could be separated from slow real faults without labelled drift examples or a trusted reference sensor. The team planned to learn whether sensor bias separates from real process change, using a physics-based energy balance. The plan tracked each sensor's bias online with a Kalman filter, using redundancy between sensors. In July 2025, before running any experiment, the team fixed its definitions. A false alarm was any alert with no fault in the following two hours, counted per dryer per day. Lead time ran from the alert to the point where the existing hard-limit alarm or an operator shutdown would have occurred, whichever came first.

It was hypothesized that if anomaly scores use residuals of a physics-based energy balance with online bias tracking, then false alarms will stay below 0.25 per dryer-day with sensor drift up to 3 C per month. The same model should hold a median lead time of at least 15 minutes on burner and column faults. A result above 0.25, or a median under 15 minutes, would disprove it.

The team did not know if sensor bias separates from real process change, so it rebuilt an isolation forest baseline. The work also covered a billing portal migration to a new cloud host. The baseline trained on 2024 data from 14 dryers, about 11,000 dryer-hours at 1-minute resolution. It was tested on held-out data with injected drift of 1, 2 and 3 C per month. False alarms per dryer-day were 0.3 at zero drift, 1.4 at 2 C per month by week four, and 2.6 at 3 C per month. The baseline caught 9 of 11 real faults with a median lead time of 9 minutes. This confirmed that an unsupervised model on raw readings cannot tolerate drift, so a different way of handling drift was needed.

The team then tried to make the model ignore drift by learning it. Random slow drift was injected into the training data, 0.5 to 3 C per month on temperatures and up to 1.5 points per month on moisture. False alarms fell to 0.6 per dryer-day at 2 C drift, which looked promising. However, the model caught only 6 of 11 faults and missed all three column plugs, which develop over 30 to 60 minutes. The model had learned to treat slow rises as drift, so tolerance for drift and detection of slow faults traded directly against each other. The team abandoned the approach and changed direction completely.

In September 2025 the team built a per-dryer energy balance model. It predicted plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity, fit on the first 48 hours of the season. The anomaly score was the residual. A Kalman filter estimated a slow bias per sensor from two plenum sensors on most dryers plus the ambient sensor. The bias was limited to 4 C per month, and the filter updated only when the process was steady. On 2024 data with 3 C per month injected drift, false alarms were 0.18 per dryer-day, 10 of 11 faults were caught, and median lead time was 22 minutes. The one miss was an igniter fault on a dryer with a single plenum sensor, where the tracker could not separate drift from process change and absorbed the fault. Redundancy therefore proved more important than expected.

From October 6 to November 21, 2025, the team ran shadow mode on 9 customer dryers, 7 with two plenum sensors and 2 with one. Dual-sensor dryers averaged 0.21 false alarms per dryer-day, with measured drift up to 2.7 C per month on one dryer. Single-sensor dryers averaged 0.64. All four real events were flagged, with lead times of 14, 19, 26 and 31 minutes; the 14-minute flame event fell under the 15-minute target. In January to March 2026, the team used exhaust temperature as an indirect second reference for plenum bias through the energy balance. Single-sensor false alarms dropped from 0.64 to 0.33 per day, still above 0.25, so exhaust temperature only partly stands in for a second plenum sensor.

### Line 246

It was uncertain whether sensor drift could be separated from slow real faults without labelled drift examples or a reference sensor. Through this investigation, it was established that energy balance residual detection with online bias tracking separates sensor drift from real process change, partly proving the hypothesis. On injected drift of 3 C per month, false alarms per dryer-day were 0.18, within the 0.25 limit, and median lead time was 22 minutes against the 15-minute target. Single-sensor dryers missed the limit in the shadow trial, not on injected drift.

It was determined that a baseline isolation forest fails under sensor drift, reaching 2.6 false alarms per dryer-day at 3 C per month. Training on synthetic drift also hides slow faults, because the model treated slow rises as drift. It caught only 6 of 11 faults and missed all three column plugs. This resolved the uncertainty regarding whether drift tolerance and slow-fault detection could be had together by learning drift. Based on this, the team dropped that approach and moved to the energy balance with online bias tracking.

It was established that sensor redundancy decides whether bias separates from process change. In shadow mode on nine dryers, the seven dual-sensor dryers averaged 0.21 false alarms per dryer-day and the two single-sensor dryers 0.64. Exhaust temperature as an indirect reference cut the single-sensor figure to 0.33, still above 0.25, so it only partly replaces a second plenum sensor.

Live-alert performance is untested, because the model still needs a full season with alerts live. Single-sensor dryers remain above target, and the 14-minute flame event lead time fell under 15 minutes. With four real field events and 11 documented faults, it is unclear whether the validation sample is sufficient. A second field trial at the Ashgrove elevator is booked for spring 2027.

The knowledge gained answers the project goal of early burner and grain-column fault warning. Energy balance residuals with online bias tracking held false alarms at 0.18 per dryer-day under 3 C per month injected drift, against the 0.25 goal, and caught 10 of 11 faults.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 297/350 words, 30/50 lines |
| 242 | Claim Exclusion: Billing portal migration to a new cloud host | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Planned fiscal 2027 moisture work | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Selling early warning as a feature and competitive position | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Shadow trial dryer count and dates agree across sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Energy balance experiment results on injected drift. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Only four real events in the trial, so lead time evidence is thin. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Only 11 documented faults for validation. | applied | none |  | P4 hedges: unclear whether 11 faults could validate. |
| 242 | Confidence Map: Single-sensor dryers remain above target. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Moisture drift is not handled by the method yet. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Live-alert performance is untested; the transcript says a full season is still needed, and the log plans fall 2026. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: shadow mode | applied | none |  | Shadow mode concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57q3bez5xevyk5wr2zsb530ax8h3td1 | applied | none |  | P1 states what the company builds. |
| 242 | Cover signed-off Summary item h57rwp665n08srzngw3pwyy7nx8h3965 | applied | none |  | P1 states the 15-minute early warning goal. |
| 242 | Cover signed-off Summary item h57y8a5fwvhnfa29qkawvd4zbx8h25mc | applied | none |  | P2 covers late fixed threshold alarms. |
| 242 | Cover signed-off Summary item h57tw9xj8e394cspdfdpw2h6an8h3fg4 | applied | none |  | P3 states the drift vs slow fault objective. |
| 242 | Cover signed-off Summary item h57qmva6s7enhqabv3bj93r1kx8h33se | applied | none | 2 | P4 states the bias separation uncertainty. |
| 242 | Cover signed-off Summary item h57qdmncxzhk6w122gjpdy5j498h2c21 | applied | none | 2 | P4 covers 11 faults and validation doubt. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P1 says "which gave the team direct experience of how sensors behave across a harvest", but the sources say "Our controller sits on the dryer, reads the temperature and moisture sensors, and runs the burner and the discharge rate.". |
| 242 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 242 paragraph 1 (sections 242): Describing the early warning as a feature the company set out to build frames the work as a product feature. The exclusions bar selling early warning as a feature. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 685/700 words, 58/100 lines |
| 244 | Claim Exclusion: Billing portal migration to a new cloud host | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 3 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words |
| 244 | Claim Exclusion: Dashboard colour and layout redesign | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Planned fiscal 2027 moisture work | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Selling early warning as a feature and competitive position | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: false alarms per dryer-day | not_applied | conflict |  | Not enforced in this Line: the writer's edit to the signed-off idea "The team did not know if sensor bias separates from real process change, so it rebuilt an isolation forest baseline...." took this term out. The writer's wording outranks the Brief. |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with Storyline. |
| 244 | Confidence Map: Shadow trial dryer count and dates agree across sources. | applied | none |  | Dates and counts match. |
| 244 | Confidence Map: Energy balance experiment results on injected drift. | applied | none |  | Results stated as established. |
| 244 | Confidence Map: Only four real events in the trial, so lead time evidence is thin. | applied | none |  | States four events plainly, no overclaim. |
| 244 | Confidence Map: Only 11 documented faults for validation. | applied | none |  | No flat claim of validation. |
| 244 | Confidence Map: Single-sensor dryers remain above target. | applied | none |  | States still above 0.25. |
| 244 | Confidence Map: Moisture drift is not handled by the method yet. | applied | none |  | Moisture drift handling not claimed. |
| 244 | Confidence Map: Live-alert performance is untested; the transcript says a full season is still needed, and the log plans fall 2026. | applied | none |  | No live-alert claim made. |
| 244 | Glossary Term: energy balance residual | applied | none |  | Concept named as 'the residual'; not a clean replacement. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year work not described. |
| 244 | Cover signed-off Summary item h57n801tqtrk6f2psdrcg5frwx8h3wwq | applied | none |  | Workplan covered in P1. |
| 244 | Cover signed-off Summary item h57j5apwe1vet0ppbceyt7hf1h8h2jtt | applied | none |  | Hypothesis stated with targets. |
| 244 | Cover signed-off Summary item h57mz1599edaefm8wjnhdv4rkx8h3m0g | applied | conflict |  | Drafted despite the Claim Exclusion "Billing portal migration to a new cloud host": the writer kept the idea "The team did not know if sensor bias separates from real process change, so it rebuilt an isolation forest baseline...." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item h57m2wdp2vnsvb4kk8sbpwtern8h332h | applied | none |  | Synthetic drift experiment covered. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | not_applied | none |  | Billing portal migration is neither stated nor needed evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned to learn whether sensor bias separates from real process change, using a physics-based energy balance...." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): The sentence about the billing portal migration to a new cloud host presents excluded work as part of the project work. The signed-off idea is not to be reported, but this sentence is other content that claims the work. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 242, 244): The isolation forest baseline was rebuilt on 2024 data and is presented as claimed work. The Claim Exclusions list the fiscal 2025 isolation forest attempt as falling before the claim period. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): Line 244 says all four real events were flagged in shadow mode, and one lead time was 14 minutes. Line 246 P5 says 10 of 11 faults were caught, a figure from 2024 data. It is also unclear whether the 11 faults and 'four real field events' in Line 246 P4 are consistent with Line 242's '11 documented faults from the 2024 season'. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 343/350 words, 36/50 lines |
| 246 | Claim Exclusion: Billing portal migration to a new cloud host | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Planned fiscal 2027 moisture work | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Selling early warning as a feature and competitive position | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with Storyline. |
| 246 | Confidence Map: Shadow trial dryer count and dates agree across sources. | applied | none |  | Dates and count match. |
| 246 | Confidence Map: Energy balance experiment results on injected drift. | applied | none |  | Injected drift results stated firmly, as allowed. |
| 246 | Confidence Map: Only four real events in the trial, so lead time evidence is thin. | applied | none |  | P4 hedges the small sample. |
| 246 | Confidence Map: Only 11 documented faults for validation. | applied | none |  | P4 says sufficiency is unclear. |
| 246 | Confidence Map: Single-sensor dryers remain above target. | applied | none |  | Single-sensor shortfall stated as above 0.25. |
| 246 | Confidence Map: Moisture drift is not handled by the method yet. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Live-alert performance is untested; the transcript says a full season is still needed, and the log plans fall 2026. | applied | none |  | P4 says live-alert performance is untested. |
| 246 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57xca6f372crss3jbap21pvbx8h2gk8 | applied | none |  | P1 states the drift separation outcome. |
| 246 | Cover signed-off Summary item h57p22dvacs8zcvyvmxqz13ynd8h3t4h | applied | none | 2 | P2 gives baseline failure at 2.6. |
| 246 | Cover signed-off Summary item h57p37942vyjs75ae8xcb0sx2d8h299z | applied | none | 2 | P2 covers synthetic drift hiding slow faults. |
| 246 | Cover signed-off Summary item h57zmb2wz5782gxsnbk3eaxbg58h37nh | applied | none |  | P4 covers status and Ashgrove trial. |
| 246 | Cover signed-off Summary item h57jnxjdx6ab023mz3rjxmfwbh8h340h | applied | none |  | P5 gives 0.18 against 0.25. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Single-sensor dryers did not meet the limit.", but the sources say "Single sensor dryers: 0.64 false alarms per dryer-day.". |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancements answer stated uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team could not tell if sensor bias separates from real process change, and residual-based detection with bias track..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team learned that a baseline isolation forest fails under drift, with 2.6 false alarms per dryer-day at 3 C per mon..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The model still needs a full season with alerts live, so live-alert performance is untested. The writer confirms a seco..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 2 (sections 244, 246): The isolation forest result (2.6 false alarms per dryer-day) is presented as an advancement. This is the pre-claim-period isolation forest attempt, which is excluded. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 4 (sections 246): The booked second field trial at the Ashgrove elevator in spring 2027 is future work, and it falls in fiscal 2027, outside the claim period. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the 0.18 false-alarm result and 22-minute lead time were on injected drift. Line 244 P6 shows the shadow trial found single-sensor dryers at 0.64, so the hypothesis is only partly supported. This is consistent, but P5 of Line 246 states the 0.18 result as the project goal being met without that qualification. |
| 246 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 246 paragraph 4 (sections 246): The text 'Live-alert performance' is a leftover placeholder token, and the term 'live-alert' does not match 'shadow mode' in the glossary. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 8 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 17.
- Line 244: 0 labels and 0 plan checks "Not checked" of 18.
- Line 246: 0 labels and 0 plan checks "Not checked" of 17.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.9 s, p95 15.2 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 11.3 s, p95 11.3 s over 1.
- Sign-off to report created: 86.3 s.
- Cost from aiUsage: $1.23 in all ($0.47 seed stage, $0.76 Brief, drafting and checks) over 33 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T17:18:34.916Z created project k978bz2brb6635gq8vbn0c83zn8h2m0c
2026-10-27T17:18:35.795Z marked as an evaluation project
2026-10-27T17:18:36.777Z added document model-development-log.md
2026-10-27T17:18:38.606Z started Step by step generation k579vfjkbm95gcxr74mmwmv8ns8h3gqj
2026-10-27T17:18:53.839Z seed stage open
2026-10-27T17:18:53.841Z Open Company / Context and wait for its Batch
2026-10-27T17:19:02.330Z Company / Context: select the first Seed
2026-10-27T17:19:05.040Z Approve Company / Context
2026-10-27T17:19:07.752Z approved company_context
2026-10-27T17:19:07.753Z Open Goal / Problem and wait for its Batch
2026-10-27T17:19:15.897Z Goal / Problem: select the first Seed
2026-10-27T17:19:18.549Z Approve Goal / Problem
2026-10-27T17:19:21.209Z approved goal_problem
2026-10-27T17:19:21.209Z Open Technological limitations and wait for its Batch
2026-10-27T17:19:30.469Z Technological limitations: select the first Seed
2026-10-27T17:19:33.165Z Approve Technological limitations
2026-10-27T17:19:35.802Z approved passive_limitations
2026-10-27T17:19:35.802Z Open Technological objectives and wait for its Batch
2026-10-27T17:19:43.888Z Technological objectives: select the first Seed
2026-10-27T17:19:46.832Z Approve Technological objectives
2026-10-27T17:19:49.518Z approved technological_objective
2026-10-27T17:19:49.519Z Open Technological uncertainties and wait for its Batch
2026-10-27T17:20:09.100Z Technological uncertainties: select the first 2 Seeds
2026-10-27T17:20:13.553Z Approve Technological uncertainties
2026-10-27T17:20:16.255Z approved active_uncertainties
2026-10-27T17:20:16.255Z Skip Previous-year status
2026-10-27T17:20:18.039Z Open Work plan and wait for its Batch
2026-10-27T17:20:31.991Z Work plan: select the first Seed
2026-10-27T17:20:34.723Z Approve Work plan
2026-10-27T17:20:37.517Z approved workplan
2026-10-27T17:20:37.518Z Open Hypothesis and wait for its Batch
2026-10-27T17:20:45.644Z Hypothesis: select the first Seed
2026-10-27T17:20:48.272Z Approve Hypothesis
2026-10-27T17:20:50.972Z approved hypothesis
2026-10-27T17:20:50.973Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T17:21:02.149Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T17:21:06.607Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-27T17:21:10.271Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-27T17:21:12.980Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-27T17:21:12.980Z Open Advancement to science / technology and wait for its Batch
2026-10-27T17:21:24.005Z Advancement to science / technology: select the first Seed
2026-10-27T17:21:26.694Z Approve Advancement to science / technology
2026-10-27T17:21:29.497Z approved overall_advancement
2026-10-27T17:21:29.497Z Open Specific technological advancements and wait for its Batch
2026-10-27T17:21:40.477Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T17:21:47.509Z Approve Specific technological advancements
2026-10-27T17:21:50.259Z approved specific_advancements
2026-10-27T17:21:50.259Z Open Project status and next steps and wait for its Batch
2026-10-27T17:21:59.561Z Project status and next steps: select the first Seed
2026-10-27T17:22:02.169Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-27T17:22:04.821Z Approve Project status and next steps
2026-10-27T17:22:07.452Z approved project_status
2026-10-27T17:22:07.452Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T17:22:18.709Z Overall company / project goal improvements: select the first Seed
2026-10-27T17:22:21.375Z Approve Overall company / project goal improvements
2026-10-27T17:22:23.982Z approved goal_improvements
2026-10-27T17:22:23.982Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T17:22:25.760Z signed off; waiting for the report
2026-10-27T17:23:52.618Z report kd74r85pbyhjrnt6c83stsr1z98h383p created
```
