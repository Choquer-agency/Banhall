import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./lib/auth";
import { domainError } from "./lib/contracts";
import { requireAnthropicConfigured } from "./lib/providerConfig";

const fileTypeValidator = v.union(
  v.literal("slack_export"),
  v.literal("whatsapp_chat"),
  v.literal("git_log"),
  v.literal("timesheet"),
  v.literal("trial_balance"),
  v.literal("general_ledger"),
  v.literal("other")
);

async function rebuildSummary(
  ctx: MutationCtx,
  projectId: Id<"projects">
): Promise<void> {
  const entries = await ctx.db
    .query("timesheetEntries")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(5_001);
  if (entries.length > 5_000) {
    domainError(
      "INVALID_INPUT",
      "This project has too many financial entries to summarize safely"
    );
  }
  const summaries = await ctx.db
    .query("financialSummaries")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(100);
  for (const summary of summaries) await ctx.db.delete(summary._id);
  if (entries.length === 0) return;

  const people = new Map<
    string,
    { totalHours: number; sredHours: number; primaryActivities: string[] }
  >();
  let totalHours = 0;
  let sredHours = 0;
  for (const entry of entries.filter((row) => row.reviewStatus === "approved")) {
    totalHours += entry.hours;
    if (entry.sredEligible) sredHours += entry.hours;
    const person = people.get(entry.personName) ?? {
      totalHours: 0,
      sredHours: 0,
      primaryActivities: [],
    };
    person.totalHours += entry.hours;
    if (entry.sredEligible) person.sredHours += entry.hours;
    if (
      person.primaryActivities.length < 8 &&
      !person.primaryActivities.includes(entry.description)
    ) {
      person.primaryActivities.push(entry.description);
    }
    people.set(entry.personName, person);
  }
  const personnelBreakdown = Array.from(people, ([name, values]) => ({
    name,
    ...values,
  }));
  await ctx.db.insert("financialSummaries", {
    projectId,
    totalHours,
    sredHours,
    nonSredHours: totalHours - sredHours,
    personnelBreakdown: JSON.stringify({ personnelBreakdown }),
    generatedAt: Date.now(),
  });
}

export const uploadAndScheduleFinancialData = mutation({
  args: {
    projectId: v.id("projects"),
    fileName: v.string(),
    fileType: fileTypeValidator,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireInternalProjectAccess(ctx, args.projectId);
    requireAnthropicConfigured("financial");
    const fileName = args.fileName.trim();
    const content = args.content.trim();
    if (!fileName || fileName.length > 255) {
      domainError("INVALID_INPUT", "Enter a file name under 255 characters");
    }
    if (!content || content.length > 200_000) {
      domainError(
        "INVALID_INPUT",
        "Financial input must contain between 1 and 200,000 characters"
      );
    }
    const uploadId = await ctx.db.insert("financialUploads", {
      projectId: args.projectId,
      fileName,
      fileType: args.fileType,
      content,
      processingStatus: "queued",
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(
      0,
      internal.ai.financialAgent.processFinancialUpload,
      { projectId: args.projectId, uploadId }
    );
    return uploadId;
  },
});

export const listUploads = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    const uploads = await ctx.db
      .query("financialUploads")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(250);
    return uploads.map((upload) => ({
      _id: upload._id,
      fileName: upload.fileName,
      fileType: upload.fileType,
      processingStatus: upload.processingStatus ?? "legacy_unknown",
      processingError: upload.processingError,
      createdAt: upload.createdAt,
      startedAt: upload.startedAt,
      completedAt: upload.completedAt,
    }));
  },
});

export const getTimesheetEntries = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return [];
    return await ctx.db
      .query("timesheetEntries")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(5_000);
  },
});

export const getFinancialSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    if (!(await getInternalProjectAccessOrNull(ctx, args.projectId))) return null;
    return await ctx.db
      .query("financialSummaries")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .first();
  },
});

