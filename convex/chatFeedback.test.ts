/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { reportChatAgent } from "./ai/chatAgentV2";

const modules = import.meta.glob("./**/*.ts");
async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { authId: "voter", role: "writer" });
    await ctx.db.insert("users", { authId: "second", role: "writer" });
    await ctx.db.insert("users", { authId: "roleless" });
    await ctx.db.insert("users", { authId: "anonymous", role: "writer", isAnonymous: true });
    const projectId = await ctx.db.insert("projects", { title: "Secret trial", clientName: "Acme Farms", writer: "Johnny Test", createdBy: userId, status: "draft", shareToken: "secret", createdAt: 1, updatedAt: 1 });
    const reportId = await ctx.db.insert("reports", { projectId, content: "original", version: 1, generatedAt: 1, updatedAt: 1 });
    return { userId, projectId, reportId };
  });
  const { threadId } = await t.run(ctx => reportChatAgent.createThread(ctx, { userId: ids.userId }));
  const saved = await t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId, messages: [{ role: "user", content: "Help Acme Farms with Secret trial. Contact writer@example.com" }], skipEmbeddings: true }));
  const prompt = saved.messages[0];
  const answers = await t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId, promptMessageId: prompt._id, messages: [
    { role: "assistant", content: "Early answer" },
    { role: "assistant", content: [{ type: "reasoning", text: "PRIVATE REASONING" }, { type: "text", text: "Acme Farms should state the measured uncertainty. Ask Johnny Test at 613-555-0134." }] },
  ], skipEmbeddings: true }));
  const turnId = await t.run(async ctx => {
    await ctx.db.insert("agentChatThreads", { ...{ projectId: ids.projectId, reportId: ids.reportId }, agentThreadId: threadId, title: "Thread", createdAt: 1 });
    return ctx.db.insert("chatTurns", { agentThreadId: threadId, promptMessageId: prompt._id, order: prompt.order, status: "completed", stepCount: 1 });
  });
  return { t, ...ids, threadId, turnId, prompt, answer: answers.messages.at(-1), actor: t.withIdentity({ subject: "voter" }), args: { reportId: ids.reportId, threadId, turnIds: [turnId] } };
}

