/**
 * 2026-10-26 (Phase E, E2b; part 6 of the first 2026-10-26 entry): Step-by-
 * step choices and reviewer outcomes become learning signals. Each signal is
 * a masked copy of the row it was made from (the names the app knows are
 * replaced by placeholders, then the project record's names are removed),
 * written by a scheduled capture so the writer's own action never pays for
 * it and never fails because of it. The rows themselves are never changed.
 * The style lesson set reads these copies; builds never build maps.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { deidentify, pseudonymize, type PlaceholderMap } from "./lib/deidentify";
import { projectPlaceholderMap } from "./lib/transcriptPlaceholders";
import { listProjectTranscripts } from "./lib/transcripts";

export const learningSignalKindValidator = v.union(
  v.literal("seed_rewording"),
  v.literal("seed_feedback"),
  v.literal("seed_choices"),
  v.literal("review_decision"),
  v.literal("review_comment")
);
export type LearningSignalKind = "seed_rewording" | "seed_feedback" | "seed_choices" | "review_decision" | "review_comment";

/** At most this many characters of any one masked text. */
const MAX_SIGNAL_TEXT = 2_000;

/** A masker for one project: the draft's frozen map when there is one, else the project's. */
async function maskerFor(
  ctx: MutationCtx,
  project: Doc<"projects">,
  generation: Doc<"generations"> | null,
  texts: readonly string[]
): Promise<(text: string) => string> {
  const map: PlaceholderMap =
    generation?.placeholders && generation.placeholders.length > 0
      ? generation.placeholders
      : await projectPlaceholderMap(ctx, project, await listProjectTranscripts(ctx, project._id), texts);
  return (text) => deidentify(pseudonymize(text, map), project).trim().slice(0, MAX_SIGNAL_TEXT);
}

async function signalBySource(ctx: MutationCtx, sourceKey: string) {
  return await ctx.db
    .query("learningSignals")
    .withIndex("by_sourceKey", (q) => q.eq("sourceKey", sourceKey))
    .unique();
}

async function removeSignal(ctx: MutationCtx, sourceKey: string): Promise<void> {
  const existing = await signalBySource(ctx, sourceKey);
  if (existing) await ctx.db.delete(existing._id);
}

/** Writes or replaces the one signal made from `sourceKey`. */
async function putSignal(
  ctx: MutationCtx,
  signal: Omit<Doc<"learningSignals">, "_id" | "_creationTime">
): Promise<void> {
  const existing = await signalBySource(ctx, signal.sourceKey);
  if (existing) await ctx.db.replace(existing._id, signal);
  else await ctx.db.insert("learningSignals", signal);
}

/** A live project that is not being erased, or null. */
async function liveProject(ctx: MutationCtx, projectId: Id<"projects">) {
  const project = await ctx.db.get(projectId);
  return project && project.deletionStartedAt === undefined ? project : null;
}

export const SEED_SELECTION_KEY = (id: Id<"seedSelections">) => `seedSelection:${id}`;
export const SEED_FEEDBACK_KEY = (id: Id<"seedFeedbackRequests">) => `seedFeedback:${id}`;
export const SEED_CHOICES_KEY = (generationId: Id<"generations">) => `seedChoices:${generationId}`;
export const REVIEW_DECISION_KEY = (id: Id<"reviewDecisions">) => `reviewDecision:${id}`;
export const REVIEW_COMMENT_KEY = (id: Id<"comments">) => `comment:${id}`;

/**
 * Makes, replaces or removes the signal one row gives. Scheduled by the
 * mutation that changed the row, so it reads the row as it is now.
 */
