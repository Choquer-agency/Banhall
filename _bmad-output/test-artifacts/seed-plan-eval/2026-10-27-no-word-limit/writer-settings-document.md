# Release eval - Velloway low-temperature powder on MDF

Semantic case: **Writer settings document** (owner decision 2026-10-02, alert 7: "a writer's settings document in Writer's Notes is followed"). Also checks: the Compliance Note rows show what the product believed it applied from the settings document.

Run 2026-10-27 on `local` at commit `df6eb97b`, acting as chat-live-1793085355051@example.test. Project `k973et6h6wj1an053aseshx62h8h3f3f`, generation `k57dq8sqgx1v6q5g72s0em1rx18h3t2a`.

## What this fixture tests

Before the first draft the writer uploads a "PD Writing Customized Settings" document in Writer's Notes, by the internal account the suite acts as, so it has internal trust and the product applies it as the Writer Profile for the generation. It sets checkable rules: five required terms for named variables (each with synonyms it bans), seven banned words and phrases, required openings for the objective and uncertainty statements in Line 242, a word cap per Line below the CRA cap, two pieces of work that must not be claimed or described, and no first person. The interview and the trial summary use the synonyms, the banned words and the first person, and the president asks to claim the excluded work. The writer takes the plainest Step by step path: the first Seed on each step (two uncertainties and two experiments, linked advancements), Previous-year status skipped (a first-year project), approve, sign off. The automatic checks count, per Line and overall, the settings rules the draft broke, so the score can be tracked and improved.

Fixture notes:

- 2026-10-02: added after alert 7 on the /alerts board (1 September). A writer uploaded a detailed PD Writing Customized Settings document before the first draft, chat listed 16 places where the draft deviated, and the second draft still deviated after a bulk revision. The owner chose a sixth fixture that measures how well a draft follows a writer's settings document, scored automatically.
- The settings document is uploaded as Writer's Notes (category writer_notes) by the reviewer account the suite acts as. That account has an internal role, so documentTrust gives it internal trust, and its first line matches the settings title the product detects. Its word caps are written so the product's own rule extraction reads them; the fixture check proves both.
- The scripted writer makes no decision of its own: the first Seed on each step, approve, sign off. Previous-year status is skipped because the project started in July 2025. So the fixture measures the settings document, not the writer's choices.
- Automatic checks added for this fixture: the settings document was applied as the Writer Profile; each required term is used and its synonyms are absent; no banned word or phrase; the required openings; each Line within its settings word cap; no excluded work mentioned (a heuristic); no first person; settings rules broken, N of M, per Line and overall; and the Compliance Note rows that mention the settings document or the Writer Profile. The pack also lists every settings rule per Line. No earlier check was removed or weakened.
- Review fixes (2026-10-02, lead review, Claude Opus 5.5): one matcher for every term, synonym, banned phrase and exclusion marker. It matches whole words in any case, a space or a hyphen between words, and the last word singular or with s or es, so "DFTs", "substrate temperatures", "edge-wrap" and "dry-film thickness" are breaks and "outgassing defect rate" uses "outgassing defects". Every scored synonym is one the settings document names.
- The settings document says never to write pinholes, pinholing, blisters or blistering on their own, so one of them in a sentence that also says outgassing defects is not a break (allowedWithTerm). A banned word counts only in the forms listed: "break-through" is the MEK test term ("no break-through to the board"), not "breakthrough", and "successful" and "unsuccessfully" are not counted as forms of "successfully". The judges decide whether such a word breaks the rule.
- Known limitation (2026-10-05, amendment 2026-10-04 first, Round 4): the datasheet steel error recurs in all five runs of this fixture. The analysis step merges "Normal powder for steel cures at 160 to 200 C" into the datasheet claim, and the Technological limitations Seed says the datasheets were developed for flat steel (run 3: "flat steel or thin panels") while quoting the steel sentence, so the word-level quote checks see support. The sources say only that the datasheet number is for flat panels. Follow-up for the owner to decide: a meaning-level check of each Seed claim against its own quote.
- Greptile on PR #27 (2026-10-05): the document bans "optimize" in any form, and the matcher counts only the listed forms plus an s or es ending, so "optimize" lists every form of the word: optimise, optimized, optimised, optimizing, optimising, optimization, optimisation, optimizer, optimiser, optimizable and optimisable (with s or es, so optimizers and optimizations count too). "Optimal" and "optimum" are other words, not forms of it. The other banned entries have no other forms the matcher misses ("trial-and-error" and "industry leading" match through the hyphen or space rule), and the choice above about "successful" and "break-through" stands.
- The word caps are 260, 520 and 260 words, below the default draft targets of about 297, 595 and 297, so a Line within its cap shows the settings cap was applied. A required opening is not counted where the org enforces the House Rule opening clauses. The summary line says how many broken rules come from the exclusion heuristic.
- 2026-10-04 (first amendment): the run at e0fd7892 was judged fail for the word caps, the Compliance Note rows that called them met, and Seeds that used the banned synonyms. Drafting, repair and shortening now aim under the settings caps, no Self-check row may vouch for a cap code measured, and Seeds use the settings terms. New automatic check: no Self-check row says the settings document was followed while a measured cap of its Line was not met (settings-rows-honest). No earlier check was removed or weakened.

## Judgment (reviewing manager)

Read the plan and the drafted Sections below, then answer each question and give one verdict. Every fixture must be judged pass before release.

1. Does each Line follow the settings document (pd-writing-customized-settings.md): its required terms, banned words and phrases, the two required openings in Line 242, its word cap, its claim exclusion list and the no first person rule? Name each break you find.
   - Answer: 
