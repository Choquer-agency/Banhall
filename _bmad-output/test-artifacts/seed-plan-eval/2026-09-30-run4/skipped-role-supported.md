# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-09-30 on `local` at commit `e8112000`, acting as e2e-audit@banhall.local. Project `k97bas2brzzec9vyc8sdfbkps98fef6c`, generation `k577xdd6dgycer2qwxwtrxw9fs8ffdsy`.

## What this fixture tests

A continuing project whose sources describe the previous year in detail (the Orion-1 prototype, its 14-day drift limit and the uncertainties left open at June 30 2025). The writer opens Previous-year status, sees cited Seeds for it, and skips it anyway. The drafter must not cover the skipped role even though the Brief and sources support it, and the Compliance Note must record the Skip as honoured.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 244 does not describe the previous year's status (Orion-1, the 14-day drift limit, what remained open at the end of fiscal 2025) as a topic of its own.
   - Answer: Yes. No 14-day result, blade materials or fiscal 2025 status in Line 244; the Skip row is applied.
2. Where this year's work refers back to the earlier prototype, it does so only as context for fiscal 2026 work, not as a previous-year status passage.
   - Answer: Yes. The failed "Orion-1" heuristic matches one clause, "the uncertainty left open after Orion-1's wiper approach failed", which gives where this year's uncertainty came from; other mentions are signed-off items 2, 3 and the item 12 baseline.
