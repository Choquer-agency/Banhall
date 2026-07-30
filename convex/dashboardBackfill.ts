import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { requireRole } from "./lib/auth";
import {
  projectDashboardProjectionPatch,
  resolveProjectGenerationActivity,
  upsertDashboardCompany,
} from "./lib/dashboardProjection";

const BATCH_SIZE = 25;

async function scheduleRun(ctx: MutationCtx, dryRun: boolean) {
  const runKey = `psos11-dashboard-v2-${dryRun ? "dry" : "live"}`;
  const existing = await ctx.db
    .query("dashboardBackfillRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  if (existing) return { started: false, dryRun, runKey, status: existing.status };
  const now = Date.now();
  if (!existing) {
    await ctx.db.insert("dashboardBackfillRuns", {
      runKey,
      status: "running",
      dryRun,
      startedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.dashboardBackfill.resetCompanies, {
    cursor: null,
    dryRun,
    deleted: 0,
    runKey,
  });
  return { started: true, dryRun, runKey };
}

export const run = mutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return await scheduleRun(ctx, args.dryRun ?? true);
  },
});

export const runInternal = internalMutation({
  args: { dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => await scheduleRun(ctx, args.dryRun ?? true),
});

export const resetCompanies = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    deleted: v.number(),
    runKey: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("dashboardCompanies").paginate({
      cursor: args.cursor,
      numItems: BATCH_SIZE,
    });
    if (!args.dryRun) {
      for (const company of result.page) await ctx.db.delete(company._id);
    }
    const deleted = args.deleted + result.page.length;
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.dashboardBackfill.resetCompanies, {
        cursor: result.continueCursor,
        dryRun: args.dryRun,
        deleted,
        runKey: args.runKey,
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.dashboardBackfill.processBatch, {
      cursor: null,
      dryRun: args.dryRun,
      scanned: 0,
      patched: 0,
      companiesDeleted: deleted,
      runKey: args.runKey,
    });
    return null;
  },
});

export const processBatch = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    scanned: v.number(),
    patched: v.number(),
    companiesDeleted: v.optional(v.number()),
    runKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("projects").paginate({
      cursor: args.cursor,
      numItems: BATCH_SIZE,
    });
    let patched = args.patched;
    for (const project of result.page) {
      const projection = projectDashboardProjectionPatch(project);
      const generationActivity = await resolveProjectGenerationActivity(ctx, project);
      const latestView = await ctx.db
        .query("reportViews")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .order("desc")
        .first();
      const patch = {
        ...projection,
        dashboardCompanyCounted: true,
        generationActivity,
        lastViewedAt: latestView?.viewedAt,
      };
      const changed =
        project.dashboardCompanyKey !== patch.dashboardCompanyKey ||
        project.dashboardFiscalYearRank !== patch.dashboardFiscalYearRank ||
        project.dashboardSearchText !== patch.dashboardSearchText ||
        project.workflowStageRank !== patch.workflowStageRank ||
        project.dashboardCompanyCounted !== true ||
        project.generationActivity !== patch.generationActivity ||
        project.lastViewedAt !== patch.lastViewedAt;
      if (changed) {
        patched += 1;
        if (!args.dryRun) await ctx.db.patch(project._id, patch);
      }
      if (!args.dryRun) {
        await upsertDashboardCompany(
          ctx,
          projection.dashboardCompanyKey,
          project.clientName,
          1
        );
      }
    }
    const scanned = args.scanned + result.page.length;
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.dashboardBackfill.processBatch, {
        cursor: result.continueCursor,
        dryRun: args.dryRun,
        scanned,
        patched,
        companiesDeleted: args.companiesDeleted,
        runKey: args.runKey,
      });
      return null;
    }
    if (args.runKey) {
      const run = await ctx.db
        .query("dashboardBackfillRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey!))
        .unique();
      if (run) await ctx.db.patch(run._id, { status: "completed", completedAt: Date.now() });
    }
    console.info("PSOS-11 dashboard backfill complete", {
      dryRun: args.dryRun,
      scanned,
      patched,
      companiesDeleted: args.companiesDeleted ?? 0,
    });
    return null;
  },
});

async function verificationReport(ctx: QueryCtx | MutationCtx) {
  const projects = await ctx.db.query("projects").take(1_001);
  const companies = await ctx.db.query("dashboardCompanies").take(501);
  return {
    scanned: Math.min(projects.length, 1_000),
    truncated: projects.length > 1_000,
    missingProjection: projects
      .slice(0, 1_000)
      .filter(
        (project) =>
          project.dashboardCompanyKey === undefined ||
          project.dashboardFiscalYearRank === undefined ||
          project.dashboardSearchText === undefined ||
          project.workflowStageRank === undefined
      ).length,
    projectedCompanyTotal: companies.reduce((sum, company) => sum + company.projectCount, 0),
    companyRows: companies.length,
    companyRowsTruncated: companies.length > 500,
  };
}

export const verify = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    return await verificationReport(ctx);
  },
});

export const verifyInternal = internalMutation({
  args: {},
  handler: verificationReport,
});
