# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `df6eb97b`, acting as chat-live-1793085355051@example.test. Project `k971q5xt2p3zvbph5gvae5e5ts8h31wp`, generation `k57eerfz6fx5jw1jwvrvssc8658h3tak`.

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
   - Answer: 
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: 
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: 
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd75mcs5ddyqpz782yndmngsfn8h2jr1 |
| All three Sections were drafted | pass | 242: 306 words, 244: 690 words, 246: 323 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work ties to Line 242 uncertainties."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P1 says "It has made sponge-replicated filters for over twenty years.", but the sources say "We've made foam-ceramic filters for metal foundries for a little..."); 244: not_applied ("P3 says "and the adhesive left a burnout gap.", but the sources say "Adhesive left a visible burnout gap of 0.3 to 0.6 mm."."); 246: not_applied ("P3 says "a 25 mm layer choked in 2 of 6 pours, while a 15 mm layer held 3.9 kg/s with capture 36 percent above the 20 ppi filter", but the sources say "Grade...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (6.9 s, 9.0 s); 244: 2 requests (7.4 s, 6.9 s); 246: 2 requests (8.6 s, 9.1 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 16 metered calls (16 Batch, 0 Feedback), 17 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company makes foam-ceramic filters for metal foundries. The team calls the graded structure the cascade-fired lattice." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "ters for metal foundries, and the team calls its graded structure the cascade-fired lattice. The company set out to make a filter that cracks less and catches mo" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "Company and cascade-fired lattice named." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company makes foam-ceramic filters for metal foundries. The team calls the graded structure the cascade-fired lattice. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The business goal is a filter that cracks less and catches more fine inclusions. / Thin-wall customers need cleaner metal without slow filling. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- The standard answer is to stack two filters, which doubles the cost. / A gap between the two pieces lets metal bypass. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether a two-zone template would survive firing without delamination. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team did not know if the shrinkage mismatch would tear the part apart at the interface. _(cited, carried from an older context)_
- Slurry loading per strut varies across the part, so the outcome could not be calculated. / Hollow struts after burnout meant interface stress could not be modelled well. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- Phase one made graded green bodies that survive firing, to test the shrinkage mismatch at the interface. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If a 10 ppi and 30 ppi template carries matched slurry mass, then mismatch stays within 0.5 percent. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team did not know if the shrinkage mismatch would tear the part apart, so trial 1 bonded sponge sheets with adhesive. _(cited, carried from an older context)_
  - Tested: uncertainty "The team did not know if the shrinkage mismatch would tear the part..."
- Trial 3 kept the two-stage dip and added a slow ramp, giving a mismatch of 0.4 percent. _(cited, carried from an older context)_
  - Tested: uncertainty "The team did not know if the shrinkage mismatch would tear the part..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team did not know if the shrinkage mismatch would tear the part apart, but trial 3 met the target. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Shrinkage mismatch tracks slurry mass per volume more than pore size. _(cited, carried from an older context)_
  - Links: uncertainty "The team did not know if the shrinkage mismatch would tear the part..."; experiments "The team did not know if the shrinkage mismatch would tear the part...", "Trial 3 kept the two-stage dip and added a slow ramp, giving a mism..."
- Adhesive bonding is not viable because it burns out before the ceramic sinters. _(cited, carried from an older context)_
  - Links: uncertainty "The team did not know if the shrinkage mismatch would tear the part..."; experiments "The team did not know if the shrinkage mismatch would tear the part..."

### 12. Project status and next steps (Section 246, standard): approved

- The open question is whether the gradient works at 30 mm thickness, the highest volume format. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team could not tell if mismatch would tear the part, and learned a two-stage dip plus slow ramp brings it under 0.5 percent. _(writer-asserted, carried from an older context)_

## Drafted Sections

### Line 242

It was uncertain whether a two-zone template with a 10 ppi entry and 30 ppi exit could survive firing without delamination, because slurry loading per strut varies across the part and the outcome could not be calculated. Dunmore Falls Ceramics is a manufacturer of foam-ceramic filters for metal foundries, and the team calls its graded structure the cascade-fired lattice. The company set out to make a filter that cracks less and catches more fine inclusions, so thin-wall customers get cleaner metal without slow filling. It has made sponge-replicated filters for over twenty years.

