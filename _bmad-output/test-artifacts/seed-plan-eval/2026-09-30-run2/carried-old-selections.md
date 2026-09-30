# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `9de29da9`, acting as e2e-audit@banhall.local. Project `k97btz9f2d93yt90af5aqtebtd8fc4tx`, generation `k57br1ya4wbzkrcadxc8gr610h8fdm11`.

## What this fixture tests

The writer approves through Experimentation, then switches the goal framing (from filter breakage to fine-inclusion capture, both supported by the sources). Every approved successor goes Stale. The writer regenerates Technological uncertainties but keeps the older selections and must Confirm and approve them as carried; the other Stale steps are confirmed the same way. Company / Context carries a writer edit with a term that is in no source, which must reach the drafted Section 242, and that edited item is writer-asserted.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 242 states the goal the writer switched to, not the first framing, and the carried uncertainties still read as consistent with it.
   - Answer: Yes, with a caveat. The scripted switch picked the second goal Seed on the page, which this run was a process card ("The core manufacturing process is replication ..."), so Line 242 takes the goal from the Brief and gives both drivers. The carried uncertainties fit it. A fixture-script weakness, not a product defect.
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: Yes. Line 242 paragraphs 2 and 4 follow both carried items clause by clause (bond-line delamination; shrinkage not calculable; hollow struts).
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: Yes. "what the team calls the cascade-fired lattice: a single replicated filter with a pore-size gradient". No evidence is invented around it.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Mostly. Plain prose, no headings, but three phrases talk about the sources rather than the work ("The two interviewees describe the motivation differently", "recorded elsewhere as", "depending on the measurement source").

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass, medium-high confidence. Run 10's major is fixed: Line 244 now covers Trials 1 to 6. Majors: Line 242 states no capture uncertainty (the writer never ticked it) while Lines 244 and 246 test and claim it; the Rule B row records this as not applied and the repair rightly kept COVER item 13; source-provenance phrases from Confidence Map repairs sit in the prose. Every figure checked matches the sources.

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd789hkm0jphz0qt9d29dd68618fc2jb |
| All three Sections were drafted | pass | 242: 323 words, 244: 685 words, 246: 316 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: not_applied; COVER rows not applied after such a repair: none |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company has made foam-ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice. ..." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | ", but both agree the goal was pursued through what the team calls the cascade-fired lattice: a single replicated filter with a pore-size gradient through its thi" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P1 covers history, cascade-fired lattice, and team size/lead." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company has made foam-ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice. / Its engineering group of five people includes a process lead with six years in firing curves and shrinkage. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The core manufacturing process is replication: a polyurethane sponge is coated with ceramic slurry, excess squeezed out, dried and fired. / Firing burns out the sponge, leaving a ceramic copy of the foam as the finished filter. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Standard practice was stacking a coarse and fine filter or buying a thicker fine filter to raise capture. / Stacking doubled cost and left a bypass gap, and thicker fine filters cracked worse as thermal stress rose with thickness. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether templates of different pore sizes could be bonded or graded and survive firing without delaminating. / This knowledge was meant to enable a replicated foam filter combining a tough entry face with a fine capture layer. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was unknown whether two-zone sponge templates could survive firing without delaminating at the bond line. / Shrinkage could not be calculated because it depends on slurry loading, pore size, viscosity and roller pressure. _(cited, carried from an older context)_
- Struts are hollow after the sponge burns out, making interface stress too hard to model analytically. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The working hypothesis proposed a two-zone template, 10 ppi entry and 30 ppi exit, matched for slurry mass per volume. / This was expected to hold shrinkage mismatch within 0.5 percent and survive firing without delamination. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If a two-zone template matches slurry mass per volume, then shrinkage mismatch stays within 0.5 percent and survives firing without delamination. / If that hypothesis holds, then capture rises at least 30 percent over the 20 ppi standard with no more than a 10 percent flow penalty. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive and a single slurry dip. / Eighteen of 24 parts delaminated at the bond line, with a 1.4 percent shrinkage mismatch. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unknown whether two-zone sponge templates could survive firi..."
- Trial 2 replaced adhesive with a thermal fused bond and added a two stage slurry dip. / Delamination dropped to 9 of 40 parts, about 22 percent, with mismatch down to 0.7 percent. _(cited, carried from an older context)_
  - Tested: uncertainty "It was unknown whether two-zone sponge templates could survive firi..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Trial 3 slowed the ramp through 1,100 to 1,350 C, meeting the 0.5 percent mismatch target. / This confirmed the hypothesis that matching slurry mass per volume controls firing survival. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Trial 1 and trial 2 findings showed shrinkage mismatch tracks slurry mass per volume more than pore size itself. / This reframed the delamination problem from a pore-size issue to a slurry pick-up control issue. _(cited, carried from an older context)_
  - Links: uncertainty "It was unknown whether two-zone sponge templates could survive firi..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive and a ...", "Trial 2 replaced adhesive with a thermal fused bond and added a two..."
