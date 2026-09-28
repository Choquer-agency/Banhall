# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-28 on `local` at commit `c8ce1fe2`, acting as e2e-audit@banhall.local. Project `k97dsxz1y97g74nkmevprechxd8f9s7y`, generation `k5792v7t94mq8bc4vn3svpg7p18f82wc`.

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

11 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd766z7xy22ef2t8pgg5r54wzd8f84n2 |
| All three Sections were drafted | pass | 242: 306 words, 244: 599 words, 246: 355 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | fail | 246: "cap breach at 355/350 words, 36/50 lines; repair failed; still over after 2 shortening passes. The text was not cut t..." |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 4 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before biofouling drift passed 5 percent. Three wiper..." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 used an uncoated fused silica window with a mechanical wiper cycling every 15 minutes and..."; confidenceMap: "Orion-1 held calibration for 14 days in secondary effluent before drift passed 5 percent."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "Prior-year status role absent from section" |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds in-line optical analyzers measuring UV absorbance at 254 nanometres for municipal treatment plants. / Its main product line reports dissolved organic carbon proxy readings to plant control systems. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a fouling-resistant analyzer that holds calibration for at least 30 days with drift under 5 percent. / This targets replacing a mechanical wiper approach that only reached 14 to 16 days before drift exceeded that limit. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published coating was confirmed to be simultaneously UV-clear, food-grade safe, and chlorine-durable for this application. / Marine biocide coatings were prohibited for the application, and UV-absorbing polymer coatings lost 30 to 60 percent of transmission at 254 nanometres. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether a window coating could resist biofilm attachment for 30 days or more while staying UV-clear at 254 nanometres. / This knowledge was meant to enable a coated window replacing the failed mechanical wiper approach. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether the 254/365 attenuation relationship stayed stable as the biofilm aged. / Biofilm was not a grey filter and contains its own UV-absorbing organics, unlike a textbook assumption. _(cited)_
- It was unknown whether a fitted multiple of 254 to 365 attenuation could hold drift under 2 percent for 30 days. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The work plan set three stages: coupon screening, then fouling tank correction work, then a field trial. / Coupon screening ran from August to October 2025, followed by tank work to January 2026 and field trials to June 2026. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a thin silica sol-gel layer has a fluorinated top surface, then it will keep raw drift under 5 percent for 30 days. / This hypothesis pairs the coating side of the two open technological uncertainties from the prior fiscal year. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Coupon screening tested four coating candidates plus uncoated controls over 42 days, measuring transmission at 254 every 3 days. / Only the sol-gel with a fluorinated top met both the transmission and durability targets, and only marginally. _(cited)_
- The zwitterionic brush resisted biofilm best but started at only 71 percent transmission at 254. / The titania film grew film faster than controls, likely because in-stream UV was too weak to activate it. _(cited)_

### 10. Advancement to science / technology (Section 246, standard): approved

- The coating objective was achieved marginally, holding transmission above 85 percent and delaying 5 percent loss to 36 to 40 days. / The compensation objective was exceeded, since corrected drift stayed under 2 percent for more than 50 days in the field. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- A fixed multiple of 1.4 left drift at 4.8 percent at day 21, showing a stable ratio could not hold the target. / This finding disproved the simple fixed-ratio version of the correction hypothesis. _(cited)_
  - Links: uncertainty "It was unknown whether a fitted multiple of 254 to 365 attenuation ..."; experiments "The zwitterionic brush resisted biofilm best but started at only 71..."
- The team learned that a correction keyed to accumulated reference loss holds drift under 2 percent for more than 50 days in the field. / This resolved whether a fitted multiple approach could meet the 2 percent target over 30 days. _(cited)_
  - Links: uncertainty "It was unknown whether a fitted multiple of 254 to 365 attenuation ..."; experiments "Coupon screening tested four coating candidates plus uncoated contr..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days remains clearly unresolved going into fiscal 2027. / One field unit's coating showed a 9 percent non-biofilm transmission loss between day 70 and day 90. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The knowledge gained connects directly to the original goal of replacing the failed wiper with a coating and reference channel. / Corrected drift held under 2 percent for more than 50 days, exceeding the 30 day target that motivated the project. _(cited)_

