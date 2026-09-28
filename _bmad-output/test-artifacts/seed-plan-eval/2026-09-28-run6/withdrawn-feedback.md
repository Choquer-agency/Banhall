# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-09-28 on `local` at commit `c8ce1fe2`, acting as e2e-audit@banhall.local. Project `k971qh2rk27jb0ve9pbdnc929x8f8zrs`, generation `k577h4djrjqh0y3baq9t7b36bs8f91yq`.

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

10 passed, 3 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7dqj0f9raa5jw6nm85db12nd8f9g13 |
| All three Sections were drafted | pass | 242: 347 words, 244: 588 words, 246: 337 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | fail | 5 row(s) in 246: "The plan coverage Self-check did not complete." |
| The model Self-check ran on every Section | fail | 246: "Self-check call failed (unknown: response failed validation: planVerdicts invalid_type); deterministic checks only" |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (15 Batch, 2 Feedback), 18 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 5 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- Tessrow builds robotic finishing cells for aerospace and medical parts, employing 45 people in Grandbois, Quebec. / The company integrates industrial arms with its own tooling, fixturing and control software. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- Tessrow sought a vision-guided, force-adaptive robotic deburring process for cast A357 aerospace brackets. / The goal was to replace fixed-force, fixed-path deburring with per-edge force control from a compliant spindle. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- A standard fixed-path, fixed-force cell cannot adapt to burr variability without over-rounding or leaving burrs behind. / Setting force high enough for a 1.2 millimetre burr over-rounds edges that only had 0.1 millimetres. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- Tessrow needed to know whether burr height could be estimated from 2D images accurately and quickly enough to guide per-edge force. / This mattered because no known prior work existed on estimating burr height from 2D images on cast aluminium. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether per-edge force adjustment on the compliant spindle could hold radius across normal casting variation. / No model existed relating burr geometry, applied force, and resulting radius before this work. _(cited)_
- The vision uncertainty was compounded by a cast aluminium surface that is shiny in places and dull in others. / Burr size is small compared to the part, so no known prior work covered this exact estimation problem. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan staged tests in the pilot cell in Bay 4 from August 2025 through June 2026, starting with a fixed-force baseline. / This baseline established a comparison point before adding vision and force adaptation. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis paired a vision accuracy and speed target with a force control and reject rate outcome. / Both conditions had to hold together inside the customer's 4 minute cycle time. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Test one ran 120 brackets at a fixed 20 newton force and fixed path in September 2025. / The baseline reject rate reached 14 percent, worse than the existing manual deburring process. _(cited)_
- Single-angle 2D vision with a low-angle ring light gave 0.18 millimetres RMS error at 210 milliseconds per edge. / Reflections on machined faces made burrs look taller than they were, causing both problems. _(cited)_

### 10. Advancement to science / technology (Section 246, standard): approved

- The final tests reached a 2.4 to 2.6 percent reject rate, meeting the sub 3 percent target. / Edge radius compliance reached 97.8 percent of edges, just under the 97 percent hypothesis threshold gap. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Single-angle 2D vision failed to resolve burr height, confirming 2D estimation needed a different lighting approach for shiny cast surfaces. / The knowledge gained was that fixed-force baseline testing alone could not close the burr-height-to-force uncertainty. _(cited)_
  - Links: uncertainty "The vision uncertainty was compounded by a cast aluminium surface t..."; experiments "Single-angle 2D vision with a low-angle ring light gave 0.18 millim..."
- Reflections on machined faces revealed a specific limit of single-angle imaging for estimating burr height. _(cited)_
  - Links: uncertainty "The vision uncertainty was compounded by a cast aluminium surface t..."; experiments "Single-angle 2D vision with a low-angle ring light gave 0.18 millim..."

### 12. Project status and next steps (Section 246, standard): approved

- Tessrow is still running parts in the pilot cell in Bay 4, with no production cell shipped yet. / The team is at the edge of the four minute cycle time, so any extra step would push it over. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The knowledge gained closed the original goal of replacing fixed-force, fixed-path deburring with per-edge control from the compliant spindle. / Two-angle imaging plus a mapped force relationship let the compliant spindle hold radius on 97.8 percent of edges. _(cited)_

## Drafted Sections

### Line 242

