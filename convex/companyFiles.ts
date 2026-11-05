/**
 * Company files (2026-10-26, Phase C; decision "2026-10-26", part 1): files
 * a company (a `clients` row) holds for every project linked to it.
 * Consultants, Managers and Admins read and add them (companyFiles.read,
 * companyFiles.add); Managers and Admins archive, restore and remove them
 * (companyFiles.manage); Financial users do neither. Every add, archive,
 * restore and removal is logged in companyFileEvents. Text is stored in
 * pieces (convex/lib/companyFileText.ts); search pieces and labels follow
 * as for project files.
 */
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { activeClientForKey, dashboardCompanyForKey, MERGE_CHAIN_HOPS } from "./lib/clients";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { requireAttemptKey } from "./lib/uploadAttempts";
import { labelsCurrent } from "./lib/fileLabels";
import { companyFileNeedsServerReading } from "./companyFileWork";
import { companyFilesNewestFirst, eligibleCompanyFiles, FROZEN_COMPANY_FILES } from "./lib/briefEvidence";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import { hasCapability } from "../shared/capabilities";
import { deriveProcessingStatus } from "../shared/documentStatus";
import {
  companyFileTextFacts,
  deleteCompanyFileSearchPieces,
  insertCompanyFileTextPieces,
  readCompanyFileText,
  replaceCompanyFileText,
} from "./lib/companyFileText";
import {
  deleteStorageIfUnreferenced,
  isStorageReferenced,
  requireFreshUpload,
  requireNotClaimedByAnother,
  uploadClaimFor,
} from "./lib/storage";
import { hasReadText, needsServerReading } from "./lib/serverReading";

const MAX_FILE_NAME_CHARS = 300;
/** Files one company page lists; more are counted, not listed. */
export const COMPANY_FILE_LIST_LIMIT = 500;
/** Projects one step links to a company row made from a company's name. */
const LINK_PROJECT_PAGE = 200;

const fileTypeValidator = v.union(
  v.literal("txt"),
  v.literal("md"),
  v.literal("pdf"),
  v.literal("docx"),
  v.literal("msg"),
  v.literal("eml"),
  v.literal("xlsx"),
  v.literal("image"),
  v.literal("other")
);

const categoryValidator = v.union(
  v.literal("previous_pd"),
  v.literal("scoping_notes"),
  v.literal("writer_notes"),
  v.literal("background"),
  v.literal("other")
);

/**
 * The company, active; a merged one is refused with the name of the active
 * company it ended up in (following merges of merges, bounded).
 */
async function requireActiveClient(ctx: QueryCtx, clientId: Id<"clients">): Promise<Doc<"clients">> {
  const client = await ctx.db.get(clientId);
  if (!client) domainError("NOT_FOUND", "This company no longer exists.");
  if (client.status === "active") return client;
  let kept: Doc<"clients"> | null = client;
  for (let hop = 0; kept && kept.status !== "active" && hop < MERGE_CHAIN_HOPS; hop++) {
    kept = kept.mergedIntoClientId ? await ctx.db.get(kept.mergedIntoClientId) : null;
  }
  domainError(
    "INVALID_STATE",
    kept?.status === "active"
      ? `This company was merged into ${kept.name}. Add the file there.`
      : "This company was merged into another one.",
    { reason: "COMPANY_MERGED" }
  );
}

async function logEvent(
  ctx: MutationCtx,
  file: Pick<Doc<"companyFiles">, "_id" | "clientId" | "fileName">,
  action: Doc<"companyFileEvents">["action"],
  userId: Id<"users">,
  otherClientId?: Id<"clients">,
  previousFileName?: string
): Promise<void> {
  await ctx.db.insert("companyFileEvents", {
    clientId: file.clientId,
    companyFileId: file._id,
    fileName: file.fileName,
    action,
    ...(otherClientId ? { otherClientId } : {}),
    ...(previousFileName ? { previousFileName } : {}),
    userId,
    at: Date.now(),
  });
}

export const WEBSITE_FILE_REPLACE_MESSAGE =
  "This file comes from the website. Change the website in Edit company, or use Read again.";

/** Fiscal years a person may file a company file under (Edit details). */
export const FISCAL_YEAR_MIN = 1990;
export const FISCAL_YEAR_MAX = 2100;

