/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";

/**
 * Report chat parity, Phase A (2026-10-19): the internal mutations that keep
 * a turn's progress, Continue offer, history start and Brain flag, and the
 * listTurns shape the browser reads. Fictional data only.
 */

const modules = import.meta.glob("./**/*.ts");
const AUTH = "auth-turn-state";
const THREAD = "thread-turn-state";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH, role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Turn state project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "turn-state-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", {
      projectId, reportId, agentThreadId: THREAD, title: "Chat", createdAt: now,
    });
    return { userId, projectId, reportId };
  });
  const turn = async (promptMessageId: string, order: number, status: Doc<"chatTurns">["status"] = "running") =>
    await t.run((ctx) => ctx.db.insert("chatTurns", {
      agentThreadId: THREAD, promptMessageId, order, status, stepCount: 0, startedAt: Date.now(),
    }));
  const read = (id: Id<"chatTurns">) => t.run((ctx) => ctx.db.get(id));
  const proposal = async (promptMessageId: string, itemIds: string[], state: Doc<"chatProposals">["state"] = "pending") =>
    await t.run(async (ctx) => {
      const proposalId = await ctx.db.insert("chatProposals", {
        agentThreadId: THREAD, promptMessageId, projectId: ids.projectId, reportId: ids.reportId,
        kind: "replacements", replacements: [], requireUniqueTargets: true, state, createdAt: Date.now(),
      });
      for (const itemId of itemIds) {
        await ctx.db.insert("chatProposalItems", {
          proposalId, projectId: ids.projectId, itemId, status: "resolved", reason: "Resolved.", createdAt: Date.now(),
        });
      }
      return proposalId;
    });
  return { t, ...ids, turn, read, proposal };
}

const key = (promptMessageId: string) => ({ agentThreadId: THREAD, promptMessageId });

describe("markTurnProgress", () => {
  test("writes the phase while the turn runs and refuses it after", async () => {
    const f = await setup();
    const id = await f.turn("p1", 1);
    const progress = { phase: "tool" as const, tool: "deviationInventory", section: "244" as const, step: 1, since: 10 };
    expect(await f.t.mutation(internal.chatV2.markTurnProgress, { ...key("p1"), progress })).toBe(true);
    expect((await f.read(id))?.progress).toEqual(progress);

    for (const status of ["completed", "failed", "aborted"] as const) {
      await f.t.run((ctx) => ctx.db.patch(id, { status }));
      expect(await f.t.mutation(internal.chatV2.markTurnProgress, {
        ...key("p1"), progress: { phase: "writing", step: 2, since: 20 },
      })).toBe(false);
      expect((await f.read(id))?.progress).toEqual(progress);
    }
    expect(await f.t.mutation(internal.chatV2.markTurnProgress, {
      ...key("missing"), progress: { phase: "writing", step: 2, since: 20 },
    })).toBe(false);
  });

  test("markTurnStarted begins a queued turn in the reading phase", async () => {
    const f = await setup();
    const id = await f.turn("p1", 1, "queued");
    await f.t.mutation(internal.chatV2.markTurnStarted, { ...key("p1"), startedAt: 1_000 });
    expect((await f.read(id))?.progress).toEqual({ phase: "reading", step: 0, since: 1_000 });
  });
});

describe("setTurnHistoryStart and markTurnBrainSearched", () => {
  test("record on a running turn only", async () => {
    const f = await setup();
    const id = await f.turn("p1", 1);
    expect(await f.t.mutation(internal.chatV2.setTurnHistoryStart, { ...key("p1"), historyStartOrder: 8 })).toBe(true);
    expect(await f.t.mutation(internal.chatV2.markTurnBrainSearched, key("p1"))).toBe(true);
    const first = (await f.read(id))?.brainSearchedAt;
    expect(first).toBeDefined();
    // A second search keeps the first time.
    expect(await f.t.mutation(internal.chatV2.markTurnBrainSearched, key("p1"))).toBe(true);
    expect((await f.read(id))?.brainSearchedAt).toBe(first);
    expect((await f.read(id))?.historyStartOrder).toBe(8);

    await f.t.run((ctx) => ctx.db.patch(id, { status: "aborted" }));
    expect(await f.t.mutation(internal.chatV2.setTurnHistoryStart, { ...key("p1"), historyStartOrder: 4 })).toBe(false);
    expect(await f.t.mutation(internal.chatV2.markTurnBrainSearched, key("p1"))).toBe(false);
    expect((await f.read(id))?.historyStartOrder).toBe(8);
  });
});

