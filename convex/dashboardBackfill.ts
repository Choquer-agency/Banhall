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
  stageCountBucket,
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
        // Full rebuild path: rows are reset first, so incremental +1 upserts
        // with the stage bucket reconstruct exact stageCounts alongside
        // projectCount (2026-08-06 second amendment).
        await upsertDashboardCompany(
          ctx,
          projection.dashboardCompanyKey,
          project.clientName,
          1,
          stageCountBucket(project.workflowStage)
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

/*
 * ───────────────────────────────────────────────────────────────────────────
 * stageCounts backfill (2026-08-06 second amendment) — TOOLING ONLY.
 *
 * Establishes exact per-client `dashboardCompanies.stageCounts` for rows that
 * predate the widen. Idempotent, resumable, `runKey`-fenced; safe to re-run.
 * Passes:
 *   0 — rank-presence verification: counts projects whose workflowStageRank
 *       is undefined (they sort before all ranked rows in the new composite
 *       index). A non-zero count HARD-GATES the live run (2026-08-06
 *       correction): the run is marked `failed` with the remediation note
 *       and writes nothing; run the PSOS-11 projection sync backfill first.
 *       A dry run still computes every pass (it writes nothing anyway).
 *   1 — per company (one company per scheduled transaction), recompute
 *       stageCounts from a bounded scan of the
 *       by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt index and
 *       patch it (recompute-overwrite ⇒ idempotent). Companies exceeding the
 *       per-company scan bound are skipped and counted as `overflow`;
 *       companies whose scan sum disagrees with projectCount are skipped and
 *       counted as `divergent` (2026-08-06 correction) — both keep failing
 *       honest (stageCounts absent/unchanged) rather than storing a bound or
 *       a divergent base as an exact count. `{}` is therefore never written
 *       onto a row with projectCount > 0.
 *   2 — verify: re-scan, compare stored stageCounts PER BUCKET and the
 *       sum === projectCount invariant, record mismatches on the run row.
 *
 * `dryRun: true` (the default) computes every pass and records stats without
 * writing stageCounts — this is the approved verification path. The mutating
 * `dryRun: false` run is NOT to be executed until explicitly requested.
 */

const STAGE_COUNTS_RUN_PREFIX = "psos-stagecounts-v1";
// One company per scheduled transaction (2026-08-06 correction, M2): the
// per-transaction read ceiling is then one company row + ≤1,001 project rows
// instead of ~5,005, keeping the scan far from Convex's 16,384-read /
// 8 MiB-scanned transaction limits even with heavy dashboardSearchText rows.
const STAGE_COUNTS_COMPANY_BATCH = 1;
const STAGE_COUNTS_PROJECT_BOUND = 1_000;
// A "running" run older than this is considered stale (a batch threw, a
// deploy interrupted the chain, the scheduler dropped) and may be taken
// over by a new schedule request (2026-08-06 correction, M1).
const STAGE_COUNTS_STALE_RUNNING_MS = 10 * 60 * 1000;
const STAGE_COUNTS_MISSING_RANK_REMEDIATION =
  "Projects with a missing workflowStageRank exist; run the PSOS-11 projection backfill (dashboardBackfill.run) first, then re-run stageCounts.";

function computeStageCounts(projects: { workflowStage?: string }[]) {
  const counts: Record<string, number> = {};
  for (const project of projects) {
    const bucket = project.workflowStage ?? "legacy";
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

function stageCountsEqual(
  a: Record<string, number> | undefined,
  b: Record<string, number>
) {
  if (a === undefined) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
}

async function scheduleStageCountsRun(ctx: MutationCtx, dryRun: boolean, force = false) {
  const runKey = `${STAGE_COUNTS_RUN_PREFIX}-${dryRun ? "dry" : "live"}`;
  const existing = await ctx.db
    .query("dashboardBackfillRuns")
    .withIndex("by_runKey", (q) => q.eq("runKey", runKey))
    .unique();
  const now = Date.now();
  if (existing?.status === "running") {
    // Unstick path (M1 correction): a run whose chain died (batch threw,
    // deploy mid-run, scheduler drop) would otherwise block re-runs forever.
    // A run older than the staleness window — or an explicit `force` — may
    // be taken over; recompute-overwrite idempotence makes takeover safe
    // even if the old chain is still limping along.
    const stale = now - existing.startedAt > STAGE_COUNTS_STALE_RUNNING_MS;
    if (!stale && !force) {
      return {
        started: false,
        dryRun,
        runKey,
        status: existing.status,
        reason: "A run is already in progress. Pass force: true (or wait for the staleness window) to take it over.",
      };
    }
  }
  if (existing) {
    // Re-run: reset the fence so a completed/failed/stale run can be
    // repeated (idempotent recompute-overwrite makes repetition safe).
    await ctx.db.patch(existing._id, {
      status: "running",
      dryRun,
      startedAt: now,
      completedAt: undefined,
      stats: undefined,
      note: undefined,
    });
  } else {
    await ctx.db.insert("dashboardBackfillRuns", {
      runKey,
      status: "running",
      dryRun,
      startedAt: now,
    });
  }
  await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass0, {
    cursor: null,
    dryRun,
    missingRank: 0,
    scanned: 0,
    runKey,
  });
  return { started: true, dryRun, runKey };
}

export const runStageCounts = mutation({
  args: { dryRun: v.optional(v.boolean()), force: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    // Default DRY RUN: verification without any stageCounts write.
    // `force` explicitly takes over a stuck "running" fence (safe:
    // recompute-overwrite idempotence).
    return await scheduleStageCountsRun(ctx, args.dryRun ?? true, args.force ?? false);
  },
});

export const runStageCountsInternal = internalMutation({
  args: { dryRun: v.optional(v.boolean()), force: v.optional(v.boolean()) },
  handler: async (ctx, args) =>
    await scheduleStageCountsRun(ctx, args.dryRun ?? true, args.force ?? false),
});

export const stageCountsPass0 = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    missingRank: v.number(),
    scanned: v.number(),
    runKey: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db.query("projects").paginate({
      cursor: args.cursor,
      numItems: 200,
    });
    const missingRank =
      args.missingRank +
      result.page.filter((project) => project.workflowStageRank === undefined).length;
    const scanned = args.scanned + result.page.length;
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass0, {
        cursor: result.continueCursor,
        dryRun: args.dryRun,
        missingRank,
        scanned,
        runKey: args.runKey,
      });
      return null;
    }
    // Pass 0 is a HARD GATE for the live run (H2 correction 2026-08-06):
    // rows with a missing workflowStageRank sort before every ranked row in
    // the composite index, so the index the counts (and the stage-ranked
    // query order) rely on is not yet trustworthy. A live run aborts as
    // "failed" with the remediation recorded — it writes nothing. A dry run
    // still computes every pass (it writes nothing by construction) so the
    // stats stay available as the verification path.
    if (missingRank > 0 && !args.dryRun) {
      const run = await ctx.db
        .query("dashboardBackfillRuns")
        .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
        .unique();
      if (run) {
        await ctx.db.patch(run._id, {
          status: "failed",
          completedAt: Date.now(),
          stats: { pass0MissingRank: missingRank, pass0Scanned: scanned },
          note: STAGE_COUNTS_MISSING_RANK_REMEDIATION,
        });
      }
      console.error("stageCounts live backfill blocked by missing ranks", {
        runKey: args.runKey,
        missingRank,
        scanned,
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass1, {
      cursor: null,
      dryRun: args.dryRun,
      companies: 0,
      patched: 0,
      overflow: 0,
      divergent: 0,
      projectsScanned: 0,
      missingRank,
      rankScanned: scanned,
      runKey: args.runKey,
    });
    return null;
  },
});

