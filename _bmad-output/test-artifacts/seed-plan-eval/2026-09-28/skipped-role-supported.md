# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-28 on `local` at commit `681d8e7b`, acting as e2e-audit@banhall.local. Project `k97a6z19dmpd4d6hztjfzbmvvs8f9b0t`, generation `k573xvph49y7yw1cgstw2smw558f9j41`.

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

7 passed, 3 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7ambqrh8djq2fgx8av77ssk98f8tjn |
| All three Sections were drafted | pass | 242: 312 words, 244: 690 words, 246: 440 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | fail | 242: "The plan coverage Self-check did not complete."; 242: "The plan coverage Self-check did not complete."; 242: "The plan coverage Self-check did not complete."; 242: "The plan coverage Self-check did not complete."; 242: "The plan coverage Self-check did not complete."; 242: "The plan coverage Self-check did not complete."; 244: "The plan coverage Self-check did not complete."; 244: "The plan coverage Self-check did not complete."; 244: "The plan coverage Self-check did not complete."; 244: "The plan coverage Self-check did not complete."; 246: "The plan coverage Self-check did not complete."; 246: "The plan coverage Self-check did not complete."; 246: "The plan coverage Self-check did not complete."; 246: "The plan coverage Self-check did not complete."; 246: "The plan coverage Self-check did not complete." |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: not_applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 13 metered calls (13 Batch, 0 Feedback), 13 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 3 cited; first: "Orion-1 held calibration for only 14 days at fiscal 2025 year end, against a 30-day customer target." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 (uncoated window, mechanical wiper) held calibration for only 14 days at the end of fisca..."; storyline: "Three wiper blade materials were tested on Orion-1 and none exceeded 16 days."; storyline: "Orion-1 lacked a reference channel and so could not separate fouling drift from real water-qualit..."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (established across both sou..."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | fail | Omit signed-off role prior_year_status: not_applied; "The plan coverage Self-check did not complete." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | fail | "The company investigated two open uncertainties carried from Orion-1: whether a window coating could resist biofilm attachment for 30 days" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds in-line optical water-quality instruments for municipal treatment plants. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought to build Orion-2, a coated-window, dual-wavelength optical analyzer to replace the failed mechanical wiper design. / The goal was an in-line UV absorbance sensor that resists biofilm fouling without operator cleaning for at least 30 days. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published anti-fouling coating was known to be UV-clear, food-grade safe, and durable in chlorinated water at once. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to know whether a window coating could resist biofilm attachment for 30 days while staying UV-clear at 254 nanometres. / This knowledge was meant to enable a coated window that survives chlorine and grit without operator cleaning. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unknown whether any coating could be simultaneously UV-clear, food-grade safe, and durable in chlorinated water. / No published combination was known to exist, since marine anti-fouling coatings use biocides or absorb strongly in the UV. _(cited)_
- It was unknown whether biofilm attenuation would behave as a spectrally flat filter across wavelengths. / Biofilm contains its own UV-absorbing organics, so the textbook assumption of even attenuation was uncertain. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned coupon screening of four coating candidates against uncoated controls over 42 days in secondary effluent. / Transmission at 254 nanometres would be measured every 3 days to compare clarity and durability. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a thin silica sol-gel layer with a fluorinated top surface resists biofilm attachment, then raw drift will stay under 5 percent for 30 days. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Coupon screening tested four coating candidates plus uncoated controls over 42 days with transmission measured every 3 days. / Only the sol-gel with fluorinated top met both the clarity and durability targets, narrowly, at 89 percent initial transmission. _(cited)_
- The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing the clarity target. / The titania film fouled faster than uncoated controls, likely from low in-stream UV intensity and rough surface. _(cited)_

### 10. Advancement to science / technology (Section 246, standard): approved

- The coating advancement met its objective only narrowly, reaching 89 percent initial transmission and 31 days before dip-speed refinement. / The refined sol-gel coating then reached 87 percent transmission and 38 days to 5 percent loss, still above the 85 percent target. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The team learned a sol-gel silica coating with a fluorinated top layer could hold 85 percent transmission and resist fouling. / This resolved the coating uncertainty, narrowly meeting both the clarity and durability targets at once. _(cited)_
  - Links: uncertainty "It was unknown whether any coating could be simultaneously UV-clear..."; experiments "Coupon screening tested four coating candidates plus uncoated contr..."
