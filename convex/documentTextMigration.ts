/**
 * 2026-10-22 (fourth), steps 4 and 5: move existing project files' text to
 * `projectDocumentTexts`. Run by hand on dev, then production, never on a
 * schedule:
 *
 *   npx convex run documentTextMigration:documentTextMoveStatus '{}'
 *   npx convex run documentTextMigration:backfillDocumentTexts '{"dryRun":true}'
 *   npx convex run documentTextMigration:backfillDocumentTexts '{}'
 *   (check the status until every file is moved)
 *   npx convex run documentTextMigration:clearMovedDocumentContent '{"dryRun":true}'
 *   npx convex run documentTextMigration:clearMovedDocumentContent '{}'
 *
 * The copy pass keeps `content`, so readers can fall back until the clear
 * pass. Each pass reads at most MIGRATION_PAGE_MAX_BYTES_READ of rows a page,
 * skips projects being deleted and schedules its own next page; a dry run
 * reports one page and writes nothing. Both are safe to run twice.
 */
import { v } from "convex/values";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { deriveStoredProcessing } from "../shared/documentStatus";
import {
  copyRowTextToPieces,
  documentKeepsRowText,
  documentTextMoved,
  piecesMatchRowText,
} from "./lib/documentText";
import { isProjectDeleting } from "./lib/projectDeletion";

/** Files per page; pages are also bounded by bytes read. */
const MIGRATION_PAGE_SIZE = 25;
/**
 * A page writes about what it reads (the pieces, then the row rewritten) and
 * the clear pass reads the pieces too, so 4 MiB keeps both under 16 MiB.
 */
const MIGRATION_PAGE_MAX_BYTES_READ = 4 * 1024 * 1024;

const pageArgs = {
  cursor: v.optional(v.union(v.string(), v.null())),
  pageSize: v.optional(v.number()),
  dryRun: v.optional(v.boolean()),
};
type PageArgs = { cursor?: string | null; pageSize?: number; dryRun?: boolean };

// Typed by hand: these functions are new, and api.d.ts lists them after codegen.
const backfillRef = makeFunctionReference<"mutation">(
  "documentTextMigration:backfillDocumentTexts"
) as unknown as FunctionReference<"mutation", "internal", PageArgs>;
const clearRef = makeFunctionReference<"mutation">(
  "documentTextMigration:clearMovedDocumentContent"
) as unknown as FunctionReference<"mutation", "internal", PageArgs>;

const pageSizeOf = (args: PageArgs) =>
  Math.min(Math.max(1, Math.floor(args.pageSize ?? MIGRATION_PAGE_SIZE)), MIGRATION_PAGE_SIZE);

/**
 * Step 4, the copy pass: for each file not yet moved, write its pieces and
 * the facts about its text, and its processing status if it has none. The
 * row keeps `content`.
 */
export const backfillDocumentTexts = internalMutation({
  args: pageArgs,
  returns: v.object({
    scanned: v.number(),
    moved: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const pageSize = pageSizeOf(args);
    const page = await ctx.db.query("projectDocuments").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
      maximumBytesRead: MIGRATION_PAGE_MAX_BYTES_READ,
    });
    const now = Date.now();
    let moved = 0;
    for (const doc of page.page) {
      if (documentTextMoved(doc)) continue;
      if (await isProjectDeleting(ctx, doc.projectId)) continue;
      moved += 1;
      if (args.dryRun) continue;
      const fields = await copyRowTextToPieces(ctx, doc, (text) => {
        const derived = deriveStoredProcessing({ fileName: doc.fileName, content: text });
        return { processingStatus: derived.status, processingDetail: derived.detail ?? undefined };
      }, now);
      await ctx.db.patch(doc._id, fields);
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, backfillRef, {
        cursor: page.continueCursor,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      });
    }
    return { scanned: page.page.length, moved, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/**
 * Step 5, the clear pass, run only after the copy pass is checked: for each
 * moved file that still holds `content`, clear it when its pieces read back
 * exactly that text with the stored fingerprint. A file whose pieces differ
 * is left as it is and counted.
 */
export const clearMovedDocumentContent = internalMutation({
  args: pageArgs,
  returns: v.object({
    scanned: v.number(),
    cleared: v.number(),
    mismatched: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const pageSize = pageSizeOf(args);
    const page = await ctx.db.query("projectDocuments").paginate({
      cursor: args.cursor ?? null,
      numItems: pageSize,
      maximumBytesRead: MIGRATION_PAGE_MAX_BYTES_READ,
    });
    let cleared = 0;
    let mismatched = 0;
    for (const doc of page.page) {
      if (!documentKeepsRowText(doc)) continue;
      if (await isProjectDeleting(ctx, doc.projectId)) continue;
      if (!(await piecesMatchRowText(ctx, doc))) {
        mismatched += 1;
        console.warn(`clearMovedDocumentContent: ${doc._id} pieces differ from its content; left as it is`);
        continue;
      }
      cleared += 1;
      if (!args.dryRun) await ctx.db.patch(doc._id, { content: undefined });
    }
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, clearRef, {
        cursor: page.continueCursor,
        ...(args.pageSize !== undefined ? { pageSize } : {}),
      });
    }
    return {
      scanned: page.page.length,
      cleared,
      mismatched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** Counts for one page of files, to check the move: run it page by page. */
export const documentTextMoveStatus = internalQuery({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({
    scanned: v.number(),
    unmoved: v.number(),
    movedKeepingContent: v.number(),
    movedAndCleared: v.number(),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("projectDocuments").paginate({
      cursor: args.cursor ?? null,
      numItems: MIGRATION_PAGE_SIZE,
      maximumBytesRead: MIGRATION_PAGE_MAX_BYTES_READ,
    });
    let unmoved = 0;
    let movedKeepingContent = 0;
    let movedAndCleared = 0;
    for (const doc of page.page) {
      if (!documentTextMoved(doc)) unmoved += 1;
      else if (documentKeepsRowText(doc)) movedKeepingContent += 1;
      else movedAndCleared += 1;
    }
    return {
      scanned: page.page.length,
      unmoved,
      movedKeepingContent,
      movedAndCleared,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});
