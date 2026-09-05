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
import { MIN_PROMOTABLE_FEEDBACK_CHARS } from "./brain";
import { deidentify } from "./lib/deidentify";
import {
  admissionValidator,
  attemptOutcomeValidator,
  type AdmissionSnapshot,
  type AttemptOutcome,
} from "./lib/learningAdmission";
import type { Doc, Id } from "./_generated/dataModel";

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

/** One cache per bounded query; missing projects still get contact scrubbing. */
function projectScrubber(ctx: QueryCtx) {
  const projects = new Map<Id<"projects">, Doc<"projects"> | null>();
  return async (projectId: Id<"projects"> | undefined) => {
    if (projectId && !projects.has(projectId)) {
      projects.set(projectId, await ctx.db.get(projectId));
    }
    const project = projectId ? (projects.get(projectId) ?? null) : null;
    return (text: string, limit: number) =>
      deidentify(text, project).slice(0, limit);
  };
}

/** Bounded signal envelopes keep attribution separate from sanitized prose. */
export const getFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("qaItemFeedback")
      .order("desc")
      .take(args.limit);
    const scrubProject = projectScrubber(ctx);
    const results = [];
    for (const row of rows) {
      const scrub = await scrubProject(row.projectId);
      results.push({
        signalId: row._id,
        producerId: row.userId,
        projectId: row.projectId,
        updatedAt: row.updatedAt,
        payload: {
          section: row.section,
          itemKind: row.itemKind,
          itemText: scrub(row.itemText, 240),
          originalSeverity: row.originalSeverity ?? null,
          overrideSeverity: row.overrideSeverity ?? null,
          vote: row.vote ?? null,
        },
      });
    }
    return results;
  },
});

export const getCandidateFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("candidateScores")
      .order("desc")
      .take(args.limit);
    const scrubProject = projectScrubber(ctx);
    const results = [];
    for (const row of rows) {
      const scrub = await scrubProject(row.projectId);
      results.push({
        signalId: row._id,
        producerId: row.userId,
        projectId: row.projectId,
        updatedAt: row.updatedAt,
        payload: {
          score: row.score,
          comment: row.comment === undefined ? null : scrub(row.comment, 500),
          aiQaScore: row.qaScore ?? null,
        },
      });
    }
    return results;
  },
});

export const getProposalWordingEditsForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("proposalWordingEditEvents")
      .order("desc")
      .take(args.limit);
    const scrubProject = projectScrubber(ctx);
    const results = [];
    for (const row of rows) {
      const scrub = await scrubProject(row.projectId);
      results.push({
        signalId: row._id,
        producerId: row.userId,
        projectId: row.projectId,
        updatedAt: row.createdAt,
        payload: {
          originalText: scrub(row.originalText, 2000),
          editedText: scrub(row.editedText, 2000),
        },
      });
    }
    return results;
  },
});

/** Near-untouched approvals remain ineligible before admission. */
export const getSectionEditsForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("sectionEditEvents")
      .order("desc")
      .take(args.limit);
    const scrubProject = projectScrubber(ctx);
    const results = [];
    for (const row of rows) {
      if (!(row.editRatio >= 0.05)) continue;
      const scrub = await scrubProject(row.projectId);
      results.push({
        signalId: row._id,
        producerId: row.userId ?? null,
        projectId: row.projectId,
        updatedAt: row.createdAt,
        payload: {
          section: row.section,
          draftText: scrub(row.draftText, 2000),
          approvedText: scrub(row.approvedText, 2000),
          ghostText:
            row.ghostText === undefined ? null : scrub(row.ghostText, 1200),
          editRatio: Math.round(row.editRatio * 100) / 100,
        },
      });
    }
    return results;
  },
});

/** Approved, promotable writer feedback uses approval-time freshness. */
export const getApprovedBrainFeedbackForDigest = internalQuery({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("brainFeedbackQueue")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .order("desc")
      .take(args.limit);
    const scrubProject = projectScrubber(ctx);
    const items = [];
    for (const row of rows) {
      const rule = row.suggestedRule?.trim();
      const body = row.body.trim();
      if (!rule && body.length < MIN_PROMOTABLE_FEEDBACK_CHARS) continue;
      const decision = await ctx.db
        .query("brainAuditLog")
        .withIndex("by_feedbackId", (q) => q.eq("feedbackId", row._id))
        .order("desc")
        .first();
      const scrub = await scrubProject(row.projectId);
      items.push({
        signalId: row._id,
        producerId: row.fromUserId,
        projectId: row.projectId ?? null,
        // Historical approvals without linked audits retain submission fallback.
        updatedAt: decision?.at ?? row.createdAt,
        payload: {
          suggestedRule: rule ? scrub(rule, 300) : null,
          body: scrub(body, 1000),
        },
      });
    }
    return items;
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
    admission: v.optional(admissionValidator),
  },
  handler: async (ctx, args) => {
    const newest = await latestGlobalDigest(ctx, args.kind);
    if (newest && args.feedbackCutoff <= newest.feedbackCutoff) {
      if (args.admission)
        await saveAttempt(ctx, args.kind, "deduplicated", args.admission);
      return null;
    }

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

    const digestId = await ctx.db.insert("learningDigests", {
      ...args,
      createdAt: Date.now(),
    });
    if (args.admission)
      await saveAttempt(ctx, args.kind, "saved", args.admission);
    return digestId;
  },
});

/** Upsert inside the same transaction as a saved/deduplicated candidate. */
async function saveAttempt(
  ctx: MutationCtx,
  kind: "qa_calibration" | "draft_style",
  outcome: AttemptOutcome,
  admission: AdmissionSnapshot,
) {
  const prior = await ctx.db
    .query("learningDigestAttempts")
    .withIndex("by_kind", (q) => q.eq("kind", kind))
    .unique();
  const result = { kind, outcome, admission, attemptedAt: Date.now() };
  if (prior) await ctx.db.replace(prior._id, result);
  else await ctx.db.insert("learningDigestAttempts", result);
}

export const recordDigestAttempt = internalMutation({
  args: {
    kind: digestKind,
    outcome: attemptOutcomeValidator,
    admission: admissionValidator,
  },
  handler: async (ctx, args) => {
    await saveAttempt(ctx, args.kind, args.outcome, args.admission);
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
      latestAttempt: await ctx.db
        .query("learningDigestAttempts")
        .withIndex("by_kind", (q) => q.eq("kind", args.kind))
        .unique(),
      publishedDigestId,
      selectionId: currentSelection?._id ?? null,
      explicitlyDisabled: currentSelection?.selectedDigestId === null,
      digests: visibleDigests.map((digest) => ({
        _id: digest._id,
        content: digest.content,
        sourceCount: digest.sourceCount,
        admission: digest.admission,
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
    // CAP-1: de-identification is best effort, so publishing a digest
    // firm-wide requires an administrator to confirm they read it and found
    // no client identifier. Only required on the publish path.
    privacyReviewed: v.optional(v.boolean()),
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
      if (args.privacyReviewed !== true) {
        throw new Error(
          "Confirm the privacy review before publishing: this version must be free of client names, project titles, emails, and phone numbers.",
        );
      }
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
