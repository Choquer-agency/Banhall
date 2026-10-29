/// <reference types="vite/client" />
/**
 * 2026-10-14 amendment "Saved clients, client merge, and the Projects page
 * redesign": create (exact and similar names, roles, year end), the client
 * directory, merge (counts, stage buckets, tombstones, rename, name
 * conflicts, number collisions, the 200 limit, roles), the backfill (dry run,
 * apply, idempotency) and the dual write of `projects.clientId`.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import {
  dashboardCompanyKey,
  dashboardFiscalYearRank,
} from "../shared/dashboardProjection";
import { getEffectiveCapabilityLevel } from "../shared/capabilities";
import { workflowStageRank, type WorkflowStage } from "../shared/workflowStages";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: "cl-writer",
      role: "writer",
      firstName: "Wendy",
      lastName: "Writer",
    });
    const otherWriterId = await ctx.db.insert("users", {
      authId: "cl-other",
      role: "writer",
      firstName: "Omar",
      lastName: "Other",
    });
    const managerId = await ctx.db.insert("users", {
      authId: "cl-manager",
      role: "manager",
      firstName: "Mina",
      lastName: "Manager",
    });
    const adminId = await ctx.db.insert("users", {
      authId: "cl-admin",
      role: "admin",
      firstName: "Avery",
      lastName: "Admin",
    });
    await ctx.db.insert("users", { authId: "cl-roleless" });
    return { writerId, otherWriterId, managerId, adminId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cl-writer" }),
    otherWriter: t.withIdentity({ subject: "cl-other" }),
    manager: t.withIdentity({ subject: "cl-manager" }),
    admin: t.withIdentity({ subject: "cl-admin" }),
    roleless: t.withIdentity({ subject: "cl-roleless" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** A fully projected, counted project, as createProject would leave it. */