Tessrow builds robotic finishing cells for grinding, sanding, polishing and deburring, employing 45 people in Grandbois, Quebec, mostly for aerospace and some medical parts. The company integrates industrial arms with its own tooling, fixturing and control software, giving it direct operational exposure to the limits of fixed-force robotic deburring on variable cast parts. This background drove the company to pursue a vision-guided, force-adaptive process for one aerospace customer's cast A357 brackets, aiming to replace fixed-force, fixed-path deburring with per-edge force control from a compliant floating head.

The limitations to standard practice were that a fixed-path, fixed-force robotic cell cannot adapt to burr height variability along a bracket's edges. Setting force high enough to remove a 1.2 mm burr over-rounds edges that carried only 0.1 mm of material, so a single force setting cannot serve both conditions on the same part. Existing 3D laser profiling and touch-probe scanning could size burrs accurately but took roughly 90 seconds per bracket, too slow for the customer's 4-minute cycle time. No documented method existed for estimating burr height from 2D images on cast aluminium, because burr size is small relative to the part and the casting surface varies from shiny to dull, confounding shadow-based estimation.

The technological objective was to advance the understanding of burr height estimation from 2D machine vision on cast aluminium, for the purposes of driving real-time per-edge force control on a modified floating head deburring tool. This mattered because no prior work was known to have solved burr height estimation from 2D images on cast aluminium under these surface conditions.

It was uncertain whether burr height could be estimated from 2D images to the accuracy and speed needed for per-edge control, because reflective and dull regions on the same cast surface confound shadow-based measurement and no comparable method was known. It was also uncertain whether per-edge force adjustment on the floating head could hold edge radius within the edge radius window across normal casting variation, since no model existed relating burr geometry, applied force and resulting radius, and thin flange sections were expected to flex under load.

### Line 244

The technological problem was to determine whether burr height on cast A357 brackets could be estimated from 2D images fast and accurately enough to drive per-edge force control on the floating head, since no known method handled the mix of shiny and dull cast surface within the customer's cycle time. The plan staged tests in the pilot cell in Bay 4 from August 2025 through June 2026, starting with a fixed-force baseline. This baseline established a comparison point before adding vision and force adaptation. From there the plan moved through single-angle 2D vision, two-angle differencing, a force map built from coupon tests, a thin flange fix, and a reference coupon correction for abrasive wear, addressing each uncertainty from Section 242 in turn.

It was hypothesized that if burr height per edge could be estimated from 2D images to within 0.1 mm RMS in under 120 milliseconds per edge, and floating head contact force were set from that estimate, then edge radius would hold within the edge radius window on at least 97 percent of edges and bracket reject rate would fall below 3 percent, inside a 4 minute cycle. The hypothesis paired a vision accuracy and speed target with a force control and reject rate outcome. Both conditions had to hold together inside the customer's 4 minute cycle time.

The first open question was whether a fixed-force, fixed-path cell could match manual deburring at all. Test one ran 120 brackets at a fixed 20 newton force and fixed path in September 2025. The baseline reject rate reached 14 percent, worse than the existing manual deburring process, with most failures split between leftover burrs and over-rounded edges. This result confirmed that a single force setting could not serve the full range of burr heights on one bracket, and ruled out fixed-force control as a viable path forward.

The next uncertainty was whether 2D imaging alone could perform burr height estimation accurately and quickly enough for control. Single-angle 2D vision with a low-angle ring light gave 0.18 mm RMS error at 210 milliseconds per edge, missing both targets. Reflections on machined faces made burrs look taller than they were, causing both problems. A borrowed structured-light 3D camera was tested next but gave no better depth resolution and took longer to capture, so it was set aside in favour of improving the 2D method.

The company then tested whether two images taken at different lighting angles could separate burr shadow from surface reflection. Two-angle differencing at 15 and 60 degrees, combined with GPU processing and CAD-cropped regions per edge, dropped error to 0.07 mm RMS at 95 milliseconds per edge, meeting both targets. This confirmed that reflection artifacts, not burr geometry itself, had been the limiting factor in the earlier attempts.

