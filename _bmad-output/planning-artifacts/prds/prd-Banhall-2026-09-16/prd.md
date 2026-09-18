---
title: Banhall step-by-step PD generation — idea seeds before prose
status: final
created: 2026-09-16
updated: 2026-09-17
supersedes-in-part: ../prd-Banhall-2026-09-09/prd.md (its §5, §6.2, SM-C4 (09-09), OQ-5 (09-09) — see §10)
---

# PRD: Banhall step-by-step PD generation: Idea Seeds before prose
*Working title — confirm.*

## 0. Document Purpose

This product requirements document (PRD) is for Johnny (owner), Michael (product direction) and the downstream user experience (UX), architecture and ticket work. It states what the redesigned **Step-by-step mode** must do. The artificial intelligence (AI) proposes short Idea Seeds per Subsection of the project description (PD) template. The writer selects, edits, gives Feedback and approves; a Running Summary accumulates. Only after the writer signs off on that Summary does the AI generate PD prose.

Today the same mode drafts a whole Section 242, 244 or 246 and asks for approval. The shipped stepper does have a text box to edit the drafted section and a free-text guidance box for regeneration (`IterativeStepper.svelte`). The writers' report that they "cannot edit or give feedback" is a discoverability and unit-of-review problem, not a missing control. The redesign's claim is narrower and stronger: the writer should be choosing ideas, not reviewing 50 lines of prose.

It builds on the 2026-09-09 PRD ("better than the dump") and its spec, which are implemented; that PRD deferred exactly this idea ("Michael's stepwise idea", OQ-5 (09-09), §6.2 per-section multi-select) to v2. This document is that v2 and records the amendments in §10. Inputs: the owner's chat brief of 2026-09-16 and the product design handoff (`input-design-handoff.md`, Google Doc `1cbfdHVOVqQkzLZAM7IDMEGDiRYc040oFKiwb_Mnb2_E`), the codebase extract (`extract-codebase.md`), the prior PRD/spec extract (`extract-prior-prd-spec.md`) and the architecture spine / UX extract (`extract-spine-ux.md`). Vocabulary is anchored in §2; features carry globally numbered functional requirements (FRs); inferences are tagged `[ASSUMPTION]` inline and indexed in §12. Mechanisms, options considered and the cost model live in `addendum.md`, which is not binding.

The first run (2026-09-16) was unattended, so it took the Fast path: gaps are recorded as assumptions and open questions rather than resolved in conversation. Three reviewer passes (rubric and adversarial, `review-*-pass1.md`, `review-*-pass2.md`, `review-*.md`) and two reconciliations (`reconcile-*.md`) shaped this version.

## 1. Vision

A section is the wrong unit of review. By the time Section 242 is written, the AI and the writer have already diverged on what the project *is*, and the writer is hunting through prose for the one wrong framing. What the writer actually wants to decide is positioning: which uncertainty, which experiments count, what was advanced.

The redesign moves that decision earlier and makes it small. Banhall's PD template has thirteen Subsections (five in 242, four in 244, four in 246). For each Subsection, the AI offers three to five **Idea Seeds**. Each is one or two bullets, never prose, tagged with its positioning (conservative, aggressive, technical, alternative angle…) and points at the transcript excerpt it came from. The writer ticks the Seeds that match their read of the project, edits a bullet where the AI is nearly right, types a one-line correction where it is wrong, or asks for a fresh set. Each Subsection's Seeds are conditioned on the decisions made in the Subsections before it. By the time the writer reaches 246, the AI proposes advancements that follow from the experiments the writer picked in 244. A Running Summary grows beside the work. When every Subsection is decided, the writer reads the Summary as one page, fixes anything, and signs off. Only then does Banhall write the PD, with the signed-off Summary as its plan and the Locked Rules unchanged.

Why it matters: the September goal is a program the writers adopt. Larry's Rev A to Rev J experience (ten revisions, "at a loss as to how to make it converge") came from correcting prose after the fact. Michael's read on the 2026-09-09 call was that a stepwise, choose-then-write flow "will be our most effective way to use this". This PRD makes that flow real without touching the one-shot modes writers rely on for small projects.

## 2. Glossary

*Downstream workflows must use these terms exactly. Inherited terms keep their 2026-09-09 definitions and are not redefined here.*