/**
 * The company row a company page (keyed by its name) works on, or null when
 * the company has no row yet (the page offers to add files, which makes it).
 */
export const companyForKey = query({
  args: { key: v.string() },
  returns: v.union(v.null(), v.object({ clientId: v.id("clients"), name: v.string() })),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.read");
    const client = await activeClientForKey(ctx, args.key);
    return client ? { clientId: client._id, name: client.name } : null;
  },
});

/**
 * The company row for a company page, made from the company's projects when
 * it has none yet (as merging does), with its projects linked to it so they
 * reach its files: the first page now, the rest in scheduled steps. Projects
 * with no company name share no company and get no row.
 */
export const ensureCompanyForKey = mutation({
  args: { key: v.string() },
  returns: v.object({ clientId: v.id("clients"), name: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.add");
    if (args.key === DASHBOARD_UNNAMED_COMPANY_KEY) {
      domainError("INVALID_INPUT", "Projects with no company name share no company files. Name their company first.");
    }
    const existing = await activeClientForKey(ctx, args.key);
    if (existing) return { clientId: existing._id, name: existing.name };
    const company = await dashboardCompanyForKey(ctx, args.key);
    if (!company) domainError("NOT_FOUND", "This company has no projects yet. Add a project first.");
    // As the clients backfill names a company made from its projects.
    const name = company.clientName.trim() || args.key;
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name,
      nameKey: args.key,
      status: "active",
      nameHistoryComplete: true,
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await linkKeyProjectsPage(ctx, args.key, clientId, null);
    return { clientId, name };
  },
});

/**
 * Links one page of a key's live projects to its company row and schedules
 * the next page. A company row that is no longer the key's active one (it
 * was merged or renamed meanwhile) stops the chain: the merge or rename
 * links projects itself. Edit company uses it too (clients.updateCompany).
 */
export async function linkKeyProjectsPage(
  ctx: MutationCtx,
  key: string,
  clientId: Id<"clients">,
  cursor: string | null
): Promise<void> {
  const page = await ctx.db
    .query("projects")
    .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", key))
    .paginate({ numItems: LINK_PROJECT_PAGE, cursor });
  for (const project of page.page) {
    if (project.deletionStartedAt !== undefined || project.clientId === clientId) continue;
    await ctx.db.patch(project._id, { clientId });
  }
  if (!page.isDone) {
    await ctx.scheduler.runAfter(0, internal.companyFiles.linkKeyProjectsStep, { key, clientId, cursor: page.continueCursor });
  }
}

export const linkKeyProjectsStep = internalMutation({
  args: { key: v.string(), clientId: v.id("clients"), cursor: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const client = await ctx.db.get(args.clientId);
    if (!client || client.status !== "active" || client.nameKey !== args.key) return null;
    await linkKeyProjectsPage(ctx, args.key, args.clientId, args.cursor);
    return null;
  },
});

/** An upload URL for a company file's original. */
export const generateCompanyUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireCapability(ctx, "companyFiles.add");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Adds a file to a company: its text as the browser read it and its
 * original. The same name with the same read text is the same file and is
 * not added twice; a repeat brings only an original the first lacked.
 */
export const addCompanyFile = mutation({
  args: {
    clientId: v.id("clients"),
    fileName: v.string(),
    fileType: fileTypeValidator,
    content: v.string(),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    category: v.optional(categoryValidator),
    textFormat: v.optional(v.literal("markdown")),
    extractionOutcome: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
    /** The browser's key for this save; a retry with the same key finds the row it made. */
    attemptKey: v.optional(v.string()),
  },
  returns: v.id("companyFiles"),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.add");
    const client = await requireActiveClient(ctx, args.clientId);
    const fileName = args.fileName.trim().slice(0, MAX_FILE_NAME_CHARS);
    if (!fileName) domainError("INVALID_INPUT", "A file needs a name");
    const facts = await companyFileTextFacts(args.content);
    const readText = hasReadText(args.content);
    const attemptKey = args.attemptKey === undefined ? undefined : requireAttemptKey(args.attemptKey);
    // A retried save (its answer was lost) gets the row it made, when it is
    // the same file. Otherwise the same name with the same read text is the
    // same file. Files with nothing read are never merged: two unreadable
    // files are two files.
    const retried = attemptKey
      ? await ctx.db
          .query("companyFiles")
          .withIndex("by_clientId_and_attemptKey", (q) => q.eq("clientId", client._id).eq("attemptKey", attemptKey))
          .first()
      : null;
    const duplicate =
      // The key is one picked file's: its name is enough, whatever the
      // server read into it since.
      (retried && retried.fileName === fileName ? retried : null) ??
      (readText
        ? await ctx.db
            .query("companyFiles")
            .withIndex("by_clientId_and_textHash_and_fileName_and_archived", (q) =>
              q.eq("clientId", client._id).eq("textHash", facts.textHash).eq("fileName", fileName).eq("archived", undefined)
            )
            .first()
        : null);
    if (args.storageId && duplicate?.storageId !== args.storageId) {
      await requireFreshUpload(ctx, args.storageId);
      if (!duplicate?.storageId) {
        if (await isStorageReferenced(ctx, args.storageId)) {
          domainError("INVALID_INPUT", "The uploaded file is already in use. Upload it again.");
        }
        await requireNotClaimedByAnother(ctx, args.storageId, user._id);
      }
    }
    if (duplicate) {
      if (!duplicate.storageId && args.storageId) {
        await ctx.db.patch(duplicate._id, {
          storageId: args.storageId,
          ...(args.mimeType ? { mimeType: args.mimeType } : {}),
        });
      } else if (args.storageId && duplicate.storageId !== args.storageId) {
        const claim = await uploadClaimFor(ctx, args.storageId);
        if (!claim || claim.userId === user._id) await deleteStorageIfUnreferenced(ctx, args.storageId);
      }
      return duplicate._id;
    }
    const derived = deriveProcessingStatus({
      fileName,
      content: args.content,
      extractionFailed: args.extractionOutcome === "failed",
    });
    const now = Date.now();
    const companyFileId = await ctx.db.insert("companyFiles", {
      clientId: client._id,
      fileName,
      fileType: args.fileType,
      ...(args.category ? { category: args.category } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(args.textFormat && facts.hasText ? { textFormat: args.textFormat } : {}),
      ...facts,
      processingStatus: derived.status,
      ...(derived.detail ? { processingDetail: derived.detail } : {}),
      uploadedBy: user._id,
      ...(user.role ? { uploaderRole: user.role } : {}),
      createdAt: now,
      ...(facts.hasText ? { searchPiecesDue: true as const, searchPiecesNextAt: 0 } : {}),
      ...(attemptKey ? { attemptKey } : {}),
    });
    await insertCompanyFileTextPieces(ctx, companyFileId, args.content);
    await logEvent(ctx, { _id: companyFileId, clientId: client._id, fileName }, "add", user._id);
    // No text, or a PDF the browser stopped reading early: the server reads
    // the stored original (convex/companyFileWork.ts).
    if (needsServerReading({ fileName, ...(args.storageId ? { storageId: args.storageId } : {}), hasReadText: readText })) {
      await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredCompanyFile, { companyFileId });
    }
    return companyFileId;
  },
});

