/// <reference types="vite/client" />
// The Brain check owner answers (2026-11-18 (second), docs/product-domain.md):
// "Put back in Brain check" undoes Keep out (Admins only), and the Brain
// check lists the last three fiscal years first, then writers by highest
// weight. Every company and person here is made up. No embedding runs: the
// embed pool's enqueue is stubbed, and fetch refuses, so nothing reaches
// Voyage.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ConvexError } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import { addShare, countShareOf, countsOf, emptyImportCounts } from "./lib/importCompanyCounts";
import type { ImportCounts } from "./lib/ingestionSheetValidators";
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

async function setup() {
  const t = convexTest(schema, modules);
  t.registerComponent("embedPool", workpoolSchema, workpoolModules);
  const ids = await t.run(async (ctx) => ({
    adminId: await ctx.db.insert("users", { authId: "check-admin", role: "admin", firstName: "Jordan", lastName: "Ellis" }),
    tracyId: await ctx.db.insert("users", { authId: "check-tracy", role: "writer", firstName: "Tracy", lastName: "Lindqvist", initials: "TL" }),
    managerId: await ctx.db.insert("users", { authId: "check-manager", role: "manager", firstName: "Lee" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "check-admin" }),
    manager: t.withIdentity({ subject: "check-manager" }),
  };
}

const FY = "Cedarline Systems/2025 - Mar 31";
const pdPath = (n: number, initials: string) =>
  `${FY}/Submitted/${String(n).padStart(2, "0")} CedarlineSystems 2025-03-31 T2.${initials}.PN ColdChainSensorDrift${n}.docx`;
const pdText = (n: number) =>
  [
    `Cedarline Systems built cold chain sensor number ${n} that drifts less in freezers.`,
    "Field of science or technology: 2.02.09",
    `We tested the sensor at minus ${20 + n} degrees for six weeks.`,
  ].join("\n");

async function stagePd(t: T, n: number, initials: string): Promise<Id<"ingestionItems">> {
  const path = pdPath(n, initials);
  const segments = path.split("/");
  const name = segments.pop()!;
  const meta = classify(segments.join("/"), name);
  const driveItemId = `drive-${path}`;
  await t.mutation(internal.ingestion.upsertDiscoveredItem, {
    driveItemId,
    path,
    name,
    clientName: meta.clientName,
    fiscalYearLabel: meta.fiscalYearLabel,
    fiscalYear: meta.fiscalYear,
    docKind: meta.docKind,
    size: 2048,
    lastModifiedAt: 1_700_000_000_000,
    contentHash: `bytes-${path}`,
    pairGroupKey: meta.pairGroupKey,
  });
  const row = await t.run((ctx) =>
    ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique()
  );
  const text = pdText(n);
  const { storageId, textStorageId } = await t.run(async (ctx) => ({
    storageId: await ctx.storage.store(new Blob(["original bytes"])),
    textStorageId: await ctx.storage.store(new Blob([text], { type: "text/plain" })),
  }));
  await t.mutation(internal.ingestion.markItemProcessed, {
    itemId: row!._id,
    storageId,
    text,
    textStorageId,
    documentScienceCode: "2.02.09",
  });
  return row!._id;
}

async function approve(t: T, admin: Admin, ids: Id<"ingestionItems">[]) {
  const known = await t.run((ctx) => ctx.db.query("clients").withIndex("by_nameKey", (q) => q.eq("nameKey", "cedarline systems")).first());
  if (!known) await admin.mutation(api.ingestion.setNewCompanyIndustry, { companyKey: "cedarline systems", industry: "manufacturing" });
  await admin.mutation(api.ingestion.approveFiles, { ids });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

async function inBrain(t: T, admin: Admin, id: Id<"ingestionItems">): Promise<Id<"brainSources">> {
  if ((await item(t, id)).status !== "approved") await approve(t, admin, [id]);
  const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: id, alsoRemove: [] });
  if (!preview.ok) throw new Error(`no preview: ${preview.reason}`);
  const added = await admin.action(api.ingestion.addToBrain, { itemId: id, alsoRemove: [], seen: preview.seen });
  if (!added.ok) throw new Error(`not added: ${added.reason}`);
  return added.sourceId;
}

async function item(t: T, id: Id<"ingestionItems">): Promise<Doc<"ingestionItems">> {
  const row = await t.run((ctx) => ctx.db.get(id));
  if (!row) throw new Error("item missing");
  return row;
}

const writerOf = async (t: T, id: Id<"ingestionItems">) => (await t.run(async (ctx) => ctx.db.get((await ctx.db.get(id))!.writerId!)))!;
const source = (t: T, id: Id<"brainSources">) => t.run((ctx) => ctx.db.get(id));
const card = (t: T, id: Id<"brainSources">) =>
  t.run((ctx) => ctx.db.query("brainSourceCards").withIndex("by_sourceId", (q) => q.eq("sourceId", id)).unique());
const relabels = (t: T, id: Id<"brainSources">) =>
  t.run(async (ctx) =>
    (await ctx.db.query("brainAuditLog").collect()).filter((row) => row.sourceId === id && row.action === "relabel")
  );
const embedsQueued = () => enqueue.mock.calls.length;

const settle = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);

function refusal(err: unknown) {
  return err instanceof ConvexError ? (err.data as { code: string; message: string }) : null;
}
const errorOf = async (promise: Promise<unknown>) => refusal(await promise.catch((e: unknown) => e))?.message;

/** Every company band equals a recount of its files (the Brain check count included). */
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

const events = (t: T, itemId: Id<"ingestionItems">) =>
  t.run((ctx) => ctx.db.query("importFileEvents").withIndex("by_itemId_and_at", (q) => q.eq("itemId", itemId)).collect());

