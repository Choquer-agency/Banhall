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
    clientName: v.string(),
    writer: v.optional(v.string()),
    interviewer: v.optional(v.string()),
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
      ...(args.writer ? { writer: args.writer } : {}),
      ...(args.interviewer ? { interviewer: args.interviewer } : {}),
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
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const project = await ctx.db.get(args.projectId);
    if (!project || project.createdBy !== userId) {
      throw new Error("Not authorized");
    }

    await ctx.scheduler.runAfter(0, internal.ai.pipeline.generateReport, {
      projectId: args.projectId,
      transcriptId: args.transcriptId,
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
