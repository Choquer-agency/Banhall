/**
 * 2026-10-22 (fourth): a project file's text and the facts about it.
 *
 * A file's text lives in `projectDocumentTexts`, in pieces of at most
 * DOCUMENT_TEXT_PIECE_CHARS characters that never split a character, each
 * with its exact starting position. The file row keeps only facts (length,
 * whether it holds text, a fingerprint, word count, an opening preview and
 * `textMovedAt`), so lists and checks read no text. A row whose text has not
 * moved yet (`textMovedAt` absent) is read from its `content`, as before.
 *
 * Every read of a file's text goes through this module (a guard test fails
 * on any other read of `projectDocuments.content`). `readDocumentText`
 * returns exactly what `content.slice(start, end)` returns, so frozen
 * evidence, placeholders and fingerprints are unchanged by the move.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { countTextWords } from "../../shared/wordCount";
import { sha256 } from "./contracts";

/** Characters per stored piece: one piece covers a chat file's shown part. */
export const DOCUMENT_TEXT_PIECE_CHARS = 32_000;
/**
 * A UTF-16 unit is at most 3 UTF-8 bytes, so a piece is at most 96,000
 * bytes. Asserted on write, well under Convex's 1 MiB document limit.
 */
const MAX_DOCUMENT_TEXT_PIECE_BYTES = 900_000;
/** Characters of the opening preview kept on the row. */
export const DOCUMENT_TEXT_PREVIEW_CHARS = 2_000;
/**
 * Pieces one file may have: a 900,000-character intake file needs 29.
 * Reading or deleting more fails closed.
 */
const MAX_DOCUMENT_TEXT_PIECES = 64;

type TextFields = Pick<
  Doc<"projectDocuments">,
  "content" | "textMovedAt" | "textLength" | "hasText"
>;

/** The facts a row keeps about its text. */
export type DocumentTextFacts = {
  textLength: number;
  hasText: boolean;
  textHash: string;
  textPreview: string;
  wordCount: number;
};

export async function documentTextFacts(text: string): Promise<DocumentTextFacts> {
  return {
    textLength: text.length,
    hasText: text.trim() !== "",
    textHash: await sha256(text),
    textPreview: text.trimStart().slice(0, DOCUMENT_TEXT_PREVIEW_CHARS),
    wordCount: countTextWords(text),
  };
}

/** Whether a row's text lives in pieces. */
export function documentTextMoved(doc: Pick<Doc<"projectDocuments">, "textMovedAt">): boolean {
  return doc.textMovedAt !== undefined;
}

/** The text's length in UTF-16 units, as `content.length` was. */
export function documentTextLength(doc: TextFields): number {
  return documentTextMoved(doc) ? (doc.textLength ?? 0) : (doc.content ?? "").length;
}

/** Whether the text holds anything other than whitespace. */
export function documentHasText(doc: TextFields): boolean {
  return documentTextMoved(doc) ? doc.hasText === true : (doc.content ?? "").trim() !== "";
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Where each piece of `text` ends: never inside a surrogate pair. */
export function documentTextPieceEnds(text: string, pieceChars = DOCUMENT_TEXT_PIECE_CHARS): number[] {
  const ends: number[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + pieceChars);
    if (end < text.length && end - 1 > at && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    ends.push(end);
    at = end;
  }
  return ends;
}

/**
 * The text from `start` to `end` (UTF-16 offsets), exactly as
 * `content.slice(start, end)`: it may end inside a surrogate pair, as a
 * slice does. Reads only the pieces the range covers. Throws when a moved
 * row's pieces do not cover the range.
 */
export async function readDocumentText(
  ctx: QueryCtx,
  doc: TextFields & { _id: Id<"projectDocuments"> },
  start = 0,
  end?: number
): Promise<string> {
  if (!documentTextMoved(doc)) return (doc.content ?? "").slice(start, end);
  const length = doc.textLength ?? 0;
  const from = clampOffset(start, length);
  const to = end === undefined ? length : clampOffset(end, length);
  if (to <= from) return "";
  const covering = await ctx.db
    .query("projectDocumentTexts")
    .withIndex("by_documentId_and_start", (q) => q.eq("documentId", doc._id).lte("start", from))
    .order("desc")
    .first();
  if (!covering) throw new Error("Document text pieces are incomplete");
  const after = await ctx.db
    .query("projectDocumentTexts")
    .withIndex("by_documentId_and_start", (q) =>
      q.eq("documentId", doc._id).gt("start", covering.start).lt("start", to))
    .take(MAX_DOCUMENT_TEXT_PIECES + 1);
  if (after.length > MAX_DOCUMENT_TEXT_PIECES) throw new Error("Document text has too many pieces");
  let joined = covering.text;
  for (const piece of after) {
    if (piece.start !== covering.start + joined.length) {
      throw new Error("Document text pieces are incomplete");
    }
    joined += piece.text;
  }
  if (covering.start + joined.length < to) throw new Error("Document text pieces are incomplete");
  return joined.slice(from - covering.start, to - covering.start);
}

/** `String.prototype.slice` offset rules for a non-negative length. */
function clampOffset(offset: number, length: number): number {
  const whole = Number.isFinite(offset) ? Math.trunc(offset) : offset > 0 ? length : 0;
  return whole < 0 ? Math.max(length + whole, 0) : Math.min(whole, length);
}

/**
 * Stores `text` as the file's pieces, replacing any it had, and returns the
 * fields the row takes: its facts and `textMovedAt`.
 */
export async function writeDocumentText(
  ctx: MutationCtx,
  doc: { _id: Id<"projectDocuments">; projectId: Id<"projects"> },
  text: string,
  now = Date.now()
): Promise<DocumentTextFacts & { textMovedAt: number }> {
  await deleteDocumentText(ctx, doc._id);
  const encoder = new TextEncoder();
  let at = 0;
  for (const end of documentTextPieceEnds(text)) {
    const piece = text.slice(at, end);
    if (encoder.encode(piece).length > MAX_DOCUMENT_TEXT_PIECE_BYTES) {
      throw new Error("Document text piece exceeds its byte limit");
    }
    await ctx.db.insert("projectDocumentTexts", {
      documentId: doc._id,
      projectId: doc.projectId,
      start: at,
      text: piece,
    });
    at = end;
  }
  return { ...(await documentTextFacts(text)), textMovedAt: now };
}

/** Deletes a file's text pieces. */
export async function deleteDocumentText(
  ctx: MutationCtx,
  documentId: Id<"projectDocuments">
): Promise<void> {
  const pieces = await ctx.db
    .query("projectDocumentTexts")
    .withIndex("by_documentId_and_start", (q) => q.eq("documentId", documentId))
    .take(MAX_DOCUMENT_TEXT_PIECES + 1);
  if (pieces.length > MAX_DOCUMENT_TEXT_PIECES) throw new Error("Document text has too many pieces");
  for (const piece of pieces) await ctx.db.delete(piece._id);
}
