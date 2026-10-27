import { requireProjectSetUp } from "./lib/intakeDrafts";
import { quotableFileText } from "../shared/wordMarkdown";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireReportEditAccess } from "./lib/roleCapabilities";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { limitUserAction } from "./lib/aiRateLimits";
import { documentHasText, documentTextHash, readDocumentText } from "./lib/documentText";
import { isProjectDeleting } from "./lib/projectDeletion";
import { requireAnthropicConfigured } from "./lib/providerConfig";
import {
  buildTranscriptPromptText,
  listProjectTranscripts,
  transcriptLabel,
} from "./lib/transcripts";
import { liveFactPacksApply } from "./lib/transcriptFactRows";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { transcriptFactsMode, transcriptPlaceholdersEnabled } from "./appSettings";
import { excludedIdsArgs, validatedExcludedSources } from "./lib/generations/reservation";
import { PROJECT_STILL_COPYING_MESSAGE, projectCopyInProgress, textCopyPending } from "./lib/projectCopy";
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
    // Decision 56: context files and transcripts unticked in the start dialog
    // are not read by this review. The written PD itself is always reviewed.
    ...excludedIdsArgs,
  },
  handler: async (ctx, args) => {
    const { user } = await requireReportEditAccess(ctx, args.projectId);
    // Decision 65, stage 2: not while the project is still being set up.
    await requireProjectSetUp(ctx, args.projectId);
    // F2 review: nor while its files are still being copied into it.
    if (await projectCopyInProgress(ctx, args.projectId)) {
      domainError("INVALID_STATE", PROJECT_STILL_COPYING_MESSAGE, { reason: "PROJECT_STILL_COPYING" });
    }
    requireAnthropicConfigured("review");
    // PD reviews never read company files: only the project's lists are kept.
    const validated = await validatedExcludedSources(ctx, args.projectId, {
      excludeDocumentIds: args.excludeDocumentIds,
      excludeTranscriptIds: args.excludeTranscriptIds,
    });
    const excludedSources = validated
      ? { documentIds: validated.documentIds, transcriptIds: validated.transcriptIds }
      : undefined;
    if (excludedSources?.documentIds.includes(args.documentId)) {
      domainError("INVALID_INPUT", "The written PD is always reviewed");
    }
    const doc = await ctx.db.get(args.documentId);
    if (
      !doc ||
      doc.projectId !== args.projectId ||
      doc.archived ||
      !documentHasText(doc)
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
    // Audit wave 2: 20 reviews an hour per user.
    await limitUserAction(ctx, "pdReviewPerUser", user._id);

    const now = Date.now();
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: args.projectId,
      documentId: args.documentId,
      sourceFileName: doc.fileName,
      status: "running",
      revisionNumber: 0,
      contentHash: await documentTextHash(doc),
      createdBy: user._id,
      createdAt: now,
      ...(excludedSources ? { excludedSources } : {}),
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
    const { user } = await requireReportEditAccess(ctx, failed.projectId);
    // F2 review: not while the project's files are still being copied.
    if (await projectCopyInProgress(ctx, failed.projectId)) {
      domainError("INVALID_STATE", PROJECT_STILL_COPYING_MESSAGE, { reason: "PROJECT_STILL_COPYING" });
    }
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
    if (!doc || doc.archived || !documentHasText(doc)) {
      domainError("INVALID_INPUT", "The reviewed PD document is no longer available");
    }
    await limitUserAction(ctx, "pdReviewPerUser", user._id);

    const now = Date.now();
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId: failed.projectId,
      documentId: failed.documentId,
      sourceFileName: doc.fileName,
      status: "running",
      revisionNumber: 0,
      contentHash: await documentTextHash(doc),
      createdBy: user._id,
      createdAt: now,
      ...(failed.excludedSources ? { excludedSources: failed.excludedSources } : {}),
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
      hasText: documentHasText(doc),
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

/**
 * F2 review: whether a review must wait for its project's files, still
 * being copied into it (review from project starts its review as the copy
 * runs; a crash can leave a copy to the job).
 */
export const reviewWaitsForCopy = internalQuery({
  args: { reviewId: v.id("pdReviews") },
  /** "gone": the review was removed or is no longer running (the reaper failed it). */
  returns: v.union(v.literal("wait"), v.literal("go"), v.literal("gone")),
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review || review.status !== "running") return "gone";
    return (await projectCopyInProgress(ctx, review.projectId)) ? "wait" : "go";
  },
});

