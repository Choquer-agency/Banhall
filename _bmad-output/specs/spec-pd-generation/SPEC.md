---
id: SPEC-pd-generation
companions:
  - glossary.md
  - touchpoints.md
  - measurement-protocol.md
  - user-journeys.md
  - ../../planning-artifacts/ux-designs/ux-Banhall-2026-09-09/DESIGN.md
  - ../../planning-artifacts/ux-designs/ux-Banhall-2026-09-09/EXPERIENCE.md
  - ../../planning-artifacts/architecture/architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md
  - ../../../docs/product-domain.md
  - ../../../docs/ai-architecture-plan.md
  - ../../../convex/_generated/ai/guidelines.md
sources:
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-09/prd.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-09/addendum.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-09/extract-codebase.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-09/extract-web-research.md
  - ../../planning-artifacts/prds/prd-Banhall-2026-09-09/extract-competitor-mechanisms.md
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# PD generation: better than the dump

## Why

A pain to solve. The lead writer gives Banhall the same inputs he would paste into ChatGPT and gets a PD that is at best marginally better after ten revisions; to make it converge he hand-builds a storyline, a claim exclusion list, a findings confidence map and a glossary offline, and the assistant, asked how to improve, asks him for more documents. His verdict: "at a loss as to how to make it converge." The owner's bar: with the Dump as the only required input, Banhall's PD must be clearly better than ChatGPT's for the same Dump, proven by a blind Paired Comparison, and correction must be one coordinated pass. Backdrop: a solid program by end of September, the lead writer's adoption as the test, and the CRA Pre-Claim Approval regime (2026-04-01) raising the bar on specific, defensible narratives. Vocabulary in `glossary.md`; every capitalised term below is defined there.

## Capabilities

- **CAP-1**
  - **intent:** A writer can supply a Storyline, or receive one derived from the Dump before any section is drafted, and every Storyline claim shows the Confidence Map entries it rests on.
  - **success:** The generation record stores the Storyline and its origin (writer-supplied | derived | derived-then-edited); every section prompt contains it; a Self-check contradiction whose section evidence is stronger than the Storyline's basis (Confidence Map: established vs. partial or unresolved) is surfaced in the Brief as a Storyline question with both sides, not repaired away — a fixture whose Transcript contradicts a derived Storyline claim yields that question; three Transcripts produce one Storyline with their disagreements listed in the Confidence Map.

- **CAP-2**
  - **intent:** The system derives Claim Exclusions, a Confidence Map and Glossary Terms from the Dump, each entry tied to its source passage and each exclusion carrying an eligibility reason.
  - **success:** On an adversarial paraphrase fixture at least 95% of excluded claims are absent from the draft and every remainder is flagged; every Confidence Map entry cites a Transcript or Supporting Document passage (digest-sourced entries marked); a rule-based term matcher plus model classification replaces or flags at least 95% of known synonyms on a fixture; every Claim Exclusion carries an eligibility reason (business risk, routine engineering, outside the claim period, not technological).

- **CAP-3**
  - **intent:** The Brief is visible beside the draft, editable entry by entry, and never required.
  - **success:** Generation completes with no Brief interaction; an edited entry is used verbatim next run and stored as writer-edited with edit magnitude (changed entries, Storyline edit distance); the only writer actions offered are supply-a-Storyline, edit, or leave.

- **CAP-4**
  - **intent:** Regeneration with unchanged inputs reuses the stored Brief; changed inputs re-derive it and show the diff.
  - **success:** Two consecutive generations with identical inputs share one Brief id; adding a Transcript re-derives the Brief and lists added and removed Confidence Map entries.

- **CAP-5**
  - **intent:** Sections are generated in the Writer Profile's Build Order with prior sections as context, each paragraph's Self-check run before output, ungated in `single` and `compare`.
  - **success:** The generation record lists the production order and it matches the profile's Build Order (default 242 → 244 → 246 with prior-section context, never parallel); a failed Self-check triggers one repair and the Compliance Note records it; in `single`/`compare` no approval checkpoint exists, each section is shown as it completes, the writer may stop at any point, and one consistency pass over the assembled draft runs before the last section is shown; `iterative` keeps its gated behaviour.

