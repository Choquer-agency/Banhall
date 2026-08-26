/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { ConvexError } from "convex/values";
import { convexTest } from "convex-test";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "auth-chat-turns";

function createTest() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  return t;
}

async function setup() {
  const t = createTest();
  const { projectId, reportId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId,
      role: "writer",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Chat timing project",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      shareToken: "chat-timing-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return { projectId, reportId };
  });
  return {
    t,
    projectId,
    reportId,
    actor: t.withIdentity({ subject: authId }),
  };
}

async function sendQueuedTurn(setupResult: Awaited<ReturnType<typeof setup>>) {
  const result = await setupResult.actor.mutation(api.chatV2.sendMessage, {
    reportId: setupResult.reportId,
    content: "Help revise this report.",
    newThread: true,
  });
  const turn = await setupResult.t.run(async (ctx) =>
    await ctx.db
      .query("chatTurns")
      .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
        q
          .eq("agentThreadId", result.threadId)
          .eq("promptMessageId", result.messageId)
      )
      .unique()
  );
  if (!turn) throw new Error("queued turn missing");
  return { result, turn };
}

async function insertTurn(
  t: ReturnType<typeof createTest>,
  values: {
    agentThreadId: string;
    promptMessageId: string;
    order: number;
    status: "queued" | "running" | "completed" | "failed" | "aborted";
    startedAt?: number;
    endedAt?: number;
    stepCount?: number;
  }
) {
  return await t.run(async (ctx) =>
    await ctx.db.insert("chatTurns", {
      ...values,
      stepCount: values.stepCount ?? 0,
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-25T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("chat turn lifecycle", () => {
  test("sendMessage inserts the queued shape addressable through both indexes", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    expect(result).toEqual({
      threadId: result.threadId,
      messageId: result.messageId,
    });
    expect(turn).toMatchObject({
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      order: expect.any(Number),
      status: "queued",
      stepCount: 0,
    });
    expect(turn).not.toHaveProperty("startedAt");
    expect(turn).not.toHaveProperty("endedAt");

    const byOrder = await setupResult.t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_order", (q) =>
          q
            .eq("agentThreadId", result.threadId)
            .eq("order", turn.order)
        )
        .unique()
    );
    expect(byOrder?._id).toBe(turn._id);
  });

  test("transitions queued to running to completed", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-lifecycle",
      promptMessageId: "prompt-lifecycle",
      order: 1,
      status: "queued",
    });

    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-lifecycle",
        promptMessageId: "prompt-lifecycle",
        startedAt: 1_000,
      })
    ).resolves.toEqual({ shouldRun: true, status: "running" });
    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-lifecycle",
        promptMessageId: "prompt-lifecycle",
        requestedStatus: "completed",
        endedAt: 4_000,
        stepCount: 3,
      })
    ).resolves.toEqual({ status: "completed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-lifecycle")
            .eq("promptMessageId", "prompt-lifecycle")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      endedAt: 4_000,
      stepCount: 3,
    });
  });

  test("repeated starts and finishes are idempotent", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      order: 2,
      status: "queued",
    });

    await t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      startedAt: 1_000,
    });
    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        startedAt: 2_000,
      })
    ).resolves.toEqual({ shouldRun: true, status: "running" });
    await t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: "thread-idempotent",
      promptMessageId: "prompt-idempotent",
      requestedStatus: "completed",
      endedAt: 4_000,
      stepCount: 2,
    });
    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        requestedStatus: "failed",
        endedAt: 9_000,
        stepCount: 8,
      })
    ).resolves.toEqual({ status: "completed" });
    await expect(
      t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: "thread-idempotent",
        promptMessageId: "prompt-idempotent",
        startedAt: 10_000,
      })
    ).resolves.toEqual({ shouldRun: false, status: "completed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-idempotent")
            .eq("promptMessageId", "prompt-idempotent")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "completed",
      startedAt: 1_000,
      endedAt: 4_000,
      stepCount: 2,
    });
  });

  test("finalizes a failed turn with a normalized step count", async () => {
    const { t } = await setup();
    await insertTurn(t, {
      agentThreadId: "thread-failed",
      promptMessageId: "prompt-failed",
      order: 3,
      status: "running",
      startedAt: 1_000,
    });

    await expect(
      t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: "thread-failed",
        promptMessageId: "prompt-failed",
        requestedStatus: "failed",
        endedAt: 2_000,
        stepCount: 2.9,
      })
    ).resolves.toEqual({ status: "failed" });

    const turn = await t.run(async (ctx) =>
      await ctx.db
        .query("chatTurns")
        .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
          q
            .eq("agentThreadId", "thread-failed")
            .eq("promptMessageId", "prompt-failed")
        )
        .unique()
    );
    expect(turn).toMatchObject({
      status: "failed",
      startedAt: 1_000,
      endedAt: 2_000,
      stepCount: 2,
    });
  });

  test("an abort before start fences the scheduled action", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await expect(
      setupResult.actor.mutation(api.chatV2.abortStreaming, {
        threadId: result.threadId,
        order: turn.order,
      })
    ).resolves.toBe(true);
    await expect(
      setupResult.t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        startedAt: Date.now() + 1_000,
      })
    ).resolves.toEqual({ shouldRun: false, status: "aborted" });
  });

  test("an abort after start fences the action before it streams", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });
    // Still active while the action loads report context.
    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
      })
    ).resolves.toBe(true);

    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });

    // The pre-stream fence must now stop it generating text or proposals.
    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
      })
    ).resolves.toBe(false);
  });

  test("a stopped turn cannot still create a proposal card", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);

    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });

    // A tool call that wins the race against stop must still be refused: a
    // card appearing after the writer stopped the reply is the visible harm.
    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });

    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: result.threadId,
        toolCallId: "call-after-stop",
        promptMessageId: result.messageId,
        kind: "references",
        references: ["anything"],
      })
    ).resolves.toEqual({
      ok: false,
      stopped: true,
      reason: "The writer stopped this reply.",
    });

    const proposals = await setupResult.t.run(async (ctx) =>
      ctx.db.query("chatProposals").collect()
    );
    expect(proposals).toHaveLength(0);

    // Control: the identical call on a live turn succeeds, proving the stop
    // fence refused it — not some unrelated downstream validation. The report
    // needs real text for the reference to resolve against.
    await setupResult.t.run(async (ctx) => {
      await ctx.db.patch(setupResult.reportId, {
        content: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "A findable passage." }],
            },
          ],
        }),
      });
    });
    const live = await sendQueuedTurn(setupResult);
    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: live.result.threadId,
        toolCallId: "call-while-live",
        promptMessageId: live.result.messageId,
        kind: "references",
        references: ["A findable passage."],
      })
    ).resolves.toMatchObject({ ok: true });
  });

  test("a turn with no metadata row is allowed to run", async () => {
    const setupResult = await setup();
    const { result } = await sendQueuedTurn(setupResult);

    await expect(
      setupResult.t.query(internal.chatV2.isTurnActive, {
        agentThreadId: result.threadId,
        promptMessageId: "message-from-before-chatTurns",
      })
    ).resolves.toBe(true);
  });

  test.each(["completed", "failed"] as const)(
    "an abort while running wins over later %s finalization",
    async (requestedStatus) => {
      const setupResult = await setup();
      const { result, turn } = await sendQueuedTurn(setupResult);
      await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        startedAt: Date.now(),
      });

      await expect(
        setupResult.actor.mutation(api.chatV2.abortStreaming, {
          threadId: result.threadId,
          order: turn.order,
        })
      ).resolves.toBe(true);
      await expect(
        setupResult.t.mutation(internal.chatV2.finishTurn, {
          agentThreadId: result.threadId,
          promptMessageId: result.messageId,
          requestedStatus,
          endedAt: Date.now() + 5_000,
          stepCount: 1,
        })
      ).resolves.toEqual({ status: "aborted" });

      const stored = await setupResult.t.run(async (ctx) =>
        await ctx.db
          .query("chatTurns")
          .withIndex("by_agentThreadId_and_promptMessageId", (q) =>
            q
              .eq("agentThreadId", result.threadId)
              .eq("promptMessageId", result.messageId)
          )
          .unique()
      );
      expect(stored?.status).toBe("aborted");
    }
  );

  test("late finalization can raise an aborted step count without moving its end", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);
    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });
    await setupResult.actor.mutation(api.chatV2.abortStreaming, {
      threadId: result.threadId,
      order: turn.order,
    });
    const aborted = await setupResult.t.run(async (ctx) =>
      await ctx.db.get(turn._id)
    );
    if (!aborted?.endedAt) throw new Error("abort end time missing");

    await setupResult.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      requestedStatus: "completed",
      endedAt: aborted.endedAt + 10_000,
      stepCount: 7,
    });
    await setupResult.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      requestedStatus: "failed",
      endedAt: aborted.endedAt + 20_000,
      stepCount: 3,
    });

    const stored = await setupResult.t.run(async (ctx) =>
      await ctx.db.get(turn._id)
    );
    expect(stored).toMatchObject({
      status: "aborted",
      endedAt: aborted.endedAt,
      stepCount: 7,
    });
  });
});

