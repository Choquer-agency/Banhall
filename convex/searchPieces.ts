/**
 * Search pieces of project files (2026-10-26, context pipeline plan Phase
 * B4). Every text write marks its file due (`searchPiecesDue`); a sweep
 * every minute indexes due files (convex/ai/searchIndexing.ts reads a PDF's
 * page starts, then `writeSearchPieces` writes the pieces). A piece records
 * the fingerprint of the text it was cut from, and search drops any piece
 * whose file's text has changed since, so a search never returns positions
 * into older text. No AI writes any of this.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { insertSearchPieces, searchProjectPieces } from "./lib/searchPieces";
import { labelsCurrent } from "./lib/fileLabels";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deleteSearchPiecesOf, documentHasText, documentTextHash, readDocumentText } from "./lib/documentText";
import { isProjectDeleting } from "./lib/projectDeletion";
import { SEARCH_PIECES_VERSION, type PieceTextKind } from "../shared/searchPieces";
import { MAX_UPLOAD_BYTES } from "./lib/storage";
import { textCopyPending } from "./lib/projectCopy";

/** A claim older than this was stopped; the sweep may claim the file again. */
export const SEARCH_INDEX_CLAIM_MS = 10 * 60_000;
/** Waits before the 2nd, 3rd and 4th try; after the 4th failure the file leaves the queue. */
export const SEARCH_INDEX_RETRY_DELAYS_MS = [60_000, 10 * 60_000, 60 * 60_000] as const;
/** Bytes one sweep may read: a row that still holds its own text is heavy. */
const SWEEP_PAGE_BYTES = 4 * 1024 * 1024;
/** Files one sweep starts, spaced so a large import does not start at once. */
const SWEEP_FILES = 40;
const SWEEP_SPACING_MS = 1_500;

/** The kind of text, which decides the structure markers that count. */
export function pieceTextKind(
  doc: Pick<Doc<"projectDocuments"> | Doc<"companyFiles">, "fileName" | "fileType" | "textFormat">
): PieceTextKind {
  if (doc.textFormat === "markdown") return "markdown";
  const name = doc.fileName.toLowerCase();
  if (doc.fileType === "pdf" || name.endsWith(".pdf")) return "pdf";
  if (doc.fileType === "xlsx" || /\.(xlsx|xls|csv)$/.test(name)) return "spreadsheet";
  if (doc.fileType === "eml" || doc.fileType === "msg" || /\.(eml|msg|mbox)$/.test(name)) return "email";
  return "text";
}

/**
 * Starts the due files' indexing, a few at a time (crons.ts, every minute):
 * the files whose next try has come, oldest first, project files before
 * company files. Claiming one moves its next try on by
 * SEARCH_INDEX_CLAIM_MS, so a stopped indexing is tried
 * again then and never holds a place in the queue.
 */
export const sweepDueSearchPieces = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const now = Date.now();
    const { page: due } = await ctx.db
      .query("projectDocuments")
      .withIndex("by_searchPiecesDue_and_searchPiecesNextAt", (q) =>
        q.eq("searchPiecesDue", true).lte("searchPiecesNextAt", now)
      )
      .paginate({ numItems: SWEEP_FILES, cursor: null, maximumBytesRead: SWEEP_PAGE_BYTES });
    for (const [started, doc] of due.entries()) {
      await ctx.db.patch(doc._id, { searchPiecesNextAt: now + SEARCH_INDEX_CLAIM_MS });
      await ctx.scheduler.runAfter(started * SWEEP_SPACING_MS, internal.ai.searchIndexing.indexDocument, {
        documentId: doc._id,
      });
    }
    // Company files (Phase C) take the places project files left.
    const room = SWEEP_FILES - due.length;
    if (room <= 0) return due.length;
    const companyDue = await ctx.db
      .query("companyFiles")
      .withIndex("by_searchPiecesDue_and_searchPiecesNextAt", (q) =>
        q.eq("searchPiecesDue", true).lte("searchPiecesNextAt", now)
      )
      .take(room);
    for (const [index, file] of companyDue.entries()) {
      await ctx.db.patch(file._id, { searchPiecesNextAt: now + SEARCH_INDEX_CLAIM_MS });
      await ctx.scheduler.runAfter((due.length + index) * SWEEP_SPACING_MS, internal.ai.searchIndexing.indexCompanyFile, {
        companyFileId: file._id,
      });
    }
    return due.length + companyDue.length;
  },
});

/**
 * A failed cut (damaged text pieces, a reader that crashed): tried again
 * after a wait, then the file leaves the queue after four tries; the next
 * text write or the backfill puts it back.
 */
