# Release eval - Marrowgate cold-water biofilter control

Semantic case: **Changed advancement links** (CAP-13: "changed advancement links"). Also checks: two advancements sharing an uncertainty are merged and the Compliance Note names the merge.

Run 2026-09-28 on `local` at commit `c8ce1fe2`, acting as e2e-audit@banhall.local. Project `k974xbpe7krmp9zgz9dv7vrts58f8qv0`, generation `k576kpxvcvhjygw48vkpj7q82x8f875e`.

## What this fixture tests

The writer selects three uncertainties and several experiments, approves Specific technological advancements, then unticks the uncertainty most advancements link to. Approving the old advancements must be refused as unlinked; the writer regenerates, drops the unlinked items and selects advancements linked to the remaining uncertainties. When two signed-off advancements share one uncertainty they must be drafted as one advancement with facets, and the Compliance Note must name the merge.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 246 does not claim an advancement for the uncertainty the writer dropped.
   - Answer: 
2. The advancements that share one uncertainty are drafted as one advancement with facets, not as two separate claims.
   - Answer: 
3. Each drafted advancement matches an uncertainty in Section 242 and an experiment in Section 244.
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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7eb57hmn8zjbp8wdafwh4d2h8f95n2 |
| All three Sections were drafted | pass | 242: 312 words, 244: 673 words, 246: 350 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 16 of 16 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 18 metered calls (18 Batch, 0 Feedback), 19 reserved; notice not shown; 0 Retry |
| After the uncertainty changed, approving the old advancements was refused as unlinked | pass | INVALID_STATE / UNLINKED_ADVANCEMENT |
| Every signed-off advancement links to exactly one active uncertainty and at least one active experiment | pass | 2 advancement(s); 0 with a link outside the plan |
| The dropped uncertainty is out of the plan and no advancement links to it | pass | dropped yn772y55582zdcb254d08assxh8f9s7v |
| Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge | pass | merged 2 items in Section 246 |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- Marrowgate designs recirculating aquaculture systems for land-based trout farms in Atlantic Canada. / The company identified three separate biofilter-related technological uncertainties to address. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- Marrowgate sought to improve the biofilter that removes toxic ammonia from RAS tank water through nitrification. / The objective spanned shortening cold-water start-up, controlling feeding-surge ammonia spikes, and keeping sensors accurate. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard cold-water start-up practice used ammonium chloride dosing or warm seed media that went into cold shock. / Published work and prior experience showed warm seed media survives but barely grows once placed in eight degree water. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- Marrowgate sought new knowledge on shortening cold-water nitrification start-up below 10 C. / That knowledge was intended to enable a repeatable seeding method for new biofilters. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- Whether feed-forward alkalinity dosing could hold TAN under 1 mg/L through feeding surges was unresolved before testing. / It was unclear if proportional dosing ahead of feeding would outperform reactive pH setpoint dosing at all. _(cited)_
- The team did not know whether optical DO sensors and ammonium electrodes could stay accurate enough for control once fouled by biofilm. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- Marrowgate planned to test each of the three uncertainties separately in dedicated pilot loops. / Separate trials let the team isolate which change fixed which mechanism, since each failed on a different timescale. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If alkalinity is dosed ahead of feeding in proportion to feed mass, then TAN stays under 1 mg/L through the ammonia pulse. / This feed-forward approach differs from reactive pH setpoint dosing used as the prior standard. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial one ran three loops at eight degrees to test whether seed acclimation would shorten nitrification start-up. / Loop A, the unseeded control, took 66 days while unacclimated seed loop B took 47 days and acclimated loop C took 31 days. _(cited, carried from an older context)_
- The nitrite stage stalled the unacclimated loop far longer than the acclimated loop, pointing to a specific bottleneck. / Nitrite oxidizing bacteria appeared more sensitive to cold shock than ammonia oxidizers, explaining the stall difference. _(cited, carried from an older context)_
- A second trial at six degrees compared five percent and fifteen percent acclimated seed fractions to refine the seeding rate. / Higher seed fraction was needed at six degrees to stay under five weeks, with returns flattening above ten to fifteen percent. _(cited, carried from an older context)_

### 10. Advancement to science / technology (Section 246, standard): approved

- Stepwise acclimation of seed media achieved the U1 hypothesis, reaching full nitrification in under 5 weeks at 8 degrees. / Acclimated seed at 31 days beat the 66 day unseeded control and 47 day unacclimated seed loop. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Stepwise cold acclimation of seed media cut cold-water start-up roughly in half versus unacclimated seed at 8 C. / Nitrite oxidizing bacteria were shown to be the main cold-sensitivity bottleneck limiting start-up speed. _(cited)_
  - Links: uncertainty "The team did not know whether optical DO sensors and ammonium elect..."; experiments "Trial one ran three loops at eight degrees to test whether seed acc...", "The nitrite stage stalled the unacclimated loop far longer than the..."
