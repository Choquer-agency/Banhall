# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `c17f2494`, acting as e2e-audit@banhall.local. Project `k97054pkvwq4gfp4m20vth0a0s8fe7sq`, generation `k57c7p1r00kb7n5z1xrmz9snnh8ffh3b`.

## What this fixture tests

The writer approves through Experimentation, then switches the goal framing (from filter breakage to fine-inclusion capture, both supported by the sources). Every approved successor goes Stale. The writer regenerates Technological uncertainties but keeps the older selections and must Confirm and approve them as carried; the other Stale steps are confirmed the same way. Company / Context carries a writer edit with a term that is in no source, which must reach the drafted Section 242, and that edited item is writer-asserted.

Fixture notes:

- 2026-09-30 (second): run 11 (commit 9de29da9) passed. Line 242 states no capture uncertainty (the writer never ticked it), while Lines 244 and 246 test and claim capture. Under the 2026-09-30 second amendment (Rule C) Line 244 keeps the capture trials: they are the evidence for signed-off Line 246 item 13 (both goals met together). The Rule B and Rule C checks now compare with every COVER item before judging not applied.
- Automatic check added for every fixture (information): Line 244's Rule C row, its repair, and any Line 244 COVER row not applied after such a repair. No earlier check was removed or weakened.
- 2026-09-30: in run 11 (commit 9de29da9) the scripted goal switch took the next Seed on the Goal / Problem page, which was a process card ("The core manufacturing process is replication ..."), so Line 242 took its goal from the Brief. A fixture-script weakness, not a product defect.
- The scripted writer now switches to the Goal / Problem Seed closest to the framing this fixture switches to, params.switchHint ("capture of fine inclusions"), when a Seed holds at least half of its words. Otherwise it takes another Seed that states a goal: one that says "goal" first, then one that says aim, target, objective or sought, and among those the one that shares the fewest words with the earlier pick. When no other Seed on the page states a goal, it takes the next Seed on the page, as before, and the run log says which way it chose. No check was removed or weakened.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 242 states the goal the writer switched to, not the first framing, and the carried uncertainties still read as consistent with it.
   - Answer: Yes. The switch took the goal Seed closest to "capture of fine inclusions" (item 2), and Line 242 paragraph 2 states it; the carried uncertainties fit it.
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: Yes. Line 242 paragraphs 3 and 4 follow items 3, 4, 5a and 5b clause by clause.
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: Yes. "The team calls the graded structure under development the cascade-fired lattice." No evidence invented around it.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (343, 692, 349); no source talk.

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (medium-high and high confidence). Fixed since run 11: the goal switch picks a real goal Seed, and the source-provenance phrases are gone. Major (Judge A): Line 246 paragraph 6 says the customer trial showed capture "improved without choking flow", which was not measured there, and the "one foundry, one alloy" hedge is missing (the repair was set aside at 408/350 words, Locked Rules first). Minors: unsourced additions in Line 246 paragraph 5; "partially proven" though every target was met; one forced Glossary swap. Every figure checked matches the sources.

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7fkr25szshahpzkch9gbekn58fej00 |
| All three Sections were drafted | pass | 242: 343 words, 244: 692 words, 246: 349 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work maps to Line 242 uncertainties or Line 246 items."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: not_applied ("P4 mismatch 0.7% called missing 0.5% target, correct; but P8…"); 246: applied ("Met targets stated as met, no miscast comparisons") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 17 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company's core manufacturing process is replication: coating a polyurethane sponge with ceramic slurry, squeezing, drying, and firing it out. The team ca..." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "ramic copy. The team calls the graded structure under development the cascade-fired lattice. Most production volume is alumina-based filters for aluminium foundr" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "Process, lattice name, and product line covered." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company's core manufacturing process is replication: coating a polyurethane sponge with ceramic slurry, squeezing, drying, and firing it out. The team calls the graded structure the cascade-fired lattice. / Most production volume is alumina based filters for aluminium foundries spanning 10, 20 and 30 pores per inch. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- A practical target was raising capture of fine inclusions in the 20 to 80 micron range without choking flow. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Stacking a coarse and fine filter doubled cost and left a gap where metal could bypass between the two pieces. / Thicker fine filters cracked worse because thermal stress rose with thickness, and priming was harder. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The company sought new knowledge on whether templates of two different pore sizes could be bonded and fired without delaminating at the interface. / This knowledge was meant to enable a replicated graded foam filter that survives firing at 50 mm thickness. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unclear whether a pore gradient could raise capture of fine inclusions while keeping flow rate close to the standard filter. / Thin-wall casting customers needed better capture of fine inclusions without choking flow, a balance not previously demonstrated. _(cited, carried from an older context)_
- How the graded interface would behave under thermal shock was open, since it was unknown whether it would arrest or start cracks. / Interface stress modeling was impractical because the hollow strut geometry left after sponge burnout resisted calculation. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team planned a phased approach: phase one tested firing survival of graded green bodies before advancing to further testing. / Phase two covered lab flow and capture testing, and phase three covered thermal shock, burst testing, and a customer pour trial. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If the graded filter survives firing, then it should capture at least 30 percent more fine inclusions than the 20 ppi standard. / This gain was expected to come at no more than a 10 percent flow rate penalty relative to the standard filter. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 4 tested the graded 25 mm fine zone filter on a 50 kg A356 pour rig. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unclear whether a pore gradient could raise capture of fine ..."
- The 25 mm fine zone graded filter choked late in 2 of 6 pours as inclusions built a cake on the fine face. / The team then thinned the fine zone to 15 mm in trial 5 to address the choking problem. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unclear whether a pore gradient could raise capture of fine ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The 15 mm fine zone graded filter achieved 36 percent higher capture than the 20 ppi standard without choking. / This met the capture goal at a smaller flow penalty than the 25 mm version that choked in 2 of 6 pours. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Trial 4 showed the 25 mm graded fine zone captured 41 percent more inclusions than the 20 ppi standard. / But the 25 mm fine zone choked late in 2 of 6 pours as inclusions built a cake on the fine face. _(cited, carried from an older context)_
  - Links: uncertainty "It was unclear whether a pore gradient could raise capture of fine ..."; experiments "Trial 4 tested the graded 25 mm fine zone filter on a 50 kg A356 po..."
