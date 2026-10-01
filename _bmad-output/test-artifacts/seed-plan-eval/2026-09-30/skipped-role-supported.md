# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-30 on `local` at commit `67be8f06`, acting as e2e-audit@banhall.local. Project `k97fkzfc0ah70j63ztgxc0dmvh8fcdem`, generation `k572c38nb4ffnse24d3fbk5ppn8fc8qh`.

## What this fixture tests

A continuing project whose sources describe the previous year in detail (the Orion-1 prototype, its 14-day drift limit and the uncertainties left open at June 30 2025). The writer opens Previous-year status, sees cited Seeds for it, and skips it anyway. The drafter must not cover the skipped role even though the Brief and sources support it, and the Compliance Note must record the Skip as honoured.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 244 does not describe the previous year's status (Orion-1, the 14-day drift limit, what remained open at the end of fiscal 2025) as a topic of its own.
   - Answer: Yes. Line 244 has no Orion-1, 14-day figure or fiscal 2025 status, and the Compliance Note records "Omit signed-off role prior_year_status | applied".
2. Where this year's work refers back to the earlier prototype, it does so only as context for fiscal 2026 work, not as a previous-year status passage.
   - Answer: Yes. The only back-references are "The uncertainty carried into fiscal 2026 was ..." (Line 244 paragraph 1) and the wiper as goal context in Line 242, which the Skip does not forbid.
3. The rest of Section 244 (work plan, hypothesis, experiments) is complete without the skipped role.
   - Answer: Yes. Work plan, two hypotheses, both coupon rounds, the tank runs and the field trial are all there, with figures matching the sources.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (325, 640, 327).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, high confidence. Run 6 issues fixed: Line 246 is within its limit (327 of 350 words) and the coating description is right. Major (Judge A): Line 242 states only the coating uncertainty, yet Lines 244 and 246 treat the reference-channel question as an uncertainty and claim its advancement; the same chain gap as changed-advancement-links. Minors: "resolved" chlorine and grit overstates, and "test both at a second plant" conflates plans.

## Automatic checks

12 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7e05dw72vkeg7a3wcwz88trh8fddga |
| All three Sections were drafted | pass | 242: 325 words, 244: 640 words, 246: 327 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | no Seed Batch failed |
| Seed-stage requests (informational; notice at 40, never refused) | info | 14 metered calls (14 Batch, 0 Feedback), 14 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 5 Seed(s) offered, 5 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before drift exceeded 5 percent. Three wiper blade ma..." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 used an uncoated fused silica window with a wiper cycling every 15 minutes and held calib..."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript)."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes)."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "No prior-year status role appears in section" |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company builds in-line optical analyzers that measure UV absorbance at 254 nanometres for municipal treatment plants. / Sensor engineering and firmware teams of four and three people run the calibration logic on the instrument. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a fouling-resistant window coating and reference-channel correction to replace the failed wiper design. / The objective was an Orion-2 analyzer holding calibration drift under 5 percent for at least 30 days without cleaning. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published coating was known to be UV-clear, food-grade safe, and durable in chlorinated water. / Most fluoropolymer and hydrogel anti-fouling coatings lose 30 to 60 percent of UV transmission at 254 nanometres. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether a window coating could stay UV-clear while resisting biofilm for 30 days or more. / This knowledge was meant to enable an Orion-2 window that meets the 85 percent transmission and durability targets. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether any coating could resist biofilm attachment for 30 days while staying optically clear at 254 nanometres and surviving chlorine and grit. _(cited)_
- No published coating was known to combine UV clarity, food-grade safety, and durability in chlorinated water. / This gap meant the team could not know in advance whether the needed combination of properties existed at all. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a staged investigation with coupon screening, tank testing, and a field trial across fiscal 2026. / Three stages ran from August 2025 coating screening through a January 2026 tank test to a June 2026 field trial. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a thin silica sol-gel layer carries a fluorinated top surface, then raw drift will stay under 5 percent for 30 days. / This coating hypothesis matched the transmission and durability objectives set for fiscal 2026. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Coupon screening tested four coating candidates plus uncoated controls over 42 days in secondary effluent. _(cited)_
  - Tested: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."