## Drafted Sections

### Line 242

Corvane Hydrologic Inc. designs and builds in-line optical analyzers measuring UV absorbance at 254 nanometres for municipal treatment plants, with its main product line reporting a dissolved organic carbon proxy to plant control systems. This fiscal year is the second in a program aimed at a fouling-resistant analyzer, Orion-2, following a first prototype, Orion-1, in fiscal 2025. That operational history with in-line optical sensing gave the team direct exposure to biofilm fouling as the limiting factor on instrument service life.

The company sought an analyzer holding calibration for at least 30 days with drift under 5 percent, replacing a mechanical wiper approach that reached only 14 to 16 days in secondary effluent before drift exceeded that limit.

The limitations to standard practice were that no published coating was confirmed to be simultaneously UV-clear at 254 nanometres, food-grade safe, and durable in chlorinated water. Marine biocide coatings were prohibited for this application, and known UV-resistant polymer coatings lost 30 to 60 percent of transmission at 254 nanometres, so no existing combination met the clarity, safety, and durability requirements together.

The technological objective was to advance the understanding of whether a window coating could resist biofilm attachment for 30 days or more while staying UV-clear at 254 nanometres, for the purposes of replacing the failed mechanical wiper with a coated window on Orion-2.

It was uncertain whether the attenuation multiple between the 254 nanometre measurement channel and a 365 nanometre reference channel stayed stable as biofilm aged, because biofilm is not a uniform grey filter and contains its own UV-absorbing organics, unlike the assumption underlying standard reference-channel correction. It was also unknown whether a fitted attenuation multiple between the 254 and 365 nanometre channels could hold corrected drift under 2 percent over 30 days, since no prior work had established how that relationship behaved as fouling films thickened.

### Line 244

The work plan set three stages: coupon screening, then fouling tank correction work, then a field trial. Coupon screening ran from August to October 2025, followed by tank work to January 2026 and field trials to June 2026.

It was hypothesized that if a thin sol-gel coating with a fluorinated top surface were applied to the window, then it would keep raw drift under 5 percent for 30 days. This hypothesis pairs the coating side of the two open technological uncertainties from the prior fiscal year.

Coupon screening tested whether any coating could combine UV-clarity at 254 nm with biofilm resistance and chlorine durability. Four candidates plus uncoated controls ran in a side stream of secondary effluent over 42 days, with transmission at 254 measured every 3 days. The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing the clarity target from day one; the titania film fouled faster than the uncoated control, a result attributed (though not separately confirmed) to weak in-stream UV failing to activate its self-cleaning action and its rough surface aiding attachment. The team narrowed to the sol-gel coating with a fluorinated top, which was the only candidate meeting both the transmission and durability targets, and only marginally, at 89 percent initial transmission and 31 days to a 5 percent loss. This established that a workable coating chemistry existed but needed refinement to reach a comfortable margin above the 30-day target.

Reviewing the marginal sol-gel result showed biofilm fouling starting at the coating edges, where thickness was uneven. Dip withdrawal speed was slowed from 2 mm/s to 1 mm/s to produce a more even layer around 180 nm, and a second round of coupons ran in November 2025. Time to 5 percent transmission loss rose to 38 days, with initial transmission at 87 percent, still above the 85 percent target. This showed that coating uniformity, controlled through withdrawal speed, extends fouling resistance without sacrificing clarity.

The reference-channel hypothesis was tested by running six uncoated optical heads in a fouling tank with nutrient-spiked effluent for 21 days, logging both channels every 5 minutes. The attenuation multiple between 254 and 365 nm was not stable: it ran near 1.6 in the first days when the film was thin, then dropped to about 1.15 after day 8 as the film thickened with biofilm fouling. A fixed multiple of 1.4 left 4.8 percent drift at day 21, disproving the fixed-ratio hypothesis. The team instead fit a drift correction factor as a function of accumulated 365 nm loss, trained on four heads and tested on two held-out heads, reaching 1.7 percent drift at day 21; a fresh 21-day run in January 2026 with six new heads gave a 1.9 percent worst case, the first time drift held under 2 percent in the fouling tank. This showed that a correction keyed to accumulated reference-channel loss, rather than a fixed ratio, generalizes across sensor heads.

