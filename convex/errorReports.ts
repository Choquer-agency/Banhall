import { query, mutation, internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { getCurrentUserOrNull } from "./lib/auth";
import { hasCapability, requireCapability } from "./lib/roleCapabilities";

const breadcrumbValidator = v.object({
  type: v.string(),
  label: v.string(),
  detail: v.optional(v.string()),
  at: v.number(),
});

/**
 * Size caps for one report (security wave 1, a2 P1-3). Longer values are cut,
 * not refused, so a real error still gets through with its start intact.
 */
export const ERROR_REPORT_LIMITS = {
  message: 2_000,
  stack: 8_000,
  // A signed-out sender's stack (review r1 P2-2): enough for the top frames.
  signedOutStack: 2_000,
  source: 200,
  url: 2_000,
  userNote: 4_000,
  userAgent: 500,
  sessionId: 64,
  breadcrumbs: 50,
  breadcrumbType: 50,
  breadcrumbLabel: 300,
  breadcrumbDetail: 1_000,
} as const;

/**
 * Reports one sender may file per minute. Over the budget a report is dropped
 * (reportError returns null) rather than refused, so the error banner never
 * turns into an error of its own. Signed-out reports share one budget as well,
 * since a session id is whatever the browser sends.
 */
export const ERROR_REPORT_BUDGET = {
  windowMs: 60_000,
  perUser: 10,
  perSession: 5,
  // All signed-out reports together (review r1 P2-2, lowered from 30).
  signedOutTotal: 10,
} as const;

/** Bug reports are kept this long, then the daily sweep deletes them
 * (review r1 P2-2). Feature requests are a product board and are kept. */
export const ERROR_REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const RETENTION_BATCH = 200;

function cap(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function capOptional(value: string | undefined, max: number): string | undefined {
  return value === undefined ? undefined : cap(value, max);
}

async function countSince(
  query: AsyncIterable<Doc<"errorReports">>,
  limit: number
): Promise<number> {
  let count = 0;
  for await (const _row of query) {
    count += 1;
    if (count >= limit) break;
  }
  return count;
}

async function withinBudget(
  ctx: MutationCtx,
  userId: Doc<"users">["_id"] | undefined,
  sessionId: string | undefined
): Promise<boolean> {
  const since = Date.now() - ERROR_REPORT_BUDGET.windowMs;
  const byUser = ctx.db
    .query("errorReports")
    .withIndex("by_userId_and_createdAt", (q) => q.eq("userId", userId).gt("createdAt", since));
  if (userId !== undefined) {
    return (await countSince(byUser, ERROR_REPORT_BUDGET.perUser)) < ERROR_REPORT_BUDGET.perUser;
  }
  if ((await countSince(byUser, ERROR_REPORT_BUDGET.signedOutTotal)) >= ERROR_REPORT_BUDGET.signedOutTotal) {
    return false;
  }
  if (sessionId === undefined) return true;
  const bySession = ctx.db
    .query("errorReports")
    .withIndex("by_sessionId_and_createdAt", (q) =>
      q.eq("sessionId", sessionId).gt("createdAt", since)
    );
  return (await countSince(bySession, ERROR_REPORT_BUDGET.perSession)) < ERROR_REPORT_BUDGET.perSession;
}

/**
 * Record an error report. Intentionally public and usable while unauthenticated
 * — the whole point is that anyone hitting an error (including clients on a
 * shared review link) can send it. If the caller is signed in we stamp their
 * id/email so we know who reported it. Field sizes are capped and each sender
 * has a per-minute budget (ERROR_REPORT_LIMITS, ERROR_REPORT_BUDGET).
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
    sessionId: v.optional(v.string()),
  },
  returns: v.union(v.id("errorReports"), v.null()),
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    const userId = user?._id ?? undefined;
    const userEmail = user?.email ?? undefined;
    const sessionId = capOptional(args.sessionId, ERROR_REPORT_LIMITS.sessionId);
    if (!(await withinBudget(ctx, userId, sessionId))) return null;

    const L = ERROR_REPORT_LIMITS;
    return await ctx.db.insert("errorReports", {
      kind: args.kind,
      // Auto-captured = always a bug; manual defaults to bug unless flagged feature.
      reportType: args.reportType ?? "bug",
      message: cap(args.message, L.message),
      stack: capOptional(args.stack, userId === undefined ? L.signedOutStack : L.stack),
      source: capOptional(args.source, L.source),
      url: cap(args.url, L.url),
      userNote: capOptional(args.userNote, L.userNote),
      breadcrumbs: args.breadcrumbs.slice(-L.breadcrumbs).map((crumb) => ({
        type: cap(crumb.type, L.breadcrumbType),
        label: cap(crumb.label, L.breadcrumbLabel),
        detail: capOptional(crumb.detail, L.breadcrumbDetail),
        at: crumb.at,
      })),
      userAgent: capOptional(args.userAgent, L.userAgent),
      ...(sessionId ? { sessionId } : {}),
      userId,
      userEmail,
      status: "open",
      createdAt: Date.now(),
    });
  },
});

/**
 * All reports, newest first. Stack traces and reporter emails are operational
 * alerts: the matrix's ops.viewAlerts (Admin only). Anyone else gets nothing.
 */
export const listErrors = query({
  args: { includeResolved: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user || user.isAnonymous === true || !hasCapability(user.role, "ops.viewAlerts")) {
      return [];
    }

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
    const user = await getCurrentUserOrNull(ctx);
    if (!user || user.isAnonymous === true || !hasCapability(user.role, "ops.viewAlerts")) {
      return 0;
    }
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
    await requireCapability(ctx, "ops.viewAlerts");
    await ctx.db.patch(args.id, { status: args.status });
  },
});

/**
 * Ops utility (mirrors generations.failStaleGenerations): batch-resolve alert
 * rows verified fixed, from the CLI where there is no signed-in user.
 * `npx convex run errorReports:adminResolve '{"ids":["..."]}'`
 */
export const adminResolve = internalMutation({
  args: { ids: v.array(v.id("errorReports")) },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    let resolved = 0;
    for (const id of args.ids) {
      const report = await ctx.db.get(id);
      if (!report || report.status === "resolved") continue;
      await ctx.db.patch(id, { status: "resolved" });
      resolved += 1;
    }
    return resolved;
  },
});

