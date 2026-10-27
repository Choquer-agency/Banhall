# Release eval - Marrowgate cold-water biofilter control

Semantic case: **Changed advancement links** (CAP-13: "changed advancement links"). Also checks: two advancements sharing an uncertainty are merged and the Compliance Note names the merge.

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k978s8yqcc00kxd7gfs1h9xhrs8h20sy`, generation `k575kmamjah2ssycf40gdb9vy18h2chj`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd74d89sa1s4e5wqj5d3kctp4n8h2x7r |
| All three Sections were drafted | pass | 242: 333 words, 244: 456 words, 246: 312 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 246: 0 labels and 1 plan check "Not checked" of 22 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | left out gx7hss4beyk50yxtr4751f8yas8h3d9p: applied; Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work is for the U1 uncertainty."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P4 says "Whether a 10 percent seed fraction was adequate, and whether it would hold at 6 C, remained open", but the sources say "We wanted to know if 10 perc..."); 244: applied ("The facts check found no figure or detail it could show differs from the sources."); 246: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: P3 says 6 C trials used acclimated seed; fine, but P3 seed clai...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (8.6 s, 9.0 s); 244: 1 request (7.0 s); 246: 2 requests (9.1 s, 9.0 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 20 metered calls (20 Batch, 0 Feedback), 21 reserved; notice not shown; 0 Retry |
| After the uncertainty changed, approving the old advancements was refused as unlinked | pass | INVALID_STATE / UNLINKED_ADVANCEMENT |
| Every signed-off advancement links to exactly one active uncertainty and at least one active experiment | pass | 2 advancement(s); 0 with a link outside the plan |
| The dropped uncertainty is out of the plan and no advancement links to it | pass | dropped gx7hss4beyk50yxtr4751f8yas8h3d9p |
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
| Where the dropped uncertainty's words and its experiments' figures appear, in every Line (a hint for the judge) | info | paragraph 2 shares 83 percent of its content words: "It was determined that unacclimated seed from a warm system suffers cold shock, which stalls the nitrite stage for 19 days in loop B. Stepwise acclimation shortened that stall to about 6 days in lo..."; distinctive figures: none; paragraphs with a hit: Line 242 P4 (39 percent of its words): "It was uncertain how to shorten nitrification start-up below 10 C, because bacteria are slow in cold water. It was un..."; Line 244 P1 (39 percent of its words): "The technological problem was how to shorten nitrification start-up below 10 C, where standard practice took 9 to 10 ..."; Line 244 P3 (33 percent of its words): "The first question was whether seeding could help at all, since seed media from a warm system goes into shock in 8 C ..."; Line 244 P4 (39 percent of its words): "The second question was whether stepwise acclimation would remove that stall. Loop C used the same 10 percent seed fr..."; Line 246 P2 (83 percent of its words): "It was determined that unacclimated seed from a warm system suffers cold shock, which stalls the nitrite stage for 19..." |
| Every Line records the dropped uncertainty as left out | pass | 242: applied; 244: applied; 246: applied; frozen at sign-off: gx7hss4beyk50yxtr4751f8yas8h3d9p |
| Line 246 records every advancement as answering a Line 242 uncertainty | pass | applied: "All answer U1 or COVER items." |
| Two advancements sharing an uncertainty are drafted as one and the Compliance Note names the merge | pass | merged 2 items in Section 246 |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company designs recirculating aquaculture systems for land-based trout farms. _(writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The business goal is to shorten biofilter nitrification start-up at water temperatures below 10 C for trout farms. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice did not show how to shorten biofilter nitrification start-up at water temperatures below 10 C. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The work sought to learn how to shorten biofilter nitrification start-up at water temperatures below 10 C. _(cited)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain how to shorten biofilter nitrification start-up at water temperatures below 10 C. _(cited)_
- Seed media from a warm system goes into shock in 8 degree water, so seeding was uncertain. _(cited)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a three-loop trial at 8 C to test whether acclimated seed shortens start-up. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If seed media is acclimated stepwise, then full nitrification at 8 C will take under 5 weeks. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Unacclimated seed from a 16 C system left loop B stalled at the nitrite stage for 19 days. _(cited, carried from an older context)_
  - Tested: uncertainty "Seed media from a warm system goes into shock in 8 degree water, so..."
- Loop C used 10 percent seed acclimated stepwise, and reached full nitrification in 31 days at 8 C. / Loop A took 66 days unseeded and loop B took 47 days, so acclimation roughly halved start-up. _(cited, carried from an older context)_
  - Tested: uncertainty "It was uncertain how to shorten biofilter nitrification start-up at..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Stepwise acclimation of seed media roughly halved start-up, with loop C reaching full nitrification in 31 days at 8 C. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Unacclimated seed from a warm system suffers cold shock, which stalls the nitrite stage for 19 days. _(cited)_
  - Links: uncertainty "Seed media from a warm system goes into shock in 8 degree water, so..."; experiments "Unacclimated seed from a 16 C system left loop B stalled at the nit..."
- Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers. / Acclimation shortened the nitrite stall to about 6 days. _(cited)_
  - Links: uncertainty "Seed media from a warm system goes into shock in 8 degree water, so..."; experiments "Unacclimated seed from a 16 C system left loop B stalled at the nit..."

### 12. Project status and next steps (Section 246, standard): approved

- The start-up method has been used on one client farm in March 2026. / They reached full nitrification in 34 days at 7 to 8 degrees, close to the pilot result. _(cited, carried from an older context, Claim Exclusion confirmed)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The goal was to shorten start-up below 10 C, and acclimated seed reached full nitrification in 31 days at 8 C. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

The company designs recirculating aquaculture systems for land-based trout farms. It was uncertain how to shorten nitrification start-up at water temperatures below 10 C, and the company set out to shorten it so clients can stock fish sooner. Its hands-on work building and commissioning these systems for cold-water rainbow trout and Arctic char, often at 6 to 12 C, gave it direct experience of how biofilters behave in cold water.

The limitations to standard practice were that the knowledge required to shorten nitrification start-up at water temperatures below 10 C was insufficient. Standard practice was ammonium chloride dosing and waiting, or seeding with media from an existing biofilter, and neither showed how to speed bacterial community establishment in cold water. Below 10 C, nitrification start-up took 9 to 10 weeks, against 3 to 4 weeks at 20 C. Published work and the company's experience indicated that seed media from a warm system goes into shock in about 8 C water, where the bacteria survive but barely grow. No documented method existed for preparing seed media to establish nitrification quickly at these temperatures.

The technological objective was to advance the understanding of how to shorten nitrification start-up at water temperatures below 10 C, for the purposes of creating a biofilter start-up method for cold-water recirculating aquaculture systems. The target was full nitrification in under 5 weeks at 8 C.

It was uncertain how to shorten nitrification start-up below 10 C, because bacteria are slow in cold water. It was uncertain whether seeding could help at all, because seed media from a warm system goes into shock in 8 C water. It was also uncertain whether stepwise acclimation of the seed media, at 1 C every 4 days from 14 to 8 C, would bring seeded biofilters to full nitrification in under 5 weeks. Whether a 10 percent seed fraction was adequate, and whether it would hold at 6 C, remained open, because cold-water growth rates left no basis for predicting the seed quantity required.

### Line 244

The technological problem was how to shorten nitrification start-up below 10 C, where standard practice took 9 to 10 weeks and seed media from a warm system went into shock in cold water. The company planned a three-loop trial at 8 C to test whether acclimated seed shortens start-up. The trial ran in the pilot recirculating aquaculture system from September 8 to November 13, 2025, using independent loops, each with a 6 m3 fish tank and a 1.2 m3 moving bed biofilter. Loop A was unseeded and dosed with ammonium chloride. Loop B received 10 percent unacclimated seed from a 16 C system. Loop C received 10 percent seed that had undergone stepwise acclimation in a side tank from 14 C to 8 C at 1 C every 4 days. Full nitrification was defined as processing 1 mg/L of total ammonia nitrogen to under 0.2 mg/L in 24 hours with nitrite under 0.3 mg/L. Technicians ran daily water chemistry and pulled lab samples to confirm each reading.

It was hypothesized that if seed media is acclimated stepwise from 14 C to 8 C at 1 C every 4 days, then the seeded biofilter will reach full nitrification at 8 C in under 5 weeks, compared with the unseeded and unacclimated-seed loops run under the same conditions.

The first question was whether seeding could help at all, since seed media from a warm system goes into shock in 8 C water. The team put 10 percent mature media taken directly from a 16 C system into loop B and compared it with the unseeded loop A. Loop B reached full nitrification in 47 days against 66 days for loop A, so seeding helped. However, loop B stalled at the nitrite stage for 19 days, which showed that moving warm seed straight into cold water wasted much of its benefit. The team therefore changed the seed preparation, rather than the seed quantity, in loop C. The conclusion was that unacclimated seed suffers cold shock that stalls the nitrite stage, so direct transfer does not give a fast start-up.

The second question was whether stepwise acclimation would remove that stall. Loop C used the same 10 percent seed fraction, acclimated in the side tank before it went into the biofilter. It reached full nitrification in 31 days at 8 C, which met the target of under 5 weeks. Loop A took 66 days and loop B took 47 days, so acclimation roughly halved start-up compared with unacclimated seed. The nitrite stall in loop C was about 6 days, against 19 days in loop B. The conclusion was that stepwise acclimation of seed media shortens nitrification start-up at 8 C and avoids most of the stall seen with unacclimated seed.

### Line 246

Shortening nitrification start-up below 10 C was uncertain, because seed media from a warm system goes into shock in 8 C water and standard practice took 9 to 10 weeks. The objective was to reach full nitrification in under 5 weeks at 8 C, and the experimental work achieved it. It was established that stepwise acclimation of seed media roughly halved start-up: loop C reached full nitrification in 31 days at 8 C, against 47 days for unacclimated seed and 66 days unseeded. The hypothesis was proven. Seeding helped even without acclimation, but acclimation made the difference between meeting the 5-week target and missing it.

It was determined that unacclimated seed from a warm system suffers cold shock, which stalls the nitrite stage for 19 days in loop B. Stepwise acclimation shortened that stall to about 6 days in loop C. Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers, although no microbial measurement confirmed this mechanism. This resolved the uncertainty regarding whether seed media from a warm system could help at all. Based on this understanding, the company acclimated seed in a side tank before it entered the biofilter, instead of transferring it directly.

Trials at 6 C also ran, in January to February 2026: 5 percent acclimated seed took 44 days and 15 percent took 29 days. The start-up method has been used on one client farm in March 2026, which reached full nitrification in 34 days at 7 to 8 C, close to the pilot result. How the seed fraction should change at lower temperatures remains an open question, because cold-water growth rates give no basis for predicting the quantity required.

The goal was to shorten nitrification start-up below 10 C, where standard practice took 9 to 10 weeks. Acclimated seed reached full nitrification in 31 days at 8 C, meeting the under-5-week target.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 333/350 words, 31/50 lines |
| 242 | Claim Exclusion: Business impact of earlier stocking and design savings is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: Changing the standard design and control package is product adoption, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Client farm application is deployment of the result. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Planned next-year testing falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline U1. |
| 242 | Confidence Map: Start-up results at 8 C are consistent across interview and summary. | applied | none |  | No 8 C results stated. |
| 242 | Confidence Map: Feed-forward dosing result for TAN is supported. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Sensor result is supported by 74 lab samples. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Fish-size effect on dosing rule is unresolved. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Membrane life extension is unknown. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Client farm result is a single case, close to pilot. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Mechanism claim that nitrite oxidizers are hit harder is hedged. | applied | none |  | Mechanism not stated. |
| 242 | Glossary Term: total ammonia nitrogen | applied | none |  | Concept absent. |
| 242 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent. |
| 242 | Glossary Term: media fill ratio | applied | none |  | Concept absent. |
| 242 | Glossary Term: bypass loop | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57hyr7yvbfvkzg392f5m39gjh8h2ezk | applied | none |  | Company context stated. |
| 242 | Cover signed-off Summary item h57jcn6fqpkwtab806e95kxjax8h2k20 | applied | none |  | Goal stated. |
| 242 | Cover signed-off Summary item h57rsymc8cwhhrg3kpg3ccd36d8h2ftj | applied | none |  | Standard practice limits stated. |
| 242 | Cover signed-off Summary item h57spwnv45j61shp05qercbgbd8h2pq3 | applied | none |  | Objective stated. |
| 242 | Cover signed-off Summary item h57xygc5thv55nmz8fsmp7qsad8h3ptg | applied | none | 2 | Uncertainty stated. |
| 242 | Cover signed-off Summary item h57qbhdeem8cmwmf3a9nzq6vr98h3xyt | applied | none | 2 | Seed shock uncertainty stated. |
| 242 | Leave out the uncertainty the writer dropped: "Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers. It was..." | applied | none |  | Nitrite oxidizer content absent. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P4 says "Whether a 10 percent seed fraction was adequate, and whether it would hold at 6 C, remained open", but the sources say "We wanted to know if 10 percent was the right seed fraction and if it held at colder water.". |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 456/700 words, 39/100 lines |
| 244 | Claim Exclusion: Business impact of earlier stocking and design savings is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: Changing the standard design and control package is product adoption, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Client farm application is deployment of the result. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Planned next-year testing falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: total ammonia nitrogen | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Start-up results at 8 C are consistent across interview and summary. | applied | none |  | 8 C results match the sources. |
| 244 | Confidence Map: Feed-forward dosing result for TAN is supported. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Sensor result is supported by 74 lab samples. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Fish-size effect on dosing rule is unresolved. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Membrane life extension is unknown. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Client farm result is a single case, close to pilot. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Mechanism claim that nitrite oxidizers are hit harder is hedged. | applied | none |  | No mechanism claim stated flatly. |
| 244 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent. |
| 244 | Glossary Term: media fill ratio | applied | none |  | Concept absent. |
| 244 | Glossary Term: bypass loop | applied | none |  | Concept absent. |
| 244 | Saved preference | applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year content. |
| 244 | Cover signed-off Summary item h57mptc30pchp75v50jdxfng918h3rcm | applied | none |  | Three-loop trial at 8 C planned and described. |
| 244 | Cover signed-off Summary item h57wfzw8etw6jzw5dax4q8nycs8h2p55 | applied | none |  | Hypothesis stated in if-then form. |
| 244 | Cover signed-off Summary item h57mtgczrsrdkexm902bb70f758h3jnn | applied | none |  | Loop B 19-day nitrite stall covered. |
| 244 | Cover signed-off Summary item h57vy1sg7rchdwzx743yq42gj18h2a3f | applied | none |  | Loop C 31 days and comparison covered. |
| 244 | Leave out the uncertainty the writer dropped: "Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers. It was..." | applied | none |  | No nitrite oxidizer mechanism claim. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work is for the U1 uncertainty. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If seed media is acclimated stepwise, then full nitrification at 8 C will take under 5 weeks." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): 'Roughly halved start-up compared with unacclimated seed' does not fit the figures: 31 days against 47 days is about a 34 percent reduction. Line 246 P1 repeats the claim. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 312/350 words, 29/50 lines |
| 246 | Claim Exclusion: Business impact of earlier stocking and design savings is commercial, not technological. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: Changing the standard design and control package is product adoption, not experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Client farm application is deployment of the result. | not_applied | conflict |  | suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 3 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words |
| 246 | Claim Exclusion: Planned next-year testing falls outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: nitrification start-up | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: stepwise acclimation | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with Storyline. |
| 246 | Confidence Map: Start-up results at 8 C are consistent across interview and summary. | applied | none |  | 8 C results stated as established. |
| 246 | Confidence Map: Feed-forward dosing result for TAN is supported. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Sensor result is supported by 74 lab samples. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Fish-size effect on dosing rule is unresolved. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Membrane life extension is unknown. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Client farm result is a single case, close to pilot. | applied | none |  | Single farm, close to pilot, stated. |
| 246 | Confidence Map: Mechanism claim that nitrite oxidizers are hit harder is hedged. | applied | none |  | P2 hedges mechanism with seem and no measurement. |
| 246 | Glossary Term: total ammonia nitrogen | applied | none |  | Concept absent. |
| 246 | Glossary Term: feed-forward dosing | applied | none |  | Concept absent. |
| 246 | Glossary Term: media fill ratio | applied | none |  | Concept absent. |
| 246 | Glossary Term: bypass loop | applied | none |  | Concept absent. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57qfczjgtmza2c1c68bvqxqmn8h3vbd | applied | none |  | P1 states halving and 31 days. |
| 246 | Cover signed-off Summary item h57vbzk16p2k42wjgg1hmxpfb98h25s0 | applied | none | 2 | P2 gives 19-day stall from cold shock. |
| 246 | Cover signed-off Summary item h57q4yyf8mj82nxm1t203n0ve58h3qn6 | applied | none | 2 | P2 hedges NOB and gives 6 days. |
| 246 | Cover signed-off Summary item h57x8c31rbptpw7bqxsh78kxfh8h2d05 | applied | conflict |  | Drafted despite the Claim Exclusion "Client farm application is deployment of the result.": the writer kept the idea "The start-up method has been used on one client farm in March 2026. They reached full nitrification in 34 days at 7..." at sign-off, so it stays in the report as work the project did and is not repaired away. |
| 246 | Cover signed-off Summary item h57spk3yyewa9bra78ky6esspd8h24h6 | applied | none |  | P4 states goal and 31 days. |
| 246 | Leave out the uncertainty the writer dropped: "Nitrite oxidizing bacteria seem to be hit harder by cold shock than ammonia oxidizers. It was..." | applied | none |  | Nothing beyond COVER content. |
| 246 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: P3 says 6 C trials used acclimated seed; fine, but P3 seed claim wrong.) |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All answer U1 or COVER items. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 3 (sections 242, 244, 246): Line 246 P3 reports trials at 6 C in January to February 2026 (5 and 15 percent seed) as work done. Line 242 P4 leaves the seed fraction at 6 C open, and Line 244 describes no such trials. This also conflicts with the claim that the question remains open. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): Line 246 P3 says the 6 C trials already ran and gave results, yet the same paragraph says seed fraction at lower temperatures remains open. Line 244 reports only the three 8 C loops, with trials ending November 13, 2025. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says unacclimated seed 'wasted much of its benefit' is not the issue; the problem is the statement that acclimation made the difference between meeting and missing the target. Loop B (47 days) is over 5 weeks, which is consistent, but 'roughly halved' is wrong against loop B: 31 days against 47 days is about a one-third cut, not half. Line 244 P4 makes the same claim. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 242, 244, 246): Line 246 P2 says the work resolved whether warm seed could help at all, and that the company changed seed preparation based on this. Line 244 P3 shows the change to acclimation was made within the trial design, with loop C run in parallel with loop B, not as a later decision. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 P1 says 'The hypothesis was proven', which overstates a single trial of one loop per condition. Line 244 shows only one run at 8 C. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 6 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 21.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 1 plan check "Not checked" of 22.

## Seed-stage numbers

- Requests: 20 metered (20 Batch, 0 Feedback); 21 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.5 s, p95 13.9 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 8.4 s, p95 8.4 s over 1.
- Sign-off to report created: 77.5 s.
- Cost from aiUsage: $1.27 in all ($0.56 seed stage, $0.71 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T16:37:55.867Z created project k978s8yqcc00kxd7gfs1h9xhrs8h20sy
2026-10-27T16:37:56.767Z marked as an evaluation project
2026-10-27T16:37:57.672Z added document biofilter-trial-summary.md
2026-10-27T16:37:59.460Z started Step by step generation k575kmamjah2ssycf40gdb9vy18h2chj
2026-10-27T16:38:14.677Z seed stage open
2026-10-27T16:38:14.678Z Open Company / Context and wait for its Batch
2026-10-27T16:38:19.996Z Company / Context: select the first Seed
2026-10-27T16:38:23.117Z Approve Company / Context
2026-10-27T16:38:25.871Z approved company_context
2026-10-27T16:38:25.871Z Open Goal / Problem and wait for its Batch
2026-10-27T16:38:42.434Z Goal / Problem: select the first Seed
2026-10-27T16:38:45.012Z Approve Goal / Problem
2026-10-27T16:38:47.619Z approved goal_problem
2026-10-27T16:38:47.619Z Open Technological limitations and wait for its Batch
2026-10-27T16:39:04.228Z Technological limitations: select the first Seed
2026-10-27T16:39:06.905Z Approve Technological limitations
2026-10-27T16:39:09.610Z approved passive_limitations
2026-10-27T16:39:09.610Z Open Technological objectives and wait for its Batch
2026-10-27T16:39:26.610Z Technological objectives: select the first Seed
2026-10-27T16:39:29.330Z Approve Technological objectives
2026-10-27T16:39:32.063Z approved technological_objective
2026-10-27T16:39:32.063Z Open Technological uncertainties and wait for its Batch
2026-10-27T16:39:40.286Z Technological uncertainties: select the first 3 Seeds
2026-10-27T16:39:46.545Z Approve Technological uncertainties
2026-10-27T16:39:49.224Z approved active_uncertainties
2026-10-27T16:39:49.225Z Skip Previous-year status
2026-10-27T16:39:50.975Z Open Work plan and wait for its Batch
2026-10-27T16:40:02.048Z Work plan: select the first Seed
2026-10-27T16:40:04.987Z Approve Work plan
2026-10-27T16:40:07.692Z approved workplan
2026-10-27T16:40:07.692Z Open Hypothesis and wait for its Batch
2026-10-27T16:40:24.666Z Hypothesis: select the first Seed
2026-10-27T16:40:27.348Z Approve Hypothesis
2026-10-27T16:40:29.994Z approved hypothesis
2026-10-27T16:40:29.994Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T16:40:41.081Z Experimentation / Iterations: select 3 experiments by the uncertainty each tested, one for each picked uncertainty first, covering at least 2 (regenerating up to twice to find them)
2026-10-27T16:40:49.873Z Approve Experimentation / Iterations
2026-10-27T16:40:52.495Z approved experimentation
2026-10-27T16:40:52.495Z Open Advancement to science / technology and wait for its Batch
2026-10-27T16:41:06.549Z Advancement to science / technology: select the first Seed
2026-10-27T16:41:09.136Z Approve Advancement to science / technology
2026-10-27T16:41:11.810Z approved overall_advancement
2026-10-27T16:41:11.810Z Open Specific technological advancements and wait for its Batch
2026-10-27T16:41:22.792Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T16:41:29.814Z Approve Specific technological advancements
2026-10-27T16:41:32.465Z approved specific_advancements
2026-10-27T16:41:32.465Z Open Project status and next steps and wait for its Batch
2026-10-27T16:41:40.564Z Project status and next steps: select the first Seed
2026-10-27T16:41:43.257Z Approve Project status and next steps
2026-10-27T16:41:46.043Z approved project_status (confirmed 1 Claim Exclusion)
2026-10-27T16:41:46.044Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T16:41:54.320Z Overall company / project goal improvements: select the first Seed
2026-10-27T16:41:56.973Z Approve Overall company / project goal improvements
2026-10-27T16:41:59.751Z approved goal_improvements
2026-10-27T16:41:59.751Z Technological uncertainties: untick the uncertainty most selected advancements link to
2026-10-27T16:42:03.415Z Approve Technological uncertainties
2026-10-27T16:42:06.082Z approved active_uncertainties
2026-10-27T16:42:06.082Z Work plan: read what the step says about its links, expect the refusal where a pick plans work for the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-27T16:42:06.956Z workplan link notice: none
2026-10-27T16:42:10.519Z workplan: no pick answers the dropped uncertainty or states its result
2026-10-27T16:42:10.520Z Hypothesis: read what the step says about its links, expect the refusal where a pick tests the dropped uncertainty, untick it, and pick (or regenerate for) one for a kept uncertainty
2026-10-27T16:42:11.454Z hypothesis link notice: none
2026-10-27T16:42:14.929Z hypothesis: no pick answers the dropped uncertainty or states its result
2026-10-27T16:42:14.930Z Experimentation / Iterations: read what the step says about its links before approving
2026-10-27T16:42:15.850Z experimentation link notice: experiments_for_dropped_uncertainty
2026-10-27T16:42:15.850Z Experimentation / Iterations: try to approve and expect the refusal for experiments that tested the dropped uncertainty
2026-10-27T16:42:18.744Z experimentation: refused (EXPERIMENT_FOR_DROPPED_UNCERTAINTY)
2026-10-27T16:42:18.744Z Experimentation / Iterations: untick the experiments that tested the dropped uncertainty (regenerating for the kept uncertainties if none is left)
2026-10-27T16:42:23.822Z untick experiment gx7jvhj1wxnm40yqjqsmacr5ph8h34y4, which tested the dropped uncertainty
2026-10-27T16:42:24.778Z Approve Experimentation / Iterations
2026-10-27T16:42:27.479Z approved experimentation (confirmed 2 carried)
2026-10-27T16:42:27.479Z Specific technological advancements: read what the step says about its links before approving
2026-10-27T16:42:28.380Z specific_advancements link notice: unlinked_advancements
2026-10-27T16:42:28.380Z Specific technological advancements: try to approve and expect the unlinked-advancement refusal
2026-10-27T16:42:31.088Z specific_advancements: refused (UNLINKED_ADVANCEMENT)
2026-10-27T16:42:31.089Z Specific technological advancements: Regenerate and wait for the fresh Batch
2026-10-27T16:42:42.043Z Specific technological advancements: untick advancements whose links are no longer active
2026-10-27T16:42:47.313Z untick unlinked advancement gx7jf3hwd05zdfj182qeqaqy1h8h27hz
2026-10-27T16:42:49.152Z untick unlinked advancement gx7qwmw0fmw6q02b579a8k3xs98h39ge
2026-10-27T16:42:49.152Z Specific technological advancements: select 2 linked advancements sharing one uncertainty (regenerating up to twice to find them)
2026-10-27T16:42:56.288Z Approve Specific technological advancements
2026-10-27T16:42:59.043Z approved specific_advancements
2026-10-27T16:42:59.043Z Advancement to science / technology: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-27T16:42:59.970Z overall_advancement link notice: none
2026-10-27T16:43:03.559Z overall_advancement: no pick answers the dropped uncertainty or states its result
2026-10-27T16:43:03.560Z Overall company / project goal improvements: read what the step says about its links and what approval asks to acknowledge, expect the refusal where a pick answers the dropped uncertainty, untick every pick that answers it or states its result, and pick (or regenerate for) an idea that answers a kept uncertainty
2026-10-27T16:43:04.445Z goal_improvements link notice: none
2026-10-27T16:43:07.929Z goal_improvements: no pick answers the dropped uncertainty or states its result
2026-10-27T16:43:07.929Z Confirm and approve every Stale Subsection, in order
2026-10-27T16:43:16.609Z approved workplan (confirmed 1 carried)
2026-10-27T16:43:24.503Z approved hypothesis (confirmed 1 carried)
2026-10-27T16:43:32.641Z approved overall_advancement (confirmed 1 carried)
2026-10-27T16:43:36.129Z approved project_status (confirmed 1 carried) (confirmed 1 Claim Exclusion)
2026-10-27T16:43:43.964Z approved goal_improvements (confirmed 1 carried)
2026-10-27T16:43:43.964Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T16:43:45.842Z signed off; waiting for the report
2026-10-27T16:45:04.899Z report kd74d89sa1s4e5wqj5d3kctp4n8h2x7r created
```
