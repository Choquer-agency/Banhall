---
title: Banhall PD generation — better than the dump
status: final
created: 2026-09-09
updated: 2026-09-09
---

# PRD: Banhall PD generation — better than the dump
*Working title — confirm.*

## 0. Document Purpose

For Johnny (owner), Michael (Banhall, product direction) and the downstream architecture and ticket work in the factory. It states what the PD generation path must do so that a writer who gives Banhall exactly what they would paste into ChatGPT gets a clearly better project description, with no extra work. Vocabulary is anchored in §2, ahead of the journeys that use it; features carry globally numbered FRs; every inference is tagged `[ASSUMPTION]` inline and indexed in §9. Inputs it builds on: the 2026-09-09 client call (Larry's workflow report, Michael's stepwise idea), the codebase extract (`extract-codebase.md`), two research extracts (`extract-web-research.md`, `extract-competitor-mechanisms.md`) and the 2026-09-08 intake assessment of chat behaviour. Technical mechanisms, options considered and measurement protocol live in `addendum.md`. UJ-1 and UJ-2 are captured from Larry's account on the call; UJ-3, UJ-4 and UJ-5 are authored scenarios derived from it and marked as such.

## 1. Vision

A Banhall writer starts a project the way they start a ChatGPT session: drop in the interview transcripts, a title, whatever context and attachments they have, and rely on the settings they wrote once. Banhall returns a project description that is better than the one ChatGPT would give for the same Dump — on the writer's own terms (their Writer Profile), on the CRA's terms (The Five Questions, the Locked Rules), and on the reader's terms (one coherent Storyline, one vocabulary, clean structure).

