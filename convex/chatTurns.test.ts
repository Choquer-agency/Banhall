/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
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