describe("failStaleChatTurns", () => {
  const MINUTES = 60 * 1000;

  test("fails stuck queued/running turns past the cutoff, leaves fresh and terminal turns", async () => {
    const { t } = await setup();
    const base = Date.now();
    // Stale rows: created (and started) 20 minutes before the sweep runs. A
    // queued row has no startedAt — it ages from _creationTime.
    const staleQueuedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "stale-queued",
      order: 1,
      status: "queued",
    });
    const staleRunningId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "stale-running",
      order: 2,
      status: "running",
      startedAt: base,
    });
    const completedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "old-completed",
      order: 3,
      status: "completed",
      startedAt: base,
      endedAt: base + 1_000,
      stepCount: 2,
    });
    const abortedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "old-aborted",
      order: 4,
      status: "aborted",
      startedAt: base,
      endedAt: base + 1_000,
    });

    vi.setSystemTime(base + 20 * MINUTES);
    const freshQueuedId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "fresh-queued",
      order: 5,
      status: "queued",
    });
    const freshRunningId = await insertTurn(t, {
      agentThreadId: "thread-reaper",
      promptMessageId: "fresh-running",
      order: 6,
      status: "running",
      startedAt: Date.now(),
    });

    await expect(
      t.mutation(internal.chatV2.failStaleChatTurns, { olderThanMinutes: 15 })
    ).resolves.toEqual({ failed: 2 });

    const statuses = await t.run(async (ctx) => ({
      staleQueued: (await ctx.db.get(staleQueuedId))?.status,
      staleRunning: await ctx.db.get(staleRunningId),
      completed: (await ctx.db.get(completedId))?.status,
      aborted: (await ctx.db.get(abortedId))?.status,
      freshQueued: (await ctx.db.get(freshQueuedId))?.status,
      freshRunning: (await ctx.db.get(freshRunningId))?.status,
    }));
    expect(statuses.staleQueued).toBe("failed");
    expect(statuses.staleRunning?.status).toBe("failed");
    expect(statuses.staleRunning?.endedAt).toBe(base + 20 * MINUTES);
    expect(statuses.completed).toBe("completed");
    expect(statuses.aborted).toBe("aborted");
    expect(statuses.freshQueued).toBe("queued");
    expect(statuses.freshRunning).toBe("running");
  });

  test("a reaped turn refuses late finalization and late tool writes", async () => {
    const setupResult = await setup();
    const { result, turn } = await sendQueuedTurn(setupResult);
    await setupResult.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: result.threadId,
      promptMessageId: result.messageId,
      startedAt: Date.now(),
    });

    vi.setSystemTime(Date.now() + 20 * MINUTES);
    await setupResult.t.mutation(internal.chatV2.failStaleChatTurns, {
      olderThanMinutes: 15,
    });
    const reaped = await setupResult.t.run(async (ctx) => await ctx.db.get(turn._id));
    expect(reaped?.status).toBe("failed");

    // A zombie action that somehow survives cannot resurrect the turn…
    await expect(
      setupResult.t.mutation(internal.chatV2.finishTurn, {
        agentThreadId: result.threadId,
        promptMessageId: result.messageId,
        requestedStatus: "completed",
        endedAt: Date.now(),
        stepCount: 1,
      })
    ).resolves.toEqual({ status: "failed" });
    // …and its tool calls hit the same stop fence as an aborted turn.
    await expect(
      setupResult.t.mutation(internal.chatV2.saveProposal, {
        agentThreadId: result.threadId,
        toolCallId: "call-after-reap",
        promptMessageId: result.messageId,
        kind: "references",
        references: ["anything"],
      })
    ).resolves.toEqual({
      ok: false,
      stopped: true,
      reason: "The writer stopped this reply.",
    });
  });
});

