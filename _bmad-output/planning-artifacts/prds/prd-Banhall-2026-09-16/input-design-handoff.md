# Input: SR&ED Project Description Generator – Product Design Handoff

Source: Google Doc `1cbfdHVOVqQkzLZAM7IDMEGDiRYc040oFKiwb_Mnb2_E`, fetched 2026-09-16 (text export). Preserved verbatim as a PRD input. The user's chat brief of the same date is reproduced at the end.

## Document Overview

This is an implementation-ready UI brief for a web application that guides writers through creating CRA-aligned SR&ED project descriptions. The workflow uses AI-generated idea seeds that writers can select, edit, and refine before full prose generation.

## Key Sections

**Audience:** Web application developers and product designers

**Primary Input:** Interview transcript describing an SR&ED project plus supporting documents

**Primary Output:** CRA-aligned SR&ED Project Description from user-approved idea seeds

## Core Design Principle

"Keep the AI output short during discovery. The writer should evaluate concepts and technical positioning, not review draft paragraphs."

## Workflow Requirements

- Import interview transcript before workflow begins
- Generate 3–5 concise suggestions per subsection
- Allow non-linear navigation through subsections
- Use all approvals, edits, and feedback as context for subsequent suggestions
- Consolidate approved ideas into final summary before generating full description

## Suggestion Behavior

- Each suggestion: max 1–2 brief bullets
- Tags indicate positioning (Conservative, Aggressive, High-level, Detailed, Technical, Alternative angle)
- Writers can select multiple suggestions
- Every card supports Edit and Give feedback actions
- Regeneration preserves subsection goal while incorporating prior approvals

## Information Architecture

**Three Numbered Sections / Thirteen Subsections:**

| Section | Subsection | Behavior |
|---------|-----------|----------|
| 242 | Company / Context | Standard |
| 242 | Goal / Problem | Standard |
| 242 | Technological limitations | Standard |
| 242 | Technological objectives | Standard |
| 242 | Technological uncertainties | Standard |
| 244 | Summarization of previous-year work | Optional |
| 244 | Work plan | Optional |
| 244 | Hypothesis | Standard |
| 244 | Experimentation / Iterations | Multiple |
| 246 | Advancement to science / technology | Standard |
| 246 | Specific technological advancements | Multiple |
| 246 | Project status and next steps | Standard |
| 246 | Overall company / project goal improvements | Standard |

## Dependency Logic

Earlier Section 242 choices influence Section 244 suggestions; approved experimentation choices influence Section 246 technological advancement suggestions. Users can navigate in any order; all subsequent suggestions remain influenced by prior selections.

## Interaction Model

| Action | Immediate Result | Downstream Effect |
|--------|------------------|-------------------|
| Select | Marks one or more idea seeds | Approved ideas inform later subsections |
| Edit | Changes suggestion inline | Edited wording becomes preferred project context |
| Give feedback | Requests targeted revision | AI returns revised option for same subsection |
| Regenerate | Produces alternative suggestions | Prior selections and preferences remain in context |
| Navigate | Opens any subsection | Existing work retained and editable |
| Generate | Creates full description | Summary becomes source plan for narrative draft |

## Three Approved Screen States

**Screen 1 – First Subsection (Section 242 Company and Context)**
- Split-pane model: left persistent outline, right active suggestion workspace
- Five tag-labeled suggestion cards
- Transcript provenance displayed
- Approval action disabled until selection made

Developer notes: Keep outline independently scrollable; use checkbox semantics for multi-select clarity; disable approval until selection; show transcript provenance without overwhelming the writer.

**Screen 2 – Mid-Process Workflow**
- Section 242 complete, two Section 244 subsections approved
- Writer selecting multiple experiments and iterations
- Compact preview of approved ideas beneath completed outline rows
- Seven of thirteen subsections reviewed; two iterations selected

Developer notes: Display compact approved idea previews; distinguish approved items, skipped optional items, active item, and untouched items; use checked control plus border treatment plus Selected label for clarity; keep final approval bar visible during card scrolling.

