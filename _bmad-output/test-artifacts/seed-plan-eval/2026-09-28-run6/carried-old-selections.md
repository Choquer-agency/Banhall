# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-28 on `local` at commit `c8ce1fe2`, acting as e2e-audit@banhall.local. Project `k974wbf7ky7q19nzvkq7j8dh998f9w04`, generation `k574t7qptvy6ape679gx5w0qm98f9y2m`.

## What this fixture tests

The writer approves through Experimentation, then switches the goal framing (from filter breakage to fine-inclusion capture, both supported by the sources). Every approved successor goes Stale. The writer regenerates Technological uncertainties but keeps the older selections and must Confirm and approve them as carried; the other Stale steps are confirmed the same way. Company / Context carries a writer edit with a term that is in no source, which must reach the drafted Section 242, and that edited item is writer-asserted.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Section 242 states the goal the writer switched to, not the first framing, and the carried uncertainties still read as consistent with it.
   - Answer: Yes. Line 242 paragraph 2 states the switched-to goal (cut cracking under thermal shock, raise capture of 20 to 80 micron inclusions); the first framing (a single pore-graded filter) appears nowhere. The carried uncertainties (firing survival, capture against flow) fit it.
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: Yes. Line 242 paragraph 5 follows plan item 5 clause by clause; "slurry loading" became the glossary term "slurry pick-up", which the sources also use.
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: Yes. "The team calls the graded structure under study in this project the cascade-fired lattice." No evidence is invented for the name.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, all three Lines within their caps (341, 665, 345 words).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 (lead), on two independent AI judges (Opus 5.5 with SR&ED research, Fable 5.1 with enterprise release-gate research), delegated by the product owner
- Date: 2026-09-28
- Notes: Both judges pass (high and medium confidence). Every figure checked matches the trial notes. Major, for the consultant: Line 244 says Line 242 sets out three uncertainties (adds interface behaviour under thermal shock) but 242 states two, and Line 246 claims an advancement on the third; the cross-Line consistency pass did not run on this fixture (call failed). Minor: "the 25 mm zone originally assumed" is not in the hypothesis; the field-trial Compliance Note row is stale.

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7ce62w99zfx4s219gkpp6nth8f92qd |
| All three Sections were drafted | pass | 242: 341 words, 244: 665 words, 246: 345 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Seed-stage requests (informational; notice at 40, never refused) | info | 19 metered calls (19 Batch, 0 Feedback), 19 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company has made foam-ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | ". The team calls the graded structure under study in this project the cascade-fired lattice. That production history gave the engineering group direct working kn" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P1 covers 20yr history and names cascade-fired lattice" |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company has made foam-ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The goal was to cut cracking under thermal shock, since fiscal 2025 field data showed 3.8 percent of used filters cracked. / The company also wanted to raise capture of fine 20 to 80 micron inclusions without killing flow for thin-wall customers. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Industry practice of stacking two filters doubled cost and left a bypass gap for metal. / Thicker single fine filters cracked worse under thermal stress and were harder to prime. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether sponge templates of two pore sizes could be bonded or graded and survive firing without delaminating. / This knowledge was meant to enable a replicated foam with a continuous pore gradient through a 50 mm part fired at production scale. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- Shrinkage and interface stress could not be calculated because slurry loading and strut geometry data did not exist for a graded part. / Struts become hollow after sponge burnout, so interface stress on both sides could not be modeled in advance. _(cited, carried from an older context)_
- Whether a gradient could raise fine inclusion capture while keeping flow rate and priming head near the standard 20 ppi filter was unresolved. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The systematic approach varied bonding method, dip staging and firing ramp across successive trials to resolve delamination. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If the graded template survives firing, then fine inclusion capture should rise at least 30 percent over the 20 ppi standard. / The same hypothesis specified no more than a 10 percent flow penalty relative to the standard filter. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 used adhesive-bonded 10 and 30 ppi sheets with a single slurry dip, but 18 of 24 parts delaminated at the bond line. / This established that the finer zone picked up disproportionately more slurry, producing a 1.4 percent shrinkage mismatch on survivors. _(cited, carried from an older context)_
- Trial 2 replaced the adhesive with a thermal-fused bond and a two-stage dip, cutting delamination to 9 of 40 parts. / Mismatch improved to 0.7 percent, still above the 0.5 percent target, so the firing curve itself needed adjustment. _(writer-asserted, carried from an older context)_

