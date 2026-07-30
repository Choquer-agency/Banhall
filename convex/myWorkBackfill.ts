import { internal } from "./_generated/api";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { desiredOversightViewers, syncOversightForItem } from "./lib/workItemOversight";
import { workItemDueSortAt } from "../shared/workItems";
import { workflowStageRank } from "../shared/workflowStages";

const BATCH_SIZE = 50;
const STALLED_AFTER_MS = 10 * 60_000;
type Phase = "projects" | "workItems" | "verifyProjects" | "verifyWorkItems";

async function getRun(ctx: MutationCtx, runKey: string) {
  return await ctx.db.query("myWorkBackfillRuns").withIndex("by_runKey", (q) => q.eq("runKey", runKey)).unique();
}

async function schedulePhase(ctx: MutationCtx, runKey: string, phase: Phase) {
  const fn = phase === "projects"
    ? internal.myWorkBackfill.processProjects
    : phase === "workItems"
      ? internal.myWorkBackfill.processWorkItems
      : phase === "verifyProjects"
        ? internal.myWorkBackfill.verifyProjects
        : internal.myWorkBackfill.verifyWorkItems;
  await ctx.scheduler.runAfter(0, fn, { runKey });
}

async function createRun(ctx: MutationCtx, dryRun: boolean, runKey: string) {
  const existing = await getRun(ctx, runKey);
  if (existing) return { started: false, runKey, status: existing.status };
  const now = Date.now();
  await ctx.db.insert("myWorkBackfillRuns", {
    runKey,
    status: "running",
    phase: "projects",
    dryRun,
    scanned: 0,
    patched: 0,
    verificationMismatches: 0,
    startedAt: now,
    updatedAt: now,
  });
  await schedulePhase(ctx, runKey, "projects");
  return { started: true, runKey };
}

async function failRun(ctx: MutationCtx, runKey: string, error: unknown) {
  const run = await getRun(ctx, runKey);
  if (!run || run.status !== "running") return;
  const message = error instanceof Error ? error.message.slice(0, 500) : "My work backfill failed";
  await ctx.db.patch(run._id, { status: "failed", lastError: message, updatedAt: Date.now() });
}

export const runInternal = internalMutation({
  args: { dryRun: v.optional(v.boolean()), runKey: v.string() },
  handler: async (ctx, args) => {
    const actor = (await ctx.db.query("users").take(200)).find((user) => user.role === "admin" && user.isAnonymous !== true);
    if (!actor) throw new Error("A development administrator is required for the My work backfill");
    return await createRun(ctx, args.dryRun ?? true, args.runKey);
  },
});

export const run = mutation({
  args: { dryRun: v.optional(v.boolean()), runKey: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return await createRun(ctx, args.dryRun ?? true, args.runKey);
  },
});

export const resumeInternal = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runKey);
    if (!run) throw new Error("My work backfill run not found");
    if (run.status === "completed") return { resumed: false, status: run.status };
    const phase = run.status === "failed" && (run.phase === "verifyProjects" || run.phase === "verifyWorkItems")
      ? "workItems"
      : (run.phase ?? "projects");
    await ctx.db.patch(run._id, { status: "running", phase, cursor: undefined, ...(phase === "workItems" ? { verificationMismatches: 0 } : {}), lastError: undefined, updatedAt: Date.now() });
    await schedulePhase(ctx, args.runKey, phase);
    return { resumed: true, status: "running" as const };
  },
});

export const resume = mutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    const run = await getRun(ctx, args.runKey);
    if (!run) domainError("NOT_FOUND", "My work backfill run not found");
    if (run.status === "completed") return { resumed: false, status: run.status };
    const phase = run.status === "failed" && (run.phase === "verifyProjects" || run.phase === "verifyWorkItems")
      ? "workItems"
      : (run.phase ?? "projects");
    await ctx.db.patch(run._id, { status: "running", phase, cursor: undefined, ...(phase === "workItems" ? { verificationMismatches: 0 } : {}), lastError: undefined, updatedAt: Date.now() });
    await schedulePhase(ctx, args.runKey, phase);
    return { resumed: true, status: "running" as const };
  },
});

export const processProjects = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runKey);
    if (!run || run.status !== "running" || (run.phase ?? "projects") !== "projects") return null;
    try {
      const page = await ctx.db.query("projects").paginate({ cursor: run.cursor ?? null, numItems: BATCH_SIZE });
      let patched = run.patched;
      for (const project of page.page) {
        const rank = workflowStageRank(project.workflowStage);
        if (project.workflowStageRank !== rank) {
          patched += 1;
          if (!run.dryRun) await ctx.db.patch(project._id, { workflowStageRank: rank });
        }
      }
      const next = page.isDone
        ? { phase: "workItems" as const, cursor: undefined }
        : { phase: "projects" as const, cursor: page.continueCursor };
      await ctx.db.patch(run._id, { ...next, scanned: run.scanned + page.page.length, patched, updatedAt: Date.now() });
      await schedulePhase(ctx, args.runKey, next.phase);
    } catch (error) {
      await failRun(ctx, args.runKey, error);
    }
    return null;
  },
});

