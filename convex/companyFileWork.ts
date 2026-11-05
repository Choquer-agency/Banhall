/**
 * Company files' background work (2026-10-26, Phase C): the server's
 * reading of an original nothing was read from, search pieces and labels,
 * by the same rules as project files (convex/documentReading.ts,
 * convex/searchPieces.ts, convex/fileLabels.ts). The sweeps there start
 * company files too. No AI writes any file's text.
 */
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { deriveProcessingStatus } from "../shared/documentStatus";
import { SEARCH_PIECES_VERSION } from "../shared/searchPieces";
import { quotableFileText } from "../shared/wordMarkdown";
import {
  deleteCompanyFileSearchPieces,
  readCompanyFileText,
  replaceCompanyFileText,
} from "./lib/companyFileText";
import {
  hasReadText,
  needsServerReading,
  READ_TEXT_PROBE_CHARS,
  SERVER_READER_VERSION,
  serverReadingReplaces,
} from "./lib/serverReading";
import { insertSearchPieces } from "./lib/searchPieces";
import { pieceTextKind, SEARCH_INDEX_RETRY_DELAYS_MS } from "./searchPieces";
import { LABEL_RETRY_DELAYS_MS, labelSamples, labelsCurrent } from "./lib/fileLabels";
import { placeholderMapFrom } from "./lib/transcriptPlaceholders";
import { transcriptPlaceholdersEnabled } from "./appSettings";
import { placeholderMapValidator } from "./lib/placeholderValidators";
import { MAX_UPLOAD_BYTES } from "./lib/storage";
import { companyIdentityNames } from "./lib/clients";

const OFF_THE_LABEL_QUEUE = { labelsDue: undefined, labelsNextAt: undefined } as const;

/** Whether a company file holds read text, reading at most a short text whole. */
async function companyFileHasReadText(ctx: QueryCtx, file: Doc<"companyFiles">): Promise<boolean> {
  if (!file.hasText) return false;
  if (file.textLength > READ_TEXT_PROBE_CHARS) return true;
  return hasReadText(await readCompanyFileText(ctx, file));
}

/** Whether a company file needs the server's reading (convex/lib/serverReading.ts). */
export async function companyFileNeedsServerReading(ctx: QueryCtx, file: Doc<"companyFiles">): Promise<boolean> {
  return needsServerReading({ ...file, hasReadText: await companyFileHasReadText(ctx, file) });
}

// ─── Server reading ─────────────────────────────────────────────────────────

/**
 * What a reading claims: the text it may replace and the original it reads
 * (2026-11-04). Replace file swaps the original, and two unreadable
 * originals have the same (empty) text, so the text alone could let a
 * reading of the old original land on the new one.
 */
function readingClaim(file: Pick<Doc<"companyFiles">, "textHash" | "storageId">): string {
  return `${file.textHash}@${file.storageId ?? ""}`;
}

/** Claims one company file's reading, as startServerReading does for a project file. */
export const startCompanyFileReading = internalMutation({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.union(
    v.null(),
    v.object({ storageId: v.id("_storage"), fileName: v.string(), textHash: v.string(), bytes: v.number() })
  ),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file?.storageId || !(await companyFileNeedsServerReading(ctx, file))) return null;
    const stored = await ctx.db.system.get(file.storageId);
    if (!stored) return null;
    await ctx.db.patch(file._id, { serverReader: SERVER_READER_VERSION, serverReadStartedAt: Date.now() });
    return { storageId: file.storageId, fileName: file.fileName, textHash: readingClaim(file), bytes: stored.size };
  },
});

