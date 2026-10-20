/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { CHAIN_STOP_GRACE_MS } from "./lib/chatChain";
import { autoContinueMessage, chainLinkMadeProgress } from "./lib/chatTurnState";
import { continueMessage } from "../src/lib/chat/turnParts";
import { isContinuePrompt } from "./lib/chatItemCoverage";

/**
 * Report chat parity, Phase B (2026-10-20), W2: a long job carries on by
 * itself as linked turns (`chatV2.continueChain`), Stop ends the chain, and
 * a skip says why. Fictional data only.
 */

const modules = import.meta.glob("./**/*.ts");
const AUTH = "auth-auto-continue";
const OTHER_AUTH = "auth-auto-continue-other";

type Continuation = NonNullable<Doc<"chatTurns">["continuation"]>;

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH, role: "writer", firstName: "Avery", lastName: "Lane" });
    const otherId = await ctx.db.insert("users", { authId: OTHER_AUTH, role: "writer", firstName: "Jordan", lastName: "Reyes" });
    const projectId = await ctx.db.insert("projects", {
      title: "Chain project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "chain-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    return { userId, otherId, projectId, reportId };
  });
  const actor = t.withIdentity({ subject: AUTH });
  const other = t.withIdentity({ subject: OTHER_AUTH });
  const sent = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId, content: "Fix the deviations in every Line.", newThread: true,
  });
  const key = { agentThreadId: sent.threadId, promptMessageId: sent.messageId };
  const turns = () => t.run((ctx) => ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", sent.threadId))
    .collect());
  const turnOf = async (promptMessageId: string) => (await turns()).find((turn) => turn.promptMessageId === promptMessageId)!;
  /** Finish a turn the way the chat action does, with a Continue offer. */
  const finish = async (
    promptMessageId: string,
    continuation: Continuation | undefined,
    extra: Partial<Doc<"chatTurns">> = {}
  ) => {
    const turn = await turnOf(promptMessageId);
    await t.run((ctx) => ctx.db.patch(turn._id, {
      status: "completed", startedAt: Date.now() - 1_000, endedAt: Date.now(),
      ...(continuation ? { continuation } : {}), ...extra,
    }));
  };
  const saveCard = (promptMessageId: string) => t.run((ctx) => ctx.db.insert("chatProposals", {
    agentThreadId: sent.threadId, promptMessageId, projectId: ids.projectId, reportId: ids.reportId,
    kind: "replacements", replacements: [], requireUniqueTargets: true, state: "pending", createdAt: Date.now(),
  }));
  const chain = (promptMessageId: string) =>
    t.mutation(internal.chatV2.continueChain, { agentThreadId: sent.threadId, promptMessageId });
  const replies = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const messages = async () =>
    (await actor.query(api.chatV2.listMessages, {
      threadId: sent.threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page;
  return { t, actor, other, ...ids, threadId: sent.threadId, promptMessageId: sent.messageId, key, turns, turnOf, finish, saveCard, chain, replies, messages };
}

const linesLeft: Continuation = { reason: "lines_left", nextSection: "244", remaining: 3 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-20T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the Continue message", () => {
  test("is the text the Continue button sends, and reads as a Continue", () => {
    for (const continuation of [linesLeft, { reason: "step_limit" as const }, { reason: "cut_off" as const, nextSection: "246" as const, remaining: 1 }]) {
      expect(autoContinueMessage(continuation)).toBe(continueMessage(continuation));
      expect(isContinuePrompt(autoContinueMessage(continuation))).toBe(true);
    }
    expect(autoContinueMessage(linesLeft)).toBe("Continue with Line 244.");
    expect(autoContinueMessage({ reason: "step_limit" })).toBe("Continue.");
  });

  test("a link made progress only below the chain's lowest count or past its furthest Line", () => {
    expect(chainLinkMadeProgress([linesLeft], { ...linesLeft, remaining: 2 })).toBe(true);
    expect(chainLinkMadeProgress([linesLeft], { ...linesLeft, nextSection: "246" })).toBe(true);
    expect(chainLinkMadeProgress([linesLeft], linesLeft)).toBe(false);
    expect(chainLinkMadeProgress([linesLeft], { ...linesLeft, remaining: 4 })).toBe(false);
    expect(chainLinkMadeProgress([{ reason: "step_limit" }], { reason: "step_limit" })).toBe(false);
    // Review round 2 N1: a chain that never had a count or Line makes
    // progress when its first count or Line appears.
    expect(chainLinkMadeProgress([undefined], linesLeft)).toBe(true);
    expect(chainLinkMadeProgress([], linesLeft)).toBe(true);
    expect(chainLinkMadeProgress([{ reason: "step_limit" }], linesLeft)).toBe(true);
    expect(chainLinkMadeProgress([{ reason: "step_limit" }], { reason: "step_limit" })).toBe(false);
    // Review R1 P3-2: once the chain has counts, one that disappears is not progress.
    expect(chainLinkMadeProgress([linesLeft], { reason: "step_limit" })).toBe(false);
    expect(chainLinkMadeProgress([{ reason: "step_limit" }, linesLeft], { reason: "step_limit" })).toBe(false);
    // The flip-flop: back to a count the chain already had.
    expect(chainLinkMadeProgress([{ reason: "step_limit" }, linesLeft], linesLeft)).toBe(false);
    // Measured against the lowest count and the furthest Line of the chain.
    const reached = { reason: "lines_left" as const, nextSection: "246" as const, remaining: 2 };
    expect(chainLinkMadeProgress([reached, linesLeft], { ...linesLeft, remaining: 2 })).toBe(false);
    expect(chainLinkMadeProgress([reached, linesLeft], { ...linesLeft, remaining: 1 })).toBe(true);
    // Back to an earlier Line is not forward.
    expect(chainLinkMadeProgress([linesLeft], { ...linesLeft, nextSection: "242" })).toBe(false);
  });
});

describe("continueChain", () => {
  test("schedules a link with the exact text, the sender and origin auto_continue", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const before = (await f.replies()).length;
    const result = await f.chain(f.promptMessageId);
    expect(result.kind).toBe("linked");
    if (result.kind !== "linked") return;

    const link = await f.turnOf(result.promptMessageId);
    expect(link).toMatchObject({ status: "queued", origin: "auto_continue", userId: f.userId, stepCount: 0 });
    expect(link.order).toBeGreaterThan((await f.turnOf(f.promptMessageId)).order);
    const saved = (await f.messages()).find((message) => message.id === result.promptMessageId);
    expect(saved).toMatchObject({ role: "user", text: "Continue with Line 244." });

    const jobs = await f.replies();
    expect(jobs).toHaveLength(before + 1);
    const job = jobs.at(-1)!;
    expect(job.name).toContain("streamChatReply");
    // Brain off; web search from the conversation's setting (absent means on).
    expect(job.args[0]).toEqual({
      agentThreadId: f.threadId, promptMessageId: result.promptMessageId, reportId: f.reportId,
      userId: f.userId, allowWeb: true,
    });
    // The writer reads the link as a turn the server started.
    const listed = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(listed.find((turn) => turn.promptMessageId === result.promptMessageId)?.origin).toBe("auto_continue");
  });

  test("a step-limit stop that saved a card continues with Continue.", async () => {
    const f = await setup();
    await f.saveCard(f.promptMessageId);
    await f.finish(f.promptMessageId, { reason: "step_limit" });
    const result = await f.chain(f.promptMessageId);
    expect(result.kind).toBe("linked");
    if (result.kind !== "linked") return;
    expect((await f.messages()).find((message) => message.id === result.promptMessageId)?.text).toBe("Continue.");
  });

  test("a reply cut off with a cut_off offer continues; a plain failure does not", async () => {
    const f = await setup();
    await f.saveCard(f.promptMessageId);
    await f.finish(f.promptMessageId, { reason: "cut_off" }, { status: "failed" });
    expect((await f.chain(f.promptMessageId)).kind).toBe("linked");

    const g = await setup();
    await g.finish(g.promptMessageId, undefined, { status: "failed" });
    expect(await g.chain(g.promptMessageId)).toEqual({ kind: "none" });
  });

  test("a turn with no Continue offer, or one stopped, starts nothing", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, undefined);
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });

    const g = await setup();
    await g.finish(g.promptMessageId, linesLeft, { status: "aborted" });
    expect(await g.chain(g.promptMessageId)).toEqual({ kind: "none" });
    expect(await g.turns()).toHaveLength(1);
  });
});

