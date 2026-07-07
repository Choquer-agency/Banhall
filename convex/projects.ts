import { query, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .order("desc")
      .collect();
    return projects;
  },
});

/** BNH-23: edit the internal and/or formal SR&ED title on an existing project. */
export const updateProjectTitles = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    sredTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.title !== undefined && args.title.trim()) {
      patch.title = args.title.trim();
    }
    if (args.sredTitle !== undefined) {
      patch.sredTitle = args.sredTitle.trim() || undefined;
    }
    await ctx.db.patch(args.projectId, patch);
  },
});

/** BNH-36: set/clear the client's fiscal year-end on an existing project. */
/**
 * BNH-10: industry scopes Brain retrieval to same-industry exemplars. Optional —
 * without it the Brain still retrieves best PDs across all industries. Values
 * must match the Brain's industry strings (see docs/the-brain.md).
 */
export const updateProjectIndustry = mutation({
  args: {
    projectId: v.id("projects"),
    industry: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(args.projectId, {
      industry: args.industry,
      updatedAt: Date.now(),
    });
  },
});

export const updateProjectFiscalYear = mutation({
  args: {
    projectId: v.id("projects"),
    fiscalYearEnd: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }
    await ctx.db.patch(args.projectId, {
      fiscalYearEnd: args.fiscalYearEnd,
      updatedAt: Date.now(),
    });
  },
});

export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) return null;
    return project;
  },
});

export const getProjectByShareToken = query({
  args: { shareToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_shareToken", (q) => q.eq("shareToken", args.shareToken))
      .unique();
  },
});

export const createProject = mutation({
  args: {
    title: v.string(),
    sredTitle: v.optional(v.string()),
    clientName: v.string(),
    writer: v.optional(v.string()),
    interviewer: v.optional(v.string()),
    fiscalYearEnd: v.optional(v.number()),
    // BNH-10: routes Brain retrieval — must match the Brain namespace strings
    // (software / manufacturing / life-sciences, see docs/the-brain.md).
    industry: v.optional(v.string()),
    // BNH-39: review mode reviews an existing written PD instead of generating.
    mode: v.optional(v.union(v.literal("generate"), v.literal("review"))),
    transcriptContent: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const now = Date.now();
    const shareToken = generateShareToken();

    const projectId = await ctx.db.insert("projects", {
      title: args.title,
      clientName: args.clientName,
      ...(args.sredTitle ? { sredTitle: args.sredTitle } : {}),
      ...(args.writer ? { writer: args.writer } : {}),
      ...(args.interviewer ? { interviewer: args.interviewer } : {}),
      ...(args.fiscalYearEnd ? { fiscalYearEnd: args.fiscalYearEnd } : {}),
      ...(args.industry ? { industry: args.industry } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
      status: "draft",
      createdBy: userId,
      shareToken,
      createdAt: now,
      updatedAt: now,
    });

    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: args.transcriptContent,
      createdAt: now,
    });

    return { projectId, transcriptId };
  },
});

/**
 * Schedule report generation in the background.
 * Returns immediately — the client watches the generation record for progress.
 */
export const scheduleGenerateReport = mutation({
  args: {
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
    // BNH-45: writer's length preference — concise (quick review), standard,
    // or full (right up to the CRA line limits, easier to trim than to grow).
    lengthTarget: v.optional(
      v.union(v.literal("concise"), v.literal("standard"), v.literal("full"))
    ),
    // BNH-52: a completed test must not be silently re-run (cost + result
    // integrity). Re-running requires the explicit force from the confirm UI.
    force: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    const latestGen = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    if (latestGen?.status === "running") {
      throw new Error("A generation is already running for this project.");
    }
    if (
      (latestGen?.status === "completed" ||
        latestGen?.status === "awaiting_selection") &&
      !args.force
    ) {
      throw new Error(
        "This project already has a generated test. Re-running requires explicit confirmation."
      );
    }

    await ctx.scheduler.runAfter(0, internal.ai.pipeline.generateReport, {
      projectId: args.projectId,
      transcriptId: args.transcriptId,
      lengthTarget: args.lengthTarget,
    });
  },
});

export const updateProjectStatus = mutation({
  args: {
    projectId: v.id("projects"),
    status: v.union(
      v.literal("draft"),
      v.literal("generating"),
      v.literal("review"),
      v.literal("client_review"),
      v.literal("final")
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.projectId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const updateProjectTitle = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    await ctx.db.patch(args.projectId, {
      title: args.title.trim(),
      updatedAt: Date.now(),
    });
  },
});

export const deleteProject = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    // Delete related records
    const transcripts = await ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const t of transcripts) await ctx.db.delete(t._id);

    const reports = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of reports) await ctx.db.delete(r._id);

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of comments) await ctx.db.delete(c._id);

    const generations = await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const g of generations) await ctx.db.delete(g._id);

    const commenters = await ctx.db
      .query("commenters")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const c of commenters) await ctx.db.delete(c._id);

    const pdReviews = await ctx.db
      .query("pdReviews")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const r of pdReviews) await ctx.db.delete(r._id);

    const pdReviewEvents = await ctx.db
      .query("pdReviewEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const e of pdReviewEvents) await ctx.db.delete(e._id);

    await ctx.db.delete(args.projectId);
  },
});

function generateShareToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Base64url encoding: URL-safe, 32 characters, 192 bits of entropy
  const raw = String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