/** Finishes a claimed reading, as saveServerReading does for a project file. */
export const saveCompanyFileReading = internalMutation({
  args: {
    companyFileId: v.id("companyFiles"),
    expectedTextHash: v.string(),
    text: v.string(),
    pageCount: v.optional(v.number()),
    reader: v.string(),
    failed: v.optional(v.boolean()),
    textFormat: v.optional(v.literal("markdown")),
  },
  returns: v.union(v.literal("kept"), v.literal("not_better"), v.literal("changed"), v.literal("failed")),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    // A claim made before claims named their original carries the text's
    // fingerprint alone.
    if (!file || (args.expectedTextHash !== readingClaim(file) && args.expectedTextHash !== file.textHash)) return "changed";
    // Archived meanwhile: the claim is released, so restoring it reads it.
    if (file.archived) {
      await ctx.db.patch(file._id, { serverReadStartedAt: undefined });
      return "changed";
    }
    if (args.failed) {
      await ctx.db.patch(file._id, { serverReadStartedAt: undefined });
      return "failed";
    }
    const now = Date.now();
    if (!serverReadingReplaces(await companyFileHasReadText(ctx, file), args.text)) {
      await ctx.db.patch(file._id, { serverReader: args.reader, serverReadAt: now });
      return "not_better";
    }
    const facts = await replaceCompanyFileText(ctx, file._id, args.text);
    const derived = deriveProcessingStatus({ fileName: file.fileName, content: args.text });
    await ctx.db.patch(file._id, {
      ...facts,
      processingStatus: derived.status,
      processingDetail: derived.detail,
      ...(args.pageCount !== undefined ? { pageCount: args.pageCount } : {}),
      textFormat: args.textFormat,
      serverReader: args.reader,
      serverReadAt: now,
      searchPiecesDue: true,
      searchPiecesNextAt: 0,
      searchPiecesAttempts: undefined,
    });
    return "kept";
  },
});

// ─── Search pieces ──────────────────────────────────────────────────────────

/** What indexing one company file needs, or null when it is gone. */
export const companyFileToIndex = internalQuery({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.union(
    v.null(),
    v.object({
      textHash: v.string(),
      kind: v.string(),
      original: v.optional(v.object({ storageId: v.id("_storage"), fileName: v.string() })),
    })
  ),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    const kind = pieceTextKind(file);
    let original: { storageId: Id<"_storage">; fileName: string } | undefined;
    if (kind === "pdf" && file.storageId && file.hasText) {
      const stored = await ctx.db.system.get(file.storageId);
      if (stored && stored.size <= MAX_UPLOAD_BYTES) original = { storageId: file.storageId, fileName: file.fileName };
    }
    return { textHash: file.textHash, kind, ...(original ? { original } : {}) };
  },
});

/** A company file's whole stored text, to compare with a fresh reading of its PDF. */
export const storedCompanyTextToIndex = internalQuery({
  args: { companyFileId: v.id("companyFiles"), textHash: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file || file.textHash !== args.textHash) return null;
    return await readCompanyFileText(ctx, file);
  },
});

/**
 * Replaces a company file's pieces with the pieces of its current text,
 * filed under the company that holds it now. Nothing is written when the
 * file is gone or its text changed after the indexing started.
 */
export const writeCompanyFileSearchPieces = internalMutation({
  args: {
    companyFileId: v.id("companyFiles"),
    textHash: v.string(),
    pageStarts: v.optional(v.array(v.number())),
  },
  returns: v.union(v.literal("written"), v.literal("changed")),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return "changed";
    if (file.textHash !== args.textHash) {
      await ctx.db.patch(file._id, { searchPiecesDue: true, searchPiecesNextAt: 0, searchPiecesAttempts: undefined });
      return "changed";
    }
    await deleteCompanyFileSearchPieces(ctx, file._id);
    const text = file.hasText ? await readCompanyFileText(ctx, file) : "";
    await insertSearchPieces(ctx, { companyFileId: file._id, clientId: file.clientId }, text, {
      kind: pieceTextKind(file),
      textHash: args.textHash,
      ...(file.textFormat ? { textFormat: file.textFormat } : {}),
      ...(args.pageStarts ? { pageStarts: args.pageStarts } : {}),
    });
    await ctx.db.patch(file._id, {
      searchPiecesTextHash: args.textHash,
      searchPiecesVersion: SEARCH_PIECES_VERSION,
      searchPiecesDue: undefined,
      searchPiecesNextAt: undefined,
      searchPiecesAttempts: undefined,
      ...(text.trim() && !file.archived && !labelsCurrent(file, args.textHash)
        ? { labelsDue: true as const, labelsNextAt: 0, labelsAttempts: undefined }
        : {}),
    });
    return "written";
  },
});

