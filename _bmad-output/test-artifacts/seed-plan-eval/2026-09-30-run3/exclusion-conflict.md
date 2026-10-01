# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `c17f2494`, acting as e2e-audit@banhall.local. Project `k977jx0ckskyzghf22nhk03w498ffzwg`, generation `k57645ksxwg4gew83cmxwsm8k98ffrvq`.

## What this fixture tests

The client says plainly that the billing portal move, the dashboard colour and layout redesign and the training sessions are not claimed, so the Brief derives Claim Exclusions. On Experimentation the writer edits a selected Seed to include the billing portal exclusion, is warned at Approve and confirms. The selection must be drafted, not repaired away, and the Compliance Note must record the conflict. Project status carries a writer-asserted note (a second field trial at the Ashgrove elevator) that is in no source and must be drafted as the writer's own assertion.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. The writer's confirmed selection that matches the Claim Exclusion is drafted in Section 244 and not silently removed.
   - Answer: Yes. Line 244 paragraph 3 holds the writer's edited item: "The work also covered this: migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide." No repair removed it.
2. The Compliance Note shows the conflict (tier conflict) so a reviewer can see it before filing.
   - Answer: Yes. The item row reads "applied | conflict | Drafted despite the Claim Exclusion" and the exclusion row "not_applied | conflict | ... its words appear in paragraph 3".
3. The Ashgrove field trial appears in Section 246 as the writer's own assertion, without invented numbers, dates or results.
   - Answer: Yes. Line 246 paragraph 5: "a second field trial at the Ashgrove elevator is booked for spring 2027." Nothing invented.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Mostly. Plain prose, no headings, within caps (248, 634, 349); "Quillmere Analytics Ltd." correct. Line 244 paragraph 1 has "This mapped onto the open questions from Line 242", prompt wording in the prose (minor).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (high confidence). The exclusion row wording is fixed. Minors: the Rule C row flags the confirmed exclusion item although a COVER item never makes it not applied (checker variance, nothing removed); both targets rows are false positives; a consistency row reads "(No finding, placeholder removed)". The owner's recorded known limitation stands. Every figure checked matches the sources.

## Automatic checks

