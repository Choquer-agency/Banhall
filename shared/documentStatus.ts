/**
 * PSOS-04: the one place that decides what happened to an uploaded file.
 *
 * Extraction runs in the browser (`src/lib/parseDocument.ts`), but the browser
 * only reports observable *facts*; the mapping from facts to a stored status
 * belongs to the server, so `uploadDocument` calls this and is the only writer
 * of `processingStatus`. A client that lies (or is simply out of date) can
 * mislabel one row but can never produce a status the content doesn't support:
 * empty content forces a non-ready status on its own.
 *
 * Lives in `shared/` because Convex must never import `parseDocument.ts` — that
 * file dynamically imports pdfjs/xlsx/mammoth, which are browser-only. The pure
 * registry pieces below therefore live here and are re-exported from
 * `parseDocument.ts` so existing importers don't change.
 */

/**
 * BNH-33: the single source of truth for which file extensions we can actually
 * parse. Anything outside this list is flagged in the UI before generation so a
 * writer never hits a silent failure mid-generate (e.g. .msg used to error).
 * Email exports: .msg (Outlook), .eml (RFC822 — Apple Mail / Thunderbird / Gmail
 * "show original" / Outlook "save as"), .mbox (Gmail / Thunderbird bulk export).
 */
export const SUPPORTED_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "pdf",
  "docx",
  "msg",
  "eml",
  "mbox",
  "xlsx",
  "xls",
  "csv",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
] as const;

/** Extensions stored as reference files only — no text extraction (yet). */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

/** Human-friendly list for `accept` attributes and warning copy. */
export const SUPPORTED_ACCEPT =
  ".txt,.md,.markdown,.pdf,.docx,.msg,.eml,.mbox,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.gif";

/** For warning copy — keep in sync with SUPPORTED_EXTENSIONS. */
export const SUPPORTED_LABEL =
  "PDF, Word (.docx), Excel (.xlsx/.xls/.csv), email (.eml/.msg/.mbox), images (.png/.jpg/.webp/.gif), .txt, .md";

