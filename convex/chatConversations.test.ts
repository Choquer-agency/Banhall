/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportChatAgent } from "./ai/chatAgentV2";
import schema from "./schema";
import { threadTitleFrom } from "./lib/chatThreads";
import { PURGE_BUDGET } from "./lib/chatThreadPurge";

/**
 * Report chat parity, Phase C (2026-10-20), W3: conversation management.
 * Rename, archive and restore, the menu's order by last activity, a send
 * that skips or restores archived conversations, and the admin-only
 * permanent delete. All names and figures are fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const START = new Date("2026-10-20T12:00:00.000Z").getTime();

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", { authId: "conv-writer", role: "writer", firstName: "Avery", lastName: "Quill" });
    const adminId = await ctx.db.insert("users", { authId: "conv-admin", role: "admin", firstName: "Ada", lastName: "Stone" });
    await ctx.db.insert("users", { authId: "conv-manager", role: "manager" });
    const projectId = await ctx.db.insert("projects", {
      title: "Fictional kiln project",
      clientName: "Northwind Fictional Ltd",
      status: "review",
      createdBy: writerId,
      shareToken: "conv-token",
      createdAt: START,
      updatedAt: START,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify({ type: "doc", content: [] }),
      version: 1,
      generatedAt: START,
      updatedAt: START,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other fictional project",
      clientName: "Elsewhere Fictional Inc",
      status: "review",
      createdBy: adminId,
      shareToken: "conv-other",
      createdAt: START,
      updatedAt: START,
    });
    return { writerId, adminId, projectId, reportId, otherProjectId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "conv-writer" }),
    admin: t.withIdentity({ subject: "conv-admin" }),
    manager: t.withIdentity({ subject: "conv-manager" }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

/** A conversation of the report with one finished turn, saved directly. */
async function conversation(s: Setup, title: string, options: { createdAt?: number; lastActivityAt?: number } = {}) {
  return await s.t.run(async (ctx) => {
    const { threadId } = await reportChatAgent.createThread(ctx, { userId: s.writerId });
    await ctx.db.insert("agentChatThreads", {
      projectId: s.projectId,
      reportId: s.reportId,
      agentThreadId: threadId,
      title,
      createdAt: options.createdAt ?? Date.now(),
      createdBy: s.writerId,
      ...(options.lastActivityAt !== undefined ? { lastActivityAt: options.lastActivityAt } : {}),
    });
    const saved = await reportChatAgent.saveMessages(ctx, {
      threadId,
      userId: s.writerId,
      messages: [{ role: "user", content: `${title} question` }],
      skipEmbeddings: true,
    });
    const prompt = saved.messages[0];
    await reportChatAgent.saveMessages(ctx, {
      threadId,
      promptMessageId: prompt._id,
      messages: [{ role: "assistant", content: `${title} answer` }],
      skipEmbeddings: true,
    });
    const turnId = await ctx.db.insert("chatTurns", {
      userId: s.writerId,
      agentThreadId: threadId,
      promptMessageId: prompt._id,
      order: prompt.order,
      status: "completed",
      stepCount: 1,
    });
    return { threadId, turnId, promptMessageId: prompt._id };
  });
}

async function threadRow(s: Setup, threadId: string) {
  return await s.t.run(async (ctx) =>
    await ctx.db.query("agentChatThreads").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).unique()
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("conversation names", () => {
  test("a new conversation is named at a word boundary", () => {
    expect(threadTitleFrom("  Tighten the   uncertainty\nframing  ")).toBe("Tighten the uncertainty framing");
    expect(threadTitleFrom("")).toBe("New chat");
    const long = "Make the work performed section read in the order the trials happened please";
    const title = threadTitleFrom(long);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(long.startsWith(title)).toBe(true);
    expect(long[title.length]).toBe(" ");
    expect(threadTitleFrom("x".repeat(90))).toBe("x".repeat(60));
  });

  test("anyone on the report renames a conversation; the name is one line of 1 to 80 characters", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "First chat");
    await s.writer.mutation(api.chatV2.renameThread, { threadId, title: "  Kiln\ntrials   review " });
    expect((await threadRow(s, threadId))?.title).toBe("Kiln trials review");
    await s.manager.mutation(api.chatV2.renameThread, { threadId, title: "x".repeat(80) });
    expect((await threadRow(s, threadId))?.title).toBe("x".repeat(80));
    for (const title of ["   ", "x".repeat(81)]) {
      await expect(s.writer.mutation(api.chatV2.renameThread, { threadId, title })).rejects.toMatchObject({
        data: { code: "INVALID_INPUT" },
      });
    }
    await expect(s.writer.mutation(api.chatV2.renameThread, { threadId: "missing", title: "x" })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
    await expect(s.t.mutation(api.chatV2.renameThread, { threadId, title: "Anonymous" })).rejects.toThrow();
  });
});

