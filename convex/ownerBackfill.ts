import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { normalizeEmail } from "./lib/email";
import {
  matchWriterText,
  ownerCandidates,
} from "./lib/ownerMatching";
import {
  getTeamRosterMemberOrNull,
  isTeamRosterMember,
  userDisplayLabel,
} from "./lib/teamRoster";

const totalsFields = {
  scanned: v.number(),
  ownerFromWriter: v.number(),
  ownerFromCreator: v.number(),
  flaggedForReview: v.number(),
  stageDrafting: v.number(),
  stageIntake: v.number(),
  skippedOwner: v.number(),
  skippedStage: v.number(),
};
const totalsValidator = v.object(totalsFields);

const emptyTotals = () => ({
  scanned: 0,
  ownerFromWriter: 0,
  ownerFromCreator: 0,
  flaggedForReview: 0,
  stageDrafting: 0,
  stageIntake: 0,
  skippedOwner: 0,
  skippedStage: 0,
});

function addTotals(
  left: ReturnType<typeof emptyTotals>,
  right: ReturnType<typeof emptyTotals>
) {
  return {
    scanned: left.scanned + right.scanned,
    ownerFromWriter: left.ownerFromWriter + right.ownerFromWriter,
    ownerFromCreator: left.ownerFromCreator + right.ownerFromCreator,
    flaggedForReview: left.flaggedForReview + right.flaggedForReview,
    stageDrafting: left.stageDrafting + right.stageDrafting,
    stageIntake: left.stageIntake + right.stageIntake,
    skippedOwner: left.skippedOwner + right.skippedOwner,
    skippedStage: left.skippedStage + right.skippedStage,
  };
}

/** Bounded preflight/postflight. Internal because it reports account collisions. */
export const report = internalQuery({
  args: {},
  returns: v.object({
    projectsScanned: v.number(),
    projectsTruncated: v.boolean(),
    missingOwner: v.number(),
    missingStage: v.number(),
    needsReview: v.number(),
    rosterScanned: v.number(),
    rosterTruncated: v.boolean(),
    duplicateNormalizedEmails: v.number(),
  }),
  handler: async (ctx) => {
    const [projectRows, rosterRows, reviewRows] = await Promise.all([
      ctx.db.query("projects").take(1_001),
      ctx.db.query("users").take(1_001),
      ctx.db
        .query("projects")
        .withIndex("by_ownerBackfillStatus", (q) =>
          q.eq("ownerBackfillStatus", "needs_review")
        )
        .take(1_001),
    ]);
    const projects = projectRows.slice(0, 1_000);
    const roster = rosterRows.slice(0, 1_000).filter(isTeamRosterMember);
    const emailCounts = new Map<string, number>();
    for (const user of roster) {
      const email = normalizeEmail(user.email);
      if (email) emailCounts.set(email, (emailCounts.get(email) ?? 0) + 1);
    }
    return {
      projectsScanned: projects.length,
      projectsTruncated: projectRows.length > 1_000,
      missingOwner: projects.filter((project) => project.ownerId === undefined).length,
      missingStage: projects.filter((project) => project.workflowStage === undefined).length,
      needsReview: Math.min(reviewRows.length, 1_000),
      rosterScanned: roster.length,
      rosterTruncated: rosterRows.length > 1_000,
      duplicateNormalizedEmails: [...emailCounts.values()].filter((count) => count > 1)
        .length,
    };
  },
});

/**
 * Invoke live mode once with a null cursor. It self-schedules the remaining
 * pages. Dry-run mode never schedules, so callers can walk cursors manually.
 */
