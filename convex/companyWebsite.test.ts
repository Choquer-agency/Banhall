/// <reference types="vite/client" />
/**
 * The company website (owner, 2026-10-29): saved through New company and
 * Edit company (normalized, refused when unusable, the same roles and stale
 * check as the other fields), the read it schedules, and the company file a
 * finished read saves (replacing the old one, logged; a failed read kept as
 * a plain reason). The fetch itself is `lib/websiteRead.test.ts` and
 * `tests/companyWebsiteNode.test.ts`.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "web-writer", role: "writer", firstName: "Wendy", lastName: "Writer" });
    const managerId = await ctx.db.insert("users", { authId: "web-manager", role: "manager", firstName: "Mina", lastName: "Manager" });
    return { writerId, managerId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "web-writer" }),
    manager: t.withIdentity({ subject: "web-manager" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function client(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) => await ctx.db.get(clientId));
}

async function scheduledReads(s: Setup) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      job.name.includes("companyWebsiteNode")
    )
  );
}

async function companyFiles(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) =>
    ctx.db
      .query("companyFiles")
      .withIndex("by_clientId_and_archived", (q) => q.eq("clientId", clientId))
      .collect()
  );
}

async function events(s: Setup, clientId: Id<"clients">) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.query("companyFileEvents").withIndex("by_clientId_and_at", (q) => q.eq("clientId", clientId)).collect()).map(
      (event) => [event.action, event.fileName]
    )
  );
}

/** Edit company's args as a dialog opened now would send them. */
async function opened(s: Setup, key: string) {
  const page = await s.manager.query(api.clients.getCompanyPage, { key });
  if (page.kind !== "company") throw new Error("not a company");
  return { key, expectedName: page.name, expectedClientId: page.clientId, expectedUpdatedAt: page.clientUpdatedAt, name: page.name };
}

/** Finishes the latest read the company asked for with `result`. */
async function finishRead(s: Setup, clientId: Id<"clients">, result: { ok: true; text: string } | { ok: false; reason: string }) {
  const row = await client(s, clientId);
  if (!row?.website || !row.websiteRead) throw new Error("no read was asked for");
  await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
    clientId,
    url: row.website,
    requestedAt: row.websiteRead.requestedAt,
    userId: s.managerId,
    result: result.ok ? { ok: true, text: result.text, title: "Hatch Better", pages: [row.website] } : result,
  });
}

describe("saving a website", () => {
  it("New company stores it normalized and asks for a read; anyone who may create projects may add it", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: " HatchBetter.com/ " });
    expect(await client(s, made.clientId)).toMatchObject({
      website: "https://hatchbetter.com",
      websiteRead: { url: "https://hatchbetter.com", status: "reading" },
    });
    const reads = await scheduledReads(s);
    expect(reads).toHaveLength(1);
    expect(reads[0]!.args[0]).toMatchObject({ clientId: made.clientId, url: "https://hatchbetter.com", userId: s.writerId });
    // The page shows it and the read under way.
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "hatch better" })).toMatchObject({
      website: "https://hatchbetter.com",
      websiteRead: { status: "reading" },
    });
  });

  it("refuses a website that cannot be used, with a plain message, and saves nothing", async () => {
    const s = await setup();
    for (const website of ["not a website", "localhost", "ftp://hatchbetter.com"]) {
      await expect(s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website })).rejects.toMatchObject({
        data: { code: "INVALID_INPUT", message: "Enter a website like hatchbetter.com." },
      });
    }
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "  " });
    expect((await client(s, made.clientId))?.website).toBeUndefined();
    expect(await scheduledReads(s)).toEqual([]);
  });

  it("Edit company changes it (Managers and Admins only) through the same stale check", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better" });
    const before = await opened(s, "hatch better");
    await expect(
      s.writer.mutation(api.clients.updateCompany, { ...before, website: "hatchbetter.com" })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await s.manager.mutation(api.clients.updateCompany, { ...before, website: "hatchbetter.com" });
    expect(await client(s, made.clientId)).toMatchObject({ website: "https://hatchbetter.com", websiteRead: { status: "reading" } });
    // A dialog opened before that change is refused.
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...before, website: "other.com" })
    ).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
    // An unchanged website asks for no new read.
    const now = await opened(s, "hatch better");
    await s.manager.mutation(api.clients.updateCompany, { ...now, website: "https://hatchbetter.com", industry: "software" });
    expect(await scheduledReads(s)).toHaveLength(1);
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "nope" })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT", message: "Enter a website like hatchbetter.com." } });
  });

  it("a finished read does not move the company's last change, so an open dialog still saves", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    const dialog = await opened(s, "hatch better");
    await finishRead(s, made.clientId, { ok: true, text: "We build incubators." });
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...dialog, website: "hatchbetter.com", industry: "manufacturing" })
    ).resolves.toMatchObject({ key: "hatch better" });
  });
});

