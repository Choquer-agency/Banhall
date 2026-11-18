/// <reference types="vite/client" />
// Files approved on the old /admin/ingestion page (2026-11-18 (second),
// owner answers 4 and 5): ingestion.sendBackOldApprovals sends each back to
// review, revoking its unscrubbed Brain copy with a confirmed erasure, with
// a dry run first. Old-page rows are seeded with exactly what the old
// approval wrote (status, brainSourceId, reviewedBy, reviewedAt; no company
// file, no Brain check). Every company and person here is made up. No
// embedding runs: the embed pool's enqueue is stubbed, and fetch refuses.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ConvexError } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { api, internal } from "./_generated/api";
import { importSource } from "./brain";
import { OLD_APPROVAL_BRAIN_REASON, SEND_BACK_READ_BUDGET } from "./ingestion";
import { patchBrainSource } from "./ai/brain/rag";
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
    adminId: await ctx.db.insert("users", { authId: "old-admin", role: "admin", firstName: "Jordan", lastName: "Ellis" }),
    tracyId: await ctx.db.insert("users", { authId: "old-tracy", role: "writer", firstName: "Tracy", lastName: "Lindqvist", initials: "TL" }),
    managerId: await ctx.db.insert("users", { authId: "old-manager", role: "manager", firstName: "Lee" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "old-admin" }),
    manager: t.withIdentity({ subject: "old-manager" }),
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


/** Stages and reads a file of any kind at `path`. */
async function stageAt(t: T, path: string, text: string): Promise<Id<"ingestionItems">> {
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
  const row = (await t.run((ctx) =>
    ctx.db.query("ingestionItems").withIndex("by_driveItemId", (q) => q.eq("driveItemId", driveItemId)).unique()
  ))!;
  const { storageId, textStorageId } = await t.run(async (ctx) => ({
    storageId: await ctx.storage.store(new Blob(["original bytes"])),
    textStorageId: await ctx.storage.store(new Blob([text], { type: "text/plain" })),
  }));
  await t.mutation(internal.ingestion.markItemProcessed, { itemId: row._id, storageId, text, textStorageId });
  return row._id;
}

/**
 * What the old page's approval left (commit cc56f269^, finalizeApproval):
 * an approved file, an unscrubbed Brain copy titled with the client's name
 * (or none), who approved it and when; no company file and no Brain check.
 * Then the counts are rebuilt, as the deploy order's steps leave them.
 */
async function approveOnOldPage(
  t: T,
  adminId: Id<"users">,
  id: Id<"ingestionItems">,
  options: { copy?: boolean; sourceId?: Id<"brainSources">; content?: string } = {}
): Promise<Id<"brainSources"> | undefined> {
  const sourceId = await t.run(async (ctx) => {
    const row = (await ctx.db.get(id))!;
    let sourceId = options.sourceId;
    if (!sourceId && options.copy !== false) {
      const result = await importSource(
        ctx,
        {
          kind: "pd_pair",
          title: `${row.clientName} ${row.name}`,
          industry: "manufacturing",
          writerTier: 0.4,
          docType: "pd",
          content: options.content ?? `${row.clientName} unscrubbed text of ${row.name}`,
          approve: true,
          importItem: { itemId: id, contentHash: row.contentHash },
        },
        adminId
      );
      if (result.outcome === "revoked") throw new Error("seed refused");
      sourceId = result.sourceId;
    }
    await ctx.db.patch(id, {
      status: "approved",
      sheetTab: "approved",
      ...(sourceId ? { brainSourceId: sourceId } : {}),
      reviewedBy: adminId,
      reviewedAt: 1_700_000_000_000,
    });
    return sourceId;
  });
  return sourceId;
}

async function rebuildCounts(t: T) {
  for (const sheetTab of ["review", "approved"] as const) {
    await t.mutation(internal.ingestion.rebuildImportCompanyCounts, { sheetTab, companyKey: "cedarline systems" });
  }
  await settle(t);
}

const snapshot = (t: T) =>
  t.run(async (ctx) => ({
    items: await ctx.db.query("ingestionItems").collect(),
    sources: await ctx.db.query("brainSources").collect(),
    audit: await ctx.db.query("brainAuditLog").collect(),
    events: await ctx.db.query("importFileEvents").collect(),
  }));

const run = (t: T, actorUserId: Id<"users">, dryRun: boolean) =>
  t.mutation(internal.ingestion.sendBackOldApprovals, { actorUserId, dryRun });