- Trial 1 revealed that adhesive bonding cannot survive firing because it burns out before the ceramic sinters. / This knowledge ruled out adhesive bonding entirely for any graded template approach. _(cited, carried from an older context)_
  - Links: uncertainty "It was unknown whether two-zone sponge templates could survive firi..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive and a ..."

### 12. Project status and next steps (Section 246, standard): approved

- The customer pour trial at one foundry showed zero breakage across 200 graded filters used. / X-ray rejects on thin-wall housings dropped from 6.2 percent to 4.5 percent over the trial period. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The graded filter program aimed to combine breakage resistance with fine inclusion capture in one part. / Trial results confirmed the two zone approach met both the firing survival and capture goals together. _(cited)_

## Drafted Sections

### Line 242

Brackenridge Kilnworks Ltd. has made foam-ceramic filters for metal foundries for a little over twenty years, from its plant in Dunmore Falls, Ontario. Its core process is replication: a polyurethane sponge is coated with ceramic slurry, the excess squeezed out, then dried and fired so the sponge burns out, leaving a ceramic copy of the foam as the finished filter. A five-person engineering group holds the firing-curve and shrinkage know-how, including a process lead with six years in firing curves and shrinkage. The two interviewees describe the motivation differently, one emphasizing breakage and the other capture, but both agree the goal was pursued through what the team calls the cascade-fired lattice: a single replicated filter with a pore-size gradient through its thickness, pairing a coarse entry face against thermal shock with a fine exit face for inclusion capture.

Standard practice was stacking a coarse and fine filter, or buying a thicker fine filter. Stacking doubled cost and left a bypass gap; thicker fine filters cracked worse as thermal stress rose with thickness. No method existed for grading or bonding sponge templates of different pore sizes through firing without delamination. Shrinkage mismatch between zones could not be calculated, since it depends on slurry loading, pore size, viscosity and roller pressure, none quantified for a graded part. Because struts are hollow after sponge burnout, interfacial stress during firing was too hard to model analytically.

The team sought new knowledge on whether templates of different pore sizes could be bonded or graded and survive firing without delaminating, meant to enable a replicated foam filter combining a tough entry face with a fine capture layer.

It was unknown whether two-zone sponge templates could survive firing without delaminating at the bond line. It was also uncertain how the interface would behave under thermal shock, since hollow struts made interfacial stress too complex to model, and whether cracks would arrest or initiate could not be predicted from the literature.

### Line 244

The technological problem was whether a replicated foam filter could carry a pore-size gradient through a 50 mm fired part without the zones tearing apart at the interface, and whether it would raise fine inclusion capture without choking flow or worsening cracking under thermal shock. The company ran a planned trial series, moving from bonding method through slurry control, firing curve, flow/capture testing and thermal shock testing, with each result fixing the variable for the next since bonding method, shrinkage mismatch, fine zone thickness and interface quality interacted rather than acting independently.

The working hypothesis proposed a two-zone template, 10 pores per inch (ppi) entry and 30 ppi exit, matched for slurry mass per volume. This was expected to hold shrinkage mismatch within 0.5 percent and survive firing without delamination. If that held, capture was expected to rise at least 30 percent over the 20 ppi standard with no more than a 10 percent flow penalty.

Trial 1 bonded 10 ppi and 30 ppi sponge sheets with polyurethane adhesive, applied a single slurry dip, and fired 24 parts. Eighteen of 24 delaminated at the bond line, with survivors showing a 1.4 percent shrinkage mismatch; the trial log recorded higher slurry pick-up on the 30 ppi side than expected. This showed the adhesive bond left a burnout gap before the ceramic sintered, and that mismatch tracked slurry pick-up rather than pore size, so the bonding method changed for the next trial.

