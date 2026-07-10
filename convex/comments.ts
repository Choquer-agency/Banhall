import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  getProjectAccess,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { applyReplacements, type PMNode } from "./lib/reportEdits";

const COMMENTER_COLORS = [
  "#818CF8",
  "#F472B6",
  "#34D399",
  "#FBBF24",
  "#60A5FA",
  "#A78BFA",
  "#FB923C",
  "#2DD4BF",
];

export const listComments = query({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind === "denied") return [];
    if (
      access.kind === "client_review" &&
      access.project.sharedReportId !== args.reportId
    ) {
      return [];
    }
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) return [];
    return await ctx.db
      .query("comments")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .take(1_000);
  },
});

export const addComment = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    commenterId: v.string(),
    highlightFrom: v.number(),
    highlightTo: v.number(),
    highlightText: v.string(),
    body: v.string(),
    suggestedEdit: v.optional(v.string()),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind === "denied") {
      domainError("NOT_AUTHORIZED", "Comment access denied");
    }
    const report = await ctx.db.get(args.reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Report does not belong to this project");
    }
    if (
      access.kind === "client_review" &&
      access.project.sharedReportId !== report._id
    ) {
      domainError("REPORT_NOT_PUBLISHED", "This report revision is not published");
    }
    const body = args.body.trim();
    const highlightText = args.highlightText.trim();
    if (!body || body.length > 5_000) {
      domainError("INVALID_INPUT", "Comment must be between 1 and 5,000 characters");
    }
    if (!highlightText || highlightText.length > 1_000) {
      domainError("INVALID_INPUT", "Selected text must be between 1 and 1,000 characters");
    }
    if (
      !Number.isInteger(args.highlightFrom) ||
      !Number.isInteger(args.highlightTo) ||
      args.highlightFrom < 0 ||
      args.highlightTo <= args.highlightFrom
    ) {
      domainError("INVALID_INPUT", "Comment selection is invalid");
    }

    let commenterType: "client" | "writer";
    let commenterId: string;
    if (access.kind === "internal") {
      commenterType = "writer";
      commenterId = access.user._id;
    } else {
      const normalizedId = ctx.db.normalizeId("commenters", args.commenterId);
      const commenter = normalizedId ? await ctx.db.get(normalizedId) : null;
      if (!commenter || commenter.projectId !== args.projectId) {
        domainError("NOT_AUTHORIZED", "Reviewer identity does not belong to this project");
      }
      commenterType = "client";
      commenterId = commenter._id;
    }

    return await ctx.db.insert("comments", {
      projectId: args.projectId,
      reportId: args.reportId,
      commenterId,
      commenterType,
      highlightFrom: args.highlightFrom,
      highlightTo: args.highlightTo,
      highlightText,
      body,
      suggestedEdit: args.suggestedEdit?.trim().slice(0, 5_000),
      resolved: false,
      createdAt: Date.now(),
    });
  },
});

export const resolveComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) domainError("NOT_FOUND", "Comment not found");
    await requireInternalProjectAccess(ctx, comment.projectId);
    await ctx.db.patch(args.commentId, { resolved: true });
  },
});

export const unresolveComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) domainError("NOT_FOUND", "Comment not found");
    await requireInternalProjectAccess(ctx, comment.projectId);
    await ctx.db.patch(args.commentId, { resolved: false });
  },
});

export const acceptEdit = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) domainError("NOT_FOUND", "Comment not found");
    if (!comment.suggestedEdit) {
      domainError("INVALID_INPUT", "This comment has no suggested edit");
    }
    await requireInternalProjectAccess(ctx, comment.projectId);
    const report = await ctx.db.get(comment.reportId);
    if (!report || report.projectId !== comment.projectId) {
      domainError("NOT_FOUND", "The commented report revision is unavailable");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(report.content);
    } catch {
      domainError("INVALID_INPUT", "The report content is not valid editor JSON");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      domainError("INVALID_INPUT", "The report content is not a valid editor document");
    }
    const document = parsed as PMNode;
    const applied = applyReplacements(document, [
      { find: comment.highlightText, replaceWith: comment.suggestedEdit },
    ]);
    if (applied.count !== 1) {
      domainError(
        "STALE_REVISION",
        applied.count === 0
          ? "The selected text no longer exists in this report revision"
          : "The selected text is ambiguous in this report revision"
      );
    }
    const content = JSON.stringify(applied.doc);
    await ctx.db.patch(report._id, {
      content,
      contentHash: await sha256(content),
      revisionNumber: (report.revisionNumber ?? 0) + 1,
      provenanceId: undefined,
      updatedAt: Date.now(),
    });
    await ctx.db.patch(args.commentId, { resolved: true });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) return;
    await requireInternalProjectAccess(ctx, comment.projectId);
    await ctx.db.delete(args.commentId);
  },
});

export const getOrCreateCommenter = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    shareToken: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind !== "client_review") {
      domainError("REPORT_NOT_PUBLISHED", "This report is not published for review");
    }
    const name = args.name.trim();
    if (!name || name.length > 100) {
      domainError("INVALID_INPUT", "Enter a reviewer name under 100 characters");
    }
    const existing = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(250);
    const found = existing.find(
      (commenter) => commenter.name.toLowerCase() === name.toLowerCase()
    );
    const commenter = found
      ? found
      : await ctx.db.get(
          await ctx.db.insert("commenters", {
            projectId: args.projectId,
            name,
            color: COMMENTER_COLORS[existing.length % COMMENTER_COLORS.length],
            createdAt: Date.now(),
          })
        );
    if (!commenter) domainError("NOT_FOUND", "Reviewer identity unavailable");
    return {
      _id: commenter._id,
      name: commenter.name,
      color: commenter.color,
    };
  },
});

export const listCommenters = query({
  args: {
    projectId: v.id("projects"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind === "denied") return [];
    const commenters = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(250);
    return commenters.map((commenter) => ({
      _id: commenter._id,
      name: commenter.name,
      color: commenter.color,
    }));
  },
});