15 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd77n1dy5ba7yhdegwk6hm1vss8fejz9 |
| All three Sections were drafted | pass | 242: 248 words, 244: 634 words, 246: 329 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: not_applied ("P3 billing portal migration is unrelated to Line 242"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P6 calls met 14-min lead time 'just under' target"); 246: not_applied ("P1 calls a missed target 'stayed just under' as if close.") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 14 metered calls (14 Batch, 0 Feedback), 15 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Migration of the customer billing portal to a new cloud host, done for cost reasons fol..." (routine_engineering); "Redesign of dashboard colours, fonts and panel layout for cosmetic/usability reasons." (not_technological); "Customer training sessions for dealers and farm operators, a sales and support activity." (business_risk) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1790819392617 |
| The matching selection is signed off with the confirmed exclusion | pass | "Experiment one rebuilt an isolation forest baseline and confirmed false alarms rose with drift, reaching 2.6 per dryer-day at 3 degrees per month. The work a..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Migration of the customer billing portal to a new cloud host, done for..."; 244: "Cover signed-off Summary item ys78kzb1mm895etyj7mn776z0h8fe7hj" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The model continues running in spring shadow mode on the same nine dryers through June 2026. The writer confirms a second field trial at the Ashgrove elevato..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P5 covers shadow mode, open items, Ashgrove trial." |
| Where "Ashgrove" appears in the drafted Section | info | "l needed before fall 2026 deployment, and a second field trial at the Ashgrove elevator is booked for spring 2027. The model now separates genuine" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- Quillmere Analytics Ltd. is based in Carrow, Saskatchewan, and builds controllers and cloud analytics for grain dryers. / The company serves continuous-flow tower and mixed-flow dryers used on larger farms and at elevators. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought to build an anomaly detection model for burner and process faults on grain dryers. / The model targets flame instability, fuel valve sticking, igniter problems and column plugging faults. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice uses fixed threshold alarms on plenum temperature, which flag faults only after they are well advanced. / Operators want warning at least 15 minutes before a fault becomes dangerous, which threshold alarms cannot provide. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether slow sensor drift could be distinguished from real slowly developing faults without labelled drift data. / They also needed to know if false alarms could be kept low without sacrificing detection lead time. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- Sensor drift had no trusted reference, so the team could not confirm whether bias could be separated from real process change. / Plenum sensors drift 1 to 3 degrees C per month, leaving uncertain how to distinguish drift from a slowly plugging column. _(writer-asserted)_
- It was unclear whether the coupled dryer physics would let the model separate sensor bias from genuine process change. / Burner output, air flow, grain flow, ambient conditions and moisture all interact, complicating that separation. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a staged investigation starting with a baseline rebuild in July 2025 to measure drift failure. / Predefined metrics for false alarms and lead time were fixed in July 2025 before any experiment ran. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis tied bias tracking to redundancy between sensors to separate drift from real process change. / This framed the energy balance residual approach as testable against two measurable targets, false alarms and lead time. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Experiment one rebuilt an isolation forest baseline and confirmed false alarms rose with drift, reaching 2.6 per dryer-day at 3 degrees per month. / The work also covered this: Migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "Sensor drift had no trusted reference, so the team could not confir..."
- Experiment two trained on synthetic drift, which cut false alarms but missed all three column plugging faults. / This showed teaching tolerance to drift also hides real slow faults, confirming the trade off. _(cited)_
  - Tested: uncertainty "Sensor drift had no trusted reference, so the team could not confir..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The energy balance residual approach separated sensor bias from real process change using redundant sensors. / Bias tracking held false alarms near 0.2 per dryer-day even as drift reached 3 degrees C per month. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Experiment one established that the isolation forest baseline failed under drift, confirming the uncertainty was real. / False alarms rose from 0.3 to 2.6 per dryer-day as drift increased from zero to 3 degrees C per month. _(cited)_
  - Links: uncertainty "Sensor drift had no trusted reference, so the team could not confir..."; experiments "Experiment two trained on synthetic drift, which cut false alarms b...", "Experiment one rebuilt an isolation forest baseline and confirmed f..."
- Experiment two showed that training a model to tolerate drift also teaches it to miss real slow faults. / It missed all three column-plugging faults, which also develop slowly over 30 to 60 minutes. _(cited)_
  - Links: uncertainty "Sensor drift had no trusted reference, so the team could not confir..."; experiments "Experiment two trained on synthetic drift, which cut false alarms b...", "Experiment one rebuilt an isolation forest baseline and confirmed f..."

### 12. Project status and next steps (Section 246, standard): approved

- The model continues running in spring shadow mode on the same nine dryers through June 2026. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. / A full season with live alerts is still needed before fall 2026 deployment. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project resolved whether sensor bias could be separated from real process change despite having no trusted reference sensor. / Energy balance residuals with Kalman-filtered online bias tracking held false alarms near 0.2 per dryer-day under drift up to 3 degrees C per month. _(cited)_

## Drafted Sections

### Line 242

Quillmere Analytics Ltd., based in Carrow, Saskatchewan, builds controllers and cloud analytics for continuous-flow tower and mixed-flow dryers used on larger farms and at elevators. The company sought to build an anomaly detection model for burner and process faults, including flame instability, fuel valve sticking, igniter problems, and column plugging, aimed at warning operators at least 15 minutes before a fault becomes dangerous.

Standard practice uses fixed threshold alarms on plenum temperature, which only fire once a hard limit is crossed, by which point a fault is already well advanced and little lead time remains. Plenum sensors drift 1 to 3 degrees C per month, and no documented method existed for separating that drift from a genuine, slowly developing fault such as gradual column plugging without labelled drift data. It was also unclear whether false alarms could be kept low without sacrificing detection lead time.

The technological objective was to advance understanding of physics-informed anomaly detection and online sensor-bias estimation in coupled industrial thermal systems, to build a fault detection model that holds false alarms low under realistic drift while preserving usable lead time. It was uncertain whether training with synthetic injected drift would let a model tolerate drift without losing sensitivity to real slow faults, since the two goals were suspected to trade off against each other. It was also uncertain whether sensor bias could be separated from genuine process change at all, since burner output, air flow, grain flow, ambient conditions, and moisture are tightly coupled.

### Line 244

The technological problem was separating genuine sensor drift from real, slowly developing faults with no trusted reference sensor and no feasible mid-harvest recalibration. The team planned a staged investigation starting with a baseline rebuild in July 2025 to measure drift failure. Predefined metrics for false alarms and lead time were fixed in July 2025 before any experiment ran, so results could be judged against a fixed target. This mapped onto the open questions from Line 242: whether drift and real faults could be told apart, and whether false alarms could be held down without losing lead time.

It was hypothesized that if anomaly scores were computed on the residuals of a physics-based energy balance (predicted versus actual plenum and exhaust temperature given fuel rate, air flow, and ambient conditions), and each sensor's bias was tracked online using redundancy between sensors, then false alarms would stay below 0.25 per dryer-day under drift up to 3 degrees C per month while median detection lead time on burner and column faults stayed at or above 15 minutes. The hypothesis tied bias tracking to redundancy between sensors to separate drift from real process change. This framed the energy balance residual approach as testable against two measurable targets: false alarms and lead time.

Experiment one rebuilt an isolation forest baseline and confirmed false alarms rose with drift, reaching 2.6 per dryer-day at 3 degrees per month. The work also covered this: migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide. The baseline caught 9 of 11 real faults at a median lead time of 9 minutes, under the 15-minute target. This confirmed drift was severe enough to undermine the baseline and ruled out frequent retraining or recalibration, neither viable mid-harvest.

Experiment two trained on synthetic drift, which cut false alarms but missed all three column plugging faults, falling to 6 of 11 faults detected overall. This showed teaching tolerance to drift also hides real slow faults, confirming the trade-off in the worst way and ruling out synthetic-drift training. The finding forced a shift toward a physics-based method.

Experiment three used a per-dryer energy balance model predicting plenum and exhaust temperature from fuel flow, fan speed, ambient temperature, and humidity, with a Kalman filter providing online bias tracking per sensor, gated to update only when redundant sensors agreed the process was steady. On 2024 data with 3 degrees C per month injected drift, false alarms fell to 0.18 per dryer-day, under the 0.25 target, and the model caught 10 of 11 faults, including all three column plugs, at a 22-minute median lead time, above the 15-minute target. The one miss was an igniter fault on a dryer with only one plenum sensor, showing redundancy mattered more than expected. This met both predefined targets and justified a field trial.

Experiment four ran the model in shadow mode on 9 customer dryers across the fall 2025 harvest. Dual-sensor dryers averaged 0.21 false alarms per dryer-day under measured drift up to 2.7 degrees C per month, meeting the 0.25 target, while single-sensor dryers averaged 0.64, missing it. All four real field events were flagged, with lead times of 14, 19, 26, and 31 minutes; the 14-minute flame instability event was just under the 15-minute target. This confirmed the approach held for dual-sensor dryers but left single-sensor performance and fast flame events unresolved.

Experiment five tested exhaust temperature as an indirect secondary reference for plenum bias tracking on the two single-sensor dryers, replayed against the fall trial data. False alarms on those dryers fell from 0.64 to 0.33 per dryer-day, still above the 0.25 target, with no change in detection of the four real events. This showed exhaust temperature could partly substitute for a missing second sensor, leaving single-sensor performance only partly resolved.

### Line 246

The technological objective, physics-informed anomaly detection and online bias tracking for coupled industrial thermal systems, was achieved for dual-sensor dryers. The energy balance residual approach separated sensor bias from real process change using sensor redundancy, holding the false alarm rate near 0.2 per dryer-day even as drift reached 3 degrees C per month. Single-sensor configurations stayed above the 0.25 per dryer-day target, and a flame instability event with a 14-minute lead time stayed just under the 15-minute target in that one case. The hypothesis was proven for dual-sensor dryers and only partly proven for single-sensor dryers and fast-developing flame events.

Experiment one established that the isolation forest baseline failed under drift, confirming the uncertainty was real: the false alarm rate rose from 0.3 to 2.6 per dryer-day as drift increased from zero to 3 degrees C per month.

Experiment two showed that training a model to tolerate drift also teaches it to miss real slow faults. The trained model missed all three column plugging faults, which also develop slowly over 30 to 60 minutes.

The project resolved whether sensor bias could be separated from real process change despite having no trusted reference sensor. Energy balance residuals with Kalman filtered online bias tracking held the false alarm rate near 0.2 per dryer-day under drift up to 3 degrees C per month, catching 10 of 11 faults at a 22-minute detection lead time.

Open items: moisture sensors drift more than temperature sensors and are not yet modeled this way, single-sensor dryers still exceed target, and fast flame events leave little margin against the lead-time requirement. The model continues running in spring shadow mode on the same nine dryers through June 2026. A full season with live alerts is still needed before fall 2026 deployment, and a second field trial at the Ashgrove elevator is booked for spring 2027.

The model now separates genuine burner and process faults from sensor drift well enough to give operators useful warning instead of false alarms.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 248/350 words, 25/50 lines |
| 242 | Claim Exclusion: Migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Redesign of dashboard colours, fonts and panel layout for cosmetic/usability reasons. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions for dealers and farm operators, a sales and support activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline background and objective scope. |
| 242 | Confidence Map: Baseline isolation forest false alarm and detection results across drift levels are established from both transcript and development log. | applied | none |  | Section doesn't flatly state baseline results, no claim. |
| 242 | Confidence Map: Development log provides the same baseline data in table form with an added 1 C/month data point not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Synthetic drift training results (false alarm drop, missed column plugs) are established and consistent across sources. | applied | none |  | Hedged as uncertainty, not flat claim, consistent. |
| 242 | Confidence Map: Energy balance model results at 3 C/month drift are established, consistent between transcript and log. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Residual RMS figures for the energy balance model on clean 2024 data are an established, log-only detail. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Shadow trial dual-sensor and single-sensor false alarm rates are established across both sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Model inference time on the controller is a log-only detail not corroborated in the transcript. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Single-sensor fallback using exhaust temperature improved false alarms from 0.64 to 0.33 per dryer-day, consistent across sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Spring shadow mode results as of June 26 2026 are a log-only detail with no real events recorded. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Drift profile data from post-season calibration checks on 23 sensors is a log-only detail providing median and worst-case drift figures, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The flame instability event with a 14-minute lead time is explicitly noted as just under the 15-minute target, an open uncertainty rather than a resolved success. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Moisture sensor drift has not been addressed with the same bias-tracking method; this remains an open, unresolved item for future work. | applied | none |  | Section states drift uncertainty, no moisture claim made. |
| 242 | Glossary Term: sensor drift | applied | none |  | Term 'drift' used for plenum sensors verbatim concept. |
| 242 | Glossary Term: false alarm rate | applied | none |  | Concept of false alarms phrased without the term; not a… |
| 242 | Glossary Term: isolation forest | applied | none |  | Isolation forest method not mentioned in this section. |
| 242 | Glossary Term: online bias tracking | applied | none |  | Online bias tracking concept not named in this section. |
| 242 | Glossary Term: shadow mode | applied | none |  | Shadow mode concept not mentioned in this section. |
| 242 | Glossary Term: sensor redundancy | applied | none |  | Sensor redundancy concept not mentioned in this section. |
| 242 | Glossary Term: kalman filter | applied | none |  | Kalman filter not mentioned in this section. |
| 242 | Glossary Term: energy balance residual | applied | none |  | Energy balance residual concept not named in this section. |
| 242 | Cover signed-off Summary item ys70hs8mcv8pqcmn0qxj2hkvph8fe2r9 | applied | none |  | P1 covers location, business, dryer types. |
| 242 | Cover signed-off Summary item ys7exdbb3k9yyqd9wd70b9rdrd8fean6 | applied | none |  | P1 covers goal and fault types targeted. |
| 242 | Cover signed-off Summary item ys704vrv90g0deetw01h4h23zs8ff4jn | applied | none |  | P2 covers threshold alarms arriving late. |
| 242 | Cover signed-off Summary item ys7c0eh8471fz6w2yyn2fsxay58ffxj7 | applied | none |  | P2 covers drift vs fault and false alarm/lead time tradeoff. |
| 242 | Cover signed-off Summary item ys70mwf9w1zg9w0myk1ty6h9mh8ff8y3 | applied | none | 2 | P3 states uncertainty on separating bias from process change. |
| 242 | Cover signed-off Summary item ys76gpn5j9a44bw47s34hg6zz18fec1n | applied | none | 2 | P3 names coupled variables causing the uncertainty. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244): Line 242 names the fault type as 'column plugging' while nothing contradicts this, but check: Line 244 P3 and P4 use 'column plugging' consistently, so no issue here. (No finding, placeholder removed) |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 634/700 words, 63/100 lines |
| 244 | Claim Exclusion: Migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 3 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words |
| 244 | Claim Exclusion: Redesign of dashboard colours, fonts and panel layout for cosmetic/usability reasons. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions for dealers and farm operators, a sales and support activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: isolation forest | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: kalman filter | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches storyline experiments and figures |
| 244 | Confidence Map: Baseline isolation forest false alarm and detection results across drift levels are established from both transcript and development log. | applied | none |  | P3 baseline figures stated flatly, matches established |
| 244 | Confidence Map: Development log provides the same baseline data in table form with an added 1 C/month data point not mentioned in the transcript. | applied | none |  | Section doesn't add the 1C data point, no conflict |
| 244 | Confidence Map: Synthetic drift training results (false alarm drop, missed column plugs) are established and consistent across sources. | applied | none |  | P4 synthetic drift results stated flatly, matches established |
| 244 | Confidence Map: Energy balance model results at 3 C/month drift are established, consistent between transcript and log. | applied | none |  | P5 energy balance results stated flatly, matches established |
| 244 | Confidence Map: Residual RMS figures for the energy balance model on clean 2024 data are an established, log-only detail. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Shadow trial dual-sensor and single-sensor false alarm rates are established across both sources. | applied | none |  | P6 shadow trial rates stated flatly, matches established |
| 244 | Confidence Map: Model inference time on the controller is a log-only detail not corroborated in the transcript. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Single-sensor fallback using exhaust temperature improved false alarms from 0.64 to 0.33 per dryer-day, consistent across sources. | applied | none |  | P7 fallback figures stated flatly, matches established |
| 244 | Confidence Map: Spring shadow mode results as of June 26 2026 are a log-only detail with no real events recorded. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Drift profile data from post-season calibration checks on 23 sensors is a log-only detail providing median and worst-case drift figures, not mentioned in the transcript. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: The flame instability event with a 14-minute lead time is explicitly noted as just under the 15-minute target, an open uncertainty rather than a resolved success. | applied | none |  | P6 hedges 14-min event as falling short of target |
| 244 | Confidence Map: Moisture sensor drift has not been addressed with the same bias-tracking method; this remains an open, unresolved item for future work. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: false alarm rate | applied | none |  | Section uses 'false alarms per dryer-day' throughout, concept… |
| 244 | Glossary Term: online bias tracking | applied | none |  | P5 says 'tracking a rate-limited bias' not the term; repaired to the Glossary Term |
| 244 | Glossary Term: sensor redundancy | applied | none |  | Section uses 'redundancy between sensors', concept matches… |
| 244 | Glossary Term: column plugging | applied | none |  | Term 'column-plugging' appears verbatim in P4 |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status language present. |
| 244 | Cover signed-off Summary item ys78k0e8av4scj0rdn56vexbcd8feqvw | applied | none |  | P1 states staged plan and July 2025 metrics verbatim. |
| 244 | Cover signed-off Summary item ys7ehrsf05g8v731afm0gmvmts8fem4y | applied | none |  | P2 states hypothesis tying bias tracking to redundancy as… |
| 244 | Cover signed-off Summary item ys78kzb1mm895etyj7mn776z0h8fe7hj | applied | conflict |  | Drafted despite the Claim Exclusion "Migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide.": the writer kept the idea "Experiment one rebuilt an isolation forest baseline and confirmed false alarms rose with drift, reaching 2.6 per..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item ys796bxrbevf1y8nzjbdkqb94d8fft3e | applied | none |  | P4 covers synthetic-drift trade-off as sourced. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P6 calls met 14-min lead time 'just under' target |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | not_applied | none |  | P3 billing portal migration is unrelated to Line 242 |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a staged investigation starting with a baseline rebuild in July 2025 to measure drift failure. Predefi..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): This paragraph states the billing portal migration to a new cloud host as work performed within the SR&ED project. This is a listed Claim Exclusion and should not be presented as claimed work. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 329/350 words, 35/50 lines |
| 246 | Claim Exclusion: Migration of the customer billing portal to a new cloud host, done for cost reasons following a vendor migration guide. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Redesign of dashboard colours, fonts and panel layout for cosmetic/usability reasons. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions for dealers and farm operators, a sales and support activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 6) |
| 246 | Glossary Term: false alarm rate | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: isolation forest | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: detection lead time | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: sensor redundancy | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: column plugging | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches storyline experiments and results. |
| 246 | Confidence Map: Baseline isolation forest false alarm and detection results across drift levels are established from both transcript and development log. | applied | none |  | P2 states established baseline figures flatly, as allowed. |
| 246 | Confidence Map: Development log provides the same baseline data in table form with an added 1 C/month data point not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Synthetic drift training results (false alarm drop, missed column plugs) are established and consistent across sources. | applied | none |  | P3 states established synthetic drift results flatly. |
| 246 | Confidence Map: Energy balance model results at 3 C/month drift are established, consistent between transcript and log. | applied | none |  | P1/P4 state established energy balance results flatly. |
| 246 | Confidence Map: Residual RMS figures for the energy balance model on clean 2024 data are an established, log-only detail. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Shadow trial dual-sensor and single-sensor false alarm rates are established across both sources. | applied | none |  | P1/P4 state established shadow trial rates flatly. |
| 246 | Confidence Map: Model inference time on the controller is a log-only detail not corroborated in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Single-sensor fallback using exhaust temperature improved false alarms from 0.64 to 0.33 per dryer-day, consistent across sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Spring shadow mode results as of June 26 2026 are a log-only detail with no real events recorded. | applied | none |  | P5 hedges spring shadow mode as ongoing, no events claimed. |
| 246 | Confidence Map: Drift profile data from post-season calibration checks on 23 sensors is a log-only detail providing median and worst-case drift figures, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The flame instability event with a 14-minute lead time is explicitly noted as just under the 15-minute target, an open uncertainty rather than a resolved success. | not_applied | missing_fact |  | P1 states flame events 'not confirmed' flatly, losing nuance; repaired, then shortened to fit the Line limit, so not re-verified |
| 246 | Confidence Map: Moisture sensor drift has not been addressed with the same bias-tracking method; this remains an open, unresolved item for future work. | applied | none |  | P5 hedges moisture drift as not yet modeled this way. |
| 246 | Glossary Term: false alarm rate | applied | none |  | Section uses 'false alarms per dryer-day' not the term; repaired to the Glossary Term |
| 246 | Glossary Term: detection lead time | applied | none |  | P4 says 'median lead time' not 'detection lead time'; repaired to the Glossary Term |
| 246 | Glossary Term: sensor redundancy | applied | none |  | P1 says 'redundant sensors', a related but not identical term |
| 246 | Glossary Term: kalman filter | applied | none |  | 'Kalman filter' appears verbatim as 'Kalman-filtered'. |
| 246 | Glossary Term: column plugging | applied | none |  | 'column-plugging' appears verbatim in P3. |
| 246 | Cover signed-off Summary item ys7eqa8z5pwf1030zhfwge15rh8fedrm | applied | none |  | P1 states bias separation and 0.2 figure at 3C drift. |
| 246 | Cover signed-off Summary item ys72s4trgw4qjtgka1t84j94td8ffbnn | applied | none | 2 | P2 states isolation forest failure and 0.3 to 2.6 figures. |
| 246 | Cover signed-off Summary item ys721hvxvxrabgebc2093z2fgn8ffc44 | applied | none | 2 | P3 states drift tolerance causes missed slow faults. |
| 246 | Cover signed-off Summary item ys7agje7qhvz57q6dc9edp469n8ffyqk | applied | none |  | P5 covers shadow mode, open items, Ashgrove trial. |
| 246 | Cover signed-off Summary item ys71wp6hax1zzfmbd0n316eenx8ff312 | applied | none |  | P4 states bias/process separation resolved with figures. |
| 246 | State each result against its target as the numbers show | not_applied | none |  | P1 calls a missed target 'stayed just under' as if close. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claimed advancements map to COVER items answering Line 242. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 2 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 27.
- Line 244: 0 labels and 0 plan checks "Not checked" of 24.
- Line 246: 0 labels and 0 plan checks "Not checked" of 25.