- The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing clarity from day one. / The titania film fouled faster than the control, likely from low in-stream UV activation and its rough surface. _(cited)_
  - Tested: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The sol-gel coating with a fluorinated top layer met both transmission and durability targets, only marginally. / A reference-channel correction keyed to accumulated 365 nanometre loss held drift under 2 percent for over 50 days in the field. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The sol-gel coating with a fluorinated top layer at about 180 nanometres met both transmission and durability targets in real secondary effluent. / This coating held transmission above 85 percent and delayed 5 percent fouling loss to 36 to 40 days. _(cited)_
  - Links: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."; experiments "Coupon screening tested four coating candidates plus uncoated contr...", "The zwitterionic brush resisted biofilm best but started at only 71..."
- Screening showed the zwitterionic brush resisted biofilm best but failed the 254 nanometre clarity target outright. / Testing also showed titania self-cleaning film does not work at the UV intensity found in the stream. _(cited)_
  - Links: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."; experiments "The zwitterionic brush resisted biofilm best but started at only 71..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days remains clearly unresolved for fiscal 2027 work. / Cold-water behaviour at 4 to 6 Celsius is unknown since all field data came from warmer water. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The fiscal 2026 work connects directly to the original goal of replacing the failed wiper with a coating and reference channel. / Combining the sol-gel coating with the fitted correction let an Orion-2 unit hold drift under 2 percent for more than 50 days. _(cited)_

## Drafted Sections

### Line 242

Corvane Hydrologic Inc. designs and builds in-line optical analyzers that measure UV absorbance at 254 nanometres for municipal treatment plants, using the reading as a proxy for dissolved organic carbon. A 4-person sensor engineering group and a 3-person firmware team, responsible for calibration logic, run the instrument's core measurement and signal-processing chains. This combined hardware and firmware capability let the company pursue a coating-and-compensation approach, built around a reference channel, after its mechanical wiper design failed. The goal was to replace that wiper design with a fouling-resistant window coating and a reference-channel correction, together forming the Orion-2 analyzer, holding calibration drift under 5 percent for at least 30 days in wastewater without manual cleaning.

No published coating was known to be simultaneously UV-clear at 254 nanometres, food-grade safe, and durable in chlorinated water, so the team had no way to know in advance whether a coating combining all three properties existed at all. Known fluoropolymer and hydrogel anti-fouling coatings lost 30 to 60 percent of UV transmission at that wavelength, and biocide-based marine coatings were unsuitable for treatment plant use. Standard practice also assumed fouling attenuates light evenly across wavelengths, permitting a simple ratio correction, but this grey-filter assumption had never been verified against biological biofilm, which carries its own UV-absorbing organic content.

The technological objective was to advance understanding of whether a window coating could stay UV-clear while resisting biofilm attachment for 30 days or more, so an Orion-2 window could meet an 85 percent transmission target with matching durability.

It was uncertain whether any surface treatment could resist biofilm attachment for 30 days while staying optically clear at 254 nanometres and surviving chlorine and grit, since no published coating was known to combine those three properties at once. This gap meant the company could not know in advance whether a coating with the needed combination of UV clarity, biological safety, and chemical durability existed, or would have to be developed from first principles.

### Line 244

The uncertainty carried into fiscal 2026 was whether any window surface treatment could resist biofilm attachment for 30 days while remaining UV-clear at 254 nanometres and durable against chlorine and grit, and whether a reference channel could separate fouling drift from real water-quality change. The team planned a staged investigation with coupon screening, tank testing, and a field trial across fiscal 2026. Three stages ran from August 2025 coating screening through a January 2026 tank test to a June 2026 field trial. Coupon screening addressed coating durability and clarity, and the tank tests addressed the reference-channel correction.

It was hypothesized that if a thin silica sol-gel layer carries a fluorinated top surface, then raw drift will stay under 5 percent for 30 days. This coating hypothesis matched the transmission and durability objectives set for fiscal 2026. A second hypothesis held that if fouling attenuation at 254 nanometres tracked a stable multiple of attenuation at 365 nanometres across the biofilm's life, then correcting the 254 nanometre signal by that fitted multiple would hold total drift under 2 percent for 30 days.

The team needed to know whether any coating could combine UV clarity with biofilm resistance and chemical durability. Coupon screening tested four coating candidates plus uncoated controls over 42 days in secondary effluent. The zwitterionic brush resisted biofilm best but started at only 71 percent UV transmission, failing clarity from day one, and the titania film fouled faster than the control, likely from low in-stream UV activation and its rough surface aiding attachment. Only the sol-gel coating met both targets, and only marginally, at 89 percent initial UV transmission with 31 days to 5 percent loss. This showed that a workable coating existed but that its margin over the 30-day target was thin.

