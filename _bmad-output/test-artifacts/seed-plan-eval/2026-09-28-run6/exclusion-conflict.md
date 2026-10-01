# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-28 on `local` at commit `c8ce1fe2`, acting as e2e-audit@banhall.local. Project `k978vgve1d6w8538qybv45sg9s8f87t0`, generation `k577nt2r00nbfa83bmvjt64bh98f8r6f`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: No. The confirmed item's billing-portal migration sentence is absent from every Line ("billing", "portal" and "migration" occur 0 times); its other bullet is drafted.
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: Partly. A row reads "not_applied | conflict | The writer confirmed a Brief Claim Exclusion conflict at sign-off.", but it is written for every confirmed item without checking the text and never says the sentence was dropped.
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: Yes. "A second field trial is booked at the Ashgrove elevator for spring 2027" uses the writer's wording, with no invented numbers or results.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Mostly. No headings, within caps (334, 692, 345). But Line 242 opens "Quillmere Client builds controllers"; the company is Quillmere Analytics Ltd.

- Verdict (pass or fail): fail
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Opus 5.5 with SR&ED research, Fable 5.1 with enterprise release-gate research), delegated by the product owner
- Date: 2026-09-28
- Notes: Both judges fail (high and medium confidence). Omitting routine IT migration is what CRA would want, but the contract (CAP-13 rule 4: a confirmed selection is drafted and not repaired away, and flagged) was broken silently. Product defect, not fixed: confirmed-exclusion items are left out of the compression Must keep list and repair (convex/ai/orderedGeneration.ts ~570 and ~670), and the conflict row is emitted without checking the text (~308-334). Major: the wrong company name "Quillmere Client" in the first sentence of 242 (origin unclear; check how the drafting request labels the company).

## Automatic checks

14 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd709k1jzhwj7md2jd7438p3rx8f921r |
| All three Sections were drafted | pass | 242: 334 words, 244: 692 words, 246: 345 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 13 metered calls (13 Batch, 0 Feedback), 14 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Migration of the customer billing portal to a new cloud host was routine IT work with n..." (routine_engineering); "Redesign of the dashboard colours and layout was cosmetic, not technological." (not_technological); "Customer training sessions for dealers and farm operators are a business activity, not ..." (business_risk); "The document explicitly confirms the billing move, dashboard update and training sessio..." (not_technological) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1790603933911 |
| The matching selection is signed off with the confirmed exclusion | pass | "The rebuilt isolation forest baseline confirmed the drift problem, with false alarms rising from 0.3 to 2.6 per dryer-day as drift increased. The work also c..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Cover signed-off Summary item ys72eaczaxh6820z70dq4gf3vh8f906v" |
| Heuristic: the conflicting selection was drafted, not removed | fail | 22 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model runs in shadow mode on nine dryers through spring drying with alerts not yet shown to operators. The writer confirms a second field trial at the As..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P4 covers shadow mode status, Ashgrove trial, harvest need." |
| Where "Ashgrove" appears in the drafted Section | info | "erently than temperature drift. A second field trial is booked at the Ashgrove elevator for spring 2027, and a full harvest season with live alerts" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- Quillmere builds controllers and cloud analytics for continuous-flow and mixed-flow grain dryers on larger farms. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought an anomaly detection model giving early warning of burner and column faults on grain dryers. / The system had to operate reliably even though plenum and moisture sensors drift heavily over a harvest season. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Existing drift-compensation methods in the literature assume a trusted reference sensor or periodic calibration, which the client lacks. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether a model could distinguish slow sensor drift from real slow-developing faults without labelled drift examples. / This knowledge was intended to enable early fault warning without false alarms caused by drift. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether a model could separate slow sensor drift from real slow faults without labelled drift examples. / It was also unclear whether false alarms could stay low without losing detection lead time, since the two goals conflict. _(cited)_
- With only 11 documented faults with good data from 2024, it was unclear if that could validate anything. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team fixed false alarm and lead time definitions in July 2025 before running any experiments. / This let them compare results across phases without moving the goalposts later. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis predicts that residuals from a physics-based energy balance model can isolate sensor bias from real faults. / This prediction rests on tracking plenum temperature against fuel rate, air flow and ambient temperature. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The rebuilt isolation forest baseline confirmed the drift problem, with false alarms rising from 0.3 to 2.6 per dryer-day as drift increased. / The work also covered this: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. _(edited, writer-asserted, Claim Exclusion confirmed)_
- Training with synthetic drift lowered false alarms but caught only 6 of 11 faults, missing all three column-plugging faults. / This showed the approach hides slow-developing faults, forcing a change in direction. _(cited)_

