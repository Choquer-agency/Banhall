# Release eval - Quillmere drift-tolerant burner anomaly model

Semantic case: **Exclusion-matching selection** (CAP-13: "exclusion-matching selection"). Also checks: a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `df6eb97b`, acting as chat-live-1793085355051@example.test. Project `k979sgkmrdrj0sx6da1t20cx258h3eqh`, generation `k5776gyxhvem6sts5ycphwmxx18h3wbd`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd77212k08nz2h4mxw1hja56j58h2ws8 |
| All three Sections were drafted | pass | 242: 342 words, 244: 628 words, 246: 317 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 242: 0 labels and 1 plan check "Not checked" of 17; 244: 0 labels and 1 plan check "Not checked" of 16; 246: 0 labels and 1 plan check "Not checked" of 16 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: not_applied ("Billing portal migration is unrelated work."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("Not checked: the targets check flagged something it could not show from the sources (its words: D..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: )"); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: P1 'only partly proven' and 'median lead' ok; 'by month' check)") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 3 requests (7.9 s, 6.3 s, 8.1 s); 244: 2 requests (7.4 s, 6.7 s); 246: 2 requests (7.0 s, 6.9 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 13 metered calls (13 Batch, 0 Feedback), 14 reserved; notice not shown; 0 Retry |
| The Brief derived at least one Claim Exclusion | pass | "Billing portal migration to a new cloud host was routine IT work." (routine_engineering); "Dashboard colour and layout redesign was cosmetic." (not_technological); "Customer training sessions are sales and support." (business_risk); "Selling early fault warning as a feature is a business outcome, not SR&ED work." (business_risk); "Fiscal 2025 isolation forest attempt falls before the claim period." (outside_claim_period) |
| Approve warned about the Claim Exclusion and the confirmation was recorded | pass | acknowledged 1 exclusion(s); recorded at 1793133816121 |
| The matching selection is signed off with the confirmed exclusion | pass | "Slow sensor drift could not be told from slow faults, so the team rebuilt the baseline. The work also covered this: Billing portal migration to a new cloud h..." |
| The Compliance Note records the conflict (tier conflict) and did not repair it | pass | 244: "Claim Exclusion: Billing portal migration to a new cloud host was routine IT work."; 244: "Cover signed-off Summary item h57gjj9hcmtfzhj2kvhs6bn57h8h303j" |
| Heuristic: the conflicting selection was drafted, not removed | pass | 100 percent of the exclusion's content words appear in Section 244 |
| The writer-asserted item is in the plan as writer-asserted | pass | "The open question is single-sensor dryers, where false alarms are still above target. The writer confirms a second field trial at the Ashgrove elevator is bo..." (writer_asserted) |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P3 covers single-sensor status and Ashgrove trial." |
| Where "Ashgrove" appears in the drafted Section | info | "suffice for validation remain unresolved. A second field trial at the Ashgrove elevator is booked for spring 2027. The project aimed to warn operat" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company builds controllers and analytics software for grain dryers. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Fixed threshold alarms are late, because the plenum crosses the threshold when the fault is well along. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether slow sensor drift differs from slow real faults without labels. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- Whether the model could separate slow sensor drift from slow real faults without labels was unknown. _(cited)_
- Drift-compensation methods in the literature assume a trusted reference sensor, which the dryers lack. / Whether bias could be separated from process change in a coupled system was unknown. _(writer-asserted)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan tested whether a model could separate slow sensor drift and real faults that also develop slowly. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If anomaly scores use energy balance residuals with online bias tracking, false alarms stay below 0.25 per dryer-day. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Slow sensor drift could not be told from slow faults, so the team rebuilt the baseline. / The work also covered this: Billing portal migration to a new cloud host was routine IT work. _(edited, writer-asserted, Claim Exclusion confirmed)_
  - Tested: uncertainty "Whether the model could separate slow sensor drift from slow real f..."