export const stageCountsPass1 = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    companies: v.number(),
    patched: v.number(),
    overflow: v.number(),
    divergent: v.number(),
    projectsScanned: v.number(),
    missingRank: v.number(),
    rankScanned: v.number(),
    runKey: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey")
      .order("asc")
      .paginate({ cursor: args.cursor, numItems: STAGE_COUNTS_COMPANY_BATCH });
    let patched = args.patched;
    let overflow = args.overflow;
    let divergent = args.divergent;
    let projectsScanned = args.projectsScanned;
    for (const company of result.page) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt", (q) =>
          q.eq("dashboardCompanyKey", company.companyKey)
        )
        .take(STAGE_COUNTS_PROJECT_BOUND + 1);
      projectsScanned += Math.min(projects.length, STAGE_COUNTS_PROJECT_BOUND);
      if (projects.length > STAGE_COUNTS_PROJECT_BOUND) {
        // Over-bound company: leave stageCounts absent (fail honest).
        overflow += 1;
        continue;
      }
      const counts = computeStageCounts(projects);
      const sum = Object.values(counts).reduce((total, count) => total + count, 0);
      if (sum !== company.projectCount) {
        // H3 correction (2026-08-06): the index scan and the maintained
        // projectCount disagree — the exact divergence this backfill exists
        // to expose, not to bake in as authoritative truth. Never write in
        // that state (this also guarantees `{}` is never persisted on a row
        // with projectCount > 0); record it separately so the operator can
        // repair via the full PSOS-11 rebuild first.
        divergent += 1;
        console.error("stageCounts divergence: scan sum != projectCount", {
          companyKey: company.companyKey,
          scanSum: sum,
          projectCount: company.projectCount,
          dryRun: args.dryRun,
        });
        continue;
      }
      if (!stageCountsEqual(company.stageCounts, counts)) {
        patched += 1;
        if (!args.dryRun) {
          await ctx.db.patch(company._id, { stageCounts: counts, updatedAt: Date.now() });
        }
      }
    }
    const companies = args.companies + result.page.length;
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass1, {
        cursor: result.continueCursor,
        dryRun: args.dryRun,
        companies,
        patched,
        overflow,
        divergent,
        projectsScanned,
        missingRank: args.missingRank,
        rankScanned: args.rankScanned,
        runKey: args.runKey,
      });
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass2, {
      cursor: null,
      dryRun: args.dryRun,
      companies: 0,
      mismatches: 0,
      sumViolations: 0,
      stats: {
        pass1Companies: companies,
        pass1Patched: patched,
        pass1Overflow: overflow,
        pass1Divergent: divergent,
        pass1ProjectsScanned: projectsScanned,
        pass0MissingRank: args.missingRank,
        pass0Scanned: args.rankScanned,
      },
      runKey: args.runKey,
    });
    return null;
  },
});