async function insertProject(
  s: Setup,
  options: {
    clientName: string;
    stage?: WorkflowStage;
    fiscalYearEnd?: number;
    projectNumber?: string;
    title?: string;
    ownerId?: Id<"users">;
    clientId?: Id<"clients">;
    deleting?: boolean;
  }
) {
  const stage = options.stage ?? "intake";
  const title = options.title ?? `Project ${Math.random()}`;
  return await s.t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      title,
      clientName: options.clientName,
      ...(options.clientId ? { clientId: options.clientId } : {}),
      dashboardCompanyKey: dashboardCompanyKey(options.clientName),
      dashboardFiscalYearRank: dashboardFiscalYearRank(options.fiscalYearEnd),
      dashboardSearchText: `${title}\n${options.clientName}`.toLowerCase(),
      dashboardCompanyCounted: options.deleting ? false : true,
      ...(options.fiscalYearEnd !== undefined ? { fiscalYearEnd: options.fiscalYearEnd } : {}),
      ...(options.projectNumber ? { projectNumber: options.projectNumber } : {}),
      ...(options.deleting ? { deletionStartedAt: now } : {}),
      workflowStage: stage,
      workflowStageRank: workflowStageRank(stage),
      ownerId: options.ownerId ?? s.writerId,
      workflowVersion: 0,
      status: "draft",
      createdBy: options.ownerId ?? s.writerId,
      shareToken: `cl-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function insertCompany(
  s: Setup,
  clientName: string,
  projectCount: number,
  stageCounts?: Record<string, number>
) {
  await s.t.run(async (ctx) => {
    await ctx.db.insert("dashboardCompanies", {
      companyKey: dashboardCompanyKey(clientName),
      clientName,
      projectCount,
      ...(stageCounts ? { stageCounts } : {}),
      updatedAt: Date.now(),
    });
  });
}

async function insertClient(
  s: Setup,
  name: string,
  extra: { fiscalYearEndMonth?: number; fiscalYearEndDay?: number; industry?: string } = {}
) {
  return await s.t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("clients", {
      name,
      nameKey: dashboardCompanyKey(name),
      ...extra,
      status: "active",
      createdBy: s.adminId,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function companyRow(s: Setup, clientName: string) {
  return await s.t.run(async (ctx) =>
    ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey", (q) => q.eq("companyKey", dashboardCompanyKey(clientName)))
      .unique()
  );
}

async function getProject(s: Setup, projectId: Id<"projects">) {
  return await s.t.run(async (ctx) => await ctx.db.get(projectId));
}

async function getClient(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) => await ctx.db.get(clientId));
}

async function clientsByKey(s: Setup, name: string) {
  return await s.t.run(async (ctx) =>
    ctx.db
      .query("clients")
      .withIndex("by_nameKey", (q) => q.eq("nameKey", dashboardCompanyKey(name)))
      .take(10)
  );
}

async function createProjectAs(
  actor: Setup["writer"],
  clientName: string,
  extra: { fiscalYearEnd?: number; projectNumber?: string } = {}
) {
  const { projectId } = await actor.mutation(api.projects.createProject, {
    title: `Project for ${clientName} ${Math.random()}`,
    clientName,
    transcripts: [{ content: "transcript" }],
    ...extra,
  });
  return projectId;
}

const FY2025 = Date.parse("2025-03-31T00:00:00Z");
const FY2024 = Date.parse("2024-03-31T00:00:00Z");

describe("createClient", () => {
  it("creates an active client with its usual year end and industry", async () => {
    const s = await setup();
    const result = await s.writer.mutation(api.clients.createClient, {
      name: "  Cedarline   Systems ",
      fiscalYearEndMonth: 2,
      fiscalYearEndDay: 29,
      industry: "software",
    });
    expect(result).toMatchObject({ key: "cedarline systems", name: "Cedarline   Systems" });
    const client = await getClient(s, result.clientId);
    expect(client).toMatchObject({
      name: "Cedarline   Systems",
      nameKey: "cedarline systems",
      status: "active",
      fiscalYearEndMonth: 2,
      fiscalYearEndDay: 29,
      industry: "software",
      createdBy: s.writerId,
    });
  });

  it("refuses an exact key match of an active client with the existing name", async () => {
    const s = await setup();
    await s.writer.mutation(api.clients.createClient, { name: "Cedarline Systems" });
    await expect(
      s.manager.mutation(api.clients.createClient, { name: " cedarline  SYSTEMS" })
    ).rejects.toMatchObject({
      data: {
        code: "CLIENT_EXISTS",
        message: "Cedarline Systems already exists.",
        existingName: "Cedarline Systems",
        existingKey: "cedarline systems",
      },
    });
    expect(await clientsByKey(s, "Cedarline Systems")).toHaveLength(1);
  });

  it("refuses an exact key match of a company name that has no client row yet", async () => {
    const s = await setup();
    await createProjectAs(s.writer, "Northwind Labs");
    await expect(
      s.writer.mutation(api.clients.createClient, { name: "NORTHWIND LABS" })
    ).rejects.toMatchObject({
      data: { code: "CLIENT_EXISTS", message: "Northwind Labs already exists." },
    });
    expect(await clientsByKey(s, "Northwind Labs")).toHaveLength(0);
  });

  it("allows a name that only looks alike (the warning is the person's call)", async () => {
    const s = await setup();
    await s.writer.mutation(api.clients.createClient, { name: "Cedarline Systems Inc." });
    const second = await s.writer.mutation(api.clients.createClient, {
      name: "Cedarline Systems",
    });
    expect(second.key).toBe("cedarline systems");
  });

  it.each([
    ["an empty name", { name: "   " }],
    ["a month without a day", { name: "Acme", fiscalYearEndMonth: 3 }],
    ["a day without a month", { name: "Acme", fiscalYearEndDay: 31 }],
    ["February 30", { name: "Acme", fiscalYearEndMonth: 2, fiscalYearEndDay: 30 }],
    ["April 31", { name: "Acme", fiscalYearEndMonth: 4, fiscalYearEndDay: 31 }],
    ["month 13", { name: "Acme", fiscalYearEndMonth: 13, fiscalYearEndDay: 1 }],
    ["month 0", { name: "Acme", fiscalYearEndMonth: 0, fiscalYearEndDay: 1 }],
    ["a fractional day", { name: "Acme", fiscalYearEndMonth: 1, fiscalYearEndDay: 1.5 }],
    ["a name over 200 characters", { name: "x".repeat(201) }],
  ])("refuses %s with INVALID_INPUT", async (_label, args) => {
    const s = await setup();
    await expect(s.writer.mutation(api.clients.createClient, args)).rejects.toMatchObject({
      data: { code: "INVALID_INPUT" },
    });
    expect(await clientsByKey(s, "Acme")).toHaveLength(0);
  });

  it("validates industry like the single-project edit: a new industry is admin-only", async () => {
    const s = await setup();
    await expect(
      s.writer.mutation(api.clients.createClient, { name: "Acme", industry: "Aerospace" })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    const created = await s.admin.mutation(api.clients.createClient, {
      name: "Acme",
      industry: "Aerospace",
    });
    expect(await getClient(s, created.clientId)).toMatchObject({ industry: "aerospace" });
  });

  it("is open to Consultant, Manager and Admin; refused without a role or sign-in", async () => {
    const s = await setup();
    await s.writer.mutation(api.clients.createClient, { name: "One" });
    await s.manager.mutation(api.clients.createClient, { name: "Two" });
    await s.admin.mutation(api.clients.createClient, { name: "Three" });
    await expect(
      s.roleless.mutation(api.clients.createClient, { name: "Four" })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(s.t.mutation(api.clients.createClient, { name: "Five" })).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    // The gate is project.create; the planned Financial role holds none of
    // it (the role cannot be stored yet, so the matrix is the evidence).
    expect(getEffectiveCapabilityLevel("financial", "project.create")).toBe("none");
  });
});

describe("listClients and findSimilarClients", () => {
  it("lists saved clients and client-less company names once each, sorted by key", async () => {
    const s = await setup();
    const alphaId = await insertClient(s, "Alpha Labs", {
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "software",
    });
    await insertCompany(s, "alpha labs", 3);
    await insertCompany(s, "Beta Works", 2);
    const gammaId = await insertClient(s, "Gamma");
    await s.t.run(async (ctx) => {
      // The unnamed bucket never appears.
      await ctx.db.insert("dashboardCompanies", {
        companyKey: "￿",
        clientName: "Unnamed",
        projectCount: 1,
        updatedAt: Date.now(),
      });
      // A merged tombstone is not listed.
      await ctx.db.insert("clients", {
        name: "Old Alpha",
        nameKey: "old alpha",
        status: "merged",
        mergedIntoClientId: alphaId,
        createdBy: s.adminId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const result = await s.writer.query(api.clients.listClients, {});
    expect(result).toEqual({
      truncated: false,
      clients: [
        {
          key: "alpha labs",
          clientId: alphaId,
          name: "Alpha Labs",
          projectCount: 3,
          fiscalYearEndMonth: 9,
          fiscalYearEndDay: 30,
          industry: "software",
          updatedAt: expect.any(Number),
        },
        { key: "beta works", clientId: null, name: "Beta Works", projectCount: 2, updatedAt: expect.any(Number) },
        { key: "gamma", clientId: gammaId, name: "Gamma", projectCount: 0, updatedAt: expect.any(Number) },
      ],
    });
  });

  it("requires an internal user", async () => {
    const s = await setup();
    await expect(s.t.query(api.clients.listClients, {})).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    await expect(s.roleless.query(api.clients.listClients, {})).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
  });

  it("finds the exact key and names that look alike", async () => {
    const s = await setup();
    await insertClient(s, "Cedarline Systems");
    await insertCompany(s, "Cedarline Systems", 4);
    await insertCompany(s, "Cedarline Systems Inc.", 1);
    await insertClient(s, "Cedar Line Systems Ltd");
    await insertClient(s, "Cedarline");
    await insertClient(s, "Northwind");

    const result = await s.writer.query(api.clients.findSimilarClients, {
      name: "cedarline systems",
    });
    expect(result.exact).toEqual({
      key: "cedarline systems",
      name: "Cedarline Systems",
      projectCount: 4,
    });
    expect(result.similar.map((entry) => entry.name)).toEqual([
      "Cedar Line Systems Ltd",
      "Cedarline",
      "Cedarline Systems Inc.",
    ]);
    expect(result.similar.find((entry) => entry.name === "Cedarline Systems Inc.")).toEqual({
      key: "cedarline systems inc.",
      name: "Cedarline Systems Inc.",
      projectCount: 1,
    });
  });

  it("returns no exact match for a new name and caps similar names at five", async () => {
    const s = await setup();
    for (const suffix of ["Inc", "Ltd", "LLC", "Corp", "Co", "Company", "Limited"]) {
      await insertClient(s, `Acme ${suffix}`);
    }
    const result = await s.writer.query(api.clients.findSimilarClients, { name: "Acme" });
    expect(result.exact).toBeNull();
    expect(result.similar).toHaveLength(5);
    const blank = await s.writer.query(api.clients.findSimilarClients, { name: "  " });
    expect(blank).toEqual({ exact: null, similar: [] });
  });
});

describe("dual write of projects.clientId", () => {
  it("createProject links the active client with the same key, or none", async () => {
    const s = await setup();
    const { clientId } = await s.writer.mutation(api.clients.createClient, {
      name: "Cedarline Systems",
    });
    const linked = await createProjectAs(s.writer, "  CEDARLINE systems ");
    const unlinked = await createProjectAs(s.writer, "Brand New Co");
    expect((await getProject(s, linked))?.clientId).toBe(clientId);
    expect(await getProject(s, unlinked)).not.toHaveProperty("clientId");
  });

  it("updateProjectClientName sets clientId to the matching client and clears it otherwise", async () => {
    const s = await setup();
    const { clientId } = await s.writer.mutation(api.clients.createClient, { name: "Acme" });
    const projectId = await createProjectAs(s.writer, "Somebody");
    await s.writer.mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "ACME",
    });
    expect(await getProject(s, projectId)).toMatchObject({ clientName: "ACME", clientId });
    await s.writer.mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "Nobody Ltd",
    });
    expect(await getProject(s, projectId)).not.toHaveProperty("clientId");
  });

  it("bulkUpdateProjects sets and clears clientId with the client name", async () => {
    const s = await setup();
    const { clientId } = await s.writer.mutation(api.clients.createClient, { name: "Acme" });
    const first = await createProjectAs(s.writer, "One");
    const second = await createProjectAs(s.writer, "Two");
    const result = await s.writer.mutation(api.projects.bulkUpdateProjects, {
      projectIds: [first, second],
      clientName: "acme",
    });
    expect(result).toEqual({ updated: 2, skipped: 0 });
    expect((await getProject(s, first))?.clientId).toBe(clientId);
    expect((await getProject(s, second))?.clientId).toBe(clientId);

    await s.writer.mutation(api.projects.bulkUpdateProjects, {
      projectIds: [first],
      clientName: "Elsewhere",
    });
    expect(await getProject(s, first)).not.toHaveProperty("clientId");
    // A bulk edit that does not touch the client name leaves the link alone.
    await s.writer.mutation(api.projects.bulkUpdateProjects, {
      projectIds: [second],
      industry: "software",
    });
    expect((await getProject(s, second))?.clientId).toBe(clientId);
  });

  it("createClient links projects of its key that exist without a company row", async () => {
    const s = await setup();
    // An uncounted straggler (no dashboardCompanies row for the key).
    const projectId = await insertProject(s, { clientName: "Straggler" });
    const { clientId } = await s.writer.mutation(api.clients.createClient, {
      name: "Straggler",
    });
    expect((await getProject(s, projectId))?.clientId).toBe(clientId);
  });
});

describe("dashboard.searchProjects companyKey scope", () => {
  it("returns only the matching client's projects when a company key is given", async () => {
    const s = await setup();
    const acme = await insertProject(s, { clientName: "Acme", title: "Turbine controller" });
    const zenith = await insertProject(s, { clientName: "Zenith", title: "Turbine controller" });
    const paginationOpts = { numItems: 20, cursor: null };

    const all = await s.writer.query(api.dashboard.searchProjects, {
      search: "turbine",
      paginationOpts,
    });
    expect(all.page.map((row) => row._id).sort()).toEqual([acme, zenith].sort());

    const scoped = await s.writer.query(api.dashboard.searchProjects, {
      search: "turbine",
      companyKey: "acme",
      paginationOpts,
    });
    expect(scoped.page.map((row) => row._id)).toEqual([acme]);
  });
});

describe("previewClientMerge and mergeClients", () => {
  /**
   * Acme (saved client, 2 projects: intake + drafting, exact stageCounts),
   * ACME Inc. (company name only, 1 project in client_review) and Acme Ltd
   * (saved client, 1 project in drafting, stageCounts not backfilled).
   */
  async function mergeFixture(s: Setup) {
    const acmeId = await insertClient(s, "Acme");
    const acmeLtdId = await insertClient(s, "Acme Ltd");
    await insertCompany(s, "Acme", 2, { intake: 1, drafting: 1 });
    await insertCompany(s, "ACME Inc.", 1, { client_review: 1 });
    await insertCompany(s, "Acme Ltd", 1);
    const a1 = await insertProject(s, {
      clientName: "Acme",
      clientId: acmeId,
      stage: "intake",
      fiscalYearEnd: FY2025,
      projectNumber: "1",
      title: "Acme one",
    });
    const a2 = await insertProject(s, {
      clientName: "Acme",
      clientId: acmeId,
      stage: "drafting",
      fiscalYearEnd: FY2024,
      projectNumber: "1",
      title: "Acme two",
    });
    const inc1 = await insertProject(s, {
      clientName: "ACME Inc.",
      stage: "client_review",
      fiscalYearEnd: FY2025,
      projectNumber: "1",
      title: "Inc one",
    });
    const ltd1 = await insertProject(s, {
      clientName: "Acme Ltd",
      clientId: acmeLtdId,
      stage: "drafting",
      fiscalYearEnd: FY2025,
      projectNumber: "2",
      title: "Ltd one",
    });
    return { acmeId, acmeLtdId, a1, a2, inc1, ltd1 };
  }

  it("previews counts and the numbers the merge makes appear twice", async () => {
    const s = await setup();
    await mergeFixture(s);
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "acme",
      mergeKeys: ["acme inc.", "acme ltd"],
    });
    expect(preview).toEqual({
      projectCount: 4,
      movedCount: 2,
      tooMany: false,
      keptName: "Acme",
      keptKey: "acme",
      nameConflict: null,
      numberCollisions: [
        { fiscalYear: 2025, projectNumber: "1", titles: ["Acme one", "Inc one"] },
      ],
      collisionCheckIncomplete: false,
      companyFileCount: 0,
      tooManyCompanyFiles: false,
    });
  });

  /** `count` kept Acme projects in FY 2025, linked and unnumbered, in one write. */
  async function insertKeptAcmeProjects(s: Setup, acmeId: Id<"clients">, count: number) {
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let index = 0; index < count; index += 1) {
        const title = `Acme bulk ${index}`;
        await ctx.db.insert("projects", {
          title,
          clientName: "Acme",
          clientId: acmeId,
          dashboardCompanyKey: "acme",
          dashboardFiscalYearRank: dashboardFiscalYearRank(FY2025),
          dashboardSearchText: `${title}\nacme`,
          dashboardCompanyCounted: true,
          fiscalYearEnd: FY2025,
          workflowStage: "intake",
          workflowStageRank: workflowStageRank("intake"),
          ownerId: s.writerId,
          workflowVersion: 0,
          status: "draft",
          createdBy: s.writerId,
          shareToken: `cl-bulk-${index}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  it("finds a repeated number past the first 100 kept projects of a fiscal year", async () => {
    const s = await setup();
    const acmeId = await insertClient(s, "Acme");
    const ltdId = await insertClient(s, "Acme Ltd");
    await insertCompany(s, "Acme", 106);
    await insertCompany(s, "Acme Ltd", 1);
    await insertKeptAcmeProjects(s, acmeId, 105);
    // Read last in the fiscal year's index order.
    await insertProject(s, {
      clientName: "Acme",
      clientId: acmeId,
      fiscalYearEnd: FY2025,
      projectNumber: "7",
      title: "Acme seven",
    });
    await insertProject(s, {
      clientName: "Acme Ltd",
      clientId: ltdId,
      fiscalYearEnd: FY2025,
      projectNumber: "7",
      title: "Ltd seven",
    });
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
    });
    expect(preview.tooMany).toBe(false);
    expect(preview.numberCollisions).toEqual([
      { fiscalYear: 2025, projectNumber: "7", titles: ["Acme seven", "Ltd seven"] },
    ]);
    expect(preview.collisionCheckIncomplete).toBe(false);
  });

  it("says the number check is incomplete when the kept client has more rows than it reads", async () => {
    const s = await setup();
    const acmeId = await insertClient(s, "Acme");
    const ltdId = await insertClient(s, "Acme Ltd");
    await insertCompany(s, "Acme", 1_001);
    await insertCompany(s, "Acme Ltd", 1);
    // One past MERGE_COLLISION_READ_LIMIT (1,000) in the same fiscal year.
    await insertKeptAcmeProjects(s, acmeId, 1_001);
    await insertProject(s, {
      clientName: "Acme Ltd",
      clientId: ltdId,
      fiscalYearEnd: FY2025,
      projectNumber: "7",
      title: "Ltd seven",
    });
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
    });
    expect(preview.tooMany).toBe(false);
    expect(preview.collisionCheckIncomplete).toBe(true);
  });

  it("moves projects, counts and stage buckets to the kept client and leaves tombstones", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "acme",
      mergeKeys: ["acme inc.", "acme ltd"],
    });
    expect(result).toEqual({ moved: 2, keptKey: "acme", keptName: "Acme", clientId: f.acmeId });

    for (const projectId of [f.a1, f.a2, f.inc1, f.ltd1]) {
      expect(await getProject(s, projectId)).toMatchObject({
        clientName: "Acme",
        clientId: f.acmeId,
        dashboardCompanyKey: "acme",
      });
    }
    // Numbers never change, even where they now collide.
    expect(await getProject(s, f.inc1)).toMatchObject({ projectNumber: "1" });
    expect(await getProject(s, f.a1)).toMatchObject({ projectNumber: "1" });
    expect(await getProject(s, f.ltd1)).toMatchObject({ projectNumber: "2" });

    const acme = await companyRow(s, "Acme");
    expect(acme).toMatchObject({
      projectCount: 4,
      stageCounts: { intake: 1, drafting: 2, client_review: 1 },
    });
    expect(await companyRow(s, "ACME Inc.")).toBeNull();
    expect(await companyRow(s, "Acme Ltd")).toBeNull();

    const ltd = await getClient(s, f.acmeLtdId);
    expect(ltd).toMatchObject({
      status: "merged",
      mergedIntoClientId: f.acmeId,
      mergedBy: s.managerId,
    });
    expect(typeof ltd?.mergedAt).toBe("number");
    const incRows = await clientsByKey(s, "ACME Inc.");
    expect(incRows).toHaveLength(1);
    expect(incRows[0]).toMatchObject({
      name: "ACME Inc.",
      status: "merged",
      mergedIntoClientId: f.acmeId,
      mergedBy: s.managerId,
      createdBy: s.managerId,
    });

    const list = await s.writer.query(api.clients.listClients, {});
    expect(list.clients).toEqual([
      { key: "acme", clientId: f.acmeId, name: "Acme", projectCount: 4, updatedAt: expect.any(Number) },
    ]);
  });

  it("creates the kept client from its company row before the backfill", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    const result = await s.admin.mutation(api.clients.mergeClients, {
      keepKey: "acme inc.",
      mergeKeys: ["acme ltd"],
    });
    expect(result).toMatchObject({ moved: 1, keptKey: "acme inc.", keptName: "ACME Inc." });
    const kept = await getClient(s, result.clientId);
    expect(kept).toMatchObject({ name: "ACME Inc.", nameKey: "acme inc.", status: "active" });
    // The kept client's own projects are linked to the new row.
    expect((await getProject(s, f.inc1))?.clientId).toBe(result.clientId);
    expect(await getProject(s, f.ltd1)).toMatchObject({
      clientName: "ACME Inc.",
      clientId: result.clientId,
    });
  });

  it("renames the kept client, moving its own projects to the new name", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
      name: "Acme Robotics",
    });
    expect(preview).toMatchObject({
      keptName: "Acme Robotics",
      keptKey: "acme robotics",
      movedCount: 3,
      nameConflict: null,
    });
    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
      name: "  Acme Robotics ",
    });
    expect(result).toEqual({
      moved: 3,
      keptKey: "acme robotics",
      keptName: "Acme Robotics",
      clientId: f.acmeId,
    });
    expect(await getClient(s, f.acmeId)).toMatchObject({
      name: "Acme Robotics",
      nameKey: "acme robotics",
      status: "active",
    });
    for (const projectId of [f.a1, f.a2, f.ltd1]) {
      expect(await getProject(s, projectId)).toMatchObject({
        clientName: "Acme Robotics",
        clientId: f.acmeId,
        dashboardCompanyKey: "acme robotics",
      });
    }
    expect(await companyRow(s, "Acme")).toBeNull();
    expect(await companyRow(s, "Acme Robotics")).toMatchObject({
      clientName: "Acme Robotics",
      projectCount: 3,
    });
    // Untouched client.
    expect(await getProject(s, f.inc1)).toMatchObject({ clientName: "ACME Inc." });
  });

  it("may take the name of one of the merged clients", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "acme ltd",
      mergeKeys: ["acme"],
      name: "Acme",
    });
    expect(result).toMatchObject({ keptKey: "acme", keptName: "Acme", clientId: f.acmeLtdId });
    expect(await getClient(s, f.acmeId)).toMatchObject({
      status: "merged",
      mergedIntoClientId: f.acmeLtdId,
    });
    expect(await getClient(s, f.acmeLtdId)).toMatchObject({
      name: "Acme",
      nameKey: "acme",
      status: "active",
    });
    const actives = (await clientsByKey(s, "Acme")).filter((row) => row.status === "active");
    expect(actives.map((row) => row._id)).toEqual([f.acmeLtdId]);
    expect(await companyRow(s, "Acme")).toMatchObject({ projectCount: 3 });
    expect(await companyRow(s, "Acme Ltd")).toBeNull();
  });

  it("reports and refuses a new name that matches another client", async () => {
    const s = await setup();
    await mergeFixture(s);
    await insertClient(s, "Zenith");
    await insertCompany(s, "Orbit Co", 1);
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
      name: "ZENITH",
    });
    expect(preview.nameConflict).toBe("Zenith");
    await expect(
      s.manager.mutation(api.clients.mergeClients, {
        keepKey: "acme",
        mergeKeys: ["acme ltd"],
        name: "orbit co",
      })
    ).rejects.toMatchObject({
      data: { code: "CLIENT_EXISTS", message: "Orbit Co already exists." },
    });
  });

  it("refuses a Consultant and writes nothing", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    await expect(
      s.writer.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["acme ltd"] })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(
      s.writer.query(api.clients.previewClientMerge, { keepKey: "acme", mergeKeys: ["acme ltd"] })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(await getClient(s, f.acmeLtdId)).toMatchObject({ status: "active" });
    expect(await getProject(s, f.ltd1)).toMatchObject({ clientName: "Acme Ltd" });
  });

  it.each([
    ["no merged clients", { keepKey: "acme", mergeKeys: [] }],
    ["a repeated key", { keepKey: "acme", mergeKeys: ["acme ltd", "acme ltd"] }],
    ["the kept key among the merged", { keepKey: "acme", mergeKeys: ["acme"] }],
    ["an unknown key", { keepKey: "acme", mergeKeys: ["nobody"] }],
    ["a blank new name", { keepKey: "acme", mergeKeys: ["acme ltd"], name: "  " }],
  ])("refuses %s with INVALID_INPUT", async (_label, args) => {
    const s = await setup();
    await mergeFixture(s);
    await expect(s.manager.mutation(api.clients.mergeClients, args)).rejects.toMatchObject({
      data: { code: "INVALID_INPUT" },
    });
  });

  it("skips projects being deleted", async () => {
    const s = await setup();
    const f = await mergeFixture(s);
    const deleting = await insertProject(s, { clientName: "Acme Ltd", deleting: true });
    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
    });
    expect(result.moved).toBe(1);
    expect(await getProject(s, deleting)).toMatchObject({ clientName: "Acme Ltd" });
    expect(await getProject(s, f.ltd1)).toMatchObject({ clientName: "Acme" });
  });

  it("refuses a merge that would move more than 200 projects", async () => {
    const s = await setup();
    await insertClient(s, "Big");
    await insertCompany(s, "Big", 1);
    await insertProject(s, { clientName: "Big" });
    await insertCompany(s, "Bigger", 201);
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("projects", {
          title: `Bigger ${i}`,
          clientName: "Bigger",
          dashboardCompanyKey: "bigger",
          dashboardFiscalYearRank: dashboardFiscalYearRank(undefined),
          dashboardSearchText: "bigger",
          dashboardCompanyCounted: true,
          workflowStage: "intake",
          workflowStageRank: workflowStageRank("intake"),
          ownerId: s.writerId,
          status: "draft",
          createdBy: s.writerId,
          shareToken: `big-${i}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "big",
      mergeKeys: ["bigger"],
    });
    expect(preview).toMatchObject({ tooMany: true, movedCount: 201, projectCount: 202 });
    await expect(
      s.manager.mutation(api.clients.mergeClients, { keepKey: "big", mergeKeys: ["bigger"] })
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_INPUT",
        message: "This merge would move more than 200 projects. Merge fewer companies at a time.",
      },
    });
    expect(await companyRow(s, "Bigger")).toMatchObject({ projectCount: 201 });
  });
});

describe("backfillClients", () => {
  // Self-rescheduling chains need fake timers to drain deterministically.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const drain = (s: Setup) => s.t.finishAllScheduledFunctions(() => vi.runAllTimers());

  async function backfillFixture(s: Setup) {
    const existingId = await insertClient(s, "Existing Co");
    await insertCompany(s, "Existing Co", 2);
    const linked = await insertProject(s, { clientName: "Existing Co", clientId: existingId });
    const unlinkedExisting = await insertProject(s, { clientName: "existing co" });
    await insertCompany(s, "Fresh Inc", 2);
    const fresh1 = await insertProject(s, { clientName: "Fresh Inc" });
    const fresh2 = await insertProject(s, { clientName: "FRESH INC" });
    // Looks alike but is a different key: never joined.
    await insertCompany(s, "Fresh Incorporated", 1);
    const lookalike = await insertProject(s, { clientName: "Fresh Incorporated" });
    const deleting = await insertProject(s, { clientName: "Fresh Inc", deleting: true });
    return { existingId, linked, unlinkedExisting, fresh1, fresh2, lookalike, deleting };
  }

  async function runStats(s: Setup, dryRun: boolean) {
    return await s.admin.query(api.clients.getClientsBackfillRun, { dryRun });
  }

  it("a dry run counts what it would do and writes nothing", async () => {
    const s = await setup();
    const f = await backfillFixture(s);
    const started = await s.admin.mutation(api.clients.backfillClients, {});
    expect(started).toMatchObject({ started: true, dryRun: true, runKey: "clients-v1-dry" });
    await drain(s);

    const run = await runStats(s, true);
    expect(run).toMatchObject({
      status: "completed",
      stats: { companiesScanned: 3, clientsCreated: 2, projectsLinked: 4 },
    });
    expect(await clientsByKey(s, "Fresh Inc")).toHaveLength(0);
    expect(await getProject(s, f.unlinkedExisting)).not.toHaveProperty("clientId");
  });

  it("applies one client per company key, links its projects, and is idempotent", async () => {
    const s = await setup();
    const f = await backfillFixture(s);
    await s.admin.mutation(api.clients.backfillClients, { dryRun: false });
    await drain(s);

    expect(await runStats(s, false)).toMatchObject({
      status: "completed",
      stats: { companiesScanned: 3, clientsCreated: 2, projectsLinked: 4 },
    });
    const fresh = await clientsByKey(s, "Fresh Inc");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({
      name: "Fresh Inc",
      nameKey: "fresh inc",
      status: "active",
      createdBy: s.adminId,
    });
    const lookalike = await clientsByKey(s, "Fresh Incorporated");
    expect(lookalike).toHaveLength(1);
    expect(lookalike[0]._id).not.toBe(fresh[0]._id);

    expect((await getProject(s, f.unlinkedExisting))?.clientId).toBe(f.existingId);
    expect((await getProject(s, f.linked))?.clientId).toBe(f.existingId);
    expect((await getProject(s, f.fresh1))?.clientId).toBe(fresh[0]._id);
    expect((await getProject(s, f.fresh2))?.clientId).toBe(fresh[0]._id);
    expect((await getProject(s, f.lookalike))?.clientId).toBe(lookalike[0]._id);
    expect(await getProject(s, f.deleting)).not.toHaveProperty("clientId");

    // Second run: nothing new to create or link.
    const again = await s.admin.mutation(api.clients.backfillClients, { dryRun: false });
    expect(again.started).toBe(true);
    await drain(s);
    expect(await runStats(s, false)).toMatchObject({
      status: "completed",
      stats: { companiesScanned: 3, clientsCreated: 0, projectsLinked: 0 },
    });
    expect(await clientsByKey(s, "Fresh Inc")).toHaveLength(1);
  });

  it("requires an admin and fences a run in progress", async () => {
    const s = await setup();
    await expect(
      s.manager.mutation(api.clients.backfillClients, {})
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    const first = await s.admin.mutation(api.clients.backfillClients, {});
    expect(first.started).toBe(true);
    const second = await s.admin.mutation(api.clients.backfillClients, {});
    expect(second.started).toBe(false);
    const forced = await s.admin.mutation(api.clients.backfillClients, { force: true });
    expect(forced.started).toBe(true);
    await drain(s);
    expect(await runStats(s, true)).toMatchObject({ status: "completed" });
  });
});

// ─── Review regressions (findings 1, 2, 3 and 5 on 88fab996) ────────────────

/** Inserts `count` bare counted projects on one key in a single transaction. */
async function insertManyProjects(
  s: Setup,
  clientName: string,
  count: number,
  options: { deleting?: boolean; clientId?: Id<"clients"> } = {}
) {
  await s.t.run(async (ctx) => {
    const now = Date.now();
    for (let i = 0; i < count; i++) {
      await ctx.db.insert("projects", {
        title: `${clientName} ${i}`,
        clientName,
        ...(options.clientId ? { clientId: options.clientId } : {}),
        dashboardCompanyKey: dashboardCompanyKey(clientName),
        dashboardFiscalYearRank: dashboardFiscalYearRank(undefined),
        dashboardSearchText: clientName.toLowerCase(),
        dashboardCompanyCounted: options.deleting ? false : true,
        ...(options.deleting ? { deletionStartedAt: now } : {}),
        workflowStage: "intake",
        workflowStageRank: workflowStageRank("intake"),
        ownerId: s.writerId,
        status: "draft",
        createdBy: s.writerId,
        shareToken: `many-${clientName}-${i}-${Math.random()}`,
        createdAt: now,
        updatedAt: now,
      });
    }
  });
}

describe("merge reads every live project of a key (finding 1)", () => {
  it("moves a live project that sits behind more than 201 deleting rows", async () => {
    const s = await setup();
    await insertClient(s, "Keep");
    await insertCompany(s, "Keep", 1, { intake: 1 });
    await insertProject(s, { clientName: "Keep" });
    // 250 deleting rows come first in the key's index order.
    await insertManyProjects(s, "Gone", 250, { deleting: true });
    await insertCompany(s, "Gone", 1, { intake: 1 });
    const live = await insertProject(s, { clientName: "Gone" });

    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "keep",
      mergeKeys: ["gone"],
    });
    expect(preview).toMatchObject({ movedCount: 1, tooMany: false });

    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "keep",
      mergeKeys: ["gone"],
    });
    expect(result.moved).toBe(1);
    expect(await getProject(s, live)).toMatchObject({
      clientName: "Keep",
      dashboardCompanyKey: "keep",
      clientId: result.clientId,
    });
    expect(await companyRow(s, "Keep")).toMatchObject({
      projectCount: 2,
      stageCounts: { intake: 2 },
    });
    expect(await companyRow(s, "Gone")).toBeNull();
  });

  it("allows exactly 200 live projects (tooMany is exact, not off by deleting rows)", async () => {
    const s = await setup();
    const keepId = await insertClient(s, "Keep");
    await insertCompany(s, "Keep", 1);
    // Already linked, so it does not count toward the limit (finding 2).
    await insertProject(s, { clientName: "Keep", clientId: keepId });
    await insertManyProjects(s, "Many", 5, { deleting: true });
    await insertManyProjects(s, "Many", 200);
    await insertCompany(s, "Many", 200);

    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "keep",
      mergeKeys: ["many"],
    });
    expect(preview).toMatchObject({ movedCount: 200, tooMany: false });
    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "keep",
      mergeKeys: ["many"],
    });
    expect(result.moved).toBe(200);
    expect(await companyRow(s, "Keep")).toMatchObject({ projectCount: 201 });
    expect(await companyRow(s, "Many")).toBeNull();
  });

  it("refuses rather than guesses when a key holds more rows than one merge reads", async () => {
    const s = await setup();
    await insertClient(s, "Keep");
    await insertCompany(s, "Keep", 1);
    await insertProject(s, { clientName: "Keep" });
    await insertManyProjects(s, "Huge", 2000, { deleting: true });
    await insertCompany(s, "Huge", 1);
    const live = await insertProject(s, { clientName: "Huge" });

    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "keep",
      mergeKeys: ["huge"],
    });
    expect(preview.tooMany).toBe(true);
    await expect(
      s.manager.mutation(api.clients.mergeClients, { keepKey: "keep", mergeKeys: ["huge"] })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    expect(await getProject(s, live)).toMatchObject({ clientName: "Huge" });
    expect(await companyRow(s, "Huge")).toMatchObject({ projectCount: 1 });
  });
});

describe("merge links the kept client's own projects (finding 2)", () => {
  it("links every live project of a kept key that had no client row yet", async () => {
    const s = await setup();
    await insertCompany(s, "Prebackfill", 3);
    const own = [
      await insertProject(s, { clientName: "Prebackfill" }),
      await insertProject(s, { clientName: "Prebackfill" }),
      await insertProject(s, { clientName: "Prebackfill" }),
    ];
    await insertCompany(s, "Other", 1);
    const moved = await insertProject(s, { clientName: "Other" });

    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "prebackfill",
      mergeKeys: ["other"],
    });
    expect(result.moved).toBe(1);
    for (const projectId of [...own, moved]) {
      expect((await getProject(s, projectId))?.clientId).toBe(result.clientId);
    }
  });

  it("counts the kept key's links toward the 200 limit", async () => {
    const s = await setup();
    await insertManyProjects(s, "Prebackfill", 150);
    await insertCompany(s, "Prebackfill", 150);
    await insertManyProjects(s, "Other", 51);
    await insertCompany(s, "Other", 51);

    const preview = await s.manager.query(api.clients.previewClientMerge, {
      keepKey: "prebackfill",
      mergeKeys: ["other"],
    });
    expect(preview).toMatchObject({ movedCount: 51, tooMany: true });
    await expect(
      s.manager.mutation(api.clients.mergeClients, {
        keepKey: "prebackfill",
        mergeKeys: ["other"],
      })
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_INPUT",
        message: "This merge would move more than 200 projects. Merge fewer companies at a time.",
      },
    });
    expect(await clientsByKey(s, "Prebackfill")).toHaveLength(0);
  });

  it("does not count already linked kept projects toward the limit", async () => {
    const s = await setup();
    const keepId = await insertClient(s, "Linked");
    await insertManyProjects(s, "Linked", 150, { clientId: keepId });
    await insertCompany(s, "Linked", 150);
    await insertManyProjects(s, "Other", 51);
    await insertCompany(s, "Other", 51);

    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "linked",
      mergeKeys: ["other"],
    });
    expect(result).toMatchObject({ moved: 51, clientId: keepId });
  });

  it("links leftover projects already on a new name's key", async () => {
    const s = await setup();
    const keepId = await insertClient(s, "Acme");
    await insertCompany(s, "Acme", 1);
    await insertProject(s, { clientName: "Acme", clientId: keepId });
    await insertCompany(s, "Acme Ltd", 1);
    await insertProject(s, { clientName: "Acme Ltd" });
    // Uncounted straggler on the new key: no company row, so no name conflict.
    const leftover = await insertProject(s, { clientName: "acme robotics" });

    const result = await s.manager.mutation(api.clients.mergeClients, {
      keepKey: "acme",
      mergeKeys: ["acme ltd"],
      name: "Acme Robotics",
    });
    expect(result).toMatchObject({ moved: 2, keptKey: "acme robotics", clientId: keepId });
    expect((await getProject(s, leftover))?.clientId).toBe(keepId);
  });
});

describe("backfill re-reads the active client each step (finding 3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const drain = (s: Setup) => s.t.finishAllScheduledFunctions(() => vi.runAllTimers());

  async function pendingStep(s: Setup, staleClientId: Id<"clients">) {
    const projects = [
      await insertProject(s, { clientName: "Moving Co" }),
      await insertProject(s, { clientName: "Moving Co" }),
      await insertProject(s, { clientName: "Moving Co" }),
    ];
    const startedAt = Date.now();
    const cursor = await s.t.run(async (ctx) => {
      await ctx.db.insert("dashboardBackfillRuns", {
        runKey: "clients-v1-live",
        status: "running",
        dryRun: false,
        startedAt,
      });
      const page = await ctx.db
        .query("projects")
        .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", "moving co"))
        .paginate({ cursor: null, numItems: 1 });
      return page.continueCursor;
    });
    await s.t.mutation(internal.clients.backfillClientsStep, {
      runKey: "clients-v1-live",
      runStartedAt: startedAt,
      dryRun: false,
      actorId: s.adminId,
      afterKey: null,
      pending: { companyKey: "moving co", clientId: staleClientId, projectCursor: cursor },
      stats: { companiesScanned: 1, clientsCreated: 1, projectsLinked: 0 },
    });
    return projects;
  }

  async function mergedTombstone(s: Setup, into?: Id<"clients">) {
    return await s.t.run(async (ctx) => {
      const now = Date.now();
      const target =
        into ??
        (await ctx.db.insert("clients", {
          name: "Elsewhere",
          nameKey: "elsewhere",
          status: "active",
          createdBy: s.adminId,
          createdAt: now,
          updatedAt: now,
        }));
      return await ctx.db.insert("clients", {
        name: "Moving Co",
        nameKey: "moving co",
        status: "merged",
        mergedIntoClientId: target,
        createdBy: s.adminId,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  it("links later pages to the key's current active client, not the saved one", async () => {
    const s = await setup();
    const activeId = await insertClient(s, "Moving Co");
    const staleId = await mergedTombstone(s);
    const [, second, third] = await pendingStep(s, staleId);
    expect((await getProject(s, second))?.clientId).toBe(activeId);
    expect((await getProject(s, third))?.clientId).toBe(activeId);
    await drain(s);
  });

  it("skips linking when the key no longer has an active client", async () => {
    const s = await setup();
    const staleId = await mergedTombstone(s);
    const [, second, third] = await pendingStep(s, staleId);
    expect(await getProject(s, second)).not.toHaveProperty("clientId");
    expect(await getProject(s, third)).not.toHaveProperty("clientId");
    await drain(s);
  });
});

describe("listClients bound ignores the unnamed company row (finding 5)", () => {
  it("is not truncated with exactly 1000 named companies plus the unnamed row", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 1000; i++) {
        await ctx.db.insert("dashboardCompanies", {
          companyKey: `company ${String(i).padStart(4, "0")}`,
          clientName: `Company ${i}`,
          projectCount: 1,
          updatedAt: now,
        });
      }
      await ctx.db.insert("dashboardCompanies", {
        companyKey: "￿",
        clientName: "Unnamed",
        projectCount: 1,
        updatedAt: now,
      });
    });
    const result = await s.writer.query(api.clients.listClients, {});
    expect(result.truncated).toBe(false);
    expect(result.clients).toHaveLength(1000);
  });
});

describe("updateCompany (Edit company, 2026-10-28)", () => {
  /** Acme (saved client, 2 projects with exact stage counts) and Zenith (saved, 1 project). */
  async function editFixture(s: Setup) {
    const acmeId = await insertClient(s, "Acme", {
      fiscalYearEndMonth: 3,
      fiscalYearEndDay: 31,
      industry: "software",
    });
    await insertCompany(s, "Acme", 2, { intake: 1, drafting: 1 });
    const a1 = await insertProject(s, {
      clientName: "Acme",
      clientId: acmeId,
      stage: "intake",
      fiscalYearEnd: FY2025,
      title: "Acme one",
    });
    const a2 = await insertProject(s, {
      clientName: "Acme",
      clientId: acmeId,
      stage: "drafting",
      fiscalYearEnd: FY2024,
      title: "Acme two",
    });
    const zenithId = await insertClient(s, "Zenith");
    await insertCompany(s, "Zenith", 1, { intake: 1 });
    const z1 = await insertProject(s, { clientName: "Zenith", clientId: zenithId, title: "Zenith one" });
    return { acmeId, a1, a2, zenithId, z1 };
  }

  /** Edit company's args as a dialog opened now would send them for `key`. */
  async function opened(s: Setup, key: string) {
    const page = await s.manager.query(api.clients.getCompanyPage, { key });
    if (page.kind !== "company") throw new Error(`${key} is not a company`);
    return {
      key,
      expectedName: page.name,
      expectedClientId: page.clientId,
      expectedUpdatedAt: page.clientUpdatedAt,
    };
  }

  /** Acme as it is, opened now: change only what a test overrides. */
  async function acmeArgs(s: Setup) {
    return {
      ...(await opened(s, "acme")),
      name: "Acme",
      fiscalYearEndMonth: 3,
      fiscalYearEndDay: 31,
      industry: "software",
    };
  }

  it("is for Managers and Admins: a Consultant or a roleless user is refused and nothing changes", async () => {
    const s = await setup();
    const f = await editFixture(s);
    for (const actor of [s.writer, s.roleless]) {
      await expect(
        actor.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), name: "Acme Robotics" })
      ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    }
    expect(await getClient(s, f.acmeId)).toMatchObject({ name: "Acme", nameKey: "acme" });
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), industry: "manufacturing" })
    ).resolves.toMatchObject({ key: "acme", name: "Acme", moved: 0 });
    await expect(
      s.admin.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), industry: "software" })
    ).resolves.toMatchObject({ key: "acme" });
  });

  it("changes the year end and industry on the company row only, and clears what is left unset", async () => {
    const s = await setup();
    const f = await editFixture(s);
    const before = await getProject(s, f.a1);
    await s.manager.mutation(api.clients.updateCompany, {
      ...(await opened(s, "acme")),
      name: "Acme",
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "manufacturing",
    });
    expect(await getClient(s, f.acmeId)).toMatchObject({
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "manufacturing",
    });
    // Projects keep their own fiscal year and are not touched.
    expect(await getProject(s, f.a1)).toEqual(before);

    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "acme")), name: "Acme" });
    const cleared = await getClient(s, f.acmeId);
    expect(cleared?.fiscalYearEndMonth).toBeUndefined();
    expect(cleared?.fiscalYearEndDay).toBeUndefined();
    expect(cleared?.industry).toBeUndefined();
  });

  it("refuses half a year end and a day the month does not have", async () => {
    const s = await setup();
    await editFixture(s);
    for (const yearEnd of [{ fiscalYearEndMonth: 9 }, { fiscalYearEndMonth: 2, fiscalYearEndDay: 30 }]) {
      await expect(
        s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "acme")), name: "Acme", ...yearEnd })
      ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    }
  });

  it("a rename re-keys every live project as a merge does, moves the counts and keeps the old name", async () => {
    const s = await setup();
    const f = await editFixture(s);
    const deleting = await insertProject(s, { clientName: "Acme", deleting: true, title: "Going" });
    const result = await s.manager.mutation(api.clients.updateCompany, {
      ...(await acmeArgs(s)),
      name: "  Acme Robotics ",
    });
    expect(result).toEqual({ clientId: f.acmeId, key: "acme robotics", name: "Acme Robotics", moved: 2 });
    expect(await getClient(s, f.acmeId)).toMatchObject({
      name: "Acme Robotics",
      nameKey: "acme robotics",
      status: "active",
      formerNames: ["Acme"],
      fiscalYearEndMonth: 3,
      industry: "software",
    });
    for (const projectId of [f.a1, f.a2]) {
      expect(await getProject(s, projectId)).toMatchObject({
        clientName: "Acme Robotics",
        clientId: f.acmeId,
        dashboardCompanyKey: "acme robotics",
      });
    }
    // The old projection row is gone, the new one counts both with their stages.
    expect(await companyRow(s, "Acme")).toBeNull();
    expect(await companyRow(s, "Acme Robotics")).toMatchObject({
      clientName: "Acme Robotics",
      projectCount: 2,
      stageCounts: { intake: 1, drafting: 1 },
    });
    // A project being deleted keeps its name, as in a merge.
    expect(await getProject(s, deleting)).toMatchObject({ clientName: "Acme" });
    // The company list shows the new name once.
    const list = await s.writer.query(api.clients.listClients, {});
    expect(list.clients.map((entry) => entry.key)).toEqual(["acme robotics", "zenith"]);
  });

  it("a rename that only changes case keeps the key and relabels the projects and the row", async () => {
    const s = await setup();
    const f = await editFixture(s);
    const result = await s.admin.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), name: "ACME" });
    expect(result).toMatchObject({ key: "acme", name: "ACME", moved: 2 });
    expect(await getProject(s, f.a1)).toMatchObject({ clientName: "ACME", dashboardCompanyKey: "acme" });
    expect(await companyRow(s, "Acme")).toMatchObject({ clientName: "ACME", projectCount: 2 });
    expect(await getClient(s, f.acmeId)).toMatchObject({ name: "ACME", formerNames: ["Acme"] });
  });

  it("refuses a name another company has, saved or known only by its projects, and writes nothing", async () => {
    const s = await setup();
    const f = await editFixture(s);
    await insertCompany(s, "Orbit Co", 1);
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), name: "zenith" })
    ).rejects.toMatchObject({
      data: { code: "CLIENT_EXISTS", message: "A company named Zenith already exists. Merge them instead." },
    });
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), name: "ORBIT CO" })
    ).rejects.toMatchObject({
      data: { code: "CLIENT_EXISTS", message: "A company named Orbit Co already exists. Merge them instead." },
    });
    expect(await getClient(s, f.acmeId)).toMatchObject({ name: "Acme", nameKey: "acme" });
    expect(await getProject(s, f.a1)).toMatchObject({ clientName: "Acme" });
  });

  const CHANGED = {
    code: "STALE_REVISION",
    message: "This company changed since you opened Edit company. Close and try again.",
  };

  it("refuses a stale dialog: a rename since, a year end or industry change since, or the company gone", async () => {
    const s = await setup();
    const f = await editFixture(s);
    // Two dialogs open on Acme as it is now.
    const first = await acmeArgs(s);
    const second = await acmeArgs(s);
    await s.manager.mutation(api.clients.updateCompany, { ...first, name: "ACME" });
    await expect(
      s.admin.mutation(api.clients.updateCompany, { ...second, industry: "manufacturing" })
    ).rejects.toMatchObject({ data: CHANGED });

    // Only the year end changed since: the name matches, the row does not.
    const before = await acmeArgs(s);
    await s.manager.mutation(api.clients.updateCompany, { ...before, name: "ACME", fiscalYearEndMonth: 6, fiscalYearEndDay: 30 });
    await expect(
      s.admin.mutation(api.clients.updateCompany, { ...before, name: "ACME", industry: "manufacturing" })
    ).rejects.toMatchObject({ data: CHANGED });
    expect(await getClient(s, f.acmeId)).toMatchObject({ fiscalYearEndMonth: 6, industry: "software" });

    // The company left its key.
    const stale = await acmeArgs(s);
    await s.manager.mutation(api.clients.updateCompany, { ...stale, name: "Acme Robotics" });
    await expect(
      s.admin.mutation(api.clients.updateCompany, { ...stale, name: "Acme Two" })
    ).rejects.toMatchObject({ data: CHANGED });
    expect(await getClient(s, f.acmeId)).toMatchObject({ name: "Acme Robotics", industry: "software" });
  });

  it("an old dialog never edits a new company that took its key", async () => {
    const s = await setup();
    const f = await editFixture(s);
    const old = await acmeArgs(s);
    await s.manager.mutation(api.clients.updateCompany, { ...old, name: "Acme Robotics" });
    // Someone makes a new "Acme": same key and the same name the old dialog
    // saw, and (pinned here) the same last change, so only the row can tell
    // the two companies apart.
    const created = await s.writer.mutation(api.clients.createClient, { name: "Acme" });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(created.clientId, { updatedAt: old.expectedUpdatedAt! });
    });
    expect(await opened(s, "acme")).toEqual({
      key: old.key,
      expectedName: old.expectedName,
      expectedClientId: created.clientId,
      expectedUpdatedAt: old.expectedUpdatedAt,
    });
    await expect(
      s.admin.mutation(api.clients.updateCompany, { ...old, industry: "manufacturing" })
    ).rejects.toMatchObject({ data: CHANGED });
    expect((await getClient(s, created.clientId))?.industry).toBeUndefined();
    expect(await getClient(s, f.acmeId)).toMatchObject({ name: "Acme Robotics", industry: "software" });
  });

  it("a company row made since a name-only company's dialog opened refuses that dialog", async () => {
    const s = await setup();
    await insertCompany(s, "Birch Foods", 1);
    await insertProject(s, { clientName: "Birch Foods" });
    const old = await opened(s, "birch foods");
    expect(old).toMatchObject({ expectedClientId: null, expectedUpdatedAt: null });
    const made = await s.manager.mutation(api.clients.updateCompany, { ...old, name: "Birch Foods", industry: "software" });
    const row = await getClient(s, made.clientId);
    // Even a dialog whose last change matches the new row is refused: it
    // opened on no row, and now there is one.
    await expect(
      s.admin.mutation(api.clients.updateCompany, {
        ...old,
        expectedUpdatedAt: row!.updatedAt,
        name: "Birch Foods",
        industry: "manufacturing",
      })
    ).rejects.toMatchObject({ data: CHANGED });
    expect(await getClient(s, made.clientId)).toMatchObject({ industry: "software" });
  });

  it("each save moves the last change forward, even twice in the same millisecond", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const at = Date.UTC(2026, 9, 28, 12);
      vi.setSystemTime(at);
      const s = await setup();
      const f = await editFixture(s);
      expect((await getClient(s, f.acmeId))?.updatedAt).toBe(at);
      const first = await acmeArgs(s);
      await s.manager.mutation(api.clients.updateCompany, { ...first, industry: "manufacturing" });
      const afterFirst = (await getClient(s, f.acmeId))!.updatedAt;
      expect(afterFirst).toBe(at + 1);

      // Opened between the two saves; the clock has not moved.
      const between = await acmeArgs(s);
      expect(between.expectedUpdatedAt).toBe(afterFirst);
      await s.manager.mutation(api.clients.updateCompany, { ...between, industry: "life-sciences" });
      const afterSecond = (await getClient(s, f.acmeId))!.updatedAt;
      expect(afterSecond).toBe(afterFirst + 1);
      expect(Date.now()).toBe(at);

      // A dialog from before the second save, same name and row, is refused.
      await expect(
        s.admin.mutation(api.clients.updateCompany, { ...between, industry: "software" })
      ).rejects.toMatchObject({ data: CHANGED });
      expect(await getClient(s, f.acmeId)).toMatchObject({ industry: "life-sciences" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a Manager keeps a company's own industry that no project uses; only a changed industry is checked", async () => {
    const s = await setup();
    await editFixture(s);
    const rareId = await insertClient(s, "Rare Co", { industry: "quantum-optics" });
    const result = await s.manager.mutation(api.clients.updateCompany, {
      ...(await opened(s, "rare co")),
      name: "Rare Co",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      industry: "quantum-optics",
    });
    expect(result).toMatchObject({ key: "rare co" });
    expect(await getClient(s, rareId)).toMatchObject({ industry: "quantum-optics", fiscalYearEndMonth: 12 });
    // A new industry no project uses is still the Admin's to add.
    await expect(
      s.manager.mutation(api.clients.updateCompany, {
        ...(await opened(s, "rare co")),
        name: "Rare Co",
        industry: "deep-sea-mining",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
  });

  it("gives a company known only by its projects its row first, linking its projects", async () => {
    const s = await setup();
    await insertCompany(s, "Birch Foods", 2);
    const b1 = await insertProject(s, { clientName: "Birch Foods", title: "Birch one" });
    const b2 = await insertProject(s, { clientName: "Birch Foods", title: "Birch two" });
    const result = await s.manager.mutation(api.clients.updateCompany, {
      ...(await opened(s, "birch foods")),
      name: "Birch Foods",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
    });
    expect(result).toMatchObject({ key: "birch foods", name: "Birch Foods", moved: 0 });
    expect(await getClient(s, result.clientId)).toMatchObject({
      name: "Birch Foods",
      nameKey: "birch foods",
      status: "active",
      nameHistoryComplete: true,
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      createdBy: s.managerId,
    });
    for (const projectId of [b1, b2]) {
      expect(await getProject(s, projectId)).toMatchObject({ clientId: result.clientId });
    }

    // Renaming another name-only company makes its row and moves its projects.
    await insertCompany(s, "Cedar Ltd", 1);
    const c1 = await insertProject(s, { clientName: "Cedar Ltd", title: "Cedar one" });
    const renamed = await s.manager.mutation(api.clients.updateCompany, {
      ...(await opened(s, "cedar ltd")),
      name: "Cedarline",
    });
    expect(renamed).toMatchObject({ key: "cedarline", name: "Cedarline", moved: 1 });
    expect(await getClient(s, renamed.clientId)).toMatchObject({ name: "Cedarline", formerNames: ["Cedar Ltd"] });
    expect(await getProject(s, c1)).toMatchObject({ clientName: "Cedarline", clientId: renamed.clientId });
    expect(await companyRow(s, "Cedar Ltd")).toBeNull();
  });

  it("keeps the history as complete as it was, and a name taken back leaves the former names", async () => {
    const s = await setup();
    const f = await editFixture(s);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(f.acmeId, { formerNames: ["Acme Robotics", "Acme Old"], nameHistoryComplete: false });
    });
    await s.manager.mutation(api.clients.updateCompany, { ...(await acmeArgs(s)), name: "Acme Robotics" });
    const client = await getClient(s, f.acmeId);
    expect(new Set(client?.formerNames)).toEqual(new Set(["Acme Old", "Acme"]));
    expect(client?.nameHistoryComplete).toBe(false);
  });

  it("refuses a rename that would move more than 200 projects; a details-only save still works", async () => {
    const s = await setup();
    const bigId = await insertClient(s, "Bigger");
    await insertCompany(s, "Bigger", 201);
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 201; i++) {
        await ctx.db.insert("projects", {
          title: `Bigger ${i}`,
          clientName: "Bigger",
          clientId: bigId,
          dashboardCompanyKey: "bigger",
          dashboardFiscalYearRank: dashboardFiscalYearRank(undefined),
          dashboardSearchText: "bigger",
          dashboardCompanyCounted: true,
          workflowStage: "intake",
          workflowStageRank: workflowStageRank("intake"),
          ownerId: s.writerId,
          status: "draft",
          createdBy: s.writerId,
          shareToken: `bigger-${i}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "bigger")), name: "Biggest" })
    ).rejects.toMatchObject({
      data: {
        code: "INVALID_INPUT",
        message: "This company has more than 200 projects, too many to rename at once. Ask an admin for help.",
      },
    });
    expect(await getClient(s, bigId)).toMatchObject({ name: "Bigger" });
    await expect(
      s.manager.mutation(api.clients.updateCompany, {
        ...(await opened(s, "bigger")),
        name: "Bigger",
        industry: "software",
      })
    ).resolves.toMatchObject({ key: "bigger", moved: 0 });
    expect(await getClient(s, bigId)).toMatchObject({ industry: "software" });
  });

  it("renames a company of exactly 200 projects (the limit is more than 200)", async () => {
    const s = await setup();
    const bigId = await insertClient(s, "Bigger");
    await insertCompany(s, "Bigger", 200);
    await s.t.run(async (ctx) => {
      const now = Date.now();
      for (let i = 0; i < 200; i++) {
        await ctx.db.insert("projects", {
          title: `Bigger ${i}`,
          clientName: "Bigger",
          clientId: bigId,
          dashboardCompanyKey: "bigger",
          dashboardFiscalYearRank: dashboardFiscalYearRank(undefined),
          dashboardSearchText: "bigger",
          dashboardCompanyCounted: true,
          workflowStage: "intake",
          workflowStageRank: workflowStageRank("intake"),
          ownerId: s.writerId,
          status: "draft",
          createdBy: s.writerId,
          shareToken: `bigger-200-${i}`,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const result = await s.manager.mutation(api.clients.updateCompany, {
      ...(await opened(s, "bigger")),
      name: "Biggest",
    });
    expect(result).toMatchObject({ key: "biggest", name: "Biggest", moved: 200 });
    expect(await companyRow(s, "Bigger")).toBeNull();
    expect(await companyRow(s, "Biggest")).toMatchObject({ projectCount: 200 });
  });

  it("refuses the projects with no company name", async () => {
    const s = await setup();
    await expect(
      s.manager.mutation(api.clients.updateCompany, {
        key: dashboardCompanyKey(""),
        expectedName: "",
        expectedClientId: null,
        expectedUpdatedAt: null,
        name: "Named",
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });
});

describe("getCompanyPage (the company page, 2026-10-28)", () => {
  it("returns a saved company with its facts, and a name-only company with its count", async () => {
    const s = await setup();
    const acmeId = await insertClient(s, "Acme", { fiscalYearEndMonth: 9, fiscalYearEndDay: 30, industry: "software" });
    await insertCompany(s, "Acme", 3);
    await insertCompany(s, "Birch Foods", 2);
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "acme" })).toEqual({
      kind: "company",
      key: "acme",
      clientId: acmeId,
      clientUpdatedAt: expect.any(Number),
      name: "Acme",
      projectCount: 3,
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "software",
      fiscalYearEndFromProjects: false,
      industryFromProjects: false,
      hasProjectFiscalYearEnd: false,
      hasProjectIndustry: false,
      websiteRead: null,
      mergedNote: null,
    });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "birch foods" })).toEqual({
      kind: "company",
      key: "birch foods",
      clientId: null,
      clientUpdatedAt: null,
      name: "Birch Foods",
      projectCount: 2,
      fiscalYearEndFromProjects: false,
      industryFromProjects: false,
      hasProjectFiscalYearEnd: false,
      hasProjectIndustry: false,
      websiteRead: null,
      mergedNote: null,
    });
  });

  it("says missing for an unknown key and the projects with no company name", async () => {
    const s = await setup();
    await insertCompany(s, "", 1);
    for (const key of ["nobody", dashboardCompanyKey("")]) {
      expect(await s.writer.query(api.clients.getCompanyPage, { key })).toEqual({ kind: "missing" });
    }
  });

  it("requires an internal user", async () => {
    const s = await setup();
    await expect(s.t.query(api.clients.getCompanyPage, { key: "acme" })).rejects.toBeTruthy();
  });

  it("sends a merged key to the company it ended up in, through merges of merges, with the note once asked", async () => {
    const s = await setup();
    const acmeId = await insertClient(s, "Acme");
    await insertCompany(s, "Acme", 1);
    await insertProject(s, { clientName: "Acme", clientId: acmeId });
    await insertCompany(s, "ACME Inc.", 2);
    await insertProject(s, { clientName: "ACME Inc." });
    await insertProject(s, { clientName: "ACME Inc." });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "acme", mergeKeys: ["acme inc."] });
    // The tombstone records how many projects moved with it.
    const [tombstone] = (await clientsByKey(s, "ACME Inc.")).filter((row) => row.status === "merged");
    expect(tombstone).toMatchObject({ status: "merged", mergedIntoClientId: acmeId, mergedProjectCount: 2 });

    // Then Acme itself is merged into Zenith: the oldest key still lands there.
    const zenithId = await insertClient(s, "Zenith");
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "zenith", mergeKeys: ["acme"] });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "acme inc." })).toEqual({
      kind: "merged",
      key: "zenith",
      name: "Zenith",
    });
    const page = await s.writer.query(api.clients.getCompanyPage, { key: "zenith", mergedFrom: "acme" });
    expect(page).toMatchObject({ kind: "company", clientId: zenithId, projectCount: 3 });
    expect(page.kind === "company" && page.mergedNote).toMatchObject({ fromName: "Acme", projectCount: 3 });
    // A merged-from key that did not end here adds no note.
    expect(
      await s.writer.query(api.clients.getCompanyPage, { key: "zenith", mergedFrom: "nobody" })
    ).toMatchObject({ kind: "company", mergedNote: null });
  });

  it("an old key opens where its latest merge went, even when an older row made the later merge", async () => {
    const s = await setup();
    const zenithId = await insertClient(s, "Zenith");
    const orbitId = await insertClient(s, "Orbit");
    await s.t.run(async (ctx) => {
      // Made first (another name, renamed onto "acme" later), merged last.
      await ctx.db.insert("clients", {
        name: "Acme",
        nameKey: "acme",
        status: "merged",
        mergedIntoClientId: zenithId,
        mergedAt: Date.UTC(2026, 9, 20),
        createdBy: s.adminId,
        createdAt: 1,
        updatedAt: Date.UTC(2026, 9, 20),
      });
      // Made later, merged earlier.
      await ctx.db.insert("clients", {
        name: "Acme",
        nameKey: "acme",
        status: "merged",
        mergedIntoClientId: orbitId,
        mergedAt: Date.UTC(2026, 9, 1),
        createdBy: s.adminId,
        createdAt: 2,
        updatedAt: Date.UTC(2026, 9, 1),
      });
    });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "acme" })).toEqual({
      kind: "merged",
      key: "zenith",
      name: "Zenith",
    });
  });

  it("names no count for a merge made before counts were kept", async () => {
    const s = await setup();
    const keptId = await insertClient(s, "Kept");
    await s.t.run(async (ctx) => {
      await ctx.db.insert("clients", {
        name: "Old Name",
        nameKey: "old name",
        status: "merged",
        mergedIntoClientId: keptId,
        mergedAt: Date.UTC(2026, 9, 3),
        createdBy: s.adminId,
        createdAt: 1,
        updatedAt: 1,
      });
    });
    const page = await s.writer.query(api.clients.getCompanyPage, { key: "kept", mergedFrom: "old name" });
    expect(page.kind === "company" && page.mergedNote).toMatchObject({
      fromName: "Old Name",
      mergedAt: Date.UTC(2026, 9, 3),
      projectCount: null,
    });
  });
});

