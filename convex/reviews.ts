import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
  requireRole,
} from "./lib/auth";

/**
 * BNH-29: the signed-in writer's own QA review for a specific report version.
 * Used to pre-fill the inputs in the QA Score box.
 */
export const getMyWriterReview = query({
  args: { reportId: v.id("reports") },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) return null;
    const access = await getInternalProjectAccessOrNull(ctx, report.projectId);
    if (!access) return null;
    const review = await ctx.db
      .query("writerReviews")
      .withIndex("by_user_report", (q) =>
        q.eq("userId", access.user._id).eq("reportId", args.reportId)
      )
      .first();
    if (!review) return null;
    return { score: review.score, comment: review.comment ?? "" };
  },
});

/**
 * Save (or update) the writer's human QA score + comment for a report version.
 * One review per writer per report. Stored for admin review — never auto-applied.
 */
export const submitWriterReview = mutation({
  args: {
    reportId: v.id("reports"),
    score: v.number(),
    comment: v.optional(v.string()),
    aiScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const report = await ctx.db.get(args.reportId);
    if (!report) throw new Error("Report not found");

    const { user } = await requireInternalProjectAccess(ctx, report.projectId);

    const score = Math.max(0, Math.min(100, Math.round(args.score)));
    const comment = args.comment?.trim() || undefined;
    const now = Date.now();

    const writerName = user.name ?? user.email ?? undefined;

    const existing = await ctx.db
      .query("writerReviews")
      .withIndex("by_user_report", (q) =>
        q.eq("userId", user._id).eq("reportId", args.reportId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        score,
        comment,
        aiScore: args.aiScore,
        writerName,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("writerReviews", {
      projectId: report.projectId,
      reportId: args.reportId,
      reportVersion: report.version,
      userId: user._id,
      writerName,
      score,
      comment,
      aiScore: args.aiScore,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Admin analytics: every writer review, enriched with project + AI score, so the
 * admin can compare the human score against the AI QA score (BNH-29 criteria #4).
 */
export const listWriterReviews = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);

    const reviews = await ctx.db.query("writerReviews").order("desc").take(200);

    const rows = await Promise.all(
      reviews.map(async (r) => {
        const project = await ctx.db.get(r.projectId);
        return {
          _id: r._id,
          projectTitle: project?.title ?? "(deleted project)",
          clientName: project?.clientName ?? "",
          reportVersion: r.reportVersion ?? null,
          writerName: r.writerName ?? "Writer",
          score: r.score,
          aiScore: r.aiScore ?? null,
          comment: r.comment ?? "",
          createdAt: r.createdAt,
        };
      })
    );

    const scored = rows.filter((r) => typeof r.aiScore === "number");
    const avgHuman = rows.length
      ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length)
      : null;
    const avgGap = scored.length
      ? Math.round(
          scored.reduce((s, r) => s + (r.score - (r.aiScore as number)), 0) /
            scored.length
        )
      : null;

    return { rows, total: rows.length, avgHuman, avgGap };
  },
});