The combined approach was tested in the field: four Orion-2 units ran at the Harbourside plant from February 9 to June 12, 2026, two on secondary effluent and two on final effluent. Raw drift on the secondary-effluent units crossed 5 percent at day 36 and day 40, while corrected drift stayed under 2 percent until day 52 and day 55. On final effluent, one unit showed a 9 percent non-biofilm transmission loss between day 70 and day 90, a result the team suspects, but has not confirmed, reflects chlorine attacking the fluorinated layer. This confirmed the coating and correction extend service interval under real conditions, while leaving chlorine durability beyond 70 days unresolved.

### Line 246

The technological objective, to advance understanding of anti-fouling window coatings and multi-wavelength fouling compensation for in-line UV analyzers, was achieved in part and exceeded in part. The coating hypothesis was proven only marginally: transmission stayed above 85 percent and 5 percent fouling loss was delayed to 36 to 40 days, just past the 30-day target. The fixed-ratio compensation hypothesis was disproven, but a revised, curve-based version was proven and exceeded, holding corrected drift under 2 percent for more than 50 days in the field.

It was determined that a sol-gel coating with a fluorinated top layer, applied at roughly 180 nm with an even edge profile, resists biofilm attachment while holding transmission above 85 percent, delaying 5 percent fouling loss to 36 to 40 days in real secondary effluent. This resolved whether any coating could combine UV-clarity at 254 nm with biofilm resistance and durability, and was applied directly to the Orion-2 window design carried into field trials.

It was established that a fixed attenuation multiple between 254 and 365 nm cannot correct fouling drift: a multiple of 1.4 left drift at 4.8 percent at day 21, disproving the assumption that biofilm attenuates light evenly across wavelengths. This resolved whether a simple ratio-based correction could meet the 2 percent target over 30 days. It was then determined that a drift correction factor keyed to accumulated reference-channel loss, rather than a fixed ratio, holds drift under 2 percent for more than 50 days under field conditions.

Coating durability in chlorinated water beyond 70 days remains unresolved going into fiscal 2027: one field unit's coating showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected to reflect chlorine attacking the fluorinated layer. Cold-water behaviour and transfer of the correction curve to plants with higher industrial load are also open, since all field data this year came from warmer months at one site.

