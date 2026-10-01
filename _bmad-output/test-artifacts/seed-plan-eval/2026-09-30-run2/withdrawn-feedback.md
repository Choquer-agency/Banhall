# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-09-30 on `local` at commit `9de29da9`, acting as e2e-audit@banhall.local. Project `k975zk846drh1qre3q6bzvtnx58fdn1t`, generation `k57cbpt6pggwcsgbe21ks4akx58fc6v9`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: Yes. "Kestrel" appears in 0 later Seeds, 0 plan items and 0 Lines; 0 of 12 later Batches carried it.
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: Yes in every Line: "compliant spindle" 6 times (242: 2, 244: 1, 246: 3), "floating head" 0 times. Subsection 9's Seeds name neither term (the failed heuristic), which is not a breach. Signed-off uncertainty item 5a still reads "floating head force"; Line 242 renders it without the term.
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: Yes. Every figure matches the memo and interview (120 brackets, 20 N, 14 percent; 0.18 mm at 210 ms; 0.07 mm at 95 ms; 60 coupons, 8 to 40 N, 4.3 and 96.1 percent; 28 N, 26 N, 40 to 25 mm/s; 2.6 and 97.8 percent; 2.4 percent over 240 brackets).
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (334, 659, 330).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, medium-high confidence. The contract holds in every Line. Major, recurring (runs 6 and 11): Line 246 paragraph 1 says 97.8 percent and 2.6 percent came "close to but not exceeding the 97 percent and 3 percent targets"; both targets were met, and the same Line says so elsewhere. The Confidence Map's "only approached" hedge about test four is being applied to the final result. Minors: "the test memo indicates" in Line 244; the order of the two flange fixes.

## Automatic checks

12 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd763rkd9adprxc4zg83yfacp98fdbrf |
| All three Sections were drafted | pass | 242: 334 words, 244: 659 words, 246: 330 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (15 Batch, 2 Feedback), 18 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | fail | 0 of 5 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds robotic finishing cells for grinding, sanding, polishing and deburring parts. / Work focuses mostly on aerospace customers with some medical parts as well. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a robotic process to deburr cast A357 aluminium brackets automatically, replacing manual work. / The goal was to hold edge radius within 0.2 to 0.5 millimetres on nearly every edge without over-rounding. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- A fixed force, fixed path robotic cell could not work because one setting either over-rounded small burrs or left large ones. / Burr height varied from about 0.1 to 1.2 millimetres, so a single force setting could not satisfy the whole range. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether burr height could be estimated from 2D images accurately and quickly enough to set contact force per edge. / This knowledge gap existed because nobody had done burr height estimation from 2D on shiny, dull cast aluminium surfaces before. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether a stable, controllable relationship existed linking burr height, force and resulting radius. / No existing model connected burr size, floating head force and the final edge radius achieved. _(cited)_
- The vision outcome was uncertain because the cast aluminium surface was shiny in places and dull in others. / The burr itself was small compared to the part, making reliable 2D estimation an open question. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a staged approach, starting with a fixed force baseline in the pilot cell in Bay 4. / Each step built on the last: vision estimation, then force mapping, then targeted fixes for edge cases. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis names a specific edge-in-window target of at least 97 percent of edges. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Test one used a fixed 20 newton force baseline, giving 14 percent rejects, worse than manual deburring. _(cited)_
  - Tested: uncertainty "It was unclear whether a stable, controllable relationship existed ..."
- A single-angle 2D vision setup gave 0.18 millimetres RMS error and took 210 milliseconds per edge. / Specular reflection on machined faces caused many burrs to be overestimated, so this attempt was dropped. _(cited)_
  - Tested: uncertainty "The vision outcome was uncertain because the cast aluminium surface..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Two-angle imaging cut vision error to 0.07 millimetres RMS at 95 milliseconds per edge, meeting both targets. / The non-linear force map, with a knee near 0.6 millimetres, let force scale correctly with burr height across the range. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Single-angle 2D vision on cast aluminium failed to reach the accuracy or speed target. / The error was 0.18 millimetres RMS at 210 milliseconds per edge, revealing a limit of single-angle imaging. _(cited)_
  - Links: uncertainty "The vision outcome was uncertain because the cast aluminium surface..."; experiments "A single-angle 2D vision setup gave 0.18 millimetres RMS error and ..."
