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
import type { WithoutSystemFields } from "convex/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { countTextWords } from "../../shared/wordCount";
import { domainError, sha256 } from "./contracts";
import type { ReadCounter } from "./readMeter";

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
export const MAX_DOCUMENT_TEXT_PIECES = 64;
/**
 * 2026-10-22 (fourth, code review): the most text a file may store, checked
 * on the server. The 1 MiB row limit used to cap it; the largest real path
 * is an intake file of 900,000 characters. Well inside
 * MAX_DOCUMENT_TEXT_PIECES pieces even when every piece moves back to a
 * word break.
 */
export const MAX_DOCUMENT_TEXT_CHARS = 1_000_000;

/** Refuses text longer than MAX_DOCUMENT_TEXT_CHARS, in words a writer can act on. */
export function assertDocumentTextFits(text: string): void {
  if (text.length > MAX_DOCUMENT_TEXT_CHARS) {
    domainError(
      "INVALID_INPUT",
      `This file's text is too long to keep (${text.length.toLocaleString("en-US")} characters; the most is ${MAX_DOCUMENT_TEXT_CHARS.toLocaleString("en-US")}). Split it into smaller files.`,
      { reason: "DOCUMENT_TEXT_TOO_LONG" }
    );
  }
}

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

/** The opening characters, leading whitespace removed: the stored preview. */
export function documentTextPreview(doc: TextFields & Pick<Doc<"projectDocuments">, "textPreview">): string {
  return documentTextMoved(doc)
    ? (doc.textPreview ?? "")
    : (doc.content ?? "").trimStart().slice(0, DOCUMENT_TEXT_PREVIEW_CHARS);
}

