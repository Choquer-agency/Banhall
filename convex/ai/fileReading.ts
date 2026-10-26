"use node";

/**
 * Reads one project file's stored original on the server (2026-10-26,
 * Phase B2) and hands the text to convex/documentReading.ts, which keeps it
 * only for a file with nothing read. Queued when a file is added or gains
 * its original, and by the one-off pass (queueServerReadings).
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { readFileOnServer, SERVER_READER_VERSION } from "./fileReader";
import { MAX_UPLOAD_BYTES } from "../lib/storage";

/**
 * A larger original is not read: the action holds the whole file in memory.
 * New uploads are refused above it; older files may not be.
 */
export const MAX_SERVER_READ_BYTES = MAX_UPLOAD_BYTES;

export const readStoredDocument = internalAction({
  args: { documentId: v.id("projectDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runMutation(internal.documentReading.startServerReading, { documentId: args.documentId });
    if (!target) return null;
    const finish = (reading: { text: string; pageCount?: number; failed?: true; textFormat?: "markdown" }) =>
      ctx.runMutation(internal.documentReading.saveServerReading, {
        documentId: args.documentId,
        expectedTextHash: target.textHash,
        text: reading.text,
        ...(reading.pageCount !== undefined ? { pageCount: reading.pageCount } : {}),
        reader: SERVER_READER_VERSION,
        ...(reading.failed ? { failed: true } : {}),
        ...(reading.textFormat ? { textFormat: reading.textFormat } : {}),
      });
    if (target.bytes > MAX_SERVER_READ_BYTES) {
      // Recorded as read, so the file is not queued again; its text stays.
      await finish({ text: "" });
      console.info(`readStoredDocument: not read, ${target.bytes} bytes is over ${MAX_SERVER_READ_BYTES}`);
      return null;
    }
    const blob = await ctx.storage.get(target.storageId);
    if (!blob) {
      await finish({ text: "", failed: true });
      return null;
    }
    const reading = await readFileOnServer(new Uint8Array(await blob.arrayBuffer()), target.fileName);
    const outcome = await finish(reading);
    console.info(`readStoredDocument: ${outcome}${reading.note ? ` (${reading.note})` : ""}`);
    return null;
  },
});
