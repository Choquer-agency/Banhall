# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `9de29da9`, acting as e2e-audit@banhall.local. Project `k9725e25ht3c4am88arkq9t8f18fctmt`, generation `k572e8vpzrtf0ys8rf1rekr7bd8fcw52`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: Yes. Line 244 paragraph 3: "this work also covered migration of the customer billing portal to a new cloud host, which was routine IT work following a vendor migration guide", the writer's edited item 9, disclaimer included (the owner's recorded known limitation). Two Glossary repairs were set aside because they no longer covered the kept idea.
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: Yes. The item row reads "applied | conflict | Drafted despite the Claim Exclusion" and the exclusion row "not_applied | conflict | suspended in this Line".
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: Yes. Line 246 paragraph 5: "A second field trial at the Ashgrove elevator is booked for spring 2027." No invented numbers or results.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (316, 681, 349). The company is "Quillmere Analytics Ltd."; "Quillmere Client" 0 times.

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, high confidence. Unchanged from run 10. Minors: the exclusion row says its words "are not in this Line as written" although they are; "met, though partially" beside "met its original goal"; a false contradiction from the consistency pass. Every figure checked matches the sources.

## Automatic checks

15 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd77cms2rgq855hjsx47sfdt9x8fdbzh |
| All three Sections were drafted | pass | 242: 316 words, 244: 681 words, 246: 349 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 17 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Migration of the customer billing portal to a new cloud host was routine IT work follow..." (routine_engineering); "Dashboard colour and layout redesign was cosmetic and not technological." (not_technological); "Customer training sessions for dealers and operators are a business/sales activity." (not_technological); "The three excluded activities are formally tracked separately from the project." (not_technological) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1790801789887 |
| The matching selection is signed off with the confirmed exclusion | pass | "The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month. The work also covered this: Migration of the ..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Migration of the customer billing portal to a new cloud host was routi..."; 244: "Cover signed-off Summary item ys749368c23gdemgwge9r0a31x8fcj08" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model is running in spring shadow mode on the same nine dryers with no live alerts yet. The writer confirms a second field trial at the Ashgrove elevator..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P5 covers shadow mode, Ashgrove trial, next steps." |
| Where "Ashgrove" appears in the drafted Section | info | "same nine dryers with no live alerts yet. A second field trial at the Ashgrove elevator is booked for spring 2027. A full season with alerts shown t" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and cloud analytics for continuous-flow and mixed-flow grain dryers. / Its controller reads temperature and moisture sensors and runs the burner and discharge rate. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The team set out to build an anomaly detection model that warns operators of burner and process faults. / The goal was early warning of flame instability, valve sticking, igniter problems and plugged columns. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard fixed threshold alarms only trigger once plenum temperature crosses a set point, arriving too late. / Standard practice could not tell sensor drift apart from a genuinely slow-developing fault. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to know whether a model could separate slow sensor drift from genuinely slow-developing faults without labelled drift data. / This knowledge was meant to enable reliable detection despite the lack of a trusted reference sensor or periodic calibration. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether 11 documented faults from the 2024 season were enough data to validate the model. / Real faults are rare compared to normal operating data, which made validation itself an open question. _(cited)_
- Sensors drift 1 to 3 degrees C per month for temperature and up to 1.5 points per month for moisture. / It was unclear whether any model could hold false alarms low without losing lead time as drift grew. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a phased approach: rebuild the baseline, try synthetic drift, then build a physics-based residual model, then field trial. / They fixed false alarm and lead time definitions in July 2025 before running any experiment. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use residuals of a physics-based energy balance, then bias tracked online via sensor redundancy holds false alarms under drift. / The hypothesis targeted false alarms below 0.25 per dryer per day with drift up to 3 degrees C per month. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month. / The work also covered this: Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "Sensors drift 1 to 3 degrees C per month for temperature and up to ..."
- The baseline caught 9 of 11 real faults but with only a 9 minute median lead time, short of the 15 minute goal. _(cited)_
  - Tested: uncertainty "Sensors drift 1 to 3 degrees C per month for temperature and up to ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team disproved synthetic drift training as a workable approach since it hid slow faults. / Energy balance residuals with online redundancy based bias tracking became the accepted method instead. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The baseline experiments confirmed false alarms rise sharply with drift, reaching 2.6 per dryer-day at 3 degrees C per month. / This established that fixed thresholds and a plain isolation forest cannot hold false alarms low as drift grows. _(cited)_
  - Links: uncertainty "Sensors drift 1 to 3 degrees C per month for temperature and up to ..."; experiments "The baseline caught 9 of 11 real faults but with only a 9 minute me...", "The team rebuilt the isolation forest baseline and tested it with i..."
