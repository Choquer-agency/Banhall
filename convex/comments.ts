import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
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
