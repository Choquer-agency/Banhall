# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-30 on `local` at commit `9de29da9`, acting as e2e-audit@banhall.local. Project `k973gvdra1srhpztphyn2qkw258fc60s`, generation `k57cdq059sqx8na5gn0jhd51d58fdasq`.

## What this fixture tests

A continuing project whose sources describe the previous year in detail (the Orion-1 prototype, its 14-day drift limit and the uncertainties left open at June 30 2025). The writer opens Previous-year status, sees cited Seeds for it, and skips it anyway. The drafter must not cover the skipped role even though the Brief and sources support it, and the Compliance Note must record the Skip as honoured.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 244 does not describe the previous year's status (Orion-1, the 14-day drift limit, what remained open at the end of fiscal 2025) as a topic of its own.
   - Answer: Yes. Line 244 has no 14-day figure, fiscal 2025 status or wiper outcome, and the Skip row is applied.
2. Where this year's work refers back to the earlier prototype, it does so only as context for fiscal 2026 work, not as a previous-year status passage.
   - Answer: Yes. The one "Orion-1" in Line 244 (the failed heuristic) is "each targeting a distinct part of the uncertainty carried forward from Orion-1", a clause introducing this year's stages, not a status passage.
3. The rest of Section 244 (work plan, hypothesis, experiments) is complete without the skipped role.
   - Answer: Yes. Work plan with dates, both hypotheses, both coupon rounds, both tank runs and the field trial.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (348, 573, 329).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, high confidence. Run 10's major is closed: Line 242 now states the reference-channel uncertainty and Rule B is applied (this run's plan held both uncertainties). Minors: a Storyline repair put prior-year wiper detail into Line 242 as goal context; Line 244 never mentions the chlorinated units behind Line 246's 70-90 day drop; a few inferences. Every figure checked matches the sources.

## Automatic checks

11 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7c0jby9e8zetjhjkaf40bpts8fdtw1 |
| All three Sections were drafted | pass | 242: 348 words, 244: 573 words, 246: 329 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | no Seed Batch failed |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 15 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 5 Seed(s) offered, 5 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before biofouling drift exceeded 5 percent. Three wip..." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 with a mechanical wiper held calibration only 14 days before drift exceeded 5 percent."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript)."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes, same fact in..."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "No prior-year status role appears in section." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | fail | "ach targeting a distinct part of the uncertainty carried forward from Orion-1: coupon screening of candidate coatings, fouling tank testing of a du" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds in-line optical water quality analyzers for municipal treatment plants in Port Aldous, British Columbia. / Its main product line measures UV absorbance at 254 nanometres as a proxy for dissolved organic carbon. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought a fouling-resistant optical window to replace the failed mechanical wiper on its analyzer. / The goal was to hold biofouling drift under 5 percent for at least 30 days between cleanings. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published coating was known to be UV-clear, food-grade safe, and durable in chlorinated water. / This left it unknown whether such a combination of properties could even exist. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team needed to know whether any window coating could resist biofilm attachment for 30 days while staying UV-clear at 254 nanometres. / That knowledge was meant to enable a coated window replacing the failed mechanical wiper on Orion-2. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- No published coating combined being UV-clear, food-grade safe, and durable in chlorinated water. / It was unknown whether such a combination of properties existed at all. _(cited)_
- It was unclear whether the fouling signal at 365 nanometres would track the signal at 254 nanometres. / It was also unclear whether that relationship would change as the biofilm aged. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- Work proceeded in three planned stages: coupon screening, fouling tank correction work, then field trials. / Coupon screening ran August to October 2025, tank work October 2025 to January 2026, and field trials February to June 2026. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If the sol-gel coating resists attachment, then raw drift stays under 5 percent for 30 days in secondary effluent. / If transmission holds above 85 percent when new, then the coating meets the clarity target alongside durability. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Coupon screening tested four coating candidates plus uncoated controls over 42 days in secondary effluent. / Only the sol-gel with fluorinated top met both the clarity and durability targets, just barely. _(cited)_
  - Tested: uncertainty "No published coating combined being UV-clear, food-grade safe, and ..."
