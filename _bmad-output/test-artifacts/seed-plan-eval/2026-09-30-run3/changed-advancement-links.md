# Release eval - Marrowgate cold-water biofilter control

Semantic case: **Changed advancement links** (CAP-13: "changed advancement links"). Also checks: two advancements sharing an uncertainty are merged and the Compliance Note names the merge.

Run 2026-09-30 on `local` at commit `c17f2494`, acting as e2e-audit@banhall.local. Project `k9775jqbdh4rtfny5h6x7530xh8ffg0f`, generation `k570daezc1mr0qzy7vn61mmpas8ffa7t`.

## What this fixture tests

The writer selects three uncertainties, picks experiments by the uncertainty each tested (one for each uncertainty first), approves Specific technological advancements, then unticks the uncertainty most advancements link to. Approving the experiments that tested it must be refused, and the writer unticks them; approving the old advancements must be refused as unlinked; the writer regenerates, drops the unlinked items and selects advancements linked to a remaining uncertainty and to experiments that tested it. When two signed-off advancements share one uncertainty they must be drafted as one advancement with facets, and the Compliance Note must name the merge. Where the Advancement to science or goal improvements pick answers the dropped uncertainty, approving it must be refused, and the writer unticks it and picks or regenerates an idea for a kept uncertainty. No drafted advancement may claim the dropped uncertainty.

Fixture notes:

- 2026-09-29: run 6 (commit c8ce1fe2) failed because the scripted writer picked the first three experiments on the page, which were all cold-water start-up trials, and then dropped the start-up uncertainty. The Seed model linked start-up advancements to the sensor uncertainty and Line 246 claimed the dropped uncertainty resolved.
- The scripted writer now picks experiments the way a writer would for this purpose: by the uncertainty each one tested (the card shows it since the 2026-09-29 first amendment), one for each picked uncertainty first. Until at least two uncertainties are covered it takes no second experiment for one uncertainty and regenerates Experimentation / Iterations, up to twice; then it fills the remaining picks.
- It still drops the uncertainty most selected advancements link to, whatever that leaves. It reads each step's notice, expects the refusal for experiments that tested the dropped uncertainty, unticks them, and, when no kept uncertainty has an experiment left (the run 6 corner), picks experiments for the kept uncertainties as the step advises before it returns to the advancements.
- Automatic checks added: both steps named the problem before approval, the experiments refusal, every signed-off advancement follows the uncertainty its experiments tested, every signed-off experiment tested an uncertainty the plan still holds, and a hint showing the Line 246 paragraph closest to the dropped uncertainty's words. No earlier check was removed or weakened.
- 2026-09-30: run 10 (commit 67be8f06) failed: the Seed-stage rule held, but drafting was never told what the writer dropped, so the Brief put the dropped seed-fraction uncertainty's Trial 2 at 6 C back in Line 244 and its result in Line 246, and Line 246 claimed dosing and sensor advancements for uncertainties Line 242 never states. The 2026-09-30 first amendment leaves a dropped uncertainty out of every Line and ties Line 246 advancements to Line 242.
- Automatic checks added: every Line records the dropped uncertainty as left out (its Compliance Note rows applied), and Line 246 records every advancement as answering a Line 242 uncertainty. The hint now scans every paragraph of every Line for the dropped uncertainty's words and for the distinctive figures in its experiments' wording (figures no signed-off item uses), and names each paragraph with a hit. No earlier check was removed or weakened.
- 2026-09-30 (second): run 11 (commit 9de29da9) passed. The judges noted that Line 244 narrated a Brief-only sensor experiment for an uncertainty Line 242 never states, and that the Line 244 LEAVE OUT row read not applied for signed-off experiment item 9 (19 and 6 days). The 2026-09-30 second amendment adds Rule C (Line 244 work answers Line 242, or is work a signed-off item holds or needs as its evidence), makes the LEAVE OUT and Rule B checks compare with every COVER item first, and records a LEAVE OUT verdict that flags a signed-off item by its figures as applied.
- Automatic check added for every fixture (information): Line 244's Rule C row, its repair, and any Line 244 COVER row not applied after such a repair. The LEAVE OUT check's evidence names a row the figure check recorded applied. No earlier check was removed or weakened.
- 2026-09-30: run 11 (commit 9de29da9) passed, but both judges found a product gap: the writer dropped the acclimation and seed-fraction uncertainty, and the claim refused in Specific technological advancements (acclimation cut start-up roughly in half, 31 days at 8 C) survived in the Advancement to science and goal improvements picks (items 10 and 13), which carried no uncertainty link, and was drafted into Line 246. Under the 2026-09-30 fourth amendment those Seeds record the uncertainties they answer, and approving a pick that answers a dropped uncertainty is refused.
- Once the specific advancements are fixed, the scripted writer resolves Advancement to science, then goal improvements: where a pick answers the dropped uncertainty it expects the refusal; it unticks every pick the step names or approval asks to acknowledge, and picks an idea that answers only kept uncertainties, regenerating the step up to twice when the page has none. Goal improvements takes a goal restatement after one regeneration. Stale result steps go through the same resolver.
- Automatic checks added: each step whose pick answered the dropped uncertainty said so before approval, approving it was refused (both shown as information when no pick answered it), and every signed-off Advancement to science and goal improvements item answers only uncertainties the plan holds, Advancement to science at least one. No earlier check was removed or weakened.
- Review of the 2026-09-30 fourth amendment (P2-1 and its re-check): a link can be wrong, so approval also shows an Advancement to science or goal improvements pick whose words state a figure of a dropped uncertainty's results (from the Seeds that recorded it and that the writer ticked, less every figure a kept pick states) and asks the writer to acknowledge it. The scripted writer does not acknowledge it: it replaces the pick. Automatic checks added: no signed-off Advancement to science or goal improvements item states such a figure (read from the frozen Summary), and, as information, how many picks approval asked to acknowledge. No earlier check was removed or weakened.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 246 does not claim an advancement for the uncertainty the writer dropped.
   - Answer: Yes. The writer dropped the dosing uncertainty ("It was unknown whether dosing alkalinity ahead of feeding would hold nitrification capacity through the ammonia pulse. / A second open question was whether fill ratio could buffer spikes ...", frozen yn73g67q7azs3n7v4r3y8axwyx8fe68a). No Line states it, narrates its trials or claims its results; none of its figures (1.2, 0.8, 2.3 mg/L, 130 mg/L, 40/55/65 percent) appears, and all three leave-out rows are applied. Line 246 paragraph 5 names dosing work only as a next step.
