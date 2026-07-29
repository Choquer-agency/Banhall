# PSOS-39 — Discovery: project source-analysis workspace

## Work control

- **Status:** `not_started`
- **Phase:** P9 — meeting-directed discovery
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** July 27, 2026 meeting transcript supplied directly by the product team
- **Progress note:** Timeboxed discovery only. Define the source-analysis artifact and workflow before implementation; do not create a generic ChatGPT clone.

## Problem

Before an interview or PD generation, consultants may receive dozens of engineering drawings, supporting documents, or timesheets. They need to ask project-specific questions, summarize relevant evidence, create chronologies, and isolate the small portion relevant to the claimed uncertainty. The reviewed and edited output should become an explicit input to later PD generation or report review.

## Transcript evidence

- **11:10–14:43:** Michael describes a third mode before generation that analyzes uploaded drawings/documents/timesheets, answers focused questions, produces editable summaries or chronologies, and passes the approved output into generation or review.
- Examples include hull-rigidity evidence across engineering drawings and a chronological employee-work summary from timesheets.
- **06:46–10:58:** a generic ChatGPT-like baseline mode is discussed but explicitly back-burnered because API behavior and cost may not match the familiar product experience.

## Discovery questions

- What is the canonical **Source analysis artifact** and how are its revisions stored?
- Is it project-scoped evidence, a dedicated document type, or another record? It must not masquerade as a report branch.
- How does a user explicitly approve an exact analysis revision for generation or review?
- How does generation provenance pin the exact approved revision consumed?
- Which project documents are included/excluded, and how do `processingStatus`, `archived`, and AI-exclusion settings apply?
- How are large mixed sets bounded, summarized, cited, and costed?
- How do private uploaded documents remain private while external research citations remain distinguishable?
- Which existing BNH/PSOS work should be extended rather than duplicated?

## Acceptance criteria

- [ ] Produce a user journey: upload/select sources → ask/analyze → editable artifact → review/approve exact revision → use in generation or report review.
- [ ] Define Source analysis artifact vocabulary, storage, revision, provenance, approval, and retention contracts.
- [ ] State explicitly that the artifact is not a draft branch, production outcome, or automatically governed Brain knowledge.
- [ ] Define how an exact approved revision is pinned in every downstream generation/review that consumes it.
- [ ] Define source citations and privacy boundaries for uploaded project evidence versus external web research.
- [ ] Define token/cost limits, cancellation, retry, partial-source failure, and stale-analysis behavior.
- [ ] Enumerate loading, empty, unsupported-source, no-readable-text, permission-denied, conflict, and partial-success states.
- [ ] Reconcile overlap with PSOS-04, PSOS-06, existing generation/review flows, and any applicable BNH interview-coaching work.
- [ ] Produce implementation tickets and dependencies; no implementation code in this discovery ticket.

## Explicit non-goals

- Generic assistant/ChatGPT product clone.
- Automatic ingestion into The Brain.
- Client/company-wide repository chat or analytics.
- Costing allocation workflows owned by PSOS-32–34.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-28 | Use the neutral name “Project source analysis” until the product team approves a final mode name. | The transcript’s mode name is censored and should not be guessed. | Planning decision |
| 2026-07-28 | Treat analysis as an explicit, revisioned input artifact rather than a branch. | It precedes report drafting and must not duplicate PSOS-18–20 branch semantics. | Claude Code/Fable and Opus planning reviews |

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| 2026-07-28 | Meeting request separated from the back-burnered generic assistant idea. | A focused discovery task now covers the valuable multi-document analysis-to-generation workflow without promising ChatGPT parity. |

## Completion record

- **Approved flow/specification:** —
- **Implementation tickets:** —
- **Known limitations at creation:** Final mode name, storage, model/cost bounds, and downstream provenance contract remain unresolved.