describe("skips", () => {
  test("budget: the project's daily chat spend is used up", async () => {
    const f = await setup();
    await f.t.mutation(internal.aiUsage.logUsage, {
      projectId: f.projectId, callSite: "chat_v2", model: "test", inputTokens: 0, outputTokens: 0,
      costUsd: 60, createdAt: Date.now() - 60_000,
    });
    await f.finish(f.promptMessageId, linesLeft);
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "skipped", reason: "budget" });
    expect((await f.turnOf(f.promptMessageId)).autoContinueSkipped).toBe("budget");
    expect(await f.turns()).toHaveLength(1);
    const listed = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(listed[0]?.autoContinueSkipped).toBe("budget");
  });

  test("no progress: a step-limit stop that saved no card", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, { reason: "step_limit" });
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "skipped", reason: "no_progress" });
    expect((await f.turnOf(f.promptMessageId)).autoContinueSkipped).toBe("no_progress");
  });

  test("no progress: a link that left as many items on the same Line", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const first = await f.chain(f.promptMessageId);
    if (first.kind !== "linked") throw new Error("expected a link");
    await f.finish(first.promptMessageId, linesLeft);
    expect(await f.chain(first.promptMessageId)).toEqual({ kind: "skipped", reason: "no_progress" });

    // A link that moved on continues again.
    const g = await setup();
    await g.finish(g.promptMessageId, linesLeft);
    const link = await g.chain(g.promptMessageId);
    if (link.kind !== "linked") throw new Error("expected a link");
    await g.finish(link.promptMessageId, { ...linesLeft, nextSection: "246", remaining: 1 });
    expect((await g.chain(link.promptMessageId)).kind).toBe("linked");
  });

  test("no progress: a chain cannot loop by flipping back to a count it already had", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, { ...linesLeft, remaining: 5 });
    const first = await f.chain(f.promptMessageId);
    if (first.kind !== "linked") throw new Error("expected a link");
    // Link 1 made real progress: 4 left.
    await f.finish(first.promptMessageId, { ...linesLeft, remaining: 4 });
    const second = await f.chain(first.promptMessageId);
    if (second.kind !== "linked") throw new Error("expected a second link");
    // Link 2 lost its counts (a step-limit stop that saved a card).
    await f.saveCard(second.promptMessageId);
    await f.finish(second.promptMessageId, { reason: "step_limit" });
    expect(await f.chain(second.promptMessageId)).toEqual({ kind: "skipped", reason: "no_progress" });

    // Same chain shape, but link 2 is back at the head's count: no progress
    // against the lowest count the chain reached (4).
    const g = await setup();
    await g.finish(g.promptMessageId, { ...linesLeft, remaining: 5 });
    const a = await g.chain(g.promptMessageId);
    if (a.kind !== "linked") throw new Error("expected a link");
    await g.finish(a.promptMessageId, { ...linesLeft, remaining: 4 });
    const b = await g.chain(a.promptMessageId);
    if (b.kind !== "linked") throw new Error("expected a second link");
    await g.finish(b.promptMessageId, { ...linesLeft, remaining: 5 });
    expect(await g.chain(b.promptMessageId)).toEqual({ kind: "skipped", reason: "no_progress" });
  });

  test("a sender who lost access starts no link, and nothing is recorded", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    await f.t.run((ctx) => ctx.db.patch(f.userId, { role: undefined }));
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });
    expect(await f.turns()).toHaveLength(1);
    expect((await f.turnOf(f.promptMessageId)).autoContinueSkipped).toBeUndefined();

    const g = await setup();
    await g.finish(g.promptMessageId, linesLeft);
    await g.t.run((ctx) => ctx.db.patch(g.userId, { isAnonymous: true }));
    expect(await g.chain(g.promptMessageId)).toEqual({ kind: "none" });
  });

  test("off: an admin turned automatic continuing off", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.insert("appSettings", {
      key: "ai.chatAutoContinue", value: "off", updatedBy: f.userId, updatedAt: Date.now(),
    }));
    await f.finish(f.promptMessageId, linesLeft);
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "skipped", reason: "off" });
    expect((await f.turnOf(f.promptMessageId)).autoContinueSkipped).toBe("off");
    // Recorded once: a second call changes nothing.
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });
  });
});

