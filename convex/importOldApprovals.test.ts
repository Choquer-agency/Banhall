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
import { OLD_APPROVAL_BRAIN_REASON, OLD_PAGE_SAME_APPROVAL_MS, oldPageCopyOrigin, SEND_BACK_READ_BUDGET } from "./ingestion";
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
 * What the old page's approval left (finalizeApproval on origin/main): in
 * one mutation, importSource made a new "pd_pair" copy (createdBy the Admin,
 * no importItemId, which did not exist yet) or returned a copy that matched
 * its text, then the file was patched approved with brainSourceId,
 * reviewedBy and reviewedAt. No company file, no Brain check. A copy made
 * here has createdAt equal to the file's reviewedAt; a matched one
 * (`sourceId`) was made earlier, so the file's approval comes a minute after
 * it unless `approvedAt` says otherwise.
 */
async function approveOnOldPage(
  t: T,
  adminId: Id<"users">,
  id: Id<"ingestionItems">,
  options: {
    copy?: boolean;
    sourceId?: Id<"brainSources">;
    content?: string;
    kind?: "pd_pair" | "writer_feedback";
    approvedAt?: number;
    reviewedBy?: Id<"users">;
  } = {}
): Promise<Id<"brainSources"> | undefined> {
  return await t.run(async (ctx) => {
    const row = (await ctx.db.get(id))!;
    let sourceId = options.sourceId;
    let madeHere = false;
    if (!sourceId && options.copy !== false) {
      const result = await importSource(
        ctx,
        {
          kind: options.kind ?? "pd_pair",
          title: `${row.clientName} ${row.name}`,
          industry: "manufacturing",
          writerTier: 0.4,
          docType: "pd",
          content: options.content ?? `${row.clientName} unscrubbed text of ${row.name}`,
          approve: true,
        },
        adminId
      );
      if (result.outcome === "revoked") throw new Error("seed refused");
      sourceId = result.sourceId;
      madeHere = true;
    }
    const createdAt = sourceId ? (await ctx.db.get(sourceId))?.createdAt : undefined;
    const reviewedAt = options.approvedAt ?? (createdAt === undefined ? 1_700_000_000_000 : madeHere ? createdAt : createdAt + 60_000);
    await ctx.db.patch(id, {
      status: "approved",
      sheetTab: "approved",
      ...(sourceId ? { brainSourceId: sourceId } : {}),
      reviewedBy: options.reviewedBy ?? adminId,
      reviewedAt,
    });
    return sourceId;
  });
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
    // Old page: a final PD and a transcript with copies their approval made, a supporting file with none.
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

  it("a dry run reports each file's outcome and its copy's kind and times, and writes nothing", async () => {
    const { t, adminId, oldPd, oldTranscript, oldSupporting, pdSource } = await seedMix();
    const before = await snapshot(t);
    const result = await run(t, adminId, true);
    expect(result).toMatchObject({
      step: { found: 3, sentBack: 0, revoke: 2, unlinkOnly: 0, unknownOrigin: 0, held: 0, skipped: 1 },
      done: true,
    });
    expect(result.totals).toEqual(result.step);
    const lines = new Map(result.copies.map((line) => [line.itemId, line]));
    const pd = await t.run((ctx) => ctx.db.get(pdSource));
    expect(lines.get(oldPd)).toEqual({
      itemId: oldPd,
      outcome: "revoke",
      detail: "made_by_this_approval",
      sourceId: pdSource,
      kind: "pd_pair",
      docType: "pd",
      createdAt: pd!.createdAt,
      approvedAt: (await item(t, oldPd)).reviewedAt,
    });
    expect(lines.get(oldTranscript)).toMatchObject({ outcome: "revoke" });
    expect(lines.get(oldSupporting)).toMatchObject({ outcome: "skipped", detail: "no_copy" });
    await settle(t);
    expect(await snapshot(t)).toEqual(before);
  });

  it("sends each back to To review with its labels, revokes the copy its approval made with a confirmed erasure, and leaves new-path files alone", async () => {
    const { t, adminId, oldPd, oldTranscript, oldSupporting, pdSource, transcriptSource, waiting, keptOut, fileGone } = await seedMix();
    const labelsBefore = await item(t, oldPd);
    const newBefore = await Promise.all([waiting, keptOut, fileGone].map((id) => item(t, id)));
    const result = await run(t, adminId, false);
    expect(result).toMatchObject({
      step: { found: 3, sentBack: 3, revoke: 2, unlinkOnly: 0, unknownOrigin: 0, held: 0, skipped: 1 },
      done: true,
    });
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

  describe("a copy another route made is only unlinked, never revoked (review P2-2)", () => {
    it("a nomination made before the file's approval, which the old page matched: unlinked, still in the Brain, reported first", async () => {
      const { t, adminId, tracyId } = await setup();
      const nomination = await t.run(async (ctx) => {
        const result = await importSource(
          ctx,
          { kind: "pd_pair", title: "Nominated report", industry: "manufacturing", writerTier: 0.4, docType: "pd", content: "the same text", approve: true },
          tracyId
        );
        return (result as { sourceId: Id<"brainSources"> }).sourceId;
      });
      const pd = await stagePd(t, 1, "TL");
      await approveOnOldPage(t, adminId, pd, { sourceId: nomination });
      await rebuildCounts(t);
      const dry = await run(t, adminId, true);
      expect(dry.step).toMatchObject({ found: 1, revoke: 0, unlinkOnly: 1, unknownOrigin: 0 });
      const created = (await t.run((ctx) => ctx.db.get(nomination)))!.createdAt;
      expect(dry.copies).toEqual([
        {
          itemId: pd,
          outcome: "unlink_only",
          detail: "made_before_this_approval",
          sourceId: nomination,
          kind: "pd_pair",
          docType: "pd",
          createdAt: created,
          approvedAt: created + 60_000,
        },
      ]);
      const real = await run(t, adminId, false);
      expect(real.step).toMatchObject({ found: 1, sentBack: 1, revoke: 0, unlinkOnly: 1 });
      await settle(t);
      expect(await t.run((ctx) => ctx.db.get(nomination))).toMatchObject({ status: "approved" });
      expect((await item(t, pd)).status).toBe("pending_review");
      expect((await events(t, pd))[0]).toMatchObject({ action: "send_back", brain: "unlinked", brainSourceId: nomination });
      const revokes = await t.run(async (ctx) => (await ctx.db.query("brainAuditLog").collect()).filter((row) => row.action === "revoke"));
      expect(revokes).toEqual([]);
    });

    it("writer feedback and a copy naming another file are another route; a different creator at that moment is unknown origin", async () => {
      const { t, adminId, managerId } = await setup();
      const feedbackPd = await stagePd(t, 1, "TL");
      const namedPd = await stagePd(t, 2, "TL");
      const otherCreatorPd = await stagePd(t, 3, "TL");
      const noTimePd = await stagePd(t, 4, "TL");
      const feedback = (await approveOnOldPage(t, adminId, feedbackPd, { kind: "writer_feedback" }))!;
      const named = (await approveOnOldPage(t, adminId, namedPd))!;
      await t.run(async (ctx) => patchBrainSource(ctx, (await ctx.db.get(named))!, { importItemId: feedbackPd }));
      const otherCreator = (await approveOnOldPage(t, adminId, otherCreatorPd, { reviewedBy: managerId }))!;
      const noTime = (await approveOnOldPage(t, adminId, noTimePd))!;
      await t.run((ctx) => ctx.db.patch(noTimePd, { reviewedAt: undefined }));
      await rebuildCounts(t);
      const dry = await run(t, adminId, true);
      const byItem = new Map(dry.copies.map((line) => [line.itemId, [line.outcome, line.detail]]));
      expect(byItem.get(feedbackPd)).toEqual(["unlink_only", "not_an_import_copy"]);
      expect(byItem.get(namedPd)).toEqual(["unlink_only", "names_another_file"]);
      expect(byItem.get(otherCreatorPd)).toEqual(["unknown_origin", "creator_or_time_differs"]);
      expect(byItem.get(noTimePd)).toEqual(["unknown_origin", "no_approval_time"]);
      expect(dry.step).toMatchObject({ found: 4, revoke: 0, unlinkOnly: 2, unknownOrigin: 2 });
      const recorded = () => t.run((ctx) => ctx.db.query("brainOldPageCopies").collect());
      // A dry run records nothing for an Admin to decide.
      expect(await recorded()).toEqual([]);
      expect((await run(t, adminId, false)).step).toMatchObject({ sentBack: 4, revoke: 0, unlinkOnly: 2, unknownOrigin: 2 });
      await settle(t);
      for (const id of [feedback, named, otherCreator, noTime]) {
        expect((await t.run((ctx) => ctx.db.get(id)))!.status, id).toBe("approved");
      }
      // Final review P2-1: each copy left approved waits for an Admin's decision, once.
      const rows = (await recorded()).map((row) => [row.sourceId, row.outcome, row.detail, row.status]);
      expect(rows.sort()).toEqual(
        [
          [feedback, "unlink_only", "not_an_import_copy", "open"],
          [named, "unlink_only", "names_another_file", "open"],
          [otherCreator, "unknown_origin", "creator_or_time_differs", "open"],
          [noTime, "unknown_origin", "no_approval_time", "open"],
        ].sort()
      );
      await run(t, adminId, false);
      expect(await recorded()).toHaveLength(4);
    });

    it("the pure rule: the old approval's own copy, one made before, one made after, one of another kind", () => {
      const item = { _id: "item-1" as Id<"ingestionItems">, reviewedAt: 10_000, reviewedBy: "admin" as Id<"users"> };
      const copy = { kind: "pd_pair" as const, createdAt: 10_000, createdBy: "admin", importItemId: undefined };
      expect(oldPageCopyOrigin(item, copy).origin).toBe("own");
      expect(oldPageCopyOrigin(item, { ...copy, createdAt: 10_000 - OLD_PAGE_SAME_APPROVAL_MS }).origin).toBe("own");
      expect(oldPageCopyOrigin(item, { ...copy, createdAt: 10_000 - OLD_PAGE_SAME_APPROVAL_MS - 1 })).toEqual({
        origin: "other_route",
        detail: "made_before_this_approval",
      });
      expect(oldPageCopyOrigin(item, { ...copy, createdAt: 10_000 + OLD_PAGE_SAME_APPROVAL_MS + 1 }).origin).toBe("unknown");
      expect(oldPageCopyOrigin(item, { ...copy, kind: "cra_letter" }).detail).toBe("not_an_import_copy");
      expect(oldPageCopyOrigin(item, { ...copy, importItemId: "item-1" as Id<"ingestionItems"> }).origin).toBe("own");
      expect(oldPageCopyOrigin(item, { ...copy, importItemId: "item-2" as Id<"ingestionItems"> }).detail).toBe("names_another_file");
    });

    it("its own copy shared with an Import file approved on the new path is only unlinked", async () => {
      const { t, admin, adminId } = await setup();
      const oldPd = await stagePd(t, 1, "TL");
      const own = (await approveOnOldPage(t, adminId, oldPd))!;
      const newPd = await stagePd(t, 2, "TL");
      await approve(t, admin, [newPd]);
      await t.run((ctx) => ctx.db.patch(newPd, { brainSourceId: own, brainCheck: "added" }));
      await rebuildCounts(t);
      const result = await run(t, adminId, false);
      expect(result.copies.map((line) => [line.itemId, line.outcome, line.detail])).toEqual([[oldPd, "unlink_only", "shared_with_import_file"]]);
      expect(await t.run((ctx) => ctx.db.get(own))).toMatchObject({ status: "approved" });
    });
  });

  it("two old-page files sharing one copy: the one whose approval made it revokes it, in either order", async () => {
    for (const makerFirst of [true, false]) {
      const { t, adminId } = await setup();
      const first = await stagePd(t, 1, "TL");
      const second = await stagePd(t, 2, "TL");
      const [maker, matcher] = makerFirst ? [first, second] : [second, first];
      const shared = (await approveOnOldPage(t, adminId, maker))!;
      await approveOnOldPage(t, adminId, matcher, { sourceId: shared });
      await rebuildCounts(t);
      const dry = await run(t, adminId, true);
      expect(dry.step, `${makerFirst}`).toMatchObject({ found: 2, revoke: 1, unlinkOnly: 1 });
      const real = await run(t, adminId, false);
      expect(real.step.sentBack, `${makerFirst}`).toBe(2);
      expect(await t.run((ctx) => ctx.db.get(shared)), `${makerFirst}`).toMatchObject({ status: "revoked" });
    }
  });

  it("a copy already removed on the Brain page, and one removed for good, are skipped and counted", async () => {
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
    const dry = await run(t, adminId, true);
    expect(dry.step).toMatchObject({ found: 2, skipped: 2 });
    expect(dry.copies.map((line) => line.detail).sort()).toEqual(["already_removed", "no_copy"]);
    const auditBefore = (await t.run((ctx) => ctx.db.query("brainAuditLog").collect())).length;
    expect((await run(t, adminId, false)).step).toMatchObject({ found: 2, sentBack: 2, skipped: 2 });
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

  it("holds, and counts, a file an approval still moving holds", async () => {
    const { t, adminId } = await setup();
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
    const result = await run(t, adminId, false);
    expect(result.step).toMatchObject({ found: 1, sentBack: 0, held: 1 });
    expect(result.copies).toEqual([{ itemId: pd, outcome: "held", detail: "approval_running" }]);
    expect((await item(t, pd)).status).toBe("approved");
  });

  it("stops a step at its read budget and goes on in the next, sending every file back once and counting a held file once (review P3-2)", async () => {
    for (const dryRun of [false, true]) {
      const { t, adminId } = await setup();
      // First on the page: a file an approval of picked files still waits on.
      const held = await stagePd(t, 9, "TL");
      await approveOnOldPage(t, adminId, held);
      await t.run(async (ctx) => {
        const approvalId = await ctx.db.insert("importApprovals", {
          scope: "files",
          status: "running",
          startedBy: adminId,
          startedAt: Date.now(),
          updatedAt: Date.now(),
          total: 1,
          done: 0,
          approved: 0,
          refused: 0,
        });
        await ctx.db.insert("importApprovalFiles", { approvalId, itemId: held, position: 0, state: "waiting", name: "held.docx" });
      });
      const ids: Id<"ingestionItems">[] = [];
      for (let n = 1; n <= 8; n += 1) ids.push(await stagePd(t, n, "TL"));
      const long = "An unscrubbed passage about freezer drift. ".repeat(23_000);
      expect(long.length * 8).toBeGreaterThan(SEND_BACK_READ_BUDGET);
      for (const [n, id] of ids.entries()) {
        const sourceId = (await approveOnOldPage(t, adminId, id, { content: `${n} ${long}` }))!;
        await t.run(async (ctx) => patchBrainSource(ctx, (await ctx.db.get(sourceId))!, { ragImportance: 1 }));
      }
      await rebuildCounts(t);
      const first = await run(t, adminId, dryRun);
      expect(first.done, `dry run ${dryRun}`).toBe(false);
      expect(first.step.held).toBe(1);
      expect(first.step.found).toBeLessThan(9);
      // Follow the chain step by step, as the scheduler does, to read the last step's totals.
      let last = first;
      let next: { cursor: string | null; totals: typeof first.totals; passedOnPage: Id<"ingestionItems">[] } | null = null;
      for (let guard = 0; guard < 20 && !last.done; guard += 1) {
        const scheduled = await t.run(async (ctx) =>
          (await ctx.db.system.query("_scheduled_functions").collect()).filter(
            (job) => job.name.includes("sendBackOldApprovals") && job.state.kind === "pending"
          )
        );
        const job = scheduled.at(-1)!;
        const args = (job.args as Array<{ cursor: string | null; totals: typeof first.totals; passedOnPage: Id<"ingestionItems">[] }>)[0];
        next = args;
        await t.run(async (ctx) => {
          for (const pending of scheduled) await ctx.scheduler.cancel(pending._id);
        });
        last = await t.mutation(internal.ingestion.sendBackOldApprovals, {
          actorUserId: adminId,
          dryRun,
          cursor: args.cursor,
          totals: args.totals,
          passedOnPage: args.passedOnPage,
        });
      }
      expect(next, `dry run ${dryRun}`).not.toBeNull();
      expect(last.done).toBe(true);
      expect(last.totals, `dry run ${dryRun}`).toMatchObject({ found: 9, held: 1, revoke: 8, sentBack: dryRun ? 0 : 8 });
      if (!dryRun) {
        for (const id of ids) {
          expect((await item(t, id)).status).toBe("pending_review");
          expect(await events(t, id)).toHaveLength(1);
        }
        expect((await item(t, held)).status).toBe("approved");
        await expectCountsMatchRecount(t);
      }
    }
  });
});
