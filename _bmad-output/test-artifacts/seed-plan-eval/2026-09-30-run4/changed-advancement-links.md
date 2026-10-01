# Release eval - Marrowgate cold-water biofilter control

Semantic case: **Changed advancement links** (CAP-13: "changed advancement links"). Also checks: two advancements sharing an uncertainty are merged and the Compliance Note names the merge.

Run 2026-09-30 on `local` at commit `e8112000`, acting as e2e-audit@banhall.local. Project `k979n57rvvsc37a6f8ytdnna6n8ffpya`, generation `k5738gcrmaw6q6x9x3d0tg0xch8ffn5w`.

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
- 2026-09-30: run 12 (commit c17f2494) passed, but both judges found a major systematic defect: the writer dropped the dosing uncertainty, and signed-off Hypothesis item 8 was the dosing hypothesis, carried and confirmed after the drop because the Hypothesis step carried no uncertainty link. Line 244 then had to choose between a COVER item and the LEAVE OUT. Under the 2026-09-30 fifth amendment Hypothesis and Work plan Seeds record the uncertainties they test or plan work for, and approving a pick that records a dropped uncertainty is refused.
- Right after the drop, in step order and before the experiments, the scripted writer resolves Work plan, then Hypothesis: it reads the step's notice, expects the refusal where a pick records the dropped uncertainty, unticks it and picks one for a kept uncertainty, regenerating the step up to twice. Automatic checks added: approving a Hypothesis or Work plan pick that tested the dropped uncertainty was refused (information when no pick did), and every signed-off Hypothesis and Work plan item records only uncertainties the plan still holds. No earlier check was removed or weakened.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 246 does not claim an advancement for the uncertainty the writer dropped.
   - Answer: Yes. The writer dropped the acclimation uncertainty ("It was uncertain whether stepwise acclimation could overcome cold shock ... / ... what seed fraction would reach full nitrification under 5 weeks once water dropped to 6 C.", frozen yn7413a1489xch2drmst0evy9d8ffm2a). None of its work or figures (66, 47, 31, 19, 6, 44, 29 days; 5 and 15 percent; 6 C) appears in any Line, and all three leave-out rows are applied. Line 246 paragraph 4 reports the 34-day client-farm result, which is signed-off status item 12 (a COVER item; status is not an advancement).
2. The advancements that share one uncertainty are drafted as one advancement with facets, not as two separate claims.
   - Answer: Yes. Items 11a and 11b (both on the sensor uncertainty) are one paragraph, Line 246 paragraph 3, "Merged items 2".
