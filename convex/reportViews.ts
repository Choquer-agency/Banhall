import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  getProjectAccess,
  requireCurrentUser,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";

export const logClientView = mutation({
  args: {
    projectId: v.id("projects"),
    shareToken: v.string(),
    viewerName: v.string(),
  },
  handler: async (ctx, args) => {
    const access = await getProjectAccess(ctx, args.projectId, args.shareToken);
    if (access.kind !== "client_review") {
      domainError("REPORT_NOT_PUBLISHED", "This report is not published for review");
    }
    const viewerName = args.viewerName.trim();
    if (!viewerName || viewerName.length > 100) {
      domainError("INVALID_INPUT", "Enter a reviewer name under 100 characters");
    }
    const reportId = access.project.sharedReportId;
    if (!reportId) {
      domainError("REPORT_NOT_PUBLISHED", "This report is not published for review");
    }
    const report = await ctx.db.get(reportId);
    if (!report || report.projectId !== args.projectId) {
      domainError("REPORT_NOT_PUBLISHED", "This report is not published for review");
    }
    await ctx.db.insert("reportViews", {
      projectId: args.projectId,
      reportId: report._id,
      reportVersion: report.version,
      revisionNumber: report.revisionNumber ?? 0,
      contentHash: report.contentHash,
      viewerName,
      viewerType: "client",
      viewedAt: Date.now(),
    });
  },
});

export const logWriterView = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const { user } = await requireInternalProjectAccess(ctx, args.projectId);
    const report = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    await ctx.db.insert("reportViews", {
      projectId: args.projectId,
      reportId: report?._id,
      reportVersion: report?.version,
      revisionNumber: report?.revisionNumber,
      contentHash: report?.contentHash,
      viewerName: user.name ?? user.email ?? "Writer",
      viewerType: "writer",
      viewedAt: Date.now(),
    });
  },
});

export const listViews = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    const views = await ctx.db
      .query("reportViews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(1_000);
    return views.map((view) => ({
      id: view._id,
      viewerName: view.viewerName,
      viewerType: view.viewerType,
      viewedAt: view.viewedAt,
      reportId: view.reportId,
      reportVersion: view.reportVersion,
      revisionNumber: view.revisionNumber,
      revisionAvailable: Boolean(view.reportId),
    }));
  },
});

export const getViewSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    const views = await ctx.db
      .query("reportViews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(1_000);
    const uniqueViewers = new Map<
      string,
      { name: string; type: "client" | "writer"; lastViewed: number; count: number }
    >();
    for (const view of views) {
      const key = `${view.viewerName}\u0000${view.viewerType}`;
      const existing = uniqueViewers.get(key);
      if (existing) {
        existing.count += 1;
        existing.lastViewed = Math.max(existing.lastViewed, view.viewedAt);
      } else {
        uniqueViewers.set(key, {
          name: view.viewerName,
          type: view.viewerType,
          lastViewed: view.viewedAt,
          count: 1,
        });
      }
    }
    return {
      totalViews: views.length,
      truncated: views.length === 1_000,
      uniqueViewers: Array.from(uniqueViewers.values()),
    };
  },
});

export const getLastViewedMap = query({
  args: {},
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    const projects = await ctx.db.query("projects").take(500);
    const result: Record<string, number> = {};
    for (const project of projects) {
      const last = await ctx.db
        .query("reportViews")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .order("desc")
        .first();
      if (last) result[project._id] = last.viewedAt;
    }
    return result;
  },
});
