---
name: Adversarial review — 2026-09-09 spine update (AD-23..AD-30)
target: architecture-Banhall-2026-09-03/ARCHITECTURE-SPINE.md (2026-09-09 update)
against: _bmad-output/specs/spec-pd-generation/stories.yaml (lanes: schema, pipeline, profile, ui, chat, eval)
lens: "construct two units one level down that each obey every AD to the letter yet still build incompatibly"
created: 2026-09-09
---

# Adversarial review: AD-23..AD-30 vs the six pd-generation stories

## Verdict

**FAIL — 2 critical, 4 high, 3 medium, 1 low.** The four-tier precedence, the
Generation Brief, the Self-check → Compliance Note pipeline and the
Deviation Inventory are each specified from a different unit's point of
view, and the seams between units are not closed with a shared data shape
the way AD-3 (closed writer list) or AD-4 (single insert point) close their
seams. A team could implement stories 1-6 exactly as AD-23..AD-30 read and
still ship a Brief with two competing "latest version" semantics, a
Compliance Note that cannot answer "which paragraph," and a Storyline
question that has nowhere to live. Every attack below is grounded in the
current schema/code (verified against `convex/schema.ts`,
`convex/writerProfiles.ts`, `shared/styleOverrides.ts`,
`convex/ai/chatEvidence.ts`, `convex/generations.ts`,
`src/lib/components/generation/CandidateSelection.svelte`), not
speculation about unbuilt code.

## Attacks — Critical

### C1. The Storyline question has no table to live in
- **Units:** story 1 (schema/derivation, owns `generationBriefs` /
  `generationBriefEntries`) and story 2 (pipeline, owns the per-section
  Self-check chain and is the *only* writer of `complianceNotes` per AD-25:
  "No unit other than the section chain writes `complianceNotes`").
- **What each did legally:** Story 2's Self-check call is the only place a
  Storyline/section contradiction can be *detected* (AD-25: Self-check
  "returns verdicts against the Storyline..."). Following AD-25 to the
  letter, story 2 records that verdict as a `complianceNotes` row — the only
  table it is allowed to write, with `tier: locked | org_enforced | conflict
  | missing_fact | none` and no value for "contradicts the Storyline."
  Story 1, following CAP-1/AD-23 to the letter, builds the storyline-question
  UI surface reading `generationBriefs`/`generationBriefEntries` — the only
  place AD-23 says a Storyline question is "surfaced in the Brief" — whose
  `generationBriefEntries.group` enum (`storyline | claimExclusion |
  confidenceMap | glossaryTerm`) has no slot for a question either.
- **Incompatibility:** AD-23 says the contradiction is "surfaced in the
  Brief"; AD-25 says only the section chain may write the table that
  detects it, and that table has no field for it. Built as specced, either
  (a) story 2 quietly repurposes a `complianceNotes` tier value to mean
  "Storyline question," which story 1's Brief-rail query never reads
  (EXPERIENCE.md's `storyline-question` pattern reads the Brief, not
  Compliance Notes), so the question never appears where CAP-1 requires it;
  or (b) story 1 invents a `generationBriefEntries` write from inside the
  section chain to satisfy CAP-1, which violates AD-25's closed-writer
  clause for that call site's output the same PR is supposed to enforce.
- **Closing AD text:** Extend AD-23 (or add AD-23a) with a fifth
  `generationBriefEntries.group: "storylineQuestion"` row shape
  `{sectionEvidence, sectionSourceId/exactExcerpt, storylineBasis,
  resolvedBy: "use_evidence" | "keep_storyline" | null}`, and amend AD-25 to
  read: "the section chain's only write is one `complianceNotes` row per
  verdict *and*, when the verdict is a Storyline contradiction, one
  `generationBriefEntries` row of group `storylineQuestion` inserted by the
  same call — this is the one exception to AD-25's closed-writer clause,
  named here rather than implied by CAP-1."