/** A failed cut: tried again after a wait, then left after four tries. */
export const failCompanyFileSearchPieces = internalMutation({
  args: { companyFileId: v.id("companyFiles"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    const attempts = (file.searchPiecesAttempts ?? 0) + 1;
    const wait = SEARCH_INDEX_RETRY_DELAYS_MS[attempts - 1];
    if (wait === undefined) {
      console.warn(`searchPieces: company file ${file._id} left without pieces after ${attempts} tries (${args.reason})`);
      await ctx.db.patch(file._id, { searchPiecesDue: undefined, searchPiecesNextAt: undefined, searchPiecesAttempts: attempts });
    } else {
      await ctx.db.patch(file._id, { searchPiecesAttempts: attempts, searchPiecesNextAt: Date.now() + wait });
    }
    return null;
  },
});

// ─── Labels ─────────────────────────────────────────────────────────────────

/**
 * The names a company file's labels hide: the company's name and every name
 * tied to it (`companyIdentityNames`), and the firm's names. Transcripts are
 * not read.
 */
async function companyPlaceholderMap(ctx: QueryCtx, client: Doc<"clients">, texts: readonly string[]) {
  const { organizations, people } = await companyIdentityNames(ctx, client);
  return await placeholderMapFrom(ctx, { clientName: client.name }, [{ people, organizations, phrases: [] }], texts);
}

/** What one label call for a company file reads, or null when it needs none. */
export const companyLabelInput = internalQuery({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.union(
    v.null(),
    v.object({
      fileName: v.string(),
      category: v.union(v.string(), v.null()),
      pageCount: v.union(v.number(), v.null()),
      textLength: v.number(),
      textHash: v.string(),
      samples: v.object({ opening: v.string(), middle: v.optional(v.string()), end: v.optional(v.string()) }),
      placeholders: placeholderMapValidator,
    })
  ),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file || file.archived || !file.hasText || labelsCurrent(file, file.textHash)) return null;
    const client = await ctx.db.get(file.clientId);
    if (!client) return null;
    const samples = labelSamples(quotableFileText(await readCompanyFileText(ctx, file), file.textFormat));
    const texts = [file.fileName, samples.opening, samples.middle ?? "", samples.end ?? ""];
    const placeholders = (await transcriptPlaceholdersEnabled(ctx)) ? [...(await companyPlaceholderMap(ctx, client, texts))] : [];
    return {
      fileName: file.fileName,
      category: file.category ?? null,
      pageCount: file.pageCount ?? null,
      textLength: file.textLength,
      textHash: file.textHash,
      samples,
      placeholders: placeholders.map((entry) => ({
        token: entry.token,
        value: entry.value,
        ...(entry.bare ? { bare: true } : {}),
        ...(entry.at ? { at: entry.at } : {}),
      })),
    };
  },
});

/** A due company file with nothing to label any more leaves the queue. */
export const retireCompanyFileLabels = internalMutation({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (file && (file.archived || !file.hasText || labelsCurrent(file, file.textHash))) {
      await ctx.db.patch(file._id, OFF_THE_LABEL_QUEUE);
    }
    return null;
  },
});

/** Keeps a company file's labels when it still has the text and name they were made from. */
export const saveCompanyFileLabels = internalMutation({
  args: {
    companyFileId: v.id("companyFiles"),
    textHash: v.string(),
    fileName: v.string(),
    model: v.string(),
    promptVersion: v.string(),
    labels: v.object({
      documentType: v.string(),
      fiscalYear: v.union(v.number(), v.null()),
      title: v.string(),
      summary: v.string(),
    }),
  },
  returns: v.union(v.literal("kept"), v.literal("changed")),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return "changed";
    if (file.fileName !== args.fileName || file.textHash !== args.textHash) {
      await ctx.db.patch(file._id, { labelsDue: true, labelsNextAt: 0 });
      return "changed";
    }
    await ctx.db.patch(file._id, {
      labels: {
        ...args.labels,
        model: args.model,
        promptVersion: args.promptVersion,
        textHash: args.textHash,
        fileName: args.fileName,
        labeledAt: Date.now(),
      },
      ...OFF_THE_LABEL_QUEUE,
      labelsAttempts: undefined,
      labelsLastError: undefined,
    });
    return "kept";
  },
});

/** A failed label call for a company file: tried again after a wait, up to four tries. */
export const failCompanyFileLabels = internalMutation({
  args: { companyFileId: v.id("companyFiles"), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    const attempts = (file.labelsAttempts ?? 0) + 1;
    const wait = LABEL_RETRY_DELAYS_MS[attempts - 1];
    if (wait === undefined) {
      console.warn(`fileLabels: company file ${file._id} left without labels after ${attempts} tries (${args.reason})`);
      await ctx.db.patch(file._id, { ...OFF_THE_LABEL_QUEUE, labelsAttempts: attempts, labelsLastError: args.reason });
      return null;
    }
    await ctx.db.patch(file._id, { labelsAttempts: attempts, labelsNextAt: Date.now() + wait, labelsLastError: args.reason });
    return null;
  },
});
