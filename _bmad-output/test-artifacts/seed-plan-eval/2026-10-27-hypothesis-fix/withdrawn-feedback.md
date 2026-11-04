# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-10-27 on `local` at commit `afbfd302`, acting as chat-live-1793085355051@example.test. Project `k975rqtqwfrgga5heqafd75tgh8h2akm`, generation `k57bqhk2jmqwd8d662sxnbf3d58h3cts`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: 
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: 
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: 
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

12 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd70r723kcmqe9bn8bxt37q9fd8h2tsa |
| All three Sections were drafted | pass | 242: 340 words, 244: 665 words, 246: 318 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work answers stated uncertainties or 246 items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P2 says "A full scan of one bracket takes about 90 seconds, too long for a 4-minute cycle", but the sources say "a full scan of one bracket takes about 90 se..."); 244: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P8 says "with it, rejects were 2.4 percent with no dri..."); 246: applied ("The facts check found no figure or detail it could show differs from the sources.") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 3 requests (8.4 s, 6.8 s, 5.7 s); 244: 2 requests (7.4 s, 6.7 s); 246: 2 requests (7.1 s, 8.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (14 Batch, 2 Feedback), 17 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 4 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds robotic finishing cells for aerospace and medical parts. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company builds robotic finishing cells, including grinding, sanding, polishing and deburring, mostly for aerospace and some medical parts. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- A fixed-force cell either over-rounds small burrs or leaves large ones when burr height varies from 0.1 to 1.2 mm. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether burr height could be estimated from 2D images accurately and fast enough for per-edge force. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether per-edge force could hold an edge radius of 0.2 to 0.5 millimetres on every edge. _(cited)_
- It was uncertain whether burr height per edge could be estimated from 2D images to within 0.1 mm RMS. / The same estimate also had to finish in under 120 ms per edge. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned to test whether burr height could be estimated from 2D images to within 0.1 mm RMS. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If burr height per edge is estimated from 2D images to within 0.1 mm RMS in under 120 ms, rejects fall below 3 percent. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Single-angle imaging with a low-angle ring light gave 0.18 millimetres RMS at about 210 milliseconds per edge. _(cited)_
  - Tested: uncertainty "It was uncertain whether burr height per edge could be estimated fr..."
- The borrowed 3D camera had depth resolution of about 0.2 millimetres, so the team returned to 2D. _(cited)_
  - Tested: uncertainty "It was uncertain whether burr height per edge could be estimated fr..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Two-angle imaging cut the error to 0.07 mm RMS at 95 ms per edge, meeting the 2D estimate targets. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Two lighting angles with image differencing separate burr shadow from reflection, giving 0.07 mm RMS at 95 ms per edge. _(cited)_
  - Links: uncertainty "It was uncertain whether burr height per edge could be estimated fr..."; experiments "Single-angle imaging with a low-angle ring light gave 0.18 millimet...", "The borrowed 3D camera had depth resolution of about 0.2 millimetre..."
- A single-angle camera cannot meet the targets, since the error was 0.18 millimetres RMS at about 210 milliseconds per edge. _(cited)_
  - Links: uncertainty "It was uncertain whether burr height per edge could be estimated fr..."; experiments "Single-angle imaging with a low-angle ring light gave 0.18 millimet..."

### 12. Project status and next steps (Section 246, standard): approved

- It is untested whether burr height can be estimated on internal edges that the camera can't see straight on. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team learned that burr height could be estimated from 2D images to 0.07 millimetres RMS at 95 milliseconds per edge. _(cited)_

## Drafted Sections

### Line 242

It was uncertain whether burr height could be estimated from fast 2D images accurately enough, and quickly enough, to set deburring force for each edge of a cast A357 aluminium bracket. The team sought to learn whether the estimate could meet both limits for per-edge force. The company designs and builds robotic finishing cells, including grinding, sanding, polishing and deburring, mostly for aerospace and some medical parts. It set out to build a deburring cell for brackets of about 180 x 90 mm that holds a consistent rounded edge within a 4-minute cycle.

Standard practice lacked the knowledge to set deburring force from the burr on each edge. A fixed-force cell either over-rounds small burrs or leaves large ones when burr height varies from 0.1 to 1.2 mm. No documented method estimated burr height on cast aluminium from fast 2D images, because the surface is shiny in places and dull in others and the burr is small relative to the part. A full scan of one bracket takes about 90 seconds, too long for a 4-minute cycle, and touch probing was also too slow. No model linked burr height, compliant spindle force and edge radius, and thin 2.5 mm flanges flex under load.

The technological objective was to advance understanding of 2D vision-based burr height estimation and of the relationship between burr height and compliant spindle force on cast A357 aluminium, in order to create an adaptive cell that holds an edge radius of 0.2 to 0.5 mm within a 4-minute cycle.

It was uncertain whether burr height per edge could be estimated from 2D images to within 0.1 mm RMS. The same estimate also had to finish in under 120 ms per edge. Image appearance depends on lighting angle and burr shape, and reflections from machined faces can mimic burr signal. It was uncertain whether per-edge force could hold an edge radius of 0.2 to 0.5 millimetres on every edge, because casting variation, thin-flange flex and chatter at higher forces could make the force-to-radius relationship too unstable to control.

### Line 244

The technical uncertainty was whether burr height per edge could be estimated from 2D images to within 0.1 mm RMS in under 120 ms, and whether per-edge force could then hold the edge radius window. The team planned to test this in the Bay 4 pilot cell using customer A357 brackets. The steps ran in order: a fixed-force baseline, a 2D estimate checked against a laser profiler, a burr-height-to-force map tested on real brackets, then longer trials for casting variation and abrasive wear. In August 2025 the team first checked that the modified compliant spindle could change force between edges, which it did in about 80 ms.

It was hypothesized that if burr height per edge is estimated from 2D images to within 0.1 mm RMS in under 120 ms, and that estimate sets compliant spindle force for each edge, then at least 97 percent of edges will fall within the edge radius window of 0.2 to 0.5 mm and rejects will fall below 3 percent.

The first question was the cost of fixed force. The company ran 120 brackets at a fixed 20 N on a fixed path. Cycle time was 3:10 and rejects were 14 percent. About two thirds of rejects were leftover burrs on high-burr edges, and the rest were edges over-rounded above 0.5 mm. Fixed force therefore performed worse than the customer's hand deburring, which confirmed that force had to follow the burr on each edge.

The next question was whether one camera could estimate burr height. The company used a 12 MP camera with a low-angle ring light on 400 edges, referenced to a laser profiler. Single-angle imaging gave 0.18 mm RMS at about 210 ms per edge, missing both limits. Reflections on machined faces made some burrs look much taller; 31 of 400 edges were overestimated by more than 0.4 mm, all on machined faces. A single-angle setup could not separate burr signal from reflection.

The company then tested whether depth sensing would avoid the problem. It borrowed a structured light 3D camera for two weeks. Depth resolution was about 0.2 mm at working distance, with about 400 ms per capture. That was no better than the 2D result on accuracy and slower on speed, so the team returned to 2D.

The team revised the 2D method. It took two shots per edge at 15 and 60 degrees and applied two-angle differencing, because burr shadow changes with lighting angle differently from reflection off a flat face. GPU processing and cropping to a region around each edge from the CAD path addressed speed. On the same 400 edges, error fell to 0.07 mm RMS at 95 ms per edge, with a worst single-edge error of 0.19 mm. Both targets were met.

The company then mapped force to radius using 60 coupons cut from scrap brackets, with burrs of 0.1 to 1.2 mm and forces of 8 to 40 N. The relationship was non-linear, rising from about 10 N to 22 N for burrs up to about 0.6 mm, then steeper to about 34 N at 1.2 mm. A lookup table run on 300 brackets gave 4.3 percent rejects, 96.1 percent of edges in the window and a 3:50 cycle. Most rejects were on 2.5 mm thin flanges, where above about 28 N the flange flexed and the head chattered. Thin flanges therefore limited usable force.

Test 5 capped force at 26 N on thin flanges and cut feed from 40 to 25 mm/s, on 360 brackets from casting lots 2 and 3. A second pass on 40 brackets gave 3.9 percent rejects, so slower feed worked better. In this single run, chatter stopped, rejects were 2.6 percent, 97.8 percent of edges were in the window and cycle time was 3:58. Last, a reference coupon deburred and imaged every 25 brackets scaled the force map. Without correction, radius drifted smaller over about 150 brackets. Over 240 brackets the reject rate stayed at 2.4 percent, with no drift trend across the run.

### Line 246

It was uncertain whether burr height per edge could be estimated from 2D images to within 0.1 mm RMS in under 120 ms. Two-angle imaging resolved it: error fell to 0.07 mm RMS at 95 ms per edge, which met both targets. The hypothesis was therefore proven for the estimate. Its second half, that per-edge force holds the edge radius window, was not proven in the first force map run: 96.1 percent of edges fell in the window against the 97 percent target, because thin flanges chattered above about 28 N.

It was determined that two lighting angles with two-angle differencing separate burr shadow from surface reflection, because the shadow changes with angle differently from reflection off a flat face. This resolved the uncertainty regarding whether 2D imaging could meet the accuracy and speed limits. A single-angle camera with a low-angle ring light could not: it gave 0.18 mm RMS at about 210 ms per edge, and reflections on machined faces overstated some burrs. A borrowed 3D camera, with about 0.2 mm depth resolution, was no better, so the team returned to 2D. Based on this understanding, the company set per-edge force from the two-angle estimate.

It remains untested whether burr height can be estimated on internal edges the camera cannot view straight on. The uncertainty persists because a straight-on view is what the two-angle method relies on, and these edges do not allow one. Transfer to other alloys and bracket designs, and any further cut in GPU time, are also unresolved.

The goal was a deburring cell that holds an edge radius of 0.2 to 0.5 mm within a 4-minute cycle on cast A357 brackets. The team learned that burr height could be estimated from 2D images to 0.07 mm RMS at 95 ms per edge. That estimate now drives per-edge compliant spindle force in the pilot cell, replacing the fixed force that gave 14 percent rejects.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 340/350 words, 31/50 lines |
| 242 | Claim Exclusion: New product line and commercial benefits are business outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer acceptance run is planned after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Internal edge and next bracket family work is planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Reusing two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Using the previous or higher force on short edges is a routine operating rule. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline. |
| 242 | Confidence Map: Two-angle vision result is reported consistently in the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Memo reports the same vision result independently. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Test 5 result met the hypothesis, but on a single run of 360 brackets. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Acceptance run timing is given as fall in the interview and October 2026 in the memo; not yet done. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Interview mentions only the wear drift, the memo quantifies it. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Internal edge estimation is untested. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: force map | applied | none |  | Concept absent. |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept absent. |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Concept absent. |
| 242 | Glossary Term: edge radius window | not_applied | none |  | P4 names the window in other words.; found on the final text |
| 242 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 242 | Cover signed-off Summary item h57qn51sjz83rt0tx50mvdw1as8h3avd | applied | none |  | P1 says the company designs and builds finishing cells. |
| 242 | Cover signed-off Summary item h57t2jefv5k08hchx7ght9t56n8h354m | applied | none |  | P1 lists grinding, sanding, polishing, deburring, aerospace. |
| 242 | Cover signed-off Summary item h57hxpxmx8gpq1xg1dm5z57q718h2abg | applied | none |  | P2 states the fixed-force over-rounding and burr issue. |
| 242 | Cover signed-off Summary item h57v53axrb7hygwvqn06pbrfbd8h2sb3 | applied | none |  | P1 says the team sought to learn the estimate could meet limits. |
| 242 | Cover signed-off Summary item h57v5e9tgh6ter9ekpqb9xetan8h22de | applied | none | 2 | P4 covers per-edge force holding 0.2 to 0.5 mm radius. |
| 242 | Cover signed-off Summary item h57j5wa9ptd2ebt6xj5evdjr6s8h2ac4 | applied | none | 2 | P4 covers 0.1 mm RMS and under 120 ms per edge. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P2 says "A full scan of one bracket takes about 90 seconds, too long for a 4-minute cycle", but the sources say "a full scan of one bracket takes about 90 seconds, and the customer's takt time is 4 minutes per bracket total". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether burr height could be estimated from 2D images accurately and fast enough for per-edge..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 665/700 words, 60/100 lines |
| 244 | Claim Exclusion: New product line and commercial benefits are business outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer acceptance run is planned after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Internal edge and next bracket family work is planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Reusing two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Using the previous or higher force on short edges is a routine operating rule. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches the Storyline. |
| 244 | Confidence Map: Two-angle vision result is reported consistently in the interview. | applied | none |  | Established result stated firmly. |
| 244 | Confidence Map: Memo reports the same vision result independently. | applied | none |  | Established result stated firmly. |
| 244 | Confidence Map: Test 5 result met the hypothesis, but on a single run of 360 brackets. | applied | none |  | P8 hedges with 'In this single run'.; repaired, and checked again on the final text |
| 244 | Confidence Map: Acceptance run timing is given as fall in the interview and October 2026 in the memo; not yet done. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Interview mentions only the wear drift, the memo quantifies it. | applied | none |  | Wear drift matches the memo figure. |
| 244 | Confidence Map: Internal edge estimation is untested. | applied | none |  | Not mentioned in the section. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status is absent. |
| 244 | Cover signed-off Summary item h57mbkh93f11r99897n3r0xkzn8h3qn1 | applied | none |  | P1 states the plan and the steps. |
| 244 | Cover signed-off Summary item h57v4hd32kpcn3g0pa6z8a3w758h2f3x | applied | none |  | P2 states the hypothesis. |
| 244 | Cover signed-off Summary item h57t1nskbyyzvtbhwvkh6am60x8h3vma | applied | none |  | P4 gives 0.18 mm RMS at about 210 ms. |
| 244 | Cover signed-off Summary item h57vp1qtshyfe60es7b76jtxcn8h2ybf | applied | none |  | P5 gives 0.2 mm depth and a return to 2D. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P8 says "with it, rejects were 2.4 percent with no drift trend over 240 brackets.", but the sources say "Over 240 brackets the reject rate stayed at 2.4 percent, with no drift trend across the run.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work answers stated uncertainties or 246 items. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 8 (sections 244, 246): Line 244 P8 reports a later run with 97.8 percent of edges in the window and 2.6 percent rejects (and 2.4 percent over 240 brackets), meeting the 97 percent and 3 percent targets. Line 246 P1 says the second half of the hypothesis was not proven and gives only the 96.1 percent first run, so the two sections disagree on whether the force half was met. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 8 (sections 244): P8 says a second pass on 40 brackets gave 3.9 percent rejects, so slower feed worked better, but Test 5 already cut feed to 25 mm/s and gave 2.6 percent. The sentence is internally inconsistent about what the 3.9 percent run showed. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 8 (sections 244): The reference coupon paragraph says radius drifted smaller over about 150 brackets without correction, yet the cycle time and reject figures are given as single-run values; also 'no drift trend' over 240 brackets is stated with the 2.4 percent reject rate that differs from the 2.6 percent Test 5 result for the same configuration. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 318/350 words, 29/50 lines |
| 246 | Claim Exclusion: New product line and commercial benefits are business outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer acceptance run is planned after the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Internal edge and next bracket family work is planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Reusing two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Using the previous or higher force on short edges is a routine operating rule. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Two-angle vision result is reported consistently in the interview. | applied | none |  | Vision result stated firmly, as allowed. |
| 246 | Confidence Map: Memo reports the same vision result independently. | applied | none |  | Vision result stated firmly, as allowed. |
| 246 | Confidence Map: Test 5 result met the hypothesis, but on a single run of 360 brackets. | applied | none |  | Test 5 not mentioned. |
| 246 | Confidence Map: Acceptance run timing is given as fall in the interview and October 2026 in the memo; not yet done. | applied | none |  | Acceptance run not mentioned. |
| 246 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | P3 says alloy transfer is unresolved. |
| 246 | Confidence Map: Interview mentions only the wear drift, the memo quantifies it. | applied | none |  | Wear not mentioned. |
| 246 | Confidence Map: Internal edge estimation is untested. | applied | none |  | P3 says internal edges remain untested. |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item h57sre67kmbpa6yk590d5dgepx8h34t2 | applied | none |  | P1 states 0.07 mm RMS at 95 ms meeting targets. |
| 246 | Cover signed-off Summary item h57j77n8d6hg95nvxpjxv2ncx98h34r3 | applied | none | 2 | P2 covers two-angle differencing and the 3D camera. |
| 246 | Cover signed-off Summary item h57rh1nc3x888y7xnvt82y5d1s8h3cj2 | applied | none | 2 | P2 gives single-angle 0.18 mm RMS at 210 ms. |
| 246 | Cover signed-off Summary item h57m212zmppdfwn2dqkayr47tx8h2phk | applied | none |  | P3 states internal edges are untested. |
| 246 | Cover signed-off Summary item h57j0d8d2yja0bwk3jn4rvb4fh8h264m | applied | none |  | P4 states what the team learned. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Claims answer stated uncertainties. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 3 (sections 244, 246): Internal edge work is planned for fiscal 2027 per the Brief, but Line 246 P3 presents internal edge burr estimation as an untested item of the claimed project, with other alloys and bracket designs. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): Line 246 P3 says the two-angle method relies on a straight-on view, but Line 244 P6 describes shots at 15 and 60 degrees, which are not straight-on. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 5 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 21.
- Line 244: 0 labels and 0 plan checks "Not checked" of 18.
- Line 246: 0 labels and 0 plan checks "Not checked" of 19.