- **CAP-6**
  - **intent:** Precedence is Locked Rules > enforced Org Mode > Writer Profile > House Rules, and no tier applies silently.
  - **success:** (The four tiers restate what PSOS-49/50 put in production after the 2026-08-23 report; the new rule is that no tier applies silently.) With every category `writer_choice`, a profile instruction contradicting each of the six House Rule categories is applied; with a category `enforced`, the House Rule applies and the Compliance Note names it org-enforced; an instruction exceeding a line or word cap is applied up to the cap and reported; `docs/product-domain.md` carries the amendment.

- **CAP-7**
  - **intent:** Every generated section carries a Compliance Note listing profile instructions applied and every instruction not applied with its reason.
  - **success:** For N relevant instructions the note accounts for N outcomes; an injected unfollowable instruction appears as not applied with a reason; the note is stored with the generation and visible in the report editor.

- **CAP-8**
  - **intent:** A customized-settings document supplied as Writer's Notes or an attachment is applied with Writer Profile precedence, with an offer to save it to the profile; a disabled or missing profile is reported.
  - **success:** The same settings supplied as profile, as Writer's Notes, or as an attachment produce identical Compliance Notes; the Brief states "no Writer Profile applied" when none is active instead of silently using House Rules.

- **CAP-9**
  - **intent:** Before a section is shown it is checked against the Storyline, Claim Exclusions, Glossary Terms, Confidence Map calibration, profile paragraph rules and Locked Rules, and repaired at most once; unresolved or unreliable facts stay hedged in the prose.
  - **success:** A section with an excluded claim, off-glossary synonym or cap breach is repaired or flagged before display; a fixture with an unreliable fact yields hedged prose and a flat statement fails the check; a Storyline contradiction is raised per CAP-1; the check's outcome and repairs are in the scorecard and the Compliance Note.

- **CAP-10**
  - **intent:** The draft uses one Glossary Term per concept, the profile's paragraph structure and the 242/244/246 skeleton, rendered identically in editor and DOCX export.
  - **success:** Editor and export show the same paragraphs and headings; no paragraph exceeds the profile's density rule where one exists.

- **CAP-11**
  - **intent:** When the Dump exceeds the context budget, the writer is told per document what was condensed or cut before reading the draft.
  - **success:** An over-budget generation shows a per-document line full | condensed | not included in the Brief; cut notices are user-facing, not only in operator logs.

- **CAP-12**
  - **intent:** On request the assistant lists every paragraph, its Writer Profile rule and each Deviation, and the writer can add content Deviations to the same list.
  - **success:** Every paragraph appears exactly once; each rule Deviation names its rule; each content Deviation names the paragraph and instruction; CAP-13 treats both kinds identically.

- **CAP-13**
  - **intent:** Given N items the assistant returns one Proposal addressing all N and a Completion Report marking each resolved | blocked (missing fact and its source) | conflicting (Locked Rule and alternative).
  - **success:** For N ≤ 30 the reply holds exactly one Proposal and N report lines; the Proposal still requires human apply; the live-model chat-behaviour harness with a 16-item fixture mixing rule and content Deviations reports 16/16 on every run.

- **CAP-14**
  - **intent:** Asked how to improve the draft, the assistant proposes concrete changes from the Dump or names the missing facts as questions for the client, never a document for the writer to produce.
  - **success:** The fixture "what can I do to help you converge?" yields a Proposal or a list of missing facts referencing unresolved Confidence Map entries; any reply requesting a writer-authored document fails the fixture.

- **CAP-15**
  - **intent:** Given a Reference PD, the assistant reports specific differences (structure, Storyline, terminology, per paragraph) and offers them as a Coordinated Revision.
  - **success:** The comparison names paragraphs, never a numeric score as primary output; differences that would breach a Locked Rule are listed as conflicting, not applied.

- **CAP-16**
  - **intent:** Michael or Johnny can record a Paired Comparison per project — blind preference, Deviations and Corrections-to-acceptable counted the same manual way for both drafts — stored with the generations.
  - **success:** A comparison record holds project, Banhall model, baseline product and model, model-equivalence caveat, blind preference, per-draft Deviation counts and counting method, per-draft Corrections-to-acceptable, development-project flag, date, judge; the Deviation Inventory is not used for either count; SM-1 and SM-2 are computed excluding development projects (`measurement-protocol.md`).

