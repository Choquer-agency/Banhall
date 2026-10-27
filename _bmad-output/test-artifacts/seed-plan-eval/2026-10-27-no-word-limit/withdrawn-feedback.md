# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-10-27 on `local` at commit `df6eb97b`, acting as chat-live-1793085355051@example.test. Project `k97c8bcmp4ytag350b1vr49we58h2hgj`, generation `k57c5w8m9gprqf8kxt3yppxftn8h28wx`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd74a99d6d9swxsp5krdxz75sn8h2pwm |
| All three Sections were drafted | pass | 242: 321 words, 244: 700 words, 246: 325 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED; hypothesis prefetch: INVALID_OUTPUT, answer 1: 1 of 1 valid, needed 3 (INVALID_PROVENANCE x1, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 1 of 1 valid, needed 3 (INVALID_PROVENANCE x1, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work ties to Line 242 uncertainties and Line 246 items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Its work integrating industrial arms with its..."); 244: not_applied ("P3 says "This confirmed that one force cannot serve both burr extremes", but the sources say "So fixed force was worse than hand deburring."."); 246: applied ("The facts check found no figure or detail it could show differs from the sources.") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (8.2 s, 6.8 s); 244: 2 requests (7.0 s, 7.2 s); 246: 2 requests (7.6 s, 7.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 18 metered calls (16 Batch, 2 Feedback), 19 reserved; notice not shown; 1 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 13 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 3 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds robotic finishing cells for aerospace and medical parts. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The goal is to deburr cast aluminium brackets automatically inside the customer's 4 minute cycle. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- A fixed path at fixed force over-rounds small burrs or leaves large ones. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether burr height can be estimated from 2D images accurately and fast enough. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- Nobody had estimated burr height from 2D images on cast aluminium, so accuracy and speed were unknown. _(writer-asserted)_
- The burr shows as a small shadow or bright line depending on lighting angle. / The link to actual height depends on burr shape, which varies. _(writer-asserted)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a fixed-force baseline first, then a vision estimate checked against a laser profiler. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If burr height is estimated within 0.1 mm RMS in under 120 ms per edge, rejects fall below 3 percent. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Single-angle vision gave 0.18 millimetres RMS at about 210 milliseconds per edge, missing both targets. _(cited)_
  - Tested: uncertainty "Nobody had estimated burr height from 2D images on cast aluminium, ..."
- Specular reflection on machined faces made some burrs look taller, with 31 of 400 edges overestimated by more than 0.4 mm. / Two-angle differencing removed that failure. _(cited)_
  - Tested: uncertainty "The burr shows as a small shadow or bright line depending on lighti..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Two-angle imaging cut error to 0.07 millimetres RMS and processing to 95 milliseconds per edge. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Specular reflection on machined faces was the main cause of single-angle burr height error. _(cited)_
  - Links: uncertainty "The burr shows as a small shadow or bright line depending on lighti..."; experiments "Specular reflection on machined faces made some burrs look taller, ..."
- Two-angle differencing separates burr shadow from face reflection and removed that failure. _(cited)_
  - Links: uncertainty "The burr shows as a small shadow or bright line depending on lighti..."; experiments "Specular reflection on machined faces made some burrs look taller, ..."

### 12. Project status and next steps (Section 246, standard): approved

- Whether transfer to other alloys works without redoing the whole force map is untested. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Two-angle imaging cut error to 0.07 millimetres RMS, inside the 0.1 millimetre goal. / Processing took 95 milliseconds per edge, under the 120 millisecond target. _(cited)_

## Drafted Sections

### Line 242

Burr height on cast A357 aluminium could not be reliably estimated from fast 2D images, and no stable relationship was known between that height and the contact force needed to hold edge radius. The company designs and builds robotic finishing cells for aerospace and medical parts. It set out to build a robotic cell that deburrs cast aluminium brackets automatically inside the customer's 4-minute cycle. The company integrates industrial arms with its own tooling, fixturing and control software.

The limitations to standard practice were that the knowledge required to control edge radius on cast A357 brackets was insufficient. A fixed path at fixed force over-rounds small burrs or leaves large ones: a force high enough to remove a 1.2 mm burr over-rounds edges that had only 0.1 mm. No documented model related a given burr height and force to a resulting edge radius. Full 3D laser scanning gives burr height but takes about 90 seconds per bracket, too long for the cycle.

The technological objective was to advance the understanding of whether burr height on cast aluminium can be estimated from 2D images accurately and fast enough. It also sought to understand how that height relates to compliant spindle force. The purpose was to create an adaptive robotic deburring cell that holds edge radius at 0.2 to 0.5 mm within a 4-minute cycle.

It was uncertain whether burr height could be estimated from 2D images with enough accuracy and speed on cast aluminium, because nobody had done this on a surface that is shiny in places and dull in others, with burrs small relative to the part. The burr shows as a small shadow or bright line depending on lighting angle. It was also uncertain whether that appearance could be linked to actual height, because the link depends on burr shape, which varies. Whether a stable relationship existed between burr height and compliant spindle force, despite casting variation, also remained open.

### Line 244

The technological problem was whether burr height on cast A357 brackets could be estimated from fast 2D images, and whether that estimate could set a contact force on the compliant spindle that holds edge radius at 0.2 to 0.5 mm. The team planned a fixed-force baseline first, then a vision estimate checked against a laser profiler. Each step answered one uncertainty from Line 242. The baseline measured the limit of standard practice. The profiler comparison tested estimation accuracy and speed. Later force-map trials tested the height-to-force relationship. All work ran in the Bay 4 pilot cell on brackets from three casting lots.

It was hypothesized that if burr height were estimated within 0.1 mm RMS in under 120 ms per edge, and the compliant spindle force were set from that estimate, then edge radius would stay within 0.2 to 0.5 mm on at least 97 percent of edges and the reject rate would fall below 3 percent within a 4-minute cycle. A miss on either estimation target, or a force relationship too unstable to control, would disprove it.

The company first needed a baseline, because it was unknown how a fixed force would perform on casting variation. It ran 120 brackets with the compliant spindle at a fixed 20 N on a fixed path. Cycle time was 3 min 10 s, but 14 percent of brackets were rejected. About two thirds of the rejects were leftover burrs on high-burr edges. The rest were edges over-rounded beyond 0.5 mm where burrs were small. This confirmed that one force cannot serve both burr extremes, so per-edge force needed a burr height estimate.

Nobody had estimated burr height from 2D images on cast aluminium, so accuracy and speed were unknown. The company imaged 400 edges with one 12 MP camera and a low-angle ring light, and compared each estimate with a laser profiler reference. Single-angle vision gave 0.18 mm RMS at about 210 ms per edge, missing both targets. Specular reflection on machined faces made some burrs look taller, and 31 of 400 edges were overestimated by more than 0.4 mm. A borrowed structured light 3D camera was then tried. Its depth resolution was about 0.2 mm at roughly 400 ms per capture, so work returned to 2D imaging.

The burr shows as a small shadow or bright line depending on lighting angle, and its link to actual height depends on burr shape, which varies. The company therefore took two shots per edge with lights at 15 and 60 degrees and applied two-angle differencing. It cropped each image around the edge from the CAD path and processed it on a GPU. On the same 400 edges, error fell to 0.07 mm RMS at 95 ms per edge, meeting both targets. The worst single-edge error was 0.19 mm. Two-angle differencing removed the reflection failure.

Whether a stable relationship existed between burr height and force was still unknown. The company cut 60 coupons from scrap brackets with burrs of 0.1 to 1.2 mm, applied forces of 8 to 40 N, and measured the resulting radius. The relationship was non-linear: about 10 to 22 N covered burrs of 0.1 to about 0.6 mm, then about 34 N was needed at 1.2 mm. A lookup table built from this force map, run on 300 brackets, gave 4.3 percent rejects, 96.1 percent of edges in window and 3 min 50 s. Most rejects were on 2.5 mm thin flanges. Above about 28 N the flange flexed and the compliant spindle chattered.

Raising force on thin flanges failed, so the company capped force at 26 N and slowed feed from 40 to 25 mm/s. A second pass on 40 brackets gave 3.9 percent rejects. On 360 brackets with slower feed, chatter disappeared, with 2.6 percent rejects, 97.8 percent of edges in window and 3 min 58 s. Force had to be traded for dwell time on thin walls.

Finally, over about 150 brackets, the removal rate of the compliant spindle dropped as the abrasive wore, and radius drifted smaller. Every 25 brackets, the cell deburred and imaged a reference coupon and scaled the force map up. With this correction, 240 brackets gave 2.4 percent rejects and no drift trend.

### Line 246

Our objective was to learn whether burr height on cast A357 aluminium can be estimated from fast 2D images, and whether that estimate can set contact force on the compliant spindle. The hypothesis was partly proven. Two-angle imaging cut error to 0.07 mm RMS and processing to 95 ms per edge, inside the 0.1 mm and 120 ms targets. The force relationship was mapped, but the full reject and edge-window targets were reached only after further changes.

Through systematic investigation, we found that specular reflection on machined faces was the main cause of single-angle burr height error. The burr shows as a small shadow or bright line depending on lighting angle, and its link to actual height depends on burr shape, which varies. Reflection made some burrs look taller: 31 of 400 edges were overestimated by more than 0.4 mm. We established that two-angle differencing separates burr shadow from face reflection and removed that failure. This resolved the uncertainty regarding whether 2D estimation could be accurate and fast enough on shiny cast aluminium. Based on this understanding, we used lights at 15 and 60 degrees with GPU processing to feed the force map.

The cell remains at pilot stage. Whether the method transfers to other alloys without redoing the whole force map is untested. We built the force map on A357, and removal behaviour at a given force is expected to depend on the material. We plan to assess how much of the existing map carries over before any new mapping.

The knowledge gained moves the project toward its goal of a robotic cell that deburrs cast brackets to a 0.2 to 0.5 mm edge radius within a 4-minute cycle. Two-angle imaging gave burr height at 0.07 mm RMS, inside the 0.1 mm goal. Processing took 95 ms per edge, under the 120 ms target, and replaced a 90-second laser scan. Force can now be set per edge rather than fixed for the whole path.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 321/350 words, 30/50 lines |
| 242 | Claim Exclusion: Customer purchase commitment and new product line are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reuse of two-angle imaging in a polishing quote is commercial work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Internal edges and transfer to other alloys are planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Short-edge rule of reusing the previous or higher force is a routine design choice. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Test 3 vision results are reported consistently in the interview and memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Test 5 result. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Reject target met in tests 5 and 6 but only at pilot scale, and the cycle margin is thin. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Memo lists A356 and titanium as transfer targets, while the interview does not name them. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Acceptance run timing differs: the interview says fall, the memo says October 2026. These are compatible, not in conflict. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: force map | applied | none |  | Concept absent. |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept absent. |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 242 | Cover signed-off Summary item h57qkhwq1x798zrsyjysv1jw0s8h3m26 | applied | none |  | P1 states the company context. |
| 242 | Cover signed-off Summary item h57x8vce8cz1sjg97tf1ne4tmh8h2sbx | applied | none |  | P1 states the goal. |
| 242 | Cover signed-off Summary item h57k1qaxvk0jayezsffctmdcv58h22g5 | applied | none |  | P2 covers fixed path over-rounding. |
| 242 | Cover signed-off Summary item h57w7g5qwrx5wzqg61rgts3jwh8h3j0z | applied | none |  | P3 states the objective. |
| 242 | Cover signed-off Summary item h57m4sp306200h93q9ea3dtq0n8h2q4t | applied | none | 2 | P4 covers the 2D estimate uncertainty. |
| 242 | Cover signed-off Summary item h57r25v19650je95vtwkwdrhys8h300e | applied | none | 2 | P4 covers shadow and shape dependence. |
| 242 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Its work integrating industrial arms with its own tooling, fixturing and control software gave it direct experience", but the sources say "We integrate industrial arms with our own tooling, fixturing and control software.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company designs and builds robotic finishing cells for aerospace and medical parts." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The goal is to deburr cast aluminium brackets automatically inside the customer's 4 minute cycle." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 700/700 words, 62/100 lines |
| 244 | Claim Exclusion: Customer purchase commitment and new product line are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reuse of two-angle imaging in a polishing quote is commercial work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Internal edges and transfer to other alloys are planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Short-edge rule of reusing the previous or higher force is a routine design choice. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Test 3 vision results are reported consistently in the interview and memo. | applied | none |  | Test 2 figures match the sources. |
| 244 | Confidence Map: Test 5 result. | applied | none |  | Test 5 result stated as the sources give it. |
| 244 | Confidence Map: Reject target met in tests 5 and 6 but only at pilot scale, and the cycle margin is thin. | applied | none |  | No claim of scale-up beyond pilot. |
| 244 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Memo lists A356 and titanium as transfer targets, while the interview does not name them. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Acceptance run timing differs: the interview says fall, the memo says October 2026. These are compatible, not in conflict. | applied | none |  | Not mentioned in the section. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status in the section. |
| 244 | Cover signed-off Summary item h57tp6c9myw1hyzzvfbybdzew58h2596 | applied | none |  | Baseline then vision check against profiler is stated. |
| 244 | Cover signed-off Summary item h57tm2bj0myw5gs1cydnpk12y98h2152 | applied | none |  | Hypothesis with targets stated. |
| 244 | Cover signed-off Summary item h57sm5zn20rk3efy3hawv67sk58h2wft | applied | none |  | Single-angle 0.18 mm, 210 ms, missed targets. |
| 244 | Cover signed-off Summary item h57vvwq3enm88257g69dq43na58h2837 | applied | none |  | Reflection failure and two-angle differencing covered. |
| 244 | State figures and details as the sources give them | not_applied | none |  | P3 says "This confirmed that one force cannot serve both burr extremes", but the sources say "So fixed force was worse than hand deburring.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work ties to Line 242 uncertainties and Line 246 items. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a fixed-force baseline first, then a vision estimate checked against a laser profiler." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 325/350 words, 30/50 lines |
| 246 | Claim Exclusion: Customer purchase commitment and new product line are commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reuse of two-angle imaging in a polishing quote is commercial work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Internal edges and transfer to other alloys are planned for fiscal 2027. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Short-edge rule of reusing the previous or higher force is a routine design choice. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Test 3 vision results are reported consistently in the interview and memo. | applied | none |  | Test 3 figures match. |
| 246 | Confidence Map: Test 5 result. | applied | none |  | Not contradicted. |
| 246 | Confidence Map: Reject target met in tests 5 and 6 but only at pilot scale, and the cycle margin is thin. | applied | none |  | P1 says targets reached only after further changes. |
| 246 | Confidence Map: Transfer to other alloys is untested. | applied | none |  | P3 says transfer is untested. |
| 246 | Confidence Map: Memo lists A356 and titanium as transfer targets, while the interview does not name them. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Acceptance run timing differs: the interview says fall, the memo says October 2026. These are compatible, not in conflict. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item h57ydqsv4dm283vq69rr90a0hd8h3rgw | applied | none |  | P1 states 0.07 mm RMS and 95 ms. |
| 246 | Cover signed-off Summary item h57xtdg24kx55apdbs3tpa2dxn8h3t1v | applied | none | 2 | P2 gives reflection cause and burr appearance. |
| 246 | Cover signed-off Summary item h57xbne26k2xhwvnkrc42sdfdd8h2nej | applied | none | 2 | P2 states differencing removed failure. |
| 246 | Cover signed-off Summary item h57ktvf81f1gaegh57m88gc6es8h3f5n | applied | none |  | P3 states transfer untested. |
| 246 | Cover signed-off Summary item h57zzfv257k2jk98m4bw34nr1d8h3n95 | applied | none |  | P4 compares with 0.1 mm and 120 ms. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancements answer Line 242 uncertainties. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the full reject and edge-window targets were reached only after further changes, which fits Line 244. But the same paragraph calls the hypothesis partly proven, while Line 244 P7 and P8 show the reject (under 3 percent) and 97 percent window targets were met. This is a weak conflict; the main point is the partial-proof wording against the final results. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): Line 246 says 95 ms processing replaced a 90-second laser scan. Line 244 compared against a laser profiler reference and never used a 90-second scan as the replaced step. Line 242 gives the 90 s figure for full 3D scanning, so the statement is consistent there; check the wording only. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 2 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 19.
- Line 244: 0 labels and 0 plan checks "Not checked" of 17.
- Line 246: 0 labels and 0 plan checks "Not checked" of 18.

## Seed-stage numbers

- Requests: 18 metered (16 Batch, 2 Feedback); 19 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.3 s, p95 10.9 s over 16 Batch(es).
- Foreground dispatch to first render (script-observed): median 9.3 s, p95 9.3 s over 1.
- Sign-off to report created: 86.8 s.
- Cost from aiUsage: $1.22 in all ($0.47 seed stage, $0.75 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T20:52:46.418Z created project k97c8bcmp4ytag350b1vr49we58h2hgj
2026-10-27T20:52:47.465Z marked as an evaluation project
2026-10-27T20:52:48.447Z added document deburring-test-memo.md
2026-10-27T20:52:51.147Z started Step by step generation k57c5w8m9gprqf8kxt3yppxftn8h28wx
2026-10-27T20:53:04.453Z seed stage open
2026-10-27T20:53:04.454Z Open Company / Context and wait for its Batch
2026-10-27T20:53:10.319Z Company / Context: select the first Seed
2026-10-27T20:53:13.301Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-27T20:53:22.753Z kept Feedback returned 1 Revised Seed(s)
2026-10-27T20:53:22.753Z Company / Context: select the first Revised Seed and untick the original
2026-10-27T20:53:27.667Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-27T20:53:36.668Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-27T20:53:36.669Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-27T20:53:38.552Z Approve Company / Context
2026-10-27T20:53:41.427Z approved company_context
2026-10-27T20:53:41.427Z Open Goal / Problem and wait for its Batch
2026-10-27T20:53:50.010Z Goal / Problem: select the first Seed
2026-10-27T20:53:52.850Z Approve Goal / Problem
2026-10-27T20:53:55.898Z approved goal_problem
2026-10-27T20:53:55.898Z Open Technological limitations and wait for its Batch
2026-10-27T20:54:05.089Z Technological limitations: select the first Seed
2026-10-27T20:54:08.034Z Approve Technological limitations
2026-10-27T20:54:10.953Z approved passive_limitations
2026-10-27T20:54:10.953Z Open Technological objectives and wait for its Batch
2026-10-27T20:54:20.001Z Technological objectives: select the first Seed
2026-10-27T20:54:23.205Z Approve Technological objectives
2026-10-27T20:54:26.130Z approved technological_objective
2026-10-27T20:54:26.130Z Open Technological uncertainties and wait for its Batch
2026-10-27T20:54:35.994Z Technological uncertainties: select the first 2 Seeds
2026-10-27T20:54:41.132Z Approve Technological uncertainties
2026-10-27T20:54:44.705Z approved active_uncertainties
2026-10-27T20:54:44.706Z Skip Previous-year status
2026-10-27T20:54:47.199Z Open Work plan and wait for its Batch
2026-10-27T20:55:01.381Z Work plan: select the first Seed
2026-10-27T20:55:04.468Z Approve Work plan
2026-10-27T20:55:07.861Z approved workplan
2026-10-27T20:55:07.861Z Open Hypothesis and wait for its Batch
2026-10-27T20:55:17.132Z hypothesis: attempt failed, Retry 1
2026-10-27T20:55:31.450Z Hypothesis: select the first Seed
2026-10-27T20:55:35.134Z Approve Hypothesis
2026-10-27T20:55:38.905Z approved hypothesis
2026-10-27T20:55:38.906Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T20:55:47.057Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T20:55:52.458Z Approve Experimentation / Iterations
2026-10-27T20:55:55.745Z approved experimentation
2026-10-27T20:55:55.745Z Open Advancement to science / technology and wait for its Batch
2026-10-27T20:56:11.172Z Advancement to science / technology: select the first Seed
2026-10-27T20:56:14.234Z Approve Advancement to science / technology
2026-10-27T20:56:17.622Z approved overall_advancement
2026-10-27T20:56:17.623Z Open Specific technological advancements and wait for its Batch
2026-10-27T20:56:27.750Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T20:56:36.511Z Approve Specific technological advancements
2026-10-27T20:56:39.598Z approved specific_advancements
2026-10-27T20:56:39.598Z Open Project status and next steps and wait for its Batch
2026-10-27T20:56:48.550Z Project status and next steps: select the first Seed
2026-10-27T20:56:51.868Z Approve Project status and next steps
2026-10-27T20:56:55.003Z approved project_status
2026-10-27T20:56:55.004Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T20:57:09.711Z Overall company / project goal improvements: select the first Seed
2026-10-27T20:57:12.536Z Approve Overall company / project goal improvements
2026-10-27T20:57:15.372Z approved goal_improvements
2026-10-27T20:57:15.372Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T20:57:17.266Z signed off; waiting for the report
2026-10-27T20:58:45.379Z report kd74a99d6d9swxsp5krdxz75sn8h2pwm created
```
