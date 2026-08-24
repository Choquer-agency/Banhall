# PSOS-41 — Historical Brain ingestion review workspace

## Work control

- **Status:** `ready`
- **Phase:** P10 — governed historical ingestion
- **Current owner:** Unassigned
- **Started:** —
- **Completed:** —
- **Source:** August 14, 2026 meeting transcript supplied by the product team
- **Progress note:** Dedicated initiative defined. Discovery and source-access setup may begin; ingestion remains blocked behind human review and the existing Brain approval/provenance controls. August 20: client uploader zip (`scripts/client-uploader`) was handed to Michael (folder picker, re-open memory, sha256 dedupe). He wants **selective** first ingest, then expand; mapping supporting documents onto individual PDs is still hard because their files are not stored that way. That mapping stays in this ticket’s later phases, not a silent auto-attach.

## Product outcome

Build an administrator review workspace that inventories historical SR&ED material, proposes associations, lets an authorized reviewer approve the selection and linkage, then submits only approved material to the existing governed Brain queue. It is not a one-click scraper and it never writes directly into retrieval storage.

## Phased workflow

1. **Inventory final reports first.** Connect read-only to the approved source system and record file identity, path, modified date, author signal, client/fiscal-year candidates, and parsed filename tokens. Recognize submitted `S0` and revision `R0`, `R1`, … conventions without treating filename parsing as truth.
2. **Review the candidate list.** Provide filters for recency, writer, client, fiscal year, parse confidence, and selection state. Michael or another authorized reviewer can include/exclude rows in bulk and correct proposed metadata.
3. **Expand selected projects.** For approved final reports, discover draft revisions, transcript candidates, and supporting documents. A transcript may relate to multiple projects; ambiguous matches require explicit review.
4. **Approve associations.** Show the proposed final report, revision family, transcript(s), and supporting files together. Record who approved each association, when, and the exact source fingerprint.
5. **Queue ingestion.** Submit approved items to the existing Brain review queue with provenance. Show queued, approved, rejected, ingested, failed, and reverted states. Never bypass BNH-42 or PSOS-25 governance.

## Acceptance criteria

- [ ] Read-only source adapter has an explicit allowlist, bounded pagination, retry policy, and credential owner.
- [ ] Re-running inventory is idempotent by source identifier plus content fingerprint and never duplicates a candidate.
- [ ] Filename parsing records `S0`/`R*` as proposed metadata with confidence and raw evidence; it never silently declares a final report.
- [ ] Candidate list supports reviewer selection by recency and writer, including the meeting examples “most recent 100” and “most recent 20 per writer.”
- [ ] Final reports, revisions, transcripts, and supporting documents remain distinct artifact kinds with source provenance.
- [ ] Many-to-many transcript suggestions are visible and require human confirmation.
- [ ] Every association and selection change is audited and reversible before ingestion.
- [ ] Removing an item from the review workspace is a reversible staged-item action: it moves the row to Deleted, preserves its prior queue state for restore, never deletes the OneDrive original, and cannot remove an approved Brain source.
- [ ] Ingestion writes only to the governed Brain review queue. Approval is the only path to retrieval storage, and the existing revert log remains authoritative.
- [ ] Raw report content from rejected, abandoned, or unapproved candidates cannot reach Brain storage.
- [ ] The UI includes loading, empty, source-offline, parse-failed, permission-denied, partial-batch, and retry states.
- [ ] Cost and volume telemetry is recorded before expanding from finals to revisions/transcripts/supporting files.

## Dependencies and boundaries

- **Depends on:** BNH-42 Brain approval/revert governance; PSOS-25 queue-only learning guardrails. Durable Clients (PSOS-31) improve association quality but are not required for inventory discovery if recorded client names remain clearly qualified.
- **Coordinates with:** PSOS-18–23 for report branches and exact outcomes; PSOS-40 for the future client repository; current Brain namespace/industry routing.
- **Out of scope:** browser automation against an unapproved source, direct vector writes, automatic fuzzy client merges, automatic transcript attachment, external file deletion, or training-provider fine-tuning.

## Decision log

| Date | Decision | Reason | Approved by |
|---|---|---|---|
| 2026-08-14 | Inventory final reports before revisions, transcripts, and supporting files. | Finals have the strongest `S0` naming convention and give reviewers the smallest useful first pass. | Product owner meeting direction |
| 2026-08-14 | Use procedural discovery plus human cleanup/approval. | Historical naming is structured but not uniformly reliable; transcripts can map to multiple projects. | Product owner meeting direction |
| 2026-08-14 | Reuse the governed Brain queue; no direct ingestion path. | Preserves provenance, rejection, approval, and revert guarantees. | Existing product-domain contract |
| 2026-08-17 | Treat the admin “Delete” action as reversible removal from the staged queue. | Gives reviewers a clear cleanup action without expanding source-system permissions or bypassing Brain revocation governance. | Product owner browser direction |

## First implementation slice

Produce a read-only adapter spike and a static-data review prototype containing only final-report candidates and proposed `S0` metadata. Do not request write/delete permissions and do not ingest content. Measure parse confidence, duplicate rate, reviewer time per 100 rows, and source API limits; use those measurements to split implementation tickets.