export const backfillOwnership = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    actorId: v.id("users"),
    dryRun: v.optional(v.boolean()),
    totals: v.optional(totalsValidator),
    runKey: v.optional(v.string()),
  },
  returns: v.object({
    ...totalsFields,
    isDone: v.boolean(),
    continueCursor: v.string(),
    totals: totalsValidator,
  }),
  handler: async (ctx, args) => {
    const actor = await ctx.db.get(args.actorId);
    if (!actor || actor.role !== "admin" || actor.isAnonymous === true) {
      domainError("NOT_AUTHORIZED", "An active administrator must own this backfill run");
    }

    const [page, rosterRows] = await Promise.all([
      ctx.db.query("projects").paginate(args.paginationOpts),
      ctx.db.query("users").take(1_001),
    ]);
    if (rosterRows.length > 1_000) {
      throw new Error(
        "Ownership backfill stopped: the bounded team-roster cap was reached. Increase the migration design before continuing."
      );
    }
    const roster = rosterRows.filter(
      (user) => isTeamRosterMember(user) && user.role !== undefined
    );
    const batch = emptyTotals();
    batch.scanned = page.page.length;

    for (const project of page.page) {
      const patch: {
        ownerId?: typeof project.createdBy;
        ownerBackfillStatus?: "needs_review";
        workflowStage?: "intake" | "drafting";
        workflowUpdatedAt?: number;
        workflowVersion?: number;
      } = {};
      const now = Date.now();

      if (project.ownerId !== undefined || project.ownerBackfillStatus !== undefined) {
        batch.skippedOwner += 1;
      } else {
        const match = matchWriterText(project.writer, roster);
        const hasWriterText = Boolean(project.writer?.trim());
        const ownerId = match.kind === "matched" ? match.user._id : project.createdBy;
        patch.ownerId = ownerId;
        if (hasWriterText && match.kind !== "matched") {
          patch.ownerBackfillStatus = "needs_review";
          batch.flaggedForReview += 1;
        }
        if (match.kind === "matched") batch.ownerFromWriter += 1;
        else batch.ownerFromCreator += 1;
        if (!args.dryRun) {
          await ctx.db.insert("projectEvents", {
            projectId: project._id,
            type: "ownership_transferred",
            actorId: actor._id,
            to: ownerId,
            note:
              match.kind === "matched"
                ? "backfill:writer"
                : "backfill:creator-fallback",
            at: now,
          });
        }
      }

      if (project.workflowStage !== undefined) {
        batch.skippedStage += 1;
      } else {
        const report = await ctx.db
          .query("reports")
          .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
          .first();
        const stage = report ? "drafting" : "intake";
        patch.workflowStage = stage;
        patch.workflowUpdatedAt = now;
        if (stage === "drafting") batch.stageDrafting += 1;
        else batch.stageIntake += 1;
        if (!args.dryRun) {
          await ctx.db.insert("projectEvents", {
            projectId: project._id,
            type: "stage_changed",
            actorId: actor._id,
            to: stage,
            note: report
              ? "backfill:stage-heuristic:has-report"
              : "backfill:stage-heuristic:no-report",
            at: now,
          });
        }
      }

      if (!args.dryRun && Object.keys(patch).length > 0) {
        patch.workflowVersion = (project.workflowVersion ?? 0) + 1;
        await ctx.db.patch(project._id, patch);
      }
    }

    const totals = addTotals(args.totals ?? emptyTotals(), batch);
    if (!page.isDone && !args.dryRun) {
      await ctx.scheduler.runAfter(0, internal.ownerBackfill.backfillOwnership, {
        paginationOpts: {
          numItems: args.paginationOpts.numItems,
          cursor: page.continueCursor,
        },
        actorId: actor._id,
        dryRun: false,
        totals,
        ...(args.runKey ? { runKey: args.runKey } : {}),
      });
    }
    // The scheduler discards a continuation's return value. An optional stable
    // run key lets operators retain final aggregate evidence without relying on
    // transient logs. Upsert semantics keep resumed runs idempotent.
    if (page.isDone && !args.dryRun && args.runKey) {
      const runKey = args.runKey;
      const existing = await ctx.db
        .query("ownerBackfillRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          actorId: actor._id,
          totals,
          completedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("ownerBackfillRuns", {
          runKey,
          actorId: actor._id,
          totals,
          completedAt: Date.now(),
        });
      }
    }
    return { ...batch, isDone: page.isDone, continueCursor: page.continueCursor, totals };
  },
});