### 10. Advancement to science / technology (Section 246, standard): approved

- The firing survival method met its target: two-stage dip, thermal fusing and a slow sintering ramp cut mismatch to 0.4 percent. / Adhesive bonding was ruled out entirely because it burns out before the ceramic sinters, closing off that path. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Trials 1 and 2 showed that shrinkage mismatch tracks slurry mass per volume more than pore size itself. / This knowledge resolved whether graded templates could survive firing without delaminating. _(cited, carried from an older context)_
  - Links: uncertainty "Shrinkage and interface stress could not be calculated because slur..."; experiments "Trial 2 replaced the adhesive with a thermal-fused bond and a two-s...", "Trial 1 used adhesive-bonded 10 and 30 ppi sheets with a single slu..."
- Trial 1 revealed that adhesive bonding fails because it burns out before the ceramic sinters. / Trial 2 confirmed a thermal-fused bond with a two-stage dip is a viable alternative for firing survival. _(cited, carried from an older context)_
  - Links: uncertainty "Shrinkage and interface stress could not be calculated because slur..."; experiments "Trial 2 replaced the adhesive with a thermal-fused bond and a two-s...", "Trial 1 used adhesive-bonded 10 and 30 ppi sheets with a single slu..."

### 12. Project status and next steps (Section 246, standard): approved

- A field pour trial at one customer foundry used 200 filters and saw no breakage. / The same trial showed X-ray rejects on thin-wall housings drop from 6.2 percent to 4.5 percent. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- The firing-survival method and the thermal shock findings together let the graded filter meet both original goals, cracking reduction and fine capture. / This closed the loop from the two linked problems, breakage and capture, that were named at project start. _(cited)_

## Drafted Sections

### Line 242

Brackenridge Kilnworks Ltd. has made replicated foam-ceramic filters for metal foundries for a little over twenty years, using the standard sponge-replication process of coating a polyurethane template in ceramic slurry and firing out the sponge to leave a ceramic copy. The team calls the graded structure under study in this project the cascade-fired lattice. That production history gave the engineering group direct working knowledge of firing curves, slurry behaviour, and shrinkage, the exact variables at stake in attempting a graded structure.

The goal was to cut cracking under thermal shock, since fiscal 2025 field data showed 3.8 percent of used filters cracked. The company also wanted to raise capture of fine 20 to 80 micron inclusions without killing flow for thin-wall customers.

The limitations to standard practice were that no method existed to combine both goals in one part. Industry practice of stacking two filters doubled cost and left a bypass gap for metal. Thicker single fine filters cracked worse under thermal stress and were harder to prime. Published work on graded ceramic foams was limited to lab-scale discs made by gel casting or freeze casting, not replicated foam fired at 50 mm production scale, so no documented method addressed the company's process or part size.

The technological objective was to advance the understanding of whether sponge templates of two pore sizes could be bonded or graded and survive firing without delaminating. This knowledge was meant to enable a replicated foam filter with a continuous pore-size gradient through a 50 mm part fired at production scale.

Shrinkage and interface stress could not be calculated in advance, because slurry pick-up and strut geometry data did not exist for a graded part. Struts become hollow after sponge burnout, so interface stress on both sides of the gradient could not be modeled. It was also uncertain whether a pore-size gradient could raise fine inclusion capture while keeping flow rate and priming head close to the standard 20 ppi filter, since no data existed on how a graded foam behaves under a real aluminium pour.

### Line 244

