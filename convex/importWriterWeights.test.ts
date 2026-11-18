/// <reference types="vite/client" />
// Writer weights (2026-11-18 (second), docs/product-domain.md): the default
// 0.7 on imported Brain copies, an Admin's weight per person on Team (a
// member's own writer and the past writer linked to them kept in step), and
// the re-tier of a writer's existing Brain copies with no new embedding, in
// steps within a read budget. Every company and person here is made up. No
// embedding runs: the embed pool's enqueue is stubbed and counted, and fetch
// refuses, so nothing reaches Voyage.
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { ConvexError } from "convex/values";
import { Workpool } from "@convex-dev/workpool";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { classify } from "./lib/ingestionClassify";
import { patchBrainSource } from "./ai/brain/rag";
import { importSource } from "./brain";
import { RETIER_BRAIN_REASON, SEND_BACK_READ_BUDGET } from "./ingestion";
import { DEFAULT_WRITER_WEIGHT, WRITER_WEIGHT_RULE } from "../shared/writerWeight";
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
    adminId: await ctx.db.insert("users", { authId: "weight-admin", role: "admin", firstName: "Jordan", lastName: "Ellis" }),
    tracyId: await ctx.db.insert("users", { authId: "weight-tracy", role: "writer", firstName: "Tracy", lastName: "Lindqvist", initials: "TL" }),
    managerId: await ctx.db.insert("users", { authId: "weight-manager", role: "manager", firstName: "Lee" }),
  }));
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "weight-admin" }),
    manager: t.withIdentity({ subject: "weight-manager" }),
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

describe("the default weight", () => {
  it("is 0.7 for a writer with no weight; once an Admin sets Tracy to 1, her copies take 1", async () => {
    const { t, admin, tracyId } = await setup();
    const first = await stagePd(t, 1, "TL");
    const firstSource = await inBrain(t, admin, first);
    expect(DEFAULT_WRITER_WEIGHT).toBe(0.7);
    expect((await source(t, firstSource))!.writerTier).toBe(0.7);
    expect((await writerOf(t, first)).userId).toBe(tracyId);

    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await settle(t);
    // The copy already in the Brain is re-tiered.
    expect((await source(t, firstSource))!.writerTier).toBe(1);
    // Her next copy is made at 1.
    const second = await stagePd(t, 2, "TL");
    const secondSource = await inBrain(t, admin, second);
    expect((await source(t, secondSource))!.writerTier).toBe(1);
  });
});

describe("users.setWriterWeight", () => {
  it("is Admin only and refuses a weight that is not a number from 0 to 1, or no one or two people", async () => {
    const { t, admin, manager, tracyId } = await setup();
    const pd = await stagePd(t, 1, "DW");
    const pastWriter = await writerOf(t, pd);
    expect(await errorOf(manager.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 }))).toBe(
      "This action requires an active elevated role"
    );
    for (const weight of [Number.NaN, 1.5, -0.1, Number.POSITIVE_INFINITY]) {
      expect(await errorOf(admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight }))).toBe(WRITER_WEIGHT_RULE);
    }
    expect(await errorOf(admin.mutation(api.users.setWriterWeight, { weight: 1 }))).toBe("Choose one person to set a weight for.");
    expect(
      await errorOf(admin.mutation(api.users.setWriterWeight, { userId: tracyId, writerId: pastWriter._id, weight: 1 }))
    ).toBe("Choose one person to set a weight for.");
    // Nothing was written.
    expect(await t.run(async (ctx) => (await ctx.db.query("pdWriters").collect()).map((row) => row.tier ?? null))).toEqual([null, null]);
    // 0 and 1 are allowed.
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 0 });
    expect((await writerOf(t, pd)).tier).toBe(0);
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 1 });
    expect((await writerOf(t, pd)).tier).toBe(1);
  });

  it("makes a member's own writer row when they have none, and sets the past writer linked to them too", async () => {
    const { t, admin, tracyId, adminId } = await setup();
    await admin.mutation(api.users.setWriterWeight, { userId: adminId, weight: 0.9 });
    const own = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", adminId)).collect());
    expect(own.map((row) => [row.tier, row.linkedAt])).toEqual([[0.9, undefined]]);

    // Tracy: her own writer (from TL files) and a past writer (DW) linked to her.
    const tl = await stagePd(t, 1, "TL");
    const dw = await stagePd(t, 2, "DW");
    const pastWriter = await writerOf(t, dw);
    await admin.mutation(api.users.linkPastWriter, { writerId: pastWriter._id, userId: tracyId });
    await settle(t);
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([1, 1]);
    const members = await admin.query(api.team.listMembers, {});
    expect(members.find((row) => row._id === tracyId)?.weight).toBe(1);
    expect(members.find((row) => row._id === adminId)?.weight).toBe(0.9);
    expect(members.find((row) => row.name === "Lee")?.weight).toBeNull();

    // Null: back to the default on both rows.
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: null });
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([undefined, undefined]);
    expect((await admin.query(api.team.listMembers, {})).find((row) => row._id === tracyId)?.weight).toBeNull();
  });

  it("sets a past writer with no login, lists its weight, and refuses one linked to an account", async () => {
    const { t, admin, tracyId } = await setup();
    const dw = await stagePd(t, 1, "DW");
    const pastWriter = await writerOf(t, dw);
    const weights = async () => (await admin.query(api.users.listPastWriters, {})).map((row) => [row.label, row.weight]);
    // DW wrote it; PN, its reviewer, is a past writer too.
    expect(await weights()).toEqual([["DW", null], ["PN", null]]);
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 0.85 });
    expect(await weights()).toEqual([["DW", 0.85], ["PN", null]]);
    // An Admin's weight keeps a bare writer: it carries a person's change now.
    expect((await writerOf(t, dw)).updatedBy).toBeDefined();
    await admin.mutation(api.users.linkPastWriter, { writerId: pastWriter._id, userId: tracyId });
    expect(await errorOf(admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 1 }))).toBe(
      "This writer is linked to an account. Unlink it first."
    );
  });
});