export const stageCountsPass2 = internalMutation({
  args: {
    cursor: v.union(v.string(), v.null()),
    dryRun: v.boolean(),
    companies: v.number(),
    mismatches: v.number(),
    sumViolations: v.number(),
    stats: v.record(v.string(), v.number()),
    runKey: v.string(),
  },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey")
      .order("asc")
      .paginate({ cursor: args.cursor, numItems: STAGE_COUNTS_COMPANY_BATCH });
    let mismatches = args.mismatches;
    let sumViolations = args.sumViolations;
    for (const company of result.page) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt", (q) =>
          q.eq("dashboardCompanyKey", company.companyKey)
        )
        .take(STAGE_COUNTS_PROJECT_BOUND + 1);
      if (projects.length > STAGE_COUNTS_PROJECT_BOUND) continue;
      const expected = computeStageCounts(projects);
      // A dry run verifies the CURRENT stored state (absent counts as a
      // mismatch only when a stored record disagrees; absence is the honest
      // pre-backfill state, so it is reported separately via pass1Patched).
      if (company.stageCounts !== undefined && !stageCountsEqual(company.stageCounts, expected)) {
        mismatches += 1;
      }
      if (company.stageCounts !== undefined) {
        const sum = Object.values(company.stageCounts).reduce((total, count) => total + count, 0);
        if (sum !== company.projectCount) sumViolations += 1;
      }
    }
    const companies = args.companies + result.page.length;
    if (!result.isDone) {
      await ctx.scheduler.runAfter(0, internal.dashboardBackfill.stageCountsPass2, {
        cursor: result.continueCursor,
        dryRun: args.dryRun,
        companies,
        mismatches,
        sumViolations,
        stats: args.stats,
        runKey: args.runKey,
      });
      return null;
    }
    const run = await ctx.db
      .query("dashboardBackfillRuns")
      .withIndex("by_runKey", (q) => q.eq("runKey", args.runKey))
      .unique();
    if (run) {
      await ctx.db.patch(run._id, {
        status: "completed",
        completedAt: Date.now(),
        stats: {
          ...args.stats,
          pass2Companies: companies,
          pass2Mismatches: mismatches,
          pass2SumViolations: sumViolations,
        },
      });
    }
    console.info("stageCounts backfill complete", {
      dryRun: args.dryRun,
      runKey: args.runKey,
      ...args.stats,
      pass2Companies: companies,
      pass2Mismatches: mismatches,
      pass2SumViolations: sumViolations,
    });
    return null;
  },
});