Fouling on the sol-gel coupons began at thin edge regions, raising the question of whether coating uniformity limited durability. The team reduced dip withdrawal speed from 2 mm/s to 1 mm/s to produce a more even layer around 180 nanometres thick. The revised coupons reached 38 days before losing 5 percent transmission, at 87 percent initial transmission, still above target. This confirmed that deposition uniformity, not just chemistry, governed coating life.

The team next needed to know whether a fixed ratio between 254 and 365 nanometre attenuation could correct for fouling drift. Uncoated heads were run in a recirculating fouling tank with nutrient-spiked effluent, logging both channels over 21 days. The attenuation multiple measured about 1.6 in the first four to five days but fell to about 1.15 after day 8 as the biofilm thickened, so a fixed multiple of 1.4 left 4.8 percent drift at day 21, disproving the simple ratio hypothesis. The team then fit a correction factor as a function of accumulated 365 nanometre loss rather than a fixed multiple, training on four heads and validating on two held-out heads. Corrected drift on the held-out heads reached only 1.7 percent at day 21, later confirmed at 1.9 percent worst case on a fresh set of six heads in January 2026, the first time drift held under 2 percent in tank testing.

The final question was whether the coated window and fitted correction, combined, would hold drift under 2 percent for 30 or more days in real plant water. Four complete Orion-2 units, two on secondary effluent and two on chlorinated final effluent, were deployed at the Harbourside plant from February to June 2026, validated against lab grab samples. Raw drift on secondary effluent exceeded 5 percent by day 36 to 40, while corrected drift held under 2 percent until day 52 to 55, exceeding the target. One chlorinated-effluent unit showed an unexpected 9 percent non-biofilm transmission loss between day 70 and day 90, suspected to result from chlorine attacking the fluorinated layer, identifying a coating durability limit beyond the scope of this year's target.

### Line 246

The technological objective was to advance UV-transparent anti-fouling coatings and multi-wavelength fouling compensation for an in-line analyzer holding biofouling drift under 5 percent raw or 2 percent corrected for 30 days. This was achieved, though the hypotheses were only partly confirmed. The coating hypothesis held: a sol-gel coating with a fluorinated top layer met both transmission and durability targets, only marginally. The simple compensation hypothesis, a fixed ratio between wavelengths, was disproven; a reference-channel correction factor keyed to accumulated 365 nanometre loss was needed instead, holding drift under 2 percent for over 50 days in the field.

It was determined that this sol-gel coating, deposited at roughly 180 nanometres, can hold UV transmission above 85 percent while delaying 5 percent fouling loss to 36 to 40 days in real secondary effluent. This resolved the uncertainty over whether any coating could stay optically clear at 254 nanometres while resisting biofilm attachment and surviving chlorine and grit. Screening also showed that the zwitterionic brush, despite resisting biofilm best, failed the 254 nanometre clarity target outright, and that titania self-cleaning film does not work at the UV intensity found in the stream.

It was determined that biofilm attenuation is not spectrally flat: the 254/365 attenuation multiple shifts from about 1.6 in early film to about 1.15 as film thickens. A correction factor keyed to accumulated reference-channel loss held drift under 2 percent for more than 50 days in the field.

Coating durability in chlorinated water beyond 70 days remains clearly unresolved for fiscal 2027 work. Cold-water behaviour at 4 to 6 degrees Celsius is also unknown, since all field data came from warmer water. Fiscal 2027 work will test both at a second plant.