export const capture = internalMutation({
  args: {
    seedSelectionId: v.optional(v.id("seedSelections")),
    seedFeedbackRequestId: v.optional(v.id("seedFeedbackRequests")),
    seedChoicesGenerationId: v.optional(v.id("generations")),
    reviewDecisionId: v.optional(v.id("reviewDecisions")),
    commentId: v.optional(v.id("comments")),
    /** Who acted, when the row does not say. */
    producerId: v.optional(v.id("users")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.seedSelectionId) await captureSeedRewording(ctx, args.seedSelectionId);
    if (args.seedFeedbackRequestId) await captureSeedFeedback(ctx, args.seedFeedbackRequestId, args.producerId);
    if (args.seedChoicesGenerationId && args.producerId) await captureSeedChoices(ctx, args.seedChoicesGenerationId, args.producerId);
    if (args.reviewDecisionId) await captureReviewDecision(ctx, args.reviewDecisionId);
    if (args.commentId) await captureReviewComment(ctx, args.commentId);
    return null;
  },
});

/** A Seed the writer reworded: the idea's words and the writer's, the last edit only. */
async function captureSeedRewording(ctx: MutationCtx, selectionId: Id<"seedSelections">): Promise<void> {
  const sourceKey = SEED_SELECTION_KEY(selectionId);
  const selection = await ctx.db.get(selectionId);
  if (!selection?.editedBullets || !selection.editedBy) return await removeSignal(ctx, sourceKey);
  const [seed, generation, project] = await Promise.all([
    ctx.db.get(selection.seedId),
    ctx.db.get(selection.generationId),
    liveProject(ctx, selection.projectId),
  ]);
  if (!seed || !project) return await removeSignal(ctx, sourceKey);
  const before = seed.bullets.join("\n");
  const after = selection.editedBullets.join("\n");
  const mask = await maskerFor(ctx, project, generation, [before, after]);
  await putSignal(ctx, {
    kind: "seed_rewording",
    sourceKey,
    projectId: project._id,
    generationId: selection.generationId,
    producerId: selection.editedBy,
    payload: { roleId: selection.roleId, before: mask(before), after: mask(after) },
    at: selection.editedAt ?? Date.now(),
  });
}

/** Feedback a writer gave on a Seed: the instruction and the wording it was about. */
async function captureSeedFeedback(
  ctx: MutationCtx,
  requestId: Id<"seedFeedbackRequests">,
  producerId: Id<"users"> | undefined
): Promise<void> {
  const sourceKey = SEED_FEEDBACK_KEY(requestId);
  const request = await ctx.db.get(requestId);
  if (!request || request.status === "withdrawn") return await removeSignal(ctx, sourceKey);
  const existing = await signalBySource(ctx, sourceKey);
  const producer = producerId ?? existing?.producerId ?? (await feedbackRequester(ctx, request));
  const [generation, project] = await Promise.all([ctx.db.get(request.generationId), liveProject(ctx, request.projectId)]);
  if (!producer || !project) return await removeSignal(ctx, sourceKey);
  const about = request.targetWording.join("\n");
  const mask = await maskerFor(ctx, project, generation, [request.instruction, about]);
  await putSignal(ctx, {
    kind: "seed_feedback",
    sourceKey,
    projectId: project._id,
    generationId: request.generationId,
    producerId: producer,
    payload: { roleId: request.roleId, instruction: mask(request.instruction), about: mask(about) },
    at: request._creationTime,
  });
}

/** Who asked for a Seed's Feedback, from the event that recorded it (older rows). */
async function feedbackRequester(
  ctx: MutationCtx,
  request: Doc<"seedFeedbackRequests">
): Promise<Id<"users"> | null> {
  const events = await ctx.db
    .query("seedDecisionEvents")
    .withIndex("by_generationId_and_at", (q) => q.eq("generationId", request.generationId))
    .take(5_000);
  for (const event of events) {
    if (event.kind === "feedbackRequested" && event.feedbackRequestId === request._id && "actorUserId" in event) {
      return event.actorUserId;
    }
  }
  return null;
}