/** Whether the text holds anything other than whitespace. */
export function documentHasText(doc: TextFields): boolean {
  return documentTextMoved(doc) ? doc.hasText === true : (doc.content ?? "").trim() !== "";
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/**
 * How far back a piece's end may move to fall between words, so the search
 * index (one per piece) never sees half a word. Text with no break that
 * close is cut where it is.
 */
const PIECE_WORD_BREAK_CHARS = 1_000;
const isBreak = (char: string) => /[\s.,;:!?()[\]{}"'\u2013\u2014/\\|]/u.test(char);

/**
 * Where each piece of `text` ends: never inside a surrogate pair, and
 * between words when a break falls in the last PIECE_WORD_BREAK_CHARS
 * characters, so a word is never split across two pieces' search entries.
 */
export function documentTextPieceEnds(text: string, pieceChars = DOCUMENT_TEXT_PIECE_CHARS): number[] {
  const ends: number[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + pieceChars);
    if (end < text.length && !isBreak(text[end - 1]!) && !isBreak(text[end]!)) {
      const floor = Math.max(at + 1, end - PIECE_WORD_BREAK_CHARS);
      for (let candidate = end - 1; candidate >= floor; candidate -= 1) {
        if (isBreak(text[candidate - 1]!)) {
          end = candidate;
          break;
        }
      }
    }
    if (end < text.length && end - 1 > at && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    ends.push(end);
    at = end;
  }
  return ends;
}

/**
 * A moved file whose pieces do not cover what was asked. Readers that can do
 * without one file (chat, search, research) catch it and leave the file out;
 * readers that need exact text (frozen evidence, previews) let it fail.
 */
export class DocumentTextIncompleteError extends Error {
  constructor(message = "Document text pieces are incomplete") {
    super(message);
    this.name = "DocumentTextIncompleteError";
  }
}

/** The text, or null when a moved file's pieces are incomplete. */
export async function readDocumentTextOrNull(
  ctx: QueryCtx,
  doc: TextFields & { _id: Id<"projectDocuments"> },
  start = 0,
  end?: number,
  meter?: ReadCounter
): Promise<string | null> {
  try {
    return await readDocumentText(ctx, doc, start, end, meter);
  } catch (error) {
    if (error instanceof DocumentTextIncompleteError) {
      console.warn(`document text: ${doc._id} has incomplete pieces; left out`);
      return null;
    }
    throw error;
  }
}

/**
 * The text from `start` to `end` (UTF-16 offsets), exactly as
 * `content.slice(start, end)`: it may end inside a surrogate pair, as a
 * slice does. Reads only the pieces the range covers. Throws when a moved
 * row's pieces do not cover the range. `meter` counts the pieces it reads.
 */
export async function readDocumentText(
  ctx: QueryCtx,
  doc: TextFields & { _id: Id<"projectDocuments"> },
  start = 0,
  end?: number,
  meter?: ReadCounter
): Promise<string> {
  if (!documentTextMoved(doc)) return (doc.content ?? "").slice(start, end);
  const length = doc.textLength ?? 0;
  const from = clampOffset(start, length);
  const to = end === undefined ? length : clampOffset(end, length);
  if (to <= from) return "";
  await meter?.beforeRead?.();
  const covering = await ctx.db
    .query("projectDocumentTexts")
    .withIndex("by_documentId_and_start", (q) => q.eq("documentId", doc._id).lte("start", from))
    .order("desc")
    .first();
  if (!covering) throw new DocumentTextIncompleteError();
  meter?.read(covering);
  await meter?.beforeRead?.();
  const after = await ctx.db
    .query("projectDocumentTexts")
    .withIndex("by_documentId_and_start", (q) =>
      q.eq("documentId", doc._id).gt("start", covering.start).lt("start", to))
    .take(MAX_DOCUMENT_TEXT_PIECES + 1);
  if (after.length > MAX_DOCUMENT_TEXT_PIECES) throw new DocumentTextIncompleteError("Document text has too many pieces");
  for (const piece of after) meter?.read(piece);
  let joined = covering.text;
  for (const piece of after) {
    if (piece.start !== covering.start + joined.length) {
      throw new DocumentTextIncompleteError();
    }
    joined += piece.text;
  }
  if (covering.start + joined.length < to) throw new DocumentTextIncompleteError();
  return joined.slice(from - covering.start, to - covering.start);
}

/** The sha256 of the exact text: the stored fingerprint once it moved. */
export async function documentTextHash(
  doc: Pick<Doc<"projectDocuments">, "content" | "textMovedAt" | "textHash">
): Promise<string> {
  if (documentTextMoved(doc) && doc.textHash !== undefined) return doc.textHash;
  return await sha256(doc.content ?? "");
}

/** Whether the file holds exactly `text`, as `content === text` was. */
export async function documentTextEquals(
  doc: Pick<Doc<"projectDocuments">, "content" | "textMovedAt" | "textHash" | "textLength" | "hasText">,
  text: string
): Promise<boolean> {
  if (!documentTextMoved(doc)) return (doc.content ?? "") === text;
  return documentTextLength(doc) === text.length && (await documentTextHash(doc)) === (await sha256(text));
}

const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * A range that never splits a character, and its text: the same range and
 * text `safeRange(content, start, end)` and `content.slice` gave for integer
 * offsets, reading only one character past each edge.
 */
export async function readDocumentTextSafeRange(
  ctx: QueryCtx,
  doc: TextFields & { _id: Id<"projectDocuments"> },
  start: number,
  end: number
): Promise<{ start: number; end: number; text: string }> {
  const length = documentTextLength(doc);
  let from = Math.max(0, Math.min(start, length));
  let to = Math.max(from, Math.min(end, length));
  const windowStart = Math.max(0, from - 1);
  // Through `from` itself even for an empty range, which safeRange checks.
  const window = await readDocumentText(ctx, doc, windowStart, Math.min(length, Math.max(to, from + 1)));
  const codeAt = (offset: number) => window.charCodeAt(offset - windowStart);
  if (from > 0 && from < length && isLowSurrogate(codeAt(from))) from -= 1;
  if (to > from && to < length && isHighSurrogate(codeAt(to - 1))) to -= 1;
  return { start: from, end: to, text: window.slice(from - windowStart, to - windowStart) };
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
  now = Date.now(),
  /**
   * Text already stored (the copy pass, a project copy) is not held to
   * MAX_DOCUMENT_TEXT_CHARS: an older row may hold up to about 1,048,000
   * characters, which the row limit allowed. New text is.
   */
  options: { storedText?: boolean } = {}
): Promise<
  DocumentTextFacts & { textMovedAt: number; searchPiecesDue: true; searchPiecesNextAt: number; searchPiecesAttempts: undefined }
> {
  if (!options.storedText) assertDocumentTextFits(text);
  await deleteDocumentText(ctx, doc._id);
  await insertDocumentTextPieces(ctx, doc, text);
  // 2026-10-26 (Phase B4): new text, so new search pieces (the sweep cuts them).
  return {
    ...(await documentTextFacts(text)),
    textMovedAt: now,
    searchPiecesDue: true,
    searchPiecesNextAt: 0,
    searchPiecesAttempts: undefined,
  };
}

/** Inserts the pieces of a file that has none yet. */
async function insertDocumentTextPieces(
  ctx: MutationCtx,
  doc: { _id: Id<"projectDocuments">; projectId: Id<"projects"> },
  text: string
): Promise<void> {
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
}

/** A file row's fields other than its text and the facts about it. */
export type DocumentRowFields = Omit<
  WithoutSystemFields<Doc<"projectDocuments">>,
  "content" | "wordCount" | "textLength" | "hasText" | "textHash" | "textPreview" | "textMovedAt"
>;

/**
 * 2026-10-22 (fourth), step 3: inserts a file row with the facts about
 * `text` and stores the text as pieces; the row carries no `content`. Every
 * writer of a project file goes through here.
 */
export async function insertDocumentWithText(
  ctx: MutationCtx,
  fields: DocumentRowFields,
  text: string,
  now = Date.now(),
  /** A copy of text already stored (a project copy) keeps any length it has. */
  options: { storedText?: boolean } = {}
): Promise<Id<"projectDocuments">> {
  if (!options.storedText) assertDocumentTextFits(text);
  const documentId = await ctx.db.insert("projectDocuments", {
    ...fields,
    ...(await documentTextFacts(text)),
    textMovedAt: now,
    // 2026-10-26 (Phase B4): text to search, so the sweep cuts its pieces.
    ...(text.trim() ? { searchPiecesDue: true as const, searchPiecesNextAt: 0 } : {}),
  });
  // A new row has no pieces to replace, so none are looked up.
  await insertDocumentTextPieces(ctx, { _id: documentId, projectId: fields.projectId }, text);
  return documentId;
}

/**
 * 2026-10-26 (B1, first part): keeps a file's current text as its next
 * version before a better reading replaces it, so the earlier text is never
 * lost (part 4 of the first 2026-10-26 entry). Nothing is kept for a file
 * with no text.
 */
export async function keepDocumentTextVersion(
  ctx: MutationCtx,
  doc: Doc<"projectDocuments">,
  why: "word_markdown" | "server_reading",
  now = Date.now()
): Promise<Id<"projectDocumentTextVersions"> | null> {
  const text = await readDocumentText(ctx, doc);
  if (!text) return null;
  const previous = await ctx.db
    .query("projectDocumentTextVersions")
    .withIndex("by_documentId_and_version", (q) => q.eq("documentId", doc._id))
    .order("desc")
    .first();
  const versionId = await ctx.db.insert("projectDocumentTextVersions", {
    documentId: doc._id,
    projectId: doc.projectId,
    version: (previous?.version ?? 0) + 1,
    textHash: await sha256(text),
    textLength: text.length,
    ...(doc.textFormat ? { textFormat: doc.textFormat } : {}),
    // The reader that wrote this text, not the latest attempt (live check).
    ...(doc.textReader ? { reader: doc.textReader } : {}),
    why,
    keptAt: now,
  });
  let at = 0;
  for (const end of documentTextPieceEnds(text)) {
    await ctx.db.insert("projectDocumentTextVersionPieces", { versionId, projectId: doc.projectId, start: at, text: text.slice(at, end) });
    at = end;
  }
  return versionId;
}

/**
 * Whether one of a file's kept versions holds exactly `text` (B1 review): an
 * upload retried after the file's text was replaced still finds its file.
 */
export async function documentKeptVersionEquals(
  ctx: QueryCtx,
  documentId: Id<"projectDocuments">,
  text: string
): Promise<boolean> {
  const versions = await ctx.db
    .query("projectDocumentTextVersions")
    .withIndex("by_documentId_and_version", (q) => q.eq("documentId", documentId))
    .take(20);
  if (versions.length === 0) return false;
  const hash = await sha256(text);
  return versions.some((version) => version.textHash === hash && version.textLength === text.length);
}

/** A kept version's text, whole (B1). */
export async function readDocumentTextVersion(
  ctx: QueryCtx,
  versionId: Id<"projectDocumentTextVersions">
): Promise<string> {
  const pieces = await ctx.db
    .query("projectDocumentTextVersionPieces")
    .withIndex("by_versionId_and_start", (q) => q.eq("versionId", versionId))
    .take(MAX_DOCUMENT_TEXT_PIECES + 1);
  if (pieces.length > MAX_DOCUMENT_TEXT_PIECES) throw new Error("Document text version has too many pieces");
  return pieces.map((piece) => piece.text).join("");
}

/** Deletes every kept version of a file and its text: only when the file itself is deleted (B1). */
export async function deleteDocumentTextVersions(
  ctx: MutationCtx,
  documentId: Id<"projectDocuments">
): Promise<void> {
  // In batches until none are left (review: not only the first 100).
  for (;;) {
    const versions = await ctx.db
      .query("projectDocumentTextVersions")
      .withIndex("by_documentId_and_version", (q) => q.eq("documentId", documentId))
      .take(100);
    for (const version of versions) {
      for (;;) {
        const pieces = await ctx.db
          .query("projectDocumentTextVersionPieces")
          .withIndex("by_versionId_and_start", (q) => q.eq("versionId", version._id))
          .take(MAX_DOCUMENT_TEXT_PIECES);
        for (const piece of pieces) await ctx.db.delete(piece._id);
        if (pieces.length < MAX_DOCUMENT_TEXT_PIECES) break;
      }
      await ctx.db.delete(version._id);
    }
    if (versions.length < 100) break;
  }
}

/** Deletes a file's text pieces. */
export async function deleteDocumentText(
  ctx: MutationCtx,
  documentId: Id<"projectDocuments">
): Promise<void> {
  // In batches until none are left, so a file with more pieces than
  // expected can still be deleted.
  for (;;) {
    const pieces = await ctx.db
      .query("projectDocumentTexts")
      .withIndex("by_documentId_and_start", (q) => q.eq("documentId", documentId))
      .take(MAX_DOCUMENT_TEXT_PIECES);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length < MAX_DOCUMENT_TEXT_PIECES) break;
  }
  // 2026-10-26 (Phase B4): its search pieces go with its text, so a removed
  // file, or text being replaced, is never found by a search.
  await deleteSearchPiecesOf(ctx, documentId);
}

/** A file's search pieces (documentSearchPieces), deleted. */
export async function deleteSearchPiecesOf(ctx: MutationCtx, documentId: Id<"projectDocuments">): Promise<void> {
  for (;;) {
    const pieces = await ctx.db
      .query("documentSearchPieces")
      .withIndex("by_documentId_and_order", (q) => q.eq("documentId", documentId))
      .take(500);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length < 500) return;
  }
}

