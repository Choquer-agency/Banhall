# Release eval - Corvane fouling-resistant analyzer

Semantic case: **Skipped role supported by the Brief** (CAP-13: "skipped role supported by the Brief").

Run 2026-10-27 on `local` at commit `afbfd302`, acting as chat-live-1793085355051@example.test. Project `k97eywhva7k76ysxz17cxdntzx8h3jvz`, generation `k577spg7k965mfdb0pxqpehek58h22qw`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd791cttg43wjrxrm6frptcd798h2kww |
| All three Sections were drafted | pass | 242: 323 words, 244: 496 words, 246: 288 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 242: 0 labels and 1 plan check "Not checked" of 22 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | passive_limitations prefetch: INVALID_OUTPUT, answer 1: 1 of 1 valid, needed 3 (INVALID_BATCH_SIZE x0, INSUFFICIENT_TAG_DIVERSITY x0), answer 2: 4 of 4 valid, needed 3 (INVALID_PROVENANCE x1, INSUFFICIENT_FORM_DIVERSITY x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work serves stated uncertainties or items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: Fouling-correction claim and 'Most' coatings detail mismatch.)"); 244: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "The sol-gel with a fluorinated top started at..."); 246: not_applied ("P1 says "In the field, raw drift crossed 5 percent at day 36 and day 40.", but the sources say "On secondary effluent, raw drift, meaning without correction,...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (7.5 s, 9.1 s); 244: 2 requests (8.7 s, 7.5 s); 246: 2 requests (10.0 s, 8.8 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 18 metered calls (18 Batch, 0 Feedback), 18 reserved; notice not shown; 1 Retry |
| The signed-off plan carries the Skip and no selection for the role | pass | skipped: prior_year_status |
| The skipped role was supported: its Batch offered cited Seeds before the Skip | pass | 4 Seed(s) offered, 4 cited; first: "Orion-1 held calibration for only 14 days in secondary effluent before the biofouling drift passed 5 percent." |
| Brief entries that mention "Orion-1" | info | storyline: "Orion-1 held calibration only 14 days before drift passed 5 percent."; claimExclusion: "Fiscal 2025 Orion-1 wiper work falls before the claim period."; confidenceMap: "Orion-1 baseline of 14 days is stated in both sources." |
| The Compliance Note records the Skip as honoured | pass | Omit signed-off role prior_year_status: applied; "Prior year status absent." |
| Heuristic: the prior-year marker "Orion-1" is absent from Section 244 | pass | absent |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs and builds water-quality instruments for municipal treatment plants. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company designs and builds water-quality instruments for municipal treatment plants. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No published coating was UV-clear, food-grade safe, and durable in chlorinated water. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought a window coating that stays UV-clear at 254 nanometres and resists biofilm for 30 days. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unknown whether any window surface could resist biofilm for 30 days while staying optically clear at 254 nanometres. _(cited)_
- We could not find a published coating that was UV-clear, food-grade safe, and durable in chlorinated water. _(writer-asserted)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned coupon screening of four coatings against uncoated controls to test whether any window surface resists biofilm. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If a silica sol-gel has a fluorinated top surface, then raw drift stays under 5 percent for 30 days. _(writer-asserted)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team changed the dip withdrawal speed from 2 millimetres per second to 1 millimetre per second. / The slower withdrawal gave a more even sol-gel layer of about 180 nanometres. _(cited)_
  - Tested: uncertainty "It was unknown whether any window surface could resist biofilm for ..."
- The second coupon round reached 5 percent loss at day 38 with initial transmission of 87 percent. _(cited)_
  - Tested: uncertainty "It was unknown whether any window surface could resist biofilm for ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The sol-gel with a fluorinated top met both coating targets, with 87 percent initial transmission and 5 percent loss at day 38. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- A sol-gel silica with a fluorinated top met both coating targets, though the first round passed just barely. _(cited)_
  - Links: uncertainty "It was unknown whether any window surface could resist biofilm for ..."; experiments "The second coupon round reached 5 percent loss at day 38 with initi..."