- The team learned that colder water requires a higher seed fraction to reach full nitrification within five weeks. _(cited)_
  - Links: uncertainty "The team did not know whether optical DO sensors and ammonium elect..."; experiments "A second trial at six degrees compared five percent and fifteen per..."

### 12. Project status and next steps (Section 246, standard): approved

- The start-up method was applied at a client farm, reaching full nitrification in 34 days at 7 to 8 degrees. / That result was close to the 31 day pilot outcome achieved with acclimated seed. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The knowledge gained connects directly to the original goal of shortening cold-water start-up for new biofilters. / Stepwise acclimation gave Marrowgate a repeatable seeding method usable across future cold-water farm designs. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

Marrowgate designs recirculating aquaculture systems (RAS) for land-based trout farms in Atlantic Canada, including tanks, water treatment trains, biofilters, oxygen systems and controls for water between 6 and 12 degrees C. This gave the engineering groups direct exposure to biofilter failures under cold-water conditions that generic industry data does not capture. In fiscal 2026 the groups identified three separate biofilter-related technological uncertainties, split apart because each fails on a different mechanism and timescale.

Marrowgate sought to improve the biofilter that removes toxic ammonia from RAS tank water through nitrification. The objective spanned shortening cold-water start-up of new biofilters, controlling ammonia (TAN) spikes from feeding surges, and keeping dissolved oxygen (DO) and ammonium sensors accurate enough for real-time control.

Standard cold-water start-up relied on ammonium chloride dosing or seeding with mature media from warm systems. Published work and prior experience showed such seed media survives but barely grows once placed in 8 degree C water, with no documented method for speeding nitrifier colonization at low temperature. Standard alkalinity dosing reacted to pH drops rather than pre-empting them, and the usual fix for feeding-driven ammonia pulses was oversizing the biofilter by 30 to 50 percent, with no established basis for tuning media fill ratio instead. Vendor-recommended weekly sensor cleaning was known to be inadequate in biofilm-heavy water, with no alternative shown accurate enough for control.

Marrowgate sought new knowledge of cold-water nitrification start-up below 10 C, meant to enable a repeatable seeding method for new biofilters, along with knowledge of feed-forward dosing, media fill ratio, and sensor fouling behaviour.

Whether feed-forward alkalinity dosing could hold TAN under 1 mg/L through feeding surges was unresolved before testing: it was unclear if proportional dosing ahead of feeding would outperform reactive pH-setpoint dosing at all. It was also unknown whether optical DO sensors and ammonium ion-selective electrodes could stay accurate enough for control once fouled by biofilm.

### Line 244

The technological problem addressed in fiscal 2026 was that no established method existed to accelerate nitrifying biofilm colonization at low temperature, to pre-empt feeding-driven total ammonia nitrogen (TAN) spikes without oversizing the biofilter in the recirculating aquaculture system (RAS), or to keep dissolved oxygen (DO) and ammonium sensors accurate in biofilm-heavy water. Marrowgate planned to test each of the three uncertainties separately in dedicated pilot loops. Separate trials let the team isolate which change fixed which mechanism, since each failed on a different timescale. For cold-water start-up, the plan compared unseeded, unacclimated-seed, and acclimated-seed conditions across pilot loops at 8 C and 6 C. For feeding spikes, the plan tested feed-forward alkalinity dosing against reactive pH-setpoint dosing, then varied media fill ratio under feed-forward dosing. For sensor reliability, the plan compared direct in-tank sensors against a bypass sampling loop with automated cleaning and calibration.

It was hypothesized that if alkalinity is dosed ahead of feeding in proportion to feed mass, then TAN stays under 1 mg/L through the ammonia pulse. This feed-forward approach differs from reactive pH-setpoint dosing, the prior standard, which only responds once pH has already fallen.

Trial one ran three loops at 8 C in the RAS to test whether stepwise temperature acclimation of seed media would shorten cold-water nitrification start-up. Loop A, the unseeded control, took 66 days; unacclimated seed loop B took 47 days; acclimated loop C took 31 days. Loop B stalled at the nitrite stage for 19 days, compared to roughly 6 days for loop C, a difference far larger than expected from seeding alone. This stall gap pointed to a specific bottleneck: nitrite oxidizing bacteria appeared more sensitive to cold shock than ammonia oxidizers. The team concluded that acclimation, not seeding alone, drove the improvement, since both seeded loops used the same seed fraction.

