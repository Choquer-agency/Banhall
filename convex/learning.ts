import { query, internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./lib/auth";

/**
 * Learning loop storage + reads. Two digest kinds:
 *
 * - qa_calibration: writers vote on QA items and reclassify severities in the
 *   QA rail; a scheduled action distills that into a calibration block the QA
 *   agent reads on every future generation.
 * - draft_style: writers score blind candidate drafts 1-10 and leave comments;
 *   a scheduled action distills recurring critiques into style guidance the
 *   section drafting agents read on every future generation.
 *
 * The scheduled actions live in convex/ai/learning.ts. Nothing here is
 * auto-applied to scoring rules or the Brain; digests only tune agent prompts
 * and every version is kept for admin audit.
 */

const digestKind = v.union(v.literal("qa_calibration"), v.literal("draft_style"));

/** Most recent QA item feedback rows, compacted for the digest prompt. */
export const getFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("qaItemFeedback")
      .order("desc")
      .take(args.limit);
    return rows.map((row) => ({
      section: row.section,
      itemKind: row.itemKind,
      // Cap item text so one verbose QA finding cannot dominate the prompt.
      itemText: row.itemText.slice(0, 240),
      originalSeverity: row.originalSeverity ?? null,
      overrideSeverity: row.overrideSeverity ?? null,
      vote: row.vote ?? null,
      updatedAt: row.updatedAt,
    }));
  },
});

/** Most recent writer scores/comments on blind candidate drafts. */
export const getCandidateFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("candidateScores")
      .order("desc")
      .take(args.limit);
    return rows.map((row) => ({
      score: row.score, // writer's 1-10
      comment: row.comment?.slice(0, 500) ?? null,
      aiQaScore: row.qaScore ?? null,
      updatedAt: row.updatedAt,
    }));
  },
});

/** Recent section-by-section edit events (draft vs approved vs ghost) for the
 * draft_style digest. Skips near-untouched approvals — no critique signal. */
export const getSectionEditsForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sectionEditEvents")
      .order("desc")
      .take(args.limit);
    return rows
      .filter((row) => row.editRatio >= 0.05)
      .map((row) => ({
        section: row.section,
        // Cap for the prompt — the stored rows keep more.
        draftText: row.draftText.slice(0, 2000),
        approvedText: row.approvedText.slice(0, 2000),
        ghostText: row.ghostText?.slice(0, 1200) ?? null,
        editRatio: Math.round(row.editRatio * 100) / 100,
        updatedAt: row.createdAt,
      }));
  },
});

/** Active digest (newest row of the kind), or null when nothing learned yet. */
export const getActiveDigest = internalQuery({
  args: { kind: digestKind },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("learningDigests")
      .withIndex("by_kind", (q) => q.eq("kind", args.kind))
      .order("desc")
      .first();
  },
});

export const saveDigest = internalMutation({
  args: {
    kind: digestKind,
    content: v.string(),
    sourceCount: v.number(),
    feedbackCutoff: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("learningDigests", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/**
 * Admin visibility: what the system currently "learned" plus history, so a
 * human can audit every change to agent behaviour. Silent drift is not
 * acceptable for a CRA tool.
 */
export const getDigestHistory = query({
  args: { kind: digestKind },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const history = await ctx.db
      .query("learningDigests")
      .withIndex("by_kind", (q) => q.eq("kind", args.kind))
      .order("desc")
      .take(20);
    return history.map((digest) => ({
      _id: digest._id,
      content: digest.content,
      sourceCount: digest.sourceCount,
      model: digest.model,
      createdAt: digest.createdAt,
    }));
  },
});
