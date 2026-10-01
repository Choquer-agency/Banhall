# Release eval - Tessrow adaptive deburring cell

Semantic case: **Corrected then withdrawn Feedback** (CAP-13: "corrected-then-withdrawn Feedback"). Also checks: a Feedback instruction on Subsection 1 is respected in Subsection 9 (CAP-4).

Run 2026-09-30 on `local` at commit `c17f2494`, acting as e2e-audit@banhall.local. Project `k975vb74hj09c9vy2r4vw2qe798fewkj`, generation `k57fef2rz4mkj97knkp4ddb6js8ffemx`.

## What this fixture tests

On Company / Context the writer gives two Feedback instructions. The first (call the tool the compliant spindle, never the floating head) stays active, and its Revised Seed replaces the original. The second (call the pilot cell the Kestrel line) is a correction the writer withdraws before approving. The withdrawn instruction must never be sent again or reach the plan or the report; the active one must reach Subsection 9's Decision Set and be respected there (the CAP-4 harness case).

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Nothing in the Seeds after the withdrawal, the plan or the report calls the pilot cell the Kestrel line.
   - Answer: Yes. "Kestrel" appears in 0 later Seeds, 0 plan items and 0 Lines; 0 of 12 later Batches carried it.
2. Subsection 9's Seeds and Section 244 call the tool the compliant spindle, as the active Feedback asked.
   - Answer: Yes. "compliant spindle" in every Line (242: 2, 244: 3, 246: 3), "floating head" 0 times, and all three term rows read governed by the Feedback, applied. One Subsection 9 Seed says "compliant spindle", none "floating head".
3. The experiments in Section 244 match the sources (burr heights, forces, cycle times, reject rates) despite the renamed tool.
   - Answer: Yes. Every figure matches the memo and interview (120 brackets, 20 N, 14 and 9 percent; 0.18 mm at 210 ms; 0.07 mm at 95 ms; 60 coupons, 8 to 40 N, knee near 0.6 mm; 4.3 and 96.1 percent at 3:50; 28 N, 26 N, 40 to 25 mm/s; 2.6 and 97.8 percent at 3:58; 2.4 percent over 240 brackets).
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (241, 650, 334).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (high confidence). Run 11's major is fixed: Line 246 now says 97.8 and 2.6 percent are "both meeting thresholds"; "the test memo indicates" is gone. Minors: "partially proven" though the thresholds were met; Line 244 paragraph 7 conflates the second-pass trial; "replacing manual deburring" overstates; a false targets row.

## Automatic checks

13 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7f44c58ghwsbk04zhb9e2ccs8fe85g |
| All three Sections were drafted | pass | 242: 241 words, 244: 650 words, 246: 334 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work ties to Line 242 uncertainties or covers signed-off…"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P6 calls 96.1% a miss but states it plainly, ok; check P4."); 246: applied ("Met targets stated as meeting, not approached or close to") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 20 metered calls (18 Batch, 2 Feedback), 21 reserved; notice not shown; 0 Retry |
| The correcting Feedback was withdrawn and the other stayed active | pass | withdrawn request: withdrawn; kept request: active |
| No Batch dispatched after the withdrawal carried the withdrawn instruction | pass | 12 later Batch(es); 0 carried it |
| "Kestrel" is absent from later Seeds, the plan and the drafted Sections | pass | 0 later Seed(s), 0 plan item(s); report: absent |
| The active Feedback on Subsection 1 is in Subsection 9's Decision Set | pass | 1 context row(s) across 1 Subsection 9 Batch(es) |
| Heuristic: Subsection 9 Seeds say "compliant spindle", not "floating head" | pass | 1 of 5 Seed(s) use the requested term; 0 use the replaced one |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The client is a 45-person robotic finishing cell integrator located in Grandbois, Quebec. / It designs and builds cells for grinding, sanding, polishing and deburring, mostly for aerospace and medical parts. _(cited, Revised Seed)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought to adapt a robotic deburring cell to handle cast A357 aerospace brackets with highly variable burr height. / The goal was a system using the compliant spindle that adjusts contact force per edge based on a vision estimate of burr height. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- A fixed-force, fixed-path robotic cell cannot handle the variable burr height without leaving burrs or over-rounding edges. / Setting force high enough for a 1.2 mm burr over-rounds edges that only had 0.1 mm of burr. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether burr height could be estimated from 2D images accurately and quickly enough for per-edge force control. / Nobody consulted had done burr height estimation from 2D on cast aluminum, given shiny and dull surface variation. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether the burr's shadow or highlight in a 2D image reliably tracked true burr height, since this depends on variable burr shape. / The team had no prior example of anyone deriving burr height from 2D images on shiny, cast aluminum surfaces. _(cited)_
- It was also uncertain whether a stable, controllable relationship existed between contact force, feed rate, abrasive wear and edge stiffness. / Thin flanges on the bracket were known to flex under load, with no model linking burr size, force and resulting radius. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a staged investigation in the pilot cell starting August 2025 to test the compliant spindle approach. / Step one was a fixed-force baseline, then developing a 2D burr height estimate checked against a laser profiler. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- The hypothesis also predicted bracket reject rate would fall below 3 percent inside a 4 minute cycle. / This ties the vision accuracy and speed targets directly to a measurable production outcome. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- A baseline test ran 120 brackets with the compliant spindle at a fixed 20 newtons and a fixed path. / The fixed-force baseline produced 14 percent rejects, worse than the 9 percent from hand deburring. _(cited)_
  - Tested: uncertainty "It was also uncertain whether a stable, controllable relationship e..."