const listedFileValidator = v.object({
  _id: v.id("companyFiles"),
  fileName: v.string(),
  fileType: fileTypeValidator,
  category: v.union(categoryValidator, v.null()),
  sizeChars: v.number(),
  wordCount: v.number(),
  archived: v.boolean(),
  processingStatus: v.string(),
  textFormat: v.union(v.literal("markdown"), v.null()),
  hasFile: v.boolean(),
  url: v.union(v.string(), v.null()),
  mimeType: v.union(v.string(), v.null()),
  createdAt: v.number(),
  addedBy: v.union(v.string(), v.null()),
  /** The company's website file (clients.websiteFileId): it is read again, never replaced by hand. */
  fromWebsite: v.boolean(),
  /** The original's size in bytes, or null with no original (for the download budget). */
  bytes: v.union(v.number(), v.null()),
  /**
   * The fiscal year a person filed it under (null: a person said none), or
   * undefined when nobody did and the AI label's year applies.
   */
  fiscalYear: v.optional(v.union(v.number(), v.null())),
  labels: v.union(
    v.null(),
    v.object({ documentType: v.string(), fiscalYear: v.union(v.number(), v.null()), title: v.string(), summary: v.string() })
  ),
});

/** A company's files, newest first: active ones, or the archived ones. */
export const listCompanyFiles = query({
  args: { clientId: v.id("clients"), archived: v.optional(v.boolean()) },
  returns: v.object({ files: v.array(listedFileValidator), truncated: v.boolean() }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.read");
    const rows = await ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_archived", (q) =>
        q.eq("clientId", args.clientId).eq("archived", args.archived ? true : undefined)
      )
      .order("desc")
      .take(COMPANY_FILE_LIST_LIMIT + 1);
    const websiteFileId = (await ctx.db.get(args.clientId))?.websiteFileId ?? null;
    const names = new Map<string, string | null>();
    const files = [];
    for (const row of rows.slice(0, COMPANY_FILE_LIST_LIMIT)) {
      let addedBy = names.get(row.uploadedBy);
      if (addedBy === undefined) {
        const uploader = await ctx.db.get(row.uploadedBy);
        addedBy = uploader?.name ?? uploader?.email ?? null;
        names.set(row.uploadedBy, addedBy);
      }
      files.push({
        _id: row._id,
        fileName: row.fileName,
        fileType: row.fileType,
        category: row.category ?? null,
        sizeChars: row.textLength,
        wordCount: row.wordCount,
        archived: row.archived === true,
        processingStatus: row.processingStatus,
        textFormat: row.textFormat ?? null,
        hasFile: row.storageId !== undefined,
        url: row.storageId ? await ctx.storage.getUrl(row.storageId) : null,
        mimeType: row.mimeType ?? null,
        createdAt: row.createdAt,
        addedBy,
        fromWebsite: row._id === websiteFileId,
        bytes: row.storageId ? ((await ctx.db.system.get(row.storageId))?.size ?? null) : null,
        ...(row.fiscalYear !== undefined ? { fiscalYear: row.fiscalYear } : {}),
        labels: row.labels
          ? {
              documentType: row.labels.documentType,
              fiscalYear: row.labels.fiscalYear,
              title: row.labels.title,
              summary: row.labels.summary,
            }
          : null,
      });
    }
    return { files, truncated: rows.length > COMPANY_FILE_LIST_LIMIT };
  },
});

