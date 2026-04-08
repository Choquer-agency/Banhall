import { query, mutation, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const uploadFinancialData = mutation({
  args: {
    projectId: v.id("projects"),
    fileName: v.string(),
    fileType: v.union(
      v.literal("slack_export"),
      v.literal("whatsapp_chat"),
      v.literal("git_log"),
      v.literal("timesheet"),
      v.literal("trial_balance"),
      v.literal("general_ledger"),
      v.literal("other")
    ),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("financialUploads", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const listUploads = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialUploads")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const getTimesheetEntries = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("timesheetEntries")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const getFinancialSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("financialSummaries")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

// Internal mutations used by the financial pipeline
export const saveTimesheetEntries = internalMutation({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
    entries: v.array(
      v.object({
        personName: v.string(),
        date: v.string(),
        hours: v.number(),
        description: v.string(),
        sredEligible: v.boolean(),
        sredReason: v.optional(v.string()),
        confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
        source: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const entry of args.entries) {
      await ctx.db.insert("timesheetEntries", {
        projectId: args.projectId,
        uploadId: args.uploadId,
        ...entry,
      });
    }
  },
});

export const saveFinancialSummary = internalMutation({
  args: {
    projectId: v.id("projects"),
    totalHours: v.number(),
    sredHours: v.number(),
    nonSredHours: v.number(),
    personnelBreakdown: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("financialSummaries", {
      ...args,
      generatedAt: Date.now(),
    });
  },
});

export const getUploadContent = internalQuery({
  args: { uploadId: v.id("financialUploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    return upload;
  },
});

export const deleteUpload = mutation({
  args: { uploadId: v.id("financialUploads") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.delete(args.uploadId);
  },
});
