/// <reference types="vite/client" />
// Send back to review and edit after approval on Import (2026-11-17,
// docs/product-domain.md, the fifth entry of that day). Every company and
// person here is made up. No embedding runs: the embed pool's enqueue is
// stubbed and counted, and fetch refuses, so nothing reaches Voyage.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ConvexError } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import { addShare, countShareOf, countsOf, emptyImportCounts } from "./lib/importCompanyCounts";
import type { ImportCounts } from "./lib/ingestionSheetValidators";
import { pathFieldsFor } from "./lib/ingestionSheet";
import { patchBrainSource } from "./ai/brain/rag";
import { NOT_APPROVED_ANY_MORE, SEND_BACK_BRAIN_REASON, SEND_BACK_READ_BUDGET, WRITER_CHECK_INCOMPLETE } from "./ingestion";
import schema from "./schema";
import workpoolSchema from "../node_modules/@convex-dev/workpool/src/component/schema.js";

const modules = import.meta.glob("./**/*.ts");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/src/component/**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Admin = ReturnType<T["withIdentity"]>;

let enqueue: MockInstance;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("VOYAGE_API_KEY", "test-voyage-key");
  vi.stubGlobal("fetch", vi.fn(async () => {
    throw new Error("No network in these tests");
  }));
  enqueue = vi.spyOn(Workpool.prototype, "enqueueAction").mockResolvedValue("work-1" as never);
});
afterEach(() => {
  enqueue.mockRestore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/** The Brain sources an embed was queued for, in order. */
const embedsQueued = () => enqueue.mock.calls.map((call) => (call[2] as { sourceId: string }).sourceId);

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", { authId: "back-admin", role: "admin", firstName: "Jordan", lastName: "Ellis" }),
    writerUserId: await ctx.db.insert("users", { authId: "back-writer", role: "writer", firstName: "Sam" }),
    managerId: await ctx.db.insert("users", { authId: "back-manager", role: "manager", firstName: "Lee" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "back-admin" }),
    writer: t.withIdentity({ subject: "back-writer" }),
    manager: t.withIdentity({ subject: "back-manager" }),
  };
}

const CEDARLINE = "Cedarline Systems";
const FY = `${CEDARLINE}/2025 - Mar 31`;
const PD = `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift.docx`;
const PD_TEXT = [
  "Prepared by Dana Whitlock",
  "Cedarline Systems built a cold chain sensor that drifts less in freezers.",
  "Field of science or technology: 2.02.09",
  "We tested the sensor at minus 30 degrees for six weeks.",
].join("\n");

async function stage(t: T, path: string, contentHash = `bytes-${path}`): Promise<Id<"ingestionItems">> {
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  const driveItemId = `drive-${path}`;
  const id = await t.mutation(internal.ingestion.upsertDiscoveredItem, {
    driveItemId,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash,
    pairGroupKey: meta.pairGroupKey,
  });
  if (id) return id;
  const row = await t.run((ctx) =>
    ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique()
  );
  return row!._id;
}

async function read(t: T, id: Id<"ingestionItems">, text: string, scienceCode?: string) {
  const { storageId, textStorageId } = await t.run(async (ctx) => ({
    storageId: await ctx.storage.store(new Blob(["original bytes"])),
    textStorageId: await ctx.storage.store(new Blob([text], { type: "text/plain" })),
  }));
  await t.mutation(internal.ingestion.markItemProcessed, {
    itemId: id,
    storageId,
    text: text.slice(0, 8000),
    textStorageId,
    ...(scienceCode ? { documentScienceCode: scienceCode } : {}),
  });
}

async function stageRead(t: T, path: string, text: string, scienceCode?: string, contentHash?: string) {
  const id = await stage(t, path, contentHash);
  await read(t, id, text, scienceCode);
  return id;
}

const readyPd = (t: T, path = PD, text = PD_TEXT, contentHash?: string) => stageRead(t, path, text, "2.02.09", contentHash);

async function item(t: T, id: Id<"ingestionItems">): Promise<Doc<"ingestionItems">> {
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("item missing");
  return row;
}

async function pickIndustry(admin: Admin, companyKey = "cedarline systems", industry = "manufacturing") {
  await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey, industry });
}

async function approve(t: T, admin: Admin, ids: Id<"ingestionItems">[]) {
  const { approvalId } = await admin.mutation(api.ingestion.approveFiles, { ids });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return approvalId;
}

/** Approved, then its Brain copy read and added, as a person does on Brain check. */
async function inBrain(t: T, admin: Admin, id: Id<"ingestionItems">): Promise<Id<"brainSources">> {
  if ((await item(t, id)).status !== "approved") await approve(t, admin, [id]);
  const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: id, alsoRemove: [] });
  if (!preview.ok) throw new Error(`no preview: ${preview.reason}`);
  const added = await admin.action(api.ingestion.addToBrain, { itemId: id, alsoRemove: [], seen: preview.seen });
  if (!added.ok) throw new Error(`not added: ${added.reason}`);
  return added.sourceId;
}

async function sendBack(admin: Admin, ids: Id<"ingestionItems">[]) {
  return await admin.mutation(api.ingestion.sendBackToReview, { ids });
}

const companyFiles = (t: T) => t.run((ctx) => ctx.db.query("companyFiles").collect());
const source = (t: T, id: Id<"brainSources">) => t.run((ctx) => ctx.db.get(id));
const card = (t: T, id: Id<"brainSources">) =>
  t.run((ctx) => ctx.db.query("brainSourceCards").withIndex("by_sourceId", (q) => q.eq("sourceId", id)).unique());
const events = (t: T, itemId: Id<"ingestionItems">) =>
  t.run((ctx) => ctx.db.query("importFileEvents").withIndex("by_itemId_and_at", (q) => q.eq("itemId", itemId)).collect());

/** Every company band equals a recount of its files. */
async function expectCountsMatchRecount(t: T) {
  const { items, bands } = await t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    bands: await ctx.db.query("importCompanies").collect(),
  }));
  const recount: Record<string, ImportCounts> = {};
  for (const row of items) {
    const share = countShareOf(row);
    if (!share) continue;
    const key = `${share.sheetTab}|${share.companyKey}`;
    recount[key] = addShare(recount[key] ?? emptyImportCounts(), share, 1);
  }
  const stored: Record<string, ImportCounts> = {};
  for (const band of bands) stored[`${band.sheetTab}|${band.companyKey}`] = countsOf(band);
  expect(stored).toEqual(recount);
}

/** Each writer's stored file count equals a recount of the files that point at it. */
async function expectWriterCountsMatch(t: T) {
  const { items, writers } = await t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    writers: await ctx.db.query("pdWriters").collect(),
  }));
  for (const writer of writers) {
    const label = writer.name ?? writer.initials;
    expect(writer.fileCount ?? 0, label).toBe(items.filter((row) => row.writerId === writer._id).length);
    // The reviewer change's count (2026-11-17): the files that name it as their reviewer.
    expect(writer.reviewCount ?? 0, label).toBe(items.filter((row) => row.reviewerId === writer._id).length);
  }
}