const waitingIds = async (admin: Admin) =>
  (await admin.query(api.ingestion.brainCheckFiles, { paginationOpts: { cursor: null, numItems: 25 } })).page.map((row) => row._id);

describe("Put back in Brain check", () => {
  it("puts a kept out final PD back to waiting, counts it again, and writes one event", async () => {
    const { t, admin, adminId } = await setup();
    const pd = await stagePd(t, 1, "TL");
    await approve(t, admin, [pd]);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: pd });
    expect(await item(t, pd)).toMatchObject({ brainCheck: "kept_out", brainCheckedBy: adminId });
    expect(await waitingIds(admin)).toEqual([]);
    const band = async () =>
      (await t.run((ctx) => ctx.db.query("importCompanies").collect())).find((row) => row.sheetTab === "approved")?.brainCheck ?? 0;
    expect(await band()).toBe(0);

    const result = await admin.mutation(api.ingestion.reopenBrainCheck, { ids: [pd, pd] });
    expect(result).toEqual({ reopened: [pd], refused: [] });
    const after = await item(t, pd);
    expect(after).toMatchObject({ status: "approved", brainCheck: "waiting" });
    expect(after.brainCheckedBy).toBeUndefined();
    expect(after.brainCheckedAt).toBeUndefined();
    expect(after.companyFileId).toBeDefined();
    expect(await band()).toBe(1);
    await expectCountsMatchRecount(t);
    expect(await waitingIds(admin)).toEqual([pd]);
    expect((await events(t, pd)).map((row) => [row.action, row.userId])).toEqual([["reopen_brain_check", adminId]]);
    expect((await admin.query(api.ingestion.importFileEvents, { id: pd })).map((row) => [row.action, row.by])).toEqual([
      ["reopen_brain_check", "Jordan Ellis"],
    ]);

    // It can be checked and added now, like any waiting PD.
    const preview = await admin.action(api.ingestion.previewBrainCopy, { itemId: pd, alsoRemove: [] });
    expect(preview.ok).toBe(true);
    if (!preview.ok) return;
    const added = await admin.action(api.ingestion.addToBrain, { itemId: pd, alsoRemove: [], seen: preview.seen });
    expect(added.ok).toBe(true);
    await expectCountsMatchRecount(t);
  });

  it("refuses, by file, one that is waiting, added, not a final PD, not approved or gone, and changes nothing", async () => {
    const { t, admin } = await setup();
    const waiting = await stagePd(t, 1, "TL");
    const added = await stagePd(t, 2, "TL");
    const onReview = await stagePd(t, 3, "TL");
    const transcriptPath = `${FY}/WIP/Technical/Audio/Interview with the lab.txt`;
    const segments = transcriptPath.split("/");
    const name = segments.pop()!;
    const meta = classify(segments.join("/"), name);
    await t.mutation(internal.ingestion.upsertDiscoveredItem, {
      driveItemId: "drive-transcript",
      path: transcriptPath,
      name,
      clientName: meta.clientName,
      fiscalYearLabel: meta.fiscalYearLabel,
      fiscalYear: meta.fiscalYear,
      docKind: meta.docKind,
      size: 10,
      lastModifiedAt: 1,
      contentHash: "bytes-transcript",
      pairGroupKey: meta.pairGroupKey,
    });
    const transcript = (await t.run((ctx) =>
      ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", "drive-transcript")).unique()
    ))!._id;
    await t.run((ctx) => ctx.db.patch(transcript, { status: "approved", sheetTab: "approved", category: "transcript", brainCheck: "kept_out" }));
    await approve(t, admin, [waiting, added]);
    await inBrain(t, admin, added);
    const gone = await stagePd(t, 4, "TL");
    await t.run((ctx) => ctx.db.delete(gone));

    const before = await t.run((ctx) => ctx.db.query("ingestionItems").collect());
    const result = await admin.mutation(api.ingestion.reopenBrainCheck, { ids: [waiting, added, onReview, transcript, gone] });
    expect(result).toEqual({
      reopened: [],
      refused: [
        { id: waiting, reason: "not_kept_out" },
        { id: added, reason: "not_kept_out" },
        { id: onReview, reason: "not_approved" },
        { id: transcript, reason: "not_final_pd" },
        { id: gone, reason: "missing" },
      ],
    });
    expect(await t.run((ctx) => ctx.db.query("ingestionItems").collect())).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("importFileEvents").collect())).toEqual([]);
  });

  it("is Admin only, and takes 1 to 100 files", async () => {
    const { t, admin, manager } = await setup();
    const pd = await stagePd(t, 1, "TL");
    await approve(t, admin, [pd]);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: pd });
    await expect(manager.mutation(api.ingestion.reopenBrainCheck, { ids: [pd] })).rejects.toThrow("Admin only");
    expect(await errorOf(admin.mutation(api.ingestion.reopenBrainCheck, { ids: [] }))).toBe("Select at least one file.");
    expect(await errorOf(admin.mutation(api.ingestion.reopenBrainCheck, { ids: Array(101).fill(pd) }))).toBe(
      "Put back up to 100 files at a time."
    );
    expect((await item(t, pd)).brainCheck).toBe("kept_out");
  });

  it("a PD sent back meanwhile is refused as no longer approved", async () => {
    const { t, admin } = await setup();
    const pd = await stagePd(t, 1, "TL");
    await approve(t, admin, [pd]);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: pd });
    await admin.mutation(api.ingestion.sendBackToReview, { ids: [pd] });
    expect(await admin.mutation(api.ingestion.reopenBrainCheck, { ids: [pd] })).toEqual({
      reopened: [],
      refused: [{ id: pd, reason: "not_approved" }],
    });
  });
});
