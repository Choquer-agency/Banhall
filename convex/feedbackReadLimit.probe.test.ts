/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { getConvexSize } from "convex/values";
import { expect, test } from "vitest";
import { api, components } from "./_generated/api";
import schema from "./schema";
import { reportChatAgent } from "./ai/chatAgentV2";
const modules = import.meta.glob("./**/*.ts");

test("probe: valid historical messages exhaust feedback read while latest answer is available", async () => {
  const t = convexTest({ schema, modules, transactionLimits: true });
  agentTest.register(t);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { authId: "probe-voter", role: "writer" });
    const projectId = await ctx.db.insert("projects", { title: "Fixture", clientName: "Fixture", createdBy: userId, status: "draft", shareToken: "fixture", createdAt: 1, updatedAt: 1 });
    const reportId = await ctx.db.insert("reports", { projectId, content: "", version: 1, generatedAt: 1, updatedAt: 1 });
    return { userId, projectId, reportId };
  });
  const { threadId } = await t.run(ctx => reportChatAgent.createThread(ctx, { userId: ids.userId }));
  const historicalIds: string[] = [];
  const content = "history ".repeat(22_500); // 180k ASCII; stored text plus message remains below 1MiB.
  let largestPublicMessage = 0;
  for (let i = 0; i < 49; i++) {
    const saved = await t.run(ctx => reportChatAgent.saveMessages(ctx, {
      threadId, messages: [{ role: "user", content }, { role: "assistant", content: `Prior answer ${i}` }], skipEmbeddings: true,
    }));
    for (const message of saved.messages) {
      historicalIds.push(message._id);
      largestPublicMessage = Math.max(largestPublicMessage, getConvexSize(message));
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
  const visible = await actor.query(api.chatV2.listMessages, { threadId, paginationOpts: { cursor: null, numItems: 80 }, streamArgs: undefined });
  expect(JSON.stringify(visible.page)).toContain("Latest small completed answer");
  let failure: unknown;
  try { await actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 }); }
  catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure instanceof Error ? failure.message : "").toContain("Read too much data");
  console.info(JSON.stringify({ historyLongPrompts: 49, bodyCharacters: content.length, largestPublicMessage, visibleRows: visible.page.length, visibleAnswerId: answer._id, failure: failure instanceof Error ? failure.message : String(failure) }));
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").collect())).toEqual([]);
  for (const messageId of historicalIds) await t.mutation(components.agent.messages.deleteByIds, { messageIds: [messageId] });
  expect(await actor.mutation(api.chatFeedback.submitFeedback, { turnId, vote: 1 })).toBe(1);
  expect(await t.run(ctx => ctx.db.query("chatAnswerFeedback").first())).toMatchObject({ answerMessageId: answer._id, answerText: "Latest small completed answer", vote: 1 });
});
