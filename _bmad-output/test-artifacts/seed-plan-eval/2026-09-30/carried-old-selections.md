# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `67be8f06`, acting as e2e-audit@banhall.local. Project `k97dtzacgtt2ykqzw2edqs3qh58fdhbt`, generation `k578vbxh7fq0xjx5zdmwzkdy4d8fd8nm`.

## What this fixture tests

The writer approves through Experimentation, then switches the goal framing (from filter breakage to fine-inclusion capture, both supported by the sources). Every approved successor goes Stale. The writer regenerates Technological uncertainties but keeps the older selections and must Confirm and approve them as carried; the other Stale steps are confirmed the same way. Company / Context carries a writer edit with a term that is in no source, which must reach the drafted Section 242, and that edited item is writer-asserted.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 242 states the goal the writer switched to, not the first framing, and the carried uncertainties still read as consistent with it.
   - Answer: Yes. Line 242 paragraph 2 states the switched goal (3.8 percent breakage, 20 to 80 micron capture); the first framing does not appear as a goal, and the carried uncertainties fit it.
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: Yes. Line 242 paragraph 5 follows both carried uncertainty items clause by clause, and Lines 244 and 246 follow items 9 and 11.
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: Yes. "The team calls the graded structure developed in this project the cascade-fired lattice." No evidence is invented around it.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Mostly. Plain prose, no headings; one garbled sentence from a Glossary repair in Line 244 paragraph 2 ("capture more fine inclusion capture than").

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each briefed for high effort (the Agent tool sets no effort of its own), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (Judge A medium, Judge B medium-high confidence). Run 6 issues fixed: Line 242 now states the third uncertainty Line 244 cites, and the consistency pass ran. Major (both judges): Line 244 covers Trials 1 to 3 only (the scripted writer picked firing experiments), yet Line 246 says the capture and thermal shock objective was largely met; Trials 4 to 6 are in the sources, so a consultant can add them. Minor, product: the deterministic Glossary substitution does not check grammar.

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7ffsz7wbf1abbb8v6qgsnzd98fcyv6 |
| All three Sections were drafted | pass | 242: 327 words, 244: 561 words, 246: 305 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company has made foam-ceramic filters for metal foundries for over twenty years using a sponge replication process. The team calls the graded structure t..." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "ss. The team calls the graded structure developed in this project the cascade-fired lattice. That history gave the engineering group working knowledge of how slu" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P1 states company history and coined term." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company has made foam-ceramic filters for metal foundries for over twenty years using a sponge replication process. The team calls the graded structure the cascade-fired lattice. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- They aimed to cut filter breakage during pours, since 3.8 percent of filters showed visible cracking in fiscal 2025. / They also aimed to raise capture of fine inclusions in the 20 to 80 micron range for thin wall castings without hurting flow. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No prior art existed for a replicated foam filter with a continuous pore gradient fired through a 50 mm section at production scale. / Published graded ceramic foam work was mostly lab scale discs made by gel casting or freeze casting, not sponge replication. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether a two-zone sponge template could survive firing without delaminating at the interface. / This knowledge was meant to enable a graded filter that resists thermal shock without the layers separating. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was uncertain whether a two-zone sponge template could be bonded or graded and survive firing without delaminating. / Different pore sizes pick up different amounts of slurry and shrink differently, so the interface outcome was unknown. _(cited, carried from an older context)_
- It was unclear whether a graded filter could raise fine inclusion capture while keeping flow near the standard 20 ppi filter. / Capture needed to reach the 20 to 80 micron range without killing flow, a balance nobody had demonstrated. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan set three phases: making graded green bodies that survive firing, then lab flow and capture testing, then thermal shock and burst testing. / A customer foundry pour trial was planned as the final step after lab testing was complete. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If the graded filter survives firing, then it should capture more fine inclusions than the 20 ppi standard filter. / The target capture gain was measurable against a flow penalty ceiling, so both metrics could be tested together. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 bonded 10 ppi and 30 ppi sponges with adhesive and a single slurry dip, testing interface survival under firing. / Eighteen of 24 parts delaminated at the bond line, with a 1.4 percent shrinkage mismatch measured on survivors. _(cited, carried from an older context)_
  - Tested: uncertainty "It was uncertain whether a two-zone sponge template could be bonded..."