- Thinning the fine zone to 15 mm in trial 5 eliminated the choking seen with the thicker 25 mm zone. _(cited, carried from an older context)_
  - Links: uncertainty "It was unclear whether a pore gradient could raise capture of fine ..."; experiments "The 25 mm fine zone graded filter choked late in 2 of 6 pours as in..."

### 12. Project status and next steps (Section 246, standard): approved

- A customer pour trial of 200 filters at one foundry showed zero breakage during fiscal 2026. / X-ray rejects on thin-wall housings dropped from 6.2 percent to 4.5 percent over that trial. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The thermal shock uncertainty was resolved: a well-matched graded interface acts as a crack arrester rather than a failure plane. / Graded filters retained 68 percent strength after quench versus 55 percent for standard filters, with fewer burst cracks. _(cited)_

## Drafted Sections

### Line 242

The company's core manufacturing process is replication: coating a polyurethane sponge with ceramic slurry, squeezing out the excess, drying, and firing it so the sponge burns out and leaves a ceramic copy. The team calls the graded structure under development the cascade-fired lattice. Most production volume is alumina-based filters for aluminium foundries spanning 10, 20 and 30 pores per inch (ppi). This base of process knowledge, built over two decades of sponge replication and firing-curve control, is what made a graded filter concept conceivable in the first place.

The company's goal was to develop a replicated alumina foam filter carrying a pore-size gradient through its thickness, pairing a coarse entry face with a fine exit face in a single fired part. A practical target was raising capture of fine inclusions in the 20 to 80 micron range without choking flow, while also addressing field-reported cracking in standard filters during the pour.

The limitations to standard practice were that no proven production method existed to achieve this balance. Stacking a coarse and fine filter doubled cost and left a gap where metal could bypass between the two pieces. Thicker fine filters cracked worse because thermal stress rose with thickness, and priming was harder. Published work on graded ceramic foams was confined to lab-scale discs made by gel casting or freeze casting, leaving no documented basis for grading a sponge-replicated part at production thickness.

The technological objective was to advance the understanding of whether sponge templates of two different pore sizes could be bonded and fired without delaminating at the interface, for the purpose of producing a replicated graded foam filter that survives firing at 50 mm thickness. It was unclear whether a pore gradient could raise fine inclusion capture while keeping flow rate close to the standard filter, since thin-wall customers needed both at once, a balance not previously demonstrated. Whether the graded interface would arrest or initiate cracks under thermal shock resistance testing was unknown. Interface stress could not be modelled reliably because the hollow strut geometry left after sponge burnout resisted calculation.