2. The advancements that share one uncertainty are drafted as one advancement with facets, not as two separate claims.
   - Answer: Yes. Items 11a (31 vs 47 days) and 11b (66-day control) are one paragraph, Line 246 paragraph 2, "Merged items 2".
3. Each drafted advancement matches an uncertainty in Section 242 and an experiment in Section 244.
   - Answer: Yes. Line 246 paragraph 2 answers the Line 242 "overcome cold shock or simply delay" uncertainty from Line 244 paragraph 3; paragraph 3 answers the nitrite-oxidizer uncertainty from paragraph 4; paragraph 4 answers the seed fraction at 6 C uncertainty from Trial 2 in paragraph 5. No dosing or sensor advancement; Rules B and C applied.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (287, 502, 349).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (medium and medium-high confidence). Run 11's majors here are fixed: no sensor experiment in Line 244, no "three uncertainties" framing, no noisy leave-out row. The failed automatic check: signed-off Hypothesis item 8 is the dosing hypothesis, carried from an older context and confirmed after the writer dropped the dosing uncertainty; Line 244 states the Brief's acclimation hypothesis instead, and the Compliance Note records item 8 as not covered. Both judges: not a blocker (the CRA-correct outcome; stating it would have been an orphan hypothesis), but a major systematic product defect: Hypothesis (and Work plan) carry no uncertainty link, so a hypothesis for a dropped uncertainty survives sign-off and collides with Rule A. Also: Line 246 paragraph 5 lists the dropped dosing work as a next step with an unsourced reason (Rule A exempts next steps); Line 242 states the never-ticked sensor uncertainty with no follow-through (recorded limitation). The fourth amendment's refusal and acknowledgement paths were not exercised (no result pick answered the dropped uncertainty). Every figure checked matches the sources.

## Automatic checks