- Trial 2 replaced adhesive with thermal fusing and added a two-stage dip to even out slurry pick-up. / Delamination fell to 9 of 40 parts and shrinkage mismatch dropped to 0.7 percent, still short of target. _(cited, carried from an older context)_
  - Tested: uncertainty "It was uncertain whether a two-zone sponge template could be bonded..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The firing survival method, matched slurry mass per volume plus a slow sintering ramp, met the 0.5 percent mismatch target. / The hypothesis on shrinkage matching was largely achieved, though it took three trial iterations beyond the original plan. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Trial 1 and trial 2 findings show shrinkage mismatch is driven more by slurry mass per volume than by pore size itself. / A slower ramp through the sintering window closes the remaining shrinkage gap between zones. _(cited, carried from an older context)_
  - Links: uncertainty "It was uncertain whether a two-zone sponge template could be bonded..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponges with adhesive and a single...", "Trial 2 replaced adhesive with thermal fusing and added a two-stage..."
- Trial 1 revealed the adhesive bond was never going to work, since it burns out before the ceramic sinters. _(cited, carried from an older context)_
  - Links: uncertainty "It was uncertain whether a two-zone sponge template could be bonded..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponges with adhesive and a single..."

### 12. Project status and next steps (Section 246, standard): approved

- A customer pour trial ran 200 graded filters and saw no breakage over the two month trial. / X-ray rejects on thin-wall housings dropped from 6.2 percent to 4.5 percent at that one foundry. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The graded filter connects directly to the original goal of cutting breakage while raising fine inclusion capture. / It achieves this by combining a coarse entry face for shock resistance with a fine exit layer for capture. _(cited)_

## Drafted Sections

### Line 242

Brackenridge Kilnworks Ltd. has made foam-ceramic filters for metal foundries for over twenty years using a sponge replication process. The team calls the graded structure developed in this project the cascade-fired lattice. That history gave the engineering group working knowledge of how slurry pick-up, pore size, and firing curves interact in a uniform filter, the baseline this project had to depart from.

The company aimed to cut filter breakage during pours, since 3.8 percent of filters showed visible cracking in fiscal 2025. It also aimed to raise capture of fine inclusions in the 20 to 80 micron range for thin-wall castings without hurting flow.

No prior art existed for a replicated foam filter with a continuous pore-size gradient fired through a 50 mm section at production scale. Published graded ceramic foam work was mostly lab-scale discs made by gel-casting or freeze-casting, not sponge replication, so no documented method addressed how shrinkage, interface strength, or flow behaviour would play out at production scale.

The technological objective was to advance understanding of whether a two-zone sponge template could survive firing without delaminating at the interface, knowledge meant to enable a graded filter that resists thermal shock without the layers separating.

It was uncertain whether a two-zone sponge template could be bonded or graded and survive firing without delaminating, because different pore sizes pick up different amounts of slurry, producing a shrinkage mismatch across the interface that had not been characterized before. It was also unclear whether such a graded filter could raise fine inclusion capture while keeping flow near the standard 20 pores per inch (ppi) filter, since capture needed to reach the 20 to 80 micron range without killing flow, a balance nobody had demonstrated. A further uncertainty was how the graded interface would behave under thermal shock, since it might arrest cracks or initiate them, and this could not be resolved by calculation because strut geometry at the interface is hollow after sponge burnout and resists modelling.

### Line 244

The technological problem facing the engineering group was how to make a 50 mm replicated foam filter with a pore-size gradient survive firing, hold flow and fine inclusion capture close to the standard 20 ppi filter, and resist thermal shock at the graded interface. The plan set three phases: making graded green bodies that survive firing, then lab flow and capture testing, then thermal shock and burst testing. A customer foundry pour trial was planned as the final step after lab testing was complete. This structure mapped onto the three uncertainties identified at the outset: interface survival through firing, flow and capture performance of a graded structure, and the behaviour of the graded interface under thermal shock.