/**
 * Edit details (2026-11-04): a company file's category and the fiscal year
 * it is filed under, for everyone who may add company files. The year is a
 * label only: drafts read company files exactly as before. A null category
 * clears it; a null year says the file has none (the AI label's year is no
 * longer shown).
 */
export const updateCompanyFileDetails = mutation({
  args: {
    companyFileId: v.id("companyFiles"),
    category: v.union(categoryValidator, v.null()),
    fiscalYear: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.add");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) domainError("NOT_FOUND", "This file no longer exists.");
    await requireActiveClient(ctx, file.clientId);
    if (
      args.fiscalYear !== null &&
      (!Number.isInteger(args.fiscalYear) || args.fiscalYear < FISCAL_YEAR_MIN || args.fiscalYear > FISCAL_YEAR_MAX)
    ) {
      domainError("INVALID_INPUT", `Pick a fiscal year between ${FISCAL_YEAR_MIN} and ${FISCAL_YEAR_MAX}.`);
    }
    await ctx.db.patch(file._id, { category: args.category ?? undefined, fiscalYear: args.fiscalYear });
    return null;
  },
});

/**
 * Replace file (2026-11-04, Managers and Admins): a new original for the
 * same file, read in the browser as for an add, its text stored as the
 * file's current text. Drafts that already used the old text keep it: they
 * refer to their own stored version (`sourceTextVersions`, kept while the
 * file exists) or hold their own copy; later drafts read the new text. The
 * file keeps its id, category and fiscal year, takes the new original's
 * name, and logs `replaced`. Search pieces and labels are made again from
 * the new text, and the server reads an original nothing was read from.
 * Sending the original the file already holds again (a retry whose answer
 * was lost) changes nothing.
 */