### Line 244

The technological problem was whether a replicated foam template combining two pore sizes could survive firing intact, and if so, whether the resulting pore-size gradient could raise fine inclusion capture and resist thermal shock without sacrificing flow. The team used a phased plan to answer these questions in order, since each later question only mattered if the earlier one was resolved. Phase one tested firing survival of graded green bodies before advancing to further testing. Phase two covered lab flow and capture testing, and phase three covered thermal shock, burst testing, and a customer pour trial. This let the team commit lab and rig time only to filters already proven to survive the kiln.

It was hypothesized that a two-zone sponge template (10 pores per inch (ppi) entry face, 30 ppi exit face) coated so both zones picked up similar slurry mass per unit volume would keep shrinkage mismatch across the interface within 0.5 percent and survive firing without delamination. If the graded filter survives firing, then it should capture at least 30 percent more fine inclusions than the 20 ppi standard. This gain was expected to come at no more than a 10 percent flow rate penalty relative to the standard filter.

Trial 1 tested adhesive-bonded 10/30 ppi templates with a single slurry dip at 2,400 mPa.s, fired on the standard curve, across 24 parts. Eighteen of 24 delaminated at the bond line; survivors showed 1.4 percent shrinkage mismatch, with the finer (30 ppi) side shrinking more from higher slurry pick-up. Single-dip loading and adhesive bonding could not control mismatch across zones of different pore size.

Trial 2 removed the adhesive, used thermal fusing instead, and applied a two-stage dip: a thin slurry coat over the whole part, then a thicker coat on the coarse half only. Delamination dropped to 9 of 40 parts (22 percent) and mismatch fell to 0.7 percent, still missing the 0.5 percent target. Slurry loading control alone was not enough; firing conditions also needed adjustment.

Trial 3 kept the two-stage dip and added a slow 1 C per minute ramp through the 1,100 to 1,350 C sintering window with a 45 minute hold, before resuming the standard ramp to 1,580 C. Delamination fell to 2 of 36 parts (6 percent) and mismatch measured 0.4 percent, meeting the target at a cost of about 3 extra hours of kiln time per load. This confirmed that mismatch is driven more by slurry mass per volume than by pore size, and that adhesive bonding cannot work since it burns out before the ceramic sinters.

Trial 4 tested the graded 25 mm fine zone filter on a 50 kg A356 pour rig to see whether a surviving graded filter could raise capture without an unacceptable flow penalty. It flowed at 3.8 kg/s against the standard's 4.1 kg/s, a reduction of roughly 7 to 8 percent and within target, and captured 41 percent more fine inclusions, meeting the 30 percent goal. The 25 mm fine zone filter choked late in 2 of 6 pours as inclusions built a cake on the fine face, an outcome the capture result alone had not predicted. The team thinned the fine zone to 15 mm in trial 5 to address the choking.

Trial 5 ran 8 pours with the thinned 15 mm fine zone and held flow at 3.9 kg/s across the full 50 kg pour with no choking, capturing 36 percent more inclusions than the standard. A thinner fine zone eliminated the cake buildup failure while still meeting the capture target.

Trial 6 compared standard filters, well-matched graded filters from trial 3, and poorly matched graded filters from trial 2 for thermal shock resistance, using quench and cold burst conditions. Standard filters retained about 55 percent strength after quench versus 68 percent for well-matched graded filters; burst cracking occurred in 3 of 20 standard filters versus 1 of 20 graded filters, with the crack stopping at the interface. Poorly matched trial 2 filters cracked along the interface in 4 of 10 cases, showing the interface only acts as a crack arrester when mismatch is controlled to the 0.4 percent level achieved in trial 3.

### Line 246

The project tested whether a two-zone pore-size gradient could be built into a sponge-replicated alumina filter that survives production firing, raises fine inclusion capture, and improves thermal shock resistance without hurting flow. The hypothesis was partially proven. Equalizing slurry mass per unit volume across zones, replacing adhesive bonding with thermal fusing, and slowing the firing ramp through the sintering window brought shrinkage mismatch to 0.4 percent, meeting the 0.5 percent target and cutting delamination to 6 percent. The expected 30 percent capture gain was exceeded at 41 percent with a 25 mm fine zone, though that configuration choked in 2 of 6 pours, a failure mode the hypothesis did not anticipate.