- A single-angle 2D vision setup imaged 400 edges with a low-angle ring light against a laser profiler reference. _(cited)_
  - Tested: uncertainty "It was unclear whether the burr's shadow or highlight in a 2D image..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Two angle lighting with GPU differencing achieved 0.07 millimetres RMS at 95 milliseconds per edge, meeting the vision target. / This confirmed a stable relationship between apparent shadow and highlight and true burr height on cast aluminum, resolving the imaging uncertainty. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The fixed-force baseline test showed that a single contact force setting cannot control edge radius across varying burr height. / At 20 newtons fixed force, the compliant spindle produced 14 percent rejects, worse than hand deburring. _(cited)_
  - Links: uncertainty "It was also uncertain whether a stable, controllable relationship e..."; experiments "A baseline test ran 120 brackets with the compliant spindle at a fi..."
- This confirmed no stable force-to-radius relationship exists without per-edge adjustment, since fixed force cannot suit all burr sizes. _(cited)_
  - Links: uncertainty "It was also uncertain whether a stable, controllable relationship e..."; experiments "A baseline test ran 120 brackets with the compliant spindle at a fi..."

### 12. Project status and next steps (Section 246, standard): approved

- The team is still running parts in the pilot cell in Bay 4 and has not yet shipped a production cell. / Cycle time sits right at the 4 minute limit, so any added step would push the cell over budget. _(writer-asserted)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The project confirmed a stable, controllable relationship between contact force, feed rate and edge stiffness exists for thin flanges. _(cited)_

## Drafted Sections

### Line 242

The company operates as a 45-person robotic finishing cell integrator in Grandbois, Quebec, designing and building grinding, sanding, polishing and deburring cells, mainly for aerospace and some medical parts customers.

The company set out to adapt a robotic deburring cell to handle cast A357 aerospace brackets whose burr height varies widely edge to edge. The goal was a system using a compliant spindle that adjusts contact force at each edge based on a vision estimate of burr height.

A fixed-force, fixed-path robotic cell could not handle this variation without leaving burrs on some edges or over-rounding others. Setting force high enough to remove a 1.2mm burr over-rounded edges carrying only 0.1mm of burr.

The team sought new knowledge on whether burr height could be estimated from 2D images accurately and quickly enough for per-edge force control. No documented method existed for estimating burr height from 2D images on cast aluminum, where surface reflectivity varies between shiny and dull regions.

It was uncertain whether a burr's shadow or highlight in a 2D image reliably tracked true burr height, since this depends on variable burr shape. No prior example existed of deriving burr height from 2D images on shiny, cast aluminum surfaces.

It was also uncertain whether a stable, controllable relationship existed between contact force, feed rate, abrasive wear and edge stiffness. Thin flanges on the bracket were known to flex under load, with no model linking burr size, force and resulting radius.

### Line 244

The workplan addressed two linked uncertainties: whether burr height per edge could be read from 2D images accurately and fast enough to drive a per-edge force command, and whether a stable, controllable relationship existed between contact force, feed rate, abrasive wear, edge stiffness and resulting edge radius for the compliant spindle. The team planned a staged investigation in the pilot cell starting August 2025 to test the compliant spindle approach. Step one was a fixed-force baseline, then developing a 2D burr height estimate checked against a laser profiler.