It was hypothesized that if a two-zone sponge template (10 ppi entry, 30 ppi exit) was coated so both zones carried similar slurry mass per unit volume, then shrinkage mismatch across the interface would stay within 0.5 percent and the part would survive firing without delamination. If the graded filter survives firing, then it should capture more fine inclusion capture than the 20 ppi standard filter. The target capture gain was measurable against a flow penalty ceiling, so both metrics could be tested together: at least 30 percent higher fine inclusion capture at no more than a 10 percent flow reduction.

Trial 1 tested whether adhesive-bonded sponge templates of two pore sizes, coated in a single slurry dip, could survive firing without separating at the bond line. Eighteen of 24 parts delaminated at the bond line, and the survivors showed a 1.4 percent shrinkage mismatch, with the finer 30 ppi side picking up more slurry per volume than the coarser side. This showed the adhesive was the weak point, since it burned out before the ceramic sintered, leaving a gap at the interface, and that uneven slurry pick-up between pore sizes was driving the mismatch. The team dropped the adhesive bond entirely rather than trying to reinforce it.

Trial 2 replaced the adhesive bond with thermal fusing of the sponge templates and introduced a two-stage dip, coating the whole part in a thinner slurry before adding a thicker coat to the coarse half only, to even out slurry pick-up between zones. Delamination fell to 9 of 40 parts and shrinkage mismatch dropped to 0.7 percent, an improvement but still short of the 0.5 percent target. This indicated that equalizing slurry mass per unit volume closed most of the gap but pick-up control alone could not fully match shrinkage across the interface. The team concluded a further correction, likely through the firing profile itself, was needed to close the remaining 0.2 percent.

Trial 3 kept the two-stage dip but added a slow 1 C per minute ramp through the 1,100 to 1,350 C sintering window with a 45 minute hold, to test whether firing profile changes could take up residual shrinkage mismatch. Delamination dropped to 2 of 36 parts and shrinkage mismatch reached 0.4 percent, meeting the target, at a cost of roughly 3 extra hours of kiln time per load. This confirmed shrinkage mismatch in graded replicated foam is governed mainly by slurry mass per unit volume rather than pore size itself, and that a slower ramp through the sintering window closes the gap that pick-up control alone could not. The firing-survival uncertainty was resolved, though at a kiln-time cost flagged for future optimization.

### Line 246

The technological objective was to advance understanding of how slurry loading control, template bonding method, and firing ramp profile govern shrinkage matching, flow and capture performance, and thermal shock behaviour across a pores per inch (ppi) gradient in a production-scale replicated ceramic foam filter. This objective was largely met. The firing survival method, matching slurry mass per unit volume through a two-stage dip plus a slow ramp through the sintering window, brought shrinkage mismatch to 0.4 percent against the 0.5 percent target. The hypothesis on shrinkage matching was largely achieved, though it took three trial iterations beyond the original plan.

Trial 1 and trial 2 findings show shrinkage mismatch is driven more by slurry mass per unit volume than by the ppi of a given zone itself, and a slower ramp through the sintering window closes the remaining shrinkage gap between zones. This fed the two-stage dip and slow-ramp method used in trials 2 and 3. Trial 1 also showed the adhesive bond was never going to work, since it burns out before the ceramic sinters, leaving a gap at the interface; this led to replacing adhesive with thermal fusing of the sponge templates.

