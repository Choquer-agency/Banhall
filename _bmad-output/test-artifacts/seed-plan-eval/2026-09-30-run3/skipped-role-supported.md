# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-30 on `local` at commit `c17f2494`, acting as e2e-audit@banhall.local. Project `k9716qazkt8tc1a2c657m1phm58ffxyn`, generation `k575j2hm86fmr0r0dn97x4pcrd8femmn`.

## What this fixture tests

A continuing project whose sources describe the previous year in detail (the Orion-1 prototype, its 14-day drift limit and the uncertainties left open at June 30 2025). The writer opens Previous-year status, sees cited Seeds for it, and skips it anyway. The drafter must not cover the skipped role even though the Brief and sources support it, and the Compliance Note must record the Skip as honoured.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 244 does not describe the previous year's status (Orion-1, the 14-day drift limit, what remained open at the end of fiscal 2025) as a topic of its own.
   - Answer: Yes. No Orion-1, 14-day figure, wiper outcome or fiscal 2025 status in Line 244; the Skip row is applied.
2. Where this year's work refers back to the earlier prototype, it does so only as context for fiscal 2026 work, not as a previous-year status passage.
   - Answer: Yes. Orion-1 appears only as goal and uncertainty context in Line 242 (signed-off goal item 2's words) and as the baseline in Line 246 paragraph 6.
3. The rest of Section 244 (work plan, hypothesis, experiments) is complete without the skipped role.
   - Answer: Yes. Work plan with dates, both hypotheses, the coupon screening, both tank runs and the field trial with the chlorinated unit. The November second coating round behind Line 246's "about 180 nanometres" is not described (minor).
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (305, 611, 345).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (high confidence). Run 11's minor about the chlorinated units is fixed. Minors: the second coating round is missing from Line 244; a false targets row; two false consistency findings. Every figure checked matches the sources.

## Automatic checks

12 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd733n2ca7w697b1brvdkkt24s8ffm78 |
| All three Sections were drafted | pass | 242: 305 words, 244: 611 words, 246: 345 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | hypothesis prefetch: INVALID_OUTPUT, answer 1: 2 of 4 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_PROVENANCE x1, INVALID_BATCH_SIZE x0), answer 2: 2 of 4 valid, needed 3 (BULLET_TOO_LONG x2, INVALID_BATCH_SIZE x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work traces to Line 242 uncertainties or Line 246 items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P3 calls 89% sol-gel result a marginal/only met target"); 246: applied ("All stated comparisons match the numbers' direction") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (19 Batch, 0 Feedback), 19 reserved; notice not shown; 1 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 4 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before biofouling drift exceeded 5 percent. The proto..." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 used an uncoated fused silica window and a mechanical wiper cycling every 15 minutes, and..."; storyline: "Three blade materials were tried on Orion-1 and none exceeded 16 days before the wiper approach w..."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent (confirmed in both transcrip..."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "No prior-year status role appears in section." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company is based in Port Aldous, British Columbia, and employs 35 people building water quality instruments. / It designs in-line optical analyzers that sit in the process stream for municipal treatment plants. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought an in-line UV analyzer window that resists biofouling for 30 days or more without cleaning. / This replaces the failed Orion-1 mechanical wiper design that lost calibration within 14 to 16 days. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published coating was known to combine UV clarity, food-grade safety, and chlorine durability for this use. / Typical fluoropolymers and hydrogels that resist fouling lose 30 to 60 percent of transmission at 254 nanometres. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team also sought to know whether a reference channel at 365 nanometres could separate fouling drift from real water-quality change. / That knowledge was intended to enable a dual-wavelength correction that works without a mechanical cleaning cycle. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether any window surface treatment could resist biofilm attachment for 30 days or more. / The treatment also had to stay optically clear at 254 nanometres while surviving chlorine and grit in the stream. _(cited)_
- It was unknown whether a coating combining UV clarity, food-grade safety, and chlorine durability even existed. / No published coating was known to combine those three properties for this application. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned three staged experiments: coupon screening, fouling tank correction work, and field trials. / Coupon screening ran August to October 2025, tank work October 2025 to January 2026, field trials February to June 2026. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a stable multiple links attenuation at 254 and 365 nanometres, then correcting by that fitted multiple holds drift under 2 percent for 30 days. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Coupon screening tested four coating candidates plus uncoated controls over 42 days in secondary effluent. / Only the sol-gel with fluorinated top met both clarity and durability targets, just barely. _(cited)_
  - Tested: uncertainty "It was unknown whether a coating combining UV clarity, food-grade s..."
- The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing clarity from day one. / The titania film fouled faster than uncoated controls, likely from low in-stream UV intensity and surface roughness. _(cited)_
  - Tested: uncertainty "It was unknown whether a coating combining UV clarity, food-grade s..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The sol-gel coating with a fluorinated top at about 180 nanometres answered whether the coating combination existed. / It held transmission above 85 percent and delayed 5 percent fouling loss to 36 to 40 days in real secondary effluent. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Coupon screening showed a sol-gel coating with a fluorinated top can combine UV clarity, food-grade safety, and chlorine durability. / This answered whether such a coating combination existed at all, confirming only one candidate met both targets. _(cited)_
  - Links: uncertainty "It was unknown whether a coating combining UV clarity, food-grade s..."; experiments "Coupon screening tested four coating candidates plus uncoated contr...", "The zwitterionic brush resisted biofilm best but started at only 71..."
- The sol-gel with fluorinated top started at 89 percent transmission and took 31 days to lose 5 percent. / This gave the first concrete evidence that a durable, UV-clear coating combination exists. _(cited)_
  - Links: uncertainty "It was unknown whether a coating combining UV clarity, food-grade s..."; experiments "Coupon screening tested four coating candidates plus uncoated contr...", "The zwitterionic brush resisted biofilm best but started at only 71..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days remains unresolved for fiscal 2027. / One field unit showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The sol-gel coating with a fluorinated top layer resolved whether a UV-clear, food-grade, chlorine-durable coating could exist. / At about 180 nanometres it held transmission above 85 percent and delayed 5 percent fouling loss to 36 to 40 days. _(cited)_

## Drafted Sections

### Line 242

The company is based in Port Aldous, British Columbia, and employs 35 people building water-quality instruments, including in-line optical analyzers that sit in the process stream for municipal treatment plants to measure UV absorbance at 254 nm.

The company sought an in-line UV analyzer window that resists biofouling for 30 days or more without cleaning, replacing the failed Orion-1 mechanical wiper design, which lost calibration within 14 to 16 days.

The limitations to standard practice were that no published coating was known to combine UV clarity at 254 nm, food-grade safety, and chlorine durability in a single surface treatment. Typical fluoropolymer and hydrogel coatings known to resist fouling lose 30 to 60 percent of transmission at 254 nm. The textbook assumption that biofilm attenuates light evenly across wavelengths, which underlies simple ratio-based drift correction, had never been verified against real biofilm, which contains its own UV-absorbing organics whose spectral behaviour over the life of a film was undocumented.

The technological objective was to advance the understanding of UV-transparent, biofouling-resistant window coatings and of whether a 365 nm reference channel could separate biofouling drift from true water-quality change, for the purpose of a dual-wavelength design using reference-channel correction to address drift without a mechanical cleaning cycle.

It was uncertain whether any window surface treatment could resist biofilm attachment for 30 days or more while holding transmission at or above 85 percent at 254 nm and surviving chlorine and grit, because no coating combining those three properties was known to exist and Orion-1's uncoated window and wiper had already failed under the same conditions. It was further uncertain whether fouling-induced drift could be separated from real water-quality change using a 365 nm reference channel, because Orion-1's single-wavelength design provided no way to test whether the attenuation multiple between the two wavelengths behaved consistently as the biofilm aged.

### Line 244

The technological problem for fiscal 2026 was twofold: no published coating was known to combine UV clarity at 254 nm, food-grade safety, and chlorine durability, and it was unknown whether biofilm attenuation behaved consistently enough across wavelengths to support a correction model. The team planned three staged experiments: coupon screening, fouling tank correction work, and field trials. Coupon screening ran August to October 2025, tank work October 2025 to January 2026, and field trials February to June 2026.

It was hypothesized that if a stable multiple links attenuation at 254 and 365 nanometres, then correcting the 254 nm signal by that fitted multiple of the 365 nm loss would hold drift under 2 percent for at least 30 days. A second, related hypothesis held that a thin silica sol-gel layer with a fluorinated top surface would keep raw, uncorrected drift under 5 percent over the same 30 days.

The first uncertainty addressed was whether a coating combining UV clarity, food-grade safety, and chlorine durability existed at all. Coupon screening tested four coating candidates, a fluorosilane monolayer, a sol-gel with fluorinated top, a zwitterionic polymer brush, and a titania self-cleaning film, plus uncoated controls, over 42 days in secondary effluent. The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing the clarity target from day one, and the titania film fouled faster than the uncoated control, which ran against its expected self-cleaning behaviour; this was attributed to low in-stream UV intensity and a rough surface that aided attachment rather than resisting it. Only the sol-gel with fluorinated top met both the clarity and durability targets, and only marginally, at 89 percent initial transmission and 31 days to 5 percent loss. This established that the coating combination needed did exist, but only in one of the four candidates tested, and that the result left little margin against the targets.

The second uncertainty addressed was whether biofilm fouling could be corrected using a fixed ratio between the 254 nm and 365 nm channels, the basis of the dual-wavelength design. Six Orion-2 optical heads with uncoated windows ran in a fouling tank with nutrient-spiked effluent for 21 days, logging both channels every 5 minutes. The attenuation multiple between channels ran about 1.6 in the first 4 to 5 days, then dropped to about 1.15 as the film thickened, so a fixed multiple of 1.4 left 4.8 percent residual drift at day 21, disproving the fixed-ratio hypothesis and showing that biofilm attenuation is not spectrally flat. In response, the team fitted a correction factor as a function of accumulated 365 nm loss instead of a fixed multiple, trained on 4 of 6 heads and tested on the 2 held out, which held corrected drift to 1.7 percent at day 21; a fresh January 2026 run with 6 new heads confirmed a worst case of 1.9 percent at day 21, the first time drift had been held under 2 percent in tank testing. This established reference-channel correction, keyed to accumulated loss rather than a fixed ratio, as the working method.

The combined coating and correction approach was then carried into field trials at the Harbourside plant from February 9 to June 12, 2026, across four complete Orion-2 units. On secondary effluent, raw drift exceeded 5 percent at day 36 and day 40 on the two units, while corrected drift stayed under 2 percent until day 52 and day 55, exceeding the original 30-day target. On chlorinated final effluent, one unit's coating showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected to be chlorine attack on the fluorinated layer, leaving coating durability beyond 70 days as an open question.

### Line 246

The technological objective for fiscal 2026 was to advance understanding of UV-clear, fouling-resistant window coatings and of reference-channel correction for separating biofouling drift from real water-quality change. Both parts were met, and the correction result exceeded its target by a wide margin. The original fixed-ratio correction hypothesis was disproven, since the attenuation relationship between channels was not stable; the revised, accumulated-loss-based correction held drift under 2 percent well beyond 30 days in field conditions.

The sol-gel coating with a fluorinated top layer, at about 180 nanometres, answered whether a coating combining UV clarity, food-grade safety, and chlorine durability could exist at all. It held transmission above 85 percent and delayed 5 percent fouling loss to 36 to 40 days in real secondary effluent, confirming the dual-wavelength design's coated-window side was workable.

Coupon screening showed that a fouling-resistant coating combining UV clarity, food-grade safety, and chlorine durability was achievable, with only the sol-gel with fluorinated top meeting both targets. That coating started at 89 percent transmission and took 31 days to lose 5 percent, the first concrete evidence the combination exists; the zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing clarity outright, and the titania film fouled faster than the uncoated control.

It was established that biofilm attenuation is not spectrally flat across 254 and 365 nm: the attenuation multiple falls from about 1.6 early in film growth to about 1.15 as the film matures, disproving the fixed-ratio model. Reference-channel correction keyed to accumulated 365 nm loss held corrected drift under 2 percent for 52 to 55 days in field trials.

Coating durability beyond 70 days in chlorinated water remains unresolved for fiscal 2027: one field unit showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack not yet confirmed. Cold-water behaviour and transfer of the correction curve to other water chemistries are untested and carry into fiscal 2027.

The coating and correction together addressed the biofouling drift that limited Orion-1 to 14-16 days, extending corrected performance to 52-55 days against the original 30-day goal.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 305/350 words, 33/50 lines |
| 242 | Claim Exclusion: Business impact framing around service interval and customer satisfaction is a commercial consideration, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer complaints about service interval driving product strategy is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Folding the coating and correction into the next product revision is a product/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine application feature built on the underlying correction work, not itself the technological uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Setting aside UV-C LEDs due to cost and lifetime is a routine cost/engineering judgment, not systematic investigation performed this year. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Rejecting the flushing system because operators would not maintain it is a routine operational/business judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Coating cost per window is a cost/business figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Staffing level and time allocation of the technician is an administrative/resourcing detail, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Prior-year (fiscal 2025) spend figure is a financial/administrative detail outside this year's claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Company headcount and general corporate description is background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 242 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: mechanical wiper | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: dual-wavelength design | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: reference-channel correction | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline's uncertainties and goals |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (confirmed in both transcript and scoping notes). | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Best wiper blade result was 16 days across three blade materials (EPDM, silicone, fluoroelastomer). | applied | none |  | P2 states 14-16 days range, matches established range |
| 242 | Confidence Map: Sol-gel coating with fluorinated top was the only candidate meeting both transmission and durability targets in round one coupon screening. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Second round sol-gel coating (thinner, more even, ~180 nm) extended time to 5 percent loss to 38 days with 87 percent initial transmission. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: 254/365 attenuation multiple was about 1.6 early and fell to about 1.15 later in biofilm growth, confirmed independently in transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fitted correction factor based on accumulated 365 nm loss, trained on 4 heads and tested on 2, giving 1.7 percent drift at day 21. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on the two secondary-effluent units. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack on the coating, but this cause is only a hypothesis, not confirmed. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unresolved since no winter field data was collected. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Coating durability in chlorinated water beyond 70 days remains unresolved. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: The correction adds a small, quantified processing overhead per sample, a minor supporting detail only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: orion-2 | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: coupon screening | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: fouling tank | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: field trial | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: sol-gel with fluorinated top | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: reference-channel correction | applied | none |  | P4 says 'dual-wavelength design that corrects drift' instead; repaired to the Glossary Term |
| 242 | Glossary Term: attenuation multiple | applied | none |  | P3 describes the concept via 'attenuates light evenly' not…; repaired to the Glossary Term |
| 242 | Glossary Term: fouling-resistant coating | applied | none |  | Concept named as 'biofouling-resistant' not as separate… |
| 242 | Cover signed-off Summary item ys7dmrwrxvzwtn2wpx8dtr2mk18ffyhs | applied | none |  | P1 states location, headcount, product. |
| 242 | Cover signed-off Summary item ys70cmx96gv348yjv3hkbhr9r18ff7gr | applied | none |  | P2 states 30-day goal and Orion-1 failure. |
| 242 | Cover signed-off Summary item ys72kwt258zvbzjcd8rzecjw3s8ff3s4 | applied | none |  | P3 states no known coating and transmission loss. |
| 242 | Cover signed-off Summary item ys773n2xehrjd007fayg1a3eph8ffg6b | applied | none |  | P4 states objective of coating and 365nm reference. |
| 242 | Cover signed-off Summary item ys73g2wy1tdaa50nn89kmj0va18ff32s | applied | none | 2 | P5 states coating attachment/clarity uncertainty. |
| 242 | Cover signed-off Summary item ys768d2jhj0r2jxwd1yyn84eex8fezqt | applied | none | 2 | P5 states reference-channel drift separation uncertainty. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 611/700 words, 57/100 lines |
| 244 | Claim Exclusion: Business impact framing around service interval and customer satisfaction is a commercial consideration, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer complaints about service interval driving product strategy is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Folding the coating and correction into the next product revision is a product/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine application feature built on the underlying correction work, not itself the technological uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Setting aside UV-C LEDs due to cost and lifetime is a routine cost/engineering judgment, not systematic investigation performed this year. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Rejecting the flushing system because operators would not maintain it is a routine operational/business judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Coating cost per window is a cost/business figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Staffing level and time allocation of the technician is an administrative/resourcing detail, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Prior-year (fiscal 2025) spend figure is a financial/administrative detail outside this year's claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Company headcount and general corporate description is background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: dual-wavelength design | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: field trial | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sol-gel with fluorinated top | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: reference-channel correction | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches storyline narrative and results |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (confirmed in both transcript and scoping notes). | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Best wiper blade result was 16 days across three blade materials (EPDM, silicone, fluoroelastomer). | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Sol-gel coating with fluorinated top was the only candidate meeting both transmission and durability targets in round one coupon screening. | applied | none |  | States sol-gel only candidate meeting both targets |
| 244 | Confidence Map: Second round sol-gel coating (thinner, more even, ~180 nm) extended time to 5 percent loss to 38 days with 87 percent initial transmission. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: 254/365 attenuation multiple was about 1.6 early and fell to about 1.15 later in biofilm growth, confirmed independently in transcript and scoping notes. | applied | none |  | States 1.6 early, 1.15 later, matches established fact |
| 244 | Confidence Map: Fitted correction factor based on accumulated 365 nm loss, trained on 4 heads and tested on 2, giving 1.7 percent drift at day 21. | applied | none |  | Fitted correction trained 4/2 heads, 1.7 percent stated |
| 244 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on the two secondary-effluent units. | applied | none |  | Corrected drift under 2 percent to day 52/55 stated |
| 244 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack on the coating, but this cause is only a hypothesis, not confirmed. | applied | none |  | Hedged with 'suspected to be', matches partial status |
| 244 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unresolved since no winter field data was collected. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Coating durability in chlorinated water beyond 70 days remains unresolved. | applied | none |  | Hedged as 'open question', matches unresolved status |
| 244 | Confidence Map: The correction adds a small, quantified processing overhead per sample, a minor supporting detail only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: biofouling drift | applied | none |  | Concept absent from section |
| 244 | Glossary Term: mechanical wiper | applied | none |  | Concept absent from section |
| 244 | Glossary Term: dual-wavelength design | applied | none |  | Section says 'dual-wavelength' concept differently in P5; repaired to the Glossary Term |
| 244 | Glossary Term: reference-channel correction | applied | none |  | Section describes correction without the term verbatim; repaired to the Glossary Term |
| 244 | Glossary Term: fouling-resistant coating | applied | none |  | No single phrase stands in for the term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role appears in section. |
| 244 | Cover signed-off Summary item ys783gg76jnr6444358e3xdaq18fev25 | applied | none |  | Three stages and dates both stated in P1. |
| 244 | Cover signed-off Summary item ys7ay2acge2wk52pe47nztspq18fe0p6 | applied | none |  | Hypothesis with 2 percent/30 day target stated in P2. |
| 244 | Cover signed-off Summary item ys72w6jbxq8a1e3mm7n6pyk4ks8fe69t | applied | none |  | Coupon screening of 4 candidates, 42 days, result stated in P3. |
| 244 | Cover signed-off Summary item ys76qvmm97bpqga557bqt848bx8ff38r | applied | none |  | Brush and titania failure details both stated in P3. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P3 calls 89% sol-gel result a marginal/only met target |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work traces to Line 242 uncertainties or Line 246 items. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 5 (sections 244, 246): 244 P5 says raw drift exceeded 5 percent at day 36 and day 40 on the two field units, with corrected drift under 2 percent until day 52 and day 55. 246 P2 reads the same day 36 to 40 figures as the coating's own fouling loss delay ('delayed 5 percent fouling loss to 36 to 40 days'), attributing to the coating what 244 attributes to raw (uncorrected) drift. These are two different measurements (coating transmission loss vs. raw signal drift) being described as the same number, which cannot both be the correct origin of the day 36-40 figures. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 345/350 words, 39/50 lines |
| 246 | Claim Exclusion: Business impact framing around service interval and customer satisfaction is a commercial consideration, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer complaints about service interval driving product strategy is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Folding the coating and correction into the next product revision is a product/commercialization decision, not itself SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine application feature built on the underlying correction work, not itself the technological uncertainty. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Setting aside UV-C LEDs due to cost and lifetime is a routine cost/engineering judgment, not systematic investigation performed this year. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Rejecting the flushing system because operators would not maintain it is a routine operational/business judgment, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Coating cost per window is a cost/business figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Staffing level and time allocation of the technician is an administrative/resourcing detail, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Prior-year (fiscal 2025) spend figure is a financial/administrative detail outside this year's claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Company headcount and general corporate description is background, not technological work. | applied | none |  | excluded claim absent (not technological) |
| 246 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 6) |
| 246 | Glossary Term: dual-wavelength design | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: field trial | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: sol-gel with fluorinated top | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: reference-channel correction | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: attenuation multiple | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches storyline objectives and results |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent (confirmed in both transcript and scoping notes). | applied | none |  | 14-day Orion-1 figure not contradicted, only range cited |
| 246 | Confidence Map: Best wiper blade result was 16 days across three blade materials (EPDM, silicone, fluoroelastomer). | applied | none |  | P5 cites 14-16 days range matching C1/C2 |
| 246 | Confidence Map: Sol-gel coating with fluorinated top was the only candidate meeting both transmission and durability targets in round one coupon screening. | applied | none |  | P2 states only one candidate met both targets |
| 246 | Confidence Map: Second round sol-gel coating (thinner, more even, ~180 nm) extended time to 5 percent loss to 38 days with 87 percent initial transmission. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: 254/365 attenuation multiple was about 1.6 early and fell to about 1.15 later in biofilm growth, confirmed independently in transcript and scoping notes. | applied | none |  | P3 states 1.6 to 1.15 multiple as established |
| 246 | Confidence Map: Fitted correction factor based on accumulated 365 nm loss, trained on 4 heads and tested on 2, giving 1.7 percent drift at day 21. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Field trial corrected drift stayed under 2 percent until day 52 and day 55 on the two secondary-effluent units. | applied | none |  | P3 states corrected drift under 2 percent for 52-55 days |
| 246 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected chlorine attack on the coating, but this cause is only a hypothesis, not confirmed. | applied | none |  | P4 hedges cause as suspected, not confirmed |
| 246 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly left open for next year. | applied | none |  | P4 states transfer is untested, carried to 2027 |
| 246 | Confidence Map: Cold-water (4-6 C) behaviour of biofilm and correction curve is unresolved since no winter field data was collected. | applied | none |  | P4 states cold-water behaviour is untested |
| 246 | Confidence Map: Coating durability in chlorinated water beyond 70 days remains unresolved. | applied | none |  | P4 states durability beyond 70 days is unresolved |
| 246 | Confidence Map: The correction adds a small, quantified processing overhead per sample, a minor supporting detail only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: mechanical wiper | applied | none |  | Concept absent from this section |
| 246 | Glossary Term: orion-2 | applied | none |  | Concept absent; no Orion-2 reference in section |
| 246 | Glossary Term: dual-wavelength design | applied | none |  | P1 says dual-wavelength only via reference-channel method; repaired to the Glossary Term |
| 246 | Glossary Term: fouling tank | applied | none |  | Concept absent from this section |
| 246 | Glossary Term: reference-channel correction | applied | none |  | P1 says "reference-channel method" not "reference-channel…; repaired to the Glossary Term |
| 246 | Glossary Term: fouling-resistant coating | applied | none |  | P2 describes coating without the term verbatim; repaired to the Glossary Term |
| 246 | Cover signed-off Summary item ys7ea0tyh699nsxqv1h41vsvex8fefvw | applied | none |  | P2 states coating met wavelength/clarity/durability answer… |
| 246 | Cover signed-off Summary item ys7fm6w6e70k5e1632f5pqfp898fe3nj | applied | none | 2 | P3 covers coupon screening, only sol-gel met both targets |
| 246 | Cover signed-off Summary item ys70j3t0cw80w6d6tpcv3ydghd8feyn2 | applied | none | 2 | P3 gives 89 percent/31 day figures as first concrete evidence |
| 246 | Cover signed-off Summary item ys782h9g7q54tmgz46ty0vff9h8ff97k | applied | none |  | P5 states unresolved durability and 9 percent loss figure |
| 246 | Cover signed-off Summary item ys707vvdbkr1fbfwhrxw24p6m18ffy54 | applied | none |  | P2 gives coating result exceeding goal with wavelength figures |
| 246 | State each result against its target as the numbers show | applied | none |  | All stated comparisons match the numbers' direction |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements trace to COVER items or Line 242 uncertainties |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): 246 P2 states the sol-gel coating held transmission above 85 percent, but 244 P3 reports the sol-gel coating's initial transmission as 89 percent only marginally above the 85 percent target, and does not establish that 85 percent was held throughout the test; 244 P3 instead reports 31 days to 5 percent loss, meaning transmission would fall below 85 percent well before day 36-40 referenced in 246 P2. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 2 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 27.
- Line 244: 0 labels and 0 plan checks "Not checked" of 25.
- Line 246: 0 labels and 0 plan checks "Not checked" of 26.