### C2. `complianceNotes` is keyed by section; the Deviation Inventory needs a paragraph
- **Units:** story 2 (owns `complianceNotes`, AD-25) and story 5 (owns the
  Deviation Inventory tool, AD-28).
- **What each did legally:** AD-25's `complianceNotes` row is
  `{generationId, candidateRunId?, section, source, instruction, outcome,
  tier, reason, repaired}` — section-granularity only (`section: "242" |
  "244" | "246"`), matching CAP-5/CAP-9's "one Self-check call" *per
  section*. Story 5, following AD-28 and CAP-12 to the letter, must list
  "every paragraph appears exactly once" with "each rule Deviation names its
  rule" and, per EXPERIENCE.md's `inventory-checklist` pattern and UJ-2
  ("244 ¶3 — paragraph rule..."), a paragraph-level locator built via
  `locateSectionParagraph(section, paragraph)`
  (`_bmad-output/.../surface-map.md`) against `src/lib/reportSections.ts`.
- **Incompatibility:** AD-28's rule is "the Deviation Inventory tool reads
  `complianceNotes` by `generationId` (AD-25) plus the report's paragraphs
  through `src/lib/reportSections.ts`, lists every paragraph once" — but
  `complianceNotes` carries no paragraph index, so there is no join key
  between a section-level compliance verdict and one specific paragraph
  inside that section. Two sections-worth of rows and N paragraphs per
  section cannot be matched deterministically; story 5 is left to guess
  which paragraph a section-level "not applied" belongs to, and a second
  implementer building the same tool from the same AD text could
  legitimately guess differently (e.g., attach every section's Deviations to
  its first paragraph vs. its last vs. every paragraph).
- **Closing AD text:** Amend AD-25: `complianceNotes` gains
  `paragraphIndex: v.optional(v.number())`, populated by the section-chain
  Self-check when the verdict is paragraph-scoped (i.e., whenever
  `resolveEffectiveOverrides`'s paragraph-rule categories —
  `paragraphDensity`, `sentenceConstruction`, `openingClauses` — are the
  source of the verdict); rows whose instruction is section-wide (Locked
  skeleton caps, glossary/claim-exclusion checks that can span the section)
  keep `paragraphIndex: undefined` and the Inventory groups them under the
  section heading, not a specific paragraph row.

## Attacks — High