export const failSearchPieces = internalMutation({
  args: { documentId: v.id("projectDocuments"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    const attempts = (doc.searchPiecesAttempts ?? 0) + 1;
    const wait = SEARCH_INDEX_RETRY_DELAYS_MS[attempts - 1];
    if (wait === undefined) {
      console.warn(`searchPieces: ${doc._id} left without pieces after ${attempts} tries (${args.reason})`);
      await ctx.db.patch(doc._id, { searchPiecesDue: undefined, searchPiecesNextAt: undefined, searchPiecesAttempts: attempts });
    } else {
      await ctx.db.patch(doc._id, { searchPiecesAttempts: attempts, searchPiecesNextAt: Date.now() + wait });
    }
    return null;
  },
});

/** A due file with nothing to index any more (its project is being erased) leaves the queue. */
export const retireSearchPieces = internalMutation({
  args: { documentId: v.id("projectDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (doc && (await isProjectDeleting(ctx, doc.projectId))) {
      await ctx.db.patch(doc._id, { searchPiecesDue: undefined, searchPiecesNextAt: undefined });
    }
    return null;
  },
});

/** What indexing one file needs, or null when it is gone or its project is being erased. */
export const fileToIndex = internalQuery({
  args: { documentId: v.id("projectDocuments") },
  returns: v.union(
    v.null(),
    v.object({
      textHash: v.string(),
      kind: v.string(),
      /** A PDF's stored original, to read its page starts from. */
      original: v.optional(v.object({ storageId: v.id("_storage"), fileName: v.string() })),
    })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || textCopyPending(doc) || (await isProjectDeleting(ctx, doc.projectId))) return null;
    const kind = pieceTextKind(doc);
    let original: { storageId: Id<"_storage">; fileName: string } | undefined;
    if (kind === "pdf" && doc.storageId && documentHasText(doc)) {
      const stored = await ctx.db.system.get(doc.storageId);
      if (stored && stored.size <= MAX_UPLOAD_BYTES) original = { storageId: doc.storageId, fileName: doc.fileName };
    }
    return { textHash: await documentTextHash(doc), kind, ...(original ? { original } : {}) };
  },
});

/** A file's whole stored text, to compare with a fresh reading of its PDF. */
export const storedTextToIndex = internalQuery({
  args: { documentId: v.id("projectDocuments"), textHash: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || (await documentTextHash(doc)) !== args.textHash) return null;
    return await readDocumentText(ctx, doc);
  },
});

/**
 * Replaces a file's pieces with the pieces of its current text. Nothing is
 * written when the file is gone, its project is being erased, or its text
 * changed after the indexing started (the next sweep indexes the new text).
 */
export const writeSearchPieces = internalMutation({
  args: {
    documentId: v.id("projectDocuments"),
    textHash: v.string(),
    pageStarts: v.optional(v.array(v.number())),
  },
  returns: v.union(v.literal("written"), v.literal("changed")),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return "changed";
    if (await isProjectDeleting(ctx, doc.projectId)) {
      await ctx.db.patch(doc._id, { searchPiecesDue: undefined, searchPiecesNextAt: undefined });
      return "changed";
    }
    // New text arrived meanwhile: it is due again, at once.
    if ((await documentTextHash(doc)) !== args.textHash) {
      await ctx.db.patch(doc._id, { searchPiecesDue: true, searchPiecesNextAt: 0, searchPiecesAttempts: undefined });
      return "changed";
    }
    await deleteSearchPiecesOf(ctx, doc._id);
    const text = documentHasText(doc) ? await readDocumentText(ctx, doc) : "";
    await insertSearchPieces(ctx, { documentId: doc._id, projectId: doc.projectId }, text, {
      kind: pieceTextKind(doc),
      textHash: args.textHash,
      ...(doc.textFormat ? { textFormat: doc.textFormat } : {}),
      ...(args.pageStarts ? { pageStarts: args.pageStarts } : {}),
    });
    await ctx.db.patch(doc._id, {
      searchPiecesTextHash: args.textHash,
      searchPiecesVersion: SEARCH_PIECES_VERSION,
      searchPiecesDue: undefined,
      searchPiecesNextAt: undefined,
      searchPiecesAttempts: undefined,
      // Labels describe a text; new text gets new labels (convex/fileLabels.ts).
      ...(text.trim() && !doc.archived && !labelsCurrent(doc, args.textHash)
        ? { labelsDue: true as const, labelsNextAt: 0, labelsAttempts: undefined }
        : {}),
    });
    return "written";
  },
});

/**
 * Search one project's files by keyword (for Phase D's drafting and chat
 * tools): pieces best first, at most two of a file, each with the text
 * fingerprint its positions refer to.
 */
export const searchProject = internalQuery({
  args: {
    projectId: v.id("projects"),
    query: v.string(),
    limit: v.optional(v.number()),
    perFile: v.optional(v.number()),
  },
  handler: async (ctx, args) => await searchProjectPieces(ctx, args),
});

/** Files one page of the backfill looks at, and the bytes it may read. */
const BACKFILL_PAGE = 100;
const BACKFILL_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * One-off pass, run by hand (dev first, then production): marks every file
 * with text that has no current pieces as due, a page at a time; the sweep
 * then cuts them. `dryRun` only counts; the last page logs the total.
 */
export const markSearchPiecesDue = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    markedSoFar: v.optional(v.number()),
  },
  returns: v.object({ marked: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projectDocuments")
      .paginate({ numItems: BACKFILL_PAGE, cursor: args.cursor ?? null, maximumBytesRead: BACKFILL_PAGE_BYTES });
    let marked = args.markedSoFar ?? 0;
    for (const doc of page.page) {
      // F2: a file still being copied has no text yet; its copy sets it due.
      if (textCopyPending(doc) || !documentHasText(doc) || doc.searchPiecesDue) continue;
      if (doc.searchPiecesVersion === SEARCH_PIECES_VERSION && doc.searchPiecesTextHash === (await documentTextHash(doc))) continue;
      if (!args.dryRun) await ctx.db.patch(doc._id, { searchPiecesDue: true, searchPiecesNextAt: 0, searchPiecesAttempts: undefined });
      marked += 1;
    }
    const verb = args.dryRun ? "would mark" : "marked";
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.searchPieces.markSearchPiecesDue, {
        cursor: page.continueCursor,
        ...(args.dryRun ? { dryRun: true } : {}),
        markedSoFar: marked,
      });
    } else {
      console.info(`markSearchPiecesDue: ${verb} ${marked} files in all`);
    }
    return { marked, isDone: page.isDone };
  },
});