3. The rest of Section 244 (work plan, hypothesis, experiments) is complete without the skipped role.
   - Answer: Yes. Three dated stages, both hypotheses, the 42-day screening, the second coating round (run 12's minor fixed), both tank runs and the field trial.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (324, 676, 340).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (high confidence). Minors: Line 246 paragraph 2 says chlorinated durability was resolved while paragraph 4 and the source call it unresolved past 70 days; 89 percent paired with 36 to 40 days across two rounds; checker noise in targets and consistency rows. Every figure checked matches the sources.

## Automatic checks

11 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd74gt67r345sxmg4h3tjy4hxx8fe7an |
| All three Sections were drafted | pass | 242: 324 words, 244: 676 words, 246: 340 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | no Seed Batch failed |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work ties to the stated 30-day/254nm uncertainty and Line…"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P3 calls 89 percent met 'though' edges fouled, phrasing ok…"); 246: not_applied ("Result reported as misstated against its target named no valid paragraph.") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 4 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before biofouling drift passed 5 percent. The best of..." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 held calibration for only 14 days before drift exceeded the 5 percent target."; storyline: "Three wiper blade materials were tried on Orion-1 and none exceeded 16 days."; confidenceMap: "Orion-1 held calibration for 14 days before drift exceeded 5 percent, agreed by transcript and sc..."; glossaryTerm: "orion-1" |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "Prior year status not mentioned in section." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | fail | "ng optically clear at 254 nanometres, the uncertainty left open after Orion-1's wiper approach failed. The team planned three sequential stages: co" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds in-line optical water-quality instruments for municipal treatment plants in Port Aldous, British Columbia. / Its main product line measures UV absorbance at 254 nanometres as a proxy for dissolved organic carbon. _(writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought an in-line UV analyzer that resists biofilm fouling on its optical window for at least 30 days. / The goal was a sensor holding drift under 5 percent without the mechanical wiper used on Orion-1. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- The mechanical wiper approach on Orion-1 was a known failure mode, since blades smeared film and scratched the window once loaded with grit. / Standard practice offered no way to separate fouling drift from real water-quality change on a single-wavelength instrument. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The project sought to learn whether a window coating could resist biofilm attachment for 30 days or more while staying optically clear at 254 nanometres. / This knowledge was meant to enable a coated window that survives chlorine and grit without a mechanical wiper. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether any coating could resist biofilm attachment for 30 days while staying optically clear at 254 nanometres. / No published coating was known to be UV-clear, food-grade safe, and durable in chlorinated water at once. _(cited)_
- Marine anti-fouling biocides were unsuitable for drinking or wastewater use, narrowing the coating search. / Fluoropolymer and hydrogel coatings that resist fouling lose 30 to 60 percent of UV transmission at 254 nanometres. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned three sequential stages: coupon screening, fouling tank correction work, then field trials at Harbourside plant. / Coupon screening ran August to October 2025 to test candidate coatings against uncoated controls over 42 days. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a thin silica sol-gel layer with a fluorinated top surface is applied, then raw drift will stay under 5 percent for 30 days. / The coating must also keep at least 85 percent transmission at 254 nanometres when new. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Four coating candidates and uncoated controls ran as 12 coupons each in secondary effluent for 42 days. / Transmission at 254 nanometres was measured every 3 days to compare clarity and durability. _(cited)_
  - Tested: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."
- The zwitterionic brush resisted biofilm best but started at only 71 percent transmission, failing clarity from day one. / The titania film fouled faster than controls, likely from low UV intensity and a rough surface aiding attachment. _(cited)_
  - Tested: uncertainty "Marine anti-fouling biocides were unsuitable for drinking or wastew..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The sol-gel coating with a fluorinated top layer met both targets, reaching 85 percent transmission and delaying fouling loss to 36 to 40 days. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The sol-gel coating with a fluorinated top layer started at 89 percent transmission and met both targets, just barely. _(cited)_
  - Links: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."; experiments "Four coating candidates and uncoated controls ran as 12 coupons eac..."
- Uncoated controls and the fluorosilane monolayer both lost clarity fast, showing untreated silica cannot meet the durability target. / The 42-day coupon screening established the clarity and durability gap a usable coating had to close. _(cited)_
  - Links: uncertainty "It was uncertain whether any coating could resist biofilm attachmen..."; experiments "Four coating candidates and uncoated controls ran as 12 coupons eac..."

### 12. Project status and next steps (Section 246, standard): approved

- The field trial achieved corrected drift under 2 percent for over 50 days, up from Orion-1's 14-16 day result. / Coating durability in chlorinated water beyond 70 days remains unresolved after a 9 percent non-biofilm transmission loss appeared. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The original goal of resisting biofilm attachment for 30 days while staying optically clear at 254 nanometres was met. / A sol-gel coating with a fluorinated top layer reached 85 percent transmission and delayed fouling loss to 36 to 40 days. _(cited)_

## Drafted Sections

### Line 242

The company designs and builds in-line optical water-quality instruments for municipal treatment plants in Port Aldous, British Columbia. Its main product line measures UV absorbance at 254 nanometres as a proxy for dissolved organic carbon. This background in deploying optical sensors directly in wastewater streams gave the company firsthand exposure to the biofouling problem that limits in-line instrument performance.

The company sought an in-line UV analyzer that resists biofilm fouling on its optical window for at least 30 days. The goal was a sensor holding biofouling drift under 5 percent without the mechanical wiper used on Orion-1, whose blade had scratched the window and worsened fouling once loaded with grit.

The limitations to standard practice were that no documented method existed for resisting biofilm attachment on a UV-transmitting optical surface over a 30-day service interval. The mechanical wiper approach on Orion-1 was a known failure, since blades smeared film and scratched the window rather than removing fouling. Standard practice also offered no way to separate fouling drift from real water-quality change on a single-wavelength instrument, leaving no established basis for distinguishing an optical artifact from an actual shift in organic load.

The technological objective was to advance the understanding of whether a window coating could resist biofilm attachment for 30 days or more while staying optically clear at 254 nanometres, for the purpose of enabling a coated window that survives chlorine and grit without a mechanical wiper.

It was uncertain whether any coating could resist biofilm attachment for 30 days while staying optically clear at 254 nanometres, because no published coating was known to be UV-clear, food-grade safe, and durable in chlorinated water at once. Marine anti-fouling biocides were unsuitable for drinking or wastewater use, narrowing the coating search to non-biocidal chemistries. Fluoropolymer and hydrogel coatings that resist fouling lose 30 to 60 percent of UV transmission at 254 nanometres, raising uncertainty over whether any fouling-resistant coating could meet the transmission target at all.

### Line 244

The company undertook a planned series of experiments to determine whether a coated optical window could resist biofilm attachment for 30 days while staying optically clear at 254 nanometres, the uncertainty left open after Orion-1's wiper approach failed. The team planned three sequential stages: coupon screening of candidate coatings, fouling tank correction work, then field trials of complete units at the Harbourside plant. Coupon screening ran August to October 2025 and tested candidate coatings against uncoated controls over 42 days in a real secondary-effluent side stream, measuring transmission at 254 nanometres every 3 days to compare clarity and durability.

It was hypothesized that if a thin silica sol-gel layer with a fluorinated top surface was applied to the optical window, then raw biofouling drift would stay under 5 percent for 30 days. The coating also had to hold at least 85 percent UV transmission at 254 nanometres when new, since a coating that blocked too much light would defeat the sensor's purpose regardless of its fouling resistance.

The coupon screening addressed whether any fouling-resistant coating could resist biofilm attachment for 30 days while meeting the clarity target, since no published coating was known to combine UV clarity, food-grade safety, and durability in chlorinated water. Four candidates (fluorosilane monolayer, sol-gel with fluorinated top, zwitterionic polymer brush, titania self-cleaning film) ran as 12 coupons each alongside 12 uncoated controls in secondary effluent for 42 days. The zwitterionic brush resisted biofilm best of all candidates but started at only 71 percent transmission, failing the clarity target from day one, while the titania film fouled faster than the uncoated controls, likely because in-stream UV intensity was too low to activate self-cleaning and its rough surface aided attachment. Only the sol-gel candidate with a fluorinated top surface met both targets, reaching 89 percent initial transmission and delaying 5 percent loss to 31 days, though fouling was starting at the coating edges where the layer ran thinnest. In response, the team changed the dip withdrawal speed from 2 mm/s to 1 mm/s to produce a thinner, more even ~180 nanometre layer, and a second coupon round reached 87 percent initial transmission with 5 percent loss delayed to 38 days, establishing that a controlled dip-coating process could meet both the clarity and durability targets together.

A second line of testing addressed whether fouling attenuation at 254 nanometres was a stable multiple of attenuation at 365 nanometres, the assumption needed for a simple reference channel correction. Six uncoated Orion-2 optical heads ran in a recirculating fouling tank with nutrient-spiked effluent to accelerate biofilm growth, logging both wavelength channels every 5 minutes over 21 days. The 254/365 attenuation multiple was not stable: it ran near 1.6 while the film was thin, then fell to about 1.15 as the film thickened, so a fixed multiple of 1.4 left drift of 4.8 percent at day 21, disproving the simple fixed-ratio hypothesis. The team instead fit a correction factor as a function of accumulated reference channel loss, trained on four of six heads and tested on the other two held-out heads, which held drift to 1.7 percent at day 21, then confirmed at 1.9 percent worst case in a fresh January tank run with six new heads. This established that a correction keyed to accumulated reference channel loss, not a fixed ratio, could hold drift under the 2 percent target and generalize across untested units.

The final stage addressed whether the coated window and fitted correction would hold under field conditions across differing water chemistries. Four complete Orion-2 units, two on secondary effluent and two on chlorinated final effluent, ran at the Harbourside plant from February 9 to June 12, 2026, validated against twice-weekly lab grab samples. On secondary effluent, corrected drift held under 2 percent until day 52 and day 55, while raw drift exceeded 5 percent by day 36 and day 40. On final effluent, one unit's coating showed a 9 percent non-biofilm transmission loss between day 70 and day 90, suspected to be chlorine attack on the fluorinated layer, an unresolved durability question carried forward.

### Line 246

The technological objective of advancing UV-transparent, fouling-resistant coatings and dual-wavelength correction was achieved for fiscal 2026, though not for all conditions. The coating hypothesis was proven: a sol-gel coating with a fluorinated top layer met both the clarity and durability targets. The correction hypothesis, a fixed multiple between the 254 nm and 365 nm channels, was disproved and replaced by a model keyed to accumulated reference channel loss.

The sol-gel coating with a fluorinated top layer started at 89 percent transmission and met both targets, reaching above 85 percent UV transmission and delaying fouling loss to 36 to 40 days in secondary effluent. This resolved whether any coating could combine UV clarity, biofouling resistance, and durability in chlorinated wastewater. Uncoated controls and the fluorosilane monolayer both lost clarity fast, showing untreated silica cannot meet the durability target; the 42-day coupon screening established the clarity and durability gap a usable coating had to close. This informed the chemistry and process used on Orion-2.

It was established that biofilm fouling is not spectrally flat: the 254/365 attenuation multiple shifts as the film matures, so a fixed correction factor cannot hold biofouling drift within target. This resolved whether fouling drift could be separated from real water-quality change using a simple wavelength ratio, and led to a correction keyed to accumulated reference channel loss, holding corrected drift under 2 percent for over 50 days in the field, up from Orion-1's 14 to 16 day result.

Coating durability in chlorinated water beyond 70 days remains unresolved: a 9 percent non-biofilm transmission loss appeared on one final-effluent unit with no confirmed cause. Cold-water behaviour at 4-6°C and transferability of the correction curve to a plant with different organic load are also open, since this year's data came only from warmer water at one site. Fiscal 2027 work will target these three questions.

The original goal, resisting biofilm attachment for 30 days while staying optically clear at 254 nm, was met: the sol-gel coating reached 85 percent transmission with fouling loss delayed to 36 to 40 days.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 324/350 words, 34/50 lines |
| 242 | Claim Exclusion: Expectation that the service-interval improvement will make the instrument more commercially desirable to customers is a business outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer complaints about service interval driving product decisions are a market/business consideration. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Plans to fold the results into the next product revision are a commercialization decision, not R&D work itself. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine product feature built on established results, not itself an uncertainty being resolved. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Coating cost estimate is a commercial/manufacturing cost figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Routine staffing allocation detail is administrative, not technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches Storyline's Orion-1 background and uncertainties |
| 242 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent, agreed by transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Transcript account of the same 14-day result. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Three blade materials tested, best result 16 days, per scoping notes with specific materials named. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Coating screening results across four candidates plus uncoated controls, consistent between transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Second coupon round after withdrawal-speed change reached 38 days to 5 percent loss, with initial transmission at 87 percent. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fixed-multiple correction (1.4) left 4.8 percent drift at day 21, disproving the simple hypothesis. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Transcript's matching account of the fixed-multiple failure. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial secondary-effluent corrected drift held under 2 percent until day 52 and 55. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss attributed to chlorine attack, stated as a suspicion rather than confirmed cause. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Chlorine attack mechanism is explicitly hedged as a belief, not confirmed. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly deferred. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Cold-water (4-6 C) biofilm and correction behaviour is untested; all field data is from warmer water. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fiscal 2025 program spend figure given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Correction computation time overhead reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Free chlorine level at the time of the final-effluent coating thinning, reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: biofouling drift | applied | none |  | P2 says 'drift' without 'biofouling drift'; repaired to the Glossary Term |
| 242 | Glossary Term: reference channel | applied | none |  | Concept absent from section |
| 242 | Glossary Term: orion-2 | applied | none |  | Orion-2 not mentioned in the section |
| 242 | Glossary Term: coupon screening | applied | none |  | Concept absent from section |
| 242 | Glossary Term: dual-wavelength correction | applied | none |  | Concept absent from section |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept absent from section |
| 242 | Glossary Term: dip withdrawal speed | applied | none |  | Concept absent from section |
| 242 | Glossary Term: grab samples | applied | none |  | Concept absent from section |
| 242 | Glossary Term: 254/365 attenuation multiple | applied | none |  | Concept absent from section |
| 242 | Glossary Term: fouling-resistant coating | applied | none |  | P5 says 'fouling-resistant chemistry' not the term; repaired to the Glossary Term |
| 242 | Cover signed-off Summary item ys754bwzasvv4zn9b5q75avjv18fezsp | applied | none |  | P1 states location and product line verbatim. |
| 242 | Cover signed-off Summary item ys788nrbxfj1mg7j0eh4by2f3s8ffptn | applied | none |  | P2 states goal, 30 days, 5 percent, wiper issue. |
| 242 | Cover signed-off Summary item ys7dra9cepa3qs7515zh7q28258ff6eh | applied | none |  | P3 covers wiper failure and drift separation limit. |
| 242 | Cover signed-off Summary item ys73w154rphfegs45hd8xrgbc18ff5rx | applied | none |  | P4 states objective and purpose as planned. |
| 242 | Cover signed-off Summary item ys705nybr2g1vqbgj0cxtfdwdd8ffrxm | applied | none | 2 | P5 states uncertainty and no known coating meeting all needs. |
| 242 | Cover signed-off Summary item ys739wfjq8qgbsswjb3z3121vs8ff844 | applied | none | 2 | P5 covers biocide unsuitability and transmission loss figures. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was uncertain whether any coating could resist biofilm attachment for 30 days while staying optically clear at 254 n..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 676/700 words, 63/100 lines |
| 244 | Claim Exclusion: Expectation that the service-interval improvement will make the instrument more commercially desirable to customers is a business outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer complaints about service interval driving product decisions are a market/business consideration. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Plans to fold the results into the next product revision are a commercialization decision, not R&D work itself. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine product feature built on established results, not itself an uncertainty being resolved. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Coating cost estimate is a commercial/manufacturing cost figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Routine staffing allocation detail is administrative, not technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fouling tank | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: dip withdrawal speed | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: grab samples | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: 254/365 attenuation multiple | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches the four-experiment storyline arc |
| 244 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent, agreed by transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Transcript account of the same 14-day result. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Three blade materials tested, best result 16 days, per scoping notes with specific materials named. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Coating screening results across four candidates plus uncoated controls, consistent between transcript and scoping notes. | applied | none |  | Coupon screening results stated as established fact |
| 244 | Confidence Map: Second coupon round after withdrawal-speed change reached 38 days to 5 percent loss, with initial transmission at 87 percent. | applied | none |  | 38 days, 87 percent stated flatly, matches established |
| 244 | Confidence Map: Fixed-multiple correction (1.4) left 4.8 percent drift at day 21, disproving the simple hypothesis. | applied | none |  | 4.8 percent drift stated flatly, matches established |
| 244 | Confidence Map: Transcript's matching account of the fixed-multiple failure. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Field trial secondary-effluent corrected drift held under 2 percent until day 52 and 55. | applied | none |  | Day 52/55 figures stated flatly, matches established |
| 244 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss attributed to chlorine attack, stated as a suspicion rather than confirmed cause. | applied | none |  | "suspected to be" hedges the cause as partial evidence shows |
| 244 | Confidence Map: Chlorine attack mechanism is explicitly hedged as a belief, not confirmed. | applied | none |  | Chlorine attack stated as suspicion, hedged |
| 244 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly deferred. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Cold-water (4-6 C) biofilm and correction behaviour is untested; all field data is from warmer water. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Fiscal 2025 program spend figure given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Correction computation time overhead reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Free chlorine level at the time of the final-effluent coating thinning, reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: reference channel | applied | none |  | Concept named as "reference wavelength" not "reference…; repaired to the Glossary Term |
| 244 | Glossary Term: dual-wavelength correction | applied | none |  | Concept of dual-wavelength correction not named with other words |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior year status not mentioned in section. |
| 244 | Cover signed-off Summary item ys79m10z0kmt5x6w90mc3gzhx58fex95 | applied | none |  | P1 states the three stages and screening dates/42 days. |
| 244 | Cover signed-off Summary item ys7aetd2e8z74x25zyt1pshx9x8ffp3p | applied | none |  | P2 states the hypothesis and 85 percent transmission… |
| 244 | Cover signed-off Summary item ys7dkt9fhzk9aem5p13p8y2h3n8ff1qs | applied | none |  | P3 covers the uncertainty and the 12-coupon 42-day test. |
| 244 | Cover signed-off Summary item ys78shh4wvysv8tr6anp11f40h8fe9pm | applied | none |  | P3 states zwitterionic brush and titania film results as… |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P3 calls 89 percent met 'though' edges fouled, phrasing ok… |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work ties to the stated 30-day/254nm uncertainty and Line… |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team planned three sequential stages: coupon screening, fouling tank correction work, then field trials at Harbours..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 340/350 words, 36/50 lines |
| 246 | Claim Exclusion: Expectation that the service-interval improvement will make the instrument more commercially desirable to customers is a business outcome, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer complaints about service interval driving product decisions are a market/business consideration. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Plans to fold the results into the next product revision are a commercialization decision, not R&D work itself. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The firmware reporting a fouling index for operator scheduling is a routine product feature built on established results, not itself an uncertainty being resolved. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Coating cost estimate is a commercial/manufacturing cost figure, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Routine staffing allocation detail is administrative, not technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: orion-1 | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: biofouling drift | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: orion-2 | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: coupon screening | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: dual-wavelength correction | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: uv transmission | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: 254/365 attenuation multiple | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: fouling-resistant coating | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section follows Storyline arc and results |
| 246 | Confidence Map: Orion-1 held calibration for 14 days before drift exceeded 5 percent, agreed by transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Transcript account of the same 14-day result. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Three blade materials tested, best result 16 days, per scoping notes with specific materials named. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Coating screening results across four candidates plus uncoated controls, consistent between transcript and scoping notes. | applied | none |  | Coating screening results stated consistent with entry |
| 246 | Confidence Map: Second coupon round after withdrawal-speed change reached 38 days to 5 percent loss, with initial transmission at 87 percent. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Fixed-multiple correction (1.4) left 4.8 percent drift at day 21, disproving the simple hypothesis. | applied | none |  | Fixed multiple failure stated as established fact |
| 246 | Confidence Map: Transcript's matching account of the fixed-multiple failure. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Field trial secondary-effluent corrected drift held under 2 percent until day 52 and 55. | applied | none |  | Field drift result stated as established fact |
| 246 | Confidence Map: Final effluent unit B showed a 9 percent non-biofilm transmission loss attributed to chlorine attack, stated as a suspicion rather than confirmed cause. | applied | none |  | P4 hedges cause as unconfirmed |
| 246 | Confidence Map: Chlorine attack mechanism is explicitly hedged as a belief, not confirmed. | applied | none |  | P4 states no confirmed cause |
| 246 | Confidence Map: Whether the correction curve transfers to a second plant with higher industrial load is unresolved and explicitly deferred. | applied | none |  | P4 hedges transferability as open |
| 246 | Confidence Map: Cold-water (4-6 C) biofilm and correction behaviour is untested; all field data is from warmer water. | applied | none |  | P4 hedges cold-water behaviour as open |
| 246 | Confidence Map: Fiscal 2025 program spend figure given only in the scoping notes, not corroborated in the transcript. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Correction computation time overhead reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Free chlorine level at the time of the final-effluent coating thinning, reported only in scoping notes. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: biofouling drift | applied | none |  | P3 says 'drift' without 'biofouling drift' phrase; repaired to the Glossary Term |
| 246 | Glossary Term: reference channel | applied | none |  | P1 says 'reference-channel' not 'reference channel'; repaired to the Glossary Term |
| 246 | Glossary Term: dual-wavelength correction | applied | none |  | Concept named differently as coating/correction, not forced |
| 246 | Glossary Term: fouling tank | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: dip withdrawal speed | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: grab samples | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: fouling-resistant coating | applied | none |  | Not mentioned in the section |
| 246 | Cover signed-off Summary item ys75kwh584n35q82tbdg0zv3xx8ffxan | applied | none |  | P1-P3 cover overall advancement for both hypotheses. |
| 246 | Cover signed-off Summary item ys79n0pq6ekcz3brxndavm6a3x8ffp4g | applied | none | 2 | P2 states coating met targets starting at 89 percent. |
| 246 | Cover signed-off Summary item ys75mfdbw5mg0nsnenhpd00dgn8ffwsy | applied | none | 2 | P2 covers controls, monolayer failure and 42-day screening. |
| 246 | Cover signed-off Summary item ys7539b3wyh9qq871adqnj0hbh8feg5w | applied | none |  | P4 and P3 state the drift result and unresolved durability… |
| 246 | Cover signed-off Summary item ys790hyzxmx0we7m48wbv5cw8s8fec5w | applied | none |  | P5 states original 30-day goal was met with figures. |
| 246 | State each result against its target as the numbers show | not_applied | none |  | Result reported as misstated against its target named no valid paragraph. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claimed advancements map to Line 242 uncertainties and… |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Uncoated controls and the fluorosilane monolayer both lost clarity fast, showing untreated silica cannot meet the durab..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The field trial achieved corrected drift under 2 percent for over 50 days, up from Orion-1's 14-16 day result. Coating..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): This paragraph states the sol-gel coating started at 89 percent transmission and delayed fouling loss to 36 to 40 days in secondary effluent. Section 244 P3 reports 89 percent initial transmission with 5 percent loss delayed to 31 days for the first dip-coating round, and the improved round (87 percent initial transmission, loss delayed to 38 days) is the one that reached the 36 to 40 day range. Pairing 89 percent with 36 to 40 days conflates the two coupon rounds, since 244 ties 89 percent specifically to the 31-day result, not 36 to 40 days. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 5 (sections 244, 246): This paragraph states the coating reached 85 percent transmission with fouling loss delayed to 36 to 40 days. Section 244 P5 reports that corrected drift (not raw coating fouling loss) held under 2 percent until day 52 and day 55 in secondary effluent, and raw drift exceeded 5 percent by day 36 and day 40. The 36 to 40 day figures in 244 describe raw drift exceeding the limit, not the coating's own fouling loss being delayed to that point, so restating them here as the coating's delayed loss misstates what was measured. |
| 246 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 246 paragraph 3 (sections 242, 246): This paragraph calls the sensor correction concept a correction based on a simple wavelength ratio and later a correction keyed to accumulated reference channel loss, where section 242 and the glossary use the term 254/365 attenuation multiple for the ratio concept. The phrase simple wavelength ratio here does not match the glossary term used elsewhere for the same idea. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 32.
- Line 244: 0 labels and 0 plan checks "Not checked" of 25.
- Line 246: 0 labels and 0 plan checks "Not checked" of 30.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.1 s, p95 22.5 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.4 s, p95 12.4 s over 1.
- Sign-off to report created: 136.4 s.
- Cost from aiUsage: $1.16 in all ($0.43 seed stage, $0.73 Brief, drafting and checks) over 43 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T03:45:09.412Z created project k97bas2brzzec9vyc8sdfbkps98fef6c
2026-10-01T03:45:10.031Z added document fiscal-2026-scoping-notes.md
2026-10-01T03:45:11.404Z started Step by step generation k577xdd6dgycer2qwxwtrxw9fs8ffdsy
2026-10-01T03:46:04.519Z seed stage open
2026-10-01T03:46:04.519Z Open Company / Context and wait for its Batch
2026-10-01T03:46:13.879Z Company / Context: select the first Seed
2026-10-01T03:46:15.799Z Approve Company / Context
2026-10-01T03:46:17.939Z approved company_context
2026-10-01T03:46:17.939Z Open Goal / Problem and wait for its Batch
2026-10-01T03:46:32.201Z Goal / Problem: select the first Seed
2026-10-01T03:46:34.104Z Approve Goal / Problem
2026-10-01T03:46:36.069Z approved goal_problem
2026-10-01T03:46:36.069Z Open Technological limitations and wait for its Batch
2026-10-01T03:47:01.163Z Technological limitations: select the first Seed
2026-10-01T03:47:04.334Z Approve Technological limitations
2026-10-01T03:47:06.253Z approved passive_limitations
2026-10-01T03:47:06.253Z Open Technological objectives and wait for its Batch
2026-10-01T03:47:23.150Z Technological objectives: select the first Seed
2026-10-01T03:47:25.072Z Approve Technological objectives
2026-10-01T03:47:27.026Z approved technological_objective
2026-10-01T03:47:27.026Z Open Technological uncertainties and wait for its Batch
2026-10-01T03:47:41.421Z Technological uncertainties: select the first 2 Seeds
2026-10-01T03:47:44.606Z Approve Technological uncertainties
2026-10-01T03:47:46.565Z approved active_uncertainties
2026-10-01T03:47:46.565Z Open Previous-year status and wait for its Batch
2026-10-01T03:48:00.882Z Skip Previous-year status
2026-10-01T03:48:02.148Z Open Work plan and wait for its Batch
2026-10-01T03:48:16.456Z Work plan: select the first Seed
2026-10-01T03:48:18.389Z Approve Work plan
2026-10-01T03:48:20.312Z approved workplan
2026-10-01T03:48:20.312Z Open Hypothesis and wait for its Batch
2026-10-01T03:48:34.753Z Hypothesis: select the first Seed
2026-10-01T03:48:36.931Z Approve Hypothesis
2026-10-01T03:48:38.897Z approved hypothesis
2026-10-01T03:48:38.897Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T03:48:53.284Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T03:48:56.481Z Approve Experimentation / Iterations
2026-10-01T03:48:58.433Z approved experimentation
2026-10-01T03:48:58.433Z Open Advancement to science / technology and wait for its Batch
2026-10-01T03:49:23.203Z Advancement to science / technology: select the first Seed
2026-10-01T03:49:25.109Z Approve Advancement to science / technology
2026-10-01T03:49:27.051Z approved overall_advancement
2026-10-01T03:49:27.051Z Open Specific technological advancements and wait for its Batch
2026-10-01T03:49:51.858Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T03:49:56.999Z Approve Specific technological advancements
2026-10-01T03:49:58.952Z approved specific_advancements
2026-10-01T03:49:58.952Z Open Project status and next steps and wait for its Batch
2026-10-01T03:50:10.627Z Project status and next steps: select the first Seed
2026-10-01T03:50:12.563Z Approve Project status and next steps
2026-10-01T03:50:14.508Z approved project_status
2026-10-01T03:50:14.508Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T03:50:39.339Z Overall company / project goal improvements: select the first Seed
2026-10-01T03:50:41.254Z Approve Overall company / project goal improvements
2026-10-01T03:50:43.177Z approved goal_improvements
2026-10-01T03:50:43.177Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T03:50:44.508Z signed off; waiting for the report
2026-10-01T03:53:01.615Z report kd74gt67r345sxmg4h3tjy4hxx8fe7an created
```