## Seed-stage numbers

- Requests: 16 metered (14 Batch, 2 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.7 s, p95 13.9 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.2 s, p95 12.2 s over 1.
- Sign-off to report created: 99.1 s.
- Cost from aiUsage: $1.37 in all ($0.49 seed stage, $0.88 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T19:14:20.150Z created project k975rqtqwfrgga5heqafd75tgh8h2akm
2026-10-27T19:14:21.379Z marked as an evaluation project
2026-10-27T19:14:22.493Z added document deburring-test-memo.md
2026-10-27T19:14:24.474Z started Step by step generation k57bqhk2jmqwd8d662sxnbf3d58h3cts
2026-10-27T19:14:39.893Z seed stage open
2026-10-27T19:14:39.893Z Open Company / Context and wait for its Batch
2026-10-27T19:14:48.124Z Company / Context: select the first Seed
2026-10-27T19:14:50.861Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-27T19:14:59.277Z kept Feedback returned 1 Revised Seed(s)
2026-10-27T19:14:59.277Z Company / Context: select the first Revised Seed and untick the original
2026-10-27T19:15:03.888Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-27T19:15:12.270Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-27T19:15:12.270Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-27T19:15:14.090Z Approve Company / Context
2026-10-27T19:15:16.835Z approved company_context
2026-10-27T19:15:16.836Z Open Goal / Problem and wait for its Batch
2026-10-27T19:15:25.357Z Goal / Problem: select the first Seed
2026-10-27T19:15:28.072Z Approve Goal / Problem
2026-10-27T19:15:30.826Z approved goal_problem
2026-10-27T19:15:30.826Z Open Technological limitations and wait for its Batch
2026-10-27T19:15:40.652Z Technological limitations: select the first Seed
2026-10-27T19:15:43.874Z Approve Technological limitations
2026-10-27T19:15:47.173Z approved passive_limitations
2026-10-27T19:15:47.176Z Open Technological objectives and wait for its Batch
2026-10-27T19:15:55.589Z Technological objectives: select the first Seed
2026-10-27T19:15:58.278Z Approve Technological objectives
2026-10-27T19:16:01.048Z approved technological_objective
2026-10-27T19:16:01.049Z Open Technological uncertainties and wait for its Batch
2026-10-27T19:16:18.020Z Technological uncertainties: select the first 2 Seeds
2026-10-27T19:16:22.852Z Approve Technological uncertainties
2026-10-27T19:16:25.878Z approved active_uncertainties
2026-10-27T19:16:25.878Z Skip Previous-year status
2026-10-27T19:16:27.767Z Open Work plan and wait for its Batch
2026-10-27T19:16:42.750Z Work plan: select the first Seed
2026-10-27T19:16:46.342Z Approve Work plan
2026-10-27T19:16:49.251Z approved workplan
2026-10-27T19:16:49.251Z Open Hypothesis and wait for its Batch
2026-10-27T19:16:58.577Z Hypothesis: select the first Seed
2026-10-27T19:17:01.337Z Approve Hypothesis
2026-10-27T19:17:04.694Z approved hypothesis
2026-10-27T19:17:04.694Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T19:17:13.397Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T19:17:18.208Z Approve Experimentation / Iterations
2026-10-27T19:17:21.368Z approved experimentation
2026-10-27T19:17:21.369Z Open Advancement to science / technology and wait for its Batch
2026-10-27T19:17:33.552Z Advancement to science / technology: select the first Seed
2026-10-27T19:17:36.350Z Approve Advancement to science / technology
2026-10-27T19:17:39.107Z approved overall_advancement
2026-10-27T19:17:39.107Z Open Specific technological advancements and wait for its Batch
2026-10-27T19:17:50.543Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T19:17:59.753Z Approve Specific technological advancements
2026-10-27T19:18:02.734Z approved specific_advancements
2026-10-27T19:18:02.734Z Open Project status and next steps and wait for its Batch
2026-10-27T19:18:13.012Z Project status and next steps: select the first Seed
2026-10-27T19:18:15.704Z Approve Project status and next steps
2026-10-27T19:18:18.396Z approved project_status
2026-10-27T19:18:18.396Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T19:18:26.885Z Overall company / project goal improvements: select the first Seed
2026-10-27T19:18:29.612Z Approve Overall company / project goal improvements
2026-10-27T19:18:32.556Z approved goal_improvements
2026-10-27T19:18:32.557Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T19:18:34.466Z signed off; waiting for the report
2026-10-27T19:20:14.639Z report kd70r723kcmqe9bn8bxt37q9fd8h2tsa created
```