describe("a finished read", () => {
  it("saves the text as a company file named for the site, logged as an add", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "# Hatch Better\nWe build incubators for poultry farms." });
    const files = await companyFiles(s, made.clientId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      fileName: "Website: hatchbetter.com",
      fileType: "txt",
      category: "background",
      processingStatus: "ready",
      hasText: true,
      uploadedBy: s.managerId,
      searchPiecesDue: true,
    });
    expect(files[0]!.archived).toBeUndefined();
    expect(await client(s, made.clientId)).toMatchObject({
      websiteRead: { status: "read", url: "https://hatchbetter.com" },
      websiteFileId: files[0]!._id,
    });
    expect(await events(s, made.clientId)).toEqual([["add", "Website: hatchbetter.com"]]);
    // The Files tab lists it with its text.
    const listed = await s.writer.query(api.companyFiles.listCompanyFiles, { clientId: made.clientId });
    expect(listed.files.map((file) => file.fileName)).toEqual(["Website: hatchbetter.com"]);
  });

  it("a new website replaces the old website file, archiving it", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "Old site text." });
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "hatchbetter.ca" });
    expect(await scheduledReads(s)).toHaveLength(2);
    await finishRead(s, made.clientId, { ok: true, text: "New site text." });
    const files = await companyFiles(s, made.clientId);
    const byName = Object.fromEntries(files.map((file) => [file.fileName, file.archived === true]));
    expect(byName).toEqual({ "Website: hatchbetter.com": true, "Website: hatchbetter.ca": false });
    expect(await events(s, made.clientId)).toEqual([
      ["add", "Website: hatchbetter.com"],
      ["add", "Website: hatchbetter.ca"],
      ["archive", "Website: hatchbetter.com"],
    ]);
  });

  it("the same text read again keeps the file it already has", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "Same text." });
    await s.t.run(async (ctx) => {
      await ctx.db.patch(made.clientId, { websiteRead: { url: "https://hatchbetter.com", status: "reading", requestedAt: 99 } });
    });
    await finishRead(s, made.clientId, { ok: true, text: "Same text." });
    expect(await companyFiles(s, made.clientId)).toHaveLength(1);
  });

  it("a failed read keeps a plain reason and no file, and the save it followed stands", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: false, reason: "it did not answer within 10 seconds." });
    expect(await companyFiles(s, made.clientId)).toEqual([]);
    expect(await client(s, made.clientId)).toMatchObject({
      website: "https://hatchbetter.com",
      websiteRead: { status: "failed", reason: "it did not answer within 10 seconds." },
    });
    expect(await s.writer.query(api.clients.getCompanyPage, { key: "hatch better" })).toMatchObject({
      websiteRead: { status: "failed", reason: "it did not answer within 10 seconds." },
    });
  });

  it("drops a read that is no longer the company's latest", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    const first = (await client(s, made.clientId))!.websiteRead!;
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "hatchbetter.ca" });
    // The read of the old address finishes late.
    await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
      clientId: made.clientId,
      url: "https://hatchbetter.com",
      requestedAt: first.requestedAt,
      userId: s.managerId,
      result: { ok: true, text: "Old.", title: null, pages: [] },
    });
    expect(await companyFiles(s, made.clientId)).toEqual([]);
    expect(await client(s, made.clientId)).toMatchObject({ websiteRead: { url: "https://hatchbetter.ca", status: "reading" } });
  });

  it("removing the website archives its file and clears the read", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "Site text." });
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")) });
    const row = await client(s, made.clientId);
    expect(row?.website).toBeUndefined();
    expect(row?.websiteRead).toBeUndefined();
    expect(row?.websiteFileId).toBeUndefined();
    expect((await companyFiles(s, made.clientId))[0]).toMatchObject({ archived: true });
    expect((await events(s, made.clientId)).at(-1)).toEqual(["archive", "Website: hatchbetter.com"]);
  });

  it("a company known only by its projects gets its row with the website", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("dashboardCompanies", { companyKey: dashboardCompanyKey("Birch Foods"), clientName: "Birch Foods", projectCount: 1, updatedAt: 1 });
    });
    const saved = await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "birch foods")), website: "birchfoods.ca" });
    expect(await client(s, saved.clientId)).toMatchObject({ website: "https://birchfoods.ca", websiteRead: { status: "reading" } });
  });
});
