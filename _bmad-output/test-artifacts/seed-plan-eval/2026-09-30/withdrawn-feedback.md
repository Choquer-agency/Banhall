# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-09-30 on `local` at commit `67be8f06`, acting as e2e-audit@banhall.local. Project `k977zzzvaa530z9gdeyag765b18fct4b`, generation `k57efgm9vf0qq6wxjxstsam7x18fczf4`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: Yes. "Kestrel" appears in 0 later Seeds, 0 plan items and 0 Lines; the Feedback row is withdrawn and 0 of 12 later Batches carried it.
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: Yes for Section 244 and every Line: "compliant spindle" 7 times (242: 3, 244: 3, 246: 1), "floating head" 0 times, and each Line's Compliance Note says the writer's Feedback governs the Glossary Term there. Subsection 9's five Seeds name the tool with neither term, which is what the failed heuristic reports; they neither follow nor breach the Feedback.
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: Yes. Every figure matches the memo and interview (120 brackets, 20 N, 3:10, 14 percent; 0.18 mm at 210 ms; 31 of 400 edges; 0.07 mm at 95 ms; 60 coupons, 8 to 40 N; 4.3 and 96.1 percent; 28 N, 26 N cap, 40 to 25 mm/s; 2.6 and 97.8 percent, 3:58; 2.4 percent over 240 brackets).
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (350, 685, 350).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, high confidence. All run 6 defects fixed: the active Feedback outranks the Glossary Term in every Line ("floating head" 8 uses to 0), "97.8 percent ... just under 97" is gone, and the Self-check completed on every Line. Minors: Line 246 paragraph 1 "came close to the radius target" (signed-off Seed) sits beside Line 244 "meeting the hypothesis" (the consistency pass flags it); Line 244 adds an invented hedge on the force map; three unselected later Seeds said "floating head" (never signed off).

## Automatic checks

12 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7b5pq7qe0mmb5p1dt6j54as98fcpqd |
| All three Sections were drafted | pass | 242: 350 words, 244: 685 words, 246: 350 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (15 Batch, 2 Feedback), 18 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 5 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds robotic finishing cells for grinding, sanding, polishing and deburring work. / These cells serve mostly aerospace customers and some medical part manufacturers. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a system to deburr cast A357 aluminum aerospace brackets automatically, replacing manual work. / The goal was to hold edge radius within 0.2-0.5 mm on every edge inside a 4 minute cycle. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard fixed path and fixed force robotic deburring could not adapt to burrs ranging from 0.1 to 1.2 mm. / Setting force high enough for the largest burr over rounded edges that only had 0.1 mm of burr. _(writer-asserted)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether burr height could be estimated from fast 2D images on cast aluminum. / No prior work existed on 2D burr height estimation for cast aluminum, given shiny and dull surfaces. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether 2D burr height estimation could be accurate and fast enough on cast aluminum. / No prior work existed on this problem, since shiny and dull surfaces made it hard to judge. _(writer-asserted)_
- It was unclear whether the force-radius relationship was stable enough to control, since removal rate depends on force, feed, wear and edge stiffness. / Thin flanges on the bracket were known to flex under load, adding to the uncertainty. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan set a four step sequence: baseline, vision estimation, force mapping, then extended trials for wear and variation. / Each step was tested in the pilot cell in Bay 4 before moving to the next. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis linked two measurable thresholds: a vision accuracy and speed target, and a downstream radius and reject outcome. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- A fixed force, fixed path baseline at 20 newtons gave 14 percent rejects, worse than manual deburring. _(cited)_
  - Tested: uncertainty "It was unclear whether the force-radius relationship was stable eno..."
