# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `08a53a18`, acting as chat-live-1793085355051@example.test. Project `k97bfm2ttdw6tk0nd7x3xzjd0s8h2dpa`, generation `k57crye4nfmfkfe128hdpa517h8h2w1z`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd758wjmbr5z561zaxg86tq7en8h35wv |
| All three Sections were drafted | pass | 242: 328 words, 244: 590 words, 246: 331 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work backs a stated uncertainty or Line 246 item."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P1 says "That sponge-replication experience gave it direct knowledge of how slurry loading and firing govern filter structure.", but the sources say "We had ..."); 244: not_applied ("P3 says "Eighteen of 24 delaminated at the bond line, with 1.4 percent shrinkage mismatch on the survivors.", but the sources say "Shrinkage mismatch on surv..."); 246: not_applied ("P2 says "Of 24 parts made in trial 1, 18 delaminated, with 1.4 percent shrinkage mismatch on the survivors.", but the sources say "Shrinkage mismatch on surv...") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (8.6 s, 8.0 s); 244: 2 requests (6.8 s, 6.7 s); 246: 2 requests (8.6 s, 6.4 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (19 Batch, 0 Feedback), 20 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The client is a foam-ceramic filter maker in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired lattice." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "g and perform in a pour, and the team calls this graded structure the cascade-fired lattice. Dunmore Falls Ceramics is a foam-ceramic filter manufacturer for met" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P1 names the client and the cascade-fired lattice." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The client is a foam-ceramic filter maker in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired lattice. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The client has made foam-ceramic filters for metal foundries for a little over twenty years. / Its plant is in Dunmore Falls, Ontario, with about 60 people. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Published graded foams are mostly lab scale, small discs made by gel casting or freeze casting, not sponge replication. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought to learn whether a graded replicated foam survives firing given different slurry pick-up and shrinkage. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team could not tell whether a 10 ppi and 30 ppi template would survive firing without separating. / Different pore sizes pick up different slurry amounts, so the shrinkage mismatch at the interface was unknown. _(cited, carried from an older context)_
- It was uncertain whether a gradient could raise capture of 20 to 80 micron inclusions without cutting flow more than 10 percent. _(writer-asserted, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- To test whether a graded foam survives firing, the team planned a 10 ppi and 30 ppi two-zone template. _(writer-asserted, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If both zones carry similar slurry mass per unit volume, linear firing shrinkage across the interface will match within 0.5 percent. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- The team could not tell if bonded templates would survive firing, so trial 1 used adhesive bonding. / Trial 1 delaminated 18 of 24 parts with 1.4 percent shrinkage mismatch. _(cited, carried from an older context)_
  - Tested: uncertainty "The team could not tell whether a 10 ppi and 30 ppi template would ..."
- Trial 3 kept the two-stage dip and added a slow ramp, giving a mismatch within target. _(cited, carried from an older context)_
  - Tested: uncertainty "The team could not tell whether a 10 ppi and 30 ppi template would ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team could not tell if a graded foam would survive firing, and trial 3 met the 0.5 percent target. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Adhesive bonding with a single dip was not viable, since 24 parts made, 18 delaminated. _(cited, carried from an older context)_
  - Links: uncertainty "The team could not tell whether a 10 ppi and 30 ppi template would ..."; experiments "The team could not tell if bonded templates would survive firing, s..."
- A two-stage dip with a slow ramp brought shrinkage mismatch to 0.4 percent, within target. _(cited, carried from an older context)_
  - Links: uncertainty "The team could not tell whether a 10 ppi and 30 ppi template would ..."; experiments "Trial 3 kept the two-stage dip and added a slow ramp, giving a mism..."

### 12. Project status and next steps (Section 246, standard): approved

- A customer pour trial used 200 filters at one foundry, with no breakage. / That trial is promising but covers one foundry and one alloy. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team learned how to make a two-zone replicated foam survive firing without delamination, which answers the original goal. _(cited, carried from an older context)_

## Drafted Sections

### Line 242

The technical uncertainty was whether a sponge-replicated alumina foam with a pore gradient through a 50 mm part could survive firing and perform in a pour, and the team calls this graded structure the cascade-fired lattice. Dunmore Falls Ceramics is a foam-ceramic filter manufacturer for metal foundries. The company set out to make a filter that resists cracking in the pour and captures more fine inclusions, though whether breakage or capture was the main driver was disputed. It has made these filters for a little over twenty years at its Dunmore Falls, Ontario plant, with about 60 people. That sponge-replication experience gave it direct knowledge of how slurry loading and firing govern filter structure.

The limitations to standard practice were that the knowledge required to build a pore gradient into a replicated foam was insufficient. Published graded foams are mostly lab scale, small discs made by gel casting or freeze casting, not sponge replication. No shrinkage data existed for parts where slurry loading, pore size and viscosity change across 50 mm. Interface stress depends on strut geometry on both sides, which could not be modelled well because the struts are hollow after the sponge burns out.

The technological objective was to advance the understanding of whether a graded replicated foam survives firing given different slurry pick-up and shrinkage, for the purposes of creating a graded filter with better fine-inclusion capture and thermal shock resistance at near-standard flow.

It was uncertain whether a 10 ppi and 30 ppi template would survive firing without separating, because different pore sizes pick up different slurry amounts and the shrinkage mismatch at the interface was unknown. It was also uncertain whether a gradient could raise capture of 20 to 80 micron inclusions without cutting flow more than 10 percent, because finer pores raise flow resistance and priming head. Finally, it remained uncertain whether the graded interface would arrest or initiate cracks under thermal shock, since published results on graded interfaces differ by material.

### Line 244

The technical uncertainty was whether a sponge-replicated alumina foam with a two-zone pore gradient could survive firing, because different pore sizes pick up different slurry amounts and the shrinkage mismatch at the interface was unknown. To test whether a graded foam survives firing, the team planned a 10 ppi and 30 ppi two-zone template, 50 mm thick, and a staged program. Phase one would make graded green bodies that survive firing. Phase two would test flow and capture on the survivors. Phase three would cover thermal shock and burst testing, then a pour trial. The program started August 18 2025, and the technician was full time from September 2 2025.

It was hypothesized that if both zones carry similar slurry mass per volume, achieved by adjusting slurry viscosity in a 10 ppi entry and 30 ppi exit template, then linear firing shrinkage across the interface will match within 0.5 percent and the part will survive firing without delamination. If the part survives, it should capture at least 30 percent more 20 to 80 micron inclusions than the standard 20 ppi filter at a flow rate no more than 10 percent lower. A trial with shrinkage mismatch above 0.5 percent, or with frequent delamination, would disprove the first clause.

The team could not tell if bonded templates would survive firing, so trial 1 (September 2025) used adhesive bonding. It bonded 25 mm sheets of 10 ppi and 30 ppi sponge with polyurethane adhesive. It then coated 24 parts of 75x75x50 mm in a single dip of standard alumina slurry at about 2,400 mPa.s. The parts were fired at a 1,580 C peak with a 2 h hold. Eighteen of 24 delaminated at the bond line, with 1.4 percent shrinkage mismatch on the survivors. The finer sponge picked up much more slurry per volume, and the adhesive left a burnout gap. The team therefore moved to thermal fusing of the sponges and a two-stage dip. The whole part went into thinner slurry at about 1,500 mPa.s, then only the coarse half into 2,400 mPa.s slurry. Trial 2 (October to November 2025, 40 parts, standard firing) delaminated 9 parts, about 22 percent, with 0.7 percent shrinkage mismatch. Single-dip adhesive bonding was not viable, and the two-stage dip improved the mismatch but not enough for production.

The remaining mismatch exceeded the 0.5 percent target, so trial 3 (December 2025 to January 2026) kept the two-stage dip on 36 parts. It added a 1 C/min ramp between 1,100 and 1,350 C, the main sintering shrinkage range, and a 45 min hold at 1,350 C. Two of 36 parts delaminated, about 6 percent, and the shrinkage mismatch fell to 0.4 percent, within the 0.5 percent target. The slow ramp cost about 3 hours more kiln time per load. Mismatch was driven more by slurry mass per volume than by pore size. The slow ramp absorbed the remaining difference, and adhesive cannot work because it burns out before the ceramic sinters.

Later trials tested the graded filter in a flow rig and in thermal shock. In the February 2026 rig, with 50 kg of A356 per run at 720 C, the graded filter flowed at 3.8 kg/s against 4.1 kg/s for 20 ppi. It captured 41 percent more inclusions, though 2 of 6 pours choked late. Cutting the fine exit layer from 25 mm to 15 mm held 3.9 kg/s with 36 percent more capture. In thermal shock, graded parts retained 68 percent strength against 55 percent for 20 ppi, and a well-matched interface arrested a crack.

### Line 246

The technical uncertainty was whether a graded filter could survive firing, and the objective was to understand how slurry pick-up and shrinkage govern that survival. The hypothesis was partly proven. The team could not tell if a graded foam would survive firing, and trial 3 met the 0.5 percent target with a shrinkage mismatch of 0.4 percent. It was not proven that matching slurry mass per volume alone is enough; a slower ramp through the sintering window was also needed.

The team determined that adhesive bonding with a single dip is not viable. The adhesive burns out before the ceramic sinters. Of 24 parts made in trial 1, 18 delaminated, with 1.4 percent shrinkage mismatch on the survivors. The team also established that shrinkage mismatch is driven more by slurry mass per volume than by pore size. This resolved the uncertainty regarding whether a 10 ppi and 30 ppi template would survive firing without separating. Based on this understanding, the team used thermal fusing, a two-stage dip and a 1 C/min ramp from 1,100 to 1,350 C. In trial 3, that combination brought shrinkage mismatch to 0.4 percent, within the 0.5 percent target, and 2 of 36 parts delaminated.

A customer pour trial of 200 filters at one foundry showed no breakage. It is promising but covers one foundry and one alloy, so it does not yet confirm the result. Three questions stay open for fiscal 2027: whether the gradient works at 30 mm thickness, whether a continuous gradient can replace two zones, and whether a different slurry binder can shorten the slow ramp, which adds about 3 hours of kiln time per load. Each remains open because the work so far covers only the 50 mm two-zone part.

The team learned how to make a two-zone replicated foam survive firing without delamination, which answers the original goal of a graded filter for aluminium foundries. The two-stage dip, fused templates and slow ramp are the process changes that made this possible.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 328/350 words, 32/50 lines |
| 242 | Claim Exclusion: Pricing requests and the competitive positioning are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The dip line change and its benefit to uniform filters is process improvement, not part of the graded filter investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The 2023 dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: A second foundry and alloy before launch is future work and a launch decision. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline. |
| 242 | Confidence Map: Trial 4 flow and capture results are consistent across both sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The log gives the trial 4 priming head for graded as +8 percent; the interview does not state it. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The project driver is disputed between breakage and capture. | applied | none |  | P1 hedges the driver as disputed. |
| 242 | Confidence Map: The interview says the 20 ppi cracking field data is from filters of two customers; the log limits it to 50 mm filters. Scope differs slightly. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The field trial is promising but limited to one foundry and one alloy. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: The kiln time penalty is stated as about 3 hours per load. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: delamination | applied | none |  | Concept absent; P4 says separating, not a rename. |
| 242 | Glossary Term: two-stage dip | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: slurry mass per volume | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: fine exit layer | applied | none |  | Not mentioned in the section. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Cover signed-off Summary item h57yexcjh594e7133bv4dk19r98h35gw | applied | none |  | P1 names the client and the cascade-fired lattice. |
| 242 | Cover signed-off Summary item h57gs97hgazfrdgtdmnwgkf17x8h2d41 | applied | none |  | P1 gives twenty years, plant and 60 people. |
| 242 | Cover signed-off Summary item h57k5pf63zct47a9w2ca16f4598h3tjt | applied | none |  | P2 states published graded foams are lab scale. |
| 242 | Cover signed-off Summary item h57hrz6fa4n3qm0f1geaaztq358h3wjk | applied | none |  | P3 states the objective. |
| 242 | Cover signed-off Summary item h57j9rb33seccs294k5j1ktcgn8h2fkn | applied | none | 2 | P4 covers firing survival and shrinkage mismatch. |
| 242 | Cover signed-off Summary item h57zdj6y4eckyymppdrpy84h418h2h8f | applied | none | 2 | P4 covers capture versus 10 percent flow. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P1 says "That sponge-replication experience gave it direct knowledge of how slurry loading and firing govern filter structure.", but the sources say "We had data for uniform filters, but not for a part where those change across 50 mm.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Published graded foams are mostly lab scale, small discs made by gel casting or freeze casting, not sponge replication." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought to learn whether a graded replicated foam survives firing given different slurry pick-up and shrinkage." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244, 246): Line 242 introduces the name cascade-fired lattice for the graded structure, but the glossary term is graded filter and the other sections never use the cascade-fired lattice name. Line 244 P5 also calls the fine exit layer the fine exit layer correctly, but Line 244 P2 uses the 10 ppi entry and 30 ppi exit template rather than a consistent zone naming. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 590/700 words, 50/100 lines |
| 244 | Claim Exclusion: Pricing requests and the competitive positioning are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The dip line change and its benefit to uniform filters is process improvement, not part of the graded filter investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The 2023 dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: A second foundry and alloy before launch is future work and a launch decision. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Trial 4 flow and capture results are consistent across both sources. | applied | none |  | P5 matches the established figures. |
| 244 | Confidence Map: The log gives the trial 4 priming head for graded as +8 percent; the interview does not state it. | applied | none |  | Priming head not mentioned. |
| 244 | Confidence Map: The project driver is disputed between breakage and capture. | applied | none |  | Driver dispute not stated. |
| 244 | Confidence Map: The interview says the 20 ppi cracking field data is from filters of two customers; the log limits it to 50 mm filters. Scope differs slightly. | applied | none |  | Field cracking data not mentioned. |
| 244 | Confidence Map: The field trial is promising but limited to one foundry and one alloy. | applied | none |  | Field trial not mentioned. |
| 244 | Confidence Map: The kiln time penalty is stated as about 3 hours per load. | applied | none |  | P4 states about 3 hours, as established. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Prior-year status is absent. |
| 244 | Cover signed-off Summary item h57mqvyftwv30k8n44mgn7t27d8h2mgg | applied | none |  | P1 states the planned two-zone template. |
| 244 | Cover signed-off Summary item h57xzghdbh8j8jndz9b3cce3bx8h3af1 | applied | none |  | P2 states the hypothesis. |
| 244 | Cover signed-off Summary item h57q81hzmb9wpc448e5dtz8peh8h361c | applied | none |  | P3 covers trial 1 and its result. |
| 244 | Cover signed-off Summary item h57tgp4g4mb7k97zs5cp18yycd8h31ty | applied | none |  | P4 covers trial 3 within target. |
| 244 | State figures and details as the sources give them | not_applied | none |  | P3 says "Eighteen of 24 delaminated at the bond line, with 1.4 percent shrinkage mismatch on the survivors.", but the sources say "Shrinkage mismatch on survivors: 1.4 percent.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work backs a stated uncertainty or Line 246 item. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): Line 244 says the slow ramp absorbed the remaining difference and that the mismatch was driven by slurry mass per volume. Line 246 P1 says matching slurry mass alone is not enough. The statements are compatible, but Line 244 P4 gives the adhesive burnout reason as a trial 3 finding, which conflicts with its own trial 1 explanation. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 331/350 words, 31/50 lines |
| 246 | Claim Exclusion: Pricing requests and the competitive positioning are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The dip line change and its benefit to uniform filters is process improvement, not part of the graded filter investigation. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The 2023 dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: A second foundry and alloy before launch is future work and a launch decision. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: graded filter | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Trial 4 flow and capture results are consistent across both sources. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The log gives the trial 4 priming head for graded as +8 percent; the interview does not state it. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The project driver is disputed between breakage and capture. | applied | none |  | Driver dispute not stated. |
| 246 | Confidence Map: The interview says the 20 ppi cracking field data is from filters of two customers; the log limits it to 50 mm filters. Scope differs slightly. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The field trial is promising but limited to one foundry and one alloy. | applied | none |  | P3 hedges the field trial. |
| 246 | Confidence Map: The kiln time penalty is stated as about 3 hours per load. | applied | none |  | About 3 hours matches. |
| 246 | Glossary Term: fine exit layer | applied | none |  | Concept absent from the section. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57wb4m7a32wqgdfvpvfa93jgd8h229f | applied | none |  | P1 covers it. |
| 246 | Cover signed-off Summary item h57qg5422wg9ep6sn96qqe7s4x8h34ek | applied | none | 2 | P2 covers adhesive failure. |
| 246 | Cover signed-off Summary item h57n2vd295hh5m1ymc0y610am98h37f3 | applied | none | 2 | P2 covers trial 3. |
| 246 | Cover signed-off Summary item h57qm791nw4pq1hr6nq8k8tvw58h3qqf | applied | none |  | P3 covers it. |
| 246 | Cover signed-off Summary item h57n0d4cg0xf16y6bwbkb2adxs8h3h2p | applied | none |  | P4 covers it. |
| 246 | State figures and details as the sources give them | not_applied | none |  | P2 says "Of 24 parts made in trial 1, 18 delaminated, with 1.4 percent shrinkage mismatch on the survivors.", but the sources say "Shrinkage mismatch on survivors: 1.4 percent.". |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancements answer stated uncertainties. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The team learned how to make a two-zone replicated foam survive firing without delamination, which answers the original..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 says adhesive bonding with a single dip is not viable and that trial 1 delaminated 18 of 24, but it also credits the finding to the adhesive burning out before the ceramic sinters. Line 244 trial 1 attributes the failure to the finer sponge picking up more slurry and to the adhesive leaving a burnout gap. The causes given for the adhesive failure differ. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 244, 246): Line 246 reports a customer pour trial of 200 filters with no breakage. Line 244 describes only a flow rig, thermal shock and 6 rig pours, and says 2 of 6 pours choked late. Line 244 never mentions a customer pour trial, so the claim has no supporting work. Line 244 P1 also lists a pour trial as phase three. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 3 (sections 246): The pour trial at a second foundry and alloy before launch is excluded as future work and a launch decision. The paragraph discusses one foundry and one alloy while framing the result as a next step, which risks presenting launch-gating work as claimed. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says the team could not tell if a graded foam would survive firing as a past state, yet states the hypothesis was partly proven. Line 244 P2 hypothesis ties survival to matching slurry mass per volume by viscosity alone. This is consistent, but Line 246 P4 says the team learned how to make parts survive without delamination, while 2 of 36 parts still delaminated in trial 3. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 6 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 19.
- Line 244: 0 labels and 0 plan checks "Not checked" of 16.
- Line 246: 0 labels and 0 plan checks "Not checked" of 17.

## Seed-stage numbers

- Requests: 19 metered (19 Batch, 0 Feedback); 20 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.5 s, p95 13.0 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 8.3 s, p95 8.3 s over 1.
- Sign-off to report created: 98.1 s.
- Cost from aiUsage: $1.29 in all ($0.51 seed stage, $0.78 Brief, drafting and checks) over 37 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T16:32:06.970Z created project k97bfm2ttdw6tk0nd7x3xzjd0s8h2dpa
2026-10-27T16:32:07.869Z marked as an evaluation project
2026-10-27T16:32:08.773Z added document graded-filter-trial-log.md
2026-10-27T16:32:10.568Z started Step by step generation k57crye4nfmfkfe128hdpa517h8h2w1z
2026-10-27T16:32:25.729Z seed stage open
2026-10-27T16:32:25.731Z Open Company / Context and wait for its Batch
2026-10-27T16:32:33.779Z Company / Context: select the first Seed
2026-10-27T16:32:36.379Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-10-27T16:32:38.987Z Approve Company / Context
2026-10-27T16:32:41.808Z approved company_context
2026-10-27T16:32:41.808Z Open Goal / Problem and wait for its Batch
2026-10-27T16:32:49.900Z Goal / Problem: select the first Seed
2026-10-27T16:32:52.509Z Approve Goal / Problem
2026-10-27T16:32:55.163Z approved goal_problem
2026-10-27T16:32:55.163Z Open Technological limitations and wait for its Batch
2026-10-27T16:33:03.288Z Technological limitations: select the first Seed
2026-10-27T16:33:05.919Z Approve Technological limitations
2026-10-27T16:33:08.649Z approved passive_limitations
2026-10-27T16:33:08.649Z Open Technological objectives and wait for its Batch
2026-10-27T16:33:19.527Z Technological objectives: select the first Seed
2026-10-27T16:33:22.171Z Approve Technological objectives
2026-10-27T16:33:24.780Z approved technological_objective
2026-10-27T16:33:24.780Z Open Technological uncertainties and wait for its Batch
2026-10-27T16:33:41.309Z Technological uncertainties: select the first 2 Seeds
2026-10-27T16:33:45.597Z Approve Technological uncertainties
2026-10-27T16:33:48.223Z approved active_uncertainties
2026-10-27T16:33:48.223Z Skip Previous-year status
2026-10-27T16:33:49.928Z Open Work plan and wait for its Batch
2026-10-27T16:34:00.817Z Work plan: select the first Seed
2026-10-27T16:34:03.403Z Approve Work plan
2026-10-27T16:34:06.010Z approved workplan
2026-10-27T16:34:06.010Z Open Hypothesis and wait for its Batch
2026-10-27T16:34:14.081Z Hypothesis: select the first Seed
2026-10-27T16:34:16.711Z Approve Hypothesis
2026-10-27T16:34:19.336Z approved hypothesis
2026-10-27T16:34:19.337Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T16:34:30.276Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T16:34:34.520Z Approve Experimentation / Iterations
2026-10-27T16:34:37.078Z approved experimentation
2026-10-27T16:34:37.078Z Goal / Problem: select the Seed closest to "capture of fine inclusions" (else one that states a goal, else the next Seed on the page) and untick the earlier selection (writer switches the goal framing)
2026-10-27T16:34:37.919Z no other Seed on the page states a goal; taking the next Seed
2026-10-27T16:34:41.342Z Approve Goal / Problem
2026-10-27T16:34:46.487Z approved goal_problem
2026-10-27T16:34:46.487Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-10-27T16:34:57.656Z Technological uncertainties: Confirm and approve the carried selections
2026-10-27T16:35:01.964Z approved active_uncertainties (confirmed 2 carried)
2026-10-27T16:35:01.964Z Confirm and approve every Stale Subsection, in order
2026-10-27T16:35:09.291Z approved passive_limitations (confirmed 1 carried)
2026-10-27T16:35:12.758Z approved technological_objective (confirmed 1 carried)
2026-10-27T16:35:14.430Z workplan link notice: none
2026-10-27T16:35:20.353Z approved workplan (confirmed 1 carried)
2026-10-27T16:35:22.007Z hypothesis link notice: none
2026-10-27T16:35:27.921Z approved hypothesis (confirmed 1 carried)
2026-10-27T16:35:31.815Z approved experimentation (confirmed 2 carried)
2026-10-27T16:35:31.815Z Open Advancement to science / technology and wait for its Batch
2026-10-27T16:35:34.621Z Advancement to science / technology: select the first Seed
2026-10-27T16:35:39.095Z Approve Advancement to science / technology
2026-10-27T16:35:42.240Z approved overall_advancement (confirmed 1 carried)
2026-10-27T16:35:42.240Z Open Specific technological advancements and wait for its Batch
2026-10-27T16:35:45.057Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T16:35:51.953Z Approve Specific technological advancements
2026-10-27T16:35:54.597Z approved specific_advancements (confirmed 2 carried)
2026-10-27T16:35:54.597Z Open Project status and next steps and wait for its Batch
2026-10-27T16:35:57.304Z Project status and next steps: select the first Seed
2026-10-27T16:35:59.889Z Approve Project status and next steps
2026-10-27T16:36:02.538Z approved project_status (confirmed 1 carried)
2026-10-27T16:36:02.538Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T16:36:05.126Z Overall company / project goal improvements: select the first Seed
2026-10-27T16:36:08.870Z Approve Overall company / project goal improvements
2026-10-27T16:36:11.507Z approved goal_improvements (confirmed 1 carried)
2026-10-27T16:36:11.507Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T16:36:13.302Z signed off; waiting for the report
2026-10-27T16:37:53.964Z report kd758wjmbr5z561zaxg86tq7en8h35wv created
```
