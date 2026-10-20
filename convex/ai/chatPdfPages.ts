"use node";

// Report chat parity, Phase C (2026-10-20): the page count of a project PDF,
// worked out on the server the first time the chat views it, then stored
// (`projectDocuments.pageCount`). The browser counts pages at upload but
// never stored the count, so older rows have none.
//
// Node runtime: pdf.js (`pdfjs-dist`, already a dependency) runs here with
// its worker in the same thread (`globalThis.pdfjsWorker`), so no worker
// file has to be found next to the bundle. Only the storage id crosses into
// this action (Node actions take at most 5 MiB of arguments); the bytes are
// read here and never leave it.

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import { safeErrorDetails } from "../lib/safeErrorDetails";

/** pdf.js gives up on a file it cannot open within this time. */
const PDF_COUNT_TIMEOUT_MS = 20_000;

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

let pdfjsLoad: Promise<PdfJs> | null = null;

/** pdf.js with its worker set up in this thread, loaded once per instance. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjsLoad ??= (async () => {
    // A static specifier, so the bundler includes the worker module.
    // @ts-expect-error pdfjs-dist ships no type declarations for its worker module.
    const worker: unknown = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return await import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjsLoad;
}

/**
 * The number of pages pdf.js finds in `bytes`, or null when it cannot open
 * the file (damaged, encrypted, not a PDF, or too slow).
 */
export async function countPdfPagesWithPdfJs(bytes: Uint8Array): Promise<number | null> {
  let pdfjs: PdfJs;
  try {
    pdfjs = await loadPdfJs();
  } catch (error) {
    pdfjsLoad = null;
    console.error("chat pdf page count could not load pdf.js", safeErrorDetails(error));
    return null;
  }
  const task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    verbosity: 0,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pdf = await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("PDF_COUNT_TIMEOUT")), PDF_COUNT_TIMEOUT_MS);
      }),
    ]);
    const pages = pdf.numPages;
    return Number.isInteger(pages) && pages > 0 ? pages : null;
  } catch (error) {
    console.warn("chat pdf page count failed", safeErrorDetails(error));
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    void task.destroy().catch(() => {});
  }
}

const storePageCountRef = makeFunctionReference<
  "mutation",
  { documentId: Id<"projectDocuments">; storageId: Id<"_storage">; pageCount: number },
  null
>("chatDocuments:storePdfPageCount") as unknown as FunctionReference<
  "mutation",
  "internal",
  { documentId: Id<"projectDocuments">; storageId: Id<"_storage">; pageCount: number },
  null
>;

/**
 * Count the pages of one project PDF's original and store the count. The
 * caller has already checked the file (chatDocuments.viewFileForChat); the
 * store re-checks that the row still holds this original. Returns the count,
 * or null when the file could not be read or counted.
 */
export const countPdfPages = internalAction({
  args: { documentId: v.id("projectDocuments"), storageId: v.id("_storage") },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, args): Promise<number | null> => {
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) return null;
    const pageCount = await countPdfPagesWithPdfJs(new Uint8Array(await blob.arrayBuffer()));
    if (pageCount === null) return null;
    await ctx.runMutation(storePageCountRef, { ...args, pageCount });
    return pageCount;
  },
});