**Screen 3 – Completed Summary**
- All thirteen subsections reviewed
- Single-column reading flow with generous spacing
- All three approved experiments visible directly (not hidden behind modals)
- Sticky section and subsection navigation
- Individual Edit actions per experiment

Developer notes: Use readable vertical flow instead of compressed layout; keep section navigation sticky; display every selected experiment directly; retain individual Edit actions; keep generation settings and Generate action available without obscuring review content.

## Suggested State Model

| Entity | Minimum Fields | Purpose |
|--------|----------------|---------|
| Project | id, title, transcriptRef, status | Owns workflow progress and generation settings |
| Subsection | code, title, order, status, optional, multiSelect | Defines navigation and completion behavior |
| Suggestion | id, subsectionId, bullets, tags, provenance | Represents one AI-proposed idea seed |
| Selection | suggestionId, editedBullets, approvedAt | Stores writer-approved version |
| Feedback | suggestionId, instruction, revisionId | Connects targeted feedback to regenerated content |
| Generation settings | style, position, targetLength | Controls final drafting pass |

## Recommendation and Regeneration Context

- Send current subsection objective, relevant transcript excerpts, all approved selections, edited text, prior feedback, and generation settings with each suggestion request
- Version suggestions and selections to prevent silent overwrites when returning to earlier subsections
- When upstream approval changes, identify stale later subsections and offer controlled regeneration
- Persist selection state immediately; support undo for destructive changes
- Keep generated prose separate from approved summary for auditability

## Accessibility and Responsive Behavior

- All selection, navigation, edit, feedback, and generation controls must be keyboard accessible
- Tags supplement meaning but never serve as sole indicator of selection or completion
- On narrower screens: stack outline above workspace or convert to persistent drawer
- Announce generation, saving, selection counts, and validation errors to assistive technology
- Preserve visible focus states and meet accessible contrast targets

## Conversation Record (Design Evolution)

**Initial Request:** Build first-step screenshot with split panes—left side accumulates approved subsection ideas; right side presents 3–5 short AI suggestions (selectable, editable, revisable via feedback, regeneratable).

**Halfway Request:** Show experience after all Section 242 subsections are generated and a couple of Section 244 subsections are complete.

**Summary Request:** Show full-screen summary after every subsection has been selected.

**Final Handoff Note:** The mockups communicate intended hierarchy and behavior rather than final production copy. During implementation, preserve the short-form ideation model, cross-subsection context, reversible navigation, and explicit human approval before full SR&ED narrative generation.

---

## User chat brief (2026-09-16, verbatim)

> Step-by-Step PD Generation Module
> Currently, the step-by-step module generates full sections (242, 244, 246) and asks for approval, no ability to edit the sections or provide feedback.
>
> Improvements:
> Sections should be generated by individual paragraphs from our PD template, not the full "242/244/246" section
> [242] Company/Context
> [242] Goal/Problem
> [242] Technological limitations
> [242] Technological Objectives
> [242] Technological Uncertainties
> [244] (Optional) Summarization of work from the previous year/where it was left off
> [244] Work plan
> [244] Hypothesis
> [244] Experimentation/Iterations — Multiple to be selected and written
> [246] Advancement to Science/technology
> [246] Specific technological advancements — Multiple to be selected based on what was written in the 244
> [246] Project status and next steps
> [246] Overall company/project goal improvements
>
> These 'suggestions' should be 1-2 bullet point summarizations MAX; not fully written text or sentences. The point here is to seed the ideas to the writer, so the writer and the AI are on the same page, not for the writer to be reviewing fully written paragraphs
> AI will provide multiple choice options for the writer to select from; these can vary both in content and presentation
> Consider including sentiment 'tags' or 'categories', for each suggestion
> The sections can be edited or have text feedback for immediate revision
> The sections can be clicked to be approved (multiple select possible) or re-generated/suggested, as needed
> Finish off with a summary/outline of all the bullet point selections (can be iteratively displayed on the side as the writer works through each section)
> Only, then once the writer signs off on the "summary", then the PD text is generated

Note: the chat brief lists Work plan without "(Optional)"; the design handoff marks it Optional. Recorded as an open question in the PRD.