### 10. Advancement to science / technology (Section 246, standard): approved

- The energy balance residual approach with online bias tracking achieved false alarms near 0.2 per dryer-day under realistic drift. / It gave detection lead times around 20 minutes, largely meeting the original hypothesis targets. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The team learned that synthetic drift training is unsuitable because it hides slow-developing faults like column plugging. / This resolved the uncertainty about distinguishing drift from real slow faults without labelled drift data. _(cited)_
  - Links: uncertainty "It was uncertain whether a model could separate slow sensor drift f..."; experiments "Training with synthetic drift lowered false alarms but caught only ..."
- Knowledge gained shows that training the model to ignore slow drift also blinds it to slow faults. _(cited)_
  - Links: uncertainty "It was uncertain whether a model could separate slow sensor drift f..."; experiments "Training with synthetic drift lowered false alarms but caught only ..."

### 12. Project status and next steps (Section 246, standard): approved

- The model runs in shadow mode on nine dryers through spring drying with alerts not yet shown to operators. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. / A full harvest season with live alerts is still needed to confirm performance. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The knowledge gained connects directly to the original goal of early warning despite heavy sensor drift. / Energy balance residuals with online bias tracking now let the model separate drift from real faults. _(cited)_

## Drafted Sections

### Line 242

Quillmere Client builds controllers and cloud analytics software for continuous-flow and mixed-flow grain dryers used on large farms, based in Carrow, Saskatchewan. The company's controllers already read plenum temperature and moisture sensors to run burner and discharge rate, giving the engineering team direct exposure to how these sensors behave and fail over a harvest season. That operational base is what let the team recognize, and attempt to solve, the sensor drift problem addressed in this project.

The company's goal was to build an anomaly detection model giving early warning of burner and column faults, such as flame instability, fuel valve sticking, igniter problems and column plugging. The model had to operate reliably even though plenum and moisture sensors drift by as much as 1 to 3 C per month and 1.5 moisture points per month as they foul with dust and moisture.

The limitations to standard practice were that existing drift-compensation methods in the literature assume access to a trusted reference sensor or periodic recalibration, neither of which is available or practical on a farm dryer mid-harvest. No documented method existed for separating sensor bias from genuine process change using only the sensor redundancy available in typical field installations, given the coupled physics of burner output, air flow, grain flow, ambient conditions and grain moisture.

The technological objective was to advance the understanding of how to distinguish slow sensor drift from genuine slow-developing process faults without labelled drift examples, for the purposes of creating a burner and process fault detection system usable in the field without excessive false alarms.

It was uncertain whether any model could make this distinction without labelled drift data, because drift and real faults like column plugging both produce slow, gradual sensor changes. It was also unclear whether false alarms could be held low without sacrificing detection lead time, since the two objectives pull against each other. With only 11 documented faults with usable data from the 2024 season, it was uncertain whether this dataset could validate any proposed approach.

### Line 244

The technological problem was to distinguish real, slow-developing faults such as column plugging from sensor drift, without labelled drift examples and without exceeding a false alarm budget that would cause operators to disable the alert. The team fixed false alarm and lead time definitions in July 2025 before running any experiments. This let them compare results across phases without moving the goalposts later. The planned approach began by rebuilding the isolation forest baseline to measure how badly it failed under drift, then testing whether synthetic drift injection could fix the problem, then developing a physics-based alternative with online sensor bias tracking, and finally validating that alternative on customer dryers in the field. Each step mapped directly onto the twofold uncertainty of separating drift from real faults and holding false alarms low without losing lead time.