- Fouling started at the edges where the coating was thinnest, so layer evenness affects biofilm resistance. / A more even layer of about 180 nanometres followed the slower withdrawal speed. _(cited)_
  - Links: uncertainty "It was unknown whether any window surface could resist biofilm for ..."; experiments "The team changed the dip withdrawal speed from 2 millimetres per se..."

### 12. Project status and next steps (Section 246, standard): approved

- Coating durability in chlorinated water beyond 70 days is unresolved, so the team suspects chlorine attacks the fluorinated layer. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team sought a UV-clear window coating, and a sol-gel with a fluorinated top met both targets. _(cited)_

## Drafted Sections

### Line 242

Water-quality instrument maker Port Aldous is not a valid opener, so the section starts with the open question: it was unknown whether any window surface could resist biofilm for 30 days while staying optically clear at 254 nm, because coatings that resist fouling tend to absorb in the UV. The company designs and builds water-quality instruments for municipal treatment plants. It set out to build an in-line analyzer whose optical window stays accurate for at least 30 days without cleaning. Its optical analyzers measure UV absorbance at 254 nm as a proxy for dissolved organic carbon. A prior prototype with a fused silica window and mechanical wiper held calibration for only 14 days in secondary effluent.

The limitations to standard practice were that the knowledge required to combine UV transparency, biofilm resistance and chemical durability in one window surface was insufficient. No published coating was UV-clear, food-grade safe, and durable in chlorinated water. Most fluoropolymers and hydrogels that resist fouling lose 30 to 60 percent of their transmission at 254 nm. Existing understanding of fouling correction assumed even attenuation across wavelengths. Biofilm contains its own organics that absorb in the UV, so a ratio correction had no established basis.

The technological objective was to advance the understanding of UV-transparent anti-fouling window coatings and of dual-wavelength (254/365 nm) reference channel drift compensation, for the purposes of creating an in-line UV absorbance analyzer. It would hold drift under 5 percent raw, and within 2 percent corrected, for at least 30 days without cleaning.

It was uncertain whether a coating could keep at least 85 percent transmission at 254 nm when new and lose less than 5 percent over 30 days in secondary effluent. Chlorine and grit in the stream added doubt about whether it would survive. It was also uncertain whether fouling attenuation at 365 nm would track that at 254 nm closely enough to correct it, because the biofilm may change as it ages.

### Line 244

The open question was whether any window surface could resist biofilm for 30 days while staying optically clear at 254 nm. The company's planned approach targeted it directly. The team planned coupon screening of four coatings against uncoated controls to test whether any window surface resists biofilm. The work ran from August to October 2025 in a secondary effluent side stream. Transmission at 254 nm was measured every 3 days. Fused silica coupons carried a fluorosilane monolayer, a silica sol-gel with a fluorinated top, a zwitterionic polymer brush or a thin titania film, with 12 coupons per candidate and 12 uncoated controls.

If a silica sol-gel has a fluorinated top surface, then raw drift stays under 5 percent for 30 days. The hypothesis fails if the coated window passes 5 percent loss in transmission before day 30 in secondary effluent, or if initial transmission at 254 nm falls below the 85 percent target.

The first uncertainty was which coating could combine UV clarity with biofilm resistance. The 42-day screening gave uncoated controls 5 percent loss by day 11 and 22 percent by day 42. The zwitterionic brush resisted biofilm best but transmitted only 71 percent initially. Titania grew film faster than the controls; the suspected cause, untested, is that in-stream UV is too low to activate it and that its rough surface aids attachment. The fluorosilane monolayer started at 92 percent and reached 5 percent loss by day 17. The sol-gel with fluorinated top started at 89 percent and took 31 days to lose 5 percent. Only the sol-gel met both targets, though the margin was narrow.

