/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { brain } from "./ai/brain/rag";
import type { EraseOutcome } from "./ai/brain/erase";
import { UNLEARN_RETRY_BASE_MS } from "./brain";

// convex-test has no registration for the `rag` component, and registering it
// would demand real embeddings. Mocking the erase seam (the pattern in
// generationEntryFailure.test.ts) makes every branch of the confirmed-erasure
// contract deterministic.
const eraseMock = vi.hoisted(() =>
  vi.fn<(ctx: unknown, entryId: string) => Promise<EraseOutcome>>()
);
vi.mock("./ai/brain/erase", () => ({ eraseBrainEntry: eraseMock }));

const modules = import.meta.glob("./**/*.ts");

const RAG_KEY = "brain:unlearn-fixture";
const ENTRY_ID = "entry_fixture_1";

beforeEach(() => {
  eraseMock.mockReset();
  eraseMock.mockResolvedValue("confirmed");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("users", {
      authId: "unlearn-admin",
      role: "admin",
      name: "Admin",
    });
  });
  return { t, admin: t.withIdentity({ subject: "unlearn-admin" }) };
}

async function insertSource(
  t: ReturnType<typeof convexTest>,
  overrides: {
    status?: "pending" | "approved" | "revoked";
    ragEntryId?: string;
    ragKey?: string;
  } = {}
) {
  return await t.run(async (ctx) =>
    ctx.db.insert("brainSources", {
      kind: "pd_pair" as const,
      status: overrides.status ?? ("approved" as const),
      title: "Fixture PD",
      industry: "software",
      writerTier: 1,
      docType: "pd",
      content: "A gold project description.",
      ragKey: overrides.ragKey ?? RAG_KEY,
      ...(overrides.ragEntryId ? { ragEntryId: overrides.ragEntryId } : {}),
      sourceHash: "hash-1",
      createdBy: "unlearn-admin",
      createdAt: Date.now(),
    })
  );
}

async function auditRows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const rows = [];
    for await (const row of ctx.db.query("brainAuditLog")) rows.push(row);
    return rows;
  });
}

function actions<T extends { action: string }>(rows: T[], action: string): T[] {
  return rows.filter((r) => r.action === action);
}

async function sourceRow(
  t: ReturnType<typeof convexTest>,
  sourceId: Id<"brainSources">
) {
  return await t.run(async (ctx) => ctx.db.get(sourceId));
}

/** Pending unlearn jobs queued by the code under test. */
async function scheduledUnlearns(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name.includes("unlearnSource"));
  });
}

type UnlearnArgs = {
  ragEntryId: string;
  sourceId?: Id<"brainSources">;
  attempt?: number;
};

/**
 * Run every `unlearnSource` job scheduled so far, once each. convex-test does
 * not execute scheduled jobs on its own, and draining until the queue is empty
 * would run the whole remediation ladder synchronously (each failure schedules
 * the next attempt) — so each job id runs at most once and its rejection is
 * handed back to the test.
 */
function unlearnDrain(t: ReturnType<typeof convexTest>) {
  const seen = new Set<string>();
  return async () => {
    const jobs = (await scheduledUnlearns(t)).filter(
      (job) => !seen.has(job._id)
    );
    for (const job of jobs) seen.add(job._id);
    for (const job of jobs) {
      await t.action(internal.brain.unlearnSource, job.args[0] as UnlearnArgs);
    }
    return jobs.length;
  };
}

/** Scheduled unlearn jobs with their args and firing time, for retry assertions. */
async function unlearnJobArgs(t: ReturnType<typeof convexTest>) {
  const jobs = await scheduledUnlearns(t);
  return jobs.map((job) => ({
    scheduledTime: job.scheduledTime,
    args: job.args[0] as UnlearnArgs,
  }));
}

async function scheduledJobNames(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.map((job) => job.name);
  });
}

const NAMESPACE = {
  namespaceId: "ns_1" as never,
  createdAt: Date.now(),
  namespace: "brain",
  status: "ready" as const,
  filterNames: ["industryApproved", "docType"],
  dimension: 1024,
  modelId: "voyage-3-large",
  version: 1,
};

