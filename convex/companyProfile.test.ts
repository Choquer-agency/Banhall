/// <reference types="vite/client" />
/**
 * The company profile (2026-11-04, docs/product-domain.md "The company
 * profile"): the page read's new fields (Client since, the people on the
 * company, the summary, the record), the Overview projects table
 * (`companyProjects.listCompanyProjects`: roles, bounds, search, filters,
 * sort and pages), the company summary (Managers and Admins only, drafted
 * once per read while no person wrote one, never over a person's text) and
 * Read again (Managers and Admins, the hourly limit, a failed re-read
 * keeping the file). The AI call itself is `ai/companySummary.sdk.test.ts`.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { COMPANY_PROJECTS_READ } from "./companyProjects";
import { MAX_COMPANY_SUMMARY_CHARS } from "../shared/companySummary";

const modules = import.meta.glob("./**/*.ts");

const JAN_2025 = Date.parse("2025-01-14T12:00:00Z");
const MAR_2025 = Date.parse("2025-03-02T12:00:00Z");
const OCT_2026 = Date.parse("2026-10-14T12:00:00Z");

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "cp-writer", role: "writer", firstName: "Priya", lastName: "Nair" });
    const managerId = await ctx.db.insert("users", { authId: "cp-manager", role: "manager", firstName: "Jordan", lastName: "Ellis" });
    const adminId = await ctx.db.insert("users", { authId: "cp-admin", role: "admin", firstName: "Sam", lastName: "Okafor" });
    await ctx.db.insert("users", { authId: "cp-roleless", firstName: "No", lastName: "Role" });
    return { writerId, managerId, adminId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cp-writer" }),
    manager: t.withIdentity({ subject: "cp-manager" }),
    admin: t.withIdentity({ subject: "cp-admin" }),
    roleless: t.withIdentity({ subject: "cp-roleless" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

let projectSeq = 0;
async function addProject(
  s: Setup,
  clientName: string,
  overrides: Partial<{
    title: string;
    createdAt: number;
    updatedAt: number;
    ownerId: Id<"users">;
    workflowStage: "intake" | "drafting" | "internal_review" | "client_review" | "delivered" | "on_hold";
    fiscalYearEnd: number;
    projectNumber: string;
    deletionStartedAt: number;
    clientId: Id<"clients">;
  }> = {}
) {
  projectSeq += 1;
  return await s.t.run(async (ctx) =>
    ctx.db.insert("projects", {
      title: overrides.title ?? `Project ${projectSeq}`,
      clientName,
      dashboardCompanyKey: dashboardCompanyKey(clientName),
      status: "draft",
      createdBy: s.writerId,
      ownerId: overrides.ownerId ?? s.writerId,
      shareToken: `cp-token-${projectSeq}`,
      createdAt: overrides.createdAt ?? OCT_2026,
      updatedAt: overrides.updatedAt ?? overrides.createdAt ?? OCT_2026,
      ...(overrides.workflowStage ? { workflowStage: overrides.workflowStage } : {}),
      ...(overrides.fiscalYearEnd !== undefined ? { fiscalYearEnd: overrides.fiscalYearEnd } : {}),
      ...(overrides.projectNumber ? { projectNumber: overrides.projectNumber } : {}),
      ...(overrides.deletionStartedAt !== undefined ? { deletionStartedAt: overrides.deletionStartedAt } : {}),
      ...(overrides.clientId ? { clientId: overrides.clientId } : {}),
    })
  );
}

async function addClient(s: Setup, name: string, extra: Record<string, unknown> = {}) {
  return await s.t.run(async (ctx) =>
    ctx.db.insert("clients", {
      name,
      nameKey: dashboardCompanyKey(name),
      status: "active",
      createdBy: s.managerId,
      createdAt: MAR_2025,
      updatedAt: MAR_2025,
      ...extra,
    })
  );
}

async function companyPage(s: Setup, key: string) {
  const page = await s.writer.query(api.clients.getCompanyPage, { key });
  if (page.kind !== "company") throw new Error(`not a company: ${page.kind}`);
  return page;
}

const fy = (year: number) => Date.parse(`${year}-09-30T00:00:00Z`);

describe("the company page read (2026-11-04)", () => {
  it("Client since is the earliest live project's creation; a project being deleted does not count", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { createdAt: OCT_2026 });
    await addProject(s, "Cedarline Systems", { createdAt: Date.parse("2024-06-01T00:00:00Z"), deletionStartedAt: OCT_2026 });
    await addProject(s, "Cedarline Systems", { createdAt: JAN_2025 });
    expect((await companyPage(s, "cedarline systems")).clientSince).toBe(JAN_2025);
  });

  it("Client since falls back to the company row's createdAt, and is null for neither", async () => {
    const s = await setup();
    await addClient(s, "Northlake Foods");
    expect((await companyPage(s, "northlake foods")).clientSince).toBe(MAR_2025);
    // A name-only company (no row) whose only project is being deleted: none.
    await addProject(s, "Harbourview Robotics", { createdAt: JAN_2025, deletionStartedAt: OCT_2026 });
    await s.t.run(async (ctx) =>
      ctx.db.insert("dashboardCompanies", {
        companyKey: "harbourview robotics",
        clientName: "Harbourview Robotics",
        projectCount: 1,
        updatedAt: OCT_2026,
      })
    );
    expect((await companyPage(s, "harbourview robotics")).clientSince).toBeNull();
  });

  it("the people on this company are the distinct owners of its live projects, newest first, with initials", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { ownerId: s.adminId, createdAt: JAN_2025 });
    await addProject(s, "Cedarline Systems", { ownerId: s.writerId, createdAt: MAR_2025 });
    await addProject(s, "Cedarline Systems", { ownerId: s.managerId, createdAt: OCT_2026 });
    await addProject(s, "Cedarline Systems", { ownerId: s.writerId, createdAt: OCT_2026 });
    await addProject(s, "Cedarline Systems", { ownerId: s.adminId, title: "Going", deletionStartedAt: OCT_2026, createdAt: OCT_2026 + 1 });
    const { team } = await companyPage(s, "cedarline systems");
    expect(team.map((member) => [member.name, member.initials])).toEqual([
      ["Priya Nair", "PN"],
      ["Jordan Ellis", "JE"],
      ["Sam Okafor", "SO"],
    ]);
  });

  it("reads at most the newest 50 projects for the team", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { ownerId: s.adminId });
    for (let index = 0; index < 50; index += 1) await addProject(s, "Cedarline Systems", { ownerId: s.writerId });
    const { team } = await companyPage(s, "cedarline systems");
    expect(team.map((member) => member.name)).toEqual(["Priya Nair"]);
  });

  it("gives who added the company, its last change and the names merged into it with their dates", async () => {
    const s = await setup();
    const clientId = await addClient(s, "Cedarline Systems", {
      formerNames: ["Cedarline Systems Inc", "Cedar Line"],
      updatedAt: OCT_2026,
    });
    await s.t.run(async (ctx) =>
      ctx.db.insert("clients", {
        name: "Cedarline Systems Inc",
        nameKey: "cedarline systems inc",
        status: "merged",
        mergedIntoClientId: clientId,
        mergedAt: Date.parse("2026-10-19T12:00:00Z"),
        createdBy: s.managerId,
        createdAt: JAN_2025,
        updatedAt: Date.parse("2026-10-19T12:00:00Z"),
      })
    );
    const page = await companyPage(s, "cedarline systems");
    expect(page.createdByName).toBe("Jordan Ellis");
    expect(page.updatedAt).toBe(OCT_2026);
    expect(page.formerNames).toEqual([
      { name: "Cedarline Systems Inc", mergedAt: Date.parse("2026-10-19T12:00:00Z") },
      { name: "Cedar Line" },
    ]);
    expect(page.summary).toBeNull();
  });
});