With a working vision method in hand, the remaining question was whether a stable force map existed between burr height and required force. Coupon tests across a burr range of 0.1 to 1.2 mm revealed a non-linear relationship with a knee near 0.6 mm, and applying it in a 300-bracket trial cut rejects to 4.3 percent but left thin flange chatter above roughly 28 newtons. Capping force and slowing feed rate on those edges, rather than adding a second pass, removed the chatter and pushed the reject rate to 2.6 percent with 97.8 percent of edges in window. A final trial adding periodic reference coupon checks to correct for abrasive wear drift held rejects at 2.4 percent with no drift trend, closing out the hypothesis within the required cycle time.

### Line 246

The technological objective was to advance understanding of burr height estimation from 2D machine vision and adaptive force control on a floating head deburring cast A357 brackets. This objective was largely met. The hypothesis was proven for vision accuracy and speed, and proven for reject rate and edge radius compliance within a small margin: final tests reached a 2.4 to 2.6 percent reject rate, meeting the sub-3 percent target, while edge radius compliance reached 97.8 percent of edges, just under the 97 percent threshold set in the hypothesis, at a cycle time of 3 minutes 58 seconds, close to the 4 minute limit.

It was determined that single-angle 2D vision could not resolve burr height on cast aluminium surfaces that are shiny in places and dull in others, because reflections on machined faces made burrs appear taller than they were. This resolved the uncertainty regarding whether existing 2D imaging methods, applied without modification, could support burr height estimation on this material; they could not. This knowledge was applied by testing a two-angle differencing approach instead, which separated burr shadow from surface reflection and met both the accuracy and speed targets.

At period end, Tessrow is still running parts in the pilot cell in Bay 4, with no production cell shipped. Cycle time sits at the edge of the 4 minute limit, so any added processing step would push it over, leaving open whether further GPU speed gains can recover margin. Whether the vision and force map methods transfer to other alloys and bracket geometries without a full re-sweep, and whether internal edges invisible to a direct camera view can be estimated at all, remain open questions for fiscal 2027.

