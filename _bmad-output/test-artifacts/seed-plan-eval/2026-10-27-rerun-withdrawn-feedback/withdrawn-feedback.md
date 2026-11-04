# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k97c76fd6tt0dh8r8y118y3vfh8h3b62`, generation `k57e91r8gmme0d2sxzaw4845t58h3mn4`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd71486m692ky6wsj959hcbwjx8h3wws |
| All three Sections were drafted | pass | 242: 336 words, 244: 689 words, 246: 301 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work answers stated uncertainties."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "and ran a pilot cell on A357 brackets that mu..."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: applied ("The facts check found no figure or detail it could show differs from the sources.") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (8.2 s, 7.7 s); 244: 1 request (5.7 s); 246: 2 requests (7.5 s, 6.4 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 18 metered calls (16 Batch, 2 Feedback), 19 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 4 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds robotic finishing cells for aerospace and medical parts. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company wants to sell adaptive deburring cells that replace manual deburring of cast aluminium aerospace brackets. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- A fixed-path, fixed-force cell either leaves burrs or over-rounds edges when burr height varies from 0.1 to 1.2 mm. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether burr height can be estimated from 2D images accurately and fast enough per edge. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- Whether burr height could be estimated from 2D images to 0.1 mm RMS in under 120 ms per edge was unknown. _(writer-asserted)_
- The surface is shiny in places and dull in others, and the burr is small compared to the part. / The link between image and height depends on burr shape, which varies, so it could not be pinned down on paper. _(writer-asserted)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a baseline at fixed force, then a vision check against a laser profiler. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If burr height per edge is estimated from 2D images to within 0.1 mm RMS in under 120 ms, then edge radius can be controlled. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The single-angle camera with a low-angle ring light gave 0.18 millimetres RMS at about 210 milliseconds per edge, missing both targets. _(cited)_
  - Tested: uncertainty "Whether burr height could be estimated from 2D images to 0.1 mm RMS..."
- Reflections on machined faces made some burrs look much taller than they were, so the single-angle setup failed. / In test 2, 31 of 400 edges were overestimated by more than 0.4 mm. _(cited)_
  - Tested: uncertainty "The surface is shiny in places and dull in others, and the burr is ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Two-angle differencing reached 0.07 millimetres RMS at 95 milliseconds per edge, meeting both vision targets. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Single-angle lighting failed because specular reflection on machined faces inflated apparent burr height. _(writer-asserted)_
  - Links: uncertainty "The surface is shiny in places and dull in others, and the burr is ..."; experiments "Reflections on machined faces made some burrs look much taller than..."
- In test 2, 31 of 400 edges were overestimated by more than 0.4 mm, all on machined faces. _(writer-asserted)_
  - Links: uncertainty "The surface is shiny in places and dull in others, and the burr is ..."; experiments "Reflections on machined faces made some burrs look much taller than..."

### 12. Project status and next steps (Section 246, standard): approved

- The team still runs parts in the Bay 4 pilot cell and has not shipped a production cell. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Whether burr height could be estimated from 2D images was answered: error dropped to 0.07 millimetres RMS and processing to 95 milliseconds per edge. _(cited)_

## Drafted Sections

### Line 242

The limitations to standard practice were that the knowledge needed to estimate burr height on cast aluminium from 2D images was insufficient, and it was unknown whether such an estimate could be fast and accurate enough for per-edge control. The company designs and builds robotic finishing cells for aerospace and medical parts. It wants to sell adaptive deburring cells that replace manual deburring of cast aluminium aerospace brackets. Customer requirements are an edge radius of 0.2 to 0.5 mm on every edge, no residual burr, and a total cycle under 4 minutes per bracket. Its engineers integrate industrial arms with in-house tooling, fixturing and control software, and ran a pilot cell on A357 brackets.

A fixed-path, fixed-force cell either leaves burrs or over-rounds edges when burr height varies from 0.1 to 1.2 mm, and no documented model linked burr size, contact force and resulting radius. A full 3D laser scan takes about 90 seconds per bracket and touch probing is too slow, so no established method gave burr height within the cycle. No documented method existed for estimating burr height from 2D images on cast aluminium.

The technological objective was to advance the understanding of whether burr height can be estimated from 2D images accurately and fast enough per edge, and of how that height relates to compliant spindle force, for the purposes of creating a robotic deburring cell that holds edge radius at 0.2 to 0.5 mm.