2. Where the automatic checks count a settings rule as broken, is it a real break or a sensible exception (for example a defined term explained once in the client's words, or a Locked Rule or org-enforced House Rule that outranks the settings document)?
   - Answer: 
3. Is any work the settings document excludes (the powder booth extraction upgrade, colour matching of the customer's catalogue shades) claimed or described in any Line?
   - Answer: 
4. Do the Compliance Note rows say plainly that the settings document was applied, and do their verdicts match what the Lines actually do?
   - Answer: 
5. Does every drafted Section read as a finished PD in plain language, with no Subsection titles used as headings?
   - Answer: 

- Verdict (pass or fail): 
- Judged by: 
- Date: 
- Notes: 

## Automatic checks

16 passed, 0 failed. A heuristic check is a hint for the judge, not a verdict.

| Check | Result | Evidence |
| --- | --- | --- |
| The scripted session finished without an error | pass | every step ran |
| Sign-off led to a created report through the existing creation path | pass | generation completed; report kd7b1j0sg0xcbja3tp43c7pzvn8h3n0e |
| All three Sections were drafted | pass | 242: 213 words, 244: 442 words, 246: 236 words |
| The Compliance Note lists every Seed Selection as covered or not | pass | 15 of 15 plan items have a coverage row |
| Every plan item is recorded as covered (conflicts aside) | pass | all coverage rows applied |
| The model Self-check ran on every Section | pass | no Self-check failure recorded |
| Every Locked Rule held (CRA line and word limits) | pass | no Locked Rule breach recorded |
| The Compliance Note lists every Skip as honoured or not | pass | prior_year_status: applied |
| Failed Seed Batches and why (informational) | info | prior_year_status prefetch: GENERATION_TERMINATED |
| Line 246 LEAVE OUT and Rule B rows, their repairs, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule B: applied; COVER rows not applied after such a repair: none |
| Line 244 Rule C row (its work answers a Line 242 uncertainty or a signed-off item), its repair, and COVER rows not applied after such a repair (informational; self-reported by the checking model) | info | Rule C: applied ("All work ties to stated uncertainties."); COVER rows not applied after such a repair: none |
| Report text that names a source, per Line, and the Self-check's row (informational; the Self-check's own detector) | info | 242: none (row applied); 244: none (row applied); 246: none (row applied) |
| Results stated against their targets, Lines 244 and 246 (informational; self-reported by the checking model) | info | 244: applied ("The targets check found no result it could show is stated against its target differently from the..."); 246: applied ("The targets check found no result it could show is stated against its target differently from the...") |
| Figures and details stated as the sources give them, per Line (informational; self-reported by the checking model) | info | 242: applied ("The facts check found no figure or detail it could show differs from the sources."); 244: not_applied ("P3 says "Trial 2 kept the preheat and lowered oven air to 125 C, then raised it to 127 C.", but the sources say "We lowered the oven air to 125 C and stretch..."); 246: applied ("The facts check found no figure or detail it could show differs from the sources.") |
| Self-check requests per Line and their times (informational; the last is the check of the final text when a repair was used) | info | 242: 1 request (6.5 s); 244: 2 requests (9.1 s, 7.3 s); 246: 2 requests (6.3 s, 6.3 s) |
| Seed-stage requests (informational; notice at 40, never refused) | info | 15 metered calls (15 Batch, 0 Feedback), 16 reserved; notice not shown; 0 Retry |
| The settings document in Writer's Notes was detected and applied as the Writer Profile | pass | source writer_notes (pd-writing-customized-settings.md), profile applied, waiver analysis analyzed, House Rule categories it addresses: bannedWords, openingClauses, reportSkeleton; Writer Profile rows: 242 applied ("Writer Profile applied"), 244 applied ("Writer Profile applied"), 246 applied ("Writer Profile applied"); House Rule outcomes: opening clauses not_applied, org_enforced ("House Rule waived for everyone (org mode off)") in 242, 244, 246; repetition caps applied, none ("House Rule applied (no Writer Profile waiver)") in 242, 244, 246 |
| Each required term from the settings document is used, and none of its synonyms appears in any Line | pass | 242: none broken. 244: none broken. 246: none broken |
| No banned word or phrase from the settings document appears in any Line | pass | 242: none broken. 244: none broken. 246: none broken |
| Heuristic: each required opening from the settings document starts a sentence in its Line (none doing so is a certain break; which sentence is the named statement is for the judge) | pass | 242: opening "The aim of this work was to" (objective) kept, opens P2 (heuristic: 1 sentence opens with these words; the judge checks it is the objective statement); opening "It was not known at the outset whether" (uncertainty) kept, opens P3 (heuristic: 1 sentence opens with these words; the judge checks it is the uncertainty statement) |
| Each Line is within the settings document's word cap (below the CRA cap) | pass | 242: word cap Line 242 kept, 213 of 260 words. 244: word cap Line 244 kept, 442 of 520 words. 246: word cap Line 246 kept, 236 of 260 words |
| Heuristic: no Line mentions work the settings document excludes from the claim | pass | 242: none broken. 244: none broken. 246: none broken |
| No Line uses the first person, as the settings document's style rule asks | pass | 242: none broken. 244: none broken. 246: none broken |
| Settings rules broken, per Line and overall (informational; the pack lists every rule per Line) | info | settings rules broken: Line 242: 0 of 18; Line 244: 0 of 16; Line 246: 0 of 16; overall: 0 of 20 |
| Compliance Note rows that mention the settings document or the Writer Profile, per Line (what the product believed it applied; informational) | info | 242: "Writer Profile" applied: "Writer Profile applied", "House Rule category: banned words" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "House Rule category: report skeleton" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "- Line 242: no more than 260 words." applied: "213/260 words", "# PD Writing Customized Settings Velloway Panel Finishing Ltd., low..." applied: "Openers, terms and exclusions followed.", 3 House Rule categories applied with no Writer Profile waiver; 244: "Writer Profile" applied: "Writer Profile applied", "House Rule category: banned words" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "House Rule category: report skeleton" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "- Line 244: no more than 520 words." applied: "442/520 words", "# PD Writing Customized Settings Velloway Panel Finishing Ltd., low..." applied: "Terms, bans and style are followed.", 3 House Rule categories applied with no Writer Profile waiver; 246: "Writer Profile" applied: "Writer Profile applied", "House Rule category: banned words" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "House Rule category: report skeleton" not_applied: "instruction waived via override: the Writer Profile waives this House Rule", "- Line 246: no more than 260 words." applied: "236/260 words", "# PD Writing Customized Settings Velloway Panel Finishing Ltd., low..." applied, repaired: "Terms, banned words and exclusions followed.; repaired, and checked again on the final text", 3 House Rule categories applied with no Writer Profile waiver |
| No Self-check row says the settings document was followed while a measured cap of its Line was not met | pass | 242: measured caps met; settings document row applied: "Openers, terms and exclusions followed."; 244: measured caps met; settings document row applied: "Terms, bans and style are followed."; 246: measured caps met; settings document row applied: "Terms, banned words and exclusions followed.; repaired, and checked again on the final text" |

## Settings document rules, per Line

Every explicit rule of the writer's settings document, checked on the drafted Lines. Settings rules broken: Line 242: 0 of 18; Line 244: 0 of 16; Line 246: 0 of 16; overall: 0 of 20. The exclusion rows are a heuristic: a marker in a Line counts as a mention. A kept opening row is a heuristic too: a sentence that opens with the words counts, and its count is shown.

| Rule | Line 242 | Line 244 | Line 246 |
| --- | --- | --- | --- |
| term "film build" | kept: not mentioned | kept: term used | kept: not mentioned |
| term "panel surface temperature" | kept: term used | kept: term used | kept: term used |
| term "cure window" | kept: term used | kept: term used | kept: term used |
| term "edge coverage" | kept: term used | kept: term used | kept: term used |
| term "outgassing defects" | kept: term used | kept: term used | kept: term used |
| banned "successfully" | kept: absent | kept: absent | kept: absent |
| banned "in order to" | kept: absent | kept: absent | kept: absent |
| banned "optimize" | kept: absent | kept: absent | kept: absent |
| banned "proprietary" | kept: absent | kept: absent | kept: absent |
| banned "trial and error" | kept: absent | kept: absent | kept: absent |
| banned "breakthrough" | kept: absent | kept: absent | kept: absent |
| banned "industry-leading" | kept: absent | kept: absent | kept: absent |
| opening "The aim of this work was to" (objective) | kept: opens P2 (heuristic: 1 sentence opens with these words; the judge checks it is the objective statement) | not applicable | not applicable |
| opening "It was not known at the outset whether" (uncertainty) | kept: opens P3 (heuristic: 1 sentence opens with these words; the judge checks it is the uncertainty statement) | not applicable | not applicable |
| word cap Line 242 | kept: 213 of 260 words | not applicable | not applicable |
| word cap Line 244 | not applicable | kept: 442 of 520 words | not applicable |
| word cap Line 246 | not applicable | not applicable | kept: 236 of 260 words |
| exclusion "the powder booth extraction upgrade" | kept: not mentioned | kept: not mentioned | kept: not mentioned |
| exclusion "colour matching of the customer's catalogue shades" | kept: not mentioned | kept: not mentioned | kept: not mentioned |
| style: no first person | kept: none | kept: none | kept: none |

## Signed-off plan

### 1. Company / Context (Section 242, standard): approved

- The company finishes MDF panels for other companies, such as cabinet doors. _(cited)_

### 2. Goal / Problem (Section 242, standard): approved

- The aim of this work was to powder coat 25 mm routed MDF doors for customers. _(cited)_

### 3. Technological limitations (Section 242, standard): approved

- Supplier datasheets for low-temperature powder are written for thin flat panels, not 25 mm routed doors. _(cited)_

### 4. Technological objectives (Section 242, standard): approved

- The aim of this work was to find a heat setting giving conductivity and cure below outgassing onset. _(writer-asserted)_

### 5. Technological uncertainties (Section 242, standard): approved

- It was not known at the outset whether conductivity and full cure could both be reached below outgassing onset. _(writer-asserted)_
- The moisture that gives conductivity is the same moisture that outgasses. / Preheat is heat, so no setting was known to do both. _(writer-asserted)_

### 6. Previous-year status (Section 244, optional): skipped

- Skipped by the writer. The drafter must not cover this role.

### 7. Work plan (Section 244, optional): approved

- The team ran Trial 2 at several dwell times to test whether dwell time controlled outgassing onset. _(cited)_

### 8. Hypothesis (Section 244, standard): approved

- If an edge sealer replaces preheat, then edge coverage reaches 60 microns below outgassing onset. _(cited)_

### 9. Experimentation / Iterations (Section 244, multiple): approved

- Trial 1 followed the supplier datasheet and reached 131 C at the surface. _(cited)_
  - Tested: uncertainty "It was not known at the outset whether conductivity and full cure c..."
- Trial 2 ran several dwell times, and outgassing onset did not move with them. / Peak temperature, not dwell time, was the controlling variable. _(cited)_
  - Tested: uncertainty "The moisture that gives conductivity is the same moisture that outg..."

### 10. Advancement to science / technology (Section 246, standard): approved

- Outgassing defects start at a panel surface temperature of about 118 to 122 C whatever the dwell time. _(cited)_

### 11. Specific technological advancements (Section 246, multiple): approved

- Outgassing onset did not move across the dwell times tried in Trial 2. _(cited)_
  - Links: uncertainty "The moisture that gives conductivity is the same moisture that outg..."; experiments "Trial 2 ran several dwell times, and outgassing onset did not move ..."
- Outgassing defects start at a panel surface temperature of about 118 to 122 C at every dwell time tried. _(cited)_
  - Links: uncertainty "The moisture that gives conductivity is the same moisture that outg..."; experiments "Trial 2 ran several dwell times, and outgassing onset did not move ..."

### 12. Project status and next steps (Section 246, standard): approved

- The shaker doors are ready for production. _(cited)_

### 13. Overall company / project goal improvements (Section 246, standard): approved

- Outgassing defects start at a panel surface temperature of about 118 to 122 C at every dwell time tried. _(cited)_

## Drafted Sections

### Line 242

The company finishes MDF panels for other companies, such as cabinet doors, and had run no powder panels before July 2025. Supplier datasheets for low-temperature powder are written for thin flat panels, not 25 mm routed doors. Making the board conductive enough for powder to stick and curing the powder both rely on heat, and heat drives moisture and resin vapour out of the MDF as outgassing defects. The moisture that gives conductivity is the same moisture that outgasses.

The aim of this work was to powder coat 25 mm routed MDF doors for customers, by finding a heat setting that gave conductivity and cure below the outgassing onset. Targets were edge coverage of at least 60 microns, at most 1 outgassing defect per square metre, a panel surface temperature of 120 C or less, a cure window at least 8 C wide, and a line speed of 2.5 m per minute.

It was not known at the outset whether conductivity and full cure could both be reached below outgassing onset. Preheat is heat, so no setting was known to do both. It also remained uncertain whether any low-temperature powder could cure there with a usable cure window, and whether the deep cove profile could reach the same edge coverage as the faces.

### Line 244

The company ran five trials from August 2025 to June 2026, logging panel surface temperature with thermocouples on every test panel and changing one variable at a time. The hypothesis was that if an edge sealer replaces preheat, then edge coverage reaches 60 microns below outgassing onset.

Trial 1 followed the supplier datasheet: infrared preheat to 110 C, a standard low-temperature powder and 10 minutes in a 135 C convection oven. Panel surface temperature reached 131 C. Outgassing defects averaged 14 per square metre overall and 30 per square metre on the routed edges. Edge film build was 35 microns against 82 microns on the faces. Cure measured 55 to 62 MEK rubs. The datasheet process did not transfer to 25 mm routed MDF.

Trial 2 kept the preheat and lowered oven air to 125 C, then raised it to 127 C. The team ran several dwell times to test whether dwell time controlled outgassing onset. Onset did not move with dwell time and stayed at about 118 to 122 C, so peak panel surface temperature, not dwell time, was the controlling variable. At 125 C air, defects were 4 per square metre but cure was only 30 MEK rubs, so the cure window was close to zero.

Trial 3 applied a water-based conductive edge sealer to the routed edges only and cut preheat from 110 C to 85 C. Edge coverage averaged 58 microns (minimum 47) and defects fell to 1.8 per square metre. Overspray on the faces gave 3B adhesion on 12 percent of panels against a 5B target; an edge-only nozzle and a face mask returned it to 5B.

Trial 4 combined the edge sealer with a polyester-epoxy hybrid powder at three catalyst levels. The fastest level cut gel time from 210 s to 95 s at 125 C and reached full cure at 120 C in 9 minutes. The cure window was 113 to 121 C. On 140 panels, edge coverage averaged 64 microns (minimum 52) and defects were 0.6 per square metre.

Trial 5 ran 600 doors on customer orders over three weeks. Defects averaged 0.9 per square metre and MEK passed on 98 percent of panels. The failures all came from one batch when oven zone 3 drifted 6 C low. Shaker doors averaged 0.8 defects per square metre with none below 60 microns edge coverage. On deep cove doors, 13 percent fell below 60 microns. Whether a different sealer, gun angle or cove geometry would bring the cove interior to 60 microns is not yet known. Shaker doors are ready for production; deep cove coverage and oven zone control remain open for fiscal 2027 trials.

### Line 246

The experimental work established that outgassing defects start at a panel surface temperature of about 118 to 122 C on 25 mm routed MDF, at every dwell time tried. Trial 2 ran several dwell times and the onset did not move, so peak panel surface temperature, not dwell time, was the controlling variable. This addressed the conflict stated at the outset: preheat is heat, and the moisture that gives conductivity is the same moisture that outgasses.

The company then separated conductivity from heat. An edge sealer cut preheat from 110 C to 85 C; edge coverage averaged 58 microns and outgassing defects fell to 1.8 per square metre. Fast-catalysed powder, with a gel time of 95 s at 125 C, reached full cure at a panel surface temperature of 120 C in 9 minutes. The cure window, mapped in 1 C steps, was 113 to 121 C, 8 C wide. On 140 panels, edge coverage averaged 64 microns and outgassing defects were 0.6 per square metre, the first time the cure and outgassing targets were met on the same panels. The fastest catalyst level gave orange peel of 5 against a target of 6.

Shaker doors are ready for production. Deep cove edge coverage is only partly met: 13 percent of deep cove panels fell below 60 microns in the pilot, and the cause and remedy are not yet known. Oven zone control also remains open.

## Compliance Note

| Section | Instruction | Outcome | Tier | Merged items | Reason |
| --- | --- | --- | --- | --- | --- |
| 242 | Writer Profile | applied | none |  | Writer Profile applied |
| 242 | Build Order | applied | none |  | Build Order 242 → 244 → 246 |
| 242 | House Rule category: banned words | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 242 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 242 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 242 | House Rule category: report skeleton | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 242 | Locked Rule: Line 242 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 213/350 words, 19/50 lines |
| 242 | - Line 242: no more than 260 words. | applied | none |  | 213/260 words |
| 242 | Writer's term: film build | applied | none |  | no banned synonym of "film build" |
| 242 | Writer's term: panel surface temperature | applied | none |  | "panel surface temperature" used; no banned synonym |
| 242 | Writer's term: cure window | applied | none |  | "cure window" used; no banned synonym |
| 242 | Writer's term: edge coverage | applied | none |  | "edge coverage" used; no banned synonym |
| 242 | Writer's term: outgassing defects | applied | none |  | "outgassing defects" used; no banned synonym |
| 242 | Writer's banned word: successfully | applied | none |  | "successfully" not used |
| 242 | Writer's banned word: in order to | applied | none |  | "in order to" not used |
| 242 | Writer's banned word: optimize | applied | none |  | "optimize" not used |
| 242 | Writer's banned word: proprietary | applied | none |  | "proprietary" not used |
| 242 | Writer's banned word: trial and error | applied | none |  | "trial and error" not used |
| 242 | Writer's banned word: breakthrough | applied | none |  | "breakthrough" not used |
| 242 | Writer's banned word: industry-leading | applied | none |  | "industry-leading" not used |
| 242 | Writer's opening for the objective statement: "The aim of this work was to" | applied | none |  | P2 opens with "The aim of this work was to" (whether that sentence is the objective statement is the Self-check's to judge) |
| 242 | Writer's opening for the uncertainty statement: "It was not known at the outset whether" | applied | none |  | P3 opens with "It was not known at the outset whether" (whether that sentence is the uncertainty statement is the Self-check's to judge) |
| 242 | Claim Exclusion: The booth extraction upgrade was done by a contractor and is not claimed. | applied | none |  | excluded claim absent (routine engineering) |
| 242 | Claim Exclusion: Matching the customer's catalogue shades is not claimed. | applied | none |  | excluded claim absent (not technological) |
| 242 | Claim Exclusion: The company wanting to be first in the province with this finish is a market goal, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 242 | Glossary Term: panel surface temperature | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: cure window | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | Glossary Term: outgassing defects | applied | none |  | Glossary Term used (paragraph 1) |
| 242 | Glossary Term: edge coverage | applied | none |  | Glossary Term used (paragraph 2) |
| 242 | State facts without naming their source | applied | none |  | no talk about sources found |
| 242 | Storyline | applied | none |  | Consistent with Storyline. |
| 242 | Confidence Map: Outgassing defects start at a panel surface temperature of about 118 to 122 C whatever the dwell time. | applied | none |  | Not stated in the section. |
| 242 | Confidence Map: The fast-catalysed powder reached full cure at 120 C panel surface temperature. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Cure window of 8 C was mapped in 1 C steps with the edge sealer. | applied | none |  | Not mentioned in the section. |
| 242 | Confidence Map: Deep cove edge coverage is partly met: the pilot missed 60 microns on some panels, and the cause is not yet known. | applied | none |  | P3 states deep cove as uncertain. |
| 242 | Confidence Map: The remedy for deep cove edge coverage is unknown. | applied | none |  | Remedy not claimed; left uncertain. |
| 242 | Confidence Map: The pilot's 2 percent MEK failures came from one oven zone drift of 6 C. | applied | none |  | Not mentioned in the section. |
| 242 | Glossary Term: edge sealer | applied | none |  | Concept absent. |
| 242 | Glossary Term: fast-catalysed powder | applied | none |  | Concept absent. |
| 242 | Glossary Term: film build | applied | none |  | Concept absent. |
| 242 | # PD Writing Customized Settings Velloway Panel Finishing Ltd., low-temperature powder coating of MDF panels, fiscal 2026 (July 1 2025 to June 30 2026). Prepared by Priya Halvorsen, SR&ED writer, after the interview. These settings apply to every Line of this project description. Where they differ from the house defaults, these settings win. ## 1. Core variable glossary Use these exact terms for the project's named variables. Never use the alternatives listed after each one, even where the client uses them. - film build: the cured coating thickness, in microns. Never write DFT, dry film thickness, film thickness or coating thickness. - panel surface temperature: the measured temperature at the MDF surface, in degrees C. Never write substrate temperature, substrate temp, board temperature or part temperature. - cure window: the range of panel surface temperature that gives full cure with no outgassing defects. Never write bake window or oven window. - edge coverage: the film build … | applied | none |  | Openers, terms and exclusions followed. |
| 242 | Cover signed-off Summary item h57kp3db7kr1jryyyshfzzmh7n8h3nnn | applied | none |  | P1 states company context. |
| 242 | Cover signed-off Summary item h57zkm0cmfwecs3c31z677913s8h2dfc | applied | none |  | P2 opens with the aim. |
| 242 | Cover signed-off Summary item h57mgqpxnqmdhg94am64pj7h7s8h2cgf | applied | none |  | P1 covers datasheet limits. |
| 242 | Cover signed-off Summary item h57rghejefy28bgxn27h7egxm58h2y9k | applied | none |  | P2 states heat setting aim. |
| 242 | Cover signed-off Summary item h57n6jzv9c9ythw7g55txqja0h8h34qx | applied | none | 2 | P3 states the uncertainty. |
| 242 | Cover signed-off Summary item h57srt542ev96v3pq3q7eabbah8h298k | applied | none | 2 | Moisture and preheat points present. |
| 242 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 244 | Writer Profile | applied | none |  | Writer Profile applied |
| 244 | House Rule category: banned words | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 244 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 244 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 244 | House Rule category: report skeleton | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 244 | Locked Rule: Line 244 holds at most 700 words and 100 form lines | applied | locked |  | within cap at 442/700 words, 39/100 lines |
| 244 | - Line 244: no more than 520 words. | applied | none |  | 442/520 words |
| 244 | Writer's term: film build | applied | none |  | "film build" used; no banned synonym |
| 244 | Writer's term: panel surface temperature | applied | none |  | "panel surface temperature" used; no banned synonym |
| 244 | Writer's term: cure window | applied | none |  | "cure window" used; no banned synonym |
| 244 | Writer's term: edge coverage | applied | none |  | "edge coverage" used; no banned synonym |
| 244 | Writer's term: outgassing defects | applied | none |  | "outgassing defects" used; no banned synonym |
| 244 | Writer's banned word: successfully | applied | none |  | "successfully" not used |
| 244 | Writer's banned word: in order to | applied | none |  | "in order to" not used |
| 244 | Writer's banned word: optimize | applied | none |  | "optimize" not used |
| 244 | Writer's banned word: proprietary | applied | none |  | "proprietary" not used |
| 244 | Writer's banned word: trial and error | applied | none |  | "trial and error" not used |
| 244 | Writer's banned word: breakthrough | applied | none |  | "breakthrough" not used |
| 244 | Writer's banned word: industry-leading | applied | none |  | "industry-leading" not used |
| 244 | Claim Exclusion: The booth extraction upgrade was done by a contractor and is not claimed. | applied | none |  | excluded claim absent (routine engineering) |
| 244 | Claim Exclusion: Matching the customer's catalogue shades is not claimed. | applied | none |  | excluded claim absent (not technological) |
| 244 | Claim Exclusion: The company wanting to be first in the province with this finish is a market goal, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 244 | Glossary Term: edge sealer | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: film build | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: panel surface temperature | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | Glossary Term: cure window | applied | none |  | Glossary Term used (paragraph 3) |
| 244 | Glossary Term: outgassing defects | applied | none |  | Glossary Term used (paragraph 2) |
| 244 | Glossary Term: edge coverage | applied | none |  | Glossary Term used (paragraph 1) |
| 244 | State facts without naming their source | applied | none |  | no talk about sources found |
| 244 | Storyline | applied | none |  | Consistent with the Storyline. |
| 244 | Confidence Map: Outgassing defects start at a panel surface temperature of about 118 to 122 C whatever the dwell time. | applied | none |  | States onset as the map allows. |
| 244 | Confidence Map: The fast-catalysed powder reached full cure at 120 C panel surface temperature. | applied | none |  | Full cure at 120 C stated, established. |
| 244 | Confidence Map: Cure window of 8 C was mapped in 1 C steps with the edge sealer. | applied | none |  | Cure window stated, established. |
| 244 | Confidence Map: Deep cove edge coverage is partly met: the pilot missed 60 microns on some panels, and the cause is not yet known. | applied | none |  | Deep cove shortfall stated as partial. |
| 244 | Confidence Map: The remedy for deep cove edge coverage is unknown. | applied | none |  | Remedy stated as not yet known. |
| 244 | Confidence Map: The pilot's 2 percent MEK failures came from one oven zone drift of 6 C. | applied | none |  | Drift cause stated as established. |
| 244 | Glossary Term: fast-catalysed powder | applied | none |  | Concept not named in other words.; repaired, and checked again on the final text |
| 244 | # PD Writing Customized Settings Velloway Panel Finishing Ltd., low-temperature powder coating of MDF panels, fiscal 2026 (July 1 2025 to June 30 2026). Prepared by Priya Halvorsen, SR&ED writer, after the interview. These settings apply to every Line of this project description. Where they differ from the house defaults, these settings win. ## 1. Core variable glossary Use these exact terms for the project's named variables. Never use the alternatives listed after each one, even where the client uses them. - film build: the cured coating thickness, in microns. Never write DFT, dry film thickness, film thickness or coating thickness. - panel surface temperature: the measured temperature at the MDF surface, in degrees C. Never write substrate temperature, substrate temp, board temperature or part temperature. - cure window: the range of panel surface temperature that gives full cure with no outgassing defects. Never write bake window or oven window. - edge coverage: the film build … | applied | none |  | Terms, bans and style are followed. |
| 244 | Omit signed-off role prior_year_status | applied | none |  | Role absent. |
| 244 | Cover signed-off Summary item h57j4nv1x2888ap8a0j54gnvr98h31yz | applied | none |  | Several dwell times test stated. |
| 244 | Cover signed-off Summary item h57htsczec1ra34xe8yc9m09g98h3k1p | applied | none |  | Hypothesis stated. |
| 244 | Cover signed-off Summary item h57hdbchze52h8rztxfb6r99cs8h3nd0 | applied | none |  | Trial 1 datasheet and 131 C covered. |
| 244 | Cover signed-off Summary item h57v77kz109m7v2ae6b5gpp87x8h2qj8 | applied | none |  | Dwell finding covered. |
| 244 | State figures and details as the sources give them | not_applied | none |  | P3 says "Trial 2 kept the preheat and lowered oven air to 125 C, then raised it to 127 C.", but the sources say "We lowered the oven air to 125 C and stretched the dwell from 10 to 14 minutes, same preheat.". |
| 244 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 244 | Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs | applied | none |  | All work ties to stated uncertainties. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "If an edge sealer replaces preheat, then edge coverage reaches 60 microns below outgassing onset." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Leave out quotes marked for a check from the evidence for the idea "Trial 1 followed the supplier datasheet and reached 131 C at the surface." | applied | none |  | 1 quote was marked as possibly not backing this idea, so the draft did not use it as evidence. The idea's wording and support status were used as signed off. "Use it anyway" on the idea card before sign-off keeps a quote as evidence. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 3 (sections 242, 244): Trial 2 is described as lowering oven air to 125 C then raising it to 127 C while keeping preheat, yet the stated hypothesis and one-variable-at-a-time method conflict with changing oven air and running several dwell times in the same trial. |
| 244 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 244 paragraph 6 (sections 242, 244, 246): Line 244 P6 says MEK passed on 98 percent of panels and Line 242 sets line speed 2.5 m per minute and 120 C surface temperature, but the draft reports no line speed result; also oven zone 3 drifted 6 C low causing failures at low cure, while Line 246 P3 calls oven zone control open without an uncertainty stated in Line 242. |
| 246 | Writer Profile | applied | none |  | Writer Profile applied |
| 246 | House Rule category: banned words | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 246 | House Rule category: paragraph density | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: sentence construction | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: repetition caps | applied | none |  | House Rule applied (no Writer Profile waiver) |
| 246 | House Rule category: opening clauses | not_applied | org_enforced |  | House Rule waived for everyone (org mode off) |
| 246 | House Rule category: report skeleton | not_applied | none |  | instruction waived via override: the Writer Profile waives this House Rule |
| 246 | Locked Rule: Line 246 holds at most 350 words and 50 form lines | applied | locked |  | within cap at 236/350 words, 20/50 lines |
| 246 | - Line 246: no more than 260 words. | applied | none |  | 236/260 words |
| 246 | Writer's term: film build | applied | none |  | no banned synonym of "film build" |
| 246 | Writer's term: panel surface temperature | applied | none |  | "panel surface temperature" used; no banned synonym |
| 246 | Writer's term: cure window | applied | none |  | "cure window" used; no banned synonym |
| 246 | Writer's term: edge coverage | applied | none |  | "edge coverage" used; no banned synonym |
| 246 | Writer's term: outgassing defects | applied | none |  | "outgassing defects" used; no banned synonym |
| 246 | Writer's banned word: successfully | applied | none |  | "successfully" not used |
| 246 | Writer's banned word: in order to | applied | none |  | "in order to" not used |
| 246 | Writer's banned word: optimize | applied | none |  | "optimize" not used |
| 246 | Writer's banned word: proprietary | applied | none |  | "proprietary" not used |
| 246 | Writer's banned word: trial and error | applied | none |  | "trial and error" not used |
| 246 | Writer's banned word: breakthrough | applied | none |  | "breakthrough" not used |
| 246 | Writer's banned word: industry-leading | applied | none |  | "industry-leading" not used |
| 246 | Claim Exclusion: The booth extraction upgrade was done by a contractor and is not claimed. | applied | none |  | excluded claim absent (routine engineering) |
| 246 | Claim Exclusion: Matching the customer's catalogue shades is not claimed. | applied | none |  | excluded claim absent (not technological) |
| 246 | Claim Exclusion: The company wanting to be first in the province with this finish is a market goal, not SR&ED work. | applied | none |  | excluded claim absent (business risk) |
| 246 | Glossary Term: edge sealer | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: fast-catalysed powder | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: panel surface temperature | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: cure window | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | Glossary Term: outgassing defects | applied | none |  | Glossary Term used (paragraph 1) |
| 246 | Glossary Term: edge coverage | applied | none |  | Glossary Term used (paragraph 2) |
| 246 | State facts without naming their source | applied | none |  | no talk about sources found |
| 246 | Storyline | applied | none |  | Consistent with the Storyline. |
| 246 | Confidence Map: Outgassing defects start at a panel surface temperature of about 118 to 122 C whatever the dwell time. | applied | none |  | Established; stated firmly. |
| 246 | Confidence Map: The fast-catalysed powder reached full cure at 120 C panel surface temperature. | applied | none |  | Established; stated firmly. |
| 246 | Confidence Map: Cure window of 8 C was mapped in 1 C steps with the edge sealer. | applied | none |  | Established; stated firmly. |
| 246 | Confidence Map: Deep cove edge coverage is partly met: the pilot missed 60 microns on some panels, and the cause is not yet known. | applied | none |  | P3 says only partly met. |
| 246 | Confidence Map: The remedy for deep cove edge coverage is unknown. | applied | none |  | P3 says remedy not yet known. |
| 246 | Confidence Map: The pilot's 2 percent MEK failures came from one oven zone drift of 6 C. | applied | none |  | Not mentioned in the section. |
| 246 | Glossary Term: film build | applied | none |  | Concept not named in other words. |
| 246 | # PD Writing Customized Settings Velloway Panel Finishing Ltd., low-temperature powder coating of MDF panels, fiscal 2026 (July 1 2025 to June 30 2026). Prepared by Priya Halvorsen, SR&ED writer, after the interview. These settings apply to every Line of this project description. Where they differ from the house defaults, these settings win. ## 1. Core variable glossary Use these exact terms for the project's named variables. Never use the alternatives listed after each one, even where the client uses them. - film build: the cured coating thickness, in microns. Never write DFT, dry film thickness, film thickness or coating thickness. - panel surface temperature: the measured temperature at the MDF surface, in degrees C. Never write substrate temperature, substrate temp, board temperature or part temperature. - cure window: the range of panel surface temperature that gives full cure with no outgassing defects. Never write bake window or oven window. - edge coverage: the film build … | applied | none |  | Terms, banned words and exclusions followed.; repaired, and checked again on the final text |
| 246 | Cover signed-off Summary item h57p6p63amh662s34gsccewep58h2nqx | applied | none |  | P1 states onset at 118 to 122 C. |
| 246 | Cover signed-off Summary item h57m2pk3xbbfm297bzd76qx87h8h24c4 | applied | none | 2 | P1 says onset did not move in Trial 2. |
| 246 | Cover signed-off Summary item h57pfvd5nvv696q635tq2qd3en8h2bre | applied | none | 2 | P1 states onset at every dwell time. |
| 246 | Cover signed-off Summary item h57s2r3ccj0mt6j801p95c4kpn8h28b2 | applied | none |  | P3 says shaker doors are ready. |
| 246 | Cover signed-off Summary item h57wxz7xfva4skhg6ya7j96rp58h33h5 | applied | none |  | P1 states onset at every dwell time. |
| 246 | State figures and details as the sources give them | applied | none |  | The facts check found no figure or detail it could show differs from the sources. |
| 246 | State each result against its target as the numbers show | applied | none |  | The targets check found no result it could show is stated against its target differently from the sources. |
| 246 | Claim an advancement only for an uncertainty Line 242 states | applied | none |  | Advancements answer Line 242 uncertainties. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 says the cure window of 113 to 121 C is 8 C wide, but the Line 242 target is at least 8 C wide and 121 minus 113 is 8, so that is fine. However Line 246 says the first time cure and outgassing targets were met, while Line 244 P4 Trial 3 shows edge coverage of 58 microns, below the 60 micron target; Line 246 P2 cites that 58 micron figure as progress without noting it missed target. Also the 8 C width is at the minimum only if the endpoints are inclusive, which conflicts with Line 244 P2 style of reporting. |
| 246 | Consistency pass (contradiction) | not_applied | none |  | section contradiction detected at Line 246 paragraph 2 (sections 244, 246): Line 246 says the 'fastest catalyst level gave orange peel of 5 against a target of 6', but Line 242 states no orange peel target and Line 244 reports no orange peel result. |
| 246 | Consistency pass | applied | none |  | consistency pass ran over the assembled draft: 4 finding(s) |