## Seed-stage numbers

- Requests: 14 metered (14 Batch, 0 Feedback); 15 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.2 s, p95 26.4 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.1 s, p95 15.1 s over 1.
- Sign-off to report created: 152.0 s.
- Cost from aiUsage: $1.05 in all ($0.36 seed stage, $0.69 Brief, drafting and checks) over 44 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T01:46:16.441Z created project k977jx0ckskyzghf22nhk03w498ffzwg
2026-10-01T01:46:17.067Z added document model-development-log.md
2026-10-01T01:46:18.354Z started Step by step generation k57645ksxwg4gew83cmxwsm8k98ffrvq
2026-10-01T01:47:03.600Z seed stage open
2026-10-01T01:47:03.600Z Open Company / Context and wait for its Batch
2026-10-01T01:47:17.849Z Company / Context: select the first Seed
2026-10-01T01:47:19.748Z Approve Company / Context
2026-10-01T01:47:21.651Z approved company_context
2026-10-01T01:47:21.651Z Open Goal / Problem and wait for its Batch
2026-10-01T01:47:35.946Z Goal / Problem: select the first Seed
2026-10-01T01:47:38.035Z Approve Goal / Problem
2026-10-01T01:47:40.235Z approved goal_problem
2026-10-01T01:47:40.235Z Open Technological limitations and wait for its Batch
2026-10-01T01:47:53.530Z Technological limitations: select the first Seed
2026-10-01T01:47:55.974Z Approve Technological limitations
2026-10-01T01:47:58.270Z approved passive_limitations
2026-10-01T01:47:58.270Z Open Technological objectives and wait for its Batch
2026-10-01T01:48:13.636Z Technological objectives: select the first Seed
2026-10-01T01:48:15.546Z Approve Technological objectives
2026-10-01T01:48:17.491Z approved technological_objective
2026-10-01T01:48:17.491Z Open Technological uncertainties and wait for its Batch
2026-10-01T01:48:31.857Z Technological uncertainties: select the first 2 Seeds
2026-10-01T01:48:35.056Z Approve Technological uncertainties
2026-10-01T01:48:36.980Z approved active_uncertainties
2026-10-01T01:48:36.980Z Skip Previous-year status
2026-10-01T01:48:38.292Z Open Work plan and wait for its Batch
2026-10-01T01:48:55.257Z Work plan: select the first Seed
2026-10-01T01:48:57.181Z Approve Work plan
2026-10-01T01:48:59.088Z approved workplan
2026-10-01T01:48:59.088Z Open Hypothesis and wait for its Batch
2026-10-01T01:49:10.768Z Hypothesis: select the first Seed
2026-10-01T01:49:12.688Z Approve Hypothesis
2026-10-01T01:49:14.614Z approved hypothesis
2026-10-01T01:49:14.614Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T01:49:44.973Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T01:49:48.184Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-01T01:49:50.713Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-01T01:49:52.665Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-01T01:49:52.665Z Open Advancement to science / technology and wait for its Batch
2026-10-01T01:50:06.952Z Advancement to science / technology: select the first Seed
2026-10-01T01:50:08.863Z Approve Advancement to science / technology
2026-10-01T01:50:10.796Z approved overall_advancement
2026-10-01T01:50:10.796Z Open Specific technological advancements and wait for its Batch
2026-10-01T01:50:27.632Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T01:50:32.714Z Approve Specific technological advancements
2026-10-01T01:50:34.666Z approved specific_advancements
2026-10-01T01:50:34.666Z Open Project status and next steps and wait for its Batch
2026-10-01T01:50:48.967Z Project status and next steps: select the first Seed
2026-10-01T01:50:50.918Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-01T01:50:52.807Z Approve Project status and next steps
2026-10-01T01:50:54.797Z approved project_status
2026-10-01T01:50:54.797Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T01:51:11.691Z Overall company / project goal improvements: select the first Seed
2026-10-01T01:51:13.615Z Approve Overall company / project goal improvements
2026-10-01T01:51:15.549Z approved goal_improvements
2026-10-01T01:51:15.549Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T01:51:16.834Z signed off; waiting for the report
2026-10-01T01:53:49.629Z report kd77n1dy5ba7yhdegwk6hm1vss8fejz9 created
```