Whether burr height could be estimated from 2D images to 0.1 mm RMS in under 120 ms per edge was unknown. This was uncertain because the cast surface is shiny in places and dull in others, and the burr is small compared to the part. The link between image appearance and height also depends on burr shape, which varies, so it could not be pinned down on paper. It was further uncertain whether per-edge force changes on the compliant spindle would hold radius across casting variation, because thin walls flex under load and abrasive wear changes removal rate.

### Line 244

Whether burr height on cast A357 aluminium could be estimated from 2D images to 0.1 mm RMS in under 120 ms per edge, and whether per-edge force on the compliant spindle would hold edge radius at 0.2 to 0.5 mm, remained unresolved. The team planned a baseline at fixed force, then a vision check against a laser profiler. A force map from burr height to compliant spindle force followed, tested on real brackets, then longer trials for casting variation and abrasive wear. The work ran in the Bay 4 pilot cell, using 1,200 brackets from three casting lots supplied by the customer.

It was hypothesized that if burr height per edge is estimated from 2D images to within 0.1 mm RMS in under 120 ms, then edge radius can be controlled. Specifically, a force map built from that estimate would place at least 97 percent of edges within the 0.2 to 0.5 mm window and hold rejects under 3 percent within a 4-minute cycle. Any result missing these thresholds would disprove it.

The first question was what a fixed-force cell achieves, as a reference for later tests. The team ran 120 brackets at a fixed 20 N on a fixed path. Cycle time was 3:10, but 14 percent of brackets were rejected, about two thirds for leftover burrs on high-burr edges and the rest for edges over-rounded above 0.5 mm. Fixed force therefore did worse than the manual process. This confirmed that force had to follow burr height edge by edge.

The next question was whether a single 2D camera could meet the accuracy and speed targets. The team used one 12 MP camera with a low-angle ring light on 400 edges and compared it with a laser profiler reference. The single-angle camera gave 0.18 mm RMS at about 210 ms per edge, missing both targets. Reflections on machined faces made some burrs look much taller than they were, so the single-angle setup failed. In test 2, 31 of 400 edges were overestimated by more than 0.4 mm. The cause was specular reflection that the camera could not separate from burr shadow; this ruled out single-angle lighting.

The team then asked whether a 3D camera would avoid the reflection problem. A structured light 3D camera was borrowed for two weeks. Depth resolution was about 0.2 mm at working distance and each capture took about 400 ms, so it was no better than 2D and slower. The team set it aside and returned to improving 2D imaging.

In test 3 the team tried two-angle differencing, taking two shots per edge with light at 15 and 60 degrees, because burr shadow and flat-face reflection change differently with angle. Processing moved to the GPU on a region cropped around each edge from the CAD path. On the same 400 edges, error fell to 0.07 mm RMS at 95 ms per edge, meeting both targets.

The team next asked what force each burr height requires. Sixty coupons cut from scrap brackets, with burrs of 0.1 to 1.2 mm, were swept at 8 to 40 N and the radius measured. The relationship was non-linear: about 10 to 22 N for burrs up to about 0.6 mm, then steeper to about 34 N at 1.2 mm. A lookup table run on 300 brackets gave 4.3 percent rejects, 96.1 percent of edges in window and a 3:50 cycle. Most rejects were on 2.5 mm flanges, which flexed above about 28 N, lost contact and chattered. Force alone could not be raised on thin walls.

Tests 5 and 6 addressed chatter and abrasive wear. Capping force at 26 N with feed slowed from 40 to 25 mm/s removed chatter and beat a second pass, which gave 3.9 percent rejects on 40 brackets. Across 360 brackets from the second and third lots, rejects were 2.6 percent, 97.8 percent of edges were in window, and cycle time was 3:58. Without correction, wear reduced removal rate and radius drifted smaller over about 150 brackets. Deburring and imaging a reference coupon every 25 brackets and rescaling the force map held rejects at 2.4 percent over 240 brackets with no drift trend.

### Line 246

Whether burr height on cast aluminium could be estimated from 2D images accurately and fast enough for per-edge control remained open at the start. The vision part of the hypothesis was proven: two-angle differencing reached 0.07 mm RMS at 95 ms per edge, meeting both the 0.1 mm RMS and 120 ms targets. The force part was only partly resolved, as reported in the work performed.