- The team learned that zwitterionic brush and titania coatings could not resolve the coating uncertainty despite fouling resistance. / The zwitterionic brush failed on clarity and the titania film fouled faster than an uncoated window. _(cited)_
  - Links: uncertainty "It was unknown whether any coating could be simultaneously UV-clear..."; experiments "The zwitterionic brush resisted biofilm best but started at only 71..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability beyond 70 days in chlorinated water remains unresolved, suspected as chlorine attack on the fluorinated layer. / This open question about the coated window's chlorine resistance carries forward into fiscal 2027. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Learning that biofilm is not a spectrally flat filter led to a correction keyed to accumulated reference loss rather than a fixed ratio. / This resolved the drift-compensation goal, holding corrected drift under 2 percent for more than 50 days in the field trial. _(cited)_

## Drafted Sections

### Line 242

The company designs and builds in-line optical water-quality instruments for municipal treatment plants. The company sought to build Orion-2, a coated-window, dual-wavelength optical analyzer to replace the failed mechanical wiper design used in Orion-1, aiming for an in-line UV absorbance sensor that resists biofilm fouling without operator cleaning for at least 30 days.

The limitations to standard practice were that no published anti-fouling coating was known to be UV-clear at 254 nm, food-grade safe, and durable in chlorinated water at once. Marine anti-fouling coatings rely on biocides unsuitable for drinking and wastewater applications, or absorb strongly in the UV, so no documented combination met all three requirements together. Standard practice also assumed that fouling attenuates light evenly across wavelengths, treating a biofilm as a spectrally flat filter that a simple ratio correction could compensate for. This assumption had no basis in validated data for real biofilms, which contain their own UV-absorbing organics and are not neutral-density filters.

The technological objective was to advance understanding of fouling-resistant coating chemistries and dual-wavelength optical correction models, in order to build a coated Orion-2 window and reference-channel measurement system that keeps calibration accuracy without operator cleaning for at least 30 days. The team sought to know whether a window coating could resist biofilm attachment for 30 days while staying UV-clear at 254 nm, so as to enable a coated window that survives chlorine and grit without operator cleaning.

It was uncertain whether any coating could be simultaneously UV-clear, food-grade safe, and durable in chlorinated water, since no published combination was known to exist and marine anti-fouling coatings either use biocides or absorb strongly in the UV. It was also uncertain whether biofilm attenuation would behave as a spectrally flat filter across the 254 nm and 365 nm channels, since biofilm contains its own UV-absorbing organics, making the textbook assumption of even attenuation unverified for this application.

### Line 244

The company investigated two open uncertainties carried from Orion-1: whether a window coating could resist biofilm attachment for 30 days while staying UV-clear at 254 nm and durable against chlorine and grit, and whether a reference channel could correct fouling-induced drift. No published coating chemistry was known to meet both targets, so coupon screening tested four coating candidates against uncoated controls over 42 days in secondary effluent, measuring transmission at 254 nm every 3 days. A parallel workstream in a recirculating fouling tank tested whether biofilm attenuation at 254 nm and 365 nm scaled together closely enough to support a mathematical drift correction. Field trials of complete Orion-2 units then checked both findings under real operating conditions.

The working hypothesis was that a thin silica sol-gel layer with a fluorinated top surface would resist biofilm attachment and hold raw drift under 5 percent for 30 days. The team expected at least one of the four candidates to combine clarity and durability outright, based on published performance of these chemistries in other fouling contexts. Instead, most failed one target or the other: the zwitterionic brush resisted biofilm best but started at only 71 percent transmission, missing the clarity target, and the titania film fouled faster than uncoated controls, likely from low in-stream UV intensity and a rough surface that aided attachment. Only the sol-gel with fluorinated top met both targets, narrowly, at 89 percent initial transmission and 31 days to 5 percent loss, confirming that a coating meeting both requirements existed but with little margin.

The sol-gel coating began fouling at the coupon edges, where the layer was thinnest, threatening to undercut the 30-day result before it could be confirmed at scale. The team reduced dip withdrawal speed from 2 mm/s to 1 mm/s to produce a more even layer around 180 nm thick and ran a second round of 12 coupons. Time to 5 percent transmission loss increased to 38 days, with initial transmission at 87 percent, above the 85 percent target. This confirmed edge-thinning as a controllable failure mode and showed dip withdrawal speed was a load-bearing process parameter for coating durability.