describe("Stop and newer turns", () => {
  test("Stop on a queued link stops it, and a stopped link never continues", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const result = await f.chain(f.promptMessageId);
    if (result.kind !== "linked") throw new Error("expected a link");
    const link = await f.turnOf(result.promptMessageId);
    expect(await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order: link.order })).toBe(true);
    expect((await f.turnOf(result.promptMessageId)).status).toBe("aborted");
    // The action's finishTurn keeps it aborted; the chain goes no further.
    await f.t.run((ctx) => ctx.db.patch(link._id, { continuation: { ...linesLeft, remaining: 1 } }));
    expect(await f.chain(result.promptMessageId)).toEqual({ kind: "none" });
    expect(await f.turns()).toHaveLength(2);
  });

  test("Stop just after a reply finished ends the chain there", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const turn = await f.turnOf(f.promptMessageId);
    vi.setSystemTime(Date.now() + 5_000);
    expect(await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order: turn.order })).toBe(true);
    expect((await f.turnOf(f.promptMessageId)).chainStoppedAt).toBe(Date.now());
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });
    expect(await f.turns()).toHaveLength(1);
    // chainStoppedAt stays on the server.
    const listed = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(listed[0]).not.toHaveProperty("chainStoppedAt");
  });

  test("Stop long after a reply finished does nothing", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const turn = await f.turnOf(f.promptMessageId);
    vi.setSystemTime(Date.now() + CHAIN_STOP_GRACE_MS);
    expect(await f.actor.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order: turn.order })).toBe(false);
    expect((await f.turnOf(f.promptMessageId)).chainStoppedAt).toBeUndefined();
  });

  test("Stop aimed at the finished turn stops the link a page had not seen yet", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const result = await f.chain(f.promptMessageId);
    if (result.kind !== "linked") throw new Error("expected a link");
    const turn = await f.turnOf(f.promptMessageId);
    expect(await f.other.mutation(api.chatV2.abortStreaming, { threadId: f.threadId, order: turn.order })).toBe(true);
    expect((await f.turnOf(result.promptMessageId)).status).toBe("aborted");
  });

  test("a newer writer message wins over the link", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const typed = await f.other.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: f.threadId, content: "Only do Line 246 next.",
    });
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });
    const turns = await f.turns();
    expect(turns).toHaveLength(2);
    expect(turns.at(-1)?.promptMessageId).toBe(typed.messageId);
    expect(turns.some((turn) => turn.origin === "auto_continue")).toBe(false);
  });

  test("while a link is queued, a writer's send is refused as a reply in progress", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    expect((await f.chain(f.promptMessageId)).kind).toBe("linked");
    await expect(f.other.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: f.threadId, content: "Another request.",
    })).rejects.toThrow(/CHAT_TURN_ACTIVE/);
  });
});

