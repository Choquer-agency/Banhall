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
import { activeClientForKey, dashboardCompanyForKey } from "./lib/clients";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { requireAttemptKey } from "./lib/uploadAttempts";
import { labelsCurrent } from "./lib/fileLabels";
import { companyFileNeedsServerReading } from "./companyFileWork";
import { deriveProcessingStatus } from "../shared/documentStatus";
import {
  companyFileTextFacts,
  deleteCompanyFileText,
  insertCompanyFileTextPieces,
  readCompanyFileText,
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
/** Merges followed to name the company a merged one ended up in. */
const MERGE_CHAIN_HOPS = 10;

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
  otherClientId?: Id<"clients">
): Promise<void> {
  await ctx.db.insert("companyFileEvents", {
    clientId: file.clientId,
    companyFileId: file._id,
    fileName: file.fileName,
    action,
    ...(otherClientId ? { otherClientId } : {}),
    userId,
    at: Date.now(),
  });
}

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
 * was merged meanwhile) stops the chain: the merge links projects itself.
 */
async function linkKeyProjectsPage(
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
    if ((file.archived === true) === args.archived) return null;
    await ctx.db.patch(file._id, { archived: args.archived ? true : undefined });
    await logEvent(ctx, file, args.archived ? "archive" : "restore", user._id);
    if (!args.archived) {
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
    return null;
  },
});

/**
 * Removes a company file (Managers and Admins): its row, text, search pieces
 * and original, unless something else holds the original. Drafts that
 * froze it keep their own copy.
 */
export const removeCompanyFile = mutation({
  args: { companyFileId: v.id("companyFiles") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.manage");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) return null;
    await logEvent(ctx, file, "remove", user._id);
    await deleteCompanyFileText(ctx, file._id);
    await ctx.db.delete(file._id);
    if (file.storageId) await deleteStorageIfUnreferenced(ctx, file.storageId);
    return null;
  },
});
