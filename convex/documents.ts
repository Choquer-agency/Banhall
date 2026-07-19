import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";

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

/** Short-lived URL the client POSTs the original file bytes to. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const uploadDocument = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.optional(v.id("reports")),
    fileName: v.string(),
    fileType: fileTypeValidator,
    content: v.string(),
    source: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    category: v.optional(categoryValidator),
  },
  handler: async (ctx, args) => {
    const { project, user } = await requireInternalProjectAccess(ctx, args.projectId);
    if (args.reportId) {
      const report = await ctx.db.get(args.reportId);
      if (!report || report.projectId !== project._id) {
        domainError("INVALID_INPUT", "Report does not belong to this project");
      }
    }

    // Dedupe: same file (name + content) already in this project → reuse it.
    const existingDocs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    const dup = existingDocs.find(
      (d) => d.fileName === args.fileName && d.content === args.content
    );
    if (dup) {
      if (!dup.storageId && args.storageId) {
        // Upgrade a text-only record with the freshly stored original bytes.
        await ctx.db.patch(dup._id, {
          storageId: args.storageId,
          ...(args.mimeType ? { mimeType: args.mimeType } : {}),
        });
      } else if (args.storageId && dup.storageId !== args.storageId) {
        // Already have the file — drop the orphaned re-upload.
        await ctx.storage.delete(args.storageId);
      }
      return dup._id;
    }

    return await ctx.db.insert("projectDocuments", {
      projectId: args.projectId,
      ...(args.reportId ? { reportId: args.reportId } : {}),
      fileName: args.fileName,
      fileType: args.fileType,
      content: args.content,
      ...(args.storageId ? { storageId: args.storageId } : {}),
      ...(args.mimeType ? { mimeType: args.mimeType } : {}),
      ...(args.category ? { category: args.category } : {}),
      source: args.source ?? "chat_upload",
      uploadedBy: user._id,
      createdAt: Date.now(),
    });
  },
});

export const listDocuments = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];

    const docs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    // Metadata + a download URL for files with stored bytes.
    return await Promise.all(
      docs.map(async (d) => ({
        _id: d._id,
        fileName: d.fileName,
        fileType: d.fileType,
        source: d.source,
        category: d.category ?? null,
        createdAt: d.createdAt,
        sizeChars: d.content.length,
        hasFile: !!d.storageId,
        mimeType: d.mimeType ?? null,
        url: d.storageId ? await ctx.storage.getUrl(d.storageId) : null,
        archived: d.archived ?? false,
      }))
    );
  },
});

/** BNH-24: archive (or restore) a file — keeps it visible but out of AI context. */
export const setDocumentArchived = mutation({
  args: { documentId: v.id("projectDocuments"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    await requireInternalProjectAccess(ctx, doc.projectId);
    await ctx.db.patch(args.documentId, { archived: args.archived });
  },
});

/** Full extracted text for the preview pane (only fetched on demand). */
export const getDocumentContent = query({
  args: { documentId: v.id("projectDocuments") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) return null;
    if (!(await getInternalProjectAccessOrNull(ctx, doc.projectId))) return null;
    return { fileName: doc.fileName, fileType: doc.fileType, content: doc.content };
  },
});

export const deleteDocument = mutation({
  args: { documentId: v.id("projectDocuments") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.documentId);
    if (!doc) throw new Error("Document not found");
    await requireInternalProjectAccess(ctx, doc.projectId);
    if (doc.storageId) await ctx.storage.delete(doc.storageId);
    await ctx.db.delete(args.documentId);
  },
});

/**
 * Internal: categorized contextual-input docs for the generation pipeline
 * (BNH-9). Returns category + text (capped) so the analyzer can weight them.
 */
export const getContextDocsForGeneration = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    return docs
      .filter((d) => !d.archived && d.category && d.content.trim().length > 0)
      .map((d) => ({
        category: d.category!,
        fileName: d.fileName,
        content: d.content.slice(0, 15000),
      }));
  },
});