The next uncertainty was why fouling on the sol-gel coupons began at the edges, where the coating was thinnest, and whether layer evenness limited biofilm resistance. The team changed the dip withdrawal speed from 2 millimetres per second to 1 millimetre per second. The slower withdrawal gave a more even sol-gel layer of about 180 nanometres. The second coupon round reached 5 percent loss at day 38 with initial transmission of 87 percent. Initial transmission fell slightly from 89 percent but stayed above the 85 percent target. A more even layer therefore extended fouling resistance by 7 days while the clarity target was still met.

The remaining uncertainty was whether the coating would perform in plant conditions. Four complete Orion-2 units with coated windows ran at the Harbourside plant from February 9 to June 12 2026, two on secondary effluent and two on chlorinated final effluent. Grab samples taken twice a week and analyzed on a lab spectrophotometer served as the reference. On secondary effluent, raw drift crossed 5 percent at day 36 and day 40. On final effluent, drift was lower, but one unit lost 9 percent of its transmission between day 70 and day 90, a loss not attributed to biofilm. The team suspects chlorine is slowly attacking the fluorinated layer, but this was not confirmed. Coating durability in chlorinated water beyond about 70 days remains unresolved.

### Line 246

Whether a window surface could resist biofilm for 30 days and stay optically clear at 254 nm was the open question, and the coating side of the objective was met in part. A sol-gel with a fluorinated top met both coating targets, with 87 percent initial transmission and 5 percent loss at day 38 in the second coupon round. In the field, raw drift crossed 5 percent at day 36 and day 40. Durability in chlorinated water was not established, and the dual-wavelength correction lies outside this coating-focused advancement.

Through this investigation, it was determined that a sol-gel with a fluorinated top can combine UV clarity with biofilm resistance, though the first round met both targets just barely. This resolved the uncertainty regarding whether any window surface could resist biofilm for 30 days while staying optically clear at 254 nm. Fouling started at the edges where the coating was thinnest, so layer evenness affects biofilm resistance. Based on this understanding, the team slowed the dip withdrawal from 2 to 1 millimetre per second. The slower withdrawal gave a more even layer of about 180 nanometres.

Coating durability in chlorinated water beyond 70 days is unresolved. One final effluent unit lost 9 percent of its transmission between day 70 and day 90, a loss not attributed to biofilm. The team suspects chlorine attacks the fluorinated layer, but this was not confirmed. Fiscal 2027 work will address this open question.