describe("listClients last update (All companies, 2026-10-28)", () => {
  it("is the later of the company row's and its projection row's change", async () => {
    const s = await setup();
    const acmeId = await insertClient(s, "Acme");
    await insertCompany(s, "Acme", 1);
    await insertCompany(s, "Birch Foods", 1);
    await s.t.run(async (ctx) => {
      await ctx.db.patch(acmeId, { updatedAt: 5_000 });
      const acme = await ctx.db.query("dashboardCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", "acme")).unique();
      await ctx.db.patch(acme!._id, { updatedAt: 9_000 });
      const birch = await ctx.db.query("dashboardCompanies").withIndex("by_companyKey", (q) => q.eq("companyKey", "birch foods")).unique();
      await ctx.db.patch(birch!._id, { updatedAt: 7_000 });
    });
    const list = await s.writer.query(api.clients.listClients, {});
    expect(list.clients.map((entry) => [entry.key, entry.updatedAt])).toEqual([
      ["acme", 9_000],
      ["birch foods", 7_000],
    ]);
  });
});

describe("fiscal year end and industry fall back to the newest project's (2026-10-28)", () => {
  const DEC_31_2025 = Date.UTC(2025, 11, 31);
  const DEC_31_2024 = Date.UTC(2024, 11, 31);
  const JUN_30_2025 = Date.UTC(2025, 5, 30);

  async function setIndustry(s: Setup, projectId: Id<"projects">, industry: string | undefined, updatedAt: number) {
    await s.t.run(async (ctx) => {
      await ctx.db.patch(projectId, { industry, updatedAt });
    });
  }

  it("a company with none saved shows its latest project year end and its most recently updated project's industry", async () => {
    const s = await setup();
    await insertClient(s, "3GA Marine Ltd");
    await insertCompany(s, "3GA Marine Ltd", 4);
    const old = await insertProject(s, { clientName: "3GA Marine Ltd", fiscalYearEnd: DEC_31_2024 });
    const latest = await insertProject(s, { clientName: "3GA Marine Ltd", fiscalYearEnd: DEC_31_2025 });
    const shortYear = await insertProject(s, { clientName: "3GA Marine Ltd", fiscalYearEnd: JUN_30_2025 });
    const going = await insertProject(s, { clientName: "3GA Marine Ltd", fiscalYearEnd: Date.UTC(2026, 2, 31), deleting: true });
    // The older-made project was updated last: its industry wins over the
    // newer-made one's, so the pick is by last update, not by creation.
    await setIndustry(s, old, "manufacturing", 5_000);
    await setIndustry(s, latest, "software", 2_000);
    // Updated later than "software", but with no industry; and one being deleted.
    await setIndustry(s, shortYear, undefined, 3_000);
    await setIndustry(s, going, "life-sciences", 6_000);

    const page = await s.writer.query(api.clients.getCompanyPage, { key: "3ga marine ltd" });
    expect(page).toMatchObject({
      kind: "company",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      industry: "manufacturing",
      fiscalYearEndFromProjects: true,
      industryFromProjects: true,
    });
    // The same year end for the All companies column.
    expect(await s.writer.query(api.clients.listCompanyYearEnds, { keys: ["3ga marine ltd", "nobody"] })).toEqual([
      { key: "3ga marine ltd", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
    ]);
  });

  it("the latest date of the latest fiscal year wins, whatever order its projects were made in", async () => {
    const s = await setup();
    await insertClient(s, "Twelve Co");
    await insertCompany(s, "Twelve Co", 12);
    // Ten projects being deleted first: skipped, and not the end of the read.
    for (let i = 0; i < 10; i++) {
      await insertProject(s, { clientName: "Twelve Co", fiscalYearEnd: Date.UTC(2025, 11, 31), deleting: true });
    }
    // Ten FY 2025 projects ending June 30 made first, then two ending December 31.
    for (let i = 0; i < 10; i++) await insertProject(s, { clientName: "Twelve Co", fiscalYearEnd: JUN_30_2025 });
    for (let i = 0; i < 2; i++) await insertProject(s, { clientName: "Twelve Co", fiscalYearEnd: DEC_31_2025 });
    await insertProject(s, { clientName: "Twelve Co", fiscalYearEnd: DEC_31_2024 });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "twelve co" })).toMatchObject({
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      fiscalYearEndFromProjects: true,
    });
    expect(await s.writer.query(api.clients.listCompanyYearEnds, { keys: ["twelve co"] })).toEqual([
      { key: "twelve co", fiscalYearEndMonth: 12, fiscalYearEndDay: 31 },
    ]);
  });

  it("a project the rank backfill has not reached neither hides a later year nor ends the read early", async () => {
    const s = await setup();
    await insertClient(s, "Unranked Co");
    await insertCompany(s, "Unranked Co", 4);
    // No rank: the index puts it first, though its year is the oldest.
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projects", {
        title: "Not backfilled",
        clientName: "Unranked Co",
        dashboardCompanyKey: "unranked co",
        dashboardSearchText: "not backfilled",
        dashboardCompanyCounted: true,
        fiscalYearEnd: Date.UTC(2023, 11, 31),
        workflowStage: "intake",
        workflowStageRank: workflowStageRank("intake"),
        ownerId: s.writerId,
        status: "draft",
        createdBy: s.writerId,
        shareToken: "unranked-1",
        createdAt: now,
        updatedAt: now,
      });
    });
    await insertProject(s, { clientName: "Unranked Co", fiscalYearEnd: JUN_30_2025 });
    await insertProject(s, { clientName: "Unranked Co", fiscalYearEnd: DEC_31_2025 });
    await insertProject(s, { clientName: "Unranked Co", fiscalYearEnd: DEC_31_2024 });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "unranked co" })).toMatchObject({
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      fiscalYearEndFromProjects: true,
    });

    // An unranked project in the newest year still wins over ranked ones.
    await s.t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("projects", {
        title: "Newest, not backfilled",
        clientName: "Unranked Co",
        dashboardCompanyKey: "unranked co",
        dashboardSearchText: "newest",
        dashboardCompanyCounted: true,
        fiscalYearEnd: Date.UTC(2026, 2, 31),
        workflowStage: "intake",
        workflowStageRank: workflowStageRank("intake"),
        ownerId: s.writerId,
        status: "draft",
        createdBy: s.writerId,
        shareToken: "unranked-2",
        createdAt: now,
        updatedAt: now,
      });
    });
    expect(await s.writer.query(api.clients.listCompanyYearEnds, { keys: ["unranked co"] })).toEqual([
      { key: "unranked co", fiscalYearEndMonth: 3, fiscalYearEndDay: 31 },
    ]);
  });

  it("a company known only by its projects falls back too", async () => {
    const s = await setup();
    await insertCompany(s, "Birch Foods", 1);
    const birch = await insertProject(s, { clientName: "Birch Foods", fiscalYearEnd: Date.UTC(2025, 2, 31) });
    await setIndustry(s, birch, "life-sciences", 5_000);
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "birch foods" })).toMatchObject({
      clientId: null,
      fiscalYearEndMonth: 3,
      fiscalYearEndDay: 31,
      industry: "life-sciences",
    });
  });

  it("a value saved on the company wins over its projects'", async () => {
    const s = await setup();
    await insertClient(s, "Acme", { fiscalYearEndMonth: 9, fiscalYearEndDay: 30, industry: "manufacturing" });
    await insertCompany(s, "Acme", 1);
    const acme = await insertProject(s, { clientName: "Acme", fiscalYearEnd: DEC_31_2025 });
    await setIndustry(s, acme, "software", 9_000);
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "acme" })).toMatchObject({
      fiscalYearEndMonth: 9,
      fiscalYearEndDay: 30,
      industry: "manufacturing",
      fiscalYearEndFromProjects: false,
      industryFromProjects: false,
      // Projects' values lie behind the saved ones: emptying a field shows them.
      hasProjectFiscalYearEnd: true,
      hasProjectIndustry: true,
    });
    // Each falls back on its own: a saved year end, no saved industry.
    await s.t.run(async (ctx) => {
      const client = await ctx.db.query("clients").withIndex("by_nameKey", (q) => q.eq("nameKey", "acme")).first();
      await ctx.db.patch(client!._id, { industry: undefined });
    });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "acme" })).toMatchObject({
      fiscalYearEndMonth: 9,
      industry: "software",
      fiscalYearEndFromProjects: false,
      industryFromProjects: true,
    });
  });

  it("says nothing when neither the company nor a project has a value", async () => {
    const s = await setup();
    await insertClient(s, "Plain Co");
    await insertCompany(s, "Plain Co", 1);
    await insertProject(s, { clientName: "Plain Co" });
    const page = await s.writer.query(api.clients.getCompanyPage, { key: "plain co" });
    expect(page.kind === "company" && [page.fiscalYearEndMonth, page.fiscalYearEndDay, page.industry]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(page).toMatchObject({
      fiscalYearEndFromProjects: false,
      industryFromProjects: false,
      hasProjectFiscalYearEnd: false,
      hasProjectIndustry: false,
    });
  });

  it("saving Edit company stores the values it sends on the company", async () => {
    const s = await setup();
    const clientId = await insertClient(s, "3GA Marine Ltd");
    await insertCompany(s, "3GA Marine Ltd", 1);
    const p = await insertProject(s, { clientName: "3GA Marine Ltd", fiscalYearEnd: DEC_31_2025 });
    await setIndustry(s, p, "manufacturing", 1_000);
    const page = await s.manager.query(api.clients.getCompanyPage, { key: "3ga marine ltd" });
    if (page.kind !== "company") throw new Error("not a company");
    await s.manager.mutation(api.clients.updateCompany, {
      key: page.key,
      expectedName: page.name,
      expectedClientId: page.clientId,
      expectedUpdatedAt: page.clientUpdatedAt,
      name: "3GA Marine",
      fiscalYearEndMonth: page.fiscalYearEndMonth,
      fiscalYearEndDay: page.fiscalYearEndDay,
      industry: page.industry,
    });
    expect(await getClient(s, clientId)).toMatchObject({
      name: "3GA Marine",
      fiscalYearEndMonth: 12,
      fiscalYearEndDay: 31,
      industry: "manufacturing",
    });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "3ga marine" })).toMatchObject({
      fiscalYearEndFromProjects: false,
      industryFromProjects: false,
    });
  });

  it("the column read asks about at most 25 companies and requires an internal user", async () => {
    const s = await setup();
    const keys = Array.from({ length: 26 }, (_, index) => `company ${index}`);
    await expect(s.writer.query(api.clients.listCompanyYearEnds, { keys })).rejects.toMatchObject({
      data: { code: "INVALID_INPUT", message: "Ask for at most 25 companies at a time." },
    });
    await expect(s.writer.query(api.clients.listCompanyYearEnds, { keys: keys.slice(0, 25) })).resolves.toEqual([]);
    await expect(s.t.query(api.clients.listCompanyYearEnds, { keys: ["acme"] })).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    await expect(s.roleless.query(api.clients.listCompanyYearEnds, { keys: ["acme"] })).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
  });
});