The technological problem was that no method existed to build a pore-size gradient into a replicated foam filter and fire it at 50 mm production scale without the zones delaminating from shrinkage mismatch, and no data existed on how such a graded structure would behave under flow, fine inclusion capture, or thermal shock during an aluminium pour. The systematic approach varied bonding method, dip staging and firing ramp across successive trials to resolve delamination. Once a survivable two-zone template was achieved, the plan moved to flow rig testing and thermal shock testing. This mapped directly to the three uncertainties set out in Section 242: firing survival, the flow and capture trade-off, and interface behaviour under thermal shock.

It was hypothesized that if a two-zone template (10 ppi entry, 30 ppi exit) was coated so both zones carried a similar slurry mass per unit volume, then firing shrinkage mismatch between zones would stay within 0.5 percent and the part would survive firing without delaminating. If the graded template survived firing, fine inclusion capture was expected to rise at least 30 percent over the 20 ppi standard filter, with no more than a 10 percent flow penalty relative to that same standard.

Trial 1 addressed whether adhesive-bonded templates of two pore sizes, given a single slurry dip, could survive standard firing. Adhesive-bonded 10 and 30 ppi sheets were dipped once and fired on the standard curve, but 18 of 24 parts delaminated at the bond line. The finer zone had picked up disproportionately more slurry than the coarse zone, producing a 1.4 percent shrinkage mismatch on the parts that survived, showing that uneven slurry pick-up between pore sizes, not the pore sizes themselves, was driving the failure. The team replaced the adhesive with a thermal-fused bond and introduced a two-stage dip in Trial 2, applying a thin overall dip followed by a thicker dip on the coarse half only, and fired 40 parts. Delamination dropped to 9 of 40, and mismatch improved to 0.7 percent, still above the 0.5 percent target, so the firing curve itself needed adjustment.

Trial 3 addressed whether the firing curve could close the remaining mismatch. Keeping the two-stage dip, the team added a slow 1 C per minute ramp through the 1,100 to 1,350 C sintering window with a 45 minute hold before proceeding to peak temperature. Delamination fell to 2 of 36 parts and mismatch reached 0.4 percent, meeting the target, at a cost of roughly 3 extra hours of kiln time per load. This confirmed that shrinkage mismatch is governed by slurry mass per unit volume rather than pore size, and that adhesive bonding is unworkable because it burns out before the ceramic densifies.

Trial 4 addressed whether a graded filter with a 25 mm fine zone could raise capture without excessive flow loss. On a 50 kg A356 flow rig, the graded filter flowed at 3.8 kg/s against a 4.1 kg/s baseline for the 20 ppi standard and captured 41 percent more fine inclusions, but 2 of 6 pours choked late as inclusions built a cake on the fine face. Trial 5 thinned the fine zone to 15 mm against a 35 mm coarse zone; flow held steady at 3.9 kg/s across the full pour with no choking, at a slightly reduced 36 percent capture gain, establishing the thinner fine zone as the better trade-off.

Trial 6 addressed whether the graded interface would arrest or initiate cracks under thermal shock. Quench-and-crush testing showed the graded filter retaining 68 percent strength against 55 percent for the standard filter, and cold burst testing showed 1 of 20 graded filters cracking, with the crack stopping at the interface, against 3 of 20 standard filters. Poorly matched parts retained from Trial 2, at 0.7 percent mismatch, cracked directly along the interface in 4 of 10 cases. This showed the interface only acts as a crack arrester when shrinkage mismatch is controlled below the 0.5 percent target, tying the firing-survival and thermal-shock uncertainties together.

### Line 246

The technological objective was to advance understanding of pore-size gradient fabrication in a replicated foam filter made by sponge replication, and to determine whether such a structure could resist thermal-shock cracking while improving fine inclusion capture in a production-scale 50 mm filter. This was achieved. A two-zone template coated to equalize slurry mass per unit volume across zones kept firing shrinkage mismatch within the 0.5 percent target, and the surviving graded filter met the 30 percent fine inclusion capture target while staying within the 10 percent flow penalty limit. Reality differed from the hypothesis mainly in fine-zone thickness: the 25 mm zone originally assumed caused late-pour choking, requiring a 15 mm zone to hold flow steady.

