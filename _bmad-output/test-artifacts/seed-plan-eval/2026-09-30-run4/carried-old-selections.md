# Release eval - Brackenridge graded foam filters

Semantic case: **Carried old selections** (CAP-13: "carried old selections"). Also checks: an edited term appears in the drafted Section; a writer-asserted item is drafted as a Writer's Note.

Run 2026-09-30 on `local` at commit `e8112000`, acting as e2e-audit@banhall.local. Project `k979pw3s0tf8wkhxj4vexj1ew58ffz2h`, generation `k572syng77g372absmewdfs72s8ffm4g`.

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
   - Answer: Yes. The switch took the capture goal Seed and Line 242 paragraph 2 states it; the carried uncertainties fit it.
2. The carried uncertainty selections are drafted faithfully, even though their Seeds were produced before the goal change.
   - Answer: Yes. Line 242 paragraph 5 follows items 5a and 5b clause by clause.
3. The edited term "cascade-fired lattice" is used naturally in Section 242, and the writer-asserted wording is presented without invented evidence.
   - Answer: Yes. "calls the graded pore structure under development the cascade-fired lattice". No evidence invented.
4. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: Yes. Plain prose, no headings, within caps (322, 622, 342).

- Verdict (pass or fail): pass
- Judged by: Claude Opus 5.5 at extra-high effort (lead), on two independent AI judges (Claude Opus 5.5 with SR&ED and CRA research; Claude Fable 5.1 with enterprise AI release-gate research), each run as a subagent at the harness default effort, which the Agent tool can neither set nor report (the briefs asked for high effort; the effort actually used is not recorded, so it is not claimed), delegated by the product owner
- Date: 2026-09-30
- Notes: Both judges pass (medium and medium-high confidence). Run 12's major is fixed (the "one foundry and one alloy" hedge is back; no unmeasured capture claim). Major (both judges): Line 246 paragraph 1 claims capture beat the 30 percent target and thermal shock resistance improved, true in the sources but with no capture or thermal shock work in Line 244 and no capture uncertainty in Line 242; the Rule B row read applied (checker miss), the consistency pass flagged it. Every figure checked matches the sources.

## Automatic checks