It was hypothesized that if burr height per edge could be estimated from 2D images to within 0.1mm RMS in under 120 milliseconds, and that estimate used to set contact force edge by edge, then edge radius could be held within the edge radius window on at least 97% of edges. The hypothesis also predicted bracket reject rate would fall below 3 percent inside a 4 minute cycle. This ties the vision accuracy and speed targets directly to a measurable production outcome.

A baseline test ran 120 brackets with the compliant spindle at a fixed 20 newtons and a fixed path. The fixed-force baseline produced 14 percent rejects, worse than the 9 percent from hand deburring, with leftover burrs on high-burr edges and over-rounding on low-burr edges. This confirmed no stable force-to-radius relationship exists without adjusting force edge by edge, since one setting cannot suit the full 0.1 to 1.2mm burr range, and established the need for per-edge adaptive force control grounded in an accurate burr height estimate.

A single-angle 2D vision setup imaged 400 edges with a low-angle ring light against a laser profiler reference, giving 0.18mm RMS error at 210 milliseconds per edge, missing both targets. Specular reflection on machined faces made some burrs read far taller than they were, confounding the shadow signal the method relied on. A borrowed structured-light 3D camera, tested as an alternative, gave no improvement (0.2mm depth resolution, 400 milliseconds per capture), so effort returned to refining 2D imaging rather than switching sensor types.

The team then tested two-angle lighting at 15 and 60 degrees, using two-angle differencing to separate burr shadow from face reflection, with processing moved to GPU and the capture region cropped using CAD path data. On the same 400 edges, error dropped to 0.07mm RMS at 95 milliseconds, meeting both vision targets and confirming shadow and highlight track true burr height on cast aluminum once the reflection confound is removed.

With burr height estimation solved, the team built a force map from 60 scrap coupons spanning 0.1 to 1.2mm burr height, run across 8 to 40 newtons, then tested it on 300 brackets. The relationship proved non-linear, with a knee near 0.6mm where force needed rose from about 10 to 22 newtons, then to 34 newtons at 1.2mm. Rejects fell to 4.3%, with 96.1% of edges in the radius window at a 3:50 cycle, missing the 97% target. Most remaining rejects traced to thin, 2.5mm flanges, where forces above about 28 newtons caused thin flange chatter.

To resolve this, the team capped force at 26 newtons on thin flanges and slowed feed rate from 40 to 25mm/s, testing this against a second-pass alternative across 360 brackets from two additional casting lots. The slower, capped-force approach eliminated chatter and outperformed the second pass, bringing rejects to 2.6% with 97.8% of edges in window, meeting the target, at a 3:58 cycle within the 4 minute limit. This showed that trading force for dwell time, rather than adding passes, resolves chatter on compliant thin-wall sections.

A final test addressed abrasive wear drift observed over roughly 150 brackets, by deburring and imaging a reference coupon every 25 brackets and scaling the force map accordingly. Over 240 brackets validated under this correction, reject rate held stable at 2.4% with no drift trend, showing periodic reference-coupon checks can track and correct wear without a fixed replacement schedule.

### Line 246

The company set out to advance knowledge in fast 2D optical burr-height estimation and adaptive force control of the compliant spindle, building a vision-guided deburring process that holds tight edge-radius tolerances across variable burr heights, flange stiffness and abrasive wear. The hypothesis was partially proven. Burr height estimation reached 0.07mm RMS at 95 milliseconds per edge, meeting both targets, and the resulting force control held 97.8% of edges in the radius window with rejects at 2.6%, both meeting thresholds, though only once a separate thin-flange fix was added beyond the original force-map approach.

Two-angle lighting with GPU differencing resolves burr height on cast aluminum to 0.07mm RMS at 95 milliseconds per edge, meeting the vision target. This confirmed a stable relationship between apparent shadow and highlight and true burr height, resolving the imaging uncertainty.

The fixed-force baseline test showed that a single contact force setting cannot control edge radius across varying burr height. At 20 newtons fixed force, the compliant spindle produced 14 percent rejects, worse than hand deburring. This confirmed no stable force-to-radius relationship exists without per-edge adjustment, since fixed force cannot suit all burr sizes.

The force needed to reach target edge radius rises non-linearly with burr height, with a knee near 0.6mm; thin flanges need force capped and traded for slower feed rather than raised further. This confirmed a stable, controllable relationship between contact force, feed rate and edge stiffness exists for thin flanges.