It was determined that single-angle lighting cannot separate burr shadow from surface reflection on cast aluminium, because specular reflection on machined faces inflated apparent burr height. This resolved the uncertainty regarding the shiny and dull surface and the variable burr shape, which had made the link between image and height impossible to fix on paper. In test 2, a single-angle camera overestimated 31 of 400 edges by more than 0.4 mm, all on machined faces. It gave 0.18 mm RMS at about 210 ms per edge. Based on this understanding, we moved to two-angle differencing, which met the targets on the same 400 edges.

The project is ongoing. The team still runs parts in the Bay 4 pilot cell and has not shipped a production cell. Whether the force map transfers to other alloys without a full re-sweep remains untested, because it was mapped only for A357. The cycle time of 3:58 leaves little margin against the 4-minute limit, so it is unknown whether processing time can be cut further. The 1,000-bracket customer acceptance run has not yet taken place.

The goal was a robotic deburring cell that holds edge radius at 0.2 to 0.5 mm within a 4-minute cycle. Burr height can now be estimated from 2D images fast enough to set force per edge on the compliant spindle. This replaces a 90-second 3D laser scan per bracket, which the cycle could not accommodate.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 336/350 words, 31/50 lines |
| 242 | Claim Exclusion: Customer purchase agreement and new product line are commercial outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Planned fiscal 2027 work on internal edges falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Reuse of two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Adding a purchased proportional valve to the floating head is integration work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Test results match across transcript and memo. | applied | none |  | No test results contradicted. |
| 242 | Confidence Map: Hypothesis targets stated consistently. | applied | none |  | Targets match the hypothesis. |
| 242 | Confidence Map: Acceptance run timing differs: fall in the interview, October 2026 in the memo; both consistent but month is only in the memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Transfer to other alloys and internal edges is untested. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Hypothesis 97 percent target met only in test 5 and 6 edge window; test 6 window share not reported. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: force map | applied | none |  | Concept absent. |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept absent. |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 242 | Cover signed-off Summary item h57qe5xbe571h66kj6r211vn458h2cvh | applied | none |  | P1 states company design and build. |
| 242 | Cover signed-off Summary item h57pdcak3w4nap0zbrw5gqeqfs8h2e1s | applied | none |  | P1 states the adaptive deburring goal. |
| 242 | Cover signed-off Summary item h57m1s7y4bz34mdk6ct4vd4gws8h342s | applied | none |  | P2 covers fixed-path limitation. |
| 242 | Cover signed-off Summary item h57gs8dyybpfkb5ykgg8n19jh58h2v4j | applied | none |  | P3 states the objective. |
| 242 | Cover signed-off Summary item h57s0vp2rm50v3tgka01ej8bmx8h3rbr | applied | none | 2 | P4 states the 0.1 mm, 120 ms unknown. |
| 242 | Cover signed-off Summary item h57jsgy4jrmp18m61rhs2tmcdd8h2nvv | applied | none | 2 | P4 gives surface and burr shape reasons. |
| 242 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "and ran a pilot cell on A357 brackets that must hold an edge radius of 0.2 to 0.5 mm within a 4-minute cycle", but the sources say "Customer requirements: edge radius 0.2 to 0.5 mm on every edge, no residual burr, total cycle under 4 minutes per bracket.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether burr height can be estimated from 2D images accurately and fast enough per edge." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 689/700 words, 62/100 lines |
| 244 | Claim Exclusion: Customer purchase agreement and new product line are commercial outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Planned fiscal 2027 work on internal edges falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Reuse of two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Adding a purchased proportional valve to the floating head is integration work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with Storyline. |
| 244 | Confidence Map: Test results match across transcript and memo. | applied | none |  | Results match sources. |
| 244 | Confidence Map: Hypothesis targets stated consistently. | applied | none |  | Targets stated consistently. |
| 244 | Confidence Map: Acceptance run timing differs: fall in the interview, October 2026 in the memo; both consistent but month is only in the memo. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Transfer to other alloys and internal edges is untested. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Hypothesis 97 percent target met only in test 5 and 6 edge window; test 6 window share not reported. | applied | none |  | P8 does not claim test 6 window share. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The Self-check found that the text follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status in section. |
| 244 | Cover signed-off Summary item h57yj2594njx4chy7gfnc232cn8h281v | applied | none |  | Workplan stated. |
| 244 | Cover signed-off Summary item h57v7bdyc0gzzcmk9x4jk887558h3bzm | applied | none |  | Hypothesis stated. |
| 244 | Cover signed-off Summary item h57kkb0e39kwjmmmqvv0gs5v718h2w4f | applied | none |  | Single-angle result stated. |
| 244 | Cover signed-off Summary item h57sc8qmg1fn6mz932htgtec618h271g | applied | none |  | Reflection cause and 31 of 400 stated. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work answers stated uncertainties. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a baseline at fixed force, then a vision check against a laser profiler." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If burr height per edge is estimated from 2D images to within 0.1 mm RMS in under 120 ms, then edge radius can be contr..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): Line 244 P4 says reflections on machined faces made burrs look taller. Line 246 P2 says all 31 overestimated edges were on machined faces, which Line 244 does not state. Line 244 P4 also says 'In test 2' while the single-angle trial is the first vision trial; the numbering is unclear. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 8 (sections 244, 246): Line 244 P8 reports rejects of 2.6 percent over 360 brackets and 2.4 percent over 240 brackets. Line 246 P3 says the cycle leaves little margin and calls the work ongoing, but Line 244 P1 says 1,200 brackets were used while the listed batches (120+400+300+60 coupons+360+240) do not clearly add up. Counts should be checked. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 301/350 words, 27/50 lines |
| 246 | Claim Exclusion: Customer purchase agreement and new product line are commercial outcomes, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Planned fiscal 2027 work on internal edges falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Reuse of two-angle imaging in a polishing cell quote is commercial activity. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Adding a purchased proportional valve to the floating head is integration work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Test results match across transcript and memo. | applied | none |  | Test results match sources. |
| 246 | Confidence Map: Hypothesis targets stated consistently. | applied | none |  | Targets stated consistently. |
| 246 | Confidence Map: Acceptance run timing differs: fall in the interview, October 2026 in the memo; both consistent but month is only in the memo. | applied | none |  | No acceptance date given; says not yet taken place. |
| 246 | Confidence Map: Transfer to other alloys and internal edges is untested. | applied | none |  | P3 says transfer remains untested. |
| 246 | Confidence Map: Hypothesis 97 percent target met only in test 5 and 6 edge window; test 6 window share not reported. | applied | none |  | 97 percent target not claimed. |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item h57h0k8man84a437bxht078kpx8h2nf5 | applied | none |  | P1 states 0.07 mm RMS at 95 ms meeting targets. |
| 246 | Cover signed-off Summary item h57rx3aqkz5572dfjhe1c39rz98h3sed | applied | none | 2 | P2 gives specular reflection cause. |
| 246 | Cover signed-off Summary item h57v72caq0dq0vb0pv84aqfk698h2qcp | applied | none | 2 | P2 gives 31 of 400 on machined faces. |
| 246 | Cover signed-off Summary item h57zfgerhercarx4ddbbmn46d18h33md | applied | none |  | P3 states pilot cell and no shipped cell. |
| 246 | Cover signed-off Summary item h57g95x99n8k35ftw5thyq3p0d8h29qs | applied | none |  | P1 answers the 2D question with figures. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancement answers stated uncertainty. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the vision part of the hypothesis was proven and the force part only partly resolved, but Line 244 P1 says both questions remained unresolved. Line 244 P8 reports force results that met the 97 percent and 3 percent thresholds (2.6 percent rejects, 97.8 percent in window), yet the 3:58 cycle and the hypothesis are not stated as confirmed or disproved. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 242, 244, 246): Line 246 P4 says the vision estimate now replaces the 90-second 3D laser scan as if the goal is achieved, but P3 says the project is ongoing with no acceptance run, and Line 244 P8 shows the cycle at 3:58, close to the limit. The conclusion is overstated against the reported state. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 18.
- Line 244: 0 labels and 0 plan checks "Not checked" of 16.
- Line 246: 0 labels and 0 plan checks "Not checked" of 17.

