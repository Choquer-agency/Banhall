"use node";

/**
 * Indexes one project or company file's search pieces (2026-10-26, context
 * pipeline plan Phases B4 and C). A PDF's page starts come from reading its stored original
 * again, used only when that reading gives exactly the stored text. They
 * are found by each page's opening words (locatePageOffsets), so a page
 * number is close but not certain on a page with almost no text. Then
 * convex/searchPieces.ts writes the pieces.
 */
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { readFileOnServer } from "./fileReader";

/** A PDF read only for its page starts gets this long. */
const PAGE_READ_TIMEOUT_MS = 60_000;

/** At most this many page starts are sent (checkedPageStarts refuses more anyway). */
const MAX_PAGE_STARTS = 2_000;

/**
 * A PDF's page starts from reading its original again, used only when that
 * reading gives exactly the stored text; undefined otherwise.
 */
async function pdfPageStarts(
  ctx: ActionCtx,
  original: { storageId: Id<"_storage">; fileName: string } | undefined,
  storedText: () => Promise<string | null>
): Promise<number[] | undefined> {
  if (!original) return undefined;
  const blob = await ctx.storage.get(original.storageId);
  const stored = blob ? await storedText() : null;
  if (!blob || stored === null) return undefined;
  const reading = await readFileOnServer(new Uint8Array(await blob.arrayBuffer()), original.fileName, {
    pdfTimeoutMs: PAGE_READ_TIMEOUT_MS,
  });
  return reading.text === stored && reading.pageOffsets && reading.pageOffsets.length <= MAX_PAGE_STARTS
    ? reading.pageOffsets
    : undefined;
}

export const indexDocument = internalAction({
  args: { documentId: v.id("projectDocuments") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const file = await ctx.runQuery(internal.searchPieces.fileToIndex, { documentId: args.documentId });
      if (!file) {
        await ctx.runMutation(internal.searchPieces.retireSearchPieces, { documentId: args.documentId });
        return null;
      }
      const pageStarts = await pdfPageStarts(ctx, file.original, () =>
        ctx.runQuery(internal.searchPieces.storedTextToIndex, { documentId: args.documentId, textHash: file.textHash })
      );
      const outcome = await ctx.runMutation(internal.searchPieces.writeSearchPieces, {
        documentId: args.documentId,
        textHash: file.textHash,
        ...(pageStarts ? { pageStarts } : {}),
      });
      console.info(`indexDocument: ${outcome}${file.original ? (pageStarts ? " with page starts" : " without page starts") : ""}`);
    } catch (error) {
      await ctx.runMutation(internal.searchPieces.failSearchPieces, {
        documentId: args.documentId,
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
    }
    return null;
  },
});

/** Indexes one company file's search pieces (Phase C), as indexDocument does. */
export const indexCompanyFile = internalAction({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const file = await ctx.runQuery(internal.companyFileWork.companyFileToIndex, { companyFileId: args.companyFileId });
      if (!file) return null;
      const pageStarts = await pdfPageStarts(ctx, file.original, () =>
        ctx.runQuery(internal.companyFileWork.storedCompanyTextToIndex, {
          companyFileId: args.companyFileId,
          textHash: file.textHash,
        })
      );
      const outcome = await ctx.runMutation(internal.companyFileWork.writeCompanyFileSearchPieces, {
        companyFileId: args.companyFileId,
        textHash: file.textHash,
        ...(pageStarts ? { pageStarts } : {}),
      });
      console.info(`indexCompanyFile: ${outcome}${file.original ? (pageStarts ? " with page starts" : " without page starts") : ""}`);
    } catch (error) {
      await ctx.runMutation(internal.companyFileWork.failCompanyFileSearchPieces, {
        companyFileId: args.companyFileId,
        reason: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      });
    }
    return null;
  },
});
