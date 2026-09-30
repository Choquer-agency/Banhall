# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `67be8f06`, acting as e2e-audit@banhall.local. Project `k97e37gda18qrzafyta1f7vr1d8fcspv`, generation `k5723khs4k05kyv5wwt8vwpbed8fdjqs`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: Yes. Plan item 9 (edited, exclusion confirmed) is drafted in Line 244 paragraph 3: "the team confirmed that migrating the customer billing portal to a new cloud host was routine IT work with no such uncertainty." The disclaimer is the writer's own pasted exclusion sentence, the owner's recorded known limitation (2026-09-29 second amendment). Two Glossary repairs were refused because the repaired text no longer covered the kept idea.
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: Yes. The item row reads "applied | conflict | Drafted despite the Claim Exclusion", the exclusion row "not_applied | conflict | suspended in this Line for the idea the writer kept", and the consistency pass also notes it.
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: Yes. Line 246 paragraph 3: "A second field trial at the Ashgrove elevator is booked for spring 2027." No invented numbers, dates or results.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (339, 673, 343). Line 242 names "Quillmere Analytics Ltd., based in Carrow, Saskatchewan", matching the manifest.

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, high confidence. Run 6 defects fixed: the kept selection is drafted and its conflict row is decided from the text, and the company name is right ("Quillmere Client" 0 times). Minors: "In parallel" is invented (the migration was in the fall), a few inferences the sources do not make, and false contradictions from the consistency pass. Every figure checked matches the sources.

## Automatic checks

15 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7a28zp6hgde7bdqv90wjnk4h8fd79z |
| All three Sections were drafted | pass | 242: 339 words, 244: 673 words, 246: 343 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Seed-stage requests (informational; notice at 40, never refused) | info | 14 metered calls (14 Batch, 0 Feedback), 15 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Migration of the customer billing portal to a new cloud host was routine IT work with n..." (routine_engineering); "Dashboard colour and layout redesign was cosmetic and not technological." (not_technological); "Customer training sessions for dealers and operators are a business/sales activity." (business_risk); "The billing portal move, dashboard update, and training sessions are explicitly recorde..." (not_technological) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1790792602249 |
| The matching selection is signed off with the confirmed exclusion | pass | "The baseline isolation forest test aimed to measure how drift breaks detection without a trusted reference sensor. The work also covered this: Migration of t..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Migration of the customer billing portal to a new cloud host was routi..."; 244: "Cover signed-off Summary item ys79z6v2fy43wn0qt4a2kf65118fcvf7" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 89 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model continues in spring shadow mode on the same nine dryers as of June 2026. The writer confirms a second field trial at the Ashgrove elevator is booke..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P3 covers status, hours, Ashgrove trial, open items" |
| Where "Ashgrove" appears in the drafted Section | info | "during spring to test detection against. A second field trial at the Ashgrove elevator is booked for spring 2027. Moisture sensor drift remains unr" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and cloud analytics software for continuous flow tower and mixed flow grain dryers. / The team has 25 people, with eight in engineering and a CTO present since founding in 2017. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The objective was an anomaly detection model for grain dryer controllers giving early warning of burner and process faults. / The goal was to warn operators at least 15 minutes before flame instability, valve sticking, igniter faults, or plugged columns become dangerous. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice used fixed threshold alarms that triggered late, after the fault was already well along. / The standard fix of retraining on drifted data risked teaching the model that drift was normal. _(writer-asserted)_

### 4. Technological objectives (Section 242, standard): approved