A second trial addressed how seed fraction should change at colder temperatures. Acclimated seed was tested at 5 percent and 15 percent fractions in loops held at 6 C. The 5 percent loop took 44 days, missing the under-5-week target, while the 15 percent loop took 29 days. This showed that the seed fraction validated at 8 C was insufficient at 6 C, and the team concluded that colder water requires a higher seed fraction, with returns flattening above roughly 10 to 15 percent.

A third trial addressed whether feed-forward alkalinity dosing could hold TAN under 1 mg/L through feeding surges. A baseline under reactive pH-setpoint dosing produced a peak TAN of 2.3 mg/L three hours after feeding, with alkalinity falling and pH dipping below 7. Switching to feed-forward dosing (0.25 kg sodium bicarbonate per kg feed, 45 minutes before each meal) cut peak TAN to 1.2 mg/L and held alkalinity higher, but this alone missed the 1 mg/L target. The team concluded a second mechanism was needed to close the remaining gap.

A fourth trial addressed whether media fill ratio could supply that second mechanism. With feed-forward dosing applied on all loops, fill ratios of 40, 55 and 65 percent were tested side by side. The 55 percent loop lowered and flattened the peak to 0.8 mg/L, while 65 percent caused media clumping and low-oxygen dead zones that worsened performance. This showed fill ratio acts as a buffering mechanism independent of dosing, and the team concluded that 55 percent fill combined with feed-forward dosing held TAN under target without enlarging the biofilter.

A fifth trial addressed whether sensors could stay accurate enough for control in biofilm-heavy water. Direct in-tank sensors, cleaned weekly by hand, were compared against a bypass sampling loop with a screen, automated air-blast cleaning, and weekly automatic two-point calibration checks. Direct sensors drifted 8 percent low on DO by day 10 and 0.4 mg/L per week on the ammonium ion-selective electrode, while the bypass loop held DO within 3 percent for 28 days and ammonium drift near 0.1 mg/L per week, later refined to within 0.12 mg/L over 4 weeks with calibration checks. The team concluded the bypass configuration, not sensor hardware alone, resolved the accuracy problem.

### Line 246

Marrowgate set out to advance knowledge of cold-water start-up, feed-forward alkalinity dosing, media fill ratio, and sensor accuracy in biofilm-heavy recirculating aquaculture systems (RAS). The U1 hypothesis, that stepwise temperature acclimation of seed media would reach full nitrification in under five weeks at 8 C, was proven: the acclimated loop reached full nitrification in 31 days, against 66 days unseeded and 47 days with unacclimated seed. The U2 hypothesis, that feed-forward alkalinity dosing alone would hold total ammonia nitrogen (TAN) under 1 mg/L through feeding surges, was disproven on its own but proven once combined with a revised media fill ratio.

Stepwise acclimation resolved the cold-water start-up uncertainty below 10 C, cutting start-up time roughly in half versus unacclimated seed at 8 C. Nitrite oxidizing bacteria, not ammonia oxidizers, were shown to be the main cold-sensitivity bottleneck. This gave a repeatable acclimation protocol for cold-water biofilters. The seed fraction needed to stay under five weeks was found to rise as temperature drops, from roughly 10 percent at 8 C to roughly 15 percent at 6 C, with gains flattening above that range.

Dosing alkalinity ahead of feeding, sized to feed mass, cut peak TAN but did not by itself resolve the feeding-surge uncertainty. Combined with a 55 percent media fill ratio, an independent buffering mechanism against ammonia spikes, TAN stayed near or under the 1 mg/L target, resolving the uncertainty through two mechanisms rather than one.

A screened bypass sampling loop with automated cleaning and periodic calibration resolved the sensor accuracy uncertainty in biofilm-heavy water, holding dissolved oxygen (DO) and ammonium ion-selective electrode readings within tolerance for at least four weeks.