The team then tested whether fouling attenuation at 254 nm was a fixed multiple of attenuation at 365 nm, which would allow a simple ratio-based drift correction. Six uncoated Orion-2 optical heads ran in a fouling tank with nutrient-spiked effluent for 21 days, logging both channels every 5 minutes and pulling windows every 3 days to measure film directly. The multiple was not fixed: it ran near 1.6 during early film growth and fell to about 1.15 as the film matured, so a fixed multiple of 1.4 left 4.8 percent drift at day 21, well above the 2 percent target, disproving the simple ratio hypothesis. The multiple tracked total accumulated 365 nm loss instead, so the team fit a correction factor as a function of accumulated loss, training on 4 heads and validating on 2 held-out heads. This held drift to 1.7 percent at day 21 on the held-out heads, and a second independent tank run with 6 new heads confirmed 1.9 percent worst-case drift, the first time drift under 2 percent had been achieved in that tank.

With both approaches validated in isolation, the team combined them in a field trial to test whether results would hold outside controlled tank conditions. Four Orion-2 units, with coated windows fitted with the correction function, ran at the Harbourside plant from February to June 2026, two on secondary effluent and two on chlorinated final effluent, checked against twice-weekly lab spectrophotometer grab samples. Corrected drift held under 2 percent to day 52 and day 55 on secondary effluent, well past the 30-day target, while raw uncorrected drift on the same units exceeded 5 percent by day 36 and day 40. On chlorinated final effluent, one unit's coating showed a 9 percent non-biofilm transmission loss between day 70 and day 90, pointing to a new durability limit beyond the coupon and tank test windows. This confirmed the coating-plus-correction approach extends usable interval past 50 days in the field, while exposing chlorine exposure as an unresolved degradation mechanism for the fluorinated layer.

### Line 246

The technological objective, to advance fouling-resistant coating chemistry and dual-wavelength optical correction for an in-line UV absorbance sensor, was achieved, though the coating result met targets only narrowly. The coating hypothesis, that a sol-gel layer with a fluorinated top would hold raw drift under 5 percent for 30 days, was proven only after dip withdrawal speed was reduced. The first coating batch reached only 89 percent initial transmission and 31 days before dip-speed refinement; the refined coating then reached 87 percent transmission and 38 days to 5 percent loss, still above the 85 percent target. The correction hypothesis, that a fixed multiple between the 254 nm and 365 nm channels could compensate for drift, was disproven, since the ratio changed as biofilm matured. A revised hypothesis based on accumulated reference-channel loss was proven instead, holding drift under 2 percent in both tank and field conditions.

The team learned a sol-gel silica coating with a fluorinated top layer could hold 85 percent transmission at 254 nm while resisting fouling. This resolved the uncertainty regarding whether any coating could be simultaneously UV-clear, food-grade safe, and durable in chlorinated water, since no published combination was known to exist. This knowledge built the coated Orion-2 window used in later tank and field testing.

The team also learned that zwitterionic brush and titania coatings could not resolve that same uncertainty despite their fouling resistance. The zwitterionic brush failed on clarity, reaching only 71 percent transmission at 254 nm; the titania film fouled faster than an uncoated window, likely from low in-stream UV intensity and surface roughness aiding attachment. This ruled out two candidates that had looked promising from published fouling performance alone.

Biofilm attenuation is not a spectrally flat filter: the attenuation multiple between 254 nm and 365 nm shifted from about 1.6 early in film growth to about 1.15 as the film matured. This showed a fixed-ratio correction could not work and led to a correction factor keyed to accumulated 365 nm loss instead, holding drift under 2 percent for over 50 days in the field trial.

Coating durability beyond 70 days in chlorinated water remains unresolved, suspected as chlorine attack on the fluorinated layer. This open question about the coated window's chlorine resistance carries into fiscal 2027, alongside cold-water biofilm behaviour and transferability of the correction curve to a plant with higher industrial load.