This work connects directly to the original goal of replacing the failed wiper with a coating and reference channel. Combining the sol-gel coating with the fitted correction let an Orion-2 unit hold drift under 2 percent for more than 50 days, exceeding the original 30-day goal.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 325/350 words, 35/50 lines |
| 242 | Claim Exclusion: Expectation of folding the coating/correction into the next product revision and business framing of service interval as a customer complaint is business planning, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The framing of service interval length as a driver of customer satisfaction and sales is a business/market consideration, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Reporting a fouling index to operators for scheduling cleaning is a downstream product feature/operational benefit, not part of the uncertainty resolution itself. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Routine grab sampling logistics (twice-weekly sampling against a lab spectrophotometer) are standard measurement practice, not the investigative work itself. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Storyline | applied | none |  | Section matches Storyline's uncertainty and objective framing |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Best wiper blade result was 16 days (transcript, general). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Specific blade materials tested and best result of 16 days, with smearing after about 7 days (scoping notes, more detailed). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Sol-gel coating second round: initial transmission 87 percent, 38 days to 5 percent loss, at 180 nm layer thickness. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: First tank run's fixed multiple of 1.4 left 4.8 percent drift at day 21. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fitted correction on held-out heads achieved 1.7 percent drift at day 21. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: January 2026 repeat tank run achieved 1.9 percent worst-case drift. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial corrected drift held under 2 percent until day 52 and 55 on secondary effluent units. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and 90, with free chlorine averaging 1.2 mg/L (scoping notes detail not in transcript). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Cause of coating thinning on the chlorinated unit is attributed to chlorine attack but stated as a belief, not confirmed. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Cold-water behaviour of biofilm and correction curve at 4 to 6 C is unknown; all field data came from warmer water. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fiscal 2025 program spend is given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Coating cost estimate of 11 dollars per window is only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Correction computation adds about 0.4 ms per sample on the current processor, stated only in scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Technician staffing level differs slightly in phrasing between sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Scoping notes specify the technician's name and a precise 90 percent time allocation. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: biofouling drift | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: orion-1 | applied | none |  | Concept (Orion-1) not referenced in this section |
| 242 | Glossary Term: reference channel | applied | none |  | Called 'reference-channel correction', not 'reference channel'; repaired to the Glossary Term |
| 242 | Glossary Term: attenuation multiple | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: sol-gel coating | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: fluorinated top layer | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: coupon screening | applied | none |  | Concept absent from the section |
| 242 | Glossary Term: correction factor | applied | none |  | Concept absent from the section |
| 242 | Cover signed-off Summary item ys7b2jf8yxn2bty25147qy9weh8fccvm | applied | none |  | P1 covers company, product, and team roles. |
| 242 | Cover signed-off Summary item ys74y989ksnjyntdt6wa3spcsh8fd2sv | applied | none |  | P1 states the goal and 30-day/5 percent target. |
| 242 | Cover signed-off Summary item ys7f74sgvqpxtcnnb8wmpv63jx8fcwng | applied | none |  | P2 states no known coating and transmission loss figures. |
| 242 | Cover signed-off Summary item ys74pbyn6nbyeh757rxr4cdyd98fdjaj | applied | none |  | P3 states the technological objective and 85 percent target. |
| 242 | Cover signed-off Summary item ys7aw35sm2wsg2qkkv5psayej98fdjtf | applied | none | 2 | P4 states the biofilm/clarity/chlorine uncertainty. |
| 242 | Cover signed-off Summary item ys764rastve6qv08wbkqzy9q9s8fcz82 | applied | none | 2 | P4 states the no-known-combination knowledge gap. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 640/700 words, 61/100 lines |
| 244 | Claim Exclusion: Expectation of folding the coating/correction into the next product revision and business framing of service interval as a customer complaint is business planning, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The framing of service interval length as a driver of customer satisfaction and sales is a business/market consideration, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Reporting a fouling index to operators for scheduling cleaning is a downstream product feature/operational benefit, not part of the uncertainty resolution itself. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Routine grab sampling logistics (twice-weekly sampling against a lab spectrophotometer) are standard measurement practice, not the investigative work itself. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Storyline | applied | none |  | Section matches storyline events and figures throughout. |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | applied | none |  | Orion-1 14-day figure not mentioned in this section. |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes). | applied | none |  | Orion-1 14-day figure not mentioned in this section. |
| 244 | Confidence Map: Best wiper blade result was 16 days (transcript, general). | applied | none |  | Wiper blade 16-day result not mentioned in this section. |
| 244 | Confidence Map: Specific blade materials tested and best result of 16 days, with smearing after about 7 days (scoping notes, more detailed). | applied | none |  | Blade smearing detail not mentioned in this section. |
| 244 | Confidence Map: Sol-gel coating second round: initial transmission 87 percent, 38 days to 5 percent loss, at 180 nm layer thickness. | applied | none |  | P4 states 87% initial, 38 days, 180nm, matches established fact. |
| 244 | Confidence Map: First tank run's fixed multiple of 1.4 left 4.8 percent drift at day 21. | applied | none |  | P5 states 4.8% drift at day 21 for fixed 1.4 multiple, matches. |
| 244 | Confidence Map: Fitted correction on held-out heads achieved 1.7 percent drift at day 21. | applied | none |  | P5 states 1.7% drift on held-out heads at day 21, matches. |
| 244 | Confidence Map: January 2026 repeat tank run achieved 1.9 percent worst-case drift. | applied | none |  | P5 states 1.9% worst-case in January 2026 repeat, matches. |
| 244 | Confidence Map: Field trial corrected drift held under 2 percent until day 52 and 55 on secondary effluent units. | applied | none |  | P6 states corrected drift held under 2% until day 52-55. |
| 244 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and 90, with free chlorine averaging 1.2 mg/L (scoping notes detail not in transcript). | applied | none |  | P6 hedges as 'suspected', chlorine level not stated. |
| 244 | Confidence Map: Cause of coating thinning on the chlorinated unit is attributed to chlorine attack but stated as a belief, not confirmed. | applied | none |  | P6 uses 'suspected to result from', properly hedged. |
| 244 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | Transfer to second plant not mentioned in this section. |
| 244 | Confidence Map: Cold-water behaviour of biofilm and correction curve at 4 to 6 C is unknown; all field data came from warmer water. | applied | none |  | Cold-water uncertainty not mentioned in this section. |
| 244 | Confidence Map: Fiscal 2025 program spend is given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Fiscal 2025 spend not mentioned in this section. |
| 244 | Confidence Map: Coating cost estimate of 11 dollars per window is only in the scoping notes. | applied | none |  | Coating cost estimate not mentioned in this section. |
| 244 | Confidence Map: Correction computation adds about 0.4 ms per sample on the current processor, stated only in scoping notes. | applied | none |  | Processor timing detail not mentioned in this section. |
| 244 | Confidence Map: Technician staffing level differs slightly in phrasing between sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Technician staffing detail not mentioned in this section. |
| 244 | Confidence Map: Scoping notes specify the technician's name and a precise 90 percent time allocation. | applied | none |  | Technician name and allocation not mentioned in this section. |
| 244 | Glossary Term: biofouling drift | applied | none |  | Section uses 'drift' but never the phrase 'biofouling drift'. |
| 244 | Glossary Term: orion-1 | applied | none |  | 'Orion-1' not used; section only mentions Orion-2. |
| 244 | Glossary Term: uv transmission | applied | none |  | Section says 'transmission' not 'UV transmission' verbatim.; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role appears in section |
| 244 | Cover signed-off Summary item ys7d2mr5m7t058rs4q0jrfbvbn8fcbf0 | applied | none |  | Three stages described matching wording |
| 244 | Cover signed-off Summary item ys7bd1v6y8bj6qmjcy435zkaqd8fd3c5 | applied | none |  | Hypothesis and objective match stated verbatim |
| 244 | Cover signed-off Summary item ys75easrp3drd7gffr6qv3jm6h8fc859 | applied | none |  | Coupon screening detail matches planned wording |
| 244 | Cover signed-off Summary item ys73nsvx2eqkh5nebcatffqy3s8fcnzs | applied | none |  | Zwitterionic and titania results both covered |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If a thin silica sol-gel layer carries a fluorinated top surface, then raw drift will stay under 5 percent for 30 days...." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): 244 P4 states the revised sol-gel coupons reached 38 days before losing 5 percent transmission at 87 percent initial transmission, but 246 P2 gives the delay as 36 to 40 days without citing the 38-day coupon figure or the 87 percent value, and instead ties the 36 to 40 day figure to the field deployment result from 244 P6, not the coupon result. The two different 36 to 40 day figures (coupon vs field) are being merged into one number in 246, which misstates which test produced it. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 244, 246): 244 P3 reports the original sol-gel coupon at 89 percent initial UV transmission with 31 days to 5 percent loss, before the dip-speed revision. 246 P2 reports the coating (after revision) at above 85 percent transmission with 36 to 40 days to 5 percent loss, but does not distinguish the pre-revision 89 percent/31 day result from the post-revision 87 percent/38 day result, so the advancement section's single summary figure does not match either individual result stated in the work performed section. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 6 (sections 244, 246): 244 P6 references validation against lab grab samples without detail; combined with the exclusion on routine grab sampling logistics, this should be checked to confirm no eligible-work credit is being implicitly claimed for the twice-weekly sampling logistics themselves rather than the corrected-drift analysis. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 327/350 words, 34/50 lines |
| 246 | Claim Exclusion: Expectation of folding the coating/correction into the next product revision and business framing of service interval as a customer complaint is business planning, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The framing of service interval length as a driver of customer satisfaction and sales is a business/market consideration, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Reporting a fouling index to operators for scheduling cleaning is a downstream product feature/operational benefit, not part of the uncertainty resolution itself. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: General company description and staffing counts are background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Routine grab sampling logistics (twice-weekly sampling against a lab spectrophotometer) are standard measurement practice, not the investigative work itself. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: fluorinated top layer | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Storyline | applied | none |  | Section matches storyline objectives and findings. |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Best wiper blade result was 16 days (transcript, general). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Specific blade materials tested and best result of 16 days, with smearing after about 7 days (scoping notes, more detailed). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Sol-gel coating second round: initial transmission 87 percent, 38 days to 5 percent loss, at 180 nm layer thickness. | applied | none |  | P2 states 85%/36-40 days figure, consistent with established… |
| 246 | Confidence Map: First tank run's fixed multiple of 1.4 left 4.8 percent drift at day 21. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Fitted correction on held-out heads achieved 1.7 percent drift at day 21. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: January 2026 repeat tank run achieved 1.9 percent worst-case drift. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Field trial corrected drift held under 2 percent until day 52 and 55 on secondary effluent units. | applied | none |  | P1/P3 state over 50 days, matches established figure. |
| 246 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and 90, with free chlorine averaging 1.2 mg/L (scoping notes detail not in transcript). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Cause of coating thinning on the chlorinated unit is attributed to chlorine attack but stated as a belief, not confirmed. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Cold-water behaviour of biofilm and correction curve at 4 to 6 C is unknown; all field data came from warmer water. | applied | none |  | P4 hedges cold-water behaviour as unknown. |
| 246 | Confidence Map: Fiscal 2025 program spend is given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Coating cost estimate of 11 dollars per window is only in the scoping notes. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Correction computation adds about 0.4 ms per sample on the current processor, stated only in scoping notes. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Technician staffing level differs slightly in phrasing between sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Scoping notes specify the technician's name and a precise 90 percent time allocation. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: biofouling drift | applied | none |  | Section uses 'drift' but not 'biofouling drift'.; repaired to the Glossary Term |
| 246 | Glossary Term: orion-1 | applied | none |  | 'Orion-1' does not appear; Orion-2 is used instead, concept… |
| 246 | Glossary Term: coupon screening | applied | none |  | Concept of coupon screening is absent from the section. |
| 246 | Glossary Term: correction factor | applied | none |  | Section says 'correction' instead of 'correction factor'.; repaired to the Glossary Term |
| 246 | Cover signed-off Summary item ys7cq1rdh2kz43ayhhv7twsh0d8fd6z5 | applied | none |  | P1 states coating and correction results as planned. |
| 246 | Cover signed-off Summary item ys7dqysbrtpfbznn0dsm66q18d8fd72v | applied | none | 2 | P2 gives 180 nm, 85 percent, 36-40 day figures. |
| 246 | Cover signed-off Summary item ys764bw6wjhv6ec5rd56ascp898fcj58 | applied | none | 2 | P2 covers zwitterionic and titania screening results. |
| 246 | Cover signed-off Summary item ys78dz0wtg6h0fm2785jtk28bh8fcex5 | applied | none |  | P4 states both unresolved items for fiscal 2027. |
| 246 | Cover signed-off Summary item ys742bscmqf9zemrrhgmfxkwk18fc43t | applied | none |  | P5 links to original goal and gives Orion-2 result. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 4 (sections 244, 246): 246 P4 says fiscal 2027 work will test coating durability beyond 70 days and cold-water behavior at a second plant, which is forward planning; when read together with 244 P6's mention of folding findings into future units, this edges toward describing next-product-revision plans as part of the technological work, which the Claim Exclusions list as business planning, not eligible work. |
| 246 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 246 paragraph 1 (sections 242, 244, 246): Section 246 P1 calls the disproven hypothesis the 'simple compensation hypothesis, a fixed ratio between wavelengths,' while 244 P2 and P5 call the same idea the fixed multiple or attenuation multiple hypothesis, and 242 does not name it at all. The glossary term 'attenuation multiple' is used consistently in 244 but replaced with different wording in 246, creating a naming mismatch for the same concept. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 5 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 33.
- Line 244: 0 labels and 0 plan checks "Not checked" of 27.
- Line 246: 0 labels and 0 plan checks "Not checked" of 28.

