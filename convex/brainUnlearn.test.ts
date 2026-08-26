/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { brain } from "./ai/brain/rag";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type SourceStatus = "pending" | "approved" | "revoked";

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "brain-admin",
      role: "admin",
      name: "Admin",
    });
  });
  return { t, admin: t.withIdentity({ subject: "brain-admin" }) };
}

async function insertSource(
  t: ReturnType<typeof convexTest>,
  opts: { status: SourceStatus; ragEntryId?: string },
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("brainSources", {
      kind: "pd_pair",
      status: opts.status,
      title: "Gold PD",
      industry: "software",
      writerTier: 1,
      docType: "pd",
      content: "Technological uncertainty about distributed cache coherence.",
      ragKey: `pd:${opts.status}:${opts.ragEntryId ?? "none"}`,
      ragEntryId: opts.ragEntryId,
      sourceHash: `hash-${opts.status}-${opts.ragEntryId ?? "none"}`,
      createdBy: "brain-admin",
      createdAt: Date.now(),
    }),
  );
}

async function allRows<T extends "brainSources" | "brainAuditLog" | "aiUsage">(
  t: ReturnType<typeof convexTest>,
  table: T,
) {
  return await t.run(async (ctx) => {
    const rows = [];
    for await (const row of ctx.db.query(table)) rows.push(row);
    return rows;
  });
}

/** Pending unlearn jobs scheduled by the mutation under test. */
async function scheduledUnlearns(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name.includes("unlearnSource"));
  });
}

describe("revokeSource scheduling", () => {
  // Scheduled jobs are timers; drop them so they cannot fire (against the real
  // RAG component) inside a later test that drains its own scheduler.
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  test("revoking an embedded source schedules unlearnSource with ragEntryId and sourceId", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: "e1",
    });

    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "stale" });

    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.status).toBe("revoked");
    // Not cleared here: it clears on confirmation, after the vector is gone.
    expect(row?.ragEntryId).toBe("e1");

    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "revoke", sourceId });

    const jobs = await scheduledUnlearns(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state.kind).toBe("pending");
    expect(jobs[0].args[0]).toMatchObject({ ragEntryId: "e1", sourceId });
  });

  test("revoking an already-revoked source is a no-op: no second job, no duplicate audit row", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: "e1",
    });

    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "stale" });
    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "again" });

    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(await scheduledUnlearns(t)).toHaveLength(1);
  });

  test("revoking a never-embedded source schedules nothing and confirms nothing", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, { status: "approved" });

    await admin.mutation(api.brain.revokeSource, { sourceId });

    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "revoke", sourceId });
    expect(audit.some((r) => r.action === "unlearn_confirmed")).toBe(false);
    expect(await scheduledUnlearns(t)).toHaveLength(0);
  });

  test("removeSourcePermanently schedules unlearnSource with sourceId", async () => {
    const { t } = await setup();
    const pendingId = await insertSource(t, {
      status: "pending",
      ragEntryId: "e-old",
    });
    await t.mutation(internal.brain.removeSourcePermanently, {
      sourceId: pendingId,
    });
    const jobs = await scheduledUnlearns(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({
      ragEntryId: "e-old",
      sourceId: pendingId,
    });
    expect(await allRows(t, "brainSources")).toHaveLength(0);
    // requeueAllApprovedEmbeds deliberately omits sourceId (re-embed, not
    // erasure); it enqueues through the workpool component, so that path is
    // verified by inspection rather than here.
  });
});