## Seed-stage numbers

- Requests: 18 metered (16 Batch, 2 Feedback); 19 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.2 s, p95 11.6 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 8.5 s, p95 8.5 s over 1.
- Sign-off to report created: 79.3 s.
- Cost from aiUsage: $1.14 in all ($0.48 seed stage, $0.66 Brief, drafting and checks) over 34 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T17:06:30.176Z created project k97c76fd6tt0dh8r8y118y3vfh8h3b62
2026-10-27T17:06:31.026Z marked as an evaluation project
2026-10-27T17:06:31.897Z added document deburring-test-memo.md
2026-10-27T17:06:33.656Z started Step by step generation k57e91r8gmme0d2sxzaw4845t58h3mn4
2026-10-27T17:06:48.776Z seed stage open
2026-10-27T17:06:48.777Z Open Company / Context and wait for its Batch
2026-10-27T17:06:54.132Z Company / Context: select the first Seed
2026-10-27T17:06:56.806Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-27T17:07:07.930Z kept Feedback returned 1 Revised Seed(s)
2026-10-27T17:07:07.931Z Company / Context: select the first Revised Seed and untick the original
2026-10-27T17:07:12.218Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-27T17:07:20.315Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-27T17:07:20.315Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-27T17:07:22.044Z Approve Company / Context
2026-10-27T17:07:24.660Z approved company_context
2026-10-27T17:07:24.660Z Open Goal / Problem and wait for its Batch
2026-10-27T17:07:32.787Z Goal / Problem: select the first Seed
2026-10-27T17:07:35.416Z Approve Goal / Problem
2026-10-27T17:07:38.106Z approved goal_problem
2026-10-27T17:07:38.106Z Open Technological limitations and wait for its Batch
2026-10-27T17:07:46.319Z Technological limitations: select the first Seed
2026-10-27T17:07:49.008Z Approve Technological limitations
2026-10-27T17:07:51.684Z approved passive_limitations
2026-10-27T17:07:51.684Z Open Technological objectives and wait for its Batch
2026-10-27T17:07:59.770Z Technological objectives: select the first Seed
2026-10-27T17:08:02.384Z Approve Technological objectives
2026-10-27T17:08:05.055Z approved technological_objective
2026-10-27T17:08:05.055Z Open Technological uncertainties and wait for its Batch
2026-10-27T17:08:13.170Z Technological uncertainties: select the first 2 Seeds
2026-10-27T17:08:17.528Z Approve Technological uncertainties
2026-10-27T17:08:20.159Z approved active_uncertainties
2026-10-27T17:08:20.160Z Skip Previous-year status
2026-10-27T17:08:21.924Z Open Work plan and wait for its Batch
2026-10-27T17:08:34.849Z Work plan: select the first Seed
2026-10-27T17:08:37.504Z Approve Work plan
2026-10-27T17:08:40.244Z approved workplan
2026-10-27T17:08:40.245Z Open Hypothesis and wait for its Batch
2026-10-27T17:08:54.084Z Hypothesis: select the first Seed
2026-10-27T17:08:56.691Z Approve Hypothesis
2026-10-27T17:08:59.372Z approved hypothesis
2026-10-27T17:08:59.372Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T17:09:13.224Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T17:09:17.606Z Approve Experimentation / Iterations
2026-10-27T17:09:20.288Z approved experimentation
2026-10-27T17:09:20.288Z Open Advancement to science / technology and wait for its Batch
2026-10-27T17:09:28.318Z Advancement to science / technology: select the first Seed
2026-10-27T17:09:30.997Z Approve Advancement to science / technology
2026-10-27T17:09:33.712Z approved overall_advancement
2026-10-27T17:09:33.712Z Open Specific technological advancements and wait for its Batch
2026-10-27T17:09:44.689Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T17:09:51.789Z Approve Specific technological advancements
2026-10-27T17:09:54.428Z approved specific_advancements
2026-10-27T17:09:54.428Z Open Project status and next steps and wait for its Batch
2026-10-27T17:10:08.335Z Project status and next steps: select the first Seed
2026-10-27T17:10:10.972Z Approve Project status and next steps
2026-10-27T17:10:13.628Z approved project_status
2026-10-27T17:10:13.628Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T17:10:21.659Z Overall company / project goal improvements: select the first Seed
2026-10-27T17:10:24.261Z Approve Overall company / project goal improvements
2026-10-27T17:10:26.896Z approved goal_improvements
2026-10-27T17:10:26.896Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T17:10:28.682Z signed off; waiting for the report
2026-10-27T17:11:49.833Z report kd71486m692ky6wsj959hcbwjx8h3wws created
```
