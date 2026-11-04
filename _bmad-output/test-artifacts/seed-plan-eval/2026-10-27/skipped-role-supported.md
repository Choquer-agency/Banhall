# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k970rc7my0k4bwy0c8bm4rfqjx8h2cmd`, generation `k5727qpdj59szcwjyc7qdmj44x8h3555`.

## What this fixture tests

A continuing project whose sources describe the previous year in detail (the Orion-1 prototype, its 14-day drift limit and the uncertainties left open at June 30 2025). The writer opens Previous-year status, sees cited Seeds for it, and skips it anyway. The drafter must not cover the skipped role even though the Brief and sources support it, and the Compliance Note must record the Skip as honoured.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 244 does not describe the previous year's status (Orion-1, the 14-day drift limit, what remained open at the end of fiscal 2025) as a topic of its own.
   - Answer: 
2. Where this year's work refers back to the earlier prototype, it does so only as context for fiscal 2026 work, not as a previous-year status passage.
   - Answer: 
3. The rest of Section 244 (work plan, hypothesis, experiments) is complete without the skipped role.
   - Answer: 
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

12 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd77xh7zpx133h972x0hj5j9mh8h25hq |
| All three Sections were drafted | pass | 242: 309 words, 244: 687 words, 246: 333 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 242: 0 labels and 1 plan check "Not checked" of 20; 246: 0 labels and 1 plan check "Not checked" of 19 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | no Seed Batch failed |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work answers stated uncertainties."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: not_applied ("P1 says "The objective was partly achieved.", but the sources say "So only one candidate met both...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: Safe for drinking water adds detail; source says food-grade.)"); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: P3 gives 1.7 percent drift on held-out heads at the wrong time ...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (7.7 s, 8.4 s); 244: 2 requests (12.1 s, 7.7 s); 246: 2 requests (8.5 s, 9.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 3 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before the biofouling drift passed 5 percent." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 held calibration only 14 days before drift passed 5 percent."; claimExclusion: "Fiscal 2025 Orion-1 work falls outside the fiscal 2026 claim period."; confidenceMap: "Orion-1 baseline result is consistent across both sources." |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "Prior year absent." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds water-quality instruments for municipal treatment plants. _(writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The company designs and builds water-quality instruments for municipal treatment plants. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Most fluoropolymers and hydrogels that resist fouling lose 30 to 60 percent of their transmission at 254 nm. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether a window surface could resist biofilm attachment for 30 days or more while staying UV-clear at 254 nm. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team did not know if a window coating could be UV-clear, safe for drinking water and durable in chlorinated water. _(cited)_
- Most fluoropolymers and hydrogels lose 30 to 60 percent of transmission at 254 nm, so the coating outcome was uncertain. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team could not find a coating that was UV-clear, food-grade safe, and durable in chlorinated water. / It therefore planned staged testing of candidate coatings to learn whether that combination existed. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a thin silica sol-gel layer with a fluorinated top surface cuts biofilm attachment, then raw drift will stay under 5 percent for 30 days. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team did not know if a coating could be UV-clear, safe and durable, so it screened four candidates. / Only the sol-gel with fluorinated top met both targets, narrowly, starting at 89 percent transmission. _(cited)_
  - Tested: uncertainty "The team did not know if a window coating could be UV-clear, safe f..."
- Fouling started at the edges where the sol-gel was thinnest, so the team changed the dip withdrawal speed. _(cited)_
  - Tested: uncertainty "The team did not know if a window coating could be UV-clear, safe f..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team did not know if a coating could be UV-clear and durable, and a sol-gel with fluorinated top met both targets. / The coating reached 87 percent initial transmission and 38 days to 5 percent loss. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Only the sol-gel with fluorinated top met both targets, starting at 89 percent transmission and losing 5 percent at day 31. _(cited)_
  - Links: uncertainty "The team did not know if a window coating could be UV-clear, safe f..."; experiments "The team did not know if a coating could be UV-clear, safe and dura..."
- The zwitterionic brush resisted biofilm best but started at 71 percent transmission, so it failed the clarity target. _(cited)_
  - Links: uncertainty "The team did not know if a window coating could be UV-clear, safe f..."; experiments "The team did not know if a coating could be UV-clear, safe and dura..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days is unresolved, so the team must confirm whether chlorine attacks the fluorinated layer. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team did not know if a coating could be UV-clear, safe and durable, and the sol-gel met both targets. _(cited)_

## Drafted Sections

### Line 242

It was uncertain whether a window coating could be UV-clear, safe for drinking water and durable in chlorinated water, because most fluoropolymers and hydrogels lose 30 to 60 percent of transmission at 254 nm. The company designs and builds water-quality instruments for municipal treatment plants. It set out to build an in-line analyzer that stays accurate for at least 30 days between cleanings without a mechanical wiper. Orion-1, a wiper-equipped prototype, was built in fiscal 2025, and the team met the limits of existing knowledge directly.

Most fluoropolymers and hydrogels that resist fouling lose 30 to 60 percent of their transmission at 254 nm. Many anti-fouling coatings used on marine sensors are biocidal, which is unusable in drinking or wastewater, or absorb strongly in the UV. No published coating was found that combined UV clarity, drinking-water safety and chlorine durability. Existing understanding also treated fouling as attenuating light evenly across wavelengths, but biofilm contains organics that absorb in the UV, so a simple ratio correction had no established basis.

The objective was to advance understanding of UV-transparent anti-fouling window surfaces and dual-wavelength fouling compensation, to create an in-line 254 nm analyzer with fouling drift under 5 percent raw and within 2 percent corrected for at least 30 days without cleaning. The team sought to learn whether a window surface could resist biofilm attachment for 30 days or more while staying UV-clear at 254 nm.

It was also uncertain whether a coating could reach at least 85 percent transmission at 254 nm when new and survive chlorinated, gritty water, and whether a thin sol-gel layer with a fluorinated top surface could keep raw drift under 5 percent for 30 days. Finally, it was uncertain whether the 365 nm reference channel could track fouling at 254 nm as the biofilm aged, because the film's own UV-absorbing organics could change that relationship.

### Line 244

The team did not know whether a window coating could be UV-clear at 254 nm, safe for drinking water and durable in chlorinated water. It could not find a published coating that combined all three. It therefore planned staged testing of candidate coatings to learn whether that combination existed. Coupon screening ran from August to October 2025 against uncoated controls. Bench testing of dual-wavelength correction in a fouling tank followed from October 2025 to January 2026. Field trials of full Orion-2 units at the Port Aldous Harbourside plant ran from February to June 2026. Each stage tested the previous stage's result under more realistic conditions.

If a thin silica sol-gel layer with a fluorinated top surface cuts biofilm attachment, then raw fouling drift will stay under 5 percent for 30 days, with initial transmission of at least 85 percent at 254 nm. A raw drift of 5 percent or more before day 30, or an initial transmission below 85 percent, would disprove it.

The team did not know if a coating could be UV-clear, safe and durable, so it screened four candidates. It coated fused silica coupons with a fluorosilane monolayer, a sol-gel with a fluorinated top, a zwitterionic polymer brush and a thin titania film. Twelve coupons of each, plus 12 uncoated controls, sat in a secondary effluent side stream for 42 days. Transmission at 254 nm was measured every 3 days. Uncoated windows lost 5 percent by day 11. The fluorosilane started at 92 percent transmission but wore off, reaching 5 percent loss by day 17. The zwitterionic brush resisted biofilm best but started at only 71 percent transmission. Titania grew film faster than the control; the team suspects the in-stream UV was too low to activate it and that its rough surface aided attachment. Only the sol-gel with fluorinated top met both targets, narrowly, starting at 89 percent transmission and reaching 5 percent loss at day 31.

Fouling started at the edges where the sol-gel was thinnest, so the team changed the dip withdrawal speed. It reduced withdrawal from 2 mm/s to 1 mm/s to give a more even layer of about 180 nm. A second round of 12 coupons was coated in November 2025. Time to 5 percent loss rose to 38 days. Initial transmission fell slightly to 87 percent, still above the 85 percent target. Why the slower withdrawal helped was not explained beyond this observation. The more even thickness delayed fouling while keeping clarity above target.

The fouling tank work tested whether a fixed multiple of 365 nm loss could correct 254 nm fouling drift. Six Orion-2 heads with uncoated windows ran 21 days in recirculated secondary effluent spiked with nutrients, which sped biofilm growth about threefold. Both channels were logged every 5 minutes. A window was pulled every 3 days to measure the film directly. The multiple was about 1.6 in the first 4 to 5 days and fell to about 1.15 after day 8. A fixed multiple of 1.4 therefore left 4.8 percent drift at day 21. The team then fitted a correction factor as a function of accumulated 365 nm loss, fitting on 4 heads and testing on the other 2. Held-out heads showed 1.7 percent drift at day 21. A fresh test of 6 new heads in January 2026 gave 1.9 percent worst case. The fixed-ratio hypothesis was disproved, but a correction keyed to accumulated reference loss held drift under 2 percent over 21 days in the tank.

Four complete Orion-2 units with coated windows and the fitted correction factor ran at Harbourside from February 9 to June 12, 2026. Two ran on secondary effluent and two on chlorinated final effluent. Twice-weekly grab samples on a lab spectrophotometer served as reference. On secondary effluent, raw drift crossed 5 percent at day 36 and day 40, while corrected drift stayed under 2 percent until day 52 and day 55. On final effluent, one unit's coating began thinning after about 70 days, with a 9 percent non-biofilm transmission drop between day 70 and day 90. Chlorine is suspected of slowly attacking the fluorinated layer, but this was not confirmed.

### Line 246

It was uncertain whether a UV-clear anti-fouling window and a reference channel could hold fouling drift under 5 percent raw and within 2 percent corrected for 30 days. The objective was partly achieved. The team did not know if a coating could be UV-clear and durable, and a sol-gel with a fluorinated top met both targets. Withdrawn at 1 mm/s instead of 2 mm/s, it gave a layer of about 180 nm, 87 percent initial transmission and 38 days to 5 percent loss. The fixed-multiple hypothesis was disproved.

It was determined that only one of four screened coatings met both targets. The team did not know if a coating could be UV-clear, safe and durable. The sol-gel with fluorinated top started at 89 percent transmission and lost 5 percent at day 31. The zwitterionic brush resisted biofilm best but started at 71 percent transmission, so it failed the clarity target. The sol-gel was carried into Orion-2.

It was established that the 254/365 multiple is not constant: it fell from about 1.6 to about 1.15 as the film matured. A fixed 1.4 multiple left 4.8 percent drift at day 21. A correction factor fitted to accumulated 365 nm loss gave 1.7 percent drift on held-out heads and 1.9 percent worst case on six new heads. In the field on secondary effluent, corrected drift stayed under 2 percent until day 52 and day 55. Raw drift crossed 5 percent at day 36 and day 40.

Coating durability in chlorinated water beyond 70 days is unresolved. One final-effluent unit lost 9 percent transmission between day 70 and day 90. Chlorine attack on the fluorinated layer is suspected but not confirmed, so fiscal 2027 work must test whether it is the cause. Cold-water behaviour at 4 to 6 C and transfer of the correction factor to a second plant also remain unknown.

With the sol-gel and the correction factor, Orion-2 moved toward an in-line analyzer that holds calibration past 30 days without a wiper on secondary effluent.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 309/350 words, 31/50 lines |
| 242 | Claim Exclusion: Business impact and customer benefit are not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Fiscal 2025 Orion-1 work falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Coating cost estimate is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Planned folding of coating into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: fouling drift | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Orion-1 baseline result is consistent across both sources. | applied | none |  | Orion-1 stated consistently. |
| 242 | Confidence Map: Sol-gel coating results and improvement are documented. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Titania result differs: transcript gives no day, notes say day 8; compatible, not conflicting. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Site transferability of the correction curve is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Chlorinated durability beyond 70 days is unresolved. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: orion-2 | applied | none |  | Orion-2 not named in the section. |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept absent. |
| 242 | Glossary Term: correction factor | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57j4gv0akzvn327cfbdpwtsg58h2g28 | applied | none |  | Company context stated in P1. |
| 242 | Cover signed-off Summary item h57tkdswq654rxzw6m9s9v6en18h25hs | applied | none |  | Goal stated in P1. |
| 242 | Cover signed-off Summary item h57sx5ztw97gjvednxr9yr6drh8h3353 | applied | none |  | P2 states the fluoropolymer limit. |
| 242 | Cover signed-off Summary item h57kssy4rkpeqc3z3ta7r2tkc18h3nwg | applied | none |  | P3 states the objective. |
| 242 | Cover signed-off Summary item h57rjvsdqjya9x6z99h0p8er3n8h26vy | applied | none | 2 | P1 states the coating uncertainty. |
| 242 | Cover signed-off Summary item h57xg67hv7wzga4sjh8tcmadwx8h3dhd | applied | none | 2 | P1 links transmission loss to uncertainty. |
| 242 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: Safe for drinking water adds detail; source says food-grade.) |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether a window surface could resist biofilm attachment for 30 days or more while staying UV-..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Most fluoropolymers and hydrogels lose 30 to 60 percent of transmission at 254 nm, so the coating outcome was uncertain." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 242 paragraph 1 (sections 242): Orion-1 was built in fiscal 2025, which the Brief places outside the fiscal 2026 claim period. The sentence presents that work as part of the uncertainty background. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 687/700 words, 61/100 lines |
| 244 | Claim Exclusion: Business impact and customer benefit are not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Fiscal 2025 Orion-1 work falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Coating cost estimate is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Planned folding of coating into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: fouling drift | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with Storyline. |
| 244 | Confidence Map: Orion-1 baseline result is consistent across both sources. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Sol-gel coating results and improvement are documented. | applied | none |  | Stated as documented. |
| 244 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift. | applied | none |  | 4.8 percent stated correctly. |
| 244 | Confidence Map: Titania result differs: transcript gives no day, notes say day 8; compatible, not conflicting. | applied | none |  | Titania day not stated. |
| 244 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | P6 hedges chlorine as suspected. |
| 244 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Site transferability of the correction curve is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Chlorinated durability beyond 70 days is unresolved. | applied | none |  | Not claimed beyond 70 days. |
| 244 | Glossary Term: reference channel | applied | none |  | Concept not named differently. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior year absent. |
| 244 | Cover signed-off Summary item h57qt8z0ngacy2zqec2xj3pjwd8h2qv7 | applied | none |  | Workplan covered. |
| 244 | Cover signed-off Summary item h57xg00d9hybs6pnrefycapr158h2s9d | applied | none |  | Hypothesis stated. |
| 244 | Cover signed-off Summary item h57p98znx983xxx0nk4egwwr8d8h3vr9 | applied | none |  | Screening covered. |
| 244 | Cover signed-off Summary item h57hjxhxy23brn9h8k6ynr22h58h2s1n | applied | none |  | Withdrawal change covered. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work answers stated uncertainties. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team did not know if a coating could be UV-clear, safe and durable, so it screened four candidates. Only the sol-ge..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Fouling started at the edges where the sol-gel was thinnest, so the team changed the dip withdrawal speed." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 5 (sections 244, 246): Line 244 says the fixed multiple of 1.4 left 4.8 percent drift at day 21 with the hypothesis disproved. 4.8 percent is under the 5 percent raw target. Line 246 repeats it, so the figure is consistent, but the fixed-ratio test used uncoated windows in the tank. Line 246 P1 does not make that clear. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): Line 244 says the coating thinning began after about 70 days on final effluent. Line 246 P4 calls durability beyond 70 days unresolved, but the field trial ran only Feb 9 to Jun 12 (about 123 days). The statement of a drop between day 70 and day 90 is consistent, but secondary-effluent corrected drift lasting until day 52 and 55 is described in P3 as the result, which is fine. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 333/350 words, 33/50 lines |
| 246 | Claim Exclusion: Business impact and customer benefit are not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Fiscal 2025 Orion-1 work falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Coating cost estimate is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Planned folding of coating into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: fouling drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Orion-1 baseline result is consistent across both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Sol-gel coating results and improvement are documented. | applied | none |  | Sol-gel results match the documented figures. |
| 246 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift. | applied | none |  | The 4.8 percent figure is stated as established. |
| 246 | Confidence Map: Titania result differs: transcript gives no day, notes say day 8; compatible, not conflicting. | applied | none |  | Titania is not mentioned. |
| 246 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | P4 says suspected but not confirmed. |
| 246 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | P4 says cold-water behaviour remains unknown. |
| 246 | Confidence Map: Site transferability of the correction curve is unknown. | applied | none |  | P4 says transfer remains unknown. |
| 246 | Confidence Map: Chlorinated durability beyond 70 days is unresolved. | applied | none |  | P4 says durability is unresolved. |
| 246 | Glossary Term: fouling tank | applied | none |  | Fouling tank is not named with other words. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57t6vyfzzy874mn6kwa19akdd8h3vyt | applied | none |  | P1 covers the sol-gel, 87 percent and 38 days. |
| 246 | Cover signed-off Summary item h57ga830w8e8j3dy3x686604k18h3ctf | applied | none | 2 | P2 gives 89 percent and day 31. |
| 246 | Cover signed-off Summary item h57yd98j6t3b2jee7vb9nzadkx8h3wnw | applied | none | 2 | P2 covers the zwitterionic brush at 71 percent. |
| 246 | Cover signed-off Summary item h57ptv1fdgedsxtr184ryq1sen8h38a0 | applied | none |  | P4 states durability past 70 days is unresolved. |
| 246 | Cover signed-off Summary item h57s401zzkpc4qr4kp6tw7x8718h3vzc | applied | none |  | P2 covers the uncertainty and the sol-gel result. |
| 246 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: P3 gives 1.7 percent drift on held-out heads at the wrong time point.) |
| 246 | State each result against its target as the numbers show | not_applied | none |  | P1 says "The objective was partly achieved.", but the sources say "So only one candidate met both targets, just barely.". |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Results answer Line 242 uncertainties or COVER items. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team did not know if a coating could be UV-clear, safe and durable, and the sol-gel met both targets." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the sol-gel gave 87 percent initial transmission and 38 days to 5 percent loss, but P2 says it started at 89 percent and lost 5 percent at day 31. Line 244 explains these are the first and second coupon rounds. Line 246 P1 gives no such distinction, which makes the two figures appear to conflict. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 1 plan check "Not checked" of 20.
- Line 244: 0 labels and 0 plan checks "Not checked" of 19.
- Line 246: 0 labels and 1 plan check "Not checked" of 19.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.8 s, p95 12.7 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 14.7 s, p95 14.7 s over 1.
- Sign-off to report created: 107.9 s.
- Cost from aiUsage: $1.33 in all ($0.50 seed stage, $0.83 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T16:50:34.159Z created project k970rc7my0k4bwy0c8bm4rfqjx8h2cmd
2026-10-27T16:50:35.031Z marked as an evaluation project
2026-10-27T16:50:35.964Z added document fiscal-2026-scoping-notes.md
2026-10-27T16:50:37.793Z started Step by step generation k5727qpdj59szcwjyc7qdmj44x8h3555
2026-10-27T16:51:01.794Z seed stage open
2026-10-27T16:51:01.794Z Open Company / Context and wait for its Batch
2026-10-27T16:51:10.145Z Company / Context: select the first Seed
2026-10-27T16:51:13.075Z Approve Company / Context
2026-10-27T16:51:15.847Z approved company_context
2026-10-27T16:51:15.847Z Open Goal / Problem and wait for its Batch
2026-10-27T16:51:29.905Z Goal / Problem: select the first Seed
2026-10-27T16:51:32.739Z Approve Goal / Problem
2026-10-27T16:51:35.416Z approved goal_problem
2026-10-27T16:51:35.416Z Open Technological limitations and wait for its Batch
2026-10-27T16:51:43.637Z Technological limitations: select the first Seed
2026-10-27T16:51:46.283Z Approve Technological limitations
2026-10-27T16:51:49.041Z approved passive_limitations
2026-10-27T16:51:49.042Z Open Technological objectives and wait for its Batch
2026-10-27T16:51:57.456Z Technological objectives: select the first Seed
2026-10-27T16:52:00.189Z Approve Technological objectives
2026-10-27T16:52:02.922Z approved technological_objective
2026-10-27T16:52:02.922Z Open Technological uncertainties and wait for its Batch
2026-10-27T16:52:11.415Z Technological uncertainties: select the first 2 Seeds
2026-10-27T16:52:15.957Z Approve Technological uncertainties
2026-10-27T16:52:18.650Z approved active_uncertainties
2026-10-27T16:52:18.650Z Open Previous-year status and wait for its Batch
2026-10-27T16:52:26.983Z Skip Previous-year status
2026-10-27T16:52:29.004Z Open Work plan and wait for its Batch
2026-10-27T16:52:46.399Z Work plan: select the first Seed
2026-10-27T16:52:49.272Z Approve Work plan
2026-10-27T16:52:52.001Z approved workplan
2026-10-27T16:52:52.001Z Open Hypothesis and wait for its Batch
2026-10-27T16:53:09.105Z Hypothesis: select the first Seed
2026-10-27T16:53:11.976Z Approve Hypothesis
2026-10-27T16:53:14.845Z approved hypothesis
2026-10-27T16:53:14.845Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T16:53:23.246Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T16:53:27.746Z Approve Experimentation / Iterations
2026-10-27T16:53:30.407Z approved experimentation
2026-10-27T16:53:30.407Z Open Advancement to science / technology and wait for its Batch
2026-10-27T16:53:41.437Z Advancement to science / technology: select the first Seed
2026-10-27T16:53:44.370Z Approve Advancement to science / technology
2026-10-27T16:53:47.062Z approved overall_advancement
2026-10-27T16:53:47.062Z Open Specific technological advancements and wait for its Batch
2026-10-27T16:53:58.293Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T16:54:05.472Z Approve Specific technological advancements
2026-10-27T16:54:08.200Z approved specific_advancements
2026-10-27T16:54:08.200Z Open Project status and next steps and wait for its Batch
2026-10-27T16:54:16.608Z Project status and next steps: select the first Seed
2026-10-27T16:54:19.341Z Approve Project status and next steps
2026-10-27T16:54:22.069Z approved project_status
2026-10-27T16:54:22.069Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T16:54:33.266Z Overall company / project goal improvements: select the first Seed
2026-10-27T16:54:35.972Z Approve Overall company / project goal improvements
2026-10-27T16:54:38.719Z approved goal_improvements
2026-10-27T16:54:38.719Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T16:54:40.571Z signed off; waiting for the report
2026-10-27T16:56:29.596Z report kd77xh7zpx133h972x0hj5j9mh8h25hq created
```