/** At a Seed sign-off: per tag, how many ideas were offered and chosen, and how often new ideas were asked for. */
async function captureSeedChoices(
  ctx: MutationCtx,
  generationId: Id<"generations">,
  producerId: Id<"users">
): Promise<void> {
  const sourceKey = SEED_CHOICES_KEY(generationId);
  const generation = await ctx.db.get(generationId);
  const project = generation ? await liveProject(ctx, generation.projectId) : null;
  if (!generation || !project) return await removeSignal(ctx, sourceKey);
  const seeds = await ctx.db
    .query("seeds")
    .withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", generationId))
    .take(2_000);
  const selections = await ctx.db
    .query("seedSelections")
    .withIndex("by_generationId_and_selected_and_roleId", (q) => q.eq("generationId", generationId).eq("selected", true))
    .take(2_000);
  const chosen = new Set(selections.map((selection) => selection.seedId));
  const byTag = new Map<string, { offered: number; chosen: number }>();
  for (const seed of seeds) {
    for (const tag of seed.tags) {
      const counts = byTag.get(tag) ?? { offered: 0, chosen: 0 };
      counts.offered += 1;
      if (chosen.has(seed._id)) counts.chosen += 1;
      byTag.set(tag, counts);
    }
  }
  const events = await ctx.db
    .query("seedDecisionEvents")
    .withIndex("by_generationId_and_at", (q) => q.eq("generationId", generationId))
    .take(5_000);
  const newIdeas = events.filter((event) => event.kind === "regenerate").length;
  const skipped = events.filter((event) => event.kind === "skip").length;
  await putSignal(ctx, {
    kind: "seed_choices",
    sourceKey,
    projectId: project._id,
    generationId,
    producerId,
    payload: {
      tags: [...byTag].sort(([a], [b]) => a.localeCompare(b)).map(([tag, counts]) => ({ tag, ...counts })),
      newIdeas,
      skipped,
    },
    at: Date.now(),
  });
}

/** A reviewer's approve or return, with the return note. */
async function captureReviewDecision(ctx: MutationCtx, decisionId: Id<"reviewDecisions">): Promise<void> {
  const sourceKey = REVIEW_DECISION_KEY(decisionId);
  const decision = await ctx.db.get(decisionId);
  const project = decision ? await liveProject(ctx, decision.projectId) : null;
  if (!decision || !project) return await removeSignal(ctx, sourceKey);
  const note = decision.note?.trim() ?? "";
  const mask = note ? await maskerFor(ctx, project, null, [note]) : null;
  await putSignal(ctx, {
    kind: "review_decision",
    sourceKey,
    projectId: project._id,
    producerId: decision.reviewerId,
    payload: { decision: decision.decision, ...(mask ? { note: mask(note) } : {}) },
    at: decision.createdAt,
  });
}

/** An internal reviewer's comment on a passage. Client comments are client data and are left out. */
async function captureReviewComment(ctx: MutationCtx, commentId: Id<"comments">): Promise<void> {
  const sourceKey = REVIEW_COMMENT_KEY(commentId);
  const comment = await ctx.db.get(commentId);
  const project = comment ? await liveProject(ctx, comment.projectId) : null;
  const commenterId = comment?.commenterType === "writer" ? ctx.db.normalizeId("users", comment.commenterId) : null;
  if (!comment || !project || !commenterId) return await removeSignal(ctx, sourceKey);
  const texts = [comment.body, comment.highlightText, ...(comment.suggestedEdit ? [comment.suggestedEdit] : [])];
  const mask = await maskerFor(ctx, project, null, texts);
  await putSignal(ctx, {
    kind: "review_comment",
    sourceKey,
    projectId: project._id,
    producerId: commenterId,
    payload: {
      note: mask(comment.body),
      about: mask(comment.highlightText),
      ...(comment.suggestedEdit ? { after: mask(comment.suggestedEdit) } : {}),
    },
    at: comment.createdAt,
  });
}

/** Removes a deleted comment's signal in the same step as the comment. */
export async function removeCommentSignal(ctx: MutationCtx, commentId: Id<"comments">): Promise<void> {
  await removeSignal(ctx, REVIEW_COMMENT_KEY(commentId));
}