3. Each drafted advancement matches an uncertainty in Section 242 and an experiment in Section 244.
   - Answer: Yes. Line 246 paragraph 1 (dosing) answers Line 242 paragraph 5 from Line 244 paragraph 3; paragraph 2 (fill ratio) from paragraph 4; paragraph 3 (sensors) from paragraph 5. Rules B and C applied.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (334, 607, 343). Line 244 paragraph 1 says "addressed in this Line" (minor).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (medium confidence). The fifth amendment worked live: the signed-off Hypothesis and Work plan record only the kept uncertainty, Line 244 states the signed-off hypothesis (run 12's omission fixed), and the refusals fired in the run log (Hypothesis PLAN_FOR_DROPPED_UNCERTAINTY, Experimentation, Specific advancements, Advancement to science and goal improvements RESULT_FOR_DROPPED_UNCERTAINTY, each replaced). The figure acknowledgement and the revision-root path were not exercised. Major (both judges, systematic): the dropped uncertainty's story survives through steps that carry no link: the objective (item 4) restates the dropped question, a limitation (item 3) and the 34-day status (item 12), all confirmed after the drop; contract-compliant (COVER wins) and every fact true, but a CRA reader sees an objective with no uncertainty or work behind it. The consistency pass flagged it. Every figure checked matches the sources.

## Automatic checks

25 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd71bdehwsm9x9jt48warse42d8ffyf4 |
| All three Sections were drafted | pass | 242: 334 words, 244: 607 words, 246: 343 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | left out yn7413a1489xch2drmst0evy9d8ffm2a: applied; Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work covers U2/U3 uncertainties from Line 242"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("P3/P4/P5 compare results to targets correctly"); 246: applied ("All target comparisons match the numbers shown.") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 17 reserved; notice not shown; 0 Retry |
| After the uncertainty changed, approving the old advancements was refused as unlinked | pass | INVALID_STATE / UNLINKED_ADVANCEMENT |
| Every signed-off advancement links to exactly one active uncertainty and at least one active experiment | pass | 2 advancement(s); 0 with a link outside the plan |
| The dropped uncertainty is out of the plan and no advancement links to it | pass | dropped yn7413a1489xch2drmst0evy9d8ffm2a |
| Every signed-off advancement's uncertainty is one the plan still holds, and every experiment it links tested that uncertainty | pass | 2 advancement(s), each following the uncertainty its experiments tested |
| Every signed-off experiment tested an uncertainty the plan still holds | pass | 2 experiment(s); 0 with no recorded uncertainty or one the plan dropped |
| Before approval, Experimentation / Iterations named the experiments that tested the dropped uncertainty | pass | notice: experiments_for_dropped_uncertainty |
| Before approval, Specific technological advancements said its advancements could not be linked | pass | notice: unlinked_advancements |
| After the uncertainty was dropped, approving the experiments that tested it was refused | pass | INVALID_STATE / EXPERIMENT_FOR_DROPPED_UNCERTAINTY |
| Before approval, each step whose pick answered the dropped uncertainty said so | pass | Advancement to science / technology: notice results_for_dropped_uncertainty; Overall company / project goal improvements: notice results_for_dropped_uncertainty |
| After the uncertainty was dropped, approving a result that answered it was refused | pass | Advancement to science / technology: INVALID_STATE / RESULT_FOR_DROPPED_UNCERTAINTY; Overall company / project goal improvements: INVALID_STATE / RESULT_FOR_DROPPED_UNCERTAINTY |
| Picks whose words stated a dropped result, which approval asked the writer to acknowledge (the scripted writer replaced them) | info | Advancement to science / technology: 0; Overall company / project goal improvements: 0 |
| No signed-off Advancement to science or goal improvements item states a figure only the dropped uncertainty's work gave | pass | 1 dropped uncertainty(ies) read from the run's Seeds the writer ticked; no item states one of their results' figures |
| Every signed-off Advancement to science and goal improvements item answers an uncertainty the plan still holds | pass | 2 item(s), each answering only uncertainties the plan holds |
| After the uncertainty was dropped, approving a Hypothesis or Work plan pick that tested it was refused | pass | Hypothesis: INVALID_STATE / PLAN_FOR_DROPPED_UNCERTAINTY |
| Every signed-off Hypothesis and Work plan item records only uncertainties the plan still holds | pass | 2 item(s), each recording only uncertainties the plan holds |
| Where the dropped uncertainty's words and its experiments' figures appear, in every Line (a hint for the judge) | info | paragraph 1 shares 23 percent of its content words: "The company set out to advance cold-water biofilter control for recirculating aquaculture systems, targeting faster nitrification start-up, control of ammonia spikes after feeding, and reliable sen..."; distinctive figures: 6 C, 66 days, 47 days, 19 days, 31 days, 14 degrees, 15 percent, 6 degrees, 5 percent, 6 days; paragraphs with a hit: Line 242 P1 (13 percent of its words; 6 C): "Marrowgate Aquatics Inc. designs recirculating aquaculture systems (RAS) for land-based cold-water trout and char far..."; Line 242 P4 (42 percent of its words): "The technological objective was to advance the understanding of whether stepwise temperature acclimation of seed medi..."; Line 242 P5 (39 percent of its words): "It was uncertain whether feed-forward alkalinity dosing alone could hold total ammonia nitrogen (TAN) under 1 mg/L th..." |
| Every Line records the dropped uncertainty as left out | pass | 242: applied; 244: applied; 246: applied; frozen at sign-off: yn7413a1489xch2drmst0evy9d8ffm2a |
| Line 246 records every advancement as answering a Line 242 uncertainty | pass | applied: "All advancements answer dosing, fill ratio, or sensor…" |
| Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge | pass | merged 2 items in Section 246 |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The client designs recirculating aquaculture systems for land-based cold-water trout and char farms in Kelvale, Nova Scotia. / The firm employs 30 people covering tanks, water treatment, biofilters, oxygen systems and controls. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company sought to improve moving bed biofilter control for recirculating aquaculture systems operating in cold water. / The goal was a biofilter control process that shortens nitrification start-up below 10 C. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard seeding practice causes cold shock in warm sourced media, so bacteria survive but barely grow. / Below 10 C, nitrification start-up using ammonium chloride dosing or warm media seeding took 9 to 10 weeks. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- New knowledge was sought on whether stepwise temperature acclimation of seed media could overcome cold shock. / This was intended to enable a biofilter start-up method reaching full nitrification in under 5 weeks at 8 degrees. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- The open question was whether feed-forward alkalinity dosing alone could hold TAN under 1 mg/L through a feeding surge. / It was unclear whether a higher media fill ratio would act as a separate buffering mechanism or simply duplicate the dosing effect. _(cited)_
- Whether optical dissolved oxygen and ammonium electrodes could remain accurate enough for control in biofilm-heavy water was unknown. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan tested feed-forward alkalinity dosing proportional to feed mass against a reactive pH-setpoint baseline to see if TAN could stay under 1 mg/L. / A separate trial then varied media fill ratio under feed-forward dosing to check whether fill ratio buffers spikes independently of the dosing rule. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If alkalinity is dosed ahead of each feeding in proportion to feed mass, then TAN stays under 1 mg/L through the pulse. / If media fill ratio is raised to 55 percent under feed-forward dosing, then the biofilter buffers the spike as a separate mechanism. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- A trial varied media fill ratio under feed-forward dosing to test whether it buffers spikes independently of dosing. / At 55 percent fill the TAN peak was lowest and flattest, while 65 percent caused clumping and dead zones. _(cited, carried from an older context)_
  - Tested: uncertainty "The open question was whether feed-forward alkalinity dosing alone ..."
- Fill ratio and the feed-forward dosing rule were confirmed to work as two separate, additive mechanisms. / Setup one with direct in-tank sensors drifted fast, while setup two using a screened bypass loop stayed within 3 percent DO for 28 days. _(cited, carried from an older context)_
  - Tested: uncertainty "Whether optical dissolved oxygen and ammonium electrodes could rema..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The feed-forward dosing rule held TAN under target only when paired with a higher media fill ratio. / A 55 percent fill ratio buffered spikes as a separate, additive mechanism from the dosing timing effect. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Direct in-tank sensors drifted quickly, with dissolved oxygen reading 8 percent low after only 10 days. / Ammonium electrodes drifted 0.4 mg/L per week in that direct setup, too fast for reliable control. _(cited, carried from an older context)_
  - Links: uncertainty "Whether optical dissolved oxygen and ammonium electrodes could rema..."; experiments "Fill ratio and the feed-forward dosing rule were confirmed to work ..."
- A screened bypass loop with air blast kept dissolved oxygen within 3 percent accuracy for 28 days. / Adding weekly automatic two-point checks held ammonium error within 0.12 mg/L over 4 weeks. _(cited, carried from an older context)_
  - Links: uncertainty "Whether optical dissolved oxygen and ammonium electrodes could rema..."; experiments "Fill ratio and the feed-forward dosing rule were confirmed to work ..."

### 12. Project status and next steps (Section 246, standard): approved

- The start-up method was applied at one client farm, reaching full nitrification in 34 days at 7 to 8 C. / The feeding surge control with feed-forward dosing and 55 percent fill ratio now runs on all four pilot loops. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Resolving the fill ratio question let the firm fold a buffering mechanism into the standard biofilter control process. / The finding that fill ratio and feed-forward dosing are separate, additive mechanisms improved TAN control design overall. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

Marrowgate Aquatics Inc. designs recirculating aquaculture systems (RAS) for land-based cold-water trout and char farms in Kelvale, Nova Scotia, with a 30-person team covering tank design, water treatment, biofilters, oxygen systems and controls. This range of in-house disciplines gave the company direct operational exposure to the moving bed biofilters and cold intake water (6-12 C) typical of Atlantic Canada sites, where nitrification performance governs farm start-up timelines and water quality control.

The company sought to improve moving bed biofilter control for RAS operating in cold water. Its goal was a biofilter control process that shortens nitrification start-up below 10 C, limits ammonia spikes after feeding, and supports reliable automated water quality control.

The limitations to standard practice were that existing seeding methods were known to fail in cold water: seed media taken from warm systems went into cold shock when moved directly into water near 8 C, so bacteria survived but barely grew. Under standard ammonium chloride dosing or unacclimated warm-media seeding, nitrification start-up below 10 C took 9 to 10 weeks, and no documented method existed for shortening this reliably.

The technological objective was to advance the understanding of whether stepwise temperature acclimation of seed media could overcome cold shock in nitrifying bacterial populations, for the purposes of developing a biofilter start-up method reaching full nitrification in under 5 weeks at 8 C.

It was uncertain whether feed-forward alkalinity dosing alone could hold total ammonia nitrogen (TAN) under 1 mg/L through a feeding surge, because cold biofilters cannot ramp nitrification fast enough to match a feed-triggered ammonia pulse even once pH depression is prevented. It was also unclear whether raising media fill ratio would act as a separate buffering mechanism or simply duplicate the dosing effect, since higher fill ratios also risk media clumping and low-oxygen dead zones. Whether optical dissolved oxygen sensors and ammonium ion-selective electrodes could stay accurate enough for closed-loop control in biofilm-heavy water was unknown, since biofilm fouling behaves differently from the conditions vendor cleaning intervals were designed around.

### Line 244

The technological problem addressed in this Line was twofold: how to prevent total ammonia nitrogen (TAN) from spiking above 1 mg/L after feeding surges in a cold-water moving bed biofilter, and whether optical dissolved oxygen and ammonium ion-selective electrodes could hold accuracy for control in biofilm-heavy water. Standard reactive alkalinity dosing on a pH setpoint only responds after pH has already fallen, by which point nitrification slows and TAN accumulates. Vendor-recommended weekly sensor cleaning was known to leave ammonium electrodes drifting about 0.4 mg/L per week, too fast for closed-loop control. The company undertook a planned series of experiments to test feed-forward alkalinity dosing proportional to feed mass against the reactive baseline, and to test media fill ratio as a possible independent buffering mechanism against TAN spikes. A parallel set of trials compared sensor installation methods to determine whether a screened bypass sampling loop could outperform direct in-tank sensors under routine biofilm fouling.

It was hypothesized that if alkalinity were dosed ahead of each feeding in proportion to feed mass, rather than reactively on pH, then TAN would stay under 1 mg/L through the feeding pulse. It was further hypothesized that if media fill ratio were raised to 55 percent under feed-forward dosing, then the biofilter would buffer the spike through a separate mechanism, independent of the dosing rule.

The first trial addressed whether reactive pH-setpoint dosing could hold TAN under 1 mg/L after feeding, or whether a feed-forward approach was needed. The baseline loops, dosed reactively on a pH 7.2 setpoint, let TAN peak at 2.3 mg/L while alkalinity fell from 150 to about 95 mg/L as CaCO3 and pH dipped to 6.9 before dosing caught up. Switching one loop to feed-forward dosing (0.25 kg sodium bicarbonate per kg feed, delivered 45 minutes ahead of each meal) cut peak TAN to 1.2 mg/L and kept alkalinity above 130 mg/L. The dosing change prevented the alkalinity and pH drop that had been slowing the nitrifiers, but TAN still missed the under-1 mg/L target on dosing alone. This showed feed-forward timing addresses the pH-driven slowdown but needed a second mechanism to meet the target.

A second trial tested whether media fill ratio could supply that missing buffer. With feed-forward dosing active on all loops, fill ratios of 40, 55 and 65 percent were compared over six weeks. Peak TAN after the morning feed came in at 1.2 mg/L at 40 percent, 0.8 mg/L at 55 percent, and 1.1 mg/L at 65 percent; at 65 percent, media clumped in the corners and produced dead zones with low oxygen. The 55 percent point gave not only the lowest peak but a flatter spike overall, pointing to spare nitrification capacity acting as a reserve during surges. This confirmed fill ratio works as a buffering mechanism separate from the dosing rule, together meeting the under-1 mg/L target that dosing alone could not.

The third trial addressed whether dissolved oxygen and ammonium sensors could stay accurate enough for control in biofilm-heavy water. Direct in-tank sensors, cleaned weekly by hand, were checked against lab wet-chemistry reference samples taken three times weekly. Dissolved oxygen readings drifted 8 percent low within 10 days, and ammonium drift reached 0.4 mg/L per week, both too fast for reliable automated dosing decisions. Switching to a screened bypass sampling loop, using a 50 micron screen with automatic compressed-air blast every 6 hours, held dissolved oxygen within 3 percent accuracy for 28 days. Adding a weekly automatic two-point calibration check on the ammonium electrode held ammonium error within 0.12 mg/L over 4 weeks, establishing that the screened bypass configuration, not the sensor hardware alone, was what made multi-week control-grade accuracy achievable.

### Line 246

The company set out to advance cold-water biofilter control for recirculating aquaculture systems, targeting faster nitrification start-up, control of ammonia spikes after feeding, and reliable sensor-based automation. The feed-forward dosing hypothesis was partially proven: dosing alkalinity ahead of feed mass prevented the pH depression that slows nitrifiers, but alone did not bring total ammonia nitrogen (TAN) under the 1 mg/L target. Reaching that target required a second mechanism alongside dosing timing.

Media fill ratio was found to buffer TAN spikes through a mechanism separate from, and additive to, feed-forward alkalinity dosing, resolving whether a higher fill ratio would duplicate the dosing effect or add independent nitrification capacity. At 55 percent fill, peak TAN came in lower and flatter than at 40 or 65 percent, pointing to spare capacity absorbed during surges rather than interaction with the dosing rule. Pairing feed-forward dosing with a 55 percent fill ratio held TAN under the 1 mg/L target that dosing alone could not reach.

A screened bypass sampling loop, not the sensor hardware itself, was found to let dissolved oxygen and ammonium instruments hold control-grade accuracy in biofilm-heavy water, resolving the uncertainty over whether these sensors could stay accurate enough for closed-loop use. Direct in-tank sensors drifted fast: dissolved oxygen read 8 percent low after 10 days, and ammonium ion-selective electrodes drifted 0.4 mg/L per week, too fast for reliable control. Routed through a screened bypass loop with air-blast cleaning, dissolved oxygen held within 3 percent accuracy for 28 days; adding weekly automatic two-point checks held ammonium error within 0.12 mg/L over 4 weeks.

The start-up method has been applied at one client farm, reaching full nitrification in 34 days at 7-8 C, and the feed-forward dosing and 55 percent fill ratio combination now runs on all four pilot loops. Fish-size adjustment of the dosing rule, ammonium membrane longevity past 3 months, and a TAN feedback trim remain open for next fiscal year.

Resolving the fill ratio question let the company fold this additive buffering mechanism into its standard biofilter control process, improving overall TAN control design.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 334/350 words, 36/50 lines |
| 242 | Claim Exclusion: Oversizing the biofilter as a cost/footprint tradeoff is a routine design/business response, not the eligible technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Spreading out feeding to avoid spikes is a routine operational/business choice farms reject due to labour cost, not technological development. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Routine vendor-recommended weekly manual sensor cleaning is standard maintenance, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Business impact framing (earlier stocking revenue, saved biofilter volume) is a commercial outcome, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Change to standard design/commercial control package is routine implementation of already-established results, not uncertainty-driven investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: moving bed biofilter | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: ammonium ion-selective electrode | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: stepwise temperature acclimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline's U1-U3 uncertainty framing. |
| 242 | Confidence Map: Trial 1 day counts for full nitrification across loops A, B, C at 8 C, consistent between transcript and document. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Nitrite stall duration figures differ slightly in framing but are consistent compatible measurements (transcript gives approximate, document gives precise days). | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Transcript's approximate nitrite stall description for loop B (about three weeks) is compatible with document's precise 19 days. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 2 seed fraction results at 6 C. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Client farm application result, reported only once but uncontradicted. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 3 baseline TAN peak and alkalinity/pH drop under pH-setpoint dosing. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Feed-forward dosing result including a bicarbonate usage increase noted only in the document, not in the transcript. | applied | none |  | P5 hedges dosing uncertainty, no flat claim made. |
| 242 | Confidence Map: Trial 4 fill ratio results and dead-zone DO readings, with precise DO figures only in the document. | applied | none |  | P5 hedges fill ratio uncertainty appropriately. |
| 242 | Confidence Map: Trial 5 sensor comparison counts, including total lab reference sample count only given in the document. | applied | none |  | P5 hedges sensor accuracy as unknown. |
| 242 | Confidence Map: Ammonium membrane replacement interval and whether it can be extended remains an open, unresolved question. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size is explicitly unresolved. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Stocking density and fish weight range for the pilot, reported only in the document. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Biofilter media specific surface area, a detail only in the document. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: recirculating aquaculture system (ras) | not_applied | none |  | RAS spelled out but acronym form absent; repair failed |
| 242 | Glossary Term: nitrite stall | not_applied | none |  | Concept described without using term 'nitrite stall'; repair failed |
| 242 | Glossary Term: screened bypass sampling loop | applied | none |  | Concept of bypass loop not described in section. |
| 242 | Cover signed-off Summary item ys7fb1a53n25780g0twdcq0cfs8fea5e | applied | none |  | P1 covers company description, location, team size, disciplines. |
| 242 | Cover signed-off Summary item ys72jj2f5sfbr80rggbgv08xr98ffmv3 | applied | none |  | P2 states goal of biofilter control process below 10 C. |
| 242 | Cover signed-off Summary item ys79w8hz6932537tcex512d6xs8fed08 | applied | none |  | P3 covers cold shock and 9-10 week baseline figures. |
| 242 | Cover signed-off Summary item ys72yev2s622yxyvd59g0q0mph8fe1at | applied | none |  | P4 states objective of stepwise acclimation and 5-week target. |
| 242 | Cover signed-off Summary item ys78d8rzypmhhps8srajqzhnyn8ffgns | applied | none | 2 | P5 covers dosing/fill ratio uncertainty as planned. |
| 242 | Cover signed-off Summary item ys7ak23awjanb0azvdw1b0ynq98feknc | applied | none | 2 | P5 covers sensor accuracy uncertainty as planned. |
| 242 | Leave out the uncertainty the writer dropped: "It was uncertain whether stepwise acclimation could overcome cold shock since nitrite oxidizers..." | applied | none |  | No U1 trial results or nitrite-oxidizer findings appear… |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 607/700 words, 57/100 lines |
| 244 | Claim Exclusion: Oversizing the biofilter as a cost/footprint tradeoff is a routine design/business response, not the eligible technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Spreading out feeding to avoid spikes is a routine operational/business choice farms reject due to labour cost, not technological development. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Routine vendor-recommended weekly manual sensor cleaning is standard maintenance, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Business impact framing (earlier stocking revenue, saved biofilter volume) is a commercial outcome, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Change to standard design/commercial control package is routine implementation of already-established results, not uncertainty-driven investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: moving bed biofilter | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: ammonium ion-selective electrode | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: screened bypass sampling loop | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches U2/U3 of Storyline closely |
| 244 | Confidence Map: Trial 1 day counts for full nitrification across loops A, B, C at 8 C, consistent between transcript and document. | applied | none |  | Not mentioned; section covers U2/U3 only |
| 244 | Confidence Map: Nitrite stall duration figures differ slightly in framing but are consistent compatible measurements (transcript gives approximate, document gives precise days). | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Transcript's approximate nitrite stall description for loop B (about three weeks) is compatible with document's precise 19 days. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 2 seed fraction results at 6 C. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Client farm application result, reported only once but uncontradicted. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 3 baseline TAN peak and alkalinity/pH drop under pH-setpoint dosing. | applied | none |  | Stated flatly, matches established status |
| 244 | Confidence Map: Feed-forward dosing result including a bicarbonate usage increase noted only in the document, not in the transcript. | applied | none |  | Bicarbonate usage increase not stated flatly |
| 244 | Confidence Map: Trial 4 fill ratio results and dead-zone DO readings, with precise DO figures only in the document. | applied | none |  | Stated flatly, matches established status |
| 244 | Confidence Map: Trial 5 sensor comparison counts, including total lab reference sample count only given in the document. | applied | none |  | Sensor comparison stated as established evidence allows |
| 244 | Confidence Map: Ammonium membrane replacement interval and whether it can be extended remains an open, unresolved question. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size is explicitly unresolved. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Stocking density and fish weight range for the pilot, reported only in the document. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Biofilter media specific surface area, a detail only in the document. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: recirculating aquaculture system (ras) | applied | none |  | RAS concept not named in this section |
| 244 | Glossary Term: stepwise temperature acclimation | applied | none |  | Not relevant to this section's uncertainties |
| 244 | Glossary Term: nitrite stall | applied | none |  | Nitrite stall concept not present in this section |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status role present in section |
| 244 | Cover signed-off Summary item ys766av8h15zkcnhj07fat7gs18ferw2 | applied | none |  | P1/P4 describe both trials as planned |
| 244 | Cover signed-off Summary item ys7cggabfgsd5bh93a177xvq5x8ffrnd | applied | none |  | P2 states both hypotheses as worded |
| 244 | Cover signed-off Summary item ys73aphjt4n8qqyrjx1n1w52kn8ffrnv | applied | none |  | P4 gives fill ratio trial and figures |
| 244 | Cover signed-off Summary item ys7b8r5vc0m8y600f06c9yttqx8ffs9r | applied | none |  | P5 shows direct vs bypass sensor results |
| 244 | Leave out the uncertainty the writer dropped: "It was uncertain whether stepwise acclimation could overcome cold shock since nitrite oxidizers..." | applied | none |  | No U1 seeding/acclimation content present |
| 244 | State each result against its target as the numbers show | applied | none |  | P3/P4/P5 compare results to targets correctly |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work covers U2/U3 uncertainties from Line 242 |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 1 (sections 242, 244): Line 244 P1 states vendor-recommended weekly sensor cleaning was known to leave ammonium electrodes drifting about 0.4 mg/L per week, treating this drift figure as a known fact going into the work. Line 242 P5 frames the sensor accuracy question as fully unknown, with no baseline drift figure stated, which is consistent, but P1 of Line 244 also folds the routine weekly cleaning activity into the tested work rather than treating it only as the baseline being measured against, which blurs it with the excluded maintenance activity named in the Claim Exclusions. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 343/350 words, 36/50 lines |
| 246 | Claim Exclusion: Oversizing the biofilter as a cost/footprint tradeoff is a routine design/business response, not the eligible technological work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Spreading out feeding to avoid spikes is a routine operational/business choice farms reject due to labour cost, not technological development. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Routine vendor-recommended weekly manual sensor cleaning is standard maintenance, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Business impact framing (earlier stocking revenue, saved biofilter volume) is a commercial outcome, not a technological claim. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Change to standard design/commercial control package is routine implementation of already-established results, not uncertainty-driven investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: nitrification | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: total ammonia nitrogen (tan) | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: ammonium ion-selective electrode | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: feed-forward alkalinity dosing | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: media fill ratio | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: screened bypass sampling loop | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches U2 and U3 narrative closely. |
| 246 | Confidence Map: Trial 1 day counts for full nitrification across loops A, B, C at 8 C, consistent between transcript and document. | applied | none |  | Not mentioned; section covers P4 client only, not Trial 1 loops. |
| 246 | Confidence Map: Nitrite stall duration figures differ slightly in framing but are consistent compatible measurements (transcript gives approximate, document gives precise days). | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Transcript's approximate nitrite stall description for loop B (about three weeks) is compatible with document's precise 19 days. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 2 seed fraction results at 6 C. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Client farm application result, reported only once but uncontradicted. | applied | none |  | Client farm result stated once, matches partial evidence. |
| 246 | Confidence Map: Trial 3 baseline TAN peak and alkalinity/pH drop under pH-setpoint dosing. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Feed-forward dosing result including a bicarbonate usage increase noted only in the document, not in the transcript. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 4 fill ratio results and dead-zone DO readings, with precise DO figures only in the document. | applied | none |  | Fill ratio results stated as established figures match map. |
| 246 | Confidence Map: Trial 5 sensor comparison counts, including total lab reference sample count only given in the document. | applied | none |  | Sensor comparison figures stated match partial entry. |
| 246 | Confidence Map: Ammonium membrane replacement interval and whether it can be extended remains an open, unresolved question. | applied | none |  | Membrane longevity stated as open, hedged appropriately. |
| 246 | Confidence Map: Whether the feed-forward dosing rule needs adjustment for fish size is explicitly unresolved. | applied | none |  | Fish-size adjustment stated as open, matches unresolved. |
| 246 | Confidence Map: Stocking density and fish weight range for the pilot, reported only in the document. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Biofilter media specific surface area, a detail only in the document. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: recirculating aquaculture system (ras) | applied | none |  | Concept absent from section, only RAS context implied. |
| 246 | Glossary Term: moving bed biofilter | applied | none |  | Term not used; only generic 'media fill ratio' discussed. |
| 246 | Glossary Term: ammonium ion-selective electrode | applied | none |  | Says 'ammonium electrodes' not full term verbatim.; repaired to the Glossary Term |
| 246 | Glossary Term: stepwise temperature acclimation | applied | none |  | Concept absent; section does not discuss seeding acclimation. |
| 246 | Glossary Term: nitrite stall | applied | none |  | Concept absent; section does not discuss nitrite stall. |
| 246 | Cover signed-off Summary item ys76zg57rnz9tgjb5161jcw4tn8ffsxt | applied | none |  | P2 states fill ratio as separate additive buffering mechanism. |
| 246 | Cover signed-off Summary item ys7b60d3x2eve30d7pe0sq8eg58ff258 | applied | none | 2 | P3 states direct sensor drift figures as drafted. |
| 246 | Cover signed-off Summary item ys72p1fvrvmd1xt4334nrvz0b98fenee | applied | none | 2 | P3 states bypass loop accuracy figures as drafted. |
| 246 | Cover signed-off Summary item ys70sj8j87a0dsgrxbpvha4f8d8ff52f | applied | none |  | P4 covers farm application and pilot loop rollout. |
| 246 | Cover signed-off Summary item ys73r25nekvmnpnkkfq9bfstsd8ffa40 | applied | none |  | P5 states the fold-in improvement to TAN control design. |
| 246 | Leave out the uncertainty the writer dropped: "It was uncertain whether stepwise acclimation could overcome cold shock since nitrite oxidizers..." | applied | none |  | No seeding/acclimation or nitrite-oxidizer content present. |
| 246 | State each result against its target as the numbers show | applied | none |  | All target comparisons match the numbers shown. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements answer dosing, fill ratio, or sensor… |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 242, 244, 246): Line 242 P4 sets the technological objective as reaching full nitrification in under 5 weeks (35 days) at 8 C, and Line 244 does not report any trial result for start-up time at all. Line 246 P4 then reports a field result of 34 days at 7-8 C as if it were the proven outcome of that objective, but no paragraph in Line 244 shows the stepwise temperature acclimation experiment or its data. Reporting a result with no supporting work shown in the Work Performed section is inconsistent across the three sections. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 4 (sections 242, 244, 246): The statement that the feed-forward dosing and 55 percent fill ratio combination now runs on all four pilot loops describes rollout into the standard control package. The Claim Exclusions list states that a change to the standard design or commercial control package is routine implementation of already-established results, not uncertainty-driven work, so presenting this rollout as part of the advancement reads as claiming excluded work. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 24.
- Line 244: 0 labels and 0 plan checks "Not checked" of 25.
- Line 246: 0 labels and 0 plan checks "Not checked" of 27.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.4 s, p95 24.1 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 17.7 s, p95 17.7 s over 1.
- Sign-off to report created: 103.7 s.
- Cost from aiUsage: $1.11 in all ($0.42 seed stage, $0.69 Brief, drafting and checks) over 40 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T03:28:33.739Z created project k979n57rvvsc37a6f8ytdnna6n8ffpya
2026-10-01T03:28:34.388Z added document biofilter-trial-summary.md
2026-10-01T03:28:35.653Z started Step by step generation k5738gcrmaw6q6x9x3d0tg0xch8ffn5w
2026-10-01T03:29:18.561Z seed stage open
2026-10-01T03:29:18.561Z Open Company / Context and wait for its Batch
2026-10-01T03:29:27.593Z Company / Context: select the first Seed
2026-10-01T03:29:29.493Z Approve Company / Context
2026-10-01T03:29:31.411Z approved company_context
2026-10-01T03:29:31.412Z Open Goal / Problem and wait for its Batch
2026-10-01T03:29:43.016Z Goal / Problem: select the first Seed
2026-10-01T03:29:44.898Z Approve Goal / Problem
2026-10-01T03:29:46.787Z approved goal_problem
2026-10-01T03:29:46.787Z Open Technological limitations and wait for its Batch
2026-10-01T03:30:01.001Z Technological limitations: select the first Seed
2026-10-01T03:30:02.980Z Approve Technological limitations
2026-10-01T03:30:04.923Z approved passive_limitations
2026-10-01T03:30:04.924Z Open Technological objectives and wait for its Batch
2026-10-01T03:30:19.257Z Technological objectives: select the first Seed
2026-10-01T03:30:21.158Z Approve Technological objectives
2026-10-01T03:30:23.095Z approved technological_objective
2026-10-01T03:30:23.095Z Open Technological uncertainties and wait for its Batch
2026-10-01T03:30:37.379Z Technological uncertainties: select the first 3 Seeds
2026-10-01T03:30:41.796Z Approve Technological uncertainties
2026-10-01T03:30:43.741Z approved active_uncertainties
2026-10-01T03:30:43.741Z Skip Previous-year status
2026-10-01T03:30:45.015Z Open Work plan and wait for its Batch
2026-10-01T03:31:05.658Z Work plan: select the first Seed
2026-10-01T03:31:07.574Z Approve Work plan
2026-10-01T03:31:09.504Z approved workplan
2026-10-01T03:31:09.504Z Open Hypothesis and wait for its Batch
2026-10-01T03:31:34.332Z Hypothesis: select the first Seed
2026-10-01T03:31:36.248Z Approve Hypothesis
2026-10-01T03:31:38.200Z approved hypothesis
2026-10-01T03:31:38.200Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T03:32:05.605Z Experimentation / Iterations: select 3 experiments by the uncertainty each tested, one for each picked uncertainty first, covering at least 2 (regenerating up to twice to find them)
2026-10-01T03:32:11.927Z Approve Experimentation / Iterations
2026-10-01T03:32:13.866Z approved experimentation
2026-10-01T03:32:13.867Z Open Advancement to science / technology and wait for its Batch
2026-10-01T03:32:28.130Z Advancement to science / technology: select the first Seed
2026-10-01T03:32:30.257Z Approve Advancement to science / technology
2026-10-01T03:32:32.186Z approved overall_advancement
2026-10-01T03:32:32.186Z Open Specific technological advancements and wait for its Batch
2026-10-01T03:32:49.053Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T03:32:54.319Z Approve Specific technological advancements
2026-10-01T03:32:56.233Z approved specific_advancements
2026-10-01T03:32:56.233Z Open Project status and next steps and wait for its Batch
2026-10-01T03:33:07.879Z Project status and next steps: select the first Seed
2026-10-01T03:33:09.783Z Approve Project status and next steps
2026-10-01T03:33:11.755Z approved project_status
2026-10-01T03:33:11.756Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T03:33:26.044Z Overall company / project goal improvements: select the first Seed
2026-10-01T03:33:27.946Z Approve Overall company / project goal improvements
2026-10-01T03:33:29.925Z approved goal_improvements
2026-10-01T03:33:29.925Z Technological uncertainties: untick the uncertainty most selected advancements link to
2026-10-01T03:33:32.513Z Approve Technological uncertainties
2026-10-01T03:33:34.451Z approved active_uncertainties
2026-10-01T03:33:34.451Z Work plan: read what the step says about its links, expect the refusal where a pick plans work for the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-01T03:33:35.073Z workplan link notice: none
2026-10-01T03:33:37.637Z workplan: no pick answers the dropped uncertainty or states its result
2026-10-01T03:33:37.637Z Hypothesis: read what the step says about its links, expect the refusal where a pick tests the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-01T03:33:38.301Z hypothesis link notice: plans_for_dropped_uncertainty
2026-10-01T03:33:42.607Z hypothesis: refused (PLAN_FOR_DROPPED_UNCERTAINTY)
2026-10-01T03:33:45.740Z untick hypothesis idea yn7fqgvzwynacz9b10dpm3pmzh8fe4ab, which answers the dropped uncertainty or states its result
2026-10-01T03:33:47.661Z hypothesis: picked yn76jfmmvm8rhzw1x3k2pxeman8femp9, which answers a kept uncertainty
2026-10-01T03:33:53.534Z approved hypothesis (confirmed 1 carried)
2026-10-01T03:33:53.534Z Experimentation / Iterations: read what the step says about its links before approving
2026-10-01T03:33:54.197Z experimentation link notice: experiments_for_dropped_uncertainty
2026-10-01T03:33:54.197Z Experimentation / Iterations: try to approve and expect the refusal for experiments that tested the dropped uncertainty
2026-10-01T03:33:56.159Z experimentation: refused (EXPERIMENT_FOR_DROPPED_UNCERTAINTY)
2026-10-01T03:33:56.159Z Experimentation / Iterations: untick the experiments that tested the dropped uncertainty (regenerating for the kept uncertainties if none is left)
2026-10-01T03:33:59.285Z untick experiment yn7ccps6bfktxy0447yh3zc1t58feeta, which tested the dropped uncertainty
2026-10-01T03:33:59.927Z Approve Experimentation / Iterations
2026-10-01T03:34:01.888Z approved experimentation (confirmed 2 carried)
2026-10-01T03:34:01.888Z Specific technological advancements: read what the step says about its links before approving
2026-10-01T03:34:02.535Z specific_advancements link notice: unlinked_advancements
2026-10-01T03:34:02.535Z Specific technological advancements: try to approve and expect the unlinked-advancement refusal
2026-10-01T03:34:04.456Z specific_advancements: refused (UNLINKED_ADVANCEMENT)
2026-10-01T03:34:04.456Z Specific technological advancements: Regenerate and wait for the fresh Batch
2026-10-01T03:34:21.445Z Specific technological advancements: untick advancements whose links are no longer active
2026-10-01T03:34:25.316Z untick unlinked advancement yn7cwwxd5r78jf6q006jpv09qd8ffe58
2026-10-01T03:34:26.617Z untick unlinked advancement yn7ct8677jvcaa2wc0bb9whq0n8ffmez
2026-10-01T03:34:26.617Z Specific technological advancements: select 2 linked advancements sharing one uncertainty (regenerating up to twice to find them)
2026-10-01T03:34:31.756Z Approve Specific technological advancements
2026-10-01T03:34:33.685Z approved specific_advancements
2026-10-01T03:34:33.685Z Advancement to science / technology: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-01T03:34:34.336Z overall_advancement link notice: results_for_dropped_uncertainty
2026-10-01T03:34:38.772Z overall_advancement: refused (RESULT_FOR_DROPPED_UNCERTAINTY)
2026-10-01T03:34:41.948Z untick overall_advancement idea yn79dvtgfm0dwr31x3avedsfcn8ffeh7, which answers the dropped uncertainty or states its result
2026-10-01T03:34:43.858Z overall_advancement: picked yn7dsd6bm4yzbxqstetpxk9bsh8ferc2, which answers a kept uncertainty
2026-10-01T03:34:49.492Z approved overall_advancement (confirmed 1 carried)
2026-10-01T03:34:49.492Z Overall company / project goal improvements: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-01T03:34:50.152Z goal_improvements link notice: results_for_dropped_uncertainty
2026-10-01T03:34:55.538Z goal_improvements: refused (RESULT_FOR_DROPPED_UNCERTAINTY)
2026-10-01T03:34:58.596Z untick goal_improvements idea yn7e5q61pdcmyg7cs02a1779hd8fe33j, which answers the dropped uncertainty or states its result
2026-10-01T03:35:00.505Z goal_improvements: picked yn7dz1kwtk0jzvjsp53n6wd43x8ffxb0, which answers a kept uncertainty
2026-10-01T03:35:06.099Z approved goal_improvements (confirmed 1 carried)
2026-10-01T03:35:06.099Z Confirm and approve every Stale Subsection, in order
2026-10-01T03:35:12.364Z approved workplan (confirmed 1 carried)
2026-10-01T03:35:14.950Z approved specific_advancements (confirmed 2 carried)
2026-10-01T03:35:17.564Z approved project_status (confirmed 1 carried)
2026-10-01T03:35:17.564Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T03:35:18.874Z signed off; waiting for the report
2026-10-01T03:37:05.057Z report kd71bdehwsm9x9jt48warse42d8ffyf4 created
```
