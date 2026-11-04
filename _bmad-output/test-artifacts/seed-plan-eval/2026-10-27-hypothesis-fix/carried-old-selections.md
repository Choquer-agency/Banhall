# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-10-27 on `local` at commit `afbfd302`, acting as chat-live-1793085355051@example.test. Project `k974nq9c9dxkg2y3x56krx3d7x8h3yvm`, generation `k57f23bmn4xfte767sx7bsa7c58h2wzw`.

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
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7aexy6zkxfhqg6a43gg2qnad8h3czt |
| All three Sections were drafted | pass | 242: 346 words, 244: 641 words, 246: 335 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | 246: 0 labels and 1 plan check "Not checked" of 19 |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("Work ties to stated uncertainties."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: not_applied ("P2 says "no work was found on a replicated foam with a pore gradient through a 50 mm part fired at production scale", but the sources say "Nobody we could fi..."); 244: applied, repaired ("The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Work from September 2025 followed a planned o..."); 246: not_applied ("Not checked: the facts check flagged something it could not show from the sources (its words: P4 says Trial 3 gave survival; Trial 5 claim is a different test.)") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 2 requests (7.4 s, 7.9 s); 244: 2 requests (7.7 s, 13.6 s); 246: 2 requests (8.8 s, 7.5 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (19 Batch, 0 Feedback), 20 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company makes foam-ceramic filters for metal foundries at its plant in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired latt..." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "aptures more fine inclusions. The team calls the graded structure the cascade-fired lattice. The process lead has six years at the company and earlier worked at" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "Company and term stated." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company makes foam-ceramic filters for metal foundries at its plant in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired lattice. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The process lead has six years at the company and earlier worked at a refractory brick maker. / Firing curves and shrinkage are familiar ground for that lead. _(writer-asserted)_

### 3. Technological limitations (Section 242, standard): approved

- Stacking filters doubles the cost and leaves a gap between the two pieces where metal can bypass. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team did not know whether the shrinkage mismatch would tear the part apart at the interface. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team did not know whether shrinkage mismatch would tear the part apart at the interface during firing. _(cited, carried from an older context)_
- Different pore sizes pick up different amounts of slurry, so the zones shrink differently in firing. / Data existed for uniform filters, but not for a part where loading changes across 50 mm. _(writer-asserted, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- To test whether different pore sizes pick up different slurry amounts, the team measured slurry pick-up per volume in each zone. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If a 10 ppi and 30 ppi template carries similar slurry mass per volume, shrinkage mismatch stays within 0.5 percent. / The team tested this by measuring slurry pick-up and linear firing shrinkage on each zone across the interface. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 bonded 10 ppi and 30 ppi sheets with adhesive, and 18 of 24 parts delaminated. / The 30 ppi side shrank 1.4 percent more, and the adhesive left a burnout gap. _(cited, carried from an older context)_
  - Tested: uncertainty "The team did not know whether shrinkage mismatch would tear the par..."
- Trial 2 used a two-stage dip and thermal fusion, which cut delamination to 9 of 40 parts. / Mismatch fell to 0.7 percent, still not good enough for production. _(cited, carried from an older context)_
  - Tested: uncertainty "Different pore sizes pick up different amounts of slurry, so the zo..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The team did not know whether shrinkage mismatch would tear the part apart, and slow-ramp Trial 3 showed it need not. / Trial 3 gave a 0.4 percent mismatch against the 0.5 percent target, with 2 of 36 parts delaminated. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- The team learned that shrinkage mismatch tracks slurry mass per volume more than pore size. _(cited, carried from an older context)_
  - Links: uncertainty "Different pore sizes pick up different amounts of slurry, so the zo..."; experiments "Trial 2 used a two-stage dip and thermal fusion, which cut delamina..."
- The two-stage dip evened pick-up to 0.24 g/cm3 fine against 0.22 g/cm3 coarse. / Mismatch of 0.7 percent still left 9 of 40 parts delaminated. _(writer-asserted, carried from an older context)_
  - Links: uncertainty "Different pore sizes pick up different amounts of slurry, so the zo..."; experiments "Trial 2 used a two-stage dip and thermal fusion, which cut delamina..."

### 12. Project status and next steps (Section 246, standard): approved

- Open items for fiscal 2027 include grading at 30 mm total thickness, the highest volume format. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The team did not know if shrinkage mismatch would split the interface, and the work showed that it tracks slurry mass per volume. _(writer-asserted, carried from an older context)_

## Drafted Sections

### Line 242

The team did not know whether shrinkage mismatch would tear a part that combines coarse and fine filtration in one ceramic body apart at the interface. The company makes foam-ceramic filters for metal foundries at its plant in Dunmore Falls, Ontario, and set out to build a filter for aluminium foundries that cracks less in the pour and captures more fine inclusions. The team calls the graded structure the cascade-fired lattice. The process lead has six years at the company and earlier worked at a refractory brick maker, so firing curves and shrinkage are familiar ground.

Standard practice falls short because the knowledge needed to combine coarse and fine filtration in one ceramic body did not exist. Stacking filters doubles the cost and leaves a gap between the two pieces where metal can bypass. Thicker fine filters raise thermal stress and make priming harder. Published graded ceramic foam work was mostly lab-scale discs made by gel casting or freeze casting, and no work was found on a replicated foam with a pore gradient through a 50 mm part fired at production scale. Interface stress could not be modelled well because the struts are hollow after burnout.

The technological objective was to advance understanding of firing shrinkage compatibility, fine-inclusion capture versus flow, and thermal shock behaviour at the interface of sponge-replicated ceramic foams with a pore gradient, to create a graded alumina filter with a coarse entry face and a fine exit layer.

Different pore sizes pick up different amounts of slurry, so the zones shrink differently in firing. The team did not know whether shrinkage mismatch would tear the part apart at the interface during firing. Data existed for uniform filters, but not for a part where slurry mass per volume changes across 50 mm. It was also uncertain whether the gradient could raise capture of 20 to 80 micron inclusions while keeping flow and priming head near the standard 20 ppi filter, and whether the graded interface would stop or start cracks under thermal shock, since the literature goes both ways depending on the material.

### Line 244

The team started from the unresolved question of whether shrinkage mismatch would tear a part with a pore gradient apart at the interface during firing. To test whether different pore sizes pick up different slurry amounts, the team measured slurry pick-up per volume in each zone. The plan was laid out in August 2025; Trial 1 ran in September 2025. It followed a planned order: make graded green bodies that survive firing, test flow and capture on the survivors, then test thermal shock and burst behaviour. Each trial changed one main variable so results could be traced to a cause. One dedicated technician and the process lead at roughly half time did the work.

It was hypothesized that if a two-zone template (10 ppi entry, 30 ppi exit) is coated so both zones carry similar slurry mass per volume, then linear firing shrinkage across the interface will match within 0.5 percent. The part should then survive firing without delamination. It should also capture at least 30 percent more fine inclusions than the standard 20 ppi filter. Flow rate should be no more than 10 percent lower. The team tested this by measuring slurry pick-up and linear firing shrinkage on each zone across the interface.

Trial 1 bonded 10 ppi and 30 ppi sheets (25 mm each) with polyurethane adhesive, coated 24 filters in standard alumina slurry, and fired them on the standard curve. Eighteen of 24 parts delaminated at the bond line. On the survivors the 30 ppi side shrank 1.4 percent more than the 10 ppi side, and the adhesive left a 0.3 to 0.6 mm burnout gap. Pore-size-dependent pick-up drives the mismatch, and the adhesive burns out before the ceramic sinters, so it could not hold the interface.

Trial 2 replaced adhesive with thermally fused templates and used a two-stage dip: the whole part in slurry at about 1,500 mPa.s, then only the coarse half at about 2,400 mPa.s. Pick-up evened to 0.24 g/cm3 on the fine side against 0.22 g/cm3 on the coarse side. Even so, 9 of 40 parts delaminated. Mismatch fell to 0.7 percent, still not good enough for production. The remaining difference pointed to the firing curve.

Trial 3 kept the two-stage dip and added a 1 C/min ramp between 1,100 and 1,350 C and a 45 minute hold at 1,350 C. Of 36 parts, 2 delaminated, and mismatch fell to 0.4 percent, within the 0.5 percent target. The slow ramp added about 3 hours of kiln time per load. Mismatch therefore tracks slurry mass per volume more than pore size, and a slower ramp through the sintering window takes up the remaining difference.

Trial 4 poured 50 kg of A356 at 720 C, six pours each through standard 20 ppi, standard 30 ppi and graded filters. The 20 ppi filter flowed at about 4.1 kg/s. The 30 ppi filter flowed at 2.9 kg/s and needed a 30 percent higher priming head. The graded filter flowed at 3.8 kg/s, 7 percent below the 20 ppi, and captured 41 percent more 20 to 80 micron inclusions. The fine side choked near the end in 2 of 6 pours. Trial 5 cut the fine exit layer from 25 mm to 15 mm. Flow held at 3.9 kg/s across the full 50 kg with no choking, and capture was 36 percent above the 20 ppi filter.

Trial 6 examined thermal shock. In quench tests (700 C into room-temperature water, then crush testing) the standard filter kept about 55 percent of its strength and the graded filter kept 68 percent. In burst tests on 20 filters each, 3 standard filters cracked, while 1 graded filter cracked and the crack stopped at the interface. Of 10 retained Trial 2 parts, 4 cracked along the interface. A well-matched interface therefore arrests cracks, while a poorly matched one becomes the failure plane.

### Line 246

The team did not know whether shrinkage mismatch would tear a part with a pore gradient apart at the interface. Trial 3 showed it need not. Mismatch was 0.4 percent against the 0.5 percent target, with 2 of 36 parts delaminated. The objective, to advance understanding of firing shrinkage compatibility in sponge-replicated foams with a pore gradient, was partly achieved. The hypothesis was proven for firing survival. Capture and flow were tested in Trials 4 and 5 at 50 mm, so those results remain partial.

It was determined that shrinkage mismatch tracks slurry mass per volume more than pore size. This resolved the uncertainty regarding whether different pore sizes would shrink too differently to survive firing. Different pore sizes pick up different amounts of slurry, so the zones shrink differently in firing. Data existed for uniform filters, but not for a part where loading changes across 50 mm. Based on this understanding, the two-stage dip evened pick-up to 0.24 g/cm3 on the fine side against 0.22 g/cm3 on the coarse side. With thermal fusion, Trial 2 cut delamination to 9 of 40 parts. Mismatch of 0.7 percent was still not good enough for production, so Trial 3 added a slower ramp through the sintering window.

Open items for fiscal 2027 include grading at 30 mm total thickness, the highest volume format. It remains uncertain whether the same mismatch control holds there, because pick-up and shrinkage were characterized only across 50 mm. Continuous gradients and a binder change to shorten the slow ramp, which adds about 3 hours of kiln time per load, are also unresolved. The team plans to repeat the firing and flow trials at 30 mm.

The project aimed at a filter that cracks less and captures more fine inclusions. The team did not know if shrinkage mismatch would split the interface, and the work showed that it tracks slurry mass per volume. Trial 3 gave survival through firing, and Trial 5 chose a 15 mm fine exit layer as the better trade.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 346/350 words, 31/50 lines |
| 242 | Claim Exclusion: Pricing requests and selling the filter as tougher and cleaner are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The dip line change improving uniform filters is an operational side benefit. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The 2023 second-slurry dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Fiscal 2025 field return data predates the claim period and is background only. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: thermal shock | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: pore gradient | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with the Storyline. |
| 242 | Confidence Map: Trial 3 results are documented in both sources. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Trial 4 flow and capture results. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Field trial result is from one foundry and one alloy only. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Driver dispute not stated flatly. |
| 242 | Confidence Map: Interviewee says breakage was the main driver. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Other interviewee says most testing time went to capture. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Priming head for graded filter is given only in the log, +8 percent. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Kiln time target for the binder change is only stated in the log. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: delamination | applied | none |  | Concept absent; tearing is not delamination wording. |
| 242 | Glossary Term: two-stage dip | applied | none |  | Concept absent from the section. |
| 242 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 242 | Glossary Term: slurry mass per volume | applied | none |  | P4 says 'amounts of slurry' and 'loading' for the term.; repaired to the Glossary Term |
| 242 | Cover signed-off Summary item h57jjtf4j6vnrb15qm95nqqkv18h2xys | applied | none |  | Company and term stated. |
| 242 | Cover signed-off Summary item h57xhsg90daajxmpk00gvxvg5h8h2hkm | applied | none |  | Process lead background stated. |
| 242 | Cover signed-off Summary item h57kh6qhdjq76avkh2fjswhph98h2bb7 | applied | none |  | Stacking limits stated. |
| 242 | Cover signed-off Summary item h57tt3ccq2k4vjhywfj7madkax8h39ry | applied | none |  | Objective stated. |
| 242 | Cover signed-off Summary item h57zq45bc0fm69vbkaj3jq8sad8h212w | applied | none | 2 | Tear uncertainty stated. |
| 242 | Cover signed-off Summary item h57tpgr98fmxk1x4w46xsr8b6s8h2k8x | applied | none | 2 | Slurry and data gap stated. |
| 242 | State figures and details as the sources give them | not_applied | none |  | P2 says "no work was found on a replicated foam with a pore gradient through a 50 mm part fired at production scale", but the sources say "Nobody we could find had made a replicated foam with a continuous pore gradient through a 50 mm part and fired it at production scale.". |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team did not know whether the shrinkage mismatch would tear the part apart at the interface." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team did not know whether shrinkage mismatch would tear the part apart at the interface during firing." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244): The graded structure is called the 'cascade-fired lattice' in Line 242 but 'graded filter' or 'part with a pore gradient' elsewhere; the Glossary term is 'pore gradient'. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 641/700 words, 56/100 lines |
| 244 | Claim Exclusion: Pricing requests and selling the filter as tougher and cleaner are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The dip line change improving uniform filters is an operational side benefit. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The 2023 second-slurry dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Fiscal 2025 field return data predates the claim period and is background only. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: thermal shock | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: pore gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with Storyline. |
| 244 | Confidence Map: Trial 3 results are documented in both sources. | applied | none |  | Trial 3 stated as documented. |
| 244 | Confidence Map: Trial 4 flow and capture results. | applied | none |  | Trial 4 matches. |
| 244 | Confidence Map: Field trial result is from one foundry and one alloy only. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Interviewee says breakage was the main driver. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Other interviewee says most testing time went to capture. | applied | none |  | Not mentioned in the section. |
| 244 | Confidence Map: Priming head for graded filter is given only in the log, +8 percent. | applied | none |  | Priming head for graded filter not stated. |
| 244 | Confidence Map: Kiln time target for the binder change is only stated in the log. | applied | none |  | Not mentioned in the section. |
| 244 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Role absent. |
| 244 | Cover signed-off Summary item h57we5q1p8qpxk3cycspxcgfhd8h2qt0 | applied | none |  | Workplan and measurement covered. |
| 244 | Cover signed-off Summary item h57w8tnj9qjsnwqy12fd2qq1hh8h2671 | applied | none |  | Hypothesis and test stated. |
| 244 | Cover signed-off Summary item h57hxcj378s9dvxzq61gd694a98h2kjs | applied | none |  | Trial 1 covered. |
| 244 | Cover signed-off Summary item h57qytz8wh43t8t4sc81ve8x818h3tgn | applied | none |  | Trial 2 covered. |
| 244 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. Fixed by the repair: P1 says "Work from September 2025 followed a planned order across fiscal 2026", but the sources say "We laid it out in August 2025. Phase one was making graded green bodies that survive firing.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | Work ties to stated uncertainties. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "To test whether different pore sizes pick up different slurry amounts, the team measured slurry pick-up per volume in e..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 244): The graded filter flowed at 3.8 kg/s and is stated as 7 percent below the 20 ppi at 4.1 kg/s. That is 7.3 percent, which is fine, but Trial 5 states 3.9 kg/s without a 20 ppi comparison; no conflict here beyond rounding. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): Line 244 P4 says the two-stage dip put 0.24 g/cm3 on the fine side against 0.22 on the coarse side, which is described as evened, while P2 hypothesizes similar mass per volume. Line 246 P2 says the dip evened pick-up as a result of 'this understanding' before Trial 3 finding, a sequence that conflicts with Trial 2 being run before the mismatch finding of Trial 3. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 244, 246): Trial 1 in 244 P3 concludes pore-size-dependent pick-up drives the mismatch, while the conclusion in 244 P5 and 246 P2 is that mismatch tracks slurry mass per volume more than pore size. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 335/350 words, 31/50 lines |
| 246 | Claim Exclusion: Pricing requests and selling the filter as tougher and cleaner are commercial matters. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The dip line change improving uniform filters is an operational side benefit. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The 2023 second-slurry dip attempt falls before the claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Fiscal 2025 field return data predates the claim period and is background only. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pore gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: slurry mass per volume | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: fine exit layer | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Trial 3 results are documented in both sources. | applied | none |  | Trial 3 stated as established. |
| 246 | Confidence Map: Trial 4 flow and capture results. | applied | none |  | Not contradicted. |
| 246 | Confidence Map: Field trial result is from one foundry and one alloy only. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Which problem drove the project is disputed between interviewees. | applied | none |  | Goal framing covers both, not a flat driver claim. |
| 246 | Confidence Map: Interviewee says breakage was the main driver. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Other interviewee says most testing time went to capture. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Priming head for graded filter is given only in the log, +8 percent. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Kiln time target for the binder change is only stated in the log. | applied | none |  | Kiln time stated as about 3 hours, not the target. |
| 246 | Glossary Term: thermal shock | applied | none |  | Concept not named with other words. |
| 246 | Saved preference | not_applied | none |  | Checked against one of the writer's saved preferences, which only that writer can see. |
| 246 | Cover signed-off Summary item h57k5qs6n9bmp7xh62r8fb9xb58h2drh | applied | none |  | P1 states uncertainty and Trial 3 result. |
| 246 | Cover signed-off Summary item h57ye8dr1qtpdb4edhffck09bs8h23xg | applied | none | 2 | P2 covers mismatch tracking and Trial 2. |
| 246 | Cover signed-off Summary item h57h7hfya874z6mvchaya8as3s8h2agn | applied | none | 2 | P2 gives pick-up figures and Trial 2. |
| 246 | Cover signed-off Summary item h57zbkn5hx95bs5ahrsaeqd72s8h3sr7 | applied | none |  | P3 lists 30 mm open item. |
| 246 | Cover signed-off Summary item h57r0gyytnqtkp21x0bd2h0xyh8h218a | applied | none |  | P4 states uncertainty and learning. |
| 246 | State figures and details as the sources give them | not_applied | none |  | Not checked: the facts check flagged something it could not show from the sources (its words: P4 says Trial 3 gave survival; Trial 5 claim is a different test.) |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Claims match Line 242 uncertainties and COVER items. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): Line 246 says capture and flow were tested in Trials 4 and 5 at 50 mm and remain partial, and that the hypothesis was proven for firing survival. Line 244 reports Trial 5 as a 15 mm fine exit layer with 50 kg poured at full flow, so the 'partial' framing is loose; more clearly, the hypothesis in 244 P2 included capture of at least 30 percent more, which Trial 4 and 5 met (41 and 36 percent). Calling the hypothesis only partly proven conflicts with these results. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 3 (sections 242, 244, 246): Line 246 calls 30 mm total thickness the highest volume format and says characterization was only across 50 mm, but the Line 244 trials fused two 25 mm sheets and later a 15 mm exit layer, so the 50 mm basis was changed in Trial 5 (40 mm total), so 'only across 50 mm' is not accurate. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 6 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 20.
- Line 244: 0 labels and 0 plan checks "Not checked" of 18.
- Line 246: 0 labels and 1 plan check "Not checked" of 19.