20 passed, 1 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd70r79r9th2mx8jh80pzpvyen8ffyjd |
| All three Sections were drafted | pass | 242: 287 words, 244: 502 words, 246: 349 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | fail | 1 row(s) in 244: "Alkalinity-dosing hypothesis never stated in section." |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED; goal_improvements prefetch: INVALID_OUTPUT / result_links, answer 1: 4 of 5 valid, needed 3 (INVALID_RESULT_REFERENCE unknown_uncertainty x1, INSUFFICIENT_FORM_DIVERSITY x0) |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | left out yn73g67q7azs3n7v4r3y8axwyx8fe68a: applied; Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Section covers only the start-up uncertainty from Line 242/246."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("All stated results vs targets match the numbers shown."); 246: not_applied ("Field 34-day result called 'close to' the 31-day pilot figure.") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (19 Batch, 0 Feedback), 20 reserved; notice not shown; 1 Retry |
| After the uncertainty changed, approving the old advancements was refused as unlinked | pass | INVALID_STATE / UNLINKED_ADVANCEMENT |
| Every signed-off advancement links to exactly one active uncertainty and at least one active experiment | pass | 2 advancement(s); 0 with a link outside the plan |
| The dropped uncertainty is out of the plan and no advancement links to it | pass | dropped yn73g67q7azs3n7v4r3y8axwyx8fe68a |
| Every signed-off advancement's uncertainty is one the plan still holds, and every experiment it links tested that uncertainty | pass | 2 advancement(s), each following the uncertainty its experiments tested |
| Every signed-off experiment tested an uncertainty the plan still holds | pass | 2 experiment(s); 0 with no recorded uncertainty or one the plan dropped |
| Before approval, Experimentation / Iterations named the experiments that tested the dropped uncertainty | pass | notice: experiments_for_dropped_uncertainty |
| Before approval, Specific technological advancements said its advancements could not be linked | pass | notice: unlinked_advancements |
| After the uncertainty was dropped, approving the experiments that tested it was refused | pass | INVALID_STATE / EXPERIMENT_FOR_DROPPED_UNCERTAINTY |
| Before approval, each step whose pick answered the dropped uncertainty said so | info | not applicable: no picked Advancement to science or goal improvements idea answered the dropped uncertainty |
| After the uncertainty was dropped, approving a result that answered it was refused | info | not applicable: no picked Advancement to science or goal improvements idea answered the dropped uncertainty |
| Picks whose words stated a dropped result, which approval asked the writer to acknowledge (the scripted writer replaced them) | info | Advancement to science / technology: 0; Overall company / project goal improvements: 0 |
| No signed-off Advancement to science or goal improvements item states a figure only the dropped uncertainty's work gave | pass | 1 dropped uncertainty(ies) read from the run's Seeds the writer ticked; no item states one of their results' figures |
| Every signed-off Advancement to science and goal improvements item answers an uncertainty the plan still holds | pass | 2 item(s), each answering only uncertainties the plan holds |
| Where the dropped uncertainty's words and its experiments' figures appear, in every Line (a hint for the judge) | info | paragraph 4 shares 19 percent of its content words: "The acclimated seed fraction proven at 8°C did not hold at 6°C and needed raising to about 15 percent to meet the target at that colder temperature, resolving whether a fraction proven at one tempe..."; distinctive figures: 1.2 mg/L, 130 mg/L, 40 percent, 55 percent, 65 percent, 0.8 mg/L; no paragraph of any Line has a hit |
| Every Line records the dropped uncertainty as left out | pass | 242: applied; 244: applied; 246: applied; frozen at sign-off: yn73g67q7azs3n7v4r3y8axwyx8fe68a |
| Line 246 records every advancement as answering a Line 242 uncertainty | pass | applied: "All advancements map to Line 242 uncertainties or COVER items." |
| Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge | pass | merged 2 items in Section 246 |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs recirculating aquaculture systems for land-based cold-water trout and char farms. / This 30-person firm is based in Kelvale, Nova Scotia, and handles the full water treatment train. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought to improve biofilter control in its recirculating aquaculture systems for cold-water trout and char farms. / The goal spanned three biofilter control problems: start-up speed, feeding surge spikes, and sensor accuracy. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice left cold-water biofilter start-up taking 9 to 10 weeks below 10 C. / Seed media from a warm system goes into cold shock and barely grows when dropped into 8 degree water. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether stepwise seed media acclimation could cut cold-water nitrification start-up to under 5 weeks at 8 C. / This knowledge was meant to enable a start-up method that avoids the cold shock that stalls unacclimated seed media. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether stepwise acclimation would overcome cold shock or simply delay the same bacterial failure. / Nitrite oxidizing bacteria were suspected to be more cold sensitive than ammonia oxidizers, but this was unconfirmed before testing. _(cited)_
- It was uncertain whether a seed fraction found to work at 8 C would still work at colder water near 6 C. / The point where added seed stopped improving start-up time was not known in advance. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team kept the three biofilter uncertainties separate because they fail differently and on different timescales. / Each experiment was designed to answer only one uncertainty so results could be attributed to a single cause. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If alkalinity is dosed ahead of each feeding in proportion to feed mass, then TAN will stay under 1 mg per litre through the pulse. / This feed-forward approach was proposed as an alternative to reactive, pH-triggered dosing after ammonia already spikes. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Experiment one tested whether 10 percent acclimated seed media would beat cold shock at 8 degrees Celsius. _(cited, carried from an older context)_
  - Tested: uncertainty "It was uncertain whether a seed fraction found to work at 8 C would..."
- The nitrite stage stalled almost three weeks in the unacclimated loop but only about six days with acclimation. / This confirmed nitrite oxidizing bacteria, not ammonia oxidizers, were the main cold shock bottleneck. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unclear whether stepwise acclimation would overcome cold sho..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Acclimated seed fraction that worked at 8 C needed raising to about 15 percent to hold under 5 weeks at 6 C. / Returns from added seed media flattened above roughly 10 to 15 percent, setting a practical ceiling. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Experiment one showed acclimated seed media reached full nitrification in 31 days, beating unacclimated media at 47 days. / This confirmed stepwise acclimation lets seed media avoid cold shock at 8 degrees Celsius. _(cited)_
  - Links: uncertainty "It was uncertain whether a seed fraction found to work at 8 C would..."; experiments "Experiment one tested whether 10 percent acclimated seed media woul..."
- The unseeded control loop took 66 days, confirming that cold water alone slows start-up without help. _(cited)_
  - Links: uncertainty "It was uncertain whether a seed fraction found to work at 8 C would..."; experiments "Experiment one tested whether 10 percent acclimated seed media woul..."

### 12. Project status and next steps (Section 246, standard): approved

- The start-up method reached a client farm in March 2026, finishing nitrification in 34 days at 7 to 8 C. / This field result sits close to the pilot's own 31-day figure at 8 degrees. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The acclimated seed fraction proven at 8 C needed raising to about 15 percent to work at 6 C. / Gains from added seed media flattened above roughly 10 to 15 percent, giving a practical ceiling. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

The company designs recirculating aquaculture systems (RAS) for land-based cold-water trout and char farms. This 30-person firm is based in Kelvale, Nova Scotia, and handles the full water treatment train, running a pilot facility with four independent loops for direct experimentation on biofilter behavior at the 6 to 12°C temperatures typical of Atlantic Canada.

The company sought to improve biofilter control in its recirculating aquaculture systems for cold-water trout and char farms. The goal spanned three biofilter control problems: start-up speed, feeding surge spikes, and sensor accuracy.