/**
 * The project's file with this name and exactly this text, as the upload
 * dedupe found it by comparing every file's text. A moved file is found by
 * its fingerprint; a file whose text has not moved yet (no fingerprint) is
 * compared by its text, so until the backfill finishes those still cost a
 * full read.
 */
export async function findDocumentWithText(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  fileName: string,
  text: string
): Promise<Doc<"projectDocuments"> | null> {
  const hash = await sha256(text);
  for await (const doc of ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId_and_textHash", (q) => q.eq("projectId", projectId).eq("textHash", hash))) {
    if (doc.fileName === fileName && documentTextMoved(doc) && doc.textLength === text.length) return doc;
  }
  for await (const doc of ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId_and_textHash", (q) => q.eq("projectId", projectId).eq("textHash", undefined))) {
    if (doc.fileName === fileName && !documentTextMoved(doc) && (doc.content ?? "") === text) return doc;
  }
  return null;
}

/**
 * The project's files a full text search finds, best first, at most `files`
 * of them (archived ones included, as the old index returned them). Pieces
 * are grouped by file, best piece first; while files are still moving, the
 * old index on `content` adds the files whose text has not moved, and a file
 * both return is listed once. A piece whose file is gone or in another
 * project is dropped.
 */
export async function searchProjectDocuments(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  search: string,
  files: number,
  budget: DocumentReadBudget = UNBOUNDED_READS,
  /** The matching pieces' own budget, so row loads always have room left. */
  pieceBudget: DocumentReadBudget = budget
): Promise<Doc<"projectDocuments">[]> {
  const pieces = await pieceBudget.list(
    untilDistinctDocuments(
      ctx.db
        .query("projectDocumentTexts")
        .withSearchIndex("search_text", (q) => q.search("text", search).eq("projectId", projectId)),
      files
    ),
    searchPieceCap(files)
  );
  const unmoved = await budget.list(
    ctx.db
      .query("projectDocuments")
      .withSearchIndex("search_content", (q) => q.search("content", search).eq("projectId", projectId)),
    files
  );
  const byId = new Map(unmoved.rows.map((doc) => [doc._id, doc] as const));
  const found: Doc<"projectDocuments">[] = [];
  for (const documentId of new Set([...pieces.rows.map((piece) => piece.documentId), ...unmoved.rows.map((doc) => doc._id)])) {
    if (found.length >= files) break;
    let doc = byId.get(documentId) ?? null;
    if (!doc) {
      const loaded = await budget.read(() => ctx.db.get(documentId));
      if (!loaded.ok) break;
      doc = loaded.value;
    }
    if (doc && doc.projectId === projectId) found.push(doc);
  }
  return found;
}

