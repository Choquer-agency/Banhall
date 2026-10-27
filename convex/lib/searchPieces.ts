/**
 * Search pieces (2026-10-26, context pipeline plan Phase B4): writing one
 * file's pieces, and searching a project's files or a company's files
 * (Phase C). The queues are convex/searchPieces.ts and
 * convex/companyFileWork.ts; deleting pieces goes with the file's text
 * (lib/documentText.ts, lib/companyFileText.ts).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { documentTextHash } from "./documentText";
import { SEARCH_PIECES_VERSION, checkedPageStarts, searchTextOf, splitSearchPieces, type PieceTextKind } from "../../shared/searchPieces";

/** Whose pieces: a project file in its project, or a company file in its company. */
export type PieceOwner =
  | { documentId: Id<"projectDocuments">; projectId: Id<"projects"> }
  | { companyFileId: Id<"companyFiles">; clientId: Id<"clients"> };

/**
 * Cuts a text into pieces and stores them for their owner. The caller has
 * deleted the owner's older pieces and checked that `textHash` is the
 * text's fingerprint. Returns how many pieces were written.
 */
export async function insertSearchPieces(
  ctx: MutationCtx,
  owner: PieceOwner,
  text: string,
  options: { kind: PieceTextKind; textHash: string; textFormat?: "markdown"; pageStarts?: number[] }
): Promise<number> {
  const pageStarts = options.kind === "pdf" ? checkedPageStarts(text, options.pageStarts) : null;
  const pieces = splitSearchPieces(text, { kind: options.kind, ...(pageStarts ? { pageStarts } : {}) });
  for (const [order, piece] of pieces.entries()) {
    const { prefixChars, searchText } = searchTextOf(text, piece, options.textFormat);
    await ctx.db.insert("documentSearchPieces", {
      ...owner,
      textHash: options.textHash,
      order,
      start: piece.start,
      end: piece.end,
      ...(piece.page !== undefined ? { page: piece.page, pageEnd: piece.pageEnd ?? piece.page } : {}),
      ...(piece.label ? { label: piece.label } : {}),
      searchText,
      prefixChars,
    });
  }
  return pieces.length;
}

/** Convex full text search reads at most this many terms. */
const MAX_TERMS = 16;
const STOP_WORDS = new Set(
  "a an and are as at be but by for from has have in into is it its of on or that the their this to was were which with what when where who why how did does do we our you your they them not no".split(" ")
);

/** Convex does not search by a term longer than this. */
const MAX_TERM_CHARS = 32;

/**
 * The words a query searches by, split the way Convex splits text (at
 * every character that is not a letter or digit, so "fluoro-polymer" is
 * two terms): lower case, no stop words, each once, longest first (the
 * rarer ones) kept, at most 16, the longest last.
 */
export function searchTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (word) => word.length > 1 && word.length <= MAX_TERM_CHARS && !STOP_WORDS.has(word)
  );
  // The 16 longest (rarest) words, then the longest last: Convex matches
  // the last term as a prefix, which a short word would match too widely.
  return [...new Set(words)]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TERMS)
    .reverse();
}

export type PieceHit = {
  documentId: Id<"projectDocuments">;
  fileName: string;
  /** The file's category and uploader role, for its trust label (Phase D). */
  category?: Doc<"projectDocuments">["category"];
  uploaderRole?: string;
  /** The text's fingerprint the positions refer to; a read must check it. */
  textHash: string;
  start: number;
  end: number;
  page?: number;
  pageEnd?: number;
  label?: string;
  /** The piece as the AI reads it (Word Markdown without its marks). */
  text: string;
};

export type PieceSearch = {
  hits: PieceHit[];
  /** False when files were not indexed yet or the read limit cut the search short. */
  complete: boolean;
  /** False only when the read limit cut the search short (Phase D: the caller covers unindexed files itself). */
  scanComplete: boolean;
};

/**
 * Whether a file's search pieces are its current text's, cut by the current
 * cutter (Phase D, step 1). Any other file with text is searched another
 * way: one waiting for its pieces, one whose pieces failed, or one from
 * before the backfill.
 */
export async function piecesCurrent(doc: Doc<"projectDocuments">): Promise<boolean> {
  return doc.searchPiecesVersion === SEARCH_PIECES_VERSION && doc.searchPiecesTextHash === (await documentTextHash(doc));
}

/**
 * The project's pieces a keyword search finds, best first: archived and
 * removed files and pieces cut from older text left out, at most
 * `perFile` pieces of one file, at most `limit` in all.
 */