It was hypothesized that if anomaly scores were computed on the residuals of a physics-based energy balance model, predicting plenum temperature from fuel rate, air flow and ambient temperature, and each sensor's bias were tracked online using redundancy between sensors, then false alarms would stay below 0.25 per dryer-day under drift up to 3 C per month while median detection lead time on burner and column faults stayed at or above 15 minutes. This prediction rested on tracking plenum temperature against fuel rate, air flow and ambient temperature, with residuals from that comparison isolating sensor bias from genuine process change.

The first problem addressed was whether the existing isolation forest approach could survive realistic drift at all. The team rebuilt the isolation forest baseline on roughly 11,000 dryer-hours from 14 dryers and tested it against injected drift of 1 to 3 C per month. False alarms rose from 0.3 per dryer-day at zero drift to 2.6 per dryer-day at 3 C per month, and the model caught only 9 of 11 documented faults with a median lead time of 9 minutes. This confirmed drift alone could push the baseline past any workable false alarm threshold, giving the team a quantified benchmark to improve against.

The second problem addressed was whether training on synthetic injected drift would make the model tolerant of real drift without losing fault detection. False alarms fell to 0.6 per dryer-day at 2 C drift, but detection dropped to 6 of 11 faults, missing all three column-plugging faults outright. This showed the model had learned to treat slow real faults as normal drift, the opposite of what was needed, and the team abandoned this direction.

The third problem addressed was whether sensor bias could be separated from genuine process change using the dryer's own physics. The team built an energy balance residual model predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature and humidity, with a Kalman filter tracking each sensor's bias online, gated by a steady-state flag requiring redundant sensors to agree. At 3 C per month drift, false alarms dropped to 0.18 per dryer-day and 10 of 11 faults were caught, including all three column plugs, with a median lead time of 22 minutes. The one miss was an igniter fault on a dryer with a single plenum sensor, showing that sensor redundancy mattered more than expected.

The fourth problem addressed was whether the model would hold up under real, uncontrolled field conditions rather than injected drift. The team ran it in shadow mode on 9 customer dryers from October 6 to November 21, 2025. Dual-sensor dryers held 0.21 false alarms per dryer-day and caught all four real events, with lead times of 14, 19, 26 and 31 minutes, while the two single-sensor dryers ran at 0.64 false alarms per dryer-day. This confirmed the approach worked close to target with redundancy present but exposed single-sensor installations as a distinct problem.

The fifth problem addressed was whether single-sensor dryers could be brought closer to target without adding hardware. The team substituted exhaust temperature as an indirect second reference for plenum bias tracking on the two single-sensor dryers. False alarms fell from 0.64 to 0.33 per dryer-day with no change in detection of the four real events, showing exhaust temperature can partly, but not fully, replace a missing second plenum sensor.

### Line 246

The technological objective was to separate sensor drift from genuine slow-developing faults on grain dryer controllers without labelled drift examples, while meeting fixed false alarm and lead time targets. This was largely achieved. The hypothesis that anomaly scores on physics-based energy balance residuals, combined with online sensor bias tracking, would hold false alarms below 0.25 per dryer-day and lead time at or above 15 minutes was mostly proven on dual-sensor dryers, though disproven for single-sensor dryers, where false alarms stayed above target.

Training on synthetic injected drift proved unsuitable: it teaches the model to treat slow-developing faults like column plugging as normal drift rather than as faults. This resolved the uncertainty over distinguishing drift from real slow faults without labelled examples. Training a model to ignore slow drift also blinds it to slow faults, which redirected the team toward a physics-based alternative.

Running anomaly detection on energy balance residuals, with sensor bias tracked online through a Kalman filter gated by a steady-state flag, keeps false alarms near 0.2 per dryer-day under drift up to about 3 C per month, with detection lead times around 20 minutes, largely meeting the original targets. This resolved the uncertainty over holding false alarms low without sacrificing lead time, and was confirmed in shadow mode on customer dryers under real, uncontrolled field conditions.

The model continues running in shadow mode on nine dryers through spring drying, with alerts not yet shown to operators; no real fault events have occurred this spring to test detection. Single-sensor dryers remain above target, since bias tracking lacks a second plenum sensor for redundancy, and moisture sensor drift is not yet addressed, as it behaves differently than temperature drift. A second field trial is booked at the Ashgrove elevator for spring 2027, and a full harvest season with live alerts is still needed to confirm performance.