### H1. Two owners can insert a `generationBriefs` version for the same `inputsHash`
- **Units:** story 1 (derivation stage, re-derives/reuses on `inputsHash`)
  and story 4 (Brief rail, `brief-entry`'s "Regenerate with this Brief" and
  the `storyline-question`'s "Use the section's evidence" flow).
- **What each did legally:** AD-23: "The same `inputsHash` reuses the stored
  Brief... a writer edit inserts a new version and never mutates an old
  one." Story 1 builds the derivation-reuse lookup on
  `by_projectId_and_inputsHash` for every new generation request. Story 4
  builds the edit-save mutation ("Regenerate with this Brief" per
  `brief-entry` in EXPERIENCE.md) that inserts a new version when the writer
  edits an entry — a second, independent insert path into the same table
  for the same `(projectId, inputsHash)` pair, since editing a Brief entry
  does not change any transcript or document and therefore does not change
  `inputsHash`.
- **Incompatibility:** Unlike AD-3's reports (closed 7-writer list, each
  fenced on `expectedRevisionNumber`) or AD-6's digest selection (CAS on
  `expectedSelectionId`), AD-23 names no closed writer list for
  `generationBriefs` and no fence. Once a second edit lands, two versions
  share one `inputsHash`; AD-23 never says which version "the same
  `inputsHash` reuses" — highest `version`, most recently edited, or the one
  a specific in-flight generation was launched from. A plain "Generate" on
  unchanged inputs (story 1's reuse path) and a "Regenerate with this Brief"
  fired seconds earlier (story 4's edit path) can each read a different
  Brief version as "the" stored one, with no version conflict ever
  surfaced — the two units never even call the same function.
- **Closing AD text:** Amend AD-23: "`generationBriefs` has exactly two
  writers, both named here: `internal.brief.deriveOrReuse` (derivation
  stage, story 1) and `briefs.saveEntryEdit` (writer edit, story 4); reuse
  always selects `MAX(version)` for `(projectId, inputsHash)`; every
  generation request that reuses a Brief stamps
  `generations.briefId`+`generations.briefVersion` at `reserved`, and
  `Regenerate with this Brief` is a `requestGeneration` call carrying the
  edited `briefId` explicitly, never a bare inputsHash lookup."

### H2. "Tier" is computed twice: once in `getEffectiveWriterStyle`, once in the section chain
- **Units:** story 3 (owns `getEffectiveWriterStyle`, AD-26) and story 2
  (owns `complianceNotes`, AD-25).
- **What each did legally:** Confirmed in code:
  `convex/writerProfiles.ts:215-237`'s `getEffectiveWriterStyle` today
  returns only `{customInstructions, styleOverrides}`; AD-26 requires story 3
  to widen its return to add "a per-category outcome `{category, mode,
  effective, tier}` and a `profileState`." Separately, AD-25 requires story
  2 to produce "deterministic rows from `resolveEffectiveOverrides`" for the
  six style categories — but `resolveEffectiveOverrides`
  (`shared/styleOverrides.ts:134-145`) returns only a boolean waive-map, no
  tier. To satisfy AD-25's letter, story 2 must independently re-derive
  `tier: locked | org_enforced | conflict | missing_fact | none` from the
  same house-mode/profile inputs `getEffectiveWriterStyle` already classifies
  for story 3.
- **Incompatibility:** Two classifiers for the same six-category precedence
  question, built by two stories that AD-26 explicitly says exist to
  prevent this ("three call sites computing precedence three ways"). If
  story 3 lands first (per stories.yaml's parallel-after-2 sequencing, story
  3 and story 2 can literally run in parallel — both listed "4/5/6 parallel
  after 2," but 2 and 3 are *not* ordered relative to each other in the
  lane list, story 2 is `pipeline` and depends on nothing named story 3),
  the two tier classifications can disagree on an edge case (e.g., a
  category at house mode `off` with a profile override present) without
  either unit's test catching it, because each unit's test fixture is
  local to its own function.
- **Closing AD text:** Amend AD-26: "`getEffectiveWriterStyle`'s
  per-category outcome is the *only* place tier is computed; the section
  chain's `complianceNotes.tier` for the six style categories is copied
  verbatim from that outcome's `tier`, never recomputed from
  `resolveEffectiveOverrides` directly. `convex/lib/glossaryMatcher.ts`-style
  small pure libs may compute intermediate booleans, but the tier label
  itself has one function."

### H3. Two "included" truths: generation's context budget vs chat's evidence budget
- **Units:** story 4 (Brief Inputs band / inclusion-row, reads
  `generationSources.contextBudget`/AD-30's `inclusion`) and story 5 (chat
  tools reading evidence via `convex/ai/chatEvidence.ts`).
- **What each did legally:** AD-30 amends AD-11 for *generation's* context
  assembly only: `generationSources.inclusion` is written by
  `convex/ai/trustedContext.ts`'s `DEFAULT_CONTEXT_BUDGET` (`maxDocuments:
  12`). Confirmed separately in code: chat has its own
  `DEFAULT_CHAT_EVIDENCE_BUDGET` in `convex/ai/chatEvidence.ts`
  (`totalTokens: 60_000`, `maxDocuments: 12`, independently computed
  per-turn `TrustedContextSource` results) — a second budget object with
  its own inclusion/truncation outcome that AD-30 never touches ("Binds:
  CAP-11, CAP-17 (stories 2, 4)" — chat/story 5 is not in AD-30's bind
  list). Story 5's Deviation Inventory and "missing facts" reply, built
  per AD-28/CAP-14, legally read whatever chat's own evidence assembly
  decided was included, with no obligation to agree with the Brief's
  `inclusion` row for the same document.
- **Incompatibility:** A document can read `condensed` in the Brief Inputs
  band (generation-time budget) and simultaneously be fully included, or
  dropped entirely, in the same turn's chat evidence (chat-time budget,
  different total, different per-document share, run against report text +
  analysis + documents together rather than transcripts + documents alone).
  A writer asking chat "why was document X cut?" gets an answer computed
  against a different budget than the one the Brief showed them, and
  nothing in either AD says the two must agree or even be labelled as
  different scopes to the writer.
- **Closing AD text:** Extend AD-30: "Chat evidence assembly
  (`chatEvidence.ts`) is a distinct budget scope from generation's context
  cap and must never render an inclusion word (`included`/`condensed`/`not
  included`) to the writer without a scope qualifier — chat UI copy names
  it 'in this reply' never bare 'included,' so the two budgets' outcomes
  are never visually conflated with the Brief's per-document status."

### H4. `inputsHash` — undefined ingredients, and story 1/story 4 can read it differently
- **Units:** story 1 (computes `inputsHash` in the derivation stage) and
  story 4 ("Regenerate with this Brief" / Storyline-edit flow that must
  decide whether a new generation reuses or re-derives).
- **What each did legally:** AD-23 names `inputsHash` as the reuse key but
  never specifies its ingredients (transcripts+documents only? the frozen
  `writer_storyline` source row AD-5's 2026-09-09 addendum says is frozen
  "before the stage runs"? the profile hash AD-26 governs?). Story 1,
  reading AD-5's addendum, could reasonably include the writer_storyline
  source in the hash (it is a frozen `generationSources` row like any
  other, "byte-for-byte" per AD-5). Story 4's "Use the section's evidence"
  flow rewrites the Storyline claim and "offers 'Regenerate with this
  Brief'" — if the writer edits the Storyline text, and `inputsHash` is
  defined over `generationSources` content (including a re-frozen
  `writer_storyline` row for the *edited* text), the hash changes and the
  derivation stage re-derives from scratch, discarding the edited entries
  in the other three Brief groups the writer already curated — legal under
  AD-23's literal text ("changed inputs re-derive it") but wrong under
  CAP-1's intent (the edit should only touch the Storyline group).
- **Incompatibility:** AD-23 and CAP-4 both use "inputs" as if its scope
  were self-evident; it is not — whether the writer-supplied/edited
  Storyline counts as an "input" that changes `inputsHash`, or is instead
  Brief *content* excluded from the hash the way `generationBriefs` itself
  is excluded from `generationSources`, changes whether an edit is cheap
  (new version, same hash) or destructive (full re-derivation). The two
  units can each build a self-consistent, AD-compliant implementation that
  disagrees on this one bit.
- **Closing AD text:** Amend AD-23: "`inputsHash` is computed over the
  `contentHash` of every frozen `generationSources` row *excluding* `kind:
  "writer_storyline"` — the Storyline itself is Brief content, versioned by
  `generationBriefs.version`, not an input that re-derives the Brief. A
  Storyline edit alone never changes `inputsHash` and never triggers
  re-derivation of Claim Exclusions, Confidence Map or Glossary Terms."

## Attacks — Medium

### M1. `compare` mode: an optional `candidateRunId` lets the rail and the chain disagree on whose notes are whose
- **Units:** story 2 (writes `complianceNotes.candidateRunId?` from the
  per-candidate chain, AD-24: "`compare` runs the chain once per
  candidate") and story 4/story 5 (read `complianceNotes` for display: the
  Editor's compliance-line, the QA rail's compliance-section, the chat
  Deviation Inventory).
- **What each did legally:** AD-25's index is `by_generationId_and_section`
  only — no `candidateRunId` in the index — and `candidateRunId` is
  optional on the row, mirroring `aiUsage.candidateRunId` (already
  `v.optional`). Story 2, running the AD-24 chain once per candidate in
  `compare`, legally stamps every note it writes with its candidate's
  `candidateRunId`. The reading units (EXPERIENCE.md names only
  `Editor.svelte`/`QAScorePanel.svelte`, the *post-selection*, single-report
  surfaces) have no candidate context to filter by — but compare mode's
  actual pre-selection UI is `CandidateSelection.svelte` +
  `ReadOnlyEditor.svelte` + per-candidate `QARailPanel.svelte`
  (confirmed in code), none of which EXPERIENCE.md's Component Patterns
  table mentions as a compliance-line/compliance-section host.
- **Incompatibility:** Nothing says which surface renders compliance data
  during `compare` before selection, or how it scopes a query with an
  index that cannot filter by candidate. A literal reading of AD-25 ("one
  query" reads `complianceNotes`) run against a `compare` generation before
  selection returns rows from every candidate interleaved for the same
  section, and whichever unit builds that query first decides — by
  omission, not by AD text — whether it filters client-side by the tab's
  candidate or shows a merged/wrong set.
- **Closing AD text:** Extend AD-24/AD-25: "`compliance-line`/
  `compliance-section` in `compare` mode render inside the per-candidate
  `ReadOnlyEditor`/`QARailPanel` pair (`CandidateSelection.svelte`), scoped
  by the tab's `candidateRunId`; `complianceNotes` gains index
  `by_generationId_and_candidateRunId_and_section`; the post-selection
  `Editor.svelte`/`QAScorePanel.svelte` path reads rows whose
  `candidateRunId` equals the generation's selected candidate (or is
  undefined, for `single`/`iterative`)."

### M2. AD-27 slot labels have no enum and clash with the codebase's own `callSite` convention
- **Units:** story 1 (`brief` slot, `convex/ai/brief.ts`) and story 2
  (`section:<n>`, `selfCheck:<n>`, `repair:<n>`, `consistency` slots,
  `promptProgram.ts`/`pipeline.ts`), both writing into `aiUsage.callSite:
  v.string()` — a free-text field, confirmed no enum in `convex/schema.ts`.
- **What each did legally:** Every existing generation call site in the
  codebase prefixes with the domain (`"generation:analyzer"`,
  `"generation:condense"`, `"generation:retrieval_brief"` —
  confirmed via grep). AD-27's literal vocabulary is unprefixed (`"brief"`,
  `"section:242"`, `"selfCheck:242"`). A story-1 implementer and a story-2
  implementer, each independently following the codebase's own established
  `<domain>:<subtask>` convention rather than AD-27's bare literal, could
  each legally prefix their calls (`"generation:brief"`,
  `"generation:section:242"`) — consistently with each other, but
  inconsistently with AD-27's literal text and with whatever code computes
  "the generation scorecard reports counts per slot... measured from
  `aiUsage` `by_generationId`" (string-matching against the bare
  vocabulary would then silently under-count or zero out every slot).
- **Incompatibility:** No schema enum enforces the vocabulary; the only
  fence is prose, and the codebase's own convention actively pulls
  implementers toward a different shape than the one AD-27 states.
- **Closing AD text:** Amend AD-27: "`callSite` for a slotted call is
  exactly `generation:<slot>` (matching the existing `generation:` prefix
  convention), e.g. `generation:brief`, `generation:section:242`,
  `generation:selfCheck:242`; the scorecard parses the slot as the text
  after the first `:`. A validator in `convex/ai/instrument.ts` rejects an
  unrecognized slot at call time rather than letting it reach `aiUsage`
  unclassified."

### M3. "Stop after this section" produces a `completed` generation AD-8/AD-3 have no path for
- **Units:** story 2 (pipeline, owns generation completion under AD-24)
  and story 4 (UI, owns the "Generate the rest" `[ASSUMPTION]` resume
  action per EXPERIENCE.md's Stopped-after-a-section state).
- **What each did legally:** AD-24: "the remaining sections stay
  ungenerated and the generation completes with what exists" — story 2
  legally lands `generations.status: "completed"` (AD-2's vocabulary has no
  "partial" state) with only 1-2 of 3 sections present. AD-8's parse
  contract assumes `buildTiptapDocument` always emits three H2 sections;
  AD-3's `createGeneratedReportArtifacts` is the closed creation-writer for
  a `reports` row and is not on record as accepting a partial section set,
  nor as the writer for a later "Generate the rest" resume. Story 4,
  building "Generate the rest" per its own `[ASSUMPTION]` tag, has no named
  AD-3 writer to call — resuming a `completed` generation to append the
  missing sections is not one of AD-3's seven revision writers nor one of
  its two creation writers.
- **Incompatibility:** Story 2 can legally emit a `completed` report
  missing H2 sections; story 4 can legally build a resume affordance with
  no defined write path, because AD-3's closed list — the mechanism AD-15
  says protects against exactly this — was never extended for this new
  state.
- **Closing AD text:** Extend AD-2/AD-3: "A `completed` generation from a
  stopped ordered chain sets `generations.stoppedAfterSection: "242" |
  "244"`; `buildTiptapDocument` renders only the sections present plus a
  `[NOT GENERATED]` placeholder heading for the rest, satisfying AD-8's
  three-heading contract; 'Generate the rest' is an eighth `AD-3` writer,
  `generations.resumeStoppedGeneration`, which re-enters the AD-24 chain at
  the next un-drafted section and is fenced on `generations.status ===
  "completed" && stoppedAfterSection !== undefined`."

## Attacks — Low

### L1. `comparisons.contentHash` pins the wrong artifact
- **Units:** story 6 (`comparisons` table/form) and the undefined
  human "someone other than the judge" who strips the draft to plain text
  (SPEC Constraints; no story owns this step).
- **What each did legally:** AD-29 pins `comparisons` to `(reportId,
  revisionNumber, contentHash)` "like `writerReviews`" — story 6, following
  AD-3/AD-8 convention, computes `contentHash` as `sha256(reports.content)`
  over the canonical Tiptap JSON. The SPEC's stripping step happens
  entirely outside any story's code, by hand.
- **Incompatibility:** The judge never sees `reports.content`; they see a
  manually stripped plain-text derivative with no hash of its own. A
  `comparisons` row can prove which structured revision *existed* at
  record time but proves nothing about what was actually pasted in front
  of the judge — a stale or mis-copied strip is undetectable by the
  pinning AD-29 specifies.
- **Closing AD text:** Extend AD-29: "`comparisons-form` requires pasting
  the stripped plain text into the record itself (`banhallDraftText`,
  `baselineDraftText`, both stored); `contentHash` continues to pin the
  structured revision, and a stored `sha256` of `banhallDraftText` against
  a plain-text extraction of that same revision (computed server-side at
  record time) is checked and flagged, not blocked, on mismatch."

## What holds

- AD-4/AD-28's boundary is genuinely closed: `saveProposal` stays the sole
  `chatProposals` writer and `applyProposal` is explicitly untouched by
  every story — no attack surface found here across stories 2/4/5.
- AD-19's project-scope exclusion for Brief content ("excluded from every
  `brainSources` nomination path and from the Brain retriever") has no
  competing claim from any of the six stories; nothing in stories 1-6
  touches Brain ingestion.
- AD-9/AD-11's routing-point and trusted-context-boundary invariants are
  inherited, not re-implemented, by every new call site named in AD-23..30
  — no story proposes a second `clientForModel`-equivalent.
- AD-16→AD-26's Locked-Rules-never-waivable floor is respected identically
  by every attack found above; none of the two-owner clashes touch Locked
  Rule enforcement itself, only who *reports* the precedence outcome.
- The `iterative` mode boundary (AD-24: "`iterative` mode and its approval
  gate are unchanged") is not contested by any story — no attack found
  where a unit reaches into `generationSectionRuns`/`approveSectionDraft`.
