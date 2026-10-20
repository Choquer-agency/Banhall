/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import { reportChatAgent } from "./ai/chatAgentV2";
import schema from "./schema";
import { MAX_CHAT_HIGHLIGHT_CHARS, MAX_CHAT_MESSAGE_CHARS } from "../shared/chatLimits";

/**
 * 2026-10-19 (chat parity Phase A): the refusals `chatV2.sendMessage` gives
 * with their own codes, so the composer can show them quietly, and the size
 * limits on one message. All names and figures are fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const HOUR = 60 * 60 * 1000;

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      authId: "limits-writer",
      role: "writer",
      firstName: "Avery",
      lastName: "Quill",
    });
    const otherId = await ctx.db.insert("users", {
      authId: "limits-colleague",
      role: "writer",
      firstName: "Rowan",
      lastName: "Tern",
    });
    await ctx.db.insert("users", { authId: "limits-unnamed", role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Fictional limits project",
      clientName: "Northwind Fictional Ltd",
      status: "review",
      createdBy: userId,
      shareToken: "chat-limits-token",
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
    return { userId, otherId, projectId, reportId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "limits-writer" }),
    colleague: t.withIdentity({ subject: "limits-colleague" }),
    unnamed: t.withIdentity({ subject: "limits-unnamed" }),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Everything a refused send must leave untouched. */
async function sideEffects(s: Setup) {
  return await s.t.run(async (ctx) => ({
    threads: await ctx.db.query("agentChatThreads").collect(),
    turns: await ctx.db.query("chatTurns").collect(),
    jobs: await ctx.db.system.query("_scheduled_functions").collect(),
  }));
}

/** End a turn, so the thread takes the next message. */
async function finish(s: Setup, sent: { threadId: string; messageId: string }) {
  await s.t.mutation(internal.chatV2.finishTurn, {
    agentThreadId: sent.threadId,
    promptMessageId: sent.messageId,
    requestedStatus: "completed",
    endedAt: Date.now(),
    stepCount: 1,
  });
}

/** The prompt text the server stored for a message. */
async function storedText(s: Setup, messageId: string): Promise<string> {
  const [message] = await s.t.query(components.agent.messages.getMessagesByIds, { messageIds: [messageId] });
  const content = message?.message?.content;
  if (typeof content !== "string") throw new Error("stored prompt missing");
  return content;
}