export async function searchProjectPieces(
  ctx: QueryCtx,
  args: { projectId: Id<"projects">; query: string; limit?: number; perFile?: number }
): Promise<PieceSearch> {
  const terms = searchTerms(args.query);
  const limit = Math.max(1, Math.min(args.limit ?? 8, 50));
  const perFile = Math.max(1, args.perFile ?? 2);
  if (terms.length === 0) return { hits: [], complete: true, scanComplete: true };
  const scanCap = Math.min(256, limit * 8);
  const scanned = await ctx.db
    .query("documentSearchPieces")
    .withSearchIndex("search_text", (q) => q.search("searchText", terms.join(" ")).eq("projectId", args.projectId))
    .take(scanCap);
  const files = new Map<string, { doc: Doc<"projectDocuments"> | null; textHash: string | null }>();
  const perFileCount = new Map<string, number>();
  const hits: PieceHit[] = [];
  for (const piece of scanned) {
    if (hits.length >= limit) break;
    const documentId = piece.documentId;
    if (!documentId) continue;
    let file = files.get(documentId);
    if (!file) {
      const doc = await ctx.db.get(documentId);
      file = { doc, textHash: doc ? await documentTextHash(doc) : null };
      files.set(documentId, file);
    }
    const { doc, textHash } = file;
    if (!doc || doc.archived || doc.projectId !== args.projectId || textHash !== piece.textHash) continue;
    // Only a file whose pieces are current (`piecesCurrent`), so a caller
    // that searches every other file another way never sees one twice.
    if (doc.searchPiecesVersion !== SEARCH_PIECES_VERSION || doc.searchPiecesTextHash !== textHash) continue;
    const count = perFileCount.get(documentId) ?? 0;
    if (count >= perFile) continue;
    perFileCount.set(documentId, count + 1);
    hits.push({
      documentId,
      fileName: doc.fileName,
      ...(doc.category ? { category: doc.category } : {}),
      ...(doc.uploaderRole ? { uploaderRole: doc.uploaderRole } : {}),
      textHash: piece.textHash,
      start: piece.start,
      end: piece.end,
      ...(piece.page !== undefined ? { page: piece.page, pageEnd: piece.pageEnd ?? piece.page } : {}),
      ...(piece.label ? { label: piece.label } : {}),
      text: piece.searchText.slice(piece.prefixChars),
    });
  }
  const notIndexed = await ctx.db
    .query("projectDocuments")
    .withIndex("by_projectId_and_searchPiecesDue", (q) => q.eq("projectId", args.projectId).eq("searchPiecesDue", true))
    .first();
  // Complete when every match was read, or the hits asked for were found.
  const scanComplete = scanned.length < scanCap || hits.length >= limit;
  return { hits, complete: notIndexed === null && scanComplete, scanComplete };
}

export type CompanyPieceHit = Omit<PieceHit, "documentId"> & { companyFileId: Id<"companyFiles"> };

/**
 * A company's pieces a keyword search finds, best first (Phase C): only
 * files the company holds now, not archived, and pieces cut from their
 * current text; at most `perFile` pieces of one file, `limit` in all. The
 * caller has checked that the asking project belongs to this company.
 */
export async function searchCompanyPieces(
  ctx: QueryCtx,
  args: {
    clientId: Id<"clients">;
    query: string;
    limit?: number;
    perFile?: number;
    /** When set, only pieces of these files. */
    onlyFileIds?: ReadonlySet<Id<"companyFiles">>;
  }
): Promise<{ hits: CompanyPieceHit[]; complete: boolean }> {
  const terms = searchTerms(args.query);
  const limit = Math.max(1, Math.min(args.limit ?? 8, 50));
  const perFile = Math.max(1, args.perFile ?? 2);
  if (terms.length === 0) return { hits: [], complete: true };
  const scanCap = Math.min(256, limit * 8);
  const scanned = await ctx.db
    .query("documentSearchPieces")
    .withSearchIndex("search_text", (q) => q.search("searchText", terms.join(" ")).eq("clientId", args.clientId))
    .take(scanCap);
  const files = new Map<string, Doc<"companyFiles"> | null>();
  const perFileCount = new Map<string, number>();
  const hits: CompanyPieceHit[] = [];
  for (const piece of scanned) {
    if (hits.length >= limit) break;
    const companyFileId = piece.companyFileId;
    if (!companyFileId || (args.onlyFileIds && !args.onlyFileIds.has(companyFileId))) continue;
    let file = files.get(companyFileId);
    if (file === undefined) {
      file = await ctx.db.get(companyFileId);
      files.set(companyFileId, file);
    }
    // A file moved to another company by a merge keeps pieces under its
    // old company until they are cut again: never shown here.
    if (!file || file.archived || file.clientId !== args.clientId || file.textHash !== piece.textHash) continue;
    const count = perFileCount.get(companyFileId) ?? 0;
    if (count >= perFile) continue;
    perFileCount.set(companyFileId, count + 1);
    hits.push({
      companyFileId,
      fileName: file.fileName,
      textHash: piece.textHash,
      start: piece.start,
      end: piece.end,
      ...(piece.page !== undefined ? { page: piece.page, pageEnd: piece.pageEnd ?? piece.page } : {}),
      ...(piece.label ? { label: piece.label } : {}),
      text: piece.searchText.slice(piece.prefixChars),
    });
  }
  const notIndexed = await ctx.db
    .query("companyFiles")
    .withIndex("by_clientId_and_searchPiecesDue", (q) => q.eq("clientId", args.clientId).eq("searchPiecesDue", true))
    .first();
  return { hits, complete: notIndexed === null && (scanned.length < scanCap || hits.length >= limit) };
}
