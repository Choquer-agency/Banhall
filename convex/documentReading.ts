/**
 * A project file's text, read again on the server (2026-10-26, Phase B2).
 * The rules for when, and when the reading is kept, are in
 * convex/lib/serverReading.ts; the reading itself is
 * convex/ai/fileReading.ts. No AI writes any of this text.
 */
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { documentTextHash, keepDocumentTextVersion, readDocumentText, writeDocumentText } from "./lib/documentText";
import { requestBriefPreparation } from "./lib/briefPreparationTrigger";
import {
  documentHasReadText,
  needsServerReading,
  SERVER_READER_VERSION,
  serverReadingReplaces,
  wordBackfillText,
  wordWithoutMarkdown,
} from "./lib/serverReading";
import { isProjectDeleting } from "./lib/projectDeletion";

/**
 * Claims one file's reading for this reader version and says what to read,
 * or null when it needs none. A claim that is never finished (the reading
 * was stopped) keeps the file from being read again by this version.
 */
export const startServerReading = internalMutation({
  args: { documentId: v.id("projectDocuments") },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), fileName: v.string(), textHash: v.string(), bytes: v.number() })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc?.storageId || (await isProjectDeleting(ctx, doc.projectId))) return null;
    if (!needsServerReading({ ...doc, hasReadText: await documentHasReadText(ctx, doc) }, { wordMarkdownBackfill: true })) return null;
    const stored = await ctx.db.system.get(doc.storageId);
    if (!stored) return null;
    await ctx.db.patch(doc._id, { serverReader: SERVER_READER_VERSION, serverReadStartedAt: Date.now() });
    return {
      storageId: doc.storageId,
      fileName: doc.fileName,
      textHash: await documentTextHash(doc),
      bytes: stored.size,
    };
  },
});

/**
 * Finishes a claimed reading. The text is kept only for a file with nothing
 * read, when the server read something, and when the file has not changed
 * since the claim. A reader that failed (`failed`) releases the claim, so a
 * later pass may try again; any other outcome records the file as read.
 */
export const saveServerReading = internalMutation({
  args: {
    documentId: v.id("projectDocuments"),
    expectedTextHash: v.string(),
    text: v.string(),
    pageCount: v.optional(v.number()),
    reader: v.string(),
    failed: v.optional(v.boolean()),
    textFormat: v.optional(v.literal("markdown")),
  },
  returns: v.union(v.literal("kept"), v.literal("not_better"), v.literal("changed"), v.literal("failed")),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.archived || (await isProjectDeleting(ctx, doc.projectId))) return "changed";
    if ((await documentTextHash(doc)) !== args.expectedTextHash) return "changed";
    if (args.failed) {
      await ctx.db.patch(doc._id, { serverReadStartedAt: undefined });
      return "failed";
    }
    const now = Date.now();
    const storedHasReadText = await documentHasReadText(ctx, doc);
    // B1 (2026-10-26, owner's backfill): a Word file's Markdown reading
    // replaces the plain text it was stored with, keeping a previous-year
    // report's header and note, and only when it reads the same words and
    // was not cut shorter (review).
    const wordMarkdown = args.textFormat === "markdown" && wordWithoutMarkdown(doc);
    let text: string | null = args.text;
    if (wordMarkdown && storedHasReadText) text = wordBackfillText(await readDocumentText(ctx, doc), args.text);
    if (text === null || !serverReadingReplaces(storedHasReadText, text, wordMarkdown)) {
      await ctx.db.patch(doc._id, { serverReader: args.reader, serverReadAt: now });
      return "not_better";
    }
    // The text it had, even a stop line alone, is kept as an earlier
    // version, never lost (review); a file with no text keeps none.
    await keepDocumentTextVersion(ctx, doc, wordMarkdown ? "word_markdown" : "server_reading", now);
    const written = await writeDocumentText(ctx, doc, text, now);
    const derived = deriveProcessingStatus({ fileName: doc.fileName, content: text });
    await ctx.db.patch(doc._id, {
      ...written,
      // The pieces are the text now; a row that still held its own copy
      // (not yet moved, or moved and not yet cleared) drops it.
      content: undefined,
      processingStatus: derived.status,
      processingDetail: derived.detail,
      ...(args.pageCount !== undefined ? { pageCount: args.pageCount, pageCountStorageId: doc.storageId } : {}),
      textFormat: args.textFormat,
      serverReader: args.reader,
      textReader: args.reader,
      serverReadAt: now,
    });
    // Decision 65: readable new evidence may change the prepared Brief.
    await requestBriefPreparation(ctx, doc.projectId, { reason: "document_added" });
    return "kept";
  },
});

/** Bytes one page of the one-off pass may read: rows may still hold their text. */
const PASS_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * One-off pass, run by hand (dev first, then production): queues a server
 * reading for every file that needs one, a page at a time, spaced so the
 * readings do not all start at once. `dryRun` only counts; each page logs
 * its running total, and the last logs the whole count.
 */
export const queueServerReadings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    queuedSoFar: v.optional(v.number()),
  },
  returns: v.object({ queued: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projectDocuments")
      .paginate({ numItems: 50, cursor: args.cursor ?? null, maximumBytesRead: PASS_PAGE_BYTES });
    let queued = args.queuedSoFar ?? 0;
    for (const doc of page.page) {
      if (!doc.storageId) continue;
      if (!needsServerReading({ ...doc, hasReadText: await documentHasReadText(ctx, doc) }, { wordMarkdownBackfill: true })) continue;
      if (!args.dryRun) {
        await ctx.scheduler.runAfter(queued * 2_000, internal.ai.fileReading.readStoredDocument, {
          documentId: doc._id,
        });
      }
      queued += 1;
    }
    const verb = args.dryRun ? "would queue" : "queued";
    if (!page.isDone) {
      console.info(`queueServerReadings: ${verb} ${queued} so far`);
      await ctx.scheduler.runAfter(0, internal.documentReading.queueServerReadings, {
        cursor: page.continueCursor,
        ...(args.dryRun ? { dryRun: true } : {}),
        queuedSoFar: queued,
      });
    } else {
      console.info(`queueServerReadings: ${verb} ${queued} server readings in all`);
    }
    return { queued, isDone: page.isDone };
  },
});