## Not checked by the Self-check

Labels (Storyline, Confidence Map, Glossary, instructions) and plan checks (items and Skips) the Self-check gave no verdict for, even after its one follow-up.

- Line 242: 0 labels and 0 plan checks "Not checked" of 18.
- Line 244: 0 labels and 0 plan checks "Not checked" of 17.
- Line 246: 0 labels and 0 plan checks "Not checked" of 17.

## Seed-stage numbers

- Requests: 15 metered (15 Batch, 0 Feedback); 16 reserved; notice at 40 not shown.
- Dispatch to validated result: median 5.9 s, p95 14.2 s over 13 Batch(es).
- Foreground dispatch to first render (script-observed): median 17.2 s, p95 17.2 s over 1.
- Sign-off to report created: 84.9 s.
- Cost from aiUsage: $1.29 in all ($0.53 seed stage, $0.77 Brief, drafting and checks) over 36 calls on claude-haiku-5-5, claude-sonnet-5-5.

## Run log

```
2026-10-27T20:58:47.631Z created project k973et6h6wj1an053aseshx62h8h3f3f
2026-10-27T20:58:48.778Z marked as an evaluation project
2026-10-27T20:58:50.289Z added document powder-on-mdf-trial-summary.md
2026-10-27T20:58:51.457Z added document pd-writing-customized-settings.md
2026-10-27T20:58:54.087Z started Step by step generation k57dq8sqgx1v6q5g72s0em1rx18h3t2a
2026-10-27T20:59:10.693Z seed stage open
2026-10-27T20:59:10.694Z Open Company / Context and wait for its Batch
2026-10-27T20:59:20.357Z Company / Context: select the first Seed
2026-10-27T20:59:23.470Z Approve Company / Context
2026-10-27T20:59:26.645Z approved company_context
2026-10-27T20:59:26.645Z Open Goal / Problem and wait for its Batch
2026-10-27T20:59:35.901Z Goal / Problem: select the first Seed
2026-10-27T20:59:38.834Z Approve Goal / Problem
2026-10-27T20:59:41.633Z approved goal_problem
2026-10-27T20:59:41.633Z Open Technological limitations and wait for its Batch
2026-10-27T20:59:47.765Z Technological limitations: select the first Seed
2026-10-27T20:59:50.460Z Approve Technological limitations
2026-10-27T20:59:53.169Z approved passive_limitations
2026-10-27T20:59:53.170Z Open Technological objectives and wait for its Batch
2026-10-27T20:59:58.585Z Technological objectives: select the first Seed
2026-10-27T21:00:01.293Z Approve Technological objectives
2026-10-27T21:00:04.124Z approved technological_objective
2026-10-27T21:00:04.125Z Open Technological uncertainties and wait for its Batch
2026-10-27T21:00:12.407Z Technological uncertainties: select the first 2 Seeds
2026-10-27T21:00:16.920Z Approve Technological uncertainties
2026-10-27T21:00:19.612Z approved active_uncertainties
2026-10-27T21:00:19.613Z Skip Previous-year status
2026-10-27T21:00:21.359Z Open Work plan and wait for its Batch
2026-10-27T21:00:41.240Z Work plan: select the first Seed
2026-10-27T21:00:43.822Z Approve Work plan
2026-10-27T21:00:46.465Z approved workplan
2026-10-27T21:00:46.465Z Open Hypothesis and wait for its Batch
2026-10-27T21:00:54.478Z Hypothesis: select the first Seed
2026-10-27T21:00:57.179Z Approve Hypothesis
2026-10-27T21:00:59.780Z approved hypothesis
2026-10-27T21:00:59.780Z Open Experimentation / Iterations and wait for its Batch
2026-10-27T21:01:10.957Z Experimentation / Iterations: select the first 2 Seeds
2026-10-27T21:01:15.594Z Approve Experimentation / Iterations
2026-10-27T21:01:18.419Z approved experimentation
2026-10-27T21:01:18.419Z Open Advancement to science / technology and wait for its Batch
2026-10-27T21:01:26.702Z Advancement to science / technology: select the first Seed
2026-10-27T21:01:29.394Z Approve Advancement to science / technology
2026-10-27T21:01:32.046Z approved overall_advancement
2026-10-27T21:01:32.046Z Open Specific technological advancements and wait for its Batch
2026-10-27T21:01:40.365Z Specific technological advancements: select 2 advancements linked to active selections (preferring a shared uncertainty)
2026-10-27T21:01:47.906Z Approve Specific technological advancements
2026-10-27T21:01:50.787Z approved specific_advancements
2026-10-27T21:01:50.788Z Open Project status and next steps and wait for its Batch
2026-10-27T21:01:59.312Z Project status and next steps: select the first Seed
2026-10-27T21:02:02.098Z Approve Project status and next steps
2026-10-27T21:02:04.846Z approved project_status
2026-10-27T21:02:04.846Z Open Overall company / project goal improvements and wait for its Batch
2026-10-27T21:02:13.271Z Overall company / project goal improvements: select the first Seed
2026-10-27T21:02:15.986Z Approve Overall company / project goal improvements
2026-10-27T21:02:19.014Z approved goal_improvements
2026-10-27T21:02:19.014Z Wait for readiness and the drafting inputs, sign off, and wait for the report
2026-10-27T21:02:20.867Z signed off; waiting for the report
2026-10-27T21:03:46.128Z report kd7b1j0sg0xcbja3tp43c7pzvn8h3n0e created
```