The difference is not more input from the writer. It is that Banhall does the structuring work the writer currently does by hand before ChatGPT will cooperate: it assembles the controlling Storyline (the writer's own, or derived), the Claim Exclusions, the Confidence Map and the Glossary Terms from the Dump itself — and then drafts against that structure, in the writer's Build Order, checking each section against the writer's rules before it shows anything. When the writer lists what is wrong, Banhall fixes all of it in one pass and says what it could not do and why. When the writer asks how to make it better, Banhall improves it or names the missing fact; it never hands the writer homework.

Why it matters: Larry, the lead writer, spent "many, many hours" and ten revisions (Rev A to Rev J) on one project; the second draft was "just marginally better than the first," and he ended "at a loss as to how to make it converge." He wants to use the tool for his client's small projects. The September goal is a program the writers adopt. Adoption follows the day the tool is the easier path to a defensible PD.

## Why Now

- Michael's stated goal is a solid program by end of September, and he has chosen to keep the next one to two review cycles on Larry's thread rather than rotating managers. Larry is on vacation the week of September 15, so the Friday September 12 review is the one live session before the metrics in §7 can start.
- Multi-transcript projects shipped (transcripts 1–7); the input side is done, the output side is what lags.
- The same complaint (settings silently overridden) was filed on 2026-08-23 and produced PSOS-49/50; Larry now calls it "largely solved but not perfect yet," with Section 246 "still quite a problem." A third report would cost trust that is hard to rebuild.
- The CRA's Pre-Claim Approval process (effective 2026-04-01) raises the bar on defensible, specific narratives — the opposite of what a "dump into ChatGPT" workflow yields.

## 2. Glossary

- **PD** — Project description: the technical narrative of an SR&ED claim, structured as Section 242, Section 244 and Section 246, answering The Five Questions.
- **The Five Questions** — the CRA's eligibility test a PD must answer: what technological uncertainty existed, what hypotheses were formulated, was the work a systematic investigation, what technological advancement was sought or achieved, and what records were kept. The Storyline is defined against them; the Confidence Map classifies the facts that answer them.
- **Section 242 / 244 / 246** — the three CRA-defined parts of a PD (uncertainties; work performed; advancements). Their existence, order and line/word limits are Locked Rules.
- **Transcript** — an interview transcript attached to a project. A project holds one or more, ordered.
- **Dump** — the set of inputs a writer would paste into ChatGPT: Transcripts, title, context, attachments, and their Writer Profile. The Dump is the maximum the tool may require.
- **Writer Profile** — a writer's saved customized settings: paragraph rules, Build Order, Self-checks, terminology preferences. Set once; applies to every generation. Larry's "PD writing customized settings document" is a Writer Profile.
- **Writer's Notes** — free-text per-project direction supplied at generation time; highest-trust input after the Writer Profile.
- **Supporting Documents** — attachments other than Transcripts (spreadsheets, PDFs, prior PDs, images).
- **House Rules** — Banhall's default style rules (banned words, density, sentence construction, repetition caps, opening clauses, report skeleton). Each category has an Org Mode.
- **Org Mode** — the organisation's setting per House Rule category: `writer_choice` (a Writer Profile may waive it), `enforced` (applies regardless of the Writer Profile), or `off`. Precedence is Locked Rules > enforced Org Mode > Writer Profile > House Rules.
- **Locked Rules** — CRA-derived rules no writer or admin can override: the 242/244/246 skeleton, line and word caps, no fabrication.
- **Generation Brief** — the structure the system derives from the Dump before drafting: Storyline, Claim Exclusions, Confidence Map, Glossary Terms. Shown to the writer; editable; never required.
- **Storyline** — the controlling narrative every section of the PD must follow; the most defensible account of the project against The Five Questions. Supplied by the writer, or derived by the system when the writer supplies none. Every Storyline claim shows the Confidence Map entries it rests on.
- **Claim Exclusions** — statements from the Dump that are outside the eligible work (business risk, routine engineering, non-SR&ED activity) and so must not be claimed in the PD however prominent they are in the source. Each carries its eligibility reason.
- **Confidence Map** — the Dump's facts classified as established, partially established, unresolved, or unreliable, each tied to its source.
- **Glossary Terms** — the technical phrases the PD uses exclusively, so one concept has one name from start to finish.
- **Build Order** — the order in which sections and paragraphs are generated, as prescribed by the Writer Profile; may differ from presentation order.
- **Self-check** — a check the Writer Profile attaches to a paragraph ("before publishing, confirm X"); the system runs it before showing the paragraph.
- **Compliance Note** — the per-section statement of which Writer Profile instructions were applied and which were not, with the reason (Locked Rule, conflict, missing fact).
- **Deviation** — a place where the draft departs from the Writer Profile, or a content issue the writer flags for correction.
- **Deviation Inventory** — the assistant's list of every paragraph, its corresponding Writer Profile rule, and each Deviation; the writer may add content Deviations to it.
- **Coordinated Revision** — one proposal that addresses every item in a Deviation Inventory or writer-supplied list at once.
- **Completion Report** — the per-item outcome of a Coordinated Revision: resolved, blocked (with the missing fact), or conflicting (with the rule and an alternative).
- **Proposal** — a set of edits the assistant proposes and a human applies (the existing chatProposals/applyProposal contract). No prose changes without one.
- **Reference PD** — a writer's own finished PD for a project, used as the standard a draft is compared against.
- **Sol** — the generation model Larry uses: "GPT-5.6 Sol" via the OpenRouter gateway (`openai/gpt-5.6-sol`). Not necessarily identical in behaviour to the Sol model inside the ChatGPT product (Open Question 3).
- **Paired Comparison** — the evaluation: the same Dump into ChatGPT and into Banhall, both drafts stripped to identically formatted plain text by a third person, rated blind by the writer, with Deviations and Corrections-to-acceptable counted by the same manual method for both.
- **Corrections-to-acceptable** — the number of Coordinated Revisions (or manual edit rounds) a writer needs before calling a draft acceptable.

## 3. Target User

### 3.1 Jobs To Be Done
- Functional: produce a first-draft PD from one or more interview transcripts that needs fewer corrections than the one ChatGPT produces from the same material.
- Functional: have my customized settings actually govern the draft — Build Order, paragraph rules, Self-checks — and know when a rule was not applied and why.
- Functional: correct a list of Deviations once, not four at a time across a dozen turns.
- Emotional: stop feeling that the tool asks more of me than it gives back — and stop having to tell it "please take your time, I care about quality more than speed" to get its best work.
- Social: trust that the PD will hold up at CRA review; consistent terminology and one Storyline are what a reviewer reads as credibility.
- Contextual: I work one paragraph at a time, building later paragraphs on earlier ones; the tool should not fight that.

### 3.2 Non-Users (v1)
- Banhall's clients (they never see the tool).
- CRA reviewers.
- Admins configuring roles, Brain ingestion or rollout — unchanged by this PRD.

### 3.3 Key User Journeys

- **UJ-1. Larry generates a first draft for a 1300-hour project.**
  - **Persona + context:** Larry, senior SR&ED writer, Burlington. Has one long, detailed interview Transcript for project 25001 and his customized-settings document (paragraph rules, Build Order, Self-checks) saved in his Writer Profile. He has already written the PD himself offline; that is his Reference PD. He also has his own Storyline — he builds one for every PD and wants to keep doing so.
  - **Entry state:** authenticated, on the new-project page, coming from the project list.
  - **Path:** (1) drops the Transcript, types the title, adds a sentence of context, attaches the client's two spreadsheets, and pastes his Storyline into the Brief's Storyline slot; (2) picks Sol; (3) generates. (4) While it runs, the Generation Brief fills in around his Storyline: six Claim Exclusions, a Confidence Map, nine Glossary Terms, each showing the Transcript passage it came from. He glances, changes one Glossary Term, leaves the rest. (5) The draft arrives section by section in his Build Order, each with a Compliance Note that also shows what was checked and repaired before he saw it — he never has to ask it to take its time.
  - **Climax:** his first read-through finds fewer Deviations from his settings than his ChatGPT draft had, and the terminology is one vocabulary end to end. The Compliance Note on 246 says: "Your instruction to expand the results discussion was applied up to the CRA limit of 50 lines; the limit is locked."
  - **Resolution:** he is in the report editor with a draft he would rather correct than rewrite. He did not create a single document to get there.
  - **Edge case:** the transcript exceeds the context budget; the Brief says so ("condensed to a digest; full text available") and the Confidence Map marks what came from the digest.

- **UJ-2. Larry corrects sixteen Deviations in one pass.**
  - **Persona + context:** same project, first draft in the editor.
  - **Entry state:** report chat open.
  - **Path:** (1) he asks for the Deviation Inventory; the assistant lists every paragraph, the settings rule it corresponds to, and fourteen Deviations; he adds two content corrections of his own, making sixteen. (2) He says "bring all sixteen into alignment". (3) The assistant returns one Coordinated Revision: a proposal covering all sixteen, plus a Completion Report: 14 resolved, 1 blocked (needs a date the transcript does not contain), 1 conflicting (would exceed the locked 244 word cap; alternative offered). (4) He reviews the diff and applies.
  - **Climax:** one turn, sixteen items accounted for, none silently dropped.
  - **Resolution:** the second draft is materially, not marginally, closer to his Reference PD.
  - **Edge case:** he asks "how can I help you converge?"; the assistant answers with the two interview facts it lacks — questions for the client — never with a request that he write a Storyline, Claim Exclusions or Glossary Terms.

- **UJ-3. Tracy starts from three transcripts and no settings of her own.** *(authored scenario)*
  - **Persona + context:** Tracy, writer, has three interviews for one project and has not set up a Writer Profile.
  - **Entry state:** new-project page.
  - **Path:** drops all three, generates. The Brief shows one Storyline reconciled across the three, with the Confidence Map flagging where the interviews disagree. House Rules apply in full because she has no settings.
  - **Climax:** a coherent draft from three voices, with the disagreements visible instead of averaged away.
  - **Resolution:** she edits in the tool; she never opens ChatGPT for this project.

- **UJ-4. Michael proves the tool beats the dump.** *(authored scenario)*
  - **Persona + context:** Michael, manager, preparing the Friday review.
  - **Entry state:** has 25001 and three other projects with transcripts, settings and Reference PDs.
  - **Path:** runs the Paired Comparison: identical inputs into ChatGPT (Sol) and into Banhall; a third person strips both drafts to plain text with identical formatting; Larry rates the two blind per project; he counts Deviations against his settings and Corrections-to-acceptable by the same manual method for both drafts.
  - **Climax:** Banhall wins on preference and on both counts across the set; the results are stored with the generations.
  - **Resolution:** the September claim ("better than ChatGPT") is a number, not a feeling.

- **UJ-5. Larry drafts a 150-hour project in an afternoon.** *(authored scenario)*
  - **Persona + context:** Larry's real target: the small projects at his current manufacturing client, "100, 200 hours," too small to justify his full offline process.
  - **Entry state:** new-project page; one short Transcript, no Reference PD, his Writer Profile.
  - **Path:** drops the Transcript, generates; the Brief derives the Storyline itself since he supplied none; the draft arrives in his Build Order.
  - **Climax:** one Coordinated Revision later he has an acceptable PD without opening ChatGPT — on a project he would not previously have put through the tool at all.
  - **Resolution:** small projects become the tool's default home. The Paired Comparison set includes at least one of these.

## 4. Features

### 4.1 Generation Brief
**Description:** Before drafting, the system assembles the structure a strong writer builds by hand — Storyline, Claim Exclusions, Confidence Map, Glossary Terms — deriving from the Dump whatever the writer did not supply, and every section is then generated against it. A writer who has a Storyline (Larry always does) pastes it in; a writer who has none gets one derived. The Brief is shown beside the draft as it is produced; the writer may edit any part of it and regenerate, or ignore it. Because the Storyline governs every section, the Brief is checked back against the draft: a section whose evidence contradicts the Storyline raises a Storyline question rather than being forced into line. It is stored with the generation and reused on regeneration so the same project does not drift between runs. Realizes UJ-1, UJ-3. `[ASSUMPTION: the Brief is shown but never gates generation; Michael's per-section multi-select is a deeper optional mode, not the default — see §6.2.]`

#### FR-1: Storyline supplied by the writer or derived from the Dump, and checked back
The writer can supply a Storyline; when none is supplied the system derives one from the Transcripts, Writer's Notes and Supporting Documents before any section is drafted. Every Storyline claim shows the Confidence Map entries it rests on. Realizes UJ-1, UJ-5.
**Consequences (testable):**
- Every generation record stores the Storyline used and whether it was writer-supplied, derived, or derived-then-edited.
- Each section's generation prompt contains the Storyline; a section that contradicts it fails the Self-check (FR-9).
- A Self-check contradiction whose section evidence is stronger than the Storyline's basis (Confidence Map: established vs. partial or unresolved) is surfaced in the Brief as a Storyline question with both sides, not repaired away. A fixture whose Transcript contradicts a derived Storyline claim yields that question.
- With three Transcripts (UJ-3) the Storyline is one narrative, and points where the Transcripts disagree appear in the Confidence Map, not silently resolved.

#### FR-2: Claim Exclusions, Confidence Map and Glossary Terms derived from the Dump
The system derives Claim Exclusions, a Confidence Map and Glossary Terms from the Dump, each entry tied to the source passage it came from. Realizes UJ-1.
**Consequences (testable):**
- On an adversarial fixture corpus (prominent excluded claims, paraphrased), at least 95% of Claim Exclusions are absent from the draft and every remaining occurrence is flagged by the Self-check; the residual is reported, not hidden.
- Every Claim Exclusion carries an eligibility reason (business risk, routine engineering, outside the claim period, not technological); "reads badly" is not a reason.
- Every Confidence Map entry cites a Transcript or Supporting Document passage; entries from a condensed digest are marked as such.
- Glossary consistency is enforced by a rule-based term matcher over the draft (exact and inflected forms), with model judgment used only to classify candidates the matcher flags; on a fixture with known synonyms, at least 95% are replaced or flagged.

#### FR-3: Brief is visible, editable and optional
The writer can read the Brief, edit any entry, and regenerate; a writer who never opens it gets a complete draft. Realizes UJ-1, UJ-3.
**Consequences (testable):**
- Generation completes with no Brief interaction.
- An edited Brief entry is used verbatim by the next generation and recorded as writer-edited, with the edit magnitude (changed entries, and edit distance on the Storyline) stored per generation for SM-C5.
- The Brief never asks the writer to supply a document; the only writer actions it offers are supply-a-Storyline (optional), edit, or leave.

#### FR-4: Brief reused across regenerations
A regeneration of the same project with unchanged inputs reuses the stored Brief; changed inputs re-derive it and show what changed. Realizes UJ-1.
**Consequences (testable):**
- Two consecutive generations with identical inputs share one Brief id.
- Adding a Transcript re-derives the Brief and lists added/removed Confidence Map entries.

### 4.2 Writer Profile fidelity
**Description:** A Writer Profile governs the draft the way its author wrote it: sections and paragraphs are produced in its Build Order with prior approved content as context, each paragraph's Self-check runs before the paragraph is shown, and House Rules yield to the profile. Where an instruction is not applied, the Compliance Note says so and why; silent override is impossible. Realizes UJ-1, UJ-2. `[ASSUMPTION: Locked Rules stay locked, including the Section 246 caps; whether Larry's 246 complaint is a locked-cap disagreement or a House Rule leak is Open Question 1.]`

#### FR-5: Profile instructions honoured, including Build Order and Self-checks
The system generates in the Writer Profile's Build Order, feeding each generated section into the next, and runs each paragraph's Self-check before output. Realizes UJ-1.
**Consequences (testable):**
- The generation record lists the order sections were produced in and it matches the profile's Build Order.
- A Self-check that fails triggers a repair attempt; the Compliance Note records the check and its outcome.
- A profile with no Build Order falls back to 242 → 244 → 246 with prior-section context, not parallel generation. `[ASSUMPTION: ordered generation with prior-section context becomes the default for every mode.]`
- In `single` and `compare` modes the ordering is ungated: no approval checkpoint is added, each section is shown as soon as it completes, and the writer may stop at any point. Because earlier sections are unreviewed when later ones are drafted, the Self-check (FR-9) runs once more over the assembled draft for cross-section consistency before the last section is shown. The gated variant, with human approval between sections, remains the existing `iterative` mode; "approved-prior-section context" is not the mechanism reused here. Decided 2026-09-09 (Johnny): ungated by default, gated available.

#### FR-6: Precedence: Locked Rules > enforced Org Mode > Writer Profile > House Rules (pending Open Question 1)
When a Writer Profile instruction conflicts with a House Rule whose Org Mode is `writer_choice`, the profile wins; when the category's Org Mode is `enforced`, the House Rule wins and the Compliance Note says "org-enforced"; when an instruction conflicts with a Locked Rule, the Locked Rule wins and the conflict is reported. This restates the precedence PSOS-49/50 already put in production (`docs/product-domain.md`); the new requirement is that no tier applies silently. Realizes UJ-1.
**Consequences (testable):**
- With every category in `writer_choice`, a profile instruction contradicting each of the six House Rule categories is applied in the draft.
- With a category `enforced`, the House Rule applies and the Compliance Note names the category as org-enforced.
- A profile instruction that would exceed a line or word cap is applied up to the cap and reported in the Compliance Note.
- The four-tier precedence and the "no silent tier" rule are recorded in `docs/product-domain.md` as an amendment.

#### FR-7: Compliance Note per section
Every generated section carries a Compliance Note listing the profile instructions applied and every instruction not applied with its reason. Realizes UJ-1.
**Consequences (testable):**
- For a profile with N instructions relevant to a section, the note accounts for N outcomes.
- No instruction can be unapplied without appearing in the note; a test that injects an unfollowable instruction sees it reported.
- The note is stored with the generation and visible in the report editor.

#### FR-8: Settings supplied as a document are treated as the Writer Profile
A customized-settings document supplied as Writer's Notes or a Supporting Document is recognised and applied with Writer Profile precedence, and the writer is offered the option to save it to their profile. Realizes UJ-1. `[ASSUMPTION: writers will keep pasting the document per project even after a profile exists; both paths must behave the same.]`
**Consequences (testable):**
- The same settings supplied as profile, as Writer's Notes, or as an attachment produce the same Compliance Notes.
- A disabled or missing profile is reported in the Brief ("no Writer Profile applied"), never silently replaced by House Rules.

### 4.3 Draft quality: ordered, self-checked, well-formed
**Description:** The draft is produced section by section against the Brief and the profile, checked before it is shown, and formatted consistently. What the context budget could not include is told to the writer, not hidden. Realizes UJ-1, UJ-3.

#### FR-9: Self-check before output
Before a section is shown, the system checks it against the Storyline, Claim Exclusions, Glossary Terms, the Confidence Map's calibration, the profile's paragraph rules and Locked Rules, and repairs at most once. Realizes UJ-1.
**Consequences (testable):**
- A section containing an excluded claim, an off-glossary synonym, or a cap breach is repaired or flagged before display.
- A fact the Confidence Map marks unresolved or unreliable is stated with CRA-appropriate hedging in the draft prose itself, never as established; a fixture with an unreliable fact yields hedged prose, and a draft that states the fact flatly fails the check. One coherent Storyline never means hiding a weakness.
- A Storyline contradiction is handled per FR-1 (raised as a Storyline question), not only repaired.
- The check's outcome, including what was repaired, is part of the generation's quality scorecard and visible in the Compliance Note.

#### FR-10: Consistent formatting and terminology
The draft uses one Glossary Term per concept, the profile's paragraph structure, and the 242/244/246 skeleton with headings and paragraph breaks the report editor renders identically to export. Realizes UJ-1.
**Consequences (testable):**
- Export (DOCX) and editor show the same paragraphs and headings.
- No paragraph exceeds the profile's density rule where one exists.

#### FR-11: Context completeness is visible
When the Dump exceeds the context budget (documents or characters), the writer is told what was condensed or cut, per document, before reading the draft. Realizes UJ-1 edge case.
**Consequences (testable):**
- A generation over budget shows a per-document line: full / condensed / not included.
- Cut notices are user-facing, not only in operator logs.

### 4.4 Convergence in one pass
**Description:** Correction is a single coordinated act, not a chat negotiation. The assistant can inventory every Deviation from the profile, take the writer's own content corrections into the same list, resolve a whole list in one Proposal with a Completion Report, and answer "how do I make this better" with an action or a precise missing fact — never with a document for the writer to produce. Realizes UJ-2.

#### FR-12: Deviation Inventory
On request, the assistant lists every paragraph, its corresponding Writer Profile rule, and each Deviation, using the stored Compliance Notes and the profile; the writer can add content Deviations (a wrong fact, a missing experiment, a paragraph to expand) to the same list. Realizes UJ-2.
**Consequences (testable):**
- Every paragraph of the draft appears exactly once in the inventory.
- Each rule Deviation names the profile rule it violates; each content Deviation names the paragraph and the writer's instruction.
- A Coordinated Revision (FR-13) treats both kinds identically; content corrections are not pushed back into multi-turn chat.

#### FR-13: Coordinated Revision with Completion Report
Given a list of N items (from the inventory or typed by the writer), the assistant returns one Proposal addressing all N and a Completion Report marking each resolved, blocked (with the missing fact), or conflicting (with the rule and an alternative). Realizes UJ-2.
**Consequences (testable):**
- For N ≤ 30, the response contains exactly one Proposal and N report lines; no item is omitted.
- A blocked item names the fact and its intended source (interview, client); a conflicting item names the Locked Rule.
- The Proposal still requires human apply (Proposal contract unchanged).
- Evaluated by the existing live-model chat-behaviour harness with a 16-item fixture: 16/16 accounted for on every run.

#### FR-14: "Make it better" contract
When the writer asks how to improve the draft, the assistant either proposes concrete improvements it can make from the Dump, or names the specific facts it lacks as questions for the client. It never asks the writer to produce a Storyline, Claim Exclusions, a Confidence Map, Glossary Terms or any other document. Realizes UJ-2 edge case.
**Consequences (testable):**
- A prompt-fixture asking "what can I do to help you converge?" yields a Proposal or a list of missing facts; a response containing a request for a writer-authored document fails the fixture.
- Missing facts reference the Confidence Map's unresolved entries.

#### FR-15: Compare against a Reference PD
When a writer supplies a Reference PD, the assistant reports the specific differences (structure, Storyline, terminology, per-paragraph) and offers them as a Coordinated Revision. Realizes UJ-2. `[ASSUMPTION: Larry will supply 25001 as a Reference PD; in MVP by decision of 2026-09-09.]`
**Consequences (testable):**
- The comparison names paragraphs, not scores; a numeric self-score is never the primary output.
- Differences that would breach a Locked Rule are listed as conflicting, not applied.

### 4.5 Paired Comparison (the proof)
**Description:** "Better than ChatGPT" is measured, per project, with the writer as judge. Realizes UJ-4.

#### FR-16: Paired Comparison harness
Michael or Johnny can run, for a project with a Dump and a Reference PD, the same Dump through a ChatGPT (Sol) baseline and through Banhall, have both drafts stripped to identically formatted plain text by someone other than the judge (no Compliance Notes, no Brief, no tool-specific headings), collect the writer's blind preference, and record Deviations and Corrections-to-acceptable counted by the same manual method for both drafts. Results are stored with the generations. Realizes UJ-4. `[ASSUMPTION: the ChatGPT baseline is produced manually by the writer in ChatGPT with the same files; automation of the baseline is out of scope.]`
**Consequences (testable):**
- A comparison record holds: project, Banhall model, baseline product and model, model-equivalence caveat (Open Question 3), blind preference, Deviation count per draft and the counting method, Corrections-to-acceptable per draft, whether the project was used during development, date, judge.
- The Deviation Inventory (FR-12) is not used to count Deviations for either draft in a comparison; the writer counts both by hand.
- The evaluation set holds at least five projects: 25001 (used during development, reported separately), at least two projects untouched during development, and at least one 100–200-hour project (UJ-5).
- SM-1 and SM-2 are computed from these records, excluding development projects.

### 4.6 Input capacity
**Description:** Attaching and entering generation context are different things: a project can hold a writer's whole working set, but the context budget (12 documents today, admin-configurable) decides what the model reads. This feature makes that distinction visible; it does not raise the budget. Realizes UJ-1, UJ-3.

#### FR-17: Context exclusions are visible
A project can attach at least 40 Supporting Documents, and before reading the draft the writer sees which documents entered generation context and which did not, in the trust order used. `[ASSUMPTION: 40 attached; the context budget stays at its configured value (12 today) for MVP, filled in trust order; raising it is Open Question 6.]`
**Consequences (testable):**
- Attaching 40 documents succeeds; the Brief lists every document as included, condensed, or not included.
- The configured context cap is shown to the writer, not silent; a document excluded by the cap is never described as "used".

**Notes:** CAD/DWG attachments are a `[NON-GOAL for MVP]` — see §5 and addendum for the conversion path.

## Cross-Cutting NFRs and Constraints
- **Provenance:** every Brief entry, Compliance Note and Completion Report line is stored with the generation and linked to source passages; nothing in the draft is unexplained.
- **No fabrication:** Brief derivation and revisions obey the existing no-fabrication Locked Rule; blocked items are the mechanism for missing facts.
- **Human apply:** all prose changes remain Proposals a human applies (agents propose, humans apply).
- **Latency and cost:** the Brief, each Self-check and its single repair, and the FR-5 consistency pass each add one model call (call-by-call budget in addendum §C); the end-to-end 2x budget and overrun reporting are specified as SM-C2. `[ASSUMPTION: 2x is acceptable for the quality gain; confirm.]`
- **Privacy:** Brief content is project-scoped; nothing derived enters the Brain or another project without the existing approval flows.
- **Retention of Claim Exclusions:** the stored Brief enumerates, per project, what was deliberately left out of a CRA submission. Exclusion reasons are scoped to eligibility (see Glossary) so the record reads as a claim-scoping decision, not as concealment; retention period and framing need a compliance read before this NFR ships (Open Question 9).
- **Determinism where it matters:** identical inputs reuse the Brief (FR-4) so drafts do not drift between runs for reasons the writer cannot see.

- **Writer effort ceiling:** the Dump is the maximum required input. Any feature that requires the writer to author a new artifact violates this PRD.
- **Locked Rules are not negotiable here:** changing CRA-derived limits is an `Ask First` product-domain amendment, not a generation change.
- **Role permissions unchanged.**

## 5. Non-Goals (Explicit)
- Embedding ChatGPT's chat inside the tool (Bryce's follow-up; separate decision).
- CAD/DWG ingestion (backlog, first week of October per Bryce; ~10% of PDs).
- Making Michael's per-section multi-select flow the default path (deferred; see §6.2).
- Changing Locked Rules, role permissions, Brain ingestion or the uploader.
- Replacing the writer's judgement: the tool derives structure and proposes; the writer decides.
- Optimising an LLM self-score (see SM-C1).

## 6. MVP Scope

### 6.1 In Scope
- FR-1 to FR-4 (Generation Brief), FR-5 to FR-8 (profile fidelity), FR-9 to FR-11 (draft quality), FR-12 to FR-15 (one-pass convergence, including compare-to-Reference-PD), FR-16 (Paired Comparison harness), FR-17 at the level of "tell the writer what was included, condensed or left out" (the per-document trust-order display is deferred to make room for FR-15).
- Product-domain amendment recording precedence (FR-6) and the effort ceiling.

### 6.2 Out of Scope for MVP
- FR-17's per-document trust-order display (the order in which documents filled the context) — v1.1; MVP shows included / condensed / not included only. Traded for FR-15 in MVP (decision 2026-09-09: comparing to a known-good PD is Larry's own 70→80 loop, and leaving it out would keep him in ChatGPT for exactly that step).
- Per-section multi-select generation (Michael's Friday idea): v2, once the Brief exists — it is the Brief at paragraph granularity with choices. `[NOTE FOR PM: revisit after Friday.]`
- Raising the hard document cap to 40 in context (only the visibility part ships).
- CAD/DWG.
- Automated ChatGPT baseline generation.

## 7. Success Metrics

**Primary**
- **SM-1: Paired Comparison win** — on at least four non-development projects (including at least one 100–200-hour project), the writer blind-prefers the Banhall draft in at least three of four, and the Banhall draft has at most half the Deviations of the ChatGPT draft, counted by the same manual method; 25001 is reported alongside as the development project. Judging starts after Larry's vacation (Why Now; addendum §D). Validates FR-1–FR-10, FR-16.
- **SM-2: Corrections-to-acceptable ≤ 1** — a draft reaches "acceptable" after one Coordinated Revision on at least three of four non-development projects; a 16-item list mixing rule and content Deviations is accounted for 16/16 in one pass on every harness run. Validates FR-12–FR-14.
- **SM-3: Zero writer-authored artifacts** — no writer produces a Storyline, Claim Exclusions, a Confidence Map or Glossary Terms offline for a Banhall project after launch (self-reported weekly by Larry and Tracy through September). Validates FR-1–FR-3, FR-14.

**Secondary**
- **SM-4: Zero silent overrides** — every profile instruction not applied appears in a Compliance Note; no "silently overridden" report from a writer. Validates FR-6–FR-8.
- **SM-5: ChatGPT drafting drops** — writers report using ChatGPT for PD drafting on fewer projects each week through September (they may keep it for other work); "comparing to my own reference" counts as drafting, which is why FR-15 is in MVP. Validates the vision, FR-15.

**Counter-metrics (do not optimize)**
- **SM-C1: Draft length and self-score** — LLM judges reward length and inflate self-grades; word counts must not rise toward the caps, and a numeric self-score is never a target. Counterbalances SM-1.
- **SM-C2: Generation time and cost** — stays within 2x today's single-mode run; a run that exceeds its repair budget (one repair per section) is reported as an overrun in the scorecard, not absorbed. Counterbalances SM-1, SM-2.
- **SM-C3: QA gate failures and fabrication flags** — must not increase; the Brief must not introduce facts. Counterbalances SM-1.
- **SM-C4: Writer interruptions** — the Brief must not become a required step; time-to-first-draft with no Brief interaction must not grow beyond SM-C2. Counterbalances SM-3.
- **SM-C5: Brief-edit burden** — the share of generations where the writer substantially rewrites a derived Brief entry (Storyline edit distance above a set threshold, or more than a third of entries changed) must fall over September, not rise; a writer re-authoring the Brief every run has moved the offline work into the tool, which SM-3 alone would not catch. Counterbalances SM-3.

## 8. Open Questions
1. Is Larry's Section 246 complaint a disagreement with the locked 50-line/350-word cap, or a House Rule leaking through? His settings document decides; get it before Friday.
2. Which generation mode does Larry use today (single, compare, iterative) and does he know `iterative` exists? Determines whether FR-5 is a default change or a discovery problem.
3. Model: Larry asked outright whether Sol is the right choice, and Michael noted the API model is not the ChatGPT chat product. Is "Sol" via OpenRouter the same behaviour as ChatGPT's Sol, and should the Paired Comparison also try Sonnet/Opus? Resolve, or record the caveat on every comparison record, before SM-1 runs.
4. Who judges the Paired Comparison besides Larry, and is 25001 plus three projects enough for Michael to sign off?
5. Must the Brief be approved before drafting for some writers (Michael's stepwise idea) — an optional gate setting, or v2 only?
6. Document cap: MVP keeps the configured context cap (12) and ships visibility only (§6.2, FR-17). When does the cap rise toward 40, and what triggers it — a writer hitting the cap on a real project, or a cost decision?
7. Has the Sept 8 bulk-edit change already improved the "4 of 16" behaviour? Re-run Larry's Rev G list before FR-13 is scheduled.
8. Where does the Compliance Note live in the editor without cluttering the draft?
9. Retention and framing of stored Claim Exclusions: what retention period applies under the Pre-Claim Approval documentation regime? Owner: Michael (or whoever he names on the Banhall side); revisit before the Provenance NFR ships.

## 9. Assumptions Index
- §4.1 — the Brief is shown but never gates generation; multi-select is an optional deeper mode.
- §4.2 — Locked Rules stay locked including 246 caps.
- FR-5 — ordered generation with prior-section context becomes the default for every mode (ungated/gated split is decided, not assumed).
- FR-8 — writers keep supplying the settings document per project; profile and document paths behave the same.
- FR-15 — Larry will supply 25001 as a Reference PD.
- FR-16 — the ChatGPT baseline is produced manually.
- FR-17 — 40 attached; context budget stays at its configured value for MVP, filled in trust order, rest reported; the per-document order display is v1.1.
- NFR — 2x latency/cost is acceptable.
- Discovery (from `.memlog.md`, not tagged inline by design) — Larry is on single/compare with Sol (Open Question 2); 25001 is the development/reference project; Friday 2026-09-12 draft target; the effort ceiling is the Dump.
