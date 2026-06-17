import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { assertProjectOwner } from "./lib/auth";
import { pruneSnapshots } from "./lib/snapshots";

export const listSnapshots = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return [];
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) return [];

    const snapshots = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .take(100);

    // List view: metadata only (content fetched on demand for preview).
    return snapshots.map((s) => ({
      _id: s._id,
      reason: s.reason,
      label: s.label,
      createdByRole: s.createdByRole,
      createdAt: s.createdAt,
    }));
  },
});

export const getSnapshot = query({
  args: { snapshotId: v.id("reportSnapshots") },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) return null;
    const project = await assertProjectOwner(ctx, snapshot.projectId);
    if (!project) return null;
    return snapshot;
  },
});

/** Create a manual restore point of the report's current content. */
export const createManualSnapshot = mutation({
  args: {
    reportId: v.id("reports"),
    label: v.optional(v.string()),
    reason: v.optional(
      v.union(v.literal("manual"), v.literal("periodic"))
    ),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");
    const project = await assertProjectOwner(ctx, report.projectId);
    if (!project) throw new Error("Not authorized");

    // Skip if the most recent snapshot already matches current content
    // (avoids churning snapshots on every debounced autosave).
    const latest = await ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .first();
    if (latest && latest.content === report.content) return latest._id;

    const id = await ctx.db.insert("reportSnapshots", {
      projectId: report.projectId,
      reportId: args.reportId,
      content: report.content,
      reason: args.reason ?? "manual",
      ...(args.label ? { label: args.label } : {}),
      createdByRole: "writer",
      createdAt: Date.now(),
    });
    await pruneSnapshots(ctx, args.reportId);
    return id;
  },
});

/**
 * Non-destructive restore: snapshots the CURRENT content first (so the present
 * state is never lost), then sets the report content back to the snapshot.
 */
export const restoreSnapshot = mutation({
  args: { snapshotId: v.id("reportSnapshots") },
  handler: async (ctx, args) => {
    const snapshot = await ctx.db.get(args.snapshotId);
    if (!snapshot) throw new Error("Snapshot not found");
    const project = await assertProjectOwner(ctx, snapshot.projectId);
    if (!project) throw new Error("Not authorized");

    const report = await ctx.db.get(snapshot.reportId);
    if (!report) throw new Error("Report not found");

    const now = Date.now();

    // Preserve the current state before overwriting.
    await ctx.db.insert("reportSnapshots", {
      projectId: snapshot.projectId,
      reportId: snapshot.reportId,
      content: report.content,
      reason: "pre_restore",
      label: "Before restore",
      createdByRole: "system",
      createdAt: now,
    });

    await ctx.db.patch(snapshot.reportId, {
      content: snapshot.content,
      updatedAt: now,
    });

    await pruneSnapshots(ctx, snapshot.reportId);
  },
});
