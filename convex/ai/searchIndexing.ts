"use node";

/**
 * Indexes one project file's search pieces (2026-10-26, context pipeline
 * plan Phase B4). A PDF's page starts come from reading its stored original
 * again, used only when that reading gives exactly the stored text. They
 * are found by each page's opening words (locatePageOffsets), so a page
 * number is close but not certain on a page with almost no text. Then
 * convex/searchPieces.ts writes the pieces.
 */
import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { readFileOnServer } from "./fileReader";

/** A PDF read only for its page starts gets this long. */
const PAGE_READ_TIMEOUT_MS = 60_000;

/** At most this many page starts are sent (checkedPageStarts refuses more anyway). */
const MAX_PAGE_STARTS = 2_000;

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
      let pageStarts: number[] | undefined;
      if (file.original) {
        const blob = await ctx.storage.get(file.original.storageId);
        const stored = blob
          ? await ctx.runQuery(internal.searchPieces.storedTextToIndex, {
              documentId: args.documentId,
              textHash: file.textHash,
            })
          : null;
        if (blob && stored !== null) {
          const reading = await readFileOnServer(new Uint8Array(await blob.arrayBuffer()), file.original.fileName, {
            pdfTimeoutMs: PAGE_READ_TIMEOUT_MS,
          });
          if (reading.text === stored && reading.pageOffsets && reading.pageOffsets.length <= MAX_PAGE_STARTS) {
            pageStarts = reading.pageOffsets;
          }
        }
      }
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
