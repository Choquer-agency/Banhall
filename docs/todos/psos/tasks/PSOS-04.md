# PSOS-04 — Mixed-upload processing receipt with per-file statuses

## Work control

- **Status:** `in_review`
- **Phase:** P1
- **Current owner:** Pi coding agent → release owner for deploy
- **Started:** 2026-07-24
- **Completed:** — (implementation complete 2026-07-27; awaiting authenticated Chrome QA + deploy)
- **Source plan:** [`../../../futur-board-ticket-breakdown-psos.md`](../../../futur-board-ticket-breakdown-psos.md)
- **Progress note:** All implementation steps 1–19 are complete locally. Planned and reviewed stepwise on claude-fable-5; final Fable audit verdict: **SHIP WITH KNOWN LIMITATIONS**, no code blocker. Green gates: 348/348 unit/integration tests, 33/33 component tests, `npm run check` 0 errors/warnings, Convex TypeScript clean, production build exit 0, `git diff --check` clean. Installed Google Chrome 150 was driven directly over CDP (no Playwright) for browser evidence: all receipt states rendered, zero undersized targets/row overlap/spill, correct summary/live region, direct Tab traversal through receipt actions, and an offline mutation probe confirmed bare Convex mutation hangs while `withUploadTimeout` rejects. Release remains `in_review` because authenticated project-page Chrome scenarios (actual chat retry + persisted replace) and Convex-first deployment require a signed-in release account, and the pre-existing dirty worktree contains unrelated changes that must not be blindly co-committed.

> Work this ticket independently. Do not start implementation until every dependency below is complete or explicitly waived in this file. Only one PSOS ticket should normally be `in_progress` at a time.

## Execution checklist

### 1. Prepare

- [x] Run and record a Claude Code/Fable high-reasoning planning pass before implementation.
- [x] Re-read this ticket, its dependencies, and linked existing BNH work.
- [x] Inspect the current implementation and record affected files before editing.
- [x] Confirm unresolved decisions and assumptions; document any approved waiver. (Q3/Q6 → DECISION 3.)
- [x] Define the smallest safe rollout slice and rollback path. (§12; steps 1–3 are pure additions, 4–5 the trust boundary.)

### 2. Implement

- [x] Complete backend/schema/domain work in scope.
- [x] Complete frontend/UX work in scope.
- [x] Add loading, empty, failure, permission-denied, and conflict states where relevant.
- [x] Add audit, authorization, OCC/idempotency, and migration handling where relevant. (Backfill intentionally deferred by Amendment D; read-time fallback is the correctness path.)
- [x] Keep unrelated behavior and files unchanged. (PSOS edits are scoped; worktree also contains pre-existing unrelated changes which remain uncommitted.)

### 3. Verify acceptance criteria

- [x] Work through every acceptance criterion below individually and attach evidence in the work log.
- [x] Add or update unit, integration, and regression coverage required by this ticket.
- [x] Verify keyboard, screen-reader labeling, touch targets, responsive layout, and reduced motion for UI work. (33 browser component tests + direct Chrome CDP evidence; authenticated project-page flows remain release QA.)

### 4. Validate and close

- [x] Run and record a fresh Claude Code/Fable post-implementation review; resolve or explicitly disposition every finding.
- [x] Run targeted tests for the changed area.
- [x] Run `npm run check`.
- [x] Run the Convex TypeScript check.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run formatting/lint commands if present and `git diff --check`.
- [x] Review the final PSOS diff for unsafe migration behavior and leaked secrets. (No artifacts/secrets; unrelated pre-existing dirty work identified and deliberately not committed.)
- [ ] Run authenticated Chrome release QA, commit a scope-reviewed diff, deploy Convex first then frontend, and update this file to `done`.

## Ticket specification

**Priority**: P1.
**Problem**: When users upload a mixed batch (transcripts, PDFs, .msg, images, corrupt
files), outcomes are opaque; failures surface mid-generation or never. Low-tech users
need one obvious receipt.
**Context**: Uploads via `convex/documents.ts` / `projectDocuments` table (has extraction
metadata), transcripts in `convex/transcripts.ts`; prior art BNH-33 (unsupported-type
warning, done) and BNH-34 (.msg support). This ticket extends those into a full receipt.
**In scope**: After each upload batch, a processing receipt listing every file with one
status: **Ready for AI**, **Reference only**, **Ready — text truncated**, **Skipped —
unsupported type**, **Could not read**, **Upload failed**; per-status plain-language
explanation + suggested action; receipt reachable later from the project files panel
(not toast-only). Persist per-file processing status on `projectDocuments` if missing.
**Scope amendments (human product decisions, 2026-07-27):**
- **DECISION 1 — Durable audit trail.** Files that fail before a `projectDocuments`
  row exists (network/storage failure; files rejected client-side as unsupported)
  MUST persist and survive reload. A new `documentUploadAttempts` table is in scope.
- **DECISION 2 — Retry in-session, Replace after reload.** While the browser still
  holds the `File`, a failed row offers true one-click retry. After reload the bytes
  are gone, so it degrades to a "Replace file…" picker. Two code paths.