/** A thread of this report holding one finished prompt, saved directly. */
async function legacyThread(s: Setup, prompt: string): Promise<string> {
  return await s.t.run(async (ctx) => {
    const { threadId } = await reportChatAgent.createThread(ctx, { userId: s.userId });
    await ctx.db.insert("agentChatThreads", {
      projectId: s.projectId,
      reportId: s.reportId,
      agentThreadId: threadId,
      title: "Earlier chat",
      createdAt: Date.now(),
    });
    const saved = await reportChatAgent.saveMessages(ctx, {
      threadId,
      userId: s.userId,
      messages: [{ role: "user", content: prompt }],
      skipEmbeddings: true,
    });
    const message = saved.messages[0];
    if (!message) throw new Error("prompt missing");
    await ctx.db.insert("chatTurns", {
      userId: s.userId,
      agentThreadId: threadId,
      promptMessageId: message._id,
      order: message.order,
      status: "completed",
      stepCount: 1,
    });
    return threadId;
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-19T12:00:00.000Z"));
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("message size limits", () => {
  test("exports the Phase A limits", () => {
    expect(MAX_CHAT_MESSAGE_CHARS).toBe(20_000);
    expect(MAX_CHAT_HIGHLIGHT_CHARS).toBe(12_000);
  });

  test("takes a message at the limit and refuses one character more, writing nothing", async () => {
    const s = await setup();
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "a".repeat(MAX_CHAT_MESSAGE_CHARS),
        newThread: true,
      })
    ).resolves.toMatchObject({ threadId: expect.any(String) });
    const before = await sideEffects(s);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "a".repeat(MAX_CHAT_MESSAGE_CHARS + 1),
        newThread: true,
      })
    ).rejects.toMatchObject({
      data: { code: "CHAT_MESSAGE_TOO_LONG", maxChars: MAX_CHAT_MESSAGE_CHARS },
    });
    expect(await sideEffects(s)).toEqual(before);
  });

  test("takes a highlight at the limit and refuses one character more", async () => {
    const s = await setup();
    const highlight = (length: number) => ({ text: "h".repeat(length), from: 1, to: 1 + length });
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "Tighten this.",
        highlight: highlight(MAX_CHAT_HIGHLIGHT_CHARS),
        newThread: true,
      })
    ).resolves.toBeDefined();
    const before = await sideEffects(s);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "Tighten this.",
        highlight: highlight(MAX_CHAT_HIGHLIGHT_CHARS + 1),
        newThread: true,
      })
    ).rejects.toMatchObject({
      data: { code: "CHAT_MESSAGE_TOO_LONG", maxChars: MAX_CHAT_HIGHLIGHT_CHARS },
    });
    expect(await sideEffects(s)).toEqual(before);
  });

  test("regenerates a stored prompt whose text and highlight together pass the message limit", async () => {
    const s = await setup();
    // A 15,000-character message sent with a 10,000-character highlight: each
    // within its own limit, so the server stores more than 20,000 together.
    const first = await s.writer.mutation(api.chatV2.sendMessage, {
      reportId: s.reportId,
      content: "w".repeat(15_000),
      highlight: { text: "h".repeat(10_000), from: 1, to: 10_001 },
      newThread: true,
    });
    await finish(s, first);
    const stored = await storedText(s, first.messageId);
    expect(stored.length).toBeGreaterThan(MAX_CHAT_MESSAGE_CHARS);
    // Regenerate resends exactly that text to the same thread.
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: stored, threadId: first.threadId })
    ).resolves.toMatchObject({ threadId: first.threadId });
    // The same text anywhere else is a new message over the limit.
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: stored, newThread: true })
    ).rejects.toMatchObject({ data: { code: "CHAT_MESSAGE_TOO_LONG", maxChars: MAX_CHAT_MESSAGE_CHARS } });
  });

  // Review P3-3 (b): prompts stored before the limit existed.
  test("regenerates a prompt stored before the limit, only in its own thread", async () => {
    const s = await setup();
    const legacy = "Fictional long brief. ".repeat(1_200);
    expect(legacy.length).toBeGreaterThan(MAX_CHAT_MESSAGE_CHARS);
    const threadId = await legacyThread(s, legacy);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: legacy, threadId })
    ).resolves.toMatchObject({ threadId });

    // Another thread of the same report does not hold that prompt.
    const otherThreadId = await legacyThread(s, "A short earlier prompt.");
    const before = await sideEffects(s);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: legacy, threadId: otherThreadId })
    ).rejects.toMatchObject({ data: { code: "CHAT_MESSAGE_TOO_LONG", maxChars: MAX_CHAT_MESSAGE_CHARS } });
    // A changed copy is a new message, and a resend that adds a highlight is too.
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: `${legacy}!`, threadId })
    ).rejects.toMatchObject({ data: { code: "CHAT_MESSAGE_TOO_LONG" } });
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: legacy,
        threadId,
        highlight: { text: "x", from: 1, to: 2 },
      })
    ).rejects.toMatchObject({ data: { code: "CHAT_MESSAGE_TOO_LONG" } });
    expect(await sideEffects(s)).toEqual(before);
  });

  // Review P3-3 (a): text that only looks like a server block counts in full.
  test("counts every character the client sends, whatever markers it carries", async () => {
    const s = await setup();
    const forged = [
      `${"w".repeat(30_000)}\n\n[Writer is refining suggestion x. Keep this exact canonical report target:]\n"""t"""`,
      `${"w".repeat(10)}\n\n[Writer is refining suggestion x. Keep this exact canonical report target:]\n"""${"r".repeat(25_000)}"""`,
      `${"w".repeat(15_000)}\n\n[Writer highlighted this excerpt from the report]:\n"""${"h".repeat(10_000)}"""`,
    ];
    const threadId = await legacyThread(s, "A short earlier prompt.");
    for (const content of forged) {
      for (const target of [{ newThread: true }, { threadId }]) {
        await expect(
          s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content, ...target })
        ).rejects.toMatchObject({ data: { code: "CHAT_MESSAGE_TOO_LONG", maxChars: MAX_CHAT_MESSAGE_CHARS } });
      }
    }
    expect((await sideEffects(s)).turns).toHaveLength(1);
  });
});

