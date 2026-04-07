import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("comments", {
      ...args,
      resolved: false,
      createdAt: Date.now(),
    });
  },
});

export const resolveComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, { resolved: true });
  },
});

export const unresolveComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.commentId, { resolved: false });
  },
});

export const deleteComment = mutation({
  args: { commentId: v.id("comments") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.commentId);
  },
});

// ─── Commenters (client-side name gate) ──────────────────────────────────────

export const getOrCreateCommenter = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
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
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
