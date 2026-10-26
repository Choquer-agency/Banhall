/**
 * Searching project files' search pieces within one project (2026-10-26,
 * context pipeline plan Phase B4). Writing them is convex/searchPieces.ts;
 * deleting them goes with the file's text (lib/documentText.ts).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { documentTextHash } from "./documentText";

/** Convex full text search reads at most this many terms. */
const MAX_TERMS = 16;
const STOP_WORDS = new Set(
  "a an and are as at be but by for from has have in into is it its of on or that the their this to was were which with what when where who why how did does do we our you your they them not no".split(" ")
);

/**
 * The words a query searches by: lower case, no stop words, each once,
 * longest first (the rarer ones), at most 16, and a whole word last
 * (Convex matches the last term as a prefix).
 */
export function searchTerms(query: string): string[] {
  const words = (query.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'&.-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? [])
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
  const unique = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, MAX_TERMS);
  return unique;
}

export type PieceHit = {
  documentId: Id<"projectDocuments">;
  fileName: string;
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
};

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
  if (terms.length === 0) return { hits: [], complete: true };
  const scanned = await ctx.db
    .query("documentSearchPieces")
    .withSearchIndex("search_text", (q) => q.search("searchText", terms.join(" ")).eq("projectId", args.projectId))
    .take(Math.min(256, limit * 8));
  const files = new Map<string, { doc: Doc<"projectDocuments"> | null; textHash: string | null }>();
  const perFileCount = new Map<string, number>();
  const hits: PieceHit[] = [];
  for (const piece of scanned) {
    if (hits.length >= limit) break;
    let file = files.get(piece.documentId);
    if (!file) {
      const doc = await ctx.db.get(piece.documentId);
      file = { doc, textHash: doc ? await documentTextHash(doc) : null };
      files.set(piece.documentId, file);
    }
    const { doc, textHash } = file;
    if (!doc || doc.archived || doc.projectId !== args.projectId || textHash !== piece.textHash) continue;
    const count = perFileCount.get(piece.documentId) ?? 0;
    if (count >= perFile) continue;
    perFileCount.set(piece.documentId, count + 1);
    hits.push({
      documentId: piece.documentId,
      fileName: doc.fileName,
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
  return { hits, complete: notIndexed === null && scanned.length < 256 };
}
