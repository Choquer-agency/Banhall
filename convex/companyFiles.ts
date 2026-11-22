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
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { domainError } from "./lib/contracts";
import { requireCapability } from "./lib/roleCapabilities";
import { activeClientForKey, companyFilesMovingInto, dashboardCompanyForKey, MERGE_CHAIN_HOPS } from "./lib/clients";
import { DASHBOARD_UNNAMED_COMPANY_KEY } from "../shared/dashboardProjection";
import { requireAttemptKey } from "./lib/uploadAttempts";
import { labelsCurrent } from "./lib/fileLabels";
import { companyFileNeedsServerReading } from "./companyFileWork";
import {
  companyDraftSubject,
  draftCompanyFiles,
  FROZEN_COMPANY_FILES,
  PINNED_FINAL_PDS,
  projectHasOwnPreviousYearReport,
} from "./lib/briefEvidence";
import { isCompanyHistoryCategory } from "./lib/companyEvidence";
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
import { COMPANY_FILE_PAGE_SIZE, COMPANY_FILE_SEARCH_LIMIT } from "../shared/companyFileMoves";
import { fileNameTerms, searchQueryWords } from "../shared/fileNameTerms";

const MAX_FILE_NAME_CHARS = 300;
/** Files the old company page list (`listCompanyFiles`) lists; kept until the paged list has shipped. */
export const COMPANY_FILE_LIST_LIMIT = 500;
/** Rows each search index gives a name search before its names are checked (review P2-1). */
const SEARCH_CANDIDATES = 200;
/** Company files one run of the `fileNameTerms` backfill reads. */
const BACKFILL_PAGE = 200;
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

/** The categories a person picks for a file added by hand. */
const categoryValidator = v.union(
  v.literal("previous_pd"),
  v.literal("scoping_notes"),
  v.literal("writer_notes"),
  v.literal("background"),
  v.literal("other")
);

/**
 * Every category a company file can hold: a person's, and since 2026-11-17
 * the ones an approved Import file keeps (`COMPANY_HISTORY_CATEGORIES`).
 */
const storedCategoryValidator = v.union(
  categoryValidator,
  v.literal("final_pd"),
  v.literal("draft"),
  v.literal("review_copy"),
  v.literal("transcript"),
  v.literal("supporting")
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
        if (
          needsServerReading({
            fileName: duplicate.fileName,
            storageId: args.storageId,
            hasReadText: duplicate.hasText,
          })
        ) {
          await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredCompanyFile, {
            companyFileId: duplicate._id,
          });
        }
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
      fileNameTerms: fileNameTerms(fileName),
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

// ─── A company file from an approved Import file (2026-11-17) ───────────────

/** A company file's type from its name, for a file Import approved. */
export function companyFileTypeForName(fileName: string): Doc<"companyFiles">["fileType"] {
  const dot = fileName.lastIndexOf(".");
  const ext = dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
  if (ext === "pdf" || ext === "docx" || ext === "txt" || ext === "md" || ext === "msg" || ext === "eml") return ext;
  if (ext === "vtt") return "txt";
  if (ext === "xlsx" || ext === "xls" || ext === "csv") return "xlsx";
  if (["png", "jpg", "jpeg", "gif", "webp", "heic", "tif", "tiff"].includes(ext)) return "image";
  return "other";
}

const IMPORTED_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  vtt: "text/vtt",
  md: "text/markdown",
};

export type ImportedCompanyFile = {
  clientId: Id<"clients">;
  importItemId: Id<"ingestionItems">;
  fileName: string;
  category: NonNullable<Doc<"companyFiles">["category"]>;
  /** The Import file's original, shared with it (never copied). */
  storageId?: Id<"_storage">;
  /** The Import file's whole text when it has it; otherwise the original is read again on the server. */
  text: string | null;
  fiscalYear?: number;
  pdNumber?: string;
  writerId?: Id<"pdWriters">;
  reviewerId?: Id<"pdWriters">;
  importLabels?: Doc<"companyFiles">["importLabels"];
  addedBy: Doc<"users">;
};

/**
 * Puts an approved Import file on its company's page (2026-11-17, Approve on
 * Import), the way `addCompanyFile` adds one: its text in pieces, marked due
 * for search pieces (then labels), the add logged. The original is the
 * Import file's own stored file, shared: removing the company file deletes
 * it only when nothing else holds it (`deleteStorageIfUnreferenced`), and
 * the Import file always does. With no whole text from Import (a file read
 * long ago with only its preview, or one whose text was cut at Import's
 * limit), the file is added with no text and the original is read on the
 * server, as for a file a person adds. Made once per Import file: a retry
 * finds the row it made (`by_importItemId`). Returns the row and whether
 * the server reads it.
 */