describe("the Overview projects table (companyProjects.listCompanyProjects)", () => {
  async function seedTable(s: Setup) {
    await addClient(s, "Cedarline Systems");
    const rows: Array<[string, string, number, Id<"users">, "drafting" | "delivered" | "client_review", number | undefined]> = [];
    for (let index = 1; index <= 24; index += 1) {
      const stage = index % 3 === 0 ? "delivered" : index % 3 === 1 ? "drafting" : "client_review";
      const owner = index % 2 === 0 ? s.managerId : s.writerId;
      const year = index <= 10 ? 2026 : index <= 20 ? 2025 : undefined;
      rows.push([`Project ${String(index).padStart(2, "0")}`, String(index), OCT_2026 - index * 86_400_000, owner, stage, year]);
    }
    for (const [title, projectNumber, updatedAt, ownerId, workflowStage, year] of rows) {
      await addProject(s, "Cedarline Systems", {
        title,
        projectNumber,
        updatedAt,
        ownerId,
        workflowStage,
        ...(year !== undefined ? { fiscalYearEnd: fy(year) } : {}),
      });
    }
  }

  it("refuses someone signed out or with no role; every internal role reads it", async () => {
    const s = await setup();
    await seedTable(s);
    await expect(s.t.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" })).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    await expect(s.roleless.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" })).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    for (const viewer of [s.writer, s.manager, s.admin]) {
      expect((await viewer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" })).total).toBe(24);
    }
  });

  it("shows 10 a page, last updated first, with the page count, and reads the last page for one past it", async () => {
    const s = await setup();
    await seedTable(s);
    const first = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" });
    expect(first).toMatchObject({ total: 24, all: 24, page: 1, pageCount: 3, pageSize: 10, truncated: false });
    expect(first.rows.map((row) => row.projectNumber)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(first.rows[0]).toMatchObject({ title: "Project 01", stage: "drafting", fiscalYear: 2026, ownerName: "Priya Nair" });
    const third = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", page: 3 });
    expect(third.rows.map((row) => row.projectNumber)).toEqual(["21", "22", "23", "24"]);
    expect(third.rows[0]!.fiscalYear).toBeNull();
    const past = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", page: 9 });
    expect(past.page).toBe(3);
  });

  it("filters by stage, fiscal year (or none) and owner, and lists only the values present", async () => {
    const s = await setup();
    await seedTable(s);
    const all = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" });
    expect(all.options).toEqual({
      stages: ["drafting", "client_review", "delivered"],
      fiscalYears: [2026, 2025],
      noFiscalYear: true,
      owners: [
        { id: s.managerId, name: "Jordan Ellis" },
        { id: s.writerId, name: "Priya Nair" },
      ],
    });
    const delivered = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", stage: "delivered" });
    expect(delivered.total).toBe(8);
    expect(delivered.rows.every((row) => row.stage === "delivered")).toBe(true);
    const fy2025 = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", fiscalYear: 2025 });
    expect(fy2025.total).toBe(10);
    const none = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", fiscalYear: null });
    expect(none.rows.map((row) => row.projectNumber)).toEqual(["21", "22", "23", "24"]);
    const jordan2026 = await s.writer.query(api.companyProjects.listCompanyProjects, {
      companyKey: "cedarline systems",
      ownerId: s.managerId,
      fiscalYear: 2026,
    });
    expect(jordan2026.rows.map((row) => row.projectNumber)).toEqual(["2", "4", "6", "8", "10"]);
    // The filters' lists stay whole while a filter is on.
    expect(jordan2026.options.fiscalYears).toEqual([2026, 2025]);
  });

  it("searches the title, the number and the owner, ignoring case and accents", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { title: "Défrost cycle prediction", projectNumber: "3" });
    await addProject(s, "Cedarline Systems", { title: "Pump control", projectNumber: "12", ownerId: s.managerId });
    const byTitle = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", search: "DEFROST" });
    expect(byTitle.rows.map((row) => row.title)).toEqual(["Défrost cycle prediction"]);
    const byNumber = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", search: "#12" });
    expect(byNumber.rows.map((row) => row.title)).toEqual(["Pump control"]);
    const byOwner = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", search: "jordan" });
    expect(byOwner.rows.map((row) => row.title)).toEqual(["Pump control"]);
    expect(byOwner.all).toBe(2);
  });

  it("sorts by name or number when asked", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { title: "Bravo", projectNumber: "10", updatedAt: OCT_2026 });
    await addProject(s, "Cedarline Systems", { title: "alpha", projectNumber: "B", updatedAt: OCT_2026 - 1 });
    await addProject(s, "Cedarline Systems", { title: "Charlie", projectNumber: "2", updatedAt: OCT_2026 - 2 });
    const byTitle = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", sort: "title" });
    expect(byTitle.rows.map((row) => row.title)).toEqual(["alpha", "Bravo", "Charlie"]);
    const byNumber = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", sort: "number" });
    expect(byNumber.rows.map((row) => row.projectNumber)).toEqual(["2", "10", "B"]);
  });

  it("leaves out projects being deleted and other companies' projects; the no-company bucket has none", async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await addProject(s, "Cedarline Systems", { title: "Kept" });
    await addProject(s, "Cedarline Systems", { title: "Going", deletionStartedAt: OCT_2026 });
    await addProject(s, "Northlake Foods", { title: "Elsewhere" });
    const result = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" });
    expect(result.rows.map((row) => row.title)).toEqual(["Kept"]);
    const unnamed = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "￿" });
    expect(unnamed).toMatchObject({ total: 0, rows: [] });
  });

  it(`reads at most ${COMPANY_PROJECTS_READ} projects, newest first, and says when there are more`, async () => {
    const s = await setup();
    await addClient(s, "Cedarline Systems");
    await s.t.run(async (ctx) => {
      for (let index = 0; index <= COMPANY_PROJECTS_READ; index += 1) {
        await ctx.db.insert("projects", {
          title: `Bulk ${index}`,
          clientName: "Cedarline Systems",
          dashboardCompanyKey: "cedarline systems",
          status: "draft",
          createdBy: s.writerId,
          ownerId: s.writerId,
          shareToken: `bulk-${index}`,
          createdAt: OCT_2026,
          updatedAt: OCT_2026,
        });
      }
    });
    const result = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems", search: "bulk 0" });
    // The oldest (Bulk 0) is past the bound, so the search does not find it.
    expect(result.rows).toEqual([]);
    const all = await s.writer.query(api.companyProjects.listCompanyProjects, { companyKey: "cedarline systems" });
    expect(all).toMatchObject({ all: COMPANY_PROJECTS_READ, truncated: true });
  });
});