This knowledge connects directly to the original goal of early warning despite heavy sensor drift: energy balance residuals with online bias tracking now let the model separate drift from real faults closely enough to meet targets on dual-sensor dryers.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 334/350 words, 36/50 lines |
| 242 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Redesign of the dashboard colours and layout was cosmetic, not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and farm operators are a business activity, not eligible work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The document explicitly confirms the billing move, dashboard update and training sessions are outside the project scope. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Storyline | applied | none |  | Section matches storyline background and uncertainties |
| 242 | Confidence Map: Documented faults with usable data from the 2024 season totaled 11. | applied | none |  | P5 states 11 faults, matches established fact |
| 242 | Confidence Map: Training data comprised roughly 11,000 dryer-hours across 14 dryers at one-minute resolution. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Baseline isolation forest results at various drift levels are established via matching interview and log figures. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Energy balance residual model achieved 0.18 false alarms per dryer-day and 22 minute median lead time at 3 C per month drift. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Shadow trial dual-sensor false alarm rate of 0.21 per dryer-day is corroborated by both interview and log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Model inference time on the controller was 38 ms per dryer per minute, reported only in the log, not the interview. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Drift profile calibration data: median plenum drift 1.8 C per month, worst 3.1 C per month, from post-season checks on 23 sensors, appears only in the log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Spring shadow-mode false alarm rate of 0.19 per dryer-day on dual-sensor units as of June 26 2026 is reported only in the log with no corroborating interview figure and no real events yet observed. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Embedded developer Tobias spent about four months porting the model to run on the controller; this detail on team effort appears only in the interview. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the single-sensor dryers will reach the false alarm target remains unresolved; the exhaust-temperature fallback improved results but left them above target. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Moisture sensor drift handling is an open item not yet resolved by the current method. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Flame instability detection lead time is marginal relative to the 15-minute target, an open and unresolved item. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: false alarm rate | applied | none |  | Concept of false alarms present but term absent |
| 242 | Glossary Term: isolation forest baseline | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: shadow mode | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: energy balance residual model | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: kalman filter | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: online sensor bias tracking | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: steady-state flag | applied | none |  | Not mentioned in the section |
| 242 | Cover signed-off Summary item ys760gx49040sq6jrjnr7s40hx8f9fks | applied | none |  | P1 states location and product per wording |
| 242 | Cover signed-off Summary item ys76d51f84yyjq09mxgtd19jhh8f8vm9 | applied | none |  | P2 states goal and drift constraint |
| 242 | Cover signed-off Summary item ys7022j8tbkestw89vphfvrp6d8f8z21 | applied | none |  | P3 states literature assumes reference sensor/calibration… |
| 242 | Cover signed-off Summary item ys7cbxs8r0yme8r60n5n94nztx8f99ec | applied | none |  | P4 states technological objective as planned |
| 242 | Cover signed-off Summary item ys7134v7a9aq69y175raajq3xs8f9zj1 | applied | none | 2 | P5 states drift/fault distinction and false alarm/lead time… |
| 242 | Cover signed-off Summary item ys75yzqnbd5xmy49wat9kt9rvs8f82b1 | applied | none | 2 | P5 states 11-fault dataset adequacy uncertainty |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company sought an anomaly detection model giving early warning of burner and column faults on grain dryers. The sys..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether a model could distinguish slow sensor drift from real slow-developing faults without l..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 692/700 words, 65/100 lines |
| 244 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Redesign of the dashboard colours and layout was cosmetic, not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and farm operators are a business activity, not eligible work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The document explicitly confirms the billing move, dashboard update and training sessions are outside the project scope. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: isolation forest baseline | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: energy balance residual model | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: kalman filter | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: online sensor bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: steady-state flag | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Storyline | applied | none |  | Section matches storyline sequence and figures |
| 244 | Confidence Map: Documented faults with usable data from the 2024 season totaled 11. | applied | none |  | 11 documented faults stated, matches established C1 |
| 244 | Confidence Map: Training data comprised roughly 11,000 dryer-hours across 14 dryers at one-minute resolution. | applied | none |  | 11,000 dryer-hours, 14 dryers stated, matches C2 |
| 244 | Confidence Map: Baseline isolation forest results at various drift levels are established via matching interview and log figures. | applied | none |  | Baseline figures stated flatly, matches established C3 |
| 244 | Confidence Map: Energy balance residual model achieved 0.18 false alarms per dryer-day and 22 minute median lead time at 3 C per month drift. | applied | none |  | 0.18 FA, 22 min lead time stated, matches established C4 |
| 244 | Confidence Map: Shadow trial dual-sensor false alarm rate of 0.21 per dryer-day is corroborated by both interview and log. | applied | none |  | 0.21 dual-sensor rate stated, matches established C5 |
| 244 | Confidence Map: Model inference time on the controller was 38 ms per dryer per minute, reported only in the log, not the interview. | applied | none |  | Inference time not mentioned in section |
| 244 | Confidence Map: Drift profile calibration data: median plenum drift 1.8 C per month, worst 3.1 C per month, from post-season checks on 23 sensors, appears only in the log. | applied | none |  | Drift calibration data not mentioned in section |
| 244 | Confidence Map: Spring shadow-mode false alarm rate of 0.19 per dryer-day on dual-sensor units as of June 26 2026 is reported only in the log with no corroborating interview figure and no real events yet observed. | applied | none |  | Spring shadow-mode figure not mentioned in section |
| 244 | Confidence Map: Embedded developer Tobias spent about four months porting the model to run on the controller; this detail on team effort appears only in the interview. | applied | none |  | Tobias porting effort not mentioned in section |
| 244 | Confidence Map: Whether the single-sensor dryers will reach the false alarm target remains unresolved; the exhaust-temperature fallback improved results but left them above target. | applied | none |  | P7 hedges: partly not fully replace, matches unresolved |
| 244 | Confidence Map: Moisture sensor drift handling is an open item not yet resolved by the current method. | applied | none |  | Moisture drift open item not mentioned in section |
| 244 | Confidence Map: Flame instability detection lead time is marginal relative to the 15-minute target, an open and unresolved item. | applied | none |  | Flame instability lead time not mentioned in section |
| 244 | Glossary Term: energy balance residual model | applied | none |  | Section says 'energy balance model', not 'residual model'; repaired to the Glossary Term |
| 244 | Glossary Term: online sensor bias tracking | applied | none |  | Section says 'tracked online' not 'online sensor bias tracking'; repaired to the Glossary Term |
| 244 | Glossary Term: steady-state flag | applied | none |  | Concept of steady-state flag not present in section |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role appears in section. |
| 244 | Cover signed-off Summary item ys77p2n3m4vcd3exdgtebydt358f827p | applied | none |  | P1 states the July 2025 fixed definitions wording. |
| 244 | Cover signed-off Summary item ys73fd721xafg5qhbw63e03yrn8f977k | applied | none |  | P2 states hypothesis and residual tracking as planned. |
| 244 | Cover signed-off Summary item ys72eaczaxh6820z70dq4gf3vh8f906v | not_applied | conflict |  | The writer confirmed a Brief Claim Exclusion conflict at sign-off. |
| 244 | Cover signed-off Summary item ys737q9rkcvpj6x0m2a97z1my58f9bqj | applied | none |  | P4 covers synthetic drift results and missed faults. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): 244 P6 reports the shadow mode trial ran on 9 customer dryers from October 6 to November 21, 2025, catching all four real events with lead times of 14, 19, 26 and 31 minutes. 246 P3 describes the same shadow mode result as lead times around 20 minutes, which does not match the specific figures given in 244 (average of 14, 19, 26, 31 is about 22.5 minutes, and the range includes 14, well below 20). |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 345/350 words, 37/50 lines |
| 246 | Claim Exclusion: Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Redesign of the dashboard colours and layout was cosmetic, not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and farm operators are a business activity, not eligible work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The document explicitly confirms the billing move, dashboard update and training sessions are outside the project scope. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: kalman filter | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: online sensor bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: steady-state flag | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Storyline | applied | none |  | Section tracks Storyline arc and figures closely. |
| 246 | Confidence Map: Documented faults with usable data from the 2024 season totaled 11. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Training data comprised roughly 11,000 dryer-hours across 14 dryers at one-minute resolution. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Baseline isolation forest results at various drift levels are established via matching interview and log figures. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Energy balance residual model achieved 0.18 false alarms per dryer-day and 22 minute median lead time at 3 C per month drift. | applied | none |  | P3 figures match established C4 values. |
| 246 | Confidence Map: Shadow trial dual-sensor false alarm rate of 0.21 per dryer-day is corroborated by both interview and log. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Model inference time on the controller was 38 ms per dryer per minute, reported only in the log, not the interview. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Drift profile calibration data: median plenum drift 1.8 C per month, worst 3.1 C per month, from post-season checks on 23 sensors, appears only in the log. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Spring shadow-mode false alarm rate of 0.19 per dryer-day on dual-sensor units as of June 26 2026 is reported only in the log with no corroborating interview figure and no real events yet observed. | not_applied | missing_fact |  | P4 omits partial 0.19 spring shadow rate as flat fact; repair not used (the repaired text came out at 372/350 words, 38/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Confidence Map: Embedded developer Tobias spent about four months porting the model to run on the controller; this detail on team effort appears only in the interview. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether the single-sensor dryers will reach the false alarm target remains unresolved; the exhaust-temperature fallback improved results but left them above target. | applied | none |  | P4 hedges single-sensor result as still above target. |
| 246 | Confidence Map: Moisture sensor drift handling is an open item not yet resolved by the current method. | applied | none |  | P4 hedges moisture drift as not yet addressed. |
| 246 | Confidence Map: Flame instability detection lead time is marginal relative to the 15-minute target, an open and unresolved item. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: false alarm rate | not_applied | none |  | Section uses 'false alarms' not 'false alarm rate'; repair not used (the repaired text came out at 372/350 words, 38/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Glossary Term: isolation forest baseline | applied | none |  | Concept of prior isolation forest baseline absent here. |
| 246 | Glossary Term: energy balance residual model | not_applied | none |  | P3 describes concept without the exact term; repair not used (the repaired text came out at 372/350 words, 38/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Cover signed-off Summary item ys7058hpd7k76v1345vf8qgfpn8f8r2c | applied | none |  | P3 covers the ~0.2 false alarms and ~20 min lead time. |
| 246 | Cover signed-off Summary item ys7dfv8whtw1tbpmj51qthpj0h8f8ehv | applied | none | 2 | P2 states synthetic drift training is unsuitable and why. |
| 246 | Cover signed-off Summary item ys78kdky90fe982vnrvwx174058f99k7 | applied | none | 2 | P2 states ignoring drift blinds model to slow faults. |
| 246 | Cover signed-off Summary item ys7ax5m1zrxvg96n0h7naptt298f99q9 | applied | none |  | P4 covers shadow mode status, Ashgrove trial, harvest need. |
| 246 | Cover signed-off Summary item ys728v4daedes95sqem4nbe4qx8f9e5e | applied | none |  | P5 ties advancement back to original early-warning goal. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Knowledge gained shows that training the model to ignore slow drift also blinds it to slow faults." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The model runs in shadow mode on nine dryers through spring drying with alerts not yet shown to operators. The writer c..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 states no real fault events have occurred this spring and that the model is still in shadow mode with alerts not yet shown to operators, implying the field trial described in 244 P6-P7 (October 6 to November 21, 2025, with real events and single-sensor mitigation already tested) is a separate, later ongoing trial. This is not clearly contradictory but the two sections should be checked: 246 P4 mentions a second field trial booked for spring 2027 at the Ashgrove elevator, a location never mentioned in 244, and it is unclear whether the spring shadow mode run in 246 P4 is the same one described in 244 P6 or a new one, since 244 gives an end date of November 21, 2025 and 246 P4 refers to spring drying with no events yet. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 says single-sensor dryers remain above target and does not mention the exhaust temperature substitution described in 244 P7, which reduced single-sensor false alarms from 0.64 to 0.33 per dryer-day. 246 P4 omits this mitigation and its partial success, leaving the advancement section inconsistent with the work performed section on the current state of the single-sensor problem. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 26.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 21.

## Seed-stage numbers

- Requests: 13 metered (13 Batch, 0 Feedback); 14 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.4 s, p95 15.3 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 18.4 s, p95 18.4 s over 1.
- Sign-off to report created: 157.1 s.
- Cost from aiUsage: $0.87 in all ($0.31 seed stage, $0.57 Brief, drafting and checks) over 39 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T13:55:27.832Z created project k978vgve1d6w8538qybv45sg9s8f87t0
2026-09-28T13:55:28.519Z added document model-development-log.md
2026-09-28T13:55:29.903Z started Step by step generation k577nt2r00nbfa83bmvjt64bh98f8r6f
2026-09-28T13:56:18.887Z seed stage open
2026-09-28T13:56:18.888Z Open Company / Context and wait for its Batch
2026-09-28T13:56:31.036Z Company / Context: select the first Seed
2026-09-28T13:56:33.116Z Approve Company / Context
2026-09-28T13:56:35.182Z approved company_context
2026-09-28T13:56:35.182Z Open Goal / Problem and wait for its Batch
2026-09-28T13:56:52.680Z Goal / Problem: select the first Seed
2026-09-28T13:56:54.780Z Approve Goal / Problem
2026-09-28T13:56:56.860Z approved goal_problem
2026-09-28T13:56:56.860Z Open Technological limitations and wait for its Batch
2026-09-28T13:57:09.175Z Technological limitations: select the first Seed
2026-09-28T13:57:11.251Z Approve Technological limitations
2026-09-28T13:57:13.343Z approved passive_limitations
2026-09-28T13:57:13.343Z Open Technological objectives and wait for its Batch
2026-09-28T13:57:25.472Z Technological objectives: select the first Seed
2026-09-28T13:57:27.538Z Approve Technological objectives
2026-09-28T13:57:29.637Z approved technological_objective
2026-09-28T13:57:29.637Z Open Technological uncertainties and wait for its Batch
2026-09-28T13:57:41.763Z Technological uncertainties: select the first 2 Seeds
2026-09-28T13:57:46.264Z Approve Technological uncertainties
2026-09-28T13:57:48.368Z approved active_uncertainties
2026-09-28T13:57:48.368Z Skip Previous-year status
2026-09-28T13:57:49.758Z Open Work plan and wait for its Batch
2026-09-28T13:58:10.264Z Work plan: select the first Seed
2026-09-28T13:58:12.392Z Approve Work plan
2026-09-28T13:58:14.494Z approved workplan
2026-09-28T13:58:14.495Z Open Hypothesis and wait for its Batch
2026-09-28T13:58:26.650Z Hypothesis: select the first Seed
2026-09-28T13:58:28.727Z Approve Hypothesis
2026-09-28T13:58:30.830Z approved hypothesis
2026-09-28T13:58:30.830Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T13:58:45.636Z Experimentation / Iterations: select the first 2 Seeds
2026-09-28T13:58:49.114Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-09-28T13:58:51.851Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-09-28T13:58:53.982Z approved experimentation (confirmed 1 Claim Exclusion)
2026-09-28T13:58:53.983Z Open Advancement to science / technology and wait for its Batch
2026-09-28T13:59:11.428Z Advancement to science / technology: select the first Seed
2026-09-28T13:59:13.512Z Approve Advancement to science / technology
2026-09-28T13:59:15.626Z approved overall_advancement
2026-09-28T13:59:15.626Z Open Specific technological advancements and wait for its Batch
2026-09-28T13:59:33.240Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T13:59:38.140Z Approve Specific technological advancements
2026-09-28T13:59:40.270Z approved specific_advancements
2026-09-28T13:59:40.270Z Open Project status and next steps and wait for its Batch
2026-09-28T13:59:55.157Z Project status and next steps: select the first Seed
2026-09-28T13:59:57.242Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-09-28T13:59:59.307Z Approve Project status and next steps
2026-09-28T14:00:01.410Z approved project_status
2026-09-28T14:00:01.410Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T14:00:19.187Z Overall company / project goal improvements: select the first Seed
2026-09-28T14:00:21.286Z Approve Overall company / project goal improvements
2026-09-28T14:00:23.373Z approved goal_improvements
2026-09-28T14:00:23.373Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T14:00:24.818Z signed off; waiting for the report
2026-09-28T14:03:04.033Z report kd709k1jzhwj7md2jd7438p3rx8f921r created
```