export const markUploadRunning = internalMutation({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Financial upload project mismatch");
    }
    if (upload.processingStatus !== "queued") return false;
    await ctx.db.patch(args.uploadId, {
      processingStatus: "running",
      processingError: undefined,
      startedAt: Date.now(),
    });
    return true;
  },
});

export const replaceTimesheetEntries = internalMutation({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
    entries: v.array(
      v.object({
        personName: v.string(),
        date: v.string(),
        hours: v.number(),
        hoursBasis: v.union(v.literal("explicit"), v.literal("estimated")),
        description: v.string(),
        sredEligible: v.boolean(),
        sredReason: v.optional(v.string()),
        confidence: v.union(
          v.literal("high"),
          v.literal("medium"),
          v.literal("low")
        ),
        source: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.projectId !== args.projectId) {
      domainError("NOT_AUTHORIZED", "Financial upload project mismatch");
    }
    if (args.entries.length > 500) {
      domainError("INVALID_INPUT", "Financial extraction returned too many entries");
    }
    const oldEntries = await ctx.db
      .query("timesheetEntries")
      .withIndex("by_uploadId", (q) => q.eq("uploadId", args.uploadId))
      .take(501);
    for (const entry of oldEntries) await ctx.db.delete(entry._id);
    for (const entry of args.entries) {
      if (
        !entry.personName.trim() ||
        !entry.description.trim() ||
        !Number.isFinite(entry.hours) ||
        entry.hours < 0 ||
        entry.hours > 24
      ) {
        domainError("INVALID_INPUT", "Financial extraction returned an invalid entry");
      }
      await ctx.db.insert("timesheetEntries", {
        projectId: args.projectId,
        uploadId: args.uploadId,
        ...entry,
        reviewStatus: "pending",
      });
    }
    await rebuildSummary(ctx, args.projectId);
    await ctx.db.patch(args.uploadId, {
      processingStatus: "completed",
      completedAt: Date.now(),
      processingError: undefined,
    });
  },
});

export const reviewTimesheetEntry = mutation({
  args: {
    entryId: v.id("timesheetEntries"),
    status: v.union(v.literal("approved"), v.literal("rejected")),
    hours: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.entryId);
    if (!entry) domainError("NOT_FOUND", "Timesheet entry not found");
    const { user } = await requireInternalProjectAccess(ctx, entry.projectId);
    const hours = args.hours ?? entry.hours;
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      domainError("INVALID_INPUT", "Reviewed hours must be between 0 and 24");
    }
    await ctx.db.patch(entry._id, {
      hours,
      reviewStatus: args.status,
      reviewedBy: user._id,
      reviewedAt: Date.now(),
    });
    await rebuildSummary(ctx, entry.projectId);
  },
});

export const markUploadFailed = internalMutation({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload || upload.projectId !== args.projectId) return;
    await ctx.db.patch(args.uploadId, {
      processingStatus: "failed",
      processingError: args.error.slice(0, 500),
      completedAt: Date.now(),
    });
  },
});

export const getUploadContent = internalQuery({
  args: {
    projectId: v.id("projects"),
    uploadId: v.id("financialUploads"),
  },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    return upload?.projectId === args.projectId ? upload : null;
  },
});

export const deleteUpload = mutation({
  args: { uploadId: v.id("financialUploads") },
  handler: async (ctx, args) => {
    const upload = await ctx.db.get(args.uploadId);
    if (!upload) return;
    await requireInternalProjectAccess(ctx, upload.projectId);
    const entries = await ctx.db
      .query("timesheetEntries")
      .withIndex("by_uploadId", (q) => q.eq("uploadId", args.uploadId))
      .take(501);
    if (entries.length > 500) {
      domainError("INVALID_INPUT", "Financial upload exceeds the safe deletion limit");
    }
    for (const entry of entries) await ctx.db.delete(entry._id);
    await ctx.db.delete(args.uploadId);
    await rebuildSummary(ctx, upload.projectId);
  },
});