The limitations to standard practice were that cold-water biofilter start-up, using ammonium chloride dosing or seeding with warm-system media, took 9 to 10 weeks below 10°C. Seed media from a warm system goes into cold shock and barely grows when dropped into 8 degree water, and the mechanism behind this, along with whether any acclimation method could offset it, was not established. It was unknown whether any sensor setup could hold accuracy enough for control in biofilm-heavy water over several weeks.

The technological objective was to advance the understanding of whether stepwise temperature acclimation of seed media could cut cold-water nitrification start-up to under 5 weeks at 8°C. This knowledge was meant to enable a start-up method that avoids the cold shock that stalls unacclimated seed media.

It was unclear whether stepwise temperature acclimation would overcome cold shock or simply delay the same bacterial failure. Nitrite oxidizing bacteria were suspected to be more cold sensitive than ammonia oxidizers, but this was unconfirmed before testing. It was also uncertain whether a seed fraction found to work at 8°C would still work at colder water near 6°C, since the point where added seed stopped improving start-up time was not known in advance.

### Line 244

The technological problem addressed in fiscal 2026 was how to shorten cold-water nitrification start-up below 10°C, where standard practice using ammonium chloride dosing or unacclimated warm-system seed media left start-up at 9 to 10 weeks. The team kept this uncertainty separate from the company's other biofilter control problems because each one fails differently and on a different timescale. Each experiment was designed to answer only one uncertainty so results could be attributed to a single cause. The pilot facility's four independent loops, each a 6 m3 tank paired with a 1.2 m3 moving bed biofilter, allowed controlled side-by-side comparisons under identical cold-water conditions.

It was hypothesized that if seed media was acclimated through stepwise temperature acclimation, dropping 1°C every 4 days from 14°C down to 8°C, rather than transferred directly from a warm system, then the resulting biofilter would reach full nitrification (processing 1 mg/L TAN to under 0.2 mg/L within 24 hours, with nitrite under 0.3 mg/L) in under 5 weeks at 8°C.

Experiment one tested whether 10 percent acclimated seed media would beat cold shock at 8°C. Three loops ran in parallel: an unseeded control dosed only with ammonium chloride, a loop seeded with 10 percent unacclimated mature media from a 16°C system, and a loop seeded with 10 percent media acclimated stepwise from 14°C to 8°C. The unseeded control took 66 days, confirming cold water alone slows start-up without help, and the unacclimated loop took 47 days, still short of the 5-week target. The acclimated loop reached full nitrification in 31 days, confirming that stepwise acclimation lets seed media avoid cold shock at 8°C and that acclimation, not seeding alone, was the deciding factor.

Tracking the two nitrification stages separately showed the nitrite stage stalled almost three weeks in the unacclimated loop but only about six days with acclimation. This confirmed nitrite oxidizing bacteria, not ammonia oxidizers, were the main cold shock bottleneck, and that acclimation worked by protecting this more cold-sensitive population rather than by speeding up nitrification broadly.

A second trial then asked whether the 10 percent seed fraction that worked at 8°C would still hold at 6°C, since the point where added seed stopped improving start-up time was not known in advance. Acclimated loops at 6°C were run at 5 percent and 15 percent seed fractions. The 5 percent loop took 44 days, missing the under-5-week target, while the 15 percent loop reached full nitrification in 29 days, meeting it. This showed the acclimated seed fraction proven at 8°C needed raising to about 15 percent to hold under 5 weeks at 6°C, with gains from added seed media flattening above roughly 10 to 15 percent and setting a practical ceiling on how much benefit additional seeding could provide.

The start-up method was then applied at a client farm in March 2026, reaching full nitrification in 34 days at 7 to 8°C. This field result sits close to the pilot's own 31-day figure at 8°C, offering a partial confirmation of the method outside the controlled pilot setting.

### Line 246

The technological objective was to learn whether stepwise temperature acclimation of seed media could cut cold-water nitrification start-up to under 5 weeks at 8°C, and the project confirmed it could. The hypothesis held at 8°C and extended, with modification, to 6°C: acclimation worked at both temperatures, but the seed fraction needed to meet the target rose as water temperature dropped. This advances the design of recirculating aquaculture systems (RAS) biofilters for cold-water farm conditions.

Stepwise acclimation let seed media avoid the cold shock that stalls unacclimated media, resolving whether acclimation would overcome cold shock or just delay the same failure. A seeded biofilter design reached full nitrification in 31 days at 8°C, beating unacclimated media at 47 days. The unseeded control loop took 66 days, confirming that cold water alone slows start-up without help.

Nitrite oxidizing bacteria, not ammonia oxidizers, proved to be the main bottleneck behind cold shock, resolving which population acclimation needed to protect. Tracking nitrification stages separately showed the nitrite stage stalling for weeks in the unacclimated loop against days under acclimation, confirming that acclimation's benefit came from protecting this more cold-sensitive population.

The acclimated seed fraction proven at 8°C did not hold at 6°C and needed raising to about 15 percent to meet the target at that colder temperature, resolving whether a fraction proven at one temperature would generalize to colder water. Returns from added seed media flattened above roughly 10 to 15 percent, setting a practical ceiling on how much added seeding could help.

