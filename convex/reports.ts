import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertProjectAccess, assertProjectOwner } from "./lib/auth";

export const getLatestReport = query({
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
    if (!project) return null;

    return await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const updateReportContent = mutation({
  args: {
    reportId: v.id("reports"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");

    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");

    await ctx.db.patch(args.reportId, {
      content: args.content,
      updatedAt: Date.now(),
    });
  },
});
