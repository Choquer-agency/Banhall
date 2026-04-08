import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const logView = mutation({
  args: {
    projectId: v.id("projects"),
    viewerName: v.string(),
    viewerType: v.union(v.literal("client"), v.literal("writer")),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("reportViews", {
      projectId: args.projectId,
      viewerName: args.viewerName,
      viewerType: args.viewerType,
      viewedAt: Date.now(),
    });
  },
});

export const listViews = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reportViews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const getViewSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const views = await ctx.db
      .query("reportViews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();

    const uniqueViewers = new Map<string, { name: string; type: string; lastViewed: number; count: number }>();
    for (const v of views) {
      const key = `${v.viewerName}-${v.viewerType}`;
      const existing = uniqueViewers.get(key);
      if (!existing || v.viewedAt > existing.lastViewed) {
        uniqueViewers.set(key, {
          name: v.viewerName,
          type: v.viewerType,
          lastViewed: v.viewedAt,
          count: (existing?.count ?? 0) + 1,
        });
      } else {
        existing.count += 1;
      }
    }

    return {
      totalViews: views.length,
      uniqueViewers: Array.from(uniqueViewers.values()),
    };
  },
});