**Inherited ([2026-09-09 PRD §2](../prd-Banhall-2026-09-09/prd.md#2-glossary), verbatim meaning):** PD, The Five Questions, Section 242 / 244 / 246, Transcript, Dump, Writer Profile, Writer's Notes, Supporting Documents, House Rules / Org Mode, Locked Rules, Generation Brief (Brief), Storyline, Claim Exclusions, Confidence Map, Glossary Terms, Build Order, Self-check, Compliance Note, Deviation / Coordinated Revision / Completion Report, Proposal, Corrections-to-acceptable (number of writer correction rounds before a PD is judged acceptable by the reviewing manager).

*Note on "Line":* the report's three H2 headings are labelled `Line 242` etc. In this PRD "Section" is the Canada Revenue Agency (CRA) part and "Line" appears only when the heading itself is meant.

**New in this PRD:**

- **Step-by-step mode** — the generation mode in which the writer decides Idea Seeds per Subsection and signs off a Summary before any prose is written. It is the existing gated mode (stored as `iterative`, currently labelled "Section by section"), relabelled. Aliases in older documents: gated mode, iterative mode. Single and compare modes are unchanged by this PRD.
- **Subsection** — one of the thirteen content roles of the PD template, each belonging to exactly one Section. The list, order and kinds are fixed in FR-2. The role id (as used by the section prompts and QA) is canonical; the Subsection title is its display label. A Subsection is not a paragraph and not a heading. Kinds: *Standard*, *Optional*, *Multiple*.
- **Predecessors** of a Subsection — the Subsections with a lower order in FR-2. **Successors** — those with a higher order. Dependency logic uses this order regardless of the order the writer visits Subsections.
- **Decision Set** of a Subsection — the current active Seed Selections (final wording), Skips and active Feedback instructions of all its Predecessors, plus the Brief version and generation settings frozen at start. It is what a Batch for that Subsection is conditioned on.
- **Context Revision** of a Subsection — a server-computed identifier of its Decision Set plus its own active Feedback. Every Batch records, immutably, the Context Revision it consumed (**consumed revision**).
- **Idea Seed (Seed)** — one AI-proposed idea for one Subsection: one or two bullets, at most 25 words per bullet `[ASSUMPTION: cap chosen to make "1–2 brief bullets" testable]`, one or two Positioning Tags, a support status and its Seed Provenance. A Seed is not prose and never enters the report directly.
- **Seed Batch (Batch)** — the immutable result of one AI request sequence (an **attempt**) for one Subsection: three to five Seeds (or one to three Revised Seeds for a Feedback Batch) and the consumed revision. A Subsection may accumulate several Batches; **Outdated** is a Batch whose consumed revision differs from the Subsection's current Context Revision.
- **Shown Set** — what the writer sees for a Subsection: its current Batch, any Revised Seeds returned by Feedback on it, and Seed Selections carried over from earlier Batches.
- **Positioning Tag (Tag)** — a label from the closed set {Conservative, Aggressive, High-level, Detailed, Technical, Alternative angle} `[ASSUMPTION: set taken from the handoff; the chat brief's "sentiment tags or categories" is exploratory — OQ-8]`.
- **Seed Provenance** — the Transcript or Supporting Document excerpt(s) a Seed cites, byte-validated against the generation's frozen sources. Byte validity proves the excerpt exists; whether it supports the claim is the writer's judgment, aided by the visible excerpt.
- **Support status** — one of *source-supported* (unedited, with at least one valid excerpt), *writer-asserted* (edited by the writer, or unsupported by any valid excerpt). Travels with the Seed into the Summary, the content plan and QA.
- **Seed Selection** — a Seed the writer has ticked for a Subsection, with any Seed Edit. Active Seed Selections form the Summary and the Decision Sets of Successors. A Seed Selection on a skipped Subsection is *inactive*.
- **Selection Revision** — a server-computed identifier of a Subsection's active Seed Selections and their final wording. Subsection Approval binds to it.
- **Seed Edit** — the writer's inline change to a Seed's bullets. The edited wording replaces the AI wording everywhere downstream and sets the Seed's support status to writer-asserted.
- **Seed Feedback (Feedback)** — a recorded request: a short written instruction attached to one Seed (its wording at request time), asking for a targeted revision. It yields a Feedback Batch of one to three **Revised Seeds** in the Shown Set, unselected, with lineage to the request. A Feedback instruction is **active** until the writer withdraws it or its Subsection is skipped; active Feedback on a Subsection is part of its own Context Revision and of the Decision Set of its Successors.
- **Regenerate** — a request for a new Batch for a Subsection. Seed Selections are kept; the **Previous Batch** stays reachable and restorable.
- **Skip** — the writer's explicit decision that an Optional Subsection does not apply. Its Seed Selections become inactive; **Unskip** reverses it.
- **Subsection Approval (Approve)** — the writer's explicit reconciliation of a Subsection's active Seed Selections with the current Context Revision. It records the **approved Selection Revision** and the **approved Context Revision**. When the shown Batch or any selected Seed was produced under a different revision, the same action is presented as **Confirm and approve** and lists what changed. Reversible. There is no separate confirm action.
- **Stale** — a derived state of an approved Subsection: its approved Context Revision or approved Selection Revision no longer equals the current one. A **stale episode** opens when a Subsection first becomes Stale and is disposed when it is re-approved (*resolved*) or when it is skipped or the generation is cancelled (*bypassed*). Never a silent regeneration.
- **Running Summary (Summary)** — the ordered outline of every Subsection's active Seed Selections (or Skip), grouped by Section, kept current as the writer works. Its rendering in the left pane is the **Outline**. Stored separately from report prose.
- **Summary Review** — the full-width reading view of the Summary that opens once every non-Optional Subsection is approved, every Optional one is approved or skipped, and none is Stale.
- **Sign-off** — the writer's explicit confirmation of a Summary version. It freezes that version (including every Skip decision), closes the seed stage, and starts Prose Generation.
- **Prose Generation** — the unattended drafting of the three Sections from the signed-off Summary under the Locked Rules, Writer Profile and House Rules, ending in a report the writer edits as today.

## 3. Target User

### 3.1 Jobs To Be Done

- **Functional:** decide the positioning of every part of the PD before any prose exists, so the first draft is already on the right story.
- **Functional:** stay in control of the AI's framing without reading and correcting long paragraphs.
- **Emotional:** feel that the AI and I agree on what the project is before it writes, so the draft is mine rather than something to fight.
- **Contextual:** work a project in fragments across a day, out of order, on the Subsections I have the clearest picture of, and pick it up where I left it.

### 3.2 Non-Users (v1)

- Writers who want a one-shot draft (single and compare modes, untouched).
- Clients: nothing in this PRD is visible on client-review surfaces.
- Reviewers and managers as a distinct role: they see the same surfaces a writer sees, under existing project access.

### 3.3 Key User Journeys

Larry is Banhall's lead writer. User journeys UJ-1 to UJ-4 are authored scenarios derived from his 2026-09-09 account, not captured sessions. Subsection names in the journeys are shortened; FR-2 holds the canonical names.

- **UJ-1. Larry decides the company context in ninety seconds.**
  - **Persona + context:** Larry, working a 150-hour client project from two Transcripts, wants the tool "on the same page" before it writes.
  - **Entry state:** authenticated; the project has two Transcripts and a saved Writer Profile; on the project page he picks the model and chooses **Step by step**.
  - **Path:** the Brief derives as today. The workspace opens on 242 · Company / Context: a left Outline listing all thirteen Subsections, the right pane showing five Seeds, each one or two bullets with Tags such as *Conservative* and *Detailed*, each with a small provenance chip that reveals the transcript excerpt. He ticks two (checkbox, border and the word "Selected" change together), edits one bullet to replace "legacy platform" with the client's product name (the card now reads "Edited · writer-asserted"), and presses **Approve**, which was disabled until he ticked something.
  - **Climax:** the Outline row turns to approved with a two-line preview of his Seed Selections, and Goal / Problem opens with Seeds that already use the product name he typed.
  - **Resolution:** one of thirteen done; the Summary has its first entry.
  - **Edge case:** a Seed says the platform ran on-premise; nothing in the transcript supports it. The Seed shows "writer-asserted" and no provenance chip. He can still select it; the Summary lists it under that marker so he knows to confirm it with the client.

- **UJ-2. Larry picks the experiments that actually happened.**
  - **Persona + context:** same project, an hour later; 242 done and 244 · Hypothesis approved.
  - **Entry state:** he opens 244 · Experimentation / Iterations, a *Multiple* Subsection.
  - **Path:** five Seeds describe candidate iterations. Three are right. The fourth conflates two runs; he presses **Give feedback**, types "split the caching experiment from the batching one, they were separate sprints", and two Revised Seeds appear beside the original, unselected, the original still selected and marked "has revisions". He ticks the two revisions and unticks the original. The fifth Seed is a guess; he ignores it. He now has five Seed Selections and approves.
  - **Climax:** the Outline shows "5 selected" under Experimentation, and when he opens 246 · Specific technological advancements, each Seed names the uncertainty it resolves and the experiments among his five that support it; two of his experiments support the same advancement, and one appears under no advancement because it failed.
  - **Resolution:** 246 is half decided before he reads a word of prose.
  - **Edge case:** the Batch is weak overall. **Regenerate** returns a new Batch; his Seed Selections stay ticked at the top; **Previous Batch** restores the old one if the new one is worse.

- **UJ-3. Larry changes his mind upstream and the tool tells him what that touched.**
  - **Persona + context:** next morning, everything approved except 246 · Overall goal improvements.
  - **Entry state:** he reopens 242 · Technological uncertainties from the Outline and unticks one uncertainty; the client confirmed it was resolved the year before.
  - **Path:** Technological uncertainties returns to *in progress*; the Outline marks every approved Successor (244 · Hypothesis, 244 · Experimentation, both approved 246 Subsections) **Stale** with the reason "Technological uncertainties changed". Nothing regenerates on its own. He re-approves uncertainties, opens Hypothesis, presses **Regenerate**, sees a Batch that no longer refers to the dropped uncertainty, re-ticks and approves. He judges Experimentation still correct and presses **Confirm and approve**, which lists the changed dependency before accepting.
  - **Climax:** the Outline is clean again and the Summary reflects the change in the right places.
  - **Resolution:** three minutes, not a regeneration of the whole report.

- **UJ-4. Larry signs off the Summary and gets a draft that follows it.**
  - **Persona + context:** all thirteen decided; previous-year status was skipped (first-year project).
  - **Entry state:** the Outline offers **Review summary**.
  - **Path:** the Summary Review is one readable page: three Section headings, thirteen Subsection blocks, the five experiments listed in full with individual Edit actions, the skipped Subsection shown as "Skipped", writer-asserted items marked. The length target, model and Writer Profile are shown read-only beside **Sign off and generate**. He fixes a bullet directly in the Summary, then signs off.
  - **Climax:** Prose Generation runs unattended as a normal generation; the report opens in the editor with 242, 244, 246 drafted from his Summary; the Brief rail and Compliance Notes work as today; the signed-off Summary is one click away, read-only.
  - **Resolution:** he starts editing prose that already tells the story he chose. If the draft still deviates, Coordinated Revision (2026-09-09 FR-13) is unchanged.
  - **Edge case:** Prose Generation fails on 244. The existing recovery surfaces apply; the signed-off Summary is not lost, and **Retry** re-drafts from the same Summary version without re-running the seed stage.

## 4. Features

### 4.1 Step-by-step mode entry and the Subsection Outline

**Description:** A writer chooses **Step by step** where they choose the generation mode today (project creation, current project page, preview page). The mode starts a normal generation: inputs freeze, the Brief derives, the analysis runs once, exactly as the existing gated mode does, and then instead of drafting Section 242 the tool opens the seed workspace: a persistent Outline of all thirteen Subsections on the left, the active Subsection's Shown Set on the right. Realizes UJ-1.

`[ASSUMPTION: the Brief is still derived at generation start and remains visible in its rail; the Brief version and the generation settings are frozen for the seed stage at start (FR-41). The Brief is not itself a gate, as decided 2026-09-09.]`

**Functional Requirements:**

#### FR-1: Choose Step-by-step mode

A writer with generation access can choose **Step by step** as the generation mode wherever a mode is chosen today; the existing mode key is reused so no new mode value exists. Realizes UJ-1.

**Consequences (testable):**
- The three mode selectors read one shared definition and show the same label "Step by step" and the same one-line hint (labels here and below are indicative copy, not final); the mode stored on the generation is the existing gated mode key.
- Starting requires at least one Transcript on the project, as generation does today.
- Starting freezes inputs, stamps prompt version and learning digests, derives the Brief and runs the analysis exactly once, as today.
- The generation records at reservation which workflow it runs (section-approval or seeds); every surface and mutation reads that record through one resolver (FR-32).
- One active generation per project is enforced exactly as today; a second start while one is active is refused with the existing typed error.

#### FR-2: Fixed Subsection list, order and kinds

The system presents exactly thirteen Subsections in this order, each with its Section, canonical role, and kind. Realizes UJ-1..4.

| Order | Section | Subsection (display) | Canonical role (as in the section prompts) | Kind |
|---|---|---|---|---|
| 1 | 242 | Company / Context | company context | Standard |
| 2 | 242 | Goal / Problem | goal / problem | Standard |
| 3 | 242 | Technological limitations | limitations of standard practice (passive uncertainties) | Standard |
| 4 | 242 | Technological objectives | technological objective | Standard |
| 5 | 242 | Technological uncertainties | active uncertainties | Standard |
| 6 | 244 | Previous-year status | prior-year status (continuing only) | Optional |
| 7 | 244 | Work plan | workplan | Optional `[ASSUMPTION: the handoff marks it Optional; the chat brief does not — OQ-1]` |
| 8 | 244 | Hypothesis | hypothesis | Standard |
| 9 | 244 | Experimentation / Iterations | experimentation / iterations | Multiple |
| 10 | 246 | Advancement to science / technology | overall advancement | Standard |
| 11 | 246 | Specific technological advancements | specific advancements (one per resolved uncertainty) | Multiple |
| 12 | 246 | Project status and next steps | project status and next steps | Standard |
| 13 | 246 | Overall company / project goal improvements | project goal and improvements | Standard |

**Consequences (testable):**
- Each Subsection maps to exactly one existing content role used by the section prompts and quality assurance (QA). The mapping is a single shared table and a test fails if a Subsection has no role or a role has no Subsection.
- The order above defines Predecessors and Successors (FR-17) regardless of visit order.
- Subsections are not headings in the report: Prose Generation still produces the three Sections and nothing else (Locked Rules).

**Out of Scope:** writer-configurable Subsection lists or order. `[NON-GOAL for MVP]`

#### FR-3: Persistent Outline with state and previews

The writer can see, at all times while in the workspace, every Subsection with its state and, for approved ones, a compact preview of its Seed Selections. Realizes UJ-1, UJ-2, UJ-3.

**Consequences (testable):**
- Each Outline row shows one of: *untouched*, *generating*, *in progress* (Shown Set exists, not approved), *approved* (with count of active Seed Selections), *skipped*, *stale* (derived, with its reason), *failed* (no suggestions could be generated, FR-27); an *outdated* marker appears on any row whose shown Batch is Outdated. State is carried by a word, never by colour alone.
- Approved rows show the first line of each Seed Selection, truncated; Multiple Subsections show the count ("5 selected").
- The Outline scrolls independently of the Shown Set and stays visible while cards scroll.

#### FR-4: Non-linear navigation

The writer can open any Subsection from the Outline at any time; opening never discards work. Realizes UJ-3.

**Consequences (testable):**
- Opening an *untouched* Subsection requests its first Batch (FR-5); opening any other state shows its Shown Set unchanged, with the Outdated marker if applicable (FR-40).
- The active Subsection is marked in the Outline; a keyboard user can move between rows and open one with Enter or Space.
- Which Subsection is open is per user and per device; it is not shared state (FR-30).

### 4.2 Idea Seed generation

**Description:** A Batch is one AI call per Subsection that returns three to five Seeds. The call receives the Subsection's objective, the Decision Set (Predecessors' active Seed Selections with final wording, Skips and Feedback text, the frozen Brief version, the frozen generation settings), and the transcript context under the trusted-context rules. Seeds are short by contract, positioned by Tag, and grounded by provenance. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-5: Generate a Batch

The system generates a Batch for a Subsection when the writer first opens it, when the writer presses Regenerate, and, after a Subsection Approval, for the next untouched Subsection in order as a prefetch `[ASSUMPTION: prefetch is a mechanism choice to hide latency; it may be dropped without changing the contract]`. Realizes UJ-1.

**Consequences (testable):**
- A Batch contains between three and five Seeds; fewer than three after validation fails the attempt. The only automatic retry is the existing structured-output repair (at most two requests per attempt); a failed attempt shows a retry action, never a partial Batch. Every attempt has a durable identity and records how many Seeds validation dropped.
- Each Seed has one or two bullets. Every bullet is at most 25 words and at most one sentence. The system checks both limits deterministically: it splits words on whitespace. A sentence ends at `.`, `!` or `?` followed by whitespace or the end, ignoring abbreviations and decimals per a fixture list. The system drops a violating Seed before display.
- Every Batch immutably records the consumed revision, attempt identity, Brief version and settings it was given. A Subsection has at most one pending attempt; only the pending attempt's result becomes the shown Batch. A result arriving for an attempt that was superseded by a retry, timed out (10-minute lease), cancelled or signed off is stored as *late*. It is kept for audit and usage, never shown as current and never applied to a closed seed stage.
- The prefetch never runs more than one Subsection ahead, never for a Subsection with any Batch, and a writer's open of the same Subsection reuses the in-flight Batch rather than starting another.
- While a Batch is generating, the Subsection shows *generating* and the writer can navigate elsewhere; the Batch lands when ready, Outdated if the Decision Set changed meanwhile (FR-40).

#### FR-6: Positioning Tags and variety

Every Seed carries one or two Tags from the closed set; a Batch varies in positioning and in form. Realizes UJ-1.

**Consequences (testable):**
- A Tag outside the closed set is rejected at the boundary and the Seed is dropped.
- A Batch whose Seeds all carry the same single Tag fails validation; shape, Tag and form checks share the attempt's two-request repair envelope (FR-5), and there is no further automatic attempt `[ASSUMPTION: diversity rule inferred from "vary in content and presentation"]`.
- Within a Batch, at least one Seed is a single bullet and at least one is two bullets when the Batch has four or more Seeds (form variety).
- Tags are displayed as words; they are never the sole indicator of selection or completion.

#### FR-7: Seed Provenance and support status

Every Seed either cites at least one excerpt from the frozen generation sources, validated byte-for-byte, and is *source-supported*, or is *writer-asserted*. Realizes UJ-1 edge case.

**Consequences (testable):**
- A cited excerpt that does not match the frozen source bytes is discarded; a Seed that loses all excerpts becomes writer-asserted rather than being dropped.
- The writer can reveal the excerpt(s) of a source-supported Seed in place (a disclosure on the card), without leaving the workspace and without the excerpts being shown by default.
- Writer-asserted Seeds are selectable; their Seed Selections carry the marker into the Summary and the content plan, and Prose Generation treats them as it treats Writer's Notes (the writer's own claim, still subject to the no-fabrication rule) `[ASSUMPTION: treatment of writer-asserted items; the alternative is to require confirmation before sign-off — OQ-9]`.