describe("archive, restore and the menu's order", () => {
  test("lists open conversations by last activity, newest first, and archived ones apart", async () => {
    const s = await setup();
    await conversation(s, "Older", { createdAt: START - 3000, lastActivityAt: START + 500 });
    await conversation(s, "Middle", { createdAt: START - 2000 });
    const newer = await conversation(s, "Newer", { createdAt: START - 1000 });
    const list = async () => (await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId })).map((row) => row.title);
    expect(await list()).toEqual(["Older", "Newer", "Middle"]);

    await s.writer.mutation(api.chatV2.archiveThread, { threadId: newer.threadId });
    expect(await list()).toEqual(["Older", "Middle"]);
    const archived = await s.writer.query(api.chatV2.listArchivedThreads, { reportId: s.reportId });
    expect(archived).toMatchObject([{ agentThreadId: newer.threadId, title: "Newer", archivedAt: START, webSearch: true }]);
    expect(await threadRow(s, newer.threadId)).toMatchObject({ archivedAt: START, archivedBy: s.writerId });

    // Archived conversations stay readable.
    const messages = await s.writer.query(api.chatV2.listMessages, {
      threadId: newer.threadId,
      paginationOpts: { cursor: null, numItems: 10 },
      streamArgs: undefined,
    });
    expect(JSON.stringify(messages.page)).toContain("Newer answer");

    // Archiving twice changes nothing; restoring puts it back by its own time.
    vi.setSystemTime(START + 60_000);
    await s.writer.mutation(api.chatV2.archiveThread, { threadId: newer.threadId });
    expect((await threadRow(s, newer.threadId))?.archivedAt).toBe(START);
    await s.manager.mutation(api.chatV2.restoreThread, { threadId: newer.threadId });
    expect(await list()).toEqual(["Older", "Newer", "Middle"]);
    expect(await threadRow(s, newer.threadId)).not.toHaveProperty("archivedAt");
    expect(await threadRow(s, newer.threadId)).not.toHaveProperty("archivedBy");
    expect(await s.writer.query(api.chatV2.listArchivedThreads, { reportId: s.reportId })).toEqual([]);
  });

  test("lists nothing for a viewer without project access", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "Private");
    await s.writer.mutation(api.chatV2.archiveThread, { threadId });
    expect(await s.t.query(api.chatV2.listArchivedThreads, { reportId: s.reportId })).toEqual([]);
    await expect(s.t.mutation(api.chatV2.restoreThread, { threadId })).rejects.toThrow();
  });

  test("a send records activity, moving the conversation to the top", async () => {
    const s = await setup();
    const first = await conversation(s, "First", { createdAt: START - 2000 });
    await conversation(s, "Second", { createdAt: START - 1000 });
    vi.setSystemTime(START + 5000);
    await s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, threadId: first.threadId, content: "One more question" });
    expect((await threadRow(s, first.threadId))?.lastActivityAt).toBe(START + 5000);
    const list = await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId });
    expect(list.map((row) => row.title)).toEqual(["First", "Second"]);
  });

  test("a send without a conversation skips archived ones", async () => {
    const s = await setup();
    const open = await conversation(s, "Open", { createdAt: START - 2000 });
    const archived = await conversation(s, "Archived", { createdAt: START - 1000 });
    await s.writer.mutation(api.chatV2.archiveThread, { threadId: archived.threadId });
    const sent = await s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Continue please" });
    expect(sent.threadId).toBe(open.threadId);

    // With every conversation archived, a send starts a new one.
    await s.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: sent.threadId,
      promptMessageId: sent.messageId,
      requestedStatus: "completed",
      endedAt: Date.now(),
      stepCount: 1,
    });
    await s.writer.mutation(api.chatV2.archiveThread, { threadId: open.threadId });
    const fresh = await s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Start over" });
    expect([open.threadId, archived.threadId]).not.toContain(fresh.threadId);
    expect(await threadRow(s, fresh.threadId)).toMatchObject({ title: "Start over", lastActivityAt: START });
  });

  test("a send in an archived conversation restores it", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "Back again");
    await s.writer.mutation(api.chatV2.archiveThread, { threadId });
    vi.setSystemTime(START + 9000);
    await s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, threadId, content: "Picking this up" });
    const row = await threadRow(s, threadId);
    expect(row).toMatchObject({ lastActivityAt: START + 9000 });
    expect(row).not.toHaveProperty("archivedAt");
    expect((await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId })).map((r) => r.agentThreadId)).toEqual([threadId]);
  });
});

