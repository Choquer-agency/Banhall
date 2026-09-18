# Glossary — Step-by-step PD generation (new terms)

Inherited terms (PD, The Five Questions, Section 242/244/246, Transcript, Dump, Writer Profile, Writer's Notes, Supporting Documents, House Rules / Org Mode, Brief, Storyline, Claim Exclusions, Confidence Map, Glossary Terms, Build Order, Locked Rules, Self-check, Compliance Note, Deviation / Coordinated Revision / Completion Report, Proposal, Corrections-to-acceptable) keep their definitions in `../spec-pd-generation/glossary.md`. Introducing a synonym for any term below is a contract violation. "Section" is the CRA part; "Line 242" is only the H2 label.

- **Step-by-step mode** — the gated generation mode (stored `iterative`, formerly labelled "Section by section") in which the writer decides Idea Seeds per Subsection and signs off a Summary before prose. Aliases in older documents: gated mode, iterative mode.
- **Subsection** — one of thirteen content roles of the PD template, each in one Section, with a fixed order and a kind: *Standard*, *Optional*, *Multiple*. The role id is canonical; the title is display. Never a heading or a paragraph.
- **Predecessors / Successors** — Subsections with lower / higher order. Dependency uses this order regardless of visit order.
- **Decision Set** of a Subsection — active Seed Selections (final wording), Skips and active Feedback instructions of its Predecessors, plus the frozen Brief version and settings.
- **Context Revision** of a Subsection — server-computed identifier of its Decision Set plus its own active Feedback. A Batch records the one it consumed (**consumed revision**), immutably.
- **Idea Seed (Seed)** — one AI-proposed idea: 1–2 bullets (≤ 25 words, one sentence each), 1–2 Positioning Tags, a support status and Seed Provenance. Never prose; never enters the report.
- **Seed Batch (Batch)** — immutable result of one attempt for one Subsection: 3–5 Seeds (or 1–3 Revised Seeds for a Feedback Batch) and its consumed revision. **Outdated** = consumed revision ≠ current Context Revision.
- **Attempt** — one dispatch of a Batch request (at most two model requests under the structured-output repair). At most one attempt is pending per Subsection; a result for a non-pending attempt is **late** (kept, never current).
- **Shown Set** — the current Batch plus Revised Seeds and carried Seed Selections for a Subsection.
- **Positioning Tag (Tag)** — one of {Conservative, Aggressive, High-level, Detailed, Technical, Alternative angle}.
- **Seed Provenance** — the Transcript or Supporting Document excerpt(s) a Seed cites, validated against the generation's frozen sources (offsets into the stored text and the exact text; the spine fixes the offset unit). Validity proves existence, not support.
- **Support status** — *source-supported* (unedited, ≥ 1 valid excerpt) or *writer-asserted* (edited, or no valid excerpt).
- **Seed Selection** — a ticked Seed with any Seed Edit; *active* unless its Subsection is skipped.
- **Selection Revision** — server-computed identifier of a Subsection's active Seed Selections and their final wording.
- **Seed Edit** — inline change to bullets; sets writer-asserted; original wording and citations kept as history; restorable.
- **Seed Feedback (Feedback)** — a recorded request (target Seed and its wording, instruction ≤ 300 chars, consumed revision, attempt) yielding a Feedback Batch of 1–3 unselected **Revised Seeds**. The instruction is *active* until withdrawn or its Subsection is skipped.
- **Regenerate** — a new Batch; Seed Selections kept; **Previous Batch** restorable.
- **Skip / Unskip** — an Optional Subsection declared not applicable; its selections and Feedback become inactive; a plan decision carried into drafting.
- **Subsection Approval (Approve)** — the writer's reconciliation of active Seed Selections with the current Context Revision; records approved Selection Revision and approved Context Revision; presented as **Confirm and approve** when the shown Batch or any selected Seed consumed a different revision. Reversible; there is no separate confirm action.
- **Stale** — derived: approved and (approved Context Revision ≠ current or approved Selection Revision ≠ current). A **stale episode** opens on the first true transition and is disposed *resolved* (re-approval) or *bypassed* (skip, cancel).
- **Unlinked** — a selected Specific-advancement item without exactly one active uncertainty reference and ≥ 1 active experiment reference.
- **Running Summary (Summary)** — ordered outline of active Seed Selections and Skips by Section; its left-pane rendering is the **Outline**.
- **Summary Review** — full-width reading view available at readiness (all required Subsections approved and not Stale, Optional ones approved or skipped, no unlinked item).
- **Sign-off** — freezes a Summary version (selections, support, references, Skips, Brief version, settings), closes the seed stage, starts Prose Generation.
- **Prose Generation** — unattended drafting of the three Sections from the signed-off Summary under Locked Rules, Writer Profile and House Rules, through the existing chain and creation writer.
- **Workflow discriminator** — spec-coined name for the PRD's "workflow recorded on the generation" (FR-1, FR-32): the value written at reservation (section-approval or seeds); absent resolves to section-approval.
- **Attempt**, **Unlinked** — spec-coined names for the PRD's attempt identity (FR-5) and the missing/inactive advancement reference condition (FR-8, FR-15).