#### FR-8: Seeds are conditioned on Predecessors' decisions

Every Batch is conditioned on the Decision Set of its Subsection and on nothing decided in its Successors. Realizes UJ-1 climax, UJ-2 climax.

**Consequences (testable):**
- The Batch request carries each Predecessor's active Seed Selections (final wording), Skips and Feedback text, the frozen Brief version and the frozen generation settings, as data blocks. They are never system instructions. The request excludes Successors' decisions.
- A fixture proves an edited term from Subsection 1 appears in Subsection 2's Seeds, and a fixture with a labelled expected outcome (in the evaluation harness) judges that a Feedback instruction on Subsection 1 is respected in Subsection 9's Seeds.
- For 246 · Specific technological advancements, whenever Subsection 9 has active Seed Selections (approved or not), each Seed carries structured references to one active uncertainty (Subsection 5) and at least one active experiment (Subsection 9); several experiments may support one advancement; an experiment may support none; the Batch is still three to five Seeds. Approve of Subsection 11 and Sign-off refuse any selected advancement item that does not carry exactly one active uncertainty reference and at least one active experiment reference. This applies whether the references are missing (generated before experiments existed) or no longer active ("unlinked"). Links are repaired only by regenerating or by Feedback and selecting the new Seed; Seed Edit changes bullets, never references. Two selected advancements that reference the same uncertainty are allowed. Prose Generation drafts them as one advancement with two facets; the Compliance Note names the merge.
- Departure from the handoff recorded: the handoff says "all approvals" inform later suggestions; this PRD conditions on Predecessors only, so that fixed-order staleness (FR-17) is exact under non-linear navigation.