Testing continues in the pilot cell in Bay 4, and no production cell has shipped. Whether the method transfers to other alloys and bracket designs, and whether burr height can be estimated on internal edges not visible to the camera, remain open. Cycle time sits at the 4 minute limit, so any added step would push the cell over budget.

The project advanced the original goal of a vision-guided compliant spindle cell meeting the edge radius spec within cycle time, replacing manual deburring and fixed-force approaches that left rejects at 9% and 14% respectively, down to 2.6%.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 241/350 words, 27/50 lines |
| 242 | Claim Exclusion: The customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial/business development activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Checking that the proportional valve could change pressure fast enough between edges was a routine engineering verification, not an uncertain technological question. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The planned fiscal 2027 work on internal edges and alloy/design transfer falls outside the fiscal 2026 claim period described. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: The customer acceptance run of 1,000 brackets is scheduled for October 2026, after the fiscal 2026 period (ending June 30 2026) and is a commercial acceptance test rather than claimed experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline goal and uncertainties. |
| 242 | Confidence Map: Two-angle vision test results (0.07 mm RMS, 95 ms/edge) are consistently reported across transcript and memo. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: The worst single-edge error in test 3 (two-angle vision) is reported only in the memo, not in the transcript. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: The force map's non-linear knee near 0.6 mm is reported consistently in both transcript and memo, with the memo adding repeatability across casting lots. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: The second-pass alternative for thin flanges is reported only in the memo with a specific reject figure, while the transcript states only that it worked less well than slower feed. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: Abrasive sleeve life extension from the wear correction is reported only in the memo. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: Whether the burr-height-to-force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: Whether burr height can be estimated on internal edges not directly visible to the camera is explicitly unresolved. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: Cycle time for test 5 (thin flange fix) is reported as right at the 4-minute limit, an acknowledged margin concern rather than a settled result. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Confidence Map: The personnel time allocation (controls engineer 60 percent, manufacturing engineer half time, technician near full time from October) is reported only in the transcript. | applied | none |  | Not mentioned in this uncertainty section. |
| 242 | Glossary Term: force map | applied | none |  | Force map concept absent from section. |
| 242 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept absent from section. |
| 242 | Glossary Term: two-angle differencing | applied | none |  | Two-angle differencing concept absent from section. |
| 242 | Glossary Term: edge radius window | applied | none |  | Edge radius window concept absent from section. |
| 242 | Glossary Term: thin flange chatter | applied | none |  | Thin flange chatter concept absent from section. |
| 242 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The Self-check found that the text follows it. |
| 242 | Cover signed-off Summary item ys72c18hj64yrbbj94yj0vjzs18ff9r8 | applied | none |  | P1 covers size, location, products, markets. |
| 242 | Cover signed-off Summary item ys733zqjnn58q66tx4afbb5mss8ffg1v | applied | none |  | P2 states goal and compliant spindle system. |
| 242 | Cover signed-off Summary item ys702q783512gbbtmq81why3r98fepcq | applied | none |  | P3 covers fixed-force limitation with figures. |
| 242 | Cover signed-off Summary item ys72c2qt4t8k7sacb7y79g5ppd8ffgjh | applied | none |  | P4 states the technological objective as planned. |
| 242 | Cover signed-off Summary item ys7ej0yxy2ffek9bgc619g1ysd8fffcv | applied | none | 2 | P5 covers shadow/highlight uncertainty wording. |
| 242 | Cover signed-off Summary item ys7fny60av6yg9y5wtwkvjs0q98ffdbg | applied | none | 2 | P6 covers force/feed/wear/stiffness uncertainty. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company sought to adapt a robotic deburring cell to handle cast A357 aerospace brackets with highly variable burr h..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought new knowledge on whether burr height could be estimated from 2D images accurately and quickly enough fo..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was unclear whether the burr's shadow or highlight in a 2D image reliably tracked true burr height, since this depen..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 650/700 words, 66/100 lines |
| 244 | Claim Exclusion: The customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial/business development activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Checking that the proportional valve could change pressure fast enough between edges was a routine engineering verification, not an uncertain technological question. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The planned fiscal 2027 work on internal edges and alloy/design transfer falls outside the fiscal 2026 claim period described. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: The customer acceptance run of 1,000 brackets is scheduled for October 2026, after the fiscal 2026 period (ending June 30 2026) and is a commercial acceptance test rather than claimed experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: force map | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: reference coupon | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Glossary Term: two-angle differencing | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: edge radius window | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: thin flange chatter | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches Storyline staged tests and results. |
| 244 | Confidence Map: Two-angle vision test results (0.07 mm RMS, 95 ms/edge) are consistently reported across transcript and memo. | applied | none |  | P5 states 0.07mm RMS/95ms, matches established entry. |
| 244 | Confidence Map: The worst single-edge error in test 3 (two-angle vision) is reported only in the memo, not in the transcript. | applied | none |  | Worst single-edge error not mentioned in section. |
| 244 | Confidence Map: The force map's non-linear knee near 0.6 mm is reported consistently in both transcript and memo, with the memo adding repeatability across casting lots. | applied | none |  | P6 states knee near 0.6mm consistent with established entry. |
| 244 | Confidence Map: The second-pass alternative for thin flanges is reported only in the memo with a specific reject figure, while the transcript states only that it worked less well than slower feed. | applied | none |  | P7 hedges: 'outperformed the second pass' without flat figure… |
| 244 | Confidence Map: Abrasive sleeve life extension from the wear correction is reported only in the memo. | applied | none |  | Sleeve life extension not mentioned in section. |
| 244 | Confidence Map: Whether the burr-height-to-force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved. | applied | none |  | Transfer to other alloys not mentioned in section. |
| 244 | Confidence Map: Whether burr height can be estimated on internal edges not directly visible to the camera is explicitly unresolved. | applied | none |  | Internal edge visibility not mentioned in section. |
| 244 | Confidence Map: Cycle time for test 5 (thin flange fix) is reported as right at the 4-minute limit, an acknowledged margin concern rather than a settled result. | applied | none |  | P7 states 3:58 cycle, within but near 4-min limit, not flat. |
| 244 | Confidence Map: The personnel time allocation (controls engineer 60 percent, manufacturing engineer half time, technician near full time from October) is reported only in the transcript. | applied | none |  | Personnel time allocation not mentioned in section. |
| 244 | Glossary Term: two-angle differencing | applied | none |  | P5 says 'two-angle lighting' not 'two-angle differencing'; repaired to the Glossary Term |
| 244 | Glossary Term: edge radius window | applied | none |  | P2 uses '0.2 to 0.5mm window' not 'edge radius window'; repaired to the Glossary Term |
| 244 | Glossary Term: thin flange chatter | applied | none |  | P6 says 'lose contact and chatter' not 'thin flange chatter'; repaired to the Glossary Term |
| 244 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status mentioned in section. |
| 244 | Cover signed-off Summary item ys7es4fpepaahye5ggja6vv3fh8fe1mx | applied | none |  | Workplan staged investigation stated as planned. |
| 244 | Cover signed-off Summary item ys7630parzctcz9dwemd0nx3sx8fek77 | applied | none |  | Hypothesis ties reject rate and cycle time to targets. |
| 244 | Cover signed-off Summary item ys72sd59cksv60d3pa0jm3b3f98fe2eq | applied | none |  | Baseline test and reject rates match source. |
| 244 | Cover signed-off Summary item ys75fb1anzcfcby250ttt6ygg98ff79c | applied | none |  | Single-angle 2D vision test on 400 edges described. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P6 calls 96.1% a miss but states it plainly, ok; check P4. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work ties to Line 242 uncertainties or covers signed-off… |
| 244 | Leave out quotes marked for a check from the evidence for the idea "A single-angle 2D vision setup imaged 400 edges with a low-angle ring light against a laser profiler reference." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): 244 P6 reports 96.1% of edges in the radius window with the force map alone, missing the 97% target, and attributes most remaining rejects to thin flange chatter above about 28 newtons. 246 P4 states this same force map test confirmed a stable, controllable relationship for thin flanges, but 244 shows the force map alone did not resolve thin flanges; that fix came only in 244 P7 after capping force and slowing feed. 246 P4 should not credit the force map step itself with the thin flange result. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 334/350 words, 37/50 lines |
| 246 | Claim Exclusion: The customer's agreement to purchase a production cell contingent on an acceptance run is a business/commercial milestone, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reusing the two-angle imaging approach in a polishing cell sales quote is a commercial/business development activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Checking that the proportional valve could change pressure fast enough between edges was a routine engineering verification, not an uncertain technological question. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The planned fiscal 2027 work on internal edges and alloy/design transfer falls outside the fiscal 2026 claim period described. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: The customer acceptance run of 1,000 brackets is scheduled for October 2026, after the fiscal 2026 period (ending June 30 2026) and is a commercial acceptance test rather than claimed experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: burr height | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches Storyline staged narrative |
| 246 | Confidence Map: Two-angle vision test results (0.07 mm RMS, 95 ms/edge) are consistently reported across transcript and memo. | applied | none |  | 0.07mm/95ms stated flatly, matches established entry |
| 246 | Confidence Map: The worst single-edge error in test 3 (two-angle vision) is reported only in the memo, not in the transcript. | applied | none |  | Worst-edge error not mentioned in section |
| 246 | Confidence Map: The force map's non-linear knee near 0.6 mm is reported consistently in both transcript and memo, with the memo adding repeatability across casting lots. | applied | none |  | Knee near 0.6mm stated flatly, matches established entry |
| 246 | Confidence Map: The second-pass alternative for thin flanges is reported only in the memo with a specific reject figure, while the transcript states only that it worked less well than slower feed. | applied | none |  | Second-pass alternative not mentioned in section |
| 246 | Confidence Map: Abrasive sleeve life extension from the wear correction is reported only in the memo. | applied | none |  | Sleeve life extension not mentioned in section |
| 246 | Confidence Map: Whether the burr-height-to-force method transfers to other alloys and bracket designs without a full re-sweep is explicitly unresolved. | applied | none |  | Transfer question hedged as open in P5 |
| 246 | Confidence Map: Whether burr height can be estimated on internal edges not directly visible to the camera is explicitly unresolved. | applied | none |  | Internal edges question hedged as open in P5 |
| 246 | Confidence Map: Cycle time for test 5 (thin flange fix) is reported as right at the 4-minute limit, an acknowledged margin concern rather than a settled result. | applied | none |  | Cycle time stated as 'right at' limit, hedged |
| 246 | Confidence Map: The personnel time allocation (controls engineer 60 percent, manufacturing engineer half time, technician near full time from October) is reported only in the transcript. | applied | none |  | Personnel allocation not mentioned in section |
| 246 | Glossary Term: reference coupon | applied | none |  | Reference coupon concept not mentioned |
| 246 | Glossary Term: two-angle differencing | applied | none |  | Phrase 'two-angle lighting differencing' used, near-verbatim |
| 246 | Glossary Term: edge radius window | applied | none |  | 'radius window' used, matches term closely enough |
| 246 | Glossary Term: thin flange chatter | applied | none |  | Chatter not mentioned in this section |
| 246 | Glossary Term: floating head | applied | conflict |  | The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.". The check of the final text after the repair found that it follows it. |
| 246 | Cover signed-off Summary item ys734yyc1ph1wt259pc9qecjh18ffma5 | applied | none |  | P2 states 0.07mm RMS at 95ms, meeting vision target |
| 246 | Cover signed-off Summary item ys77wh357hzambyvd232jb05ed8ffpv7 | applied | none | 2 | P3 gives 20N fixed force, 14% rejects, worse than hand |
| 246 | Cover signed-off Summary item ys717wzgkwkntb5r2tz6b6p6n18ffj86 | applied | none | 2 | P3 confirms no stable force-to-radius relation without… |
| 246 | Cover signed-off Summary item ys73k8r6vr0zyb9ecpsmmpqryn8fekvk | applied | none |  | P5 states pilot cell status, no production ship, cycle time… |
| 246 | Cover signed-off Summary item ys755depew65xsm5r4xkw47d1n8ffy0j | applied | none |  | P4 confirms stable force/feed/stiffness relationship for thin… |
| 246 | State each result against its target as the numbers show | applied | none |  | Met targets stated as meeting, not approached or close to |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claimed advancements trace to Line242 uncertainties or… |
| 246 | Leave out quotes marked for a check from the evidence for the idea "This confirmed no stable force-to-radius relationship exists without per-edge adjustment, since fixed force cannot suit..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 1 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 22.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 22.