describe("Link and Unlink keep one weight per person", () => {
  it("Link gives both rows the member's weight when set, else the past writer's; Unlink leaves them", async () => {
    const { t, admin, tracyId } = await setup();
    const tl = await stagePd(t, 1, "TL");
    const dw = await stagePd(t, 2, "DW");
    const dwSource = await inBrain(t, admin, dw);
    const pastWriter = await writerOf(t, dw);
    // Only the past writer has a weight: Tracy's own row takes it.
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 0.9 });
    await settle(t);
    expect((await source(t, dwSource))!.writerTier).toBe(0.9);
    await admin.mutation(api.users.linkPastWriter, { writerId: pastWriter._id, userId: tracyId });
    await settle(t);
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([0.9, 0.9]);

    // Unlink leaves both as they are.
    await admin.mutation(api.users.unlinkPastWriter, { writerId: pastWriter._id });
    await settle(t);
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([0.9, 0.9]);

    // Both set and different: the member's wins, and the past writer's copies follow.
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await admin.mutation(api.users.linkPastWriter, { writerId: pastWriter._id, userId: tracyId });
    await settle(t);
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([1, 1]);
    expect((await source(t, dwSource))!.writerTier).toBe(1);
  });

  it("Link when neither has a weight leaves both unset", async () => {
    const { t, admin, tracyId } = await setup();
    const tl = await stagePd(t, 1, "TL");
    const dw = await stagePd(t, 2, "DW");
    await admin.mutation(api.users.linkPastWriter, { writerId: (await writerOf(t, dw))._id, userId: tracyId });
    await settle(t);
    expect([(await writerOf(t, tl)).tier, (await writerOf(t, dw)).tier]).toEqual([undefined, undefined]);
  });
});