## Seed-stage numbers

- Requests: 14 metered (14 Batch, 0 Feedback); 14 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.8 s, p95 24.9 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.6 s, p95 15.6 s over 1.
- Sign-off to report created: 171.6 s.
- Cost from aiUsage: $1.10 in all ($0.38 seed stage, $0.72 Brief, drafting and checks) over 43 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T18:27:02.256Z created project k97fkzfc0ah70j63ztgxc0dmvh8fcdem
2026-09-30T18:27:02.927Z added document fiscal-2026-scoping-notes.md
2026-09-30T18:27:04.268Z started Step by step generation k572c38nb4ffnse24d3fbk5ppn8fc8qh
2026-09-30T18:28:11.621Z seed stage open
2026-09-30T18:28:11.621Z Open Company / Context and wait for its Batch
2026-09-30T18:28:23.593Z Company / Context: select the first Seed
2026-09-30T18:28:25.651Z Approve Company / Context
2026-09-30T18:28:27.682Z approved company_context
2026-09-30T18:28:27.682Z Open Goal / Problem and wait for its Batch
2026-09-30T18:28:44.876Z Goal / Problem: select the first Seed
2026-09-30T18:28:46.829Z Approve Goal / Problem
2026-09-30T18:28:48.805Z approved goal_problem
2026-09-30T18:28:48.805Z Open Technological limitations and wait for its Batch
2026-09-30T18:29:03.413Z Technological limitations: select the first Seed
2026-09-30T18:29:05.358Z Approve Technological limitations
2026-09-30T18:29:07.373Z approved passive_limitations
2026-09-30T18:29:07.373Z Open Technological objectives and wait for its Batch
2026-09-30T18:29:21.915Z Technological objectives: select the first Seed
2026-09-30T18:29:23.897Z Approve Technological objectives
2026-09-30T18:29:25.931Z approved technological_objective
2026-09-30T18:29:25.931Z Open Technological uncertainties and wait for its Batch
2026-09-30T18:29:40.493Z Technological uncertainties: select the first 2 Seeds
2026-09-30T18:29:43.774Z Approve Technological uncertainties
2026-09-30T18:29:45.772Z approved active_uncertainties
2026-09-30T18:29:45.772Z Open Previous-year status and wait for its Batch
2026-09-30T18:29:57.649Z Skip Previous-year status
2026-09-30T18:29:58.971Z Open Work plan and wait for its Batch
2026-09-30T18:30:16.593Z Work plan: select the first Seed
2026-09-30T18:30:18.574Z Approve Work plan
2026-09-30T18:30:20.576Z approved workplan
2026-09-30T18:30:20.576Z Open Hypothesis and wait for its Batch
2026-09-30T18:30:32.826Z Hypothesis: select the first Seed
2026-09-30T18:30:34.849Z Approve Hypothesis
2026-09-30T18:30:36.888Z approved hypothesis
2026-09-30T18:30:36.888Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T18:31:03.063Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T18:31:06.396Z Approve Experimentation / Iterations
2026-09-30T18:31:08.418Z approved experimentation
2026-09-30T18:31:08.418Z Open Advancement to science / technology and wait for its Batch
2026-09-30T18:31:25.695Z Advancement to science / technology: select the first Seed
2026-09-30T18:31:27.693Z Approve Advancement to science / technology
2026-09-30T18:31:29.682Z approved overall_advancement
2026-09-30T18:31:29.682Z Open Specific technological advancements and wait for its Batch
2026-09-30T18:31:44.211Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T18:31:49.785Z Approve Specific technological advancements
2026-09-30T18:31:51.818Z approved specific_advancements
2026-09-30T18:31:51.818Z Open Project status and next steps and wait for its Batch
2026-09-30T18:32:03.715Z Project status and next steps: select the first Seed
2026-09-30T18:32:05.660Z Approve Project status and next steps
2026-09-30T18:32:07.646Z approved project_status
2026-09-30T18:32:07.646Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T18:32:22.300Z Overall company / project goal improvements: select the first Seed
2026-09-30T18:32:24.254Z Approve Overall company / project goal improvements
2026-09-30T18:32:26.238Z approved goal_improvements
2026-09-30T18:32:26.238Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T18:32:27.621Z signed off; waiting for the report
2026-09-30T18:35:20.966Z report kd7e05dw72vkeg7a3wcwz88trh8fddga created
```
