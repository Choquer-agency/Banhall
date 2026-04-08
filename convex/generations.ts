import {
  query,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import { assertProjectOwner } from "./lib/auth";

/**
 * Public query: get the latest generation for a project (for progress UI).
 * Requires authenticated owner. Strips internal agentOutputs.
 */
export const getLatestGeneration = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return null;

    return await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

/**
 * Public query: list all generations for a project.
 * Requires authenticated owner. Strips internal agentOutputs.
 */
export const listGenerations = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await assertProjectOwner(ctx, args.projectId);
    if (!project) return [];

    return await ctx.db
      .query("generations")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

// ─── Internal functions used by the pipeline action ──────────────────────────

export const createGeneration = internalMutation({
  args: {
    projectId: v.id("projects"),
    transcriptId: v.id("transcripts"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("generations", {
      projectId: args.projectId,
      transcriptId: args.transcriptId,
      status: "running",
      currentStep: "Starting...",
      startedAt: Date.now(),
    });
  },
});

export const getTranscriptContent = internalQuery({
  args: { transcriptId: v.id("transcripts") },
  handler: async (ctx, args) => {
    const transcript = await ctx.db.get(args.transcriptId);
    return transcript?.content ?? null;
  },
});

export const getProjectTitle = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    return project?.title ?? null;
  },
});

export const getNextReportVersion = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const latest = await ctx.db
      .query("reports")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
    return (latest?.version ?? 0) + 1;
  },
});

// ─── Mutations called by the pipeline action ─────────────────────────────────

export const updateGenerationStatus = internalMutation({
  args: {
    generationId: v.id("generations"),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed")
    ),
    currentStep: v.optional(v.string()),
    agentOutputs: v.optional(v.string()),
    error: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = { status: args.status };
    if (args.currentStep !== undefined) updates.currentStep = args.currentStep;
    if (args.agentOutputs !== undefined)
      updates.agentOutputs = args.agentOutputs;
    if (args.error !== undefined) updates.error = args.error;
    if (args.completedAt !== undefined) updates.completedAt = args.completedAt;
    await ctx.db.patch(args.generationId, updates);
  },
});

export const saveReport = internalMutation({
  args: {
    projectId: v.id("projects"),
    content: v.string(),
    version: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("reports", {
      projectId: args.projectId,
      content: args.content,
      version: args.version,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(args.projectId, {
      status: "review",
      updatedAt: now,
    });
  },
});

export const setProjectGenerating = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      status: "generating",
      updatedAt: Date.now(),
    });
  },
});

export const resetProjectToDraft = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      status: "draft",
      updatedAt: Date.now(),
    });
  },
});