- Test two revealed that specular reflection on machined faces was the main cause of overestimated burr height. / Thirty one of four hundred edges were overestimated by more than 0.4 millimetres, all on machined faces. _(cited)_
  - Links: uncertainty "The vision outcome was uncertain because the cast aluminium surface..."; experiments "A single-angle 2D vision setup gave 0.18 millimetres RMS error and ..."

### 12. Project status and next steps (Section 246, standard): approved

- The project remains active in the pilot cell in Bay 4, with no production cell shipped yet. / The team is running parts close to the cycle time limit, leaving no room for extra steps. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project set out to replace manual deburring with a controlled process holding edge radius within 0.2 to 0.5 millimetres. / The knowledge gained lets the compliant spindle set force per edge from a 2D burr height estimate, meeting that original goal. _(cited)_

## Drafted Sections

### Line 242

The company designs and builds robotic finishing cells for grinding, sanding, polishing and deburring, working mostly with aerospace customers and some medical parts, integrating industrial robotic arms with proprietary tooling, fixturing and control software. This background in force-controlled tooling and vision integration gave the company the operational base to take on an aerospace customer's cast A357 aluminum bracket, previously deburred by hand.

The company sought a robotic process to deburr these cast A357 brackets automatically, replacing the manual operation and its 9% reject rate. The goal was to hold edge radius within the 0.2-0.5 mm edge radius window on nearly every edge, without over-rounding smaller burrs while still removing the largest ones.

The limitations to standard practice were that a fixed-force, fixed-path robotic cell could not work: a force high enough to remove a 1.2 mm burr over-rounded edges carrying only a 0.1 mm burr. No documented method existed for estimating burr height quickly from 2D images on cast aluminum, where surfaces are partly shiny and partly dull and burrs are small relative to the part. No model existed relating burr height, compliant spindle contact force, feed rate, abrasive wear and edge stiffness to the resulting edge radius for this class of casting.

The technological objective was to advance the understanding of real-time 2D vision-based burr height estimation and adaptive force control of a compliant spindle deburring tool, for the purposes of creating a robotic deburring process able to hold edge radius within a tight tolerance window despite variable incoming burr geometry, inside a constrained cycle time.

It was uncertain whether a stable, controllable relationship, a force map linking burr height, contact force and resulting radius, even existed, since no model connected these variables for cast A357 brackets. It was uncertain whether burr height could be estimated reliably from 2D images because the cast aluminum surface was shiny in some areas and dull in others, and the burr was small relative to the part, conditions under which no comparable estimation method had been documented.

### Line 244

The company used a staged approach: fixed-force baseline, then burr height estimation, then force mapping, then targeted fixes for edge cases such as thin flange chatter and abrasive wear drift. The team began by measuring a fixed-force baseline in the pilot cell in Bay 4 to quantify how far standard practice fell short of the edge radius window. Each step built on the last, vision estimation, then force mapping, then targeted fixes for edge cases, isolating each uncertainty before combining them into a working process.

It was hypothesized that if burr height per edge could be estimated from 2D images to within 0.1 mm RMS in under 120 ms per edge, and compliant spindle contact force set from that estimate, then edge radius would stay in window on at least 97 percent of edges and bracket reject rate would fall below 3 percent, within a 4-minute cycle.

Test one used a fixed 20 N force baseline over a fixed tool path, run across 120 brackets. Rejects came in at 14 percent, worse than manual deburring, with most failures from leftover burr on high-burr edges and over-rounding on low-burr edges. This confirmed that no single force setting could serve the full range of burr sizes and that a burr-height-linked force adjustment was required.

The second test checked whether burr height could be estimated fast and accurately enough from 2D images using a single lighting angle. The team imaged 400 edges with a 12MP camera and a low-angle ring light, against laser profiler reference readings. Error came in at 0.18 mm RMS at 210 ms per edge, missing both targets, because specular reflection on machined faces caused many burrs to be overestimated, so this attempt was dropped. This ruled out single-angle 2D imaging and pointed toward a method that could separate reflection from shadow.