describe("setTurnContinuation", () => {
  const outstanding = [
    { section: "242" as const, itemId: "r-242-1-1" },
    { section: "244" as const, itemId: "r-244-1-1" },
    { section: "244" as const, itemId: "r-244-2-1" },
    { section: "246" as const, itemId: "r-246-1-1" },
  ];

  test("offers the first Line whose Deviations the conversation has not handled", async () => {
    const f = await setup();
    // An earlier turn's card for Line 242 was applied; its card for Line 246
    // was rejected, so that item is still to do (review P2-2).
    await f.turn("p0", 0, "completed");
    await f.proposal("p0", ["r-242-1-1"], "applied");
    await f.proposal("p0", ["r-246-1-1"], "rejected");
    const id = await f.turn("p1", 1);
    await f.proposal("p1", ["r-244-1-1"]);
    const stored = await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p1"), reason: "lines_left", outstanding,
    });
    expect(stored).toEqual({ reason: "lines_left", nextSection: "244", remaining: 2 });
    expect((await f.read(id))?.continuation).toEqual(stored);
  });

  test("lines_left needs a Completion Report from this turn and a Line still to do", async () => {
    const f = await setup();
    const listOnly = await f.turn("p1", 1);
    expect(await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p1"), reason: "lines_left", outstanding,
    })).toBeNull();
    expect((await f.read(listOnly))?.continuation).toBeUndefined();

    const done = await f.turn("p2", 2);
    await f.proposal("p2", outstanding.map((item) => item.itemId));
    expect(await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p2"), reason: "lines_left", outstanding,
    })).toBeNull();
    expect((await f.read(done))?.continuation).toBeUndefined();
  });

  test("step_limit and cut_off are always offered, with a Line when one is left", async () => {
    const f = await setup();
    await f.turn("p1", 1);
    expect(await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p1"), reason: "step_limit", outstanding: [],
    })).toEqual({ reason: "step_limit" });
    await f.turn("p2", 2);
    expect(await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p2"), reason: "cut_off", outstanding,
    })).toEqual({ reason: "cut_off", nextSection: "242", remaining: 4 });
  });

  test("a stopped or finished turn is offered nothing", async () => {
    const f = await setup();
    const id = await f.turn("p1", 1, "aborted");
    expect(await f.t.mutation(internal.chatV2.setTurnContinuation, {
      ...key("p1"), reason: "cut_off", outstanding,
    })).toBeNull();
    expect((await f.read(id))?.continuation).toBeUndefined();
  });
});

describe("getThreadItemCoverage (review P2-2)", () => {
  test("reads each item's newest card state for the thread", async () => {
    const f = await setup();
    await f.proposal("p0", ["r-242-1-1", "r-244-1-1"], "applied");
    await f.proposal("p1", ["r-246-1-1"], "rejected");
    await f.proposal("p2", ["r-244-1-1"]);
    const coverage = await f.t.query(internal.chatV2.getThreadItemCoverage, { agentThreadId: THREAD });
    const byId = new Map(coverage.map((item) => [item.itemId, item]));
    expect(byId.get("r-242-1-1")).toMatchObject({ label: "applied", handled: true });
    expect(byId.get("r-244-1-1")).toMatchObject({ label: "already on a pending card", handled: true });
    expect(byId.get("r-246-1-1")).toMatchObject({ handled: false });
    expect(await f.t.query(internal.chatV2.getThreadItemCoverage, { agentThreadId: "another-thread" })).toEqual([]);
  });
});

describe("listTurns", () => {
  test("returns progress, continuation and historyStartOrder, never the Brain flag", async () => {
    const f = await setup();
    const id = await f.turn("p1", 1);
    await f.t.run((ctx) => ctx.db.patch(id, {
      progress: { phase: "writing", step: 2, since: 5 },
      continuation: { reason: "lines_left", nextSection: "246", remaining: 3 },
      historyStartOrder: 4,
      brainSearchedAt: 7,
    }));
    const listed = await f.t.withIdentity({ subject: AUTH }).query(api.chatV2.listTurns, { threadId: THREAD });
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      progress: { phase: "writing", step: 2, since: 5 },
      continuation: { reason: "lines_left", nextSection: "246", remaining: 3 },
      historyStartOrder: 4,
    });
    expect(listed[0]).not.toHaveProperty("brainSearchedAt");
  });
});
