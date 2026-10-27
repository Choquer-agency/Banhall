# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-10-27 on `local` at commit `df6eb97b`, acting as chat-live-1793085355051@example.test. Project `k9756kt4akzxzjjsee2z10fkvn8h3fpk`, generation `k571pgecsnxwtkd9779xda5hvs8h35bg`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd75x9pj8yeah9sz7n5nym5rsx8h2m69 |
| All three Sections were drafted | pass | 242: 348 words, 244: 646 words, 246: 314 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | no Seed Batch failed |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work backs stated uncertainties or Line 246 items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P2 says "Most fluoropolymers and hydrogels that resist fouling lose that share of transmission at 254 nm.", but the sources say "Most fluoropolymers and hydr..."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: applied ("The facts check found no figure or detail it could show differs from the sources.") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (10.3 s, 9.2 s); 244: 2 requests (7.1 s, 6.9 s); 246: 2 requests (8.7 s, 8.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (17 Batch, 0 Feedback), 17 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 3 Seed(s) offered, 1 cited; first: "Whether a reference channel could compensate for drift stayed open, since Orion-1 had a single wavelength." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 held calibration only 14 days before drift passed 5 percent."; claimExclusion: "Orion-1 wiper work was done in fiscal 2025, outside the claim period."; confidenceMap: "Orion-1 baseline of 14 days is supported by both sources." |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "Prior-year status is absent." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds water-quality instruments for municipal treatment plants. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- Customers want at least 30 days between cleanings with drift under 5 percent. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Orion-1 held calibration for only 14 days in secondary effluent before drift passed 5 percent. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought a window coating that keeps UV transmission high and resists biofilm for 30 days. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- Unknown whether any window surface could resist biofilm for 30 days while staying UV-clear. _(cited)_
- Published coatings were biocidal or lost 30 to 60 percent of transmission at 254. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- Coupon screening tested four coatings against uncoated controls to find one that stays UV-clear and resists biofilm. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a silica sol-gel has a fluorinated top surface, then raw drift stays under 5 percent for 30 days. / Test with 12 coupons per coating against 12 uncoated controls for 42 days in secondary effluent. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Four coatings and 12 uncoated controls ran 42 days; only the sol-gel with fluorinated top met both targets. _(cited)_
  - Tested: uncertainty "Unknown whether any window surface could resist biofilm for 30 days..."
- Zwitterionic brush resisted biofilm best but started at 71 percent transmission, so it failed clarity. _(cited)_
  - Tested: uncertainty "Published coatings were biocidal or lost 30 to 60 percent of transm..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Only the sol-gel with a fluorinated top met both targets, and only just. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Coatings that resist biofouling best, the zwitterionic ones, are not UV-clear enough for 254 nm use. _(cited)_
  - Links: uncertainty "Published coatings were biocidal or lost 30 to 60 percent of transm..."; experiments "Zwitterionic brush resisted biofilm best but started at 71 percent ..."
- The zwitterionic brush started at only 71 percent transmission, so it failed the clarity target. _(cited)_
  - Links: uncertainty "Published coatings were biocidal or lost 30 to 60 percent of transm..."; experiments "Zwitterionic brush resisted biofilm best but started at 71 percent ..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days is unresolved. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Only the sol-gel with a fluorinated top met both targets, and only just. _(cited)_

## Drafted Sections

### Line 242

Biofilm on the optical window of an in-line analyzer was the problem that drove this work, and the project was in no way routine. Port Aldous Instruments is a water-quality instrument developer that designs and builds in-line optical analyzers for municipal treatment plants. The company set out to build an analyzer that stays accurate for weeks without cleaning. Its main product line measures UV absorbance at 254 nm as a proxy for dissolved organic carbon. Customers want at least 30 days between cleanings with drift under 5 percent. The prior prototype, Orion-1, used a fused silica window with a mechanical wiper. It held calibration for only 14 days in secondary effluent before drift passed 5 percent.

The limitations to standard practice were that the knowledge required to keep a UV window clear of biofilm was insufficient. Published coatings were biocidal, which is not permitted for this use, or lost 30 to 60 percent of transmission at 254 nm. Most fluoropolymers and hydrogels that resist fouling lose that share of transmission at 254 nm. No documented coating combined UV clarity with durability in chlorinated water. Existing understanding assumed fouling attenuates light evenly across wavelengths, although biofilm contains UV-absorbing organics. Published ultrasonic cleaning results were mixed, and its power draw of about 4 W exceeded the 1.5 W available.

The technological objective was to advance the understanding of UV-transparent anti-fouling window coatings and dual-wavelength fouling compensation, for the purposes of creating an in-line analyzer with a coated window and a reference channel that holds drift under 5 percent for 30 days without cleaning.

It was uncertain whether any window surface could resist biofilm for 30 days while staying UV-clear at 254 nm, because published coatings were biocidal or lost 30 to 60 percent of transmission. It was uncertain whether a sol-gel layer with a fluorinated top surface would survive chlorine and grit, because scratches had given biofilm anchoring sites on Orion-1. It was uncertain whether 254 nm attenuation would stay a stable multiple of the 365 nm reference loss as the biofilm matured, because biofilm composition may change with age.

### Line 244

The coupon screening addressed whether any window surface could resist biofilm for 30 days while staying UV-clear at 254 nm. This was open because published coatings were biocidal or lost 30 to 60 percent of transmission. The company planned coupon screening of four coatings against uncoated controls to find one that stays UV-clear and resists biofilm. The candidates were a fluorosilane monolayer, a sol-gel silica with a fluorinated top surface, a zwitterionic polymer brush and a thin titania film. The coating that passed would go into later bench and field work.

The hypothesis was that if a silica sol-gel has a fluorinated top surface, then raw drift stays under 5 percent for 30 days. Transmission at 254 nm would also stay at or above 85 percent when new. The test used 12 coupons of each coating against 12 uncoated controls for 42 days in a secondary effluent side stream. Transmission at 254 nm was measured every 3 days. Sol-gel coupons failing to reach 30 days under 5 percent loss would disprove the hypothesis.

The company coated fused silica coupons with the four candidates and exposed them alongside the controls. Controls lost 5 percent of transmission by day 11 and 22 percent by day 42. The fluorosilane monolayer started at 92 percent but lost 5 percent by day 17. The titania film grew biofilm faster than the controls. Suspected causes are in-stream UV too low to activate it and a rough surface aiding attachment, neither confirmed. The sol-gel with a fluorinated top started at 89 percent and lost 5 percent at day 31. Only this candidate met both targets, and only just.

The zwitterionic polymer brush showed the best biofilm resistance of the four, but it started at only 71 percent transmission. That was below the 85 percent target from day one, so it failed the clarity requirement. The most fouling-resistant coating tested was not UV-clear enough for 254 nm use.

Fouling on the sol-gel coupons began at the edges, where the coating was thinnest. The company reduced the dip withdrawal speed from 2 mm/s to 1 mm/s. This gave a more even layer of about 180 nm. A second round of 12 coupons ran in November 2025. Initial transmission dropped to 87 percent, still above target. Time to 5 percent loss rose from 31 to 38 days.

The remaining uncertainty was whether a fixed 254/365 nm attenuation multiple could correct fouling drift. The company logged both channels every 5 minutes on six Orion-2 heads with deliberately uncoated windows in a fouling tank. The tank used recirculated secondary effluent spiked with nutrients to speed biofilm growth about threefold. The run lasted 21 days, and a window was pulled every 3 days to measure the film directly. The multiple was about 1.6 in the first 4 to 5 days and fell to about 1.15 after about day 8. A fixed multiple of 1.4 left 4.8 percent drift at day 21, which disproved the fixed-ratio hypothesis.

The multiple tracked accumulated 365 nm loss. The company therefore fitted the correction factor as a function of that loss, using 4 heads and testing on the other 2. Corrected drift was 1.7 percent at day 21. A fresh 21-day test in January 2026 with 6 new heads gave 1.9 percent worst case. This met the 2 percent target on the bench.

Four complete Orion-2 units then ran at the Harbourside plant from February 9 to June 12 2026. Two ran on secondary effluent and two on chlorinated final effluent. On secondary effluent, raw drift crossed 5 percent at day 36 and day 40. Corrected drift stayed under 2 percent until day 52 and day 55. On final effluent, one coating thinned after about 70 days, with a 9 percent transmission drop between day 70 and day 90 that was not biofilm. Chlorine attack on the fluorinated layer is suspected but not confirmed.

### Line 246

It was uncertain whether any window surface could resist biofilm for 30 days while staying UV-clear at 254 nm, and the work answered that only narrowly. The objective was to advance knowledge of UV-transparent anti-fouling coatings and dual-wavelength fouling compensation for an analyzer holding drift under 5 percent for 30 days. Of four candidates, only the sol-gel with a fluorinated top met both targets, and only just, starting at 89 percent transmission and losing 5 percent at day 31. The fixed-ratio hypothesis was disproved, and a fitted correction replaced it.

Through this investigation, it was established that the coatings that resist biofilm best are not UV-clear enough for 254 nm use. The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, so it failed the 85 percent clarity target from day one. This resolved the uncertainty regarding whether any surface could combine fouling resistance with UV clarity, given that published coatings were biocidal or lost 30 to 60 percent of transmission. Based on this understanding, the company narrowed development to the sol-gel, and a more even layer of about 180 nm extended time to 5 percent loss to 38 days at 87 percent initial transmission.

Coating durability in chlorinated water beyond 70 days remains unresolved. On one final effluent unit, transmission fell 9 percent between day 70 and day 90 without biofilm; chlorine attack on the fluorinated layer is suspected but not confirmed. Behaviour at 4 to 6 C is also unknown, since field data covered 9 to 17 C. Fiscal 2027 work will address chlorinated-water durability, winter conditions and transfer of the correction curve to a second plant.

The project goal was an analyzer running 30 days without cleaning. The sol-gel window on secondary effluent kept raw drift under 5 percent until day 36 and day 40, and corrected drift stayed under 2 percent until day 52 and day 55.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 348/350 words, 34/50 lines |
| 242 | Claim Exclusion: Business impact and customer demand for longer service intervals is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Folding the coating and correction into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Orion-1 wiper work was done in fiscal 2025, outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Fiscal 2025 spend belongs to the prior year. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Coating cost estimate is a commercial consideration. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Firmware fouling index reporting for operators is a product feature, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline. |
| 242 | Confidence Map: Orion-1 baseline of 14 days is supported by both sources. | applied | none |  | 14 days stated correctly. |
| 242 | Confidence Map: Coating screening results. | applied | none |  | No conflict. |
| 242 | Confidence Map: Multiple changed from 1.6 to 1.15. | applied | none |  | No conflict. |
| 242 | Confidence Map: Repeat tank test gave 1.9 percent worst case. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | Chlorine attack not stated as fact. |
| 242 | Confidence Map: Titania failure explanation is a hypothesis. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Titania day of 5 percent loss appears only in notes; interview gives no day. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Technician time: interview says almost full time, notes say about 90 percent; compatible. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: coupon screening | applied | none |  | Concept absent. |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept absent. |
| 242 | Glossary Term: corrected drift | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57zrktmr1aw2dwbeqngkc83y98h301z | applied | none |  | Company context given. |
| 242 | Cover signed-off Summary item h57jygcvz17rz75agscpps88ph8h3k56 | applied | none |  | 30 days and 5 percent stated. |
| 242 | Cover signed-off Summary item h57x93kfnxv1ne6yweprt53cxs8h2txy | applied | none |  | Orion-1 14 days stated. |
| 242 | Cover signed-off Summary item h57t0ejrqexsp4mh6cxy61h7n18h2hnw | applied | none |  | Objective stated. |
| 242 | Cover signed-off Summary item h57vdw596vnd3a1f198srpq8b18h3rp3 | applied | none | 2 | Window surface uncertainty stated. |
| 242 | Cover signed-off Summary item h57vge8x96dz132nz5wemqp1tn8h2k54 | applied | none | 2 | Published coatings limits stated. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P2 says "Most fluoropolymers and hydrogels that resist fouling lose that share of transmission at 254 nm.", but the sources say "Most fluoropolymers and hydrogels that resist fouling are fine in visible light but lose 30 to 60 percent of their transmission at 254.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Unknown whether any window surface could resist biofilm for 30 days while staying UV-clear." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Published coatings were biocidal or lost 30 to 60 percent of transmission at 254." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 646/700 words, 59/100 lines |
| 244 | Claim Exclusion: Business impact and customer demand for longer service intervals is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Folding the coating and correction into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Orion-1 wiper work was done in fiscal 2025, outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Fiscal 2025 spend belongs to the prior year. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Coating cost estimate is a commercial consideration. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Firmware fouling index reporting for operators is a product feature, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: corrected drift | applied | none |  | Glossary Term used (paragraph 7) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Orion-1 baseline of 14 days is supported by both sources. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Coating screening results. | applied | none |  | Screening results match. |
| 244 | Confidence Map: Multiple changed from 1.6 to 1.15. | applied | none |  | Multiple stated as sourced. |
| 244 | Confidence Map: Repeat tank test gave 1.9 percent worst case. | applied | none |  | 1.9 percent stated correctly. |
| 244 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | P8 hedges chlorine as suspected. |
| 244 | Confidence Map: Titania failure explanation is a hypothesis. | applied | none |  | P3 hedges titania causes. |
| 244 | Confidence Map: Titania day of 5 percent loss appears only in notes; interview gives no day. | applied | none |  | No titania day stated. |
| 244 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Technician time: interview says almost full time, notes say about 90 percent; compatible. | applied | none |  | Not mentioned in the section. |
| 244 | Glossary Term: reference channel | applied | none |  | Section uses 'channels', not a different name. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status is absent. |
| 244 | Cover signed-off Summary item h57sy570rw2y0hceeskg5p0zh58h3avk | applied | none |  | Coupon screening of four coatings stated. |
| 244 | Cover signed-off Summary item h57kyqqm57dg7hy4drv2a8nzth8h3pvc | applied | none |  | Hypothesis and test design stated. |
| 244 | Cover signed-off Summary item h57k1ahb2ej91cydy7bb8bcp7d8h2zvj | applied | none |  | Results and sol-gel result stated. |
| 244 | Cover signed-off Summary item h57n6gmyvewd429t215ec5d33n8h2an5 | applied | none |  | Zwitterionic 71 percent failure stated. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work backs stated uncertainties or Line 246 items. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Zwitterionic brush resisted biofilm best but started at 71 percent transmission, so it failed clarity." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 244 paragraph 6 (sections 242, 244): Line 244 calls the test rig a "fouling tank" (Glossary Term), but the same concept is not named differently elsewhere; no change needed here. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 7 (sections 244): Line 244 P7 says the bench result met a "2 percent target", but the stated objective in Lines 242 and 246 is drift under 5 percent. The 2 percent target is never established elsewhere. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 2 (sections 244, 246): Line 244 P2 says controls and coupons are judged on 5 percent loss; the sol-gel failure criterion is stated as 30 days, while P3 reports controls losing 5 percent at day 11 and the Line 242 P1 says Orion-1 held 14 days. These are consistent, but the 85 percent clarity target is described as 'when new' while the sol-gel new value of 87 percent in the second round is called above target; no conflict. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 314/350 words, 29/50 lines |
| 246 | Claim Exclusion: Business impact and customer demand for longer service intervals is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Folding the coating and correction into the next product revision is commercialization. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Orion-1 wiper work was done in fiscal 2025, outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Fiscal 2025 spend belongs to the prior year. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Coating cost estimate is a commercial consideration. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Firmware fouling index reporting for operators is a product feature, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: corrected drift | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with Storyline. |
| 246 | Confidence Map: Orion-1 baseline of 14 days is supported by both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Coating screening results. | applied | none |  | Screening results match. |
| 246 | Confidence Map: Multiple changed from 1.6 to 1.15. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Repeat tank test gave 1.9 percent worst case. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Chlorine attack on the coating is suspected, not confirmed. | applied | none |  | P3 hedges chlorine attack as suspected. |
| 246 | Confidence Map: Titania failure explanation is a hypothesis. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Titania day of 5 percent loss appears only in notes; interview gives no day. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Cold-water behaviour is unknown. | applied | none |  | P3 says cold behaviour is unknown. |
| 246 | Confidence Map: Technician time: interview says almost full time, notes say about 90 percent; compatible. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: reference channel | applied | none |  | Concept not named with other words. |
| 246 | Glossary Term: coupon screening | applied | none |  | Concept absent. |
| 246 | Glossary Term: fouling tank | applied | none |  | Concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57qe25p5nexfv8zmxmmew24v98h3g9t | applied | none |  | P1 states only the sol-gel met both targets, just. |
| 246 | Cover signed-off Summary item h57yz2vcfwbzmhryhq8bawe7ad8h3cja | applied | none | 2 | P2 says best resisting coatings are not UV-clear. |
| 246 | Cover signed-off Summary item h57zr8g9zmv95d365s5ff082v18h22ka | applied | none | 2 | P2 gives 71 percent and failed clarity. |
| 246 | Cover signed-off Summary item h57nmdnhbn4kxxkjd2cdmrb0s58h2axx | applied | none |  | P3 states durability beyond 70 days unresolved. |
| 246 | Cover signed-off Summary item h57x4989h7zken3ceway4gesfx8h3g3m | applied | none |  | P1 states only the sol-gel met both, only just. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Claims answer stated uncertainties or COVER items. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 21.
- Line 244: 0 labels and 0 plan checks "Not checked" of 20.
- Line 246: 0 labels and 0 plan checks "Not checked" of 22.

## Seed-stage numbers

- Requests: 17 metered (17 Batch, 0 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.4 s, p95 18.6 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 17.5 s, p95 17.5 s over 1.
- Sign-off to report created: 100.8 s.
- Cost from aiUsage: $1.35 in all ($0.53 seed stage, $0.82 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T20:46:30.001Z created project k9756kt4akzxzjjsee2z10fkvn8h3fpk
2026-10-27T20:46:30.985Z marked as an evaluation project
2026-10-27T20:46:31.934Z added document fiscal-2026-scoping-notes.md
2026-10-27T20:46:33.766Z started Step by step generation k571pgecsnxwtkd9779xda5hvs8h35bg
2026-10-27T20:46:52.474Z seed stage open
2026-10-27T20:46:52.475Z Open Company / Context and wait for its Batch
2026-10-27T20:46:58.093Z Company / Context: select the first Seed
2026-10-27T20:47:01.646Z Approve Company / Context
2026-10-27T20:47:04.819Z approved company_context
2026-10-27T20:47:04.819Z Open Goal / Problem and wait for its Batch
2026-10-27T20:47:13.462Z Goal / Problem: select the first Seed
2026-10-27T20:47:16.692Z Approve Goal / Problem
2026-10-27T20:47:19.578Z approved goal_problem
2026-10-27T20:47:19.578Z Open Technological limitations and wait for its Batch
2026-10-27T20:47:40.484Z Technological limitations: select the first Seed
2026-10-27T20:47:43.321Z Approve Technological limitations
2026-10-27T20:47:46.286Z approved passive_limitations
2026-10-27T20:47:46.286Z Open Technological objectives and wait for its Batch
2026-10-27T20:47:55.372Z Technological objectives: select the first Seed
2026-10-27T20:47:58.137Z Approve Technological objectives
2026-10-27T20:48:01.703Z approved technological_objective
2026-10-27T20:48:01.703Z Open Technological uncertainties and wait for its Batch
2026-10-27T20:48:11.060Z Technological uncertainties: select the first 2 Seeds
2026-10-27T20:48:16.435Z Approve Technological uncertainties
2026-10-27T20:48:19.213Z approved active_uncertainties
2026-10-27T20:48:19.213Z Open Previous-year status and wait for its Batch
2026-10-27T20:48:28.073Z Skip Previous-year status
2026-10-27T20:48:30.078Z Open Work plan and wait for its Batch
2026-10-27T20:48:50.475Z Work plan: select the first Seed
2026-10-27T20:48:53.371Z Approve Work plan
2026-10-27T20:48:56.587Z approved workplan
2026-10-27T20:48:56.587Z Open Hypothesis and wait for its Batch
2026-10-27T20:49:11.819Z Hypothesis: select the first Seed
2026-10-27T20:49:14.610Z Approve Hypothesis
2026-10-27T20:49:17.712Z approved hypothesis
2026-10-27T20:49:17.712Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T20:49:27.228Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T20:49:31.983Z Approve Experimentation / Iterations
2026-10-27T20:49:35.022Z approved experimentation
2026-10-27T20:49:35.022Z Open Advancement to science / technology and wait for its Batch
2026-10-27T20:49:43.944Z Advancement to science / technology: select the first Seed
2026-10-27T20:49:46.864Z Approve Advancement to science / technology
2026-10-27T20:49:51.043Z approved overall_advancement
2026-10-27T20:49:51.044Z Open Specific technological advancements and wait for its Batch
2026-10-27T20:50:00.435Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T20:50:09.384Z Approve Specific technological advancements
2026-10-27T20:50:12.605Z approved specific_advancements
2026-10-27T20:50:12.605Z Open Project status and next steps and wait for its Batch
2026-10-27T20:50:23.688Z Project status and next steps: select the first Seed
2026-10-27T20:50:29.035Z Approve Project status and next steps
2026-10-27T20:50:33.185Z approved project_status
2026-10-27T20:50:33.185Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T20:50:51.784Z Overall company / project goal improvements: select the first Seed
2026-10-27T20:50:55.021Z Approve Overall company / project goal improvements
2026-10-27T20:50:58.378Z approved goal_improvements
2026-10-27T20:50:58.378Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T20:51:00.480Z signed off; waiting for the report
2026-10-27T20:52:44.052Z report kd75x9pj8yeah9sz7n5nym5rsx8h2m69 created
```