export const processWorkItems = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runKey);
    if (!run || run.status !== "running" || run.phase !== "workItems") return null;
    try {
      const page = await ctx.db.query("workItems").paginate({ cursor: run.cursor ?? null, numItems: BATCH_SIZE });
      let patched = run.patched;
      for (const item of page.page) {
        const dueSortAt = workItemDueSortAt(item.dueAt);
        if (item.dueSortAt !== dueSortAt) {
          patched += 1;
          if (!run.dryRun) await ctx.db.patch(item._id, { dueSortAt });
        }
        if (!run.dryRun && item.status === "open") {
          const project = await ctx.db.get(item.projectId);
          if (project) await syncOversightForItem(ctx, { ...item, dueSortAt }, project);
        }
      }
      const next = page.isDone
        ? { phase: "verifyProjects" as const, cursor: undefined }
        : { phase: "workItems" as const, cursor: page.continueCursor };
      await ctx.db.patch(run._id, { ...next, scanned: run.scanned + page.page.length, patched, updatedAt: Date.now() });
      await schedulePhase(ctx, args.runKey, next.phase);
    } catch (error) {
      await failRun(ctx, args.runKey, error);
    }
    return null;
  },
});

export const verifyProjects = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runKey);
    if (!run || run.status !== "running" || run.phase !== "verifyProjects") return null;
    try {
      const page = await ctx.db.query("projects").paginate({ cursor: run.cursor ?? null, numItems: BATCH_SIZE });
      const mismatches = (run.verificationMismatches ?? 0) + page.page.filter((row) => row.workflowStageRank !== workflowStageRank(row.workflowStage)).length;
      const next = page.isDone
        ? { phase: "verifyWorkItems" as const, cursor: undefined }
        : { phase: "verifyProjects" as const, cursor: page.continueCursor };
      await ctx.db.patch(run._id, { ...next, verificationMismatches: mismatches, updatedAt: Date.now() });
      await schedulePhase(ctx, args.runKey, next.phase);
    } catch (error) {
      await failRun(ctx, args.runKey, error);
    }
    return null;
  },
});

export const verifyWorkItems = internalMutation({
  args: { runKey: v.string() },
  handler: async (ctx, args) => {
    const run = await getRun(ctx, args.runKey);
    if (!run || run.status !== "running" || run.phase !== "verifyWorkItems") return null;
    try {
      const page = await ctx.db.query("workItems").paginate({ cursor: run.cursor ?? null, numItems: BATCH_SIZE });
      let pageMismatches = 0;
      for (const item of page.page) {
        if (item.dueSortAt !== workItemDueSortAt(item.dueAt)) pageMismatches += 1;
        const rows = await ctx.db.query("workItemOversight").withIndex("by_workItemId", (q) => q.eq("workItemId", item._id)).take(5);
        const project = await ctx.db.get(item.projectId);
        const desired = project ? desiredOversightViewers(item, project) : new Map();
        if (rows.length !== desired.size) {
          pageMismatches += 1;
          continue;
        }
        for (const row of rows) {
          const reason = desired.get(row.viewerId);
          if (!reason || row.projectId !== item.projectId || row.assigneeId !== item.assigneeId || row.dueSortAt !== workItemDueSortAt(item.dueAt) || row.sourceAssigner !== reason.sourceAssigner || row.sourceOwner !== reason.sourceOwner) {
            pageMismatches += 1;
            break;
          }
        }
      }
      const mismatches = (run.verificationMismatches ?? 0) + pageMismatches;
      const now = Date.now();
      if (page.isDone) {
        await ctx.db.patch(run._id, {
          status: mismatches === 0 ? "completed" : "failed",
          cursor: undefined,
          verificationMismatches: mismatches,
          verifiedAt: now,
          ...(mismatches === 0 ? { completedAt: now, lastError: undefined } : { lastError: `Verification found ${mismatches} projection mismatch${mismatches === 1 ? "" : "es"}` }),
          updatedAt: now,
        });
      } else {
        await ctx.db.patch(run._id, { cursor: page.continueCursor, verificationMismatches: mismatches, updatedAt: now });
        await schedulePhase(ctx, args.runKey, "verifyWorkItems");
      }
    } catch (error) {
      await failRun(ctx, args.runKey, error);
    }
    return null;
  },
});

export const sweepStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - STALLED_AFTER_MS;
    const rows = await ctx.db.query("myWorkBackfillRuns").withIndex("by_status_and_updatedAt", (q) => q.eq("status", "running").lt("updatedAt", cutoff)).take(25);
    for (const run of rows) await schedulePhase(ctx, run.runKey, run.phase ?? "projects");
    return null;
  },
});