describe("delete permanently", () => {
  /** Every row keyed by a conversation, for one thread. */
  async function keyedRows(s: Setup, threadId: string) {
    return await s.t.run(async (ctx) => {
      const proposals = await ctx.db.query("chatProposals").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).collect();
      const items = [];
      const events = [];
      for (const proposal of proposals) {
        items.push(...(await ctx.db.query("chatProposalItems").withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id)).collect()));
        events.push(...(await ctx.db.query("proposalWordingEditEvents").withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id)).collect()));
      }
      return {
        threads: await ctx.db.query("agentChatThreads").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).collect(),
        turns: await ctx.db.query("chatTurns").withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", threadId)).collect(),
        proposals,
        items,
        events,
        searches: await ctx.db.query("chatWebSearches").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).collect(),
        feedback: await ctx.db.query("chatAnswerFeedback").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).collect(),
      };
    });
  }

  /** Cards, checklist items, edit events, searches, votes and usage for a thread. */
  async function fill(s: Setup, threadId: string, turnId: Id<"chatTurns">, promptMessageId: string, items: number) {
    await s.t.run(async (ctx) => {
      for (let card = 0; card < 3; card += 1) {
        const proposalId = await ctx.db.insert("chatProposals", {
          agentThreadId: threadId,
          projectId: s.projectId,
          reportId: s.reportId,
          kind: "edit",
          state: "pending",
          newText: `Fictional wording ${card}`,
          createdAt: Date.now(),
        });
        for (let i = 0; i < items; i += 1) {
          await ctx.db.insert("chatProposalItems", {
            proposalId,
            projectId: s.projectId,
            itemId: `item-${card}-${i}`,
            status: "resolved",
            reason: "Fictional reason",
            createdAt: Date.now(),
          });
        }
        await ctx.db.insert("proposalWordingEditEvents", {
          projectId: s.projectId,
          reportId: s.reportId,
          proposalId,
          userId: s.writerId,
          originalText: "Fictional before",
          editedText: "Fictional after",
          createdAt: Date.now(),
        });
      }
      await ctx.db.insert("chatWebSearches", {
        projectId: s.projectId,
        reportId: s.reportId,
        agentThreadId: threadId,
        promptMessageId,
        query: "kiln drying standards",
        status: "ok",
        sources: [],
        createdAt: Date.now(),
      });
      await ctx.db.insert("chatAnswerFeedback", {
        turnId,
        userId: s.writerId,
        projectId: s.projectId,
        reportId: s.reportId,
        agentThreadId: threadId,
        promptMessageId,
        answerMessageId: "answer",
        promptText: "Fictional prompt",
        answerText: "Fictional answer",
        vote: 1,
        createdAt: Date.now(),
      });
      await ctx.db.insert("aiUsage", {
        projectId: s.projectId,
        agentThreadId: threadId,
        callSite: "chat",
        model: "fictional-model",
        inputTokens: 10,
        outputTokens: 10,
        costUsd: 0.01,
        createdAt: Date.now(),
      });
    });
  }

  test("only an admin deletes, and every keyed table is emptied while billing rows stay", async () => {
    const s = await setup();
    const doomed = await conversation(s, "Doomed");
    const kept = await conversation(s, "Kept");
    // More checklist items than one run deletes, so the job pages.
    await fill(s, doomed.threadId, doomed.turnId, doomed.promptMessageId, PURGE_BUDGET);
    await fill(s, kept.threadId, kept.turnId, kept.promptMessageId, 2);

    for (const actor of [s.writer, s.manager, s.t]) {
      await expect(actor.mutation(api.chatV2.deleteThread, { threadId: doomed.threadId })).rejects.toThrow();
    }
    expect((await keyedRows(s, doomed.threadId)).threads).toHaveLength(1);

    await s.admin.mutation(api.chatV2.deleteThread, { threadId: doomed.threadId });
    // The row is gone at once: the menu no longer lists it, and a send refuses it.
    expect((await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId })).map((row) => row.title)).toEqual(["Kept"]);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, threadId: doomed.threadId, content: "Hello?" })
    ).rejects.toThrow("Thread not found");

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await keyedRows(s, doomed.threadId);
    for (const [table, rows] of Object.entries(after)) expect(rows, table).toEqual([]);
    const component = await s.t.query(components.agent.messages.listMessagesByThreadId, {
      threadId: doomed.threadId,
      order: "asc",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(component.page).toEqual([]);
    const usage = await s.t.run(async (ctx) => await ctx.db.query("aiUsage").collect());
    expect(usage.map((row) => row.agentThreadId).sort()).toEqual([doomed.threadId, kept.threadId].sort());

    // The other conversation is untouched.
    const other = await keyedRows(s, kept.threadId);
    expect(other).toMatchObject({ threads: [expect.anything()], turns: [expect.anything()], searches: [expect.anything()], feedback: [expect.anything()] });
    expect(other.proposals).toHaveLength(3);
    expect(other.items).toHaveLength(6);
    expect(other.events).toHaveLength(3);
  });

  test("refuses while a reply runs, and for a conversation that is gone", async () => {
    const s = await setup();
    const busy = await conversation(s, "Busy");
    await s.t.run(async (ctx) => await ctx.db.patch(busy.turnId, { status: "running" }));
    await expect(s.admin.mutation(api.chatV2.deleteThread, { threadId: busy.threadId })).rejects.toMatchObject({
      data: { code: "CHAT_TURN_ACTIVE" },
    });
    expect((await threadRow(s, busy.threadId))?.title).toBe("Busy");
    await expect(s.admin.mutation(api.chatV2.deleteThread, { threadId: "missing" })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });
  });
});