describe("listTurns", () => {
  test("returns the newest 200 authorized turns in ascending range order", async () => {
    const { t, actor, projectId, reportId } = await setup();
    const threadId = "thread-list";
    await t.run(async (ctx) => {
      await ctx.db.insert("agentChatThreads", {
        projectId,
        reportId,
        agentThreadId: threadId,
        title: "Timing list",
        createdAt: Date.now(),
      });
      for (let order = 1; order <= 240; order += 1) {
        await ctx.db.insert("chatTurns", {
          agentThreadId: threadId,
          promptMessageId: `prompt-${order}`,
          order,
          status: "completed",
          startedAt: order * 10,
          endedAt: order * 10 + 5,
          stepCount: order % 4,
        });
      }
    });

    const turns = await actor.query(api.chatV2.listTurns, {
      threadId,
      startOrder: 10,
      endOrder: 230,
    });
    expect(turns).toHaveLength(200);
    expect(turns[0]?.order).toBe(31);
    expect(turns.at(-1)?.order).toBe(230);
    expect(turns.map((turn) => turn.order)).toEqual(
      [...turns].map((turn) => turn.order).sort((a, b) => a - b)
    );
    await expect(
      actor.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 20,
        endOrder: 19,
      })
    ).resolves.toEqual([]);
  });

  test("returns no metadata for an inaccessible thread", async () => {
    const { t, projectId, reportId } = await setup();
    const threadId = "thread-private";
    await t.run(async (ctx) => {
      await ctx.db.insert("agentChatThreads", {
        projectId,
        reportId,
        agentThreadId: threadId,
        title: "Private timing",
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatTurns", {
        agentThreadId: threadId,
        promptMessageId: "private-prompt",
        order: 1,
        status: "completed",
        stepCount: 0,
      });
    });

    await expect(
      t.query(api.chatV2.listTurns, {
        threadId,
        startOrder: 1,
        endOrder: 1,
      })
    ).resolves.toEqual([]);
    await expect(
      t.withIdentity({ subject: "unmapped-user" }).query(api.chatV2.listTurns, {
        threadId,
        startOrder: 1,
        endOrder: 1,
      })
    ).resolves.toEqual([]);
  });
});