function refusal(err: unknown) {
  return err instanceof ConvexError ? (err.data as { code: string; message: string }) : null;
}

const errorOf = async (promise: Promise<unknown>) => refusal(await promise.catch((e: unknown) => e))?.message;

describe("Send back to review", () => {
  it("returns a final PD in the Brain to To review with its labels, removes its company file and revokes its Brain copy", async () => {
    const { t, admin, adminId } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    const approved = await item(t, pd);
    const [file] = await companyFiles(t);
    const [client] = await t.run((ctx) => ctx.db.query("clients").collect());
    expect(approved).toMatchObject({ status: "approved", companyFileId: file._id, brainSourceId: sourceId, brainCheck: "added" });

    const result = await sendBack(admin, [pd]);
    expect(result).toEqual({ sentBack: [pd], refused: [], companyFileGone: [], brainKept: [], brainRevoked: [pd], notReached: [] });

    const back = await item(t, pd);
    expect(back).toMatchObject({ status: "pending_review", sheetTab: "review", needsCheck: false, sentBackBy: adminId });
    for (const gone of ["companyFileId", "brainSourceId", "brainCheck", "brainCheckedBy", "brainCheckedAt", "reviewedBy", "reviewedAt"] as const) {
      expect(back[gone], gone).toBeUndefined();
    }
    // Its labels stay.
    for (const kept of ["clientName", "category", "fiscalYearEnd", "pdNumber", "pdTitle", "versionCode", "versionNumber", "writerId", "writerInitials", "reviewerInitials", "scienceCode", "editedLabels", "storageId", "textStorageId", "contentHash"] as const) {
      expect(back[kept], kept).toEqual(approved[kept]);
    }
    // The company file goes by the company file delete path, logged with the Admin; the company stays.
    expect(await companyFiles(t)).toEqual([]);
    const fileEvents = await t.run((ctx) => ctx.db.query("companyFileEvents").collect());
    expect(fileEvents.map((event) => [event.action, event.userId])).toEqual([
      ["add", adminId],
      ["remove", adminId],
    ]);
    expect(await t.run((ctx) => ctx.db.get(client._id))).toMatchObject({ status: "active", name: CEDARLINE });
    // The Brain copy is revoked as an audited unlearn, marked as Send back's.
    expect(await source(t, sourceId)).toMatchObject({ status: "revoked", revokedFromStatus: "approved", sentBackItemId: pd });
    expect(await card(t, sourceId)).toMatchObject({ status: "revoked" });
    const audit = await t.run((ctx) => ctx.db.query("brainAuditLog").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect());
    expect(audit.map((row) => [row.action, row.reason])).toEqual([
      ["approve", "Imported & auto-approved (curated)"],
      ["revoke", SEND_BACK_BRAIN_REASON],
      ["unlearn_confirmed", "No RAG entry to erase"],
    ]);
    expect(await events(t, pd)).toMatchObject([
      { action: "send_back", userId: adminId, companyFileId: file._id, companyFile: "removed", brainSourceId: sourceId, brain: "revoked" },
    ]);
    // Counts, the Brain check count, pairing and writer counts follow.
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 0, brainCheck: 0 });
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "review" })).toMatchObject({ files: 1, ready: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectCountsMatchRecount(t);
    await expectWriterCountsMatch(t);
    // Retrieval no longer counts the company as one with imported PDs in the Brain.
    const sentBack = await t.run((ctx) => ctx.db.get(pd));
    expect(sentBack?.brainSourceId).toBeUndefined();
    const companyRows = await t.run((ctx) =>
      ctx.db
        .query("ingestionItems")
        .withIndex("by_companyKey_and_brainSourceId", (q) => q.eq("companyKey", sentBack!.companyKey!))
        .collect()
    );
    expect(companyRows.filter((row) => row.brainSourceId !== undefined)).toEqual([]);
  });

  it("asks the Brain to unlearn an embedded copy, through the same confirmed erasure as a revoke", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(sourceId))!;
      await patchBrainSource(ctx, row, { ragEntryId: "entry-1", ragImportance: 1 });
    });
    await sendBack(admin, [pd]);
    const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.filter((job) => job.name.includes("unlearnSource")).map((job) => job.args[0])).toEqual([
      { ragEntryId: "entry-1", sourceId, index: "voyage3" },
    ]);
  });

  it("sends back every kind of file, with no Brain step but for a final PD, and a final PD waiting for its Brain check or kept out", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const paths = [
      `${FY}/Drafts/Sensor notes.docx`,
      `${FY}/In Review/Sensor review.docx`,
      `${FY}/WIP/Technical/Audio/Kickoff call.txt`,
      `${FY}/WIP/Freezer readings.pdf`,
      `${CEDARLINE}/Company deck.pdf`,
    ];
    const others = [];
    for (const path of paths) others.push(await stageRead(t, path, `Text of ${path}`));
    const waiting = await readyPd(t);
    const keptOut = await readyPd(t, `${CEDARLINE}/2024 - Mar 31/Submitted/04 CedarlineSystems 2024-03-31 S1.DW Earlier.docx`, `${PD_TEXT}\nAn earlier year.`);
    await approve(t, admin, [...others, waiting, keptOut]);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: keptOut });
    expect(await companyFiles(t)).toHaveLength(7);
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 7, brainCheck: 1 });

    const result = await sendBack(admin, [...others, waiting, keptOut]);
    expect(result.sentBack).toHaveLength(7);
    expect(result.brainRevoked).toEqual([]);
    expect(await companyFiles(t)).toEqual([]);
    for (const id of [...others, waiting, keptOut]) {
      const back = await item(t, id);
      expect(back.status, back.name).toBe("pending_review");
      expect(back.brainCheck, back.name).toBeUndefined();
    }
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toEqual([]);
    expect(await admin.query(api.ingestion.sheetTotals, { tab: "approved" })).toMatchObject({ files: 0, brainCheck: 0 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectCountsMatchRecount(t);
    await expectWriterCountsMatch(t);
  });

  it("only unlinks a Brain copy another approved file still shares, then revokes it with the last one", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    // The same bytes in another file: its Brain check reuses the same copy.
    const copy = await readyPd(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift copy.docx`, PD_TEXT, (await item(t, pd)).contentHash);
    expect(await inBrain(t, admin, copy)).toBe(sourceId);

    const first = await sendBack(admin, [pd]);
    expect(first).toMatchObject({ sentBack: [pd], brainKept: [pd], brainRevoked: [] });
    // The copy stays for the other file, which retrieval now reads its company from.
    expect(await source(t, sourceId)).toMatchObject({ status: "approved", importItemId: copy });
    expect(await card(t, sourceId)).toMatchObject({ status: "approved", importItemId: copy });
    expect(await item(t, copy)).toMatchObject({ status: "approved", brainSourceId: sourceId });
    expect((await item(t, pd)).brainSourceId).toBeUndefined();
    expect(await events(t, pd)).toMatchObject([{ action: "send_back", brain: "unlinked" }]);
    // The other file's company file stays.
    expect((await companyFiles(t)).map((file) => file.importItemId)).toEqual([copy]);

    const last = await sendBack(admin, [copy]);
    expect(last).toMatchObject({ sentBack: [copy], brainKept: [], brainRevoked: [copy] });
    expect(await source(t, sourceId)).toMatchObject({ status: "revoked", sentBackItemId: copy });
  });

  it("finds a file sharing the copy past the first twenty, so a copy still in use is never revoked", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    const bytes = (await item(t, pd)).contentHash;
    const copies: Id<"ingestionItems">[] = [];
    for (let n = 1; n <= 21; n++) {
      copies.push(await readyPd(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift copy ${n}.docx`, PD_TEXT, bytes));
    }
    await approve(t, admin, copies);
    for (const copy of copies) expect(await inBrain(t, admin, copy)).toBe(sourceId);

    // The first file and the next nineteen go back together; the twenty-first copy still uses it.
    const first20 = [pd, ...copies.slice(0, 19)];
    const result = await sendBack(admin, first20);
    expect(result.sentBack).toEqual(first20);
    expect(result.brainRevoked).toEqual([]);
    expect(result.brainKept).toEqual(first20);
    expect(await source(t, sourceId)).toMatchObject({ status: "approved" });
    expect([copies[19], copies[20]]).toContain((await source(t, sourceId))?.importItemId);
    // The last two go one after the other: only the very last revokes it.
    expect(await sendBack(admin, [copies[19]])).toMatchObject({ brainKept: [copies[19]], brainRevoked: [] });
    expect(await sendBack(admin, [copies[20]])).toMatchObject({ brainKept: [], brainRevoked: [copies[20]] });
    expect(await source(t, sourceId)).toMatchObject({ status: "revoked", sentBackItemId: copies[20] });
  });

  it("sends a large selection back across several calls, each within its read budget, never reading the copies", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pds: Id<"ingestionItems">[] = [];
    for (let n = 0; n < 50; n++) {
      const number = String(n + 10).padStart(2, "0");
      pds.push(
        await readyPd(t, `${FY}/Submitted/${number} CedarlineSystems 2025-03-31 T2.DW.PN SensorCase${number}.docx`, `${PD_TEXT}\nCase ${number}.`)
      );
    }
    await approve(t, admin, pds);
    const sources: Id<"brainSources">[] = [];
    for (const pd of pds) sources.push(await inBrain(t, admin, pd));
    expect(new Set(sources).size).toBe(50);
    // Each Brain copy holds a long text, and each file has many copies with
    // its bytes still on To review: none of them shares the copy.
    const big = "Long passage about sensor drift. ".repeat(20_000);
    await t.run(async (ctx) => {
      for (const sourceId of sources) await patchBrainSource(ctx, (await ctx.db.get(sourceId))!, { content: big });
      for (const pd of pds) {
        const row = (await ctx.db.get(pd))!;
        for (let n = 0; n < 20; n++) {
          await ctx.db.insert("ingestionItems", {
            driveItemId: `drive-${pd}-copy-${n}`,
            path: `${FY}/Submitted/copy ${n} of ${row.name}`,
            name: `copy ${n} of ${row.name}`,
            clientName: CEDARLINE,
            companyKey: "cedarline systems",
            docKind: "pd",
            size: 1,
            lastModifiedAt: 1,
            contentHash: row.contentHash,
            status: "pending_review",
            text: "x".repeat(8000),
            pairGroupKey: "cedarline systems::2025",
            updatedAt: 1,
          });
        }
      }
    });
    const sourceSize = await t.run(async (ctx) => JSON.stringify(await ctx.db.get(sources[0]))!.length);
    const itemSize = await t.run(async (ctx) => JSON.stringify(await ctx.db.get(pds[0]))!.length);

    // As the page does: the files a call did not reach go first in the next one.
    let queue = [...pds];
    const calls: Array<Awaited<ReturnType<typeof sendBack>>> = [];
    while (queue.length > 0) {
      const result = await sendBack(admin, queue.slice(0, 50));
      calls.push(result);
      expect(result.notReached.length).toBeLessThan(Math.min(queue.length, 50));
      queue = [...result.notReached, ...queue.slice(50)];
    }
    expect(calls.length).toBeGreaterThan(1);
    for (const call of calls) {
      // What a call read stays within its budget, but for the one file that crossed it.
      const read = call.sentBack.length * (sourceSize + itemSize);
      expect(read).toBeLessThanOrEqual(SEND_BACK_READ_BUDGET + sourceSize + itemSize + 1024 * 1024);
      expect(call.refused).toEqual([]);
    }
    const all = calls.flatMap((call) => call.sentBack);
    expect(all.sort()).toEqual([...pds].sort());
    expect(calls.flatMap((call) => call.brainRevoked).sort()).toEqual([...pds].sort());
    for (const sourceId of sources) expect(await source(t, sourceId)).toMatchObject({ status: "revoked" });
    for (const pd of pds) expect(await item(t, pd)).toMatchObject({ status: "pending_review" });
  });

  it("finds a file with other bytes that shares the copy through the Brain's link rows", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    // Other bytes, the same text: its Brain check reuses the copy and links its own bytes.
    const resaved = await readyPd(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift v2.docx`, PD_TEXT, "bytes-resaved");
    expect(await inBrain(t, admin, resaved)).toBe(sourceId);
    const links = await t.run((ctx) =>
      ctx.db.query("brainSourceImportFiles").withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId)).collect()
    );
    expect(links.map((link) => link.importItemId).sort()).toEqual([pd, resaved].sort());

    expect(await sendBack(admin, [pd])).toMatchObject({ sentBack: [pd], brainKept: [pd], brainRevoked: [] });
    expect(await source(t, sourceId)).toMatchObject({ status: "approved", importItemId: resaved });
    expect(await sendBack(admin, [resaved])).toMatchObject({ sentBack: [resaved], brainKept: [], brainRevoked: [resaved] });
    expect(await source(t, sourceId)).toMatchObject({ status: "revoked", sentBackItemId: resaved });
    // The link rows stay with the revoked copy, as for any revoke.
    expect(
      await t.run((ctx) => ctx.db.query("brainSourceImportFiles").withIndex("by_sourceId", (q) => q.eq("sourceId", sourceId)).collect())
    ).toHaveLength(2);
  });

  it("leaves a Brain copy removed on the Brain page as it is, and says so", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "Not a good example" });
    const result = await sendBack(admin, [pd]);
    expect(result).toMatchObject({ sentBack: [pd], brainKept: [], brainRevoked: [] });
    const removed = await source(t, sourceId);
    expect(removed?.status).toBe("revoked");
    expect(removed?.sentBackItemId).toBeUndefined();
    const revokes = await t.run((ctx) => ctx.db.query("brainAuditLog").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect());
    expect(revokes.filter((row) => row.action === "revoke")).toHaveLength(1);
    expect(await events(t, pd)).toMatchObject([{ action: "send_back", brainSourceId: sourceId, brain: "already_removed" }]);
  });

  it("never says a shared copy stays when it was removed on the Brain page", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    const copy = await readyPd(t, `${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN ColdChainSensorDrift copy.docx`, PD_TEXT, (await item(t, pd)).contentHash);
    expect(await inBrain(t, admin, copy)).toBe(sourceId);
    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "Not a good example" });
    expect(await sendBack(admin, [pd])).toMatchObject({ sentBack: [pd], brainKept: [], brainRevoked: [] });
    expect(await events(t, pd)).toMatchObject([{ action: "send_back", brain: "already_removed" }]);
    // Nothing re-pointed or revoked again.
    expect(await source(t, sourceId)).toMatchObject({ status: "revoked", importItemId: pd });
    expect((await source(t, sourceId))?.sentBackItemId).toBeUndefined();
  });

  it("never approves a source Send back revoked on the Brain page, beside its newer copy", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const first = await inBrain(t, admin, pd);
    await sendBack(admin, [pd]);
    const second = await inBrain(t, admin, pd);
    expect(second).not.toBe(first);
    expect(await errorOf(admin.mutation(api.brain.approveSource, { sourceId: first }))).toBe(
      "This source was removed from the Brain, so it cannot be approved again."
    );
    expect(await errorOf(admin.mutation(api.brain.approveSource, { sourceId: second }))).toBe("This source is already in the Brain.");
    expect(await source(t, first)).toMatchObject({ status: "revoked" });
  });

  it("keeps the frozen text versions drafts read from the company file, and never deletes the Import file's original", async () => {
    const { t, admin, adminId } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text about the sensor.");
    await approve(t, admin, [draft]);
    const [file] = await companyFiles(t);
    const { storageId, textStorageId } = await item(t, draft);
    // A draft froze the company file's text (B1, second part).
    const versionId = await t.run(async (ctx) => {
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Sensor", clientName: CEDARLINE, clientId: file.clientId, status: "draft", createdBy: adminId, shareToken: "back", createdAt: now, updatedAt: now,
      });
      const generationId = await ctx.db.insert("generations", { projectId, status: "completed", startedAt: now });
      const id = await ctx.db.insert("sourceTextVersions", {
        companyFileId: file._id, clientId: file.clientId, textHash: "h-draft", textLength: 5, textBytes: 5, createdAt: now,
      });
      await ctx.db.insert("sourceTextVersionPieces", { versionId: id, companyFileId: file._id, start: 0, text: "Draft" });
      await ctx.db.insert("generationSources", {
        generationId, projectId, kind: "company_file", companyFileId: file._id, clientId: file.clientId, label: "other:Sensor notes.docx",
        textVersionId: id, textLength: 5, contentHash: "h-draft", truncated: false, originalLength: 5, capturedAt: now,
      });
      return id;
    });
    await sendBack(admin, [draft]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await companyFiles(t)).toEqual([]);
    // The company file's own text pieces go; the version a draft used stays, with its pieces.
    expect(await t.run((ctx) => ctx.db.query("companyFileTexts").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(versionId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("sourceTextVersionPieces").collect())).toHaveLength(1);
    // The Import file's original and text are still stored, and it still points at them.
    expect(await t.run((ctx) => ctx.db.system.get(storageId!))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.system.get(textStorageId!))).not.toBeNull();
    expect(await item(t, draft)).toMatchObject({ storageId, textStorageId });
  });

  it("keeps pairing: a PD sent back stays paired with its transcript", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const transcript = await stageRead(t, `${FY}/WIP/Technical/Audio/Kickoff call.txt`, "Call text");
    await t.mutation(internal.ingestion.recomputePairs, { groupKeys: ["cedarline systems::2025"] });
    await approve(t, admin, [pd, transcript]);
    await sendBack(admin, [pd]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await item(t, pd)).pairStatus).toBe("paired");
    expect((await item(t, transcript)).pairStatus).toBe("paired");
    await expectCountsMatchRecount(t);
  });

  it("sends back a file whose company file was already deleted by hand, and says only the file came back", async () => {
    const { t, admin } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    const [file] = await companyFiles(t);
    await admin.mutation(api.companyFiles.removeCompanyFile, { companyFileId: file._id });
    const result = await sendBack(admin, [draft]);
    expect(result).toMatchObject({ sentBack: [draft], companyFileGone: [draft] });
    expect(await item(t, draft)).toMatchObject({ status: "pending_review" });
    expect(await events(t, draft)).toMatchObject([{ action: "send_back", companyFile: "gone", brain: "none" }]);
  });

  it("refuses by name a file that is not approved, one no longer in Import, and one whose company is still being approved", async () => {
    const { t, admin, adminId } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text");
    const notYet = await stageRead(t, `${FY}/Drafts/Other notes.docx`, "Other text");
    await approve(t, admin, [draft]);
    const gone = await stageRead(t, `${FY}/Drafts/Gone notes.docx`, "Gone text");
    await t.run((ctx) => ctx.db.delete(gone));

    // A company's approval still moving would take the file straight back.
    const running = await t.run((ctx) =>
      ctx.db.insert("importApprovals", {
        startedBy: adminId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        scope: "company",
        companyKey: "cedarline systems",
        companyName: CEDARLINE,
        status: "running",
        total: 3,
        done: 1,
        approved: 1,
        refused: 0,
      })
    );
    expect(await sendBack(admin, [draft, notYet, gone])).toEqual({
      sentBack: [],
      refused: [
        { id: draft, reason: "approval_running" },
        { id: notYet, reason: "not_approved" },
        { id: gone, reason: "missing" },
      ],
      companyFileGone: [],
      brainKept: [],
      brainRevoked: [],
      notReached: [],
    });
    expect(await item(t, draft)).toMatchObject({ status: "approved" });
    expect(await companyFiles(t)).toHaveLength(1);
    // One that has stopped moving (five minutes) no longer blocks.
    await t.run((ctx) => ctx.db.patch(running, { updatedAt: Date.now() - 6 * 60 * 1000 }));
    expect((await sendBack(admin, [draft])).sentBack).toEqual([draft]);
    // A file sent back twice is refused the second time, and nothing is made twice.
    expect((await sendBack(admin, [draft])).refused).toEqual([{ id: draft, reason: "not_approved" }]);
    expect(await events(t, draft)).toHaveLength(1);

    // A file still waiting in an approval of picked files would be approved again too.
    await approve(t, admin, [draft]);
    const picked = await t.run(async (ctx) => {
      const approvalId = await ctx.db.insert("importApprovals", {
        startedBy: adminId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        scope: "files",
        status: "running",
        total: 1,
        done: 0,
        approved: 0,
        refused: 0,
      });
      await ctx.db.insert("importApprovalFiles", { approvalId, itemId: draft, position: 0, state: "waiting", name: "Sensor notes.docx" });
      return approvalId;
    });
    expect((await sendBack(admin, [draft])).refused).toEqual([{ id: draft, reason: "approval_running" }]);
    // Once it is past that file (or stalled), it no longer blocks.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("importApprovalFiles")
        .withIndex("by_approvalId_and_itemId", (q) => q.eq("approvalId", picked).eq("itemId", draft))
        .unique();
      await ctx.db.patch(row!._id, { state: "already" });
    });
    expect((await sendBack(admin, [draft])).sentBack).toEqual([draft]);

    expect(await errorOf(sendBack(admin, []))).toBe("Select at least one file.");
    const many = Array.from({ length: 51 }, () => draft);
    expect(await errorOf(sendBack(admin, many))).toBe("Send back up to 50 files at a time.");
  });
});

describe("Send back and approvals it must see (Greptile, 2026-11-19)", () => {
  it("finds a file still waiting in a newer approval behind 60 other running ones", async () => {
    const { t, admin, adminId } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    const base = { startedBy: adminId, status: "running" as const, total: 1, done: 0, approved: 0, refused: 0 };
    await t.run(async (ctx) => {
      // Older running approvals: stalled picked files and other companies' runs.
      for (let index = 0; index < 60; index += 1) {
        const stalled = index % 2 === 0;
        await ctx.db.insert("importApprovals", {
          ...base,
          startedAt: Date.now() - 60_000 + index,
          updatedAt: stalled ? Date.now() - 6 * 60 * 1000 : Date.now(),
          scope: stalled ? "files" : "company",
          ...(stalled ? {} : { companyKey: `other company ${index}`, companyName: `Other Company ${index}` }),
        });
      }
      const approvalId = await ctx.db.insert("importApprovals", { ...base, startedAt: Date.now(), updatedAt: Date.now(), scope: "files" });
      await ctx.db.insert("importApprovalFiles", { approvalId, itemId: draft, position: 0, state: "waiting", name: "Sensor notes.docx" });
    });
    expect((await sendBack(admin, [draft])).refused).toEqual([{ id: draft, reason: "approval_running" }]);
    expect(await item(t, draft)).toMatchObject({ status: "approved" });
  });

  it("refuses safely when the file waits in more stalled approvals than one call reads", async () => {
    const { t, admin, adminId } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    await t.run(async (ctx) => {
      for (let index = 0; index < 20; index += 1) {
        const approvalId = await ctx.db.insert("importApprovals", {
          startedBy: adminId, startedAt: index, updatedAt: Date.now() - 6 * 60 * 1000, scope: "files", status: "running", total: 1, done: 0, approved: 0, refused: 0,
        });
        await ctx.db.insert("importApprovalFiles", { approvalId, itemId: draft, position: 0, state: "waiting", name: "Sensor notes.docx" });
      }
    });
    expect((await sendBack(admin, [draft])).refused).toEqual([{ id: draft, reason: "approval_running" }]);
    // With fewer than that, stalled ones no longer block.
    await t.run(async (ctx) => {
      const row = await ctx.db.query("importApprovalFiles").withIndex("by_itemId_and_state", (q) => q.eq("itemId", draft).eq("state", "waiting")).first();
      await ctx.db.patch(row!._id, { state: "already" });
    });
    expect((await sendBack(admin, [draft])).sentBack).toEqual([draft]);
  });
});

describe("approving again after Send back", () => {
  it("works like a first approval: a new company file, a Brain check, and a new Brain copy beside the revoked one", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const firstSource = await inBrain(t, admin, pd);
    const [firstFile] = await companyFiles(t);
    await sendBack(admin, [pd]);
    const companiesBefore = await t.run((ctx) => ctx.db.query("clients").collect());

    await approve(t, admin, [pd]);
    const again = await item(t, pd);
    const [secondFile] = await companyFiles(t);
    expect(secondFile._id).not.toBe(firstFile._id);
    expect(secondFile).toMatchObject({ importItemId: pd, category: "final_pd", clientId: firstFile.clientId, storageId: firstFile.storageId });
    expect(again).toMatchObject({ status: "approved", companyFileId: secondFile._id, brainCheck: "waiting" });
    expect(again.brainSourceId).toBeUndefined();
    // The company the first approval made is the one used again; none is made.
    expect(await t.run((ctx) => ctx.db.query("clients").collect())).toEqual(companiesBefore);

    // The revoked copy is never reused: the Brain check makes a new one, with a key of its own.
    const secondSource = await inBrain(t, admin, pd);
    expect(secondSource).not.toBe(firstSource);
    const [revoked, fresh] = [await source(t, firstSource), await source(t, secondSource)];
    expect(revoked).toMatchObject({ status: "revoked", sentBackItemId: pd });
    expect(fresh).toMatchObject({ status: "approved", importItemId: pd, sourceHash: revoked!.sourceHash });
    expect(fresh!.ragKey).not.toBe(revoked!.ragKey);
    expect(fresh!.ragKey.startsWith(revoked!.ragKey)).toBe(true);
    expect(await item(t, pd)).toMatchObject({ brainSourceId: secondSource, brainCheck: "added" });
    expect(embedsQueued()).toEqual([firstSource, secondSource]);

    // Another path that matches the PD now finds the new copy, not the revoked one.
    const content = fresh!.content;
    const nominated = await admin.mutation(api.brain.importPdPair, { title: "Again", industry: "manufacturing", writerTier: 0.4, docType: "pd", content });
    expect(nominated).toBe(secondSource);
    expect(await t.run((ctx) => ctx.db.query("brainSources").collect())).toHaveLength(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectCountsMatchRecount(t);
  });

  it("still refuses, on every other path, a Brain source sent back and not yet copied again", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    await sendBack(admin, [pd]);
    const content = (await source(t, sourceId))!.content;
    expect(await errorOf(admin.mutation(api.brain.importPdPair, { title: "Again", industry: "manufacturing", writerTier: 0.4, docType: "pd", content }))).toBe(
      "This PD matches a Brain source an Admin removed from the Brain, so it cannot be approved here."
    );
  });

  it("keeps a revoke made on the Brain page in force on re-approval: the PD stays in Brain check", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    await admin.mutation(api.brain.revokeSource, { sourceId });
    await sendBack(admin, [pd]);
    await approve(t, admin, [pd]);
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    if (!preview.ok) throw new Error("no preview");
    expect(await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen })).toEqual({
      ok: false,
      reason: "This PD matches a Brain source an Admin removed from the Brain, so it cannot be approved here.",
    });
    expect(await item(t, pd)).toMatchObject({ brainCheck: "waiting" });
  });
});

describe("editing an approved file", () => {
  async function approvedPdInBrain(t: T, admin: Admin) {
    await pickIndustry(admin);
    const pd = await readyPd(t);
    const sourceId = await inBrain(t, admin, pd);
    enqueue.mockClear();
    return { pd, sourceId };
  }

  it("changes the writer on the file alone, its company file and its Brain copy, with no new embed", async () => {
    const { t, admin, adminId } = await setup();
    const { pd, sourceId } = await approvedPdInBrain(t, admin);
    const before = await item(t, pd);
    expect(await source(t, sourceId)).toMatchObject({ writerName: "Dana Whitlock", writerTier: 0.7 });

    const result = await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Robin Sample" } } });
    expect(result).toEqual({ changed: ["writer"], brainUpdated: true });
    const after = await item(t, pd);
    const robin = await t.run((ctx) => ctx.db.get(after.writerId!));
    expect(robin).toMatchObject({ name: "Robin Sample", createdVia: "person", createdBy: adminId });
    expect(after).toMatchObject({ status: "approved", writerName: "Robin Sample", writerNameSource: "person" });
    expect(after.editedLabels).toContain("writerName");
    // Nothing else on the file moved.
    for (const kept of ["clientName", "category", "fiscalYearEnd", "companyKey", "storageId", "textStorageId", "companyFileId", "brainSourceId"] as const) {
      expect(after[kept], kept).toEqual(before[kept]);
    }
    const [file] = await companyFiles(t);
    expect(file.writerId).toBe(robin!._id);
    expect(await source(t, sourceId)).toMatchObject({ writerName: "Robin Sample", writerTier: 0.7, content: (await source(t, sourceId))!.content });
    expect(await card(t, sourceId)).toMatchObject({ writerName: "Robin Sample" });
    // Retrieval reads the name from the card: nothing is embedded again (the same tier).
    expect(embedsQueued()).toEqual([]);
    const relabels = await t.run((ctx) => ctx.db.query("brainAuditLog").withIndex("by_source", (q) => q.eq("sourceId", sourceId)).collect());
    expect(relabels.find((row) => row.action === "relabel")).toMatchObject({ actorId: adminId, reason: "Changed on Import after approval: writer Dana Whitlock → Robin Sample" });
    expect(await events(t, pd)).toMatchObject([
      {
        action: "edit",
        userId: adminId,
        changes: [{ field: "writer", before: before.writerId, after: robin!._id, beforeLabel: "Dana Whitlock", afterLabel: "Robin Sample" }],
        companyFile: "updated",
        brainSourceId: sourceId,
        brain: "relabeled",
      },
    ]);
    await expectWriterCountsMatch(t);
    await expectCountsMatchRecount(t);
    // The sheet shows it.
    const row = await admin.query(api.ingestion.sheetFile, { id: pd });
    expect(row).toMatchObject({ writerName: "Robin Sample" });
  });

  it("changes the science code on the file, its company file's labels and its Brain copy, with no new embed", async () => {
    const { t, admin } = await setup();
    const { pd, sourceId } = await approvedPdInBrain(t, admin);
    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { scienceCode: "1.02.02" } })).toEqual({ changed: ["scienceCode"], brainUpdated: true });
    expect(await item(t, pd)).toMatchObject({ scienceCode: "1.02.02", scienceCodeSource: "person" });
    expect((await companyFiles(t))[0].importLabels).toMatchObject({ scienceCode: "1.02.02", pdTitle: (await item(t, pd)).pdTitle });
    expect(await source(t, sourceId)).toMatchObject({ scienceCode: "1.02.02" });
    expect(await card(t, sourceId)).toMatchObject({ scienceCode: "1.02.02" });
    expect(embedsQueued()).toEqual([]);
    // The same code again changes nothing and writes no row.
    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { scienceCode: "1.02.02" } })).toEqual({ changed: [], brainUpdated: false });
    expect(await events(t, pd)).toHaveLength(1);
    expect(embedsQueued()).toEqual([]);
  });

  it("changes the PD title, the reviewer and the CRA mark on the file and its company file, never touching the Brain copy", async () => {
    const { t, admin, adminId } = await setup();
    const { pd, sourceId } = await approvedPdInBrain(t, admin);
    const sourceBefore = await source(t, sourceId);
    const auditBefore = await t.run((ctx) => ctx.db.query("brainAuditLog").collect());
    const titleBefore = (await item(t, pd)).pdTitle ?? null;
    // The reviewer its initials gave (PN, from T2.DW.PN), before any edit.
    const reviewerBefore = (await item(t, pd)).reviewerId ?? null;
    expect(reviewerBefore).not.toBeNull();

    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { pdTitle: "  Cold   chain drift  " } })).toEqual({ changed: ["pdTitle"], brainUpdated: false });
    expect(await item(t, pd)).toMatchObject({ pdTitle: "Cold chain drift" });
    expect((await item(t, pd)).editedLabels).toContain("pdTitle");
    expect((await companyFiles(t))[0].importLabels).toMatchObject({ pdTitle: "Cold chain drift" });

    const reviewer = await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { reviewer: { kind: "name", name: "Priya Nadeau" } } });
    expect(reviewer).toEqual({ changed: ["reviewer"], brainUpdated: false });
    const withReviewer = await item(t, pd);
    expect(withReviewer).toMatchObject({ reviewerSource: "person" });
    expect((await companyFiles(t))[0].reviewerId).toBe(withReviewer.reviewerId);
    expect(await admin.query(api.ingestion.sheetFile, { id: pd })).toMatchObject({ reviewerId: withReviewer.reviewerId, reviewerName: "Priya Nadeau" });

    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { craReviewed: true } })).toEqual({ changed: ["craReviewed"], brainUpdated: false });
    expect(await item(t, pd)).toMatchObject({ craReviewed: true, craReviewedBy: adminId });
    expect((await companyFiles(t))[0].importLabels).toMatchObject({ craReviewed: true });
    expect(await admin.query(api.ingestion.sheetFile, { id: pd })).toMatchObject({ craReviewed: true });

    // Cleared again.
    await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { reviewer: null, craReviewed: false } });
    const cleared = await item(t, pd);
    for (const gone of ["reviewerId", "craReviewed", "craReviewedBy", "craReviewedAt"] as const) expect(cleared[gone], gone).toBeUndefined();
    // "No reviewer" is a person's choice, kept so its initials never fill it again.
    expect(cleared.reviewerSource).toBe("person");
    const [file] = await companyFiles(t);
    expect(file.reviewerId).toBeUndefined();
    expect(file.importLabels?.craReviewed).toBeUndefined();

    // The Brain copy is exactly as it was: no relabel, no embed, no craOutcome.
    expect(await source(t, sourceId)).toEqual(sourceBefore);
    expect(await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).toEqual(auditBefore);
    expect(embedsQueued()).toEqual([]);
    const rows = await events(t, pd);
    expect(rows.map((row) => row.changes?.map((change) => [change.field, change.before ?? null, change.after ?? null]))).toEqual([
      [["pdTitle", titleBefore, "Cold chain drift"]],
      [["reviewer", reviewerBefore, withReviewer.reviewerId]],
      [["craReviewed", "no", "yes"]],
      [
        ["reviewer", withReviewer.reviewerId, null],
        ["craReviewed", "yes", "no"],
      ],
    ]);
  });

  it("counts a reviewer set after approval, so a past writer that is only a reviewer is never removed", async () => {
    const { t, admin } = await setup();
    const { pd } = await approvedPdInBrain(t, admin);
    const approved = await item(t, pd);
    const dana = approved.writerId!;
    const pn = approved.reviewerId!;
    // DW wrote it and PN reviewed it, both writers the check made from the file name.
    expect(await t.run((ctx) => ctx.db.get(dana))).toMatchObject({ createdVia: "import", fileCount: 1 });
    expect(await t.run((ctx) => ctx.db.get(pn))).toMatchObject({ createdVia: "import", reviewCount: 1 });

    // DW becomes its reviewer too, then someone else its writer: DW still reviews it, so it stays.
    await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { reviewer: { kind: "writer", writerId: dana } } });
    await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Robin Sample" } } });
    expect(await t.run((ctx) => ctx.db.get(dana))).toMatchObject({ fileCount: 0, reviewCount: 1 });
    expect(await item(t, pd)).toMatchObject({ reviewerId: dana, reviewerSource: "person" });
    expect((await companyFiles(t))[0].reviewerId).toBe(dana);
    // PN reviews nothing now and no person ever changed it, so it goes, as on To review.
    expect(await t.run((ctx) => ctx.db.get(pn))).toBeNull();
    await expectWriterCountsMatch(t);

    // Sent back and approved again, the reviewer a person set is the company file's.
    await admin.mutation(api.ingestion.sendBackToReview, { ids: [pd] });
    expect(await item(t, pd)).toMatchObject({ status: "pending_review", reviewerId: dana, reviewerSource: "person" });
    await approve(t, admin, [pd]);
    const again = await item(t, pd);
    expect(again.status).toBe("approved");
    expect((await t.run((ctx) => ctx.db.get(again.companyFileId!)))?.reviewerId).toBe(dana);
    await expectWriterCountsMatch(t);
  });

  it("refuses a final PD's writer whose name gives its company away on the Brain copy", async () => {
    const { t, admin, adminId } = await setup();
    const { pd, sourceId } = await approvedPdInBrain(t, admin);
    const before = await item(t, pd);
    const writersBefore = await t.run((ctx) => ctx.db.query("pdWriters").collect());
    for (const name of ["Cedarline Systems", "CedarlineSystems team"]) {
      expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name } } })), name).toMatch(
        /^That writer's name holds the company's name \("cedarline/
      );
    }
    // A person the company's projects interviewed, whatever the case.
    const clientId = (await t.run((ctx) => ctx.db.query("clients").collect())).find((client) => client.name === CEDARLINE)!._id;
    await t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "Freezer sensors",
        clientName: CEDARLINE,
        clientId,
        dashboardCompanyKey: "cedarline systems",
        status: "review",
        createdBy: adminId,
        shareToken: "cedarline-token",
        interviewees: ["Morgan Vale"],
        createdAt: 1,
        updatedAt: 1,
      })
    );
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "morgan  vale" } } }))).toBe(
      "That writer's name is a person the company's projects interviewed, so it cannot go on this PD's Brain copy. Choose the writer by their own name."
    );
    // Nothing changed, and no writer was made for the typed names.
    expect(await item(t, pd)).toMatchObject({ writerId: before.writerId, writerName: before.writerName });
    expect(await source(t, sourceId)).toMatchObject({ writerName: "Dana Whitlock" });
    expect(await t.run((ctx) => ctx.db.query("pdWriters").collect())).toHaveLength(writersBefore.length);
    expect(await events(t, pd)).toEqual([]);
    // Another name is fine.
    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Morgan Hale" } } })).toEqual({
      changed: ["writer"],
      brainUpdated: true,
    });
  });

  it("checks the writer against the same live projects the Brain copy hides, past projects awaiting deletion (Greptile, 2026-11-19)", async () => {
    const { t, admin, adminId } = await setup();
    const { pd } = await approvedPdInBrain(t, admin);
    const clientId = (await t.run((ctx) => ctx.db.query("clients").collect())).find((client) => client.name === CEDARLINE)!._id;
    const project = (title: string, extra: Record<string, unknown> = {}) => ({
      title, clientName: CEDARLINE, clientId, dashboardCompanyKey: "cedarline systems", status: "review" as const,
      createdBy: adminId, shareToken: `${title}-token`, createdAt: 1, updatedAt: 1, ...extra,
    });
    await t.run(async (ctx) => {
      // The interviewee's live project, then 60 newer ones awaiting deletion.
      await ctx.db.insert("projects", project("Freezer sensors", { interviewees: ["Morgan Vale"] }));
      for (let index = 0; index < 60; index += 1) await ctx.db.insert("projects", project(`Deleting ${index}`, { deletionStartedAt: 1 }));
    });
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Morgan Vale" } } }))).toBe(
      "That writer's name is a person the company's projects interviewed, so it cannot go on this PD's Brain copy. Choose the writer by their own name."
    );
    // More rows awaiting deletion than the check reads: refused, not checked in part.
    await t.run(async (ctx) => {
      for (let index = 60; index < 1000; index += 1) await ctx.db.insert("projects", project(`Deleting ${index}`, { deletionStartedAt: 1 }));
    });
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Morgan Hale" } } }))).toBe(
      WRITER_CHECK_INCOMPLETE
    );
  });

  it("keeps a reviewer cleared by a person cleared through Send back and the next approval", async () => {
    const { t, admin } = await setup();
    const { pd } = await approvedPdInBrain(t, admin);
    // T2.DW.PN: the initials gave PN as its reviewer.
    expect((await item(t, pd)).reviewerId).toBeDefined();
    await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { reviewer: null } });
    expect(await item(t, pd)).toMatchObject({ reviewerSource: "person" });
    await sendBack(admin, [pd]);
    const back = await item(t, pd);
    expect(back).toMatchObject({ status: "pending_review", reviewerInitials: "PN", reviewerSource: "person" });
    expect(back.reviewerId).toBeUndefined();
    // The sheet shows no reviewer, and the backfill for approved files leaves it too.
    expect((await admin.query(api.ingestion.sheetFile, { id: pd }))?.reviewerId).toBeUndefined();
    await approve(t, admin, [pd]);
    const again = await item(t, pd);
    expect(again).toMatchObject({ status: "approved", reviewerSource: "person" });
    expect(again.reviewerId).toBeUndefined();
    expect((await t.run((ctx) => ctx.db.get(again.companyFileId!)))?.reviewerId).toBeUndefined();
    await t.mutation(internal.ingestion.backfillImportWriters, { tab: "approved", cursor: null });
    expect((await item(t, pd)).reviewerId).toBeUndefined();
    await expectWriterCountsMatch(t);
  });

  it("logs a person confirming the AI's science code as an edit, with where the code came from", async () => {
    const { t, admin, adminId } = await setup();
    const { pd, sourceId } = await approvedPdInBrain(t, admin);
    expect(await item(t, pd)).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "document" });
    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { scienceCode: "2.02.09" } })).toEqual({
      changed: ["scienceCode"],
      brainUpdated: false,
    });
    expect(await item(t, pd)).toMatchObject({ scienceCode: "2.02.09", scienceCodeSource: "person" });
    expect((await item(t, pd)).editedLabels).toContain("scienceCode");
    expect(await events(t, pd)).toMatchObject([
      {
        action: "edit",
        userId: adminId,
        changes: [{ field: "scienceCode", before: "2.02.09", after: "2.02.09", beforeLabel: "document", afterLabel: "person" }],
        brain: "none",
      },
    ]);
    // The Brain copy and the company file keep the same code: nothing is lost there.
    expect(await source(t, sourceId)).toMatchObject({ scienceCode: "2.02.09" });
    expect((await companyFiles(t))[0].importLabels).toMatchObject({ scienceCode: "2.02.09" });
    // Confirmed once is enough: again changes nothing and logs nothing.
    expect(await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { scienceCode: "2.02.09" } })).toEqual({
      changed: [],
      brainUpdated: false,
    });
    expect(await events(t, pd)).toHaveLength(1);
  });

  it("refuses what does not go on the file, a file no longer approved, and bad values, in plain words", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const draft = await stageRead(t, `${FY}/Drafts/04 CedarlineSystems 2025-03-31 R1.DW SensorDrift.docx`, "Draft text");
    const pd = await readyPd(t);
    const transcript = await stageRead(t, `${FY}/WIP/Technical/Audio/Kickoff call.txt`, "Call text");
    await approve(t, admin, [draft, pd, transcript]);
    const notYet = await stageRead(t, `${FY}/Drafts/Other notes.docx`, "Other text");

    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: draft, patch: { scienceCode: "2.02.09" } }))).toBe("A science code only goes on a final PD.");
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: draft, patch: { craReviewed: true } }))).toBe("Only a final PD can be marked as reviewed by CRA.");
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: transcript, patch: { writer: { kind: "name", name: "Robin Sample" } } }))).toBe(
      "A writer only goes on a final PD, draft or review copy."
    );
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: transcript, patch: { pdTitle: "Call" } }))).toBe("A PD title only goes on a final PD, draft or review copy.");
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: notYet, patch: { pdTitle: "Notes" } }))).toBe(NOT_APPROVED_ANY_MORE);
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { scienceCode: "9.99.99" } }))).toBe("That is not a CRA field of science code.");
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { pdTitle: "x".repeat(201) } }))).toBe("A PD title can be up to 200 characters.");
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "robin@example.com" } } }))).toBe(
      "Type the writer's name, not an email address."
    );
    expect(await errorOf(admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: {} }))).toBe("Choose a detail to change.");
    // A draft takes a writer and a title.
    expect((await admin.mutation(api.ingestion.editApprovedFile, { id: draft, patch: { pdTitle: "Sensor drift notes" } })).changed).toEqual(["pdTitle"]);
    expect(await t.run((ctx) => ctx.db.query("importFileEvents").collect())).toHaveLength(1);
  });

  it("keeps the freeze rule: a firm-wide pick skips approved files, and a writer set on one approved file is never a pick", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    await approve(t, admin, [pd]);
    const approvedWriter = (await item(t, pd)).writerId;
    const onReview = await readyPd(t, `${CEDARLINE}/2024 - Mar 31/Submitted/04 CedarlineSystems 2024-03-31 S1.DW Earlier.docx`, `${PD_TEXT}\nEarlier.`);
    expect((await item(t, onReview)).writerId).toBe(approvedWriter);

    // "DW is Robin Sample" for the whole firm moves the To review file only.
    await admin.mutation(api.ingestion.matchWriterInitials, { initials: "DW", writer: { kind: "name", name: "Robin Sample" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const robin = (await item(t, onReview)).writerId;
    expect(robin).not.toBe(approvedWriter);
    expect((await item(t, pd)).writerId).toBe(approvedWriter);

    // A writer chosen on the approved file is for it alone: no pick is made or moved.
    const picksBefore = await t.run((ctx) => ctx.db.query("pdWriterPicks").collect());
    await admin.mutation(api.ingestion.editApprovedFile, { id: pd, patch: { writer: { kind: "name", name: "Kim Tran" } } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("pdWriterPicks").collect())).toEqual(picksBefore);
    expect((await item(t, onReview)).writerId).toBe(robin);
    await expectWriterCountsMatch(t);
  });

  it("keeps an Admin's edits through Send back, and the next approval files them on the new company file", async () => {
    const { t, admin } = await setup();
    await pickIndustry(admin);
    const pd = await readyPd(t);
    await approve(t, admin, [pd]);
    await admin.mutation(api.ingestion.editApprovedFile, {
      id: pd,
      patch: { pdTitle: "Cold chain drift", reviewer: { kind: "name", name: "Priya Nadeau" }, craReviewed: true, writer: { kind: "name", name: "Robin Sample" } },
    });
    const edited = await item(t, pd);
    await sendBack(admin, [pd]);
    const back = await item(t, pd);
    expect(back).toMatchObject({ pdTitle: "Cold chain drift", reviewerId: edited.reviewerId, craReviewed: true, writerId: edited.writerId, writerNameSource: "person" });
    await approve(t, admin, [pd]);
    const [file] = await companyFiles(t);
    expect(file).toMatchObject({ writerId: edited.writerId, reviewerId: edited.reviewerId });
    expect(file.importLabels).toMatchObject({ pdTitle: "Cold chain drift", craReviewed: true });
    // A title an Admin set survives a rename on the drive.
    expect(
      pathFieldsFor(`${FY}/Submitted/04 CedarlineSystems 2025-03-31 T2.DW.PN Renamed.docx`, "04 CedarlineSystems 2025-03-31 T2.DW.PN Renamed.docx", {
        editedLabels: ["pdTitle"],
        pdTitle: "Cold chain drift",
      }).pdTitle
    ).toBe("Cold chain drift");
  });
});

describe("who may send back and edit", () => {
  it("lets only Admins send back, edit and read a file's history", async () => {
    const { t, admin, writer, manager } = await setup();
    const draft = await stageRead(t, `${FY}/Drafts/Sensor notes.docx`, "Draft text");
    await approve(t, admin, [draft]);
    for (const user of [writer, manager]) {
      await expect(user.mutation(api.ingestion.sendBackToReview, { ids: [draft] })).rejects.toThrow(/Admin only/);
      await expect(user.mutation(api.ingestion.editApprovedFile, { id: draft, patch: { pdTitle: "Notes" } })).rejects.toThrow(/Admin only/);
      expect(await user.query(api.ingestion.importFileEvents, { id: draft })).toEqual([]);
    }
    await expect(t.mutation(api.ingestion.sendBackToReview, { ids: [draft] })).rejects.toThrow(/Not authenticated/);
    expect(await item(t, draft)).toMatchObject({ status: "approved" });
    await admin.mutation(api.ingestion.sendBackToReview, { ids: [draft] });
    expect(await admin.query(api.ingestion.importFileEvents, { id: draft })).toMatchObject([
      { action: "send_back", by: "Jordan Ellis", changes: [], companyFile: "removed", brain: "none" },
    ]);
  });
});
