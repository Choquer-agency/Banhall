# PSOS-45 — Writer notes as document-level instructions

## Work control

- **Status:** `not_started`
- **Phase:** P11 — August 20 meeting-directed writer flow
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting
- **Progress note:** Writer notes are already highest-trust **content** guidance. They are not given a catalogue of attached files, so instructions about “transcript 1” or “supporting document B” have nothing reliable to bind to.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

Writers need to steer generation at the file layer: which interview to trust, which supporting file is an image to downweight, which developer’s session to prioritize. Today `CONTEXT_INPUTS_GUIDANCE` tells the model that writer notes win on intent, but the analyzer only sees note **text** plus unlabeled document dumps. Johnny confirmed this meta layer does not exist yet.

## Current code

- Category `writer_notes` in `src/lib/contextCategories.ts` / `convex/ai/analyzerAgent.ts`.
- `convex/ai/prompts.ts` `CONTEXT_INPUTS_GUIDANCE`: notes override transcript on framing, but do not list sibling files as addressable objects.
- Extra interviews parked as supporting documents cannot be named as transcripts until PSOS-42.

## Product outcome

When writer notes are present, generation receives a stable manifest of attached transcripts and supporting documents (filename, category, processing status, optional short label). The model is instructed that notes may refer to those files by name. Notes still cannot invent technical claims unsupported by sources.

## Acceptance criteria

- [ ] Generation payload includes a file manifest (id, display name, category, role: transcript vs supporting).
- [ ] Analyzer/system prompt states that writer notes may assign priority, ignore, or context to named files.
- [ ] Notes that mention a filename present in the manifest are followed in a documented, testable fixture (e.g. “ignore drawing.png”).
- [ ] Notes cannot promote a supporting document into a transcript; PSOS-42 remains the transcript model.
- [ ] Missing/unreadable files are listed as such so notes cannot silently target them.
- [ ] Prompt/regression coverage for “prioritize transcript A / downweight image B”.

## Dependencies and boundaries

- **Prefer after:** PSOS-42 so extra interviews are real transcripts in the manifest.
- **Out of scope:** live interview coaching (PSOS-48); Brain writer-style weights (PSOS-46).

## Transcript evidence

- **26:10–27:33:** Michael asks whether writer notes can speak one layer above content, about the files themselves. Johnny: not at the moment; will look into it.