- The team learned that catching most faults did not guarantee adequate warning, since lead time can still fall short. / The baseline caught 9 of 11 faults yet gave only a 9 minute median lead time against a 15 minute goal. _(cited)_
  - Links: uncertainty "Sensors drift 1 to 3 degrees C per month for temperature and up to ..."; experiments "The baseline caught 9 of 11 real faults but with only a 9 minute me...", "The team rebuilt the isolation forest baseline and tested it with i..."

### 12. Project status and next steps (Section 246, standard): approved

- The model is running in spring shadow mode on the same nine dryers with no live alerts yet. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. / A full season with alerts shown to operators is still needed before wider release. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project met its original goal: energy balance residuals with redundancy based bias tracking gave early warning under drift. / False alarms held near 0.2 per dryer-day and lead times reached about 20 minutes, meeting the 15 minute target. _(cited)_

## Drafted Sections

### Line 242

Quillmere Analytics Ltd. builds controllers and cloud analytics software for continuous-flow and mixed-flow grain dryers used on large farms and at elevators. Its controller reads temperature and moisture sensors on the dryer and directly runs the burner and discharge rate, giving the company direct exposure to how those sensors behave and fail over a full harvest. That operating position is what surfaced the sensor drift problem this project addresses.

The team set out to build an anomaly detection model that warns operators of burner and process faults, including flame instability, fuel valve sticking, igniter problems and plugged columns. The goal was early warning, ideally 15 minutes or more, before a fault became dangerous.

The limitations to standard practice were that fixed-threshold alarms on plenum temperature only trigger after a set point is crossed, which arrives too late for early warning. No documented method existed for telling sensor drift apart from a genuinely slow-developing fault such as column plugging, since published drift-compensation approaches assume a trusted reference sensor or periodic recalibration, neither of which exists on a dryer mid-harvest.

The technological objective was to advance the understanding of how to separate slow sensor drift from genuinely slow-developing faults without labelled drift examples, for the purpose of enabling reliable fault detection without a trusted reference sensor or periodic calibration.

It was uncertain whether 11 documented faults from the 2024 season were enough data to validate any detection approach, because real faults are rare relative to normal operating data and each added fault carries disproportionate weight in judging reliability. It was also uncertain whether any model could hold false alarms low as drift accumulated, since temperature sensors drift 1 to 3 C per month and moisture sensors up to 1.5 points per month, and it was not known whether tolerance to that drift could be achieved without also losing detection lead time on real faults developing at similar timescales.

### Line 244

The company undertook a systematic investigation into whether burner and column faults could be distinguished from sensor drift without a trusted reference sensor and without mid-harvest recalibration. The team fixed precise definitions for false alarm rate and detection lead time in July 2025 before running any experiment, so that every later result could be judged against the same yardstick. The planned approach moved in stages: rebuild the isolation forest baseline and measure how it failed under drift, attempt synthetic drift training, then build a physics-based residual model with online bias tracking, then validate it in a field shadow trial. Each stage was designed to test a distinct piece of the uncertainty described in Section 242, from whether drift tolerance could be achieved at all to whether it could be achieved without losing lead time on real faults.

It was hypothesized that if anomaly scores were computed on the residuals of a physics-based energy balance, predicting plenum temperature from fuel rate, air flow and ambient conditions, and each sensor's bias was tracked online using redundancy between sensors, then false alarms would stay below 0.25 per dryer-day under drift up to 3 C per month while median detection lead time on burner and column faults remained at least 15 minutes.

The first uncertainty was whether the existing unsupervised approach could survive drift in the field at all. The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month; this work also covered migration of the customer billing portal to a new cloud host, which was routine IT work following a vendor migration guide. At zero drift the false alarm rate was 0.3 per dryer-day, but it rose to 1.4 per day at 2 C per month and 2.6 per day at 3 C per month by week four. The baseline caught 9 of 11 real faults but with only a 9 minute median lead time, short of the 15 minute goal. This confirmed that drift degrades an unsupervised model past the point of operational use even before lead time is considered.