#### FR-9: Seeds are short and never prose

A Seed is never a paragraph. Realizes the handoff's core principle.

**Consequences (testable):**
- The bullet cap and sentence check of FR-5 are enforced server-side; no client-side truncation.
- The Batch prompt forbids narrative sentences and connective prose; the deterministic check is the floor, and the evaluation harness includes full-sentence Seeds as negative fixtures.
- Seeds are stored in their own records, never written into the report, a Proposal or the Brief.

### 4.3 Working a Subsection: select, edit, feedback, regenerate, skip, approve

**Description:** The right pane lists Seed cards. Each card has a checkbox, its bullets, its Tags, its support status, its provenance disclosure, and two visible (not hover-only) actions: Edit and Give feedback. An action bar holding Regenerate, Skip (Optional Subsections only) and Approve stays visible while cards scroll, at every breakpoint; Approve is disabled until there is at least one active Seed Selection. Every action persists immediately. Realizes UJ-1, UJ-2.

**Functional Requirements:**

#### FR-10: Select and deselect Seeds

The writer can tick any number of Seeds in the Shown Set, including Seeds from earlier Batches and Revised Seeds. Realizes UJ-1, UJ-2.

**Consequences (testable):**
- Ticking uses checkbox semantics: the control state, a border treatment and the word "Selected" change together.
- A Seed Selection persists on the server before the control settles; reloading shows the same Seed Selections.
- Any tick or untick changes the Subsection's Selection Revision: an approved Subsection returns to *in progress* and every approved Successor becomes Stale (FR-17), in one transaction.

#### FR-11: Edit a Seed inline

The writer can change a Seed's bullets in place; the edited wording is what carries forward. Realizes UJ-1.

**Consequences (testable):**
- Editing keeps the bullet cap, the sentence check and the one-or-two-bullet shape; the writer is told when they exceed them and cannot save until within them.
- An edited Seed shows "Edited · writer-asserted"; its original AI wording and original citations remain viewable as history ("original source"), and **Restore original wording** is always available.
- An edit changes the Selection Revision if the Seed is selected (same effects as FR-10).

#### FR-12: Give feedback on a Seed

The writer can attach a short written instruction to a Seed and receive one to three Revised Seeds in the Shown Set. Realizes UJ-2.

**Consequences (testable):**
- Feedback is at most 300 characters `[ASSUMPTION]`. The request records the target Seed, its wording at request time, the instruction, the consumed revision and the attempt. One AI attempt returns a Feedback Batch of one to three Seeds. They obey the per-Seed rules of FR-5, FR-6 (Tags) and FR-7; Batch-level cardinality and Tag-diversity rules do not apply.
- Revised Seeds arrive **unselected**, adjacent to the original, linked to their request; the original keeps its selection state and shows "has revisions". Replacing the original is the writer's explicit tick/untick (FR-10). A Feedback Batch is subject to FR-40: if the Subsection's Context Revision changed while it ran, or the target Seed's wording changed since the request, it is shown Outdated ("the idea you gave feedback on has changed").
- The instruction is **active** from the request until the writer withdraws it (a visible action on the feedback chip) or the Subsection is skipped. Active instructions are included when this Subsection regenerates. They are also part of every Successor's Decision Set (FR-8); adding or withdrawing one is a Context Revision change (FR-17). Withdrawn instructions remain readable as history and are never sent again.

#### FR-13: Regenerate a Batch

The writer can request a new Batch for the active Subsection; nothing chosen is lost. Realizes UJ-2 edge case.

**Consequences (testable):**
- Active Seed Selections remain selected and are shown at the top of the new Shown Set, each marked with whether it was produced under the current Context Revision; the Previous Batch is reachable and can be restored as the current Batch. A fresh Batch never vouches for carried Seed Selections; Approve does (FR-15).
- Regenerate is a single AI attempt, metered (NFR-3) and never refused.
- A second Regenerate while one is in flight for the same Subsection is not started; the writer sees "already generating".

#### FR-14: Skip and Unskip an Optional Subsection

The writer can mark an Optional Subsection as not applicable, and reverse that. Realizes UJ-4.

**Consequences (testable):**
- Skip is available only on Subsections of kind Optional; the mutation refuses it elsewhere.
- Skip sets the state to *skipped*; its Seed Selections become inactive: excluded from every Successor's Decision Set, from the Summary and from Sign-off, but retained.
- Skip and Unskip are Decision Set changes: every approved Successor becomes Stale (FR-17).
- Unskip returns the Subsection to *in progress* with its retained Seed Selections active again (or to *untouched* if it never had a Batch); it never returns directly to *approved*.
- A skipped Subsection counts as decided for Summary Review readiness (FR-20), is listed as "Skipped" in the Summary, and its Skip is a plan decision carried into Prose Generation (FR-25): the drafter must not cover that role from the Brief or sources.
- Skipping a Stale Subsection disposes its stale episode as *bypassed*; its active Feedback becomes inactive.

#### FR-15: Approve a Subsection

The writer can approve a Subsection once it has at least one active Seed Selection; Approve is the writer's reconciliation of every active Seed Selection with the current Context Revision. Realizes UJ-1, UJ-3.