/** Everything the review agent needs in one read: the written PD, the project
 *  basics, and every transcript joined (may be empty in review mode). */
export const getReviewInput = internalQuery({
  args: { reviewId: v.id("pdReviews") },
  handler: async (ctx, args) => {
    const review = await ctx.db.get(args.reviewId);
    if (!review) return null;
    const doc = await ctx.db.get(review.documentId);
    // F2 review: the written PD itself still being copied has no text yet
    // (the review waits for the copy first: `reviewWaitsForCopy`).
    if (doc && textCopyPending(doc)) {
      domainError("INVALID_STATE", PROJECT_STILL_COPYING_MESSAGE, { reason: "PROJECT_STILL_COPYING" });
    }
    const project = await ctx.db.get(review.projectId);
    const allRows = await listProjectTranscripts(ctx, review.projectId);
    const excludedTranscripts = new Set(review.excludedSources?.transcriptIds ?? []);
    const excludedDocuments = new Set(review.excludedSources?.documentIds ?? []);
    const rows = allRows.filter((row) => !excludedTranscripts.has(row._id));
    // Owner decision 26: the review call reads placeholders, not names. The
    // action checks the map against every text it sends. Every transcript,
    // left-out ones included, so their speakers stay hidden in kept files.
    const placeholders =
      project && (await transcriptPlaceholdersEnabled(ctx))
        ? [...(await projectPlaceholderMap(ctx, project, allRows))]
        : [];
    // The context documents the review reads (archived, uncategorized and
    // empty files skipped), minus the left-out ones.
    const documents = await ctx.db
      .query("projectDocuments")
      .withIndex("by_projectId", (q) => q.eq("projectId", review.projectId))
      .take(200);
    const contextDocs = [];
    for (const d of documents) {
      // F2: a file still being copied has no text yet.
      if (d.archived || !d.category || textCopyPending(d) || !documentHasText(d) || excludedDocuments.has(d._id)) continue;
      contextDocs.push({
        category: d.category,
        fileName: d.fileName,
        // 2026-10-22 (fourth): only the part the review reads. 2026-10-26:
        // Word Markdown without its marks.
        content: quotableFileText(await readDocumentText(ctx, d, 0, 15000), d.textFormat),
      });
    }
    return {
      pdContent: doc ? quotableFileText(await readDocumentText(ctx, doc), doc.textFormat) : "",
      // Usage attribution: the user who started (or retried) this review.
      createdBy: review.createdBy,
      fileName: review.sourceFileName,
      title: project?.title ?? "Untitled",
      clientName: project?.clientName ?? "",
      transcript: buildTranscriptPromptText(
        rows.map((row) => ({ label: transcriptLabel(row), content: row.content }))
      ),
      // 2026-09-24 (transcript method, plan step 8): under transcripts.factsMode
      // the action tries the verified fact packs of these transcripts, one
      // query each, in place of the text the budget would cut.
      factPacks: liveFactPacksApply(rows, await transcriptFactsMode(ctx))
        ? rows.map((row, index) => ({ transcriptId: row._id, position: index + 1, label: transcriptLabel(row) }))
        : [],
      placeholders,
      contextDocs,
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
    if (await isProjectDeleting(ctx, review.projectId)) return;
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
      if (await isProjectDeleting(ctx, review.projectId)) continue;
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
    if (await isProjectDeleting(ctx, review.projectId)) return;
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