Before pursuing that, the team tested a borrowed 3D structured-light camera, reasoning that direct depth measurement might avoid the reflection problem. Depth resolution came in at about 0.2 mm, no better than the 2D result, and capture time ran near 400 ms per edge, slower and with added equipment cost. 3D profiling offered no advantage here, so the team returned to refining 2D imaging.

The team then tested two images per edge, at 15 and 60 degree lighting angles, using two-angle differencing to separate burr shadow from surface reflection, cropped to a CAD-defined region of interest and processed on GPU. On the same 400 edges, error dropped to 0.07 mm RMS at 95 ms per edge, meeting both accuracy and speed targets. Two-angle differencing, not single-angle imaging or 3D profiling, resolved the vision uncertainty.

With vision working, the team checked whether a stable relationship existed between burr height and required contact force. Sixty coupons with burrs from 0.1 to 1.2 mm were run through a force sweep of 8-40 N, mapped into a force map tested on 300 brackets. The relationship proved non-linear, rising steeply above a 0.6 mm knee; applying the force map brought rejects to 4.3 percent with 96.1 percent of edges in window, short of the hypothesis target. The force-radius relationship was real and repeatable, but a further source of error remained.

That error traced to thin, 2.5 mm flange walls, where forces above about 28 N caused thin flange chatter against part deflection. A second pass on those edges was tried first, but capping force at 26 N and slowing feed rate from 40 to 25 mm/s worked better, eliminating chatter and bringing rejects to 2.6 percent with 97.8 percent of edges in window. On flexible features, force had to be traded for dwell time rather than increased.

Finally, the team addressed radius drift from abrasive wear over extended runs, adding a reference coupon check every 25 brackets to rescale the force table. Over 240 brackets, the test memo indicates reject rate held stable at 2.4 percent with no drift trend, suggesting wear could be tracked and corrected without a fixed replacement schedule.

### Line 246

The technological objective was to advance real-time 2D vision-based burr height estimation and adaptive force control of a compliant spindle for deburring cast A357 aerospace brackets. This objective was met. Two-angle imaging cut vision error to 0.07 mm RMS at 95 ms per edge, meeting both targets, and the non-linear force map, with a knee near 0.6 mm, let force scale correctly with burr height across the range. Combined, these results reached 97.8 percent of edges in the edge radius window and 2.6 percent rejects, close to but not exceeding the 97 percent and 3 percent targets.

Single-angle 2D vision on cast aluminum could not reach the accuracy or speed target needed for per-edge force control. The 0.18 mm RMS error at 210 ms per edge revealed a limit of single-angle imaging, traced to specular reflection on machined faces. Thirty one of 400 edges were overestimated by more than 0.4 mm, all on machined faces, confirming reflection as the dominant failure mode. This was resolved by moving to two-angle differencing, separating shadow from reflection and meeting both targets.

The relationship between burr height and required compliant spindle force is non-linear, with a repeatable knee near 0.6 mm, resolving the uncertainty over whether a stable, controllable force-to-radius relationship existed for A357 brackets. This was used to build a force map that scales contact force correctly across the 0.1-1.2 mm burr range.

The project remains active in the pilot cell in Bay 4, with no production cell shipped. Cycle time now runs close to the 4-minute limit, leaving no margin for added steps, which keeps GPU processing time reduction an open question for the next period.