The start-up method was applied at one client farm, reaching full nitrification in 34 days at 7 to 8 C, close to the 31 day pilot result. Fish-size dependency of the dosing rule and electrode membrane longevity beyond three months remain unresolved and are planned for next fiscal year. This connects to the original goal of shortening cold-water start-up: stepwise acclimation gave Marrowgate a repeatable seeding method for future cold-water farm designs, while stabilizing ammonia without oversizing the biofilter.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 312/350 words, 36/50 lines |
| 242 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue benefit to clients, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Savings from not oversizing the biofilter are a cost/business benefit, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Adoption of the 55 percent fill ratio and feed-forward dosing into the standard design package is a business/commercial rollout decision, not experimental work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Cleaning sensors weekly by hand per vendor instructions is routine maintenance, not experimental development. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Dosing sodium bicarbonate reactively on a pH setpoint is the pre-existing standard method, not part of the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Planned future work testing the dosing rule across fish sizes and a TAN feedback trim falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: dissolved oxygen (do) | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: ammonium ion-selective electrodes | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: cold-water start-up | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Storyline | applied | none |  | Section matches storyline scope for U1-U3 uncertainties. |
| 242 | Confidence Map: Trial 1 (U1) days to full nitrification for loops A, B, C at 8 C matches between transcript and document. | applied | none |  | Not mentioned; section stays at uncertainty stage, no trial… |
| 242 | Confidence Map: Nitrite stall duration for unacclimated seed (loop B) reported as 19 days in the document, described as 'almost three weeks' in the transcript; consistent but stated with different precision. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Transcript states the nitrite stall for the unacclimated loop was almost three weeks, a less precise figure than the document's 19 days but not conflicting. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 2 (U1) results at 6 C for 5 percent and 15 percent acclimated seed match across sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 3 (U2) baseline pH-setpoint dosing results (peak TAN, alkalinity drop, pH dip) are consistent between sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Feed-forward dosing effect on peak TAN and alkalinity in Trial 3 is consistent between sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Bicarbonate consumption increase under feed-forward dosing is reported only in the document, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 4 (U2) fill ratio results (40/55/65 percent, TAN peaks) match between sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Dead zone dissolved oxygen levels at 65 percent fill are quantified only in the document. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 5 (U3) direct sensor drift figures (DO 8 percent low by day 10, ammonium drift 0.4 mg/L per week) are consistent between sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 5 (U3) bypass loop performance (DO within 3 percent for 28 days, ammonium drift about 0.1 mg/L per week) is consistent between sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Weekly automatic two-point calibration check performance (ammonium error within 0.12 mg/L over 4 weeks) matches across sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Client farm application of the start-up method and its result (34 days at 7-8 C) is reported consistently, though only from a single farm instance. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for smaller fish remains an open, unresolved question. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether ammonium membrane life can be extended beyond 3 months is explicitly unresolved. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Section says 'recirculating aquaculture systems' but not…; repaired to the Glossary Term |
| 242 | Glossary Term: dissolved oxygen (do) | applied | none |  | Says 'dissolved oxygen' but not the abbreviation 'DO'.; repaired to the Glossary Term |
| 242 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | 'ammonia (TAN)' appears verbatim in P2. |
| 242 | Glossary Term: ammonium ion-selective electrodes | applied | none |  | Section says 'ammonium electrodes', not 'ammonium…; repaired to the Glossary Term |
| 242 | Glossary Term: stepwise temperature acclimation | applied | none |  | Concept of stepwise acclimation absent from this section. |
| 242 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Nitrite-oxidizing bacteria concept absent from this section. |
| 242 | Glossary Term: bypass sampling loop | applied | none |  | Bypass sampling loop concept absent from this section. |
| 242 | Cover signed-off Summary item ys74e392sxg2c5c9bgn86wagzs8f9efc | applied | none |  | P1 covers company context and three uncertainties. |
| 242 | Cover signed-off Summary item ys79ybbqmvjak11h5sczysqbjh8f87n4 | applied | none |  | P2 states goal and three-part objective scope. |
| 242 | Cover signed-off Summary item ys70ckqpey745xzm9e77h432918f93vh | applied | none |  | P3 covers standard practice and cold shock limitation. |
| 242 | Cover signed-off Summary item ys73hwzx6b2fftfn9gvjtwgxpd8f8vb5 | applied | none |  | P4 states the objective and enabling seeding method. |
| 242 | Cover signed-off Summary item ys730n46xf83aw6gbxaarzb5ed8f8xmy | applied | none | 2 | P5 states the dosing uncertainty as unresolved. |
| 242 | Cover signed-off Summary item ys7248sy6ymm97veg3fwpk425d8f8qsp | applied | none | 2 | P5 states sensor accuracy uncertainty was unknown. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Marrowgate sought to improve the biofilter that removes toxic ammonia from RAS tank water through nitrification. The ob..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 673/700 words, 67/100 lines |
| 244 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue benefit to clients, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Savings from not oversizing the biofilter are a cost/business benefit, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Adoption of the 55 percent fill ratio and feed-forward dosing into the standard design package is a business/commercial rollout decision, not experimental work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Cleaning sensors weekly by hand per vendor instructions is routine maintenance, not experimental development. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Dosing sodium bicarbonate reactively on a pH setpoint is the pre-existing standard method, not part of the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Planned future work testing the dosing rule across fish sizes and a TAN feedback trim falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: dissolved oxygen (do) | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: cold-water start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: bypass sampling loop | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Storyline | not_applied | none |  | P3 stall duration figures differ from storyline; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Trial 1 (U1) days to full nitrification for loops A, B, C at 8 C matches between transcript and document. | applied | none |  | P3 loop A/B/C day counts match established fact |
| 244 | Confidence Map: Nitrite stall duration for unacclimated seed (loop B) reported as 19 days in the document, described as 'almost three weeks' in the transcript; consistent but stated with different precision. | not_applied | missing_fact |  | P3 omits the 19-day stall figure entirely; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Transcript states the nitrite stall for the unacclimated loop was almost three weeks, a less precise figure than the document's 19 days but not conflicting. | applied | none |  | Section only gives qualitative stall comparison, no conflict |
| 244 | Confidence Map: Trial 2 (U1) results at 6 C for 5 percent and 15 percent acclimated seed match across sources. | applied | none |  | P4 seed fraction results match established figures |
| 244 | Confidence Map: Trial 3 (U2) baseline pH-setpoint dosing results (peak TAN, alkalinity drop, pH dip) are consistent between sources. | applied | none |  | P5 baseline dosing figures match established data |
| 244 | Confidence Map: Feed-forward dosing effect on peak TAN and alkalinity in Trial 3 is consistent between sources. | applied | none |  | P5 feed-forward peak TAN figure matches established data |
| 244 | Confidence Map: Bicarbonate consumption increase under feed-forward dosing is reported only in the document, not mentioned in the transcript. | applied | none |  | Bicarbonate consumption increase not mentioned in section |
| 244 | Confidence Map: Trial 4 (U2) fill ratio results (40/55/65 percent, TAN peaks) match between sources. | applied | none |  | P6 fill ratio TAN peaks match established data |
| 244 | Confidence Map: Dead zone dissolved oxygen levels at 65 percent fill are quantified only in the document. | applied | none |  | P6 hedges dead zone as qualitative, no DO figure stated |
| 244 | Confidence Map: Trial 5 (U3) direct sensor drift figures (DO 8 percent low by day 10, ammonium drift 0.4 mg/L per week) are consistent between sources. | applied | none |  | P7 direct sensor drift figures match established data |
| 244 | Confidence Map: Trial 5 (U3) bypass loop performance (DO within 3 percent for 28 days, ammonium drift about 0.1 mg/L per week) is consistent between sources. | applied | none |  | P7 bypass loop performance figures match established data |
| 244 | Confidence Map: Weekly automatic two-point calibration check performance (ammonium error within 0.12 mg/L over 4 weeks) matches across sources. | applied | none |  | P7 calibration figure of 0.12 mg/L over 4 weeks matches |
| 244 | Confidence Map: Client farm application of the start-up method and its result (34 days at 7-8 C) is reported consistently, though only from a single farm instance. | applied | none |  | Client farm application not mentioned in this section |
| 244 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for smaller fish remains an open, unresolved question. | applied | none |  | Open question on smaller fish not mentioned in section |
| 244 | Confidence Map: Whether ammonium membrane life can be extended beyond 3 months is explicitly unresolved. | applied | none |  | Membrane life question not mentioned in section |
| 244 | Glossary Term: recirculating aquaculture systems (ras) | not_applied | none |  | RAS term never appears in section; repair failed |
| 244 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Section uses 'ammonia (TAN)' not full term; repaired to the Glossary Term |
| 244 | Glossary Term: ammonium ion-selective electrodes | not_applied | none |  | Section says 'ammonium sensors', not ion-selective electrodes; repair failed |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role appears in section. |
| 244 | Cover signed-off Summary item ys735tdce8qas41x8rnskseh8d8f8tyh | applied | none |  | P1 states separate trials isolate mechanisms by timescale. |
| 244 | Cover signed-off Summary item ys7dsrmjpgca0jqjk24wbpkcrn8f8wfg | applied | none |  | P2 states the feed-forward hypothesis and contrast to… |
| 244 | Cover signed-off Summary item ys79e4kfk0cr88z64k69xpmy6h8f8630 | applied | none |  | P3 gives loop A/B/C day counts as specified. |
| 244 | Cover signed-off Summary item ys76cvzb1bfg3e7xre5a05y7j18f8gnw | applied | none |  | P3 states the nitrite oxidizer cold-shock bottleneck finding. |
| 244 | Cover signed-off Summary item ys71zfrhe6vk35wmjt3vq255s98f9jg0 | applied | none |  | P4 states higher seed fraction needed at 6C, returns flatten… |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 7 (sections 244, 246): 244 P7 states the bypass loop held ammonium drift near 0.1 mg/L per week, later refined to within 0.12 mg/L over 4 weeks with calibration checks. 246 P4 states the bypass loop held DO and ammonium readings within tolerance for at least four weeks, without citing the 0.12 mg/L figure or reconciling it with the 0.1 mg/L per week figure from 244, leaving the final quantitative result ambiguous between the two sections. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 7 (sections 242, 244): 242 P3 states vendor-recommended weekly sensor cleaning was known to be inadequate, framing hand cleaning as the flawed existing practice. 244 P7 tests direct in-tank sensors cleaned weekly by hand as one arm of the trial. The Claim Exclusions list state that cleaning sensors weekly by hand per vendor instructions is routine maintenance, not experimental development, so reporting this as one arm of a controlled trial risks presenting excluded routine maintenance as part of the experimental comparison. |
| 244 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 244 paragraph 5 (sections 244): 244 P5 describes reactive pH-setpoint dosing as the baseline condition tested in the trial. The Claim Exclusions state dosing sodium bicarbonate reactively on a pH setpoint is the pre-existing standard method, not part of the claimed advancement, so care is needed that this baseline description does not read as claimed experimental work rather than a comparison control. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 350/350 words, 36/50 lines; repaired |
| 246 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue benefit to clients, not a technological result. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Savings from not oversizing the biofilter are a cost/business benefit, not a technological finding. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Adoption of the 55 percent fill ratio and feed-forward dosing into the standard design package is a business/commercial rollout decision, not experimental work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Cleaning sensors weekly by hand per vendor instructions is routine maintenance, not experimental development. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Dosing sodium bicarbonate reactively on a pH setpoint is the pre-existing standard method, not part of the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Planned future work testing the dosing rule across fish sizes and a TAN feedback trim falls outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: dissolved oxygen (do) | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: cold-water start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: bypass sampling loop | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Storyline | applied | none |  | Section matches storyline claims and figures. |
| 246 | Confidence Map: Trial 1 (U1) days to full nitrification for loops A, B, C at 8 C matches between transcript and document. | applied | none |  | 31/47/66 day figures match established C1. |
| 246 | Confidence Map: Nitrite stall duration for unacclimated seed (loop B) reported as 19 days in the document, described as 'almost three weeks' in the transcript; consistent but stated with different precision. | applied | none |  | Section doesn't state stall duration figure. |
| 246 | Confidence Map: Transcript states the nitrite stall for the unacclimated loop was almost three weeks, a less precise figure than the document's 19 days but not conflicting. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 2 (U1) results at 6 C for 5 percent and 15 percent acclimated seed match across sources. | applied | none |  | Seed fraction 10-15% at 8-6C matches established C4. |
| 246 | Confidence Map: Trial 3 (U2) baseline pH-setpoint dosing results (peak TAN, alkalinity drop, pH dip) are consistent between sources. | applied | none |  | Not stated as flat fact beyond established baseline. |
| 246 | Confidence Map: Feed-forward dosing effect on peak TAN and alkalinity in Trial 3 is consistent between sources. | applied | none |  | Feed-forward TAN reduction stated, matches established C6. |
| 246 | Confidence Map: Bicarbonate consumption increase under feed-forward dosing is reported only in the document, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 4 (U2) fill ratio results (40/55/65 percent, TAN peaks) match between sources. | applied | none |  | 55 percent fill ratio result matches established C8. |
| 246 | Confidence Map: Dead zone dissolved oxygen levels at 65 percent fill are quantified only in the document. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 5 (U3) direct sensor drift figures (DO 8 percent low by day 10, ammonium drift 0.4 mg/L per week) are consistent between sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 5 (U3) bypass loop performance (DO within 3 percent for 28 days, ammonium drift about 0.1 mg/L per week) is consistent between sources. | applied | none |  | Bypass loop performance stated matches established C11. |
| 246 | Confidence Map: Weekly automatic two-point calibration check performance (ammonium error within 0.12 mg/L over 4 weeks) matches across sources. | applied | none |  | 4-week tolerance figure matches established C12. |
| 246 | Confidence Map: Client farm application of the start-up method and its result (34 days at 7-8 C) is reported consistently, though only from a single farm instance. | applied | none |  | 34 days figure stated flatly, but C13 is partial |
| 246 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for smaller fish remains an open, unresolved question. | applied | none |  | Fish-size dependency hedged as 'remain unresolved'. |
| 246 | Confidence Map: Whether ammonium membrane life can be extended beyond 3 months is explicitly unresolved. | applied | none |  | Membrane longevity hedged as 'remain unresolved'. |
| 246 | Glossary Term: ammonium ion-selective electrodes | not_applied | none |  | Section says 'ammonium electrode' not full term; repair failed |
| 246 | Cover signed-off Summary item ys76x3kq3z6zgand84hckb9fzx8f9f8r | applied | none |  | P1 states U1 proven, 31 vs 66 vs 47 days |
| 246 | Cover signed-off Summary item ys76w30wshc005szx0zafdjtzh8f8wc9 | applied | none | 2 | P2 covers halved start-up and NOB bottleneck |
| 246 | Cover signed-off Summary item ys7564s99x67d0nrnyg0krzej58f875j | applied | none | 2 | P2 gives seed fraction rising with colder temps |
| 246 | Cover signed-off Summary item ys76w2kxve1wdzkkc691tr4a9h8f8p5p | applied | none |  | P5 states 34 days at client farm, close to 31 day pilot |
| 246 | Cover signed-off Summary item ys7byb03a82753r2mqvy2gmkhs8f9brk | applied | none |  | P5 links acclimation method to original cold-start goal |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team learned that colder water requires a higher seed fraction to reach full nitrification within five weeks." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): 246 P2 states the seed fraction needed to stay under five weeks rises from roughly 10 percent at 8 C to roughly 15 percent at 6 C. But 244 P4 describes only a 5 percent and 15 percent fraction tested at 6 C, with no mention of a 10 percent fraction or figure at 8 C, and 244 P3 does not report the seed fraction used at 8 C at all. The 10 percent figure for 8 C appears to be introduced in 246 without support in 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): 246 P1 labels the two hypotheses as U1 (acclimation reaching full nitrification under five weeks at 8 C) and U2 (feed-forward dosing alone holding TAN under 1 mg/L). 244 does not use U1/U2 labels or state the acclimation hypothesis as an explicit under-five-weeks target for trial one at 8 C; it only introduces the under-5-week target in P4 for the 6 C seed-fraction trial. This creates an unclear or shifted hypothesis statement between sections. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 5 (sections 242, 244, 246): 246 P5 states stepwise acclimation gave Marrowgate a repeatable seeding method for future farm designs while stabilizing ammonia without oversizing the biofilter, tying the advancement to the business benefit of not oversizing the biofilter. The Claim Exclusions list savings from not oversizing the biofilter as a cost/business benefit, not a technological finding, so presenting it as part of the technological advancement is an excluded claim. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 5 (sections 246): 246 P5 reports application of the start-up method at one client farm and connects this to the original goal, which touches on the excluded claim that shorter start-up allowing earlier fish stocking is a revenue benefit rather than a technological result. The paragraph should be checked to ensure it reports the technological transfer only, not the business benefit of earlier stocking. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 7 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 29.
- Line 244: 0 labels and 0 plan checks "Not checked" of 25.
- Line 246: 0 labels and 0 plan checks "Not checked" of 22.

