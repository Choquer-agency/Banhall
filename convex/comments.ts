import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { assertProjectAccess, assertProjectOwner } from "./lib/auth";

const COMMENTER_COLORS = [
  "#818CF8", // indigo
  "#F472B6", // pink
  "#34D399", // emerald
  "#FBBF24", // amber
  "#60A5FA", // blue
  "#A78BFA", // violet
  "#FB923C", // orange
  "#2DD4BF", // teal
];

export const listComments = query({
  args: {
    projectId: v.id("projects"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectAccess(
      ctx,
      args.projectId,
      args.shareToken
    );
    if (!project) return [];

    return await ctx.db
      .query("comments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const addComment = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("reports"),
    commenterId: v.string(),
    commenterType: v.union(v.literal("client"), v.literal("writer")),
    highlightFrom: v.number(),
    highlightTo: v.number(),
    highlightText: v.string(),
    body: v.string(),
    suggestedEdit: v.optional(v.string()),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectAccess(
      ctx,
      args.projectId,
      args.shareToken
    );
    if (!project) throw new Error("Not authorized");

    if (args.body.length > 5000) throw new Error("Comment too long");
    if (args.highlightText.length > 1000)
      throw new Error("Highlight text too long");

    const { shareToken, ...commentData } = args;
    return await ctx.db.insert("comments", {
      ...commentData,
      resolved: false,
      createdAt: Date.now(),
    });
  },
});

export const resolveComment = mutation({
  args: {
    commentId: v.id("comments"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    const project = await assertProjectAccess(
      ctx,
      comment.projectId,
      args.shareToken
    );
    if (!project) throw new Error("Not authorized");

    await ctx.db.patch(args.commentId, { resolved: true });
  },
});

export const acceptEdit = mutation({
  args: {
    commentId: v.id("comments"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");
    if (!comment.suggestedEdit) throw new Error("No suggested edit on this comment");

    const project = await ctx.db.get(comment.projectId);
    if (!project || project.createdBy !== userId) throw new Error("Not authorized");

    // Get the latest report
    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", comment.projectId))
      .order("desc")
      .first();
    if (!report) throw new Error("Report not found");

    // Apply the edit: find the highlighted text and replace it
    const doc = JSON.parse(report.content);
    const docText = extractDocText(doc);
    const editedText = docText.replace(comment.highlightText, comment.suggestedEdit);

    if (editedText !== docText) {
      // Rebuild doc with the edit applied — simple text replacement in paragraph nodes
      const updatedContent = JSON.stringify(applyTextReplace(doc, comment.highlightText, comment.suggestedEdit));
      await ctx.db.patch(report._id, { content: updatedContent, updatedAt: Date.now() });
    }

    // Resolve the comment
    await ctx.db.patch(args.commentId, { resolved: true });
  },
});

function extractDocText(doc: { content?: Array<{ content?: Array<{ text?: string }> }> }): string {
  if (!doc.content) return "";
  return doc.content
    .map((node) =>
      node.content?.map((c) => c.text ?? "").join("") ?? ""
    )
    .join("\n");
}

function applyTextReplace(
  doc: Record<string, unknown>,
  oldText: string,
  newText: string
): Record<string, unknown> {
  const content = doc.content as Array<Record<string, unknown>> | undefined;
  if (!content) return doc;

  return {
    ...doc,
    content: content.map((node) => {
      const children = node.content as Array<Record<string, unknown>> | undefined;
      if (!children) return node;

      return {
        ...node,
        content: children.map((child) => {
          if (child.type === "text" && typeof child.text === "string" && child.text.includes(oldText)) {
            return { ...child, text: child.text.replace(oldText, newText) };
          }
          return child;
        }),
      };
    }),
  };
}

export const unresolveComment = mutation({
  args: {
    commentId: v.id("comments"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    const project = await assertProjectAccess(
      ctx,
      comment.projectId,
      args.shareToken
    );
    if (!project) throw new Error("Not authorized");

    await ctx.db.patch(args.commentId, { resolved: false });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.commentId);
    if (!comment) throw new Error("Comment not found");

    const project = await assertProjectOwner(ctx, comment.projectId);
    if (!project) throw new Error("Not authorized");

    await ctx.db.delete(args.commentId);
  },
});

// ─── Commenters (client-side name gate) ──────────────────────────────────────

export const getOrCreateCommenter = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectAccess(
      ctx,
      args.projectId,
      args.shareToken
    );
    if (!project) throw new Error("Not authorized");

    if (args.name.trim().length === 0) throw new Error("Name is required");
    if (args.name.length > 100) throw new Error("Name too long");

    // Check if this name already exists for this project
    const existing = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const found = existing.find(
      (c) => c.name.toLowerCase() === args.name.toLowerCase()
    );
    if (found) return found;

    // Assign a color based on how many commenters exist
    const color = COMMENTER_COLORS[existing.length % COMMENTER_COLORS.length];

    const id = await ctx.db.insert("commenters", {
      projectId: args.projectId,
      name: args.name.trim(),
      color,
      createdAt: Date.now(),
    });

    return await ctx.db.get(id);
  },
});

export const listCommenters = query({
  args: {
    projectId: v.id("projects"),
    shareToken: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await assertProjectAccess(
      ctx,
      args.projectId,
      args.shareToken
    );
    if (!project) return [];

    return await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
