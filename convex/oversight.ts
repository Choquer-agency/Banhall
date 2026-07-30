import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { syncOversightForItem } from "./lib/workItemOversight";

const RECONCILE_BATCH_SIZE = 50;
const MAX_REBUILD_ATTEMPTS = 5;

async function addSyncingRow(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  viewerId: Id<"users">,
  rebuildId: Id<"oversightRebuilds">,
  startedAt: number
) {
  const existing = await ctx.db
    .query("oversightSyncing")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(201);
  const row = existing.find((candidate) => candidate.viewerId === viewerId);
  if (row) await ctx.db.patch(row._id, { rebuildId, startedAt });
  else await ctx.db.insert("oversightSyncing", { projectId, viewerId, rebuildId, startedAt });
}

export async function scheduleOwnershipOversightRebuild(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">;
    reason: Doc<"oversightRebuilds">["reason"];
    fromOwnerId?: Id<"users">;
    toOwnerId: Id<"users">;
  }
) {
  const now = Date.now();
  const rebuildId = await ctx.db.insert("oversightRebuilds", {
    projectId: args.projectId,
    reason: args.reason,
    ...(args.fromOwnerId ? { fromOwnerId: args.fromOwnerId } : {}),
    toOwnerId: args.toOwnerId,
    affectedViewerIds: [],
    status: "pending",
    attempts: 0,
    startedAt: now,
    updatedAt: now,
  });
  const projectSyncingRows = await ctx.db.query("oversightSyncing").withIndex("by_projectId", (q) => q.eq("projectId", args.projectId)).take(201);
  const inheritedViewers = projectSyncingRows.map((row) => row.viewerId);
  const failedRebuilds = await ctx.db.query("oversightRebuilds").withIndex("by_projectId_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "failed")).take(201);
  for (const failed of failedRebuilds) {
    inheritedViewers.push(...(failed.affectedViewerIds ?? []));
    await ctx.db.patch(failed._id, { status: "superseded", completedAt: now, updatedAt: now });
  }
  const viewers = [...new Set([args.fromOwnerId, args.toOwnerId, ...inheritedViewers].filter(Boolean) as Id<"users">[])];
  await ctx.db.patch(rebuildId, { affectedViewerIds: viewers });
  for (const viewerId of viewers) await addSyncingRow(ctx, args.projectId, viewerId, rebuildId, now);
  await ctx.scheduler.runAfter(0, internal.oversight.reconcileProject, { rebuildId });
  return rebuildId;
}

async function clearSyncing(ctx: MutationCtx, rebuildId: Id<"oversightRebuilds">) {
  const rows = await ctx.db
    .query("oversightSyncing")
    .withIndex("by_rebuildId", (q) => q.eq("rebuildId", rebuildId))
    .take(201);
  for (const row of rows) await ctx.db.delete(row._id);
}

export const reconcileProject = internalMutation({
  args: { rebuildId: v.id("oversightRebuilds") },
  handler: async (ctx, args) => {
    const rebuild = await ctx.db.get(args.rebuildId);
    if (!rebuild || rebuild.status === "completed" || rebuild.status === "superseded") return null;
    const project = await ctx.db.get(rebuild.projectId);
    if (!project || project.ownerId !== rebuild.toOwnerId) {
      await ctx.db.patch(rebuild._id, {
        status: "superseded",
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
      const successors = [];
      for (const status of ["pending", "running"] as const) {
        successors.push(...await ctx.db.query("oversightRebuilds").withIndex("by_projectId_and_status", (q) => q.eq("projectId", rebuild.projectId).eq("status", status)).take(10));
      }
      const successor = successors.find((row) => row._id !== rebuild._id);
      if (successor) {
        const oldRows = await ctx.db.query("oversightSyncing").withIndex("by_rebuildId", (q) => q.eq("rebuildId", rebuild._id)).take(201);
        const affectedViewerIds = [...new Set([...(successor.affectedViewerIds ?? []), ...(rebuild.affectedViewerIds ?? []), ...oldRows.map((row) => row.viewerId)])];
        await ctx.db.patch(successor._id, { affectedViewerIds });
        for (const row of oldRows) {
          await addSyncingRow(ctx, rebuild.projectId, row.viewerId, successor._id, row.startedAt);
          await ctx.db.delete(row._id);
        }
      } else {
        await clearSyncing(ctx, rebuild._id);
      }
      return null;
    }
    try {
      const page = await ctx.db
        .query("workItems")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", project._id).eq("status", "open")
        )
        .paginate({ cursor: rebuild.cursor ?? null, numItems: RECONCILE_BATCH_SIZE });
      for (const item of page.page) await syncOversightForItem(ctx, item, project);
      const now = Date.now();
      if (page.isDone) {
        await ctx.db.patch(rebuild._id, {
          status: "completed",
          cursor: undefined,
          completedAt: now,
          updatedAt: now,
          lastError: undefined,
        });
        await clearSyncing(ctx, rebuild._id);
      } else {
        await ctx.db.patch(rebuild._id, {
          status: "running",
          cursor: page.continueCursor,
          updatedAt: now,
          lastError: undefined,
        });
        await ctx.scheduler.runAfter(0, internal.oversight.reconcileProject, { rebuildId: rebuild._id });
      }
    } catch (error) {
      const attempts = rebuild.attempts + 1;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Oversight reconciliation failed";
      await ctx.db.patch(rebuild._id, {
        attempts,
        status: attempts >= MAX_REBUILD_ATTEMPTS ? "failed" : "pending",
        lastError: message,
        updatedAt: Date.now(),
      });
      if (attempts < MAX_REBUILD_ATTEMPTS) {
        await ctx.scheduler.runAfter(attempts * 1_000, internal.oversight.reconcileProject, { rebuildId: rebuild._id });
      }
    }
    return null;
  },
});

export const repairFailed = internalMutation({
  args: { rebuildId: v.id("oversightRebuilds") },
  handler: async (ctx, args) => {
    const rebuild = await ctx.db.get(args.rebuildId);
    if (!rebuild || rebuild.status !== "failed") return null;
    const now = Date.now();
    const viewers = rebuild.affectedViewerIds ?? [rebuild.fromOwnerId, rebuild.toOwnerId].filter(Boolean) as Id<"users">[];
    for (const viewerId of viewers) await addSyncingRow(ctx, rebuild.projectId, viewerId, rebuild._id, now);
    await ctx.db.patch(rebuild._id, { status: "pending", attempts: 0, lastError: undefined, updatedAt: now });
    await ctx.scheduler.runAfter(0, internal.oversight.reconcileProject, { rebuildId: rebuild._id });
    return null;
  },
});

export const sweepStalled = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - 10 * 60_000;
    for (const status of ["pending", "running"] as const) {
      const rows = await ctx.db
        .query("oversightRebuilds")
        .withIndex("by_status_and_updatedAt", (q) => q.eq("status", status).lt("updatedAt", cutoff))
        .take(50);
      for (const row of rows) {
        await ctx.scheduler.runAfter(0, internal.oversight.reconcileProject, { rebuildId: row._id });
      }
    }
    return null;
  },
});