describe("completed chat answer feedback", () => {
  test.each([1, -1] as const)("persists vote %s with server context, one row per voter, and a later vote changes it", async vote => {
    const s = await setup();
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
    expect(await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote })).toBe(vote);
    // Phase C (W3): the voter may change their vote; it stays one row.
    const flipped = vote === 1 ? -1 : 1;
    await Promise.all([1, 2].map(() => s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: flipped })));
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([{ turnId: s.turnId, vote: flipped }]);
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote });
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([{ turnId: s.turnId, vote }]);
    const rows = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: s.userId, projectId: s.projectId, reportId: s.reportId, answerMessageId: s.answer?._id, vote, changeCount: 2 });
    expect(rows[0].answerText).toContain("Acme Farms");
    expect(rows[0].answerText).not.toContain("PRIVATE REASONING");
    expect(rows[0].answerText).not.toContain("Early answer");
    const other = s.t.withIdentity({ subject: "second" });
    expect(await other.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
    await other.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1 });
    expect(await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toHaveLength(2);
    const sanitized = JSON.stringify(await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 500 }));
    for (const secret of ["Acme Farms", "Johnny Test", "Secret trial", "writer@example.com", "613-555-0134", "PRIVATE REASONING"]) expect(sanitized).not.toContain(secret);
    expect(await s.t.run(ctx => ctx.db.get(s.reportId))).toMatchObject({ content: "original" });
  });
  test.each(["rename", "delete"])("keeps vote-time learning redaction stable after project %s", async change => {
    const s = await setup();
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
    await s.t.run(async ctx => {
      if (change === "delete") await ctx.db.delete(s.projectId);
      else await ctx.db.patch(s.projectId, { clientName: "Renamed", title: "Renamed title", writer: "Renamed writer" });
    });
    const rows = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 500 });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/Acme Farms|Johnny Test|Secret trial/);
    expect(await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ answerText: expect.stringContaining("Acme Farms") });
  });
  test("redacts identifiers crossing the stored text boundary and omits historical rows without snapshots", async () => {
    const s = await setup();
    const content = "x ".repeat(1998) + "Acme Farms should measure results.";
    await s.t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId: s.threadId, promptMessageId: s.prompt._id, messages: [{ role: "assistant", content }], skipEmbeddings: true }));
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
    const rows = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 500 });
    expect(rows[0].payload.answerText).toBe(content.replace("Acme Farms", "[redacted]").slice(0, 1000));
    const row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
    if (!row) throw new Error("Missing vote");
    expect(row.answerText).toHaveLength(4000);
    expect(row.learningSnapshot?.answerText).toBe(content.replace("Acme Farms", "[redacted]").slice(0, 4000));
    await s.t.run(ctx => ctx.db.patch(row._id, { learningSnapshot: undefined }));
    expect(await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 500 })).toEqual([]);
  });
  test.each([undefined, "roleless", "anonymous", "client"])("rejects writes and hides reads from %s", async subject => {
    const s = await setup();
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
    const actor = subject ? s.t.withIdentity({ subject }) : s.t;
    expect(await actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
    await expect(actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1 })).rejects.toThrow();
  });
  test.each(["queued", "running", "failed", "aborted"] as const)("rejects %s turns", async status => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.patch(s.turnId, { status }));
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
  });
  test("racing first votes create one row holding the last vote", async () => {
    const s = await setup();
    const results = await Promise.all([
      s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 }),
      s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1 }),
    ]);
    const rows = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect());
    expect(rows).toHaveLength(1);
    expect(results).toContain(rows[0].vote);
  });
  test("rejects orphan answers, foreign prompts, missing turns and inconsistent project mapping", async () => {
    const s = await setup();
    const foreign = await s.t.run(ctx => reportChatAgent.createThread(ctx, {}));
    const foreignMessages = await s.t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId: foreign.threadId, messages: [{ role: "user", content: "Foreign prompt" }], skipEmbeddings: true }));
    await s.t.run(ctx => ctx.db.patch(s.turnId, { promptMessageId: foreignMessages.messages[0]._id }));
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await s.t.run(ctx => ctx.db.patch(s.turnId, { promptMessageId: s.prompt._id }));
    const allMessages = await s.t.query(components.agent.messages.listMessagesByThreadId, { threadId: s.threadId, order: "asc" });
    await s.t.mutation(components.agent.messages.deleteByIds, { messageIds: allMessages.page.filter(m => m.message?.role === "assistant").map(m => m._id) });
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    const otherProject = await s.t.run(ctx => ctx.db.insert("projects", { title: "Other", clientName: "Other client", createdBy: s.userId, status: "draft", shareToken: "other", createdAt: 1, updatedAt: 1 }));
    await s.t.run(ctx => ctx.db.patch(s.reportId, { projectId: otherProject }));
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    await s.t.run(ctx => ctx.db.delete(s.turnId));
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  });
  test("rejects missing/mismatched prompt, report, thread and bounded query abuse", async () => {
    const s = await setup();
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, { ...s.args, threadId: "wrong" })).toEqual([]);
    await expect(s.actor.query(api.chatFeedback.getViewerVotes, { ...s.args, turnIds: Array(201).fill(s.turnId) })).rejects.toThrow();
    await s.t.run(ctx => ctx.db.patch(s.turnId, { order: s.prompt.order + 1 }));
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toThrow();
    await s.t.run(ctx => ctx.db.patch(s.turnId, { order: s.prompt.order }));
    await s.t.mutation(components.agent.messages.deleteByIds, { messageIds: [s.prompt._id] });
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toThrow();
    await s.t.run(ctx => ctx.db.delete(s.reportId));
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toThrow();
  });
});

test("selects bounded text from the exact turn and ignores subsequent turns and tool-only answers", async () => {
  const s = await setup();
  await s.t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId: s.threadId, promptMessageId: s.prompt._id,
    messages: [{ role: "assistant", content: [{ type: "tool-call", toolCallId: "lookup", toolName: "searchBrain", input: { private: "TOOL PAYLOAD" } }] }], skipEmbeddings: true }));
  await s.t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId: s.threadId,
    messages: [{ role: "user", content: "Other turn" }, { role: "assistant", content: "NEIGHBOUR ANSWER" }], skipEmbeddings: true }));
  await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
  const rows = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect());
  expect(rows[0].answerMessageId).toBe(s.answer?._id);
  expect(rows[0].answerText).not.toContain("TOOL PAYLOAD");
  expect(rows[0].answerText).not.toContain("NEIGHBOUR ANSWER");
});

test("bounds snapshotted text and rejects a turn without a mapped thread", async () => {
  const s = await setup();
  await s.t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId: s.threadId, promptMessageId: s.prompt._id,
    messages: [{ role: "assistant", content: "Meaningful measured comparison. ".repeat(500) }], skipEmbeddings: true }));
  await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1 });
  const rows = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect());
  expect(rows[0].answerText).toHaveLength(4000);
  await s.t.run(async ctx => {
    const thread = await ctx.db.query("agentChatThreads").withIndex("by_agentThreadId", q => q.eq("agentThreadId", s.threadId)).unique();
    if (thread) await ctx.db.delete(thread._id);
  });
  expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([]);
  await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
});


test("preserves complete Unicode characters at raw and sanitized snapshot boundaries", async () => {
  const s = await setup();
  const content = "x".repeat(3999) + "🧪tail";
  await s.t.run(ctx => reportChatAgent.saveMessages(ctx, {
    threadId: s.threadId, promptMessageId: s.prompt._id,
    messages: [{ role: "assistant", content }], skipEmbeddings: true,
  }));
  await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
  const row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
  expect(row?.answerText).toBe("x".repeat(3999) + "🧪");
  expect(row?.learningSnapshot?.answerText).toBe(row?.answerText);
});