The team sought a UV-clear window coating that resists biofilm, and a sol-gel with a fluorinated top met both targets. The earlier fused silica window with a mechanical wiper held calibration for only 14 days in secondary effluent, so the coating moves the analyzer toward the 30-day goal without cleaning.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 323/350 words, 32/50 lines |
| 242 | Claim Exclusion: Business impact and customer expectations about service interval are commercial, not technological. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Fiscal 2025 Orion-1 wiper work falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Coating cost estimate is a commercial matter. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Folding results into the next product revision is product development, not research. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: reference channel | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: dual-wavelength | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Orion-1 baseline of 14 days is stated in both sources. | applied | none |  | 14 days stated as established. |
| 242 | Confidence Map: Sol-gel second round reached 38 days to 5 percent loss. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fitted correction held-out and repeat results. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Chlorine attack on the fluorinated layer is suspected, not confirmed. | applied | none |  | P4 frames chlorine as doubt, not fact. |
| 242 | Confidence Map: Titania failure cause is a belief only. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Titania day of 5 percent loss is given only in notes; the interview says only that it fouled faster. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Winter behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Site specificity of the correction curve is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Technician time is reported as almost full time in the interview and about 90 percent in the notes; compatible, not a conflict. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: sol-gel | applied | none |  | Concept absent. |
| 242 | Glossary Term: fouling tank | applied | none |  | Concept absent. |
| 242 | Glossary Term: corrected drift | not_applied | none |  | P3 says 'within 2 percent corrected'.; found on the final text |
| 242 | Glossary Term: grab samples | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57w2xp7h5h5v1q4f533z1k7z18h3kca | applied | none |  | Company description stated in P1. |
| 242 | Cover signed-off Summary item h57y1127pdyx1fz1tg429w5pw58h232f | applied | none |  | P1 states the company and goal. |
| 242 | Cover signed-off Summary item h57q5d7naeggf55x3kxmeagynn8h3x6v | applied | none |  | P2 states no published coating. |
| 242 | Cover signed-off Summary item h57rvmhaxkheab2s3ve8rmkne18h3e1w | applied | none |  | P3 states coating and drift objective. |
| 242 | Cover signed-off Summary item h57xcf5ngt4gd8r6va8h410nh18h3qd1 | applied | none | 2 | P1 states the unknown. |
| 242 | Cover signed-off Summary item h57gtkptsssez6f7g9srws1nan8h33ty | applied | none | 2 | P2 covers no published coating. |
| 242 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: Fouling-correction claim and 'Most' coatings detail mismatch.) |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought a window coating that stays UV-clear at 254 nanometres and resists biofilm for 30 days." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was unknown whether any window surface could resist biofilm for 30 days while staying optically clear at 254 nanomet..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242): The opening contains drafting text ('Port Aldous is not a valid opener, so the section starts with...') that is not a project statement. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 3 (sections 242, 244, 246): Line 242 uses 'drift ... within 2 percent corrected' and 'reference channel drift compensation' while Line 244 and 246 say only 'raw drift'; the glossary term 'corrected drift' is not used consistently and the dual-wavelength correction is dropped from later sections. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 496/700 words, 45/100 lines |
| 244 | Claim Exclusion: Business impact and customer expectations about service interval are commercial, not technological. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Fiscal 2025 Orion-1 wiper work falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Coating cost estimate is a commercial matter. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Folding results into the next product revision is product development, not research. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: grab samples | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with Storyline. |
| 244 | Confidence Map: Orion-1 baseline of 14 days is stated in both sources. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Sol-gel second round reached 38 days to 5 percent loss. | applied | none |  | 38 days stated as established. |
| 244 | Confidence Map: Fitted correction held-out and repeat results. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Chlorine attack on the fluorinated layer is suspected, not confirmed. | applied | none |  | P5 hedges chlorine attack as suspected. |
| 244 | Confidence Map: Titania failure cause is a belief only. | applied | none |  | P3 says suspected cause, untested. |
| 244 | Confidence Map: Titania day of 5 percent loss is given only in notes; the interview says only that it fouled faster. | applied | none |  | No titania day figure stated. |
| 244 | Confidence Map: Winter behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Site specificity of the correction curve is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Technician time is reported as almost full time in the interview and about 90 percent in the notes; compatible, not a conflict. | applied | none |  | Not mentioned in the section. |
| 244 | Glossary Term: reference channel | applied | none |  | Concept absent. |
| 244 | Glossary Term: dual-wavelength | applied | none |  | Concept absent. |
| 244 | Glossary Term: fouling tank | applied | none |  | Fouling tank not described. |
| 244 | Glossary Term: corrected drift | applied | none |  | Concept absent. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior year status absent. |
| 244 | Cover signed-off Summary item h57t1b26zf3x8phgj8km8gjcs58h2g7d | applied | none |  | Coupon screening plan covered. |
| 244 | Cover signed-off Summary item h57g338vf92ap6qrsff0h4p0ks8h3zs6 | applied | none |  | Hypothesis stated. |
| 244 | Cover signed-off Summary item h57tvzxff9amhejgqzcfdz34td8h2xpt | applied | none |  | Withdrawal change and 180 nm covered. |
| 244 | Cover signed-off Summary item h57mj0m8te7jnaazvgm00h7kqs8h36he | applied | none |  | Day 38 and 87 percent stated. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "The sol-gel with a fluorinated top started at 89 percent and reached 5 percent loss at day 31.", but the sources say "The sol-gel with fluorinated top started at 89 percent and took 31 days to lose 5 percent.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work serves stated uncertainties or items. |
| 244 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 244 paragraph 1 (sections 242, 244): Line 244 describes a 'secondary effluent side stream' and coupon screening while the glossary term 'fouling tank' is not used; also 'grab samples' is used correctly. Minor, but the test setup naming differs from the glossary. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 288/350 words, 28/50 lines |
| 246 | Claim Exclusion: Business impact and customer expectations about service interval are commercial, not technological. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Fiscal 2025 Orion-1 wiper work falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Coating cost estimate is a commercial matter. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Folding results into the next product revision is product development, not research. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: biofilm | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: dual-wavelength | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: sol-gel | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with Storyline. |
| 246 | Confidence Map: Orion-1 baseline of 14 days is stated in both sources. | applied | none |  | 14 days stated correctly. |
| 246 | Confidence Map: Sol-gel second round reached 38 days to 5 percent loss. | applied | none |  | 38 days stated correctly. |
| 246 | Confidence Map: Fitted correction held-out and repeat results. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Chlorine attack on the fluorinated layer is suspected, not confirmed. | applied | none |  | P3 hedges the chlorine cause. |
| 246 | Confidence Map: Titania failure cause is a belief only. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Titania day of 5 percent loss is given only in notes; the interview says only that it fouled faster. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Winter behaviour is unknown. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Site specificity of the correction curve is unknown. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Technician time is reported as almost full time in the interview and about 90 percent in the notes; compatible, not a conflict. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: reference channel | applied | none |  | Concept absent. |
| 246 | Glossary Term: fouling tank | applied | none |  | Concept absent. |
| 246 | Glossary Term: corrected drift | applied | none |  | Concept absent. |
| 246 | Glossary Term: grab samples | applied | none |  | Concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57se2dv8nf26c13x7ffcem2gs8h3b94 | applied | none |  | P1 states 87 percent and day 38. |
| 246 | Cover signed-off Summary item h57vp1d51whhvyx0nnjsppfv2n8h37ty | applied | none | 2 | P2 states just barely. |
| 246 | Cover signed-off Summary item h57jp9q9tfj94445dfdk85newh8h2x4n | applied | none | 2 | P2 gives edge fouling and 180 nm layer. |
| 246 | Cover signed-off Summary item h57r1gsdc9rg0ge4z1prdtmxhh8h305m | applied | none |  | P3 states unresolved and suspected. |
| 246 | Cover signed-off Summary item h57r2yksgb13rt8dw6j2pgjvpd8h394j | applied | none |  | P4 states the goal and result. |
| 246 | State figures and details as the sources give them | not_applied | none |  | P1 says "In the field, raw drift crossed 5 percent at day 36 and day 40.", but the sources say "On secondary effluent, raw drift, meaning without correction, crossed 5 percent at day 36 and day 40 on the two units.". |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Claims answer the coating uncertainty. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Fouling started at the edges where the coating was thinnest, so layer evenness affects biofilm resistance. A more even..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team sought a UV-clear window coating, and a sol-gel with a fluorinated top met both targets." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 says the first round met both targets just barely, and that the slower withdrawal gave day 38 and 87 percent. Line 244 P3 says the sol-gel reached 5 percent loss at day 31 with 89 percent initial in the first round, so 'just barely' is consistent, but P1 of 246 attributes the day 38 and 87 percent result to the second round while P2 presents the first round as already meeting both targets and resolving the uncertainty; the resolution claim ignores that field raw drift crossed 5 percent at day 36 and 40, so 30 days was not shown in plant conditions. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): Line 246 says the coating moves the analyzer toward the 30-day goal without cleaning and that both targets were met, but Line 244 P5 shows unresolved chlorinated-water durability, so the claim of meeting coating targets is overstated relative to field results. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 5 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 1 plan check "Not checked" of 22.
- Line 244: 0 labels and 0 plan checks "Not checked" of 23.
- Line 246: 0 labels and 0 plan checks "Not checked" of 23.