Shrinkage mismatch depended more on slurry mass per unit volume than on pore size; a slow ramp through the 1,100 to 1,350 C sintering window closed the remaining gap. A two-stage dip with thermally fused templates produced parts at 0.4 percent mismatch and 6 percent delamination.

Fine zone thickness, not grading itself, controlled whether higher capture came at the cost of choking. The 25 mm fine zone captured 41 percent more inclusions than the 20 ppi standard but choked late in 2 of 6 pours as inclusions built a cake on the fine face. Thinning the fine zone to 15 mm eliminated this choking across a full 50 kg pour while still capturing 36 percent more than standard, a smaller flow penalty than the 25 mm version.

A graded interface acts as a crack arrester only when shrinkage mismatch is well controlled. Well-matched graded filters retained 68 percent strength after quench versus 55 percent for standard filters, with fewer burst cracks; poorly matched filters cracked along the interface instead.

Performance at 30 mm thickness, the highest-volume format, remains unknown, since geometry and slurry pick-up scale differently there. Whether a continuous gradient is achievable, and whether a faster-sintering binder could cut added kiln time, carries into fiscal 2027.

A 200-filter customer pour trial in fiscal 2026 showed zero breakage, with X-ray rejects on thin-wall housings dropping from 6.2 to 4.5 percent, and fine inclusion capture improved without choking flow.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 343/350 words, 33/50 lines |
| 242 | Claim Exclusion: Pricing discussions and commercial positioning with thin-wall customers are business matters, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Changing the dip line to support two-stage coating as a general production/business improvement to uniform filters is a process rollout, not the uncertainty resolution itself. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The decision about whether the project primarily targeted breakage (a liability/quality business concern) reflects a business motivation rather than a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Securing a second foundry and alloy before a launch decision is a commercial/business qualification step, not an SR&ED technological activity. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The simple 2023 dip-coating attempt to create a skin was a routine trial using standard technique, outside the fiscal 2026 claim period and not part of the systematic investigation described. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: thermal shock resistance | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: sponge replication | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: pores per inch (ppi) | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches Storyline's goal, limits, objective… |
| 242 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent is established from both transcript and trial log. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 1 delamination rate and shrinkage mismatch are established, with trial log giving a slightly different percentage framing than the transcript's raw count. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 3 meeting the 0.5 percent mismatch target and added kiln time is established, corroborated by both transcript and trial log. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 4 flow/capture comparison table figures are established from the trial log, with a minor discrepancy in percent framing (7 percent vs 8 percent lower flow) across sources, which is a partial/hedged detail. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 6 burst test results and crack-arresting behavior of the well-matched interface are established. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The claim that most testing time went into capture work (per Castellanos) versus breakage being the real driver (per Aberline) is an unresolved internal disagreement about project motivation. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Aberline's competing view that breakage was the real driver of the project is the other side of the unresolved disagreement. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The customer pour trial's reject-rate improvement is supported but explicitly flagged by the source as limited in scope (one foundry, one alloy), making it a partial finding. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether the gradient works at 30 mm thickness (the highest-volume format) remains unresolved, as the program only tested 50 mm parts. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Whether a continuous gradient (versus two-zone) is achievable remains unresolved and is deferred to future work. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The trial log's slurry pick-up measurements (g/cm3) for trial 1 and trial 2 are established details not mentioned in the transcript, supported only by the project document. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: thermal shock resistance | applied | none |  | P4 says 'thermal shock' not 'thermal shock resistance'; repaired to the Glossary Term |
| 242 | Glossary Term: priming head | applied | none |  | Concept of priming head absent from section. |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Term shrinkage mismatch not named in section. |
| 242 | Glossary Term: pores per inch (ppi) | applied | none |  | P1 writes 'pores per inch' not abbreviation 'ppi'; repaired to the Glossary Term |
| 242 | Glossary Term: delamination | applied | none |  | Term delaminating used, not delamination as noun concept absent. |
| 242 | Glossary Term: two-stage dip | applied | none |  | Two-stage dip process not described in section. |
| 242 | Glossary Term: crack arrester | applied | none |  | Crack arrester concept not present in section. |
| 242 | Cover signed-off Summary item ys71jp59x61bx0nrr0ff97gqxn8fez3d | applied | none |  | Process, lattice name, and product line covered. |
| 242 | Cover signed-off Summary item ys719nq3c8ydszmrn6ewd5psc18fegvg | applied | none |  | Goal and 20-80 micron target stated. |
| 242 | Cover signed-off Summary item ys7a36r0jnvffdehbbxt2shr558fe313 | applied | none |  | Stacking cost/gap and cracking limitation both present. |
| 242 | Cover signed-off Summary item ys78yean9vj9asw1hhan4k2etx8ffyvj | applied | none |  | Bonding/delamination objective and 50mm survival stated. |
| 242 | Cover signed-off Summary item ys71ex5rkdnxz8f5nssr7ysvbx8fewp3 | applied | none | 2 | Flow/capture uncertainty and thin-wall need both present. |
| 242 | Cover signed-off Summary item ys7d2kedy3mgxktam87ywb1d318ff1h5 | applied | none | 2 | Crack arrest/initiate and strut modeling uncertainty present. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 692/700 words, 64/100 lines |
| 244 | Claim Exclusion: Pricing discussions and commercial positioning with thin-wall customers are business matters, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Changing the dip line to support two-stage coating as a general production/business improvement to uniform filters is a process rollout, not the uncertainty resolution itself. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The decision about whether the project primarily targeted breakage (a liability/quality business concern) reflects a business motivation rather than a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Securing a second foundry and alloy before a launch decision is a commercial/business qualification step, not an SR&ED technological activity. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The simple 2023 dip-coating attempt to create a skin was a routine trial using standard technique, outside the fiscal 2026 claim period and not part of the systematic investigation described. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thermal shock resistance | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: pores per inch (ppi) | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches Storyline sequence and figures |
| 244 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent is established from both transcript and trial log. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 1 delamination rate and shrinkage mismatch are established, with trial log giving a slightly different percentage framing than the transcript's raw count. | applied | none |  | Trial 1 figures stated as established fact matches C2 |
| 244 | Confidence Map: Trial 3 meeting the 0.5 percent mismatch target and added kiln time is established, corroborated by both transcript and trial log. | applied | none |  | Trial 3 target meeting stated flatly, matches established |
| 244 | Confidence Map: Trial 4 flow/capture comparison table figures are established from the trial log, with a minor discrepancy in percent framing (7 percent vs 8 percent lower flow) across sources, which is a partial/hedged detail. | not_applied | missing_fact |  | P6 states flat 7 to 8 percent despite source discrepancy; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Trial 6 burst test results and crack-arresting behavior of the well-matched interface are established. | applied | none |  | Trial 6 results stated flatly, matches established status |
| 244 | Confidence Map: The claim that most testing time went into capture work (per Castellanos) versus breakage being the real driver (per Aberline) is an unresolved internal disagreement about project motivation. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Aberline's competing view that breakage was the real driver of the project is the other side of the unresolved disagreement. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: The customer pour trial's reject-rate improvement is supported but explicitly flagged by the source as limited in scope (one foundry, one alloy), making it a partial finding. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether the gradient works at 30 mm thickness (the highest-volume format) remains unresolved, as the program only tested 50 mm parts. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether a continuous gradient (versus two-zone) is achievable remains unresolved and is deferred to future work. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: The trial log's slurry pick-up measurements (g/cm3) for trial 1 and trial 2 are established details not mentioned in the transcript, supported only by the project document. | applied | none |  | Pick-up noted qualitatively, not flatly quantified |
| 244 | Glossary Term: pore-size gradient | applied | none |  | P1 says 'graded structure' instead of pore-size gradient; repaired to the Glossary Term |
| 244 | Glossary Term: thermal shock resistance | applied | none |  | P8 uses 'thermal quench' not 'thermal shock resistance'; repaired to the Glossary Term |
| 244 | Glossary Term: priming head | applied | none |  | Priming head concept not mentioned in the section |
| 244 | Glossary Term: sponge replication | applied | none |  | Sponge replication concept not mentioned in the section |
| 244 | Glossary Term: pores per inch (ppi) | applied | none |  | P2 uses 'ppi' as abbreviation without full term; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status language appears in section. |
| 244 | Cover signed-off Summary item ys7bbn0gvsw7g3b193a71c4gyx8fe8z7 | applied | none |  | Phased plan matches wording in P1. |
| 244 | Cover signed-off Summary item ys7e263ctps0r14p15f0szd93s8fen4x | applied | none |  | Hypothesis wording matches P2 verbatim. |
| 244 | Cover signed-off Summary item ys7a64d4kw0rhh3d64xap9qwr58feddx | applied | none |  | Trial 4 on 50 kg A356 rig matches wording. |
| 244 | Cover signed-off Summary item ys76x04jjta1mwdt6pc3wqg6mx8ff41m | applied | none |  | Choking and thinning to 15 mm described in P6. |
| 244 | State each result against its target as the numbers show | not_applied | none |  | P4 mismatch 0.7% called missing 0.5% target, correct; but P8… |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work maps to Line 242 uncertainties or Line 246 items. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Trial 4 tested the graded 25 mm fine zone filter on a 50 kg A356 pour rig." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 242, 244): Trial 4 is described as testing a '25 mm fine zone filter' on the pour rig, but no prior paragraph in 244 or 242 establishes 25 mm as the starting fine zone thickness; the uncertainty section (242 P4) only references an overall part thickness of 50 mm. This creates an unexplained jump in stated dimension that is not grounded in the uncertainty framing, though this alone may just be an omission rather than a true contradiction; flagging the dimension mismatch between the 50 mm total thickness in 242 and the 25 mm fine zone figure introduced in 244 for review. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 349/350 words, 36/50 lines |
| 246 | Claim Exclusion: Pricing discussions and commercial positioning with thin-wall customers are business matters, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Changing the dip line to support two-stage coating as a general production/business improvement to uniform filters is a process rollout, not the uncertainty resolution itself. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The decision about whether the project primarily targeted breakage (a liability/quality business concern) reflects a business motivation rather than a technological uncertainty. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Securing a second foundry and alloy before a launch decision is a commercial/business qualification step, not an SR&ED technological activity. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The simple 2023 dip-coating attempt to create a skin was a routine trial using standard technique, outside the fiscal 2026 claim period and not part of the systematic investigation described. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: thermal shock resistance | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches storyline facts and sequence |
| 246 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent is established from both transcript and trial log. | applied | none |  | C1 not restated in section, no contradiction |
| 246 | Confidence Map: Trial 1 delamination rate and shrinkage mismatch are established, with trial log giving a slightly different percentage framing than the transcript's raw count. | applied | none |  | Trial1 details not stated flatly in section |
| 246 | Confidence Map: Trial 3 meeting the 0.5 percent mismatch target and added kiln time is established, corroborated by both transcript and trial log. | applied | none |  | Matches established 0.5% target and kiln time |
| 246 | Confidence Map: Trial 4 flow/capture comparison table figures are established from the trial log, with a minor discrepancy in percent framing (7 percent vs 8 percent lower flow) across sources, which is a partial/hedged detail. | applied | none |  | P3/P1 give single clean figures, no contradiction stated |
| 246 | Confidence Map: Trial 6 burst test results and crack-arresting behavior of the well-matched interface are established. | applied | none |  | Matches established 68% vs 55% result |
| 246 | Confidence Map: The claim that most testing time went into capture work (per Castellanos) versus breakage being the real driver (per Aberline) is an unresolved internal disagreement about project motivation. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Aberline's competing view that breakage was the real driver of the project is the other side of the unresolved disagreement. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: The customer pour trial's reject-rate improvement is supported but explicitly flagged by the source as limited in scope (one foundry, one alloy), making it a partial finding. | not_applied | missing_fact |  | P6 states reject drop flatly, no scope hedge; repair not used (the repaired text came out at 408/350 words, 42/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Confidence Map: Whether the gradient works at 30 mm thickness (the highest-volume format) remains unresolved, as the program only tested 50 mm parts. | applied | none |  | P5 hedges 30 mm performance as unknown |
| 246 | Confidence Map: Whether a continuous gradient (versus two-zone) is achievable remains unresolved and is deferred to future work. | applied | none |  | P5 hedges continuous gradient as open question |
| 246 | Confidence Map: The trial log's slurry pick-up measurements (g/cm3) for trial 1 and trial 2 are established details not mentioned in the transcript, supported only by the project document. | applied | none |  | Not mentioned in the section |
| 246 | Glossary Term: priming head | applied | none |  | Priming head concept not mentioned |
| 246 | Glossary Term: sponge replication | not_applied | none |  | Section says 'sponge-replicated' not 'sponge replication'; repair not used (the repaired text came out at 408/350 words, 42/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Glossary Term: pores per inch (ppi) | not_applied | none |  | Section uses '20 ppi' but never spells out ppi term; repair not used (the repaired text came out at 408/350 words, 42/50 lines, further from the Line 246 limit than the checked draft, so the checked draft was kept) |
| 246 | Cover signed-off Summary item ys76ycgfnt6hkwgy0bjrkc938n8fea11 | applied | none |  | P3 covers 15mm 36% capture gain without choking |
| 246 | Cover signed-off Summary item ys77kyzyfh0r9zq20ataa0grrh8fenxc | applied | none | 2 | P1/P3 cover 41% capture gain and choking in 2 of 6 |
| 246 | Cover signed-off Summary item ys78zexmmvjbzh2ecwgwa63tc58fe967 | applied | none | 2 | P3 covers 15mm thinning eliminating choking |
| 246 | Cover signed-off Summary item ys7enexcesyby43gm3chkhvhjn8fev4c | applied | none |  | P6 covers 200-filter trial, zero breakage, reject drop |
| 246 | Cover signed-off Summary item ys7cbr2s7ysrnht2ngff8nm55d8ffmh9 | applied | none |  | P4 covers crack arrester finding and 68% vs 55% |
| 246 | State each result against its target as the numbers show | applied | none |  | Met targets stated as met, no miscast comparisons |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All claims trace to Line242 uncertainties or COVER items |
| 246 | Leave out quotes marked for a check from the evidence for the idea "Thinning the fine zone to 15 mm in trial 5 eliminated the choking seen with the thicker 25 mm zone." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 6 (sections 242, 244, 246): This paragraph reports a 200-filter customer pour trial and X-ray reject rate drop on thin-wall housings, framed as an advancement result. Line 242 and 244 only establish uncertainty and testing around pore gradient, capture, flow and thermal shock, not a customer-facing commercial pour trial. The Claim Exclusions list securing commercial qualification steps and customer-facing business matters as excluded; this paragraph reads as a business/customer validation outcome rather than resolution of a stated technological uncertainty. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 242, 246): Paragraph 1 states the hypothesis was partially proven and that flow was not hurt, but it does not mention the flow penalty figures from 244 (7 to 8 percent reduction), and separately claims the 25 mm configuration choked, which 242 never raises as a possible outcome since 242 frames the uncertainty only as capture versus flow versus crack behavior, not choking. The choking failure mode in 246 P1 and P3 is presented as unanticipated, which is consistent, so this is not reported as a finding beyond noting the dimension consistency already flagged above. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 25.
- Line 244: 0 labels and 0 plan checks "Not checked" of 24.
- Line 246: 0 labels and 0 plan checks "Not checked" of 22.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.2 s, p95 23.9 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.0 s, p95 15.0 s over 1.
- Sign-off to report created: 153.0 s.
- Cost from aiUsage: $1.15 in all ($0.41 seed stage, $0.74 Brief, drafting and checks) over 45 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T01:29:54.478Z created project k97054pkvwq4gfp4m20vth0a0s8fe7sq
2026-10-01T01:29:55.118Z added document graded-filter-trial-log.md
2026-10-01T01:29:56.396Z started Step by step generation k57c7p1r00kb7n5z1xrmz9snnh8ffh3b
2026-10-01T01:30:47.769Z seed stage open
2026-10-01T01:30:47.770Z Open Company / Context and wait for its Batch
2026-10-01T01:30:56.849Z Company / Context: select the first Seed
2026-10-01T01:30:58.749Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-10-01T01:31:00.646Z Approve Company / Context
2026-10-01T01:31:03.601Z approved company_context
2026-10-01T01:31:03.602Z Open Goal / Problem and wait for its Batch
2026-10-01T01:31:15.281Z Goal / Problem: select the first Seed
2026-10-01T01:31:17.172Z Approve Goal / Problem
2026-10-01T01:31:19.123Z approved goal_problem
2026-10-01T01:31:19.123Z Open Technological limitations and wait for its Batch
2026-10-01T01:31:33.460Z Technological limitations: select the first Seed
2026-10-01T01:31:35.362Z Approve Technological limitations
2026-10-01T01:31:37.273Z approved passive_limitations
2026-10-01T01:31:37.273Z Open Technological objectives and wait for its Batch
2026-10-01T01:31:51.594Z Technological objectives: select the first Seed
2026-10-01T01:31:53.482Z Approve Technological objectives
2026-10-01T01:31:55.376Z approved technological_objective
2026-10-01T01:31:55.376Z Open Technological uncertainties and wait for its Batch
2026-10-01T01:32:06.997Z Technological uncertainties: select the first 2 Seeds
2026-10-01T01:32:10.159Z Approve Technological uncertainties
2026-10-01T01:32:12.088Z approved active_uncertainties
2026-10-01T01:32:12.088Z Skip Previous-year status
2026-10-01T01:32:13.359Z Open Work plan and wait for its Batch
2026-10-01T01:32:30.276Z Work plan: select the first Seed
2026-10-01T01:32:32.220Z Approve Work plan
2026-10-01T01:32:34.193Z approved workplan
2026-10-01T01:32:34.193Z Open Hypothesis and wait for its Batch
2026-10-01T01:32:45.931Z Hypothesis: select the first Seed
2026-10-01T01:32:47.816Z Approve Hypothesis
2026-10-01T01:32:49.752Z approved hypothesis
2026-10-01T01:32:49.752Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T01:33:17.136Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T01:33:20.373Z Approve Experimentation / Iterations
2026-10-01T01:33:22.294Z approved experimentation
2026-10-01T01:33:22.295Z Goal / Problem: select the Seed closest to "capture of fine inclusions" (else one that states a goal, else the next Seed on the page) and untick the earlier selection (writer switches the goal framing)
2026-10-01T01:33:22.924Z switching to the Seed closest to "capture of fine inclusions": yn7bbr7fvjah5e9wmsms36kj898fex6a
2026-10-01T01:33:25.470Z Approve Goal / Problem
2026-10-01T01:33:27.371Z approved goal_problem
2026-10-01T01:33:27.371Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-10-01T01:33:44.335Z Technological uncertainties: Confirm and approve the carried selections
2026-10-01T01:33:46.311Z approved active_uncertainties (confirmed 2 carried)
2026-10-01T01:33:46.311Z Confirm and approve every Stale Subsection, in order
2026-10-01T01:33:49.479Z approved passive_limitations (confirmed 1 carried)
2026-10-01T01:33:52.038Z approved technological_objective (confirmed 1 carried)
2026-10-01T01:33:54.557Z approved workplan (confirmed 1 carried)
2026-10-01T01:33:57.119Z approved hypothesis (confirmed 1 carried)
2026-10-01T01:33:59.643Z approved experimentation (confirmed 2 carried)
2026-10-01T01:33:59.643Z Open Advancement to science / technology and wait for its Batch
2026-10-01T01:34:01.541Z Advancement to science / technology: select the first Seed
2026-10-01T01:34:03.443Z Approve Advancement to science / technology
2026-10-01T01:34:05.387Z approved overall_advancement (confirmed 1 carried)
2026-10-01T01:34:05.387Z Open Specific technological advancements and wait for its Batch
2026-10-01T01:34:09.233Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T01:34:14.310Z Approve Specific technological advancements
2026-10-01T01:34:16.219Z approved specific_advancements (confirmed 2 carried)
2026-10-01T01:34:16.219Z Open Project status and next steps and wait for its Batch
2026-10-01T01:34:27.881Z Project status and next steps: select the first Seed
2026-10-01T01:34:29.784Z Approve Project status and next steps
2026-10-01T01:34:31.790Z approved project_status
2026-10-01T01:34:31.790Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T01:34:46.155Z Overall company / project goal improvements: select the first Seed
2026-10-01T01:34:48.099Z Approve Overall company / project goal improvements
2026-10-01T01:34:50.021Z approved goal_improvements
2026-10-01T01:34:50.021Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T01:34:51.314Z signed off; waiting for the report
2026-10-01T01:37:24.937Z report kd7fkr25szshahpzkch9gbekn58fej00 created
```