- Fouling started at the coated edges where the layer ran thinnest, prompting a process change. / Slowing withdrawal speed from 2 millimetres per second to 1 millimetre per second gave a more even layer. _(cited)_
  - Tested: uncertainty "No published coating combined being UV-clear, food-grade safe, and ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The simple fixed-multiple reference-channel hypothesis was disproved, since the 254 to 365 ratio shifted from about 1.6 to 1.15 as the film aged. / The team learned biofilm attenuation is not spectrally flat, which explains why the original hypothesis failed. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- A sol-gel coating with a fluorinated top layer was the only candidate meeting both clarity and durability targets. _(cited)_
  - Links: uncertainty "No published coating combined being UV-clear, food-grade safe, and ..."; experiments "Coupon screening tested four coating candidates plus uncoated contr..."
- Coupon testing showed the sol-gel coating held 89 percent initial transmission with 5 percent loss by day 31. / This confirmed a UV-clear, food-grade coating durable in chlorinated water does exist. _(cited)_
  - Links: uncertainty "No published coating combined being UV-clear, food-grade safe, and ..."; experiments "Coupon screening tested four coating candidates plus uncoated contr..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days remains clearly unresolved for fiscal 2027. / A chlorinated unit showed thinning and a 9 percent non-biofilm transmission drop between day 70 and day 90. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The original goal was 30 days between cleanings with drift under 5 percent, versus 14 days on the mechanical wiper. / Combining the coated window with the fitted correction extended corrected drift under 2 percent to day 52 and day 55 in the field. _(cited)_

## Drafted Sections

### Line 242

The company designs and builds in-line optical water quality analyzers for municipal treatment plants in Port Aldous, British Columbia. Its main product line measures UV absorbance at 254 nanometres as a proxy for dissolved organic carbon, a measurement principle whose reliability depends entirely on keeping the optical window clean and stable over time.

The company sought a fouling-resistant optical window to replace the failed mechanical wiper on Orion-1, which held calibration for only 14 to 16 days across three blade materials and worsened fouling by scratching the window once blades picked up grit, giving biofilm anchor points. The goal was to hold biofouling drift under 5 percent for at least 30 days between cleanings, using a coated window and a dual-wavelength reference channel design on the successor unit, Orion-2.

The limitations to standard practice were that no published coating was known to be UV-clear, food-grade safe, and durable in chlorinated water. This left it unknown whether such a combination of properties could even exist, since documented anti-fouling approaches (marine biocide coatings, fluoropolymers, hydrogels) were each unsuitable on at least one of these grounds. Standard practice in optical fouling correction also assumed fouling attenuates light evenly across wavelengths, a spectrally flat assumption that had never been tested against a real, maturing biofilm.

The technological objective was to advance understanding of whether any window coating, specifically a sol-gel coating, could resist biofilm attachment for 30 days while staying UV-clear at 254 nanometres, and whether a reference channel could isolate fouling-driven drift from true water-quality change, for the purpose of enabling a coated, self-correcting window on Orion-2 in place of the failed mechanical wiper.

It was uncertain whether a sol-gel coating combining UV clarity, food-grade acceptability, and chlorine/grit durability existed at all, because no documented formulation had achieved all three properties together. It was also uncertain whether the fouling signal at 365 nanometres would track the fouling signal at 254 nanometres closely enough to support a correction factor, and whether that attenuation multiple would hold steady or shift as the biofilm aged, since film composition and thickness change over its growth.

### Line 244

Work proceeded in three planned stages, each targeting a distinct part of the uncertainty carried forward from Orion-1: coupon screening of candidate coatings, fouling tank testing of a dual-wavelength correction approach, and field trials of complete Orion-2 units. Coupon screening ran from August to October 2025, tank work from October 2025 to January 2026, and field trials from February to June 2026. This staged structure let the company isolate the coating question from the correction-model question before combining both into a working unit on a live process stream.

It was hypothesized that if the sol-gel coating resisted biofilm attachment, then raw biofouling drift would stay under 5 percent for 30 days in secondary effluent. It was further hypothesized that if the coating held transmission above 85 percent when new, then it would meet the clarity target alongside the durability target, since prior candidates in the literature had achieved one property but not both.