export async function addImportedCompanyFile(
  ctx: MutationCtx,
  file: ImportedCompanyFile
): Promise<{ companyFileId: Id<"companyFiles">; created: boolean; readOnServer: boolean }> {
  const existing = await ctx.db
    .query("companyFiles")
    .withIndex("by_importItemId", (q) => q.eq("importItemId", file.importItemId))
    .first();
  if (existing) return { companyFileId: existing._id, created: false, readOnServer: false };
  const fileName = file.fileName.trim().slice(0, MAX_FILE_NAME_CHARS) || "Imported file";
  const content = file.text ?? "";
  const facts = await companyFileTextFacts(content);
  const derived = deriveProcessingStatus({ fileName, content, extractionFailed: false });
  const dot = fileName.lastIndexOf(".");
  const mimeType = IMPORTED_MIME_TYPES[dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase()];
  const now = Date.now();
  const companyFileId = await ctx.db.insert("companyFiles", {
    clientId: file.clientId,
    fileName,
    fileNameTerms: fileNameTerms(fileName),
    fileType: companyFileTypeForName(fileName),
    category: file.category,
    ...(mimeType ? { mimeType } : {}),
    ...(file.storageId ? { storageId: file.storageId } : {}),
    ...facts,
    processingStatus: derived.status,
    ...(derived.detail ? { processingDetail: derived.detail } : {}),
    uploadedBy: file.addedBy._id,
    ...(file.addedBy.role ? { uploaderRole: file.addedBy.role } : {}),
    createdAt: now,
    ...(facts.hasText ? { searchPiecesDue: true as const, searchPiecesNextAt: 0 } : {}),
    ...(file.fiscalYear !== undefined ? { fiscalYear: file.fiscalYear } : {}),
    importItemId: file.importItemId,
    ...(file.writerId ? { writerId: file.writerId } : {}),
    ...(file.reviewerId ? { reviewerId: file.reviewerId } : {}),
    ...(file.pdNumber ? { pdNumber: file.pdNumber } : {}),
    ...(file.importLabels ? { importLabels: file.importLabels } : {}),
  });
  if (content) await insertCompanyFileTextPieces(ctx, companyFileId, content);
  await logEvent(ctx, { _id: companyFileId, clientId: file.clientId, fileName }, "add", file.addedBy._id);
  const readOnServer = needsServerReading({
    fileName,
    ...(file.storageId ? { storageId: file.storageId } : {}),
    hasReadText: hasReadText(content),
  });
  if (readOnServer) {
    await ctx.scheduler.runAfter(0, internal.ai.fileReading.readStoredCompanyFile, { companyFileId });
  }
  return { companyFileId, created: true, readOnServer };
}

const listedFileValidator = v.object({
  _id: v.id("companyFiles"),
  fileName: v.string(),
  fileType: fileTypeValidator,
  category: v.union(storedCategoryValidator, v.null()),
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
  /**
   * 2026-11-17: the Import category of a file Import approved that a person
   * filed under another category since, which Edit details can give back.
   */
  importCategory: v.optional(storedCategoryValidator),
  labels: v.union(
    v.null(),
    v.object({ documentType: v.string(), fiscalYear: v.union(v.number(), v.null()), title: v.string(), summary: v.string() })
  ),
});

/**
 * The Import category a person moved an Import file away from, read from
 * its Import file only for such a file (rare), so the list reads no Import
 * row for any other.
 */
async function movedImportCategory(
  ctx: QueryCtx,
  row: Doc<"companyFiles">
): Promise<{ importCategory?: "final_pd" | "draft" | "review_copy" | "transcript" | "supporting" }> {
  if (!row.importItemId || isCompanyHistoryCategory(row.category)) return {};
  const category = (await ctx.db.get(row.importItemId))?.category;
  return isCompanyHistoryCategory(category) ? { importCategory: category } : {};
}