// ─── CAP-8: bounded proposal reads and safe empty thread reads ───────────────

async function errorCode(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ConvexError);
    return (err as ConvexError<{ code: string }>).data.code;
  }
  throw new Error("expected the call to reject");
}

/** Thread with turns 1..5, each carrying one proposal keyed by promptMessageId. */
async function seedProposalThread(
  setupResult: Awaited<ReturnType<typeof setup>>,
  threadId: string
) {
  const { t, projectId, reportId } = setupResult;
  return await t.run(async (ctx) => {
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId: threadId,
      title: "Proposal window",
      createdAt: Date.now(),
    });
    const proposalIds = [];
    // Insert in reverse so creation order differs from createdAt order and
    // the ascending-createdAt sort is actually exercised.
    for (let order = 5; order >= 1; order -= 1) {
      await ctx.db.insert("chatTurns", {
        agentThreadId: threadId,
        promptMessageId: `prompt-${order}`,
        order,
        status: "completed",
        stepCount: 1,
      });
      proposalIds.push(
        await ctx.db.insert("chatProposals", {
          agentThreadId: threadId,
          promptMessageId: `prompt-${order}`,
          toolCallId: `call-${order}`,
          projectId,
          reportId,
          kind: "edit",
          targetText: `old ${order}`,
          newText: `new ${order}`,
          state: "pending",
          createdAt: 1000 * order,
        })
      );
    }
    return proposalIds;
  });
}

describe("CHAT_CONTEXT_OPTIONS", () => {
  test("caps the model context at 30 recent non-tool messages", async () => {
    const { CHAT_CONTEXT_OPTIONS } = await import("./ai/chatAgentV2");
    expect(CHAT_CONTEXT_OPTIONS).toEqual({
      recentMessages: 30,
      excludeToolMessages: true,
    });
  });

  test("is the object passed to the streamText call site", async () => {
    const source = await readFile(
      new URL("./ai/chatAgentV2.ts", import.meta.url),
      "utf8"
    );
    const call = source.slice(source.indexOf("reportChatAgent.streamText("));
    // The options argument is the one carrying saveStreamDeltas.
    const optionsArg = call.slice(0, call.indexOf("await result.consumeStream()"));
    expect(optionsArg).toMatch(
      /\{\s*saveStreamDeltas: true,\s*contextOptions: CHAT_CONTEXT_OPTIONS\s*\}/
    );
    // Anchored on the call, not the Agent constructor.
    const ctor = source.slice(
      source.indexOf("new Agent("),
      source.indexOf("reportChatAgent.streamText(")
    );
    expect(ctor).not.toContain("contextOptions");
  });
});