Learning that biofilm is not a spectrally flat filter led directly to a correction keyed to accumulated reference loss rather than a fixed ratio. This resolved the drift-compensation goal, holding corrected drift under 2 percent for more than 50 days in the field trial, up from Orion-1's 14 days.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 312/350 words, 33/50 lines; repaired |
| 242 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer service-interval complaints and market desirability framing are business rationale, not technological advancement. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Coating cost per window is a commercial/costing figure, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Routine operational scheduling of grab sampling is standard measurement practice, not itself the systematic investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Model Self-check | not_applied | none |  | Self-check call failed (unknown: 9 ordinary verdicts for 22 labels); deterministic checks only |
| 242 | Cover signed-off Summary item ys7bc6td4rz9dc9g6fxs7e35h98f9tec | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item ys7d4p09tzry5vag93t0e4tnj98f9qtj | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item ys77c7b58snzfamjgt2y7yegtn8f9w2x | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item ys70y57khd591xhvcwh4mhgcvh8f8dey | not_applied | none |  | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item ys77r22dj4r6se47fr92wt2p318f8pep | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 242 | Cover signed-off Summary item ys712yek8t91ppxrg4839bxhf18f924v | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 690/700 words, 63/100 lines |
| 244 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer service-interval complaints and market desirability framing are business rationale, not technological advancement. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Coating cost per window is a commercial/costing figure, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Routine operational scheduling of grab sampling is standard measurement practice, not itself the systematic investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: drift | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: dip withdrawal speed | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: grab samples | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: transmission at 254 nm | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Model Self-check | not_applied | none |  | Self-check call failed (unknown: 6 ordinary verdicts for 17 labels); deterministic checks only |
| 244 | Omit signed-off role prior_year_status | not_applied | none |  | The plan coverage Self-check did not complete. |
| 244 | Cover signed-off Summary item ys7745yd9j2gybbv4j47q71dfh8f9mkx | not_applied | none |  | The plan coverage Self-check did not complete. |
| 244 | Cover signed-off Summary item ys7bae17q8wz3hva0bzyxsrzjd8f8e8p | not_applied | none |  | The plan coverage Self-check did not complete. |
| 244 | Cover signed-off Summary item ys77h142tfj050awazjqpsbj818f8tm7 | not_applied | none |  | The plan coverage Self-check did not complete. |
| 244 | Cover signed-off Summary item ys7667anh4ct49hqqdgv8pka4n8f9dx9 | not_applied | none |  | The plan coverage Self-check did not complete. |
| 244 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 244 paragraph 2 (sections 242, 244): Line 242 P4 frames the coating uncertainty as three simultaneous properties (UV-clear, food-grade safe, durable in chlorinated water). Line 244 P2 describes the working hypothesis and candidate outcomes only in terms of clarity and durability targets, dropping the food-grade safety criterion from the discussion of the four candidates. This creates an inconsistency in how many requirements the coating had to satisfy across sections. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | not_applied | locked |  | cap breach at 440/350 words, 45/50 lines; repair failed |
| 246 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer service-interval complaints and market desirability framing are business rationale, not technological advancement. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Coating cost per window is a commercial/costing figure, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Routine operational scheduling of grab sampling is standard measurement practice, not itself the systematic investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 6) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: dip withdrawal speed | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: transmission at 254 nm | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Model Self-check | not_applied | none |  | Self-check call failed (unknown: 8 ordinary verdicts for 19 labels); deterministic checks only |
| 246 | Cover signed-off Summary item ys77gj19zwvwzmh9jc37rkhpfh8f91mh | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys794m8d3kpzxyfhm2w8sbekmh8f8w9h | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys76gjya2fa69sr99e304g4pd18f8mb7 | not_applied | none | 2 | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys7b9vwjgshhvst56936eqddd18f8g0g | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Cover signed-off Summary item ys72z8tgj7sqt5z9mbzepbm70d8f9vnh | not_applied | none |  | The plan coverage Self-check did not complete. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team learned a sol-gel silica coating with a fluorinated top layer could hold 85 percent transmission and resist fo..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Learning that biofilm is not a spectrally flat filter led to a correction keyed to accumulated reference loss rather th..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): This paragraph states the refined coating reached 87 percent transmission and 38 days to 5 percent loss, still above the 85 percent target. Line 244 P3 gives the same 87 percent and 38 day figures but reports the target as 85 percent, matching here, yet P1 also frames the first batch's 89 percent and 31 days as achieved before refinement, which conflicts with Line 244 P2 where the first batch (sol-gel with fluorinated top) is already described as meeting both targets narrowly. The two sections describe the refinement step differently: 244 treats the 89 percent/31 day result as a full pass that was later improved for edge fouling, while 246 P1 frames it as an outcome only proven after refinement was needed. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 5 (sections 244, 246): This paragraph says coating durability beyond 70 days in chlorinated water remains unresolved and open into fiscal 2027. Line 244 P5 reports a 9 percent non-biofilm transmission loss between day 70 and day 90 on chlorinated final effluent, which is a specific finding pointing to a new durability limit, not simply an unresolved open question with no data. The framing in 246 as a clean unresolved uncertainty understates the contradictory finding already recorded in 244 that a measurable failure occurred in that window. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 6 (sections 242, 246): This paragraph credits the reference-loss correction with resolving 'the drift-compensation goal' and improving on Orion-1's 14 days. Line 242 never mentions a 14-day figure for Orion-1 performance; it only says Orion-1 used a failed mechanical wiper design. Introducing a specific baseline number (14 days) with no support in the uncertainty or work sections is an unsupported figure that contradicts the absence of any such baseline elsewhere in the draft. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Seed-stage numbers