/**
 * Read-only stageCounts verification (admin): bounded spot-check usable at
 * any time without scheduling a run. Reports rank presence, backfill
 * coverage, and invariant violations over the first 200 companies.
 */
export const verifyStageCounts = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const companies = await ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey")
      .order("asc")
      .take(201);
    const bounded = companies.slice(0, 200);
    let withStageCounts = 0;
    let mismatches = 0;
    let sumViolations = 0;
    let overflow = 0;
    let scanDivergent = 0;
    // Per-bucket drift detail (2026-08-06 correction): sum-only checks are
    // blind to a bucket moved without its counter (the B1 class of bug), so
    // the verifier reports WHICH companies/buckets disagree, bounded.
    const bucketDrift: Array<{
      companyKey: string;
      stored: Record<string, number>;
      computed: Record<string, number>;
    }> = [];
    for (const company of bounded) {
      const projects = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt", (q) =>
          q.eq("dashboardCompanyKey", company.companyKey)
        )
        .take(STAGE_COUNTS_PROJECT_BOUND + 1);
      if (projects.length > STAGE_COUNTS_PROJECT_BOUND) {
        overflow += 1;
        continue;
      }
      const expected = computeStageCounts(projects);
      const expectedSum = Object.values(expected).reduce((total, count) => total + count, 0);
      if (expectedSum !== company.projectCount) scanDivergent += 1;
      if (company.stageCounts === undefined) continue;
      withStageCounts += 1;
      if (!stageCountsEqual(company.stageCounts, expected)) {
        mismatches += 1;
        if (bucketDrift.length < 10) {
          bucketDrift.push({
            companyKey: company.companyKey,
            stored: company.stageCounts,
            computed: expected,
          });
        }
      }
      const sum = Object.values(company.stageCounts).reduce((total, count) => total + count, 0);
      if (sum !== company.projectCount) sumViolations += 1;
    }
    const projectsSample = await ctx.db.query("projects").take(1_001);
    const missingRank = projectsSample
      .slice(0, 1_000)
      .filter((project) => project.workflowStageRank === undefined).length;
    const runs = await Promise.all(
      (["dry", "live"] as const).map((mode) =>
        ctx.db
          .query("dashboardBackfillRuns")
          .withIndex("by_runKey", (q) => q.eq("runKey", `${STAGE_COUNTS_RUN_PREFIX}-${mode}`))
          .unique()
      )
    );
    return {
      companies: bounded.length,
      companiesTruncated: companies.length > 200,
      withStageCounts,
      withoutStageCounts: bounded.length - withStageCounts - overflow,
      mismatches,
      // First mismatched companies with their stored vs computed per-bucket
      // records (bounded to 10) — sum checks alone cannot see bucket drift.
      bucketDrift,
      sumViolations,
      // Companies whose bounded index scan disagrees with projectCount —
      // the exact-counts base is divergent for these rows and Pass 1 will
      // refuse to write them.
      scanDivergent,
      overflow,
      missingRank,
      missingRankTruncated: projectsSample.length > 1_000,
      runs: runs.flatMap((run) =>
        run
          ? [{
              runKey: run.runKey,
              status: run.status,
              dryRun: run.dryRun,
              startedAt: run.startedAt,
              completedAt: run.completedAt ?? null,
              stats: run.stats ?? null,
              note: run.note ?? null,
            }]
          : []
      ),
    };
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