describe("unlearnSource", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("with sourceId: deletes the vector, then confirms (ragEntryId cleared, audit row)", async () => {
    const { t, admin } = await setup();
    const del = vi.spyOn(brain, "delete").mockResolvedValue(undefined);
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: "e1",
    });
    vi.useFakeTimers();
    await admin.mutation(api.brain.revokeSource, { sourceId, reason: "stale" });

    // Drain the job revokeSource scheduled, end to end.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    expect(del).toHaveBeenCalledTimes(1);
    expect(del.mock.calls[0][1]).toMatchObject({ entryId: "e1" });
    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBeUndefined();
    const audit = await allRows(t, "brainAuditLog");
    expect(audit.map((r) => r.action)).toEqual(["revoke", "unlearn_confirmed"]);
    expect(audit[1]).toMatchObject({ sourceId, actorId: "system" });
    expect(audit[1].reason).toContain("e1");
    const revoked = await admin.query(api.brain.listBrainSources, {
      status: "revoked",
    });
    expect(revoked?.find((s) => s._id === sourceId)?.hasEntry).toBe(false);
  });

  test("without sourceId (requeue path): deletes the vector only, no audit row, no patch", async () => {
    const { t } = await setup();
    const del = vi.spyOn(brain, "delete").mockResolvedValue(undefined);
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: "e1",
    });

    await t.action(internal.brain.unlearnSource, { ragEntryId: "e1" });

    expect(del).toHaveBeenCalledTimes(1);
    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBe("e1");
    expect(await allRows(t, "brainAuditLog")).toHaveLength(0);
  });

  test("a failed delete is never confirmed: ragEntryId stays, no audit row, error propagates", async () => {
    const { t } = await setup();
    vi.spyOn(brain, "delete").mockRejectedValue(new Error("component down"));
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: "e1",
    });

    await expect(
      t.action(internal.brain.unlearnSource, { ragEntryId: "e1", sourceId }),
    ).rejects.toThrow(/component down/);

    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBe("e1");
    expect(await allRows(t, "brainAuditLog")).toHaveLength(0);
  });
});

describe("confirmUnlearn", () => {
  test("clears ragEntryId and writes an unlearn_confirmed audit row", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: "e1",
    });

    await t.mutation(internal.brain.confirmUnlearn, {
      sourceId,
      ragEntryId: "e1",
    });

    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBeUndefined();
    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "unlearn_confirmed",
      sourceId,
      actorId: "system",
    });
    expect(audit[0].reason).toContain("e1");

    const revoked = await admin.query(api.brain.listBrainSources, {
      status: "revoked",
    });
    expect(revoked?.find((s) => s._id === sourceId)?.hasEntry).toBe(false);
  });

  test("does not clobber a newer ragEntryId from a re-ingest", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: "e2",
    });

    await t.mutation(internal.brain.confirmUnlearn, {
      sourceId,
      ragEntryId: "e1",
    });

    const row = await t.run((ctx) => ctx.db.get(sourceId));
    expect(row?.ragEntryId).toBe("e2");
    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "unlearn_confirmed", sourceId });
    expect(audit[0].reason).toContain("e1");
  });

  test("still writes the audit row when the source row was deleted", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "pending",
      ragEntryId: "e1",
    });
    await t.run((ctx) => ctx.db.delete(sourceId));

    await expect(
      t.mutation(internal.brain.confirmUnlearn, { sourceId, ragEntryId: "e1" }),
    ).resolves.toBeNull();

    const audit = await allRows(t, "brainAuditLog");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "unlearn_confirmed", sourceId });
    expect(await allRows(t, "brainSources")).toHaveLength(0);
  });
});

describe("embedSource on non-approved sources", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function expectSkipped(
    t: ReturnType<typeof convexTest>,
    sourceId: Id<"brainSources">,
  ) {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The handler returns undefined; Convex serializes a void result as null
    // on the wire, so the client-observed value is null.
    const result = await t.action(internal.ai.brain.ingest.embedSource, {
      sourceId,
    });
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/brain embed skipped/);
    expect(await allRows(t, "aiUsage")).toHaveLength(0);
    expect(await allRows(t, "brainAuditLog")).toHaveLength(0);
  }

  test("revoked row: resolves, warns once, no usage or audit rows", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: "e1",
    });
    await expectSkipped(t, sourceId);
  });

  test("pending row: resolves, warns once, no usage or audit rows", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "pending" });
    await expectSkipped(t, sourceId);
  });

  test("deleted row: resolves, warns once, no usage or audit rows", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "approved" });
    await t.run((ctx) => ctx.db.delete(sourceId));
    await expectSkipped(t, sourceId);
  });
});