describe("the lease and the queue limit", () => {
  test("one link per turn, and the lease still holds a link", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const result = await f.chain(f.promptMessageId);
    if (result.kind !== "linked") throw new Error("expected a link");
    // A second call (a retried action) finds the link newer and adds nothing.
    expect(await f.chain(f.promptMessageId)).toEqual({ kind: "none" });
    expect(await f.turns()).toHaveLength(2);

    // A turn already running in the thread (a race) fails the queued link.
    await f.t.run((ctx) => ctx.db.insert("chatTurns", {
      agentThreadId: f.threadId, promptMessageId: "racing-turn", order: 99, status: "running", stepCount: 0, startedAt: Date.now(),
    }));
    const start = await f.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: f.threadId, promptMessageId: result.promptMessageId, startedAt: Date.now(),
    });
    expect(start).toEqual({ shouldRun: false, status: "failed" });
  });

  test("a queued link starts like any turn", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, linesLeft);
    const result = await f.chain(f.promptMessageId);
    if (result.kind !== "linked") throw new Error("expected a link");
    const start = await f.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: f.threadId, promptMessageId: result.promptMessageId, startedAt: Date.now(),
    });
    expect(start).toEqual({ shouldRun: true, status: "running" });
  });

  test("a queued link does not count toward the sender's queue limit", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.insert("appSettings", {
      key: "ai.chatMaxQueuedTurns", value: "1", updatedBy: f.userId, updatedAt: Date.now(),
    }));
    await f.finish(f.promptMessageId, linesLeft);
    expect((await f.chain(f.promptMessageId)).kind).toBe("linked");
    // The same writer asks something in another conversation of the report.
    await expect(f.actor.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, content: "A separate question.", newThread: true,
    })).resolves.toMatchObject({ messageId: expect.any(String) });
  });
});

