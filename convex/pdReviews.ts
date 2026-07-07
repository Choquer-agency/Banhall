import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/**
 * BNH-39: PD review mode. A review-mode project uploads an existing written PD
 * (stored in projectDocuments, source "review_pd"); these functions run the AI
 * review, expose the result, and keep the timestamped interaction log.
 */

async function assertOwner(ctx: MutationCtx, projectId: Id<"projects">) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Not authenticated");
  const project = await ctx.db.get(projectId);
  if (!project || project.createdBy !== userId) {
    throw new Error("Not authorized");
  }
  return { userId, project };
}

/** Kick off an AI review of the uploaded PD. Returns immediately — the client
 *  watches the pdReviews row for progress. */
export const startPdReview = mutation({
  args: {
    projectId: v.id("projects"),
    documentId: v.id("projectDocuments"),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertOwner(ctx, args.projectId);
    const doc = await ctx.db.get(args.documentId);
    if (!doc || doc.projectId !== args.projectId) {
      throw new Error("Document not found");
    }

    const now = Date.now();
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: args.projectId,
      documentId: args.documentId,
      sourceFileName: doc.fileName,
      status: "running",
      createdBy: userId,
      createdAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId: args.projectId,
      reviewId,
      actor: userId,
      action: "review_started",
      detail: doc.fileName,
      at: now,
    });

    await ctx.scheduler.runAfter(0, internal.ai.reviewAgent.runPdReview, {
      reviewId,
      projectId: args.projectId,
    });
    return reviewId;
  },
});

export const getLatestPdReview = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) return null;
    return await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const listPdReviewEvents = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) return [];
    return await ctx.db
      .query("pdReviewEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

/** Reviewer-side interactions (opened the report, triggered generation). */
export const logPdReviewEvent = mutation({
  args: {
    projectId: v.id("projects"),
    reviewId: v.optional(v.id("pdReviews")),
    action: v.union(
      v.literal("review_viewed"),
      v.literal("generate_from_review")
    ),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId } = await assertOwner(ctx, args.projectId);
    await ctx.db.insert("pdReviewEvents", {
      projectId: args.projectId,
      reviewId: args.reviewId,
      actor: userId,
      action: args.action,
      detail: args.detail,
      at: Date.now(),
    });
  },
});

// ─── Internal plumbing for the review action ─────────────────────────────────

/** Everything the review agent needs in one read: the written PD, the project
 *  basics, and the transcript (may be empty in review mode). */
export const getReviewInput = internalQuery({
  args: { reviewId: v.id("pdReviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return null;
    const doc = await ctx.db.get(review.documentId);
    const project = await ctx.db.get(review.projectId);
    const transcript = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", review.projectId))
      .first();
    return {
      pdContent: doc?.content ?? "",
      fileName: review.sourceFileName,
      title: project?.title ?? "Untitled",
      clientName: project?.clientName ?? "",
      transcript: transcript?.content?.trim() ?? "",
    };
  },
});

export const completePdReview = internalMutation({
  args: {
    reviewId: v.id("pdReviews"),
    result: v.string(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    const now = Date.now();
    await ctx.db.patch(args.reviewId, {
      status: "completed",
      result: args.result,
      model: args.model,
      completedAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId: review.projectId,
      reviewId: args.reviewId,
      actor: "system",
      action: "review_completed",
      at: now,
    });
  },
});

export const failPdReview = internalMutation({
  args: {
    reviewId: v.id("pdReviews"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return;
    const now = Date.now();
    await ctx.db.patch(args.reviewId, {
      status: "failed",
      error: args.error,
      completedAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId: review.projectId,
      reviewId: args.reviewId,
      actor: "system",
      action: "review_failed",
      detail: args.error,
      at: now,
    });
  },
});