## Seed-stage numbers

- Requests: 20 metered (18 Batch, 2 Feedback); 21 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.7 s, p95 24.9 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.5 s, p95 12.5 s over 1.
- Sign-off to report created: 133.9 s.
- Cost from aiUsage: $1.14 in all ($0.46 seed stage, $0.68 Brief, drafting and checks) over 49 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T02:02:23.231Z created project k975vb74hj09c9vy2r4vw2qe798fewkj
2026-10-01T02:02:23.863Z added document deburring-test-memo.md
2026-10-01T02:02:25.134Z started Step by step generation k57fef2rz4mkj97knkp4ddb6js8ffemx
2026-10-01T02:03:06.677Z seed stage open
2026-10-01T02:03:06.677Z Open Company / Context and wait for its Batch
2026-10-01T02:03:18.355Z Company / Context: select the first Seed
2026-10-01T02:03:20.318Z Company / Context: give Feedback on the selected Seed: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step."
2026-10-01T02:03:29.462Z kept Feedback returned 1 Revised Seed(s)
2026-10-01T02:03:29.462Z Company / Context: select the first Revised Seed and untick the original
2026-10-01T02:03:32.650Z Company / Context: give Feedback on the next unselected Seed: "Call the pilot cell in Bay 4 the Kestrel line."
2026-10-01T02:03:41.760Z withdrawn Feedback returned 1 Revised Seed(s)
2026-10-01T02:03:41.760Z Company / Context: withdraw the "withdrawn" Feedback
2026-10-01T02:03:43.027Z Approve Company / Context
2026-10-01T02:03:44.938Z approved company_context
2026-10-01T02:03:44.938Z Open Goal / Problem and wait for its Batch
2026-10-01T02:03:59.276Z Goal / Problem: select the first Seed
2026-10-01T02:04:01.211Z Approve Goal / Problem
2026-10-01T02:04:04.150Z approved goal_problem
2026-10-01T02:04:04.150Z Open Technological limitations and wait for its Batch
2026-10-01T02:04:18.584Z Technological limitations: select the first Seed
2026-10-01T02:04:20.470Z Approve Technological limitations
2026-10-01T02:04:22.424Z approved passive_limitations
2026-10-01T02:04:22.424Z Open Technological objectives and wait for its Batch
2026-10-01T02:04:47.218Z Technological objectives: select the first Seed
2026-10-01T02:04:49.146Z Approve Technological objectives
2026-10-01T02:04:51.070Z approved technological_objective
2026-10-01T02:04:51.070Z Open Technological uncertainties and wait for its Batch
2026-10-01T02:05:05.376Z Technological uncertainties: select the first 2 Seeds
2026-10-01T02:05:08.560Z Approve Technological uncertainties
2026-10-01T02:05:10.533Z approved active_uncertainties
2026-10-01T02:05:10.533Z Skip Previous-year status
2026-10-01T02:05:11.798Z Open Work plan and wait for its Batch
2026-10-01T02:05:26.200Z Work plan: select the first Seed
2026-10-01T02:05:28.095Z Approve Work plan
2026-10-01T02:05:30.018Z approved workplan
2026-10-01T02:05:30.018Z Open Hypothesis and wait for its Batch
2026-10-01T02:05:41.734Z Hypothesis: select the first Seed
2026-10-01T02:05:43.617Z Approve Hypothesis
2026-10-01T02:05:45.568Z approved hypothesis
2026-10-01T02:05:45.568Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T02:06:13.932Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T02:06:17.124Z Approve Experimentation / Iterations
2026-10-01T02:06:19.029Z approved experimentation
2026-10-01T02:06:19.029Z Open Advancement to science / technology and wait for its Batch
2026-10-01T02:06:35.883Z Advancement to science / technology: select the first Seed
2026-10-01T02:06:37.771Z Approve Advancement to science / technology
2026-10-01T02:06:39.724Z approved overall_advancement
2026-10-01T02:06:39.724Z Open Specific technological advancements and wait for its Batch
2026-10-01T02:07:04.541Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T02:07:09.713Z Approve Specific technological advancements
2026-10-01T02:07:11.640Z approved specific_advancements
2026-10-01T02:07:11.640Z Open Project status and next steps and wait for its Batch
2026-10-01T02:07:23.348Z Project status and next steps: select the first Seed
2026-10-01T02:07:25.269Z Approve Project status and next steps
2026-10-01T02:07:27.199Z approved project_status
2026-10-01T02:07:27.199Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T02:07:52.090Z Overall company / project goal improvements: select the first Seed
2026-10-01T02:07:54.022Z Approve Overall company / project goal improvements
2026-10-01T02:07:55.957Z approved goal_improvements
2026-10-01T02:07:55.958Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T02:07:57.241Z signed off; waiting for the report
2026-10-01T02:10:11.686Z report kd7f44c58ghwsbk04zhb9e2ccs8fe85g created
```
