import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { requireAnthropicConfigured } from "./lib/providerConfig";
import { projectTranscriptPromptText } from "./lib/transcripts";
/**
 * BNH-39: PD review mode. A review-mode project uploads an existing written PD
 * (stored in projectDocuments, source "review_pd"); these functions run the AI
 * review, expose the result, and keep the timestamped interaction log.
 */


/** Kick off an AI review of the uploaded PD. Returns immediately — the client
 *  watches the pdReviews row for progress. */
export const startPdReview = mutation({
  args: {
    projectId: v.id("projects"),
    documentId: v.id("projectDocuments"),
  },
  handler: async (ctx, args) => {
    const { user } = await requireInternalProjectAccess(ctx, args.projectId);
    requireAnthropicConfigured("review");
    const doc = await ctx.db.get(args.documentId);
    if (
      !doc ||
      doc.projectId !== args.projectId ||
      doc.archived ||
      !doc.content.trim()
    ) {
      domainError("INVALID_INPUT", "An active, non-empty project document is required");
    }
    // Start is user-invocable from the project page (recovery for the
    // 2026-08-07 stranded-review flag), so it needs the same double-run guard
    // retry has always had.
    const latest = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (latest && latest.status === "running") {
      domainError("INVALID_INPUT", "A review is already running for this project");
    }

    const now = Date.now();
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: args.projectId,
      documentId: args.documentId,
      sourceFileName: doc.fileName,
      status: "running",
      createdBy: user._id,
      createdAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId: args.projectId,
      reviewId,
      actor: user._id,
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

/** Re-run a review against the same uploaded PD (e.g. after a provider outage
 *  or billing failure). Creates a fresh pdReviews row. */
export const retryPdReview = mutation({
  args: { reviewId: v.id("pdReviews") },
  handler: async (ctx, args) => {
    const failed = await ctx.db.get(args.reviewId);
    if (!failed) domainError("NOT_FOUND", "Review not found");
    const { user } = await requireInternalProjectAccess(ctx, failed.projectId);
    requireAnthropicConfigured("review");
    // `completed` is retryable too: older rows were stored before the result
    // was validated, so a review can be marked complete yet hold a payload the
    // report can't read. Refusing to re-run those left them permanently blank.
    if (failed.status !== "failed" && failed.status !== "completed") {
      domainError("INVALID_INPUT", "This review can't be retried yet");
    }
    const running = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", failed.projectId))
      .order("desc")
      .first();
    if (running && running.status === "running") {
      domainError("INVALID_INPUT", "A review is already running for this project");
    }
    const doc = await ctx.db.get(failed.documentId);
    if (!doc || doc.archived || !doc.content.trim()) {
      domainError("INVALID_INPUT", "The reviewed PD document is no longer available");
    }

    const now = Date.now();
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: failed.projectId,
      documentId: failed.documentId,
      sourceFileName: doc.fileName,
      status: "running",
      createdBy: user._id,
      createdAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId: failed.projectId,
      reviewId,
      actor: user._id,
      action: "review_started",
      detail: `Retry of ${failed.status} review — ${doc.fileName}`,
      at: now,
    });
    await ctx.scheduler.runAfter(0, internal.ai.reviewAgent.runPdReview, {
      reviewId,
      projectId: failed.projectId,
    });
    return reviewId;
  },
});

export const getLatestPdReview = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    const review = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (!review) return null;
    return {
      _id: review._id,
      projectId: review.projectId,
      documentId: review.documentId,
      sourceFileName: review.sourceFileName,
      status: review.status,
      result: review.result,
      error:
        review.status === "failed"
          ? "The review did not complete. Try running it again."
          : undefined,
      createdAt: review.createdAt,
      completedAt: review.completedAt,
    };
  },
});

/** The uploaded written PD a review would run against — lets the project page
 *  offer "start review" when a review-mode project has a PD but no review row
 *  (the stranded state behind the 2026-08-07 flag). */
export const getReviewSourceDocument = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("projectDocuments"),
      fileName: v.string(),
      hasText: v.boolean(),
    })
  ),
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    const docs = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    const candidates = docs
      .filter((d) => d.source === "review_pd" && !d.archived)
      .sort((a, b) => b.createdAt - a.createdAt);
    const doc = candidates[0];
    if (!doc) return null;
    return {
      _id: doc._id,
      fileName: doc.fileName,
      hasText: doc.content.trim().length > 0,
    };
  },
});

export const listPdReviewEvents = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    const events = await ctx.db
      .query("pdReviewEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
    return events.map((event) => ({
      _id: event._id,
      action: event.action,
      detail:
        event.action === "review_failed"
          ? "The review did not complete."
          : event.detail,
      at: event.at,
    }));
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
    const { project, user } = await requireInternalProjectAccess(
      ctx,
      args.projectId
    );
    if (args.reviewId) {
      const review = await ctx.db.get(args.reviewId);
      if (!review || review.projectId !== project._id) {
        domainError("NOT_AUTHORIZED", "Review does not belong to this project");
      }
    }
    await ctx.db.insert("pdReviewEvents", {
      projectId: args.projectId,
      reviewId: args.reviewId,
      actor: user._id,
      action: args.action,
      detail: args.detail?.slice(0, 1_000),
      at: Date.now(),
    });
  },
});

// ─── Internal plumbing for the review action ─────────────────────────────────

/** Everything the review agent needs in one read: the written PD, the project
 *  basics, and every transcript joined (may be empty in review mode). */
export const getReviewInput = internalQuery({
  args: { reviewId: v.id("pdReviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return null;
    const doc = await ctx.db.get(review.documentId);
    const project = await ctx.db.get(review.projectId);
    return {
      pdContent: doc?.content ?? "",
      // Usage attribution: the user who started (or retried) this review.
      createdBy: review.createdBy,
      fileName: review.sourceFileName,
      title: project?.title ?? "Untitled",
      clientName: project?.clientName ?? "",
      transcript: await projectTranscriptPromptText(ctx, review.projectId),
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

/**
 * Cron reaper (mirrors generations.failStaleGenerations): runPdReview's catch
 * handles soft failures, but a hard action death (deploy restart, timeout,
 * OOM) strands the row in "running" with no catch block left to fail it —
 * and both startPdReview and retryPdReview refuse while one is running, so
 * the UI would spin forever. Fail anything running past the cutoff; the
 * writer retries from the normal failed-review path.
 * `npx convex run pdReviews:failStalePdReviews '{"olderThanMinutes":15}'`
 */
export const failStalePdReviews = internalMutation({
  args: { olderThanMinutes: v.optional(v.number()) },
  returns: v.object({ failed: v.number() }),
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.olderThanMinutes ?? 15) * 60 * 1000;
    const stale = await ctx.db
      .query("pdReviews")
      .withIndex("by_status_and_createdAt", (q) =>
        q.eq("status", "running").lt("createdAt", cutoff)
      )
      .take(100);
    let failed = 0;
    for (const review of stale) {
      const now = Date.now();
      await ctx.db.patch(review._id, {
        status: "failed",
        error: "Timed out before the review completed.",
        completedAt: now,
      });
      await ctx.db.insert("pdReviewEvents", {
        projectId: review.projectId,
        reviewId: review._id,
        actor: "system",
        action: "review_failed",
        detail: "Timed out before the review completed.",
        at: now,
      });
      failed += 1;
    }
    return { failed };
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