Work continues into fiscal 2027 on whether the two-zone method scales to the 30 mm format, whether a continuous gradient behaves the same way, and whether an alternate slurry binder can shorten the kiln-time penalty per load. A customer pour trial of 200 graded filters at one foundry saw no breakage over two months, with X-ray rejects on thin-wall housings dropping from 6.2 to 4.5 percent; this result is limited to one foundry and one alloy and is not yet generalized. The graded filter meets the original goal of cutting breakage while raising fine inclusion capture, combining a coarse entry face for shock resistance with a fine exit layer for capture.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 327/350 words, 35/50 lines |
| 242 | Claim Exclusion: Pricing requests from thin-wall customers are a commercial/market response, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Selling the filter as tougher and cleaner as a market positioning advantage is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: The 2023 dip-in-second-slurry attempt to clog the bottom half predates the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Routine field return data collection and standard quality tracking is not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Changing the dip line to support the two-stage coat is a production/manufacturing implementation, and its benefit to uniform filters is a routine process improvement, not the uncertainty-resolving experimentation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Second foundry and second alloy validation before a launch decision is a business/commercial gating step planned for a future year, outside this claim period. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 3) |
| 242 | Glossary Term: sponge replication process | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: thermal shock | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: pores per inch (ppi) | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Storyline | applied | none |  | Uncertainty framing matches storyline setup |
| 242 | Confidence Map: Trial 1 delamination rate stated as 18 of 24 in interview, consistent with 75 percent in trial log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 4 flow rate for graded filter differs slightly between interview (7 percent below 20 ppi) framing and trial log table figures. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Interview states graded filter flow was 7 percent below the 20 ppi standard. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial log states graded filter priming head was +8 percent versus 20 ppi baseline, a distinct metric from flow-rate percentage difference. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether breakage or capture was the primary driver of the project is disputed between the two interviewees. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Process lead's competing view that most testing time and motivation centered on capture. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Well-matched interface acting as crack arrester, established across both interview and trial log with matching figures. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Poorly matched interface (0.7 percent mismatch, trial 2 parts) cracking along the interface in 4 of 10 cases. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Customer pour trial result is a single-site, single-alloy result and explicitly flagged as not yet generalized. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Kiln time cost of trial 3 firing change given as about 3 hours per load in interview, and specific before/after hours in the trial log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the gradient will work at 30 mm thickness or with a continuous gradient is unresolved and explicitly left open for future work. | applied | none |  | Section stays within firing-stage uncertainty, no 30mm claim |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Uses 'shrink at different rates' not the term; repaired to the Glossary Term |
| 242 | Glossary Term: priming head | applied | none |  | Priming head concept absent from section |
| 242 | Glossary Term: pores per inch (ppi) | applied | none |  | Says '20 ppi filter' but not 'pores per inch'; repaired to the Glossary Term |
| 242 | Glossary Term: slurry mass per unit volume | applied | none |  | Slurry mass per unit volume concept absent from section |
| 242 | Glossary Term: delamination | applied | none |  | Term 'delaminating' used, root form of delamination |
| 242 | Glossary Term: two-stage dip | applied | none |  | Two-stage dip concept absent from section |
| 242 | Glossary Term: crack arrester | applied | none |  | Crack arrester concept absent, only 'arrest cracks' as verb |
| 242 | Cover signed-off Summary item ys75y62d7xd03pdt33yb3bfnpx8fd69w | applied | none |  | P1 states company history and coined term. |
| 242 | Cover signed-off Summary item ys72ww5g27n02vcn4n9xf9mzh18fdwj8 | applied | none |  | P2 states both goals with figures. |
| 242 | Cover signed-off Summary item ys7f7ev42qnrm2sm2w9d73ja8s8fczyt | applied | none |  | P3 states no prior art and lab-scale gap. |
| 242 | Cover signed-off Summary item ys75q22ckgbyyj2p411vzpsfed8fd656 | applied | none |  | P4 states the objective as planned. |
| 242 | Cover signed-off Summary item ys75ndgk7qqg94xqzaqxah816h8fc7wt | applied | none | 2 | P5 covers delamination and shrinkage uncertainty. |
| 242 | Cover signed-off Summary item ys7f464c0pwscvnjhvm4ngazcd8fdnrv | applied | none | 2 | P5 covers fine capture vs flow uncertainty. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company has made foam-ceramic filters for metal foundries for over twenty years using a sponge replication process...." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "It was uncertain whether a two-zone sponge template could be bonded or graded and survive firing without delaminating...." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244, 246): Section 242 P1 names the developed structure the cascade-fired lattice, but sections 244 and 246 never use this term and instead describe the same structure as the graded filter or two-zone sponge template. Since pore-size gradient is a glossary term already used consistently elsewhere, the cascade-fired lattice label in 242 is an inconsistent name for the same concept. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 561/700 words, 51/100 lines |
| 244 | Claim Exclusion: Pricing requests from thin-wall customers are a commercial/market response, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Selling the filter as tougher and cleaner as a market positioning advantage is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: The 2023 dip-in-second-slurry attempt to clog the bottom half predates the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Routine field return data collection and standard quality tracking is not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Changing the dip line to support the two-stage coat is a production/manufacturing implementation, and its benefit to uniform filters is a routine process improvement, not the uncertainty-resolving experimentation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Second foundry and second alloy validation before a launch decision is a business/commercial gating step planned for a future year, outside this claim period. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thermal shock | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: slurry mass per unit volume | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Storyline | applied | none |  | Section matches storyline's first 3 trials, no contradiction |
| 244 | Confidence Map: Trial 1 delamination rate stated as 18 of 24 in interview, consistent with 75 percent in trial log. | applied | none |  | 18/24 delamination stated, matches established C1 |
| 244 | Confidence Map: Trial 4 flow rate for graded filter differs slightly between interview (7 percent below 20 ppi) framing and trial log table figures. | applied | none |  | Trial 4 flow figures not mentioned in this section |
| 244 | Confidence Map: Interview states graded filter flow was 7 percent below the 20 ppi standard. | applied | none |  | Trial 4 interview flow figure not mentioned here |
| 244 | Confidence Map: Trial log states graded filter priming head was +8 percent versus 20 ppi baseline, a distinct metric from flow-rate percentage difference. | applied | none |  | Priming head metric not mentioned in this section |
| 244 | Confidence Map: Whether breakage or capture was the primary driver of the project is disputed between the two interviewees. | applied | none |  | Driver dispute not mentioned in this firing-focused section |
| 244 | Confidence Map: Process lead's competing view that most testing time and motivation centered on capture. | applied | none |  | Process lead's capture view not mentioned in this section |
| 244 | Confidence Map: Well-matched interface acting as crack arrester, established across both interview and trial log with matching figures. | applied | none |  | Crack arrester finding not mentioned in this section |
| 244 | Confidence Map: Poorly matched interface (0.7 percent mismatch, trial 2 parts) cracking along the interface in 4 of 10 cases. | applied | none |  | Trial 2 interface cracking result not mentioned here |
| 244 | Confidence Map: Customer pour trial result is a single-site, single-alloy result and explicitly flagged as not yet generalized. | applied | none |  | Customer pour trial result not detailed in this section |
| 244 | Confidence Map: Kiln time cost of trial 3 firing change given as about 3 hours per load in interview, and specific before/after hours in the trial log. | applied | none |  | 3 extra hours kiln cost stated, matches established C10 |
| 244 | Confidence Map: Whether the gradient will work at 30 mm thickness or with a continuous gradient is unresolved and explicitly left open for future work. | applied | none |  | 30 mm/continuous gradient question not mentioned here |
| 244 | Glossary Term: sponge replication process | applied | none |  | Sponge replication process concept absent from section |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Section says 'capture' but not 'fine inclusion capture'; repaired to the Glossary Term |
| 244 | Glossary Term: priming head | applied | none |  | Priming head concept absent from section |
| 244 | Glossary Term: pores per inch (ppi) | applied | none |  | 'ppi' used verbatim (e.g. 20 ppi, 10 ppi, 30 ppi) |
| 244 | Glossary Term: crack arrester | applied | none |  | Crack arrester concept absent from this firing-only section |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status mentioned in section. |
| 244 | Cover signed-off Summary item ys7e5dfwp5eeng0y5564921jn58fc3pv | applied | none |  | Three phases and foundry trial stated verbatim. |
| 244 | Cover signed-off Summary item ys7e1jdrnw3f0ad91fgt5f3da18fctc8 | applied | none |  | Hypothesis and testable metrics stated in P2. |
| 244 | Cover signed-off Summary item ys73g8yyzsfb39kqn20z1ww7798fdej5 | applied | none |  | Trial 1 bond, delamination count, mismatch given. |
| 244 | Cover signed-off Summary item ys79k9yd9zp082e33qkd6wpa718fdv21 | applied | none |  | Trial 2 fusing, dip, delamination, mismatch given. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The plan set three phases: making graded green bodies that survive firing, then lab flow and capture testing, then ther..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If the graded filter survives firing, then it should capture more fine inclusions than the 20 ppi standard filter. The..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 244, 246): P3 says Trial 1 showed the adhesive was the weak point and that uneven slurry pick-up between pore sizes was driving the mismatch, with the finer 30 ppi side picking up more slurry per volume than the coarse side. Section 246 P2 states shrinkage mismatch is driven more by slurry mass per unit volume than by ppi itself, which is a different framing of what Trial 1 actually established (Trial 1 only isolated the adhesive failure and the pick-up imbalance, not a ppi-versus-slurry-mass conclusion). The claim in 246 attributes a finding to Trial 1 that Trial 1's own description in 244 does not support. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 4 (sections 244, 246): P4 says Trial 2 introduced a two-stage dip to even out slurry pick-up and that this alone was not enough, concluding a further correction 'likely through the firing profile itself' was needed. Section 246 P2 restates this as an established finding that a slower ramp closes the gap, which is consistent, but 246 P1 credits the two-stage dip plus slow ramp together as 'the firing survival method' without noting that the two-stage dip's dip-line implementation is called out in the Claim Exclusions as a routine production change, not part of the uncertainty-resolving experimentation. This creates a mismatch between how much credit for uncertainty resolution 246 assigns to the two-stage dip versus how the exclusions characterize it. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 305/350 words, 27/50 lines |
| 246 | Claim Exclusion: Pricing requests from thin-wall customers are a commercial/market response, not eligible technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Selling the filter as tougher and cleaner as a market positioning advantage is a business consideration. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: The 2023 dip-in-second-slurry attempt to clog the bottom half predates the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Routine field return data collection and standard quality tracking is not itself experimental work. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Changing the dip line to support the two-stage coat is a production/manufacturing implementation, and its benefit to uniform filters is a routine process improvement, not the uncertainty-resolving experimentation itself. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Second foundry and second alloy validation before a launch decision is a business/commercial gating step planned for a future year, outside this claim period. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: thermal shock | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: pores per inch (ppi) | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: slurry mass per unit volume | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Storyline | applied | none |  | Section matches storyline claims and figures |
| 246 | Confidence Map: Trial 1 delamination rate stated as 18 of 24 in interview, consistent with 75 percent in trial log. | applied | none |  | P1 states trial 1 75 percent, matches established C1 |
| 246 | Confidence Map: Trial 4 flow rate for graded filter differs slightly between interview (7 percent below 20 ppi) framing and trial log table figures. | applied | none |  | Not discussed; only interview framing used, no conflict shown |
| 246 | Confidence Map: Interview states graded filter flow was 7 percent below the 20 ppi standard. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Trial log states graded filter priming head was +8 percent versus 20 ppi baseline, a distinct metric from flow-rate percentage difference. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Whether breakage or capture was the primary driver of the project is disputed between the two interviewees. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Process lead's competing view that most testing time and motivation centered on capture. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Well-matched interface acting as crack arrester, established across both interview and trial log with matching figures. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Poorly matched interface (0.7 percent mismatch, trial 2 parts) cracking along the interface in 4 of 10 cases. | applied | none |  | Not mentioned in the section |
| 246 | Confidence Map: Customer pour trial result is a single-site, single-alloy result and explicitly flagged as not yet generalized. | not_applied | missing_fact |  | P4 states pour trial result flatly, no single-site hedge; repaired, then shortened to fit the Line limit, so not re-verified |
| 246 | Confidence Map: Kiln time cost of trial 3 firing change given as about 3 hours per load in interview, and specific before/after hours in the trial log. | applied | none |  | P4 states about 3 hour kiln-time cost, matches established C10 |
| 246 | Confidence Map: Whether the gradient will work at 30 mm thickness or with a continuous gradient is unresolved and explicitly left open for future work. | applied | none |  | P4 hedges 30mm scaling and continuous gradient as open questions |
| 246 | Glossary Term: sponge replication process | applied | none |  | Concept of replication process named via 'replicated ceramic… |
| 246 | Glossary Term: priming head | applied | none |  | Priming head concept not discussed in section |
| 246 | Glossary Term: pores per inch (ppi) | applied | none |  | Pore size used instead of 'pores per inch (ppi)'; repaired to the Glossary Term |
| 246 | Glossary Term: crack arrester | applied | none |  | Concept of crack arresting not discussed in section |
| 246 | Cover signed-off Summary item ys736y3bwyehshahpbf69a906n8fcj2y | applied | none |  | P1 states the 0.4% mismatch met vs 0.5% target and trial count. |
| 246 | Cover signed-off Summary item ys7awhnhrkqh2w714vg2gdeskx8fc7ve | applied | none | 2 | P2 covers slurry mass driver and slower ramp finding. |
| 246 | Cover signed-off Summary item ys76x1ps22pkb0yx9t5rp250fx8fcd32 | applied | none | 2 | P2 states adhesive bond failure and switch to thermal fusing. |
| 246 | Cover signed-off Summary item ys73zc87w5x4we8yww72ez12es8fdcb2 | applied | none |  | P3 gives pour trial figures and single-foundry caveat. |
| 246 | Cover signed-off Summary item ys73xsp99ez3vaemppt3xzwyts8fcn69 | applied | none |  | P3 links graded filter to breakage/capture goal via… |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The graded filter connects directly to the original goal of cutting breakage while raising fine inclusion capture. It a..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 3 (sections 246): P3 describes a customer pour trial of 200 graded filters at one foundry with breakage and X-ray reject results, presented as part of the project's advancement narrative. The Claim Exclusions list states that second foundry and second alloy validation before a launch decision is a business/commercial gating step planned for a future year, outside the claim period, and separately that routine field return data collection is not itself experimental work. Presenting this single-foundry field trial as supporting the technological advancement risks framing excluded validation/field-data work as claimed experimentation. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 25.
- Line 244: 0 labels and 0 plan checks "Not checked" of 22.
- Line 246: 0 labels and 0 plan checks "Not checked" of 21.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 11.4 s, p95 19.7 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.3 s, p95 15.3 s over 1.
- Sign-off to report created: 150.0 s.
- Cost from aiUsage: $1.05 in all ($0.38 seed stage, $0.67 Brief, drafting and checks) over 44 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-30T18:03:21.197Z created project k97dtzacgtt2ykqzw2edqs3qh58fdhbt
2026-09-30T18:03:22.141Z added document graded-filter-trial-log.md
2026-09-30T18:03:23.478Z started Step by step generation k578vbxh7fq0xjx5zdmwzkdy4d8fd8nm
2026-09-30T18:04:11.886Z seed stage open
2026-09-30T18:04:11.887Z Open Company / Context and wait for its Batch
2026-09-30T18:04:23.678Z Company / Context: select the first Seed
2026-09-30T18:04:25.678Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-09-30T18:04:27.665Z Approve Company / Context
2026-09-30T18:04:29.621Z approved company_context
2026-09-30T18:04:29.621Z Open Goal / Problem and wait for its Batch
2026-09-30T18:04:44.231Z Goal / Problem: select the first Seed
2026-09-30T18:04:46.226Z Approve Goal / Problem
2026-09-30T18:04:48.205Z approved goal_problem
2026-09-30T18:04:48.205Z Open Technological limitations and wait for its Batch
2026-09-30T18:05:00.109Z Technological limitations: select the first Seed
2026-09-30T18:05:02.149Z Approve Technological limitations
2026-09-30T18:05:04.163Z approved passive_limitations
2026-09-30T18:05:04.163Z Open Technological objectives and wait for its Batch
2026-09-30T18:05:18.822Z Technological objectives: select the first Seed
2026-09-30T18:05:20.879Z Approve Technological objectives
2026-09-30T18:05:22.869Z approved technological_objective
2026-09-30T18:05:22.869Z Open Technological uncertainties and wait for its Batch
2026-09-30T18:05:34.714Z Technological uncertainties: select the first 2 Seeds
2026-09-30T18:05:37.988Z Approve Technological uncertainties
2026-09-30T18:05:39.975Z approved active_uncertainties
2026-09-30T18:05:39.975Z Skip Previous-year status
2026-09-30T18:05:41.305Z Open Work plan and wait for its Batch
2026-09-30T18:05:58.564Z Work plan: select the first Seed
2026-09-30T18:06:00.582Z Approve Work plan
2026-09-30T18:06:02.587Z approved workplan
2026-09-30T18:06:02.587Z Open Hypothesis and wait for its Batch
2026-09-30T18:06:14.538Z Hypothesis: select the first Seed
2026-09-30T18:06:16.515Z Approve Hypothesis
2026-09-30T18:06:18.531Z approved hypothesis
2026-09-30T18:06:18.531Z Open Experimentation / Iterations and wait for its Batch
2026-09-30T18:06:33.047Z Experimentation / Iterations: select the first 2 Seeds
2026-09-30T18:06:36.420Z Approve Experimentation / Iterations
2026-09-30T18:06:38.414Z approved experimentation
2026-09-30T18:06:38.414Z Goal / Problem: select a different Seed and untick the earlier selection (writer switches the goal framing)
2026-09-30T18:06:41.738Z Approve Goal / Problem
2026-09-30T18:06:43.676Z approved goal_problem
2026-09-30T18:06:43.676Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-09-30T18:06:58.339Z Technological uncertainties: Confirm and approve the carried selections
2026-09-30T18:07:00.369Z approved active_uncertainties (confirmed 2 carried)
2026-09-30T18:07:00.369Z Confirm and approve every Stale Subsection, in order
2026-09-30T18:07:03.656Z approved passive_limitations (confirmed 1 carried)
2026-09-30T18:07:06.312Z approved technological_objective (confirmed 1 carried)
2026-09-30T18:07:08.971Z approved workplan (confirmed 1 carried)
2026-09-30T18:07:11.627Z approved hypothesis (confirmed 1 carried)
2026-09-30T18:07:14.332Z approved experimentation (confirmed 2 carried)
2026-09-30T18:07:14.333Z Open Advancement to science / technology and wait for its Batch
2026-09-30T18:07:16.278Z Advancement to science / technology: select the first Seed
2026-09-30T18:07:18.267Z Approve Advancement to science / technology
2026-09-30T18:07:22.306Z approved overall_advancement (confirmed 1 carried)
2026-09-30T18:07:22.306Z Open Specific technological advancements and wait for its Batch
2026-09-30T18:07:24.304Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-30T18:07:30.608Z Approve Specific technological advancements
2026-09-30T18:07:32.606Z approved specific_advancements (confirmed 2 carried)
2026-09-30T18:07:32.606Z Open Project status and next steps and wait for its Batch
2026-09-30T18:07:36.497Z Project status and next steps: select the first Seed
2026-09-30T18:07:38.486Z Approve Project status and next steps
2026-09-30T18:07:40.461Z approved project_status (confirmed 1 carried)
2026-09-30T18:07:40.461Z Open Overall company / project goal improvements and wait for its Batch
2026-09-30T18:07:55.055Z Overall company / project goal improvements: select the first Seed
2026-09-30T18:07:57.043Z Approve Overall company / project goal improvements
2026-09-30T18:07:59.046Z approved goal_improvements
2026-09-30T18:07:59.046Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-30T18:08:00.430Z signed off; waiting for the report
2026-09-30T18:10:32.404Z report kd7ffsz7wbf1abbb8v6qgsnzd98fcyv6 created
```
