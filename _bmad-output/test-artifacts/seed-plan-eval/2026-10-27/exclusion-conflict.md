# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k971dpt7kypew6mcpc3jqrc5pd8h2qvp`, generation `k570bqppvgjxesdywg0tdywvwx8h21c1`.

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

13 passed, 2 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd74m6c5z838keqpcspak0kbf98h2kn9 |
| All three Sections were drafted | pass | 242: 282 words, 244: 671 words, 246: 307 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | fail | 6 row(s) in 242: "The plan coverage Self-check did not complete." |
| The model Self-check ran on every Section | fail | 242: "Self-check call failed (unknown: response failed validation: (root) unrecognized_keys); deterministic checks only" |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work serves stated uncertainties; the exclusion is confirmed."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied, repaired ("Fixed by the repair: P1 says "lead time met the target of at least 15 minutes in three of four fi...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("The plan coverage Self-check did not complete."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "single-sensor dryers averaged 0.64, and exhau...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 1 request (8.3 s); 244: 2 requests (6.3 s, 6.7 s); 246: 2 requests (9.4 s, 16.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Billing portal migration to a new cloud host is routine IT work." (routine_engineering); "Dashboard colour and layout redesign is cosmetic." (not_technological); "Customer training sessions are sales and support." (business_risk); "Selling early fault warning as a feature is a commercial outcome, not SR&ED work." (business_risk) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1793119663373 |
| The matching selection is signed off with the confirmed exclusion | pass | "The rebuilt isolation forest baseline reached 2.6 false alarms per dryer-day at 3 degrees C per month drift. The work also covered this: Billing portal migra..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Billing portal migration to a new cloud host is routine IT work."; 244: "Cover signed-off Summary item h57zwpbeqg41mcx0g0mhttdpc58h3xhc" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "Single-sensor dryers remain above target, with false alarms at 0.33 per dryer-day after the exhaust temperature fallback. The writer confirms a second field ..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "Status and Ashgrove trial stated." |
| Where "Ashgrove" appears in the drafted Section | info | "y partly replaces a second plenum sensor. A second field trial at the Ashgrove elevator is booked for spring 2027. A full season with live alerts, f" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The business goal is early warning of burner and column faults on grain dryers, at least 15 minutes ahead. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Fixed threshold alarms are late, because plenum temperature crosses the threshold only when the fault is well along. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether slow sensor drift could be separated from slow real faults without labelled drift. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether sensor bias could be separated from real process change in a coupled dryer system. _(cited)_
- Anything that makes the model more tolerant of slow change also makes it slower to see slow faults. / It was uncertain whether false alarms could stay low without losing detection lead time. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- To test whether false alarms could stay low without losing lead time, the team fixed definitions in July 2025 before any run. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use residuals of a physics-based energy balance with online bias tracking, then false alarms will stay below 0.25 per dryer per day. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The rebuilt isolation forest baseline reached 2.6 false alarms per dryer-day at 3 degrees C per month drift. / The work also covered this: Billing portal migration to a new cloud host is routine IT work. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "Anything that makes the model more tolerant of slow change also mak..."
- Synthetic drift training cut false alarms to 0.6 but caught only 6 of 11 faults. / All 3 column plugs were missed, so the approach was dropped. _(cited)_
  - Tested: uncertainty "Anything that makes the model more tolerant of slow change also mak..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team could not separate drift from slow faults using synthetic drift training, which hides slow faults. / Residual scoring with online bias tracking worked under realistic drift. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Isolation forest on raw sensors fails under drift, reaching 2.6 false alarms per dryer-day at 3 degrees C per month. _(cited)_
  - Links: uncertainty "Anything that makes the model more tolerant of slow change also mak..."; experiments "The rebuilt isolation forest baseline reached 2.6 false alarms per ..."
- The baseline caught 9 of 11 faults with a median lead time of 9 minutes, so lead time was already short. _(cited)_
  - Links: uncertainty "Anything that makes the model more tolerant of slow change also mak..."; experiments "The rebuilt isolation forest baseline reached 2.6 false alarms per ..."

### 12. Project status and next steps (Section 246, standard): approved

- Single-sensor dryers remain above target, with false alarms at 0.33 per dryer-day after the exhaust temperature fallback. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Residual scoring with online bias tracking met the goal of false alarms below 0.25 per dryer-day under drift. _(cited)_

## Drafted Sections

### Line 242

Grain Dryer Controls builds controllers and analytics software for grain dryers. The company set out to build an early-warning system that flags burner and column faults on grain dryers at least 15 minutes ahead.

The limitations to standard practice were that the knowledge needed to warn of slow-developing faults in time was insufficient. Fixed threshold alarms are late, because plenum temperature crosses the threshold only when the fault is well along. No documented methods existed for separating slow drift from slow real faults without a trusted reference sensor or periodic calibration, which the company's dryers lack. Anomaly models trained on clean data flag drift as anomalies, and retraining on drifted data teaches the model that drift is normal, which can hide real slow faults. Plenum temperature sensors drift 1 to 3 degrees C per month and moisture sensors up to 1.5 points per month.

The technological objective was to advance the understanding of how slow sensor drift can be separated from slow real faults, without labelled drift examples, in coupled industrial process data, for the purposes of giving operators early burner and column fault warnings on grain dryers with few false alarms.

It was uncertain whether sensor bias could be separated from real process change in a coupled dryer system, because burner output, air flow, grain flow, ambient conditions and grain moisture interact, and it was unknown whether the available sensors carried enough independent information to isolate bias.

It was also uncertain whether false alarms could stay low without losing detection lead time. Anything that makes the model more tolerant of slow change also makes it slower to see slow faults, and a gradually plugging column develops as slowly as drift does.

### Line 244

The technical uncertainty was whether slow sensor drift could be separated from slow real faults in a coupled dryer process, with no labelled drift, no trusted reference sensor and no periodic calibration. False alarms also had to stay low and lead time long. The company planned four phases for fiscal 2026. These were a rebuilt baseline measured under drift, training with synthetic drift, an energy balance residual model with online bias tracking, and shadow mode trials on customer dryers during the fall 2025 harvest. To test whether false alarms could stay low without losing lead time, the team fixed definitions in July 2025 before any run. A false alarm was an alert with no fault in the following two hours, counted per dryer-day. Lead time ran from the alert to the earlier of the existing hard-limit alarm or manual operator shutdown.

It was hypothesized that if anomaly scores use energy balance residuals (expected plenum temperature from fuel rate, air flow and ambient temperature) with online bias tracking from sensor redundancy, then false alarms will stay below 0.25 per dryer per day with drift up to 3 degrees C per month. Median lead time on burner and column faults would also stay at least 15 minutes. A false alarm rate of 0.25 or more, or a median lead time under 15 minutes, would disprove it.

The first experiment asked how the fiscal 2025 isolation forest fails under drift. In July and August 2025 the team rebuilt it on 2024 data from 14 dryers (about 11,000 dryer-hours) and tested held-out data with injected drift of 1, 2 and 3 degrees C per month. False alarms per dryer-day were 0.3 at zero drift, 1.4 at 2 degrees per month by week four, and 2.6 at 3 degrees. The baseline caught 9 of 11 real faults with a median lead time of 9 minutes, so lead time was already short. The work also covered this: Billing portal migration to a new cloud host is routine IT work.

The second experiment tested whether the model could learn to ignore drift. In August 2025 the team injected random slow synthetic drift into the training data, 0.5 to 3 degrees C per month on temperatures and up to 1.5 points per month on moisture. False alarms fell to 0.6 per dryer-day, but the model caught only 6 of 11 faults. It missed all 3 column plugs, which develop over 30 to 60 minutes, because it treated slow rises as drift. The team dropped the approach, having confirmed that tolerance to slow change hides slow faults.

The third experiment aimed to separate drift from real process change. In September 2025 the team fit a per-dryer energy balance on the first 48 hours of the season, predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity. A Kalman filter tracked slow bias per sensor, limited to 4 degrees C per month, using two plenum sensors and the ambient sensor. It updated only when the process was steady. On 2024 data with injected drift of 3 degrees per month, false alarms were 0.18 per dryer-day, 10 of 11 faults were caught including all three column plugs, and median lead time was 22 minutes. The miss was an igniter fault on a dryer with one plenum sensor, where the tracker absorbed the fault.

The fourth experiment tested field conditions. From October 6 to November 21, 2025, shadow mode ran on nine customer dryers, seven with two plenum sensors and two with one. The seven dual-sensor dryers averaged 0.21 false alarms per dryer-day, with measured drift up to 2.7 degrees C per month on one dryer. The two single-sensor dryers averaged 0.64. All four real events were flagged, with lead times of 14, 19, 26 and 31 minutes, so the 14-minute flame event fell under the 15-minute target. From January to March 2026 the team replayed fall data using exhaust temperature as an indirect second reference. Single-sensor false alarms fell from 0.64 to 0.33 per day, still above target.

### Line 246

It was uncertain whether slow sensor drift could be separated from slow real faults without labelled drift or a trusted reference sensor. The investigation showed that energy balance residual scoring with online bias tracking works under realistic drift, while training on synthetic drift hides slow faults. The objective was largely achieved and the hypothesis partly proven. On the seven dual-sensor dryers, false alarms averaged 0.21 per dryer-day, below the 0.25 limit. Three of four field events met the 15-minute lead time target; the 14-minute flame event fell short. Moisture drift is not yet tracked with the same method.

An isolation forest on raw sensors fails under drift, reaching 2.6 false alarms per dryer-day at 3 degrees C per month. The baseline caught 9 of 11 faults with a median lead time of 9 minutes, so lead time was already short. Anything that makes a model more tolerant of slow change also makes it slower to see slow faults. Training on synthetic drift cut false alarms to 0.6 but caught only 6 of 11 faults, so the team dropped it.

Residual scoring with online bias tracking kept false alarms below 0.25 per dryer-day under drift. On 2024 data with injected drift of 3 degrees C per month, not live faults, false alarms were 0.18 per dryer-day, 10 of 11 faults were caught and median lead time was 22 minutes. Sensor redundancy decided the result: in the field trial, the two single-sensor dryers had 0.64 false alarms per dryer-day. A replay using exhaust temperature as an indirect second reference gave 0.33.

Single-sensor dryers remain above the 0.25 target at 0.33, because exhaust temperature only partly replaces a second plenum sensor. A second field trial at the Ashgrove elevator is booked for spring 2027. A full season with live alerts, flame event lead time and moisture drift also remain open.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 282/350 words, 29/50 lines |
| 242 | Claim Exclusion: Billing portal migration to a new cloud host is routine IT work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign is cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Selling early fault warning as a feature is a commercial outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Model Self-check | not_applied | none |  | Self-check call failed (unknown: response failed validation: (root) unrecognized_keys); deterministic checks only |
| 242 | Cover signed-off Summary item h57wae3wh2aqjd4jr8dabd493n8h3tpr | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item h57vc2df8f7h134tpwbks7drwh8h2crr | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item h57yggw7beazs4h2wc4h77kxzd8h38bw | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item h57xbvm7ppae5hjkgjbhnfdjmh8h247r | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item h57ngbr16j0fx09mz2jthp8csn8h282p | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item h57kw9a02pkhh1e2gwwd6rpbz18h3by0 | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 242 | State figures and details as the sources give them | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether slow sensor drift could be separated from slow real faults without labelled drift." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was uncertain whether sensor bias could be separated from real process change in a coupled dryer system." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 671/700 words, 58/100 lines |
| 244 | Claim Exclusion: Billing portal migration to a new cloud host is routine IT work. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 3 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words |
| 244 | Claim Exclusion: Dashboard colour and layout redesign is cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Selling early fault warning as a feature is a commercial outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: synthetic drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: plenum sensor | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Baseline isolation forest results under drift are documented consistently. | applied | none |  | Baseline results stated consistently. |
| 244 | Confidence Map: Shadow trial flagged all four real events. | applied | none |  | All four events flagged, as established. |
| 244 | Confidence Map: Energy balance results rest on injected drift on 2024 data, not live faults. | applied | none |  | P5 states injected drift on 2024 data. |
| 244 | Confidence Map: Only 11 documented faults and 4 trial events limit validation. | applied | none |  | No validation claim beyond the data. |
| 244 | Confidence Map: Moisture drift is not handled by the method. | applied | none |  | Moisture handling not claimed. |
| 244 | Confidence Map: Live alert season has not occurred; timing of the first one is only planned. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Interview says full season with live alerts is still needed; no conflict with the log. | applied | none |  | Not mentioned in the section. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior year work is not described. |
| 244 | Cover signed-off Summary item h57whb35kzsrk1hkq0dqh32hah8h2rtr | applied | none |  | Definitions fixed in July 2025 before any run. |
| 244 | Cover signed-off Summary item h57tkzcer7pefqx4t7jszdgk2h8h3dwt | applied | none |  | Hypothesis stated with its targets. |
| 244 | Cover signed-off Summary item h57zwpbeqg41mcx0g0mhttdpc58h3xhc | applied | conflict |  | Drafted despite the Claim Exclusion "Billing portal migration to a new cloud host is routine IT work.": the writer kept the idea "The rebuilt isolation forest baseline reached 2.6 false alarms per dryer-day at 3 degrees C per month drift. The work..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item h57zr8pyn72gfkjnq300185zgn8h2aj8 | applied | none |  | Synthetic drift result and drop stated. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work serves stated uncertainties; the exclusion is confirmed. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): The sentence on the billing portal migration is the signed-off idea kept in Line 244, so it is not reported as a claim. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 1 (sections 244, 246): Line 244 says the plan was four phases for fiscal 2026 with the fall 2025 harvest trials inside it, while the work was done in 2025 and early 2026. This is a possible fiscal-year mismatch, but it does not clearly conflict. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 307/350 words, 29/50 lines |
| 246 | Claim Exclusion: Billing portal migration to a new cloud host is routine IT work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign is cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Selling early fault warning as a feature is a commercial outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: synthetic drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: plenum sensor | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Baseline isolation forest results under drift are documented consistently. | applied | none |  | Baseline figures match. |
| 246 | Confidence Map: Shadow trial flagged all four real events. | applied | none |  | Event lead times stated correctly. |
| 246 | Confidence Map: Energy balance results rest on injected drift on 2024 data, not live faults. | applied | none |  | P3 says injected drift, not live faults.; repaired, and checked again on the final text |
| 246 | Confidence Map: Only 11 documented faults and 4 trial events limit validation. | applied | none |  | No flat validation claim. |
| 246 | Confidence Map: Moisture drift is not handled by the method. | applied | none |  | States moisture not yet tracked. |
| 246 | Confidence Map: Live alert season has not occurred; timing of the first one is only planned. | applied | none |  | No live alert season claimed. |
| 246 | Confidence Map: Interview says full season with live alerts is still needed; no conflict with the log. | applied | none |  | Full season stated as open. |
| 246 | Glossary Term: shadow mode | applied | none |  | Shadow mode concept absent. |
| 246 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57pda2c2hqvmtx2wxyv13hzds8h2bes | applied | none |  | Covers advancement and moisture gap. |
| 246 | Cover signed-off Summary item h57y5z5p0b4ge78p5vs816hcwh8h27ck | applied | none | 2 | States 2.6 false alarms at 3 C. |
| 246 | Cover signed-off Summary item h57rjfeh4spz4yaxr03a830nvx8h35p3 | applied | none | 2 | States 9 of 11, 9 minutes. |
| 246 | Cover signed-off Summary item h57h6yec13w6w850nknftz5jen8h3xqc | applied | none |  | Status and Ashgrove trial stated. |
| 246 | Cover signed-off Summary item h57q0a5cwkjvnx1deftx1cdrcd8h29k8 | applied | none |  | Below 0.25 with 0.18 stated. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "single-sensor dryers averaged 0.64, and exhaust temperature as an indirect second reference lowered this to 0.33", but the sources say "On the two single-sensor dryers it was 0.64.". |
| 246 | State each result against its target as the numbers show | applied | none |  | Fixed by the repair: P1 says "lead time met the target of at least 15 minutes in three of four field events", but the sources say "Lead times 14, 19, 26 and 31 minutes.". The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Results tie to stated uncertainties. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): Line 246 says live-alert flame event lead time and a full season remain open, and that a second field trial is booked for spring 2027. Line 244 reports no such trial. Lead time for the flame event is described as already measured in the fall trial, so 'open' is partly inconsistent. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the 'hypothesis partly proven' and that false alarms stayed below 0.25. Line 244 reports the 0.25 limit was met only on dual-sensor dryers, and the hypothesis would be disproved if a median lead time was under 15 minutes. The overall median across the four events was 22.5 minutes, so this is consistent. No change needed. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 7.
- Line 244: 0 labels and 0 plan checks "Not checked" of 17.
- Line 246: 0 labels and 0 plan checks "Not checked" of 18.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.4 s, p95 11.4 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 11.4 s, p95 11.4 s over 1.
- Sign-off to report created: 99.2 s.
- Cost from aiUsage: $1.18 in all ($0.47 seed stage, $0.71 Brief, drafting and checks) over 34 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T16:45:06.721Z created project k971dpt7kypew6mcpc3jqrc5pd8h2qvp
2026-10-27T16:45:07.610Z marked as an evaluation project
2026-10-27T16:45:08.469Z added document model-development-log.md
2026-10-27T16:45:10.380Z started Step by step generation k570bqppvgjxesdywg0tdywvwx8h21c1
2026-10-27T16:45:25.657Z seed stage open
2026-10-27T16:45:25.659Z Open Company / Context and wait for its Batch
2026-10-27T16:45:36.930Z Company / Context: select the first Seed
2026-10-27T16:45:39.570Z Approve Company / Context
2026-10-27T16:45:42.301Z approved company_context
2026-10-27T16:45:42.301Z Open Goal / Problem and wait for its Batch
2026-10-27T16:45:50.470Z Goal / Problem: select the first Seed
2026-10-27T16:45:53.179Z Approve Goal / Problem
2026-10-27T16:45:55.865Z approved goal_problem
2026-10-27T16:45:55.866Z Open Technological limitations and wait for its Batch
2026-10-27T16:46:04.042Z Technological limitations: select the first Seed
2026-10-27T16:46:06.849Z Approve Technological limitations
2026-10-27T16:46:09.517Z approved passive_limitations
2026-10-27T16:46:09.517Z Open Technological objectives and wait for its Batch
2026-10-27T16:46:17.722Z Technological objectives: select the first Seed
2026-10-27T16:46:20.453Z Approve Technological objectives
2026-10-27T16:46:23.235Z approved technological_objective
2026-10-27T16:46:23.235Z Open Technological uncertainties and wait for its Batch
2026-10-27T16:46:31.426Z Technological uncertainties: select the first 2 Seeds
2026-10-27T16:46:35.846Z Approve Technological uncertainties
2026-10-27T16:46:38.648Z approved active_uncertainties
2026-10-27T16:46:38.648Z Skip Previous-year status
2026-10-27T16:46:40.483Z Open Work plan and wait for its Batch
2026-10-27T16:46:54.565Z Work plan: select the first Seed
2026-10-27T16:46:57.248Z Approve Work plan
2026-10-27T16:46:59.861Z approved workplan
2026-10-27T16:46:59.861Z Open Hypothesis and wait for its Batch
2026-10-27T16:47:14.178Z Hypothesis: select the first Seed
2026-10-27T16:47:17.498Z Approve Hypothesis
2026-10-27T16:47:20.681Z approved hypothesis
2026-10-27T16:47:20.681Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T16:47:32.071Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T16:47:36.635Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-27T16:47:40.445Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-27T16:47:43.458Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-27T16:47:43.459Z Open Advancement to science / technology and wait for its Batch
2026-10-27T16:47:53.242Z Advancement to science / technology: select the first Seed
2026-10-27T16:47:56.398Z Approve Advancement to science / technology
2026-10-27T16:47:59.846Z approved overall_advancement
2026-10-27T16:47:59.859Z Open Specific technological advancements and wait for its Batch
2026-10-27T16:48:09.059Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T16:48:16.622Z Approve Specific technological advancements
2026-10-27T16:48:19.583Z approved specific_advancements
2026-10-27T16:48:19.583Z Open Project status and next steps and wait for its Batch
2026-10-27T16:48:28.028Z Project status and next steps: select the first Seed
2026-10-27T16:48:30.947Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-27T16:48:33.661Z Approve Project status and next steps
2026-10-27T16:48:36.432Z approved project_status
2026-10-27T16:48:36.432Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T16:48:44.792Z Overall company / project goal improvements: select the first Seed
2026-10-27T16:48:47.497Z Approve Overall company / project goal improvements
2026-10-27T16:48:50.272Z approved goal_improvements
2026-10-27T16:48:50.272Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T16:48:52.791Z signed off; waiting for the report
2026-10-27T16:50:32.296Z report kd74m6c5z838keqpcspak0kbf98h2kn9 created
```