- Synthetic drift training cut false alarms but missed all column plugs, so the approach was dropped. _(cited)_
  - Tested: uncertainty "Whether the model could separate slow sensor drift from slow real f..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Slow drift and slow faults were separated using energy balance residuals with online bias tracking. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Training on synthetic drift hides slow faults, so it is the wrong approach here. _(cited)_
  - Links: uncertainty "Whether the model could separate slow sensor drift from slow real f..."; experiments "Synthetic drift training cut false alarms but missed all column plu..."
- The model had learned to treat slow rises as drift, so column plugs developing over 30 to 60 minutes went undetected. _(cited)_
  - Links: uncertainty "Whether the model could separate slow sensor drift from slow real f..."; experiments "Synthetic drift training cut false alarms but missed all column plu..."

### 12. Project status and next steps (Section 246, standard): approved

- The open question is single-sensor dryers, where false alarms are still above target. The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027. _(edited, writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The goal of early warning with few false alarms was met on injected drift, not yet in live alerts. _(cited)_

## Drafted Sections

### Line 242

Early fault warning on grain dryers could not be given reliably, because it was unknown whether a model could separate slow sensor drift from slow real faults without labels. The team sought to learn whether the two differ in a way a model can use. The goal was a model that warns operators of burner and column faults early enough to act. The company builds controllers and analytics software for grain dryers. Its controllers read temperature and moisture sensors and run the burner and discharge rate, which gave the team field experience of how sensors behave over a harvest season.

Fixed-threshold alarms are late, because plenum temperature crosses the threshold only when the fault is well along. Drift-compensation methods in the literature mostly assume a trusted reference sensor or periodic calibration, and the dryers have neither. No documented method separated slow sensor drift from slow real faults, such as a plugging column, without labelled drift examples. Retraining on drifted data teaches a model that drift is normal, which can hide slow faults.

The technological objective was to advance understanding of anomaly detection on drifting, coupled industrial sensor data without labelled drift examples or reference sensors. The target was detecting burner and column faults with a median lead time of at least 15 minutes and fewer than 0.25 false alarms per dryer-day under sensor drift up to 3 °C per month.

It was uncertain whether a model could separate slow sensor drift from slow real faults without labels, because making a model tolerant of slow change also slows its detection of slow faults. It was uncertain whether bias could be separated from real process change in a coupled system, because burner output, air flow, grain flow, ambient conditions and grain moisture interact and only the available sensors could be used. It was uncertain whether anomaly scores on an energy balance residual, with online bias tracking from redundant sensors, would keep false alarms under target, particularly on dryers with one plenum sensor. It was also uncertain whether 11 documented faults could validate the approach.

### Line 244

The technical problem was whether a model could separate slow sensor drift from real faults that also develop slowly, such as a plugging column, without labelled drift examples or a trusted reference sensor. The company planned the work in phases. It first rebuilt the isolation forest baseline and measured how it failed under injected drift. It then tested synthetic drift training, followed by an energy balance residual model with online bias tracking, and finally ran shadow mode trials on customer dryers. In July 2025, before any run, the team defined a false alarm as an alert with no fault in the following two hours, counted per dryer-day. Lead time ran from the alert to the earlier of the existing hard-limit alarm or the operator's manual shutdown. Fixing these definitions in advance kept the pass criteria from shifting with results.

It was hypothesized that if anomaly scores were computed on energy balance residuals with online bias tracking from redundant sensors, then false alarms per dryer-day would stay below 0.25 and median lead time would stay at or above 15 minutes under sensor drift up to 3 °C per month. Either measure missing its target on injected drift or shadow mode data would disprove the hypothesis.

Slow sensor drift could not be told from slow faults, so the team rebuilt the baseline. The rebuilt isolation forest on raw sensor readings had looked good in the lab, so the team injected drift to test it. At 3 °C per month it produced 2.6 false alarms per dryer-day with a median lead time of 9 minutes, missing both targets. The team concluded that raw readings could not carry the distinction. A model had to learn what drift looked like or have it removed. This result set the comparison point for later phases. The work also covered a billing portal migration to a new cloud host, which was routine IT work.

The next question was whether synthetic drift training could teach the model to ignore drift without hiding slow faults. The team trained with synthetic drift and replayed the 11 documented faults. False alarms fell to 0.6 per dryer-day, but the model caught only 6 of 11 faults and missed all three column plugs, which build over 30 to 60 minutes. The model had learned to treat slow rises as drift. The team dropped the approach, learning that tolerance to slow change and detection of slow faults trade against each other in this method.

The team then asked whether physics could separate the two. It computed an energy balance residual and tracked per-sensor bias online with a Kalman filter, using sensor redundancy. On injected drift this gave 0.18 false alarms per dryer-day, 10 of 11 faults and a median lead time of 22 minutes, meeting both targets. The shadow mode trial on nine customer dryers in fall 2025 showed a split. The seven dual-sensor dryers gave 0.21 false alarms per dryer-day, below the 0.25 limit, but the two single-sensor dryers gave 0.64. All four real events were flagged, with lead times of 14, 19, 26 and 31 minutes. The 14-minute flame event was below the 15-minute target. Without the redundant sensor, the bias tracker could not separate drift from process change and had to be set conservatively, so a fault was absorbed.

The team finally tested whether exhaust temperature could act as an indirect second reference on the single-sensor dryers. This cut false alarms from 0.64 to 0.33 per dryer-day, still above the 0.25 limit. Sensor redundancy therefore decides performance, and exhaust temperature only partly replaces it. Moisture sensor drift remains less well handled than temperature drift. The model continues to run in shadow mode on the same nine dryers. Whether 11 documented faults plus four real events suffice for validation is unresolved.

### Line 246

Slow sensor drift and slow real faults were hard to tell apart without labels, and it was unknown whether a model could tolerate drift without losing detection of slow faults. Through this investigation, it was established that slow drift and slow faults were separated using energy balance residuals with online bias tracking, though the hypothesis was only partly proven. On injected drift of 3 °C per month, this gave 0.18 false alarms per dryer-day against a limit below 0.25, and a median lead time of 22 minutes against a target of at least 15.

Whether synthetic drift training could teach a model to ignore drift without hiding slow faults was uncertain. It was determined that this training hides slow faults, so it is the wrong approach here. The model had learned to treat slow rises as drift, so column plugs developing over 30 to 60 minutes went undetected. This resolved the uncertainty regarding drift tolerance versus slow-fault detection. Based on this understanding, the company dropped that approach and moved to the energy balance residual model.

The open question is single-sensor dryers, where false alarms are still above target. Without a redundant sensor, the bias tracker cannot separate drift from process change. In shadow mode these dryers gave 0.64 false alarms per dryer-day, and exhaust temperature as an indirect reference cut that to 0.33, against a limit below 0.25. Flame event lead time was 14 minutes on one event, under the 15-minute target. Moisture sensor drift, performance across a full season of live alerts, and whether 11 documented faults suffice for validation remain unresolved. A second field trial at the Ashgrove elevator is booked for spring 2027.

The project aimed to warn operators of burner and column faults early, without flooding them with false alarms. That goal was met on injected drift, with 10 of 11 faults caught, but it has not yet been shown in live alerts.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 342/350 words, 33/50 lines |
| 242 | Claim Exclusion: Billing portal migration to a new cloud host was routine IT work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Selling early fault warning as a feature is a business outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Experiment results through the fall shadow trial are consistent across transcript and log. | applied | none |  | No contradiction of established results. |
| 242 | Confidence Map: Only 11 documented faults limit validation strength. | applied | none |  | P4 states the 11 faults as uncertain. |
| 242 | Confidence Map: Flame lead time is marginal. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Moisture drift is not handled by the method. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Live-alert performance is not yet shown; spring shadow had no real events. | applied | none |  | Live-alert claims not made. |
| 242 | Confidence Map: Interview says next step is live alerts, log gives fall 2026 timing; spring shadow-mode is running. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: shadow mode | applied | none |  | Concept absent. |
| 242 | Glossary Term: synthetic drift training | applied | none |  | Concept absent. |
| 242 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57q4j4m6q2tcqt908g4cet9z18h3d11 | applied | none |  | P1 states what the company builds. |
| 242 | Cover signed-off Summary item h57pev68gm3gf9xczpv87c74p98h2dt6 | applied | none |  | P1 gives goal and company line. |
| 242 | Cover signed-off Summary item h57jm25wfps63fxnq6zsqxna5x8h23j9 | applied | none |  | P2 covers late fixed-threshold alarms. |
| 242 | Cover signed-off Summary item h57hm07wjx2xeafw13ycxxmn218h35f0 | applied | none |  | P1 states what the team sought to learn. |
| 242 | Cover signed-off Summary item h57wxdns0rzat8aaewk61mrfch8h25je | applied | none | 2 | P4 states the separation uncertainty. |
| 242 | Cover signed-off Summary item h57rdx4n4vrdq4a37axy0kh9yx8h2m9y | applied | none | 2 | P2 and P4 cover reference sensor and coupling. |
| 242 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: ) |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 628/700 words, 57/100 lines |
| 244 | Claim Exclusion: Billing portal migration to a new cloud host was routine IT work. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering): its exact words are not in this Line, but a close form of its words is in paragraph 3 and is not repaired away; the idea's own row says whether it was drafted |
| 244 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Selling early fault warning as a feature is a business outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: synthetic drift training | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Experiment results through the fall shadow trial are consistent across transcript and log. | applied | none |  | Results match the log. |
| 244 | Confidence Map: Only 11 documented faults limit validation strength. | applied | none |  | P6 says validation sufficiency is unresolved. |
| 244 | Confidence Map: Flame lead time is marginal. | applied | none |  | P5 notes the 14-minute event is below target. |
| 244 | Confidence Map: Moisture drift is not handled by the method. | applied | none |  | P6 says moisture drift is less well handled. |
| 244 | Confidence Map: Live-alert performance is not yet shown; spring shadow had no real events. | applied | none |  | No live-alert performance claim made. |
| 244 | Confidence Map: Interview says next step is live alerts, log gives fall 2026 timing; spring shadow-mode is running. | applied | none |  | Section says shadow mode continues; no live timing. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year work is absent. |
| 244 | Cover signed-off Summary item h57qqtrwnch754sxzvmgccc0qn8h29j0 | applied | none |  | P1 states the problem and phased plan. |
| 244 | Cover signed-off Summary item h57x0ad190wnsegw5jvb328whn8h2k4n | applied | none |  | P2 states the hypothesis with targets. |
| 244 | Cover signed-off Summary item h57gjj9hcmtfzhj2kvhs6bn57h8h303j | applied | conflict |  | Drafted despite the Claim Exclusion "Billing portal migration to a new cloud host was routine IT work.": the writer kept the idea "Slow sensor drift could not be told from slow faults, so the team rebuilt the baseline. The work also covered this:..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 244 | Cover signed-off Summary item h57vbwrax48g1q7rmg533jzg0x8h2pzp | applied | none |  | P4 covers synthetic drift and dropped approach. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | Not checked: the targets check flagged something it could not show from the sources (its words: Dual-sensor 0.21 met target; shadow lead time claim.) |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | not_applied | none |  | Billing portal migration is unrelated work. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Slow sensor drift could not be told from slow faults, so the team rebuilt the baseline. The work also covered this: Bil..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 5 (sections 244, 246): Line 244 says the energy balance residual model on injected drift caught 10 of 11 faults and met both targets, yet the same paragraph says a fault was absorbed on single-sensor dryers. This is consistent. However, Line 246 P2 says column plugs went undetected only under synthetic training, which matches. No conflict here beyond the points below. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 3 (sections 244): The sentence on the billing portal migration to a new cloud host presents routine IT work inside the project description. The brief says the signed-off idea is the only permitted one, but this is a stray claim of that work in a paragraph about the baseline. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 317/350 words, 30/50 lines |
| 246 | Claim Exclusion: Billing portal migration to a new cloud host was routine IT work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dashboard colour and layout redesign was cosmetic. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Customer training sessions are sales and support. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Selling early fault warning as a feature is a business outcome, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Fiscal 2025 isolation forest attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: sensor drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: lead time | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: online bias tracking | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shadow mode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: energy balance residual | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: false alarms per dryer-day | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: synthetic drift training | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Experiment results through the fall shadow trial are consistent across transcript and log. | applied | none |  | Results match the established entry. |
| 246 | Confidence Map: Only 11 documented faults limit validation strength. | applied | none |  | P3 says 11 faults sufficiency remains unresolved. |
| 246 | Confidence Map: Flame lead time is marginal. | applied | none |  | P3 gives 14 minutes on one event. |
| 246 | Confidence Map: Moisture drift is not handled by the method. | applied | none |  | Moisture drift stated as unresolved. |
| 246 | Confidence Map: Live-alert performance is not yet shown; spring shadow had no real events. | applied | none |  | P4 says not yet shown in live alerts. |
| 246 | Confidence Map: Interview says next step is live alerts, log gives fall 2026 timing; spring shadow-mode is running. | applied | none |  | No live-alert timing stated flatly. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57nw566gtpj0e8f410v350z258h3rzz | applied | none |  | P1 states the separation with figures. |
| 246 | Cover signed-off Summary item h57k0q6bt49xkfegwhdhwx0bzs8h3dak | applied | none | 2 | P2 states synthetic training hides slow faults. |
| 246 | Cover signed-off Summary item h57xmj02r3khfdx2bt4nxbbs0h8h3s15 | applied | none | 2 | P2 covers the column plugs missed. |
| 246 | Cover signed-off Summary item h57khf1e0628qjxbsjcw1kswwn8h3xvw | applied | none |  | P3 covers single-sensor status and Ashgrove trial. |
| 246 | Cover signed-off Summary item h57n4heeb0hp95fhz1wnd326e58h23qg | applied | none |  | P4 states goal met on injected drift only. |
| 246 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: P1 'only partly proven' and 'median lead' ok; 'by month' check) |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancements answer Line 242 uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Slow drift and slow faults were separated using energy balance residuals with online bias tracking." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Training on synthetic drift hides slow faults, so it is the wrong approach here." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): Line 246 says the goal was met on injected drift, but the 14-minute flame event and the single-sensor results in shadow mode mean lead time and false alarm targets were not met in the field. Line 244 P5 also shows the mixed result, so the claim of the goal being met is overstated against Line 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says slow drift and slow faults were separated, with the hypothesis only partly proven. Line 244 P5 shows one of the 11 faults was missed on injected drift and shadow mode single-sensor dryers failed the false alarm target, so 'separated' is stated without that qualification. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): Line 246 mentions a second field trial at the Ashgrove elevator in spring 2027. Line 244 says the model continues to run in shadow mode on the same nine dryers and mentions no such trial, so the plan is not supported by Line 244. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 5 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 1 plan check "Not checked" of 17.
- Line 244: 0 labels and 1 plan check "Not checked" of 16.
- Line 246: 0 labels and 1 plan check "Not checked" of 16.