function completionEntry(key: string, entryId = ENTRY_ID) {
  return {
    key,
    title: "Fixture PD",
    metadata: { sourceId: "unused" },
    entryId: entryId as never,
    importance: 1,
    filterValues: [
      { name: "industryApproved", value: { industry: "software", approved: true } },
      { name: "docType", value: "pd" },
    ],
    contentHash: "hash-1",
    status: "ready" as const,
  };
}

describe("confirmed unlearn (CAP-10)", () => {
  test("(a) revoke with a live entry confirms erasure and clears the evidence", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });

    await admin.mutation(api.brain.revokeSource, { sourceId });
    await drain();

    expect(eraseMock).toHaveBeenCalledTimes(1);
    expect(eraseMock.mock.calls[0][1]).toBe(ENTRY_ID);
    const row = await sourceRow(t, sourceId);
    expect(row?.status).toBe("revoked");
    expect(row?.ragEntryId).toBeUndefined();
    const rows = await auditRows(t);
    expect(actions(rows, "revoke")).toHaveLength(1);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(1);
    expect(actions(rows, "unlearn_failed")).toHaveLength(0);
  });

  test("(b) revoke with no entry id records a confirmed unlearn with no remote call", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    const sourceId = await insertSource(t);

    await admin.mutation(api.brain.revokeSource, { sourceId });
    await drain();

    expect(eraseMock).not.toHaveBeenCalled();
    const row = await sourceRow(t, sourceId);
    expect(row?.status).toBe("revoked");
    expect(row?.ragEntryId).toBeUndefined();
    const rows = await auditRows(t);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(1);
  });

  test("(b') an already-absent entry is treated as confirmed", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    eraseMock.mockResolvedValue("already_absent");
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });

    await admin.mutation(api.brain.revokeSource, { sourceId });
    await drain();

    const row = await sourceRow(t, sourceId);
    expect(row?.ragEntryId).toBeUndefined();
    expect(actions(await auditRows(t), "unlearn_confirmed")).toHaveLength(1);
  });

  test("(c) a failed erasure retains the evidence, records the failure and reschedules deletion only", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    eraseMock.mockRejectedValue(new Error("rag unreachable"));
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });

    await admin.mutation(api.brain.revokeSource, { sourceId });
    const before = Date.now();
    await expect(drain()).rejects.toThrow();
    const after = Date.now();

    const row = await sourceRow(t, sourceId);
    expect(row?.status).toBe("revoked");
    expect(row?.ragEntryId).toBe(ENTRY_ID);
    const rows = await auditRows(t);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(0);
    const failed = actions(rows, "unlearn_failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toContain("rag unreachable");

    // Remediation is deletion only...
    const names = await scheduledJobNames(t);
    expect(names.some((n) => n.includes("unlearnSource"))).toBe(true);
    expect(names.some((n) => n.includes("embedSource"))).toBe(false);

    // ...and it ESCALATES: the retry carries attempt + 1 and backs off. A retry
    // that re-sent the same attempt would loop at the base delay forever and
    // write an unbounded stream of unlearn_failed rows.
    const jobs = await unlearnJobArgs(t);
    expect(jobs).toHaveLength(2);
    const retry = jobs.filter((j) => j.args.attempt === 2);
    expect(retry).toHaveLength(1);
    expect(retry[0].args.ragEntryId).toBe(ENTRY_ID);
    expect(retry[0].args.sourceId).toBe(sourceId);
    expect(retry[0].scheduledTime).toBeGreaterThanOrEqual(
      before + UNLEARN_RETRY_BASE_MS
    );
    expect(retry[0].scheduledTime).toBeLessThanOrEqual(
      after + UNLEARN_RETRY_BASE_MS
    );
  });

  test("(c') remediation stops at the cap", async () => {
    const { t } = await setup();
    eraseMock.mockRejectedValue(new Error("still failing"));
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: ENTRY_ID,
    });

    await expect(
      t.action(internal.brain.unlearnSource, {
        ragEntryId: ENTRY_ID,
        sourceId,
        attempt: 5,
      })
    ).rejects.toThrow("still failing");

    expect(await scheduledUnlearns(t)).toHaveLength(0);
  });

  test("(d) a second revoke is a no-op once erasure is confirmed", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });

    await admin.mutation(api.brain.revokeSource, { sourceId });
    await drain();
    await admin.mutation(api.brain.revokeSource, { sourceId });
    await drain();

    expect(eraseMock).toHaveBeenCalledTimes(1);
    const rows = await auditRows(t);
    expect(actions(rows, "revoke")).toHaveLength(1);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(1);
  });

  test("repeated pre-drain revokes and confirmation deliveries confirm an entry once", async () => {
    const { t, admin } = await setup();
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });
    await Promise.all([
      admin.mutation(api.brain.revokeSource, { sourceId }),
      admin.mutation(api.brain.revokeSource, { sourceId }),
    ]);
    expect(await scheduledUnlearns(t)).toHaveLength(2);
    eraseMock.mockResolvedValueOnce("confirmed").mockResolvedValue("already_absent");
    await unlearnDrain(t)();
    await Promise.all([
      t.mutation(internal.brain.recordUnlearnConfirmed, { sourceId, ragEntryId: ENTRY_ID }),
      t.mutation(internal.brain.recordUnlearnConfirmed, { sourceId, ragEntryId: ENTRY_ID }),
    ]);
    expect(actions(await auditRows(t), "revoke")).toHaveLength(1);
    expect(actions(await auditRows(t), "unlearn_confirmed")).toHaveLength(1);
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBeUndefined();
  });

  test("successful remediation fences a stale failure without losing earlier evidence", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "revoked", ragEntryId: ENTRY_ID });
    eraseMock.mockRejectedValueOnce(new Error("initial outage"));
    await expect(t.action(internal.brain.unlearnSource, {
      sourceId, ragEntryId: ENTRY_ID,
    })).rejects.toThrow("initial outage");
    await unlearnDrain(t)();
    const jobs = await scheduledUnlearns(t);
    eraseMock.mockRejectedValueOnce(new Error("stale failure"));
    await expect(t.action(internal.brain.unlearnSource, {
      sourceId, ragEntryId: ENTRY_ID,
    })).rejects.toThrow("stale failure");
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBeUndefined();
    expect(await scheduledUnlearns(t)).toEqual(jobs);
    const rows = await auditRows(t);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(1);
    expect(actions(rows, "unlearn_failed")).toHaveLength(1);
    expect(actions(rows, "unlearn_failed")[0].reason).toContain("initial outage");
  });

  test("an overlapping erase failure cannot undo another attempt's confirmation", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "revoked", ragEntryId: ENTRY_ID });
    let releaseFailure = () => {};
    let signalStarted = () => {};
    const started = new Promise<void>((resolve) => { signalStarted = resolve; });
    eraseMock.mockImplementationOnce(() => new Promise<EraseOutcome>((_resolve, reject) => {
      releaseFailure = () => reject(new Error("overlapping failure"));
      signalStarted();
    }));
    const failure = expect(t.action(internal.brain.unlearnSource, {
      sourceId, ragEntryId: ENTRY_ID,
    })).rejects.toThrow("overlapping failure");
    await started;
    await t.action(internal.brain.unlearnSource, { sourceId, ragEntryId: ENTRY_ID });
    releaseFailure();
    await failure;
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBeUndefined();
    expect(actions(await auditRows(t), "unlearn_confirmed")).toHaveLength(1);
    expect(actions(await auditRows(t), "unlearn_failed")).toHaveLength(0);
    expect(await scheduledUnlearns(t)).toHaveLength(0);
  });

  test("historical confirmation clears a matching stale handle and fences later failure", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "revoked", ragEntryId: ENTRY_ID });
    await t.run(async (ctx) => ctx.db.insert("brainAuditLog", {
      action: "unlearn_confirmed", sourceId, actorId: "system",
      reason: `Erasure confirmed for entry ${ENTRY_ID}`, at: Date.now(),
    }));
    await t.mutation(internal.brain.recordUnlearnConfirmed, { sourceId, ragEntryId: ENTRY_ID });
    await t.mutation(internal.brain.recordUnlearnFailure, {
      sourceId, ragEntryId: ENTRY_ID, attempt: 1, error: "stale",
    });
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBeUndefined();
    expect(await auditRows(t)).toHaveLength(1);
    expect(await scheduledUnlearns(t)).toHaveLength(0);
  });

  test("confirmation fence is scoped to both source and exact entry", async () => {
    const { t } = await setup();
    const first = await insertSource(t, { status: "revoked" });
    const second = await insertSource(t, { status: "revoked", ragKey: "other" });
    for (const [sourceId, ragEntryId] of [
      [first, ENTRY_ID], [first, `${ENTRY_ID}_suffix`], [second, ENTRY_ID],
    ] as const) {
      await t.mutation(internal.brain.recordUnlearnConfirmed, { sourceId, ragEntryId });
    }
    expect(actions(await auditRows(t), "unlearn_confirmed")).toHaveLength(3);
  });

  test("failed erasure after reapproval never restores an id or writes failure evidence", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, { status: "revoked" });
    await t.run(async (ctx) => ctx.db.patch(sourceId, { status: "approved" }));
    eraseMock.mockRejectedValueOnce(new Error("late failure"));
    await expect(t.action(internal.brain.unlearnSource, {
      sourceId, ragEntryId: ENTRY_ID,
    })).rejects.toThrow("late failure");
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBeUndefined();
    expect((await sourceRow(t, sourceId))?.status).toBe("approved");
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("(d') re-revoking after a failed erasure restarts remediation without a second revoke row", async () => {
    const { t, admin } = await setup();
    const drain = unlearnDrain(t);
    eraseMock.mockRejectedValue(new Error("rag unreachable"));
    const sourceId = await insertSource(t, { ragEntryId: ENTRY_ID });

    await admin.mutation(api.brain.revokeSource, { sourceId });
    await expect(drain()).rejects.toThrow();
    expect(await unlearnJobArgs(t)).toHaveLength(2); // original + escalated retry

    // The retained ragEntryId doubles as the remediation handle. Re-revoking is
    // the only lever the admin has once remediation has capped out, so it must
    // schedule a fresh deletion — while still writing no second `revoke` row.
    await admin.mutation(api.brain.revokeSource, { sourceId });

    const jobs = await unlearnJobArgs(t);
    expect(jobs).toHaveLength(3);
    const restarts = jobs.filter(
      (j) => j.args.attempt === undefined && j.args.ragEntryId === ENTRY_ID
    );
    expect(restarts).toHaveLength(2);
    expect(restarts.every((j) => j.args.sourceId === sourceId)).toBe(true);

    const rows = await auditRows(t);
    expect(actions(rows, "revoke")).toHaveLength(1);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(0);
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBe(ENTRY_ID);
  });

  test("confirmation never clobbers a newer ragEntryId written by a re-ingest", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: "entry_fixture_2",
    });

    await t.action(internal.brain.unlearnSource, {
      ragEntryId: ENTRY_ID,
      sourceId,
    });

    // Cleared only if it still equals the erased id — E2 belongs to a later
    // entry that this confirmation says nothing about.
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBe("entry_fixture_2");
    expect(actions(await auditRows(t), "unlearn_confirmed")).toHaveLength(1);
  });

  test("confirmation never books against a source that was re-approved meanwhile", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "approved",
      ragEntryId: ENTRY_ID,
    });

    await t.action(internal.brain.unlearnSource, {
      ragEntryId: ENTRY_ID,
      sourceId,
    });

    expect((await sourceRow(t, sourceId))?.ragEntryId).toBe(ENTRY_ID);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("unlearnSource without a sourceId writes no audit row and patches nothing", async () => {
    const { t } = await setup();
    const sourceId = await insertSource(t, {
      status: "revoked",
      ragEntryId: ENTRY_ID,
    });

    await t.action(internal.brain.unlearnSource, { ragEntryId: ENTRY_ID });

    expect(await auditRows(t)).toHaveLength(0);
    expect((await sourceRow(t, sourceId))?.ragEntryId).toBe(ENTRY_ID);
  });

  test("(e) embedSource is a silent no-op on a missing, revoked or pending source", async () => {
    const { t } = await setup();
    const revoked = await insertSource(t, { status: "revoked" });
    const pending = await insertSource(t, {
      status: "pending",
      ragKey: "brain:pending",
    });
    const missing = await insertSource(t, { ragKey: "brain:missing" });
    await t.run(async (ctx) => ctx.db.delete(missing));

    for (const sourceId of [revoked, pending, missing]) {
      // The handler does `return;` (undefined); convex-test serializes an
      // undefined function result as null at the boundary, as Convex does.
      await expect(
        t.action(internal.ai.brain.ingest.embedSource, { sourceId })
      ).resolves.toBeNull();
    }

    expect((await sourceRow(t, revoked))?.ragEntryId).toBeUndefined();
    expect((await sourceRow(t, pending))?.ragEntryId).toBeUndefined();
    expect(await sourceRow(t, missing)).toBeNull();
    // Resolving rather than throwing IS the fix: a throw is retried by
    // embedPool up to 6 times against a source that must never be embedded.
    expect(await scheduledJobNames(t)).toEqual([]);
  });

  test("(f1) a late embed on a revoked source is compensated and confirmed", async () => {
    const { t } = await setup();
    const drain = unlearnDrain(t);
    const sourceId = await insertSource(t, { status: "revoked" });

    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: NAMESPACE,
      entry: completionEntry(RAG_KEY),
    });
    await drain();

    const row = await sourceRow(t, sourceId);
    expect(row?.status).toBe("revoked");
    expect(row?.ragEntryId).toBeUndefined();
    const rows = await auditRows(t);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(1);
    expect(eraseMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID);
    const names = await scheduledJobNames(t);
    expect(names.some((n) => n.includes("embedSource"))).toBe(false);
  });

  test("(f2) failed compensation keeps the orphaned id as evidence", async () => {
    const { t } = await setup();
    const drain = unlearnDrain(t);
    eraseMock.mockRejectedValue(new Error("compensation failed"));
    const sourceId = await insertSource(t, { status: "revoked" });

    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: NAMESPACE,
      entry: completionEntry(RAG_KEY),
    });
    await expect(drain()).rejects.toThrow();

    const row = await sourceRow(t, sourceId);
    expect(row?.status).toBe("revoked");
    expect(row?.ragEntryId).toBe(ENTRY_ID);
    const rows = await auditRows(t);
    expect(actions(rows, "unlearn_confirmed")).toHaveLength(0);
    expect(actions(rows, "unlearn_failed")).toHaveLength(1);
    const names = await scheduledJobNames(t);
    expect(names.some((n) => n.includes("unlearnSource"))).toBe(true);
    expect(names.some((n) => n.includes("embedSource"))).toBe(false);
  });

  test("(f3) a completed embed no governance row owns is erased with no bookkeeping", async () => {
    const { t } = await setup();
    const drain = unlearnDrain(t);

    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: NAMESPACE,
      entry: completionEntry("brain:orphan"),
    });

    const jobs = await unlearnJobArgs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args.ragEntryId).toBe(ENTRY_ID);
    // No row to book against, so no sourceId and no audit trail.
    expect(jobs[0].args.sourceId).toBeUndefined();

    await drain();
    expect(eraseMock).toHaveBeenCalledWith(expect.anything(), ENTRY_ID);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("(f3'') a failed orphan erasure still climbs the deletion-only ladder, with no bookkeeping", async () => {
    const { t } = await setup();
    const drain = unlearnDrain(t);
    eraseMock.mockRejectedValue(new Error("rag unreachable"));

    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: NAMESPACE,
      entry: completionEntry("brain:orphan"),
    });
    await expect(drain()).rejects.toThrow("rag unreachable");

    // No row to book against: no audit row, no patch — but the retry ladder is
    // the only thing standing between an orphaned vector and permanence, so it
    // must still escalate exactly as the sourceId-bearing path does.
    expect(await auditRows(t)).toHaveLength(0);
    const jobs = await unlearnJobArgs(t);
    expect(jobs).toHaveLength(2);
    const retry = jobs.filter((j) => j.args.attempt === 2);
    expect(retry).toHaveLength(1);
    expect(retry[0].args.ragEntryId).toBe(ENTRY_ID);
    expect(retry[0].args.sourceId).toBeUndefined();
    const names = await scheduledJobNames(t);
    expect(names.some((n) => n.includes("embedSource"))).toBe(false);
  });

  test("(f3') a FAILED ingest with no governance row schedules nothing", async () => {
    const { t } = await setup();

    await t.mutation(internal.ai.brain.rag.ingestOnComplete, {
      namespace: NAMESPACE,
      entry: completionEntry("brain:orphan"),
      error: "embedding provider exploded",
    });

    // Nothing was written remotely, so there is nothing to erase.
    expect(await scheduledJobNames(t)).toEqual([]);
    expect(await auditRows(t)).toHaveLength(0);
    expect(eraseMock).not.toHaveBeenCalled();
  });

  test("(g) served results drop hits whose source is no longer approved", async () => {
    const { t } = await setup();
    const approved = await insertSource(t, { ragKey: "brain:approved" });
    const pending = await insertSource(t, { status: "pending", ragKey: "brain:pending" });
    const revoked = await insertSource(t, {
      status: "revoked",
      ragKey: "brain:revoked",
    });
    // A row removed by removeSourcePermanently: valid-shaped id, no document.
    const deleted = await insertSource(t, { ragKey: "brain:deleted" });
    await t.run(async (ctx) => ctx.db.delete(deleted));

    const hit = (entryId: string, score: number) => ({
      entryId: entryId as never,
      order: 0,
      startOrder: 0,
      score,
      content: [{ text: `passage ${entryId}`, metadata: undefined }],
    });
    const entry = (entryId: string, sourceId: string | undefined) => ({
      ...completionEntry("k", entryId),
      metadata: sourceId ? { sourceId } : {},
    });

    vi.spyOn(brain, "search").mockResolvedValue({
      results: [
        hit("e_pending", 0.99),
        hit("e_ok", 0.9),
        hit("e_revoked", 0.8),
        hit("e_deleted", 0.75),
        hit("e_legacy", 0.7),
      ],
      entries: [
        entry("e_pending", pending),
        entry("e_ok", approved),
        entry("e_revoked", revoked),
        entry("e_deleted", deleted),
        entry("e_legacy", undefined),
      ],
      usage: { tokens: 0 },
      text: "",
    } as never);

    const outcome = await t.action(
      internal.ai.brain.retrieve.retrieveBrainContext,
      { query: "how do we phrase uncertainty" }
    );

    expect(outcome.degraded).toBe(false);
    expect(outcome.exemplars.map((e) => e.entryId).sort()).toEqual([
      "e_legacy",
      "e_ok",
    ]);
  });

  test("(g') non-servable hits are dropped before ranking, so they never consume top-k slots", async () => {
    const { t } = await setup();
    const approved = await insertSource(t, { ragKey: "brain:approved" });
    const pending = await insertSource(t, { status: "pending", ragKey: "brain:pending" });
    const revoked = await insertSource(t, {
      status: "revoked",
      ragKey: "brain:revoked",
    });

    const hit = (entryId: string, score: number) => ({
      entryId: entryId as never,
      order: 0,
      startOrder: 0,
      score,
      content: [{ text: `passage ${entryId}`, metadata: undefined }],
    });
    const entry = (entryId: string, sourceId: string | undefined) => ({
      ...completionEntry("k", entryId),
      metadata: sourceId ? { sourceId } : {},
    });

    // Two revoked hits OUTRANK every servable one. If the governance join ran
    // after top-k, the served list would shrink to one exemplar (and a 5 > 3
    // slate would have been handed to the reranker). Filtering first leaves a
    // 3-candidate slate for k = 3, so no rerank call is made and all three
    // servable hits are served.
    vi.spyOn(brain, "search").mockResolvedValue({
      results: [
        hit("e_pending", 0.99),
        hit("e_rev_1", 0.95),
        hit("e_rev_2", 0.9),
        hit("e_ok_1", 0.85),
        hit("e_ok_2", 0.8),
        hit("e_legacy", 0.75),
      ],
      entries: [
        entry("e_pending", pending),
        entry("e_rev_1", revoked),
        entry("e_rev_2", revoked),
        entry("e_ok_1", approved),
        entry("e_ok_2", approved),
        entry("e_legacy", undefined),
      ],
      usage: { tokens: 0 },
      text: "",
    } as never);

    const outcome = await t.action(
      internal.ai.brain.retrieve.retrieveBrainContext,
      { query: "how do we phrase uncertainty", k: 3 }
    );

    expect(outcome.degraded).toBe(false);
    expect(outcome.exemplars.map((e) => e.entryId)).toEqual([
      "e_ok_1",
      "e_ok_2",
      "e_legacy",
    ]);
  });
});