- The new knowledge sought was whether a model could separate slow sensor drift from real slow developing faults without labelled drift data. / This uncertainty had to be resolved while holding false alarms low without losing detection lead time. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether drift compensation could work without a trusted reference sensor or periodic calibration. / The dryer physics is coupled across burner output, air flow, grain flow and ambient conditions, making bias separation uncertain. _(cited)_
- Only 11 documented faults from the 2024 season were available, raising doubt about whether that was enough to validate any model. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team defined false alarm rate and lead time definitions in July 2025 before any testing began. / A staged, falsifiable plan moved from baseline rebuild to synthetic drift to a physics based residual model to field trials. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use physics based energy balance residuals with online redundancy tracked sensor bias, then false alarms stay below 0.25 per dryer-day. / The same hypothesis predicted a median detection lead time of at least 15 minutes under drift up to 3 degrees C per month. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The baseline isolation forest test aimed to measure how drift breaks detection without a trusted reference sensor. / The work also covered this: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "It was uncertain whether drift compensation could work without a tr..."
- Synthetic drift training was attempted next to make the model tolerant of coupled physical changes without calibration. / It cut false alarms but destroyed detection, missing all three column-plugging faults, so the approach was dropped. _(cited)_
  - Tested: uncertainty "It was uncertain whether drift compensation could work without a tr..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The energy balance residual model with online bias tracking achieved the hypothesis, reaching 0.18 false alarms and 22 minute lead time. / This met the false alarm target and exceeded the 15 minute lead time goal, resolving the drift versus detection trade-off. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Experiments on the coupled physics uncertainty showed synthetic drift training was the wrong approach for this problem. _(cited)_
  - Links: uncertainty "It was uncertain whether drift compensation could work without a tr..."; experiments "The baseline isolation forest test aimed to measure how drift break...", "Synthetic drift training was attempted next to make the model toler..."
- The baseline and synthetic drift experiments together confirmed a direct trade-off between drift tolerance and fault detection. / Making the model tolerant of slow change also made it slower to catch slow developing faults like column plugging. _(writer-asserted)_
  - Links: uncertainty "It was uncertain whether drift compensation could work without a tr..."; experiments "Synthetic drift training was attempted next to make the model toler..."

### 12. Project status and next steps (Section 246, standard): approved

- The model continues in spring shadow mode on the same nine dryers as of June 2026. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. / As of June 26, 2026, 1,850 dryer-hours were logged with no real events during spring. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The energy balance residual model met the original goal of warning operators at least 15 minutes before faults. / This directly resolved the early need for early fault warning against burner and process faults like plugged columns. _(cited)_

## Drafted Sections

### Line 242

Quillmere Analytics Ltd., based in Carrow, Saskatchewan, builds controllers and cloud analytics software for continuous-flow tower and mixed-flow grain dryers used on large farms and at elevators. The company has 25 employees, including an eight-person engineering team led by a CTO in place since the company's founding in 2017. This background in dryer control and sensor data gives the team direct exposure to the burner and process faults, and the sensor behaviour, that motivated this project.

The goal was an anomaly detection model, running on the dryer controller, giving operators early warning of burner faults (flame instability, fuel valve sticking, igniter problems) and process faults such as column plugging. The target was to flag these faults at least 15 minutes before they became dangerous.

The limitations to standard practice were that fixed threshold alarms triggered only once a fault was already well along, leaving no working method to tell sensor drift apart from a real developing fault. The standard fix of retraining a model on drifted data risked teaching it that drift was normal, which could mask slow real faults such as gradual column plugging.

The technological objective was to advance the understanding of whether sensor drift could be separated from real slow-developing faults without labelled drift examples, for the purpose of building a fault detection model, using an energy balance residual model, that held false alarms low without losing detection lead time.

It was uncertain whether drift compensation could work without a trusted reference sensor or periodic calibration, since published methods assumed access to one or the other and grain dryers in the field have neither. Separating sensor bias from real process change was uncertain because burner output, air flow, grain flow, ambient conditions and grain moisture are physically coupled, so a shift in one reading could reflect drift or a genuine fault. It was also uncertain whether the 11 documented faults available from the 2024 season gave enough evidence to validate any candidate approach, given how rare and varied burner and column faults are across a season.

### Line 244

The technological problem was to separate real, slowly developing faults such as column plugging from ordinary sensor drift, without labelled drift examples, a trusted reference sensor, or mid-harvest recalibration. The team fixed its definitions of false alarm rate and detection lead time in July 2025, before running any tests, so those targets could not be adjusted later based on results. The planned approach moved in stages: rebuild the existing isolation forest baseline and measure its failure under drift, attempt training with synthetic injected drift, then build a physics based residual model with online sensor bias tracking, and finally validate the result in the field.

It was hypothesized that if anomaly scores were computed from residuals of a physics based energy balance model, with each sensor's bias tracked online using redundancy between sensors, then false alarms would stay below 0.25 per dryer-day under drift up to 3 C per month, while median detection lead time on burner and column faults would stay at or above 15 minutes.