describe("a member's own writer row made after Link takes the linked weight (review P2-1)", () => {
  /** An invite's new account, made the way sign-up makes it (auth.ts onCreate). */
  async function acceptInvite(t: T, token: string, email: string, firstName: string, lastName: string) {
    await t.mutation(api.invites.confirmInviteNames, { token, firstName, lastName });
    await t.mutation(internal.auth.onCreate, {
      model: "user",
      doc: { _id: `auth-${firstName}`, email, name: `${firstName} ${lastName}` },
    });
    return (await t.run((ctx) => ctx.db.query("users").withIndex("by_authId", (q) => q.eq("authId", `auth-${firstName}`)).unique()))!;
  }

  it("a past writer at 1 invited and accepted: the new member's first PD and its Brain copy are at 1", async () => {
    const { t, admin } = await setup();
    const old = await stagePd(t, 1, "DW");
    const pastWriter = await writerOf(t, old);
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 1 });
    const [invite] = await admin.mutation(api.invites.createInvites, { emails: ["dana@example.com"], role: "writer", pdWriterId: pastWriter._id });
    if (invite.status !== "created") throw new Error(invite.status);
    const dana = await acceptInvite(t, invite.token, "dana@example.com", "Dana", "Whitlock");
    await settle(t);
    // Linked on acceptance; she has no own writer row yet.
    const rowsBefore = await t.run((ctx) => ctx.db.query("pdWriters").withIndex("by_userId", (q) => q.eq("userId", dana._id)).collect());
    expect(rowsBefore.map((row) => [row._id === pastWriter._id, row.tier])).toEqual([[true, 1]]);
    expect((await admin.query(api.team.listMembers, {})).find((row) => row._id === dana._id)?.weight).toBe(1);

    // Her first new PD makes her own row, at her weight.
    const fresh = await stagePd(t, 2, "DW");
    const own = await writerOf(t, fresh);
    expect(own.userId).toBe(dana._id);
    expect(own._id).not.toBe(pastWriter._id);
    expect(own.tier).toBe(1);
    const sourceId = await inBrain(t, admin, fresh);
    expect((await source(t, sourceId))!.writerTier).toBe(1);
  });

  it("an Admin's Link to a member with no PD yet, then that member's first PD: one weight", async () => {
    const { t, admin, managerId } = await setup();
    await t.run((ctx) => ctx.db.patch(managerId, { initials: "LM", firstName: "Lee", lastName: "Mbeki" }));
    const old = await stagePd(t, 1, "KT");
    const pastWriter = await writerOf(t, old);
    await admin.mutation(api.users.setWriterWeight, { writerId: pastWriter._id, weight: 0.9 });
    await admin.mutation(api.users.linkPastWriter, { writerId: pastWriter._id, userId: managerId });
    await settle(t);
    const fresh = await stagePd(t, 2, "LM");
    const own = await writerOf(t, fresh);
    expect([own.userId, own.tier]).toEqual([managerId, 0.9]);
  });
});