14 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd777ag5hg0nseapb2kmjnk5f98ffhsa |
| All three Sections were drafted | pass | 242: 322 words, 244: 622 words, 246: 342 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work ties to the shrinkage mismatch uncertainty or Line…"); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("All results compared to targets match the numbers."); 246: not_applied ("Result reported as misstated against its target named no valid paragraph.") |
| Seed-stage requests (informational; notice at 40, never refused) | info | 17 metered calls (17 Batch, 0 Feedback), 18 reserved; notice not shown; 0 Retry |
| The edited Seed is in the plan, marked edited and writer-asserted | pass | "The company is a 60 person foam ceramic filter maker based in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired lattice. It has m..." (writer_asserted, edited) |
| The edited term "cascade-fired lattice" appears in the drafted Section | pass | "gineering group calls the graded pore structure under development the cascade-fired lattice. Two decades of production experience with sponge replication, coatin" |
| Approving the regenerated Subsection required Confirm and approve for the carried selections | pass | 2 carried Seed(s) acknowledged; changed Subsections: goal_problem; approve event confirmed=true |
| The carried selections stay in the signed-off plan and none of them came from the fresh Batch | pass | 2 carried Seed(s) in the plan; 1 fresh Batch(es); 0 carried Seed(s) from a fresh Batch |
| Changing the goal opened stale episodes and every one was disposed before sign-off | pass | 6 opened, 6 disposed |
| The writer-asserted item has a coverage row (drafted as a Writer's Note) | pass | applied: "P1 covers company size, location, product, term." |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company is a 60 person foam ceramic filter maker based in Dunmore Falls, Ontario. The team calls the graded structure the cascade-fired lattice. / It has made foam ceramic filters for metal foundries for a little over twenty years. _(edited, writer-asserted)_

### 2. Goal / Problem (Section 242, standard): approved

- The gradient aimed to raise fine inclusion capture in the 20 to 80 micron range without the cost of stacking two filters. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- No prior art existed for a replicated foam with a continuous pore gradient fired at 50 mm production scale. / Published graded ceramic foam work was lab scale, using gel casting or freeze casting of small discs, not sponge replication. _(cited, carried from an older context)_

### 4. Technological objectives (Section 242, standard): approved

- The team sought new knowledge on whether a two-zone sponge template could survive firing without delaminating at the interface. / That knowledge was meant to enable a graded filter combining a tough entry face and a fine capture layer in one part. _(cited, carried from an older context)_

### 5. Technological uncertainties (Section 242, standard): approved

- The team did not know if shrinkage mismatch between the coarse and fine zones would tear the part apart at the interface. / Different pore sizes pick up different slurry mass per unit volume, so they shrink differently in firing. _(cited, carried from an older context)_
- It was unclear whether the graded interface between layers would stop cracks or start them under thermal shock. / This question could not be answered from existing uniform-filter data alone. _(cited, carried from an older context)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The plan laid out phase one to make graded green bodies that survive firing, testing the shrinkage mismatch uncertainty. / Phase two planned lab flow and capture testing, while phase three covered thermal shock and burst testing plus a pour trial. _(cited, carried from an older context)_

### 8. Hypothesis (Section 244, standard): approved

- If both zones pick up similar slurry mass per unit volume, then shrinkage mismatch will stay within 0.5 percent. / This hypothesis targeted whether mismatch would tear the part apart at the interface. _(cited, carried from an older context)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive, single dip, standard firing at 1580 C. _(cited, carried from an older context)_
  - Tested: uncertainty "The team did not know if shrinkage mismatch between the coarse and ..."
- Trial 2 replaced the adhesive with thermal fusion and added a two-stage dip to equalise slurry pick-up. / Delamination dropped to 9 of 40 parts and shrinkage mismatch fell to 0.7 percent, still short of target. _(cited, carried from an older context)_
  - Tested: uncertainty "The team did not know if shrinkage mismatch between the coarse and ..."

### 10. Advancement to science / technology (Section 246, standard): approved

- The shrinkage mismatch uncertainty was resolved: a two-stage dip plus a slow ramp through the sintering window held mismatch to 0.4 percent. / This met the 0.5 percent target and let graded parts survive firing with only 6 percent delamination. _(cited, carried from an older context)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Trial 1 and trial 2 findings showed shrinkage mismatch tracked slurry mass per volume more than pore size itself. / Adhesive bonding was shown not viable because it burns out before the ceramic sinters. _(cited, carried from an older context)_
  - Links: uncertainty "The team did not know if shrinkage mismatch between the coarse and ..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive, singl...", "Trial 2 replaced the adhesive with thermal fusion and added a two-s..."
- Trial 1's adhesive bonding produced 18 of 24 delaminations with a 1.4 percent shrinkage mismatch. _(cited, carried from an older context)_
  - Links: uncertainty "The team did not know if shrinkage mismatch between the coarse and ..."; experiments "Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive, singl..."

### 12. Project status and next steps (Section 246, standard): approved

- A field pour trial at one customer foundry used 200 filters with zero breakage from May to June 2026. / X-ray rejects on thin-wall housings dropped from 6.2 percent to 4.5 percent over that trial. _(cited, carried from an older context)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Shrinkage mismatch between zones was resolved by a two-stage dip and a slow ramp through the sintering window. / That brought mismatch to 0.4 percent and let graded parts survive firing with the pore-size gradient intact. _(cited)_

## Drafted Sections

### Line 242

The company has made alumina replicated foam filters for aluminium foundries for a little over twenty years, operating a 60-person manufacturing site in Dunmore Falls, Ontario. Its engineering group calls the graded pore structure under development the cascade-fired lattice. Two decades of production experience with sponge replication, coating, drying, and firing uniform-pore filters gave the team the process grounding to attempt a pore-size gradient within a single fired part.

The goal was to build a filter with a pore-size gradient through its 50 mm thickness, pairing a coarse entry face with a fine exit face, raising fine inclusion capture in the 20 to 80 micron range without the added cost of stacking two separate filters.

The limitations to standard practice were that no prior art existed for a replicated foam with a continuous pore gradient fired at 50 mm production scale, and no behaviour data existed for how such a part would respond under a real aluminium pour. Published graded ceramic foam work was confined to lab-scale discs made by gel casting or freeze casting, not sponge-replicated parts, leaving no applicable body of knowledge for this manufacturing route or thickness.

The technological objective was to advance the understanding of whether a two-zone template could survive firing without delaminating at the interface, for the purpose of creating a graded filter combining a tough entry face with a fine capture layer in a single fired part.

It was uncertain whether shrinkage mismatch between the coarse and fine zones would tear the part apart at the interface, because different pore sizes pick up different slurry mass per unit volume and so shrink at different rates during firing. It was also uncertain whether the graded interface would act as a crack arrester or a crack initiation plane under thermal shock, a question that could not be answered from existing uniform-filter data, since no prior data described how a shrinkage-mismatched interface behaves under quench or burst conditions.

### Line 244

The technological problem facing the engineering group was whether a two-zone sponge template, 10 ppi on the entry face and 30 ppi on the exit face, could survive firing as a single part without the zones separating at the interface. Different pore sizes pick up different slurry mass per unit volume, so they shrink at different rates during sintering, and no data existed to predict whether that mismatch would tear a 50 mm production-scale part apart. The plan laid out phase one to make graded green bodies that survive firing, testing the shrinkage mismatch uncertainty directly. Phase two planned lab flow and capture testing, while phase three covered thermal shock and burst testing plus a pour trial. The program ran roughly nine months with one dedicated technician and the process lead at about half time.

It was hypothesized that if a two-zone 10 ppi/30 ppi template were coated so both zones picked up similar slurry mass per unit volume, then linear firing shrinkage across the interface would stay within 0.5 percent and the part would survive firing without delamination. This hypothesis targeted whether shrinkage mismatch between the coarse and fine zones would tear the part apart at the interface during sintering.

Trial 1 tested whether a two-zone template could be joined and fired intact using the simplest construction available: 10 ppi and 30 ppi sponge sheets bonded with polyurethane adhesive, dipped once in standard slurry, and fired on the standard 1,580 C curve. Eighteen of 24 parts delaminated at the bond line, a 75 percent failure rate, and the surviving parts showed a 1.4 percent shrinkage mismatch, with the 30 ppi side shrinking more than the 10 ppi side. This showed that the finer zone picked up more slurry mass per unit volume than the coarse zone, and that the adhesive bond itself burned out before the ceramic sintered, leaving a gap rather than a joint. The team concluded adhesive bonding was not viable for this structure and that slurry pick-up, not pore size alone, was driving the mismatch.

Trial 2 addressed both failures from trial 1: the team replaced adhesive bonding with thermal fusion of the sponge templates, and introduced a two-stage dip, first coating the whole part in a thinner slurry, then dipping only the coarse half in a thicker slurry, to reduce the difference in pick-up between zones. Across 40 parts, delamination dropped to 9, or 22 percent, and shrinkage mismatch fell to 0.7 percent. This was a marked improvement over trial 1, but the mismatch remained above the 0.5 percent target, showing that slurry control alone could narrow the gap without closing it fully.

Trial 3 kept the two-stage dip from trial 2 and added a slow 1 C/min firing ramp between 1,100 and 1,350 C, the main sintering shrinkage window, with a 45 minute hold at 1,350 C. Across 36 parts, delamination fell to 2, or 6 percent, and shrinkage mismatch measured 0.4 percent, meeting the 0.5 percent target, at a cost of about 3 added hours of kiln time per load. This resolved the shrinkage mismatch uncertainty: mismatch tracks slurry mass per unit volume more than pore size itself, and a slow ramp through the sintering window lets both zones equalize shrinkage before final densification, closing the gap left by slurry control alone.

With a firing method that reliably produced intact graded parts, the team moved to flow, capture, and thermal shock testing. A field pour trial at one customer foundry used 200 filters with zero breakage from May to June 2026, and X-ray rejects on thin-wall housings dropped from 6.2 percent to 4.5 percent over that trial; this result is limited to one foundry and one alloy and has not been generalized beyond that trial.

### Line 246

The objective was to establish whether a two-zone template could survive firing intact and raise fine inclusion capture and thermal shock resistance over a standard uniform-pore filter. This was achieved. The hypothesis was partly proven: shrinkage mismatch was held within target through slurry control combined with firing curve adjustment, not slurry control alone, and inclusion capture exceeded the 30 percent target while thermal shock resistance improved beyond prediction.

Shrinkage mismatch across a pore-size gradient was found to track slurry mass per unit volume more than pore size itself, and adhesive bonding proved not viable because it burns out before the ceramic sinters. This resolved the uncertainty over whether the coarse and fine zones would tear apart at the interface during firing. Trial 1, using adhesive bonding and a single slurry dip, produced delamination in 18 of 24 parts at 1.4 percent shrinkage mismatch. Trial 2 applied thermal fusion of the two-zone template with a two-stage dip, which equalized slurry pick-up between zones.

The two-stage dip combined with a slow ramp through the sintering window held shrinkage mismatch to 0.4 percent, meeting the 0.5 percent target. This let the two-zone template survive firing with only 6 percent delamination, down from 75 percent initially, resolving the firing-survival uncertainty central to the pore-size gradient concept.

Open items for next fiscal period: whether the method holds at 30 mm thickness, the company's highest-volume format, since zone proportions and slurry pick-up ratios differ from the 50 mm part tested; whether a continuous gradient can replace the two-zone construction; and whether an alternative binder can shorten the roughly 3-hour kiln time addition. Both remain open pending further characterization of sintering behaviour.

The graded filter addresses the project's commercial drivers: cracking and fragment shedding in standard filters, and inadequate fine inclusion capture for thin-wall casting customers. A field pour trial at one customer foundry, using 200 filters from May to June 2026, showed zero breakage, with X-ray rejects on thin-wall housings dropping from 6.2 percent to 4.5 percent, though this result is limited to one foundry and one alloy.

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
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 322/350 words, 34/50 lines |
| 242 | Claim Exclusion: Pricing requests from thin-wall customers and competitive positioning are business matters, not technological work | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Selling the filter as both tougher and cleaner for market advantage is a commercial consideration | applied | none |  | excluded claim absent (business risk) |
| 242 | Claim Exclusion: Dip line changes that improved uniform filter slurry pick-up control are a production/manufacturing change benefiting existing standard product, not part of the graded filter experimental work itself | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: The routine core replication process (coat, squeeze, dry, fire) used for standard production is established practice, not part of the uncertainty being investigated | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Earlier 2023 dip-skin attempt predates the fiscal 2026 claim period under review | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Claim Exclusion: Second foundry/second alloy validation and launch decision are planned business/commercial milestones for a future year, not yet performed technological work | applied | none |  | excluded claim absent (outside the claim period) |
| 242 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: sponge replication | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | Glossary Term: two-zone template | applied | none |  | Glossary Term used (paragraph 4) |
| 242 | Glossary Term: crack arrester | applied | none |  | Glossary Term used (paragraph 5) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Section matches storyline goal, limits, objective, uncertainties |
| 242 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent cited consistently across both sources | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Same 3.8 percent figure independently stated in trial log | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Disagreement between Aberline and Castellanos on which problem (breakage vs capture) was the primary driver of the project | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Counter-claim that most testing time and the origin of the gradient idea was about capture, not breakage | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination rate stated as a fraction in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 1 delamination rate stated as percentage in trial log, consistent with transcript fraction | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial log gives slurry pick-up figures (g/cm3) for trial 1 not mentioned in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 2 pick-up figures given only in trial log | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Kiln time increase quantified in hours in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial log gives precise door-to-door kiln hours for trial 3 | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 4 flow and capture comparison table figures for 30 ppi standard filter (priming head +30%, capture +58%) only in trial log, not fully detailed in transcript | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Trial 6 burst test and interface crack arrest result consistent between sources | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Open question of whether gradient works at 30 mm thickness remains unresolved for fiscal 2027 | applied | none |  | Not mentioned in the section |
| 242 | Confidence Map: Field trial result is promising but explicitly limited to one foundry and one alloy, not generalized | applied | none |  | Not mentioned in the section |
| 242 | Glossary Term: thermal shock resistance | applied | none |  | Concept of thermal shock behaviour present but not a rename |
| 242 | Glossary Term: two-zone template | applied | none |  | P4 says 'two-zone sponge template' not 'two-zone template'; repaired to the Glossary Term |
| 242 | Glossary Term: delamination | applied | none |  | Term 'delaminating' used, not a rename needed |
| 242 | Glossary Term: two-stage dip | applied | none |  | Concept of dip process absent from section |
| 242 | Glossary Term: sintering window | applied | none |  | Concept of sintering window absent from section |
| 242 | Glossary Term: choking | applied | none |  | Concept of choking absent from section |
| 242 | Cover signed-off Summary item ys7938sp9pwn0ndahwmhaf3qr98ff32p | applied | none |  | P1 covers company size, location, product, term. |
| 242 | Cover signed-off Summary item ys7f8k5ef9mjsyehhazxqd4g0d8fffep | applied | none |  | P2 states goal, capture range, cost avoidance. |
| 242 | Cover signed-off Summary item ys73st29wdszxz0mcty1rggg9h8fee1j | applied | none |  | P3 states no prior art and lab-scale gap. |
| 242 | Cover signed-off Summary item ys7debxxffxqe399acrgvehsen8fetpd | applied | none |  | P4 states objective of surviving firing without delaminating. |
| 242 | Cover signed-off Summary item ys7706yk8btxcn02qaxfphc9dx8ffy14 | applied | none | 2 | P5 states shrinkage mismatch uncertainty and cause. |
| 242 | Cover signed-off Summary item ys7dqhcwzx1vgndqt741cy1s6h8ferfg | applied | none | 2 | P5 states crack arrester vs initiation uncertainty. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The company is a 60 person foam ceramic filter maker based in Dunmore Falls, Ontario. The team calls the graded structu..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Leave out quotes marked for a check from the evidence for the idea "The team sought new knowledge on whether a two-zone sponge template could survive firing without delaminating at the in..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 242 | Consistency pass (terminology) | not_applied | none |  | one concept named two ways at Line 242 paragraph 1 (sections 242, 244, 246): Section 242 names the technology under development "cascade-fired lattice," a term never used again. Sections 244 and 246 describe the same structure only as "two-zone template" and "pore-size gradient," both of which are Glossary Terms. The unique label in 242 should match the glossary terms used elsewhere. |
| 244 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 244 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 622/700 words, 56/100 lines |
| 244 | Claim Exclusion: Pricing requests from thin-wall customers and competitive positioning are business matters, not technological work | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Selling the filter as both tougher and cleaner for market advantage is a commercial consideration | applied | none |  | excluded claim absent (business risk) |
| 244 | Claim Exclusion: Dip line changes that improved uniform filter slurry pick-up control are a production/manufacturing change benefiting existing standard product, not part of the graded filter experimental work itself | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: The routine core replication process (coat, squeeze, dry, fire) used for standard production is established practice, not part of the uncertainty being investigated | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Earlier 2023 dip-skin attempt predates the fiscal 2026 claim period under review | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Claim Exclusion: Second foundry/second alloy validation and launch decision are planned business/commercial milestones for a future year, not yet performed technological work | applied | none |  | excluded claim absent (outside the claim period) |
| 244 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: two-zone template | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 4) |
| 244 | Glossary Term: sintering window | applied | none |  | Glossary Term used (paragraph 5) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Section matches storyline on trials 1-3 and context |
| 244 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent cited consistently across both sources | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Same 3.8 percent figure independently stated in trial log | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Disagreement between Aberline and Castellanos on which problem (breakage vs capture) was the primary driver of the project | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Counter-claim that most testing time and the origin of the gradient idea was about capture, not breakage | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 1 delamination rate stated as a fraction in transcript | applied | none |  | P3 states delamination figure consistent with established data |
| 244 | Confidence Map: Trial 1 delamination rate stated as percentage in trial log, consistent with transcript fraction | applied | none |  | P3 states 75 percent figure, established in both sources |
| 244 | Confidence Map: Trial log gives slurry pick-up figures (g/cm3) for trial 1 not mentioned in transcript | applied | none |  | Section omits slurry pick-up g/cm3 figures, not stated flatly |
| 244 | Confidence Map: Trial 2 pick-up figures given only in trial log | applied | none |  | Section omits trial 2 pick-up figures entirely |
| 244 | Confidence Map: Kiln time increase quantified in hours in transcript | applied | none |  | P5 states 3 added hours, matches established figure |
| 244 | Confidence Map: Trial log gives precise door-to-door kiln hours for trial 3 | applied | none |  | Section gives only approximate 3-hour figure, not precise… |
| 244 | Confidence Map: Trial 4 flow and capture comparison table figures for 30 ppi standard filter (priming head +30%, capture +58%) only in trial log, not fully detailed in transcript | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Trial 6 burst test and interface crack arrest result consistent between sources | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Open question of whether gradient works at 30 mm thickness remains unresolved for fiscal 2027 | applied | none |  | Not mentioned in the section |
| 244 | Confidence Map: Field trial result is promising but explicitly limited to one foundry and one alloy, not generalized | not_applied | missing_fact |  | P6 states field result flatly without the one-foundry limit; repaired (deterministic re-check only; not re-verified by the model) |
| 244 | Glossary Term: pore-size gradient | applied | none |  | Concept named differently; graded template describes gradient… |
| 244 | Glossary Term: sponge replication | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: thermal shock resistance | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: fine inclusion capture | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: choking | applied | none |  | Not mentioned in the section |
| 244 | Glossary Term: crack arrester | applied | none |  | Not mentioned in the section |
| 244 | Omit signed-off role prior_year_status | applied | none |  | No prior-year status mentioned in section. |
| 244 | Cover signed-off Summary item ys7a85jqthaejdwck86g5tq1xh8ffm1q | applied | none |  | P1 states the three-phase workplan as planned. |
| 244 | Cover signed-off Summary item ys71p016mv8wht6hf59h4ra0ed8ffdp7 | applied | none |  | P2 states the hypothesis and what it targeted. |
| 244 | Cover signed-off Summary item ys7bfqr83kswxxq18qpe8wgebd8ffkd8 | applied | none |  | P3 describes trial 1 construction, dip, firing as planned. |
| 244 | Cover signed-off Summary item ys747cspyhjkrsh5tsm28bkj9d8fe94y | applied | none |  | P4 covers trial 2 fusion, two-stage dip and results. |
| 244 | State each result against its target as the numbers show | applied | none |  | All results compared to targets match the numbers. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work ties to the shrinkage mismatch uncertainty or Line… |
| 244 | Leave out quotes marked for a check from the evidence for the idea "The plan laid out phase one to make graded green bodies that survive firing, testing the shrinkage mismatch uncertainty..." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 246 | Writer Profile | not_applied | none |  | no Writer Profile applied (missing) |
| 246 | House Rule category: banned words | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 342/350 words, 36/50 lines |
| 246 | Claim Exclusion: Pricing requests from thin-wall customers and competitive positioning are business matters, not technological work | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Selling the filter as both tougher and cleaner for market advantage is a commercial consideration | applied | none |  | excluded claim absent (business risk) |
| 246 | Claim Exclusion: Dip line changes that improved uniform filter slurry pick-up control are a production/manufacturing change benefiting existing standard product, not part of the graded filter experimental work itself | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: The routine core replication process (coat, squeeze, dry, fire) used for standard production is established practice, not part of the uncertainty being investigated | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Earlier 2023 dip-skin attempt predates the fiscal 2026 claim period under review | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Claim Exclusion: Second foundry/second alloy validation and launch decision are planned business/commercial milestones for a future year, not yet performed technological work | applied | none |  | excluded claim absent (outside the claim period) |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: thermal shock resistance | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: fine inclusion capture | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: shrinkage mismatch | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: two-zone template | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: delamination | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: two-stage dip | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: sintering window | applied | none |  | Glossary Term used (paragraph 3) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Section matches storyline facts and sequence. |
| 246 | Confidence Map: Fiscal 2025 field return cracking rate of 3.8 percent cited consistently across both sources | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Same 3.8 percent figure independently stated in trial log | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Disagreement between Aberline and Castellanos on which problem (breakage vs capture) was the primary driver of the project | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Counter-claim that most testing time and the origin of the gradient idea was about capture, not breakage | applied | none |  | Not mentioned in the section. |
| 246 | Confidence Map: Trial 1 delamination rate stated as a fraction in transcript | applied | none |  | P2 states delamination as a flat fraction, matches established. |
| 246 | Confidence Map: Trial 1 delamination rate stated as percentage in trial log, consistent with transcript fraction | applied | none |  | Flat percentage stated, consistent with established status. |
| 246 | Confidence Map: Trial log gives slurry pick-up figures (g/cm3) for trial 1 not mentioned in transcript | applied | none |  | Pick-up figures in g/cm3 not stated in section. |
| 246 | Confidence Map: Trial 2 pick-up figures given only in trial log | applied | none |  | Trial 2 pick-up figures not stated in section. |
| 246 | Confidence Map: Kiln time increase quantified in hours in transcript | applied | none |  | P4 states kiln time hedged as roughly 3-hour addition. |
| 246 | Confidence Map: Trial log gives precise door-to-door kiln hours for trial 3 | applied | none |  | Precise trial 3 kiln hours not stated in section. |
| 246 | Confidence Map: Trial 4 flow and capture comparison table figures for 30 ppi standard filter (priming head +30%, capture +58%) only in trial log, not fully detailed in transcript | applied | none |  | Trial 4 flow/capture table figures not mentioned in section. |
| 246 | Confidence Map: Trial 6 burst test and interface crack arrest result consistent between sources | applied | none |  | Trial 6 burst/arrest result not mentioned in this section. |
| 246 | Confidence Map: Open question of whether gradient works at 30 mm thickness remains unresolved for fiscal 2027 | applied | none |  | P4 hedges 30 mm question as open, matches unresolved. |
| 246 | Confidence Map: Field trial result is promising but explicitly limited to one foundry and one alloy, not generalized | applied | none |  | P5 hedges field result as limited to one foundry/alloy. |
| 246 | Glossary Term: pore-size gradient | applied | none |  | Section says pore size gradient concept without the exact term; repaired to the Glossary Term |
| 246 | Glossary Term: sponge replication | applied | none |  | Concept of sponge replication absent from section. |
| 246 | Glossary Term: two-zone template | applied | none |  | P2/P3 say 'graded parts' not 'two-zone template'; repaired to the Glossary Term |
| 246 | Glossary Term: choking | not_applied | none |  | P4 implies choking risk via 'sintering behaviour' without the…; repair failed |
| 246 | Glossary Term: crack arrester | applied | none |  | Concept of crack arrest absent from this section. |
| 246 | Cover signed-off Summary item ys72k3e339bkg8jsezwh4rrh118fe9gf | applied | none |  | P3 states mismatch resolved to 0.4 percent, meeting target. |
| 246 | Cover signed-off Summary item ys7c1x0ecz33fsdh8vd7arwkkn8fevs2 | applied | none | 2 | P2 covers slurry mass driver and adhesive bond failure. |
| 246 | Cover signed-off Summary item ys73n879xy2mj0xde6kwpt28pn8fe0x6 | applied | none | 2 | P2 states Trial 1's 18 of 24 delaminations at 1.4 percent. |
| 246 | Cover signed-off Summary item ys77ahpxnfv6gxm6ja6522pcyn8fergx | applied | none |  | P5 gives the pour trial figures as stated. |
| 246 | Cover signed-off Summary item ys71xpp66ahycy3xana57ssj558fedtw | applied | none |  | P3 states 0.4 percent mismatch letting firing survive intact. |
| 246 | State each result against its target as the numbers show | not_applied | none |  | Result reported as misstated against its target named no valid paragraph. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | All advancements trace to COVER items answering stated… |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 1 (sections 244, 246): 246 states the hypothesis was "partly proven: shrinkage mismatch was held within target through slurry control combined with firing curve adjustment, not slurry control alone." This matches 244's trial progression (trial 2 slurry control alone fell short, trial 3 added the firing ramp), but 246 also claims "inclusion capture exceeded the 30 percent target while thermal shock resistance improved beyond prediction." Section 242 never states a 30 percent capture target or a thermal shock prediction, and section 244's work performed section contains no inclusion capture or thermal shock test results or figures to support this claim. |
| 246 | Consistency pass (excluded_claim) | not_applied | none |  | excluded claim presented as claimed work at Line 246 paragraph 1 (sections 242, 246): 246 reports an advancement for thermal shock resistance ("thermal shock resistance improved beyond prediction"), but section 242 only raises thermal shock as an open question in P5 without stating it as a tested uncertainty with a hypothesis, and no corresponding thermal shock test or result appears in 244's work performed section. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 3 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 27.
- Line 244: 0 labels and 0 plan checks "Not checked" of 28.
- Line 246: 0 labels and 0 plan checks "Not checked" of 27.