describe("listProposals", () => {
  test("returns only the proposals of turns inside the window, ascending createdAt", async () => {
    const setupResult = await setup();
    const threadId = "thread-proposals";
    await seedProposalThread(setupResult, threadId);

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
      startOrder: 2,
      endOrder: 4,
    });
    expect(proposals.map((p) => p.promptMessageId)).toEqual([
      "prompt-2",
      "prompt-3",
      "prompt-4",
    ]);
    expect(proposals.map((p) => p.createdAt)).toEqual([2000, 3000, 4000]);
  });

  test("excludes proposals outside the window", async () => {
    const setupResult = await setup();
    const threadId = "thread-proposals-tail";
    await seedProposalThread(setupResult, threadId);

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
      startOrder: 5,
      endOrder: 5,
    });
    expect(proposals.map((p) => p.promptMessageId)).toEqual(["prompt-5"]);
  });

  test("returns [] for an inverted window", async () => {
    const setupResult = await setup();
    const threadId = "thread-proposals-inverted";
    await seedProposalThread(setupResult, threadId);

    await expect(
      setupResult.actor.query(api.chatV2.listProposals, {
        threadId,
        startOrder: 4,
        endOrder: 2,
      })
    ).resolves.toEqual([]);
  });

  test("orders same-createdAt proposals by _creationTime", async () => {
    const setupResult = await setup();
    const threadId = "thread-proposals-ties";
    await seedProposalThread(setupResult, threadId);
    const { t, projectId, reportId } = setupResult;
    // Two extra proposals on turn 3 sharing turn 3's createdAt: insertion
    // order (_creationTime) must break the tie deterministically.
    const tieIds = await t.run(async (ctx) => {
      const ids = [];
      for (const suffix of ["a", "b"]) {
        ids.push(
          await ctx.db.insert("chatProposals", {
            agentThreadId: threadId,
            promptMessageId: "prompt-3",
            toolCallId: `call-3-${suffix}`,
            projectId,
            reportId,
            kind: "edit",
            targetText: `old 3 ${suffix}`,
            newText: `new 3 ${suffix}`,
            state: "pending",
            createdAt: 3000,
          })
        );
      }
      return ids;
    });

    const proposals = await setupResult.actor.query(api.chatV2.listProposals, {
      threadId,
      startOrder: 3,
      endOrder: 3,
    });
    expect(proposals.map((p) => p.createdAt)).toEqual([3000, 3000, 3000]);
    expect(proposals.map((p) => p.toolCallId)).toEqual(["call-3", "call-3-a", "call-3-b"]);
    expect(proposals.slice(1).map((p) => p._id)).toEqual(tieIds);
  });

  test("returns [] for a thread with no agentChatThreads row", async () => {
    const { actor } = await setup();
    await expect(
      actor.query(api.chatV2.listProposals, {
        threadId: "thread-does-not-exist",
        startOrder: 1,
        endOrder: 5,
      })
    ).resolves.toEqual([]);
  });

  test("returns [] for anonymous or unmapped callers on a real thread", async () => {
    const setupResult = await setup();
    const threadId = "thread-proposals-private";
    await seedProposalThread(setupResult, threadId);
    const { t } = setupResult;
    await t.run(async (ctx) => {
      await ctx.db.insert("users", {
        authId: "auth-chat-anon",
        role: "writer",
        isAnonymous: true,
      });
    });
    const args = { threadId, startOrder: 1, endOrder: 5 };

    await expect(t.query(api.chatV2.listProposals, args)).resolves.toEqual([]);
    await expect(
      t.withIdentity({ subject: "unmapped-user" }).query(api.chatV2.listProposals, args)
    ).resolves.toEqual([]);
    await expect(
      t.withIdentity({ subject: "auth-chat-anon" }).query(api.chatV2.listProposals, args)
    ).resolves.toEqual([]);
  });
});

describe("abortStreaming", () => {
  test("still throws for a thread with no agentChatThreads row", async () => {
    const { actor } = await setup();
    await expect(
      actor.mutation(api.chatV2.abortStreaming, { threadId: "thread-gone", order: 1 })
    ).rejects.toThrow("Thread not found");
  });
});

describe("listMessages", () => {
  test("returns an empty page instead of throwing for an unknown thread", async () => {
    const { actor } = await setup();
    await expect(
      actor.query(api.chatV2.listMessages, {
        threadId: "thread-gone",
        paginationOpts: { cursor: null, numItems: 80 },
        streamArgs: undefined,
      })
    ).resolves.toEqual({
      page: [],
      isDone: true,
      continueCursor: "",
      streams: undefined,
    });
  });

  test("still rejects a role-less identity on an existing thread", async () => {
    const { t, projectId, reportId } = await setup();
    const threadId = "thread-messages-private";
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "auth-chat-roleless" });
      await ctx.db.insert("agentChatThreads", {
        projectId,
        reportId,
        agentThreadId: threadId,
        title: "Private messages",
        createdAt: Date.now(),
      });
    });

    const code = await errorCode(
      t.withIdentity({ subject: "auth-chat-roleless" }).query(api.chatV2.listMessages, {
        threadId,
        paginationOpts: { cursor: null, numItems: 80 },
        streamArgs: undefined,
      })
    );
    expect(code).toBe("NOT_AUTHORIZED");
  });
});