describe("the company summary", () => {
  it("only Managers and Admins write it; a Consultant or someone with no role is refused", async () => {
    const s = await setup();
    const clientId = await addClient(s, "Cedarline Systems");
    for (const viewer of [s.writer, s.roleless]) {
      await expect(viewer.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Makes things." })).rejects.toMatchObject({
        data: { code: "NOT_AUTHORIZED" },
      });
    }
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "  Cedarline builds controls for cold storage.  " });
    expect((await companyPage(s, "cedarline systems")).summary).toMatchObject({
      text: "Cedarline builds controls for cold storage.",
      editedByName: "Jordan Ellis",
    });
    await s.admin.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Cedarline builds refrigeration controls." });
    expect((await companyPage(s, "cedarline systems")).summary).toMatchObject({ editedByName: "Sam Okafor" });
  });

  it("refuses a summary over the limit, and empty text removes it", async () => {
    const s = await setup();
    const clientId = await addClient(s, "Cedarline Systems");
    await expect(
      s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "a".repeat(MAX_COMPANY_SUMMARY_CHARS + 1) })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Makes controls." });
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "   " });
    expect((await companyPage(s, "cedarline systems")).summary).toBeNull();
  });

  it("does not move the company's last change, so an open Edit company dialog still saves", async () => {
    const s = await setup();
    const clientId = await addClient(s, "Cedarline Systems");
    const before = await companyPage(s, "cedarline systems");
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Makes controls." });
    expect((await companyPage(s, "cedarline systems")).clientUpdatedAt).toBe(before.clientUpdatedAt);
  });

  async function websiteCompany(s: Setup) {
    const made = await s.writer.mutation(api.clients.createClient, { name: "Quillmere Analytics", website: "quillmere.com" });
    return made.clientId;
  }

  async function finishRead(s: Setup, clientId: Id<"clients">, result: { ok: true; text: string } | { ok: false; reason: string }) {
    const job = (await scheduled(s, "companyWebsiteNode")).filter((entry) => (entry.args[0] as { clientId: string }).clientId === clientId).at(-1);
    if (!job) throw new Error("no read");
    const args = job.args[0] as { clientId: Id<"clients">; url: string; requestedAt: number; userId: Id<"users"> };
    await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
      ...args,
      result: result.ok ? { ok: true, text: result.text, title: null, pages: [args.url] } : result,
    });
    return args;
  }

  async function scheduled(s: Setup, name: string) {
    return await s.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes(name))
    );
  }

  it("a website read that saves its text asks for one summary draft from that file", async () => {
    const s = await setup();
    const clientId = await websiteCompany(s);
    const read = await finishRead(s, clientId, { ok: true, text: "Quillmere Analytics builds lab software." });
    const drafts = await scheduled(s, "companySummary:draftCompanySummary");
    expect(drafts).toHaveLength(1);
    const client = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(drafts[0]!.args[0]).toEqual({
      clientId,
      companyFileId: client!.websiteFileId,
      url: "https://quillmere.com",
      requestedAt: read.requestedAt,
      userId: s.writerId,
    });
    // A failed read asks for none.
    const other = await s.writer.mutation(api.clients.createClient, { name: "Boreal Hydraulics", website: "boreal.ca" });
    await finishRead(s, other.clientId, { ok: false, reason: "it could not be reached." });
    expect(await scheduled(s, "companySummary:draftCompanySummary")).toHaveLength(1);
  });

  it("asks for no draft when a person wrote the summary, and a draft saved later never replaces their text", async () => {
    const s = await setup();
    const clientId = await websiteCompany(s);
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Our own words." });
    const read = await finishRead(s, clientId, { ok: true, text: "Quillmere Analytics builds lab software." });
    expect(await scheduled(s, "companySummary:draftCompanySummary")).toHaveLength(0);
    // A draft already under way when the person saved is dropped.
    const outcome = await s.t.mutation(internal.companySummary.saveDraftedSummary, {
      clientId,
      url: read.url,
      requestedAt: read.requestedAt,
      text: "AI words.",
    });
    expect(outcome).toBe("person");
    expect((await companyPage(s, "quillmere analytics")).summary).toMatchObject({ text: "Our own words.", editedByName: "Jordan Ellis" });
    // And the draft's input says there is nothing to draft.
    const client = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(
      await s.t.query(internal.companySummary.summaryInput, {
        clientId,
        companyFileId: client!.websiteFileId!,
        url: read.url,
        requestedAt: read.requestedAt,
      })
    ).toBeNull();
  });

  it("a draft replaces an earlier AI draft, keeps where it came from, and a person's edit keeps that too", async () => {
    const s = await setup();
    const clientId = await websiteCompany(s);
    const read = await finishRead(s, clientId, { ok: true, text: "Quillmere Analytics builds lab software." });
    await s.t.mutation(internal.companySummary.saveDraftedSummary, { clientId, url: read.url, requestedAt: read.requestedAt, text: "First." });
    await s.t.mutation(internal.companySummary.saveDraftedSummary, { clientId, url: read.url, requestedAt: read.requestedAt, text: " Second. " });
    expect((await companyPage(s, "quillmere analytics")).summary).toMatchObject({ text: "Second.", aiDraftedFrom: "https://quillmere.com" });
    expect((await companyPage(s, "quillmere analytics")).summary?.editedByName).toBeUndefined();
    await s.manager.mutation(api.companySummary.updateCompanySummary, { clientId, text: "Second, edited." });
    expect((await companyPage(s, "quillmere analytics")).summary).toMatchObject({
      text: "Second, edited.",
      aiDraftedFrom: "https://quillmere.com",
      editedByName: "Jordan Ellis",
    });
  });

  it("drops a draft from a read that is no longer the company's latest", async () => {
    const s = await setup();
    const clientId = await websiteCompany(s);
    const read = await finishRead(s, clientId, { ok: true, text: "Quillmere Analytics builds lab software." });
    await s.t.run(async (ctx) => ctx.db.patch(clientId, { websiteRead: { url: read.url, status: "reading", requestedAt: read.requestedAt + 1 } }));
    expect(
      await s.t.mutation(internal.companySummary.saveDraftedSummary, { clientId, url: read.url, requestedAt: read.requestedAt, text: "Late." })
    ).toBe("stale");
    expect((await companyPage(s, "quillmere analytics")).summary).toBeNull();
  });
});