- Requests: 13 metered (13 Batch, 0 Feedback); 13 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.6 s, p95 16.6 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 18.3 s, p95 18.3 s over 1.
- Sign-off to report created: 166.4 s.
- Cost from aiUsage: $0.93 in all ($0.35 seed stage, $0.58 Brief, drafting and checks) over 41 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T07:46:43.455Z created project k97a6z19dmpd4d6hztjfzbmvvs8f9b0t
2026-09-28T07:46:44.149Z added document fiscal-2026-scoping-notes.md
2026-09-28T07:46:45.520Z started Step by step generation k573xvph49y7yw1cgstw2smw558f9j41
2026-09-28T07:47:42.011Z seed stage open
2026-09-28T07:47:42.012Z Open Company / Context and wait for its Batch
2026-09-28T07:47:51.383Z Company / Context: select the first Seed
2026-09-28T07:47:53.430Z Approve Company / Context
2026-09-28T07:47:55.477Z approved company_context
2026-09-28T07:47:55.477Z Open Goal / Problem and wait for its Batch
2026-09-28T07:48:10.219Z Goal / Problem: select the first Seed
2026-09-28T07:48:12.275Z Approve Goal / Problem
2026-09-28T07:48:14.313Z approved goal_problem
2026-09-28T07:48:14.314Z Open Technological limitations and wait for its Batch
2026-09-28T07:48:29.015Z Technological limitations: select the first Seed
2026-09-28T07:48:31.032Z Approve Technological limitations
2026-09-28T07:48:33.090Z approved passive_limitations
2026-09-28T07:48:33.090Z Open Technological objectives and wait for its Batch
2026-09-28T07:48:47.856Z Technological objectives: select the first Seed
2026-09-28T07:48:49.880Z Approve Technological objectives
2026-09-28T07:48:51.972Z approved technological_objective
2026-09-28T07:48:51.972Z Open Technological uncertainties and wait for its Batch
2026-09-28T07:49:04.023Z Technological uncertainties: select the first 2 Seeds
2026-09-28T07:49:07.449Z Approve Technological uncertainties
2026-09-28T07:49:09.513Z approved active_uncertainties
2026-09-28T07:49:09.514Z Open Previous-year status and wait for its Batch
2026-09-28T07:49:21.559Z Skip Previous-year status
2026-09-28T07:49:22.907Z Open Work plan and wait for its Batch
2026-09-28T07:49:43.438Z Work plan: select the first Seed
2026-09-28T07:49:45.476Z Approve Work plan
2026-09-28T07:49:47.556Z approved workplan
2026-09-28T07:49:47.557Z Open Hypothesis and wait for its Batch
2026-09-28T07:50:02.267Z Hypothesis: select the first Seed
2026-09-28T07:50:04.320Z Approve Hypothesis
2026-09-28T07:50:06.431Z approved hypothesis
2026-09-28T07:50:06.431Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T07:50:21.131Z Experimentation / Iterations: select the first 2 Seeds
2026-09-28T07:50:24.539Z Approve Experimentation / Iterations
2026-09-28T07:50:26.787Z approved experimentation
2026-09-28T07:50:26.787Z Open Advancement to science / technology and wait for its Batch
2026-09-28T07:50:44.216Z Advancement to science / technology: select the first Seed
2026-09-28T07:50:46.273Z Approve Advancement to science / technology
2026-09-28T07:50:48.364Z approved overall_advancement
2026-09-28T07:50:48.365Z Open Specific technological advancements and wait for its Batch
2026-09-28T07:51:03.078Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T07:51:07.872Z Approve Specific technological advancements
2026-09-28T07:51:09.933Z approved specific_advancements
2026-09-28T07:51:09.933Z Open Project status and next steps and wait for its Batch
2026-09-28T07:51:27.460Z Project status and next steps: select the first Seed
2026-09-28T07:51:29.534Z Approve Project status and next steps
2026-09-28T07:51:31.603Z approved project_status
2026-09-28T07:51:31.604Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T07:51:49.031Z Overall company / project goal improvements: select the first Seed
2026-09-28T07:51:51.097Z Approve Overall company / project goal improvements
2026-09-28T07:51:53.162Z approved goal_improvements
2026-09-28T07:51:53.162Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T07:51:54.563Z signed off; waiting for the report
2026-09-28T07:54:43.321Z report kd7ambqrh8djq2fgx8av77ssk98f8tjn created
```
