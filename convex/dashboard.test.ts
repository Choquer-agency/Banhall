/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const userId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      authId: "dashboard-user",
      email: "dashboard@banhall.com",
      firstName: "Dash",
      lastName: "Owner",
      role: "admin",
    })
  );
  const asUser = t.withIdentity({ subject: "dashboard-user" });
  return { t, asUser, userId, now };
}

async function insertProject(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  args: { title: string; clientName: string; fiscalYearEnd?: number; updatedAt?: number }
) {
  const now = args.updatedAt ?? Date.now();
  return await t.run(async (ctx) =>
    ctx.db.insert("projects", {
      title: args.title,
      clientName: args.clientName,
      fiscalYearEnd: args.fiscalYearEnd,
      status: "draft",
      createdBy: userId,
      shareToken: `token-${args.title}`,
      createdAt: now,
      updatedAt: now,
    })
  );
}

describe("PSOS-11 dashboard projections", () => {
  it("backfills UTC ordering fields and paginates company summaries", async () => {
    const { t, asUser, userId } = await setup();
    await insertProject(t, userId, {
      title: "Alpha old",
      clientName: "Alpha Ltd.",
      fiscalYearEnd: Date.UTC(2024, 11, 31),
    });
    await insertProject(t, userId, {
      title: "Alpha new",
      clientName: "Alpha Ltd.",
      fiscalYearEnd: Date.UTC(2025, 11, 31),
    });
    await insertProject(t, userId, { title: "Unnamed", clientName: "   " });

    await asUser.mutation(api.dashboardBackfill.run, { dryRun: false });
    await t.finishAllScheduledFunctions(() => {});

    const companies = await asUser.query(api.dashboard.listCompanies, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(companies.page.map((company) => company.clientName)).toEqual([
      "Alpha Ltd.",
      "—",
    ]);
    expect(companies.page[0]?.projectCount).toBe(2);

    const alpha = await asUser.query(api.dashboard.listCompanyProjects, {
      companyKey: companies.page[0]!.companyKey,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(alpha.page.map((project) => project.title)).toEqual([
      "Alpha new",
      "Alpha old",
    ]);
  });

  it("keeps active generation activity denormalized through failure and retry", async () => {
    const { t, asUser, userId, now } = await setup();
    const projectId = await insertProject(t, userId, {
      title: "Generation projection",
      clientName: "Client",
    });
    const transcriptId = await t.run(async (ctx) =>
      ctx.db.insert("transcripts", { projectId, content: "Interview", createdAt: now })
    );
    const generationId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "running",
        requestedBy: userId,
        startedAt: now,
      });
      await ctx.db.patch(projectId, { activeGenerationId: id });
      return id;
    });

    await t.mutation(internal.generations.updateGenerationStatus, {
      generationId,
      status: "awaiting_input",
    });
    let project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.generationActivity).toBe("awaiting_input");

    await t.mutation(internal.generations.updateGenerationStatus, {
      generationId,
      status: "failed",
      completedAt: now + 1,
    });
    await t.run(async (ctx) => ctx.db.patch(projectId, { activeGenerationId: undefined }));
    await t.mutation(internal.dashboardBackfill.processBatch, {
      cursor: null,
      dryRun: false,
      scanned: 0,
      patched: 0,
      companiesDeleted: 0,
      runKey: undefined,
    });
    await t.finishAllScheduledFunctions(() => {});
    project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.generationActivity).toBeUndefined();

    const flat = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "updated",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(flat.page.find((row) => row._id === projectId)?.generationActivity).toBeUndefined();
  });

  it("keeps the old company label when one project moves to a new company", async () => {
    const { t, asUser, userId } = await setup();
    for (let index = 0; index < 3; index += 1) {
      await insertProject(t, userId, {
        title: `Acme ${index}`,
        clientName: "Acme Ltd.",
      });
    }
    await asUser.mutation(api.dashboardBackfill.run, { dryRun: false });
    await t.finishAllScheduledFunctions(() => {});
    const projects = await t.run((ctx) => ctx.db.query("projects").take(3));
    await asUser.mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projects[0]!._id],
      clientName: "Zeta Inc.",
    });
    const companies = await asUser.query(api.dashboard.listCompanies, {
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(companies.page.map(({ clientName, projectCount }) => ({ clientName, projectCount }))).toEqual([
      { clientName: "Acme Ltd.", projectCount: 2 },
      { clientName: "Zeta Inc.", projectCount: 1 },
    ]);
  });

  it("uses one bounded raw page for selective filters", async () => {
    const { t, asUser, userId } = await setup();
    for (let index = 0; index < 61; index += 1) {
      await insertProject(t, userId, {
        title: `Project ${index}`,
        clientName: "Client",
        updatedAt: index + 1,
      });
    }
    const page = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "updated",
      industry: "missing-industry",
      paginationOpts: { cursor: null, numItems: 60 },
    });
    expect(page.page).toEqual([]);
    expect(page.isDone).toBe(false);
    expect(page.scanTruncated).toBe(true);
  });

  it("denormalizes the latest report view instead of using a dashboard N+1", async () => {
    const { t, asUser, userId } = await setup();
    const projectId = await insertProject(t, userId, {
      title: "Viewed project",
      clientName: "Client",
    });
    await asUser.mutation(api.reportViews.logWriterView, { projectId });
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.lastViewedAt).toEqual(expect.any(Number));

    const page = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "viewed",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page[0]).toMatchObject({ _id: projectId, lastViewedAt: project?.lastViewedAt });
  });
});