The first test addressed whether a baseline anomaly model could hold up under drift with no reference sensor to correct against. The team rebuilt an isolation forest model on 2024 data from 14 dryers, about 11,000 dryer-hours, and tested it against injected drift of 1, 2, and 3 C per month. The false alarm rate rose from 0.3 per dryer-day at zero drift to 2.6 at 3 C per month, and the model caught only 9 of 11 real faults at a 9-minute median lead time, below target even before drift was introduced. This confirmed that a model with no way to separate drift from true signal change would fail in the field. In parallel, the team confirmed that migrating the customer billing portal to a new cloud host was routine IT work with no such uncertainty.

The second test asked whether exposing the model to synthetic drift during training would teach it to ignore drift while still catching real faults. The team injected random synthetic drift, 0.5 to 3 C per month in temperature and up to 1.5 points per month in moisture, into the training data. False alarms dropped to 0.6 per dryer-day at 2 C drift, but detection collapsed: the model caught only 6 of 11 faults and missed all three column-plugging faults, having learned to treat slow real rises as normal drift. Drift tolerance and detection sensitivity worked directly against each other under this method, so the team dropped the synthetic drift approach entirely.

The third test asked whether a physics based residual model with redundancy based bias tracking could resolve that trade-off. The team built an energy balance model predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity, then used a Kalman filter bias state, rate-limited and gated to update only during steady-state conditions, to track drift using agreement between two plenum sensors. Under 3 C per month drift, false alarms fell to 0.18 per dryer-day and the model caught 10 of 11 faults, including all three column plugs, at a 22-minute median lead time, missing only an igniter fault on a dryer with a single plenum sensor. This showed sensor redundancy, not the residual model alone, was the limiting factor in performance.

The fourth test validated the approach under harvest conditions using shadow mode on 9 customer dryers. Dual-sensor dryers averaged 0.21 false alarms per dryer-day and flagged all four real events, two flame instability and two plugging faults, at lead times of 14, 19, 26 and 31 minutes, while single-sensor dryers averaged 0.64 false alarms per dryer-day. This gap confirmed the redundancy dependency held under live field conditions, not just on historical data.

The fifth test addressed that single-sensor gap by using exhaust temperature as an indirect reference for bias tracking. Replayed against the fall trial data, this cut the single-sensor false alarm rate from 0.64 to 0.33 per dryer-day, with no change in detection of the four real events, showing exhaust temperature can partly, but not fully, substitute for a missing second plenum sensor.

### Line 246

The technological objective was to determine whether sensor drift could be separated from real, slow-developing faults without labelled drift examples, a trusted reference sensor, or recalibration. The energy balance residual model with online sensor bias tracking achieved the hypothesis, reaching a false alarm rate of 0.18 per dryer-day and a median detection lead time of 22 minutes under 3 C per month drift. This met the false alarm target and exceeded the 15 minute lead time goal, resolving the drift versus detection trade-off that the earlier methods could not.

Experiments on the coupled physics uncertainty showed synthetic drift training was the wrong approach for this problem. It was uncertain whether drift compensation could work without a trusted reference sensor or periodic calibration, since the dryer's physics couples burner output, air flow, grain flow and ambient conditions in ways that make bias separation difficult to resolve directly. The baseline isolation forest test measured how drift breaks detection under these conditions, and synthetic drift training was attempted next to make the model tolerant of coupled physical change without calibration. It cut false alarms but destroyed detection, missing all three column-plugging faults, so the approach was dropped. Together these experiments confirmed a direct trade-off between drift tolerance and fault detection: making the model tolerant of slow change also made it slower to catch slow developing faults like column plugging.

The model continues in spring shadow mode on the same nine dryers as of June 2026, with 1,850 dryer-hours logged and no real events during spring to test detection against. A second field trial at the Ashgrove elevator is booked for spring 2027. Moisture sensor drift remains unresolved, flame instability lead time remains marginal against the 15 minute target, and single-sensor dryer performance remains above target, each left open for further work.