- A single angle ring light vision setup was tried to estimate burr height from 2D images. / It reached only 0.18 millimetres RMS error at 210 milliseconds per edge, limited by reflections on machined faces. _(cited)_
  - Tested: uncertainty "It was uncertain whether 2D burr height estimation could be accurat..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The hypothesis was largely achieved: two-angle vision and force mapping together met the vision target and came close to the radius target. / Final testing on 240 brackets held reject rate at 2.4 percent, well under the 3 percent goal. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Fixed force at 20 newtons on a fixed path resolved that a non-adaptive approach could not handle burr variation. / Rejects reached 14 percent, worse than manual deburring, confirming force must vary edge to edge. _(cited)_
  - Links: uncertainty "It was unclear whether the force-radius relationship was stable eno..."; experiments "A fixed force, fixed path baseline at 20 newtons gave 14 percent re..."
- The baseline test showed removal rate could not be held stable with a single fixed force setting. / About two thirds of rejects were leftover burrs, the rest over rounded edges, per the baseline run. _(cited)_
  - Links: uncertainty "It was unclear whether the force-radius relationship was stable eno..."; experiments "A fixed force, fixed path baseline at 20 newtons gave 14 percent re..."

### 12. Project status and next steps (Section 246, standard): approved

- The team is still running parts in the pilot cell in Bay 4, with no production cell shipped yet. / Cycle time sits at the edge of the 4 minute limit, leaving no room for extra steps. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project aimed to replace manual deburring with an adaptive system holding edge radius within 0.2-0.5 mm. / Testing confirmed two-angle vision plus force mapping could set contact force accurately enough to meet that goal. _(cited)_

## Drafted Sections

### Line 242

The company designs and builds robotic finishing cells for grinding, sanding, polishing and deburring, integrating industrial arms with proprietary tooling, fixturing and control software. These cells serve mostly aerospace customers and some medical part manufacturers. That background in force-controlled tooling and part-specific process development for precision aerospace components gave the company the operational basis to pursue an automated deburring solution for a customer's cast bracket problem.

The company sought a system to deburr cast A357 aluminum aerospace brackets automatically, replacing manual work performed by three people per shift at a 9 percent reject rate. The goal was to hold edge radius within 0.2-0.5mm on every edge inside a 4-minute cycle, using a modified compliant spindle whose contact force could be set per edge.

The limitations to standard practice were that fixed path, fixed force robotic deburring could not adapt to burrs ranging from 0.1 to 1.2mm along a single part. Setting force high enough to clear the largest burr over-rounded edges that carried only 0.1mm of burr, and no documented method existed for estimating burr height from 2D imaging on cast aluminum, where mixed shiny and dull reflectivity and burr size relative to the part made the problem unsolved by prior art.

The technological objective was to advance the understanding of whether burr height could be estimated from fast 2D images on cast aluminum, for the purposes of setting per-edge contact force on a compliant spindle within a 4-minute cycle. No prior work existed on 2D burr height estimation for cast aluminum given its shiny and dull surface variation.

It was uncertain whether 2D burr height estimation could reach the accuracy and speed needed for per-edge force control, since no prior work addressed this problem and reflective variation across shiny and dull cast surfaces made burr signal hard to separate from surface glare. It was also unclear whether a stable, controllable force-to-radius relationship existed, since the compliant spindle's material removal rate depends on force, feed rate, abrasive wear and edge stiffness together, and the bracket's thin flanges were known to flex under load, adding an unresolved variable to that relationship.

### Line 244

The technological problem was that no method existed to estimate burr height from 2D images on cast A357 aluminum fast enough to set per-edge contact force on the compliant spindle, and it was unknown whether a stable, controllable relationship existed between burr height, contact force, edge stiffness and abrasive wear that could hold edges within the 0.2-0.5mm edge radius window. The plan set a four step sequence: baseline, vision estimation, force mapping, then extended trials for wear and variation, each tested in the pilot cell in Bay 4 before moving to the next. The first step checked whether a fixed-force, fixed-path approach, the standard method, could handle burr variation at all. The second and third targeted the linked uncertainties directly: whether 2D imaging could resolve burr height on a mixed shiny/dull cast surface within the needed accuracy and speed, and whether a usable force-to-radius relationship existed given feed rate, wear and flange stiffness as confounding variables. The fourth tested whether any solution held up over longer runs and across casting lots.