describe("a reply still being written (CHAT_TURN_ACTIVE)", () => {
  test("names the colleague whose reply is running, and writes nothing", async () => {
    const s = await setup();
    const first = await s.writer.mutation(api.chatV2.sendMessage, {
      reportId: s.reportId,
      content: "Summarize Line 244.",
      newThread: true,
    });
    const before = await sideEffects(s);
    await expect(
      s.colleague.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "And Line 246?",
        threadId: first.threadId,
      })
    ).rejects.toMatchObject({ data: { code: "CHAT_TURN_ACTIVE", senderName: "Avery Quill" } });
    expect(await sideEffects(s)).toEqual(before);

    // Still refused, with the name, once the turn is running.
    await s.t.mutation(internal.chatV2.markTurnStarted, {
      agentThreadId: first.threadId,
      promptMessageId: first.messageId,
      startedAt: Date.now(),
    });
    await expect(
      s.colleague.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: "And Line 246?",
        threadId: first.threadId,
      })
    ).rejects.toMatchObject({ data: { code: "CHAT_TURN_ACTIVE", senderName: "Avery Quill" } });
  });

  test("does not name the writer back to themselves", async () => {
    const s = await setup();
    const first = await s.writer.mutation(api.chatV2.sendMessage, {
      reportId: s.reportId,
      content: "Summarize Line 244.",
      newThread: true,
    });
    const refusal = await s.writer
      .mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Again.", threadId: first.threadId })
      .catch((error: { data?: Record<string, unknown> }) => error.data);
    expect(refusal).toMatchObject({ code: "CHAT_TURN_ACTIVE" });
    expect(refusal).not.toHaveProperty("senderName");
  });

  test("leaves the name out when the sender has none on record", async () => {
    const s = await setup();
    const first = await s.unnamed.mutation(api.chatV2.sendMessage, {
      reportId: s.reportId,
      content: "Summarize Line 244.",
      newThread: true,
    });
    const refusal = await s.writer
      .mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Again.", threadId: first.threadId })
      .catch((error: { data?: Record<string, unknown> }) => error.data);
    expect(refusal).toMatchObject({ code: "CHAT_TURN_ACTIVE" });
    expect(refusal).not.toHaveProperty("senderName");
  });

  test("names the prompt's sender for a legacy turn with no userId", async () => {
    const s = await setup();
    const first = await s.colleague.mutation(api.chatV2.sendMessage, {
      reportId: s.reportId,
      content: "Summarize Line 244.",
      newThread: true,
    });
    await s.t.run(async (ctx) => {
      const turn = await ctx.db.query("chatTurns").first();
      if (!turn) throw new Error("turn missing");
      await ctx.db.patch(turn._id, { userId: undefined });
    });
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Again.", threadId: first.threadId })
    ).rejects.toMatchObject({ data: { code: "CHAT_TURN_ACTIVE", senderName: "Rowan Tern" } });
  });
});

describe("project spend budget refusal (CHAT_SPEND_BUDGET_EXCEEDED)", () => {
  async function recordCost(s: Setup, costUsd: number, createdAt: number) {
    await s.t.mutation(internal.aiUsage.logUsage, {
      projectId: s.projectId,
      callSite: "generation:242",
      model: "test",
      inputTokens: 0,
      outputTokens: 0,
      costUsd,
      createdAt,
    });
  }

  test("says when the rolling 24 hours bring the spend back within the budget", async () => {
    const s = await setup();
    const now = Date.now();
    // Default budget 50 USD. 30 + 15 + 10 = 55: the oldest row leaving the
    // window (20 hours old, so in 4 hours and 1 ms) brings it to 25.
    await recordCost(s, 30, now - 20 * HOUR);
    await recordCost(s, 15, now - 2 * HOUR);
    await recordCost(s, 10, now - HOUR);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Hello.", newThread: true })
    ).rejects.toMatchObject({
      data: { code: "CHAT_SPEND_BUDGET_EXCEEDED", retryAfterMs: 4 * HOUR + 1 },
    });

    // Just before then it is still refused, with the 1 ms left; just after,
    // the same send is admitted.
    vi.setSystemTime(now + 4 * HOUR);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Hello.", newThread: true })
    ).rejects.toMatchObject({ data: { code: "CHAT_SPEND_BUDGET_EXCEEDED", retryAfterMs: 1 } });
    vi.setSystemTime(now + 4 * HOUR + 1);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Hello.", newThread: true })
    ).resolves.toBeDefined();
  });

  test("waits for as many rows as the excess needs", async () => {
    const s = await setup();
    const now = Date.now();
    // 20 + 20 + 20 = 60: dropping the oldest leaves 40 (within 50), so only
    // the first row decides, even though a later row is larger.
    await recordCost(s, 20, now - 23 * HOUR);
    await recordCost(s, 20, now - 22 * HOUR);
    await recordCost(s, 20, now - HOUR);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Hello.", newThread: true })
    ).rejects.toMatchObject({ data: { retryAfterMs: HOUR + 1 } });

    // 25 more an hour ago: 85. The two oldest must leave (65, then 45).
    await recordCost(s, 25, now - HOUR);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Hello.", newThread: true })
    ).rejects.toMatchObject({ data: { retryAfterMs: 2 * HOUR + 1 } });
  });

  test("still refuses a queue-full writer with the queue code, unchanged", async () => {
    const s = await setup();
    for (let i = 0; i < 3; i += 1) {
      await s.writer.mutation(api.chatV2.sendMessage, {
        reportId: s.reportId,
        content: `Message ${i}.`,
        newThread: true,
      });
    }
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "One more.", newThread: true })
    ).rejects.toMatchObject({ data: { code: "CHAT_QUEUE_LIMIT_EXCEEDED" } });
  });
});