**Consequences (testable):**
- Approve is disabled with no active Seed Selection; the mutation refuses it server-side.
- When the shown Batch is Outdated, or any active Seed Selection comes from a Batch whose consumed revision differs from the current Context Revision, the action is presented as **Confirm and approve**. The surface lists those carried items and the Subsections whose changes they have not seen. Accepting records an explicit confirmation with the actor. The mutation records the approved Selection Revision and the approved Context Revision (always the current one at approval), who and when. It sets the state to *approved* and disposes an open stale episode as *resolved*. It records three facts rather than one label: whether an attempt consuming the current Context Revision completed during the episode, whether any of its Seeds is in the approval snapshot, and whether older Seed Selections were confirmed.
- For Subsection 11, Approve refuses any selected advancement item with an inactive reference (FR-8).
- If any active Seed Selection matches a Claim Exclusion of the frozen Brief, Approve shows a warning naming the exclusion and proceeds only on the writer's confirmation (recorded).
- Approve on the last undecided Subsection makes Summary Review available (FR-20).
- Approve requires the same access as editing report prose on this project; user interface (UI) hiding is not the authorization.

#### FR-16: Multiple-kind Subsections yield distinct items to cover

For Experimentation / Iterations and Specific technological advancements, each active Seed Selection is one distinct item in the Summary and one distinct item the prose must cover. Realizes UJ-2.

**Consequences (testable):**
- The Summary lists each Seed Selection of a Multiple Subsection as its own entry with its own Edit action.
- Prose Generation receives the Seed Selections of a Multiple Subsection as an ordered list and the Compliance Note for the Section reports each item as covered or not covered; the number of paragraphs is not prescribed (2026-09-15 amendment).
- Specific technological advancements keep the existing role meaning, one advancement per resolved uncertainty: an advancement item names its uncertainty and its supporting experiments.
- Standard Subsections merge their Seed Selections into one role's content.

### 4.4 Dependency, staleness and Outdated Batches

**Description:** Because a Subsection's Seeds are conditioned on its Predecessors, changing a Predecessor's decisions can invalidate a Successor. The tool never regenerates on its own; it marks and offers. Realizes UJ-3.

**Functional Requirements:**

#### FR-17: Mark approved Successors Stale

When a Subsection's Decision Set contribution changes (tick, untick, Seed Edit on a selected Seed, Skip, Unskip, Feedback instruction added or withdrawn), the Context Revision of every Successor changes, and every approved Successor becomes Stale with a stated reason. Realizes UJ-3.

**Consequences (testable):**
- Stale is one server-side predicate: *approved* and (approved Context Revision ≠ current Context Revision, or approved Selection Revision ≠ current Selection Revision). It is recomputed in the same transaction as the change; the client reads it, never derives it.
- The reason names the changed Subsection ("Technological uncertainties changed"); a stale episode opens with a timestamp when the predicate first becomes true and stays open until disposed (FR-18); several upstream changes during an open episode do not open new ones.
- A Successor that is *in progress* or *untouched* is not Stale; its shown Batch, if any, becomes Outdated (FR-40).

#### FR-18: Resolve staleness

The writer resolves a Stale Subsection by re-approving it, with or without regenerating first. Realizes UJ-3.

**Consequences (testable):**
- Re-approval (FR-15) is the only resolution; it disposes the episode as *resolved* with the three recorded facts. Skip and cancel dispose an open episode as *bypassed*.
- Summary Review is unavailable while any Subsection is Stale (FR-20).

#### FR-19: Versioned state and conflict handling

Returning to an earlier Subsection never silently overwrites a later decision; concurrent writers never lose work silently. Realizes UJ-3.

**Consequences (testable):**
- Every writer-initiated seed-stage mutation carries the expected seed-stage version. The server refuses a mutation that presents an older version with the existing stale-revision error. The client refreshes the server state and keeps any unsaved text in the writer's edit or Feedback box for them to reapply. Batch completions are not writer mutations: they are fenced by attempt ownership (FR-5), not by the writer's version.
- Prior Batches, superseded Seeds and original wordings are retained for the life of the generation.

#### FR-40: Outdated Batches

A Batch (including a Feedback Batch) whose consumed revision differs from the Subsection's current Context Revision is Outdated, whether it is shown, prefetched or arrives after the change. Realizes UJ-3.

**Consequences (testable):**
- The Shown Set shows an "Outdated: <Subsection> changed" notice with the actions **Regenerate** and **Confirm and approve** (FR-15); the consumed revision on the Batch is never rewritten. A Feedback Batch is also Outdated when its target Seed's current wording differs from the wording recorded on the request.
- A pending attempt whose result arrives after its Subsection's Context Revision changed is stored and shown as Outdated, never discarded and never silently treated as current; a result for an attempt that is no longer pending is stored as late (FR-5).

### 4.5 Running Summary, Summary Review and Sign-off

**Description:** The Outline is the Running Summary while working. When every Subsection is decided and none is Stale, the writer can open the Summary Review: a single-column, full-width reading view with generous spacing, sticky Section and Subsection navigation, every Seed Selection visible (no modals, no collapsed experiments), Edit per item, and the frozen generation settings beside the Sign-off action. Sign-off freezes the Summary, closes the seed stage and starts Prose Generation. Realizes UJ-4.

**Functional Requirements:**

#### FR-20: Summary Review readiness

The writer can open Summary Review when all Standard and Multiple Subsections are approved, all Optional ones are approved or skipped, none is Stale (so every approval is against the current revisions) and no selected advancement item is unlinked. Realizes UJ-4.

**Consequences (testable):**
- The readiness rule is evaluated server-side and exposed as one readable state with the blocking Subsections named.
- Before readiness, the Review action is disabled with the reason shown; the Outline remains readable.

#### FR-21: Summary Review view

The Summary Review shows every Subsection's active Seed Selections in FR-2 order, grouped under the three Sections, with Skipped and writer-asserted items marked. Realizes UJ-4.

**Consequences (testable):**
- Each Seed Selection of a Multiple Subsection is shown in full, directly on the page, with its own Edit action.
- Section and Subsection navigation remains available while scrolling (sticky).
- The view is a full-width state of the project page, not a modal; browser back returns to the workspace.
- The view shows, read-only, the length target, the model and the Writer Profile applied, as frozen at start (FR-41).

#### FR-22: Edit within the Summary Review

The writer can edit any Seed Selection's wording from the Summary Review without returning to the Subsection. Realizes UJ-4.

**Consequences (testable):**
- An edit here is a Seed Edit (FR-11) and obeys the same limits and the same staleness effects; if it stales any Subsection, readiness is withdrawn until resolved.
- The writer cannot add a free-text item that is not a Seed; new ideas are added by returning to the Subsection and giving Feedback or editing a Seed. `[NOTE FOR PM: keeps "the Dump is the maximum required input" honest; revisit if writers ask for it.]`

#### FR-23: Sign-off closes the seed stage

The writer can sign off a ready Summary; Sign-off freezes that Summary version, closes the seed stage and starts Prose Generation. Realizes UJ-4.

**Consequences (testable):**
- Sign-off requires the prose-edit capability on the project and the generation being in its human-gated state. It re-evaluates readiness (FR-20) and records who, when, the Summary version (active Seed Selections with support status and, for Subsection 11, their references; every Skip decision), the Brief version and the settings used.
- After Sign-off no seed-stage mutation is accepted for that generation (typed invalid-state error); Seed Selections and the Summary are read-only from then on.
- Revising the plan after Sign-off is out of MVP scope (§8.2): corrections go through prose editing and Coordinated Revision; a new plan is a new Step-by-step generation.

#### FR-24: Summary is stored apart from the prose

The Summary is never written into the report document. Realizes UJ-4.

**Consequences (testable):**
- The report document contains only the three Sections (Locked Rules); the Summary lives in its own records linked to the generation.
- Deleting or restoring a report snapshot never changes the Summary.

#### FR-41: Frozen Brief, settings and content precedence

For the whole seed stage and Prose Generation, the Brief version and generation settings are those frozen at start; signed-off decisions take precedence over Brief entries for content.

