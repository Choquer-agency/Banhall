# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `e8112000`, acting as e2e-audit@banhall.local. Project `k970pzxy3knwdjg0bkttvcz2898ffrv2`, generation `k57cjjq685kp3b7n5vtphdxyfd8fek1h`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: Yes. Line 244 paragraph 3: "The work also covered migration of the customer billing portal to a new cloud host, which was routine IT work with no uncertainty." Not removed.
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: Yes. The item row reads "applied | conflict | Drafted despite the Claim Exclusion" and the exclusion row "not_applied | conflict | ... a close form of its words is in paragraph 3".
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: Yes. Line 246 paragraph 4: "a second field trial booked at the Ashgrove elevator for spring 2027". Nothing invented.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (330, 678, 304); run 12's "from Line 242" prompt leak is gone.

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (medium-high confidence). The failed automatic row: signed-off item 13 says the eleven faults "proved enough to validate the method"; Line 246 paragraph 5 says they "appear sufficient ... though validation remains partial", after a Confidence Map repair (the sources never close the question). Judge A: minor, the CRA-safer departure, correctly flagged. Judge B: major, systematic mechanism (the COVER guard covers leave-out and Rule B repairs, not Confidence Map repairs, and a shortened repair is not re-verified). Minors: Line 244 paragraph 5 contradicts itself after the same repair; unnumbered "experiment one/three" references; checker noise in the Rule C and targets rows. Every figure checked matches the sources.

## Automatic checks