/** What the Files tab shows of one file, read once per uploader name. */
async function listedFile(
  ctx: QueryCtx,
  row: Doc<"companyFiles">,
  websiteFileId: Id<"companyFiles"> | null,
  names: Map<string, string | null>
) {
  let addedBy = names.get(row.uploadedBy);
  if (addedBy === undefined) {
    const uploader = await ctx.db.get(row.uploadedBy);
    addedBy = uploader?.name ?? uploader?.email ?? null;
    names.set(row.uploadedBy, addedBy);
  }
  return {
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
    ...(await movedImportCategory(ctx, row)),
    labels: row.labels
      ? {
          documentType: row.labels.documentType,
          fiscalYear: row.labels.fiscalYear,
          title: row.labels.title,
          summary: row.labels.summary,
        }
      : null,
  };
}

/**
 * A company's files, newest first: active ones, or the archived ones, up
 * to COMPANY_FILE_LIST_LIMIT. Kept as it was for the frontend that is live
 * while the backend deploys first (2026-11-18); the Files tab now pages
 * with `listCompanyFilesPage`. Remove this in a later narrow step.
 */
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
    for (const row of rows.slice(0, COMPANY_FILE_LIST_LIMIT)) files.push(await listedFile(ctx, row, websiteFileId, names));
    return { files, truncated: rows.length > COMPANY_FILE_LIST_LIMIT };
  },
});

/**
 * 2026-11-18 (owner answer 3, "a company holds all its files"): a
 * company's files, newest first, one page at a time, active ones or the
 * archived ones, with no cap on how many the company holds. A page holds
 * at most COMPANY_FILE_PAGE_SIZE files whatever the caller asks, so each
 * read stays bounded. Same rows as `listCompanyFiles`.
 */
export const listCompanyFilesPage = query({
  args: { clientId: v.id("clients"), archived: v.optional(v.boolean()), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(listedFileValidator),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.read");
    const result = await ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_archived", (q) =>
        q.eq("clientId", args.clientId).eq("archived", args.archived ? true : undefined)
      )
      .order("desc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(args.paginationOpts.numItems, COMPANY_FILE_PAGE_SIZE)),
      });
    const websiteFileId = (await ctx.db.get(args.clientId))?.websiteFileId ?? null;
    const names = new Map<string, string | null>();
    const page = [];
    for (const row of result.page) page.push(await listedFile(ctx, row, websiteFileId, names));
    return { ...result, page };
  },
});

/**
 * 2026-11-18: files of a company whose names match a search, active and
 * archived, at most COMPANY_FILE_SEARCH_LIMIT. The Files tab asks only
 * while some of the company's files are not loaded, so Find a file also
 * finds an old one.
 *
 * Review P2-1: the tab's own filter finds any part of a name, and Convex
 * search matches whole words and the start of the last one. So the search
 * asks for the query's parts (`searchQueryWords`: "fy2021" asks for fy and
 * 2021) in the name's own words and their parts (`search_fileNameTerms`),
 * and, for rows made before `fileNameTerms` existed and not yet filled, the
 * search as typed in the name itself (`search_fileName`, as before). Each reads at most
 * SEARCH_CANDIDATES rows, and a row is returned only when its name holds
 * the search as typed, as the tab's filter would show it, so the two never
 * disagree. What it cannot find: a piece inside a word that does not start
 * at a word, a number or a capital letter ("cme" in "Acme").
 */
export const searchCompanyFiles = query({
  args: { clientId: v.id("clients"), search: v.string() },
  returns: v.object({ files: v.array(listedFileValidator) }),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.read");
    const search = args.search.trim().slice(0, MAX_FILE_NAME_CHARS);
    const words = searchQueryWords(search);
    if (!search || words.length === 0) return { files: [] };
    const wanted = search.toLowerCase();
    const asked = words.join(" ");
    // Convex search takes at most 16 words; keep the last 16 of the text as typed.
    const typed = search.split(/\s+/).slice(-16).join(" ");
    const byTerms = await ctx.db
      .query("companyFiles")
      .withSearchIndex("search_fileNameTerms", (q) => q.search("fileNameTerms", asked).eq("clientId", args.clientId))
      .take(SEARCH_CANDIDATES);
    const byName = await ctx.db
      .query("companyFiles")
      .withSearchIndex("search_fileName", (q) => q.search("fileName", typed).eq("clientId", args.clientId))
      .take(SEARCH_CANDIDATES);
    const seen = new Set<Id<"companyFiles">>();
    const rows: Doc<"companyFiles">[] = [];
    for (const row of [...byTerms, ...byName]) {
      if (seen.has(row._id) || !row.fileName.toLowerCase().includes(wanted)) continue;
      seen.add(row._id);
      rows.push(row);
      if (rows.length === COMPANY_FILE_SEARCH_LIMIT) break;
    }
    const websiteFileId = (await ctx.db.get(args.clientId))?.websiteFileId ?? null;
    const names = new Map<string, string | null>();
    const files = [];
    for (const row of rows) files.push(await listedFile(ctx, row, websiteFileId, names));
    return { files };
  },
});