export const replaceCompanyFile = mutation({
  args: {
    companyFileId: v.id("companyFiles"),
    fileName: v.string(),
    fileType: fileTypeValidator,
    content: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
    textFormat: v.optional(v.literal("markdown")),
    extractionOutcome: v.optional(v.union(v.literal("ok"), v.literal("failed"))),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) domainError("NOT_FOUND", "This file no longer exists.");
    if (file.storageId === args.storageId) return null;
    if (file.archived) domainError("INVALID_STATE", "Restore this file before replacing it.");
    const client = await requireActiveClient(ctx, file.clientId);
    // The next website read would archive a file replaced by hand.
    if (client.websiteFileId === file._id) domainError("INVALID_STATE", WEBSITE_FILE_REPLACE_MESSAGE, { reason: "WEBSITE_FILE" });
    const fileName = args.fileName.trim().slice(0, MAX_FILE_NAME_CHARS);
    if (!fileName) domainError("INVALID_INPUT", "A file needs a name");
    await requireFreshUpload(ctx, args.storageId);
    if (await isStorageReferenced(ctx, args.storageId)) {
      domainError("INVALID_INPUT", "The uploaded file is already in use. Upload it again.");
    }
    await requireNotClaimedByAnother(ctx, args.storageId, user._id);
    const facts = await replaceCompanyFileText(ctx, file._id, args.content);
    const derived = deriveProcessingStatus({
      fileName,
      content: args.content,
      extractionFailed: args.extractionOutcome === "failed",
    });
    await ctx.db.patch(file._id, {
      fileName,
      fileType: args.fileType,
      storageId: args.storageId,
      mimeType: args.mimeType,
      textFormat: args.textFormat && facts.hasText ? args.textFormat : undefined,
      ...facts,
      pageCount: undefined,
      processingStatus: derived.status,
      processingDetail: derived.detail,
      serverReader: undefined,
      serverReadStartedAt: undefined,
      serverReadAt: undefined,
      // The old labels describe the old text; new ones follow the new pieces.
      labels: undefined,
      labelsDue: undefined,
      labelsNextAt: undefined,
      labelsAttempts: undefined,
      labelsLastError: undefined,
      searchPiecesDue: facts.hasText ? (true as const) : undefined,
      searchPiecesNextAt: facts.hasText ? 0 : undefined,
      searchPiecesAttempts: undefined,
    });
    if (!facts.hasText) await deleteCompanyFileSearchPieces(ctx, file._id);
    await logEvent(
      ctx,
      { _id: file._id, clientId: file.clientId, fileName },
      "replaced",
      user._id,
      undefined,
      file.fileName !== fileName ? file.fileName : undefined
    );
    if (file.storageId) await deleteStorageIfUnreferenced(ctx, file.storageId);
    if (needsServerReading({ fileName, storageId: args.storageId, hasReadText: hasReadText(args.content) })) {
      await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredCompanyFile, { companyFileId: file._id });
    }
    return null;
  },
});

/** A company file's whole text, for its preview. */
export const getCompanyFileContent = query({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.union(
    v.null(),
    v.object({
      fileName: v.string(),
      fileType: v.string(),
      content: v.string(),
      textFormat: v.optional(v.literal("markdown")),
    })
  ),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.read");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    return {
      fileName: file.fileName,
      fileType: file.fileType,
      content: await readCompanyFileText(ctx, file),
      ...(file.textFormat ? { textFormat: file.textFormat } : {}),
    };
  },
});

/** Archives or restores a company file (Managers and Admins). */
export const setCompanyFileArchived = mutation({
  args: { companyFileId: v.id("companyFiles"), archived: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) domainError("NOT_FOUND", "This file no longer exists.");
    await applyArchived(ctx, file, args.archived, user._id);
    return null;
  },
});

/** Archives or restores one file and logs it; nothing when it is already so. */
async function applyArchived(ctx: MutationCtx, file: Doc<"companyFiles">, archived: boolean, userId: Id<"users">): Promise<boolean> {
  if ((file.archived === true) === archived) return false;
  await ctx.db.patch(file._id, { archived: archived ? true : undefined });
  await logEvent(ctx, file, archived ? "archive" : "restore", userId);
  if (!archived) {
    // Work skipped while it was archived resumes: stale pieces and labels
    // are due again, and an original nothing was read from is read.
    const restored = { ...file, archived: undefined };
    const reading = Boolean(file.storageId) && (await companyFileNeedsServerReading(ctx, restored));
    // A file about to be read gets its pieces and labels from that text.
    await ctx.db.patch(file._id, {
      ...(!reading && file.hasText && file.searchPiecesTextHash !== file.textHash
        ? { searchPiecesDue: true as const, searchPiecesNextAt: 0, searchPiecesAttempts: undefined }
        : {}),
      ...(!reading && file.hasText && !labelsCurrent(file, file.textHash)
        ? { labelsDue: true as const, labelsNextAt: 0, labelsAttempts: undefined }
        : {}),
    });
    if (reading) {
      await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredCompanyFile, { companyFileId: file._id });
    }
  }
  return true;
}

