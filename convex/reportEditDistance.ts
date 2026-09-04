import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { getInternalProjectAccessOrNull, requireCurrentUser } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { recordReportEditDistance } from "./lib/editDistance";

// ─── BNH-10 flywheel (CAP-2): persisted post-edit distance ───────────────────
// Read surface for the learning dashboard (CAP-3). Both series are bounded and
// keep the NEWEST readings; the caps are exported so tests cannot drift.

export const SERIES_FOR_REPORT_LIMIT = 200;
export const SERIES_FOR_WRITER_LIMIT = 500;

/**
 * Every recorded reading for one report, oldest-first. Returns `null` (never
 * throws) for a caller without internal access to the report's project, so the
 * dashboard can render an empty state without a error boundary.
 */
export const seriesForReport = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const access = await getInternalProjectAccessOrNull(ctx, report.projectId);
    if (!access) return null;

    const rows = await ctx.db
      .query("reportEditDistance")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .take(SERIES_FOR_REPORT_LIMIT);

    return rows
      .slice()
      .sort(
        (a, b) =>
          a.computedAt - b.computedAt || a._creationTime - b._creationTime
      )
      .map((row) => ({
        _id: row._id,
        reportId: row.reportId,
        projectId: row.projectId,
        generationId: row.generationId ?? null,
        writerUserId: row.writerUserId ?? null,
        revisionNumber: row.revisionNumber,
        ped: row.ped,
        computedAt: row.computedAt,
        trigger: row.trigger,
      }));
  },
});

/**
 * PED trend for one accountable writer (projects.ownerId), oldest-first.
 * Readable by an admin/manager or by that writer themselves; never by an
 * anonymous caller.
 */
export const seriesForWriter = query({
  args: {
    writerUserId: v.id("users"),
    sinceDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.sinceDays !== undefined) {
      if (
        !Number.isFinite(args.sinceDays) ||
        args.sinceDays <= 0 ||
        args.sinceDays > 3650
      ) {
        domainError("INVALID_INPUT", "sinceDays must be between 1 and 3650");
      }
    }
    const user = await requireCurrentUser(ctx);
    const elevated = user.role === "admin" || user.role === "manager";
    const isSelf = user._id === args.writerUserId;
    if (user.isAnonymous === true || !user.role || (!elevated && !isSelf)) {
      domainError("NOT_AUTHORIZED", "Not allowed to read this writer's series");
    }

    const since =
      args.sinceDays === undefined
        ? undefined
        : Date.now() - args.sinceDays * 24 * 60 * 60 * 1000;

    const rows = await ctx.db
      .query("reportEditDistance")
      .withIndex("by_writerUserId_and_computedAt", (q) =>
        since === undefined
          ? q.eq("writerUserId", args.writerUserId)
          : q.eq("writerUserId", args.writerUserId).gte("computedAt", since)
      )
      .order("desc")
      .take(SERIES_FOR_WRITER_LIMIT);

    return rows
      .slice()
      .reverse()
      .map((row) => ({
        _id: row._id,
        reportId: row.reportId,
        projectId: row.projectId,
        generationId: row.generationId ?? null,
        writerUserId: row.writerUserId ?? null,
        revisionNumber: row.revisionNumber,
        ped: row.ped,
        computedAt: row.computedAt,
        trigger: row.trigger,
      }));
  },
});

/** Scheduled from projects.publishForReview so publishing never waits on PED. */
export const recordAtPublish = internalMutation({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    await recordReportEditDistance(ctx, report, "client_publish");
    return null;
  },
});
