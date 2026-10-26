"use node";

/**
 * Reads one project file's stored original on the server (2026-10-26,
 * Phase B2) and hands the text to convex/documentReading.ts, which keeps it
 * only for a file with nothing read. Company files (Phase C) go the same
 * way through convex/companyFileWork.ts. Queued when a file is added or gains
 * its original, and by the one-off pass (queueServerReadings).
 */
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { readFileOnServer, SERVER_READER_VERSION } from "./fileReader";
import { MAX_UPLOAD_BYTES } from "../lib/storage";

/**
 * A larger original is not read: the action holds the whole file in memory.
 * New uploads are refused above it; older files may not be.
 */
export const MAX_SERVER_READ_BYTES = MAX_UPLOAD_BYTES;

type Target = { storageId: Id<"_storage">; fileName: string; textHash: string; bytes: number };
type Reading = { text: string; pageCount?: number; failed?: true; textFormat?: "markdown" };

/** Reads a claimed original and hands the reading to `finish`; returns its outcome. */
async function readTarget(
  ctx: ActionCtx,
  target: Target,
  finish: (reading: Reading) => Promise<string>
): Promise<string> {
  if (target.bytes > MAX_SERVER_READ_BYTES) {
    // Recorded as read, so the file is not queued again; its text stays.
    await finish({ text: "" });
    return `not read, ${target.bytes} bytes is over ${MAX_SERVER_READ_BYTES}`;
  }
  const blob = await ctx.storage.get(target.storageId);
  if (!blob) return await finish({ text: "", failed: true });
  const reading = await readFileOnServer(new Uint8Array(await blob.arrayBuffer()), target.fileName);
  const outcome = await finish(reading);
  return `${outcome}${reading.note ? ` (${reading.note})` : ""}`;
}

/** The save arguments a reading becomes. */
function savedReading(target: Target, reading: Reading) {
  return {
    expectedTextHash: target.textHash,
    text: reading.text,
    ...(reading.pageCount !== undefined ? { pageCount: reading.pageCount } : {}),
    reader: SERVER_READER_VERSION,
    ...(reading.failed ? { failed: true } : {}),
    ...(reading.textFormat ? { textFormat: reading.textFormat } : {}),
  };
}

export const readStoredDocument = internalAction({
  args: { documentId: v.id("projectDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runMutation(internal.documentReading.startServerReading, { documentId: args.documentId });
    if (!target) return null;
    const outcome = await readTarget(ctx, target, (reading) =>
      ctx.runMutation(internal.documentReading.saveServerReading, { documentId: args.documentId, ...savedReading(target, reading) })
    );
    console.info(`readStoredDocument: ${outcome}`);
    return null;
  },
});

/** Reads one company file's stored original (Phase C), as readStoredDocument does. */
export const readStoredCompanyFile = internalAction({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const target = await ctx.runMutation(internal.companyFileWork.startCompanyFileReading, {
      companyFileId: args.companyFileId,
    });
    if (!target) return null;
    const outcome = await readTarget(ctx, target, (reading) =>
      ctx.runMutation(internal.companyFileWork.saveCompanyFileReading, {
        companyFileId: args.companyFileId,
        ...savedReading(target, reading),
      })
    );
    console.info(`readStoredCompanyFile: ${outcome}`);
    return null;
  },
});