/**
 * The read budget a search may take (documentReadBudget in
 * convex/chatDocuments.ts has this shape).
 */
export type DocumentReadBudget = {
  read<T>(fn: () => Promise<T>, extraBytes?: number): Promise<{ ok: true; value: T } | { ok: false }>;
  list<T>(source: AsyncIterable<T>, cap: number): Promise<{ rows: T[]; complete: boolean }>;
};

/** No budget: reads as many rows as asked for. */
const UNBOUNDED_READS: DocumentReadBudget = {
  async read(fn) {
    return { ok: true, value: await fn() };
  },
  async list(source, cap) {
    const rows = [];
    for await (const row of source) {
      if (rows.length >= cap) return { rows, complete: false };
      rows.push(row);
    }
    return { rows, complete: true };
  },
};

/**
 * Pieces a search reads for `files` files: enough to pass one file whose
 * every piece matches, so a long file cannot take every file slot.
 */
export function searchPieceCap(files: number): number {
  return files * 3 + MAX_DOCUMENT_TEXT_PIECES;
}

/** Search hits until they name `files` different files. */
export async function* untilDistinctDocuments<Piece extends { documentId: Id<"projectDocuments"> }>(
  source: AsyncIterable<Piece>,
  files: number
): AsyncGenerator<Piece> {
  const seen = new Set<string>();
  for await (const piece of source) {
    yield piece;
    seen.add(piece.documentId);
    if (seen.size >= files) return;
  }
}