The limitations to standard practice were that the knowledge required to build a graded filter from replicated foam was insufficient. Stacking two filters doubles the cost, and the gap between the pieces lets metal bypass. Thicker fine filters crack worse and prime harder. No documented methods existed for a replicated foam with a pore gradient through 50 mm fired at production scale; published graded foams were lab-scale and made by other methods. Shrinkage data existed only for uniform filters.

The technological objective was to advance the understanding of firing shrinkage matching, fine-inclusion capture versus flow, and thermal shock behaviour in sponge-replicated foam with a pore-size gradient, for the purpose of producing a graded filter for aluminium casting. The team sought to learn whether a two-zone template would survive firing without delamination.

The team did not know if the shrinkage mismatch would tear the part apart at the interface. It was uncertain whether interface stress could be predicted, because the struts are hollow after burnout and interface stress could not be modelled well. It was also uncertain whether the graded filter could raise capture of 20 to 80 micron inclusions while holding flow and priming head near the standard 20 ppi filter, and whether the interface would stop or start cracks under thermal shock.

### Line 244

The technological problem was whether a sponge-replicated alumina foam with a 10 ppi entry zone and a 30 ppi exit zone could survive firing without delamination, because slurry loading per strut varies across the part. The team planned the work in August 2025 in three phases, covering the uncertainties stated in Line 242. Phase 1 made graded green bodies that survive firing, to test the shrinkage mismatch at the interface. Phase 2 measured flow and fine-inclusion capture on the survivors. Phase 3 ran thermal shock and burst tests, then a pour trial at a customer foundry.

It was hypothesized that if a 10 ppi and 30 ppi two-zone template carries matched slurry mass per volume, then linear firing shrinkage across the interface will stay within 0.5 percent and the part will survive firing without delamination. The graded filter should then capture at least 30 percent more 20 to 80 micron inclusions than the standard 20 ppi filter, at a flow rate no more than 10 percent lower. Results outside these thresholds would disprove it.

The team did not know if the shrinkage mismatch would tear the part apart at the interface, so trial 1 (September 2025) bonded 10 ppi and 30 ppi sponge sheets (25 mm each) with polyurethane adhesive. It used a single dip in standard alumina slurry (about 2,400 mPa.s). Firing was standard (1,580 C peak, 2 h hold) on 24 filters of 75x75x50 mm. Delamination at the bond line affected 18 of 24 parts. On the survivors, the 30 ppi side shrank 1.4 percent more than the 10 ppi side. The finer sponge picked up more slurry per volume, and the adhesive left a burnout gap. The team concluded that unequal slurry pick-up is linked to the mismatch and that adhesive bonding is not viable.

Trial 2 (October-November 2025) fused the sponges thermally instead of using adhesive and applied a two-stage dip: the whole part in about 1,500 mPa.s slurry, then only the coarse half in 2,400 mPa.s slurry. Delamination fell to 9 of 40 parts and the shrinkage mismatch to 0.7 percent, still above the 0.5 percent target. Equalising slurry mass per volume helped but did not close the gap alone.

Trial 3 (December 2025-January 2026) kept the two-stage dip and added a slow ramp of 1 C per minute between 1,100 and 1,350 C, with a 45 minute hold at 1,350 C. Only 2 of 36 parts delaminated, and the shrinkage mismatch measured 0.4 percent, within target. The extra kiln time was about 3 hours per load. The team concluded that mismatch is driven more by slurry mass per volume than by pore size, and that a slow ramp through the sintering window absorbs the remaining difference.

Trial 4 (February 2026) tested capture and flow on a rig using 50 kg of A356 per run at 720 C, with 6 pours each of the standard 20 ppi, standard 30 ppi and graded filter (25 mm fine zone). The 20 ppi filter gave about 4.1 kg/s; the 30 ppi gave 2.9 kg/s with a 30 percent higher priming head. The graded filter gave 3.8 kg/s, 7 percent below the 20 ppi, and captured 41 percent more inclusions, meeting both targets. In 2 of 6 graded pours, however, the fine side choked near the end. Trial 5 (March 2026) reduced the fine exit layer to 15 mm over 8 pours. Flow held at 3.9 kg/s across the full 50 kg with no choking, and capture was 36 percent above the 20 ppi. The team chose the 15 mm layer.