It was hypothesized that if burr height per edge could be estimated from 2D images to within 0.1mm RMS in under 120 milliseconds, and that estimate used to set compliant spindle contact force, then edge radius could be held within 0.2-0.5mm on at least 97 percent of edges and bracket reject rate brought below 3 percent, inside a 4-minute cycle. The hypothesis linked two measurable thresholds: a vision accuracy and speed target, and a downstream radius and reject outcome.

The first uncertainty was whether the existing fixed-force, fixed-path method could handle the observed 0.1-1.2mm burr variation on a single part. The company ran 120 brackets through the pilot cell with the compliant spindle at a fixed 20N and fixed path, at a baseline cycle time of 3 minutes 10 seconds. This gave 14 percent rejects, worse than manual deburring, split between leftover burrs on high-burr edges and over-rounded edges on low-burr edges, confirming no fixed setting could serve both ends of the burr range and that per-edge adaptation was required.

The next uncertainty was whether burr height could be read from 2D images accurately and quickly enough to drive that adaptation. A single angle ring light setup reached only 0.18mm RMS error at 210 milliseconds per edge, limited by reflections on machined faces, with 31 of 400 test edges overestimated by more than 0.4mm, all on machined faces, where glare mimicked a taller burr. A borrowed structured-light 3D camera was tested next but gave no better depth resolution (about 0.2mm) and captured more slowly (400ms), so the team returned to refining 2D. Switching to two-angle differencing, using images at 15 and 60 degree lighting angles to separate burr shadow from surface reflection, and moving processing to GPU with CAD-path cropping, cut error to 0.07mm RMS at 95ms per edge, meeting both vision targets. This established that two-angle differencing, not single-angle or 3D imaging, resolves burr height on cast aluminum's mixed reflectivity within the needed speed.

With burr height estimation solved, 60 scrap coupons across the 0.1-1.2mm burr range at forces from 8 to 40N were used to build a force map linking force to resulting radius, then applied to 300 brackets. The relationship was non-linear, with a knee near 0.6mm that, based on preliminary comparison across lots, appeared repeatable within about plus or minus 2N, though this remains to be confirmed by further testing. Rejects fell to 4.3 percent and 96.1 percent of edges landed in window, just short of target. The shortfall traced to thin 2.5mm flanges, where forces above 28N caused measured static deflection of up to 0.15mm, loss of contact and thin flange chatter. Capping flange force at 26N and slowing feed from 40 to 25mm/s removed the chatter, bringing 360 brackets to 2.6 percent rejects and 97.8 percent in window, meeting the hypothesis at a 3:58 cycle time. A final trial addressed abrasive wear drift by checking a reference coupon every 25 brackets to rescale the force map, holding rejects at 2.4 percent over 240 brackets with no drift trend, confirming wear could be tracked without a fixed replacement schedule.

### Line 246

The technological objective was to determine whether burr height on cast A357 aluminum brackets could be estimated from 2D imaging and used to set per-edge contact force on a compliant spindle, holding edge radius within the 0.2-0.5mm edge radius window inside a 4-minute cycle. The hypothesis was largely achieved: two-angle vision and force mapping together met the vision target and came close to the radius target. Final testing on 240 brackets held reject rate at 2.4 percent, well under the 3 percent goal, with no drift trend observed over that run.

A fixed-force, fixed-path approach could not resolve burr variation on these brackets. At 20 newtons on a fixed path, with a baseline cycle time of 3 minutes 10 seconds, rejects reached 14 percent, worse than manual deburring, confirming force must vary edge to edge. The baseline test had already shown removal rate could not be held stable with a single fixed force setting; about two thirds of rejects were leftover burrs, the rest over-rounded edges.

Burr height could be read from 2D images accurately and quickly enough for per-edge control only once shadow was separated from surface reflection using two-angle differencing. GPU-based processing of this two-angle scheme reached 0.07mm RMS at 95ms per edge.

Burr height and required spindle force followed a non-linear relationship with a knee near 0.6mm that appeared repeatable across casting lots. Applied as a force map, this cut rejects to 4.3 percent before a later fix for thin flange chatter closed the remaining gap.