/**
 * Step 4 (the copy pass) for one file not yet moved: writes its pieces from
 * `content` and returns the fields the row takes (its facts, and the
 * processing status `deriveStatus` gives when the row has none). The row
 * keeps `content`.
 */
export async function copyRowTextToPieces(
  ctx: MutationCtx,
  doc: Doc<"projectDocuments">,
  deriveStatus: (text: string) => Pick<Doc<"projectDocuments">, "processingStatus" | "processingDetail">,
  now = Date.now()
): Promise<Partial<Doc<"projectDocuments">>> {
  const text = doc.content ?? "";
  const facts = await writeDocumentText(ctx, doc, text, now, { storedText: true });
  return { ...facts, ...(doc.processingStatus ? {} : deriveStatus(text)) };
}

/** Whether a moved file still holds the copy of its text on the row. */
export function documentKeepsRowText(doc: Pick<Doc<"projectDocuments">, "content" | "textMovedAt">): boolean {
  return documentTextMoved(doc) && doc.content !== undefined;
}

/**
 * Step 5 (the clear pass) for one moved file: whether its pieces read back
 * exactly the text on its row, with the stored fingerprint, so `content`
 * may be cleared. Missing or different pieces answer false.
 */
export async function piecesMatchRowText(ctx: QueryCtx, doc: Doc<"projectDocuments">): Promise<boolean> {
  if (!documentKeepsRowText(doc)) return false;
  const pieces = await readDocumentText(ctx, doc).catch(() => null);
  return pieces !== null && pieces === doc.content && (await sha256(pieces)) === doc.textHash;
}