## Seed-stage numbers

- Requests: 19 metered (19 Batch, 0 Feedback); 19 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.4 s, p95 23.8 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 25.6 s, p95 25.6 s over 1.
- Sign-off to report created: 152.1 s.
- Cost from aiUsage: $1.25 in all ($0.48 seed stage, $0.77 Brief, drafting and checks) over 49 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T01:53:50.959Z created project k9716qazkt8tc1a2c657m1phm58ffxyn
2026-10-01T01:53:51.592Z added document fiscal-2026-scoping-notes.md
2026-10-01T01:53:52.944Z started Step by step generation k575j2hm86fmr0r0dn97x4pcrd8femmn
2026-10-01T01:54:48.437Z seed stage open
2026-10-01T01:54:48.438Z Open Company / Context and wait for its Batch
2026-10-01T01:55:00.157Z Company / Context: select the first Seed
2026-10-01T01:55:02.053Z Approve Company / Context
2026-10-01T01:55:03.975Z approved company_context
2026-10-01T01:55:03.975Z Open Goal / Problem and wait for its Batch
2026-10-01T01:55:15.640Z Goal / Problem: select the first Seed
2026-10-01T01:55:17.539Z Approve Goal / Problem
2026-10-01T01:55:19.451Z approved goal_problem
2026-10-01T01:55:19.451Z Open Technological limitations and wait for its Batch
2026-10-01T01:55:33.767Z Technological limitations: select the first Seed
2026-10-01T01:55:35.669Z Approve Technological limitations
2026-10-01T01:55:37.577Z approved passive_limitations
2026-10-01T01:55:37.577Z Open Technological objectives and wait for its Batch
2026-10-01T01:55:51.842Z Technological objectives: select the first Seed
2026-10-01T01:55:53.761Z Approve Technological objectives
2026-10-01T01:55:55.677Z approved technological_objective
2026-10-01T01:55:55.677Z Open Technological uncertainties and wait for its Batch
2026-10-01T01:56:09.973Z Technological uncertainties: select the first 2 Seeds
2026-10-01T01:56:13.162Z Approve Technological uncertainties
2026-10-01T01:56:15.081Z approved active_uncertainties
2026-10-01T01:56:15.081Z Open Previous-year status and wait for its Batch
2026-10-01T01:56:29.371Z Skip Previous-year status
2026-10-01T01:56:30.642Z Open Work plan and wait for its Batch
2026-10-01T01:56:58.173Z Work plan: select the first Seed
2026-10-01T01:57:00.084Z Approve Work plan
2026-10-01T01:57:01.990Z approved workplan
2026-10-01T01:57:01.990Z Open Hypothesis and wait for its Batch
2026-10-01T01:57:25.521Z hypothesis: attempt failed, Retry 1
2026-10-01T01:57:49.824Z Hypothesis: select the first Seed
2026-10-01T01:57:52.959Z Approve Hypothesis
2026-10-01T01:57:55.099Z approved hypothesis
2026-10-01T01:57:55.099Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T01:58:09.679Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T01:58:12.890Z Approve Experimentation / Iterations
2026-10-01T01:58:14.806Z approved experimentation
2026-10-01T01:58:14.806Z Open Advancement to science / technology and wait for its Batch
2026-10-01T01:58:36.962Z Advancement to science / technology: select the first Seed
2026-10-01T01:58:38.876Z Approve Advancement to science / technology
2026-10-01T01:58:40.800Z approved overall_advancement
2026-10-01T01:58:40.800Z Open Specific technological advancements and wait for its Batch
2026-10-01T01:58:55.109Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T01:59:00.256Z Approve Specific technological advancements
2026-10-01T01:59:02.231Z approved specific_advancements
2026-10-01T01:59:02.231Z Open Project status and next steps and wait for its Batch
2026-10-01T01:59:17.567Z Project status and next steps: select the first Seed
2026-10-01T01:59:19.489Z Approve Project status and next steps
2026-10-01T01:59:21.445Z approved project_status
2026-10-01T01:59:21.445Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T01:59:43.617Z Overall company / project goal improvements: select the first Seed
2026-10-01T01:59:45.537Z Approve Overall company / project goal improvements
2026-10-01T01:59:47.420Z approved goal_improvements
2026-10-01T01:59:47.420Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T01:59:48.705Z signed off; waiting for the report
2026-10-01T02:02:21.939Z report kd733n2ca7w697b1brvdkkt24s8ffm78 created
```
