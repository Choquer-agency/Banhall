/**
 * A company file's text (2026-10-26, Phase C): stored in pieces in
 * companyFileTexts, the same shape as a project file's (32,000 characters
 * that never split a character, each with its start), keyed by the file
 * only. A thin layer over the pure helpers of convex/lib/documentText.ts, so
 * both kinds of file cut, count and fingerprint their text the same way.
 * Company file text is never kept on the row.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ReadCounter } from "./readMeter";
import {
  assertDocumentTextFits,
  documentTextFacts,
  documentTextPieceEnds,
  DocumentTextIncompleteError,
  MAX_DOCUMENT_TEXT_PIECES,
  type DocumentTextFacts,
} from "./documentText";

const MAX_PIECE_BYTES = 900_000;

/** `String.prototype.slice` offset rules for a non-negative length. */
function clampOffset(offset: number, length: number): number {
  const whole = Number.isFinite(offset) ? Math.trunc(offset) : offset > 0 ? length : 0;
  return whole < 0 ? Math.max(length + whole, 0) : Math.min(whole, length);
}

/** Checks the text's size and returns the facts the row keeps. */
export async function companyFileTextFacts(text: string): Promise<DocumentTextFacts> {
  assertDocumentTextFits(text);
  return await documentTextFacts(text);
}

/** Stores the pieces of a file that has none yet. */
export async function insertCompanyFileTextPieces(
  ctx: MutationCtx,
  companyFileId: Id<"companyFiles">,
  text: string
): Promise<void> {
  const encoder = new TextEncoder();
  let at = 0;
  for (const end of documentTextPieceEnds(text)) {
    const piece = text.slice(at, end);
    if (encoder.encode(piece).length > MAX_PIECE_BYTES) throw new Error("Company file text piece exceeds its byte limit");
    await ctx.db.insert("companyFileTexts", { companyFileId, start: at, text: piece });
    at = end;
  }
}

/**
 * The file's text from `start` to `end` (slice rules), joined from its
 * pieces. Throws DocumentTextIncompleteError when the pieces do not cover
 * the range, as a project file's read does.
 */
export async function readCompanyFileText(
  ctx: QueryCtx,
  file: Pick<Doc<"companyFiles">, "_id" | "textLength">,
  start = 0,
  end?: number,
  meter?: ReadCounter
): Promise<string> {
  const length = file.textLength;
  const from = clampOffset(start, length);
  const to = end === undefined ? length : clampOffset(end, length);
  if (to <= from) return "";
  await meter?.beforeRead?.();
  const covering = await ctx.db
    .query("companyFileTexts")
    .withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", file._id).lte("start", from))
    .order("desc")
    .first();
  if (!covering) throw new DocumentTextIncompleteError();
  meter?.read(covering);
  await meter?.beforeRead?.();
  const after = await ctx.db
    .query("companyFileTexts")
    .withIndex("by_companyFileId_and_start", (q) =>
      q.eq("companyFileId", file._id).gt("start", covering.start).lt("start", to)
    )
    .take(MAX_DOCUMENT_TEXT_PIECES + 1);
  if (after.length > MAX_DOCUMENT_TEXT_PIECES) throw new DocumentTextIncompleteError("Document text has too many pieces");
  for (const piece of after) meter?.read(piece);
  let joined = covering.text;
  for (const piece of after) {
    if (piece.start !== covering.start + joined.length) throw new DocumentTextIncompleteError();
    joined += piece.text;
  }
  if (covering.start + joined.length < to) throw new DocumentTextIncompleteError();
  return joined.slice(from - covering.start, to - covering.start);
}

/** The text, or null when its pieces are incomplete (readers that can do without one file). */
export async function readCompanyFileTextOrNull(
  ctx: QueryCtx,
  file: Pick<Doc<"companyFiles">, "_id" | "textLength">,
  start = 0,
  end?: number,
  meter?: ReadCounter
): Promise<string | null> {
  try {
    return await readCompanyFileText(ctx, file, start, end, meter);
  } catch (error) {
    if (error instanceof DocumentTextIncompleteError) {
      console.warn(`company file text: ${file._id} has incomplete pieces; left out`);
      return null;
    }
    throw error;
  }
}

async function deleteTextPieces(ctx: MutationCtx, companyFileId: Id<"companyFiles">): Promise<void> {
  for (;;) {
    const pieces = await ctx.db
      .query("companyFileTexts")
      .withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", companyFileId))
      .take(MAX_DOCUMENT_TEXT_PIECES);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length < MAX_DOCUMENT_TEXT_PIECES) return;
  }
}

/**
 * Replaces a company file's text (the server's reading of a file with
 * nothing read) and returns the facts for its row. Its search pieces stay
 * until they are cut again: search drops a piece whose fingerprint is not
 * the file's.
 */
export async function replaceCompanyFileText(
  ctx: MutationCtx,
  companyFileId: Id<"companyFiles">,
  text: string
): Promise<DocumentTextFacts> {
  const facts = await companyFileTextFacts(text);
  await deleteTextPieces(ctx, companyFileId);
  await insertCompanyFileTextPieces(ctx, companyFileId, text);
  return facts;
}

/** Deletes a company file's text pieces and its search pieces. */
export async function deleteCompanyFileText(ctx: MutationCtx, companyFileId: Id<"companyFiles">): Promise<void> {
  await deleteTextPieces(ctx, companyFileId);
  await deleteCompanyFileSearchPieces(ctx, companyFileId);
}

/** Deletes a company file's search pieces. */
export async function deleteCompanyFileSearchPieces(ctx: MutationCtx, companyFileId: Id<"companyFiles">): Promise<void> {
  for (;;) {
    const pieces = await ctx.db
      .query("documentSearchPieces")
      .withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", companyFileId))
      .take(500);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length < 500) return;
  }
}