/** Schedules a capture; a capture that cannot be scheduled never fails the writer's action. */
export async function scheduleSignalCapture(
  ctx: MutationCtx,
  args: {
    seedSelectionId?: Id<"seedSelections">;
    seedFeedbackRequestId?: Id<"seedFeedbackRequests">;
    seedChoicesGenerationId?: Id<"generations">;
    reviewDecisionId?: Id<"reviewDecisions">;
    commentId?: Id<"comments">;
    producerId?: Id<"users">;
  }
): Promise<void> {
  await ctx.scheduler.runAfter(0, internal.learningSignals.capture, args);
}

/** The style lesson set's reads: one kind's signals, newest first, in the shape `admitStream` takes. */
export const getSignalsForDigest = internalQuery({
  args: { kind: learningSignalKindValidator, limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("learningSignals")
      .withIndex("by_kind_and_at", (q) => q.eq("kind", args.kind))
      .order("desc")
      .take(args.limit);
    return rows.map((row) => ({
      signalId: row._id as string,
      producerId: row.producerId as string,
      projectId: row.projectId as string,
      updatedAt: row.at,
      payload: row.payload,
    }));
  },
});

/**
 * One-off, owner-run, dev first: makes the signals of rows written before
 * E2b (reworded Seeds, Seed Feedback, review decisions and comments, and the
 * choices of signed-off Seed stages). One table and one page per run; it
 * schedules the next.
 */
export const backfillLearningSignals = internalMutation({
  args: {
    table: v.optional(
      v.union(
        v.literal("seedSelections"),
        v.literal("seedFeedbackRequests"),
        v.literal("reviewDecisions"),
        v.literal("comments"),
        v.literal("summaryVersions")
      )
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.object({ table: v.string(), scheduled: v.number(), done: v.boolean() }),
  handler: async (ctx, args) => {
    const order = ["seedSelections", "seedFeedbackRequests", "reviewDecisions", "comments", "summaryVersions"] as const;
    const table = args.table ?? order[0];
    const page = { cursor: args.cursor ?? null, numItems: 100 };
    let scheduled = 0;
    let next: { isDone: boolean; continueCursor: string };
    if (table === "seedSelections") {
      const result = await ctx.db.query("seedSelections").paginate(page);
      for (const row of result.page) {
        if (row.editedBullets) {
          await scheduleSignalCapture(ctx, { seedSelectionId: row._id });
          scheduled += 1;
        }
      }
      next = result;
    } else if (table === "seedFeedbackRequests") {
      const result = await ctx.db.query("seedFeedbackRequests").paginate(page);
      for (const row of result.page) {
        if (row.status !== "withdrawn") {
          await scheduleSignalCapture(ctx, { seedFeedbackRequestId: row._id });
          scheduled += 1;
        }
      }
      next = result;
    } else if (table === "reviewDecisions") {
      const result = await ctx.db.query("reviewDecisions").paginate(page);
      for (const row of result.page) {
        await scheduleSignalCapture(ctx, { reviewDecisionId: row._id });
        scheduled += 1;
      }
      next = result;
    } else if (table === "comments") {
      const result = await ctx.db.query("comments").paginate(page);
      for (const row of result.page) {
        if (row.commenterType === "writer") {
          await scheduleSignalCapture(ctx, { commentId: row._id });
          scheduled += 1;
        }
      }
      next = result;
    } else {
      const result = await ctx.db.query("summaryVersions").paginate(page);
      for (const row of result.page) {
        await scheduleSignalCapture(ctx, { seedChoicesGenerationId: row.originGenerationId, producerId: row.signedOffBy });
        scheduled += 1;
      }
      next = result;
    }
    const nextTable = next.isDone ? order[order.indexOf(table) + 1] : table;
    if (nextTable) {
      await ctx.scheduler.runAfter(0, internal.learningSignals.backfillLearningSignals, {
        table: nextTable,
        cursor: next.isDone ? null : next.continueCursor,
      });
    }
    return { table, scheduled, done: next.isDone && !nextTable };
  },
});