describe("Phase C: changeable votes and reasons", () => {
  test("offers a reason on thumbs down only, bounded, and clears it when the vote flips", async () => {
    const s = await setup();
    const vote = (args: Record<string, unknown>) => s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1, ...args });
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1, reasonCode: "wrong" })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1, reasonText: "Bad" })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(vote({ reasonCode: "other", reasonText: "x".repeat(501) })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(vote({ reasonCode: "nonsense" })).rejects.toThrow();
    expect(await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);

    expect(await vote({})).toBe(-1);
    let row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
    expect(row).toMatchObject({ vote: -1, learningSnapshot: { version: 2 } });
    expect(row).not.toHaveProperty("reasonCode");
    expect(row).not.toHaveProperty("updatedAt");

    await vote({ reasonCode: "made_up", reasonText: `  ${"y".repeat(500)}  ` });
    row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
    expect(row).toMatchObject({ vote: -1, reasonCode: "made_up", reasonText: "y".repeat(500), changeCount: 1 });
    expect(await s.actor.query(api.chatFeedback.getViewerVotes, s.args)).toEqual([{ turnId: s.turnId, vote: -1, reasonCode: "made_up", reasonText: "y".repeat(500) }]);

    // The same thumbs down again keeps the reason and changes nothing.
    await vote({});
    expect(await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ reasonCode: "made_up", changeCount: 1 });
    // Text alone counts as "Other".
    await vote({ reasonText: "Missed the point" });
    expect(await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ reasonCode: "other", reasonText: "Missed the point", changeCount: 2 });

    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
    row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
    expect(row).toMatchObject({ vote: 1, changeCount: 3 });
    expect(row).not.toHaveProperty("reasonCode");
    expect(row).not.toHaveProperty("reasonText");
    expect(row?.learningSnapshot).not.toHaveProperty("reasonCode");
    expect(row?.learningSnapshot).not.toHaveProperty("reasonText");
  });

  test("the learning snapshot carries the reason de-identified, and the digest reads a changed vote as a new signal", async () => {
    const s = await setup();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
      // A newer vote by someone else, so the changed vote must rise above it.
      const other = s.t.withIdentity({ subject: "second" });
      vi.setSystemTime(2_000);
      await other.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
      let signals = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 1 });
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ updatedAt: 2_000, payload: { vote: 1 } });

      vi.setSystemTime(3_000);
      await s.actor.mutation(api.chatFeedback.submitFeedback, {
        turnId: s.turnId, vote: -1, reasonCode: "wrong",
        reasonText: "Acme Farms never ran Secret trial; ask Johnny Test at writer@example.com",
      });
      signals = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 1 });
      expect(signals).toHaveLength(1);
      expect(signals[0]).toMatchObject({ producerId: s.userId, updatedAt: 3_000, payload: { vote: -1, reason: { code: "wrong" } } });
      const sanitized = JSON.stringify(signals);
      for (const secret of ["Acme Farms", "Johnny Test", "Secret trial", "writer@example.com"]) expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain("never ran");
      const row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").withIndex("by_turnId_and_userId", q => q.eq("turnId", s.turnId).eq("userId", s.userId)).unique());
      expect(row).toMatchObject({ reasonText: expect.stringContaining("Acme Farms"), learningSnapshot: { version: 2, reasonCode: "wrong" } });
      expect(row?.learningSnapshot?.reasonText).not.toContain("Acme Farms");

      // Both votes, newest signal first, each once.
      signals = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 20 });
      expect(signals.map(signal => signal.updatedAt)).toEqual([3_000, 2_000]);
      // A flip back to thumbs up drops the reason from the signal.
      vi.setSystemTime(4_000);
      await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
      signals = await s.t.query(internal.chatFeedback.getFeedbackForDigest, { limit: 20 });
      expect(signals[0]).toMatchObject({ updatedAt: 4_000, payload: { vote: 1 } });
      expect(signals[0].payload).not.toHaveProperty("reason");
    } finally {
      vi.useRealTimers();
    }
  });

  test("a version 1 snapshot is upgraded on change and keeps its de-identified text", async () => {
    const s = await setup();
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: 1 });
    await s.t.run(async ctx => {
      const row = await ctx.db.query("chatAnswerFeedback").first();
      if (!row?.learningSnapshot) throw new Error("Missing vote");
      await ctx.db.patch(row._id, { learningSnapshot: { version: 1, promptText: row.learningSnapshot.promptText, answerText: row.learningSnapshot.answerText } });
    });
    await s.actor.mutation(api.chatFeedback.submitFeedback, { turnId: s.turnId, vote: -1, reasonCode: "too_long" });
    const row = await s.t.run(ctx => ctx.db.query("chatAnswerFeedback").first());
    expect(row?.learningSnapshot).toMatchObject({ version: 2, reasonCode: "too_long" });
    expect(row?.learningSnapshot?.answerText).not.toContain("Acme Farms");
  });
});