describe("re-tiering a writer's Brain copies", () => {
  it("moves the source and its card to the new weight with one relabel row and no new embed; a second run changes nothing", async () => {
    const { t, admin, tracyId, adminId } = await setup();
    const pd = await stagePd(t, 1, "TL");
    const sourceId = await inBrain(t, admin, pd);
    // As a finished embed leaves it: vectors at importance 1, so no re-embed is needed.
    await t.run(async (ctx) => patchBrainSource(ctx, (await ctx.db.get(sourceId))!, { ragImportance: 1 }));
    const embedsBefore = embedsQueued();
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await settle(t);
    expect((await source(t, sourceId))!.writerTier).toBe(1);
    expect((await card(t, sourceId))!.writerTier).toBe(1);
    const rows = await relabels(t, sourceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: adminId, reason: `${RETIER_BRAIN_REASON}: writerTier 0.7 → 1` });
    expect(embedsQueued()).toBe(embedsBefore);

    const writerId = (await writerOf(t, pd))._id;
    const again = await t.mutation(internal.ingestion.retierWriterBrainCopies, { writerId, cursor: null });
    expect(again).toEqual({ retiered: 0, passedOver: 1, waitingMoved: 0, done: true });
    expect(await relabels(t, sourceId)).toHaveLength(1);
  });

  it("embeds once a copy whose vectors still carry its old weight as importance", async () => {
    const { t, admin, tracyId } = await setup();
    const pd = await stagePd(t, 1, "TL");
    const sourceId = await inBrain(t, admin, pd);
    await t.run(async (ctx) => patchBrainSource(ctx, (await ctx.db.get(sourceId))!, { ragImportance: 0.7 }));
    const embedsBefore = embedsQueued();
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await settle(t);
    expect(embedsQueued()).toBe(embedsBefore + 1);
  });

  it("passes over a revoked copy and a copy that names another file as its own", async () => {
    const { t, admin, adminId, tracyId } = await setup();
    const revokedPd = await stagePd(t, 1, "TL");
    const revokedId = await inBrain(t, admin, revokedPd);
    await admin.mutation(api.brain.revokeSource, { sourceId: revokedId });
    const otherPd = await stagePd(t, 2, "DW");
    const sharedId = await inBrain(t, admin, otherPd);
    // A second approved file of Tracy's that shares DW's copy (the same PD in two files).
    const sharing = await stagePd(t, 3, "TL");
    await approve(t, admin, [sharing]);
    await t.run((ctx) => ctx.db.patch(sharing, { brainSourceId: sharedId, brainCheck: "added", brainCheckedBy: adminId }));

    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await settle(t);
    expect((await source(t, revokedId))!.writerTier).toBe(0.7);
    expect((await source(t, sharedId))!.writerTier).toBe(0.7);
    expect(await relabels(t, revokedId)).toEqual([]);
    expect(await relabels(t, sharedId)).toEqual([]);
  });

  it("never re-tiers a copy that names no file: one made on the old page, or a nomination the file only matched (review P3-1)", async () => {
    const { t, admin, adminId, tracyId } = await setup();
    // As the old page left it: an approved file pointing at a copy with no importItemId.
    const oldPage = await stagePd(t, 1, "TL");
    const nominated = await stagePd(t, 2, "TL");
    const [oldCopy, nomination] = await t.run(async (ctx) => {
      const make = async (label: string, kind: "pd_pair" | "writer_feedback") =>
        (await importSource(
          ctx,
          { kind, title: `Copy ${label}`, industry: "manufacturing", writerTier: 0.4, docType: "pd", content: `text of ${label}`, approve: true },
          adminId
        )) as { outcome: string; sourceId: Id<"brainSources"> };
      return [(await make("old page", "pd_pair")).sourceId, (await make("nomination", "writer_feedback")).sourceId];
    });
    await t.run(async (ctx) => {
      await ctx.db.patch(oldPage, { status: "approved", sheetTab: "approved", brainSourceId: oldCopy, reviewedBy: adminId, reviewedAt: 1 });
      await ctx.db.patch(nominated, { status: "approved", sheetTab: "approved", brainSourceId: nomination, reviewedBy: adminId, reviewedAt: 1 });
    });
    for (const id of [oldCopy, nomination]) expect((await card(t, id))!.importItemId).toBeUndefined();
    const embedsBefore = embedsQueued();
    await admin.mutation(api.users.setWriterWeight, { userId: tracyId, weight: 1 });
    await settle(t);
    for (const id of [oldCopy, nomination]) {
      expect((await source(t, id))!.writerTier).toBe(0.4);
      expect(await relabels(t, id)).toEqual([]);
    }
    expect(embedsQueued()).toBe(embedsBefore);
  });

  it("stops a step once its read budget is spent and goes on in the next, reaching every copy once", async () => {
    const { t, admin, tracyId } = await setup();
    const ids: Id<"ingestionItems">[] = [];
    for (let n = 1; n <= 8; n += 1) ids.push(await stagePd(t, n, "TL"));
    await approve(t, admin, ids);
    const sources: Id<"brainSources">[] = [];
    for (const id of ids) sources.push(await inBrain(t, admin, id));
    // Each copy's whole text is near 1 MiB, as a long PD's is: eight pass the budget.
    const long = "A long passage about freezer drift. ".repeat(28_000);
    expect(long.length * 8).toBeGreaterThan(SEND_BACK_READ_BUDGET);
    await t.run(async (ctx) => {
      for (const id of sources) await patchBrainSource(ctx, (await ctx.db.get(id))!, { content: long, ragImportance: 1 });
    });
    await t.run(async (ctx) => {
      const writer = (await ctx.db.get(ids[0]))!.writerId!;
      await ctx.db.patch(writer, { tier: 1 });
    });
    const writerId = (await writerOf(t, ids[0]))._id;
    const first = await t.mutation(internal.ingestion.retierWriterBrainCopies, { writerId, cursor: null });
    expect(first.done).toBe(false);
    expect(first.retiered).toBeGreaterThan(0);
    expect(first.retiered).toBeLessThan(8);
    await settle(t);
    for (const id of sources) {
      expect((await source(t, id))!.writerTier).toBe(1);
      expect(await relabels(t, id)).toHaveLength(1);
    }
    void tracyId;
  });

  it("stops when the writer is gone", async () => {
    const { t, admin } = await setup();
    const pd = await stagePd(t, 1, "DW");
    const writerId = (await writerOf(t, pd))._id;
    await admin.mutation(api.ingestion.removeItems, { ids: [pd] });
    await t.run(async (ctx) => {
      if (await ctx.db.get(writerId)) await ctx.db.delete(writerId);
    });
    expect(await t.mutation(internal.ingestion.retierWriterBrainCopies, { writerId, cursor: null })).toEqual({
      retiered: 0,
      passedOver: 0,
      waitingMoved: 0,
      done: true,
    });
  });
});