Trial 6 (April 2026) asked whether the interface would stop or start cracks. After quenching from 700 C into room-temperature water, retained strength was about 55 percent for the standard 20 ppi and 68 percent for the graded filter. In burst tests with a 300 mm head, 3 of 20 standard 50 mm filters cracked, against 1 of 20 graded filters, where the crack stopped at the interface. Of 10 retained trial 2 parts, which had higher mismatch, 4 cracked along the interface. A well-matched interface therefore arrested cracks, while a poorly matched one became the failure plane.

### Line 246

The team did not know if the shrinkage mismatch would tear the part apart at the interface, and trial 3 resolved that question: the mismatch measured 0.4 percent against the 0.5 percent limit, with 2 of 36 parts showing delamination. The technological objective was to advance understanding of shrinkage matching, fine-inclusion capture versus flow, and thermal shock behaviour in sponge-replicated foam with a pore-size gradient. The hypothesis was partly proven. The graded filter also met the capture and flow targets in trial 4: 41 percent more inclusions captured, with flow 7 percent below the 20 ppi filter.

Shrinkage mismatch tracks slurry mass per volume more than pore size. Based on this, the team adopted a two-stage dip and a slow ramp of 1 C per minute between 1,100 and 1,350 C, which absorbed the remaining difference. Adhesive bonding is not viable because it burns out before the ceramic sinters. Trial 1 confirmed this: 18 of 24 parts delaminated at the bond line, and thermal fusing replaced adhesive.

A well-matched interface arrests cracks, while a poorly matched one becomes the failure plane. In trial 6, retained strength was 68 percent for the graded filter against 55 percent for the standard 20 ppi filter. Fine exit layer thickness also governs choking: a 25 mm layer choked in 2 of 6 pours, while a 15 mm layer held 3.9 kg/s with capture 36 percent above the 20 ppi filter.

The open question is whether the graded filter works at 30 mm thickness, the highest volume format. It remains uncertain because shrinkage and choking behaviour were established only at 50 mm. The planned approach is to repeat the two-stage dip and ramp work at 30 mm.

