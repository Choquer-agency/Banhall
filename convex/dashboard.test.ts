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

describe("dashboard query authorization", () => {
  const paginationOpts = { cursor: null, numItems: 10 };

  async function authSetup() {
    const { t, userId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "dash-writer", role: "writer", firstName: "Writer" });
      await ctx.db.insert("users", { authId: "dash-manager", role: "manager", firstName: "Manager" });
      await ctx.db.insert("users", { authId: "dash-roleless", firstName: "NoRole" });
      await ctx.db.insert("users", { authId: "dash-anon", role: "writer", isAnonymous: true });
    });
    await insertProject(t, userId, { title: "Shared visibility", clientName: "Client" });
    return t;
  }

  it("denies unauthenticated callers and preserves the pre-existing signed-in read visibility (D1)", async () => {
    const t = await authSetup();
    const roleless = t.withIdentity({ subject: "dash-roleless" });

    // Unauthenticated: every dashboard read fails.
    await expect(t.query(api.dashboard.listFlatProjects, { sortBy: "updated", paginationOpts })).rejects.toThrow(/authentication/i);
    await expect(t.query(api.dashboard.listCompanies, { paginationOpts })).rejects.toThrow(/authentication/i);
    await expect(t.query(api.dashboard.getFacets, {})).rejects.toThrow(/authentication/i);

    // D1 (2026-08-06 correction): the redesign changes no read permissions —
    // a signed-in user without an assigned role could read the dashboard
    // projections before the redesign and still can. Read hardening beyond
    // this requires a separately approved and tested decision (PSOS-30).
    const flat = await roleless.query(api.dashboard.listFlatProjects, { sortBy: "updated", paginationOpts });
    expect(flat.page.map((row) => row.title)).toContain("Shared visibility");
    // These resolve without NOT_AUTHORIZED (no projection rows are seeded
    // here, so only reachability is asserted).
    await expect(roleless.query(api.dashboard.listCompanies, { paginationOpts })).resolves.toBeTruthy();
    await expect(
      roleless.query(api.dashboard.listCompanyProjects, { companyKey: "client", paginationOpts })
    ).resolves.toBeTruthy();
    // (searchProjects shares the identical requireCurrentUser gate; its
    // search-index pagination is not exercisable under convex-test here.)
    const facets = await roleless.query(api.dashboard.getFacets, {});
    expect(facets.total).toBeGreaterThan(0);
  });

  it("preserves decision D1 firm-wide visibility for writer, manager, and admin roles", async () => {
    const t = await authSetup();
    for (const subject of ["dash-writer", "dash-manager", "dashboard-user"]) {
      const caller = t.withIdentity({ subject });
      const flat = await caller.query(api.dashboard.listFlatProjects, { sortBy: "updated", paginationOpts });
      expect(flat.page.map((row) => row.title)).toContain("Shared visibility");
      const facets = await caller.query(api.dashboard.getFacets, {});
      expect(facets.total).toBeGreaterThan(0);
    }
  });
});

describe("dashboard owner labels", () => {
  it("includes the canonical owner label in every bounded result page", async () => {
    const { t, asUser, userId } = await setup();
    const writerId = await t.run((ctx) =>
      ctx.db.insert("users", {
        authId: "owner-writer",
        firstName: "Wendy",
        lastName: "Writer",
        role: "writer",
      })
    );
    const projectId = await insertProject(t, userId, {
      title: "Owned project",
      clientName: "Client",
    });
    await t.run((ctx) => ctx.db.patch(projectId, { ownerId: writerId }));

    const page = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "updated",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.find((row) => row._id === projectId)).toMatchObject({
      ownerId: writerId,
      ownerLabel: "Wendy Writer",
    });
  });
});

describe("dashboard current-handoff projection (2026-08-10 amendment)", () => {
  async function insertHandoff(
    t: ReturnType<typeof convexTest>,
    projectId: Id<"projects">,
    assigneeId: Id<"users">,
    assignerId: Id<"users">,
    overrides: { status?: "open" | "completed"; dueAt?: number } = {}
  ) {
    const now = Date.now();
    const workItemId = await t.run((ctx) =>
      ctx.db.insert("workItems", {
        projectId,
        kind: "internal_review",
        assigneeId,
        assignerId,
        dueAt: overrides.dueAt,
        instructions: "Review the draft",
        blocking: true,
        status: overrides.status ?? "open",
        version: 1,
        createRequestId: `req-${projectId}-${now}`,
        createRequestFingerprint: "fp",
        createdAt: now,
        updatedAt: now,
      })
    );
    await t.run((ctx) => ctx.db.patch(projectId, { currentHandoffId: workItemId }));
    return workItemId;
  }

  it("projects the open blocking handoff with its assignee label on bounded pages", async () => {
    const { t, asUser, userId } = await setup();
    const revieweeId = await t.run((ctx) =>
      ctx.db.insert("users", {
        authId: "handoff-reviewer",
        firstName: "Rita",
        lastName: "Reviewer",
        role: "manager",
      })
    );
    const projectId = await insertProject(t, userId, {
      title: "Handoff project",
      clientName: "Handoff Client",
    });
    await insertHandoff(t, projectId, revieweeId, userId, { dueAt: Date.UTC(2026, 8, 1) });

    const page = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "updated",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(page.page.find((row) => row._id === projectId)?.currentHandoff).toMatchObject({
      kind: "internal_review",
      assigneeId: revieweeId,
      assigneeLabel: "Rita Reviewer",
      blocking: true,
      dueAt: Date.UTC(2026, 8, 1),
    });
  });

  it("projects nothing for absent, non-open, or cross-project handoff pointers", async () => {
    const { t, asUser, userId } = await setup();
    const noPointerId = await insertProject(t, userId, {
      title: "No pointer",
      clientName: "H Client",
    });
    const staleId = await insertProject(t, userId, {
      title: "Stale pointer",
      clientName: "H Client",
    });
    await insertHandoff(t, staleId, userId, userId, { status: "completed" });
    const crossId = await insertProject(t, userId, {
      title: "Cross pointer",
      clientName: "H Client",
    });
    const otherProjectId = await insertProject(t, userId, {
      title: "Other project",
      clientName: "H Client",
    });
    const foreignItemId = await insertHandoff(t, otherProjectId, userId, userId);
    await t.run((ctx) => ctx.db.patch(crossId, { currentHandoffId: foreignItemId }));

    const page = await asUser.query(api.dashboard.listFlatProjects, {
      sortBy: "updated",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    for (const id of [noPointerId, staleId, crossId]) {
      expect(page.page.find((row) => row._id === id)?.currentHandoff).toBeUndefined();
    }
    expect(page.page.find((row) => row._id === otherProjectId)?.currentHandoff).toMatchObject({
      kind: "internal_review",
    });
  });
});