describe("sending back the files approved on the old page", () => {
  async function seedMix() {
    const s = await setup();
    const { t, admin, adminId } = s;
    // Old page: a final PD and a transcript with Brain copies, a supporting file with none.
    const oldPd = await stagePd(t, 1, "TL");
    const oldTranscript = await stageAt(t, `${FY}/WIP/Technical/Audio/Lab interview.txt`, "Interview with the lab about freezer drift.");
    const oldSupporting = await stageAt(t, `${FY}/WIP/Technical/Freezer readings.txt`, "Readings at minus 30 degrees.");
    const pdSource = (await approveOnOldPage(t, adminId, oldPd))!;
    const transcriptSource = (await approveOnOldPage(t, adminId, oldTranscript))!;
    await approveOnOldPage(t, adminId, oldSupporting, { copy: false });
    // New path: waiting, kept out, and one whose company file was deleted by hand.
    const waiting = await stagePd(t, 2, "TL");
    const keptOut = await stagePd(t, 3, "TL");
    const fileGone = await stagePd(t, 4, "TL");
    await approve(t, admin, [waiting, keptOut, fileGone]);
    await admin.mutation(api.ingestion.keepOutOfBrain, { itemId: keptOut });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(fileGone))!;
      await ctx.db.delete(row.companyFileId!);
    });
    await rebuildCounts(t);
    return { ...s, oldPd, oldTranscript, oldSupporting, pdSource, transcriptSource, waiting, keptOut, fileGone };
  }

  it("a dry run counts what a real run would do and writes nothing", async () => {
    const { t, adminId } = await seedMix();
    const before = await snapshot(t);
    const result = await run(t, adminId, true);
    expect(result).toMatchObject({
      step: { found: 3, sentBack: 0, brainRevoked: 2, brainUnlinked: 0, brainAlreadyRemoved: 0, brainNone: 1, skipped: 0 },
      done: true,
    });
    expect(result.totals).toEqual(result.step);
    await settle(t);
    expect(await snapshot(t)).toEqual(before);
  });

  it("sends each back to To review with its labels, revokes its unscrubbed copy with a confirmed erasure, and leaves new-path files alone", async () => {
    const { t, adminId, oldPd, oldTranscript, oldSupporting, pdSource, transcriptSource, waiting, keptOut, fileGone } = await seedMix();
    const labelsBefore = await item(t, oldPd);
    const newBefore = await Promise.all([waiting, keptOut, fileGone].map((id) => item(t, id)));
    const result = await run(t, adminId, false);
    expect(result).toMatchObject({
      step: { found: 3, sentBack: 3, brainRevoked: 2, brainUnlinked: 0, brainAlreadyRemoved: 0, brainNone: 1, skipped: 0 },
      done: true,
    });
    expect(result.revokedCreatedBy.map((row) => row.sourceId).sort()).toEqual([pdSource, transcriptSource].sort());
    expect(result.revokedCreatedBy.every((row) => row.createdBy === adminId)).toBe(true);
    await settle(t);

    for (const id of [oldPd, oldTranscript, oldSupporting]) {
      const row = await item(t, id);
      expect(row).toMatchObject({ status: "pending_review", sheetTab: "review", sentBackBy: adminId });
      expect(row.brainSourceId).toBeUndefined();
      expect(row.reviewedBy).toBeUndefined();
      expect((await events(t, id)).map((event) => [event.action, event.userId])).toEqual([["send_back", adminId]]);
    }
    const pdAfter = await item(t, oldPd);
    for (const kept of ["clientName", "category", "fiscalYearEnd", "writerId", "reviewerId", "scienceCode", "pdNumber"] as const) {
      expect(pdAfter[kept], kept).toEqual(labelsBefore[kept]);
    }
    for (const sourceId of [pdSource, transcriptSource]) {
      const source = await t.run((ctx) => ctx.db.get(sourceId));
      expect(source).toMatchObject({ status: "revoked", revokedFromStatus: "approved" });
      const audit = await t.run(async (ctx) => (await ctx.db.query("brainAuditLog").collect()).filter((row) => row.sourceId === sourceId));
      expect(audit.find((row) => row.action === "revoke")).toMatchObject({ actorId: adminId, reason: OLD_APPROVAL_BRAIN_REASON });
      // Never embedded here, so the erasure is confirmed at once.
      expect(audit.some((row) => row.action === "unlearn_confirmed")).toBe(true);
    }
    // New-path files are untouched.
    expect(await Promise.all([waiting, keptOut, fileGone].map((id) => item(t, id)))).toEqual(newBefore);
    await expectCountsMatchRecount(t);

    // Run again: nothing left.
    expect((await run(t, adminId, false)).step).toMatchObject({ found: 0, sentBack: 0 });
  });

  it("a transcript sent back never gets a Brain copy again; a final PD gets a new one through its Brain check", async () => {
    const { t, admin, adminId, oldPd, oldTranscript, pdSource } = await seedMix();
    await run(t, adminId, false);
    await settle(t);
    await approve(t, admin, [oldPd, oldTranscript]);
    expect((await item(t, oldTranscript)).brainCheck).toBeUndefined();
    expect((await item(t, oldPd)).brainCheck).toBe("waiting");
    const newSource = await inBrain(t, admin, oldPd);
    expect(newSource).not.toBe(pdSource);
    expect(await t.run((ctx) => ctx.db.get(pdSource))).toMatchObject({ status: "revoked", sentBackItemId: oldPd });
    const fresh = (await t.run((ctx) => ctx.db.get(newSource)))!;
    expect(fresh.status).toBe("approved");
    expect(fresh.content).not.toContain("Cedarline");
  });

  it("two old-page files sharing one copy: the first only lets go, the last revokes it", async () => {
    const { t, adminId } = await setup();
    const first = await stagePd(t, 1, "TL");
    const second = await stagePd(t, 2, "TL");
    const shared = (await approveOnOldPage(t, adminId, first))!;
    await approveOnOldPage(t, adminId, second, { sourceId: shared });
    await rebuildCounts(t);
    const dry = await run(t, adminId, true);
    // Each sees the other in a dry run.
    expect(dry.step).toMatchObject({ found: 2, brainUnlinked: 2, brainRevoked: 0 });
    const real = await run(t, adminId, false);
    expect(real.step).toMatchObject({ found: 2, sentBack: 2, brainUnlinked: 1, brainRevoked: 1 });
    expect(await t.run((ctx) => ctx.db.get(shared))).toMatchObject({ status: "revoked" });
  });

  it("a copy already removed on the Brain page is left and counted; one removed for good counts as none", async () => {
    const { t, admin, adminId } = await setup();
    const revokedPd = await stagePd(t, 1, "TL");
    const gonePd = await stagePd(t, 2, "TL");
    const revoked = (await approveOnOldPage(t, adminId, revokedPd))!;
    const gone = (await approveOnOldPage(t, adminId, gonePd))!;
    await admin.mutation(api.brain.revokeSource, { sourceId: revoked });
    // Removed for good: revoked, then deleted; the file keeps the dangling id.
    await admin.mutation(api.brain.revokeSource, { sourceId: gone });
    await settle(t);
    await t.mutation(internal.brain.removeSourcePermanently, { sourceId: gone });
    await settle(t);
    await rebuildCounts(t);
    expect((await run(t, adminId, true)).step).toMatchObject({ found: 2, brainAlreadyRemoved: 1, brainNone: 1 });
    const auditBefore = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).length;
    expect((await run(t, adminId, false)).step).toMatchObject({ found: 2, sentBack: 2, brainAlreadyRemoved: 1, brainNone: 1 });
    // Nothing more was revoked.
    expect(
      (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).slice(auditBefore).filter((row) => row.action === "revoke")
    ).toEqual([]);
  });

  it("stops and writes nothing when the actor is not an Admin, or no longer one between steps", async () => {
    const { t, adminId, managerId } = await setup();
    const pd = await stagePd(t, 1, "TL");
    await approveOnOldPage(t, adminId, pd);
    await rebuildCounts(t);
    const before = await snapshot(t);
    expect(await run(t, managerId, false)).toMatchObject({ stopped: "actor_not_admin", done: true, step: { found: 0 } });
    expect(await snapshot(t)).toEqual(before);
    await t.run((ctx) => ctx.db.patch(adminId, { role: "writer" }));
    expect(
      await t.mutation(internal.ingestion.sendBackOldApprovals, { actorUserId: adminId, dryRun: false, cursor: null })
    ).toMatchObject({ stopped: "actor_not_admin" });
    expect(await snapshot(t)).toEqual(before);
  });

  it("skips, and counts, a file held by an approval still moving", async () => {
    const { t, admin, adminId } = await setup();
    const pd = await stagePd(t, 1, "TL");
    await approveOnOldPage(t, adminId, pd);
    await rebuildCounts(t);
    await t.run((ctx) =>
      ctx.db.insert("importApprovals", {
        scope: "company",
        companyKey: "cedarline systems",
        status: "running",
        startedBy: adminId,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        total: 1,
        done: 0,
        approved: 0,
        refused: 0,
      })
    );
    expect((await run(t, adminId, false)).step).toMatchObject({ found: 1, sentBack: 0, skipped: 1 });
    expect((await item(t, pd)).status).toBe("approved");
    void admin;
  });

  it("stops a step once its read budget is spent and goes on in the next, sending every file back once", async () => {
    const { t, adminId } = await setup();
    const ids: Id<"ingestionItems">[] = [];
    for (let n = 1; n <= 8; n += 1) ids.push(await stagePd(t, n, "TL"));
    const long = "An unscrubbed passage about freezer drift. ".repeat(23_000);
    expect(long.length * 8).toBeGreaterThan(SEND_BACK_READ_BUDGET);
    for (const [n, id] of ids.entries()) {
      const sourceId = (await approveOnOldPage(t, adminId, id, { content: `${n} ${long}` }))!;
      await t.run(async (ctx) => patchBrainSource(ctx, (await ctx.db.get(sourceId))!, { ragImportance: 1 }));
    }
    await rebuildCounts(t);
    const first = await run(t, adminId, false);
    expect(first.done).toBe(false);
    expect(first.step.sentBack).toBeGreaterThan(0);
    expect(first.step.sentBack).toBeLessThan(8);
    await settle(t);
    for (const id of ids) {
      expect((await item(t, id)).status).toBe("pending_review");
      expect(await events(t, id)).toHaveLength(1);
    }
    await expectCountsMatchRecount(t);
  });
});
