/**
 * When the server reads a project file's stored original again (2026-10-26,
 * context pipeline plan Phase B2; decision "2026-10-26" part 2). The browser
 * reads a file once at upload; when no text came out of a supported file, or
 * the browser stopped early (a PDF it gave up on after its 60 seconds), the
 * server reads the original (convex/ai/fileReading.ts) and
 * convex/documentReading.ts keeps the fuller text. No AI writes any of it.
 */
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isImageFile, isSupportedFile } from "../../shared/documentStatus";

/** The start of the line a reader adds when it stops reading a PDF early. */
const PAGE_STOP_PREFIX = "\n[Stopped reading at page ";

/** How far from the end the stop line may start. */
const STOP_LINE_WINDOW = 400;

/** Whether a file's text stops where a reader gave up on a PDF. */
export function stoppedEarly(text: string): boolean {
  return text.slice(-STOP_LINE_WINDOW).includes(PAGE_STOP_PREFIX);
}

/** A text without the stop line at its end, if it has one. */
function withoutStopLine(text: string): string {
  const at = text.lastIndexOf(PAGE_STOP_PREFIX);
  return at >= 0 && at >= text.length - STOP_LINE_WINDOW ? text.slice(0, at) : text;
}

/**
 * Whether the server should read a file's original: a stored original of a
 * supported type that is not a picture, whose text is empty or stops early,
 * and that the server has not read yet.
 */
export function needsServerReading(doc: {
  fileName: string;
  storageId?: Id<"_storage">;
  archived?: boolean;
  serverReadAt?: number;
  hasText: boolean;
  stoppedEarly: boolean;
}): boolean {
  if (!doc.storageId || doc.archived || doc.serverReadAt !== undefined) return false;
  if (!isSupportedFile(doc.fileName) || isImageFile(doc.fileName)) return false;
  return !doc.hasText || doc.stoppedEarly;
}

/**
 * Whether the server's reading may replace a file's text. A file with no
 * text takes any text. A file whose reading stopped early takes a longer
 * reading only when that reading starts with exactly the text read so far,
 * so every position already pointing into the file still lands on the same
 * characters. Anything else waits for text versions (Phase B1), which keep
 * the old text beside the new one.
 */
export function serverReadingReplaces(stored: string, reading: string): boolean {
  if (reading.trim().length === 0) return false;
  if (stored.trim().length === 0) return true;
  if (!stoppedEarly(stored)) return false;
  const readSoFar = withoutStopLine(stored);
  return reading.startsWith(readSoFar) && withoutStopLine(reading).length > readSoFar.length;
}

/**
 * Queues the server's reading of a file just added or just given its
 * original, when it needs one. `text` is the file's whole text as stored.
 */
export async function queueServerReadingIfNeeded(
  ctx: MutationCtx,
  documentId: Id<"projectDocuments">,
  doc: { fileName: string; storageId?: Id<"_storage">; archived?: boolean; serverReadAt?: number },
  text: string
): Promise<boolean> {
  const needed = needsServerReading({
    ...doc,
    hasText: text.trim() !== "",
    stoppedEarly: stoppedEarly(text),
  });
  if (needed) await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredDocument, { documentId });
  return needed;
}
