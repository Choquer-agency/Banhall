import type { MutationCtx, QueryCtx } from "../_generated/server";
import { documentTextPieceEnds } from "./documentText";
import type { Doc, Id } from "../_generated/dataModel";
import type { ReadCounter } from "./readMeter";

/**
 * B1, second part (2026-10-27): the one way to read the text a draft row
 * (`generationSources`) froze.
 *
 * A row written before the change holds its own copy (`content`). A new
 * project file or company file row refers to a stored text version
 * (`textVersionId`), and a new transcript row to its transcript, with how
 * many characters it read (`textLength`). The writer hashes the text once;
 * a reader checks the stored version's fingerprint and length against the
 * row, and a transcript's own fingerprint when the row read all of it, and
 * refuses any difference by name. It never returns other text.
 */

type Db = { db: QueryCtx["db"] };

/** The fields a row's text is read from. */
export type SourceTextRow = Pick<
  Doc<"generationSources">,
  "_id" | "kind" | "contentHash" | "content" | "textVersionId" | "textLength" | "transcriptId"
>;

/** A draft row in the shape every reader has always seen: its text on it. */
export type SourceRowWithText<T extends SourceTextRow = Doc<"generationSources">> = Omit<
  T,
  "content" | "textVersionId" | "textLength"
> & { content: string };

/** The stored text does not match what the row says it read. */
export class SourceTextMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceTextMismatchError";
  }
}

async function versionText(ctx: Db, row: SourceTextRow, meter?: ReadCounter): Promise<string> {
  const version = row.textVersionId ? await ctx.db.get(row.textVersionId) : null;
  meter?.read(version);
  if (!version) throw new SourceTextMismatchError(`Draft source ${row._id}: its text version is gone`);
  if (version.textHash !== row.contentHash || (row.textLength !== undefined && version.textLength !== row.textLength)) {
    throw new SourceTextMismatchError(`Draft source ${row._id}: its text version does not match the row`);
  }
  let text = "";
  for await (const piece of ctx.db
    .query("sourceTextVersionPieces")
    .withIndex("by_versionId_and_start", (q) => q.eq("versionId", version._id))
    .order("asc")) {
    meter?.read(piece);
    if (piece.start !== text.length) throw new SourceTextMismatchError(`Draft source ${row._id}: a piece of its text is missing`);
    text += piece.text;
  }
  if (text.length !== version.textLength) throw new SourceTextMismatchError(`Draft source ${row._id}: its text is incomplete`);
  return text;
}

async function transcriptText(ctx: Db, row: SourceTextRow, meter?: ReadCounter): Promise<string> {
  const transcript = row.transcriptId ? await ctx.db.get(row.transcriptId) : null;
  // The whole transcript is read, however little of it the row used.
  meter?.read(transcript);
  const length = row.textLength;
  if (!transcript || length === undefined) throw new SourceTextMismatchError(`Draft source ${row._id}: its transcript is gone`);
  if (transcript.content.length < length) throw new SourceTextMismatchError(`Draft source ${row._id}: its transcript is shorter than it read`);
  if (transcript.content.length === length && transcript.contentHash !== undefined && transcript.contentHash !== row.contentHash) {
    throw new SourceTextMismatchError(`Draft source ${row._id}: its transcript does not match the row`);
  }
  return transcript.content.slice(0, length);
}

/** The whole text a draft row read; `meter` is told of every document read for it. */
export async function sourceRowText(ctx: Db, row: SourceTextRow, meter?: ReadCounter): Promise<string> {
  if (row.content !== undefined) return row.content;
  if (row.textVersionId) return await versionText(ctx, row, meter);
  if (row.kind === "transcript" && row.transcriptId) return await transcriptText(ctx, row, meter);
  throw new SourceTextMismatchError(`Draft source ${row._id}: it holds no text and refers to none`);
}

/**
 * Characters [start, end) of a row's text, reading only the pieces they
 * fall in (for a quote check that needs a part; today every reader reads
 * the whole text). The pieces read must join without a gap and reach `to`,
 * or it refuses by name, as the whole-text reader does.
 */