The energy balance residual model met the original goal of warning operators at least 15 minutes before faults. This directly resolved the early need for early warning against burner and process faults like plugged columns, improving on the fixed threshold alarms that standard practice offered.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 339/350 words, 35/50 lines |
| 242 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly recorded as outside the claimed project. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: energy balance residual model | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Storyline | applied | none |  | Section matches storyline background and uncertainties |
| 242 | Confidence Map: Isolation forest baseline results at 0, 2, and 3 C/month drift, and overall fault capture and lead time, are established via both the transcript and the development log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: The development log provides a matching, more granular version of baseline results including the 1 C/month data point. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Synthetic drift training results (false alarms, faults caught, missed column plugs) are established and consistent across transcript and log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Energy balance residual model results (0.18 false alarms, 10 of 11 faults, 22 min lead time) are established and consistent across sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Harvest shadow trial results for dual and single sensor dryers, and the four real events with lead times, are established and consistent across sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Single-sensor dryer shadow trial false alarm rate is established. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Exhaust-temperature fallback result for single-sensor dryers is established. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Spring shadow mode continuation with partial-season data is a partial result, since the season is not complete and no real events have occurred yet to test detection. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Moisture sensor drift handling remains unresolved / not yet achieved with the same method. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Flame instability detection lead time is only partially established, being marginal relative to the 15 minute target. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Drift profile characterization from calibration checks is an established, distinct data point from the log not repeated in the transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Controller inference time is an established engineering detail found only in the log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Embedded porting effort to run the model on the controller itself is established from the transcript, not corroborated in the log. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: false alarm rate | applied | none |  | Concept of false alarm rate absent from section |
| 242 | Glossary Term: shadow mode | applied | none |  | Shadow mode not mentioned in this section |
| 242 | Glossary Term: energy balance residual model | applied | none |  | P5 discusses drift/fault separation without naming it; repaired to the Glossary Term |
| 242 | Glossary Term: sensor redundancy | applied | none |  | Sensor redundancy concept not present in section |
| 242 | Glossary Term: kalman filter bias state | applied | none |  | Kalman filter concept not present in section |
| 242 | Glossary Term: online sensor bias tracking | applied | none |  | Online sensor bias tracking concept not present |
| 242 | Glossary Term: steady-state gating | applied | none |  | Steady-state gating concept not present in section |
| 242 | Cover signed-off Summary item ys77ea68avevef5fxgb37fh3518fc164 | applied | none |  | P1 gives company, products, size, CTO since 2017. |
| 242 | Cover signed-off Summary item ys75nkxzdntmf0v5q7gn8b0qgh8fce5b | applied | none |  | P2 states goal, fault types, 15 min warning. |
| 242 | Cover signed-off Summary item ys7ds64tnssvy08b83d01vbhk98fd5h9 | applied | none |  | P3 covers late alarms and retraining risk. |
| 242 | Cover signed-off Summary item ys75rh3fw8azc5kvaymfdkbrp18fc08t | applied | none |  | P4 states objective with false alarm/lead time constraint. |
| 242 | Cover signed-off Summary item ys74a6j7jnrhjtn5afbnsqbsv58fc4ra | applied | none | 2 | P5 covers reference sensor/calibration and coupled physics… |
| 242 | Cover signed-off Summary item ys76k6rmxxavnnnkwmg2h9pf958fc56y | applied | none | 2 | P5 covers 11 faults validation uncertainty. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 673/700 words, 64/100 lines |
| 244 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering); its words are not in this Line as written, and the idea's own row says whether it was drafted |
| 244 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly recorded as outside the claimed project. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: sensor redundancy | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: kalman filter bias state | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: online sensor bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Storyline | applied | none |  | Section matches storyline experiments and results |
| 244 | Confidence Map: Isolation forest baseline results at 0, 2, and 3 C/month drift, and overall fault capture and lead time, are established via both the transcript and the development log. | applied | none |  | P3 baseline results stated flatly, matches established |
| 244 | Confidence Map: The development log provides a matching, more granular version of baseline results including the 1 C/month data point. | applied | none |  | P3 gives drift levels; 1C point not singled out but fine |
| 244 | Confidence Map: Synthetic drift training results (false alarms, faults caught, missed column plugs) are established and consistent across transcript and log. | applied | none |  | P4 synthetic drift results stated flatly, matches established |
| 244 | Confidence Map: Energy balance residual model results (0.18 false alarms, 10 of 11 faults, 22 min lead time) are established and consistent across sources. | applied | none |  | P5 residual model results stated flatly, matches established |
| 244 | Confidence Map: Harvest shadow trial results for dual and single sensor dryers, and the four real events with lead times, are established and consistent across sources. | applied | none |  | P6 shadow trial results stated flatly, matches established |
| 244 | Confidence Map: Single-sensor dryer shadow trial false alarm rate is established. | applied | none |  | P6 single-sensor rate stated flatly, matches established |
| 244 | Confidence Map: Exhaust-temperature fallback result for single-sensor dryers is established. | applied | none |  | P7 exhaust fallback stated flatly, matches established |
| 244 | Confidence Map: Spring shadow mode continuation with partial-season data is a partial result, since the season is not complete and no real events have occurred yet to test detection. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Moisture sensor drift handling remains unresolved / not yet achieved with the same method. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Flame instability detection lead time is only partially established, being marginal relative to the 15 minute target. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Drift profile characterization from calibration checks is an established, distinct data point from the log not repeated in the transcript. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Controller inference time is an established engineering detail found only in the log. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Embedded porting effort to run the model on the controller itself is established from the transcript, not corroborated in the log. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: energy balance residual model | not_applied | none |  | Section says 'physics based residual model' not term; repair not used (the repaired text no longer covers the idea the writer kept despite a Claim Exclusion ("The baseline isolation forest test aimed to measure how drift breaks detection without a trusted reference sensor...."), so the checked draft was kept) |
| 244 | Glossary Term: steady-state gating | not_applied | none |  | Section says 'gated to update only during steady-state'; repair not used (the repaired text no longer covers the idea the writer kept despite a Claim Exclusion ("The baseline isolation forest test aimed to measure how drift breaks detection without a trusted reference sensor...."), so the checked draft was kept) |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status role absent from section |
| 244 | Cover signed-off Summary item ys7ft13csdkf9rhcmtyqyasq8x8fddem | applied | none |  | P1 gives fixed definitions date and staged plan |
| 244 | Cover signed-off Summary item ys7awj6ynqse4z630mpjcc0czs8fdc1q | applied | none |  | P2 states hypothesis with both targets |
| 244 | Cover signed-off Summary item ys79z6v2fy43wn0qt4a2kf65118fcvf7 | applied | conflict |  | Drafted despite the Claim Exclusion "Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty.": the writer kept the idea "The baseline isolation forest test aimed to measure how drift breaks detection without a trusted reference sensor...." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item ys75xt5tejf6bekhg6v6gzphzs8fc65t | applied | none |  | P4 covers synthetic drift purpose and dropped result |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If anomaly scores use physics based energy balance residuals with online redundancy tracked sensor bias, then false ala..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): The sentence noting the team confirmed that migrating the customer billing portal to a new cloud host was routine IT work with no such uncertainty restates the excluded billing portal idea. Per the exclusion note, this specific signed-off idea should be kept, but its presence here should be flagged since it sits inside the work performed narrative rather than as a clearly separated note. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 343/350 words, 34/50 lines |
| 246 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The billing portal move, dashboard update, and training sessions are explicitly recorded as outside the claimed project. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: energy balance residual model | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: online sensor bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Storyline | applied | none |  | P3 matches storyline open items and status |
| 246 | Confidence Map: Isolation forest baseline results at 0, 2, and 3 C/month drift, and overall fault capture and lead time, are established via both the transcript and the development log. | applied | none |  | Baseline results not flatly restated beyond established facts |
| 246 | Confidence Map: The development log provides a matching, more granular version of baseline results including the 1 C/month data point. | applied | none |  | 1 C/month data point not mentioned in section |
| 246 | Confidence Map: Synthetic drift training results (false alarms, faults caught, missed column plugs) are established and consistent across transcript and log. | applied | none |  | Synthetic drift results stated match established facts |
| 246 | Confidence Map: Energy balance residual model results (0.18 false alarms, 10 of 11 faults, 22 min lead time) are established and consistent across sources. | applied | none |  | 0.18 FA, 22 min lead time stated match established facts |
| 246 | Confidence Map: Harvest shadow trial results for dual and single sensor dryers, and the four real events with lead times, are established and consistent across sources. | applied | none |  | Harvest shadow trial details not mentioned in this section |
| 246 | Confidence Map: Single-sensor dryer shadow trial false alarm rate is established. | applied | none |  | Single-sensor shadow FA rate not stated here |
| 246 | Confidence Map: Exhaust-temperature fallback result for single-sensor dryers is established. | applied | none |  | Exhaust-temperature fallback not mentioned in section |
| 246 | Confidence Map: Spring shadow mode continuation with partial-season data is a partial result, since the season is not complete and no real events have occurred yet to test detection. | applied | none |  | Spring shadow mode described as partial, no events yet |
| 246 | Confidence Map: Moisture sensor drift handling remains unresolved / not yet achieved with the same method. | applied | none |  | Moisture drift called unresolved, matches partial status |
| 246 | Confidence Map: Flame instability detection lead time is only partially established, being marginal relative to the 15 minute target. | applied | none |  | Flame lead time called marginal, hedged appropriately |
| 246 | Confidence Map: Drift profile characterization from calibration checks is an established, distinct data point from the log not repeated in the transcript. | applied | none |  | Drift profile characterization not mentioned in section |
| 246 | Confidence Map: Controller inference time is an established engineering detail found only in the log. | applied | none |  | Controller inference time not mentioned in section |
| 246 | Confidence Map: Embedded porting effort to run the model on the controller itself is established from the transcript, not corroborated in the log. | applied | none |  | Embedded porting effort not mentioned in section |
| 246 | Glossary Term: false alarm rate | applied | none |  | Uses 'false alarms per dryer-day' not the exact term; repaired to the Glossary Term |
| 246 | Glossary Term: detection lead time | applied | none |  | Uses 'lead time' not 'detection lead time'; repaired to the Glossary Term |
| 246 | Glossary Term: sensor redundancy | applied | none |  | Sensor redundancy concept not mentioned in section |
| 246 | Glossary Term: kalman filter bias state | applied | none |  | Kalman filter bias state not mentioned in section |
| 246 | Glossary Term: online sensor bias tracking | applied | none |  | Uses 'online bias tracking' not full glossary term; repaired to the Glossary Term |
| 246 | Glossary Term: steady-state gating | applied | none |  | Steady-state gating concept not mentioned in section |
| 246 | Cover signed-off Summary item ys71bhth9n5p7r1qh05k94q3ys8fdyz1 | applied | none |  | P1 states results, meets/exceeds targets |
| 246 | Cover signed-off Summary item ys78b618e8bqske11kfarvv8nd8fcynv | applied | none | 2 | P2 covers uncertainty, isolation forest, synthetic drift |
| 246 | Cover signed-off Summary item ys76745v8hy3f7vmpjhpy4pxg98fcyer | applied | none | 2 | P2 states the drift/detection trade-off conclusion |
| 246 | Cover signed-off Summary item ys79bec5fa81hr1azdpahqxcgh8fd9r4 | applied | none |  | P3 covers status, hours, Ashgrove trial, open items |
| 246 | Cover signed-off Summary item ys7a1ate11n6ac8vfqe8k3bc8x8fct2n | applied | none |  | P4 states goal met and improvement over fixed thresholds |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The energy balance residual model met the original goal of warning operators at least 15 minutes before faults. This di..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): 246 P3 states single-sensor dryer performance remains above target as an unresolved open item, but 244 P7 reports that adding exhaust temperature as an indirect reference cut the single-sensor false alarm rate from 0.64 to 0.33 per dryer-day. The draft does not reconcile whether 0.33 still exceeds the 0.25 target or whether this issue was substantially addressed by the fifth test. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 242, 246): 246 P3 lists flame instability lead time as remaining marginal against the 15 minute target, but 244 P6 reports flame instability faults were flagged at lead times of 14, 19, 26 and 31 minutes in shadow mode, and 246 P1 reports the overall median lead time of 22 minutes exceeded the 15 minute goal. The draft does not explain why flame instability specifically is still marginal given these numbers. |
| 246 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 246 paragraph 2 (sections 242, 246): 246 P2 restates the uncertainty about drift compensation without a trusted reference sensor almost verbatim from 242 P5, but drops the third uncertainty from 242 P5 about whether the 11 documented faults gave enough evidence to validate a candidate approach. This uncertainty is never addressed or closed anywhere in 244 or 246. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 27.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 25.