The knowledge gained closed the original goal of replacing fixed-force, fixed-path deburring with per-edge control from the compliant floating head. Two-angle imaging combined with the mapped force relationship let the floating head hold edge radius on 97.8 percent of edges, cutting rejects from the manual process's 9 percent baseline to 2.6 percent, within the customer's 4 minute cycle.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 347/350 words, 35/50 lines |
| 242 | Claim Exclusion: Customer's business decision to buy a production cell conditional on acceptance run results is a commercial/business risk matter, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial application, not part of this project's experimental work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The planned customer acceptance run is a future production/commercial qualification activity scheduled outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Adding a proportional valve so the controller could change pressure between edges was a known engineering modification, not itself the uncertain element (the uncertainty was the burr-to-force relationship, not building the valve). | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Checking that the floating head's response time was fast enough to change force between edges was a straightforward engineering verification of a purchased/modified component, not itself the technological uncertainty being investigated. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Transferring the force map to other alloys and a titanium bracket is described as future work planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Handling internal edges is explicitly identified as planned for the next fiscal year, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: floating head | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Storyline | applied | none |  | Section matches storyline background and uncertainties |
| 242 | Confidence Map: Baseline fixed-force test results are established from both the interview and the memo table. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Single-angle vision failure mode attributed to specular reflection is established, with a memo detail quantifying which edges were affected. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Two-angle vision result of 0.07 mm RMS at 95 ms/edge is established, consistent across interview and memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: The worst single-edge error in the two-angle test is an established but partial supplementary detail only in the memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: The non-linear force/burr-height knee near 0.6 mm is established, with memo adding repeatability detail across casting lots. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Thin flange deflection measurement under static load is a partial, single-source detail only in the memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: A second pass was tried on flange edges and rejected as worse than the slower feed approach; this detail with its specific reject rate appears only in the memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Abrasive wear drift without correction is established with a specific magnitude only stated in the memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Sleeve life extension from wear correction is a partial, single-source quantitative detail from the memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Final test 5 results (reject rate, edges in window, cycle time) are established, consistent across interview and memo. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the project's methods transfer to other alloys and bracket designs without a full re-sweep is explicitly unresolved. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is explicitly unresolved. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Personnel time allocation on the project is established from the interview. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: pilot cell | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: force map | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: thin flange chatter | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: edge radius window | applied | none |  | P2 uses required window instead of the term; repaired to the Glossary Term |
| 242 | Cover signed-off Summary item ys79bagdvbwtvfe2wgr4bdz2cd8f8a5x | applied | none |  | P1 covers company, size, location, products. |
| 242 | Cover signed-off Summary item ys726vnvnp6w73w03y716t8gg18f96ez | applied | none |  | P1 states goal to replace fixed-force deburring. |
| 242 | Cover signed-off Summary item ys7fjgm05af8cqnsk51708rqgd8f9c5z | applied | none |  | P2 gives the 1.2mm/0.1mm force limitation. |
| 242 | Cover signed-off Summary item ys77sf3yhneaf3nwe57ewyggx18f8drw | applied | none |  | P3 states the objective and novelty rationale. |
| 242 | Cover signed-off Summary item ys78pw5j1yw16qkdc7qjznqacx8f903n | applied | none | 2 | P4 covers force/radius model uncertainty. |
| 242 | Cover signed-off Summary item ys774q164hv40yydvw8ypdjk4s8f8a42 | applied | none | 2 | P4 covers vision estimation uncertainty from surfaces. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Tessrow sought a vision-guided, force-adaptive robotic deburring process for cast A357 aerospace brackets. The goal was..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 588/700 words, 53/100 lines |
| 244 | Claim Exclusion: Customer's business decision to buy a production cell conditional on acceptance run results is a commercial/business risk matter, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial application, not part of this project's experimental work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The planned customer acceptance run is a future production/commercial qualification activity scheduled outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Adding a proportional valve so the controller could change pressure between edges was a known engineering modification, not itself the uncertain element (the uncertainty was the burr-to-force relationship, not building the valve). | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Checking that the floating head's response time was fast enough to change force between edges was a straightforward engineering verification of a purchased/modified component, not itself the technological uncertainty being investigated. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Transferring the force map to other alloys and a titanium bracket is described as future work planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Handling internal edges is explicitly identified as planned for the next fiscal year, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: pilot cell | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: floating head | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Storyline | applied | none |  | Section matches storyline plan, hypothesis, and results |
| 244 | Confidence Map: Baseline fixed-force test results are established from both the interview and the memo table. | applied | none |  | P3 baseline 14% reject rate stated as established fact |
| 244 | Confidence Map: Single-angle vision failure mode attributed to specular reflection is established, with a memo detail quantifying which edges were affected. | applied | none |  | P4 attributes error to reflections, consistent with established |
| 244 | Confidence Map: Two-angle vision result of 0.07 mm RMS at 95 ms/edge is established, consistent across interview and memo. | applied | none |  | P5 states 0.07mm RMS at 95ms, matches established fact |
| 244 | Confidence Map: The worst single-edge error in the two-angle test is an established but partial supplementary detail only in the memo. | applied | none |  | Worst single-edge error detail not mentioned in section |
| 244 | Confidence Map: The non-linear force/burr-height knee near 0.6 mm is established, with memo adding repeatability detail across casting lots. | applied | none |  | P6 states knee near 0.6 mm, matches established fact |
| 244 | Confidence Map: Thin flange deflection measurement under static load is a partial, single-source detail only in the memo. | applied | none |  | Flange deflection measurement not mentioned in section |
| 244 | Confidence Map: A second pass was tried on flange edges and rejected as worse than the slower feed approach; this detail with its specific reject rate appears only in the memo. | applied | none |  | P6 hedges via 'rather than adding a second pass', not flat claim |
| 244 | Confidence Map: Abrasive wear drift without correction is established with a specific magnitude only stated in the memo. | applied | none |  | Specific drift magnitude not stated in section |
| 244 | Confidence Map: Sleeve life extension from wear correction is a partial, single-source quantitative detail from the memo. | applied | none |  | Sleeve life extension detail not mentioned in section |
| 244 | Confidence Map: Final test 5 results (reject rate, edges in window, cycle time) are established, consistent across interview and memo. | applied | none |  | P6 final trial figures match established consistent results |
| 244 | Confidence Map: Whether the project's methods transfer to other alloys and bracket designs without a full re-sweep is explicitly unresolved. | applied | none |  | Transfer to other alloys not mentioned in section |
| 244 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is explicitly unresolved. | applied | none |  | Internal edge visibility question not mentioned in section |
| 244 | Confidence Map: Personnel time allocation on the project is established from the interview. | applied | none |  | Personnel time allocation not mentioned in section |
| 244 | Glossary Term: burr height estimation | applied | none |  | Section says 'estimate burr height', not the glossary term; repaired to the Glossary Term |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Section says 'chattering' not 'thin flange chatter'; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role present in section. |
| 244 | Cover signed-off Summary item ys76q2365tcm1j694xghv3r2w58f943g | applied | none |  | Workplan wording matches P1 verbatim. |
| 244 | Cover signed-off Summary item ys72t0jng57ejejgqss19hjsmn8f8nn5 | applied | none |  | Hypothesis wording matches P2 verbatim. |
| 244 | Cover signed-off Summary item ys78ezd4fh3xraw2syb6kz80c58f9a1s | applied | none |  | Baseline test wording matches P3 verbatim. |
| 244 | Cover signed-off Summary item ys7fs9r3x59c9dg3bp11x6brn58f978k | applied | none |  | 2D vision result wording matches P4 verbatim. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The plan staged tests in the pilot cell in Bay 4 from August 2025 through June 2026, starting with a fixed-force baseli..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 337/350 words, 33/50 lines |
| 246 | Claim Exclusion: Customer's business decision to buy a production cell conditional on acceptance run results is a commercial/business risk matter, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial application, not part of this project's experimental work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The planned customer acceptance run is a future production/commercial qualification activity scheduled outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Adding a proportional valve so the controller could change pressure between edges was a known engineering modification, not itself the uncertain element (the uncertainty was the burr-to-force relationship, not building the valve). | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Checking that the floating head's response time was fast enough to change force between edges was a straightforward engineering verification of a purchased/modified component, not itself the technological uncertainty being investigated. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Transferring the force map to other alloys and a titanium bracket is described as future work planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Handling internal edges is explicitly identified as planned for the next fiscal year, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pilot cell | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: floating head | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Model Self-check | not_applied | none |  | Self-check call failed (unknown: response failed validation: planVerdicts invalid_type); deterministic checks only |
| 246 | Cover signed-off Summary item ys7ct57xf5gvchq4j8vnx867ks8f8k3y | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys7f993m3q85d14f1dzzm6atnh8f93fj | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys7bb35ce6gzg066zr30vewfd18f8234 | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys7e4pwmhwq2xmd5pncb89ygd98f9q40 | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys7bfa963zryf6ph25pqe3gehx8f840t | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Single-angle 2D vision failed to resolve burr height, confirming 2D estimation needed a different lighting approach for..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Reflections on machined faces revealed a specific limit of single-angle imaging for estimating burr height." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 states the manual process baseline reject rate was 9 percent, but 244 P3 states the fixed-force baseline test reached 14 percent reject rate and calls it worse than the existing manual deburring process, implying manual reject rate was below 14 percent but never states 9 percent. The two sections give inconsistent manual baseline figures (9 percent here versus an unstated but implied lower-than-14-percent figure in 244), and 242 P2 never mentions a manual baseline figure at all, so the 9 percent figure appears unsupported and inconsistent with the fixed-force framing in 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): 246 P1 says edge radius compliance reached 97.8 percent, just under the 97 percent threshold set in the hypothesis, but 97.8 is above 97, not under it. This misstates the comparison against the hypothesis target restated correctly in 244 P2 and P6. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): 246 P3 states cycle time sits at the edge of the 4 minute limit with no margin for added steps, while 246 P1 gives the final cycle time as 3 minutes 58 seconds. 244 does not report a final cycle time figure, so the precise number in 246 P1 is not corroborated by the work performed section and the framing in P3 downplays the 2 second margin reported in P1. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 26.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 5.