/**
 * 2026-11-18 (review P2-1): fills `fileNameTerms` on company files made
 * before it existed, BACKFILL_PAGE rows a run in creation order, scheduling
 * itself until every row is read. Run once after the backend deploys
 * (`companyFiles:backfillCompanyFileNameTerms` with no arguments); safe to
 * run again, and a row whose words are already right is not written.
 * Until a row is filled, search still finds it by its name's whole words.
 */
export const backfillCompanyFileNameTerms = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), filled: v.optional(v.number()) },
  returns: v.object({ filled: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("companyFiles").paginate({ cursor: args.cursor ?? null, numItems: BACKFILL_PAGE });
    let filled = args.filled ?? 0;
    for (const row of page.page) {
      const terms = fileNameTerms(row.fileName);
      if (row.fileNameTerms === terms) continue;
      await ctx.db.patch(row._id, { fileNameTerms: terms });
      filled += 1;
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.companyFiles.backfillCompanyFileNameTerms, { cursor: page.continueCursor, filled });
      return { filled, done: false };
    }
    console.log(`backfillCompanyFileNameTerms: done, ${filled} company files filled`);
    return { filled, done: true };
  },
});

/**
 * Edit details (2026-11-04): a company file's category and the fiscal year
 * it is filed under, for everyone who may add company files. A null
 * category clears it; a null year says the file has none (the AI label's
 * year is no longer shown). The year was a label only until 2026-11-17;
 * since then a draft pins a final PD by it.
 *
 * 2026-11-17: an Import category (final PD, draft, review copy, transcript,
 * supporting file) is kept when a file already has it, and can be given
 * back to a file Import approved under it (`importItemId`, the Import
 * file's own category) after a person changed it; no person files any
 * other file into one: a final PD a person picked would be pinned in
 * drafts without coming from Import.
 */