describe("Read again", () => {
  async function readCompany(s: Setup) {
    const made = await s.writer.mutation(api.clients.createClient, { name: "Quillmere Analytics", website: "quillmere.com" });
    const job = (await reads(s)).at(-1)!;
    const args = job.args[0] as { clientId: Id<"clients">; url: string; requestedAt: number; userId: Id<"users"> };
    await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
      ...args,
      result: { ok: true, text: "We build lab software.", title: null, pages: [args.url] },
    });
    return made.clientId;
  }

  async function reads(s: Setup) {
    return await s.t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("companyWebsiteNode"))
    );
  }

  it("only Managers and Admins may read the website again", async () => {
    const s = await setup();
    const clientId = await readCompany(s);
    for (const viewer of [s.writer, s.roleless]) {
      await expect(viewer.mutation(api.companyWebsite.readWebsiteAgain, { clientId })).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    }
    await s.manager.mutation(api.companyWebsite.readWebsiteAgain, { clientId });
    const client = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(client!.websiteRead).toMatchObject({ url: "https://quillmere.com", status: "reading", again: true });
    expect(await reads(s)).toHaveLength(2);
    expect((await reads(s)).at(-1)!.args[0]).toMatchObject({ clientId, url: "https://quillmere.com", userId: s.managerId });
    // A read still running is not asked for twice.
    await s.admin.mutation(api.companyWebsite.readWebsiteAgain, { clientId });
    expect(await reads(s)).toHaveLength(2);
  });

  it("refuses a company with no website", async () => {
    const s = await setup();
    const clientId = await addClient(s, "Northlake Foods");
    await expect(s.manager.mutation(api.companyWebsite.readWebsiteAgain, { clientId })).rejects.toMatchObject({
      data: { code: "INVALID_INPUT" },
    });
  });

  it("a failed read again keeps the file the website was already read into", async () => {
    const s = await setup();
    const clientId = await readCompany(s);
    const fileId = (await s.t.run(async (ctx) => ctx.db.get(clientId)))!.websiteFileId!;
    await s.manager.mutation(api.companyWebsite.readWebsiteAgain, { clientId });
    const args = (await reads(s)).at(-1)!.args[0] as { clientId: Id<"clients">; url: string; requestedAt: number; userId: Id<"users"> };
    await s.t.mutation(internal.companyWebsite.finishWebsiteRead, { ...args, result: { ok: false, reason: "it could not be reached." } });
    const client = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(client!.websiteFileId).toBe(fileId);
    expect(client!.websiteRead).toMatchObject({ status: "failed", reason: "it could not be reached." });
    const file = await s.t.run(async (ctx) => ctx.db.get(fileId));
    expect(file!.archived).toBeUndefined();
  });

  it("text read again unchanged keeps the same file", async () => {
    const s = await setup();
    const clientId = await readCompany(s);
    const fileId = (await s.t.run(async (ctx) => ctx.db.get(clientId)))!.websiteFileId!;
    await s.manager.mutation(api.companyWebsite.readWebsiteAgain, { clientId });
    const args = (await reads(s)).at(-1)!.args[0] as { clientId: Id<"clients">; url: string; requestedAt: number; userId: Id<"users"> };
    await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
      ...args,
      result: { ok: true, text: "We build lab software.", title: null, pages: [args.url] },
    });
    const client = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(client!.websiteFileId).toBe(fileId);
    expect(client!.websiteRead).toMatchObject({ status: "read" });
  });

  it("past the hourly limit it is refused and the company is left as it is", async () => {
    const s = await setup();
    const clientId = await readCompany(s);
    // The manager's 20 reads an hour, spent on websites they saved.
    for (let index = 0; index < 20; index += 1) {
      await s.manager.mutation(api.clients.createClient, { name: `Spare ${index}`, website: `spare${index}.com` });
    }
    const before = await s.t.run(async (ctx) => ctx.db.get(clientId));
    await expect(s.manager.mutation(api.companyWebsite.readWebsiteAgain, { clientId })).rejects.toMatchObject({
      data: { code: "RATE_LIMITED" },
    });
    const after = await s.t.run(async (ctx) => ctx.db.get(clientId));
    expect(after!.websiteRead).toEqual(before!.websiteRead);
    expect(after!.websiteFileId).toBe(before!.websiteFileId);
  });
});