The next question was whether making the model tolerant of drift could solve the problem directly. The team injected synthetic drift into the training data so the model would learn to treat gradual change as normal. False alarms fell to 0.6 per dryer-day at 2 C drift, but only 6 of 11 faults were caught, and all three column-plugging faults were missed because the model had learned to treat their slow rise as ordinary drift. This showed synthetic drift training was the wrong approach for this application, since it hides the very faults that develop slowly, and the team dropped it in favour of a physics-based method.

With drift tolerance and fault sensitivity shown to work against each other, the team asked whether the physics of the dryer itself could separate bias from real change. They built a per-dryer energy balance model predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity, with a Kalman filter tracking each sensor's bias, rate-limited to 4 C per month and updated only when redundant sensors agreed the process was steady. False alarms dropped to 0.18 per dryer-day, 10 of 11 faults were caught including all three plugging cases, and median lead time reached 22 minutes; the one miss was an igniter fault on a dryer with a single plenum sensor. This established that sensor redundancy, not drift tolerance, was the deciding factor in reliable bias tracking.

The remaining question was whether these results would hold on live dryers rather than historical data. Running the model in shadow mode on 9 customer dryers through the fall 2025 harvest, dual-sensor dryers held 0.21 false alarms per dryer-day and flagged all four real events at lead times of 14 to 31 minutes, while single-sensor dryers ran at 0.64 per dryer-day. Substituting exhaust temperature as an indirect bias reference for the missing second sensor cut the single-sensor rate to 0.33 per dryer-day, roughly halving the penalty without changing fault detection, though still short of target.

### Line 246

The technological objective was to advance physics-based residual anomaly detection with online sensor-bias tracking under drift, distinguishing real burner and column faults from sensor drift without a trusted reference sensor. This objective was met, though partially: the team disproved synthetic drift training as a workable approach, since it hid slow faults, and established energy balance residuals with online, redundancy-based bias tracking as the accepted method instead, holding false alarms near 0.2 per dryer-day under drift up to roughly 3 C per month with lead times around 20 minutes.

It was determined that training on synthetic injected drift taught the model to treat slow real faults, including all three column plugging cases tested, as ordinary sensor drift. This resolved the uncertainty over whether drift tolerance could be built in directly, and ruled out synthetic drift training, redirecting the work toward the physics-based method described below.

It was established that a plain isolation forest baseline cannot hold false alarm rate low as drift accumulates. Baseline experiments confirmed false alarms rose sharply with drift, reaching 2.6 per dryer-day at 3 C per month, showing that fixed thresholds and unsupervised models on raw sensor data degrade past operational use as drift grows.

The team also learned that catching most faults did not guarantee adequate detection lead time. The isolation forest baseline caught 9 of 11 real faults yet gave only a 9 minute median lead time against the 15 minute goal, establishing that fault detection rate and lead time must be judged as separate measures.

The model is running in spring shadow mode on the same nine dryers with no live alerts yet. A second field trial at the Ashgrove elevator is booked for spring 2027. A full season with alerts shown to operators is still needed before wider release, along with further work on single-sensor dryers and moisture drift.