Work on fish-size-dependent dosing, ammonium membrane life, and total ammonia nitrogen (TAN) feedback trim is planned for next fiscal year and remains open, since current results were established under fixed feeding and sensor conditions not yet tested across that variation. The start-up method reached a client farm in March 2026, finishing nitrification in 34 days at 7 to 8°C, close to the pilot's own 31-day figure at 8°C and offering partial field confirmation. This let the company cut cold-water biofilter start-up well below the 9 to 10 week standard, improving the reliability of its biofilter designs for cold-water farm conditions.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 287/350 words, 32/50 lines |
| 242 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue/business benefit to clients, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Savings on biofilter volume and design package changes are business/commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Routine vendor-recommended weekly manual cleaning of sensors is standard, non-experimental maintenance practice. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Standard reactive alkalinity dosing on pH setpoint is pre-existing routine practice, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Oversizing the biofilter or spreading feeding out are described as standard industry workarounds, not part of the claimed work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches U1 scope, no contradiction found |
| 242 | Confidence Map: Trial 1 day counts for loops A, B, C are consistent between transcript and scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Scoping notes corroborate the same Trial 1 day counts. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Nitrite stall duration differs slightly in wording between sources but both describe loop B stalling about three weeks versus transcript's qualitative description. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Scoping notes give a precise nitrite stall duration of 19 days for loop B. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 2 seed fraction results are consistent across sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: U2 baseline TAN peak and alkalinity drop established in both sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Feed-forward dosing reduced peak TAN, established in both sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Bicarbonate use increase under feed-forward dosing is reported only in the scoping notes, not mentioned in the transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Fill ratio results at 40/55/65 percent established in both sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Dead zone oxygen levels at 65 percent fill are given with specific figures only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: U3 direct sensor drift figures established across both sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: U3 bypass loop sensor performance established across both sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size remains an open, unresolved question at year end. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether ammonium membrane life can be extended past 3 months remains unresolved. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Client farm application result of 34 days is reported consistently but described as close to, not matching, the pilot result, so remains a partial confirmation outside the controlled pilot. | applied | none |  | Section hedges with 'unclear' and 'unconfirmed' |
| 242 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | RAS spelled out but acronym absent; repaired to the Glossary Term |
| 242 | Glossary Term: moving bed biofilter | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: dissolved oxygen (do) | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: bypass sampling loop | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: stepwise temperature acclimation | applied | none |  | Term paraphrased as 'stepwise acclimation'; repaired to the Glossary Term |
| 242 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Not mentioned in the section |
| 242 | Cover signed-off Summary item ys72x4mywj7qpd30cerrck11h18ffyp7 | applied | none |  | P1 states company context as planned. |
| 242 | Cover signed-off Summary item ys72923m20zps2p01v2dtx2wp18ffqzb | applied | none |  | P2 states goal and three problems. |
| 242 | Cover signed-off Summary item ys7ejz3qqy6pxhq9drx69fr5zx8ff7w7 | applied | none |  | P3 states limitations with 9-10 weeks and cold shock. |
| 242 | Cover signed-off Summary item ys741pahb1eja317me41nc1xqs8ffwm2 | applied | none |  | P4 states the technological objective as planned. |
| 242 | Cover signed-off Summary item ys77xxjvqze16a51x6qcrmhrbd8fe6dz | applied | none | 2 | P5 states overcome-vs-delay and NOB sensitivity uncertainty. |
| 242 | Cover signed-off Summary item ys7cgbx7f8h4e1qb338x97wfxs8ffnjt | applied | none | 2 | P5 states seed-fraction-at-6C and diminishing-returns… |
| 242 | Leave out the uncertainty the writer dropped: "It was unknown whether dosing alkalinity ahead of feeding would hold nitrification capacity..." | applied | none |  | Section holds no alkalinity dosing or fill ratio content. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was unclear whether stepwise acclimation would overcome cold shock or simply delay the same bacterial failure. Nitri..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was uncertain whether a seed fraction found to work at 8 C would still work at colder water near 6 C. The point wher..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 502/700 words, 50/100 lines |
| 244 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue/business benefit to clients, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Savings on biofilter volume and design package changes are business/commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Routine vendor-recommended weekly manual cleaning of sensors is standard, non-experimental maintenance practice. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Standard reactive alkalinity dosing on pH setpoint is pre-existing routine practice, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Oversizing the biofilter or spreading feeding out are described as standard industry workarounds, not part of the claimed work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: moving bed biofilter | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Matches U1, Trial 1 and Trial 2 details |
| 244 | Confidence Map: Trial 1 day counts for loops A, B, C are consistent between transcript and scoping notes. | applied | none |  | Day counts stated match established figures |
| 244 | Confidence Map: Scoping notes corroborate the same Trial 1 day counts. | applied | none |  | Day counts consistent with scoping notes |
| 244 | Confidence Map: Nitrite stall duration differs slightly in wording between sources but both describe loop B stalling about three weeks versus transcript's qualitative description. | applied | none |  | Hedged as 'almost three weeks', not exact |
| 244 | Confidence Map: Scoping notes give a precise nitrite stall duration of 19 days for loop B. | applied | none |  | Section uses 'almost three weeks', not precise 19 days |
| 244 | Confidence Map: Trial 2 seed fraction results are consistent across sources. | applied | none |  | Seed fraction results stated as established figures |
| 244 | Confidence Map: U2 baseline TAN peak and alkalinity drop established in both sources. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Feed-forward dosing reduced peak TAN, established in both sources. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Bicarbonate use increase under feed-forward dosing is reported only in the scoping notes, not mentioned in the transcript. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Fill ratio results at 40/55/65 percent established in both sources. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Dead zone oxygen levels at 65 percent fill are given with specific figures only in the scoping notes. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: U3 direct sensor drift figures established across both sources. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: U3 bypass loop sensor performance established across both sources. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size remains an open, unresolved question at year end. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether ammonium membrane life can be extended past 3 months remains unresolved. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Client farm application result of 34 days is reported consistently but described as close to, not matching, the pilot result, so remains a partial confirmation outside the controlled pilot. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: moving bed biofilter | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: dissolved oxygen (do) | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: media fill ratio | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: bypass sampling loop | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: stepwise temperature acclimation | applied | none |  | Uses 'acclimated stepwise' not the term verbatim; repaired to the Glossary Term |
| 244 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Not mentioned in the section |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status statement appears in the section. |
| 244 | Cover signed-off Summary item ys7d19g1zbjypjq34zqs5what58ff3j1 | applied | none |  | P1 states separation reason and single-cause design. |
| 244 | Cover signed-off Summary item ys7cytsynxem3mdt5e6bc20mjn8ffy8f | not_applied | none |  | Alkalinity-dosing hypothesis never stated in section. |
| 244 | Cover signed-off Summary item ys73rtrpvd0jw8393rzkp1027d8ffx1r | applied | none |  | P3 tests the 8 C seed-fraction uncertainty as planned. |
| 244 | Cover signed-off Summary item ys7733h94tk64ttyhjpsbv2wa58fe4dh | applied | none |  | P4 gives stall durations and NOB bottleneck conclusion. |
| 244 | Leave out the uncertainty the writer dropped: "It was unknown whether dosing alkalinity ahead of feeding would hold nitrification capacity..." | applied | none |  | No feed-forward dosing or fill-ratio content appears. |
| 244 | State each result against its target as the numbers show | applied | none |  | All stated results vs targets match the numbers shown. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Section covers only the start-up uncertainty from Line 242/246. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Experiment one tested whether 10 percent acclimated seed media would beat cold shock at 8 degrees Celsius." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 349/350 words, 37/50 lines |
| 246 | Claim Exclusion: Shorter start-up allowing earlier fish stocking is a revenue/business benefit to clients, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Savings on biofilter volume and design package changes are business/commercial outcomes. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Routine vendor-recommended weekly manual cleaning of sensors is standard, non-experimental maintenance practice. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Standard reactive alkalinity dosing on pH setpoint is pre-existing routine practice, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Oversizing the biofilter or spreading feeding out are described as standard industry workarounds, not part of the claimed work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 5) |
| 246 | Glossary Term: nitrite oxidizing bacteria | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches U1 narrative and figures. |
| 246 | Confidence Map: Trial 1 day counts for loops A, B, C are consistent between transcript and scoping notes. | applied | none |  | Day counts stated match established Trial 1 figures. |
| 246 | Confidence Map: Scoping notes corroborate the same Trial 1 day counts. | applied | none |  | Consistent with scoping notes, stated flatly as established. |
| 246 | Confidence Map: Nitrite stall duration differs slightly in wording between sources but both describe loop B stalling about three weeks versus transcript's qualitative description. | applied | none |  | Section gives only qualitative stall duration, not precise… |
| 246 | Confidence Map: Scoping notes give a precise nitrite stall duration of 19 days for loop B. | applied | none |  | Section does not state the precise 19-day figure. |
| 246 | Confidence Map: Trial 2 seed fraction results are consistent across sources. | applied | none |  | Trial 2 seed fraction result stated matches established data. |
| 246 | Confidence Map: U2 baseline TAN peak and alkalinity drop established in both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Feed-forward dosing reduced peak TAN, established in both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Bicarbonate use increase under feed-forward dosing is reported only in the scoping notes, not mentioned in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Fill ratio results at 40/55/65 percent established in both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Dead zone oxygen levels at 65 percent fill are given with specific figures only in the scoping notes. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: U3 direct sensor drift figures established across both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: U3 bypass loop sensor performance established across both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size remains an open, unresolved question at year end. | applied | none |  | P5 hedges: dosing work 'remains open' not yet tested. |
| 246 | Confidence Map: Whether ammonium membrane life can be extended past 3 months remains unresolved. | applied | none |  | P5 hedges: membrane life work 'remains open' not yet tested. |
| 246 | Confidence Map: Client farm application result of 34 days is reported consistently but described as close to, not matching, the pilot result, so remains a partial confirmation outside the controlled pilot. | applied | none |  | P5 hedges with 'close to' and 'partial field confirmation'. |
| 246 | Glossary Term: recirculating aquaculture systems (ras) | applied | none |  | Section never writes RAS designs concept verbatim as RAS; repaired to the Glossary Term |
| 246 | Glossary Term: moving bed biofilter | applied | none |  | Concept of moving bed biofilter not referenced in section. |
| 246 | Glossary Term: dissolved oxygen (do) | applied | none |  | Dissolved oxygen concept not mentioned in the section. |
| 246 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | P5 says 'TAN feedback trim' using abbreviation without full term; repaired to the Glossary Term |
| 246 | Glossary Term: media fill ratio | applied | none |  | Media fill ratio concept not mentioned in the section. |
| 246 | Glossary Term: bypass sampling loop | applied | none |  | Bypass sampling loop concept not mentioned in the section. |
| 246 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Feed-forward alkalinity dosing concept not mentioned here. |
| 246 | Cover signed-off Summary item ys776fks5azccrc5pt0m9wnsfd8fftk2 | applied | none |  | P4 states 15 percent fraction and ceiling at 10-15 percent. |
| 246 | Cover signed-off Summary item ys7evkaz4vyam9enbw55ydgvs18fejtv | applied | none | 2 | P2 states 31 vs 47 days and cold shock resolution. |
| 246 | Cover signed-off Summary item ys7fvxsdzr19n19gm5zsqxs5cs8fee0a | applied | none | 2 | P2 states unseeded control loop took 66 days. |
| 246 | Cover signed-off Summary item ys7fqfzx801wk59q9z1y4kq4h58ffjat | applied | none |  | P5 states March 2026 field result, 34 days at 7-8 C. |
| 246 | Cover signed-off Summary item ys7ay2twx6e4h7eayp7xdazf7s8fe1w9 | applied | none |  | P4 states fraction raised to 15 percent and ceiling. |
| 246 | Leave out the uncertainty the writer dropped: "It was unknown whether dosing alkalinity ahead of feeding would hold nitrification capacity..." | applied | none |  | No mention of alkalinity dosing or fill ratio uncertainty. |
| 246 | State each result against its target as the numbers show | not_applied | none |  | Field 34-day result called 'close to' the 31-day pilot figure. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements map to Line 242 uncertainties or COVER items. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Experiment one showed acclimated seed media reached full nitrification in 31 days, beating unacclimated media at 47 day..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The acclimated seed fraction proven at 8 C needed raising to about 15 percent to work at 6 C. Gains from added seed med..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 242, 246): This paragraph says the 8% seed fraction proven at 8 degrees C did not hold at 6 degrees C. Line 242 P5 frames this as an open uncertainty (whether the fraction would still work at 6 degrees C), and Line 244 P5 reports the 5 percent loop (not the 10 percent fraction used at 8 degrees C) missed the target while 15 percent met it. Line 246 P4's claim that the 10 percent fraction specifically failed at 6 degrees C is not supported by the 5 percent vs 15 percent test described in 244, and overstates the result as a clean failure rather than an untested gap. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 1 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 30.
- Line 244: 0 labels and 0 plan checks "Not checked" of 32.
- Line 246: 0 labels and 0 plan checks "Not checked" of 31.