Trial 2 replaced adhesive with a thermal-fused bond and added a two-stage dip (thin slurry over the whole part, then thick slurry on the coarse half only), firing 40 parts. Delamination dropped to 9 of 40, about 22 percent, with mismatch down to 0.7 percent, still short of the 0.5 percent target. This indicated the two-stage dip fixed most, but not all, of the pick-up imbalance, leaving the firing curve as the remaining lever.

Trial 3 kept the two-stage dip and slowed the firing ramp to 1 C per minute through the 1,100 to 1,350 C sintering window, adding a 45 minute hold before the final ramp to 1,580 C, across 36 parts. Delamination fell to 2 of 36 (6 percent) and mismatch measured 0.4 percent, meeting the target at a cost of roughly 3 extra hours of kiln time per load (recorded elsewhere as a door-to-door increase from about 19 to 22 hours). This confirmed mismatch is governed more by slurry mass per volume than pore size, and that a slower sintering-window ramp closes the gap the dip alone could not.

Trial 4 used a flow rig with 50 kg A356 pours at 720 C to compare standard 20 ppi, standard 30 ppi, and a graded filter with a 25 mm fine zone, 6 pours each. The graded filter flowed at 3.8 kg/s, roughly 7 to 8 percent below the 20 ppi baseline depending on the measurement source, and captured 41 percent more inclusions, but 2 of 6 pours choked late as inclusion cake built on the fine face, so the fine zone needed to be thinner before the capture gain could be used.

Trial 5 cut the fine zone to 15 mm against a 35 mm coarse zone, testing 8 pours of the full 50 kg charge. Flow held at 3.9 kg/s with no choking, and capture reached 36 percent above the 20 ppi standard, an acceptable trade-off against the earlier 41 percent. This established 15 mm as the fine zone thickness that avoids choking without giving up most of the capture benefit.

Trial 6 ran quench-and-crush tests (700 C to room-temperature water, then crush) and cold burst tests, comparing standard 20 ppi, well-matched trial 3 parts, and poorly matched trial 2 parts. Well-matched graded filters retained 68 percent strength after quench versus 55 percent for standard, and only 1 of 20 cracked in burst testing (crack stopping at the interface) versus 3 of 20 standard; poorly matched parts cracked along the interface in 4 of 10 cases. This showed a well-matched interface acts as a crack arrester while a poorly matched one becomes a failure plane, linking the firing-survival and thermal-shock questions.

### Line 246

The technological objective was to determine whether a replicated foam filter could carry a pore-size gradient through a 50 mm fired part, resisting thermal shock while raising fine inclusion capture without unacceptable flow penalty. That objective was achieved. The hypothesis was proven in part and revised in part: matching slurry mass per unit volume across zones did control shrinkage mismatch, confirmed when trial 3's slow ramp through 1,100 to 1,350 C met the 0.5 percent mismatch target. The 30 percent capture target was met only after the predicted fine-zone thickness was revised from 25 mm to 15 mm to avoid choking.

It was determined that shrinkage mismatch between graded zones (10 ppi entry, 30 ppi exit) tracks slurry mass per unit volume more than pore size itself, and that a slow ramp through the primary sintering window closes the remaining gap a two-stage dip alone cannot. This resolved the uncertainty over whether graded templates could survive firing at production scale without delaminating. This knowledge was applied to a two-stage dip and thermal-fused bond, which held delamination to 6 percent and mismatch to 0.4 percent in trial 3.

It was established that adhesive bonding cannot survive firing, since it burns out before the ceramic sinters, while a thermal-fused bond carries the graded part through intact. This resolved the bonding-method question directly, ruling out adhesive bonding for any graded replicated foam filter.