export async function sourceRowSlice(ctx: Db, row: SourceTextRow, start: number, end: number): Promise<string> {
  if (row.content !== undefined) return row.content.slice(start, end);
  if (!row.textVersionId) return (await sourceRowText(ctx, row)).slice(start, end);
  const version = await ctx.db.get(row.textVersionId);
  if (
    !version ||
    version.textHash !== row.contentHash ||
    (row.textLength !== undefined && version.textLength !== row.textLength)
  ) {
    throw new SourceTextMismatchError(`Draft source ${row._id}: its text version does not match the row`);
  }
  const to = Math.min(Math.max(end, start), version.textLength);
  if (start >= to) return "";
  // The pieces from the last one starting at or before `start` up to `to`.
  const pieces: Doc<"sourceTextVersionPieces">[] = [];
  for await (const piece of ctx.db
    .query("sourceTextVersionPieces")
    .withIndex("by_versionId_and_start", (q) => q.eq("versionId", version._id).lt("start", to))
    .order("desc")) {
    pieces.unshift(piece);
    if (piece.start <= start) break;
  }
  const first = pieces[0];
  if (!first || first.start > start) throw new SourceTextMismatchError(`Draft source ${row._id}: a piece of its text is missing`);
  let joined = "";
  for (const piece of pieces) {
    if (piece.start !== first.start + joined.length) throw new SourceTextMismatchError(`Draft source ${row._id}: a piece of its text is missing`);
    joined += piece.text;
  }
  if (first.start + joined.length < to) throw new SourceTextMismatchError(`Draft source ${row._id}: its text is incomplete`);
  return joined.slice(start - first.start, to - first.start);
}

/** A row in the old shape, its text on it and the new fields left out. */
export async function withSourceText<T extends SourceTextRow>(ctx: Db, row: T): Promise<SourceRowWithText<T>> {
  const { textVersionId: _version, textLength: _length, ...rest } = row;
  void _version;
  void _length;
  return { ...rest, content: await sourceRowText(ctx, row) } as SourceRowWithText<T>;
}

/** Rows in the old shape, in order. */
export async function withSourceTexts<T extends SourceTextRow>(ctx: Db, rows: readonly T[]): Promise<Array<SourceRowWithText<T>>> {
  const out: Array<SourceRowWithText<T>> = [];
  for (const row of rows) out.push(await withSourceText(ctx, row));
  return out;
}

/** One draft row by id, in the old shape, or null. */
export async function getSourceRowWithText(
  ctx: Db,
  id: Id<"generationSources">
): Promise<SourceRowWithText | null> {
  const row = await ctx.db.get(id);
  return row ? await withSourceText(ctx, row) : null;
}

/** How many characters a draft row read, without reading its text. */
export function sourceRowLength(row: Pick<SourceTextRow, "_id" | "content" | "textLength">): number {
  if (row.content !== undefined) return row.content.length;
  if (row.textLength !== undefined) return row.textLength;
  throw new SourceTextMismatchError(`Draft source ${row._id}: it records no length`);
}

/** Whose stored text a version is: a project file's, or a company file's. */
export type SourceTextOwner =
  | { projectId: Id<"projects"> }
  | { companyFileId: Id<"companyFiles">; clientId?: Id<"clients"> };

/**
 * The stored version of exactly this text for this owner, written once: an
 * existing one with the same fingerprint and length is reused, else the
 * text is stored in pieces. Returns how many UTF-8 bytes it wrote (0 when
 * reused), for the caller's write budget. The text is the caller's
 * already-checked frozen text; `textHash` is its SHA-256.
 */
export async function storedSourceTextVersion(
  ctx: { db: MutationCtx["db"] },
  owner: SourceTextOwner,
  text: string,
  textHash: string
): Promise<{ versionId: Id<"sourceTextVersions">; writtenBytes: number }> {
  const existing =
    "projectId" in owner
      ? await ctx.db
          .query("sourceTextVersions")
          .withIndex("by_projectId_and_textHash", (q) => q.eq("projectId", owner.projectId).eq("textHash", textHash))
          .first()
      : await ctx.db
          .query("sourceTextVersions")
          .withIndex("by_companyFileId_and_textHash", (q) => q.eq("companyFileId", owner.companyFileId).eq("textHash", textHash))
          .first();
  if (existing && existing.textLength === text.length) return { versionId: existing._id, writtenBytes: 0 };
  const textBytes = new TextEncoder().encode(text).byteLength;
  const versionId = await ctx.db.insert("sourceTextVersions", {
    ...owner,
    textHash,
    textLength: text.length,
    textBytes,
    createdAt: Date.now(),
  });
  const pieceOwner = "projectId" in owner ? { projectId: owner.projectId } : { companyFileId: owner.companyFileId };
  let start = 0;
  for (const end of documentTextPieceEnds(text)) {
    await ctx.db.insert("sourceTextVersionPieces", { versionId, ...pieceOwner, start, text: text.slice(start, end) });
    start = end;
  }
  return { versionId, writtenBytes: textBytes };
}
