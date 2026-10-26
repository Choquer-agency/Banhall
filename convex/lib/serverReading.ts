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
import { isImageFile, isSupportedFile } from "../../shared/documentStatus";
import { documentHasText, documentTextLength, readDocumentText } from "./documentText";

/**
 * The server reader's version, recorded on each file it reads. A file read
 * (or tried) by this version is not read again; a newer version may read it.
 */
export const SERVER_READER_VERSION = "server-reader-1";

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
  storageId?: Id<"_storage">;
  archived?: boolean;
  serverReader?: string;
  serverReadAt?: number;
  serverReadStartedAt?: number;
};

/**
 * Whether the server should read a file's original: a stored original of a
 * supported type that is not a picture, with nothing read yet, that this
 * reader version has not read or started reading. A reading that started
 * and never finished (its action was stopped) is not tried again by the
 * same version; a reading that failed released its claim and may be.
 */
export function needsServerReading(doc: ReadingState & { hasReadText: boolean }): boolean {
  if (!doc.storageId || doc.archived) return false;
  if (!isSupportedFile(doc.fileName) || isImageFile(doc.fileName)) return false;
  if (
    doc.serverReader === SERVER_READER_VERSION &&
    (doc.serverReadAt !== undefined || doc.serverReadStartedAt !== undefined)
  ) {
    return false;
  }
  return !doc.hasReadText;
}

/**
 * Whether the server's reading may replace a file's text: only when the
 * file has nothing read and the server read something. A file with read
 * text keeps it, even when the browser stopped part way, because PD
 * reviews, upload retries and duplicate checks hold its fingerprint;
 * reading it again waits for text versions (Phase B1), which keep the old
 * text beside the new one.
 */
export function serverReadingReplaces(storedHasReadText: boolean, reading: string): boolean {
  return !storedHasReadText && hasReadText(reading);
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
  const needed = needsServerReading({ ...doc, hasReadText: fileHasReadText });
  if (needed) await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredDocument, { documentId });
  return needed;
}