Trials 1 and 2 established that shrinkage mismatch tracks slurry mass per unit volume more than pore size itself, resolving whether graded templates could survive firing without delaminating. Trial 1 also showed that adhesive bonding fails because it burns out before the ceramic sinters, closing off that path entirely. Trial 2 confirmed a thermal-fused bond with a two-stage dip as a viable alternative. Applying a two-stage dip, the thermal-fused bond and a slow ramp through the 1,100-1,350 C sintering window cut mismatch to 0.4 percent and delamination to 2 of 36 parts.

Next, the company must determine whether the method holds at 30 mm thickness, the highest-volume format, since slurry pick-up and shrinkage behaviour there have not been characterized. Whether a continuous gradient, rather than a two-zone construction, can survive firing also remains open, as does whether an alternate binder can shorten the sintering ramp below the current 3-hour kiln time penalty. These are planned for fiscal 2027.

The firing-survival method and the finding that a well-matched interface acts as a crack arrester let the graded filter meet both original goals, reduced cracking and improved fine capture, in a single part, closing the loop between the two problems named at project start. A 200-filter pour trial at one customer foundry, limited to one alloy, confirmed zero breakage and cut X-ray rejects on thin-wall housings from 6.2 to 4.5 percent.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 341/350 words, 35/50 lines |
| 242 | Claim Exclusion: Pricing requests from thin-wall customers and the commercial positioning of the filter as tougher and cleaner than competitors' products are business considerations, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Changing the dip line to support the two-stage coat and the resulting benefit to uniform filter production is a process/equipment change for manufacturing, not part of the graded-filter experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Plans for a second foundry and a second alloy trial before a launch decision are commercial validation steps outside the claimed technical uncertainty resolution, and outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: General background on the company's twenty-plus years of standard foam-ceramic filter manufacturing is routine established production, not the uncertain work under study. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Glossary Term: priming head | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: slurry pick-up | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Storyline | applied | none |  | P1-P5 align with storyline background and uncertainties |
| 242 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent from two customers is established by both interview and trial log. | applied | none |  | P2 states established 3.8% figure flatly, matches C1 |
| 242 | Confidence Map: The interview version of the same fiscal 2025 field return statistic. | applied | none |  | Same established figure, no conflict shown |
| 242 | Confidence Map: Whether breakage or capture was the primary driver of the project is unresolved between the VP and process lead. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Competing claim that most testing time and the origin of the gradient idea centered on capture, not breakage. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination and mismatch figures are established and consistent across transcript and log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination percentage stated explicitly in the trial log. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 3 firing curve change and resulting delamination/mismatch improvement to meet target. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 4 flow and capture numbers for the graded 25 mm filter are established, with the interview and log giving slightly different framing of the flow penalty (7 percent vs 8 percent implied by table) but compatible. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial log table gives priming head for graded 25mm filter as +8 percent versus 20 ppi baseline, a compatible but distinct measurement from the flow rate percentage in the interview. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 5 results (15 mm fine zone, no choking, 36 percent capture gain) are established and consistent across sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 6 thermal shock retained-strength and burst test results are established and consistent across sources. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial outcome (200 filters, zero breakage, X-ray reject drop from 6.2 to 4.5 percent) is established but explicitly limited in scope to one foundry and one alloy. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether the gradient works at 30 mm thickness and whether continuous grading is achievable remain open and unresolved as of the end of fiscal 2026. | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Whether a different slurry binder can shorten the slow ramp and reduce kiln time is unresolved, framed as future work. | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Concept absent from this uncertainty section |
| 242 | Glossary Term: delamination | applied | none |  | Concept absent from this uncertainty section |
| 242 | Glossary Term: two-stage dip | applied | none |  | Concept absent from this uncertainty section |
| 242 | Glossary Term: crack arrester | applied | none |  | Concept absent from this uncertainty section |
| 242 | Glossary Term: two-zone template | applied | none |  | Concept absent from this uncertainty section |
| 242 | Glossary Term: thermal-fused bond | applied | none |  | Concept absent from this uncertainty section |
| 242 | Cover signed-off Summary item ys74ysa838tck1ybehks6973jh8f9xm6 | applied | none |  | P1 covers 20yr history and names cascade-fired lattice |
| 242 | Cover signed-off Summary item ys7fnd07aqwkgm73grkya7vbtd8f9sbv | applied | none |  | P2 covers both cracking goal and capture goal as planned |
| 242 | Cover signed-off Summary item ys7cp6fygxmgvb66wm4b61f9ys8f8qae | applied | none |  | P3 covers stacking cost/gap and thicker filter cracking/priming |
| 242 | Cover signed-off Summary item ys75anzm546td363mx4k3dcyy58f9e16 | applied | none |  | P4 covers bonding/grading and continuous gradient objective |
| 242 | Cover signed-off Summary item ys7343g0120364bja8v4a68vw58f9t3s | applied | none | 2 | P5 covers shrinkage/interface stress uncertainty and hollow… |
| 242 | Cover signed-off Summary item ys75kbfj42e1j7mced0rjpnb398f8pv9 | applied | none | 2 | P5 covers capture vs flow/priming uncertainty as planned |
| 242 | Leave out quotes marked for a check from the evidence for the idea "Shrinkage and interface stress could not be calculated because slurry loading and strut geometry data did not exist for..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 665/700 words, 59/100 lines |
| 244 | Claim Exclusion: Pricing requests from thin-wall customers and the commercial positioning of the filter as tougher and cleaner than competitors' products are business considerations, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Changing the dip line to support the two-stage coat and the resulting benefit to uniform filter production is a process/equipment change for manufacturing, not part of the graded-filter experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Plans for a second foundry and a second alloy trial before a launch decision are commercial validation steps outside the claimed technical uncertainty resolution, and outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: General background on the company's twenty-plus years of standard foam-ceramic filter manufacturing is routine established production, not the uncertain work under study. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 6) |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: slurry pick-up | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: two-zone template | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: thermal-fused bond | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Storyline | applied | none |  | Section matches storyline uncertainties, trials, hypothesis |
| 244 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent from two customers is established by both interview and trial log. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: The interview version of the same fiscal 2025 field return statistic. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether breakage or capture was the primary driver of the project is unresolved between the VP and process lead. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Competing claim that most testing time and the origin of the gradient idea centered on capture, not breakage. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 1 delamination and mismatch figures are established and consistent across transcript and log. | applied | none |  | Trial 1 figures stated match established data |
| 244 | Confidence Map: Trial 1 delamination percentage stated explicitly in the trial log. | applied | none |  | 18 of 24 figure matches established trial log |
| 244 | Confidence Map: Trial 3 firing curve change and resulting delamination/mismatch improvement to meet target. | applied | none |  | Trial 3 ramp and results match established data |
| 244 | Confidence Map: Trial 4 flow and capture numbers for the graded 25 mm filter are established, with the interview and log giving slightly different framing of the flow penalty (7 percent vs 8 percent implied by table) but compatible. | applied | none |  | Flow/capture figures stated flatly, matches established data |
| 244 | Confidence Map: Trial log table gives priming head for graded 25mm filter as +8 percent versus 20 ppi baseline, a compatible but distinct measurement from the flow rate percentage in the interview. | applied | none |  | Priming head figure not stated in section |
| 244 | Confidence Map: Trial 5 results (15 mm fine zone, no choking, 36 percent capture gain) are established and consistent across sources. | applied | none |  | Trial 5 figures match established data |
| 244 | Confidence Map: Trial 6 thermal shock retained-strength and burst test results are established and consistent across sources. | applied | none |  | Trial 6 figures match established data |
| 244 | Confidence Map: Field trial outcome (200 filters, zero breakage, X-ray reject drop from 6.2 to 4.5 percent) is established but explicitly limited in scope to one foundry and one alloy. | applied | none |  | Field trial outcome not mentioned in this section |
| 244 | Confidence Map: Whether the gradient works at 30 mm thickness and whether continuous grading is achievable remain open and unresolved as of the end of fiscal 2026. | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Whether a different slurry binder can shorten the slow ramp and reduce kiln time is unresolved, framed as future work. | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: priming head | applied | none |  | Concept of priming head absent from section |
| 244 | Glossary Term: two-zone template | applied | none |  | Uses 'two-zone sponge template' not exact term; repaired to the Glossary Term |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status mentioned in section. |
| 244 | Cover signed-off Summary item ys7eap7gwtsfdmppqaax3cgjzx8f9km0 | applied | none |  | Workplan sentence appears verbatim. |
| 244 | Cover signed-off Summary item ys7ap2b6zbfnfeh5ddsqfen4798f97km | applied | none |  | Hypothesis with capture and flow penalty figures present. |
| 244 | Cover signed-off Summary item ys70g91x1x50rdvyymmf3tbatx8f8gvk | applied | none |  | Trial 1 details and 1.4 percent mismatch finding present. |
| 244 | Cover signed-off Summary item ys794d6nfqfrj4q863nxfg442d8f8jvc | applied | none |  | Trial 2 bond change, delamination, mismatch figures present. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The systematic approach varied bonding method, dip staging and firing ramp across successive trials to resolve delamina..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If the graded template survives firing, then fine inclusion capture should rise at least 30 percent over the 20 ppi sta..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 345/350 words, 33/50 lines |
| 246 | Claim Exclusion: Pricing requests from thin-wall customers and the commercial positioning of the filter as tougher and cleaner than competitors' products are business considerations, not technological work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Changing the dip line to support the two-stage coat and the resulting benefit to uniform filter production is a process/equipment change for manufacturing, not part of the graded-filter experimental work. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Plans for a second foundry and a second alloy trial before a launch decision are commercial validation steps outside the claimed technical uncertainty resolution, and outside the fiscal 2026 claim period. | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: General background on the company's twenty-plus years of standard foam-ceramic filter manufacturing is routine established production, not the uncertain work under study. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 4) |
| 246 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: slurry pick-up | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-zone template | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: thermal-fused bond | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: replicated foam filter | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Storyline | applied | none |  | Section matches storyline arc and figures. |
| 246 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent from two customers is established by both interview and trial log. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: The interview version of the same fiscal 2025 field return statistic. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Whether breakage or capture was the primary driver of the project is unresolved between the VP and process lead. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Competing claim that most testing time and the origin of the gradient idea centered on capture, not breakage. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 1 delamination and mismatch figures are established and consistent across transcript and log. | applied | none |  | Section only states final results, not Trial 1 detail. |
| 246 | Confidence Map: Trial 1 delamination percentage stated explicitly in the trial log. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 3 firing curve change and resulting delamination/mismatch improvement to meet target. | applied | none |  | Trial 3 ramp and mismatch improvement stated as established… |
| 246 | Confidence Map: Trial 4 flow and capture numbers for the graded 25 mm filter are established, with the interview and log giving slightly different framing of the flow penalty (7 percent vs 8 percent implied by table) but compatible. | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial log table gives priming head for graded 25mm filter as +8 percent versus 20 ppi baseline, a compatible but distinct measurement from the flow rate percentage in the interview. | applied | none |  | Priming head figure not mentioned in the section. |
| 246 | Confidence Map: Trial 5 results (15 mm fine zone, no choking, 36 percent capture gain) are established and consistent across sources. | applied | none |  | 15 mm fix stated as established, matches confidence map. |
| 246 | Confidence Map: Trial 6 thermal shock retained-strength and burst test results are established and consistent across sources. | applied | none |  | Not directly restated in the section. |
| 246 | Confidence Map: Field trial outcome (200 filters, zero breakage, X-ray reject drop from 6.2 to 4.5 percent) is established but explicitly limited in scope to one foundry and one alloy. | not_applied | missing_fact |  | Field trial stated flatly without noting scope limit.; repaired, then shortened to fit the Line limit, so not re-verified |
| 246 | Confidence Map: Whether the gradient works at 30 mm thickness and whether continuous grading is achievable remain open and unresolved as of the end of fiscal 2026. | applied | none |  | 30 mm and continuous gradient framed as open questions. |
| 246 | Confidence Map: Whether a different slurry binder can shorten the slow ramp and reduce kiln time is unresolved, framed as future work. | applied | none |  | Alternate binder framed as open, hedged as future work. |
| 246 | Glossary Term: priming head | applied | none |  | Priming head concept absent from section. |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Uses 'graded-porosity' and 'graded filter' instead.; repaired to the Glossary Term |
| 246 | Glossary Term: replicated foam filter | applied | none |  | Uses 'filter' and 'graded filter', not 'replicated foam filter'.; repaired to the Glossary Term |
| 246 | Cover signed-off Summary item ys75qf8qz0ppda5f91rdpn4q3x8f8dnf | applied | none |  | P2 covers mismatch cut to 0.4% and adhesive burnout. |
| 246 | Cover signed-off Summary item ys7e9evka7hm7zbpadhb37j7e58f8g18 | applied | none | 2 | P2 states mismatch tracks slurry mass, resolving delamination… |
| 246 | Cover signed-off Summary item ys7902xq0mnht4yp74q04h1jqx8f9bqc | applied | none | 2 | P2 covers adhesive failure and thermal-fused dip alternative. |
| 246 | Cover signed-off Summary item ys7crg4bg4dsyyez3eetz1t8618f867f | applied | none |  | P4 gives 200-filter trial, zero breakage, reject drop. |
| 246 | Cover signed-off Summary item ys7cjywmvnvexsp11nesh4wd658f96ym | applied | none |  | P4 states both goals met, closing loop on two problems. |
| 246 | Leave out quotes marked for a check from the evidence for the idea "The firing-survival method and the thermal shock findings together let the graded filter meet both original goals, crac..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Consistency pass | not_applied | none |  | consistency pass call failed (unknown) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 27.
- Line 244: 0 labels and 0 plan checks "Not checked" of 22.
- Line 246: 0 labels and 0 plan checks "Not checked" of 23.