Coupon screening addressed the question of whether any coating could combine UV clarity, food-grade acceptability, and chlorine and grit durability, since no published coating was known to do so. The company tested four coating candidates plus uncoated controls over 42 days in a side stream of real secondary effluent, measuring transmission at 254 nanometres every 3 days. Only the sol-gel coating with a fluorinated top layer met both the clarity and durability targets, and only barely, while the other three candidates each failed on a different property. This established that the combination of properties the industry lacked could in fact be achieved, narrowing the open question to how durable and repeatable that result was.

A second iteration addressed a durability weakness found in the first: the sol-gel coating fouled first at its thinnest point, the coated edges. The initial dip-coating process, run at a withdrawal speed of 2 millimetres per second, had produced an uneven layer with thin edge regions that gave biofilm an early foothold. Slowing the withdrawal speed to 1 millimetre per second produced a more even layer of about 180 nanometres, and a second round of 12 coupons run in November 2025 extended time to 5 percent transmission loss from 31 to 38 days. This showed that a specific, repeatable process parameter, not just material selection, was needed to reach the durability target.

On the correction-model side, tank testing of the reference channel disproved the assumption that fouling attenuates light evenly across wavelengths. Running uncoated optical heads in the fouling tank, the company found the 254/365 attenuation multiple was not stable: about 1.6 in the first days of thin, mostly bacterial film, falling to about 1.15 after roughly a week as the film thickened. A fixed multiple of 1.4 left 4.8 percent residual drift at day 21, disproving the simple ratio hypothesis. The company then fit a correction factor as a function of accumulated 365 nanometre loss rather than a fixed multiple, which held drift on held-out heads to 1.7 to 1.9 percent over 21 days across two tank runs. This showed the relationship between channels had to be modeled as the biofilm matured, not assumed constant.

Field trials at the Harbourside plant then combined the coated window and the fitted correction on four full Orion-2 units. On secondary effluent, raw drift exceeded 5 percent by day 36 to 40, while corrected drift stayed under 2 percent until day 52 and day 55, extending the usable interval well beyond the original 30-day target under real operating conditions.

### Line 246

The company set out to learn whether a window coating could resist biofilm attachment for 30 days while staying UV-clear, and whether a reference channel could isolate biofouling drift from real water-quality change. Both goals were achieved, but the underlying hypotheses were only partly proven: the coating hypothesis held, while the fixed-ratio correction hypothesis was disproved and had to be replaced before the drift target was met.

Biofilm attenuation is not spectrally flat across UV wavelengths, which disproved the original fixed-multiple hypothesis. A simple ratio between the 254 nm and 365 nm channels could not correct drift, since the attenuation multiple shifted from about 1.6 in early biofilm growth to about 1.15 as the film matured. This resolved the question of whether a fixed ratio could distinguish fouling from real water-quality change. A correction factor keyed to accumulated 365 nm loss was fitted instead, holding drift on held-out sensor heads to 1.7 to 1.9 percent over 21 days in the fouling tank.

A UV-clear, food-grade coating durable enough to resist fouling for 30 days in chlorinated water does exist, resolving whether such properties could be combined at all. In coupon screening of four candidates against uncoated controls over 42 days in real secondary effluent, only a silica sol-gel coating with a fluorinated top layer met both targets, holding 89 percent initial transmission with 5 percent loss by day 31. This went directly into the Orion-2 window design.

Coating durability in chlorinated water beyond 70 days remains unresolved for fiscal 2027: the cause of the 9 percent non-biofilm transmission drop seen between day 70 and day 90 has not been characterized. Cold-water behaviour and transferability of the correction curve to a second plant are also carried forward.

