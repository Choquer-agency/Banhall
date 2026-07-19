import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const breadcrumbValidator = v.object({
  type: v.string(),
  label: v.string(),
  detail: v.optional(v.string()),
  at: v.number(),
});

/**
 * Record an error report. Intentionally public and usable while unauthenticated
 * — the whole point is that anyone hitting an error (including clients on a
 * shared review link) can send it. If the caller is signed in we stamp their
 * id/email so we know who reported it.
 */
export const reportError = mutation({
  args: {
    kind: v.union(v.literal("auto"), v.literal("manual")),
    reportType: v.optional(v.union(v.literal("bug"), v.literal("feature"))),
    message: v.string(),
    stack: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.string(),
    userNote: v.optional(v.string()),
    breadcrumbs: v.array(breadcrumbValidator),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    let userEmail: string | undefined;
    if (userId) {
      const user = await ctx.db.get(userId);
      userEmail = user?.email;
    }

    return await ctx.db.insert("errorReports", {
      ...args,
      // Auto-captured = always a bug; manual defaults to bug unless flagged feature.
      reportType: args.reportType ?? "bug",
      userId: userId ?? undefined,
      userEmail,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

/** All reports, newest first. Auth-only (this is an internal dev surface). */
export const listErrors = query({
  args: { includeResolved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const reports = await ctx.db.query("errorReports").order("desc").take(300);
    return args.includeResolved
      ? reports
      : reports.filter((r) => r.status === "open");
  },
});

/** Count of open reports, for the dashboard badge. */
export const openCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return 0;
    const open = await ctx.db
      .query("errorReports")
      .withIndex("by_status", (q) => q.eq("status", "open"))
      .take(100);
    return open.length;
  },
});

export const setStatus = mutation({
  args: {
    id: v.id("errorReports"),
    status: v.union(v.literal("open"), v.literal("resolved")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.id, { status: args.status });
  },
});

export const deleteError = mutation({
  args: { id: v.id("errorReports") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.delete(args.id);
  },
});

// ─── Jul 17: public feature-request board (extends BNH-38) ───────────────────
// Feature requests are visible to every signed-in writer so ideas aren't
// silo'd and duplicates surface before submission. Bugs stay dev/admin-facing.

/** All feature requests, newest first, with the caller's +1 state. */
export const listFeatureRequests = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const reports = await ctx.db.query("errorReports").order("desc").take(300);
    return reports
      .filter((r) => r.reportType === "feature")
      .map((r) => ({
        _id: r._id,
        note: r.userNote ?? r.message,
        submittedBy: r.userEmail ?? "Someone",
        status: r.status,
        createdAt: r.createdAt,
        upvotes: r.upvoterIds?.length ?? 0,
        upvotedByMe: r.upvoterIds?.includes(userId) ?? false,
        mine: r.userId === userId,
      }));
  },
});

/** Toggle the caller's +1 on a feature request. */
export const toggleUpvote = mutation({
  args: { id: v.id("errorReports") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const report = await ctx.db.get(args.id);
    if (!report || report.reportType !== "feature") {
      throw new Error("Feature request not found");
    }
    const current = report.upvoterIds ?? [];
    const upvoterIds = current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId];
    await ctx.db.patch(args.id, { upvoterIds });
  },
});