/**
 * Removes a company file (Managers and Admins): its row, text, search pieces
 * and original, unless something else holds the original. Drafts that
 * froze it keep its text: their own copy, or the stored version they refer
 * to, which goes once no draft uses it.
 */
export const removeCompanyFile = mutation({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    await applyRemove(ctx, file, user._id);
    return null;
  },
});

/**
 * Removes one file: its row, its original (unless held elsewhere) and the
 * log line now; its text and search pieces in scheduled pages
 * (`deleteRemovedFileLeftovers`), so a removal of many large files stays
 * within one transaction's limits. Until they go, nothing reads them: text
 * is read through the row, and company search keeps only pieces of files
 * the company holds.
 */
async function applyRemove(ctx: MutationCtx, file: Doc<"companyFiles">, userId: Id<"users">): Promise<void> {
  await logEvent(ctx, file, "remove", userId);
  await ctx.db.delete(file._id);
  if (file.storageId) await deleteStorageIfUnreferenced(ctx, file.storageId);
  await ctx.scheduler.runAfter(0, internal.companyFiles.deleteRemovedFileLeftovers, { companyFileId: file._id });
}

/** Text pieces (up to 900 KB each) and search pieces one cleanup step deletes. */
const LEFTOVER_TEXT_PAGE = 8;
const LEFTOVER_SEARCH_PAGE = 200;

/**
 * A removed file's text pieces, then its search pieces, a page at a time,
 * then its stored text versions no draft uses (B1, second part). Does
 * nothing for a file that still exists.
 */
export const deleteRemovedFileLeftovers = internalMutation({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (await ctx.db.get(args.companyFileId)) return null;
    const again = () => ctx.scheduler.runAfter(0, internal.companyFiles.deleteRemovedFileLeftovers, args);
    const texts = await ctx.db
      .query("companyFileTexts")
      .withIndex("by_companyFileId_and_start", (q) => q.eq("companyFileId", args.companyFileId))
      .take(LEFTOVER_TEXT_PAGE);
    for (const piece of texts) await ctx.db.delete(piece._id);
    if (texts.length === LEFTOVER_TEXT_PAGE) {
      await again();
      return null;
    }
    const pieces = await ctx.db
      .query("documentSearchPieces")
      .withIndex("by_companyFileId_and_order", (q) => q.eq("companyFileId", args.companyFileId))
      .take(LEFTOVER_SEARCH_PAGE);
    for (const piece of pieces) await ctx.db.delete(piece._id);
    if (pieces.length === LEFTOVER_SEARCH_PAGE) {
      await again();
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.sourceTextSweep.sweepCompanyTextVersions, { companyFileId: args.companyFileId });
    return null;
  },
});

// ─── Several files at once (2026-11-04, the selection bar) ──────────────────

/** Files one Move to fiscal year or Archive call takes; the page sends more in turns. */
export const BULK_FILE_LIMIT = 200;
/** Files one Delete call takes: each brings its text and search pieces with it. */
export const BULK_REMOVE_LIMIT = 50;

/**
 * The selected files, all of this company. Refuses more than `limit`, a
 * repeated id or a file of another company; files already gone are skipped.
 */
async function selectedFiles(
  ctx: QueryCtx,
  clientId: Id<"clients">,
  ids: readonly Id<"companyFiles">[],
  limit: number
): Promise<Doc<"companyFiles">[]> {
  if (ids.length === 0) domainError("INVALID_INPUT", "Select at least one file.");
  if (ids.length > limit) domainError("INVALID_INPUT", `Select at most ${limit} files at a time.`);
  if (new Set(ids).size !== ids.length) domainError("INVALID_INPUT", "A file was selected twice.");
  const files: Doc<"companyFiles">[] = [];
  for (const id of ids) {
    const file = await ctx.db.get(id);
    if (!file) continue;
    if (file.clientId !== clientId) domainError("INVALID_INPUT", "A selected file belongs to another company.");
    files.push(file);
  }
  return files;
}

