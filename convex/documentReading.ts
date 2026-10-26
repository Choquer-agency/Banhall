/**
 * A project file's text, read again on the server (2026-10-26, Phase B2).
 * The rules for when, and when the reading replaces the text, are in
 * convex/lib/serverReading.ts; the reading itself is
 * convex/ai/fileReading.ts. No AI writes any of this text.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { deriveProcessingStatus } from "../shared/documentStatus";
import {
  documentHasText,
  documentTextHash,
  documentTextLength,
  readDocumentText,
  writeDocumentText,
} from "./lib/documentText";
import { requestBriefPreparation } from "./lib/briefPreparationTrigger";
import { needsServerReading, serverReadingReplaces, stoppedEarly } from "./lib/serverReading";
import { isProjectDeleting } from "./lib/projectDeletion";

async function readingFacts(ctx: Parameters<typeof readDocumentText>[0], doc: Doc<"projectDocuments">) {
  const hasText = documentHasText(doc);
  const tail = hasText ? await readDocumentText(ctx, doc, Math.max(0, documentTextLength(doc) - 400)) : "";
  return { hasText, stoppedEarly: stoppedEarly(tail) };
}

/** What the server reads for one file, or null when it has nothing to read. */
export const storedDocumentToRead = internalQuery({
  args: { documentId: v.id("projectDocuments") },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), fileName: v.string(), textHash: v.string(), bytes: v.number() })
  ),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc?.storageId) return null;
    if (!needsServerReading({ ...doc, ...(await readingFacts(ctx, doc)) })) return null;
    const stored = await ctx.db.system.get(doc.storageId);
    if (!stored) return null;
    return {
      storageId: doc.storageId,
      fileName: doc.fileName,
      textHash: await documentTextHash(doc),
      bytes: stored.size,
    };
  },
});

/**
 * Keeps the server's reading when serverReadingReplaces allows it. The file
 * must not have changed since the reading started. Either way the row
 * records that the server read it, so it is not read again.
 */
export const saveServerReading = internalMutation({
  args: {
    documentId: v.id("projectDocuments"),
    expectedTextHash: v.string(),
    text: v.string(),
    pageCount: v.optional(v.number()),
    reader: v.string(),
  },
  returns: v.union(v.literal("kept"), v.literal("not_better"), v.literal("changed")),
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.archived || (await isProjectDeleting(ctx, doc.projectId))) return "changed";
    if ((await documentTextHash(doc)) !== args.expectedTextHash) return "changed";
    const now = Date.now();
    const stored = documentHasText(doc) ? await readDocumentText(ctx, doc) : "";
    if (!serverReadingReplaces(stored, args.text)) {
      await ctx.db.patch(doc._id, { serverReader: args.reader, serverReadAt: now });
      return "not_better";
    }
    const written = await writeDocumentText(ctx, doc, args.text, now);
    const derived = deriveProcessingStatus({ fileName: doc.fileName, content: args.text });
    await ctx.db.patch(doc._id, {
      ...written,
      processingStatus: derived.status,
      processingDetail: derived.detail,
      ...(args.pageCount !== undefined ? { pageCount: args.pageCount } : {}),
      serverReader: args.reader,
      serverReadAt: now,
    });
    // Decision 65: readable new evidence may change the prepared Brief.
    await requestBriefPreparation(ctx, doc.projectId, { reason: "document_added" });
    return "kept";
  },
});

/**
 * One-off pass, run by hand (dev first, then production): queues a server
 * reading for every file that needs one, a page at a time, spaced so the
 * readings do not all start at once. `dryRun` only counts.
 */
export const queueServerReadings = internalMutation({
  args: {
    cursor: v.optional(v.union(v.string(), v.null())),
    dryRun: v.optional(v.boolean()),
    queuedSoFar: v.optional(v.number()),
  },
  returns: v.object({ queued: v.number(), isDone: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("projectDocuments").paginate({ numItems: 50, cursor: args.cursor ?? null });
    let queued = args.queuedSoFar ?? 0;
    for (const doc of page.page) {
      if (!doc.storageId) continue;
      if (!needsServerReading({ ...doc, ...(await readingFacts(ctx, doc)) })) continue;
      if (!args.dryRun) {
        await ctx.scheduler.runAfter(queued * 2_000, internal.ai.fileReading.readStoredDocument, {
          documentId: doc._id,
        });
      }
      queued += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.documentReading.queueServerReadings, {
        cursor: page.continueCursor,
        ...(args.dryRun ? { dryRun: true } : {}),
        queuedSoFar: queued,
      });
    } else {
      console.info(`queueServerReadings: ${args.dryRun ? "would queue" : "queued"} ${queued} server readings`);
    }
    return { queued, isDone: page.isDone };
  },
});