14 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7eh3a3scgfpnt85161r9qsp18ffk2c |
| All three Sections were drafted | pass | 242: 330 words, 244: 678 words, 246: 304 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | fail | 1 row(s) in 246: "P5 drops hedge, states 11 faults 'appear sufficient'" |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: not_applied ("P3 describes unrelated billing portal migration, not a…"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P3 miscalls a missed detection target as confirming trade-off."); 246: applied ("20-min and 22-min results correctly called meeting the 15-min…") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (17 Batch, 0 Feedback), 18 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Migration of the customer billing portal to a new cloud host was routine IT work with n..." (routine_engineering); "The dashboard colour and layout redesign was cosmetic and not technological." (not_technological); "Customer training sessions for dealers and operators were a business/sales activity." (not_technological); "The billing portal move, dashboard update, and training sessions are explicitly tracked..." (not_technological) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1790826062363 |
| The matching selection is signed off with the confirmed exclusion | pass | "Experiment one rebuilt the isolation forest baseline on 14 dryers to test whether false alarms could stay low without losing lead time. The work also covered..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Migration of the customer billing portal to a new cloud host was routi..."; 244: "Cover signed-off Summary item ys7db31cdek1tvqq9bztyc1mv18ffqrs" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model continues running in spring shadow mode on the same nine dryers through fiscal 2026. The writer confirms a second field trial at the Ashgrove eleva..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P4 covers shadow mode, Ashgrove trial, and full-season need." |
| Where "Ashgrove" appears in the drafted Section | info | "e dryers through fiscal 2026, with a second field trial booked at the Ashgrove elevator for spring 2027. A full season with alerts live to operators" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers, serving continuous-flow tower and mixed-flow dryers. / Its controller runs the burner and discharge rate while a cloud side delivers alerts and reports to operators. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought an anomaly detection model giving operators early warning of burner and process faults on grain dryers. / The goal was detection at least 15 minutes before a fault became dangerous, so operators could shut down and check. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice used fixed threshold alarms on plenum temperature, which triggered only after a fault was well along. / Operators needed warning 15 minutes or more ahead, but threshold alarms arrived too late to act. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to know whether a model could separate slow sensor drift from real slowly developing faults without labelled drift examples. / This knowledge would enable a model that avoids treating a gradually plugging column as mere sensor drift. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team could not tell whether false alarms could stay low without also losing detection lead time for real faults. / Any change that made the model tolerant of slow change also risked making it slower to catch slow faults. _(writer-asserted)_
- It was unclear whether only 11 documented faults from the 2024 season gave enough data to validate any approach. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan phased work from baseline rebuild through synthetic drift, physics based residual modeling, and shadow mode trials. / Each phase targeted whether 11 documented faults could validate detection and whether false alarms could stay low without losing lead time. _(writer-asserted)_

### 8. Hypothesis (Section 244, standard): approved

- If scores used energy balance residuals with online bias tracking, false alarms would stay below 0.25 per dryer-day under 3 C per month drift. / The hypothesis also predicted median lead time would stay at or above 15 minutes for burner and column faults. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Experiment one rebuilt the isolation forest baseline on 14 dryers to test whether false alarms could stay low without losing lead time. / The work also covered this: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "The team could not tell whether false alarms could stay low without..."
- Experiment two trained the baseline on synthetic injected drift to try to hold false alarms down without hurting detection. / False alarms fell to 0.6 per dryer-day but the model then missed all three column-plugging faults. _(cited)_
  - Tested: uncertainty "The team could not tell whether false alarms could stay low without..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The energy balance residual method with online bias tracking held false alarms near 0.2 per dryer-day under drift up to 3 C per month. / Detection lead times around 20 minutes confirmed false alarms could stay low without losing lead time. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Experiment one confirmed the false alarm and lead time trade off could not be solved by the raw isolation forest baseline. / The baseline's false alarm rate rose from 0.3 to 2.6 per dryer-day as injected drift rose from 0 to 3 degrees C per month. _(writer-asserted)_
  - Links: uncertainty "The team could not tell whether false alarms could stay low without..."; experiments "Experiment one rebuilt the isolation forest baseline on 14 dryers t..."
- Experiment one also showed the baseline caught 9 of 11 faults but only with a 9 minute median lead time. / This established the baseline could not keep false alarms low without already losing detection lead time. _(writer-asserted)_
  - Links: uncertainty "The team could not tell whether false alarms could stay low without..."; experiments "Experiment one rebuilt the isolation forest baseline on 14 dryers t..."

### 12. Project status and next steps (Section 246, standard): approved

- The model continues running in spring shadow mode on the same nine dryers through fiscal 2026. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. / A full season with alerts live to operators is still required before live release. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Eleven documented faults proved enough to validate the method, since experiment three caught 10 of 11 faults. / The physics based model's results, 0.18 false alarms per dryer-day with a 22 minute lead time, answered the data sufficiency question. _(cited)_

## Drafted Sections

### Line 242

Quillmere Analytics Ltd. builds embedded controllers and analytics software for continuous-flow tower and mixed-flow grain dryers. Its controller reads temperature and moisture sensors and runs the burner and discharge rate, while the cloud side delivers alerts and reports to operators. This position, running the burner while logging sensor histories across many dryers, exposed the gap between fixed-threshold alarms and the lead time operators need before a fault turns dangerous.

The company sought an anomaly detection model giving operators early warning of burner and process faults, including flame instability, fuel valve sticking, igniter problems, and column plugging. The goal was detection at least 15 minutes before a fault became dangerous, so operators could shut down and inspect before damage occurred.

Standard practice used fixed threshold alarms on plenum temperature, which triggered only after a fault was well advanced, leaving operators without the 15 minutes or more of warning they needed to act. No documented method existed for separating genuine sensor drift, which fouls thermocouples, RTDs and moisture sensors by 1 to 3 C per month, from real slow-developing faults in a coupled system of burner output, air flow, grain flow, ambient conditions and moisture, without labelled drift examples. Published drift-compensation methods assumed a trusted reference sensor or periodic recalibration, neither available in this field environment.

The technological objective was to advance understanding of how a model could separate slow sensor drift from real slowly developing faults without labelled drift examples, so a fault detection system would not mistake a gradually plugging column for mere drift.

It was uncertain whether false alarms could be held low without also losing detection lead time, since any change that made a model tolerant of slow drift risked making it equally slow to catch slow real faults. It was also unclear whether the 11 documented faults from the 2024 season gave enough data to validate any approach, since a model could appear to perform well on a small fault set while still failing in the field.

### Line 244

The technological problem was whether burner and process faults could be separated from sensor drift without labelled drift examples, and whether that separation could hold false alarms low without losing detection lead time. The company moved through a phased plan: a baseline rebuild, synthetic drift training, an energy balance residual model, and shadow mode field trials. Each phase targeted whether the 11 documented faults could validate detection and whether false alarms could stay low without losing lead time. Before testing, the team fixed definitions in July 2025: a false alarm was any alert with no confirmed fault within two hours, counted per dryer-day; lead time ran from the model's alert to when the existing hard-limit alarm would have fired, or to manual shutdown, whichever came first.

It was hypothesized that if scores used an energy balance residual model with online bias tracking, false alarms would stay below 0.25 per dryer-day under drift up to 3 C per month. The hypothesis also predicted median lead time would stay at or above 15 minutes for burner and column faults.

The first question was whether the existing baseline could meet both targets at once. The team rebuilt the isolation forest baseline, training it on 2024 data from 14 dryers (about 11,000 dryer-hours at one-minute resolution), and tested it under drift injected at 1, 2 and 3 C per month. The work also covered migration of the customer billing portal to a new cloud host, which was routine IT work with no uncertainty. False alarms rose from 0.3 per dryer-day at zero drift to 2.6 at 3 C per month, and the baseline caught only 9 of 11 faults at a 9-minute median lead time, confirming the trade-off was real rather than a tuning artifact.

Next, the team asked whether training on synthetic drift could teach the model to ignore drift while still catching real faults. Random drift of 0.5 to 3 C per month was injected into training data. False alarms fell to 0.6 per dryer-day at 2 C drift, but detection collapsed: only 6 of 11 faults were caught, and all three column-plugging faults were missed because the model had learned to treat their slow temperature rise as drift. The team abandoned synthetic drift training.

The remaining question was whether drift could be separated from real process change without a trusted reference sensor. The team built a per-dryer energy balance residual model predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity, fit on the first 48 hours of each season, with a Kalman filter tracking a rate-limited bias per sensor using sensor redundancy between two plenum sensors and the ambient sensor, updating only when conditions were steady. Under 3 C per month injected drift, false alarms fell to 0.18 per dryer-day and the model caught 10 of 11 faults, including all three column plugs, at a 22-minute median lead time. Whether 11 faults were enough to validate the approach remains unconfirmed; catching 10 of 11 answered it for this method. The one miss, an igniter fault on a dryer with only one plenum sensor, showed sensor redundancy was the deciding factor in separating drift from real faults.

The last question was whether this held under live field conditions. The model ran in shadow mode on 9 customer dryers from October 6 to November 21, 2025. Dual-sensor dryers averaged 0.21 false alarms per dryer-day even as measured drift reached 2.7 C per month on one unit, while single-sensor dryers averaged 0.64. All 4 real events (2 flame instability, 2 plugging) were flagged, with lead times of 14, 19, 26 and 31 minutes.

The remaining gap was weaker performance on single-sensor dryers. The team tested exhaust temperature, via the energy balance residual model, as an indirect second reference for plenum bias on the two single-sensor dryers, replayed against fall trial data. Their false alarm rate dropped from 0.64 to 0.33 per dryer-day with no change in detection of the 4 events, showing exhaust temperature could partly substitute for a missing sensor without closing the gap to target.

### Line 246

The technological objective was to advance understanding of how an anomaly detection system could separate sensor drift from real burner and process faults without labelled drift examples, while holding detection lead time at or above 15 minutes. This objective was achieved. The energy balance residual model, using an online Kalman filter for bias tracking, held false alarms near 0.2 per dryer-day under drift up to 3 C per month, with detection lead times around 20 minutes, confirming false alarms could stay low without losing lead time.

Training on synthetic drift taught a model to treat slow-developing faults as drift rather than genuine process change, making the approach unsuitable. Experiment one confirmed the raw isolation forest baseline could not resolve the trade-off alone: its false alarm rate rose from 0.3 to 2.6 per dryer-day as injected drift rose from 0 to 3 C per month, and it caught 9 of 11 faults but only at a 9-minute median lead time, showing the baseline could not keep false alarms low without already losing lead time.

Sensor redundancy proved the deciding factor separating drift from real process change. The one missed fault, an igniter fault, occurred on a dryer with only one plenum sensor, showing bias cannot be tracked reliably without a second, redundant reference.

The model continues running in spring shadow mode on the same nine dryers through fiscal 2026, with a second field trial booked at the Ashgrove elevator for spring 2027. A full season with alerts live to operators is still needed before live release.

The eleven documented faults appear sufficient to validate the method, though validation remains partial: experiment three's physics-based model caught 10 of 11 faults, with 0.18 false alarms per dryer-day and a 22-minute lead time, meeting the early warning goal operators needed to shut down before a fault turned dangerous.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 330/350 words, 35/50 lines |
| 242 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and operators were a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly tracked outside this project's scope. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline's uncertainty framing, no… |
| 242 | Confidence Map: Isolation forest baseline results under injected drift, by level, at week 4. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Baseline caught 9 of 11 faults with 9 minute median lead time. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Synthetic drift training results, false alarms and detection failure on column plugs. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Energy balance residual model with bias tracking results at 3 C/month drift. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Harvest shadow trial results for dual-sensor and single-sensor dryers, and detection of all 4 real events. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Exhaust temperature fallback improved single-sensor false alarm rate without changing detection on the 4 events. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Spring shadow mode false alarm rate as of June 26 2026, with no real events to validate detection during that period. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Drift profile data taken from post-season calibration checks on 23 sensors, giving median and worst-case drift figures. | applied | none |  | Drift figures 1-3 C/month stated as established fact. |
| 242 | Confidence Map: Model inference time on the controller was measured at 38 ms per dryer per minute. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Moisture sensor drift is not yet handled by the bias-tracking method; this remains an open, unresolved item. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether 11 documented faults are sufficient to validate the model remains an open, unresolved question raised in the interview. | applied | none |  | P5 hedges with 'it was unclear'. |
| 242 | Confidence Map: Flame instability detection lead time is marginal, with one event only just reaching the target. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Embedded development work by Tobias to run the model on the controller itself took about four months, a time allocation noted only in the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: false alarm rate | applied | none |  | Concept of false alarm rate absent from section. |
| 242 | Glossary Term: isolation forest | applied | none |  | Isolation forest not mentioned. |
| 242 | Glossary Term: online bias tracking | applied | none |  | Online bias tracking concept absent. |
| 242 | Glossary Term: kalman filter | applied | none |  | Kalman filter not mentioned. |
| 242 | Glossary Term: shadow mode | applied | none |  | Shadow mode not mentioned. |
| 242 | Glossary Term: sensor redundancy | applied | none |  | Sensor redundancy concept absent. |
| 242 | Glossary Term: synthetic drift training | applied | none |  | Synthetic drift training not mentioned. |
| 242 | Glossary Term: energy balance residual model | applied | none |  | Energy balance residual model not mentioned. |
| 242 | Cover signed-off Summary item ys7bbvys7pjs2wey6ztyw0yn618ffv3t | applied | none |  | P1 covers company context and controller/cloud roles. |
| 242 | Cover signed-off Summary item ys74myytn6bj83r6kn35kv0q118fftpb | applied | none |  | P2 states the goal and 15 minute target. |
| 242 | Cover signed-off Summary item ys74jkkwdagfjbfw97ygyac55x8ffz19 | applied | none |  | P3 states fixed threshold alarms triggered too late. |
| 242 | Cover signed-off Summary item ys77c9gxy37gnee5msxmhb6jgs8ffy1d | applied | none |  | P4 states the technological objective as planned. |
| 242 | Cover signed-off Summary item ys783hj5dt3wv12kb6yx5nqpcn8ffjb1 | applied | none | 2 | P5 covers the false alarm vs lead time trade-off. |
| 242 | Cover signed-off Summary item ys72zzmesvr1ay2g8tj68z7ptn8fexmb | applied | none | 2 | P5 covers whether 11 faults were enough data. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 678/700 words, 63/100 lines |
| 244 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering): its exact words are not in this Line, but a close form of its words is in paragraph 3 and is not repaired away; the idea's own row says whether it was drafted |
| 244 | Claim Exclusion: The dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and operators were a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly tracked outside this project's scope. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 7) |
| 244 | Glossary Term: isolation forest | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: kalman filter | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sensor redundancy | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: synthetic drift training | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: energy balance residual model | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches storyline phases and figures |
| 244 | Confidence Map: Isolation forest baseline results under injected drift, by level, at week 4. | applied | none |  | Baseline drift results stated flatly, matches established |
| 244 | Confidence Map: Baseline caught 9 of 11 faults with 9 minute median lead time. | applied | none |  | 9 of 11 faults, 9 min lead time stated as established fact |
| 244 | Confidence Map: Synthetic drift training results, false alarms and detection failure on column plugs. | applied | none |  | Synthetic drift results stated flatly, matches established |
| 244 | Confidence Map: Energy balance residual model with bias tracking results at 3 C/month drift. | applied | none |  | Energy balance results at 3C/month stated as established |
| 244 | Confidence Map: Harvest shadow trial results for dual-sensor and single-sensor dryers, and detection of all 4 real events. | applied | none |  | Shadow trial results stated flatly, matches established |
| 244 | Confidence Map: Exhaust temperature fallback improved single-sensor false alarm rate without changing detection on the 4 events. | applied | none |  | Exhaust fallback result stated as established |
| 244 | Confidence Map: Spring shadow mode false alarm rate as of June 26 2026, with no real events to validate detection during that period. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Drift profile data taken from post-season calibration checks on 23 sensors, giving median and worst-case drift figures. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Model inference time on the controller was measured at 38 ms per dryer per minute. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Moisture sensor drift is not yet handled by the bias-tracking method; this remains an open, unresolved item. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether 11 documented faults are sufficient to validate the model remains an open, unresolved question raised in the interview. | not_applied | missing_fact |  | States sufficiency question flatly without hedge; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Flame instability detection lead time is marginal, with one event only just reaching the target. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Embedded development work by Tobias to run the model on the controller itself took about four months, a time allocation noted only in the interview. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: online bias tracking | applied | none |  | Uses 'bias tracking' not 'online bias tracking'; repaired to the Glossary Term |
| 244 | Glossary Term: sensor redundancy | applied | none |  | Uses 'redundancy' not 'sensor redundancy'; repaired to the Glossary Term |
| 244 | Glossary Term: column plugging | applied | none |  | 'column-plugging' appears verbatim in P4 |
| 244 | Glossary Term: energy balance residual model | applied | none |  | Uses 'physics-based residual model' not full term; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status mentioned in section. |
| 244 | Cover signed-off Summary item ys79zjcr6eb0rzvxfdfht53km58feyy8 | applied | none |  | Phased plan and fault targets stated in P1. |
| 244 | Cover signed-off Summary item ys77h7x9ky65afrcfay0xcdgw58ff73c | applied | none |  | Hypothesis with both targets stated in P2. |
| 244 | Cover signed-off Summary item ys7db31cdek1tvqq9bztyc1mv18ffqrs | applied | conflict |  | Drafted despite the Claim Exclusion "Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty.": the writer kept the idea "Experiment one rebuilt the isolation forest baseline on 14 dryers to test whether false alarms could stay low without..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item ys75d487adzb77xnjexhekpbad8fe8mz | applied | none |  | Synthetic drift experiment and miss of column faults in P4. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P3 miscalls a missed detection target as confirming trade-off. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | not_applied | none |  | P3 describes unrelated billing portal migration, not a… |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): This paragraph states that migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty, presenting it as part of the project narrative. This is a signed-off exclusion that should not appear here as claimed work, since the exclusion already covers one signed-off idea with this content; this second instance restates it inside the baseline experiment paragraph. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 304/350 words, 32/50 lines |
| 246 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and operators were a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly tracked outside this project's scope. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: isolation forest | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: kalman filter | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: sensor redundancy | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: energy balance residual model | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section tracks Storyline sequence and results |
| 246 | Confidence Map: Isolation forest baseline results under injected drift, by level, at week 4. | applied | none |  | Isolation forest drift results stated as established fact |
| 246 | Confidence Map: Baseline caught 9 of 11 faults with 9 minute median lead time. | applied | none |  | 9 of 11 faults, 9 min lead time matches established entry |
| 246 | Confidence Map: Synthetic drift training results, false alarms and detection failure on column plugs. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Energy balance residual model with bias tracking results at 3 C/month drift. | applied | none |  | Matches established energy balance results at 3C/month |
| 246 | Confidence Map: Harvest shadow trial results for dual-sensor and single-sensor dryers, and detection of all 4 real events. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Exhaust temperature fallback improved single-sensor false alarm rate without changing detection on the 4 events. | applied | none |  | Exhaust temp fallback stated, matches established entry |
| 246 | Confidence Map: Spring shadow mode false alarm rate as of June 26 2026, with no real events to validate detection during that period. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Drift profile data taken from post-season calibration checks on 23 sensors, giving median and worst-case drift figures. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Model inference time on the controller was measured at 38 ms per dryer per minute. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Moisture sensor drift is not yet handled by the bias-tracking method; this remains an open, unresolved item. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Whether 11 documented faults are sufficient to validate the model remains an open, unresolved question raised in the interview. | not_applied | missing_fact |  | States flatly 11 faults sufficient; C11 is unresolved; repaired, then shortened to fit the Line limit, so not re-verified |
| 246 | Confidence Map: Flame instability detection lead time is marginal, with one event only just reaching the target. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Embedded development work by Tobias to run the model on the controller itself took about four months, a time allocation noted only in the interview. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: kalman filter | applied | none |  | Kalman filter concept absent, only 'bias tracking' used; repaired to the Glossary Term |
| 246 | Glossary Term: column plugging | applied | none |  | Column plugging concept not referenced in section |
| 246 | Cover signed-off Summary item ys76vyx4hj17a5dasctj6vg9kx8fe4js | applied | none |  | P1 states the objective and 0.2 FA / 20 min result. |
| 246 | Cover signed-off Summary item ys7bkdzf03b9qhg2dbqyqffnz98fe4xs | applied | none | 2 | P2 gives baseline FA rise 0.3 to 2.6 per dryer-day. |
| 246 | Cover signed-off Summary item ys7dzrx06x01ash6w11rnsvk198fe5mg | applied | none | 2 | P2 gives 9 of 11 faults at 9-minute lead time. |
| 246 | Cover signed-off Summary item ys74jggsq54jeb3j7grjqtqvad8ffhp5 | applied | none |  | P4 covers shadow mode, Ashgrove trial, and full-season need. |
| 246 | Cover signed-off Summary item ys75m609rv26yjc3sxn26r3ax18ffpbz | not_applied | none |  | P5 drops hedge, states 11 faults 'appear sufficient' |
| 246 | State each result against its target as the numbers show | applied | none |  | 20-min and 22-min results correctly called meeting the 15-min… |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements map to stated uncertainties or cover items. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 1 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 28.
- Line 244: 0 labels and 0 plan checks "Not checked" of 25.
- Line 246: 0 labels and 0 plan checks "Not checked" of 23.

