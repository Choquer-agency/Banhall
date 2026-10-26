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
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { activeClientForKey, dashboardCompanyForKey, linkKeyProjects } from "./lib/clients";
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
/** Projects a company row links when it is made from a company's name. */
const LINK_PROJECT_LIMIT = 200;

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

/** The company, active; a merged one is refused with the name of the company it joined. */
async function requireActiveClient(ctx: QueryCtx, clientId: Id<"clients">): Promise<Doc<"clients">> {
  const client = await ctx.db.get(clientId);
  if (!client) domainError("NOT_FOUND", "This company no longer exists.");
  if (client.status !== "active") {
    const kept = client.mergedIntoClientId ? await ctx.db.get(client.mergedIntoClientId) : null;
    domainError(
      "INVALID_STATE",
      kept ? `This company was merged into ${kept.name}. Add the file there.` : "This company was merged into another one.",
      { reason: "COMPANY_MERGED" }
    );
  }
  return client;
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
 * reach its files.
 */
export const ensureCompanyForKey = mutation({
  args: { key: v.string() },
  returns: v.object({ clientId: v.id("clients"), name: v.string() }),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.add");
    const existing = await activeClientForKey(ctx, args.key);
    if (existing) return { clientId: existing._id, name: existing.name };
    const company = await dashboardCompanyForKey(ctx, args.key);
    if (!company) domainError("NOT_FOUND", "This company has no projects yet. Add a project first.");
    const now = Date.now();
    const clientId = await ctx.db.insert("clients", {
      name: company.clientName,
      nameKey: args.key,
      status: "active",
      createdBy: user._id,
      createdAt: now,
      updatedAt: now,
    });
    await linkKeyProjects(ctx, args.key, clientId, LINK_PROJECT_LIMIT);
    return { clientId, name: company.clientName };
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
  },
  returns: v.id("companyFiles"),
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "companyFiles.add");
    const client = await requireActiveClient(ctx, args.clientId);
    const fileName = args.fileName.trim().slice(0, MAX_FILE_NAME_CHARS);
    if (!fileName) domainError("INVALID_INPUT", "A file needs a name");
    const facts = await companyFileTextFacts(args.content);
    const readText = hasReadText(args.content);
    // The same name with the same read text is the same file. Files with
    // nothing read are never merged: two unreadable files are two files.
    const duplicate = readText
      ? (
          await ctx.db
            .query("companyFiles")
            .withIndex("by_clientId_and_textHash", (q) => q.eq("clientId", client._id).eq("textHash", facts.textHash))
            .take(20)
        ).find((file) => file.fileName === fileName && !file.archived)
      : undefined;
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