The original goal was 30 days between cleanings with drift under 5 percent, against 14 days on the mechanical wiper. Combining the coated window with the fitted correction extended corrected drift under 2 percent to day 52 and day 55 in the field.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 348/350 words, 37/50 lines |
| 242 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer service interval complaints and adoption motivation are business concerns, not technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The firmware reporting a fouling index for maintenance scheduling is an operational/business feature, not the technological investigation itself. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Choosing to abandon flushing systems because operators would not maintain plumbing and chemicals is a business/operational judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Coating cost per unit is a commercial/costing figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Company size, structure and location are background business facts, not part of the technological work. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Storyline | not_applied | none |  | P2 omits Orion-1's 14-16 day result and scratching cause; repaired (deterministic re-check only; not re-verified by the model) |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes, same fact independently stated). | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Best wiper blade result was 16 days across three blade materials. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Coupon screening results (initial transmission and days to 5 percent loss) for all four coating candidates plus control. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Second-round sol-gel coupon result after withdrawal speed change. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift at day 21 in tank run 1. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fitted correction factor tested on held-out heads gave 1.7 percent drift, repeat run gave 1.9 percent worst case. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on secondary effluent units. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack, not confirmed. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Ultrasonic cleaning power draw figures (4W vs 1.5W budget) are reported without detail on test conditions, a hedged comparison. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fiscal 2025 program spend of roughly 1.4 person-years is a rough estimate. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Technician staffing on the fouling tank is stated differently across sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Technician staffing per scoping notes: about 90 percent time. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: transmission | applied | none |  | Concept 'transmission' not discussed in section. |
| 242 | Glossary Term: sol-gel coating | applied | none |  | P3 discusses coatings generically, not 'sol-gel coating'; repaired to the Glossary Term |
| 242 | Glossary Term: coupon screening | applied | none |  | Concept 'coupon screening' not discussed in section. |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept 'fouling tank' not discussed in section. |
| 242 | Cover signed-off Summary item ys71a54a9t676jrxk6wz04kms98fd141 | applied | none |  | P1 covers company context wording. |
| 242 | Cover signed-off Summary item ys73kcqxdxg15wsex39d59nc3x8fcw8y | applied | none |  | P2 states goal and problem as planned. |
| 242 | Cover signed-off Summary item ys77wxer0r6qz3dt9bjewdcyyh8fc4c3 | applied | none |  | P3 states the limitation verbatim-close. |
| 242 | Cover signed-off Summary item ys77qh38v9jhx18c6xeec04jex8fd8ff | applied | none |  | P4 states the technological objective. |
| 242 | Cover signed-off Summary item ys7bye4cephc07x2m5m314nmwx8fc2r0 | applied | none | 2 | P5 states coating existence uncertainty. |
| 242 | Cover signed-off Summary item ys7389s0s7aem0y8ahnmdv8gzx8fcp61 | applied | none | 2 | P5 states 365/254 tracking and aging uncertainty. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company designs and builds in-line optical water quality analyzers for municipal treatment plants in Port Aldous, B..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team needed to know whether any window coating could resist biofilm attachment for 30 days while staying UV-clear a..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 573/700 words, 54/100 lines |
| 244 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer service interval complaints and adoption motivation are business concerns, not technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The firmware reporting a fouling index for maintenance scheduling is an operational/business feature, not the technological investigation itself. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Choosing to abandon flushing systems because operators would not maintain plumbing and chemicals is a business/operational judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Coating cost per unit is a commercial/costing figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Company size, structure and location are background business facts, not part of the technological work. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: transmission | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Storyline | not_applied | none |  | P1 says wiper held 14-16 days, storyline says 14 days only; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | not_applied | missing_fact |  | P1 states range 14-16 days, obscuring established 14-day fact; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes, same fact independently stated). | not_applied | missing_fact |  | Same 14-day fact blurred into a 14-16 day range; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Best wiper blade result was 16 days across three blade materials. | applied | none |  | P1 states 16-day best blade result across three materials |
| 244 | Confidence Map: Coupon screening results (initial transmission and days to 5 percent loss) for all four coating candidates plus control. | applied | none |  | P4 gives coupon screening results for all four candidates |
| 244 | Confidence Map: Second-round sol-gel coupon result after withdrawal speed change. | applied | none |  | P5 gives second-round sol-gel result after speed change |
| 244 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift at day 21 in tank run 1. | applied | none |  | P6 states fixed multiple left 4.8 percent drift at day 21 |
| 244 | Confidence Map: Fitted correction factor tested on held-out heads gave 1.7 percent drift, repeat run gave 1.9 percent worst case. | applied | none |  | P6 states 1.7 to 1.9 percent drift across two tank runs |
| 244 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on secondary effluent units. | applied | none |  | P7 states corrected drift under 2 percent until day 52-55 |
| 244 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack, not confirmed. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Ultrasonic cleaning power draw figures (4W vs 1.5W budget) are reported without detail on test conditions, a hedged comparison. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Fiscal 2025 program spend of roughly 1.4 person-years is a rough estimate. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Technician staffing on the fouling tank is stated differently across sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Technician staffing per scoping notes: about 90 percent time. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: attenuation multiple | applied | none |  | P6 uses 'attenuation ratio' not 'attenuation multiple'; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role appears in section. |
| 244 | Cover signed-off Summary item ys71b1geyqw3sfq3qsx70d826x8fc4x6 | applied | none |  | Three stages and dates match plan wording. |
| 244 | Cover signed-off Summary item ys717jhg9q85ry5npphxp653zs8fcacx | applied | none |  | Both hypotheses stated as planned. |
| 244 | Cover signed-off Summary item ys7cn29mc87zpqqm6b9fjvb3cx8fc0tc | applied | none |  | Four candidates, 42 days, one coating met both targets. |
| 244 | Cover signed-off Summary item ys7106n4n0pt23k1rx2sfrkj098fcdqf | applied | none |  | Edge fouling cause and speed change to 1 mm/s covered. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Work proceeded in three planned stages: coupon screening, fouling tank correction work, then field trials. Coupon scree..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 1 (sections 244): 244 P1 frames the three-stage plan (coupon screening, tank testing, field trials) as leading toward 'combining both into a working unit on a live process stream,' which edges toward describing integration into the next product revision. Per the Claim Exclusions, folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work, so this framing risks presenting a business decision as part of the claimed technological work. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 329/350 words, 34/50 lines |
| 246 | Claim Exclusion: Folding the coating and correction into the next product revision is a business/commercialization decision, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer service interval complaints and adoption motivation are business concerns, not technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The firmware reporting a fouling index for maintenance scheduling is an operational/business feature, not the technological investigation itself. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Choosing to abandon flushing systems because operators would not maintain plumbing and chemicals is a business/operational judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Coating cost per unit is a commercial/costing figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Company size, structure and location are background business facts, not part of the technological work. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: transmission | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: sol-gel coating | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: correction factor | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Storyline | applied | none |  | Matches storyline goals, wiper result, and field drift figures. |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (transcript). | applied | none |  | 14 days figure used consistently, matches established fact. |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (scoping notes, same fact independently stated). | applied | none |  | Same established 14-day fact, no conflict. |
| 246 | Confidence Map: Best wiper blade result was 16 days across three blade materials. | applied | none |  | 16-day blade figure not stated in section; nothing… |
| 246 | Confidence Map: Coupon screening results (initial transmission and days to 5 percent loss) for all four coating candidates plus control. | applied | none |  | P3 states four-candidate coupon results, matches established… |
| 246 | Confidence Map: Second-round sol-gel coupon result after withdrawal speed change. | applied | none |  | Second-round withdrawal-speed result not mentioned in section. |
| 246 | Confidence Map: Fixed multiple of 1.4 left 4.8 percent drift at day 21 in tank run 1. | applied | none |  | P2 covers ratio shift; fixed multiple 1.4/4.8% not stated but… |
| 246 | Confidence Map: Fitted correction factor tested on held-out heads gave 1.7 percent drift, repeat run gave 1.9 percent worst case. | applied | none |  | P2 states 1.7 to 1.9 percent over 21 days, matches… |
| 246 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on secondary effluent units. | applied | none |  | P5 states corrected drift under 2% to day 52 and 55, matches… |
| 246 | Confidence Map: Chlorinated final effluent unit showed 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack, not confirmed. | applied | none |  | P4 hedges: mechanism 'has not been characterized', matches… |
| 246 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open. | applied | none |  | P4 hedges transferability as 'open questions carried forward'. |
| 246 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unknown; all field data is from warmer months. | applied | none |  | P4 hedges cold-water behaviour as an open question. |
| 246 | Confidence Map: Ultrasonic cleaning power draw figures (4W vs 1.5W budget) are reported without detail on test conditions, a hedged comparison. | applied | none |  | Power draw figures not mentioned in the section. |
| 246 | Confidence Map: Fiscal 2025 program spend of roughly 1.4 person-years is a rough estimate. | applied | none |  | Program spend figure not mentioned in the section. |
| 246 | Confidence Map: Technician staffing on the fouling tank is stated differently across sources: transcript says almost full time, scoping notes specify about 90 percent. | applied | none |  | Technician staffing conflict not mentioned in the section. |
| 246 | Confidence Map: Technician staffing per scoping notes: about 90 percent time. | applied | none |  | Technician staffing figure not mentioned in the section. |
| 246 | Glossary Term: biofouling drift | applied | none |  | Section uses 'drift' and 'fouling drift', not 'biofilm drift'…; repaired to the Glossary Term |
| 246 | Glossary Term: orion-1 | applied | none |  | Term 'Orion-1' does not appear; concept (mechanical wiper) is… |
| 246 | Glossary Term: coupon screening | applied | none |  | P3 describes candidate testing but never says 'coupon…; repaired to the Glossary Term |
| 246 | Cover signed-off Summary item ys7bnmdnz53eh8eq1vpxaar1hh8fdwfv | applied | none |  | P2 covers the non-flat attenuation and ratio shift finding. |
| 246 | Cover signed-off Summary item ys7b4vvzbckyesjtg56qjwwren8fc6h0 | applied | none | 2 | P3 covers coating existence and coupon screening results. |
| 246 | Cover signed-off Summary item ys7cp50tmc2472jnns3x38nf458fd151 | applied | none | 2 | P3 states 89 percent transmission, 5 percent loss day 31. |
| 246 | Cover signed-off Summary item ys779x3mmsrqe7kpkyd468a1kn8fc0tx | applied | none |  | P4 covers unresolved durability beyond 70 days and 9% drop. |
| 246 | Cover signed-off Summary item ys7fvxwhy9bb3dzfnt26ajdacd8fd6v9 | applied | none |  | P5 states goal vs wiper and corrected drift to day 52/55. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claims map to Line 242 uncertainties or plan items. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): 246 P3 states the sol-gel coating held 89 percent initial transmission with 5 percent loss by day 31, but 244 P4 states the second iteration of coupons (November 2025, slower withdrawal speed) extended time to 5 percent transmission loss to 38 days, not 31. The 31-day figure belongs to the first iteration in 244 P4, so 246 P3 appears to describe the wrong (earlier) result as the one that met the durability target and went into the Orion-2 design. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): 246 P4 introduces a 9 percent non-biofilm transmission drop between day 70 and day 90 as an unresolved item carried forward. No such result, test, or timeframe (70 to 90 days) appears anywhere in 244's work performed narrative, which only covers coupon screening (42 days), tank testing (21 days), and field trials (up to day 55). This figure has no supporting basis in the work performed section. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): 246 P2 says the attenuation multiple shifted from about 1.6 'in early biofilm growth' to about 1.15 'as the film matured' without a timeframe, while 244 P5 specifies this happened over roughly the first week (1.6 in the first days, falling to 1.15 after roughly a week). This is a minor omission rather than a hard contradiction, but flagging since 246 also drops the day-21 fixed-multiple residual drift figure (4.8 percent) that motivated the fit, which could read as a gap in the advancement narrative's support for disproving the hypothesis. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 26.
- Line 244: 0 labels and 0 plan checks "Not checked" of 22.
- Line 246: 0 labels and 0 plan checks "Not checked" of 25.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 15 reserved; notice at 40 not shown.
- Dispatch to validated result: median 10.9 s, p95 20.8 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.7 s, p95 12.7 s over 1.
- Sign-off to report created: 137.0 s.
- Cost from aiUsage: $1.02 in all ($0.37 seed stage, $0.65 Brief, drafting and checks) over 42 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T20:59:32.947Z created project k973gvdra1srhpztphyn2qkw258fc60s
2026-09-30T20:59:33.617Z added document fiscal-2026-scoping-notes.md
2026-09-30T20:59:34.984Z started Step by step generation k57cdq059sqx8na5gn0jhd51d58fdasq
2026-09-30T21:00:23.363Z seed stage open
2026-09-30T21:00:23.364Z Open Company / Context and wait for its Batch
2026-09-30T21:00:35.210Z Company / Context: select the first Seed
2026-09-30T21:00:37.259Z Approve Company / Context
2026-09-30T21:00:39.208Z approved company_context
2026-09-30T21:00:39.208Z Open Goal / Problem and wait for its Batch
2026-09-30T21:00:51.057Z Goal / Problem: select the first Seed
2026-09-30T21:00:53.003Z Approve Goal / Problem
2026-09-30T21:00:55.012Z approved goal_problem
2026-09-30T21:00:55.012Z Open Technological limitations and wait for its Batch
2026-09-30T21:01:06.842Z Technological limitations: select the first Seed
2026-09-30T21:01:08.803Z Approve Technological limitations
2026-09-30T21:01:10.817Z approved passive_limitations
2026-09-30T21:01:10.818Z Open Technological objectives and wait for its Batch
2026-09-30T21:01:25.304Z Technological objectives: select the first Seed
2026-09-30T21:01:27.391Z Approve Technological objectives
2026-09-30T21:01:29.347Z approved technological_objective
2026-09-30T21:01:29.347Z Open Technological uncertainties and wait for its Batch
2026-09-30T21:01:41.309Z Technological uncertainties: select the first 2 Seeds
2026-09-30T21:01:44.577Z Approve Technological uncertainties
2026-09-30T21:01:46.572Z approved active_uncertainties
2026-09-30T21:01:46.572Z Open Previous-year status and wait for its Batch
2026-09-30T21:01:58.589Z Skip Previous-year status
2026-09-30T21:01:59.915Z Open Work plan and wait for its Batch
2026-09-30T21:02:14.520Z Work plan: select the first Seed
2026-09-30T21:02:16.490Z Approve Work plan
2026-09-30T21:02:18.484Z approved workplan
2026-09-30T21:02:18.484Z Open Hypothesis and wait for its Batch
2026-09-30T21:02:41.002Z Hypothesis: select the first Seed
2026-09-30T21:02:42.972Z Approve Hypothesis
2026-09-30T21:02:44.979Z approved hypothesis
2026-09-30T21:02:44.979Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T21:03:00.265Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T21:03:04.030Z Approve Experimentation / Iterations
2026-09-30T21:03:06.326Z approved experimentation
2026-09-30T21:03:06.326Z Open Advancement to science / technology and wait for its Batch
2026-09-30T21:03:21.915Z Advancement to science / technology: select the first Seed
2026-09-30T21:03:24.112Z Approve Advancement to science / technology
2026-09-30T21:03:26.272Z approved overall_advancement
2026-09-30T21:03:26.272Z Open Specific technological advancements and wait for its Batch
2026-09-30T21:03:49.076Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T21:03:54.340Z Approve Specific technological advancements
2026-09-30T21:03:56.297Z approved specific_advancements
2026-09-30T21:03:56.297Z Open Project status and next steps and wait for its Batch
2026-09-30T21:04:10.819Z Project status and next steps: select the first Seed
2026-09-30T21:04:12.781Z Approve Project status and next steps
2026-09-30T21:04:14.771Z approved project_status
2026-09-30T21:04:14.771Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T21:04:29.271Z Overall company / project goal improvements: select the first Seed
2026-09-30T21:04:31.243Z Approve Overall company / project goal improvements
2026-09-30T21:04:33.172Z approved goal_improvements
2026-09-30T21:04:33.172Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T21:04:34.492Z signed off; waiting for the report
2026-09-30T21:06:53.164Z report kd7c0jby9e8zetjhjkaf40bpts8fdtw1 created
```