**Consequences (testable):**
- Every Batch and the signed-off Summary record the Brief version and settings they used. The Brief rail labels the version the active run uses; a Brief edit during the run is labelled as applying to the next generation and does not change later Batches; "Regenerate with this Brief" is unavailable while a generation is active (one active generation per project).
- The handoff's generation settings map as: style = Writer Profile and House Rules (existing), targetLength = the existing length target, position = not in MVP (OQ-3).
- Content precedence in Prose Generation: Locked Rules, then the signed-off Seed Selections, then Brief entries. A Seed Selection that contradicts a Claim Exclusion is drafted, and the Section's Compliance Note records the conflict; the exclusion is not applied silently.
- Style precedence (Locked, Org Mode, Writer Profile, House Rules) is unchanged. Glossary Terms and Writer Profile terminology preferences normalize the *wording* of Seeds and prose (a synonym is replaced by the Glossary Term); they never add, drop or override content. A Seed Selection whose content matches a Claim Exclusion is a content override handled as above.

### 4.6 Prose Generation from the signed-off Summary

**Description:** Sign-off turns the generation into an unattended drafting run. Each Section is drafted with its Subsections' Seed Selections as the content plan, under the Locked Rules, the Writer Profile and House Rules, with the existing Self-check, consistency pass and Compliance Notes. The result is created as a report exactly as today's generations create one, and the writer lands in the editor. Realizes UJ-4.

`[ASSUMPTION: no second, per-Section prose approval gate after sign-off; the current mode's approve-each-section step is retired for seed generations. OQ-2. If reversed, §7's corresponding non-goal is withdrawn.]`

**Functional Requirements:**

#### FR-25: Draft the three Sections from the Summary

Prose Generation drafts Section 242, 244 and 246 using each Section's Subsection Seed Selections as its content plan. Realizes UJ-4.

**Consequences (testable):**
- Each Section's drafting prompt receives its Subsections' Seed Selections (final wording, support status, order, references) and its Skip decisions as delimited data blocks. The prompt instructs the drafter to cover each Seed Selection and to leave a skipped role uncovered even when the Brief or sources support it. A fixture proves an edited term appears in the drafted Section. A release-blocking semantic suite in the evaluation harness (fixtures: carried old selections after an upstream change, a skipped role strongly supported by the Brief, a corrected then withdrawn Feedback, a Seed Selection that matches a Claim Exclusion, an advancement with changed experiment links) is judged by the reviewing manager. Every fixture must pass before release, and the judgments are stored under the test artifacts.
- Locked Rules are unchanged: three Sections, line and word limits, no-fabrication with `[GAP]`, human-prose scan; the assembled-draft consistency pass runs as today.
- The Compliance Note for each Section lists every Seed Selection as covered or not covered, with a reason when not covered, and every Skip decision as honoured or not honoured.

#### FR-26: Report creation is the existing path

Prose Generation creates the report through the existing report-creation path and hands off to post-generation QA as today. Realizes UJ-4.

**Consequences (testable):**
- No new prose writer is introduced; the generation completes with a report and QA is scheduled exactly as one-shot generations do.
- The generation record links the signed-off Summary version, so "which plan produced this report" is answerable.

#### FR-27: Failure and retry keep the Summary

If Prose Generation fails, the signed-off Summary is retained and the writer can retry from it. Realizes UJ-4 edge case.

**Consequences (testable):**
- Failure surfaces through the existing recovery surfaces; Retry starts a recovery generation bound to the same Summary version, reusing the frozen inputs and skipping the seed stage.
- A stalled drafting run is recovered by the existing stale-generation mechanism. The human-gated seed stage itself is never reaped for inactivity. If a pending attempt has no completion after its 10-minute lease, the reaper marks it failed on its next pass (at most 20 minutes after dispatch). The Subsection returns to its prior state with a retry action. After three consecutive failed attempts a Subsection shows *failed* with the reason; Retry remains available without limit and a successful attempt is always usable. Guaranteed completion is not claimed under persistent model failure.

#### FR-28: After generation, the Summary stays readable

The writer can open the signed-off Summary from the report, read-only.

**Consequences (testable):**
- The Summary view after generation shows the frozen version and states it is signed off; edits are not possible there.

### 4.7 Persistence, resume, concurrency and recovery

#### FR-29: Domain state persists immediately

Every Seed Selection, Seed Edit, Feedback, Skip, Approve, Confirm and Sign-off is saved on the server as it happens.

**Consequences (testable):**
- Closing the browser at any point and reopening on another device shows the same Seed Selections, states and Summary.
- No seed-stage domain state lives only in browser storage; the open Subsection and unsaved box text are the only per-user local state.

#### FR-30: Shared domain state, private navigation

Two people with access to the same project see the same seed domain state live; each has their own open Subsection and unsaved text.

**Consequences (testable):**
- A change by one client appears on the other without reload; a conflicting write is refused and the refusing client keeps its unsaved text (FR-19). Concurrency is optimistic: a stale write is rejected, not accepted.

#### FR-31: Cancel

The writer can cancel a Step-by-step generation at any point before Sign-off, as today.

**Consequences (testable):**
- Cancel ends the generation with the existing cancel semantics; seed records are retained for audit; no report is created.

#### FR-32: Legacy generations keep their surfaces

Generations started in the old gated workflow keep their old surfaces; the switch is by the workflow recorded on the generation, never by whether seed records exist.

**Consequences (testable):**
- One resolver decides the workflow for every generation: the recorded value when present; a gated generation reserved before the field existed resolves to section-approval. Queries, mutations, recovery and telemetry all use that resolver; none infers the workflow from whether seed records exist.
- A section-approval generation renders the previous stepper; a seeds generation renders the seed workspace, showing an initializing state until its Subsection records exist and a failed state with retry if initialization fails.
- The legacy approve and regenerate mutations refuse seed generations; the seed mutations refuse section-approval generations.

#### FR-39: Every destructive action has a named restoration

**Consequences (testable):**
- Seed Edit: Restore original wording. Replacing an original with a Revised Seed: re-tick the original (both remain in the Shown Set). Regenerate: Previous Batch. Skip: Unskip. Untick: re-tick.
- Each restoration is a selection change with the same staleness effects as any other (FR-17); none bypasses approval.

### 4.8 Learning signals, measurement and auditability

#### FR-33: Seed decision events

Every Batch completion, Batch first view, Seed Selection change, Seed Edit, Feedback request and withdrawal, Regenerate, Skip, Unskip, Approve (with or without confirmation), stale-episode open and disposition, Sign-off and cancel is recorded as an append-only event.

**Consequences (testable):**
- Each event carries: id, kind, time, project, generation, Subsection role, Batch, attempt, Feedback request or Seed id where applicable, actor (a user reference, or *system* for reaper and completion events; never a free-text string), the Context Revision and Selection Revision in force, the outcome, and the stale-episode id when relevant. Approve and Sign-off additionally snapshot the active Seed Selections. A Batch is *shown* when a user first renders it (one view event per Batch per user); attempts record Seeds dropped by validation.
- Events carry no Seed text or Feedback text; Seed Edit events carry an edit ratio.
- Events are never updated or deleted during the generation's life.

#### FR-34: Events have a reader in the same release

