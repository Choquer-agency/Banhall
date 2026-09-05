/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { getConvexSize } from "convex/values";
import { expect, test } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { reportChatAgent } from "./ai/chatAgentV2";
const modules = import.meta.glob("./**/*.ts");

async function setup(historyRows = 0) {
  const t = convexTest({ schema, modules, transactionLimits: true });
  agentTest.register(t);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { authId: "probe-voter", role: "writer" });
    const projectId = await ctx.db.insert("projects", { title: "Fixture", clientName: "Fixture", createdBy: userId, status: "draft", shareToken: "fixture", createdAt: 1, updatedAt: 1 });
    const reportId = await ctx.db.insert("reports", { projectId, content: "", version: 1, generatedAt: 1, updatedAt: 1 });
    return { userId, projectId, reportId };
  });
  const { threadId } = await t.run(ctx => reportChatAgent.createThread(ctx, { userId: ids.userId }));
  const content = "history ".repeat(22_500); // 180k ASCII; stored text plus message remains below 1MiB.
  for (let i = 0; i < historyRows; i++) {
    const saved = await t.run(ctx => reportChatAgent.saveMessages(ctx, {
      threadId, messages: [{ role: "user", content }, { role: "assistant", content: `Prior answer ${i}` }], skipEmbeddings: true,
    }));
    for (const message of saved.messages) {
      expect(getConvexSize(message)).toBeLessThan(1_000_000);
    }
  }
  const promptSaved = await t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId, messages: [{ role: "user", content: "Latest small question" }], skipEmbeddings: true }));
  const prompt = promptSaved.messages[0];
  const answerSaved = await t.run(ctx => reportChatAgent.saveMessages(ctx, { threadId, promptMessageId: prompt._id, messages: [{ role: "assistant", content: "Latest small completed answer" }], skipEmbeddings: true }));
  const answer = answerSaved.messages[0];
  const turnId = await t.run(async ctx => {
    await ctx.db.insert("agentChatThreads", { projectId: ids.projectId, reportId: ids.reportId, agentThreadId: threadId, title: "Fixture", createdAt: 1 });
    return ctx.db.insert("chatTurns", { agentThreadId: threadId, promptMessageId: prompt._id, order: prompt.order, status: "completed", stepCount: 1 });
  });
  const actor = t.withIdentity({ subject: "probe-voter" });
  return { t, actor, ids, threadId, prompt, answer, turnId };
}

test("rates an available latest answer despite large prior prompt history", async () => {
  const { t, actor, threadId, turnId, answer } = await setup(49);
  const visible = await actor.query(api.chatV2.listMessages, { threadId, paginationOpts: { cursor: null, numItems: 80 }, streamArgs: undefined });
  expect(JSON.stringify(visible.page)).toContain("Latest small completed answer");
  expect(await actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).toBe(1);
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ answerMessageId: answer._id, answerText: "Latest small completed answer", vote: 1 });
});


test.each([99, 100])("keeps the 100-record boundary with %s later nontext records", async count => {
  const { t, actor, threadId, prompt, turnId, answer } = await setup();
  await t.run(ctx => reportChatAgent.saveMessages(ctx, {
    threadId, promptMessageId: prompt._id,
    messages: Array.from({ length: count }, () => ({ role: "assistant", content: [{ type: "reasoning", text: "PRIVATE REASONING" }] })),
    skipEmbeddings: true,
  }));
  if (count === 99) {
    expect(await actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).toBe(1);
    expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ answerMessageId: answer._id, answerText: "Latest small completed answer" });
  } else {
    await expect(actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);
  }
});

test("stops safely at the byte bound instead of reading a text answer beyond it", async () => {
  const { t, actor, threadId, prompt, turnId } = await setup();
  for (let i = 0; i < 5; i++) {
    const saved = await t.run(ctx => reportChatAgent.saveMessages(ctx, {
      threadId, promptMessageId: prompt._id,
      messages: [{ role: "assistant", content: [{ type: "reasoning", text: "r".repeat(400_000) }] }], skipEmbeddings: true,
    }));
    expect(getConvexSize(saved.messages[0])).toBeLessThan(1_000_000);
  }
  await expect(actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT", message: "Chat answer is unavailable within feedback read limits" } });
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);
});


test("does not rate an earlier answer when the target has no text on continuation", async () => {
  const { t, actor, threadId, prompt, turnId, answer } = await setup(1);
  await t.mutation(components.agent.messages.deleteByIds, { messageIds: [answer._id] });
  await t.run(ctx => reportChatAgent.saveMessages(ctx, {
    threadId, promptMessageId: prompt._id,
    messages: [{ role: "assistant", content: [{ type: "reasoning", text: "No public target text" }] }], skipEmbeddings: true,
  }));
  await expect(actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);
});

test("bounds both merged tool and non-tool streams before safe byte exhaustion", async () => {
  const { t, actor, threadId, prompt, turnId } = await setup();
  for (let i = 0; i < 5; i++) {
    const saved = await t.run(ctx => reportChatAgent.saveMessages(ctx, {
      threadId, promptMessageId: prompt._id,
      messages: [
        { role: "assistant", content: [{ type: "tool-call", toolCallId: `probe-${i}`, toolName: "searchBrain", input: { payload: "t".repeat(400_000) } }] },
        { role: "assistant", content: [{ type: "reasoning", text: "r".repeat(400_000) }] },
      ], skipEmbeddings: true,
    }));
    for (const message of saved.messages) expect(getConvexSize(message)).toBeLessThan(1_000_000);
  }
  await expect(actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).rejects.toMatchObject({ data: { code: "INVALID_INPUT", message: "Chat answer is unavailable within feedback read limits" } });
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);
});
