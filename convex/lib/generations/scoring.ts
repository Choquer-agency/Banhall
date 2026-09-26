/**
 * Model preference and writer scores (BNH-48): stats, comments and
 * per-option scores.
 *
 * Split out of convex/generations.ts (2026-09-25, phase 4). The Convex
 * functions stay registered in convex/generations.ts under their old names;
 * this module holds their handlers and helpers.
 */
import type { QueryCtx, MutationCtx } from "../../_generated/server";
import {
  requireRole,
  requireCurrentUser,
  requireInternalProjectAccess,
  getInternalProjectAccessOrNull,
} from "../auth";
import { v, type ObjectType } from "convex/values";
import { internal } from "../../_generated/api";

/** Argument validators of generations.modelStats. */
export const modelStatsArgs = {};

/** Handler of generations.modelStats. */
export async function modelStatsHandler(ctx: QueryCtx) {
  const user = await requireRole(ctx, ["admin"]);

  const all = await ctx.db.query("modelSelections").collect();
  const total = all.length;

  const tally = (rows: typeof all) => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const r of rows) {
      const cur = counts.get(r.model) ?? { label: r.label, count: 0 };
      cur.count += 1;
      counts.set(r.model, cur);
    }
    return [...counts.entries()]
      .map(([model, { label, count }]) => ({
        model,
        label,
        count,
        pct: rows.length ? Math.round((count / rows.length) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  };

  const overall = tally(all);
  const mine = tally(all.filter((r) => r.userId === user._id));

  const top = overall[0];
  const recommendation =
    total >= 5 && top
      ? `Across ${total} selections, ${top.label} is preferred ${top.pct}% of the time.`
      : `Not enough data yet — ${total} selection(s) logged. Keep choosing to surface a recommendation.`;

  // Jul 17 meeting: per-model score stats + writer comments so the team can
  // converge on a model (avg 1–10 score, and the raw one-liners feeding the
  // AI feedback summary below).
  const scores = await ctx.db.query("candidateScores").collect();
  const byModel = new Map<
    string,
    { label: string; scores: number[]; comments: Array<{ comment: string; score: number; at: number }> }
  >();
  for (const s of scores) {
    const cur =
      byModel.get(s.model) ?? { label: s.label, scores: [], comments: [] };
    cur.scores.push(s.score);
    if (s.comment) {
      cur.comments.push({ comment: s.comment, score: s.score, at: s.updatedAt });
    }
    byModel.set(s.model, cur);
  }
  const scoreStats = [...byModel.entries()]
    .map(([model, { label, scores: ss, comments }]) => ({
      model,
      label,
      scoreCount: ss.length,
      avgScore: ss.length
        ? Math.round((ss.reduce((a, b) => a + b, 0) / ss.length) * 10) / 10
        : null,
      comments: comments.sort((a, b) => b.at - a.at).slice(0, 10),
    }))
    .sort((a, b) => b.scoreCount - a.scoreCount);

  return { total, overall, mine, recommendation, scoreStats };
}

/** The most comments getModelComments returns, newest first. */
export const MODEL_COMMENT_LIMIT = 50;

/** The most score rows getModelComments reads for one model. */
export const MODEL_COMMENT_SCAN_LIMIT = 2_000;

/** Argument validators of generations.getModelComments. */
export const getModelCommentsArgs = { model: v.string() };

/** Handler of generations.getModelComments. */
export async function getModelCommentsHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getModelCommentsArgs>
) {
  // Newest first through the model's own index range, stopping at 50
  // comments; rows without a comment are skipped, and the scan is bounded
  // so a model with many uncommented scores cannot read without limit.
  const comments: Array<{ comment: string; score: number }> = [];
  let scanned = 0;
  for await (const score of ctx.db
    .query("candidateScores")
    .withIndex("by_model_and_updatedAt", (q) => q.eq("model", args.model))
    .order("desc")) {
    scanned += 1;
    if (score.comment) comments.push({ comment: score.comment, score: score.score });
    if (comments.length >= MODEL_COMMENT_LIMIT || scanned >= MODEL_COMMENT_SCAN_LIMIT) break;
  }
  return comments;
}

/** Argument validators of generations.scoreCandidate. */
export const scoreCandidateArgs = {
  candidateId: v.id("reportCandidates"),
  score: v.number(),
  optionPosition: v.number(),
  comment: v.optional(v.string()),
};

/** Handler of generations.scoreCandidate. */
export async function scoreCandidateHandler(
  ctx: MutationCtx,
  args: ObjectType<typeof scoreCandidateArgs>
) {
  await requireCurrentUser(ctx);
  if (!Number.isInteger(args.score) || args.score < 1 || args.score > 10) {
    throw new Error("Score must be a whole number from 1 to 10");
  }
  const comment = args.comment?.trim();

  const candidate = await ctx.db.get(args.candidateId);
  if (!candidate) throw new Error("Candidate not found");
  const { user } = await requireInternalProjectAccess(ctx, candidate.projectId);
  const userId = user._id;

  let qaScore: number | undefined;
  try {
    const parsed: unknown = JSON.parse(candidate.agentOutputs);
    if (
      parsed &&
      typeof parsed === "object" &&
      "qa" in parsed &&
      parsed.qa &&
      typeof parsed.qa === "object" &&
      "overall_score" in parsed.qa &&
      typeof parsed.qa.overall_score === "number"
    ) {
      qaScore = parsed.qa.overall_score;
    }
  } catch {
    // A legacy candidate may not have structured QA output.
  }

  const now = Date.now();
  // Learning loop: refresh the draft style digest after scoring settles. The
  // delay coalesces a selection session's worth of scores; the action no-ops
  // when the active digest already covers the newest feedback.
  if (comment) {
    await ctx.scheduler.runAfter(
      10 * 60 * 1000,
      internal.ai.learning.generateDraftStyleDigest,
      {}
    );
  }
  const existing = await ctx.db
    .query("candidateScores")
    .withIndex("by_user_and_candidateId", (q) =>
      q.eq("userId", userId).eq("candidateId", args.candidateId)
    )
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      score: args.score,
      optionPosition: args.optionPosition,
      comment: comment || undefined,
      updatedAt: now,
    });
    return;
  }
  await ctx.db.insert("candidateScores", {
    projectId: candidate.projectId,
    generationId: candidate.generationId,
    candidateId: args.candidateId,
    optionPosition: args.optionPosition,
    model: candidate.model,
    label: candidate.label,
    ...(qaScore !== undefined ? { qaScore } : {}),
    userId,
    score: args.score,
    ...(comment ? { comment } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

/** Argument validators of generations.getMyCandidateScores. */
export const getMyCandidateScoresArgs = { generationId: v.id("generations") };

/** Handler of generations.getMyCandidateScores. */
export async function getMyCandidateScoresHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getMyCandidateScoresArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return [];
  const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
  if (!access) return [];
  const scores = await ctx.db
    .query("candidateScores")
    .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
    .take(20);
  return scores
    .filter((score) => score.userId === access.user._id)
    .map((score) => ({
      candidateId: score.candidateId,
      score: score.score,
      comment: score.comment ?? "",
    }));
}

/** Argument validators of generations.getCandidateScoreSummary. */
export const getCandidateScoreSummaryArgs = { generationId: v.id("generations") };

/** Handler of generations.getCandidateScoreSummary. */
export async function getCandidateScoreSummaryHandler(
  ctx: QueryCtx,
  args: ObjectType<typeof getCandidateScoreSummaryArgs>
) {
  const generation = await ctx.db.get(args.generationId);
  if (!generation) return null;
  const access = await getInternalProjectAccessOrNull(ctx, generation.projectId);
  if (!access) return null;
  // Only the caller's own scores: the panel is titled "Your score", and two
  // teammates scoring the same blind option would otherwise produce rows
  // sharing an optionPosition — the UI keys its table on optionPosition
  // (each_key_duplicate class, Aug 18 audit).
  const scores = (
    await ctx.db
      .query("candidateScores")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(100)
  ).filter((score) => score.userId === access.user._id);
  if (scores.length === 0) return null;
  const selections = await ctx.db
    .query("modelSelections")
    .withIndex("by_projectId", (q) => q.eq("projectId", generation.projectId))
    .take(1_000);
  const chosenModel =
    selections.find((selection) => selection.generationId === generation._id)
      ?.model ?? null;
  return {
    chosenModel,
    rows: scores
      .sort((a, b) => a.optionPosition - b.optionPosition)
      .map((score) => ({
        optionPosition: score.optionPosition,
        model: score.model,
        label: score.label,
        score: score.score,
        comment: score.comment ?? "",
        qaScore: score.qaScore ?? null,
        chosen: score.model === chosenModel,
      })),
  };
}