export const listReviewQueue = query({
  args: {},
  returns: v.object({
    rows: v.array(
      v.object({
        projectId: v.id("projects"),
        title: v.string(),
        clientName: v.string(),
        legacyWriter: v.string(),
        creatorLabel: v.string(),
        currentOwnerId: v.id("users"),
        currentOwnerLabel: v.string(),
        reason: v.union(
          v.literal("no_match"),
          v.literal("ambiguous"),
          v.literal("now_matched")
        ),
        candidates: v.array(
          v.object({
            userId: v.id("users"),
            label: v.string(),
            email: v.union(v.string(), v.null()),
            matchedBy: v.union(v.literal("email"), v.literal("name")),
          })
        ),
      })
    ),
    roster: v.array(
      v.object({
        userId: v.id("users"),
        label: v.string(),
        email: v.union(v.string(), v.null()),
      })
    ),
    truncated: v.boolean(),
  }),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const [projectRows, rosterRows] = await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_ownerBackfillStatus", (q) =>
          q.eq("ownerBackfillStatus", "needs_review")
        )
        .take(201),
      ctx.db.query("users").take(1_001),
    ]);
    if (rosterRows.length > 1_000) {
      domainError("INVALID_STATE", "The team roster is too large for the review queue");
    }
    const roster = rosterRows.filter(
      (user) => isTeamRosterMember(user) && user.role !== undefined
    );
    const rows = [];
    for (const project of projectRows.slice(0, 200)) {
      if (!project.ownerId) continue;
      const [creator, owner] = await Promise.all([
        ctx.db.get(project.createdBy),
        ctx.db.get(project.ownerId),
      ]);
      const match = matchWriterText(project.writer, roster);
      const candidates = ownerCandidates(match);
      const reason: "no_match" | "ambiguous" | "now_matched" =
        match.kind === "matched"
          ? "now_matched"
          : match.kind === "ambiguous"
            ? "ambiguous"
            : "no_match";
      rows.push({
        projectId: project._id,
        title: project.title,
        clientName: project.clientName,
        legacyWriter: project.writer?.trim() || "—",
        creatorLabel: creator ? userDisplayLabel(creator) : "Unknown creator",
        currentOwnerId: project.ownerId,
        currentOwnerLabel: owner ? userDisplayLabel(owner) : "Unknown owner",
        reason,
        candidates,
      });
    }
    return {
      rows,
      roster: roster
        .map((user) => ({
          userId: user._id,
          label: userDisplayLabel(user),
          email: user.email?.trim() || null,
        }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.userId.localeCompare(b.userId)),
      truncated: projectRows.length > 200,
    };
  },
});

export const assignOwnerFromReview = mutation({
  args: {
    projectId: v.id("projects"),
    toUserId: v.id("users"),
    expectedOwnerId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const actor = await requireRole(ctx, ["admin"]);
    const [project, target] = await Promise.all([
      ctx.db.get(args.projectId),
      getTeamRosterMemberOrNull(ctx, args.toUserId),
    ]);
    if (!project) domainError("NOT_FOUND", "Project not found");
    if (project.ownerBackfillStatus !== "needs_review") {
      domainError("INVALID_STATE", "This project no longer needs ownership review");
    }
    if (project.ownerId !== args.expectedOwnerId) {
      domainError("STALE_REVISION", "This project's owner changed. Review the latest value.");
    }
    if (!target?.role || (target.role !== "writer" && target.role !== "manager")) {
      domainError("INVALID_INPUT", "Choose a current Consultant or Manager");
    }

    if (project.ownerId === target._id) {
      await ctx.db.patch(project._id, { ownerBackfillStatus: undefined });
      return null;
    }
    const now = Date.now();
    await ctx.db.patch(project._id, {
      ownerId: target._id,
      ownerBackfillStatus: undefined,
      workflowUpdatedAt: now,
      workflowVersion: (project.workflowVersion ?? 0) + 1,
    });
    await ctx.db.insert("projectEvents", {
      projectId: project._id,
      type: "ownership_transferred",
      actorId: actor._id,
      from: project.ownerId,
      to: target._id,
      note: "review:manual-assign",
      at: now,
    });
    return null;
  },
});

export const confirmFallbackOwner = mutation({
  args: {
    projectId: v.id("projects"),
    expectedOwnerId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");
    if (project.ownerBackfillStatus !== "needs_review") {
      domainError("INVALID_STATE", "This project no longer needs ownership review");
    }
    if (project.ownerId !== args.expectedOwnerId) {
      domainError("STALE_REVISION", "This project's owner changed. Review the latest value.");
    }
    await ctx.db.patch(project._id, { ownerBackfillStatus: undefined });
    return null;
  },
});