/**
 * Move to fiscal year: files the selected files under one fiscal year (null:
 * none), for everyone who may add company files. A label only, as Edit
 * details; not logged, as Edit details is not.
 */
export const setCompanyFilesFiscalYear = mutation({
  args: { clientId: v.id("clients"), companyFileIds: v.array(v.id("companyFiles")), fiscalYear: v.union(v.number(), v.null()) },
  returns: v.object({ changed: v.number() }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.add");
    await requireActiveClient(ctx, args.clientId);
    if (
      args.fiscalYear !== null &&
      (!Number.isInteger(args.fiscalYear) || args.fiscalYear < FISCAL_YEAR_MIN || args.fiscalYear > FISCAL_YEAR_MAX)
    ) {
      domainError("INVALID_INPUT", `Pick a fiscal year between ${FISCAL_YEAR_MIN} and ${FISCAL_YEAR_MAX}.`);
    }
    let changed = 0;
    for (const file of await selectedFiles(ctx, args.clientId, args.companyFileIds, BULK_FILE_LIMIT)) {
      if (file.fiscalYear === args.fiscalYear) continue;
      await ctx.db.patch(file._id, { fiscalYear: args.fiscalYear });
      changed += 1;
    }
    return { changed };
  },
});

/** Archives or restores the selected files (Managers and Admins), each logged. */
export const setCompanyFilesArchived = mutation({
  args: { clientId: v.id("clients"), companyFileIds: v.array(v.id("companyFiles")), archived: v.boolean() },
  returns: v.object({ changed: v.array(v.id("companyFiles")) }),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const changed: Id<"companyFiles">[] = [];
    for (const file of await selectedFiles(ctx, args.clientId, args.companyFileIds, BULK_FILE_LIMIT)) {
      if (await applyArchived(ctx, file, args.archived, user._id)) changed.push(file._id);
    }
    return { changed };
  },
});

/** Deletes the selected files for good (Managers and Admins), each logged, as Delete does one. */
export const removeCompanyFiles = mutation({
  args: { clientId: v.id("clients"), companyFileIds: v.array(v.id("companyFiles")) },
  returns: v.object({ removed: v.number() }),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const files = await selectedFiles(ctx, args.clientId, args.companyFileIds, BULK_REMOVE_LIMIT);
    for (const file of files) await applyRemove(ctx, file, user._id);
    return { removed: files.length };
  },
});

/**
 * The company files a project's next draft can read (Phase C), for its start
 * dialog: those a draft freezes when none is left out
 * (`eligibleCompanyFiles`), newest first. A draft reads them only while the
 * project's own frozen text leaves room in the frozen total (`frozenTotal`,
 * F5 stress run 2026-10-27), which this list cannot know without reading
 * every file: the dialog says so on each company file, and the Inputs band
 * names the ones a draft left out (2026-10-28, third). Empty for a project
 * with no active company, and for a viewer who may not read company files.
 */
export const listForProject = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    files: v.array(
      v.object({
        _id: v.id("companyFiles"),
        fileName: v.string(),
        category: v.union(categoryValidator, v.null()),
        wordCount: v.number(),
        createdAt: v.number(),
      })
    ),
    usedAtMost: v.number(),
  }),
  handler: async (ctx, args) => {
    const empty = { files: [], usedAtMost: FROZEN_COMPANY_FILES };
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access?.user.role || !hasCapability(access.user.role, "companyFiles.read")) return empty;
    const client = access.project.clientId ? await ctx.db.get(access.project.clientId) : null;
    if (!client || client.status !== "active") return empty;
    return {
      files: eligibleCompanyFiles(await companyFilesNewestFirst(ctx, client._id)).map(({ file }) => ({
        _id: file._id,
        fileName: file.fileName,
        category: file.category ?? null,
        wordCount: file.wordCount,
        createdAt: file.createdAt,
      })),
      usedAtMost: FROZEN_COMPANY_FILES,
    };
  },
});