This knowledge connects directly to the original goal of replacing the failed wiper with a coated window and reference channel. Corrected drift held under 2 percent for more than 50 days, exceeding the 30-day, 2 percent target that motivated the project.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 306/350 words, 33/50 lines |
| 242 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The service-interval improvement framed as a customer satisfaction/business driver is a market outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customers' stated complaint about service interval is a market/business input, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The firmware feature reporting a fouling index for maintenance scheduling is a routine product feature/operational tool, not the uncertainty-resolving investigation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Coating cost estimation is a manufacturing/business cost consideration, not a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: General staffing/spend levels are administrative facts, not technological content. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: secondary effluent | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: transmission | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: biofilm fouling | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Storyline | applied | none |  | Section matches storyline's problem/objective/uncertainty… |
| 242 | Confidence Map: Orion-1 held calibration for 14 days in secondary effluent before drift passed 5 percent. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Scoping notes corroborate the 14-day result and add blade material identities. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Best wiper result across three blade materials was 16 days. | applied | none |  | 16-day wiper result stated, matches established fact |
| 242 | Confidence Map: Sol-gel coating with fluorinated top, ~180 nm even layer, extended time to 5 percent loss to 38 days at 87 percent initial transmission. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fixed multiple of 1.4 correction left 4.8 percent drift at day 21, disproving the simple ratio hypothesis. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field secondary-effluent corrected drift stayed under 2 percent until day 52 and 55. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Chlorine attack on the fluorinated layer causing 9 percent non-biofilm loss is a suspected, not confirmed, mechanism. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the correction curve is site-specific/transferable to a plant with higher industrial load is explicitly unresolved. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Titania film's faster fouling is attributed to a proposed mechanism (low UV activation, rough surface) that is offered as explanation, not confirmed by separate testing. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: The scoping notes give a specific day (day 8) for titania's 5 percent loss, while the transcript does not quantify a day for titania, only calling it worse than uncoated controls; these are compatible but the transcript adds no specific day, so the day-8 figure rests solely on the document. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Correction computation adds a small processing overhead per sample, reported only in the scoping document. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: secondary effluent | applied | none |  | Term not used verbatim; repaired to the Glossary Term |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept absent from section |
| 242 | Glossary Term: final effluent | applied | none |  | Concept absent from section |
| 242 | Glossary Term: attenuation multiple | applied | none |  | Used 'attenuation relationship' instead; repaired to the Glossary Term |
| 242 | Glossary Term: sol-gel coating | applied | none |  | Concept absent from section |
| 242 | Glossary Term: drift correction factor | applied | none |  | Concept absent from section |
| 242 | Cover signed-off Summary item ys73b9rm7nkmx1tkvwwmfk0mms8f8a96 | applied | none |  | P1 covers company context and product line. |
| 242 | Cover signed-off Summary item ys7d3185v2swybn412844ye69s8f8xgv | applied | none |  | P2 states 30-day/5% goal vs 14-16 day wiper limit. |
| 242 | Cover signed-off Summary item ys7f1kfgsb4dmvjp6ah6c8x47s8f996y | applied | none |  | P3 covers coating limitations and 30-60% loss. |
| 242 | Cover signed-off Summary item ys75zjtadvmhntqhxt4twsbgrn8f81vq | applied | none |  | P4 states the technological objective as planned. |
| 242 | Cover signed-off Summary item ys7bwwb31ssa5speqhd5y3cr818f8jh6 | applied | none | 2 | P5 states the 254/365 stability uncertainty. |
| 242 | Cover signed-off Summary item ys75dczvdexrkhd087wjbh4rbs8f9e8g | applied | none | 2 | P5 states the fitted-multiple drift uncertainty. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company sought a fouling-resistant analyzer that holds calibration for at least 30 days with drift under 5 percent...." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 599/700 words, 55/100 lines |
| 244 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The service-interval improvement framed as a customer satisfaction/business driver is a market outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customers' stated complaint about service interval is a market/business input, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The firmware feature reporting a fouling index for maintenance scheduling is a routine product feature/operational tool, not the uncertainty-resolving investigation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Coating cost estimation is a manufacturing/business cost consideration, not a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: General staffing/spend levels are administrative facts, not technological content. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: secondary effluent | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: transmission | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: final effluent | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: biofilm fouling | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: drift correction factor | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Storyline | applied | none |  | Section matches storyline events and results |
| 244 | Confidence Map: Orion-1 held calibration for 14 days in secondary effluent before drift passed 5 percent. | applied | none |  | 14-day figure stated flatly, matches established fact |
| 244 | Confidence Map: Scoping notes corroborate the 14-day result and add blade material identities. | applied | none |  | Blade materials tested, consistent with established… |
| 244 | Confidence Map: Best wiper result across three blade materials was 16 days. | applied | none |  | 16-day best result stated, matches established fact |
| 244 | Confidence Map: Sol-gel coating with fluorinated top, ~180 nm even layer, extended time to 5 percent loss to 38 days at 87 percent initial transmission. | applied | none |  | 38 days/87 percent stated flatly, matches established fact |
| 244 | Confidence Map: Fixed multiple of 1.4 correction left 4.8 percent drift at day 21, disproving the simple ratio hypothesis. | applied | none |  | 4.8 percent drift at day 21 stated, matches established fact |
| 244 | Confidence Map: Field secondary-effluent corrected drift stayed under 2 percent until day 52 and 55. | applied | none |  | Under 2 percent until day 52/55 stated, matches established fact |
| 244 | Confidence Map: Chlorine attack on the fluorinated layer causing 9 percent non-biofilm loss is a suspected, not confirmed, mechanism. | applied | none |  | "suspected to result from" hedges the partial mechanism |
| 244 | Confidence Map: Whether the correction curve is site-specific/transferable to a plant with higher industrial load is explicitly unresolved. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Titania film's faster fouling is attributed to a proposed mechanism (low UV activation, rough surface) that is offered as explanation, not confirmed by separate testing. | not_applied | missing_fact |  | "likely because" still states mechanism as near-fact; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: The scoping notes give a specific day (day 8) for titania's 5 percent loss, while the transcript does not quantify a day for titania, only calling it worse than uncoated controls; these are compatible but the transcript adds no specific day, so the day-8 figure rests solely on the document. | applied | none |  | Section gives no specific day for titania, consistent |
| 244 | Confidence Map: Correction computation adds a small processing overhead per sample, reported only in the scoping document. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: biofilm fouling | applied | none |  | Section uses 'fouling' and 'biofilm' separately, not the term; repaired to the Glossary Term |
| 244 | Glossary Term: drift correction factor | applied | none |  | Section says 'correction factor' not 'drift correction factor'; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status role absent from section |
| 244 | Cover signed-off Summary item ys71nq4gzndjm36ed02xj6ny318f982e | applied | none |  | Three-stage workplan and dates given verbatim |
| 244 | Cover signed-off Summary item ys76ph9safyjc7tgycz9eqw0a98f8kt7 | applied | none |  | Hypothesis and prior-year link stated as planned |
| 244 | Cover signed-off Summary item ys7envcgd0j00rgmwtehz553fx8f8j8k | applied | none |  | 42-day test and marginal single-winner result covered |
| 244 | Cover signed-off Summary item ys70459hb391frvp3s1t9h0hz18f8f05 | applied | none |  | Zwitterionic and titania results both covered |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The work plan set three stages: coupon screening, then fouling tank correction work, then a field trial. Coupon screeni..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 244, 246): 244 P3 states the sol-gel coating with fluorinated top met the durability target at 31 days to a 5 percent loss in the first coupon round, and 244 P4 reports a refined second round reaching 38 days. But 246 P1 and P2 both describe the delay to 5 percent fouling loss as "36 to 40 days," a range that does not match either coupon figure (31 or 38 days) and instead matches the field trial numbers from 244 P6. The coupon-stage results and field-stage results are being conflated across sections. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 244): P3 says the second coupon round used a target of 85 percent initial transmission ("still above the 85 percent target" appears in P4, but P3 states the working target was 89 percent, calling it "only marginally" meeting the target at 89 percent). The stated target for initial transmission shifts between paragraphs: P3 implies the target is near 89 percent (marginal pass), while P4 explicitly names 85 percent as the target. This is an internal inconsistency in what the transmission target actually is. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | not_applied | locked |  | cap breach at 355/350 words, 36/50 lines; repair failed; still over after 2 shortening passes. The text was not cut to fit: shorten Line 246 to 350 words and 50 lines before filing |
| 246 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The service-interval improvement framed as a customer satisfaction/business driver is a market outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customers' stated complaint about service interval is a market/business input, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The firmware feature reporting a fouling index for maintenance scheduling is a routine product feature/operational tool, not the uncertainty-resolving investigation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Coating cost estimation is a manufacturing/business cost consideration, not a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: General staffing/spend levels are administrative facts, not technological content. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: secondary effluent | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: transmission | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: drift correction factor | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Storyline | applied | none |  | Section matches storyline objectives and results. |
| 246 | Confidence Map: Orion-1 held calibration for 14 days in secondary effluent before drift passed 5 percent. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Scoping notes corroborate the 14-day result and add blade material identities. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Best wiper result across three blade materials was 16 days. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Sol-gel coating with fluorinated top, ~180 nm even layer, extended time to 5 percent loss to 38 days at 87 percent initial transmission. | applied | none |  | P2 states 180 nm coating result, matches established fact. |
| 246 | Confidence Map: Fixed multiple of 1.4 correction left 4.8 percent drift at day 21, disproving the simple ratio hypothesis. | applied | none |  | P3 states 4.8 percent drift at day 21, matches established fact. |
| 246 | Confidence Map: Field secondary-effluent corrected drift stayed under 2 percent until day 52 and 55. | applied | none |  | P5 states drift under 2 percent for 50+ days, matches… |
| 246 | Confidence Map: Chlorine attack on the fluorinated layer causing 9 percent non-biofilm loss is a suspected, not confirmed, mechanism. | not_applied | missing_fact |  | P4 states chlorine attack as if confirmed, not hedged; repaired (deterministic re-check only; not re-verified by the model) |
| 246 | Confidence Map: Whether the correction curve is site-specific/transferable to a plant with higher industrial load is explicitly unresolved. | applied | none |  | P4 hedges transferability as open uncertainty. |
| 246 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | P4 hedges cold-water behaviour as open, matches unresolved. |
| 246 | Confidence Map: Titania film's faster fouling is attributed to a proposed mechanism (low UV activation, rough surface) that is offered as explanation, not confirmed by separate testing. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The scoping notes give a specific day (day 8) for titania's 5 percent loss, while the transcript does not quantify a day for titania, only calling it worse than uncoated controls; these are compatible but the transcript adds no specific day, so the day-8 figure rests solely on the document. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Correction computation adds a small processing overhead per sample, reported only in the scoping document. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: orion-1 | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: fouling tank | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: final effluent | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: biofilm fouling | applied | none |  | Concept described differently, but term absent overall not… |
| 246 | Glossary Term: sol-gel coating | applied | none |  | P2 says 'sol-gel silica coating', not exact term; repaired to the Glossary Term |
| 246 | Glossary Term: drift correction factor | applied | none |  | P3 uses 'correction' not 'drift correction factor'; repaired to the Glossary Term |
| 246 | Cover signed-off Summary item ys70p0w5ndd2hk2d62xsetkxs58f94r5 | applied | none |  | P1 states coating achieved in part, compensation exceeded. |
| 246 | Cover signed-off Summary item ys7bv908vedk8hadn6g7tb3m8n8f9p01 | applied | none | 2 | P3 gives 1.4 multiple, 4.8% at day 21, disproved. |
| 246 | Cover signed-off Summary item ys78f6tcjseackw1ahq5h8657h8f8684 | applied | none | 2 | P3 states correction keyed to reference loss holds drift <2%. |
| 246 | Cover signed-off Summary item ys7c6rnyw9e4fngtzn00k0rdyd8f9afq | applied | none |  | P4 states durability beyond 70 days unresolved, 9% loss. |
| 246 | Cover signed-off Summary item ys739qhkn7x2my1h1bd5m3f4zs8f8w6b | applied | none |  | P5 links to wiper replacement goal, exceeds target. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): 246 P2 attributes the 36 to 40 day fouling delay to coupon-stage findings ("in real secondary effluent"), but 244 P6 shows the 36 and 40 day figures come from the field trial's raw drift crossing 5 percent on the two secondary-effluent Orion-2 units, not from coupon screening. 246 P2 misattributes a field trial result to the coating characterization work. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): 246 P1 says the coating hypothesis was "proven only marginally" using the 36 to 40 day figures, but 244 P4 reports the refined coupon coating reached 38 days at 87 percent transmission, which is described in 244 P4 as extending resistance to a point still needing evaluation against a 30-day target with margin, not necessarily as low-margin as 246 characterizes given the field results actually exceeded 30 days by 6 to 10 days. The characterization of the same result as merely marginal in 246 but as improved and validated in 244 P4 is inconsistent. |
| 246 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 246 paragraph 3 (sections 244, 246): 246 P3 refers to "a drift correction factor keyed to accumulated reference-channel loss," while 244 P5 describes the same concept as a correction factor fit "as a function of accumulated 365 nm loss." The glossary term "reference channel" and "drift correction factor" exist separately; conflating "365 nm loss" with "reference-channel loss" without a consistent link risks introducing a third naming variant for the same measured quantity. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 5 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 25.
- Line 244: 0 labels and 0 plan checks "Not checked" of 20.
- Line 246: 0 labels and 0 plan checks "Not checked" of 24.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 13.5 s, p95 26.1 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.5 s, p95 15.5 s over 1.
- Sign-off to report created: 178.4 s.
- Cost from aiUsage: $1.11 in all ($0.39 seed stage, $0.73 Brief, drafting and checks) over 46 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T14:03:05.515Z created project k97dsxz1y97g74nkmevprechxd8f9s7y
2026-09-28T14:03:06.185Z added document fiscal-2026-scoping-notes.md
2026-09-28T14:03:07.641Z started Step by step generation k5792v7t94mq8bc4vn3svpg7p18f82wc
2026-09-28T14:04:07.379Z seed stage open
2026-09-28T14:04:07.380Z Open Company / Context and wait for its Batch
2026-09-28T14:04:27.687Z Company / Context: select the first Seed
2026-09-28T14:04:29.760Z Approve Company / Context
2026-09-28T14:04:31.825Z approved company_context
2026-09-28T14:04:31.825Z Open Goal / Problem and wait for its Batch
2026-09-28T14:04:59.986Z Goal / Problem: select the first Seed
2026-09-28T14:05:02.084Z Approve Goal / Problem
2026-09-28T14:05:04.184Z approved goal_problem
2026-09-28T14:05:04.184Z Open Technological limitations and wait for its Batch
2026-09-28T14:05:21.603Z Technological limitations: select the first Seed
2026-09-28T14:05:23.764Z Approve Technological limitations
2026-09-28T14:05:26.011Z approved passive_limitations
2026-09-28T14:05:26.011Z Open Technological objectives and wait for its Batch
2026-09-28T14:05:43.424Z Technological objectives: select the first Seed
2026-09-28T14:05:45.503Z Approve Technological objectives
2026-09-28T14:05:47.585Z approved technological_objective
2026-09-28T14:05:47.585Z Open Technological uncertainties and wait for its Batch
2026-09-28T14:05:59.700Z Technological uncertainties: select the first 2 Seeds
2026-09-28T14:06:03.186Z Approve Technological uncertainties
2026-09-28T14:06:05.259Z approved active_uncertainties
2026-09-28T14:06:05.259Z Open Previous-year status and wait for its Batch
2026-09-28T14:06:20.038Z Skip Previous-year status
2026-09-28T14:06:21.430Z Open Work plan and wait for its Batch
2026-09-28T14:06:39.015Z Work plan: select the first Seed
2026-09-28T14:06:41.062Z Approve Work plan
2026-09-28T14:06:43.135Z approved workplan
2026-09-28T14:06:43.135Z Open Hypothesis and wait for its Batch
2026-09-28T14:06:58.050Z Hypothesis: select the first Seed
2026-09-28T14:07:00.105Z Approve Hypothesis
2026-09-28T14:07:02.175Z approved hypothesis
2026-09-28T14:07:02.175Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T14:07:17.113Z Experimentation / Iterations: select the first 2 Seeds
2026-09-28T14:07:20.720Z Approve Experimentation / Iterations
2026-09-28T14:07:22.873Z approved experimentation
2026-09-28T14:07:22.873Z Open Advancement to science / technology and wait for its Batch
2026-09-28T14:07:37.694Z Advancement to science / technology: select the first Seed
2026-09-28T14:07:39.770Z Approve Advancement to science / technology
2026-09-28T14:07:41.889Z approved overall_advancement
2026-09-28T14:07:41.889Z Open Specific technological advancements and wait for its Batch
2026-09-28T14:08:02.502Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T14:08:07.374Z Approve Specific technological advancements
2026-09-28T14:08:09.452Z approved specific_advancements
2026-09-28T14:08:09.452Z Open Project status and next steps and wait for its Batch
2026-09-28T14:08:32.279Z Project status and next steps: select the first Seed
2026-09-28T14:08:34.365Z Approve Project status and next steps
2026-09-28T14:08:36.516Z approved project_status
2026-09-28T14:08:36.516Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T14:08:59.377Z Overall company / project goal improvements: select the first Seed
2026-09-28T14:09:01.485Z Approve Overall company / project goal improvements
2026-09-28T14:09:03.544Z approved goal_improvements
2026-09-28T14:09:03.544Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T14:09:04.930Z signed off; waiting for the report
2026-09-28T14:12:04.635Z report kd766z7xy22ef2t8pgg5r54wzd8f84n2 created
```