describe("authors", () => {
  test("listThreads names who started each conversation, never by email", async () => {
    const f = await setup();
    const mine = await f.actor.query(api.chatV2.listThreads, { reportId: f.reportId });
    expect(mine[0]).toMatchObject({ createdBy: f.userId, createdByName: "Avery Lane", startedByCurrentUser: true });
    const theirs = await f.other.query(api.chatV2.listThreads, { reportId: f.reportId });
    expect(theirs[0]).toMatchObject({ createdByName: "Avery Lane", startedByCurrentUser: false });

    // An older row with no createdBy falls back to its first turn's sender.
    await f.t.run(async (ctx) => {
      const row = (await ctx.db.query("agentChatThreads").collect())[0]!;
      await ctx.db.replace(row._id, {
        projectId: row.projectId, reportId: row.reportId, agentThreadId: row.agentThreadId,
        title: row.title, createdAt: row.createdAt,
      });
    });
    expect((await f.other.query(api.chatV2.listThreads, { reportId: f.reportId }))[0]).toMatchObject({
      createdByName: "Avery Lane", startedByCurrentUser: false,
    });

    // A sender with only an email on record has no name to show.
    await f.t.run((ctx) => ctx.db.patch(f.userId, { firstName: undefined, lastName: undefined, email: "avery@example.test" }));
    const unnamed = (await f.other.query(api.chatV2.listThreads, { reportId: f.reportId }))[0]!;
    expect(unnamed).not.toHaveProperty("createdByName");
    expect(JSON.stringify(unnamed)).not.toContain("@");
  });

  test("listTurns gives each turn its sender's name and whether it is the viewer", async () => {
    const f = await setup();
    await f.finish(f.promptMessageId, undefined);
    await f.other.mutation(api.chatV2.sendMessage, { reportId: f.reportId, threadId: f.threadId, content: "And Line 246?" });
    const seenByOther = await f.other.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(seenByOther.map((turn) => [turn.senderName, turn.fromCurrentUser])).toEqual([
      ["Avery Lane", false], ["Jordan Reyes", true],
    ]);
    const seenByMe = await f.actor.query(api.chatV2.listTurns, { threadId: f.threadId });
    expect(seenByMe.map((turn) => turn.fromCurrentUser)).toEqual([true, false]);
  });
});

describe("reportChatActivity", () => {
  test("says whether a reply runs, whether it is mine, and when mine last finished", async () => {
    const f = await setup();
    // The writer's own turn is queued.
    expect(await f.actor.query(api.chatV2.reportChatActivity, { reportId: f.reportId })).toEqual({
      active: true, mineActive: true, mineLastFinishedAt: null,
    });
    expect(await f.other.query(api.chatV2.reportChatActivity, { reportId: f.reportId })).toEqual({
      active: true, mineActive: false, mineLastFinishedAt: null,
    });
    await f.finish(f.promptMessageId, undefined);
    const endedAt = (await f.turnOf(f.promptMessageId)).endedAt!;
    expect(await f.actor.query(api.chatV2.reportChatActivity, { reportId: f.reportId })).toEqual({
      active: false, mineActive: false, mineLastFinishedAt: endedAt,
    });
    // Someone else's reply in another conversation runs; mine stays finished.
    await f.other.mutation(api.chatV2.sendMessage, { reportId: f.reportId, content: "A question.", newThread: true });
    expect(await f.actor.query(api.chatV2.reportChatActivity, { reportId: f.reportId })).toEqual({
      active: true, mineActive: false, mineLastFinishedAt: endedAt,
    });
  });

  test("is idle for a reader without access", async () => {
    const f = await setup();
    expect(await f.t.query(api.chatV2.reportChatActivity, { reportId: f.reportId })).toEqual({
      active: false, mineActive: false, mineLastFinishedAt: null,
    });
    const roleless = await f.t.run((ctx) => ctx.db.insert("users", { authId: "auth-roleless-activity" }));
    expect(roleless).toBeDefined();
    expect(await f.t.withIdentity({ subject: "auth-roleless-activity" }).query(api.chatV2.reportChatActivity, {
      reportId: f.reportId,
    })).toEqual({ active: false, mineActive: false, mineLastFinishedAt: null });
  });
});