## Seed-stage numbers

- Requests: 18 metered (18 Batch, 0 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.3 s, p95 14.3 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 9.2 s, p95 9.2 s over 1.
- Sign-off to report created: 94.3 s.
- Cost from aiUsage: $1.30 in all ($0.51 seed stage, $0.79 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T19:08:36.185Z created project k97eywhva7k76ysxz17cxdntzx8h3jvz
2026-10-27T19:08:37.042Z marked as an evaluation project
2026-10-27T19:08:37.909Z added document fiscal-2026-scoping-notes.md
2026-10-27T19:08:39.697Z started Step by step generation k577spg7k965mfdb0pxqpehek58h22qw
2026-10-27T19:08:55.305Z seed stage open
2026-10-27T19:08:55.306Z Open Company / Context and wait for its Batch
2026-10-27T19:09:04.295Z Company / Context: select the first Seed
2026-10-27T19:09:07.622Z Approve Company / Context
2026-10-27T19:09:10.397Z approved company_context
2026-10-27T19:09:10.397Z Open Goal / Problem and wait for its Batch
2026-10-27T19:09:19.315Z Goal / Problem: select the first Seed
2026-10-27T19:09:21.917Z Approve Goal / Problem
2026-10-27T19:09:24.885Z approved goal_problem
2026-10-27T19:09:24.885Z Open Technological limitations and wait for its Batch
2026-10-27T19:09:31.356Z passive_limitations: attempt failed, Retry 1
2026-10-27T19:09:40.956Z Technological limitations: select the first Seed
2026-10-27T19:09:43.683Z Approve Technological limitations
2026-10-27T19:09:46.394Z approved passive_limitations
2026-10-27T19:09:46.394Z Open Technological objectives and wait for its Batch
2026-10-27T19:09:55.685Z Technological objectives: select the first Seed
2026-10-27T19:09:58.686Z Approve Technological objectives
2026-10-27T19:10:01.519Z approved technological_objective
2026-10-27T19:10:01.519Z Open Technological uncertainties and wait for its Batch
2026-10-27T19:10:10.215Z Technological uncertainties: select the first 2 Seeds
2026-10-27T19:10:15.016Z Approve Technological uncertainties
2026-10-27T19:10:17.836Z approved active_uncertainties
2026-10-27T19:10:17.836Z Open Previous-year status and wait for its Batch
2026-10-27T19:10:27.302Z Skip Previous-year status
2026-10-27T19:10:29.110Z Open Work plan and wait for its Batch
2026-10-27T19:10:41.012Z Work plan: select the first Seed
2026-10-27T19:10:43.819Z Approve Work plan
2026-10-27T19:10:46.786Z approved workplan
2026-10-27T19:10:46.787Z Open Hypothesis and wait for its Batch
2026-10-27T19:10:58.836Z Hypothesis: select the first Seed
2026-10-27T19:11:01.593Z Approve Hypothesis
2026-10-27T19:11:04.313Z approved hypothesis
2026-10-27T19:11:04.313Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T19:11:23.651Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T19:11:28.167Z Approve Experimentation / Iterations
2026-10-27T19:11:31.844Z approved experimentation
2026-10-27T19:11:31.844Z Open Advancement to science / technology and wait for its Batch
2026-10-27T19:11:46.751Z Advancement to science / technology: select the first Seed
2026-10-27T19:11:49.540Z Approve Advancement to science / technology
2026-10-27T19:11:52.619Z approved overall_advancement
2026-10-27T19:11:52.619Z Open Specific technological advancements and wait for its Batch
2026-10-27T19:12:01.153Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T19:12:08.999Z Approve Specific technological advancements
2026-10-27T19:12:12.294Z approved specific_advancements
2026-10-27T19:12:12.295Z Open Project status and next steps and wait for its Batch
2026-10-27T19:12:20.373Z Project status and next steps: select the first Seed
2026-10-27T19:12:23.032Z Approve Project status and next steps
2026-10-27T19:12:25.682Z approved project_status
2026-10-27T19:12:25.682Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T19:12:33.863Z Overall company / project goal improvements: select the first Seed
2026-10-27T19:12:36.544Z Approve Overall company / project goal improvements
2026-10-27T19:12:39.214Z approved goal_improvements
2026-10-27T19:12:39.214Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T19:12:41.100Z signed off; waiting for the report
2026-10-27T19:14:18.001Z report kd791cttg43wjrxrm6frptcd798h2kww created
```