- **CAP-17**
  - **intent:** A project accepts at least 40 Supporting Documents, and the writer sees which entered generation context, which were condensed and which were left out, with the configured cap shown.
  - **success:** Attaching 40 documents succeeds; the Brief lists every document as included | condensed | not included; the cap is displayed; an excluded document is never described as used.

## Constraints

- The Dump is the maximum required input; any capability that requires the writer to author a new artifact is out of contract. Recorded in `docs/product-domain.md` as an amendment alongside the CAP-6 precedence.
- Locked Rules (242/244/246 skeleton, line and word caps s242 50/350, s244 100/700, s246 50/350, no fabrication) are unchanged; changing them is an `Ask First` product-domain amendment.
- Every prose change is a Proposal a human applies (`chatProposals` + `applyProposal`); no tool mutates report prose directly.
- Ordered generation is ungated by default in `single` and `compare`; the gated path is the existing `iterative` mode only (decided 2026-09-09).
- Call budget per generation: one Brief call, per section one generation + one Self-check + at most one repair, one assembled-draft consistency pass; end-to-end time and cost within 2x today's single-mode run; overruns are recorded in the scorecard, never absorbed silently.
- The context budget (12 documents, admin-configurable) does not change in MVP; CAP-11 and CAP-17 make it visible.
- Brief content is project-scoped and never enters the Brain or another project outside existing approval flows; Claim Exclusion reasons are eligibility categories only.
- Identical inputs reuse the stored Brief; the Brief is keyed by inputs, versioned, and its source citations are validated against frozen `generationSources` rows like provenance. Every Brief entry, Compliance Note and Completion Report line is stored with the generation and linked to its source passages; nothing in the draft is unexplained.
- Paired Comparison outcomes never use LLM self-scores; drafts are stripped to identical plain text by someone other than the judge.
- Convex code follows `convex/_generated/ai/guidelines.md`; new tests live where the gate runs them (vitest `convex/**` project, not `bun:test` files); UI follows the design system (bits-ui primitives, max font weight 500).
- Role permissions, Brain ingestion and the client uploader are untouched.

## Non-goals

- ChatGPT chat embedded in the tool.
- CAD/DWG ingestion (October backlog).
- Per-section multi-select generation as the default path (v2: the Brief at paragraph granularity with choices).
- Raising the context cap toward 40; automating the ChatGPT baseline; the per-document trust-order display (v1.1).
- Replacing the writer's judgement or optimising an LLM self-score.

## Success signal

On at least four non-development projects, including one 100–200-hour project, the writer blind-prefers the Banhall draft in at least three, with at most half the Deviations of the ChatGPT draft for the same Dump; and a 16-item Deviation list is accounted for 16/16 in one Coordinated Revision on every harness run. No writer builds a Storyline, Claim Exclusions, Confidence Map or Glossary Terms offline for a Banhall project after launch.

## Assumptions

- The Brief is shown but never gates generation; multi-select is an optional deeper mode.
- Locked Rules stay locked including the Section 246 caps (Open Question 1 may reveal that the complaint is about the cap itself).
- Writers keep supplying the settings document per project; profile and document paths must behave the same.
- Larry supplies 25001 as a Reference PD and as the development project.
- The ChatGPT baseline is produced manually by the writer with the same files.
- 2x latency and cost is acceptable for the quality gain.
- Larry generates in `single` or `compare` with Sol today.

## Open Questions

- Is the Section 246 complaint a disagreement with the locked cap or a House Rule leaking through? Larry's settings document decides (before 2026-09-12).
- Which generation mode does Larry use, and does he know `iterative` exists?
- Is Sol via OpenRouter equivalent to ChatGPT's Sol, and should the comparison add a Sonnet/Opus arm? Resolve or record the caveat per record before SM-1 runs.
- Who judges besides Larry, and is five projects enough for Michael to sign off?
- Should some writers be able to gate on Brief approval (optional setting) rather than waiting for v2?
- What triggers raising the context cap toward 40?
- Has PR #8's bulk edit already improved the "4 of 16" behaviour? Re-run Larry's Rev G list before CAP-13 is scheduled.
- Where does the Compliance Note live in the editor?
- Retention period and framing of stored Claim Exclusions under Pre-Claim Approval — owner Michael, before the provenance constraint ships.