## Seed-stage numbers

- Requests: 17 metered (15 Batch, 2 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.5 s, p95 24.7 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 26.4 s, p95 26.4 s over 1.
- Sign-off to report created: 122.2 s.
- Cost from aiUsage: $0.96 in all ($0.39 seed stage, $0.57 Brief, drafting and checks) over 41 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T14:12:06.090Z created project k971qh2rk27jb0ve9pbdnc929x8f8zrs
2026-09-28T14:12:06.756Z added document deburring-test-memo.md
2026-09-28T14:12:08.140Z started Step by step generation k577h4djrjqh0y3baq9t7b36bs8f91yq
2026-09-28T14:13:04.851Z seed stage open
2026-09-28T14:13:04.852Z Open Company / Context and wait for its Batch
2026-09-28T14:13:16.956Z Company / Context: select the first Seed
2026-09-28T14:13:19.049Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-09-28T14:13:28.602Z kept Feedback returned 1 Revised Seed(s)
2026-09-28T14:13:28.602Z Company / Context: select the first Revised Seed and untick the original
2026-09-28T14:13:32.111Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-09-28T14:13:41.606Z withdrawn Feedback returned 1 Revised Seed(s)
2026-09-28T14:13:41.607Z Company / Context: withdraw the "withdrawn" Feedback
2026-09-28T14:13:43.022Z Approve Company / Context
2026-09-28T14:13:45.091Z approved company_context
2026-09-28T14:13:45.091Z Open Goal / Problem and wait for its Batch
2026-09-28T14:13:59.890Z Goal / Problem: select the first Seed
2026-09-28T14:14:01.968Z Approve Goal / Problem
2026-09-28T14:14:04.052Z approved goal_problem
2026-09-28T14:14:04.052Z Open Technological limitations and wait for its Batch
2026-09-28T14:14:18.860Z Technological limitations: select the first Seed
2026-09-28T14:14:20.910Z Approve Technological limitations
2026-09-28T14:14:22.978Z approved passive_limitations
2026-09-28T14:14:22.978Z Open Technological objectives and wait for its Batch
2026-09-28T14:14:35.279Z Technological objectives: select the first Seed
2026-09-28T14:14:37.334Z Approve Technological objectives
2026-09-28T14:14:39.398Z approved technological_objective
2026-09-28T14:14:39.398Z Open Technological uncertainties and wait for its Batch
2026-09-28T14:15:04.903Z Technological uncertainties: select the first 2 Seeds
2026-09-28T14:15:08.479Z Approve Technological uncertainties
2026-09-28T14:15:10.554Z approved active_uncertainties
2026-09-28T14:15:10.555Z Skip Previous-year status
2026-09-28T14:15:11.935Z Open Work plan and wait for its Batch
2026-09-28T14:15:40.365Z Work plan: select the first Seed
2026-09-28T14:15:42.455Z Approve Work plan
2026-09-28T14:15:44.554Z approved workplan
2026-09-28T14:15:44.554Z Open Hypothesis and wait for its Batch
2026-09-28T14:15:59.385Z Hypothesis: select the first Seed
2026-09-28T14:16:01.490Z Approve Hypothesis
2026-09-28T14:16:03.570Z approved hypothesis
2026-09-28T14:16:03.570Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T14:16:18.736Z Experimentation / Iterations: select the first 2 Seeds
2026-09-28T14:16:22.194Z Approve Experimentation / Iterations
2026-09-28T14:16:24.290Z approved experimentation
2026-09-28T14:16:24.290Z Open Advancement to science / technology and wait for its Batch
2026-09-28T14:16:36.499Z Advancement to science / technology: select the first Seed
2026-09-28T14:16:38.582Z Approve Advancement to science / technology
2026-09-28T14:16:40.663Z approved overall_advancement
2026-09-28T14:16:40.663Z Open Specific technological advancements and wait for its Batch
2026-09-28T14:16:58.149Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T14:17:02.976Z Approve Specific technological advancements
2026-09-28T14:17:05.095Z approved specific_advancements
2026-09-28T14:17:05.095Z Open Project status and next steps and wait for its Batch
2026-09-28T14:17:19.852Z Project status and next steps: select the first Seed
2026-09-28T14:17:21.940Z Approve Project status and next steps
2026-09-28T14:17:24.045Z approved project_status
2026-09-28T14:17:24.045Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T14:17:41.576Z Overall company / project goal improvements: select the first Seed
2026-09-28T14:17:43.665Z Approve Overall company / project goal improvements
2026-09-28T14:17:45.805Z approved goal_improvements
2026-09-28T14:17:45.805Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T14:17:47.204Z signed off; waiting for the report
2026-09-28T14:19:51.153Z report kd7dqj0f9raa5jw6nm85db12nd8f9g13 created
```
