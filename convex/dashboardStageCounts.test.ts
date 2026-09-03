/// <reference types="vite/client" />
/**
 * 2026-08-06 second amendment: exact per-client stageCounts on
 * dashboardCompanies, the stage-ranked per-client query, and the
 * runKey-fenced stageCounts backfill (tooling only — never executed against
 * a real deployment by this suite; convex-test runs in-memory).
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { workflowStageRank, type WorkflowStage } from "../shared/workflowStages";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "sc-admin",
      role: "admin",
      firstName: "Avery",
      lastName: "Admin",
    });
    const writerId = await ctx.db.insert("users", {
      authId: "sc-writer",
      role: "writer",
      firstName: "Wendy",
      lastName: "Writer",
    });
    return { adminId, writerId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "sc-admin" }),
    writer: t.withIdentity({ subject: "sc-writer" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Inserts a fully projected, counted project the way createProject would. */
async function insertCountedProject(
  s: Setup,
  options: {
    clientName: string;
    companyKey?: string;
    stage?: WorkflowStage;
    legacy?: boolean;
    missingRank?: boolean;
    ownerId?: Id<"users">;
    updatedAt?: number;
    title?: string;
  }
) {
  const companyKey = options.companyKey ?? options.clientName.trim().toLowerCase();
  return await s.t.run(async (ctx) => {
    const now = options.updatedAt ?? Date.now();
    return await ctx.db.insert("projects", {
      title: options.title ?? `Project ${Math.random()}`,
      clientName: options.clientName,
      dashboardCompanyKey: companyKey,
      dashboardFiscalYearRank: 1_000_000,
      dashboardSearchText: options.clientName.toLowerCase(),
      dashboardCompanyCounted: true,
      ...(options.legacy
        ? {}
        : { workflowStage: options.stage ?? "intake" }),
      ...(options.missingRank
        ? {}
        : {
            workflowStageRank: options.legacy
              ? workflowStageRank(undefined)
              : workflowStageRank(options.stage ?? "intake"),
          }),
      ownerId: options.ownerId ?? s.writerId,
      workflowVersion: 0,
      status: "draft",
      createdBy: s.writerId,
      shareToken: `sc-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function companyRow(s: Setup, companyKey: string) {
  return await s.t.run(async (ctx) =>
    ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
      .unique()
  );
}

async function insertCompany(
  s: Setup,
  companyKey: string,
  clientName: string,
  projectCount: number,
  stageCounts?: Record<string, number>
) {
  await s.t.run(async (ctx) => {
    await ctx.db.insert("dashboardCompanies", {
      companyKey,
      clientName,
      projectCount,
      ...(stageCounts ? { stageCounts } : {}),
      updatedAt: Date.now(),
    });
  });
}

function sumCounts(counts: Record<string, number> | undefined) {
  return Object.values(counts ?? {}).reduce((total, count) => total + count, 0);
}

describe("stageCounts transactional maintenance", () => {
  it("createProject initializes a new company row with an exact intake bucket", async () => {
    const s = await setup();
    await s.writer.mutation(api.projects.createProject, {
      title: "New client project",
      clientName: "Fresh Client",
      transcripts: [{ content: "transcript" }],
    });
    const company = await companyRow(s, "fresh client");
    expect(company).not.toBeNull();
    expect(company?.projectCount).toBe(1);
    expect(company?.stageCounts).toEqual({ intake: 1 });
    expect(sumCounts(company?.stageCounts)).toBe(company?.projectCount);
  });

  it("setWorkflowStage moves the bucket on a backfilled company row and keeps the sum invariant", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 2, { intake: 2 });
    const projectId = await insertCountedProject(s, { clientName: "Acme", stage: "intake" });
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });

    await s.admin.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "drafting",
      expectedVersion: 0,
    });
    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toEqual({ intake: 1, drafting: 1 });
    expect(sumCounts(company?.stageCounts)).toBe(company?.projectCount);
  });

  it("a legacy row entering the workflow moves out of the legacy bucket", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 1, { legacy: 1 });
    const projectId = await insertCountedProject(s, { clientName: "Acme", legacy: true });

    // A legacy (stage-less) row is treated as intake for transition purposes;
    // its counted bucket is "legacy" and must move to the target stage.
    await s.admin.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "drafting",
      expectedVersion: 0,
    });
    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toEqual({ drafting: 1 });
  });

  it("an idempotent same-stage no-op leaves the company row untouched", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 1, { drafting: 1 });
    const before = await companyRow(s, "acme");
    const projectId = await insertCountedProject(s, { clientName: "Acme", stage: "drafting" });

    const result = await s.admin.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "drafting",
      expectedVersion: 0,
    });
    expect(result.status).toBe("noop");
    const after = await companyRow(s, "acme");
    expect(after?.stageCounts).toEqual(before?.stageCounts);
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });

  it("never fabricates stageCounts on a not-yet-backfilled company row (fail honest)", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 1);
    const projectId = await insertCountedProject(s, { clientName: "Acme", stage: "intake" });

    await s.admin.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "drafting",
      expectedVersion: 0,
    });
    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toBeUndefined();
  });

  it("deleteProject decrements the exact occupied bucket", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 2, { drafting: 1, delivered: 1 });
    const projectId = await insertCountedProject(s, {
      clientName: "Acme",
      stage: "drafting",
    });
    await insertCountedProject(s, { clientName: "Acme", stage: "delivered" });
    // deleteProject requires creator or admin.
    await s.admin.mutation(api.projects.deleteProject, { projectId });
    const company = await companyRow(s, "acme");
    expect(company?.projectCount).toBe(1);
    expect(company?.stageCounts).toEqual({ delivered: 1 });
    expect(sumCounts(company?.stageCounts)).toBe(company?.projectCount);
  });

  it("workItems.create with a confirmed Stage change moves the exact bucket in the same transaction (B1)", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 2, { drafting: 1, intake: 1 });
    const projectId = await insertCountedProject(s, {
      clientName: "Acme",
      stage: "drafting",
      ownerId: s.writerId,
    });
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });

    // The assign-review composer's "also change the stage" path — a live,
    // UI-reachable workflowStage writer that must not bypass stageCounts.
    await s.writer.mutation(api.workItems.create, {
      projectId,
      kind: "internal_review",
      assigneeId: s.writerId,
      blocking: true,
      instructions: "Please review",
      createRequestId: "b1-review-1",
      confirmedStageChange: "internal_review",
      expectedWorkflowVersion: 0,
    });

    const company = await companyRow(s, "acme");
    // Per-bucket assertion, NOT sum-only: this drift preserves
    // sum === projectCount, so only exact bucket comparison can catch it.
    expect(company?.stageCounts).toEqual({ intake: 1, internal_review: 1 });
    expect(sumCounts(company?.stageCounts)).toBe(company?.projectCount);
    const project = await s.t.run(async (ctx) => ctx.db.get(projectId));
    expect(project?.workflowStage).toBe("internal_review");
  });

  it("client-name reassignment moves the stage bucket between both company rows", async () => {
    const s = await setup();
    await insertCompany(s, "old co", "Old Co", 2, { drafting: 2 });
    const projectId = await insertCountedProject(s, {
      clientName: "Old Co",
      companyKey: "old co",
      stage: "drafting",
    });

    await s.admin.mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      clientName: "New Co",
    });

    const oldCompany = await companyRow(s, "old co");
    const newCompany = await companyRow(s, "new co");
    expect(oldCompany?.projectCount).toBe(1);
    expect(oldCompany?.stageCounts).toEqual({ drafting: 1 });
    // Brand-new company rows are exact by construction.
    expect(newCompany?.projectCount).toBe(1);
    expect(newCompany?.stageCounts).toEqual({ drafting: 1 });
  });
});

describe("listCompanyProjectsByStageRank", () => {
  const paginationOpts = { cursor: null, numItems: 50 };

  it("returns a true server stage order: missing rank first, frozen ranks ascending, legacy last", async () => {
    const s = await setup();
    await insertCountedProject(s, { clientName: "Acme", stage: "delivered", title: "Delivered" });
    await insertCountedProject(s, { clientName: "Acme", stage: "on_hold", title: "On hold" });
    await insertCountedProject(s, { clientName: "Acme", stage: "intake", title: "Intake" });
    await insertCountedProject(s, { clientName: "Acme", legacy: true, title: "Legacy" });
    await insertCountedProject(s, {
      clientName: "Acme",
      stage: "drafting",
      missingRank: true,
      title: "Unranked",
    });

    const result = await s.admin.query(api.dashboard.listCompanyProjectsByStageRank, {
      companyKey: "acme",
      paginationOpts,
    });
    // Frozen persisted ranks put on_hold (7) BEFORE delivered (8); missing
    // rank sorts before every ranked row; legacy (1000) arrives last.
    expect(result.page.map((row) => row.title)).toEqual([
      "Unranked",
      "Intake",
      "On hold",
      "Delivered",
      "Legacy",
    ]);
    expect(result.isDone).toBe(true);
  });

  it("filters one client by Stage and Owner through compound indexes", async () => {
    const s = await setup();
    const secondOwnerId = await s.t.run((ctx) =>
      ctx.db.insert("users", {
        authId: "sc-second-writer",
        role: "writer",
        firstName: "Sasha",
        lastName: "Second",
      })
    );
    await insertCountedProject(s, {
      clientName: "Acme",
      stage: "drafting",
      ownerId: s.writerId,
      title: "Wendy draft",
    });
    await insertCountedProject(s, {
      clientName: "Acme",
      stage: "intake",
      ownerId: s.writerId,
      title: "Wendy intake",
    });
    await insertCountedProject(s, {
      clientName: "Acme",
      stage: "drafting",
      ownerId: secondOwnerId,
      title: "Sasha draft",
    });

    const stageOnly = await s.admin.query(api.dashboard.listCompanyProjectsByStageRank, {
      companyKey: "acme",
      stage: "drafting",
      paginationOpts,
    });
    expect(stageOnly.page.map((row) => row.title).sort()).toEqual([
      "Sasha draft",
      "Wendy draft",
    ]);

    const stageAndOwner = await s.admin.query(api.dashboard.listCompanyProjectsByStageRank, {
      companyKey: "acme",
      stage: "drafting",
      ownerId: s.writerId,
      paginationOpts,
    });
    expect(stageAndOwner.page.map((row) => row.title)).toEqual(["Wendy draft"]);
  });

  it("keeps owner labels and the pre-existing read visibility (any signed-in user, same as listCompanies)", async () => {
    const s = await setup();
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });
    await s.t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "sc-roleless", firstName: "NoRole" });
    });
    // D1: the redesign changes no read permissions. A signed-in user without
    // an assigned role could read every dashboard projection before the
    // redesign and still can; only unauthenticated callers fail.
    const roleless = s.t.withIdentity({ subject: "sc-roleless" });
    const rolelessResult = await roleless.query(api.dashboard.listCompanyProjectsByStageRank, {
      companyKey: "acme",
      paginationOpts,
    });
    expect(rolelessResult.page).toHaveLength(1);
    await expect(
      s.t.query(api.dashboard.listCompanyProjectsByStageRank, {
        companyKey: "acme",
        paginationOpts,
      })
    ).rejects.toThrow(/Authentication required/i);

    const result = await s.admin.query(api.dashboard.listCompanyProjectsByStageRank, {
      companyKey: "acme",
      paginationOpts,
    });
    expect(result.page[0].ownerLabel).toBe("Wendy Writer");
  });

  it("exposes stageCounts additively on listCompanies pages", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 2, { intake: 1, drafting: 1 });
    await insertCompany(s, "beta", "Beta", 1);
    const result = await s.admin.query(api.dashboard.listCompanies, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    const acme = result.page.find((row) => row.companyKey === "acme");
    const beta = result.page.find((row) => row.companyKey === "beta");
    expect(acme?.stageCounts).toEqual({ intake: 1, drafting: 1 });
    // Absent means not-yet-backfilled — consumers must fail honest.
    expect(beta?.stageCounts).toBeUndefined();
  });
});

describe("stageCounts backfill tooling (runKey-fenced, dry-run first)", () => {
  // Self-rescheduling chains need fake timers to drain deterministically
  // (the established ownerBackfill.test.ts pattern).
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const drain = (s: Setup) => s.t.finishAllScheduledFunctions(() => vi.runAllTimers());

  it("dry run computes stats without writing stageCounts", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 2);
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });
    await insertCountedProject(s, { clientName: "Acme", stage: "drafting", missingRank: true });

    const started = await s.admin.mutation(api.dashboardBackfill.runStageCounts, {});
    expect(started).toMatchObject({ started: true, dryRun: true });
    await drain(s);

    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toBeUndefined();
    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    const dryRun = verify.runs.find((run) => run.runKey.endsWith("-dry"));
    expect(dryRun?.status).toBe("completed");
    expect(dryRun?.stats).toMatchObject({
      pass0MissingRank: 1,
      pass1Companies: 1,
      pass1Patched: 1,
      pass2Mismatches: 0,
    });
  });

  it("live run writes exact counts, verifies the sum invariant, and is idempotent", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 3);
    await insertCompany(s, "beta", "Beta", 1);
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });
    await insertCountedProject(s, { clientName: "Acme", stage: "intake" });
    await insertCountedProject(s, { clientName: "Acme", legacy: true });
    await insertCountedProject(s, { clientName: "Beta", stage: "delivered" });

    await s.admin.mutation(api.dashboardBackfill.runStageCounts, { dryRun: false });
    await drain(s);

    const acme = await companyRow(s, "acme");
    const beta = await companyRow(s, "beta");
    expect(acme?.stageCounts).toEqual({ intake: 2, legacy: 1 });
    expect(beta?.stageCounts).toEqual({ delivered: 1 });
    expect(sumCounts(acme?.stageCounts)).toBe(acme?.projectCount);

    // Idempotent: a second run patches nothing and verifies clean.
    await s.admin.mutation(api.dashboardBackfill.runStageCounts, { dryRun: false });
    await drain(s);
    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    const liveRun = verify.runs.find((run) => run.runKey.endsWith("-live"));
    expect(liveRun?.stats).toMatchObject({
      pass1Patched: 0,
      pass2Mismatches: 0,
      pass2SumViolations: 0,
    });
    expect(verify.mismatches).toBe(0);
    expect(verify.sumViolations).toBe(0);
  });

  it("fences concurrent runs by runKey and requires an admin", async () => {
    const s = await setup();
    await expect(
      s.writer.mutation(api.dashboardBackfill.runStageCounts, {})
    ).rejects.toThrow(/NOT_AUTHORIZED|elevated role/i);

    const first = await s.admin.mutation(api.dashboardBackfill.runStageCounts, {});
    expect(first.started).toBe(true);
    const second = await s.admin.mutation(api.dashboardBackfill.runStageCounts, {});
    expect(second.started).toBe(false);
    await drain(s);
  });

  it("a stuck running fence can be taken over with force (and stays blocked without it)", async () => {
    const s = await setup();
    // Simulate a run whose chain died: fence row stuck in "running".
    await s.t.run(async (ctx) => {
      await ctx.db.insert("dashboardBackfillRuns", {
        runKey: "psos-stagecounts-v1-dry",
        status: "running",
        dryRun: true,
        startedAt: Date.now(),
      });
    });
    const blocked = await s.admin.mutation(api.dashboardBackfill.runStageCounts, {});
    expect(blocked.started).toBe(false);
    const forced = await s.admin.mutation(api.dashboardBackfill.runStageCounts, { force: true });
    expect(forced.started).toBe(true);
    await drain(s);
    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    expect(verify.runs.find((run) => run.runKey.endsWith("-dry"))?.status).toBe("completed");
  });

  it("a LIVE run is hard-gated by Pass 0: missing ranks mark it failed with remediation and write nothing", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 1);
    await insertCountedProject(s, { clientName: "Acme", stage: "drafting", missingRank: true });

    await s.admin.mutation(api.dashboardBackfill.runStageCounts, { dryRun: false });
    await drain(s);

    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toBeUndefined();
    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    const liveRun = verify.runs.find((run) => run.runKey.endsWith("-live"));
    expect(liveRun?.status).toBe("failed");
    expect(liveRun?.note).toMatch(/PSOS-11 projection backfill/);
    expect(liveRun?.stats).toMatchObject({ pass0MissingRank: 1 });
  });

  it("Pass 1 refuses to write when the scan sum diverges from projectCount (never persists {} on a counted row)", async () => {
    const s = await setup();
    // projectCount claims 3 but the index scan finds 1 — divergent base.
    await insertCompany(s, "acme", "Acme", 3);
    await insertCountedProject(s, { clientName: "Acme", stage: "drafting" });
    // An empty-scan company with a positive projectCount would otherwise
    // store {} as "exact truth".
    await insertCompany(s, "ghost", "Ghost", 2);

    await s.admin.mutation(api.dashboardBackfill.runStageCounts, { dryRun: false });
    await drain(s);

    expect((await companyRow(s, "acme"))?.stageCounts).toBeUndefined();
    expect((await companyRow(s, "ghost"))?.stageCounts).toBeUndefined();
    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    const liveRun = verify.runs.find((run) => run.runKey.endsWith("-live"));
    expect(liveRun?.status).toBe("completed");
    expect(liveRun?.stats).toMatchObject({ pass1Divergent: 2, pass1Patched: 0 });
    expect(verify.scanDivergent).toBe(2);
  });

  it("verifyStageCounts reports per-bucket drift that a sum-only check cannot see", async () => {
    const s = await setup();
    // sum === projectCount holds (2 === 2) but the buckets are wrong —
    // exactly the drift shape a bypassed stage writer (B1) produced.
    await insertCompany(s, "acme", "Acme", 2, { drafting: 2 });
    await insertCountedProject(s, { clientName: "Acme", stage: "drafting" });
    await insertCountedProject(s, { clientName: "Acme", stage: "internal_review" });

    const verify = await s.admin.query(api.dashboardBackfill.verifyStageCounts, {});
    expect(verify.sumViolations).toBe(0);
    expect(verify.mismatches).toBe(1);
    expect(verify.bucketDrift).toEqual([
      {
        companyKey: "acme",
        stored: { drafting: 2 },
        computed: { drafting: 1, internal_review: 1 },
      },
    ]);
  });

  it("repairs a drifted stageCounts record (recompute-overwrite) and reports it", async () => {
    const s = await setup();
    await insertCompany(s, "acme", "Acme", 1, { drafting: 5 });
    await insertCountedProject(s, { clientName: "Acme", stage: "drafting" });

    await s.t.mutation(internal.dashboardBackfill.runStageCountsInternal, { dryRun: false });
    await drain(s);
    const company = await companyRow(s, "acme");
    expect(company?.stageCounts).toEqual({ drafting: 1 });
  });
});