The project goal was a graded filter that cracks less and captures more fine inclusions. The team could not tell whether mismatch would tear the part, and learned that a two-stage dip plus a slow ramp brings it under 0.5 percent.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 306/350 words, 30/50 lines |
| 242 | Claim Exclusion: Sales positioning and customer pricing requests are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Dip line change that improved uniform filters is process improvement outside the experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The 2023 dip trial predates the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Fiscal 2027 items are outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Trial 1 results are supported by the log. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 3 results are supported by the interview. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Section does not pick a single driving problem. |
| 242 | Confidence Map: Priming head penalty for graded filter: the interview gives no figure while the log gives one. | applied | none |  | No priming head figure stated. |
| 242 | Confidence Map: Field trial result is limited to one foundry and alloy. | applied | none |  | Field trial not mentioned. |
| 242 | Confidence Map: Whether the gradient works at 30 mm is unknown. | applied | none |  | 30 mm not mentioned. |
| 242 | Glossary Term: two-stage dip | applied | none |  | Concept absent. |
| 242 | Glossary Term: slurry mass per volume | applied | none |  | Concept absent. |
| 242 | Glossary Term: fine exit layer | applied | none |  | Concept absent. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57j0nm6mptfceyd5j67anqhqs8h3fvp | applied | none |  | Company and cascade-fired lattice named. |
| 242 | Cover signed-off Summary item h57hme6cyffgga2j3ktkt1jrzx8h2nxn | applied | none |  | Goal and thin-wall need stated. |
| 242 | Cover signed-off Summary item h57ky06ftjv64zehgg2sf8a62n8h37pw | applied | none |  | Stacking cost and bypass gap stated. |
| 242 | Cover signed-off Summary item h57zqfj0f5qx5xntqa5jz10agh8h28va | applied | none |  | Objective states the delamination question. |
| 242 | Cover signed-off Summary item h57vwes58kj743q52rsjsnmted8h2fcy | applied | none | 2 | Mismatch tearing uncertainty stated. |
| 242 | Cover signed-off Summary item h57yepmdkgew001thf53c8wx3x8h299m | applied | none | 2 | Slurry loading and hollow struts covered. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P1 says "It has made sponge-replicated filters for over twenty years.", but the sources say "We've made foam-ceramic filters for metal foundries for a little over twenty years.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Slurry loading per strut varies across the part, so the outcome could not be calculated. Hollow struts after burnout me..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 4 (sections 242, 244): Line 242 says the struts are hollow after burnout and interface stress could not be modelled; Line 244 attributes the mismatch to slurry pick-up. Not a clear conflict, but Line 242 P1 uses 'cascade-fired lattice' and 'graded structure' while the Glossary term is 'graded filter'. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 690/700 words, 61/100 lines |
| 244 | Claim Exclusion: Sales positioning and customer pricing requests are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Dip line change that improved uniform filters is process improvement outside the experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The 2023 dip trial predates the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Fiscal 2027 items are outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Trial 1 results are supported by the log. | applied | none |  | Trial 1 matches the log. |
| 244 | Confidence Map: Trial 3 results are supported by the interview. | applied | none |  | Trial 3 matches the interview. |
| 244 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Driver dispute not stated flatly. |
| 244 | Confidence Map: Priming head penalty for graded filter: the interview gives no figure while the log gives one. | applied | none |  | Priming head penalty for graded filter not stated. |
| 244 | Confidence Map: Field trial result is limited to one foundry and alloy. | applied | none |  | Field trial not mentioned. |
| 244 | Confidence Map: Whether the gradient works at 30 mm is unknown. | applied | none |  | 30 mm not mentioned. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status absent. |
| 244 | Cover signed-off Summary item h57ry0r2deyhta24v8jrp92f458h37dk | applied | none |  | Phase 1 stated. |
| 244 | Cover signed-off Summary item h57j23qesgv5m3w9w0dvzf1qjh8h330y | applied | none |  | Hypothesis stated. |
| 244 | Cover signed-off Summary item h57j6ax030tnwv0d8c1sskv54n8h31tq | applied | none |  | Trial 1 stated with uncertainty. |
| 244 | Cover signed-off Summary item h57s5rfc9950zqywq6f4sgwvws8h3qqb | applied | none |  | Trial 3 with 0.4 percent. |
| 244 | State figures and details as the sources give them | not_applied | none |  | P3 says "and the adhesive left a burnout gap.", but the sources say "Adhesive left a visible burnout gap of 0.3 to 0.6 mm.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work ties to Line 242 uncertainties. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The team did not know if the shrinkage mismatch would tear the part apart, so trial 1 bonded sponge sheets with adhesiv..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 323/350 words, 31/50 lines |
| 246 | Claim Exclusion: Sales positioning and customer pricing requests are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Dip line change that improved uniform filters is process improvement outside the experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The 2023 dip trial predates the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Fiscal 2027 items are outside the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | not_applied | none |  | P3 says 25 mm choked but trial 4 vs 5 mixed; capture 3.9 kg/s ok; found on the final text |
| 246 | Confidence Map: Trial 1 results are supported by the log. | applied | none |  | Trial 1 figures match the log. |
| 246 | Confidence Map: Trial 3 results are supported by the interview. | applied | none |  | Trial 3 figures match. |
| 246 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Driver dispute not stated flatly. |
| 246 | Confidence Map: Priming head penalty for graded filter: the interview gives no figure while the log gives one. | applied | none |  | Priming head penalty not stated. |
| 246 | Confidence Map: Field trial result is limited to one foundry and alloy. | applied | none |  | Field trial not mentioned. |
| 246 | Confidence Map: Whether the gradient works at 30 mm is unknown. | applied | none |  | P4 states 30 mm as uncertain. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57yef5fy2gjjbavcm6krywbhd8h33dd | applied | none |  | P1 states the uncertainty and trial 3 result. |
| 246 | Cover signed-off Summary item h57jq1fkvp2p2bpbp0k6zp56a98h3bpj | applied | none | 2 | P2 states mismatch tracks slurry mass. |
| 246 | Cover signed-off Summary item h57wd1rm417ks0262qtpj3w9y18h21v3 | applied | none | 2 | P2 states adhesive not viable. |
| 246 | Cover signed-off Summary item h57hvjzmrksph7vjhvcyz0ccv58h30q2 | applied | none |  | P4 gives the 30 mm open question. |
| 246 | Cover signed-off Summary item h57k65v7srv9ebfjp5be7jjmrx8h2x29 | applied | none |  | P5 states goal and learning. |
| 246 | State figures and details as the sources give them | not_applied | none |  | P3 says "a 25 mm layer choked in 2 of 6 pours, while a 15 mm layer held 3.9 kg/s with capture 36 percent above the 20 ppi filter", but the sources say "Graded filter with 15 mm fine zone and 35 mm coarse zone. Eight pours.". P4 says "It remains uncertain because shrinkage and choking behaviour were established only at 50 mm.", but the sources say "What's still open is whether the gradient works at 30 mm thickness, which is our biggest volume". |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Results answer stated uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team did not know if the shrinkage mismatch would tear the part apart, but trial 3 met the target." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 says adhesive is not viable because it burns out before the ceramic sinters, and that trial 1 confirmed this. Line 244 trial 1 reports a burnout gap and delamination but did not test the burnout timing, so the stated cause is not established there. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the hypothesis was partly proven, yet by Line 244 trial 3 and trial 4 the shrinkage target (0.4 percent vs 0.5) and the capture and flow targets (41 percent, 7 percent) were all met. Trial 5 also showed capture of 36 percent, still above 30 percent. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 5 (sections 244, 246): Line 246 says the slow ramp plus the two-stage dip brings mismatch under 0.5 percent. Line 244 trial 2 shows the two-stage dip alone gave 0.7 percent; this is consistent, but the paragraph presents the result as solved while P4 says the 30 mm format is unresolved. Also Line 246 P1 says trial 3 resolved the question while P4 limits it to 50 mm. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 18.
- Line 244: 0 labels and 0 plan checks "Not checked" of 16.
- Line 246: 0 labels and 0 plan checks "Not checked" of 16.

