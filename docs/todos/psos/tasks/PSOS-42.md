# PSOS-42 — Multiple interview transcripts per project

## Work control

- **Status:** `ready`
- **Phase:** P11 — August 20 meeting-directed writer flow
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 20, 2026 meeting (Tracy request; Johnny confirmed still in progress)
- **Progress note:** Schema already allows many `transcripts` rows per project, but every product path treats the first row as the only transcript. Tracy is workaround-uploading extra interviews as supporting documents.

> Work this ticket independently after every dependency is complete or explicitly waived. Preserve the one-active-ticket rule.

## Problem

Writers often run more than one interview for a single PD. The new-project wizard and project files panel accept a single transcript. Tracy attempted to treat a second interview as a supporting document plus writer-notes instructions; that path is unofficial and does not pin the extra interview as a transcript source.

## Current code

- `convex/schema.ts` `transcripts` is indexed `by_projectId` with no uniqueness constraint.
- `convex/transcripts.ts` `getTranscript` returns `.first()` only.
- Wizard, `FilesPanel`, `CurrentProjectPage`, `PreviewProjectPage`, and duplication copy that single row.
- Generation provenance stores one `sourceTranscriptId` / `transcriptId` on the generation/report.

## Product outcome

A project can attach, list, and generate from multiple interview transcripts as first-class sources. Writer-notes remain a separate document category (PSOS-45 owns document-level instructions). Extra interviews must not be forced into `other` / supporting-document slots.

## Acceptance criteria

- [ ] New-project and existing-project upload accept more than one transcript file (and paste) without replacing the first.
- [ ] Files panel lists every transcript as a named interview, not as supporting material.
- [ ] Generation concatenates or otherwise consumes all attached transcripts with stable per-file labels so the model can distinguish speakers/sessions.
- [ ] Provenance records every transcript used, not only the first row.
- [ ] Duplicate-project and review-from-project copy the full transcript set.
- [ ] Empty, single, and many-transcript states are labelled; removing one transcript does not delete the others.
- [ ] Tracy’s supporting-document workaround is no longer required; docs/help copy does not recommend it.
- [ ] Regression tests cover list/get/upload/generate/duplicate with 0, 1, and N transcripts.

## Dependencies and boundaries

- **Coordinates with:** PSOS-04 mixed-upload receipt; PSOS-45 writer-notes meta instructions; Jul 17 “transcript optional” draft if still open.
- **Out of scope:** real-time live transcription (PSOS-48); treating supporting PDFs as transcripts automatically; Brain ingestion of interviews.

## Transcript evidence

- **11:34–11:53:** Tracy flagged multiple transcripts for reports; Johnny is still building it.
- **25:32–26:10:** Michael confirmed it is not done. Tracy put a second interview in supporting documents and asked writer notes to treat it as a transcript.

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-08-20 | Keep interviews in `transcripts`, not `projectDocuments`. | Supporting-document categories already have different generation weight; interviews are the primary source. | Meeting direction; engineering default |