The original goal was to replace manual deburring with a controlled process holding edge radius within the 0.2 to 0.5 mm edge radius window. The knowledge gained lets the compliant spindle set force per edge from a 2D burr height estimate, meeting that goal and cutting rejects from 9 percent under manual deburring to 2.6 percent.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 334/350 words, 35/50 lines |
| 242 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on meeting reject rate targets is a business/commercial arrangement, not technological work | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reuse of the imaging method in a polishing cell sales quote is business development, not the SR&ED work itself | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The upcoming customer acceptance run is a commercial qualification activity outside the systematic investigation | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Planned transfer of the force map to other alloys/titanium is explicitly slated for the next fiscal year, outside this claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Routine verification of the purchased floating head's valve response time is standard engineering checking, not an uncertainty investigation | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Handling short edges by reusing the prior edge's force setting is a simple operational workaround, not a technological finding | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: a357 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: cycle time | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Storyline | applied | none |  | Section matches Storyline background and uncertainty framing |
| 242 | Confidence Map: Two-angle vision result of 0.07mm RMS at 95ms confirmed in both transcript and memo | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Test memo corroborates two-angle vision result with added worst-edge-error detail | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Force map knee near 0.6mm confirmed in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Force map knee corroborated in memo with repeatability across casting lots | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Test five reject rate and edge-in-window figures consistent across transcript and memo | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Final hypothesis target of 97 percent edges in window was not fully met in test four, only approached | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the force map transfers to other alloys and bracket designs without a full re-sweep is unresolved, stated as an open question | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is unresolved | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Single-angle vision failure cause attributed to specular reflection, with quantified detail only in memo | applied | none |  | Section hedges via uncertainty framing, no flat claim |
| 242 | Confidence Map: Abrasive wear drift magnitude given only in memo, not independently quantified in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Sleeve life extension figure appears only in memo | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: floating head | not_applied | none |  | Tool called 'compliant spindle', per Writer Feedback override; repair failed |
| 242 | Glossary Term: force map | applied | none |  | Concept absent; force-radius relationship not called force map; repaired to the Glossary Term |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept absent in this section |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Concept absent in this section |
| 242 | Glossary Term: edge radius window | applied | none |  | Concept present but not named 'edge radius window'; repaired to the Glossary Term |
| 242 | Glossary Term: thin flange chatter | applied | none |  | Concept absent in this section |
| 242 | Cover signed-off Summary item ys7d16c2c7v4h0qcjhewtkn0w98fc45n | applied | none |  | P1 covers company context and focus. |
| 242 | Cover signed-off Summary item ys76j51d85ehg03ye16et8xy2s8fc23c | applied | none |  | P2 states goal and radius window. |
| 242 | Cover signed-off Summary item ys765z5xjj0hwpnn7hyzr3htyh8fdp22 | applied | none |  | P3 states fixed-force limitation and burr range. |
| 242 | Cover signed-off Summary item ys79tyr5gw5hqay92vsqcxzt3n8fdnad | applied | none |  | P4 states technological objective on vision and force. |
| 242 | Cover signed-off Summary item ys7fx7m0j24xw08mkws5c7csqn8fck5w | applied | none | 2 | P5 states uncertainty on force-radius relationship. |
| 242 | Cover signed-off Summary item ys7aqg8d80se03hv4k5bf6j2j58fdc29 | applied | none | 2 | P5 states vision estimation uncertainty on cast surface. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 659/700 words, 65/100 lines |
| 244 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on meeting reject rate targets is a business/commercial arrangement, not technological work | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reuse of the imaging method in a polishing cell sales quote is business development, not the SR&ED work itself | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The upcoming customer acceptance run is a commercial qualification activity outside the systematic investigation | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Planned transfer of the force map to other alloys/titanium is explicitly slated for the next fiscal year, outside this claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Routine verification of the purchased floating head's valve response time is standard engineering checking, not an uncertainty investigation | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Handling short edges by reusing the prior edge's force setting is a simple operational workaround, not a technological finding | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 7) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 9) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Storyline | applied | none |  | Sequence and figures match Storyline throughout |
| 244 | Confidence Map: Two-angle vision result of 0.07mm RMS at 95ms confirmed in both transcript and memo | applied | none |  | P6 states established 0.07mm/95ms result flatly |
| 244 | Confidence Map: Test memo corroborates two-angle vision result with added worst-edge-error detail | applied | none |  | Consistent with established two-angle result in P6 |
| 244 | Confidence Map: Force map knee near 0.6mm confirmed in transcript | applied | none |  | P7 states 0.6mm knee, matches established fact |
| 244 | Confidence Map: Force map knee corroborated in memo with repeatability across casting lots | applied | none |  | Knee repeatability established, stated flatly in P7 |
| 244 | Confidence Map: Test five reject rate and edge-in-window figures consistent across transcript and memo | applied | none |  | Reject/in-window figures for test five stated in P8 |
| 244 | Confidence Map: Final hypothesis target of 97 percent edges in window was not fully met in test four, only approached | applied | none |  | P7 hedges with 'short of the hypothesis target' |
| 244 | Confidence Map: Whether the force map transfers to other alloys and bracket designs without a full re-sweep is unresolved, stated as an open question | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is unresolved | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Single-angle vision failure cause attributed to specular reflection, with quantified detail only in memo | applied | none |  | P4 states reflection cause without overclaiming certainty level |
| 244 | Confidence Map: Abrasive wear drift magnitude given only in memo, not independently quantified in transcript | not_applied | missing_fact |  | P9 states wear held stable flatly, partial evidence only; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Sleeve life extension figure appears only in memo | applied | none |  | Sleeve life figure not mentioned in the section |
| 244 | Glossary Term: a357 | applied | none |  | A357 alloy concept not mentioned in section |
| 244 | Glossary Term: cycle time | applied | none |  | '4-minute cycle' present, matches term 'cycle time' concept… |
| 244 | Glossary Term: force map | applied | none |  | P7 uses 'lookup table' instead of 'force map'; repaired to the Glossary Term |
| 244 | Glossary Term: burr height estimation | applied | none |  | Section says 'burr height could be estimated' not the term; repaired to the Glossary Term |
| 244 | Glossary Term: edge radius window | applied | none |  | Section says '0.2-0.5 mm window' not 'edge radius window'; repaired to the Glossary Term |
| 244 | Glossary Term: thin flange chatter | applied | none |  | P1 uses 'thin-flange chatter' verbatim variant of term |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status content present. |
| 244 | Cover signed-off Summary item ys7e74hk9rbx571mvb47g1bnn18fcxch | applied | none |  | P1 states staged approach with Bay 4 baseline and step order. |
| 244 | Cover signed-off Summary item ys79pbb2fwe2qfjcqycj3c5hp98fc45a | applied | none |  | P2 states 97 percent edge-in-window hypothesis target. |
| 244 | Cover signed-off Summary item ys7etfj44j87zrg49fm5rsqh7h8fcd49 | applied | none |  | P3 gives 20N baseline test, 14 percent rejects, worse than… |
| 244 | Cover signed-off Summary item ys7fajcwxbp1rsvtjhpb94eyad8fdbdq | applied | none |  | P4 gives 0.18mm RMS, 210ms, specular reflection cause. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a staged approach, starting with a fixed force baseline in the pilot cell in Bay 4. Each step built on..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 7 (sections 244, 246): 244 P7 states the force map test on 300 brackets brought rejects to 4.3 percent with 96.1 percent of edges in window (before the flange chatter fix). 246 P1 and P5 report the final combined result as 97.8 percent in window and 2.6 percent rejects, which matches 244 P8, not P7. Read alone, 246 P1's phrase 'the non-linear force map... let force scale correctly... Combined, these results reached 97.8 percent' could be misread as the force map alone reaching that figure, but the actual improvement to 97.8 percent came only after the flange chatter fix in 244 P8. This should be checked so 246 does not appear to contradict the staged results in 244. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 330/350 words, 33/50 lines |
| 246 | Claim Exclusion: Customer's agreement to purchase a production cell contingent on meeting reject rate targets is a business/commercial arrangement, not technological work | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reuse of the imaging method in a polishing cell sales quote is business development, not the SR&ED work itself | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The upcoming customer acceptance run is a commercial qualification activity outside the systematic investigation | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Planned transfer of the force map to other alloys/titanium is explicitly slated for the next fiscal year, outside this claim period | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Routine verification of the purchased floating head's valve response time is standard engineering checking, not an uncertainty investigation | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Handling short edges by reusing the prior edge's force setting is a simple operational workaround, not a technological finding | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: a357 | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: cycle time | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: burr height estimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Storyline | applied | none |  | Section matches storyline results and framing |
| 246 | Confidence Map: Two-angle vision result of 0.07mm RMS at 95ms confirmed in both transcript and memo | applied | none |  | P1 states established 0.07mm/95ms figure flatly |
| 246 | Confidence Map: Test memo corroborates two-angle vision result with added worst-edge-error detail | applied | none |  | Not mentioned; worst-edge detail not stated |
| 246 | Confidence Map: Force map knee near 0.6mm confirmed in transcript | applied | none |  | P3 states established knee near 0.6mm |
| 246 | Confidence Map: Force map knee corroborated in memo with repeatability across casting lots | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Test five reject rate and edge-in-window figures consistent across transcript and memo | applied | none |  | P1 gives reject/edge figures consistent with memo |
| 246 | Confidence Map: Final hypothesis target of 97 percent edges in window was not fully met in test four, only approached | applied | none |  | P1 hedges 'close to but not exceeding' target |
| 246 | Confidence Map: Whether the force map transfers to other alloys and bracket designs without a full re-sweep is unresolved, stated as an open question | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Whether burr height can be estimated on internal edges not visible to the camera is unresolved | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Single-angle vision failure cause attributed to specular reflection, with quantified detail only in memo | applied | none |  | P2 states specular reflection cause, hedged as traced |
| 246 | Confidence Map: Abrasive wear drift magnitude given only in memo, not independently quantified in transcript | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Sleeve life extension figure appears only in memo | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept not mentioned in section |
| 246 | Glossary Term: edge radius window | applied | none |  | P5 uses 'edge radius within 0.2 to 0.5 mm' not the term; repaired to the Glossary Term |
| 246 | Glossary Term: thin flange chatter | applied | none |  | Thin flange chatter concept not mentioned in section |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item ys76bfwy4jb3vq5andx85mggrn8fc5x5 | applied | none |  | P1 states both results meeting targets as planned. |
| 246 | Cover signed-off Summary item ys7fcdasv3j0agm5gets28cxb58fcxgy | applied | none | 2 | P2 gives 0.18 mm RMS, 210 ms, failure to meet target. |
| 246 | Cover signed-off Summary item ys7cg938dtzx791jqm6n6ca4558fcvyp | applied | none | 2 | P2 gives 31 of 400 edges overestimated, reflection cause. |
| 246 | Cover signed-off Summary item ys739w4gcv3avph05d7r582gm98fd7ww | applied | none |  | P4 states pilot cell status, no production cell shipped. |
| 246 | Cover signed-off Summary item ys77tpztsyqxnrhz5p7467zfr98fd8vt | applied | none |  | P5 restates original goal and how it was met. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claimed results trace to Line 242 uncertainties or plan… |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 says cycle time now runs close to the 4-minute limit, but 244 does not report a final combined cycle time figure anywhere, only per-edge timings (95 ms per edge for imaging). There is no paragraph in 244 establishing an overall cycle time result, so 246's claim about being close to the 4-minute limit is not supported by, and cannot be checked against, any stated figure in 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): 246 P2 states 'Thirty one of 400 edges were overestimated by more than 0.4 mm, all on machined faces,' a specific figure not present anywhere in 244 P4, which only reports the aggregate 0.18 mm RMS error at 210 ms per edge. This specific breakdown appears without support from the work performed section. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 24.
- Line 244: 0 labels and 0 plan checks "Not checked" of 24.
- Line 246: 0 labels and 0 plan checks "Not checked" of 22.

