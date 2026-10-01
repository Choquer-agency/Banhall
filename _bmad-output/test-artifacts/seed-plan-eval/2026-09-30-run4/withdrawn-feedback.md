# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-09-30 on `local` at commit `e8112000`, acting as e2e-audit@banhall.local. Project `k973zf626q9d3a97eqw3pamwsh8ffkgy`, generation `k578hh9anbk7exq5mmnnzmftn58ffamn`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: Yes. "Kestrel" is in 0 later Seeds, 0 plan items and 0 Lines; 0 of the later Batches carried it.
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: Yes. "compliant spindle" in every Line, "floating head" 0 times; the term rows record the Feedback governing it. One Subsection 9 Seed says "compliant spindle", none "floating head".
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: Yes. Every figure matches the memo and interview (20 N, 120 brackets, 14 percent, 3:10; 0.18 mm at 210 ms; 0.07 mm at 95 ms; 60 coupons, 8 to 40 N, knee near 0.6 mm; 4.3 and 96.1 percent; 28 and 26 N, 40 to 25 mm/s; 2.6 and 97.8 percent, 3:58; 2.4 percent over 240 brackets).
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (318, 631, 334).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (high confidence). Run 12's minors are fixed. Minors: Line 244 paragraph 1 calls the 2D estimation objective an uncertainty; "met the goal" runs slightly ahead of the pending acceptance run; checker noise in targets rows.

## Automatic checks

13 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7162yq07d9yb75x95vwfntcn8fe01z |
| All three Sections were drafted | pass | 242: 318 words, 244: 631 words, 246: 334 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED; hypothesis prefetch: INVALID_OUTPUT, answer 1: 0 of 4 valid, needed 3 (BULLET_TOO_LONG x4, INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 2 of 4 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All described work matches Line 242 uncertainties and COVER…"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P5 calls a 96.1% result 'missing' target, correct; but 3:58…"); 246: applied, repaired ("All targets stated correctly as met with matching direction…") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (17 Batch, 2 Feedback), 20 reserved; notice not shown; 1 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 13 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | pass | 1 of 5 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- Client is a 45-person robotic finishing cell builder located in Grandbois, Quebec. / The company designs and builds robotic finishing cells for aerospace and medical parts, using the compliant spindle as its deburring tool. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a robotic finishing cell that could deburr cast A357 aerospace brackets with varying burr heights. / The goal was to replace manual deburring and fixed-force robotic cells that could not meet the edge radius spec. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No one else had estimated burr height from 2D images on shiny, dull cast aluminium surfaces. / Standard 3D laser profiling gave accurate burr height but took about 90 seconds per bracket, too slow for the 4 minute cycle. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to know whether burr height per edge could be estimated from 2D camera images on cast aluminium. / This knowledge was meant to enable per-edge force control on the compliant spindle without a slow 3D scan. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- The relationship between burr, force and resulting radius had no existing model to draw on. / It was uncertain whether a stable relationship existed given that edge stiffness varies across the bracket. _(cited)_
- A fixed-force, fixed-path cell could not satisfy both ends of the burr height range at once. / Setting force to clear the largest burr over-rounded small-burr edges, and a lower setting left burrs behind. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a staged test sequence in the pilot cell in Bay 4 to address both open uncertainties together. / Steps moved from a fixed-force baseline through vision development to a force map and long run validation. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a fixed force setting cannot serve both large and small burrs, then a per-edge variable force should resolve that conflict. / The hypothesis tests whether varying contact force by edge removes the over-round versus leftover burr trade-off. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- A fixed-force baseline of 20 newtons on 120 brackets gave 14 percent rejects at a 3:10 cycle. / This confirmed the fixed-force cell was worse than hand deburring, leaving large burrs or over-rounding small ones. _(cited)_
  - Tested: uncertainty "A fixed-force, fixed-path cell could not satisfy both ends of the b..."
- The team built a force-versus-burr map from 60 coupons swept from 8 to 40 newtons. / The relationship proved non-linear, needing about 10 to 22 newtons up to a 0.6 millimetre knee, then up to 34 newtons at 1.2 millimetres. _(cited)_
  - Tested: uncertainty "The relationship between burr, force and resulting radius had no ex..."