## Seed-stage numbers

- Requests: 14 metered (14 Batch, 0 Feedback); 15 reserved; notice at 40 not shown.
- Dispatch to validated result: median 10.8 s, p95 22.4 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.9 s, p95 12.9 s over 1.
- Sign-off to report created: 130.3 s.
- Cost from aiUsage: $0.95 in all ($0.33 seed stage, $0.62 Brief, drafting and checks) over 40 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T18:19:57.875Z created project k97e37gda18qrzafyta1f7vr1d8fcspv
2026-09-30T18:19:58.530Z added document model-development-log.md
2026-09-30T18:20:00.092Z started Step by step generation k5723khs4k05kyv5wwt8vwpbed8fdjqs
2026-09-30T18:20:48.497Z seed stage open
2026-09-30T18:20:48.497Z Open Company / Context and wait for its Batch
2026-09-30T18:21:00.683Z Company / Context: select the first Seed
2026-09-30T18:21:02.688Z Approve Company / Context
2026-09-30T18:21:04.713Z approved company_context
2026-09-30T18:21:04.713Z Open Goal / Problem and wait for its Batch
2026-09-30T18:21:19.207Z Goal / Problem: select the first Seed
2026-09-30T18:21:21.210Z Approve Goal / Problem
2026-09-30T18:21:23.251Z approved goal_problem
2026-09-30T18:21:23.251Z Open Technological limitations and wait for its Batch
2026-09-30T18:21:35.200Z Technological limitations: select the first Seed
2026-09-30T18:21:37.222Z Approve Technological limitations
2026-09-30T18:21:39.201Z approved passive_limitations
2026-09-30T18:21:39.201Z Open Technological objectives and wait for its Batch
2026-09-30T18:21:53.691Z Technological objectives: select the first Seed
2026-09-30T18:21:56.016Z Approve Technological objectives
2026-09-30T18:21:58.001Z approved technological_objective
2026-09-30T18:21:58.001Z Open Technological uncertainties and wait for its Batch
2026-09-30T18:22:12.566Z Technological uncertainties: select the first 2 Seeds
2026-09-30T18:22:15.941Z Approve Technological uncertainties
2026-09-30T18:22:17.992Z approved active_uncertainties
2026-09-30T18:22:17.992Z Skip Previous-year status
2026-09-30T18:22:19.342Z Open Work plan and wait for its Batch
2026-09-30T18:22:34.262Z Work plan: select the first Seed
2026-09-30T18:22:36.291Z Approve Work plan
2026-09-30T18:22:38.301Z approved workplan
2026-09-30T18:22:38.301Z Open Hypothesis and wait for its Batch
2026-09-30T18:22:52.955Z Hypothesis: select the first Seed
2026-09-30T18:22:54.947Z Approve Hypothesis
2026-09-30T18:22:56.954Z approved hypothesis
2026-09-30T18:22:56.955Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T18:23:14.265Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T18:23:17.651Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-09-30T18:23:20.291Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-09-30T18:23:22.311Z approved experimentation (confirmed 1 Claim Exclusion)
2026-09-30T18:23:22.311Z Open Advancement to science / technology and wait for its Batch
2026-09-30T18:23:36.961Z Advancement to science / technology: select the first Seed
2026-09-30T18:23:38.960Z Approve Advancement to science / technology
2026-09-30T18:23:41.027Z approved overall_advancement
2026-09-30T18:23:41.027Z Open Specific technological advancements and wait for its Batch
2026-09-30T18:24:06.903Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T18:24:12.338Z Approve Specific technological advancements
2026-09-30T18:24:14.307Z approved specific_advancements
2026-09-30T18:24:14.307Z Open Project status and next steps and wait for its Batch
2026-09-30T18:24:26.232Z Project status and next steps: select the first Seed
2026-09-30T18:24:28.307Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-09-30T18:24:30.329Z Approve Project status and next steps
2026-09-30T18:24:32.398Z approved project_status
2026-09-30T18:24:32.398Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T18:24:44.357Z Overall company / project goal improvements: select the first Seed
2026-09-30T18:24:46.373Z Approve Overall company / project goal improvements
2026-09-30T18:24:48.425Z approved goal_improvements
2026-09-30T18:24:48.425Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T18:24:49.759Z signed off; waiting for the report
2026-09-30T18:27:00.823Z report kd7a28zp6hgde7bdqv90wjnk4h8fd79z created
```