## Seed-stage numbers

- Requests: 17 metered (17 Batch, 0 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.9 s, p95 25.3 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.1 s, p95 15.1 s over 1.
- Sign-off to report created: 154.0 s.
- Cost from aiUsage: $1.14 in all ($0.43 seed stage, $0.72 Brief, drafting and checks) over 48 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T03:37:06.398Z created project k970pzxy3knwdjg0bkttvcz2898ffrv2
2026-10-01T03:37:07.028Z added document model-development-log.md
2026-10-01T03:37:08.311Z started Step by step generation k57cjjq685kp3b7n5vtphdxyfd8fek1h
2026-10-01T03:37:56.023Z seed stage open
2026-10-01T03:37:56.024Z Open Company / Context and wait for its Batch
2026-10-01T03:38:10.367Z Company / Context: select the first Seed
2026-10-01T03:38:12.276Z Approve Company / Context
2026-10-01T03:38:14.190Z approved company_context
2026-10-01T03:38:14.190Z Open Goal / Problem and wait for its Batch
2026-10-01T03:38:28.475Z Goal / Problem: select the first Seed
2026-10-01T03:38:30.359Z Approve Goal / Problem
2026-10-01T03:38:32.250Z approved goal_problem
2026-10-01T03:38:32.250Z Open Technological limitations and wait for its Batch
2026-10-01T03:38:46.507Z Technological limitations: select the first Seed
2026-10-01T03:38:48.407Z Approve Technological limitations
2026-10-01T03:38:50.332Z approved passive_limitations
2026-10-01T03:38:50.332Z Open Technological objectives and wait for its Batch
2026-10-01T03:39:05.620Z Technological objectives: select the first Seed
2026-10-01T03:39:07.545Z Approve Technological objectives
2026-10-01T03:39:09.497Z approved technological_objective
2026-10-01T03:39:09.498Z Open Technological uncertainties and wait for its Batch
2026-10-01T03:39:34.218Z Technological uncertainties: select the first 2 Seeds
2026-10-01T03:39:37.370Z Approve Technological uncertainties
2026-10-01T03:39:39.302Z approved active_uncertainties
2026-10-01T03:39:39.302Z Skip Previous-year status
2026-10-01T03:39:40.577Z Open Work plan and wait for its Batch
2026-10-01T03:39:57.521Z Work plan: select the first Seed
2026-10-01T03:39:59.415Z Approve Work plan
2026-10-01T03:40:01.383Z approved workplan
2026-10-01T03:40:01.383Z Open Hypothesis and wait for its Batch
2026-10-01T03:40:23.582Z Hypothesis: select the first Seed
2026-10-01T03:40:25.479Z Approve Hypothesis
2026-10-01T03:40:27.395Z approved hypothesis
2026-10-01T03:40:27.395Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T03:40:54.734Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T03:40:57.934Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-01T03:41:00.479Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-01T03:41:02.419Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-01T03:41:02.419Z Open Advancement to science / technology and wait for its Batch
2026-10-01T03:41:19.671Z Advancement to science / technology: select the first Seed
2026-10-01T03:41:21.569Z Approve Advancement to science / technology
2026-10-01T03:41:23.485Z approved overall_advancement
2026-10-01T03:41:23.485Z Open Specific technological advancements and wait for its Batch
2026-10-01T03:41:45.611Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T03:41:50.702Z Approve Specific technological advancements
2026-10-01T03:41:52.626Z approved specific_advancements
2026-10-01T03:41:52.626Z Open Project status and next steps and wait for its Batch
2026-10-01T03:42:04.281Z Project status and next steps: select the first Seed
2026-10-01T03:42:06.203Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-01T03:42:08.120Z Approve Project status and next steps
2026-10-01T03:42:10.068Z approved project_status
2026-10-01T03:42:10.068Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T03:42:27.407Z Overall company / project goal improvements: select the first Seed
2026-10-01T03:42:29.330Z Approve Overall company / project goal improvements
2026-10-01T03:42:31.314Z approved goal_improvements
2026-10-01T03:42:31.314Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T03:42:32.607Z signed off; waiting for the report
2026-10-01T03:45:08.082Z report kd7eh3a3scgfpnt85161r9qsp18ffk2c created
```