/**
 * Retention sweep (daily cron): deletes bug reports, open or resolved, older
 * than ERROR_REPORT_RETENTION_MS, a bounded batch at a time, and schedules
 * itself again while a full batch was found. Rows with no reportType are bug
 * reports from before BNH-38. Feature requests are never swept.
 */
export const pruneOldErrorReports = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx): Promise<number> => {
    const cutoff = Date.now() - ERROR_REPORT_RETENTION_MS;
    let deleted = 0;
    for (const reportType of [undefined, "bug"] as const) {
      const old = await ctx.db
        .query("errorReports")
        .withIndex("by_reportType_and_createdAt", (q) =>
          q.eq("reportType", reportType).lt("createdAt", cutoff)
        )
        .take(RETENTION_BATCH - deleted);
      for (const row of old) await ctx.db.delete(row._id);
      deleted += old.length;
      if (deleted >= RETENTION_BATCH) break;
    }
    if (deleted >= RETENTION_BATCH) {
      await ctx.scheduler.runAfter(0, internal.errorReports.pruneOldErrorReports, {});
    }
    return deleted;
  },
});

export const deleteError = mutation({
  args: { id: v.id("errorReports") },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "ops.viewAlerts");
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
    const user = await getCurrentUserOrNull(ctx);
    if (!user) return [];
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
        upvotedByMe: r.upvoterIds?.includes(user._id) ?? false,
        mine: r.userId === user._id,
      }));
  },
});

/** Toggle the caller's +1 on a feature request. */
export const toggleUpvote = mutation({
  args: { id: v.id("errorReports") },
  handler: async (ctx, args) => {
    const user = await getCurrentUserOrNull(ctx);
    if (!user) throw new Error("Not authenticated");
    const report = await ctx.db.get(args.id);
    if (!report || report.reportType !== "feature") {
      throw new Error("Feature request not found");
    }
    const current = report.upvoterIds ?? [];
    const upvoterIds = current.includes(user._id)
      ? current.filter((id) => id !== user._id)
      : [...current, user._id];
    await ctx.db.patch(args.id, { upvoterIds });
  },
});