export function getFileExtension(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isSupportedFile(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(
    getFileExtension(name)
  );
}

export function isImageFile(name: string): boolean {
  return (IMAGE_EXTENSIONS as readonly string[]).includes(getFileExtension(name));
}

// ─── Truncation markers ─────────────────────────────────────────────────────

/**
 * Every size-limited extraction path ends by appending one of these. The
 * producer (`parseDocument.ts`) imports them from here so the marker text and
 * the detector below cannot drift apart.
 */
export const CAP_TRUNCATION_MARKER =
  "\n\n[Document truncated — text exceeded the size limit]";

export function pdfPageStopMarker(page: number): string {
  return `\n[Stopped reading at page ${page} — document too large or slow to parse (likely drawings/scans with little extractable text)]`;
}

export function mboxOverflowMarker(remaining: number): string {
  return `\n\n[${remaining} more message(s) in this mailbox were not included]`;
}

/**
 * How much of the tail `hasTruncationMarker` inspects. Markers are appended at
 * the very end by construction, and a full scan of up to 400k chars per row
 * inside a reactive query is a real performance hazard. A marker pushed further
 * back than this window is deliberately not detected.
 */
export const TRUNCATION_TAIL_WINDOW = 300;

const TRUNCATION_PATTERNS = [
  /\[Document truncated — text exceeded the size limit\]/,
  /\[Stopped reading at page \d+ — document too large or slow to parse/,
  /\[\d+ more message\(s\) in this mailbox were not included\]/,
];

export function hasTruncationMarker(content: string): boolean {
  const tail = content.slice(-TRUNCATION_TAIL_WINDOW);
  return TRUNCATION_PATTERNS.some((pattern) => pattern.test(tail));
}

// ─── Status derivation ──────────────────────────────────────────────────────

/** Persisted on `projectDocuments`. */
export const PROCESSING_STATUSES = [
  "ready",
  "ready_truncated",
  "reference_only",
  "could_not_read",
  "skipped_unsupported",
] as const;
export type ProcessingStatus = (typeof PROCESSING_STATUSES)[number];

/**
 * Presentation union: adds the failure of an upload that never produced a
 * document row. Never persisted on `projectDocuments` — it lives on
 * `documentUploadAttempts` instead.
 */
export type ReceiptStatus = ProcessingStatus | "upload_failed";

const RECEIPT_STATUSES: readonly string[] = [
  ...PROCESSING_STATUSES,
  "upload_failed",
];

/** Runtime guard for payloads crossing a deploy-version boundary. */
export function isReceiptStatus(value: unknown): value is ReceiptStatus {
  return typeof value === "string" && RECEIPT_STATUSES.includes(value);
}

/**
 * Machine reason code, never free text. Making this a literal union is what
 * makes "no provider/internal error strings leak" a structural guarantee rather
 * than a discipline: the Convex validator rejects prose outright. Deliberately
 * unlike `financialUploads.processingError: v.string()`.
 */
export const PROCESSING_DETAILS = [
  "text_extracted",
  "text_truncated",
  "image_reference",
  "no_text_extracted",
  "parse_failed",
  "unsupported_extension",
  "pasted_text",
] as const;
export type ProcessingDetail = (typeof PROCESSING_DETAILS)[number];

export type ExtractionFacts = {
  fileName: string;
  content: string;
  /** Client fact: the parser threw. Only ever narrows a decision empty content
   *  would force anyway. */
  extractionFailed?: boolean;
  /** Client fact: pasted text has no file extension, so extension-based
   *  derivation would wrongly call it unsupported. */
  intake?: "file" | "pasted";
};

export type DerivedProcessing = {
  status: ProcessingStatus;
  detail: ProcessingDetail;
};

/**
 * Precedence is the specification; first match wins. Status and detail are
 * returned as one pair so they can never disagree.
 */
export function deriveProcessingStatus(facts: ExtractionFacts): DerivedProcessing {
  const hasText = facts.content.trim().length > 0;
  const truncated = hasText && hasTruncationMarker(facts.content);

  // 1–2. Pasted text: no extension to reason about.
  if ((facts.intake ?? "file") === "pasted") {
    return hasText
      ? { status: "ready", detail: "pasted_text" }
      : { status: "could_not_read", detail: "no_text_extracted" };
  }

  // 3–4. Images are reference-only *by nature*, not by failure: nothing was
  // attempted, so nothing failed. Evaluated before the parse-failure rules.
  if (isImageFile(facts.fileName)) {
    if (!hasText) return { status: "reference_only", detail: "image_reference" };
    return truncated
      ? { status: "ready_truncated", detail: "text_truncated" }
      : { status: "ready", detail: "text_extracted" };
  }

  // 5–6. Off the whitelist. With usable text it is still `ready`: generation
  // feeds any non-empty document to the model, so "Skipped" would be a lie.
  if (!isSupportedFile(facts.fileName)) {
    if (!hasText) {
      return { status: "skipped_unsupported", detail: "unsupported_extension" };
    }
    return truncated
      ? { status: "ready_truncated", detail: "text_truncated" }
      : { status: "ready", detail: "unsupported_extension" };
  }

  // 7–8. Supported, non-image, nothing readable. A scanned PDF and an empty
  // .txt are indistinguishable from the extracted bytes and have the same
  // consequence, so they share a status.
  if (!hasText) {
    return facts.extractionFailed
      ? { status: "could_not_read", detail: "parse_failed" }
      : { status: "could_not_read", detail: "no_text_extracted" };
  }

  // 9–10.
  return truncated
    ? { status: "ready_truncated", detail: "text_truncated" }
    : { status: "ready", detail: "text_extracted" };
}

/**
 * Before the wizard was fixed, its previous-year path stored
 * `prefix + extractedText`, so a file yielding nothing still persisted this
 * boilerplate line — and a stored row can no longer tell boilerplate from
 * extracted text. Stored-row derivation strips exactly this one line before
 * measuring, so those files report `could_not_read` instead of claiming to be
 * readable.
 *
 * Exact-literal on purpose: the wording, the em-dash, the numeric year and the
 * trailing newline must all match. A genuine document that happens to open with
 * some other bracketed line is untouched. The `Note:` line is deliberately NOT
 * stripped — that is the user's own text, it is stored, and generation reads
 * it, so a row carrying one is truthfully ready.
 */
const LEGACY_PY_PREFIX_RE = /^\[Previous-year report — fiscal -?\d+(?:\.\d+)?\]\n/;

export function stripIngestPrefix(content: string): string {
  return content.replace(LEGACY_PY_PREFIX_RE, "");
}

/**
 * Derivation for a row that is already stored, where the client's facts are
 * gone: used by the `listDocuments` read-time fallback, the backfill migration,
 * and project duplication. A missing extension means the row was pasted text
 * (both wizard paste call sites name their rows without one), so treating it as
 * a file would wrongly call it unsupported. `extractionFailed` is unknowable
 * after the fact and left false — the resulting status is `could_not_read`
 * either way, only the reason code differs.
 *
 * Live uploads never come through here: they derive from the client's facts,
 * and the wizard now sends empty content when nothing was extracted.
 */
export function deriveStoredProcessing(row: {
  fileName: string;
  content: string;
}): DerivedProcessing {
  return deriveProcessingStatus({
    fileName: row.fileName,
    content: stripIngestPrefix(row.content),
    intake: getFileExtension(row.fileName) === "" ? "pasted" : "file",
  });
}

/**
 * Collapse parse artifacts in extracted document/transcript text: CRLF and
 * NBSP normalization, trailing whitespace per line, and runs of 3+ newlines
 * down to one blank line. Word-exported forms (T661 PDs especially) carry
 * page-layout whitespace that reads as noise once flattened to text.
 *
 * Applied at ingestion (every parser and paste path flows through
 * `capContent`) and again at render time, so documents stored before this
 * existed present clean too. Idempotent by construction.
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
