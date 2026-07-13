import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
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

    // Learning loop (auto-nomination): a highly rated report is candidate
    // Brain knowledge. Nominates into the PENDING queue only; the admin still
    // approves every entry, and content-hash dedup makes re-submits no-ops.
    if (score >= 85) {
      await ctx.scheduler.runAfter(0, internal.brain.nominateFromReport, {
        reportId: args.reportId,
        writerName,
        score,
      });
    }

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

const qaTargetArgs = v.union(
  v.object({ reportId: v.id("reports") }),
  v.object({ candidateId: v.id("reportCandidates") })
);

async function getReportCandidateTargetKey(
  ctx: QueryCtx | MutationCtx,
  reportId: Id<"reports">
): Promise<string> {
  const report = await ctx.db.get(reportId);
  if (!report) throw new Error("Report not found");
  if (!report.generationId) return `report:${reportId}`;
  const selection = await ctx.db
    .query("modelSelections")
    .withIndex("by_projectId_and_generationId", (q) =>
      q.eq("projectId", report.projectId).eq("generationId", report.generationId!)
    )
    .first();
  return selection?.candidateId ? `candidate:${selection.candidateId}` : `report:${reportId}`;
}

async function resolveQaTarget(
  ctx: QueryCtx | MutationCtx,
  target:
    | { reportId: Id<"reports"> }
    | { candidateId: Id<"reportCandidates"> }
) {
  if ("reportId" in target) {
    const report = await ctx.db.get(target.reportId);
    if (!report) throw new Error("Report not found");
    const access = await requireInternalProjectAccess(ctx, report.projectId);
    const targetKey = await getReportCandidateTargetKey(ctx, target.reportId);
    return {
      targetKey,
      projectId: report.projectId,
      reportId: report._id,
      generationId: report.generationId,
      access,
    };
  }
  const candidate = await ctx.db.get(target.candidateId);
  if (!candidate) throw new Error("Candidate not found");
  const access = await requireInternalProjectAccess(ctx, candidate.projectId);
  return {
    targetKey: `candidate:${target.candidateId}`,
    projectId: candidate.projectId,
    candidateId: candidate._id,
    generationId: candidate.generationId,
    access,
  };
}

export const getMyQaItemFeedback = query({
  args: { target: qaTargetArgs },
  handler: async (ctx, args) => {
    const target = await resolveQaTarget(ctx, args.target);
    const rows = await ctx.db
      .query("qaItemFeedback")
      .withIndex("by_user_target_item", (q) =>
        q.eq("userId", target.access.user._id).eq("targetKey", target.targetKey)
      )
      .collect();
    return rows.map((row) => ({
      itemKey: row.itemKey,
      overrideSeverity: row.overrideSeverity ?? null,
      vote: row.vote ?? null,
    }));
  },
});

export const saveQaItemFeedback = mutation({
  args: {
    target: qaTargetArgs,
    itemKey: v.string(),
    itemKind: v.union(v.literal("issue"), v.literal("strength")),
    section: v.string(),
    itemText: v.string(),
    originalSeverity: v.optional(v.union(v.literal("deduction"), v.literal("warning"))),
    overrideSeverity: v.optional(v.union(v.literal("deduction"), v.literal("warning"), v.null())),
    vote: v.optional(v.union(v.literal(-1), v.literal(1), v.null())),
  },
  handler: async (ctx, args) => {
    const target = await resolveQaTarget(ctx, args.target);
    const user = target.access.user;
    const existing = await ctx.db
      .query("qaItemFeedback")
      .withIndex("by_user_target_item", (q) =>
        q.eq("userId", user._id).eq("targetKey", target.targetKey).eq("itemKey", args.itemKey)
      )
      .unique();
    const now = Date.now();
    const value = {
      itemKind: args.itemKind,
      section: args.section,
      itemText: args.itemText,
      originalSeverity: args.originalSeverity,
      overrideSeverity: args.overrideSeverity ?? undefined,
      vote: args.vote ?? undefined,
      writerName: user.name ?? user.email ?? undefined,
      updatedAt: now,
    };
    // Learning loop: refresh the QA calibration digest after feedback settles.
    // The delay coalesces review bursts, and the action itself no-ops when the
    // active digest already covers the newest feedback, so extra runs are cheap.
    await ctx.scheduler.runAfter(
      10 * 60 * 1000,
      internal.ai.learning.generateQaCalibrationDigest,
      {}
    );
    if (existing) {
      await ctx.db.patch(existing._id, value);
      return existing._id;
    }
    return await ctx.db.insert("qaItemFeedback", {
      targetKey: target.targetKey,
      projectId: target.projectId,
      reportId: target.reportId,
      candidateId: target.candidateId,
      generationId: target.generationId,
      itemKey: args.itemKey,
      userId: user._id,
      createdAt: now,
      ...value,
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
      reviews.map(async (review) => {
        const project = await ctx.db.get(review.projectId);
        return {
          _id: review._id,
          projectTitle: project?.title ?? "(deleted project)",
          clientName: project?.clientName ?? "",
          reportVersion: review.reportVersion ?? null,
          writerName: review.writerName ?? "Writer",
          score: review.score,
          aiScore: review.aiScore ?? null,
          comment: review.comment ?? "",
          createdAt: review.createdAt,
        };
      })
    );

    const scored = rows.filter((row) => typeof row.aiScore === "number");
    const avgHuman = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length)
      : null;
    const avgGap = scored.length
      ? Math.round(
          scored.reduce(
            (sum, row) => sum + (row.score - (row.aiScore as number)),
            0
          ) / scored.length
        )
      : null;

    const feedback = await ctx.db.query("qaItemFeedback").order("desc").take(500);
    const itemRows = await Promise.all(
      feedback.map(async (item) => {
        const project = await ctx.db.get(item.projectId);
        return {
          _id: item._id,
          projectTitle: project?.title ?? "(deleted project)",
          writerName: item.writerName ?? "Writer",
          section: item.section,
          itemText: item.itemText,
          itemKind: item.itemKind,
          originalSeverity: item.originalSeverity ?? null,
          overrideSeverity: item.overrideSeverity ?? null,
          vote: item.vote ?? null,
          updatedAt: item.updatedAt,
        };
      })
    );

    return { rows, total: rows.length, avgHuman, avgGap, itemRows };
  },
});