The project met its original goal: energy balance residuals with redundancy based bias tracking gave early warning under drift without a trusted reference sensor. False alarms held near 0.2 per dryer-day and lead times reached about 20 minutes, meeting the 15 minute target.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 316/350 words, 34/50 lines |
| 242 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: The three excluded activities are formally tracked separately from the project. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Storyline | applied | none |  | Section matches storyline's uncertainty framing, no… |
| 242 | Confidence Map: Isolation forest baseline false alarm rates under injected drift, established in both transcript and log. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Baseline log table confirms matching drift/false alarm figures with an added 1 C/month data point. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Energy balance model with Kalman bias tracking results, established across both sources. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Shadow trial dual-sensor false alarm rate and drift, established. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Single-sensor fallback improvement using exhaust temperature, established. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Spring shadow mode performance is reported only in the log, not corroborated independently in the transcript beyond a general status statement. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Drift profile source data (23 sensors, median and worst drift) is documented only in the log, not detailed in the transcript. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Moisture sensor drift handling remains unresolved/open as of the end of the claim period. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Flame instability detection lead time remains marginal relative to the 15-minute target. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Single-sensor dryers remain above the false alarm target despite the exhaust-temperature fallback. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Confidence Map: Model inference time on the controller is a specific engineering detail reported only in the log. | applied | none |  | Not mentioned in this uncertainty section |
| 242 | Glossary Term: false alarm rate | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: isolation forest baseline | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: synthetic drift training | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: online bias tracking | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: shadow mode | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: sensor redundancy | applied | none |  | Concept absent from this section |
| 242 | Glossary Term: energy balance residual model | applied | none |  | Concept absent from this section |
| 242 | Cover signed-off Summary item ys77xt7kankawkevp96p1k2je58fcrmw | applied | none |  | P1 covers company context and sensor exposure |
| 242 | Cover signed-off Summary item ys7cq100qrt2br3dzy525sa6d98fcz8q | applied | none |  | P2 states goal, faults and 15-minute target |
| 242 | Cover signed-off Summary item ys7b6jbxwc6sh6bmv929cdzws58fcj54 | applied | none |  | P3 covers fixed-threshold alarms and drift-vs-fault gap |
| 242 | Cover signed-off Summary item ys7daf354vrk2gex6qb71jm8an8fd221 | applied | none |  | P4 states objective and purpose clearly |
| 242 | Cover signed-off Summary item ys70dgt39vjaqt27j7qsfrwpq58fdtx2 | applied | none | 2 | P5 states 11-fault validation uncertainty |
| 242 | Cover signed-off Summary item ys71rccc2qp37a3r1ah3j2t2e58fcpgq | applied | none | 2 | P5 states drift rates and lead-time tradeoff uncertainty |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Standard fixed threshold alarms only trigger once plenum temperature crosses a set point, arriving too late. Standard p..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 681/700 words, 61/100 lines |
| 244 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering); its words are not in this Line as written, and the idea's own row says whether it was drafted |
| 244 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: The three excluded activities are formally tracked separately from the project. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: isolation forest baseline | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: synthetic drift training | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: sensor redundancy | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Storyline | applied | none |  | Section matches storyline sequence and figures |
| 244 | Confidence Map: Isolation forest baseline false alarm rates under injected drift, established in both transcript and log. | applied | none |  | Baseline drift figures stated flatly, matches established |
| 244 | Confidence Map: Baseline log table confirms matching drift/false alarm figures with an added 1 C/month data point. | applied | none |  | Drift/false alarm figures match established data |
| 244 | Confidence Map: Energy balance model with Kalman bias tracking results, established across both sources. | applied | none |  | Energy balance/Kalman results match established data |
| 244 | Confidence Map: Shadow trial dual-sensor false alarm rate and drift, established. | applied | none |  | Dual-sensor shadow figures match established data |
| 244 | Confidence Map: Single-sensor fallback improvement using exhaust temperature, established. | applied | none |  | Exhaust temp fallback figures match established data |
| 244 | Confidence Map: Spring shadow mode performance is reported only in the log, not corroborated independently in the transcript beyond a general status statement. | applied | none |  | Spring shadow mode results not mentioned in section |
| 244 | Confidence Map: Drift profile source data (23 sensors, median and worst drift) is documented only in the log, not detailed in the transcript. | applied | none |  | Drift profile source data not mentioned in section |
| 244 | Confidence Map: Moisture sensor drift handling remains unresolved/open as of the end of the claim period. | applied | none |  | Moisture drift not mentioned in section |
| 244 | Confidence Map: Flame instability detection lead time remains marginal relative to the 15-minute target. | applied | none |  | Flame instability lead time not mentioned in section |
| 244 | Confidence Map: Single-sensor dryers remain above the false alarm target despite the exhaust-temperature fallback. | applied | none |  | P6 hedges: 'still short of target' |
| 244 | Confidence Map: Model inference time on the controller is a specific engineering detail reported only in the log. | applied | none |  | Controller inference time not mentioned in section |
| 244 | Glossary Term: column plugging | not_applied | none |  | Section uses 'column-plugging' not 'column plugging'; repair not used (the repaired text no longer covers the idea the writer kept despite a Claim Exclusion ("The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month. The..."), so the checked draft was kept) |
| 244 | Glossary Term: energy balance residual model | not_applied | none |  | Section says 'physics-based residual model' not the glossary…; repair not used (the repaired text no longer covers the idea the writer kept despite a Claim Exclusion ("The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month. The..."), so the checked draft was kept) |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior year status role appears in section |
| 244 | Cover signed-off Summary item ys7ebk5aew2d8qtk6xmk5t37qn8fdh5p | applied | none |  | P1 covers phased workplan and July 2025 definitions |
| 244 | Cover signed-off Summary item ys754bzvh2qg81ranfj8s6y0198fdmmm | applied | none |  | P2 states hypothesis with matching figures |
| 244 | Cover signed-off Summary item ys749368c23gdemgwge9r0a31x8fcj08 | applied | conflict |  | Drafted despite the Claim Exclusion "Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide.": the writer kept the idea "The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month. The..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item ys710g83q0my0g347ajk4jjc1n8fdxss | applied | none |  | P3 states 9 of 11 faults at 9 minute lead time |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a phased approach: rebuild the baseline, try synthetic drift, then build a physics-based residual mode..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 349/350 words, 37/50 lines |
| 246 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic and not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and operators are a business/sales activity. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: The three excluded activities are formally tracked separately from the project. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: isolation forest baseline | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: synthetic drift training | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Storyline | applied | none |  | Section matches storyline sequence and figures |
| 246 | Confidence Map: Isolation forest baseline false alarm rates under injected drift, established in both transcript and log. | applied | none |  | Baseline drift figures stated flatly, matches established C1 |
| 246 | Confidence Map: Baseline log table confirms matching drift/false alarm figures with an added 1 C/month data point. | applied | none |  | Baseline table figures used, consistent with established C2 |
| 246 | Confidence Map: Energy balance model with Kalman bias tracking results, established across both sources. | applied | none |  | Energy balance/bias tracking results stated, matches… |
| 246 | Confidence Map: Shadow trial dual-sensor false alarm rate and drift, established. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Single-sensor fallback improvement using exhaust temperature, established. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Spring shadow mode performance is reported only in the log, not corroborated independently in the transcript beyond a general status statement. | applied | none |  | P6 hedges spring status, no live alerts yet |
| 246 | Confidence Map: Drift profile source data (23 sensors, median and worst drift) is documented only in the log, not detailed in the transcript. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Moisture sensor drift handling remains unresolved/open as of the end of the claim period. | applied | none |  | P6 notes moisture drift as further work needed |
| 246 | Confidence Map: Flame instability detection lead time remains marginal relative to the 15-minute target. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Single-sensor dryers remain above the false alarm target despite the exhaust-temperature fallback. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Model inference time on the controller is a specific engineering detail reported only in the log. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: false alarm rate | applied | none |  | 'false alarms per dryer-day' used, concept present |
| 246 | Glossary Term: isolation forest baseline | applied | none |  | Says 'plain isolation forest' not 'isolation forest baseline'; repaired to the Glossary Term |
| 246 | Glossary Term: detection lead time | applied | none |  | 'median lead time' used, matches concept |
| 246 | Glossary Term: online bias tracking | applied | none |  | 'bias tracked online' used, matches concept |
| 246 | Glossary Term: energy balance residual model | applied | none |  | 'Energy-balance residuals' used verbatim |
| 246 | Glossary Term: sensor redundancy | not_applied | none |  | Uses 'redundant-sensor agreement/redundancy' not 'sensor…; repair failed |
| 246 | Cover signed-off Summary item ys764p43c4rg27ef4r4ne6tc3d8fckng | applied | none |  | P1/P2 cover disproving synthetic drift and new method. |
| 246 | Cover signed-off Summary item ys7dbgpbrqxbfe6qr3wk9zdw818fdnyn | applied | none | 2 | P3 gives baseline false alarm rise to 2.6 at 3C/month. |
| 246 | Cover signed-off Summary item ys76ertetmebvh29ed3c7cng5x8fctq5 | applied | none | 2 | P4 states 9/11 faults, 9 min lead time vs 15 min goal. |
| 246 | Cover signed-off Summary item ys7bc38p6wtfe4zj31xh1tkab58fc6j1 | applied | none |  | P5 covers shadow mode, Ashgrove trial, next steps. |
| 246 | Cover signed-off Summary item ys71m2btdr693dx9r2hsxkzssx8fcaq0 | applied | none |  | P6 states goal met with figures matching source. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claims answer Line 242 uncertainties or are plan-covered. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The model is running in spring shadow mode on the same nine dryers with no live alerts yet. The writer confirms a secon..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 5 (sections 244, 246): Line 246 P5 says the model is running in spring shadow mode on the same nine dryers with no live alerts yet, and that a second field trial is booked for spring 2027. Line 244 P6 already reports a completed fall 2025 shadow trial on 9 dryers with results (false alarm rates, four real events caught, lead times 14 to 31 minutes). The two sections disagree on whether the shadow trial has produced results yet and on the season (fall 2025 vs spring). |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 1 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 25.
- Line 244: 0 labels and 0 plan checks "Not checked" of 19.
- Line 246: 0 labels and 0 plan checks "Not checked" of 24.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.2 s, p95 20.7 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 23.7 s, p95 23.7 s over 1.
- Sign-off to report created: 96.3 s.
- Cost from aiUsage: $0.94 in all ($0.38 seed stage, $0.56 Brief, drafting and checks) over 40 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T20:52:40.072Z created project k9725e25ht3c4am88arkq9t8f18fctmt
2026-09-30T20:52:40.727Z added document model-development-log.md
2026-09-30T20:52:42.104Z started Step by step generation k572e8vpzrtf0ys8rf1rekr7bd8fcw52
2026-09-30T20:53:30.639Z seed stage open
2026-09-30T20:53:30.639Z Open Company / Context and wait for its Batch
2026-09-30T20:53:39.892Z Company / Context: select the first Seed
2026-09-30T20:53:41.875Z Approve Company / Context
2026-09-30T20:53:43.940Z approved company_context
2026-09-30T20:53:43.940Z Open Goal / Problem and wait for its Batch
2026-09-30T20:54:06.521Z Goal / Problem: select the first Seed
2026-09-30T20:54:08.511Z Approve Goal / Problem
2026-09-30T20:54:10.480Z approved goal_problem
2026-09-30T20:54:10.480Z Open Technological limitations and wait for its Batch
2026-09-30T20:54:24.880Z Technological limitations: select the first Seed
2026-09-30T20:54:26.848Z Approve Technological limitations
2026-09-30T20:54:28.808Z approved passive_limitations
2026-09-30T20:54:28.808Z Open Technological objectives and wait for its Batch
2026-09-30T20:54:43.293Z Technological objectives: select the first Seed
2026-09-30T20:54:45.258Z Approve Technological objectives
2026-09-30T20:54:47.255Z approved technological_objective
2026-09-30T20:54:47.255Z Open Technological uncertainties and wait for its Batch
2026-09-30T20:55:01.824Z Technological uncertainties: select the first 2 Seeds
2026-09-30T20:55:05.176Z Approve Technological uncertainties
2026-09-30T20:55:07.167Z approved active_uncertainties
2026-09-30T20:55:07.167Z Skip Previous-year status
2026-09-30T20:55:08.483Z Open Work plan and wait for its Batch
2026-09-30T20:55:34.454Z Work plan: select the first Seed
2026-09-30T20:55:36.862Z Approve Work plan
2026-09-30T20:55:39.157Z approved workplan
2026-09-30T20:55:39.157Z Open Hypothesis and wait for its Batch
2026-09-30T20:55:54.785Z Hypothesis: select the first Seed
2026-09-30T20:55:57.227Z Approve Hypothesis
2026-09-30T20:55:59.444Z approved hypothesis
2026-09-30T20:55:59.444Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T20:56:21.995Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T20:56:25.261Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-09-30T20:56:27.960Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-09-30T20:56:29.946Z approved experimentation (confirmed 1 Claim Exclusion)
2026-09-30T20:56:29.946Z Open Advancement to science / technology and wait for its Batch
2026-09-30T20:56:44.405Z Advancement to science / technology: select the first Seed
2026-09-30T20:56:46.378Z Approve Advancement to science / technology
2026-09-30T20:56:48.382Z approved overall_advancement
2026-09-30T20:56:48.382Z Open Specific technological advancements and wait for its Batch
2026-09-30T20:57:05.446Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T20:57:10.660Z Approve Specific technological advancements
2026-09-30T20:57:12.711Z approved specific_advancements
2026-09-30T20:57:12.711Z Open Project status and next steps and wait for its Batch
2026-09-30T20:57:27.206Z Project status and next steps: select the first Seed
2026-09-30T20:57:29.210Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-09-30T20:57:31.146Z Approve Project status and next steps
2026-09-30T20:57:33.102Z approved project_status
2026-09-30T20:57:33.102Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T20:57:47.560Z Overall company / project goal improvements: select the first Seed
2026-09-30T20:57:49.531Z Approve Overall company / project goal improvements
2026-09-30T20:57:51.487Z approved goal_improvements
2026-09-30T20:57:51.488Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T20:57:52.839Z signed off; waiting for the report
2026-09-30T20:59:31.607Z report kd77cms2rgq855hjsx47sfdt9x8fdbzh created
```