**Out of scope**: New extractors; changing generation behavior.
**UX**: Dense ruled list (ledger style), status as text badge + icon (not color-only);
retry/remove actions inline; batch summary line ("6 files: 4 ready, 1 reference only,
1 failed"). Loading state per file while extraction runs; empty state if no files.
**Technical notes**: widen `projectDocuments` with `processingStatus` +
`processingDetail` if not present; derive statuses in mutation/action that finalizes
extraction; receipt component `src/lib/components/upload/UploadReceipt.svelte`; reuse
whitelist from BNH-33.
**Acceptance criteria**:
- [x] Given a batch with one unsupported, one unreadable, and two good files, receipt
      shows four rows with correct statuses and actions. (`receiptRows.test.ts` AC1 + live receipt implementation.)
- [x] Truncated extraction (size limits) shows "Ready — text truncated" with what that
      means for generation quality. (Parser regression tests + AC2 copy/status tests.)
- [x] Statuses persist and re-render on revisit; no provider/internal error strings leak.
      (Server fields + read-time fallback + attempts table/outbox; literal-union schemas and banned-copy test.)
- [x] Upload failure (network) distinguishable from extraction failure.
      (`upload_failed` attempts vs `could_not_read` documents; AC4 test. Chrome offline probe verified the timeout mechanism.)
- [x] Tests: status derivation unit tests; component states; keyboard nav across rows.
      (348 unit/integration + 33 browser component tests.)
**Dependencies**: none hard. **Rollout**: backfill `processingStatus` for existing docs
as best-effort (`Ready for AI` when extractedText present, else `Could not read`).
*(Rollout rule amended by decision log below — the literal rule mislabels images; the
backfill runs the shared derivation function instead.)*

## Decision and assumption log

| Date | Decision or assumption | Reason | Approved by |
|---|---|---|---|
| 2026-07-27 | Status derivation lives in one pure module `shared/documentStatus.ts` and is called **server-side** in `uploadDocument`; the client sends only structured *facts*, never a status and never an error message. | Parsing runs in the browser, so a client-declared status is unvalidated data crossing a trust boundary — the exact shape of the last two bugs. The mutation owns the fact→status mapping. Confirmed by the Codex research pass. | Planning decision (re-confirmed on claude-fable-5) |
| 2026-07-27 | The client's only new derivation fact is `extractionOutcome: "ok" \| "failed"` (an enum, not a message). Truncation is re-derived **server-side** by scanning the tail of the stored `content` for known markers. | The server already holds the authoritative `content`; a client `truncated` boolean would be a second unvalidated input for no gain. | Planning decision |
| 2026-07-27 | `processingDetail` is a **literal-union reason code**, never free text. Same for `documentUploadAttempts.failureCode`. | Structurally makes the "no provider/internal error strings leak" criterion unfalsifiable — the validator rejects prose. Deliberately unlike `financialUploads.processingError: v.string()` (`convex/schema.ts:204`), a known prose-leak vector that is NOT copied. | Planning decision |
| 2026-07-27 | **SUPERSEDED (DECISION 1):** `upload_failed` was planned as session-only. It now persists — but on the new `documentUploadAttempts` table, **never** as a `projectDocuments.processingStatus` value. `ProcessingStatus` (5 values, persisted on documents) and `ReceiptStatus` (6 values, presentation union) stay distinct types. | A failed upload has no document row to carry a status; the attempts table is the durable home for failures. | Human DECISION 1 |
| 2026-07-27 | Attempt idempotency: the client generates a UUID `attemptKey` per file; `recordUploadAttempts` **upserts** by `(projectId, attemptKey)`; `uploadDocument` resolves the attempt (status `succeeded` + `documentId`) **in the same transaction** as the document insert — and also on the dedupe-hit return path. Retry and Replace reuse the same `attemptKey`. | Retries never double-create; the receipt can never show the same file twice (succeeded attempts are excluded from the list query); a dedupe hit without resolution would otherwise leave a ghost "in progress" attempt. | Planning decision (DECISION 1 mechanics) |
| 2026-07-27 | Attempt "Remove" sets `status: "dismissed"`; rows are never user-deleted. Cleanup is **prune-on-write** with a per-project cap (100), via a pure helper mirroring `snapshotIdsToDelete` (`convex/lib/snapshots.ts:142`). Stale `in_progress` attempts (>10 min) are **displayed** as failed by read-time derivation — no cron rewrites stored status. | Matches the repo's two established patterns: snapshots prune on write; invites derive expiry at read (`convex/invites.ts:131-137`). The domain contract forbids crons that rewrite status "merely because time passed". Preserves the audit trail DECISION 1 asks for. | Planning decision |
| 2026-07-27 | Failures that never reach Convex (network down at the first mutation) are queued in a **localStorage outbox** holding only `{projectId, attemptKey, fileName≤200, fileSizeBytes, origin, failureCode, at}` — never bytes, never error strings (the entry type has no message field) — and flushed idempotently through `recordUploadAttempts` on next authenticated load. | A server table categorically cannot record a request that never arrived; this is the only honest way to satisfy DECISION 1's "survive reload" for the total-network-failure case. Structural field whitelist keeps the leak criterion intact. | Planning decision (DECISION 1 mechanics) |
| 2026-07-27 | **Retry in-session / Replace after reload (two code paths).** In-session rows keep the `File` object and re-run the full pipeline under the same `attemptKey`. After reload, failed attempts and non-`ready` documents offer **Replace file…** (scoped picker). Replace on a persisted document is guarded against `uploadDocument`'s dedupe: `const newId = await uploadDocument(...); if (newId !== oldId) await deleteDocument(oldId)`. | The dedupe (`convex/documents.ts:60-80`) can return the *existing* row's id; "upload then delete the old row" unguarded would delete the row just returned. The id-compare makes an identical-content replace a safe no-op. | Human DECISION 2 + verified dedupe finding |
| 2026-07-27 | **xlsx/PDF truncation: no behavioural fix in this ticket.** `parseDocument.ts:255-262` pushes the sheet **before** the size check, so joined length exceeds the cap and `capContent` DOES append the marker — a size-truncated workbook already derives `ready_truncated`. Same for the PDF size path (`:226-239`), where `capContent` replaces the page-specific marker with the generic one. This ticket adds **regression tests** asserting the marker is present and derives `ready_truncated`; structured truncation metadata (which sheets/pages were dropped) is a follow-up ticket. | The prior plan's claim that the xlsx break skips the marker was **wrong** (independently verified). The real defect — silently dropped sheets described only by a generic marker — is real but narrower, and fixing it is scope expansion under queue rule 5. | Codex research pass (verified); planning decision |
| 2026-07-27 | **DECISION 2 refinement:** "non-`ready` documents offer Replace" is implemented as the three AI-unusable statuses (`reference_only`, `could_not_read`, `skipped_unsupported`), explicitly **excluding** `ready_truncated`. | Replace (step 18) deletes the old row. A truncated file did capture real text, and §9's action for it is "split the file and upload that section on its own" — offering a destructive Replace beside that advice would contradict it and lose captured content. Literal reading of DECISION 2's wording would have included it. | Implementation decision (plan flag F2), recorded here so the shipped behaviour matches the decision log |
| 2026-07-27 | Backfill runs the same `deriveProcessingStatus` function rather than the ticket's `extractedText ? ready : could_not_read` rule. | The ticket rule mislabels every image as `Could not read`; images are `reference_only` by design (`parseDocument.ts:269-277`), not `could_not_read`. Same function everywhere = one truth. | Planning decision (amends ticket Rollout line) |
| 2026-07-27 | `listDocuments` derives a **read-time fallback** status for rows where `processingStatus` is undefined, using the same pure function. | Existing documents get truthful statuses immediately; the backfill becomes a persistence optimization instead of a correctness prerequisite; no "Not recorded" placeholder state. | Planning decision |
| 2026-07-27 | Truncation-marker scan reads only the last 300 chars of `content`; all markers are appended at the tail by construction, and the marker constants are exported from `shared/documentStatus.ts` and imported by `parseDocument.ts`. | Producer and detector cannot drift; a full scan of up to 250 × 400k chars inside a reactive query is a real performance hazard. | Planning decision |
| 2026-07-27 | A supported-but-empty file (empty `.txt`, scanned PDF, image-only `.docx`) resolves to **Could not read**, with copy truthful for both causes ("No readable text was found in this file"). | The causes are indistinguishable from the extracted bytes and have identical consequence. Generation already treats `content.trim() === ""` as unusable (`convex/documents.ts:173`, `convex/generations.ts:224-236`); derivation agrees. | Planning decision |
| 2026-07-27 | An unsupported extension that nevertheless yielded text resolves to **Ready for AI**, not **Skipped**. `Skipped — unsupported type` requires no usable text. | Generation consumes any document with non-empty content; "Skipped" would lie about what the AI can see. | Planning decision |
| 2026-07-27 | Pasted-text documents (the two distinct wizard call sites, `src/routes/project/new/+page.svelte:443-451` and `:462-470`) are marked via an explicit `intake: "pasted"` argument. | They have no file extension, so extension-based derivation would wrongly flag them `Skipped — unsupported type`. | Planning decision |
| 2026-07-27 | The persistent receipt surface (`FilesPanel`) additionally mounts **outside the report gate** on `project/[id]` — today it renders only inside `{#if … && report}` (`+page.svelte:1056`, mount at `:1086`), so a project whose generation never produced a report has no files panel at all. | Exactly the failure cases this ticket exists for (upload failed, generation never completed) currently have no "reachable later" surface; the ticket's contract is unsatisfiable without this. `FilesPanel` already takes `reportId` as optional. | Planning decision (resolves verified gating finding) |
| 2026-07-27 | Wizard file rejections that occur **before `createProject`** cannot be recorded as attempts (there is no `projectId` yet) and remain session-only with the existing inline error. Upload failures **during** the wizard's commit loop (project exists) ARE recorded as attempts and surface on the project files panel after navigation. | Honest boundary of what a project-scoped server table can capture; inventing a pre-project holding table is scope expansion. | Planning decision |
| 2026-07-27 | Component-state and keyboard-nav coverage uses the PSOS-03 waiver (svelte-check + exhaustive pure-logic tests + documented manual verification) instead of adding a jsdom component-test harness. | The repository still has no browser component-test stack; adding one is unrelated infrastructure scope. | Planning waiver (see Open question Q6) |
| 2026-07-27 | **DECISION 3 — Q3 accepted as recommended, Q6 rejected.** Q3: a storage-bytes failure with successful text extraction stays unchanged in v1 and becomes a follow-up ticket. Q6: the component-test harness is **funded** — component states and keyboard nav are automated in this ticket rather than covered by the PSOS-03 waiver. This supersedes the "Component-state and keyboard-nav coverage uses the PSOS-03 waiver" row above and the AC5 waiver in §13. | Human product decision. | Human DECISION 3 |
| 2026-07-27 | Convex deploys **before** the frontend. | All new mutation args and the attempts API are additive/optional, so old clients keep working against the new server; the reverse ordering would reject the new args. | Planning decision |

## Claude planning pass

*Recorded 2026-07-27 on **claude-fable-5** (high reasoning), superseding in full the earlier pass that ran on the wrong model (Opus 5). Inputs: the prior pass, the Codex research verification of it, and human product DECISIONS 1–2. No source file was modified by this pass.*

### 1. Current-state map

**Server-side writers of `projectDocuments` — exactly two:**

| # | Writer | File:line | Notes |
|---|---|---|---|
| S1 | `uploadDocument` mutation | `convex/documents.ts:39-96` (dedupe `:60-80`, insert `:82-94`) | The only public write. Dedupes on `(fileName, content)` and returns the existing `_id` on a hit — **any replace/delete flow must id-compare against this** (see §4). |
| S2 | `copyProjectInputRows` (project duplication) | `convex/projects.ts:384-426` (direct `ctx.db.insert` at `:408-419`) | **Bypasses `uploadDocument` entirely.** Must carry the source row's status over (or derive when the source predates this ticket). |

**Client call sites that reach S1 (production ingress):**

| # | Entry point | File:line | Behaviour today |
|---|---|---|---|
| C1 | Chat panel batch upload | `src/lib/components/chat/AgentChatPanel.svelte:436-487` (`uploadFiles`) | storage POST → `parseFileToText` → `uploadDocument`. Swallows storage failure (`:453`), folds parse failure into `content: ""` (`:456-462`), surfaces one overwriting `uploadError` string (rendered `:616-629`). Unsupported files are rejected at the file input (`:716-731`) and never reach the server — today that leaves only a transient error string. |
| C2 | Wizard, context files | `src/routes/project/new/+page.svelte:396-448` (`uploadFile`; storage helper `:333-346`) | Same shape; failures collect into `skippedFiles` and become a toast. Runs inside `commit()` — the project already exists. |
| C3 | Wizard, pasted previous-year note | `src/routes/project/new/+page.svelte:443-451` | Inserts `Previous-year note (FY <year>)` — **no file extension**. |
| C4 | Wizard, pasted category text | `src/routes/project/new/+page.svelte:462-470` | Inserts `<Category> (pasted)` — **no file extension**. Distinct call site from C3 (the prior pass merged them). |
| C5 | Wizard, review-mode PD | `src/routes/project/new/+page.svelte:474-492` (`source: "review_pd"`) | Pre-validated by `isSupportedFile` + non-empty text in `handlePdFile` (`:211-231`); feeds `pdReviews.startPdReview`. |

Test fixtures (`convex/projects.test.ts`) are **not** production ingress and are not counted; they only change if the schema later narrows.

**Consumers that must not regress:**

- `convex/documents.ts:98-126` `listDocuments` — projection with exactly **two** frontend consumers: `src/lib/components/editor/FilesPanel.svelte:93` and `src/lib/components/evidence/FilingReadinessPanel.svelte:33`.
- `convex/documents.ts:165-180` `getContextDocsForGeneration` + `convex/generations.ts:224-236`, `:310-320` — generation treats `content.trim() === ""` as unusable; derivation agrees (empty content can never be `ready`).
- `src/routes/project/[id]/+page.svelte:1056/:1086` — **`FilesPanel` is report-gated.** No report ⇒ no files panel ⇒ the ticket's "reachable later from the project files panel" is currently unsatisfiable for the very failure cases in scope. Resolved in §7 (mount outside the gate).
- `src/lib/parseDocument.ts` — whitelist `:27-55`, cap marker `:87-93`, extension helpers `:95-108`, PDF page-stop `:237-239`, xlsx loop `:243-263`, images `:269-277`, mbox overflow `:328-331`. Browser-only dynamic imports (pdfjs/xlsx/mammoth) mean **Convex must never import this file** — the pure registry pieces move to `shared/` (§2).
- `convex/transcripts.ts` — different table, no extraction status; out of scope. The pinned transcript row in `FilesPanel` (`:236-297`) keeps rendering **without** a status badge.

**Files that must change** (step order in §11): `shared/documentStatus.ts` (new), `src/lib/uploads/documentStatus.test.ts` (new), `src/lib/parseDocument.ts` + `src/lib/parseDocument.test.ts`, `convex/schema.ts`, `convex/documents.ts` + `convex/documents.test.ts` (new), `convex/projects.ts`, `convex/uploadAttempts.ts` (new) + `convex/lib/uploadAttempts.ts` (new) + `convex/uploadAttempts.test.ts` (new), `convex/documentStatusMigration.ts` (new) + `.test.ts` (new), `src/lib/uploads/attemptOutbox.ts` (new) + `.test.ts` (new), `src/lib/uploads/processingStatus.ts` (new) + `.test.ts` (new), `src/lib/uploads/receiptRows.ts` (new) + `.test.ts` (new), `src/lib/components/upload/ProcessingStatusBadge.svelte` (new), `UploadReceiptRow.svelte` (new), `UploadReceipt.svelte` (new), `src/routes/styleguide/+page.svelte`, `src/lib/components/editor/FilesPanel.svelte`, `src/lib/components/chat/AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte`, `src/routes/project/[id]/+page.svelte`.

### 2. Status derivation — the core design

**Trust boundary (kept from the prior pass; independently confirmed).** Extraction runs in the browser (`parseFileToText`), but the browser produces **facts** and the **mutation** owns the fact→status mapping and is the only writer of `processingStatus`. Of the derivation inputs, four are recomputed server-side from data the server already holds; exactly two cross the boundary, both as validated two-value enums:

| Input | Source | Trust |
|---|---|---|
| extension / whitelist membership | server, from `args.fileName` | server-authoritative |
| is-image | server, from `args.fileName` | server-authoritative |
| has usable text | server, `args.content.trim().length > 0` | server-authoritative |
| truncated | server, marker scan over the last 300 chars of `args.content` | server-authoritative |
| parse threw | client `extractionOutcome: "ok" \| "failed"` (default `"ok"`) | validated enum; only ever *narrows* a decision the server would make from empty content anyway |
| pasted vs file | client `intake: "file" \| "pasted"` (default `"file"`) | validated enum; a lie mislabels one row, never corrupts data |

Deliberate property: **an old or lying client still yields a correct-or-conservative status**, because empty content forces a non-ready status on its own.

**The pure module — `shared/documentStatus.ts`.** `shared/` is the established both-sides home (`shared/roles.ts`, `shared/pdReview.ts`, `shared/generationModels.ts`); `convex/lib/` is Convex-only, and importing `src/lib/parseDocument.ts` from Convex would drag in browser-only dynamic imports. This module absorbs the **pure registry** pieces — `SUPPORTED_EXTENSIONS`, `IMAGE_EXTENSIONS`, `getFileExtension`, `isSupportedFile`, `isImageFile`, `SUPPORTED_LABEL`, `SUPPORTED_ACCEPT` — which `parseDocument.ts` then re-exports unchanged so its existing importers don't churn. It also exports the truncation markers as constants/builders (`CAP_TRUNCATION_MARKER`, `pdfPageStopMarker(page)`, `mboxOverflowMarker(count)`) plus `hasTruncationMarker(content)` (tail-300 regex scan), imported by `parseDocument.ts` so producer and detector can never drift.

```ts
export const PROCESSING_STATUSES = [
  "ready", "ready_truncated", "reference_only",
  "could_not_read", "skipped_unsupported",
] as const;                                    // persisted on projectDocuments
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/** Presentation union: adds the attempts-only failure. Never persisted on projectDocuments. */
export type ReceiptStatus = ProcessingStatus | "upload_failed";

export const PROCESSING_DETAILS = [
  "text_extracted", "text_truncated", "image_reference",
  "no_text_extracted", "parse_failed",
  "unsupported_extension", "pasted_text",
] as const;
export type ProcessingDetail = (typeof PROCESSING_DETAILS)[number];

export type ExtractionFacts = {
  fileName: string;
  content: string;
  extractionFailed?: boolean;   // client fact, default false
  intake?: "file" | "pasted";   // client fact, default "file"
};

export function deriveProcessingStatus(f: ExtractionFacts):
  { status: ProcessingStatus; detail: ProcessingDetail };
```

**Precedence (first match wins). This ordering is the specification — implement it literally.** Status and detail are returned as one pair from one table, so they can never disagree (`ready_truncated` ⇔ truncation detail by construction).

| # | Condition | Status | Detail |
|---|---|---|---|
| 1 | `intake === "pasted"` && has text | `ready` | `pasted_text` |
| 2 | `intake === "pasted"` && no text | `could_not_read` | `no_text_extracted` |
| 3 | is image (ext ∈ `IMAGE_EXTENSIONS`) && no text | `reference_only` | `image_reference` |
| 4 | is image && has text | `ready` / `ready_truncated` if marker | `text_extracted` / `text_truncated` |
| 5 | not on whitelist && no text | `skipped_unsupported` | `unsupported_extension` |
| 6 | not on whitelist && has text | `ready` / `ready_truncated` if marker | `unsupported_extension` / `text_truncated` |
| 7 | `extractionFailed` && no text | `could_not_read` | `parse_failed` |
| 8 | no text (supported, non-image, no parse error) | `could_not_read` | `no_text_extracted` |
| 9 | has truncation marker | `ready_truncated` | `text_truncated` |
| 10 | otherwise | `ready` | `text_extracted` |

`hasText = content.trim().length > 0`. Extension matching is case-insensitive (`.PDF` works — reuse `getFileExtension`). A file with no extension and `intake: "file"` falls to rule 5/6.

**Boundary cases, answered explicitly:**

- **Reference only vs Could not read.** An image is `reference_only` *by nature*, not by failure — `parseFileToText` deliberately returns `""` for images (`parseDocument.ts:269-277`); nothing was attempted, so nothing failed. A non-image supported file with no text is `could_not_read`: the user's expectation was text and they got none. Discriminator = extension, evaluated first (rules 3–4 before 7–8).
- **Empty `.txt` / scanned PDF / image-only `.docx`.** `could_not_read` (rule 8); copy is truthful for all causes.
- **Parse threw but partial text survived.** Rules 7–8 require empty text; a partial parse is `ready`/`ready_truncated` — truthful, the AI can use what was recovered.
- **Unsupported extension that yielded text.** `ready` (rule 6) — generation will feed it to the model; "Skipped" would be false.
- **Truncation (corrected from the prior pass).** All three size paths already end with a detectable tail marker: the generic cap marker (`capContent`, `:87-93`), and — because the xlsx loop **pushes before breaking** (`:255-256`) and the PDF/mbox paths append their specific marker before `capContent` — any size-truncated document carries either its specific marker or the generic one at the tail. **No parser behaviour changes in this ticket.** Regression tests pin this (§10). The real narrower defect (whole sheets/pages silently dropped, described only generically) becomes a follow-up ticket for structured truncation metadata.

**Callers of `deriveProcessingStatus`:**

1. `uploadDocument` — derive before insert; write both fields. On the **dedupe path** (`:60-80`), patch `processingStatus`/`processingDetail` only when the existing row has none (backfill-on-touch; content is identical by the dedupe key, so never churn an existing value). Also resolve any attempt (§4) on **both** paths.
2. `copyProjectInputRows` (`convex/projects.ts:408`) — carry `doc.processingStatus`/`processingDetail` when present, else derive from the copied content (`intake: "pasted"` inferred when the file name has no extension). A duplicate reports the same truth as its source. Attempts are **not** copied — they are audit history of the source project's ingestion, not project input.
3. `listDocuments` — read-time fallback: `d.processingStatus ?? derive(...)`. Pre-backfill rows render truthfully on day one.
4. `documentStatusMigration` — persists what the fallback already computes.

### 3. Schema — widen only (rule 6)

**3a. `projectDocuments` widening** (after `archived`, `convex/schema.ts:~561`), both optional:

```ts
    // PSOS-04: per-file processing outcome, derived server-side in
    // uploadDocument from observable extraction facts (shared/documentStatus.ts).
    // Optional during widen → backfill; narrowing is a separate work item.
    processingStatus: v.optional(v.union(
      v.literal("ready"),
      v.literal("ready_truncated"),
      v.literal("reference_only"),
      v.literal("could_not_read"),
      v.literal("skipped_unsupported")
    )),
    // Machine reason code ONLY — never free text; no provider/internal string
    // can reach a user through this field. (Deliberately NOT the
    // financialUploads.processingError shape.)
    processingDetail: v.optional(v.union(
      v.literal("text_extracted"),
      v.literal("text_truncated"),
      v.literal("image_reference"),
      v.literal("no_text_extracted"),
      v.literal("parse_failed"),
      v.literal("unsupported_extension"),
      v.literal("pasted_text")
    )),
```

**No new index on `projectDocuments`** — the receipt reads the already-indexed `by_projectId` set and counts in memory, as `listDocuments` does today.

**Why not the `financialUploads` shape** (`convex/schema.ts:196-204`): that table models an async server job (`queued→running→completed→failed` + free-text `processingError`). Extraction here is synchronous and finished before the row exists (no job states), these statuses describe text *usability* not job progress, and `processingError: v.string()` is precisely the leak vector the acceptance criteria forbid.

**3b. `documentUploadAttempts` — new table (DECISION 1).** Field-by-field justification:

```ts
  documentUploadAttempts: defineTable({
    projectId: v.id("projects"),          // scope + authorization anchor
    attemptKey: v.string(),               // client UUID; idempotency key. Server rejects
                                          // anything not matching /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
                                          // so no prose can flow through it.
    fileName: v.string(),                 // user's own file name (already stored on
                                          // projectDocuments); server slices to 200 chars.
    fileSizeBytes: v.optional(v.number()),// harmless numeric fact; helps the user recognise the file
    origin: v.union(                      // which ingress produced the attempt — audit value,
      v.literal("chat_upload"),           // mirrors projectDocuments.source vocabulary
      v.literal("context_input"),
      v.literal("review_pd")
    ),
    status: v.union(
      v.literal("in_progress"),           // begin recorded, outcome unknown
      v.literal("failed"),                // durable failure (DECISION 1)
      v.literal("succeeded"),             // resolved to a document row; excluded from receipt
      v.literal("dismissed")              // user removed the row; kept for audit until pruned
    ),
    failureCode: v.optional(v.union(      // machine codes only — never a raw error
      v.literal("rejected_unsupported"),  // client whitelist rejection (file never uploaded)
      v.literal("upload_failed")          // storage/mutation/network failure
    )),
    documentId: v.optional(v.id("projectDocuments")), // set on resolution; the correlation that
                                          // guarantees a file never shows twice (§4)
    createdBy: v.id("users"),             // audit identity
    createdAt: v.number(),
    updatedAt: v.number(),                // drives read-time staleness derivation
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_attemptKey", ["projectId", "attemptKey"]),
```

No backfill needed (new table). Every string field is either a validated-format key, a length-capped user file name, or a literal union — there is **no field a raw error string can flow into**.

### 4. Attempt lifecycle (begin → storage → success/failure), idempotency, correlation

New module `convex/uploadAttempts.ts` (mutations/queries) + `convex/lib/uploadAttempts.ts` (shared helpers callable from `uploadDocument`).

**Happy path (per batch):**

1. Client generates a UUID-v4-compatible `attemptKey` per file through the
   shared request-ID helper. Native `crypto.randomUUID()` is preferred; LAN
   HTTP clients fall back to `crypto.getRandomValues()` while preserving the
   backend-validated UUID shape.
2. **Begin:** one batched `recordUploadAttempts({ projectId, attempts: [{attemptKey, fileName, fileSizeBytes, origin, failureCode?}] })` call per batch (max 50 entries; more → `domainError("INVALID_INPUT", …)`). Upsert semantics by `(projectId, attemptKey)`: absent → insert (`in_progress`, or `failed` when `failureCode` is supplied — this is how client-side whitelist rejections and outbox flushes are recorded in the same mutation); present with status `failed`/`in_progress`/`dismissed` → patch back to `in_progress` (or `failed`); present with status **`succeeded` → no-op** (terminal; a late duplicate flush can't resurrect it). Prune runs at the end (§5).
3. Storage POST + parse (unchanged flow).
4. **Success:** `uploadDocument` gains optional `attemptKey` (regex-validated). After insert — and equally on the dedupe-hit path — it calls `resolveUploadAttempt(ctx, projectId, attemptKey, documentId)`: patch `{status: "succeeded", documentId, updatedAt}`. Missing attempt row (old client, begin lost to the network) → silently proceed. Resolution in the **same transaction** as the insert is the atomic correlation: the receipt joins `listDocuments` + `listUploadAttempts` and the list query excludes `succeeded`/`dismissed`, so a resolved attempt and its document row can never both render.
5. **Failure:** the client `catch` calls `failUploadAttempt({ projectId, attemptKey, failureCode: "upload_failed" })` — patch unless status is `succeeded` (idempotent; repeated calls converge). No error text argument exists.

**Retry (in-session, DECISION 2):** the receipt row still holds the `File`; Retry re-runs steps 2–5 under the **same `attemptKey`** — the upsert flips `failed → in_progress`, success resolves it. No duplicate rows, ever.

**Replace (after reload, DECISION 2):** the row came from the server; no `File` exists.
- *Failed attempt row:* "Replace file…" opens a scoped picker; the chosen file runs the normal pipeline under the **same `attemptKey`**, resolving the attempt. (The attempt keeps its original `fileName` as audit; the document row carries the new name.)
- *Persisted non-`ready` document row:* "Replace file…" uploads the new file (fresh `attemptKey`), then `if (newId !== oldId) await deleteDocument(oldId)`. The id-compare is mandatory: the dedupe (`convex/documents.ts:60-80`) may return the **old row itself** (identical name+content), and unguarded deletion would destroy the row just returned. When `newId === oldId`, the replace is a no-op and the UI says the file was already up to date.

**Remove:** ephemeral in-session rows just drop from local state (if an attempt was recorded, `dismissUploadAttempt` marks it `dismissed`); server-backed rows call `dismissUploadAttempt` (attempts) or the existing `deleteDocument` confirmation flow (documents).

**Honesty about the network floor:** if the network is down before `recordUploadAttempts` ever reaches Convex, **no server table can know**. The client appends a whitelisted record to the localStorage outbox (`src/lib/uploads/attemptOutbox.ts`, key `banhall.uploadAttemptOutbox.v1`): `{projectId, attemptKey, fileName≤200, fileSizeBytes, origin, failureCode: "upload_failed", at}` — **never bytes, never error strings** (the TypeScript entry type has no message field; the serializer test enforces it). Capped at 50 entries FIFO. On next authenticated app load (and on `FilesPanel` mount) the outbox flushes through `recordUploadAttempts`; upsert-by-`attemptKey` makes double-flushes harmless, and entries clear only after the mutation succeeds. Limits stated plainly: an entry survives reload on the *same browser profile*; a different device or cleared storage loses it — that residual gap is unfixable client-side and is accepted.

**Stale `in_progress`:** a tab closed mid-upload leaves `in_progress` forever. `listUploadAttempts` derives at read: `in_progress` with `updatedAt` older than 10 minutes is **returned as** `displayStatus: "failed"` (stored status untouched — matches the invites read-time-expiry pattern and the domain rule against clock-driven status rewrites). Fresh `in_progress` renders as the per-file loading row.

### 5. Retention/cleanup for attempts

Repo patterns inspected: **invites** derive expiry at read time, no cron deletion (`convex/invites.ts:131-137`); **snapshots** prune on write via a pure, unit-tested decision function + a bounded delete inside the writing mutation (`convex/lib/snapshots.ts:142-204`, called from `convex/snapshots.ts` and `convex/chatV2.ts:382`). The existing crons (`convex/crons.ts`) are for stale generation recovery and learning digests — no cleanup cron precedent. **Therefore: no new cron.**

`convex/lib/uploadAttempts.ts` exports pure `attemptIdsToPrune(attempts, now): Id[]` mirroring `snapshotIdsToDelete`: per-project hard cap **100**; when over cap, delete oldest first, preferring `succeeded` and `dismissed` rows before `failed` rows (failures are the audit trail DECISION 1 protects; they die last, oldest-first). Called at the end of `recordUploadAttempts` (bounded `by_projectId` read, `.take(1_000)`). Unit-tested in isolation.

### 6. Authorization for attempts

Checked against `convex/lib/auth.ts` and the domain contract (D1: firm-wide internal visibility; "Shared/client-review token flows remain separately scoped public capabilities").

- `recordUploadAttempts`, `failUploadAttempt`, `dismissUploadAttempt`: `requireInternalProjectAccess(ctx, projectId)` (`auth.ts:44-52`) — authenticated internal users only; `createdBy = user._id`.
- `listUploadAttempts`: `getInternalProjectAccessOrNull` → `[]` when absent, exactly like `listDocuments` (`documents.ts:101`).
- **Client-review token users get nothing structurally:** token access flows only through `getProjectAccess(ctx, projectId, shareToken)` (`auth.ts:90-109`); no attempts function accepts a `shareToken` argument, and token holders are unauthenticated so every attempts entry point resolves to null/denied. UI hiding is not relied on (rule 7).
- Consultant/Manager/Admin all see attempts for projects they can open (consistent with D1 and with `listDocuments` today); no role gate beyond authentication is added.

### 7. Backfill migration (`projectDocuments` only)

The ticket's literal rollout rule (`extractedText ? ready : could_not_read`) is **not implemented** — it would mislabel every image (`reference_only` by design), every pasted note, and every truncated document. The migration runs `deriveProcessingStatus` over stored rows (`fileName` + `content`; `extractionFailed: false`; `intake: "pasted"` inferred when the file name has no extension).

`convex/documentStatusMigration.ts`, mirroring `convex/emailMigration.ts`:

- `report` — `internalQuery`, read-only pre/postflight: `{ total, missingStatus, byDerivedStatus, truncated }`, bounded `.take(1_001)` with an explicit `truncated` flag (never silently "clean").
- `backfillProcessingStatus` — `internalMutation`, `{ paginationOpts: paginationOptsValidator, dryRun: v.optional(v.boolean()) }` → `{ scanned, patched, skipped, isDone, continueCursor }`. Patches **only** rows where `processingStatus === undefined` (idempotent + resumable); self-schedules the next page via `ctx.scheduler.runAfter(0, …)` when `!isDone && !dryRun` (pattern at `emailMigration.ts:152-160`).

Because of the read-time fallback, the migration is **not on the critical path** — UI truth precedes it. Run dry-run → live on the development deployment after the frontend ships. No attempts backfill exists (new table).

### 8. Component design and mounting

**Primitive inventory (reuse, don't reinvent):** `ui/Spinner.svelte` (`size="sm"`, has `role="status"`), `ui/Tooltip.svelte` (rule 11 — required for icon-only controls; FilesPanel's existing bare `title=` is a pre-existing violation, out of scope beyond touched rows), `ui/Button.svelte`, `ui/IconAction.svelte`, `contextCategories.categoryMeta`, `.card`/`.text-label`/`.text-body`/`.text-data`, semantic aliases `ink-*`/`line-*`, `parseDocument.SUPPORTED_LABEL` (re-exported from shared). `ui/Badge.svelte` is **not** reusable — hard-coded project-status map, no icon slot.

**New files:**

```
src/lib/uploads/attemptOutbox.ts           # localStorage outbox (whitelisted fields; §4)
src/lib/uploads/processingStatus.ts        # static presentation map (labels, copy, icon, classes)
src/lib/uploads/receiptRows.ts             # pure buildReceiptRows() + summarizeReceipt()
src/lib/components/upload/ProcessingStatusBadge.svelte
src/lib/components/upload/UploadReceiptRow.svelte
src/lib/components/upload/UploadReceipt.svelte
```

**Row model + builder:**

```ts
// src/lib/uploads/receiptRows.ts
export type ReceiptRow = {
  key: string;                          // documentId | attemptKey | `local:${i}:${name}`
  fileName: string;
  documentId?: Id<"projectDocuments">;  // present ⇒ a document row exists
  attemptKey?: string;                  // present ⇒ server-backed attempt row
  status: ReceiptStatus | null;         // null ⇒ in flight (loading row)
  detail?: ProcessingDetail | null;
  sizeChars?: number;
  createdAt?: number;
  canRetry: boolean;                    // true only while this session holds the File
  canReplace: boolean;                  // failed attempt rows + persisted non-ready docs
  canRemove: boolean;
};
export function buildReceiptRows(
  docs: ListedDocument[], attempts: ListedAttempt[], ephemeral: EphemeralEntry[]
): ReceiptRow[];   // merges the three sources; excludes succeeded/dismissed attempts;
                   // drops any attempt whose documentId appears in docs (belt-and-braces)
export function summarizeReceipt(rows: ReceiptRow[]): string;
// → "6 files: 4 ready, 1 reference only, 1 failed" (zero counts omitted; singular handled)
```

```svelte
<!-- UploadReceipt.svelte -->
let {
  rows, heading = "Processing receipt",
  busy = new SvelteSet<string>(),        // row keys with an action in flight
  emptyMessage = "No files yet.",
  onRetry, onReplace, onRemove,
}: {
  rows: ReceiptRow[]; heading?: string; busy?: Set<string>; emptyMessage?: string;
  onRetry?: (row: ReceiptRow) => void | Promise<void>;
  onReplace?: (row: ReceiptRow, file: File) => void | Promise<void>;
  onRemove?: (row: ReceiptRow) => void | Promise<void>;
} = $props();
```

```svelte
<!-- ProcessingStatusBadge.svelte -->
let { status, size = "sm" }: { status: ReceiptStatus; size?: "sm" | "md" } = $props();
```

**Visual spec (ledger aesthetic).** `<ul class="divide-y divide-line-soft">`, one `<li>` per file, `py-2.5 gap-3`, `min-h-11` (44px touch targets — the contract's rule; existing 32px FilesPanel buttons are a listed non-goal, new controls comply). Summary line above the list: `.text-label` eyebrow + counts in `.text-data`. File name `.text-body truncate`; meta `.text-data text-ink-muted`. Badge: `inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium`, leading `aria-hidden` icon **plus literal status text** — never colour-only. Tokens only, no ad-hoc hex:

| Status | Badge classes | Icon |
|---|---|---|
| Ready for AI | `bg-primary/15 text-primary-selected` | check |
| Ready — text truncated | `bg-amber-50 text-amber-700` | scissors |
| Reference only | `bg-chrome text-ink-secondary` | image |
| Could not read | `bg-gray-100 text-gray-600` | eye-off |
| Skipped — unsupported type | `bg-gray-100 text-gray-600` | slash-circle |
| Upload failed | `bg-red-50 text-red-600` | alert-triangle |

Loading (`status === null` or fresh `in_progress` attempt): `<Spinner size="sm" />` + "Reading…" in the badge slot. Explanation + suggested action always visible as a second line (`text-xs text-ink-muted`) for non-`ready` statuses — no hover-only, no disclosure (one-line copy; low-tech users shouldn't hunt; if a disclosure is ever added it follows rule 7: chevron right edge, rotate-180). Hover fills `hover:bg-primary-wash` (rule 9); destructive hovers red; bare `transition-*` utilities only (300ms, rule 8); icon-only controls get shared `Tooltip` + `aria-label` (rule 11). Empty state: `emptyMessage` in `text-sm text-ink-muted`.

**Mounting — two surfaces, one component, plus the gating fix:**

1. **Live (per batch), chat panel.** `AgentChatPanel.uploadFiles` replaces the single overwriting `uploadError` string (`:479-485`, rendered `:616-629`) with `ReceiptRow[]` state: row appended `status: null` before work, updated from the mutation result, `upload_failed` in the `catch`, `skipped_unsupported` for input-rejected files (which now also record attempts, since `projectId` exists). Rendered where `uploadError` renders today, above the composer, dismissible. Satisfies AC1/AC4 live.
2. **Persistent, files panel.** `FilesPanel` gains the summary line, a `ProcessingStatusBadge` + explanation per document row (from `listDocuments`), and failed-attempt rows (from `listUploadAttempts`) with Replace/Remove. The pinned transcript row keeps no badge. Satisfies "reachable later" + AC3.
3. **Report-gating fix.** `src/routes/project/[id]/+page.svelte` additionally renders `<FilesPanel {projectId} />` when there is **no report** (outside the `{#if !awaitingSelection && !showIterativeStepper && report}` gate at `:1056` — e.g. under the `GenerationProgress`/failure branch in a `max-w-3xl` container). `reportId` is already optional on the component. Without this, the ticket's persistent receipt is unreachable exactly when uploads failed and generation never produced a report.
4. **Wizard.** Keeps its existing inline error/toast UX. Pre-`createProject` rejections stay session-only (no `projectId` — recorded honestly as a limit); commit-loop failures record attempts (`origin: "context_input"`/`"review_pd"`), so after navigation the project files panel shows them durably. No wizard receipt step (kept from prior Q7 recommendation, now materially improved by attempts).

### 9. Exact user-facing copy and structural leak-proofing

Three structural defences (discipline is not the mechanism):

1. **No error string can be sent.** The client catches, `console.error(e)`, and sends only enums (`extractionOutcome`, `failureCode`). No argument on any new/changed function accepts prose; `attemptKey` is regex-gated; `fileName` is the user's own file name, length-capped.
2. **No error string can be stored.** `processingDetail`, `failureCode`, `status`, `origin` are literal unions — the Convex validator rejects anything else.
3. **No error string can be rendered.** All user copy comes from one static `Record<ReceiptStatus, …>` map in `src/lib/uploads/processingStatus.ts`; no component interpolates `e.message`/`err.toString()`. A unit test asserts no copy string matches `/error|exception|stack|convex|openrouter|anthropic|undefined|\bat \w+\(/i`.

| Status | Badge label | Explanation | Suggested action |
|---|---|---|---|
| `ready` | Ready for AI | Text was read from this file. | — |
| `ready_truncated` | Ready — text truncated | This file was too long to read completely, so only the first part was captured. Anything after the cut-off won't be used when the report is written or reviewed. | If the later pages matter, split the file and upload that section on its own. |
| `reference_only` | Reference only | Images are kept for people to open and download. No text is read from them, so the assistant can't use what they show. | If the content matters to the report, describe it in the chat or upload a text version. |
| `could_not_read` | Could not read | No readable text was found in this file. It's saved in the project, but the assistant can't use its contents. | This usually means a scan or a photo of a page. Use "Replace file…" with a text-based version, or paste the text into the chat. |
| `skipped_unsupported` | Skipped — unsupported type | This file type can't be read, so nothing was added to the project. | Supported: {`SUPPORTED_LABEL`}. Convert the file, or paste the text into the chat. |
| `upload_failed` (canRetry — same session) | Upload failed | This file didn't reach the project — nothing was saved. | Check your connection and try again. |
| `upload_failed` (after reload — canReplace) | Upload failed | This file didn't reach the project — nothing was saved. | Use "Replace file…" to choose it again and upload it. |

The two `upload_failed` variants are one map entry with `action` keyed by `canRetry`, so the record stays exhaustive over `ReceiptStatus`.

### 10. Test plan

Pure-logic coverage is deliberately exhaustive because the component layer is not automatable here (Q6).

**`src/lib/uploads/documentStatus.test.ts`** — one case per precedence rule + every boundary: normal `.docx` → `ready`; each truncation marker (generic cap, PDF page-stop, mbox overflow) → `ready_truncated`, marker at very end vs 200 chars in; marker beyond the 300-char tail → documented as not detected (the window is a visible contract); `.png/.jpg/.jpeg/.webp/.gif` empty → `reference_only`; image with text → `ready`; `.PDF` uppercase; empty/whitespace `.txt` → `could_not_read`; `.zip` no text → `skipped_unsupported`; `.rtf` with text → `ready`; `extractionFailed` ± text; `intake:"pasted"` ± text; no extension + `intake:"file"`; exhaustiveness over `PROCESSING_STATUSES`/`PROCESSING_DETAILS`; status/detail pairing invariant (`ready_truncated` ⇔ `text_truncated`).

**`src/lib/parseDocument.test.ts`** (extend) — markers imported from `shared/documentStatus` (no duplicated literals); **regression, no behaviour change:** a size-truncated `.xlsx` (sheets dropped) yields content whose tail passes `hasTruncationMarker` and derives `ready_truncated`; same for an over-cap PDF-shaped string where `capContent` replaced the page-specific marker.

**`convex/documents.test.ts`** (new, `convex-test`) — `uploadDocument` persists status+detail for good `.docx` / image / empty `.pdf` / truncated / pasted; dedupe path backfills missing status, never overwrites, and **resolves a pending attempt on the dedupe-hit path**; `listDocuments` derives fallback status for legacy rows; non-member gets `[]`; invalid `attemptKey` format rejected; no returned detail is free text.

**`convex/uploadAttempts.test.ts`** (new) — record → fail → list roundtrip; upsert idempotency (same `attemptKey` twice → one row); retry flips `failed → in_progress`; resolution via `uploadDocument` marks `succeeded` + `documentId` and the row leaves `listUploadAttempts`; `succeeded` is terminal (late flush no-ops); dismiss hides but keeps the row; stale `in_progress` (>10 min) lists as `displayStatus:"failed"`, fresh does not; batch >50 rejected; `attemptIdsToPrune` — cap 100, oldest first, `succeeded`/`dismissed` pruned before `failed`; unauthenticated/token caller gets `[]` from list and errors from mutations.

**`src/lib/uploads/attemptOutbox.test.ts`** (new) — serializer stores only whitelisted fields (a poisoned entry with `message`/`stack` is stripped); 50-entry FIFO cap; flush clears only after success; double-flush produces identical upsert payloads.

**`convex/documentStatusMigration.test.ts`** (new) — dry run patches nothing, counts accurately; live patches only `undefined` rows; **image with empty content → `reference_only`, not `could_not_read`** (regression for the ticket's wrong rollout rule); second run patches 0; pagination self-scheduling terminates.

**`src/lib/uploads/processingStatus.test.ts`** — copy map exhaustive over `ReceiptStatus` (compile-time `Record` + runtime loop); non-empty labels/explanations; banned-substring regex passes (AC3 made testable); `skipped_unsupported` action contains `SUPPORTED_LABEL`; both `upload_failed` action variants present.

**`src/lib/uploads/receiptRows.test.ts`** — `summarizeReceipt` matches the ticket's "6 files: 4 ready, 1 reference only, 1 failed", singular/zero handling; `buildReceiptRows` merges docs+attempts+ephemeral without key collisions, excludes `succeeded`/`dismissed`, drops attempts whose `documentId` is in docs, sets `canRetry` only for in-session rows and `canReplace` per §4. **The four acceptance scenarios encoded as data tests:** (AC1) mixed 4-file batch → 4 rows, correct statuses/actions; (AC2) truncated → `ready_truncated` + truncation copy; (AC3) rows rebuilt from `listDocuments`+`listUploadAttempts`-shaped payloads reproduce identical statuses (persistence across "reload"); (AC4) `upload_failed` (attempt, no `documentId`) vs `could_not_read` (document row) — distinct statuses, copy, and provenance.

**Component states + keyboard nav** — no jsdom/component harness exists (PSOS-03 waiver, re-requested as Q6). Covered by `npm run check` at 0 errors incl. a11y + documented manual checklist: Tab reaches every row action in DOM order, no positive `tabindex`, every icon-only control has `aria-label` **and** shared `Tooltip`, badges legible in greyscale, rows ≥44px at 375px viewport, `prefers-reduced-motion` respected, Replace picker reachable by keyboard.

### 11. Sequenced steps

Each step is small, independently shippable, independently verifiable, and leaves the app working. The human runs them **one at a time** through the Pi agent with a Fable review between each. At the end of every step also run: `npm run check` · `npx tsc --noEmit -p convex/tsconfig.json` · `npm run test`. The Verify column is the *targeted* addition.

| # | Step | Files touched | Done means | Verify |
|---|---|---|---|---|
| 1 | Pure derivation module + registry move + tests. Nothing imports it from app code yet. | `shared/documentStatus.ts`, `src/lib/uploads/documentStatus.test.ts` | Every §2 precedence rule and boundary passes; markers/registry exported; pairing invariant holds. | `npx vitest run src/lib/uploads/documentStatus.test.ts` |
| 2 | `parseDocument.ts` imports markers/registry from step 1 and re-exports; **zero behaviour change**; truncation regression tests added. | `src/lib/parseDocument.ts`, `src/lib/parseDocument.test.ts` | No duplicated marker literals; xlsx/PDF size-truncation marker regression tests pass; existing tests untouched-green. | `npx vitest run src/lib/parseDocument.test.ts` |
| 3 | Schema widen: `projectDocuments` fields + `documentUploadAttempts` table + two indexes. No writers yet. | `convex/schema.ts` | Codegen succeeds; nothing writes the new fields/table; existing data untouched. | `npx convex codegen` |
| 4 | Server derivation: `uploadDocument` (insert + dedupe backfill-on-touch; optional `extractionOutcome`/`intake` args), `copyProjectInputRows` carry-over, `listDocuments` fallback + projection fields. | `convex/documents.ts`, `convex/projects.ts`, `convex/documents.test.ts` | New docs get status; listed docs always report one; old clients (no new args) still work; duplication carries truth. | `npx vitest run convex/documents.test.ts` |
| 5 | Attempts backend: `recordUploadAttempts`, `failUploadAttempt`, `dismissUploadAttempt`, `listUploadAttempts`, `resolveUploadAttempt` helper wired into `uploadDocument` (both paths), prune helper. | `convex/uploadAttempts.ts`, `convex/lib/uploadAttempts.ts`, `convex/documents.ts`, `convex/uploadAttempts.test.ts` | Full lifecycle, idempotency, staleness derivation, prune, and auth tests pass; token/unauthed callers excluded. | `npx vitest run convex/uploadAttempts.test.ts` |
| 6 | Client sends facts: `extractionOutcome` on parse throw, `intake:"pasted"` on the two wizard pasted call sites (`:443-451`, `:462-470`). No UI change. | `src/lib/components/chat/AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte` | Facts flow as enums; raw errors stay in `console.error`; manual: corrupt PDF + pasted note store correct statuses. | `npm run check` · manual on `:3001` |
| 7 | Attempt wiring + outbox: attemptKey per file, begin/fail calls in chat + wizard commit loop, input-rejection attempts (chat), localStorage outbox + flush on load/panel mount. | `src/lib/uploads/attemptOutbox.ts` + `.test.ts`, `AgentChatPanel.svelte`, `src/routes/project/new/+page.svelte`, `FilesPanel.svelte` (flush hook) | Failed/rejected uploads produce durable attempt rows; offline-at-first-mutation lands in outbox and flushes after reload; no prose stored. | `npx vitest run src/lib/uploads/attemptOutbox.test.ts` · manual: DevTools offline batch, reload, verify row |
| 8 | Backfill migration + tests. | `convex/documentStatusMigration.ts` + `.test.ts` | Dry run counts only; live idempotent/resumable; images → `reference_only`. | `npx vitest run convex/documentStatusMigration.test.ts` · `npx convex run documentStatusMigration:report` · dry-run then live on dev deployment |
| 9 | Presentation: copy map + badge component + styleguide specimen of all badges. | `src/lib/uploads/processingStatus.ts` + `.test.ts`, `ProcessingStatusBadge.svelte`, `src/routes/styleguide/+page.svelte` | All 6 statuses + loading render on `/styleguide`; banned-substring test passes. | `npx vitest run src/lib/uploads/processingStatus.test.ts` · `curl -s -o /dev/null -w "%{http_code}" localhost:3001/styleguide` |
| 10 | Receipt component + row builder + styleguide specimen (all statuses, loading, empty, summary). AC scenarios as data tests. | `src/lib/uploads/receiptRows.ts` + `.test.ts`, `UploadReceipt.svelte`, `UploadReceiptRow.svelte`, `src/routes/styleguide/+page.svelte` | AC1–AC4 data tests pass; specimen renders; no consumer wired yet. | `npx vitest run src/lib/uploads/receiptRows.test.ts` · screenshot of `/styleguide` |
| 11 | Persistent surface: FilesPanel badges + summary + failed-attempt rows; **mount FilesPanel outside the report gate**. Satisfies AC3 + "reachable later". | `FilesPanel.svelte`, `src/routes/project/[id]/+page.svelte` | Statuses + failures survive reload; a report-less project shows the panel; transcript row unbadged. | `npm run check` · manual: project with failed generation shows panel; reload persists |
| 12 | Live surface: chat batch receipt with working in-session Retry; overwriting `uploadError` string removed. Satisfies AC1 + AC4 live. | `AgentChatPanel.svelte` | Per-file `null → status`; Retry reuses attemptKey; mixed batch (1 unsupported + 1 unreadable + 2 good + 1 offline) shows 5 truthful rows. | `npm run check` · manual mixed batch incl. offline file |
| 13 | Replace flows: failed attempts (same attemptKey) + persisted non-ready docs (id-compare guard); then close-out (work log, evidence, queue README, follow-up tickets). | `UploadReceiptRow.svelte`, `FilesPanel.svelte`, this file, `../README.md` | Replace-with-identical-content is a safe no-op; replace resolves/supersedes correctly; every AC has evidence. | `npm run check` · manual · `npm run build` · `git diff --check` |

Steps 1–3 are pure additions (fastest review). Steps 4–5 are the trust boundary (highest-scrutiny review). Step 11 alone already satisfies the persistent-receipt contract; 12–13 complete the live UX.

### 12. Risks, rollback, non-goals

**Deploy ordering.** Convex first. All new args are optional and the attempts API is additive: an old bundle sends nothing, the server derives from content alone, and unreadable files still land `could_not_read`. Reverse ordering would send args an old server rejects.

**In-flight uploads during deploy.** Each file is its own mutation; status is written in the same transaction as the insert, so no half-written rows. An interrupted call surfaces as a thrown error → `failUploadAttempt` → durable `upload_failed` with Retry.

**Attempt/receipt double-show.** The invariant is transactional resolution inside `uploadDocument` (both insert and dedupe paths) + list-query exclusion of `succeeded`/`dismissed` + the builder's `documentId` cross-check. The dedupe-path resolution test in step 5 pins the one subtle case.

**Write amplification.** One extra batched mutation per upload batch (`recordUploadAttempts`) plus one small patch per failure — negligible against the storage POST + document insert already paid. Prune is a bounded indexed read in the same mutation.

**Performance.** Derivation per row inside reactive `listDocuments`: 300-char tail scan + one `trim()` + one extension match, on a set already fully collected today. Watch Convex insights after step 4.

**localStorage outbox.** Residual gap: different device / cleared storage loses never-reached-Convex records — unfixable client-side, accepted and documented. Flush is idempotent by attemptKey, so crash-between-flush-and-clear is safe.

**Copy/enum drift.** Exhaustive `Record<ReceiptStatus, …>` + runtime loops over the exported const arrays make a missing case a compile or test failure.

**Rollback.** Frontend: revert steps 9–13; the server keeps writing statuses/attempts harmlessly. Server: revert steps 4–5; optional fields stop being written, attempts stop accumulating; nothing else reads them. Schema: leave widened fields/table in place (removal = separate narrow work item, rule 6). Migration needs no down-phase (fills fields no legacy code reads).

**Explicit non-goals** (each a follow-up ticket under rule 5 if wanted):
- Structured truncation metadata (which sheets/pages dropped; sheet-specific xlsx marker) — the confirmed narrow defect, deliberately deferred.
- New extractors / OCR; any change to generation behaviour or which documents feed the model.
- Narrowing `processingStatus`/`processingDetail` to required.
- A pre-project holding area for wizard rejections before `createProject`.
- Batch grouping (`uploadBatchId`) — attempts carry `createdAt`; revisit only on user demand.
- Surfacing storage-bytes-failure-with-text-success as a status (Q3).
- A jsdom component-test harness (Q6).
- Fixing FilesPanel's pre-existing bare `title=` attributes and 32px touch targets beyond rows this ticket touches.
- Cross-device durability for the localStorage outbox.

### 13. Ambiguities, open questions, untestable criteria

**Resolved since the prior pass (no longer open):** durable failed-upload trail (was Q1 — resolved by human DECISION 1); retry-after-reload semantics (was Q5 — resolved by human DECISION 2); wizard live receipt (was Q7 — attempts now give the wizard's failures a durable home on the project page; recommendation to keep the wizard toast stands and is adopted above).

**Still needing a human product decision (queue rule 9 — not decided here):**

- **Q3. Storage-bytes failure with successful text extraction.** Today (`AgentChatPanel.svelte:453`) this silently yields a document with text but no downloadable original. Recommendation: unchanged in v1; follow-up ticket. Confirm.
- **Q6. Component-test harness waiver.** Re-accept the PSOS-03 waiver for component-state/keyboard-nav automation, or fund a harness as its own ticket. Recommendation: re-accept; the pure-logic layer here is deliberately exhaustive and the manual checklist is recorded as evidence.

**Planning-decided, flagged for visibility (veto before step 1 if disagreed):** attempts cap 100/project with succeeded-first pruning (§5); stale-`in_progress` display threshold 10 minutes (§4); "Remove" = `dismissed`, not delete (§4); outbox cap 50 entries (§4).

**Untestable-as-written acceptance criteria:**

- **AC5 "component states; keyboard nav"** — not automatable (no jsdom harness; PSOS-03 precedent). Covered by exhaustive pure-logic tests + `npm run check` a11y at 0 errors + documented manual checklist (§10). Waiver = Q6.
- **AC3 "no provider/internal error strings leak"** — untestable as prose; made testable by construction: literal-union validators server-side, the banned-substring test over the static copy map, and the absence of any prose-capable argument/field end to end. The test proves the copy map and schema are clean; the structural defence (nothing can carry prose) is the actual guarantee.
- **AC1/AC2/AC4** — testable as data-level tests over `buildReceiptRows`/`summarizeReceipt` (§10) plus manual UI verification; only visual rendering falls under the AC5 waiver.

**Conflicts with `docs/product-domain.md`: none.** The plan implements its cross-cutting rules directly: typed user-safe failure states (§9); dense ruled lists, no colour-only state, no hover-only controls, 44px targets (§8); empty/loading/failure/partial-success states as acceptance criteria (§8, §10); widen → idempotent/resumable backfill → later narrow (§3, §7); stable idempotency keys for retryable operations (§4); no clock-driven status rewrites (§4, §5); server-enforced authorization with token flows excluded (§6).

## Work log and evidence

| Date | Change/evidence | Result |
|---|---|---|
| — | Ticket created from the PSOS master plan. | Not started |
| 2026-07-24 | Selected as the sole active queue item and launched mandatory Claude Code/Fable planning pass (`sa-18`). | Planning underway; no implementation edits made. |
| 2026-07-27 | Claude Code high-reasoning planning pass completed and recorded (`## Claude planning pass`). | Later found to have run on the wrong model (Opus 5, not Fable); treated as input only. |
| 2026-07-27 | Codex research pass verified the prior plan. | Confirmed the server-authoritative derivation design; found real errors: miscounted entry points, wrong xlsx-marker claim, unsafe replace-vs-dedupe interaction, and the report-gated FilesPanel reachability gap. |
| 2026-07-27 | Human product decisions recorded: DECISION 1 (durable `documentUploadAttempts` audit trail) and DECISION 2 (retry in-session, replace after reload). | Ticket scope amended above. |
| 2026-07-27 | **Steps 17–18 implemented — live chat receipt, Retry, and both Replace paths.** Planned/reviewed on claude-fable-5 (`PSOS-04-steps-17-18-plan.md`); post-review verdict **SHIP**, zero blockers. Chat's single overwriting `uploadError` removed: every file now appears immediately as a `null → status` row, File objects live outside `$state` in a plain Map, Retry reuses the same attempt key and full pipeline, and unsupported rejections share their receipt key with the durable attempt. FilesPanel: failed-attempt Replace reuses its key; document Replace uses a fresh key, upload-first/delete-second, mandatory id compare, and an unconditional destructive confirmation (especially important for reference-only images whose bytes are useful). | Green: 348/348 tests, 33/33 component, check/Convex tsc clean. Review findings fixed: `receiptBusy` now keys on `row.key` (not bare attempt key), Retry re-entrancy guard, dismissal timeout + File-map cleanup, and an honest partial-success message when replacement succeeds but deletion of the old row fails. Final Fable audit found no code blocker. |
| 2026-07-28 | Post-release alert remediation in `25493c7` hardened PSOS-04 status consumers against missing/future deploy-skew payloads. | `FilesPanel`, `ProcessingStatusBadge`, `UploadReceiptRow`, status copy, and receipt summaries now use neutral runtime fallbacks; unit and browser-component regressions passed. Convex development remains deployed and all related alerts were resolved. |
| 2026-07-27 | **Direct Google Chrome release evidence (CDP, no Playwright).** Chrome 150 rendered `/styleguide` at 375×812 and 1440×900: 8 visible rows (7 countable + archived), all 8 status/loading/archived labels present, 10 enabled action controls, zero target under 44px, zero row overlap, zero receipt spill, no bare `title`, aria-live summary exactly `7 files: 1 ready, 1 truncated, 1 reference only, 1 unreadable, 1 skipped, 1 failed, 1 still reading`. Direct Chrome Tab events reached receipt actions in DOM order. Offline probe in real Chrome: bare Convex mutation promise result `HUNG`; wrapped result `REJECTED:UploadTimeout`, proving the load-bearing timeout behavior. | Pass. Whole-page 375px scroll width was 460 due to a pre-existing invisible `SourceContent` tooltip in the chat-primitives styleguide specimen; receipt rows themselves had zero spill — not a PSOS-04 regression. Authenticated chat/project replacement checks require release credentials and remain the deployment QA gate. |
| 2026-07-27 | **Final validation + Fable audit.** | `npm run test` 348/348; `npm run test:component` 33/33; `npm run check` 0 errors/warnings; `npx tsc --noEmit -p convex` clean; `npm run build` exit 0 (adapter-vercel, 4m28s); `git diff --check` clean. Final audit: **SHIP WITH KNOWN LIMITATIONS**, no code blocker. |
| 2026-07-27 | **Steps 15–16 implemented — the persistent receipt surface and its mounts.** Planned and reviewed on claude-fable-5 (`PSOS-04-steps-15-16-plan.md`). Amendment C: `listUploadAttempts` now returns `null` on denial, so "you may not look" is distinguishable from "there is nothing here". Resolution (b): `FilesPanel`'s hand-written `DocRow` replaced by `FunctionReturnType<…>[number]` and the `as DocRow[]` assertion deleted — that cast is what had been silently discarding this ticket's own status fields. FilesPanel keeps its own document rows (preview/download/archive/delete/BNH-24 revise are all untouched) and gains a status badge + explanation per row, a summary line, a header failure count, and failed-attempt rows drawn with the shared `UploadReceiptRow`. Step 16: the B5 layout fix (`items-center` → child `my-auto`, so an overflowing progress card's top edge stays reachable) plus mounts M1 (generation container, gated `!report`, opened when the generation failed) and M2 (reportless main). | Green: 346/346 `npm run test`, 33/33 component, `check` 0 errors, convex `tsc` clean, `/styleguide` + `/dashboard` HTTP 200 with no SSR errors. **Review found one blocking defect, which was mine:** I gated only the summary slot on `attemptsDenied`, so a denied panel rendered the permission copy *and then* "No supporting files yet" underneath it — the exact contradiction the plan and the authoritative manual check forbid. The denial now replaces the whole panel body. Also fixed from the review: `countReceiptFailures` was missing the `!archived` guard that `summarizeReceipt` has (header and summary could have disagreed); Remove had no busy state and swallowed its error, so a failed dismissal left the user guessing — now it disables the row and surfaces a toast; the header middot was dropped; and a compile-level `satisfies` guard now pins the `displayStatus` narrowing. **The narrowing itself was a real latent bug the planner caught:** `.filter()` with a plain boolean does not narrow, so `displayStatus` leaked all four stored statuses into a type that accepts two. I implemented it as a type predicate rather than a cast, and mutation-tested the guard — reverting the predicate fails `tsc -p convex`, which is the suite that gates the Convex-first deploy. |
| 2026-07-27 | **Steps 13–14 implemented — row builder, receipt components, and the AC5 a11y suite.** Planned and reviewed on claude-fable-5 (`PSOS-04-steps-13-14-plan.md`). `receiptRows.ts` merges documents + attempts + in-session entries into one ledger (ephemeral → failures → documents, so problems sit above healthy files); `summarizeReceipt` reproduces the ticket's pinned line byte-exact. `UploadReceiptRow`/`UploadReceipt` are strictly presentational (grep-enforced: no `convex-svelte`/`$app`/`$env`), so they are testable in a real browser. `Button` gained an additive `danger-ghost` variant — its class string is concatenated, not cn-merged, so a caller cannot safely override a hover colour. Styleguide gained the receipt specimens. | **AC5 evidence: `npm run test:component` 33/33 in headless Chromium**, covering resolution (d) assertions 6–23 — real `userEvent.tab()` traversal against a pinned 7-stop order, `:focus-visible` computed rings, Enter/Space activation, measured 44×44 at 375px, row overlap, and CDP-emulated reduced motion. Also 342/342 `npm run test`, `check` 0 errors, convex `tsc` clean. **I mutation-tested the two most important assertions rather than trusting green:** removing `min-h-11` failed the touch-target test (38px observed), and removing `motion-reduce:animate-none` failed the reduced-motion sweep ('spin' vs 'none') — both restored. That also empirically closed two of the plan's could-not-verify items (CDP emulation reaching the test frame; `:focus-visible` after synthetic Tab). **Review findings fixed in-step:** (1) a real copy bug — `could_not_read`'s advice named a "Replace file…" button that the live chat receipt never renders, so its action now varies on `canReplace` exactly as `upload_failed` varies on `canRetry`; (2) two a11y assertions could pass vacuously if a render regression produced zero elements — both now assert element counts first; (3) an archived-row test asserted copy absence but not action absence, despite its name; (4) the styleguide never rendered an enabled action, leaving the new destructive variant visually unverified. Accepted plan deviations F1–F9, notably **F2**: `canReplace` excludes `ready_truncated` as well as `ready`, because step 18's Replace deletes the old row and a truncated file did capture real text — §9 tells that user to split the file, so a destructive button beside that advice would contradict it. |
| 2026-07-27 | **Steps 10–11 implemented — attempt wiring, offline flush, sign-out sweep.** Planned on claude-fable-5 (`PSOS-04-steps-10-11-plan.md`), then reviewed on claude-fable-5. New pure seam `src/lib/uploads/outboxFlush.ts` (drop-vs-keep predicate, whitelist payload mapper, flush) so the decisions in two `convex-svelte`-importing components are testable. Chat: per-file `attemptKey`, batched begin, per-file failure recording, batch-abort honesty, input-rejection attempts, opportunistic flush. Wizard: `attemptKey` on both upload paths, failure recording for `context_input` and `review_pd`. Page-level `$effect` flush; `clearAllOutboxes()` at **both** sign-out sites. | Green: 316/316 `npm run test`, 6/6 component, `check` 0 errors, convex `tsc` clean, `npm run build` exit 0 on the bumped framework versions. **The review found one blocking defect and I verified it at the source: Convex's WebSocket client never rejects a mutation when offline.** `node_modules/convex/dist/esm/browser/sync/request_manager.js:19` builds the request promise with `new Promise((resolve) => ...)` — there is no reject path — and `restart()` (:117) *re-queues* mutations for replay, giving an error result only to Actions. So an offline `uploadDocument` hangs forever: the catch blocks never run, no failure is recorded, and a reload loses the attempt with no trace — precisely the case DECISION 1's audit trail exists to prevent. Fixed with `withUploadTimeout` (30s) on every upload/record mutation; a timeout is deliberately classified *keep*, not drop, and if the mutation later lands it resolves to `succeeded`, which is terminal on both paths, so the optimistic failure converges to the truth. Also fixed from the review: flush Set now keyed `userId:projectId` (a session changing hands without sign-out would otherwise skip the second user's flush — delayed rows, no leak); `flushOutboxFor` now clears only the keys it actually sent; A2 test case 9 (bare prefix, no trailing newline) added; malformed-`attemptKey` coverage for `uploadDocument` asserting the document rolls back with it; unhandled-rejection guard at the signup sign-out site. Confirmed correct by review and not re-litigated: `settled` bookkeeping in every branch, `noteCarried` across all five note/file combinations, outbox cross-user isolation, SSR inertness, §9 copy verbatim. |
| 2026-07-27 | **Step 12 implemented — copy map + `ProcessingStatusBadge` + styleguide.** §9's copy table transcribed verbatim, with the two `upload_failed` action variants as one entry keyed on `canRetry`. Badge always renders its label as text (colour/icon are decoration only); loading state is a spinner + "Reading…" carrying `motion-reduce:animate-none`, since this app has no global reduced-motion reset. Step-6 probe deleted as planned. | Green: 9 copy-map tests (incl. the banned-substring regex over every string — AC3 made testable) + 6 component tests in real Chromium asserting literal labels for all 6 statuses, `aria-hidden` icons, and *computed* background colours; 293/293 `npm run test`, `check` 0 errors. Styleguide verified by HTTP, not just type-check: all 7 specimens render server-side at `/styleguide`. **Harness API correction:** `vitest-browser-svelte`'s `render()` returns a **Promise** and `unmount()` is async — my first draft never awaited either and failed 6/6. Worth noting for steps 13–14. |
| 2026-07-27 | **Step 9 implemented — offline outbox module** (`src/lib/uploads/attemptOutbox.ts`, no wiring yet). User-scoped per Amendment F: key `banhall.uploadAttemptOutbox.v2:{userId}`, per-entry `userId`, sign-out sweep over the whole prefix incl. legacy keys, 7-day TTL, 50-entry FIFO cap. `sanitizeEntry` rebuilds each entry field-by-field from a whitelist rather than spreading input, and the type has no message/stack/error field — that absence is the leak-proofing. Storage shell is inert without `localStorage`, so SSR import is safe. | Green: 19 new tests, 284/284 `npm run test` ×5 consecutive, `npm run check` 0 errors. **One real bug caught by its own test:** `appendOutbox` deduped on `attemptKey` alone, so queuing a key for one project evicted an unrelated entry sharing that key under another project; now keyed on `(projectId, attemptKey)`, matching the server's upsert. Separately fixed a self-inflicted flake: the step-2 xlsx truncation fixture built 24,000 cells and intermittently exceeded the 5s default (7.7s observed); rebuilt as few-wide-rows — same assertion, 374ms. |
| 2026-07-27 | **Steps 7–8 + Amendment A2 implemented.** Step 7 (Amendment B): `uploadDocument` skips the `(fileName, content)` dedupe when content is blank — unreadable files all store `""`, so deduping merged genuinely different uploads sharing a name, showed one receipt row for two files, and resolved both attempt keys to one document (an audit trail claiming success for a file never stored). Step 8 (Amendment A): the wizard sends `content: ""` instead of `prefix + ""` for an unreadable file, with a `noteCarried` flag so a row whose files all fail still persists the user's note — strictly more note-preserving than the old `files.length === 0` guard. Both wizard paste call sites now send `intake: "pasted"`; chat and wizard both send `extractionOutcome`. A2: `stripIngestPrefix()` in `deriveStoredProcessing` only. | Green: 265/265 `npm run test`, `test:component` 4/4, `npm run check` 0 errors, convex `tsc` clean. **A2 decided (ii), not the assumed (i).** The deciding evidence was one the plan had missed: `copyProjectInputRows` (`convex/projects.ts:412-423`) *persists* `deriveStoredProcessing` output, so every project duplication was permanently freezing a wrong `ready` behind the backfill's patch-only-when-undefined guard — waiting was not neutral, the mislabelled population was growing. Matcher is exact-literal (wording, em-dash, numeric year, trailing newline) so a genuine document opening with any other bracketed line is untouched; the `Note:` line is deliberately preserved because it is the user's own text and generation reads it. 14 new tests incl. adversarial cases (ASCII hyphen not stripped, mid-content not stripped, strips at most once) and a duplication integration test pinning `could_not_read` on the copy. Known residue recorded in the decision: rows whose wrong status was already persisted during this ticket's own step 1–5 window need the deferred backfill's `force` mode. |
| 2026-07-27 | **Step 6 implemented — component-test harness** (DECISION 3's funded scope). Vitest Browser Mode + headless Chromium in a **separate** `vitest.component.config.ts` (`vitest-browser-svelte@3.0.0`, `@vitest/browser@4.1.10`, `@vitest/browser-playwright@4.1.10`, `playwright@1.62.0`); `npm run test` left byte-identical, new `npm run test:component`; root config touched only by the `configDefaults`-spread exclude on the `src` project. Probe component asserts real click, measured 44px geometry, computed `:focus-visible` ring, and reduced-motion opt-out. | Green: `npm run test:component` 4/4, `npm run test` 251/251 ×6 consecutive, `npm run check` 0 errors, `npx tsc --noEmit -p convex` clean. **Three findings during implementation.** (1) The plan's unverified provider-factory shape is confirmed: `provider: playwright()` from `@vitest/browser-playwright` works; the string form throws at config resolution. (2) `@vitest/browser/context` is deprecated in 4.1.10 — use `vitest/browser`. (3) **The probe caught a defect in the plan's assertion 18**: programmatic `.focus()` never matches `:focus-visible` (browsers withhold it from script focus), so the planned focus-ring assertion would have failed against correct markup. Real `userEvent.tab()` is required — step 14's suite must use keyboard traversal throughout. Separately, `vitest.config.ts` gained `testTimeout: 30_000` on the convex project: the two slowest `convex-test` cases were failing intermittently (~1 run in 3) against the 5s default because convex-test glob-imports the whole backend and transform time swings 6s–26s. Pre-existing flake, surfaced by the slower post-install first run; not caused by and not masking any logic change. Lockfiles: both updated in step, diffs contain only the 4 new packages + transitive deps — no framework movement. `node_modules` did move to the versions `package-lock.json` already pinned (Kit 2.70.1, plugin 7.2.0, svelte 5.56.6, vite 8.1.5, tailwind 4.3.3), resolving the pre-existing npm↔bun divergence rather than creating one. |
| 2026-07-27 | **Remaining work re-planned on claude-fable-5** — [`PSOS-04-implementation-plan.md`](./PSOS-04-implementation-plan.md), steps 6–19. Sequence: a Codex read-only research pass verified the current-state map and harness options; an Opus draft plan was written and then **critically reviewed**, which found 6 blocking defects (draft's wizard fix caused note **data loss**; it created a new `(fileName, content)` dedupe collision that would have made two unreadable files share one row and one `documentId` across two attempt keys; a string `browser.provider` that throws during config resolution and would have broken `npm run test` itself; an un-namespaced localStorage outbox that could flush user A's failures into user B's session on the audit table; a mount inside an `items-center` overflow container whose top edge is unreachable; and a backfill that would have permanently frozen a known mislabelling); the authoritative plan was then re-run on the required model with all findings supplied. Amendments A–G proposed. | Plan recorded. Amendment A2 (legacy prefix-only rows) is the one open human decision; the backfill migration is deferred (Amendment D) specifically to keep A2's cheapest fix viable, since read-time derivation self-corrects every legacy row. |
| 2026-07-27 | **Steps 1–5 implemented** (§11). Step 1: `shared/documentStatus.ts` + 27 derivation tests. Step 2: `parseDocument.ts` re-exports the registry and imports the three markers (zero behaviour change) + 3 truncation regression tests — confirming again that a size-truncated xlsx *does* carry a detectable marker. Step 3: `projectDocuments.processingStatus`/`processingDetail` widened, `documentUploadAttempts` added with both indexes. Step 4: derivation in `uploadDocument` (insert + dedupe backfill-on-touch), carry-over in `copyProjectInputRows`, read-time fallback in `listDocuments` + 7 tests. Step 5: `convex/uploadAttempts.ts` + `convex/lib/uploadAttempts.ts`, resolution wired into **both** `uploadDocument` paths + 16 tests. | Green: 251/251 `npm run test`, `npx tsc --noEmit -p convex` clean, `npx convex codegen` clean. One planning assumption corrected during implementation: `listDocuments` access is firm-wide for any authenticated internal user (domain contract D1), so the exclusion test asserts unauthenticated-only denial. Added `deriveStoredProcessing` for the three call sites that derive from a stored row (no client facts available) so the pasted-text inference lives in one place. |
| 2026-07-27 | **Planning pass re-run on claude-fable-5** (the prior pass ran on the wrong model) and recorded as the single authoritative plan, superseding the earlier section in full. | Corrected 7-point current-state map (2 server writers, 5 client ingress sites); 10-rule pure derivation kept; `documentUploadAttempts` schema + idempotent attempt lifecycle + localStorage outbox designed; prune-on-write retention per repo patterns; token-user exclusion verified; report-gating fix specified; dedupe-safe Replace specified; xlsx claim corrected to regression-tests-only; 13 sequenced steps; 2 open questions (Q3, Q6) remain for human decision. No source file modified. |

## Completion record

- **Pull request/commit:** `8fa3a2e` — `Ship PSOS upload receipts and reliability updates`, pushed to `origin/main` on 2026-07-28. The integrated commit includes the complete pre-existing reviewed workspace (PSOS, chat/reasoning, QA, role, and email reliability work), not only PSOS-04.
- **Deployment:** Convex development deployment completed 2026-07-28 with `npx convex dev --once` against `admin-choquer:banhall:dev/bryce-choquer` (`energized-salamander-237`); functions ready after successful typecheck. Frontend production deployment was not requested/run.
- **Follow-up tickets to file during release handoff:**
  1. Structured truncation metadata / generation's separate 15,000-char context slice (a long file may say Ready while generation uses only its first 15k chars).
  2. Storage-bytes failure with successful text extraction (human Q3 accepted unchanged for v1).
  3. Deferred status backfill with `force` mode after A2, for the small window where a wrong status may already have been persisted.
  4. FilesPanel legacy accessibility debt (32px icon targets, bare `title=`, modal Escape/focus trap).
  5. First repository-wide test CI workflow; intentionally excluded from this ticket under queue rule 5.
  6. `tests/*.test.ts` bun suite not included in `npm run test`.
- **Known limitations accepted for release:** same-browser-profile-only durability for failures whose first request never reached Convex; 30s per mutation timeout means a fully offline first file may take roughly 90s through begin/url/upload before all rows settle; wizard rejections before `createProject` remain session-only; timed-out replace that lands late can leave two truthful rows for manual cleanup; attempts do not store category, so replacing a failed context-input attempt creates an uncategorized document; no duration/backfill of statuses already persisted in the brief step-1→step-8 window until the force migration follow-up.
- **Release QA still required before `done`:** signed-in Chrome mixed chat batch; Chrome offline → settle → Retry with no duplicate; reload shows durable failures; failed-attempt Replace; document Replace success + partial-success (delete-old failure) + confirmation; verify no Replace on ready/ready-truncated. Convex development deployment is complete; production frontend/deployment remains separate.