## Seed-stage numbers

- Requests: 16 metered (16 Batch, 0 Feedback); 17 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.6 s, p95 16.6 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 8.6 s, p95 8.6 s over 1.
- Sign-off to report created: 103.2 s.
- Cost from aiUsage: $1.29 in all ($0.47 seed stage, $0.82 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T20:28:47.036Z created project k971q5xt2p3zvbph5gvae5e5ts8h31wp
2026-10-27T20:28:47.951Z marked as an evaluation project
2026-10-27T20:28:48.897Z added document graded-filter-trial-log.md
2026-10-27T20:28:50.751Z started Step by step generation k57eerfz6fx5jw1jwvrvssc8658h3tak
2026-10-27T20:29:06.515Z seed stage open
2026-10-27T20:29:06.517Z Open Company / Context and wait for its Batch
2026-10-27T20:29:14.894Z Company / Context: select the first Seed
2026-10-27T20:29:17.597Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-10-27T20:29:20.230Z Approve Company / Context
2026-10-27T20:29:22.891Z approved company_context
2026-10-27T20:29:22.891Z Open Goal / Problem and wait for its Batch
2026-10-27T20:29:29.016Z Goal / Problem: select the first Seed
2026-10-27T20:29:31.732Z Approve Goal / Problem
2026-10-27T20:29:34.520Z approved goal_problem
2026-10-27T20:29:34.520Z Open Technological limitations and wait for its Batch
2026-10-27T20:29:42.963Z Technological limitations: select the first Seed
2026-10-27T20:29:45.619Z Approve Technological limitations
2026-10-27T20:29:48.248Z approved passive_limitations
2026-10-27T20:29:48.248Z Open Technological objectives and wait for its Batch
2026-10-27T20:29:56.479Z Technological objectives: select the first Seed
2026-10-27T20:29:59.197Z Approve Technological objectives
2026-10-27T20:30:01.906Z approved technological_objective
2026-10-27T20:30:01.907Z Open Technological uncertainties and wait for its Batch
2026-10-27T20:30:11.174Z Technological uncertainties: select the first 2 Seeds
2026-10-27T20:30:15.731Z Approve Technological uncertainties
2026-10-27T20:30:18.523Z approved active_uncertainties
2026-10-27T20:30:18.524Z Skip Previous-year status
2026-10-27T20:30:20.416Z Open Work plan and wait for its Batch
2026-10-27T20:30:33.617Z Work plan: select the first Seed
2026-10-27T20:30:36.381Z Approve Work plan
2026-10-27T20:30:39.230Z approved workplan
2026-10-27T20:30:39.230Z Open Hypothesis and wait for its Batch
2026-10-27T20:30:47.581Z Hypothesis: select the first Seed
2026-10-27T20:30:50.375Z Approve Hypothesis
2026-10-27T20:30:53.333Z approved hypothesis
2026-10-27T20:30:53.334Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T20:31:01.640Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T20:31:06.645Z Approve Experimentation / Iterations
2026-10-27T20:31:09.377Z approved experimentation
2026-10-27T20:31:09.377Z Goal / Problem: select the Seed closest to "capture of fine inclusions" (else one that states a goal, else the next Seed on the page) and untick the earlier selection (writer switches the goal framing)
2026-10-27T20:31:10.273Z switching to the Seed closest to "capture of fine inclusions": gx7njdksf8a45rhzpmpaq39ce98h3t3g
2026-10-27T20:31:13.934Z Approve Goal / Problem
2026-10-27T20:31:18.494Z approved goal_problem
2026-10-27T20:31:18.494Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-10-27T20:31:27.018Z Technological uncertainties: Confirm and approve the carried selections
2026-10-27T20:31:29.697Z approved active_uncertainties (confirmed 2 carried)
2026-10-27T20:31:29.697Z Confirm and approve every Stale Subsection, in order
2026-10-27T20:31:34.164Z approved passive_limitations (confirmed 1 carried)
2026-10-27T20:31:37.831Z approved technological_objective (confirmed 1 carried)
2026-10-27T20:31:39.625Z workplan link notice: none
2026-10-27T20:31:45.841Z approved workplan (confirmed 1 carried)
2026-10-27T20:31:47.638Z hypothesis link notice: none
2026-10-27T20:31:53.912Z approved hypothesis (confirmed 1 carried)
2026-10-27T20:31:57.661Z approved experimentation (confirmed 2 carried)
2026-10-27T20:31:57.662Z Open Advancement to science / technology and wait for its Batch
2026-10-27T20:32:00.429Z Advancement to science / technology: select the first Seed
2026-10-27T20:32:03.156Z Approve Advancement to science / technology
2026-10-27T20:32:05.905Z approved overall_advancement (confirmed 1 carried)
2026-10-27T20:32:05.905Z Open Specific technological advancements and wait for its Batch
2026-10-27T20:32:08.624Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T20:32:15.882Z Approve Specific technological advancements
2026-10-27T20:32:18.618Z approved specific_advancements (confirmed 2 carried)
2026-10-27T20:32:18.618Z Open Project status and next steps and wait for its Batch
2026-10-27T20:32:21.535Z Project status and next steps: select the first Seed
2026-10-27T20:32:24.195Z Approve Project status and next steps
2026-10-27T20:32:26.898Z approved project_status (confirmed 1 carried)
2026-10-27T20:32:26.898Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T20:32:29.685Z Overall company / project goal improvements: select the first Seed
2026-10-27T20:32:33.064Z Approve Overall company / project goal improvements
2026-10-27T20:32:35.848Z approved goal_improvements (confirmed 1 carried)
2026-10-27T20:32:35.848Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T20:32:37.700Z signed off; waiting for the report
2026-10-27T20:34:23.732Z report kd75mcs5ddyqpz782yndmngsfn8h2jr1 created
```