## Seed-stage numbers

- Requests: 19 metered (19 Batch, 0 Feedback); 20 reserved; notice at 40 not shown.
- Dispatch to validated result: median 6.1 s, p95 14.6 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 17.6 s, p95 17.6 s over 1.
- Sign-off to report created: 118.5 s.
- Cost from aiUsage: $1.40 in all ($0.54 seed stage, $0.85 Brief, drafting and checks) over 40 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T18:47:18.223Z created project k974nq9c9dxkg2y3x56krx3d7x8h3yvm
2026-10-27T18:47:19.147Z marked as an evaluation project
2026-10-27T18:47:20.546Z added document graded-filter-trial-log.md
2026-10-27T18:47:22.514Z started Step by step generation k57f23bmn4xfte767sx7bsa7c58h2wzw
2026-10-27T18:47:38.737Z seed stage open
2026-10-27T18:47:38.739Z Open Company / Context and wait for its Batch
2026-10-27T18:47:47.385Z Company / Context: select the first Seed
2026-10-27T18:47:50.112Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-10-27T18:47:52.972Z Approve Company / Context
2026-10-27T18:47:55.792Z approved company_context
2026-10-27T18:47:55.792Z Open Goal / Problem and wait for its Batch
2026-10-27T18:48:07.062Z Goal / Problem: select the first Seed
2026-10-27T18:48:09.939Z Approve Goal / Problem
2026-10-27T18:48:12.726Z approved goal_problem
2026-10-27T18:48:12.726Z Open Technological limitations and wait for its Batch
2026-10-27T18:48:21.207Z Technological limitations: select the first Seed
2026-10-27T18:48:23.948Z Approve Technological limitations
2026-10-27T18:48:27.022Z approved passive_limitations
2026-10-27T18:48:27.022Z Open Technological objectives and wait for its Batch
2026-10-27T18:48:35.692Z Technological objectives: select the first Seed
2026-10-27T18:48:38.503Z Approve Technological objectives
2026-10-27T18:48:41.230Z approved technological_objective
2026-10-27T18:48:41.230Z Open Technological uncertainties and wait for its Batch
2026-10-27T18:48:50.380Z Technological uncertainties: select the first 2 Seeds
2026-10-27T18:48:55.214Z Approve Technological uncertainties
2026-10-27T18:48:57.909Z approved active_uncertainties
2026-10-27T18:48:57.910Z Skip Previous-year status
2026-10-27T18:48:59.713Z Open Work plan and wait for its Batch
2026-10-27T18:49:20.007Z Work plan: select the first Seed
2026-10-27T18:49:22.734Z Approve Work plan
2026-10-27T18:49:25.422Z approved workplan
2026-10-27T18:49:25.423Z Open Hypothesis and wait for its Batch
2026-10-27T18:49:39.409Z Hypothesis: select the first Seed
2026-10-27T18:49:42.281Z Approve Hypothesis
2026-10-27T18:49:45.077Z approved hypothesis
2026-10-27T18:49:45.078Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T18:49:53.660Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T18:49:58.434Z Approve Experimentation / Iterations
2026-10-27T18:50:01.291Z approved experimentation
2026-10-27T18:50:01.292Z Goal / Problem: select the Seed closest to "capture of fine inclusions" (else one that states a goal, else the next Seed on the page) and untick the earlier selection (writer switches the goal framing)
2026-10-27T18:50:02.193Z no other Seed on the page states a goal; taking the next Seed
2026-10-27T18:50:06.047Z Approve Goal / Problem
2026-10-27T18:50:11.106Z approved goal_problem
2026-10-27T18:50:11.107Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-10-27T18:50:31.135Z Technological uncertainties: Confirm and approve the carried selections
2026-10-27T18:50:33.822Z approved active_uncertainties (confirmed 2 carried)
2026-10-27T18:50:33.822Z Confirm and approve every Stale Subsection, in order
2026-10-27T18:50:38.329Z approved passive_limitations (confirmed 1 carried)
2026-10-27T18:50:42.023Z approved technological_objective (confirmed 1 carried)
2026-10-27T18:50:43.716Z workplan link notice: none
2026-10-27T18:50:50.322Z approved workplan (confirmed 1 carried)
2026-10-27T18:50:52.204Z hypothesis link notice: none
2026-10-27T18:50:58.355Z approved hypothesis (confirmed 1 carried)
2026-10-27T18:51:02.069Z approved experimentation (confirmed 2 carried)
2026-10-27T18:51:02.070Z Open Advancement to science / technology and wait for its Batch
2026-10-27T18:51:04.849Z Advancement to science / technology: select the first Seed
2026-10-27T18:51:07.745Z Approve Advancement to science / technology
2026-10-27T18:51:10.466Z approved overall_advancement (confirmed 1 carried)
2026-10-27T18:51:10.466Z Open Specific technological advancements and wait for its Batch
2026-10-27T18:51:13.185Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T18:51:22.026Z Approve Specific technological advancements
2026-10-27T18:51:24.980Z approved specific_advancements (confirmed 2 carried)
2026-10-27T18:51:24.980Z Open Project status and next steps and wait for its Batch
2026-10-27T18:51:28.084Z Project status and next steps: select the first Seed
2026-10-27T18:51:31.143Z Approve Project status and next steps
2026-10-27T18:51:34.072Z approved project_status (confirmed 1 carried)
2026-10-27T18:51:34.074Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T18:51:37.054Z Overall company / project goal improvements: select the first Seed
2026-10-27T18:51:39.795Z Approve Overall company / project goal improvements
2026-10-27T18:51:42.665Z approved goal_improvements (confirmed 1 carried)
2026-10-27T18:51:42.665Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T18:51:44.477Z signed off; waiting for the report
2026-10-27T18:53:45.703Z report kd7aexy6zkxfhqg6a43gg2qnad8h3czt created
```