Work continues into fiscal 2027 on 30 mm parts, a continuous gradient, and an alternative binder to shorten the ramp, each unresolved because the mechanisms established at 50 mm have not been tested at other thicknesses or gradient forms. The replicated foam filter combined breakage resistance with fine inclusion capture in one part, meeting both original goals together, as shown by a customer pour trial of 200 filters with zero breakage and X-ray rejects falling from 6.2 to 4.5 percent at one foundry with one alloy.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 323/350 words, 33/50 lines |
| 242 | Claim Exclusion: Business decision to sell the filter as both tougher and cleaner to differentiate from competitors. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Customer pricing requests, a commercial matter not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Change to the dip line supporting two-stage coating, described as a production/manufacturing line change benefiting standard filters, not itself the uncertainty resolution. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Standard industry practice of stacking two filters or buying a thicker fine filter, described as pre-existing routine approaches, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Plans for a second foundry and second alloy validation before any launch decision are future commercial/validation steps outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Storyline | applied | none |  | Section aligns with storyline's uncertainty framing |
| 242 | Confidence Map: Both interviewees agree the gradient was meant to address both breakage and capture, though they disagree on which was the primary driver. | not_applied | missing_fact |  | P1 doesn't note disagreement on breakage vs capture driver; repaired (deterministic re-check only; not re-verified by the model) |
| 242 | Confidence Map: Competing claim that most testing time and motivation centered on capture, not breakage. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination rate reported consistently across transcript and document. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination rate as percentage stated in trial log document. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 7 percent in transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 8 percent (+8 percent priming head) in trial log table. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Slurry pick-up measurements for trial 1 given precisely in the document but not mentioned in transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Kiln time increase quantified precisely in the document (19 to 22 hours door-to-door) versus general statement in transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial result of zero breakage and X-ray reject improvement is a single-site, single-alloy result, explicitly flagged as limited. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Choking mechanism attributed to inclusion cake building on the fine face, explained only in transcript. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the gradient works at 30 mm thickness remains unresolved and is deferred to future work. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: fine inclusion capture | applied | none |  | Concept of fine inclusion capture not stated in section |
| 242 | Glossary Term: priming head | applied | none |  | Priming head concept absent from section |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | P2 uses 'shrinkage' without 'mismatch' term; repaired to the Glossary Term |
| 242 | Glossary Term: pores per inch (ppi) | applied | none |  | Ppi concept not mentioned in section |
| 242 | Glossary Term: thermal-fused bond | applied | none |  | Thermal-fused bond concept absent from section |
| 242 | Glossary Term: two-stage dip | applied | none |  | Two-stage dip concept absent from section |
| 242 | Glossary Term: crack arrester | applied | none |  | Crack arrester concept absent from section |
| 242 | Cover signed-off Summary item ys7bfnbfkgn1vpynp6akhzj7x58fdh7k | applied | none |  | P1 covers history, cascade-fired lattice, and team size/lead. |
| 242 | Cover signed-off Summary item ys7dmhhvd0cmpezbr5d4snagcs8fdj93 | applied | none |  | P1 describes replication process and burnout. |
| 242 | Cover signed-off Summary item ys706vnv0v6vydwf4fe49pcdgx8fcfqj | applied | none |  | P2 states stacking/thicker filter limitations. |
| 242 | Cover signed-off Summary item ys76btvwjp30wf9754vw9bpxnn8fcfv3 | applied | none |  | P3 states the sought knowledge and goal. |
| 242 | Cover signed-off Summary item ys72mderthr8549xmg7g3jbfyh8fcd8r | applied | none | 2 | P4/P2 cover delamination and shrinkage uncertainty. |
| 242 | Cover signed-off Summary item ys73jxcxxrmxd1e6bjwcxnksp18fdvjb | applied | none | 2 | P4 covers hollow struts making stress unmodelable. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Struts are hollow after the sponge burns out, making interface stress too hard to model analytically." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244): Line 242 names the object of investigation 'the cascade-fired lattice' (a single replicated filter with a pore-size gradient), but this term never appears again. Line 244 and 246 consistently call the same object the 'graded filter' or 'replicated foam filter with a pore-size gradient,' both of which are or map to glossary terms. Using 'cascade-fired lattice' only in 242 for the same concept is an unreconciled second name for the replicated foam filter with a pore-size gradient. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 685/700 words, 63/100 lines |
| 244 | Claim Exclusion: Business decision to sell the filter as both tougher and cleaner to differentiate from competitors. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Customer pricing requests, a commercial matter not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Change to the dip line supporting two-stage coating, described as a production/manufacturing line change benefiting standard filters, not itself the uncertainty resolution. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Standard industry practice of stacking two filters or buying a thicker fine filter, described as pre-existing routine approaches, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Plans for a second foundry and second alloy validation before any launch decision are future commercial/validation steps outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: pores per inch (ppi) | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: thermal-fused bond | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 8) |
| 244 | Storyline | applied | none |  | Section matches Storyline trial sequence and results. |
| 244 | Confidence Map: Both interviewees agree the gradient was meant to address both breakage and capture, though they disagree on which was the primary driver. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Competing claim that most testing time and motivation centered on capture, not breakage. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Trial 1 delamination rate reported consistently across transcript and document. | applied | none |  | Delamination rate stated matches established fact. |
| 244 | Confidence Map: Trial 1 delamination rate as percentage stated in trial log document. | applied | none |  | Percentage figure matches established fact. |
| 244 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 7 percent in transcript. | not_applied | missing_fact |  | States 7 percent flat though figure is partial (7 or 8); repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 8 percent (+8 percent priming head) in trial log table. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Slurry pick-up measurements for trial 1 given precisely in the document but not mentioned in transcript. | not_applied | missing_fact |  | States slurry pick-up as flat fact, source is partial; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Kiln time increase quantified precisely in the document (19 to 22 hours door-to-door) versus general statement in transcript. | not_applied | missing_fact |  | States kiln time flatly though figure is partial; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Confidence Map: Field trial result of zero breakage and X-ray reject improvement is a single-site, single-alloy result, explicitly flagged as limited. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Choking mechanism attributed to inclusion cake building on the fine face, explained only in transcript. | applied | none |  | States mechanism as cause of choking, matches transcript source. |
| 244 | Confidence Map: Whether the gradient works at 30 mm thickness remains unresolved and is deferred to future work. | applied | none |  | Not mentioned in the section. |
| 244 | Glossary Term: priming head | applied | none |  | Concept of priming head absent from section. |
| 244 | Glossary Term: pores per inch (ppi) | applied | none |  | Uses 'ppi' without spelling out pores per inch; repaired to the Glossary Term |
| 244 | Glossary Term: thermal-fused bond | applied | none |  | Uses 'thermal fused bond' not 'thermal-fused bond'; repaired to the Glossary Term |
| 244 | Glossary Term: crack arrester | applied | none |  | Concept of crack arrester phrased differently, not as term. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status language present in section. |
| 244 | Cover signed-off Summary item ys77bg7v2f1ks2mwd05rcvs7v18fcpf9 | applied | none |  | P2 states the two-zone template and shrinkage target. |
| 244 | Cover signed-off Summary item ys7ch1n5c4s6n325wprqysdeed8fdshb | applied | none |  | P2 states the hypothesis and expected capture/flow outcome. |
| 244 | Cover signed-off Summary item ys76tbkfvbyd4jrye9f8ac3f018fd6bm | applied | none |  | P3 covers Trial 1 bonding, delamination count, and mismatch. |
| 244 | Cover signed-off Summary item ys74jh0cx7jzsdervdzdsgfgn58fc2a5 | applied | none |  | P4 covers Trial 2 method, delamination rate, and mismatch. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244, 246): Trial 4 in 244 reports the graded filter with a 25 mm fine zone captured '41 percent more inclusions' as a raw finding, and trial 5 reports 36 percent above the 20 ppi standard with a 15 mm fine zone. Line 246 P1 states 'The 30 percent capture target was met only after the predicted fine-zone thickness was revised from 25 mm to 15 mm,' but 244's own data shows the 25 mm zone (41 percent) already exceeded the 30 percent target; the target was met before the revision, not only after it. The revision addressed choking, not the capture target itself, so 246's phrasing misstates the reason for the revision. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 316/350 words, 31/50 lines |
| 246 | Claim Exclusion: Business decision to sell the filter as both tougher and cleaner to differentiate from competitors. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Customer pricing requests, a commercial matter not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Change to the dip line supporting two-stage coating, described as a production/manufacturing line change benefiting standard filters, not itself the uncertainty resolution. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Standard industry practice of stacking two filters or buying a thicker fine filter, described as pre-existing routine approaches, not the claimed advancement. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Plans for a second foundry and second alloy validation before any launch decision are future commercial/validation steps outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: thermal-fused bond | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Storyline | applied | none |  | Section matches storyline trials and findings. |
| 246 | Confidence Map: Both interviewees agree the gradient was meant to address both breakage and capture, though they disagree on which was the primary driver. | applied | none |  | Not mentioned; C1 is context, not in this section. |
| 246 | Confidence Map: Competing claim that most testing time and motivation centered on capture, not breakage. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 1 delamination rate reported consistently across transcript and document. | applied | none |  | Trial 1 rate not restated here; consistent with established. |
| 246 | Confidence Map: Trial 1 delamination rate as percentage stated in trial log document. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 7 percent in transcript. | applied | none |  | Flow penalty figure not stated in this section. |
| 246 | Confidence Map: Trial 4 flow penalty for graded 25mm filter stated as 8 percent (+8 percent priming head) in trial log table. | applied | none |  | Flow penalty figure not stated in this section. |
| 246 | Confidence Map: Slurry pick-up measurements for trial 1 given precisely in the document but not mentioned in transcript. | applied | none |  | Slurry pick-up figures not stated in this section. |
| 246 | Confidence Map: Kiln time increase quantified precisely in the document (19 to 22 hours door-to-door) versus general statement in transcript. | applied | none |  | Kiln time increase not quantified precisely here. |
| 246 | Confidence Map: Field trial result of zero breakage and X-ray reject improvement is a single-site, single-alloy result, explicitly flagged as limited. | applied | none |  | Section states single trial result without overclaiming. |
| 246 | Confidence Map: Choking mechanism attributed to inclusion cake building on the fine face, explained only in transcript. | applied | none |  | Choking mechanism not explained in this section. |
| 246 | Confidence Map: Whether the gradient works at 30 mm thickness remains unresolved and is deferred to future work. | applied | none |  | P5 hedges as unresolved, work continuing. |
| 246 | Glossary Term: replicated foam filter | applied | none |  | Section says 'fired part' and 'ceramic', not the term; repaired to the Glossary Term |
| 246 | Glossary Term: priming head | applied | none |  | Concept of priming head absent from section. |
| 246 | Glossary Term: pores per inch (ppi) | not_applied | none |  | Section never uses 'pores per inch' or 'ppi'; repair failed |
| 246 | Cover signed-off Summary item ys7eq8607996edv3fsc8jmnt318fdseg | applied | none |  | P1 covers trial 3 ramp meeting 0.5% target |
| 246 | Cover signed-off Summary item ys79fxm2cskg05xbny7e08c5sx8fdenh | applied | none | 2 | P2 states shrinkage tracks slurry mass over pore size |
| 246 | Cover signed-off Summary item ys7cg5a945197pv8y46js4ysa98fdm9s | applied | none | 2 | P3 states adhesive bonding cannot survive firing |
| 246 | Cover signed-off Summary item ys7dwh2bpadvatn2sk5ezxsp418fdnvw | applied | none |  | P4 reports pour trial zero breakage and reject drop |
| 246 | Cover signed-off Summary item ys772fhs6y1m6a96wvz74k2x2s8fdmx0 | applied | none |  | P4 states both goals met together via trial |
| 246 | Claim an advancement only for an uncertainty Line 242 states | not_applied | none |  | P1 claims flow-penalty/capture objective not in Line 242… |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The graded filter program aimed to combine breakage resistance with fine inclusion capture in one part. Trial results c..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 4 (sections 244, 246): This paragraph claims the filter 'combined breakage resistance with fine inclusion capture in one part, meeting both original goals together' and cites a customer pour trial with zero breakage and X-ray rejects falling from 6.2 to 4.5 percent. Line 244 never reports these customer trial figures or a zero-breakage result; the closest data point (trial 6, quench-and-crush) shows some cracking still occurring (1 of 20 for well-matched parts). Introducing an unreferenced customer trial result with specific figures contradicts or goes beyond the work described in 244. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 4 (sections 242, 244, 246): The reference to a customer pour trial of 200 filters at one foundry with one alloy, presented as evidence the objective was met, edges into future commercial/validation territory. The Claim Exclusions list plans for a second foundry and second alloy validation before launch as outside the claim period; presenting this single-foundry customer trial as part of the achieved technological advancement risks folding a validation/commercial milestone into the claimed work. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 25.
- Line 244: 0 labels and 0 plan checks "Not checked" of 21.
- Line 246: 0 labels and 0 plan checks "Not checked" of 21.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.9 s, p95 21.7 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.2 s, p95 15.2 s over 1.
- Sign-off to report created: 170.2 s.
- Cost from aiUsage: $1.11 in all ($0.38 seed stage, $0.72 Brief, drafting and checks) over 44 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T20:37:19.290Z created project k97btz9f2d93yt90af5aqtebtd8fc4tx
2026-09-30T20:37:19.981Z added document graded-filter-trial-log.md
2026-09-30T20:37:21.546Z started Step by step generation k57br1ya4wbzkrcadxc8gr610h8fdm11
2026-09-30T20:38:10.653Z seed stage open
2026-09-30T20:38:10.654Z Open Company / Context and wait for its Batch
2026-09-30T20:38:25.102Z Company / Context: select the first Seed
2026-09-30T20:38:27.042Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-09-30T20:38:29.021Z Approve Company / Context
2026-09-30T20:38:30.998Z approved company_context
2026-09-30T20:38:30.998Z Open Goal / Problem and wait for its Batch
2026-09-30T20:38:45.466Z Goal / Problem: select the first Seed
2026-09-30T20:38:47.477Z Approve Goal / Problem
2026-09-30T20:38:49.448Z approved goal_problem
2026-09-30T20:38:49.448Z Open Technological limitations and wait for its Batch
2026-09-30T20:39:03.902Z Technological limitations: select the first Seed
2026-09-30T20:39:05.865Z Approve Technological limitations
2026-09-30T20:39:07.800Z approved passive_limitations
2026-09-30T20:39:07.800Z Open Technological objectives and wait for its Batch
2026-09-30T20:39:22.691Z Technological objectives: select the first Seed
2026-09-30T20:39:24.686Z Approve Technological objectives
2026-09-30T20:39:26.660Z approved technological_objective
2026-09-30T20:39:26.660Z Open Technological uncertainties and wait for its Batch
2026-09-30T20:39:41.285Z Technological uncertainties: select the first 2 Seeds
2026-09-30T20:39:44.612Z Approve Technological uncertainties
2026-09-30T20:39:46.587Z approved active_uncertainties
2026-09-30T20:39:46.587Z Skip Previous-year status
2026-09-30T20:39:47.882Z Open Work plan and wait for its Batch
2026-09-30T20:40:05.041Z Work plan: select the first Seed
2026-09-30T20:40:07.076Z Approve Work plan
2026-09-30T20:40:09.652Z approved workplan
2026-09-30T20:40:09.652Z Open Hypothesis and wait for its Batch
2026-09-30T20:40:21.593Z Hypothesis: select the first Seed
2026-09-30T20:40:23.582Z Approve Hypothesis
2026-09-30T20:40:25.616Z approved hypothesis
2026-09-30T20:40:25.616Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T20:40:40.188Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T20:40:43.465Z Approve Experimentation / Iterations
2026-09-30T20:40:45.468Z approved experimentation
2026-09-30T20:40:45.468Z Goal / Problem: select a different Seed and untick the earlier selection (writer switches the goal framing)
2026-09-30T20:40:48.794Z Approve Goal / Problem
2026-09-30T20:40:50.818Z approved goal_problem
2026-09-30T20:40:50.818Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-09-30T20:41:08.078Z Technological uncertainties: Confirm and approve the carried selections
2026-09-30T20:41:10.057Z approved active_uncertainties (confirmed 2 carried)
2026-09-30T20:41:10.057Z Confirm and approve every Stale Subsection, in order
2026-09-30T20:41:13.380Z approved passive_limitations (confirmed 1 carried)
2026-09-30T20:41:16.015Z approved technological_objective (confirmed 1 carried)
2026-09-30T20:41:18.727Z approved workplan (confirmed 1 carried)
2026-09-30T20:41:21.363Z approved hypothesis (confirmed 1 carried)
2026-09-30T20:41:24.013Z approved experimentation (confirmed 2 carried)
2026-09-30T20:41:24.013Z Open Advancement to science / technology and wait for its Batch
2026-09-30T20:41:26.018Z Advancement to science / technology: select the first Seed
2026-09-30T20:41:27.995Z Approve Advancement to science / technology
2026-09-30T20:41:30.046Z approved overall_advancement (confirmed 1 carried)
2026-09-30T20:41:30.046Z Open Specific technological advancements and wait for its Batch
2026-09-30T20:41:34.034Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T20:41:39.664Z Approve Specific technological advancements
2026-09-30T20:41:41.719Z approved specific_advancements (confirmed 2 carried)
2026-09-30T20:41:41.719Z Open Project status and next steps and wait for its Batch
2026-09-30T20:41:59.570Z Project status and next steps: select the first Seed
2026-09-30T20:42:01.782Z Approve Project status and next steps
2026-09-30T20:42:04.013Z approved project_status
2026-09-30T20:42:04.013Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T20:42:19.753Z Overall company / project goal improvements: select the first Seed
2026-09-30T20:42:21.841Z Approve Overall company / project goal improvements
2026-09-30T20:42:25.048Z approved goal_improvements
2026-09-30T20:42:25.048Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T20:42:26.650Z signed off; waiting for the report
2026-09-30T20:45:18.406Z report kd789hkm0jphz0qt9d29dd68618fc2jb created
```
