import { query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireCurrentUser,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { recordReportEditDistance } from "./lib/editDistance";

/**
 * BNH-10 flywheel read surface: the persisted post-edit-distance series.
 * Both queries are index-scoped and bounded — a writer with years of history
 * must never grow an unbounded document read.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** ~100 years. Past this, `sinceDays * DAY_MS` stops being a meaningful cutoff. */
const MAX_SINCE_DAYS = 36500;
/** A report accrues one row per milestone; 500 is far past any real report. */
export const REPORT_ROW_LIMIT = 500;
/** Newest readings are the ones a trend chart needs; older ones age out. */
export const WRITER_ROW_LIMIT = 1000;

/** Every reading for one report, oldest first. Null when the caller lacks internal access. */
export const seriesForReport = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const access = await getInternalProjectAccessOrNull(ctx, report.projectId);
    if (!access) return null;
    // Descending so the cap keeps the NEWEST readings (same contract as
    // seriesForWriter), then restored to the oldest-first order this query
    // promises. `computedAt` ties — a milestone and an immediately-drained
    // publish can share a millisecond — break on `_creationTime` so the
    // returned order is deterministic.
    const rows = await ctx.db
      .query("reportEditDistance")
      .withIndex("by_reportId", (q) => q.eq("reportId", args.reportId))
      .order("desc")
      .take(REPORT_ROW_LIMIT);
    return rows.sort(
      (a, b) => a.computedAt - b.computedAt || a._creationTime - b._creationTime
    );
  },
});

/**
 * Every reading accountable to one writer (projects.ownerId), oldest first,
 * capped at the newest `WRITER_ROW_LIMIT` readings.
 * Admins and managers can read anyone's series; a writer can read only their own.
 */
export const seriesForWriter = query({
  args: {
    writerUserId: v.id("users"),
    sinceDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    // Same internal-actor contract as lib/auth's helpers: an anonymous auth
    // record is never an internal reader, even when it carries a role, and
    // even when it names itself as the writer.
    if (user.isAnonymous === true) {
      domainError("NOT_AUTHENTICATED", "Authentication required");
    }
    const elevated = user.role === "admin" || user.role === "manager";
    if (!elevated && user._id !== args.writerUserId) {
      domainError("NOT_AUTHORIZED", "Cannot read another writer's edit-distance series");
    }
    if (
      args.sinceDays !== undefined &&
      (!Number.isFinite(args.sinceDays) ||
        args.sinceDays <= 0 ||
        args.sinceDays > MAX_SINCE_DAYS)
    ) {
      domainError(
        "INVALID_INPUT",
        `sinceDays must be a positive number of days no greater than ${MAX_SINCE_DAYS}`
      );
    }
    const since =
      args.sinceDays === undefined ? undefined : Date.now() - args.sinceDays * DAY_MS;
    // Descending so the cap keeps the newest readings, then reversed back to
    // the oldest-first ordering the series contract promises.
    const rows = await ctx.db
      .query("reportEditDistance")
      .withIndex("by_writerUserId_and_computedAt", (q) =>
        since === undefined
          ? q.eq("writerUserId", args.writerUserId)
          : q.eq("writerUserId", args.writerUserId).gte("computedAt", since)
      )
      .order("desc")
      .take(WRITER_ROW_LIMIT);
    return rows.reverse();
  },
});

/**
 * Publish trigger. Scheduled from projects.publishForReview so recording can
 * never fail the publish itself.
 */
export const recordAtPublish = internalMutation({
  args: { reportId: v.id("reports") },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    await recordReportEditDistance(ctx, report, "client_publish");
    return null;
  },
});
