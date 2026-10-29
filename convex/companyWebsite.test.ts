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
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { WEBSITE_READ_EXPIRY_MS, WEBSITE_READ_RATE_LIMITED } from "./companyWebsite";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
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

/**
 * Finishes the company's latest scheduled read with `result`, with exactly
 * the arguments the save scheduled (so who saved it reaches the file).
 */
async function finishRead(s: Setup, clientId: Id<"clients">, result: { ok: true; text: string } | { ok: false; reason: string }) {
  const jobs = (await scheduledReads(s)).filter((job) => (job.args[0] as { clientId: string }).clientId === clientId);
  const job = jobs.at(-1);
  if (!job) throw new Error("no read was asked for");
  const args = job.args[0] as { clientId: Id<"clients">; url: string; requestedAt: number; userId: Id<"users"> };
  await s.t.mutation(internal.companyWebsite.finishWebsiteRead, {
    ...args,
    result: result.ok ? { ok: true, text: result.text, title: "Hatch Better", pages: [args.url] } : result,
  });
}

async function expiries(s: Setup) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) => job.name.includes("expireWebsiteRead"))
  );
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

  it.each([
    ["a finished read", { ok: true as const, text: "We build incubators." }],
    ["a failed read", { ok: false as const, reason: "it could not be reached." }],
  ])("%s does not move the company's last change, so an open dialog still saves", async (_label, result) => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    const dialog = await opened(s, "hatch better");
    const before = (await client(s, made.clientId))!.updatedAt;
    await finishRead(s, made.clientId, result);
    expect((await client(s, made.clientId))!.updatedAt).toBe(before);
    await expect(
      s.manager.mutation(api.clients.updateCompany, { ...dialog, website: "hatchbetter.com", industry: "manufacturing" })
    ).resolves.toMatchObject({ key: "hatch better" });
  });

  it("an absent website leaves it as it is; an empty one removes it", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    // An older tab that sends no website at all.
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), industry: "software" });
    expect(await client(s, made.clientId)).toMatchObject({ website: "https://hatchbetter.com", industry: "software" });
    expect(await scheduledReads(s)).toHaveLength(1);
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "", industry: "software" });
    expect((await client(s, made.clientId))?.website).toBeUndefined();
  });

  it("refuses a port other than the usual one with its own words", async () => {
    const s = await setup();
    await expect(
      s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com:8080" })
    ).rejects.toMatchObject({
      data: { code: "INVALID_INPUT", message: "Enter the website without a port number, like hatchbetter.com." },
    });
  });

  it("each person asks for at most 20 reads an hour; past it the read fails plainly and the save stands", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better" });
    for (let i = 0; i < 20; i++) {
      await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: `hatch${i}.com` });
    }
    expect(await scheduledReads(s)).toHaveLength(20);
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "hatch-last.com" });
    expect(await client(s, made.clientId)).toMatchObject({
      website: "https://hatch-last.com",
      websiteRead: { status: "failed", reason: WEBSITE_READ_RATE_LIMITED },
    });
    expect(await scheduledReads(s)).toHaveLength(20);
    // Another person still has their own reads.
    await s.writer.mutation(api.clients.createClient, { name: "Other Co", website: "other.com" });
    expect(await scheduledReads(s)).toHaveLength(21);
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
      // Who saved the website, carried from the save through the read.
      uploadedBy: s.writerId,
      uploaderRole: "writer",
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

  it("a failed read of a new address archives the old address's file, so it stops feeding drafts", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Wrong Co", website: "wrongco.com" });
    await finishRead(s, made.clientId, { ok: true, text: "The wrong company's site." });
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "wrong co")), website: "rightco.ca" });
    // Until the new read finishes, the old file stays.
    expect((await companyFiles(s, made.clientId))[0]).toMatchObject({ fileName: "Website: wrongco.com" });
    expect((await companyFiles(s, made.clientId))[0]!.archived).toBeUndefined();
    await finishRead(s, made.clientId, { ok: false, reason: "it could not be reached." });
    expect((await companyFiles(s, made.clientId))[0]).toMatchObject({ fileName: "Website: wrongco.com", archived: true });
    const row = await client(s, made.clientId);
    expect(row?.websiteFileId).toBeUndefined();
    expect(row?.websiteRead).toMatchObject({ url: "https://rightco.ca", status: "failed" });
    expect((await events(s, made.clientId)).at(-1)).toEqual(["archive", "Website: wrongco.com"]);
  });

  it("a read still not finished after two minutes fails as unreachable, archiving the old address's file", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "Old text." });
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "hatchbetter.ca" });
    const checks = await expiries(s);
    expect(checks).toHaveLength(2);
    const latest = checks.at(-1)!;
    expect(latest.scheduledTime - latest._creationTime).toBeGreaterThanOrEqual(WEBSITE_READ_EXPIRY_MS - 1_000);
    const args = latest.args[0] as { clientId: Id<"clients">; requestedAt: number; userId: Id<"users"> };
    // The read never came back.
    await s.t.mutation(internal.companyWebsite.expireWebsiteRead, args);
    expect(await client(s, made.clientId)).toMatchObject({
      websiteRead: { url: "https://hatchbetter.ca", status: "failed", reason: "it could not be reached." },
    });
    expect((await companyFiles(s, made.clientId))[0]).toMatchObject({ archived: true });
    // The first read's check, long finished, changes nothing.
    await s.t.mutation(internal.companyWebsite.expireWebsiteRead, checks[0]!.args[0] as typeof args);
    expect((await client(s, made.clientId))?.websiteRead).toMatchObject({ status: "failed", url: "https://hatchbetter.ca" });
  });

  it("a read that finished before its check is left alone", async () => {
    const s = await setup();
    const made = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better", website: "hatchbetter.com" });
    await finishRead(s, made.clientId, { ok: true, text: "Text." });
    await s.t.mutation(internal.companyWebsite.expireWebsiteRead, (await expiries(s))[0]!.args[0] as never);
    expect(await client(s, made.clientId)).toMatchObject({ websiteRead: { status: "read" } });
    expect((await companyFiles(s, made.clientId))[0]!.archived).toBeUndefined();
  });

  it("a merge archives the merged company's website file, since its website does not come along", async () => {
    const s = await setup();
    const kept = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better" });
    const merged = await s.writer.mutation(api.clients.createClient, { name: "Hatch Better Inc", website: "hatchbetterinc.com" });
    await finishRead(s, merged.clientId, { ok: true, text: "Inc site." });
    await s.manager.mutation(api.clients.mergeClients, { keepKey: "hatch better", mergeKeys: ["hatch better inc"] });
    const files = await companyFiles(s, kept.clientId);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ fileName: "Website: hatchbetterinc.com", archived: true });
    expect((await events(s, kept.clientId)).at(-1)).toEqual(["archive", "Website: hatchbetterinc.com"]);
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
    await s.manager.mutation(api.clients.updateCompany, { ...(await opened(s, "hatch better")), website: "" });
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