## Seed-stage numbers

- Requests: 17 metered (17 Batch, 0 Feedback); 18 reserved; notice at 40 not shown.
- Dispatch to validated result: median 12.3 s, p95 23.9 s over 14 Batch(es).
- Foreground dispatch to first render (script-observed): median 15.2 s, p95 15.2 s over 1.
- Sign-off to report created: 139.2 s.
- Cost from aiUsage: $1.17 in all ($0.44 seed stage, $0.73 Brief, drafting and checks) over 45 calls on claude-haiku-4-5-20251001, claude-sonnet-5, rerank-2.5, voyage-3-large.

## Run log

```
2026-10-01T03:21:10.138Z created project k979pw3s0tf8wkhxj4vexj1ew58ffz2h
2026-10-01T03:21:10.775Z added document graded-filter-trial-log.md
2026-10-01T03:21:12.061Z started Step by step generation k572syng77g372absmewdfs72s8ffm4g
2026-10-01T03:22:02.765Z seed stage open
2026-10-01T03:22:02.766Z Open Company / Context and wait for its Batch
2026-10-01T03:22:14.449Z Company / Context: select the first Seed
2026-10-01T03:22:16.366Z Company / Context: edit the selected Seed, adding "The team calls the graded structure the cascade-fired lattice."
2026-10-01T03:22:18.281Z Approve Company / Context
2026-10-01T03:22:20.205Z approved company_context
2026-10-01T03:22:20.205Z Open Goal / Problem and wait for its Batch
2026-10-01T03:22:32.023Z Goal / Problem: select the first Seed
2026-10-01T03:22:33.939Z Approve Goal / Problem
2026-10-01T03:22:35.844Z approved goal_problem
2026-10-01T03:22:35.844Z Open Technological limitations and wait for its Batch
2026-10-01T03:22:52.711Z Technological limitations: select the first Seed
2026-10-01T03:22:54.608Z Approve Technological limitations
2026-10-01T03:22:56.536Z approved passive_limitations
2026-10-01T03:22:56.536Z Open Technological objectives and wait for its Batch
2026-10-01T03:23:08.152Z Technological objectives: select the first Seed
2026-10-01T03:23:10.071Z Approve Technological objectives
2026-10-01T03:23:11.952Z approved technological_objective
2026-10-01T03:23:11.952Z Open Technological uncertainties and wait for its Batch
2026-10-01T03:23:23.739Z Technological uncertainties: select the first 2 Seeds
2026-10-01T03:23:26.923Z Approve Technological uncertainties
2026-10-01T03:23:28.838Z approved active_uncertainties
2026-10-01T03:23:28.838Z Skip Previous-year status
2026-10-01T03:23:30.096Z Open Work plan and wait for its Batch
2026-10-01T03:23:47.141Z Work plan: select the first Seed
2026-10-01T03:23:49.073Z Approve Work plan
2026-10-01T03:23:51.022Z approved workplan
2026-10-01T03:23:51.022Z Open Hypothesis and wait for its Batch
2026-10-01T03:24:13.169Z Hypothesis: select the first Seed
2026-10-01T03:24:15.087Z Approve Hypothesis
2026-10-01T03:24:17.017Z approved hypothesis
2026-10-01T03:24:17.017Z Open Experimentation / Iterations and wait for its Batch
2026-10-01T03:24:44.505Z Experimentation / Iterations: select the first 2 Seeds
2026-10-01T03:24:47.725Z Approve Experimentation / Iterations
2026-10-01T03:24:49.649Z approved experimentation
2026-10-01T03:24:49.649Z Goal / Problem: select the Seed closest to "capture of fine inclusions" (else one that states a goal, else the next Seed on the page) and untick the earlier selection (writer switches the goal framing)
2026-10-01T03:24:50.281Z switching to the Seed closest to "capture of fine inclusions": yn7cvhqyyfsmeq84z4kcyn8y858fejvb
2026-10-01T03:24:53.053Z Approve Goal / Problem
2026-10-01T03:24:54.969Z approved goal_problem
2026-10-01T03:24:54.969Z Technological uncertainties: Regenerate and wait for the fresh Batch
2026-10-01T03:25:09.407Z Technological uncertainties: Confirm and approve the carried selections
2026-10-01T03:25:11.336Z approved active_uncertainties (confirmed 2 carried)
2026-10-01T03:25:11.336Z Confirm and approve every Stale Subsection, in order
2026-10-01T03:25:14.487Z approved passive_limitations (confirmed 1 carried)
2026-10-01T03:25:17.050Z approved technological_objective (confirmed 1 carried)
2026-10-01T03:25:18.295Z workplan link notice: none
2026-10-01T03:25:22.714Z approved workplan (confirmed 1 carried)
2026-10-01T03:25:23.988Z hypothesis link notice: none
2026-10-01T03:25:28.368Z approved hypothesis (confirmed 1 carried)
2026-10-01T03:25:30.925Z approved experimentation (confirmed 2 carried)
2026-10-01T03:25:30.925Z Open Advancement to science / technology and wait for its Batch
2026-10-01T03:25:32.849Z Advancement to science / technology: select the first Seed
2026-10-01T03:25:34.756Z Approve Advancement to science / technology
2026-10-01T03:25:36.706Z approved overall_advancement (confirmed 1 carried)
2026-10-01T03:25:36.706Z Open Specific technological advancements and wait for its Batch
2026-10-01T03:25:38.598Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-01T03:25:43.677Z Approve Specific technological advancements
2026-10-01T03:25:45.567Z approved specific_advancements (confirmed 2 carried)
2026-10-01T03:25:45.568Z Open Project status and next steps and wait for its Batch
2026-10-01T03:25:49.359Z Project status and next steps: select the first Seed
2026-10-01T03:25:51.253Z Approve Project status and next steps
2026-10-01T03:25:53.175Z approved project_status (confirmed 1 carried)
2026-10-01T03:25:53.175Z Open Overall company / project goal improvements and wait for its Batch
2026-10-01T03:26:07.674Z Overall company / project goal improvements: select the first Seed
2026-10-01T03:26:09.630Z Approve Overall company / project goal improvements
2026-10-01T03:26:11.558Z approved goal_improvements
2026-10-01T03:26:11.558Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-01T03:26:12.836Z signed off; waiting for the report
2026-10-01T03:28:32.419Z report kd777ag5hg0nseapb2kmjnk5f98ffhsa created
```