## Seed-stage numbers

- Requests: 17 metered (15 Batch, 2 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 10.9 s, p95 23.7 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.9 s, p95 15.9 s over 1.
- Sign-off to report created: 136.9 s.
- Cost from aiUsage: $1.05 in all ($0.39 seed stage, $0.66 Brief, drafting and checks) over 44 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T21:06:54.550Z created project k975zk846drh1qre3q6bzvtnx58fdn1t
2026-09-30T21:06:55.214Z added document deburring-test-memo.md
2026-09-30T21:06:56.535Z started Step by step generation k57cbpt6pggwcsgbe21ks4akx58fc6v9
2026-09-30T21:07:42.278Z seed stage open
2026-09-30T21:07:42.278Z Open Company / Context and wait for its Batch
2026-09-30T21:07:51.719Z Company / Context: select the first Seed
2026-09-30T21:07:53.694Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-09-30T21:08:02.954Z kept Feedback returned 1 Revised Seed(s)
2026-09-30T21:08:02.954Z Company / Context: select the first Revised Seed and untick the original
2026-09-30T21:08:06.290Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-09-30T21:08:12.897Z withdrawn Feedback returned 1 Revised Seed(s)
2026-09-30T21:08:12.897Z Company / Context: withdraw the "withdrawn" Feedback
2026-09-30T21:08:14.215Z Approve Company / Context
2026-09-30T21:08:16.234Z approved company_context
2026-09-30T21:08:16.234Z Open Goal / Problem and wait for its Batch
2026-09-30T21:08:30.648Z Goal / Problem: select the first Seed
2026-09-30T21:08:32.609Z Approve Goal / Problem
2026-09-30T21:08:34.618Z approved goal_problem
2026-09-30T21:08:34.618Z Open Technological limitations and wait for its Batch
2026-09-30T21:08:49.116Z Technological limitations: select the first Seed
2026-09-30T21:08:51.097Z Approve Technological limitations
2026-09-30T21:08:53.052Z approved passive_limitations
2026-09-30T21:08:53.053Z Open Technological objectives and wait for its Batch
2026-09-30T21:09:18.151Z Technological objectives: select the first Seed
2026-09-30T21:09:20.085Z Approve Technological objectives
2026-09-30T21:09:22.093Z approved technological_objective
2026-09-30T21:09:22.094Z Open Technological uncertainties and wait for its Batch
2026-09-30T21:09:36.580Z Technological uncertainties: select the first 2 Seeds
2026-09-30T21:09:39.865Z Approve Technological uncertainties
2026-09-30T21:09:41.936Z approved active_uncertainties
2026-09-30T21:09:41.936Z Skip Previous-year status
2026-09-30T21:09:43.283Z Open Work plan and wait for its Batch
2026-09-30T21:10:01.424Z Work plan: select the first Seed
2026-09-30T21:10:03.544Z Approve Work plan
2026-09-30T21:10:05.659Z approved workplan
2026-09-30T21:10:05.659Z Open Hypothesis and wait for its Batch
2026-09-30T21:10:20.503Z Hypothesis: select the first Seed
2026-09-30T21:10:22.480Z Approve Hypothesis
2026-09-30T21:10:24.471Z approved hypothesis
2026-09-30T21:10:24.471Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T21:10:49.940Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T21:10:53.371Z Approve Experimentation / Iterations
2026-09-30T21:10:55.334Z approved experimentation
2026-09-30T21:10:55.334Z Open Advancement to science / technology and wait for its Batch
2026-09-30T21:11:10.206Z Advancement to science / technology: select the first Seed
2026-09-30T21:11:12.155Z Approve Advancement to science / technology
2026-09-30T21:11:14.150Z approved overall_advancement
2026-09-30T21:11:14.150Z Open Specific technological advancements and wait for its Batch
2026-09-30T21:11:31.259Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T21:11:36.497Z Approve Specific technological advancements
2026-09-30T21:11:38.494Z approved specific_advancements
2026-09-30T21:11:38.494Z Open Project status and next steps and wait for its Batch
2026-09-30T21:11:52.992Z Project status and next steps: select the first Seed
2026-09-30T21:11:54.939Z Approve Project status and next steps
2026-09-30T21:11:56.882Z approved project_status
2026-09-30T21:11:56.882Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T21:12:11.370Z Overall company / project goal improvements: select the first Seed
2026-09-30T21:12:13.344Z Approve Overall company / project goal improvements
2026-09-30T21:12:15.302Z approved goal_improvements
2026-09-30T21:12:15.302Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T21:12:16.612Z signed off; waiting for the report
2026-09-30T21:14:34.793Z report kd763rkd9adprxc4zg83yfacp98fdbrf created
```
