import {
  mutation,
  query,
  internalQuery,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { requireCapability } from "./lib/roleCapabilities";

/**
 * Learning loop storage + governed publication.
 *
 * Distillation creates immutable candidates. A separate append-only selection
 * ledger controls which global candidate, if any, may affect production
 * prompts. This keeps human activity as a learning signal without allowing an
 * automatic model call to silently change firm-wide behavior.
 */

const digestKind = v.union(
  v.literal("qa_calibration"),
  v.literal("draft_style"),
);
const MAX_REASON_LENGTH = 500;

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
      score: row.score,
      comment: row.comment?.slice(0, 500) ?? null,
      aiQaScore: row.qaScore ?? null,
      updatedAt: row.updatedAt,
    }));
  },
});

/** Direct edits to AI proposal wording, including edits made in normal chat. */
export const getProposalWordingEditsForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("proposalWordingEditEvents")
      .order("desc")
      .take(args.limit);
    return rows.map((row) => ({
      originalText: row.originalText.slice(0, 2000),
      editedText: row.editedText.slice(0, 2000),
      updatedAt: row.createdAt,
    }));
  },
});

/** Recent section edits with near-untouched approvals removed. */
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
        draftText: row.draftText.slice(0, 2000),
        approvedText: row.approvedText.slice(0, 2000),
        ghostText: row.ghostText?.slice(0, 1200) ?? null,
        editRatio: Math.round(row.editRatio * 100) / 100,
        updatedAt: row.createdAt,
      }));
  },
});

type DigestCtx = QueryCtx | MutationCtx;

async function latestGlobalDigest(
  ctx: DigestCtx,
  kind: "qa_calibration" | "draft_style",
) {
  return await ctx.db
    .query("learningDigests")
    .withIndex("by_kind_and_userId", (q) =>
      q.eq("kind", kind).eq("userId", undefined),
    )
    .order("desc")
    .first();
}

async function latestSelection(
  ctx: DigestCtx,
  kind: "qa_calibration" | "draft_style",
) {
  return await ctx.db
    .query("learningDigestSelections")
    .withIndex("by_kind", (q) => q.eq("kind", kind))
    .order("desc")
    .first();
}

/**
 * Published digest, or null when explicitly disabled.
 *
 * Compatibility: before the first selection event, the newest legacy global
 * digest remains active. saveDigest atomically freezes that legacy choice
 * before inserting the first post-governance candidate.
 */
export const getActiveDigest = internalQuery({
  args: { kind: digestKind },
  handler: async (ctx, args) => {
    const selection = await latestSelection(ctx, args.kind);
    if (!selection) return await latestGlobalDigest(ctx, args.kind);
    if (!selection.selectedDigestId) return null;
    const digest = await ctx.db.get(selection.selectedDigestId);
    if (!digest || digest.kind !== args.kind || digest.userId) return null;
    return digest;
  },
});

/** Newest generated candidate, used only for freshness/deduplication. */
export const getLatestGeneratedDigest = internalQuery({
  args: { kind: digestKind },
  handler: async (ctx, args) => await latestGlobalDigest(ctx, args.kind),
});

/**
 * Save an immutable candidate. The first post-deploy save freezes the current
 * legacy choice before inserting, so a newly generated candidate cannot leak
 * into production through compatibility behavior.
 */
export const saveDigest = internalMutation({
  args: {
    kind: digestKind,
    content: v.string(),
    sourceCount: v.number(),
    feedbackCutoff: v.number(),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    const newest = await latestGlobalDigest(ctx, args.kind);
    if (newest && args.feedbackCutoff <= newest.feedbackCutoff) return null;

    const selection = await latestSelection(ctx, args.kind);
    if (!selection) {
      await ctx.db.insert("learningDigestSelections", {
        kind: args.kind,
        selectedDigestId: newest?._id ?? null,
        actorKind: "system",
        action: "compatibility_freeze",
        reason: newest
          ? "Froze the pre-governance production digest."
          : "Froze learning guidance as disabled until administrator publication.",
        selectedAt: Date.now(),
      });
    }

    return await ctx.db.insert("learningDigests", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

/** Admin review model: published guidance, unpublished candidates, and ledger. */
export const getDigestHistory = query({
  args: { kind: digestKind },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "settings.configure");
    const [digests, selectionEvents] = await Promise.all([
      ctx.db
        .query("learningDigests")
        .withIndex("by_kind", (q) => q.eq("kind", args.kind))
        .order("desc")
        .take(20),
      ctx.db
        .query("learningDigestSelections")
        .withIndex("by_kind", (q) => q.eq("kind", args.kind))
        .order("desc")
        .take(20),
    ]);
    const currentSelection = selectionEvents[0] ?? null;
    const legacyPublishedId =
      digests.find((digest) => !digest.userId)?._id ?? null;
    const publishedDigestId = currentSelection
      ? currentSelection.selectedDigestId
      : legacyPublishedId;
    const publishedDigest = publishedDigestId
      ? await ctx.db.get(publishedDigestId)
      : null;
    const visibleDigests =
      publishedDigest &&
      !digests.some((digest) => digest._id === publishedDigest._id)
        ? [publishedDigest, ...digests]
        : digests;
    return {
      publishedDigestId,
      selectionId: currentSelection?._id ?? null,
      explicitlyDisabled: currentSelection?.selectedDigestId === null,
      digests: visibleDigests.map((digest) => ({
        _id: digest._id,
        content: digest.content,
        sourceCount: digest.sourceCount,
        feedbackCutoff: digest.feedbackCutoff,
        model: digest.model,
        createdAt: digest.createdAt,
        isPersonal: Boolean(digest.userId),
      })),
      selections: selectionEvents.map((event) => ({
        _id: event._id,
        selectedDigestId: event.selectedDigestId,
        action: event.action,
        actorKind: event.actorKind,
        actorUserId: event.actorUserId,
        reason: event.reason,
        selectedAt: event.selectedAt,
      })),
    };
  },
});

/** Publish, roll back to, or disable immutable learning guidance. */
export const selectDigest = mutation({
  args: {
    kind: digestKind,
    digestId: v.union(v.id("learningDigests"), v.null()),
    expectedSelectionId: v.union(v.id("learningDigestSelections"), v.null()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireCapability(ctx, "settings.configure");
    const current = await latestSelection(ctx, args.kind);
    if ((current?._id ?? null) !== args.expectedSelectionId) {
      throw new Error(
        "Learning guidance changed since this page loaded. Refresh and try again.",
      );
    }

    if (args.digestId) {
      const digest = await ctx.db.get(args.digestId);
      if (!digest || digest.kind !== args.kind)
        throw new Error("Digest not found for this guidance type");
      if (digest.userId)
        throw new Error("Personal digests cannot be published globally");
    }

    if (current && current.selectedDigestId === args.digestId)
      return current._id;
    const reason = args.reason?.trim();
    if (reason && reason.length > MAX_REASON_LENGTH) {
      throw new Error(
        `Reason must be ${MAX_REASON_LENGTH} characters or fewer`,
      );
    }

    return await ctx.db.insert("learningDigestSelections", {
      kind: args.kind,
      selectedDigestId: args.digestId,
      previousSelectionId: current?._id,
      actorKind: "user",
      actorUserId: user._id,
      action: args.digestId ? "select" : "disable",
      reason: reason || undefined,
      selectedAt: Date.now(),
    });
  },
});