## Seed-stage numbers

- Requests: 19 metered (19 Batch, 0 Feedback); 20 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.4 s, p95 23.5 s over 15 Batch(es).
- Foreground dispatch to first render (script-observed): median 12.5 s, p95 12.5 s over 1.
- Sign-off to report created: 134.9 s.
- Cost from aiUsage: $1.21 in all ($0.49 seed stage, $0.72 Brief, drafting and checks) over 47 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T01:37:26.265Z created project k9775jqbdh4rtfny5h6x7530xh8ffg0f
2026-10-01T01:37:26.899Z added document biofilter-trial-summary.md
2026-10-01T01:37:28.175Z started Step by step generation k570daezc1mr0qzy7vn61mmpas8ffa7t
2026-10-01T01:38:08.053Z seed stage open
2026-10-01T01:38:08.053Z Open Company / Context and wait for its Batch
2026-10-01T01:38:19.642Z Company / Context: select the first Seed
2026-10-01T01:38:21.524Z Approve Company / Context
2026-10-01T01:38:23.729Z approved company_context
2026-10-01T01:38:23.730Z Open Goal / Problem and wait for its Batch
2026-10-01T01:38:38.731Z Goal / Problem: select the first Seed
2026-10-01T01:38:40.730Z Approve Goal / Problem
2026-10-01T01:38:42.923Z approved goal_problem
2026-10-01T01:38:42.923Z Open Technological limitations and wait for its Batch
2026-10-01T01:38:57.371Z Technological limitations: select the first Seed
2026-10-01T01:38:59.269Z Approve Technological limitations
2026-10-01T01:39:01.180Z approved passive_limitations
2026-10-01T01:39:01.181Z Open Technological objectives and wait for its Batch
2026-10-01T01:39:25.910Z Technological objectives: select the first Seed
2026-10-01T01:39:27.830Z Approve Technological objectives
2026-10-01T01:39:29.747Z approved technological_objective
2026-10-01T01:39:29.747Z Open Technological uncertainties and wait for its Batch
2026-10-01T01:39:44.005Z Technological uncertainties: select the first 3 Seeds
2026-10-01T01:39:48.516Z Approve Technological uncertainties
2026-10-01T01:39:50.437Z approved active_uncertainties
2026-10-01T01:39:50.437Z Skip Previous-year status
2026-10-01T01:39:51.727Z Open Work plan and wait for its Batch
2026-10-01T01:40:06.142Z Work plan: select the first Seed
2026-10-01T01:40:08.059Z Approve Work plan
2026-10-01T01:40:10.027Z approved workplan
2026-10-01T01:40:10.027Z Open Hypothesis and wait for its Batch
2026-10-01T01:40:21.909Z Hypothesis: select the first Seed
2026-10-01T01:40:23.803Z Approve Hypothesis
2026-10-01T01:40:25.721Z approved hypothesis
2026-10-01T01:40:25.721Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T01:40:50.511Z Experimentation / Iterations: select 3 experiments by the uncertainty each tested, one for each picked uncertainty first, covering at least 2 (regenerating up to twice to find them)
2026-10-01T01:40:56.835Z Approve Experimentation / Iterations
2026-10-01T01:40:58.754Z approved experimentation
2026-10-01T01:40:58.755Z Open Advancement to science / technology and wait for its Batch
2026-10-01T01:41:12.996Z Advancement to science / technology: select the first Seed
2026-10-01T01:41:14.981Z Approve Advancement to science / technology
2026-10-01T01:41:16.905Z approved overall_advancement
2026-10-01T01:41:16.905Z Open Specific technological advancements and wait for its Batch
2026-10-01T01:41:41.658Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T01:41:46.741Z Approve Specific technological advancements
2026-10-01T01:41:48.667Z approved specific_advancements
2026-10-01T01:41:48.668Z Open Project status and next steps and wait for its Batch
2026-10-01T01:42:00.324Z Project status and next steps: select the first Seed
2026-10-01T01:42:02.253Z Approve Project status and next steps
2026-10-01T01:42:04.178Z approved project_status
2026-10-01T01:42:04.178Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T01:42:27.675Z goal_improvements: attempt failed, Retry 1
2026-10-01T01:42:43.377Z Overall company / project goal improvements: select the first Seed
2026-10-01T01:42:45.330Z Approve Overall company / project goal improvements
2026-10-01T01:42:47.254Z approved goal_improvements
2026-10-01T01:42:47.254Z Technological uncertainties: untick the uncertainty most selected advancements link to
2026-10-01T01:42:49.772Z Approve Technological uncertainties
2026-10-01T01:42:51.682Z approved active_uncertainties
2026-10-01T01:42:51.682Z Experimentation / Iterations: read what the step says about its links before approving
2026-10-01T01:42:52.332Z experimentation link notice: experiments_for_dropped_uncertainty
2026-10-01T01:42:52.333Z Experimentation / Iterations: try to approve and expect the refusal for experiments that tested the dropped uncertainty
2026-10-01T01:42:54.226Z experimentation: refused (EXPERIMENT_FOR_DROPPED_UNCERTAINTY)
2026-10-01T01:42:54.226Z Experimentation / Iterations: untick the experiments that tested the dropped uncertainty (regenerating for the kept uncertainties if none is left)
2026-10-01T01:42:57.320Z untick experiment yn70bwbswas7cbsh06yhddbdts8febzn, which tested the dropped uncertainty
2026-10-01T01:42:57.962Z Approve Experimentation / Iterations
2026-10-01T01:43:00.409Z approved experimentation (confirmed 2 carried)
2026-10-01T01:43:00.409Z Specific technological advancements: read what the step says about its links before approving
2026-10-01T01:43:01.076Z specific_advancements link notice: unlinked_advancements
2026-10-01T01:43:01.076Z Specific technological advancements: try to approve and expect the unlinked-advancement refusal
2026-10-01T01:43:03.076Z specific_advancements: refused (UNLINKED_ADVANCEMENT)
2026-10-01T01:43:03.076Z Specific technological advancements: Regenerate and wait for the fresh Batch
2026-10-01T01:43:17.441Z Specific technological advancements: untick advancements whose links are no longer active
2026-10-01T01:43:21.302Z untick unlinked advancement yn70sa9tyydjn91qvg4zyaj2h18fft2h
2026-10-01T01:43:22.605Z untick unlinked advancement yn77m5wywb68f92asr7nyt93bh8fe01n
2026-10-01T01:43:22.605Z Specific technological advancements: select 2 linked advancements sharing one uncertainty (regenerating up to twice to find them)
2026-10-01T01:43:28.722Z Approve Specific technological advancements
2026-10-01T01:43:30.681Z approved specific_advancements
2026-10-01T01:43:30.682Z Advancement to science / technology: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-01T01:43:31.324Z overall_advancement link notice: none
2026-10-01T01:43:33.850Z overall_advancement: no pick answers the dropped uncertainty or states its result
2026-10-01T01:43:33.850Z Overall company / project goal improvements: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-01T01:43:34.515Z goal_improvements link notice: none
2026-10-01T01:43:37.016Z goal_improvements: no pick answers the dropped uncertainty or states its result
2026-10-01T01:43:37.016Z Confirm and approve every Stale Subsection, in order
2026-10-01T01:43:40.174Z approved workplan (confirmed 1 carried)
2026-10-01T01:43:42.736Z approved hypothesis (confirmed 1 carried)
2026-10-01T01:43:48.478Z approved overall_advancement (confirmed 1 carried)
2026-10-01T01:43:51.021Z approved project_status (confirmed 1 carried)
2026-10-01T01:43:56.690Z approved goal_improvements (confirmed 1 carried)
2026-10-01T01:43:56.690Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T01:43:57.973Z signed off; waiting for the report
2026-10-01T01:46:15.118Z report kd70r79r9th2mx8jh80pzpvyen8ffyjd created
```