### 10. Advancement to science / technology (Section 246, standard): approved

- A stable, non-linear relationship between burr height, force and radius was mapped for A357, resolving the no-model uncertainty. / The knee near 0.6 millimetres repeated across all three casting lots within plus or minus 2 newtons. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The fixed-force baseline test confirmed a single force setting cannot clear large burrs without over-rounding small ones. / This finding showed that per-edge variable force control was necessary rather than a tuning adjustment to the fixed-force cell. _(cited)_
  - Links: uncertainty "A fixed-force, fixed-path cell could not satisfy both ends of the b..."; experiments "A fixed-force baseline of 20 newtons on 120 brackets gave 14 percen..."
- The baseline test showed most rejects came from leftover burrs on high-burr edges or over-rounding on small-burr edges. / This confirmed the fixed-force, fixed-path approach was worse than hand deburring at 14 percent rejects. _(cited)_
  - Links: uncertainty "A fixed-force, fixed-path cell could not satisfy both ends of the b..."; experiments "A fixed-force baseline of 20 newtons on 120 brackets gave 14 percen..."

### 12. Project status and next steps (Section 246, standard): approved

- No production cell has shipped yet, and work remains in the pilot cell in Bay 4. / The compliant spindle method is still being validated on brackets from ongoing casting lots. _(writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project goal of replacing fixed-force deburring was met by linking 2D vision estimates to per-edge compliant spindle force. _(cited)_

## Drafted Sections

### Line 242

Tessrow Robotics Corp. is a 45-person robotic finishing cell builder in Grandbois, Quebec, designing and building cells for aerospace and medical parts around a compliant spindle as the deburring tool. That background in force-controlled finishing for precision aerospace components put the company in position to take on a deburring problem that manual labor and standard robotic cells could not solve.

The company sought a robotic finishing cell able to deburr cast A357 aerospace brackets carrying burr heights from 0.1 to 1.2 mm across 38 edges, holding edge radius to a 0.2 to 0.5 mm spec within a 4 minute cycle. The goal was to replace manual deburring, which still left a 9% reject rate, and to improve on fixed-force robotic cells that could not meet the edge radius spec across that burr range.

The limitations to standard practice were that no one had estimated burr height from 2D images on cast aluminum surfaces that are shiny in some areas and dull in others, with burrs small relative to the part. Standard 3D laser profiling produced accurate burr height readings but took about 90 seconds per bracket, too slow to fit a 4 minute cycle.

The technological objective was to advance the understanding of per-edge burr height estimation from 2D camera images on cast aluminum, for the purpose of driving per-edge force control on the compliant spindle without relying on a slow 3D scan.

No existing model related burr height, applied force, edge stiffness and resulting edge radius, so it was uncertain whether a stable, controllable relationship even existed, given that edge stiffness varies across the bracket's geometry. It was also uncertain whether a single force setting could ever satisfy both ends of the burr range at once: a force high enough to clear a 1.2 mm burr risked over-rounding edges carrying only a 0.1 mm burr, while a lower setting risked leaving burrs behind on the larger ones.

### Line 244

The technological problem required solving two linked uncertainties in the pilot cell in Bay 4: whether burr height on cast A357 brackets could be estimated from 2D images fast and accurately enough to drive per-edge force control, and whether a stable relationship existed between burr height, compliant spindle contact force and resulting edge radius. The team planned a staged test sequence in the pilot cell in Bay 4 to address both open uncertainties together. Steps moved from a fixed-force baseline through vision development to a force map and long run validation, each step built on the findings of the one before it.

It was hypothesized that if a fixed force setting could not serve both large and small burrs, then a per-edge variable force should resolve that conflict. The hypothesis tested whether varying contact force by edge could remove the over-round versus leftover-burr trade-off that a single force setting could not escape. Specifically, if burr height per edge was estimated from 2D images to within 0.1 mm RMS in under 120 ms, and that estimate set compliant spindle force, then edge radius would hold in the 0.2 to 0.5 mm window on at least 97% of edges, with bracket rejects below 3%, inside a 4 minute cycle.

The team first ran a fixed-force baseline to quantify how far a standard cell fell short. A fixed-force baseline of 20 N on 120 brackets gave a 14% reject rate at a 3:10 cycle. This confirmed the fixed-force cell was worse than hand deburring, leaving large burrs behind on high-burr edges or over-rounding edges where burrs were small. The result confirmed that a single force setting could not satisfy both ends of the burr range at once, and that per-edge variable force control, not a tuning adjustment to the fixed-force cell, was required to proceed.

With that direction set, the team turned to burr height estimation. A single-angle 2D camera setup tested on 400 edges gave 0.18 mm RMS error at 210 ms per edge, missing both the accuracy and speed targets. Specular reflection on machined faces was causing burrs to read taller than they were. A borrowed structured-light 3D camera was tested as an alternative and gave no better depth resolution (about 0.2 mm) while taking about 400 ms per capture, so the team returned to 2D. Capturing two images per edge at two lighting angles, differencing them to separate burr shadow from face reflection, and moving processing to GPU with cropped regions of interest brought error to 0.07 mm RMS at 95 ms per edge, meeting both targets and confirming that reflection could be separated from burr shadow by angle-dependent differencing.

The team built a force-versus-burr map from 60 coupons swept from 8 to 40 N. The relationship proved non-linear, needing about 10 to 22 N up to a 0.6 mm knee, then rising faster to about 34 N at 1.2 mm. Applied to 300 brackets, this brought rejects to 4.3%, with 96.1% of edges in the radius window, missing the 97% target for that test. Investigating the shortfall showed most failures were on thin flanges, where force above about 28 N caused flexing and chatter. Capping force at 26 N and slowing feed from 40 to 25 mm/s on thin flanges, rather than adding a second pass, eliminated the chatter and brought 360 brackets to a 2.6% reject rate with 97.8% of edges in window, meeting the hypothesis targets, at a cycle time of 3:58, within but close to the 4 minute limit. A final test introduced a reference coupon check every 25 brackets to correct for abrasive wear; without it, radius drifted smaller, while with the correction, 240 brackets held a 2.4% reject rate with no drift trend, confirming that periodic recalibration could manage wear without a fixed replacement schedule.

### Line 246

The technological objective was to advance understanding of per-edge burr height estimation from 2D camera images on cast A357 aluminum, to drive per-edge force control on the compliant spindle. This objective was achieved, and the hypothesis was proven in its final form after an intermediate partial result. Burr height was estimated to 0.07 mm RMS at 95 ms per edge, meeting the 0.1 mm and 120 ms targets, and the resulting process held 97.8% of edges within the radius window at 2.6% rejects, meeting the 97% and 3% targets, with cycle time at 3:58 against the 4 minute limit.

A stable, non-linear relationship exists between burr height, compliant spindle force and edge radius for A357 castings, with a knee near 0.6 mm burr height that repeated across three casting lots within plus or minus 2 N. This resolved the open question of whether any controllable relationship existed between burr height, force and radius across normal casting variation, and it was applied to build a force map driving per-edge contact force from the vision estimate rather than a single fixed setting.

The baseline test confirmed that a single force setting cannot satisfy both ends of the 0.1 to 1.2 mm burr range at once: clearing a 1.2 mm burr over-rounds a 0.1 mm edge, and a lower setting leaves burrs behind. At 20 N fixed force, 14% of 120 brackets were rejected at a 3:10 cycle, with most rejects coming from leftover burrs on high-burr edges or over-rounding on small-burr edges. This confirmed the fixed-force, fixed-path approach was worse than hand deburring, and that per-edge variable force, not a tuning adjustment, was required.

Work remains in the pilot cell in Bay 4; no production cell has shipped, and the compliant spindle method is still being validated on brackets from ongoing casting lots.

Linking 2D vision estimates to per-edge compliant spindle force met the goal of replacing fixed-force deburring, holding edge radius in spec within the 4 minute cycle where manual and fixed-force methods could not.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 318/350 words, 32/50 lines |
| 242 | Claim Exclusion: Customer's agreement to buy a production cell contingent on an acceptance run is a business/commercial arrangement, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reusing the two-angle imaging in a polishing cell quote is a commercial/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Checking the floating head's valve response time against edge length was a routine engineering verification, not an uncertain investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Using the force from the previous edge or the higher of two forces on short edges is a routine operational rule, not a technological advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The planned customer acceptance run in October 2026 falls outside the fiscal 2026 claim period (July 1 2025 to June 30 2026). | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Transfer of the force map to other alloys/bracket designs and internal-edge imaging are planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: edge radius | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section aligns with Storyline facts and uncertainties. |
| 242 | Confidence Map: Transcript and memo agree on the hypothesis wording and targets (0.1 mm RMS, 120 ms, 97 percent edges, 3 percent rejects, 4 minute cycle). | applied | none |  | Not mentioned; section covers uncertainty, not hypothesis. |
| 242 | Confidence Map: Baseline test results (14 percent rejects, 3:10 cycle) are confirmed in both transcript and memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Two-angle vision results (0.07 mm RMS, 95 ms/edge) are confirmed in both transcript and memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Force map test 4 result of 96.1 percent edges in window, just short of the 97 percent target, is established but represents a partial result relative to the hypothesis. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Test 5 flange fix results (2.6 percent rejects, 97.8 percent in window) meet the hypothesis targets and are confirmed in both sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cycle time in test 5 (3:58) is right at the 4 minute limit, an acknowledged margin concern. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The knee in the force-burr relationship near 0.6 mm was repeatable across casting lots within a stated tolerance, per the memo. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Second-pass approach on flanges was tried and dropped for giving worse rejects (3.9 percent) than the feed-slowing fix. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the vision/force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved and left open. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Sleeve/abrasive life extension figure from fixed 100 to about 175 brackets is reported only in the memo, not corroborated in the transcript's discussion of wear correction. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The flange deflection magnitude (up to 0.15 mm under static load) is reported only in the memo as a distinct measurement method, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: pilot cell in bay 4 | applied | none |  | Concept not mentioned in the section. |
| 242 | Glossary Term: abrasive wear | applied | none |  | Concept not mentioned in the section. |
| 242 | Glossary Term: thin flange | applied | none |  | Concept not mentioned; no chatter/flange discussion here. |
| 242 | Glossary Term: force map | applied | none |  | Concept not mentioned in the section. |
| 242 | Glossary Term: reference coupon | applied | none |  | Concept not mentioned in the section. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The Self-check found that the text follows it. |
| 242 | Cover signed-off Summary item ys71x46w3wxvr8xvhwy13zc3358fezmf | applied | none |  | P1 states size, location, and spindle-based finishing cells. |
| 242 | Cover signed-off Summary item ys7beqrfsx0fjm7hacy1m2dm4x8ff1qx | applied | none |  | P2 states the goal and both limitations it replaces. |
| 242 | Cover signed-off Summary item ys7fx7zkqs1ynnd98kv6b06k2x8ff3fg | applied | none |  | P3 covers 2D limitation and slow 3D profiling. |
| 242 | Cover signed-off Summary item ys7daxnepyyenk20c6bts9x6r58ff7vz | applied | none |  | P4 states the objective verbatim in substance. |
| 242 | Cover signed-off Summary item ys77c9bcp144pwdaha0gr4e3sn8ffa2r | applied | none | 2 | P5 states no model existed and stiffness uncertainty. |
| 242 | Cover signed-off Summary item ys766f7yzn2zx8s1ysbyhz4m0d8ffx7n | applied | none | 2 | P5 states the single-force-setting dilemma clearly. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company sought a robotic finishing cell that could deburr cast A357 aerospace brackets with varying burr heights. T..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 631/700 words, 55/100 lines |
| 244 | Claim Exclusion: Customer's agreement to buy a production cell contingent on an acceptance run is a business/commercial arrangement, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reusing the two-angle imaging in a polishing cell quote is a commercial/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Checking the floating head's valve response time against edge length was a routine engineering verification, not an uncertain investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Using the force from the previous edge or the higher of two forces on short edges is a routine operational rule, not a technological advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The planned customer acceptance run in October 2026 falls outside the fiscal 2026 claim period (July 1 2025 to June 30 2026). | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Transfer of the force map to other alloys/bracket designs and internal-edge imaging are planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: pilot cell in bay 4 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: edge radius | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: abrasive wear | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: thin flange | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches storyline dates, figures and narrative. |
| 244 | Confidence Map: Transcript and memo agree on the hypothesis wording and targets (0.1 mm RMS, 120 ms, 97 percent edges, 3 percent rejects, 4 minute cycle). | applied | none |  | Hypothesis wording matches established figures. |
| 244 | Confidence Map: Baseline test results (14 percent rejects, 3:10 cycle) are confirmed in both transcript and memo. | applied | none |  | Baseline 14% rejects, 3:10 cycle stated flatly as established. |
| 244 | Confidence Map: Two-angle vision results (0.07 mm RMS, 95 ms/edge) are confirmed in both transcript and memo. | applied | none |  | 0.07mm RMS at 95ms stated flatly, matches established. |
| 244 | Confidence Map: Force map test 4 result of 96.1 percent edges in window, just short of the 97 percent target, is established but represents a partial result relative to the hypothesis. | applied | none |  | 96.1% called short of 97% target, matches partial status. |
| 244 | Confidence Map: Test 5 flange fix results (2.6 percent rejects, 97.8 percent in window) meet the hypothesis targets and are confirmed in both sources. | applied | none |  | 2.6% rejects, 97.8% in window stated as meeting targets. |
| 244 | Confidence Map: Cycle time in test 5 (3:58) is right at the 4 minute limit, an acknowledged margin concern. | not_applied | missing_fact |  | 3:58 cycle stated flatly without noting margin concern.; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: The knee in the force-burr relationship near 0.6 mm was repeatable across casting lots within a stated tolerance, per the memo. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Second-pass approach on flanges was tried and dropped for giving worse rejects (3.9 percent) than the feed-slowing fix. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Whether the vision/force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved and left open. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Sleeve/abrasive life extension figure from fixed 100 to about 175 brackets is reported only in the memo, not corroborated in the transcript's discussion of wear correction. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: The flange deflection magnitude (up to 0.15 mm under static load) is reported only in the memo as a distinct measurement method, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status content appears in section. |
| 244 | Cover signed-off Summary item ys7ajwpj0w5s3eecfn5pndk57s8feawr | applied | none |  | P1 states the staged test sequence plan verbatim. |
| 244 | Cover signed-off Summary item ys79tp9gz0cg4w76w8w1w55r7n8feptf | applied | none |  | P2 states hypothesis of per-edge variable force resolving… |
| 244 | Cover signed-off Summary item ys73e1sef7mf2kdvys6ta5adxd8ff1ka | applied | none |  | P3 gives baseline 14% reject rate and confirms worse than… |
| 244 | Cover signed-off Summary item ys71ja7m7zffbncxmjfjq5vg1h8ffhcw | applied | none |  | P5 states force-burr map and non-linear relation with figures. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P5 calls a 96.1% result 'missing' target, correct; but 3:58… |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All described work matches Line 242 uncertainties and COVER… |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned a staged test sequence in the pilot cell in Bay 4 to address both open uncertainties together. Steps m..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 334/350 words, 33/50 lines |
| 246 | Claim Exclusion: Customer's agreement to buy a production cell contingent on an acceptance run is a business/commercial arrangement, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reusing the two-angle imaging in a polishing cell quote is a commercial/sales activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Checking the floating head's valve response time against edge length was a routine engineering verification, not an uncertain investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Using the force from the previous edge or the higher of two forces on short edges is a routine operational rule, not a technological advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The planned customer acceptance run in October 2026 falls outside the fiscal 2026 claim period (July 1 2025 to June 30 2026). | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Transfer of the force map to other alloys/bracket designs and internal-edge imaging are planned for fiscal 2027, outside this claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pilot cell in bay 4 | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: edge radius | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches storyline facts and sequence. |
| 246 | Confidence Map: Transcript and memo agree on the hypothesis wording and targets (0.1 mm RMS, 120 ms, 97 percent edges, 3 percent rejects, 4 minute cycle). | applied | none |  | Targets stated match C1 figures exactly. |
| 246 | Confidence Map: Baseline test results (14 percent rejects, 3:10 cycle) are confirmed in both transcript and memo. | applied | none |  | 14% rejects, 3:10 cycle stated as established. |
| 246 | Confidence Map: Two-angle vision results (0.07 mm RMS, 95 ms/edge) are confirmed in both transcript and memo. | applied | none |  | 0.07mm RMS/95ms stated flatly, matches established. |
| 246 | Confidence Map: Force map test 4 result of 96.1 percent edges in window, just short of the 97 percent target, is established but represents a partial result relative to the hypothesis. | applied | none |  | Partial 96.1% result not mentioned in section. |
| 246 | Confidence Map: Test 5 flange fix results (2.6 percent rejects, 97.8 percent in window) meet the hypothesis targets and are confirmed in both sources. | applied | none |  | 97.8%/2.6% final results stated, matches established. |
| 246 | Confidence Map: Cycle time in test 5 (3:58) is right at the 4 minute limit, an acknowledged margin concern. | not_applied | missing_fact |  | 3:58 stated flatly as meeting target, margin unhedged; repaired (deterministic re-check only; not re-verified by the model) |
| 246 | Confidence Map: The knee in the force-burr relationship near 0.6 mm was repeatable across casting lots within a stated tolerance, per the memo. | applied | none |  | Knee repeatability stated as established fact. |
| 246 | Confidence Map: Second-pass approach on flanges was tried and dropped for giving worse rejects (3.9 percent) than the feed-slowing fix. | applied | none |  | Second-pass approach not mentioned in section. |
| 246 | Confidence Map: Whether the vision/force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved and left open. | applied | none |  | Transfer to other alloys/designs marked open, hedged. |
| 246 | Confidence Map: Sleeve/abrasive life extension figure from fixed 100 to about 175 brackets is reported only in the memo, not corroborated in the transcript's discussion of wear correction. | applied | none |  | Sleeve/abrasive life figure not mentioned in section. |
| 246 | Confidence Map: The flange deflection magnitude (up to 0.15 mm under static load) is reported only in the memo as a distinct measurement method, not mentioned in the transcript. | applied | none |  | Flange deflection figure not mentioned in section. |
| 246 | Glossary Term: abrasive wear | applied | none |  | Abrasive wear concept absent from section. |
| 246 | Glossary Term: thin flange | not_applied | none |  | P4 says 'brackets' not 'thin flange' concept absent; repair failed |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept absent from section. |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item ys7e5jqxr250atrpsr9khpxce98fe5pj | applied | none |  | P2 states the relationship and knee repeatability as planned. |
| 246 | Cover signed-off Summary item ys79d9kvfgw6qjgb0g5sv45xvh8fe2s4 | applied | none | 2 | P3 covers fixed-force limitation and 14% reject baseline. |
| 246 | Cover signed-off Summary item ys7dc48184ayfmfatgkcre7zt98feegm | applied | none | 2 | P3 states reject causes and worse-than-hand-deburring finding. |
| 246 | Cover signed-off Summary item ys74z7210c5fcscehg5a511rqd8feq7b | applied | none |  | P4 states pilot cell status and ongoing validation. |
| 246 | Cover signed-off Summary item ys74parayxb4t25h47yrh2n4718fetja | applied | none |  | P5 states the goal was met as planned. |
| 246 | State each result against its target as the numbers show | applied | none |  | All targets stated correctly as met with matching direction… |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements trace to COVER items answering Line 242… |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The fixed-force baseline test confirmed a single force setting cannot clear large burrs without over-rounding small one..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The project goal of replacing fixed-force deburring was met by linking 2D vision estimates to per-edge compliant spindl..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 0 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 24.
- Line 244: 0 labels and 0 plan checks "Not checked" of 20.
- Line 246: 0 labels and 0 plan checks "Not checked" of 23.

## Seed-stage numbers

- Requests: 19 metered (17 Batch, 2 Feedback); 20 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.2 s, p95 25.4 s over 16 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.1 s, p95 15.1 s over 1.
- Sign-off to report created: 100.9 s.
- Cost from aiUsage: $1.08 in all ($0.46 seed stage, $0.62 Brief, drafting and checks) over 43 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T03:53:02.944Z created project k973zf626q9d3a97eqw3pamwsh8ffkgy
2026-10-01T03:53:03.570Z added document deburring-test-memo.md
2026-10-01T03:53:04.842Z started Step by step generation k578hh9anbk7exq5mmnnzmftn58ffamn
2026-10-01T03:53:50.377Z seed stage open
2026-10-01T03:53:50.377Z Open Company / Context and wait for its Batch
2026-10-01T03:54:02.066Z Company / Context: select the first Seed
2026-10-01T03:54:03.980Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-01T03:54:13.096Z kept Feedback returned 1 Revised Seed(s)
2026-10-01T03:54:13.096Z Company / Context: select the first Revised Seed and untick the original
2026-10-01T03:54:16.312Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-01T03:54:22.877Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-01T03:54:22.877Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-01T03:54:24.144Z Approve Company / Context
2026-10-01T03:54:26.078Z approved company_context
2026-10-01T03:54:26.078Z Open Goal / Problem and wait for its Batch
2026-10-01T03:54:40.381Z Goal / Problem: select the first Seed
2026-10-01T03:54:42.307Z Approve Goal / Problem
2026-10-01T03:54:44.522Z approved goal_problem
2026-10-01T03:54:44.522Z Open Technological limitations and wait for its Batch
2026-10-01T03:54:58.749Z Technological limitations: select the first Seed
2026-10-01T03:55:00.637Z Approve Technological limitations
2026-10-01T03:55:02.570Z approved passive_limitations
2026-10-01T03:55:02.570Z Open Technological objectives and wait for its Batch
2026-10-01T03:55:16.866Z Technological objectives: select the first Seed
2026-10-01T03:55:18.842Z Approve Technological objectives
2026-10-01T03:55:20.811Z approved technological_objective
2026-10-01T03:55:20.811Z Open Technological uncertainties and wait for its Batch
2026-10-01T03:55:35.108Z Technological uncertainties: select the first 2 Seeds
2026-10-01T03:55:38.279Z Approve Technological uncertainties
2026-10-01T03:55:40.247Z approved active_uncertainties
2026-10-01T03:55:40.247Z Skip Previous-year status
2026-10-01T03:55:41.527Z Open Work plan and wait for its Batch
2026-10-01T03:55:58.554Z Work plan: select the first Seed
2026-10-01T03:56:00.483Z Approve Work plan
2026-10-01T03:56:02.400Z approved workplan
2026-10-01T03:56:02.400Z Open Hypothesis and wait for its Batch
2026-10-01T03:56:25.914Z hypothesis: attempt failed, Retry 1
2026-10-01T03:56:41.624Z Hypothesis: select the first Seed
2026-10-01T03:56:43.609Z Approve Hypothesis
2026-10-01T03:56:45.532Z approved hypothesis
2026-10-01T03:56:45.532Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T03:57:13.092Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T03:57:16.254Z Approve Experimentation / Iterations
2026-10-01T03:57:18.214Z approved experimentation
2026-10-01T03:57:18.214Z Open Advancement to science / technology and wait for its Batch
2026-10-01T03:57:35.309Z Advancement to science / technology: select the first Seed
2026-10-01T03:57:37.216Z Approve Advancement to science / technology
2026-10-01T03:57:39.168Z approved overall_advancement
2026-10-01T03:57:39.168Z Open Specific technological advancements and wait for its Batch
2026-10-01T03:57:53.630Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T03:57:58.723Z Approve Specific technological advancements
2026-10-01T03:58:00.665Z approved specific_advancements
2026-10-01T03:58:00.665Z Open Project status and next steps and wait for its Batch
2026-10-01T03:58:14.991Z Project status and next steps: select the first Seed
2026-10-01T03:58:16.928Z Approve Project status and next steps
2026-10-01T03:58:18.892Z approved project_status
2026-10-01T03:58:18.892Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T03:58:41.116Z Overall company / project goal improvements: select the first Seed
2026-10-01T03:58:43.077Z Approve Overall company / project goal improvements
2026-10-01T03:58:45.250Z approved goal_improvements
2026-10-01T03:58:45.250Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T03:58:46.579Z signed off; waiting for the report
2026-10-01T04:00:29.486Z report kd7162yq07d9yb75x95vwfntcn8fe01z created
```
