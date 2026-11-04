# Release eval - Marrowgate cold-water biofilter control

Semantic case: **Changed advancement links** (CAP-13: "changed advancement links"). Also checks: two advancements sharing an uncertainty are merged and the Compliance Note names the merge.

Run 2026-10-27 on `local` at commit `afbfd302`, acting as chat-live-1793085355051@example.test. Project `k975dnq31agme3fjvefszr14ds8h3nad`, generation `k57a347y44d74vnrpa6svszh898h2gdw`.

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

22 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7frgj9q3x652x2h6waj8z2658h2cys |
| All three Sections were drafted | pass | 242: 303 words, 244: 534 words, 246: 331 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 244: 0 labels and 1 plan check "Not checked" of 21 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | left out gx7z10jscx4snxjt3wxch088jn8h3q4s: applied; Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work is for the U1 uncertainty Line 242 states."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P1 says "the biological systems and controls groups have direct experience of how biofilters behave in these conditions", but the sources say "I lead the bio..."); 244: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: P3 says Loop A was a no-seed control, a minor stretch.)"); 246: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "against almost three weeks for Loop B", but t...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (10.4 s, 11.3 s); 244: 2 requests (8.4 s, 11.2 s); 246: 2 requests (8.8 s, 7.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (17 Batch, 0 Feedback), 18 reserved; notice not shown; 0 Retry |
| After the uncertainty changed, approving the old advancements was refused as unlinked | pass | INVALID_STATE / UNLINKED_ADVANCEMENT |
| Every signed-off advancement links to exactly one active uncertainty and at least one active experiment | pass | 2 advancement(s); 0 with a link outside the plan |
| The dropped uncertainty is out of the plan and no advancement links to it | pass | dropped gx7z10jscx4snxjt3wxch088jn8h3q4s |
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
| After the uncertainty was dropped, approving a Hypothesis or Work plan pick that tested it was refused | info | not applicable: no picked Hypothesis or Work plan idea recorded the dropped uncertainty |
| Every signed-off Hypothesis and Work plan item records only uncertainties the plan still holds | pass | 2 item(s), each recording only uncertainties the plan holds |
| Where the dropped uncertainty's words and its experiments' figures appear, in every Line (a hint for the judge) | info | paragraph 1 shares 25 percent of its content words: "The uncertainty was whether stepwise acclimation of seed media could shorten nitrification start-up below 10 C, where warm seed goes into shock and growth was in doubt. The objective was to underst..."; distinctive figures: 2.3 mg/L, 1.2 mg/L, 40 percent, 55 percent, 65 percent, 0.8 mg/L, 1.1 mg/L, 1 mg/L; paragraphs with a hit: Line 242 P1 (33 percent of its words): "Slow nitrification start-up in cold water was the uncertainty that drove this project: it was unknown how to shorten ..."; Line 244 P1 (33 percent of its words; 1 mg/L): "The technical uncertainty was whether nitrification start-up below 10 C could be shortened by preparing seed media be..." |
| Every Line records the dropped uncertainty as left out | pass | 242: applied; 244: applied; 246: applied; frozen at sign-off: gx7z10jscx4snxjt3wxch088jn8h3q4s |
| Line 246 records every advancement as answering a Line 242 uncertainty | pass | applied: "All claims answer stated uncertainties." |
| Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge | pass | merged 2 items in Section 246 |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs recirculating aquaculture systems for land-based trout farms. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The company designs recirculating aquaculture systems for land-based trout farms, including tanks, biofilters, oxygen systems and controls. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard start-up is to dose ammonium chloride and wait, or to seed with media from an existing biofilter. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The objective was to learn how to get cold-water start-up under 5 weeks at 8 C. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether stepwise acclimation could shorten nitrification start-up at water temperatures below 10 C. / Warm seed media goes into shock in 8 degree water, so growth was in doubt. _(cited)_
- It was unclear if nitrite oxidizing bacteria were the bottleneck, since cold shock seemed to hit them harder. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team tested whether stepwise acclimation of seed media shortens start-up, using three loops at 8 C. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If seed media is acclimated stepwise, then start-up at 8 C will take under 5 weeks. / Acclimation drops temperature 1 C every 4 days from 14 C to 8 C, instead of moving seed straight into cold water. _(writer-asserted, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Unacclimated seed at 8 C took 47 days, against 66 days for the unseeded control. _(cited, carried from an older context)_
  - Tested: uncertainty "It was uncertain whether stepwise acclimation could shorten nitrifi..."
- Loop B stalled at the nitrite stage for 19 days, against 6 days with acclimated seed. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unclear if nitrite oxidizing bacteria were the bottleneck, s..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Stepwise acclimation cut start-up at 8 C to 31 days, against 47 days for unacclimated seed. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Unacclimated seed at 8 C took 47 days, which showed that warm seed media still helps over no seed. _(cited)_
  - Links: uncertainty "It was uncertain whether stepwise acclimation could shorten nitrifi..."; experiments "Unacclimated seed at 8 C took 47 days, against 66 days for the unse..."
- Warm seed dropped straight into cold water gave only a partial gain, so the shock limited growth. / Acclimation was needed to cut start-up well below the 47 days. _(cited)_
  - Links: uncertainty "It was uncertain whether stepwise acclimation could shorten nitrifi..."; experiments "Unacclimated seed at 8 C took 47 days, against 66 days for the unse..."

### 12. Project status and next steps (Section 246, standard): approved

- Open work remains on whether the feed-forward rule needs to change with fish size. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Stepwise acclimation of seed media cut start-up at 8 C to 31 days, against 47 days for unacclimated seed. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

Slow nitrification start-up in cold water was the uncertainty that drove this project: it was unknown how to shorten start-up below 10 C in biofilm-heavy recirculating aquaculture system (RAS) water. The company designs recirculating aquaculture systems for land-based trout farms, including tanks, biofilters, oxygen systems and controls. It set out to make its cold-water biofilters start up faster. Clients run cold water, often 6 to 12 C, and the biological systems and controls groups have direct experience of how biofilters behave in these conditions.

The limitations to standard practice were that the knowledge required to speed nitrification start-up below 10 C was insufficient. Standard start-up is to dose ammonium chloride and wait, or to seed with media from an existing biofilter. Start-up took 9 to 10 weeks below 10 C, versus 3 to 4 weeks at 20 C. Published work and the company's experience indicated that seed media from a warm system goes into shock in 8 C water, where the bacteria survive but barely grow. No documented method was known for preparing seed media to grow at these temperatures.

The technological objective was to advance the understanding of cold-water (below 10 C) nitrification start-up, for the purpose of improving the design of RAS biofilters so that start-up takes under 5 weeks at 8 C.

It was uncertain whether stepwise acclimation of seed media, lowering temperature 1 C every 4 days from 14 to 8 C, could shorten nitrification start-up at 8 C. Warm seed media goes into shock at that temperature, so it was unknown whether gradual cooling would restore growth. It was also uncertain whether a 10 percent seed fraction was adequate, and whether it would hold at 6 C. It was unclear whether nitrite oxidizing bacteria were the bottleneck, since cold shock seemed to hit them harder than ammonia oxidizers.

### Line 244

The technical uncertainty was whether nitrification start-up below 10 C could be shortened by preparing seed media before it entered cold water. Standard start-up took 9 to 10 weeks below 10 C, and warm seed media goes into shock in 8 C water. The company treated this as a separate question from its other cold-water biofilter work, so that each change could be linked to one result. The team tested whether stepwise acclimation of seed media shortens start-up, using three loops at 8 C. Each loop was a 1.2 m3 moving bed biofilter on the pilot RAS. Full nitrification was defined as processing 1 mg/L TAN to under 0.2 mg/L in 24 h. Nitrite also had to stay under 0.3 mg/L. Lab wet chemistry gave the reference for each reading.

It was hypothesized that if seed media is acclimated stepwise, then nitrification start-up at 8 C will take under 5 weeks. Acclimation drops temperature 1 C every 4 days from 14 C to 8 C, instead of moving seed straight into cold water. Unacclimated seed is expected to take longer, at 47 days. Any acclimated loop needing 35 days or more would disprove the hypothesis. [GAP: the reason for choosing 1 C every 4 days and the 14 C starting point was not given.]

The first question was whether warm seed alone would help at 8 C, given the shock seen in cold water. Loop A received no seed, only ammonium chloride dosing. Loop B had 10 percent of its media replaced with mature media from a 16 C production system, moved straight in. Loop A took 66 days to reach full nitrification and Loop B took 47 days. Seed therefore helped, but only partly, and the shock limited growth. This showed that the seed needed preparation before it could cut start-up much further.

The second question was whether stepwise acclimation would restore growth and shorten the stall at the nitrite stage. Loop C used the same 10 percent seed fraction as Loop B, but the seed was first held in a side tank and cooled 1 C every 4 days from 14 to 8 C. Loop C reached full nitrification in 31 days, against 47 days for unacclimated seed, which met the target of under 5 weeks. Loop B had stalled at the nitrite stage for 19 days, against 6 days for Loop C. Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers, which would make them the bottleneck. This is an inference from one stall observation, and the bacterial populations were not measured. [GAP: no replicate loops are described, so confidence in the single-loop results is unclear.]

The third question was whether the result would hold at 6 C and whether the 10 percent seed fraction was adequate. The team ran two loops at 6 C with acclimated seed at 5 and 15 percent. The 5 percent loop took 44 days, which missed the 5-week target. The 15 percent loop took 29 days, which met it. At 6 C more seed was therefore needed, and returns appeared to flatten above about 10 to 15 percent. [GAP: why the 5 percent loop missed the target was not examined.]

### Line 246

The uncertainty was whether stepwise acclimation of seed media could shorten nitrification start-up below 10 C, where warm seed goes into shock and growth was in doubt. The objective was to understand cold-water nitrification start-up well enough to design RAS biofilters that start up in under 5 weeks at 8 C. That objective was met at 8 C: stepwise acclimation cut start-up to 31 days, against 47 days for unacclimated seed. The hypothesis was proven at 8 C. At 6 C, 5 percent acclimated seed took 44 days and missed the target, while 15 percent seed took 29 days and met it.

It was determined that warm seed media still helps at 8 C without acclimation, but only partly. Unacclimated seed took 47 days, against 66 days for the unseeded control. This resolved the uncertainty regarding whether warm seed could grow in 8 C water. Warm seed dropped straight into cold water gave only a partial gain, so the shock limited growth. Acclimation was needed to cut start-up well below 47 days.

Through this investigation, it was established that stepwise acclimation restores growth in shocked seed media. This resolved the uncertainty regarding whether gradual cooling from 14 to 8 C would shorten start-up. Loop B stalled at the nitrite stage for 19 days (almost three weeks), against 6 days for Loop C. Nitrite oxidizing bacteria seem to be the bottleneck, but this is an inference, since the bacterial populations were not measured. Each condition ran as a single loop, so replicate confidence is unknown.

Open work remains on whether the feed-forward rule needs to change with fish size. The seed fraction at 6 C also remains open below 15 percent, since only the 5 and 15 percent loops were run.

The knowledge gained answers the project goal of faster cold-water nitrification start-up. Stepwise acclimation of seed media cut start-up at 8 C to 31 days, against 47 days for unacclimated seed. This improved the biofilter start-up process for cold-water RAS designs.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 303/350 words, 29/50 lines |
| 242 | Claim Exclusion: Business impact (earlier stocking, revenue, design volume savings) is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Changing the standard design and control package is commercial implementation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Client farm application is routine use of the result, not experimentation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Routine daily water chemistry and sampling by technicians. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Planned next-year work falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline U1. |
| 242 | Confidence Map: Experiment 1 start-up results are consistent across both sources. | applied | none |  | No firm contradiction of results. |
| 242 | Confidence Map: Trial 3 baseline and feed-forward TAN results. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Sensor results over 4 weeks are supported, but membranes still need replacement and the extension is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the feed-forward rule must change with fish size is open. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The client farm result is a single application, close to but not the same as pilot conditions. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Nitrite oxidizers as the bottleneck is an inference (seem to be) from one stall observation. | applied | none |  | P4 hedges: unclear, seemed. |
| 242 | Glossary Term: total ammonia nitrogen | applied | none |  | Concept absent. |
| 242 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent. |
| 242 | Glossary Term: media fill ratio | applied | none |  | Concept absent. |
| 242 | Glossary Term: bypass loop | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57xcq03jcmjfyw5tftmm1yp498h3rzn | applied | none |  | P1 states the company designs RAS for trout farms. |
| 242 | Cover signed-off Summary item h57hv7eg1j8g0fy3chr7x7q1ds8h38nr | applied | none |  | P1 lists tanks, biofilters, oxygen systems, controls. |
| 242 | Cover signed-off Summary item h57vcd5ffz9eqjt0cctm3gdk3n8h310x | applied | none |  | P2 states standard start-up. |
| 242 | Cover signed-off Summary item h57qdr5eaq5yr4ws199zs4b3dd8h3bpf | applied | none |  | P3 gives objective under 5 weeks at 8 C. |
| 242 | Cover signed-off Summary item h57xkprezav46wejpf6mfa2hsh8h3fkh | applied | none | 2 | P4 states acclimation uncertainty and shock. |
| 242 | Cover signed-off Summary item h57sjm1b8mkw7yyhm5jasn282s8h2b2x | applied | none | 2 | P4 hedges nitrite oxidizer bottleneck. |
| 242 | Leave out the uncertainty the writer dropped: "It was uncertain how to keep TAN from spiking after feeding surges without oversizing the biofilter." | applied | none |  | No TAN spike content in the section. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P1 says "the biological systems and controls groups have direct experience of how biofilters behave in these conditions", but the sources say "I lead the biological systems group. I've been here nine years.". |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 489/700 words, 41/100 lines |
| 244 | Claim Exclusion: Business impact (earlier stocking, revenue, design volume savings) is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Changing the standard design and control package is commercial implementation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Client farm application is routine use of the result, not experimentation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Routine daily water chemistry and sampling by technicians. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Planned next-year work falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline U1 figures. |
| 244 | Confidence Map: Experiment 1 start-up results are consistent across both sources. | applied | none |  | Experiment 1 figures match the sources. |
| 244 | Confidence Map: Trial 3 baseline and feed-forward TAN results. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Sensor results over 4 weeks are supported, but membranes still need replacement and the extension is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Whether the feed-forward rule must change with fish size is open. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: The client farm result is a single application, close to but not the same as pilot conditions. | applied | none |  | Client farm result not mentioned. |
| 244 | Confidence Map: Nitrite oxidizers as the bottleneck is an inference (seem to be) from one stall observation. | applied | none |  | P4 hedges the bottleneck as an inference. |
| 244 | Glossary Term: total ammonia nitrogen | applied | none |  | Concept absent from the section. |
| 244 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent from the section. |
| 244 | Glossary Term: media fill ratio | applied | none |  | Concept absent from the section. |
| 244 | Glossary Term: bypass loop | applied | none |  | Concept absent from the section. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status absent. |
| 244 | Cover signed-off Summary item h57s97pj3bbdc8dhmh24ftc6598h37ka | applied | none |  | P1 states the test with three loops at 8 C. |
| 244 | Cover signed-off Summary item h57w9k3pzmyhq96qspq38rra918h2x32 | applied | none |  | P2 gives the hypothesis and the acclimation steps. |
| 244 | Cover signed-off Summary item h57z044a0425jt4664km4m89th8h3p20 | applied | none |  | P3 gives 47 days against 66 days. |
| 244 | Cover signed-off Summary item h57yx9kcvmqgnphdxmejn73bkx8h2cee | applied | none |  | P4 gives the 19 day and 6 day stalls. |
| 244 | Leave out the uncertainty the writer dropped: "It was uncertain how to keep TAN from spiking after feeding surges without oversizing the biofilter." | applied | none |  | No U2 content in the section. |
| 244 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: P3 says Loop A was a no-seed control, a minor stretch.) |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work is for the U1 uncertainty Line 242 states. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team tested whether stepwise acclimation of seed media shortens start-up, using three loops at 8 C." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Loop B stalled at the nitrite stage for 19 days, against 6 days with acclimated seed." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 1 (sections 242, 244): Line 244 P1 describes the work as treated separately from other cold-water biofilter work. Line 242 P1 frames the whole project as making cold-water biofilters start up faster. The scope of the project differs between the two. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 331/350 words, 32/50 lines |
| 246 | Claim Exclusion: Business impact (earlier stocking, revenue, design volume savings) is not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Changing the standard design and control package is commercial implementation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Client farm application is routine use of the result, not experimentation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Routine daily water chemistry and sampling by technicians. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Planned next-year work falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Experiment 1 start-up results are consistent across both sources. | applied | none |  | Figures match the established results. |
| 246 | Confidence Map: Trial 3 baseline and feed-forward TAN results. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Sensor results over 4 weeks are supported, but membranes still need replacement and the extension is unknown. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether the feed-forward rule must change with fish size is open. | applied | none |  | P4 states it as open. |
| 246 | Confidence Map: The client farm result is a single application, close to but not the same as pilot conditions. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Nitrite oxidizers as the bottleneck is an inference (seem to be) from one stall observation. | applied | none |  | P3 hedges it as an inference. |
| 246 | Glossary Term: total ammonia nitrogen | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent apart from the open item. |
| 246 | Glossary Term: media fill ratio | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: bypass loop | applied | none |  | Not mentioned in the section. |
| 246 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57ncs4s92tz93d55nb4n6qbgd8h31ej | applied | none |  | P1 states 31 vs 47 days. |
| 246 | Cover signed-off Summary item h57vmeqm18q2pe3ajw7t26vv5h8h2c1x | applied | none | 2 | P2 gives 47 vs 66 days. |
| 246 | Cover signed-off Summary item h57jk9kmbfmrqbvrkcnjxs3tk58h2qg8 | applied | none | 2 | P2 states partial gain and need for acclimation. |
| 246 | Cover signed-off Summary item h57z8f686erz22q1gezhq3f08h8h206k | applied | none |  | P4 states the fish-size open work. |
| 246 | Cover signed-off Summary item h57sx8j1fexf6cew1fxk0tch098h28ht | applied | none |  | P5 states the improvement. |
| 246 | Leave out the uncertainty the writer dropped: "It was uncertain how to keep TAN from spiking after feeding surges without oversizing the biofilter." | applied | none |  | No TAN spike content. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P3 says "against almost three weeks for Loop B", but the sources say "The nitrite stall lasted 19 days in B and 6 days in C.". |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claims answer stated uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Warm seed dropped straight into cold water gave only a partial gain, so the shock limited growth. Acclimation was neede..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 4 (sections 246): Line 246 P4 lists open work on whether the feed-forward rule needs to change with fish size. This is planned future work outside the claim period, and it is not part of the uncertainty stated in Line 242 or the work in Line 244. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the hypothesis was proven at 8 C. Line 244 P4 has only a single loop per condition with no replicates and calls the cause an inference, so 'proven' overstates what Line 244 supports. Line 246 P3 itself says replicate confidence is unknown. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 P2 says the 47 day versus 66 day result resolved whether warm seed could grow in 8 C water. Line 242 and Line 244 describe the seed as shocked, where bacteria survive but barely grow, and Line 244 P3 says shock limited growth. The two claims conflict. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 20.
- Line 244: 0 labels and 1 plan check "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 21.

## Seed-stage numbers

- Requests: 17 metered (17 Batch, 0 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 7.3 s, p95 15.8 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 21.6 s, p95 21.6 s over 1.
- Sign-off to report created: 101.6 s.
- Cost from aiUsage: $1.33 in all ($0.52 seed stage, $0.80 Brief, drafting and checks) over 35 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T18:53:47.611Z created project k975dnq31agme3fjvefszr14ds8h3nad
2026-10-27T18:53:48.556Z marked as an evaluation project
2026-10-27T18:53:49.536Z added document biofilter-trial-summary.md
2026-10-27T18:53:51.456Z started Step by step generation k57a347y44d74vnrpa6svszh898h2gdw
2026-10-27T18:54:05.148Z seed stage open
2026-10-27T18:54:05.149Z Open Company / Context and wait for its Batch
2026-10-27T18:54:16.788Z Company / Context: select the first Seed
2026-10-27T18:54:20.604Z Approve Company / Context
2026-10-27T18:54:24.146Z approved company_context
2026-10-27T18:54:24.147Z Open Goal / Problem and wait for its Batch
2026-10-27T18:54:34.368Z Goal / Problem: select the first Seed
2026-10-27T18:54:37.394Z Approve Goal / Problem
2026-10-27T18:54:40.232Z approved goal_problem
2026-10-27T18:54:40.232Z Open Technological limitations and wait for its Batch
2026-10-27T18:54:52.415Z Technological limitations: select the first Seed
2026-10-27T18:54:55.577Z Approve Technological limitations
2026-10-27T18:54:59.310Z approved passive_limitations
2026-10-27T18:54:59.310Z Open Technological objectives and wait for its Batch
2026-10-27T18:55:12.800Z Technological objectives: select the first Seed
2026-10-27T18:55:18.749Z Approve Technological objectives
2026-10-27T18:55:22.098Z approved technological_objective
2026-10-27T18:55:22.099Z Open Technological uncertainties and wait for its Batch
2026-10-27T18:55:35.706Z Technological uncertainties: select the first 3 Seeds
2026-10-27T18:55:45.129Z Approve Technological uncertainties
2026-10-27T18:55:48.420Z approved active_uncertainties
2026-10-27T18:55:48.420Z Skip Previous-year status
2026-10-27T18:55:51.315Z Open Work plan and wait for its Batch
2026-10-27T18:56:19.587Z Work plan: select the first Seed
2026-10-27T18:56:22.942Z Approve Work plan
2026-10-27T18:56:27.241Z approved workplan
2026-10-27T18:56:27.241Z Open Hypothesis and wait for its Batch
2026-10-27T18:56:37.036Z Hypothesis: select the first Seed
2026-10-27T18:56:40.414Z Approve Hypothesis
2026-10-27T18:56:45.567Z approved hypothesis
2026-10-27T18:56:45.569Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T18:56:57.862Z Experimentation / Iterations: select 3 experiments by the uncertainty each tested, one for each picked uncertainty first, covering at least 2 (regenerating up to twice to find them)
2026-10-27T18:57:09.005Z Approve Experimentation / Iterations
2026-10-27T18:57:15.479Z approved experimentation
2026-10-27T18:57:15.480Z Open Advancement to science / technology and wait for its Batch
2026-10-27T18:57:30.589Z Advancement to science / technology: select the first Seed
2026-10-27T18:57:34.474Z Approve Advancement to science / technology
2026-10-27T18:57:40.274Z approved overall_advancement
2026-10-27T18:57:40.275Z Open Specific technological advancements and wait for its Batch
2026-10-27T18:57:54.215Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T18:58:02.188Z Approve Specific technological advancements
2026-10-27T18:58:05.478Z approved specific_advancements
2026-10-27T18:58:05.478Z Open Project status and next steps and wait for its Batch
2026-10-27T18:58:14.814Z Project status and next steps: select the first Seed
2026-10-27T18:58:18.294Z Approve Project status and next steps
2026-10-27T18:58:23.249Z approved project_status
2026-10-27T18:58:23.249Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T18:58:32.748Z Overall company / project goal improvements: select the first Seed
2026-10-27T18:58:37.259Z Approve Overall company / project goal improvements
2026-10-27T18:58:40.778Z approved goal_improvements
2026-10-27T18:58:40.779Z Technological uncertainties: untick the uncertainty most selected advancements link to
2026-10-27T18:58:47.850Z Approve Technological uncertainties
2026-10-27T18:58:51.277Z approved active_uncertainties
2026-10-27T18:58:51.280Z Work plan: read what the step says about its links, expect the refusal where a pick plans work for the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-27T18:58:52.561Z workplan link notice: none
2026-10-27T18:58:57.551Z workplan: no pick answers the dropped uncertainty or states its result
2026-10-27T18:58:57.552Z Hypothesis: read what the step says about its links, expect the refusal where a pick tests the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-27T18:58:59.200Z hypothesis link notice: none
2026-10-27T18:59:04.069Z hypothesis: no pick answers the dropped uncertainty or states its result
2026-10-27T18:59:04.069Z Experimentation / Iterations: read what the step says about its links before approving
2026-10-27T18:59:04.990Z experimentation link notice: experiments_for_dropped_uncertainty
2026-10-27T18:59:04.990Z Experimentation / Iterations: try to approve and expect the refusal for experiments that tested the dropped uncertainty
2026-10-27T18:59:08.728Z experimentation: refused (EXPERIMENT_FOR_DROPPED_UNCERTAINTY)
2026-10-27T18:59:08.729Z Experimentation / Iterations: untick the experiments that tested the dropped uncertainty (regenerating for the kept uncertainties if none is left)
2026-10-27T18:59:14.126Z untick experiment gx7gbhhmc1vmqcjnqarrz4dg7n8h3p0x, which tested the dropped uncertainty
2026-10-27T18:59:15.061Z Approve Experimentation / Iterations
2026-10-27T18:59:18.574Z approved experimentation (confirmed 2 carried)
2026-10-27T18:59:18.574Z Specific technological advancements: read what the step says about its links before approving
2026-10-27T18:59:19.597Z specific_advancements link notice: unlinked_advancements
2026-10-27T18:59:19.598Z Specific technological advancements: try to approve and expect the unlinked-advancement refusal
2026-10-27T18:59:22.367Z specific_advancements: refused (UNLINKED_ADVANCEMENT)
2026-10-27T18:59:22.367Z Specific technological advancements: Regenerate and wait for the fresh Batch
2026-10-27T18:59:36.581Z Specific technological advancements: untick advancements whose links are no longer active
2026-10-27T18:59:43.521Z untick unlinked advancement gx7v7wtweqbpbx54vbep9g3cjs8h2r7j
2026-10-27T18:59:46.068Z untick unlinked advancement gx7h5mtgcmeg6pqnhpbpsdnmc98h37d1
2026-10-27T18:59:46.069Z Specific technological advancements: select 2 linked advancements sharing one uncertainty (regenerating up to twice to find them)
2026-10-27T18:59:54.751Z Approve Specific technological advancements
2026-10-27T18:59:57.850Z approved specific_advancements
2026-10-27T18:59:57.850Z Advancement to science / technology: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-27T18:59:58.882Z overall_advancement link notice: none
2026-10-27T19:00:03.756Z overall_advancement: no pick answers the dropped uncertainty or states its result
2026-10-27T19:00:03.757Z Overall company / project goal improvements: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-27T19:00:04.951Z goal_improvements link notice: none
2026-10-27T19:00:09.243Z goal_improvements: no pick answers the dropped uncertainty or states its result
2026-10-27T19:00:09.244Z Confirm and approve every Stale Subsection, in order
2026-10-27T19:00:21.518Z approved workplan (confirmed 1 carried)
2026-10-27T19:00:30.924Z approved hypothesis (confirmed 1 carried)
2026-10-27T19:00:40.444Z approved overall_advancement (confirmed 1 carried)
2026-10-27T19:00:45.164Z approved project_status (confirmed 1 carried)
2026-10-27T19:00:54.148Z approved goal_improvements (confirmed 1 carried)
2026-10-27T19:00:54.148Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T19:00:56.201Z signed off; waiting for the report
2026-10-27T19:02:37.912Z report kd7frgj9q3x652x2h6waj8z2658h2cys created
```