export const updateCompanyFileDetails = mutation({
  args: {
    companyFileId: v.id("companyFiles"),
    category: v.union(storedCategoryValidator, v.null()),
    fiscalYear: v.union(v.number(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireCapability(ctx, "companyFiles.add");
    const file = await ctx.db.get(args.companyFileId);
    if (!file) domainError("NOT_FOUND", "This file no longer exists.");
    await requireActiveClient(ctx, file.clientId);
    if (isCompanyHistoryCategory(args.category) && args.category !== file.category) {
      const item = file.importItemId ? await ctx.db.get(file.importItemId) : null;
      if (item?.category !== args.category) {
        domainError("INVALID_INPUT", "Only Import can set this category. Pick another category.");
      }
    }
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
      fileNameTerms: fileNameTerms(fileName),
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
  const client = await ctx.db.get(file.clientId);
  if (client && client.websiteFileId === file._id) {
    await ctx.db.patch(client._id, { websiteFileId: undefined });
  }
  await ctx.db.delete(file._id);
  if (file.storageId) await deleteStorageIfUnreferenced(ctx, file.storageId);
  await ctx.scheduler.runAfter(0, internal.companyFiles.deleteRemovedFileLeftovers, { companyFileId: file._id });
}

/**
 * Send back to review on Import (2026-11-17): removes the company file an
 * approval made, by the company file delete path (applyRemove), logged with
 * the Admin who sent it back. Its original is the Import file's own and is
 * kept, since the Import file still holds it (deleteStorageIfUnreferenced);
 * drafts that froze it keep the text versions they read. Returns false when
 * the file was already removed by hand, or is not this Import file's.
 */
export async function removeImportedCompanyFile(
  ctx: MutationCtx,
  companyFileId: Id<"companyFiles">,
  importItemId: Id<"ingestionItems">,
  userId: Id<"users">
): Promise<boolean> {
  const file = await ctx.db.get(companyFileId);
  if (!file || file.importItemId !== importItemId) return false;
  await applyRemove(ctx, file, userId);
  return true;
}

/** What an edit after approval changes on the company file an Import file became. */
export type ImportedCompanyFileLabels = {
  writerId?: Id<"pdWriters"> | null;
  reviewerId?: Id<"pdWriters"> | null;
  pdTitle?: string | null;
  scienceCode?: string | null;
  craReviewed?: boolean;
};

/**
 * Edit after approval on Import (2026-11-17): the company file's own fields
 * follow its Import file's metadata (the writer and reviewer it points at,
 * and the labels it stores in `importLabels`). Never its text, original,
 * category, fiscal year or company. Returns false when the file is gone or
 * is not this Import file's, true when it was found (changed or not).
 */
export async function updateImportedCompanyFileLabels(
  ctx: MutationCtx,
  companyFileId: Id<"companyFiles">,
  importItemId: Id<"ingestionItems">,
  change: ImportedCompanyFileLabels
): Promise<boolean> {
  const file = await ctx.db.get(companyFileId);
  if (!file || file.importItemId !== importItemId) return false;
  const patch: Partial<Doc<"companyFiles">> = {};
  if (change.writerId !== undefined && (file.writerId ?? null) !== change.writerId) patch.writerId = change.writerId ?? undefined;
  if (change.reviewerId !== undefined && (file.reviewerId ?? null) !== change.reviewerId) patch.reviewerId = change.reviewerId ?? undefined;
  const labels = { ...(file.importLabels ?? {}) };
  let labelsChanged = false;
  const setLabel = <K extends "pdTitle" | "scienceCode">(key: K, value: string | null | undefined) => {
    if (value === undefined) return;
    const next = value ?? undefined;
    if (labels[key] === next) return;
    if (next === undefined) delete labels[key];
    else labels[key] = next;
    labelsChanged = true;
  };
  setLabel("pdTitle", change.pdTitle);
  setLabel("scienceCode", change.scienceCode);
  if (change.craReviewed !== undefined && (labels.craReviewed === true) !== change.craReviewed) {
    if (change.craReviewed) labels.craReviewed = true;
    else delete labels.craReviewed;
    labelsChanged = true;
  }
  if (labelsChanged) patch.importLabels = Object.keys(labels).length > 0 ? labels : undefined;
  if (Object.keys(patch).length > 0) await ctx.db.patch(file._id, patch);
  return true;
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
 * dialog: those a draft freezes when none is left out (`draftCompanyFiles`:
 * the files added by hand, newest first, as before, then since 2026-11-17
 * the pinned final PDs; since 2026-11-18, third, `previousYear` marks the
 * one read as the project's previous-year report). A draft reads them only while the
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
        category: v.union(storedCategoryValidator, v.null()),
        wordCount: v.number(),
        createdAt: v.number(),
        /** 2026-11-18 (third): last year's final PD a draft reads as the project's previous-year report. */
        previousYear: v.boolean(),
      })
    ),
    usedAtMost: v.number(),
    /**
     * 2026-11-18: files of a company merged into this one are still moving
     * here, so a draft is refused until they all have (the dialog says so).
     */
    filesMoving: v.optional(v.boolean()),
  }),
  handler: async (ctx, args) => {
    const empty: { files: never[]; usedAtMost: number; filesMoving?: boolean } = { files: [], usedAtMost: FROZEN_COMPANY_FILES + PINNED_FINAL_PDS };
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access?.user.role || !hasCapability(access.user.role, "companyFiles.read")) return empty;
    const client = access.project.clientId ? await ctx.db.get(access.project.clientId) : null;
    if (!client || client.status !== "active") return empty;
    const subject = companyDraftSubject(access.project, client);
    // 2026-11-18 (third): the project's own previous-year file decides as a
    // draft's freeze does. Its file rows are read only when a pinned PD
    // would count, stopping at the first previous-year file and within a
    // byte budget (an older row holds its text); a read that stopped early
    // counts no PD.
    const ownPreviousYearReport = () => projectHasOwnPreviousYearReport(ctx, access.project._id);
    return {
      files: (await draftCompanyFiles(ctx, client._id, subject, undefined, ownPreviousYearReport)).map(({ file, previousYear }) => ({
        _id: file._id,
        fileName: file.fileName,
        category: file.category ?? null,
        wordCount: file.wordCount,
        createdAt: file.createdAt,
        previousYear,
      })),
      usedAtMost: FROZEN_COMPANY_FILES + PINNED_FINAL_PDS,
      ...((await companyFilesMovingInto(ctx, client._id)) ? { filesMoving: true } : {}),
    };
  },
});