## Seed-stage numbers

- Requests: 13 metered (13 Batch, 0 Feedback); 14 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.1 s, p95 10.7 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 14.5 s, p95 14.5 s over 1.
- Sign-off to report created: 99.2 s.
- Cost from aiUsage: $1.22 in all ($0.45 seed stage, $0.77 Brief, drafting and checks) over 33 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T20:41:07.111Z created project k979sgkmrdrj0sx6da1t20cx258h3eqh
2026-10-27T20:41:07.994Z marked as an evaluation project
2026-10-27T20:41:09.240Z added document model-development-log.md
2026-10-27T20:41:11.148Z started Step by step generation k5776gyxhvem6sts5ycphwmxx18h3wbd
2026-10-27T20:41:27.003Z seed stage open
2026-10-27T20:41:27.003Z Open Company / Context and wait for its Batch
2026-10-27T20:41:32.894Z Company / Context: select the first Seed
2026-10-27T20:41:35.713Z Approve Company / Context
2026-10-27T20:41:38.486Z approved company_context
2026-10-27T20:41:38.486Z Open Goal / Problem and wait for its Batch
2026-10-27T20:41:47.047Z Goal / Problem: select the first Seed
2026-10-27T20:41:50.039Z Approve Goal / Problem
2026-10-27T20:41:52.822Z approved goal_problem
2026-10-27T20:41:52.823Z Open Technological limitations and wait for its Batch
2026-10-27T20:42:02.293Z Technological limitations: select the first Seed
2026-10-27T20:42:04.996Z Approve Technological limitations
2026-10-27T20:42:07.736Z approved passive_limitations
2026-10-27T20:42:07.736Z Open Technological objectives and wait for its Batch
2026-10-27T20:42:16.137Z Technological objectives: select the first Seed
2026-10-27T20:42:18.853Z Approve Technological objectives
2026-10-27T20:42:21.550Z approved technological_objective
2026-10-27T20:42:21.550Z Open Technological uncertainties and wait for its Batch
2026-10-27T20:42:29.790Z Technological uncertainties: select the first 2 Seeds
2026-10-27T20:42:34.380Z Approve Technological uncertainties
2026-10-27T20:42:37.622Z approved active_uncertainties
2026-10-27T20:42:37.622Z Skip Previous-year status
2026-10-27T20:42:39.519Z Open Work plan and wait for its Batch
2026-10-27T20:42:56.872Z Work plan: select the first Seed
2026-10-27T20:42:59.752Z Approve Work plan
2026-10-27T20:43:02.768Z approved workplan
2026-10-27T20:43:02.768Z Open Hypothesis and wait for its Batch
2026-10-27T20:43:11.163Z Hypothesis: select the first Seed
2026-10-27T20:43:13.904Z Approve Hypothesis
2026-10-27T20:43:16.804Z approved hypothesis
2026-10-27T20:43:16.805Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T20:43:25.160Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T20:43:29.665Z Experimentation / Iterations: edit the selected Seed, adding a bullet with the Brief's Claim Exclusion about "billing"
2026-10-27T20:43:33.321Z Experimentation / Iterations: approve, confirming the Claim Exclusion warning
2026-10-27T20:43:36.202Z approved experimentation (confirmed 1 Claim Exclusion)
2026-10-27T20:43:36.203Z Open Advancement to science / technology and wait for its Batch
2026-10-27T20:43:44.615Z Advancement to science / technology: select the first Seed
2026-10-27T20:43:47.553Z Approve Advancement to science / technology
2026-10-27T20:43:50.392Z approved overall_advancement
2026-10-27T20:43:50.392Z Open Specific technological advancements and wait for its Batch
2026-10-27T20:44:01.748Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T20:44:10.011Z Approve Specific technological advancements
2026-10-27T20:44:13.150Z approved specific_advancements
2026-10-27T20:44:13.151Z Open Project status and next steps and wait for its Batch
2026-10-27T20:44:21.924Z Project status and next steps: select the first Seed
2026-10-27T20:44:24.749Z Project status and next steps: edit the selected Seed, adding "The writer confirms a second field trial at the Ashgrove elevator is booked for spring 2027."
2026-10-27T20:44:27.479Z Approve Project status and next steps
2026-10-27T20:44:30.213Z approved project_status
2026-10-27T20:44:30.213Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T20:44:39.195Z Overall company / project goal improvements: select the first Seed
2026-10-27T20:44:41.913Z Approve Overall company / project goal improvements
2026-10-27T20:44:44.811Z approved goal_improvements
2026-10-27T20:44:44.811Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T20:44:46.675Z signed off; waiting for the report
2026-10-27T20:46:27.976Z report kd77212k08nz2h4mxw1hja56j58h2ws8 created
```