At fiscal year end the team is still running parts in the pilot cell in Bay 4, with no production cell shipped. Cycle time sits at the edge of the 4-minute limit, leaving no room for extra steps. Whether the force map transfers to other alloys or geometries, and whether internal edges hidden from the camera can be estimated, remain open for fiscal 2027.

The project aimed to replace manual deburring with an adaptive system holding edge radius within the 0.2-0.5mm edge radius window. Testing confirmed two-angle differencing plus force mapping could set contact force accurately enough to meet that goal.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 350/350 words, 36/50 lines |
| 242 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The planned customer acceptance run of 1,000 brackets is a commercial qualification event outside the claim period and not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Reuse of the two-angle imaging method in a polishing cell quote is a business development/sales activity, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Adding a second pass on flange edges was a straightforward alternative tried and dropped without new technological learning beyond confirming it underperformed the feed-rate fix; it reflects routine trial of a standard technique rather than resolving a core uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Describing the company's general business and product lines is company background, not a technological claim. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: The characterization of adaptive deburring as a new product line is a business/commercialization statement, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Storyline | applied | none |  | Section matches storyline's uncertainty framing. |
| 242 | Confidence Map: Baseline fixed-force test: 14 percent rejects, 3:10 cycle time. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cycle time for baseline test was 3 minutes 10 seconds. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Single-angle vision error and speed: 0.18 mm RMS at 210 ms per edge. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: 31 of 400 edges in test 2 were overestimated by more than 0.4 mm, all on machined faces, per the test memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Two-angle vision achieved 0.07 mm RMS at 95 ms per edge. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Worst single-edge error in test 3 was 0.19 mm, per the test memo, a detail not mentioned in the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Force map: knee near 0.6 mm burr height, repeatable across all three casting lots within plus or minus 2 N (memo detail beyond interview's general description). | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Force map test: 4.3 percent rejects, 96.1 percent edges in window, 3:50 cycle. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Thin flange deflection measured at up to 0.15 mm under static load above 28 N, per the test memo (not stated in interview). | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Flange fix test: 2.6 percent rejects, 97.8 percent in window, cycle 3:58. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Wear correction test: 2.4 percent rejects, no drift trend over 240 brackets; memo adds quantified wear drift and sleeve life extension not in the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Sleeve life extended from a fixed 100 brackets to about 175 brackets with the wear correction, a detail present only in the memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Reference coupon check adds about 22 seconds every 25 brackets, under 1 second per bracket on average, per the memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Personnel time allocation: controls engineer about 60 percent, manufacturing engineer about half time, technician near full time from October, developer about three months, stated only in the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the force map transfers to other alloys/geometries without a full re-sweep is explicitly unresolved and left open for future work. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is explicitly unresolved. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Internal edges make up about 8 percent of edges on the next bracket family, a forward-looking estimate not yet tested. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: pilot cell in bay 4 | applied | none |  | Pilot cell / Bay 4 not mentioned in section. |
| 242 | Glossary Term: force map | applied | none |  | Force map concept not mentioned in section. |
| 242 | Glossary Term: edge radius window | applied | none |  | Edge radius window concept not mentioned. |
| 242 | Glossary Term: thin flange chatter | applied | none |  | Thin flange chatter concept not mentioned. |
| 242 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept not mentioned. |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Two-angle differencing concept not mentioned. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The Self-check found that the text follows it. |
| 242 | Cover signed-off Summary item ys7bby6cfjt0y6zt59apb05evh8fch8p | applied | none |  | P1 covers company context wording. |
| 242 | Cover signed-off Summary item ys72nxw19p34q5m6tkcfcp9dgx8fc5c5 | applied | none |  | P2 covers goal and problem wording. |
| 242 | Cover signed-off Summary item ys7fztd99z4dp5acht659jqwx98fd30b | applied | none |  | P3 covers passive limitations wording. |
| 242 | Cover signed-off Summary item ys72p18v1tg90nv758wp1tbqs18fdf6g | applied | none |  | P4 covers technological objective wording. |
| 242 | Cover signed-off Summary item ys7enhsngfjb0y86sn4xf81sfn8fcj82 | applied | none | 2 | P5 covers both active uncertainties. |
| 242 | Cover signed-off Summary item ys77hpnrmwce60ynjxt4ccsc118fdhnc | applied | none | 2 | P5 covers force-radius uncertainty and flex. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 685/700 words, 63/100 lines |
| 244 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The planned customer acceptance run of 1,000 brackets is a commercial qualification event outside the claim period and not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Reuse of the two-angle imaging method in a polishing cell quote is a business development/sales activity, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Adding a second pass on flange edges was a straightforward alternative tried and dropped without new technological learning beyond confirming it underperformed the feed-rate fix; it reflects routine trial of a standard technique rather than resolving a core uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Describing the company's general business and product lines is company background, not a technological claim. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: The characterization of adaptive deburring as a new product line is a business/commercialization statement, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: pilot cell in bay 4 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Storyline | not_applied | none |  | Baseline cycle time absent; storyline gives 3:10; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Baseline fixed-force test: 14 percent rejects, 3:10 cycle time. | applied | none |  | P3 states 14 percent rejects at fixed 20N, matches C1 |
| 244 | Confidence Map: Cycle time for baseline test was 3 minutes 10 seconds. | not_applied | missing_fact |  | Baseline cycle time 3:10 never stated; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Single-angle vision error and speed: 0.18 mm RMS at 210 ms per edge. | applied | none |  | P4 states 0.18mm RMS at 210ms, matches C3 |
| 244 | Confidence Map: 31 of 400 edges in test 2 were overestimated by more than 0.4 mm, all on machined faces, per the test memo. | not_applied | missing_fact |  | Drops that all overestimates were on machined faces; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Two-angle vision achieved 0.07 mm RMS at 95 ms per edge. | applied | none |  | P4 states 0.07mm RMS at 95ms, matches C5 |
| 244 | Confidence Map: Worst single-edge error in test 3 was 0.19 mm, per the test memo, a detail not mentioned in the interview. | applied | none |  | Worst single-edge error in test 3 not mentioned |
| 244 | Confidence Map: Force map: knee near 0.6 mm burr height, repeatable across all three casting lots within plus or minus 2 N (memo detail beyond interview's general description). | not_applied | missing_fact |  | States knee flatly without hedging repeatability across lots; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Force map test: 4.3 percent rejects, 96.1 percent edges in window, 3:50 cycle. | applied | none |  | P5 gives 4.3 percent rejects, 96.1 percent in window, matches C8 |
| 244 | Confidence Map: Thin flange deflection measured at up to 0.15 mm under static load above 28 N, per the test memo (not stated in interview). | not_applied | missing_fact |  | Flange deflection measurement (0.15mm) omitted; repaired, then shortened to fit the Line limit, so not re-verified |
| 244 | Confidence Map: Flange fix test: 2.6 percent rejects, 97.8 percent in window, cycle 3:58. | applied | none |  | P5 gives 2.6 percent rejects, 97.8 percent, 3:58, matches C10 |
| 244 | Confidence Map: Wear correction test: 2.4 percent rejects, no drift trend over 240 brackets; memo adds quantified wear drift and sleeve life extension not in the interview. | applied | none |  | P5 states 2.4 percent rejects, no drift, hedges beyond that |
| 244 | Confidence Map: Sleeve life extended from a fixed 100 brackets to about 175 brackets with the wear correction, a detail present only in the memo. | applied | none |  | Sleeve life extension not mentioned in section |
| 244 | Confidence Map: Reference coupon check adds about 22 seconds every 25 brackets, under 1 second per bracket on average, per the memo. | applied | none |  | Reference coupon time overhead not mentioned |
| 244 | Confidence Map: Personnel time allocation: controls engineer about 60 percent, manufacturing engineer about half time, technician near full time from October, developer about three months, stated only in the interview. | applied | none |  | Personnel time allocation not mentioned |
| 244 | Confidence Map: Whether the force map transfers to other alloys/geometries without a full re-sweep is explicitly unresolved and left open for future work. | applied | none |  | Force map transfer question not mentioned in section |
| 244 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is explicitly unresolved. | applied | none |  | Internal edge estimation question not mentioned |
| 244 | Confidence Map: Internal edges make up about 8 percent of edges on the next bracket family, a forward-looking estimate not yet tested. | applied | none |  | Internal edges 8 percent figure not mentioned |
| 244 | Glossary Term: force map | applied | none |  | Uses 'table' instead of 'force map'; repaired to the Glossary Term |
| 244 | Glossary Term: edge radius window | applied | none |  | Uses 'window' instead of 'edge radius window'; repaired to the Glossary Term |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Uses 'flex, loss of contact and chatter' not the term; repaired to the Glossary Term |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior year status mentioned in section. |
| 244 | Cover signed-off Summary item ys76jy6k93b5qg8374n48cvs5d8fdyat | applied | none |  | P1 states the four-step plan and Bay 4 testing. |
| 244 | Cover signed-off Summary item ys7amk7drx48yzbybz2rt3j0sd8fdm2t | applied | none |  | P2 links vision accuracy/speed threshold to radius/reject… |
| 244 | Cover signed-off Summary item ys79m6htjkmz0m5nrhk1epdzbn8fd873 | applied | none |  | P3 gives fixed-force baseline at 20N with 14% rejects. |
| 244 | Cover signed-off Summary item ys7at4bwy30eww81ghef58fg618fcst9 | applied | none |  | P4 gives single-angle setup, 0.18mm RMS at 210ms, glare cause. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The hypothesis linked two measurable thresholds: a vision accuracy and speed target, and a downstream radius and reject..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 350/350 words, 36/50 lines |
| 246 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The planned customer acceptance run of 1,000 brackets is a commercial qualification event outside the claim period and not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Reuse of the two-angle imaging method in a polishing cell quote is a business development/sales activity, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Adding a second pass on flange edges was a straightforward alternative tried and dropped without new technological learning beyond confirming it underperformed the feed-rate fix; it reflects routine trial of a standard technique rather than resolving a core uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Describing the company's general business and product lines is company background, not a technological claim. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: The characterization of adaptive deburring as a new product line is a business/commercialization statement, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: pilot cell in bay 4 | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: thin flange chatter | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Storyline | applied | none |  | Section matches storyline's arc and results |
| 246 | Confidence Map: Baseline fixed-force test: 14 percent rejects, 3:10 cycle time. | not_applied | missing_fact |  | Section says 20N/14%, omits established 3:10 cycle time; repaired (deterministic re-check only; not re-verified by the model) |
| 246 | Confidence Map: Cycle time for baseline test was 3 minutes 10 seconds. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Single-angle vision error and speed: 0.18 mm RMS at 210 ms per edge. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: 31 of 400 edges in test 2 were overestimated by more than 0.4 mm, all on machined faces, per the test memo. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Two-angle vision achieved 0.07 mm RMS at 95 ms per edge. | applied | none |  | 0.07mm RMS at 95ms stated as established fact |
| 246 | Confidence Map: Worst single-edge error in test 3 was 0.19 mm, per the test memo, a detail not mentioned in the interview. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Force map: knee near 0.6 mm burr height, repeatable across all three casting lots within plus or minus 2 N (memo detail beyond interview's general description). | not_applied | missing_fact |  | States knee flatly though memo detail is only partial; repaired (deterministic re-check only; not re-verified by the model) |
| 246 | Confidence Map: Force map test: 4.3 percent rejects, 96.1 percent edges in window, 3:50 cycle. | applied | none |  | 4.3 percent rejects stated matches established figure |
| 246 | Confidence Map: Thin flange deflection measured at up to 0.15 mm under static load above 28 N, per the test memo (not stated in interview). | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Flange fix test: 2.6 percent rejects, 97.8 percent in window, cycle 3:58. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Wear correction test: 2.4 percent rejects, no drift trend over 240 brackets; memo adds quantified wear drift and sleeve life extension not in the interview. | not_applied | missing_fact |  | 2.4 percent stated flatly though wear detail is partial; repaired (deterministic re-check only; not re-verified by the model) |
| 246 | Confidence Map: Sleeve life extended from a fixed 100 brackets to about 175 brackets with the wear correction, a detail present only in the memo. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Reference coupon check adds about 22 seconds every 25 brackets, under 1 second per bracket on average, per the memo. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Personnel time allocation: controls engineer about 60 percent, manufacturing engineer about half time, technician near full time from October, developer about three months, stated only in the interview. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Whether the force map transfers to other alloys/geometries without a full re-sweep is explicitly unresolved and left open for future work. | applied | none |  | Hedged as 'remain open' for fiscal 2027 |
| 246 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is explicitly unresolved. | applied | none |  | Hedged as 'remain open' for fiscal 2027 |
| 246 | Confidence Map: Internal edges make up about 8 percent of edges on the next bracket family, a forward-looking estimate not yet tested. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: burr height estimation | applied | none |  | Concept described differently but term not required |
| 246 | Glossary Term: edge radius window | applied | none |  | Concept present ('in window' implied) without the term; repaired to the Glossary Term |
| 246 | Glossary Term: thin flange chatter | applied | none |  | Thin flange issue named but 'chatter' term omitted; repaired to the Glossary Term |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept not mentioned in the section |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Two lighting angles described, not the term 'two-angle…; repaired to the Glossary Term |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item ys72th9m1cpfs3zz1n5mqpgmdh8fdvpg | applied | none |  | P1 covers hypothesis largely achieved and 2.4% result. |
| 246 | Cover signed-off Summary item ys7343zsggak730yw8c26xd7yx8fctka | applied | none | 2 | P2 covers fixed force 20N baseline, 14% rejects. |
| 246 | Cover signed-off Summary item ys7dr9crh8c3362d6cg1bzhtdn8fdt28 | applied | none | 2 | P2 covers baseline instability and two thirds leftover burrs. |
| 246 | Cover signed-off Summary item ys7d4408dsgxzhhswgnstyhwm98fc99q | applied | none |  | P5 covers pilot cell status and cycle time margin. |
| 246 | Cover signed-off Summary item ys7a92q1r9rh3jgb1srbcs7ezd8fccsx | applied | none |  | P6 restates goal and confirms it was met. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The baseline test showed removal rate could not be held stable with a single fixed force setting. About two thirds of r..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): 246 P1 says the hypothesis 'came close to the radius target' and calls 2.4 percent reject rate the final result, but 244 P5 reports the hypothesis (97 percent of edges in window, sub-3 percent rejects) was actually met at 3:58 cycle time with 97.8 percent in window and 2.6 percent rejects, before the separate wear-drift trial. 246 P1 blends the wear-drift trial's 2.4 percent figure with the radius target discussion in a way that understates that the radius target was already met in 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 6 (sections 244, 246): 246 P6 states testing confirmed the goal was met, which conflicts with P1 and P5 of the same section describing the result as 'largely achieved' and 'close to' target, and with cycle time sitting at the edge of the 4-minute limit; this is an internal inconsistency about whether the target was fully met. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 says the force map's knee near 0.6mm 'appeared repeatable across casting lots' stated as settled fact, but 244 P5 qualifies this as based on 'preliminary comparison across lots' and explicitly says it 'remains to be confirmed by further testing.' 246 drops that uncertainty. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 31.
- Line 244: 0 labels and 0 plan checks "Not checked" of 27.
- Line 246: 0 labels and 0 plan checks "Not checked" of 29.

## Seed-stage numbers

- Requests: 17 metered (15 Batch, 2 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.2 s, p95 25.8 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.3 s, p95 15.3 s over 1.
- Sign-off to report created: 162.9 s.
- Cost from aiUsage: $1.06 in all ($0.41 seed stage, $0.65 Brief, drafting and checks) over 43 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T18:35:22.364Z created project k977zzzvaa530z9gdeyag765b18fct4b
2026-09-30T18:35:23.013Z added document deburring-test-memo.md
2026-09-30T18:35:24.374Z started Step by step generation k57efgm9vf0qq6wxjxstsam7x18fczf4
2026-09-30T18:36:26.049Z seed stage open
2026-09-30T18:36:26.049Z Open Company / Context and wait for its Batch
2026-09-30T18:36:37.963Z Company / Context: select the first Seed
2026-09-30T18:36:39.931Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-09-30T18:36:49.244Z kept Feedback returned 1 Revised Seed(s)
2026-09-30T18:36:49.244Z Company / Context: select the first Revised Seed and untick the original
2026-09-30T18:36:52.535Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-09-30T18:37:01.794Z withdrawn Feedback returned 1 Revised Seed(s)
2026-09-30T18:37:01.794Z Company / Context: withdraw the "withdrawn" Feedback
2026-09-30T18:37:03.093Z Approve Company / Context
2026-09-30T18:37:05.090Z approved company_context
2026-09-30T18:37:05.090Z Open Goal / Problem and wait for its Batch
2026-09-30T18:37:30.304Z Goal / Problem: select the first Seed
2026-09-30T18:37:32.277Z Approve Goal / Problem
2026-09-30T18:37:34.253Z approved goal_problem
2026-09-30T18:37:34.253Z Open Technological limitations and wait for its Batch
2026-09-30T18:37:48.767Z Technological limitations: select the first Seed
2026-09-30T18:37:50.766Z Approve Technological limitations
2026-09-30T18:37:52.872Z approved passive_limitations
2026-09-30T18:37:52.872Z Open Technological objectives and wait for its Batch
2026-09-30T18:38:07.673Z Technological objectives: select the first Seed
2026-09-30T18:38:09.687Z Approve Technological objectives
2026-09-30T18:38:11.661Z approved technological_objective
2026-09-30T18:38:11.661Z Open Technological uncertainties and wait for its Batch
2026-09-30T18:38:27.282Z Technological uncertainties: select the first 2 Seeds
2026-09-30T18:38:30.633Z Approve Technological uncertainties
2026-09-30T18:38:32.642Z approved active_uncertainties
2026-09-30T18:38:32.642Z Skip Previous-year status
2026-09-30T18:38:33.959Z Open Work plan and wait for its Batch
2026-09-30T18:38:51.220Z Work plan: select the first Seed
2026-09-30T18:38:53.188Z Approve Work plan
2026-09-30T18:38:55.216Z approved workplan
2026-09-30T18:38:55.216Z Open Hypothesis and wait for its Batch
2026-09-30T18:39:09.750Z Hypothesis: select the first Seed
2026-09-30T18:39:11.747Z Approve Hypothesis
2026-09-30T18:39:13.726Z approved hypothesis
2026-09-30T18:39:13.726Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T18:39:41.734Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T18:39:45.014Z Approve Experimentation / Iterations
2026-09-30T18:39:47.020Z approved experimentation
2026-09-30T18:39:47.021Z Open Advancement to science / technology and wait for its Batch
2026-09-30T18:40:04.172Z Advancement to science / technology: select the first Seed
2026-09-30T18:40:06.277Z Approve Advancement to science / technology
2026-09-30T18:40:08.381Z approved overall_advancement
2026-09-30T18:40:08.381Z Open Specific technological advancements and wait for its Batch
2026-09-30T18:40:25.735Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T18:40:31.519Z Approve Specific technological advancements
2026-09-30T18:40:33.655Z approved specific_advancements
2026-09-30T18:40:33.655Z Open Project status and next steps and wait for its Batch
2026-09-30T18:40:45.747Z Project status and next steps: select the first Seed
2026-09-30T18:40:47.786Z Approve Project status and next steps
2026-09-30T18:40:49.842Z approved project_status
2026-09-30T18:40:49.842Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T18:41:09.966Z Overall company / project goal improvements: select the first Seed
2026-09-30T18:41:12.010Z Approve Overall company / project goal improvements
2026-09-30T18:41:14.246Z approved goal_improvements
2026-09-30T18:41:14.246Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T18:41:15.608Z signed off; waiting for the report
2026-09-30T18:43:58.559Z report kd7b5pq7qe0mmb5p1dt6j54as98fcpqd created
```
