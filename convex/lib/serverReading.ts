/**
 * When the server reads a project file's stored original again (2026-10-26,
 * context pipeline plan Phase B2; decision "2026-10-26 (third)"). The
 * browser reads a file once at upload; when nothing came out of a supported
 * file (no text, or a PDF it gave up on before any page with text), the
 * server reads the original (convex/ai/fileReading.ts) and
 * convex/documentReading.ts keeps its text. No AI writes any of it.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { CAP_TRUNCATION_MARKER, isImageFile, isSupportedFile } from "../../shared/documentStatus";
import { escapeMarks, quotableWordText } from "../../shared/wordMarkdown";
import { documentHasText, documentTextLength, readDocumentText } from "./documentText";

/**
 * The server reader's version, recorded on each file it reads. A file read
 * (or tried) by this version is not read again; a newer version may read it.
 * 2: Word files as Markdown (2026-10-26, owner). 3: a Word file whose
 * stored text is not Markdown yet is read again, and its Markdown replaces
 * the plain text, which is kept as an earlier version (B1, 2026-10-26,
 * owner: "properly backfilled for any current/past files").
 */
export const SERVER_READER_VERSION = "server-reader-3";

/** A Word file whose stored text is not Markdown yet (B1: read again). */
export function wordWithoutMarkdown(doc: { fileName: string; textFormat?: "markdown" }): boolean {
  return /\.docx$/i.test(doc.fileName.trim()) && doc.textFormat !== "markdown";
}

/**
 * The line a reader adds when it stops reading a PDF early. Matched without
 * its leading newline: a file whose first page already ran out of time
 * holds only this line, and the text is trimmed.
 */
const STOP_LINE = "[Stopped reading at page ";

/** How far from the end the stop line may start. */
const STOP_LINE_WINDOW = 400;

/** A file text no longer than this is read whole to decide; anything longer holds read text. */
export const READ_TEXT_PROBE_CHARS = 1_000;

/** A text without the stop line at its end, if it has one. */
function withoutStopLine(text: string): string {
  const at = text.lastIndexOf(STOP_LINE);
  return at >= 0 && at >= text.length - STOP_LINE_WINDOW ? text.slice(0, at) : text;
}

/**
 * Whether a file's text holds anything a reader actually read: not empty,
 * and not only the line a reader adds when it stops before the first page
 * with text.
 */
export function hasReadText(text: string): boolean {
  return withoutStopLine(text).trim() !== "";
}

/** Whether a stored file holds read text, reading at most a short text whole. */
export async function documentHasReadText(
  ctx: QueryCtx,
  doc: Doc<"projectDocuments">
): Promise<boolean> {
  if (!documentHasText(doc)) return false;
  if (documentTextLength(doc) > READ_TEXT_PROBE_CHARS) return true;
  return hasReadText(await readDocumentText(ctx, doc));
}

type ReadingState = {
  fileName: string;
  textFormat?: "markdown";
  storageId?: Id<"_storage">;
  archived?: boolean;
  serverReader?: string;
  serverReadAt?: number;
  serverReadStartedAt?: number;
};

/**
 * Whether the server should read a file's original: a stored original of a
 * supported type that is not a picture, with nothing read yet (or, for a
 * project file, Word text that is not Markdown yet, B1), that this reader
 * version has not read or started reading. A reading that started
 * and never finished (its action was stopped) is not tried again by the
 * same version; a reading that failed released its claim and may be.
 */
export function needsServerReading(
  doc: ReadingState & { hasReadText: boolean },
  /**
   * B1: project files only. A company file has no earlier versions to keep
   * its plain text in, so its Word text is not read again (review).
   */
  options: { wordMarkdownBackfill?: boolean } = {}
): boolean {
  if (!doc.storageId || doc.archived) return false;
  if (!isSupportedFile(doc.fileName) || isImageFile(doc.fileName)) return false;
  if (
    doc.serverReader === SERVER_READER_VERSION &&
    (doc.serverReadAt !== undefined || doc.serverReadStartedAt !== undefined)
  ) {
    return false;
  }
  // B1: a Word file read before Word was kept as Markdown is read again.
  return !doc.hasReadText || (options.wordMarkdownBackfill === true && wordWithoutMarkdown(doc));
}

/**
 * Whether the server's reading may replace a file's text: when the file has
 * nothing read and the server read something, or (B1) when a Word file's
 * Markdown reading replaces the plain text it was stored with, which is kept
 * as a version. Any other file with read text keeps it, even when the
 * browser stopped part way.
 */
export function serverReadingReplaces(
  storedHasReadText: boolean,
  reading: string,
  /** B1: a Word file's Markdown reading of plain text it already has; the plain text is kept as a version. */
  wordMarkdown = false
): boolean {
  return hasReadText(reading) && (!storedHasReadText || wordMarkdown);
}

/** A previous-year report's first lines: its header, then the year's note, then a blank line. */
const PREVIOUS_YEAR_PREFIX = /^(\[Previous-year report \u2014 fiscal \d{4}\]\n)(?:Note: ([\s\S]*?)\n)?\n/;

/** The letters and digits a text starts with, to tell whether two readings are of the same words. */
function openingWords(text: string, size = 80): string {
  return text.replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase().slice(0, size);
}

/**
 * B1 (review): the text a Word file's Markdown reading leaves the file, or
 * null when it may not replace the plain text it has.
 *
 * - A previous-year report keeps its header and the writer's note (escaped
 *   for Markdown) before the reading: they are not in the original file.
 * - The rest of the stored text must start with the same words as the
 *   reading; otherwise something else wrote it and it is kept.
 * - A reading cut at the size cap never replaces text that was not cut.
 */
export function wordBackfillText(stored: string, reading: string): string | null {
  if (reading.endsWith(CAP_TRUNCATION_MARKER) && !stored.endsWith(CAP_TRUNCATION_MARKER)) return null;
  const prefix = PREVIOUS_YEAR_PREFIX.exec(stored);
  const body = prefix ? stored.slice(prefix[0].length) : stored;
  const opening = openingWords(body);
  if (!opening || opening !== openingWords(quotableWordText(reading)).slice(0, opening.length)) return null;
  if (!prefix) return reading;
  const note = prefix[2] === undefined ? "" : `Note: ${escapeMarks(prefix[2])}\n`;
  return `${prefix[1]}${note}\n${reading}`;
}

/**
 * Queues the server's reading of a file just added or just given its
 * original, when it needs one.
 */
export async function queueServerReadingIfNeeded(
  ctx: MutationCtx,
  documentId: Id<"projectDocuments">,
  doc: ReadingState,
  fileHasReadText: boolean
): Promise<boolean> {
  const needed = needsServerReading({ ...doc, hasReadText: fileHasReadText }, { wordMarkdownBackfill: true });
  if (needed) await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredDocument, { documentId });
  return needed;
}