**Consequences (testable):**
- The existing learning-health admin surface shows, per period and per mode: seed-stage request counts and cost, Batches shown, Seeds shown, Seeds selected, Seeds edited, Feedback requests and their frozen first-Approve outcome (selected / not selected / response not yet available at that Approve / unresolved), with withdrawal state reported separately, Regenerates, stale episodes by disposition (resolved episodes broken down by fresh-attempt-used / confirmed-only), sign-offs, active time to Sign-off. There is no budget-extension metric because usage never gates a request. A worked event trace with expected numbers lives in [addendum §B, Worked event trace](addendum.md#worked-event-trace-for-the-metrics) so two readers compute the same figures. `[ASSUMPTION: counts are enough for v1; distillation into digests is OQ-4.]`
- The draft-style digest (which today learns from section-approval edit events) labels Step-by-step generations as *not included* until seed decisions are distilled.

#### FR-35: Privacy of seed text

Seed text and Feedback are client-derived content.

**Consequences (testable):**
- They are never written to logs or error reports; any future use in firm-wide knowledge goes through the existing de-identification step.

### 4.9 Accessibility and responsive behaviour

#### FR-36: Keyboard and assistive technology

All selection, navigation, edit, feedback, regenerate, skip, confirm, approve and Sign-off controls are keyboard operable and announced.

**Consequences (testable):**
- Every control is reachable by Tab with a visible focus state; checkboxes toggle with Space; Approve, Regenerate, Confirm and Sign-off are buttons.
- Batch arrival, save confirmation, selection counts, Outdated and Stale changes and validation errors are announced politely (not assertively).
- Tags, support status and state pills always carry their word; nothing relies on colour alone.

#### FR-37: Narrow screens

Below the large breakpoint the writer can still use every function.

**Consequences (testable):**
- The Outline stacks above the workspace or becomes a drawer; one pane is shown at a time with an explicit switch; the action bar with Approve stays visible while cards scroll.

#### FR-38: Contrast and targets

**Consequences (testable):**
- All text meets the design system's contrast rule; interactive targets are at least 44 px on coarse pointers (design-system rule).

## 5. Cross-cutting non-functional requirements (NFRs)

- **NFR-1 Latency.** From the dispatch of an attempt to its validated result being available (completion event; failures included, prefetch included): at most 12 s at the median and 30 s at the 95th percentile for a project within the standard context budget. A separate foreground figure, dispatch to first render for attempts whose Subsection stayed open, is reported but not thresholded; first-view events remain the exposure measure. Prose Generation, from Sign-off to report created, is the normative bound: within the existing single-mode drafting time (request to report created, same model, same project, retries included) plus the consistency pass, measured as a median over the release cohort. `[ASSUMPTION: not yet measured; both are fixed after a measurement on the production model.]`
- **NFR-2 Cost attribution.** Every seed-stage call is metered under its own named slot so cost per generation and per Subsection is answerable from the usage ledger; retries, repairs, prefetches and failures are included.
- **NFR-3 Seed-stage usage visibility (no cap).** Every model request in the seed stage is metered (Batch attempts, Feedback attempts, structured-output repair requests, prefetch) and the workspace shows the running count per generation, with an informational notice at 40 requests. No seed-stage request is ever refused on usage: the writer can regenerate, give feedback and retry until the PD is done (owner decision 2026-09-17). Usage per generation is recorded in the scorecard for the existing alert-only spend stance. `[ASSUMPTION: the 40-request notice threshold is a placeholder until measured.]`
- **NFR-4 Trusted context.** Transcript excerpts, Seed Selections, Seed Edits and Feedback enter prompts as delimited data, never as instructions; the injection test suite that covers drafting covers Batch and Feedback calls.
- **NFR-5 Determinism of validation.** Seed shape, Tag set, provenance validation, Context and Selection Revisions, Outdated, Stale and readiness are computed server-side; the client never decides them.
- **NFR-6 Read bounds.** Queries listing Seeds, Batches or the Summary are bounded by the existing read-budget mechanism and paginated where they can exceed it.
- **NFR-7 No prompt-version drift.** Seed prompt changes move the prompt version like any other prompt change; the version is stamped on the generation.
- **NFR-8 Design system.** New UI uses the existing tokens, type roles, max font weight 500, and bits-ui primitives (checkbox, popover, drawer); no ad-hoc colours; no modal for the seed workspace or the Summary Review.

## 6. Constraints and Guardrails

- **Agents propose, humans apply.** Seeds are not prose and never enter the report. The only prose written by this feature is the Prose Generation report created through the existing creation path.
- **Locked Rules unchanged.** Three Sections, CRA line/word limits, no-fabrication with `[GAP]`, human-prose scan. Subsections change how the writer plans, not what the report is.
- **Authority.** Starting, working and signing off a Step-by-step generation require the project's prose-edit capability: own project or an open assigned work item for a Consultant; all projects for Managers and Admins (the existing rule). `projects.createdBy` is never consulted.
- **Generation state.** No new generation status values. The seed stage uses the existing human-gated status; per-Subsection state lives on its own records.
- **Privacy.** Seed text and Feedback are client data.
- **Content roles, not counts.** Seed Selections tell the drafter what to cover, not how many paragraphs to write; QA continues to score roles, never counts.

## 7. Non-Goals (Explicit)

- Changing single or compare mode in any way, including adding any pre-draft gate to them.
- Per-paragraph or per-Subsection approval of *prose* after Sign-off (withdrawn if OQ-2 is answered "keep the gate").
- Revising the plan after Sign-off within the same generation.
- Writer-defined Subsection lists, order or kinds.
- Free-text writer-authored Summary items that are not Seeds.
- Using Seeds inside the chat assistant, or generating Seeds for an existing report.
- Client-facing exposure of Seeds or the Summary.
- Automatic regeneration of Stale Subsections or Outdated Batches.
- A new agent framework or orchestrator; the seed stage is a new stage in the existing generation pipeline.

## 8. Minimum viable product (MVP) Scope

### 8.1 In Scope

- FR-1..FR-41 as written, with these simplifications: Summary Review edits are Seed Edits only (FR-22); the learning reader is counts only (FR-34).
- Relabel of the mode in all three selectors from one shared definition.
- Legacy stepper retained for section-approval generations (FR-32).

### 8.2 Out of Scope for MVP

- Revising a signed-off plan (edit Seed Selections after Sign-off, "regenerate from summary"). The re-plan path is a new Step-by-step generation. `[NOTE FOR PM: a "start from previous summary" pre-fill would make this cheap in v2.]`
- Distilling seed decisions into learning digests (needs the de-identification path and a diversity gate). `[NOTE FOR PM: load-bearing for the "learn from writers" thesis; revisit once counts show volume.]`
- A "positioning" default for Prose Generation (OQ-3).
- Comparing two Batches side by side; the Previous Batch is restorable, not juxtaposed.
- The ghost one-shot comparison draft for seed generations. `[ASSUMPTION: retired for this mode — OQ-5; consequence for edit-distance baselines recorded in §10.]`
- A second tag axis (sentiment or category) beyond positioning (confirmed 2026-09-17).
- Retention or archival policy for seed records beyond the existing project-scoped erasure.

## 9. Success Metrics

Cohort for every metric unless stated: generations recorded as seed workflow (FR-32), excluding cancelled ones and projects flagged as development. Legacy section-approval generations are never in the cohort.

### Primary

- **SM-1 Adoption.** The lead writer (a named user id in the admin settings) signs off and reaches a created report on at least three distinct projects by 2026-10-31. Validates FR-1..FR-28.
- **SM-2 Active time to Sign-off.** Median active time from the seed stage's first event to Sign-off is at most 30 minutes. Active time is the sum of gaps between consecutive seed events (any actor, any user) shorter than 10 minutes. This is an event-gap proxy for effort: it is validated against at least five observed writer sessions before the threshold binds, and elapsed wall time is reported alongside, not thresholded. Validates FR-5, FR-8, FR-13, NFR-1.
- **SM-3 Seeds land.** In at least 60% of Subsections approved at Sign-off, the Sign-off snapshot contains at least one Seed Selection whose final wording equals the AI wording of a non-Revised Seed (a restored original counts). Validates FR-5..FR-8.
- **SM-4 Fewer corrections.** Corrections-to-acceptable, recorded by the reviewing manager per report as in the 2026-09-09 measurement protocol (manual record, report version and judge stored), is at most 1 for seed-workflow PDs. Validates FR-25.

### Secondary

- **SM-5 Feedback works.** At least 70% of Feedback requests have at least one of their Revised Seeds selected in the snapshot of their Subsection's next Approve (denominator: requests whose response was available before an Approve of that Subsection. Requests whose response arrived after the next Approve are scored at the following Approve. Requests never followed by one are reported as unresolved, not counted. Withdrawal after scoring does not change the score). Validates FR-12.
- **SM-6 Staleness is cheap.** Median stale episodes per generation at most 3, and median duration of *resolved* episodes (open to disposition, active time) under 2 minutes; *bypassed* episodes are counted and reported separately. Validates FR-17, FR-18.

### Counter-metrics (do not optimize)

- **SM-C1 Seeds stay seeds.** Over all Seeds shown, median bullet length at most 18 words and zero bullets failing the sentence check; Seeds dropped by validation (from attempt records) are reported as a rate of Seeds returned. Counterbalances SM-3.
- **SM-C2 No grinding.** Median seed-stage calls per generation at most 20 and 95th percentile under 40, counting every call in NFR-3 and including cancelled generations. Counterbalances SM-3 and SM-5.
- **SM-C3 Other modes untouched.** Time-to-first-draft (request to report created) and cost per generation in single and compare mode, over the same 30-day window before and after release and the same model, do not worsen by more than 10%. This is an observational guard, not a causal proof. Counterbalances everything in this PRD.
- **SM-C4 No fabrication drift.** Post-generation QA findings of unsupported claims per PD (QA's existing evidence-tracing check, completed QA only) in seed-workflow PDs are not higher than in single mode over the same window and model. `[GAP]` markers are reported separately and are not the metric, so honest gaps are not penalised. Counterbalances SM-4.

## 10. Amendments to prior artifacts

This PRD amends the 2026-09-09 PRD, `spec-pd-generation`, the 2026-09-03 architecture spine and the product-domain record as follows. The architecture step carries these into dated ADs; the product-domain amendment is proposed, not yet approved.

| # | Old contract | New contract (Step-by-step mode only unless stated) | Status |
|---|---|---|---|
| 1 | 09-09 §5 / §6.2: per-section multi-select is a non-goal / deferred to v2 | Multi-select of Seeds per Subsection is the core of Step-by-step mode | Reversed, this mode |
| 2 | SM-C4 (09-09): "the Brief must not become a required step" | Applies to single and compare. Step-by-step is gated by design; the Brief still does not gate | Rescoped |
| 3 | OQ-5 (09-09): optional Brief-approval gate | Closed: the gate is Summary Sign-off, not Brief approval | Closed |
| 4 | SPEC constraint lines 105–106: ungated by default; call budget one Brief, per section one draft + one Self-check + at most one repair, one consistency pass; ≤ 2x single-mode time and cost end to end | Gate lives only in this mode (unchanged). The seed stage has no request cap (owner decision 2026-09-17); its requests and cost are recorded per generation in the scorecard and reported (alert-only, consistent with the parent's no-refusal stance). The drafting budget after Sign-off is unchanged; the 2x *time* ceiling applies from Sign-off to report created, with NFR-1 as the normative bound; the inherited *cost* ceiling does not apply to this mode. The consistency pass and per-slot scorecard are kept, with new named slots for seed calls | Amended |
| 5 | 09-09 writer-effort ceiling / SM-3 (09-09) "zero writer-authored artifacts" | Choosing, editing and giving feedback on Seeds in-tool is not authoring an artifact; the Dump remains the maximum input | Restated |
| 6 | CAP-5 Build Order at Section granularity | Step-by-step records the Subsection order (FR-2) as its planning order; Build Order still governs the Section order of Prose Generation | Extended |
| 7 | Product-domain 2026-09-15: content roles, not counts | Honoured: Subsections are roles; Multiple items are coverage, not paragraph counts; QA unchanged; "specific advancements (one per resolved uncertainty)" keeps its meaning (FR-16) | Confirmed |
| 8 | Gated mode: section drafts approved one by one (`approveSectionDraft`) | Seed generations have no per-Section prose approval (OQ-2 default); legacy generations keep it | Retired, this mode `[ASSUMPTION]` |
| 9 | Gated mode: a ghost one-shot draft is generated for comparison and becomes the edit-distance baseline | Seed generations run no ghost; their edit-distance baseline is the generated report's own first snapshot, as in single mode | Retired, this mode `[ASSUMPTION]` |
| 10 | `sectionEditEvents` (draft vs approved section text) feed the draft-style learning digest | Seed generations produce seed decision events (FR-33) instead; the digest labels this mode *not included* until seed decisions are distilled (FR-34) | Replaced with visible coverage |
| 11 | Spine Deferred: "per-section multi-select generation and an optional per-writer Brief gate" | Undeferred by this PRD; a new dated AD set is required | Undeferred |
| 12 | Handoff "Dependency logic: all approvals influence later suggestions" | Predecessor-only conditioning (FR-8) | Narrowed, recorded |
| 13 | 09-09: the Brief is editable at any time and "Regenerate with this Brief" re-derives | In this mode the Brief version is frozen per generation; edits during a run apply to the next generation and are labelled so; "Regenerate with this Brief" is unavailable while a generation is active (FR-41) | Amended, this mode |
| 14 | 09-09 / AD-25: Claim Exclusions and Glossary Terms are checked by the Self-check and repaired | Content precedence: a signed-off Seed Selection that matches a Claim Exclusion is drafted and the conflict is recorded, not repaired; Glossary Terms normalize wording only (FR-41) | Amended, this mode |
| 15 | Handoff "Give feedback → AI returns revised option" | Feedback returns one to three unselected Revised Seeds; instructions are active until withdrawn (FR-12) | Extended |

## 11. Open Questions

All nine questions were put to the product owner on 2026-09-17 (chat); the record is `DECISIONS-2026-09-17.md` beside this PRD.

1. **OQ-1: Is Work plan Optional?** Answered: Optional.
2. **OQ-2: Second gate.** Answered: no second per-Section prose approval; the writer lands in the editor.
3. **OQ-3: Positioning default.** Answered: not in MVP.
4. **OQ-4: Learning.** Answered: counts on the learning-health surface only for v1.
5. **OQ-5: Ghost draft.** Answered: retired for seed generations.
6. **OQ-6: Budget and latency numbers.** Answered in part: there is no cap; latency thresholds and the 40-request notice remain placeholders until measured (owner Johnny, before build slice 7).
7. **OQ-7: Discovery.** Answered (delegated judgement 2026-09-17): relabel with the hint "Decide the ideas first, then generate the PD", listed first for the first two projects; revisit with Michael after that.
8. **OQ-8: Second tag axis.** Answered: six positioning tags only in v1.
9. **OQ-9: Writer-asserted items at sign-off.** Answered: marker only, treated as Writer's Notes.

## 12. Assumptions Index

- §2 Idea Seed — 25-word bullet cap makes "brief bullets" testable.
- §2 Positioning Tag — closed six-value set from the handoff (confirmed 2026-09-17).
- §4.1 — the Brief still derives at start and does not gate; Brief version and settings frozen at start.
- FR-2 — Work plan is Optional (confirmed 2026-09-17).
- FR-5 — prefetch is a mechanism choice, droppable.
- FR-6 — Tag-diversity and form-variety rules inferred from "vary in content and presentation".
- FR-7 — writer-asserted items treated as Writer's Notes (confirmed 2026-09-17).
- FR-12 — Feedback ≤ 300 characters.
- §4.6 / §10 row 8 — no second per-Section prose gate after Sign-off (confirmed 2026-09-17).
- §8.2 / §10 row 9 — ghost draft retired for this mode (confirmed 2026-09-17).
- FR-34 — counts are a sufficient reader for v1 (confirmed 2026-09-17).
- NFR-1, NFR-3 — latency thresholds and the 40-request notice unmeasured (OQ-6).