## Seed-stage numbers

- Requests: 18 metered (18 Batch, 0 Feedback); 19 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.3 s, p95 23.4 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 26.2 s, p95 26.2 s over 1.
- Sign-off to report created: 186.1 s.
- Cost from aiUsage: $1.16 in all ($0.43 seed stage, $0.73 Brief, drafting and checks) over 48 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T13:45:52.344Z created project k974xbpe7krmp9zgz9dv7vrts58f8qv0
2026-09-28T13:45:53.031Z added document biofilter-trial-summary.md
2026-09-28T13:45:54.436Z started Step by step generation k576kpxvcvhjygw48vkpj7q82x8f875e
2026-09-28T13:46:48.400Z seed stage open
2026-09-28T13:46:48.401Z Open Company / Context and wait for its Batch
2026-09-28T13:46:57.936Z Company / Context: select the first Seed
2026-09-28T13:46:59.993Z Approve Company / Context
2026-09-28T13:47:02.066Z approved company_context
2026-09-28T13:47:02.066Z Open Goal / Problem and wait for its Batch
2026-09-28T13:47:16.889Z Goal / Problem: select the first Seed
2026-09-28T13:47:19.046Z Approve Goal / Problem
2026-09-28T13:47:21.131Z approved goal_problem
2026-09-28T13:47:21.131Z Open Technological limitations and wait for its Batch
2026-09-28T13:47:33.580Z Technological limitations: select the first Seed
2026-09-28T13:47:35.648Z Approve Technological limitations
2026-09-28T13:47:37.740Z approved passive_limitations
2026-09-28T13:47:37.740Z Open Technological objectives and wait for its Batch
2026-09-28T13:47:52.539Z Technological objectives: select the first Seed
2026-09-28T13:47:54.696Z Approve Technological objectives
2026-09-28T13:47:56.779Z approved technological_objective
2026-09-28T13:47:56.780Z Open Technological uncertainties and wait for its Batch
2026-09-28T13:48:11.575Z Technological uncertainties: select the first 3 Seeds
2026-09-28T13:48:16.448Z Approve Technological uncertainties
2026-09-28T13:48:18.551Z approved active_uncertainties
2026-09-28T13:48:18.551Z Skip Previous-year status
2026-09-28T13:48:19.924Z Open Work plan and wait for its Batch
2026-09-28T13:48:48.161Z Work plan: select the first Seed
2026-09-28T13:48:50.450Z Approve Work plan
2026-09-28T13:48:52.562Z approved workplan
2026-09-28T13:48:52.562Z Open Hypothesis and wait for its Batch
2026-09-28T13:49:18.042Z Hypothesis: select the first Seed
2026-09-28T13:49:20.139Z Approve Hypothesis
2026-09-28T13:49:22.238Z approved hypothesis
2026-09-28T13:49:22.238Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T13:49:37.068Z Experimentation / Iterations: select the first 3 Seeds
2026-09-28T13:49:41.916Z Approve Experimentation / Iterations
2026-09-28T13:49:44.092Z approved experimentation
2026-09-28T13:49:44.092Z Open Advancement to science / technology and wait for its Batch
2026-09-28T13:50:01.597Z Advancement to science / technology: select the first Seed
2026-09-28T13:50:03.688Z Approve Advancement to science / technology
2026-09-28T13:50:05.794Z approved overall_advancement
2026-09-28T13:50:05.794Z Open Specific technological advancements and wait for its Batch
2026-09-28T13:50:31.310Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T13:50:36.163Z Approve Specific technological advancements
2026-09-28T13:50:38.266Z approved specific_advancements
2026-09-28T13:50:38.266Z Open Project status and next steps and wait for its Batch
2026-09-28T13:50:50.431Z Project status and next steps: select the first Seed
2026-09-28T13:50:52.768Z Approve Project status and next steps
2026-09-28T13:50:54.859Z approved project_status
2026-09-28T13:50:54.859Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T13:51:09.677Z Overall company / project goal improvements: select the first Seed
2026-09-28T13:51:11.765Z Approve Overall company / project goal improvements
2026-09-28T13:51:13.864Z approved goal_improvements
2026-09-28T13:51:13.864Z Technological uncertainties: untick the uncertainty most selected advancements link to
2026-09-28T13:51:16.755Z Approve Technological uncertainties
2026-09-28T13:51:18.900Z approved active_uncertainties
2026-09-28T13:51:18.901Z Specific technological advancements: try to approve and expect the unlinked-advancement refusal
2026-09-28T13:51:20.972Z specific_advancements: refused (UNLINKED_ADVANCEMENT)
2026-09-28T13:51:20.972Z Specific technological advancements: Regenerate and wait for the fresh Batch
2026-09-28T13:51:49.317Z Specific technological advancements: untick advancements whose links are no longer active
2026-09-28T13:51:52.868Z untick unlinked advancement yn73h883e8ryeszaxzwffmfzhn8f8y8t
2026-09-28T13:51:54.351Z untick unlinked advancement yn7dbgwvryrjbbzcb44h8qed2h8f99gk
2026-09-28T13:51:54.351Z Specific technological advancements: select 2 linked advancements sharing one uncertainty (regenerating up to twice to find them)
2026-09-28T13:51:59.231Z Approve Specific technological advancements
2026-09-28T13:52:01.310Z approved specific_advancements
2026-09-28T13:52:01.310Z Confirm and approve every Stale Subsection, in order
2026-09-28T13:52:04.751Z approved workplan (confirmed 1 carried)
2026-09-28T13:52:07.524Z approved hypothesis (confirmed 1 carried)
2026-09-28T13:52:10.328Z approved experimentation (confirmed 3 carried)
2026-09-28T13:52:13.262Z approved overall_advancement (confirmed 1 carried)
2026-09-28T13:52:16.084Z approved project_status (confirmed 1 carried)
2026-09-28T13:52:18.863Z approved goal_improvements (confirmed 1 carried)
2026-09-28T13:52:18.863Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T13:52:20.271Z signed off; waiting for the report
2026-09-28T13:55:26.383Z report kd7eb57hmn8zjbp8wdafwh4d2h8f95n2 created
```