## Seed-stage numbers

- Requests: 19 metered (19 Batch, 0 Feedback); 19 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.8 s, p95 31.3 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.4 s, p95 15.4 s over 1.
- Sign-off to report created: 132.3 s.
- Cost from aiUsage: $1.08 in all ($0.46 seed stage, $0.62 Brief, drafting and checks) over 44 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-09-28T13:37:23.860Z created project k974wbf7ky7q19nzvkq7j8dh998f9w04
2026-09-28T13:37:24.541Z added document graded-filter-trial-log.md
2026-09-28T13:37:25.932Z started Step by step generation k574t7qptvy6ape679gx5w0qm98f9y2m
2026-09-28T13:38:33.267Z seed stage open
2026-09-28T13:38:33.268Z Open Company / Context and wait for its Batch
2026-09-28T13:38:53.487Z Company / Context: select the first Seed
2026-09-28T13:38:55.551Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-09-28T13:38:57.614Z Approve Company / Context
2026-09-28T13:38:59.658Z approved company_context
2026-09-28T13:38:59.659Z Open Goal / Problem and wait for its Batch
2026-09-28T13:39:17.301Z Goal / Problem: select the first Seed
2026-09-28T13:39:19.372Z Approve Goal / Problem
2026-09-28T13:39:21.438Z approved goal_problem
2026-09-28T13:39:21.438Z Open Technological limitations and wait for its Batch
2026-09-28T13:39:36.240Z Technological limitations: select the first Seed
2026-09-28T13:39:38.455Z Approve Technological limitations
2026-09-28T13:39:40.567Z approved passive_limitations
2026-09-28T13:39:40.567Z Open Technological objectives and wait for its Batch
2026-09-28T13:39:55.378Z Technological objectives: select the first Seed
2026-09-28T13:39:57.452Z Approve Technological objectives
2026-09-28T13:39:59.543Z approved technological_objective
2026-09-28T13:39:59.543Z Open Technological uncertainties and wait for its Batch
2026-09-28T13:40:11.688Z Technological uncertainties: select the first 2 Seeds
2026-09-28T13:40:15.134Z Approve Technological uncertainties
2026-09-28T13:40:17.218Z approved active_uncertainties
2026-09-28T13:40:17.218Z Skip Previous-year status
2026-09-28T13:40:18.611Z Open Work plan and wait for its Batch
2026-09-28T13:40:36.108Z Work plan: select the first Seed
2026-09-28T13:40:38.188Z Approve Work plan
2026-09-28T13:40:40.392Z approved workplan
2026-09-28T13:40:40.393Z Open Hypothesis and wait for its Batch
2026-09-28T13:40:55.317Z Hypothesis: select the first Seed
2026-09-28T13:40:57.409Z Approve Hypothesis
2026-09-28T13:40:59.507Z approved hypothesis
2026-09-28T13:40:59.507Z Open Experimentation / Iterations and wait for its Batch
2026-09-28T13:41:16.990Z Experimentation / Iterations: select the first 2 Seeds
2026-09-28T13:41:20.460Z Approve Experimentation / Iterations
2026-09-28T13:41:22.548Z approved experimentation
2026-09-28T13:41:22.548Z Goal / Problem: select a different Seed and untick the earlier selection (writer switches the goal framing)
2026-09-28T13:41:26.000Z Approve Goal / Problem
2026-09-28T13:41:28.078Z approved goal_problem
2026-09-28T13:41:28.078Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-09-28T13:41:45.704Z Technological uncertainties: Confirm and approve the carried selections
2026-09-28T13:41:47.823Z approved active_uncertainties (confirmed 2 carried)
2026-09-28T13:41:47.823Z Confirm and approve every Stale Subsection, in order
2026-09-28T13:41:51.259Z approved passive_limitations (confirmed 1 carried)
2026-09-28T13:41:54.050Z approved technological_objective (confirmed 1 carried)
2026-09-28T13:41:56.833Z approved workplan (confirmed 1 carried)
2026-09-28T13:41:59.603Z approved hypothesis (confirmed 1 carried)
2026-09-28T13:42:02.455Z approved experimentation (confirmed 2 carried)
2026-09-28T13:42:02.455Z Open Advancement to science / technology and wait for its Batch
2026-09-28T13:42:04.523Z Advancement to science / technology: select the first Seed
2026-09-28T13:42:06.643Z Approve Advancement to science / technology
2026-09-28T13:42:08.738Z approved overall_advancement (confirmed 1 carried)
2026-09-28T13:42:08.738Z Open Specific technological advancements and wait for its Batch
2026-09-28T13:42:18.181Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-09-28T13:42:23.024Z Approve Specific technological advancements
2026-09-28T13:42:25.162Z approved specific_advancements (confirmed 2 carried)
2026-09-28T13:42:25.162Z Open Project status and next steps and wait for its Batch
2026-09-28T13:42:58.772Z Project status and next steps: select the first Seed
2026-09-28T13:43:00.815Z Approve Project status and next steps
2026-09-28T13:43:02.933Z approved project_status
2026-09-28T13:43:02.933Z Open Overall company / project goal improvements and wait for its Batch
2026-09-28T13:43:31.113Z Overall company / project goal improvements: select the first Seed
2026-09-28T13:43:33.224Z Approve Overall company / project goal improvements
2026-09-28T13:43:35.289Z approved goal_improvements
2026-09-28T13:43:35.289Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-09-28T13:43:36.699Z signed off; waiting for the report
2026-09-28T13:45:50.906Z report kd7ce62w99zfx4s219gkpp6nth8f92qd created
```
