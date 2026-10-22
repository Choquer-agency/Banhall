/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { makeFunctionReference, type FunctionReference } from "convex/server";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { reportChatAgent } from "./ai/chatAgentV2";
import schema from "./schema";
import { noteThreadSend, threadTitleFrom } from "./lib/chatThreads";
import { PURGE_MAX_BYTES_READ, PURGE_PAGE_ROWS, PURGE_STALL_MS } from "./lib/chatThreadPurge";
import { THREAD_DELETE_ACTION_CEILING_MS, THREAD_DELETE_SETTLE_MS } from "./chatV2";

/**
 * Report chat parity, Phase C (2026-10-20), W3: conversation management.
 * Rename, archive and restore, the menu's order by last activity, a send
 * that skips or restores archived conversations, and the admin-only
 * permanent delete. All names and figures are fictional.
 */

const modules = import.meta.glob("./**/*.ts");
const START = new Date("2026-10-20T12:00:00.000Z").getTime();

async function setup(options: { transactionLimits?: boolean } = {}) {
  const t = convexTest({ schema, modules, transactionLimits: options.transactionLimits ?? false });
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

async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) return String((data as { code: unknown }).code);
    return `untyped: ${String(error)}`;
  }
  return "no error";
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

  test("a send without a conversation continues the one with the latest activity (review R2 P3-9)", async () => {
    const s = await setup();
    const older = await conversation(s, "Older but active", { createdAt: START - 2000, lastActivityAt: START - 10 });
    await conversation(s, "Newer but quiet", { createdAt: START - 1000 });
    const sent = await s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, content: "Carry on" });
    expect(sent.threadId).toBe(older.threadId);
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
      const undoRecords = [];
      for (const proposal of proposals) {
        items.push(...(await ctx.db.query("chatProposalItems").withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id)).collect()));
        events.push(...(await ctx.db.query("proposalWordingEditEvents").withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id)).collect()));
        undoRecords.push(...(await ctx.db.query("chatProposalAppliedChanges").withIndex("by_proposalId", (q) => q.eq("proposalId", proposal._id)).collect()));
      }
      return {
        threads: await ctx.db.query("agentChatThreads").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).collect(),
        turns: await ctx.db.query("chatTurns").withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", threadId)).collect(),
        proposals,
        items,
        events,
        undoRecords,
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
          state: card === 0 ? "applied" : "pending",
          newText: `Fictional wording ${card}`,
          createdAt: Date.now(),
        });
        // The first card was applied and keeps its Undo record.
        if (card === 0) {
          const appliedChangeId = await ctx.db.insert("chatProposalAppliedChanges", {
            proposalId,
            projectId: s.projectId,
            revisionNumber: 1,
            appliedAt: Date.now(),
            appliedBy: s.writerId,
            hunks: [{ before: "Fictional before", after: "Fictional after" }],
          });
          await ctx.db.patch(proposalId, { appliedChangeId });
        }
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
    await fill(s, doomed.threadId, doomed.turnId, doomed.promptMessageId, PURGE_PAGE_ROWS);
    await fill(s, kept.threadId, kept.turnId, kept.promptMessageId, 2);

    // Fable review F2 P3-5: each refusal is the one it should be.
    for (const [actor, code] of [[s.writer, "NOT_AUTHORIZED"], [s.manager, "NOT_AUTHORIZED"], [s.t, "NOT_AUTHENTICATED"]] as const) {
      expect(await errorCode(() => actor.mutation(api.chatV2.deleteThread, { threadId: doomed.threadId }))).toBe(code);
    }
    expect((await keyedRows(s, doomed.threadId)).threads).toHaveLength(1);

    await s.writer.mutation(api.chatV2.archiveThread, { threadId: kept.threadId });
    await s.writer.mutation(api.chatV2.restoreThread, { threadId: kept.threadId });
    const doomedRecords = (await keyedRows(s, doomed.threadId)).undoRecords.map((row) => row._id);
    expect(doomedRecords).toHaveLength(1);
    await s.admin.mutation(api.chatV2.deleteThread, { threadId: doomed.threadId });
    // The row is marked at once and stays until the purge ends; every read
    // and send treats the conversation as gone.
    expect(await threadRow(s, doomed.threadId)).toMatchObject({ deletingAt: START, deletingBy: s.adminId });
    expect((await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId })).map((row) => row.title)).toEqual(["Kept"]);
    expect(await s.writer.query(api.chatV2.listArchivedThreads, { reportId: s.reportId })).toEqual([]);
    const page = { cursor: null, numItems: 10 };
    expect((await s.writer.query(api.chatV2.listMessages, { threadId: doomed.threadId, paginationOpts: page, streamArgs: undefined })).page).toEqual([]);
    expect(await s.writer.query(api.chatV2.listTurns, { threadId: doomed.threadId })).toEqual([]);
    expect(await s.writer.query(api.chatV2.listProposals, { threadId: doomed.threadId })).toEqual([]);
    await expect(
      s.writer.mutation(api.chatV2.sendMessage, { reportId: s.reportId, threadId: doomed.threadId, content: "Hello?" })
    ).rejects.toThrow("Thread not found");
    await expect(s.writer.mutation(api.chatV2.sendAlternative, {
      threadId: doomed.threadId, ofPromptMessageId: doomed.promptMessageId, kind: "regenerate",
    })).rejects.toThrow();
    for (const call of [
      () => s.writer.mutation(api.chatV2.renameThread, { threadId: doomed.threadId, title: "Back" }),
      () => s.writer.mutation(api.chatV2.archiveThread, { threadId: doomed.threadId }),
      () => s.admin.mutation(api.chatV2.deleteThread, { threadId: doomed.threadId }),
    ]) {
      await expect(call()).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    }
    await expect(s.writer.mutation(api.chatFeedback.submitFeedback, { turnId: doomed.turnId, vote: 1 })).rejects.toMatchObject({
      data: { code: "NOT_FOUND" },
    });

    await s.t.finishAllScheduledFunctions(vi.runAllTimers);

    const after = await keyedRows(s, doomed.threadId);
    for (const [table, rows] of Object.entries(after)) expect(rows, table).toEqual([]);
    // The Undo records went with their cards, none left behind.
    expect(await s.t.run(async (ctx) => await Promise.all(doomedRecords.map((id) => ctx.db.get(id))))).toEqual([null]);
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
    expect(other.undoRecords).toHaveLength(1);
  });

  test("pages a conversation with large applied cards within the transaction limits", async () => {
    const s = await setup({ transactionLimits: true });
    const big = await conversation(s, "Big cards");
    // Applied cards keep Undo records of up to 600 KB each, in their own
    // rows: 40 of them are about 24 MB, well past one transaction's read limit.
    const hunk = { before: "b".repeat(300_000), after: "a".repeat(300_000) };
    const bigRecords: Array<Id<"chatProposalAppliedChanges">> = [];
    for (let card = 0; card < 40; card += 1) {
      bigRecords.push(await s.t.run(async (ctx) => {
        const proposalId = await ctx.db.insert("chatProposals", {
          agentThreadId: big.threadId, projectId: s.projectId, reportId: s.reportId,
          kind: "edit", state: "applied", newText: `Fictional wording ${card}`, createdAt: Date.now(),
        });
        const appliedChangeId = await ctx.db.insert("chatProposalAppliedChanges", {
          proposalId, projectId: s.projectId, revisionNumber: card, appliedAt: Date.now(), appliedBy: s.writerId, hunks: [hunk],
        });
        await ctx.db.patch(proposalId, { appliedChangeId });
        await ctx.db.insert("proposalWordingEditEvents", {
          projectId: s.projectId, reportId: s.reportId, proposalId, userId: s.writerId,
          originalText: "x".repeat(200_000), editedText: "y".repeat(200_000), createdAt: Date.now(),
        });
        return appliedChangeId;
      }));
    }
    // Votes with full stored texts.
    await s.t.run(async (ctx) => {
      for (let i = 0; i < 150; i += 1) {
        await ctx.db.insert("chatAnswerFeedback", {
          turnId: big.turnId, userId: s.writerId, projectId: s.projectId, reportId: s.reportId,
          agentThreadId: big.threadId, promptMessageId: big.promptMessageId, answerMessageId: `answer-${i}`,
          promptText: "p".repeat(4000), answerText: "q".repeat(4000), vote: 1, createdAt: Date.now(),
        });
      }
    });
    await s.admin.mutation(api.chatV2.deleteThread, { threadId: big.threadId });
    // Each run stays inside its byte budget; the next continues.
    let runs = 0;
    for (;;) {
      const scheduled = await s.t.run(async (ctx) =>
        (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
          job.name.includes("purgeThread") && job.state.kind === "pending"));
      if (scheduled.length === 0) break;
      const job = scheduled[0];
      await s.t.mutation(internal.chatV2.purgeThread, job.args[0] as { agentThreadId: string });
      await s.t.run(async (ctx) => await ctx.scheduler.cancel(job._id));
      runs += 1;
      expect(runs).toBeLessThan(400);
    }
    expect(runs).toBeGreaterThan(Math.ceil((40 * 600_000) / PURGE_MAX_BYTES_READ));
    const left = await keyedRows(s, big.threadId);
    for (const [table, rows] of Object.entries(left)) expect(rows, table).toEqual([]);
    for (const id of bigRecords) expect(await s.t.run(async (ctx) => await ctx.db.get(id))).toBeNull();
  });

  test("a purge run that failed is resumed while the row stands", async () => {
    const s = await setup();
    const stuck = await conversation(s, "Stuck");
    await fill(s, stuck.threadId, stuck.turnId, stuck.promptMessageId, 2);
    await s.admin.mutation(api.chatV2.deleteThread, { threadId: stuck.threadId });
    // The scheduled run never happens (as if it hit a limit and failed).
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) await ctx.scheduler.cancel(job._id);
    });
    expect(await s.t.mutation(internal.chatV2.resumeStalledThreadPurges, {})).toBe(0);
    vi.setSystemTime(START + PURGE_STALL_MS + 1);
    expect(await s.t.mutation(internal.chatV2.resumeStalledThreadPurges, {})).toBe(1);
    // Resumed once: the sweep does not start a second chain while it runs.
    expect(await s.t.mutation(internal.chatV2.resumeStalledThreadPurges, {})).toBe(0);
    await s.t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await keyedRows(s, stuck.threadId);
    for (const [table, rows] of Object.entries(after)) expect(rows, table).toEqual([]);
  });

  test("waits for a stopped turn's action to really end, then THREAD_DELETE_SETTLE_MS (round 2 N5)", async () => {
    const s = await setup();
    const stopped = await conversation(s, "Just stopped");
    // Stop pressed 30 s ago; the action is still inside a long tool call.
    await s.t.run(async (ctx) => await ctx.db.patch(stopped.turnId, { status: "aborted", endedAt: START - 30_000 }));
    const refused = { data: { code: "CHAT_TURN_ACTIVE", message: "A reply just finished in this conversation. Try again in a few seconds." } };
    await expect(s.admin.mutation(api.chatV2.deleteThread, { threadId: stopped.threadId })).rejects.toMatchObject(refused);
    // The action reaches finishTurn: its real end is recorded, Stop or not.
    vi.setSystemTime(START + 5_000);
    expect(await s.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: stopped.threadId, promptMessageId: stopped.promptMessageId,
      requestedStatus: "failed", endedAt: START + 5_000, stepCount: 2,
    })).toEqual({ status: "aborted" });
    expect(await s.t.run((ctx) => ctx.db.get(stopped.turnId))).toMatchObject({ status: "aborted", endedAt: START - 30_000, actionEndedAt: START + 5_000 });
    vi.setSystemTime(START + 5_000 + THREAD_DELETE_SETTLE_MS - 1);
    await expect(s.admin.mutation(api.chatV2.deleteThread, { threadId: stopped.threadId })).rejects.toMatchObject(refused);
    vi.setSystemTime(START + 5_000 + THREAD_DELETE_SETTLE_MS);
    await s.admin.mutation(api.chatV2.deleteThread, { threadId: stopped.threadId });
    expect(await threadRow(s, stopped.threadId)).toHaveProperty("deletingAt");
  });

  test("an action that never reports its end is waited for up to THREAD_DELETE_ACTION_CEILING_MS", async () => {
    const s = await setup();
    const died = await conversation(s, "Died mid-call");
    await s.t.run(async (ctx) => await ctx.db.patch(died.turnId, { status: "aborted", endedAt: START }));
    vi.setSystemTime(START + THREAD_DELETE_ACTION_CEILING_MS - 1);
    await expect(s.admin.mutation(api.chatV2.deleteThread, { threadId: died.threadId })).rejects.toMatchObject({ data: { code: "CHAT_TURN_ACTIVE" } });
    vi.setSystemTime(START + THREAD_DELETE_ACTION_CEILING_MS);
    await s.admin.mutation(api.chatV2.deleteThread, { threadId: died.threadId });
    expect(await threadRow(s, died.threadId)).toHaveProperty("deletingAt");
  });

  test("a completed turn's finishTurn records its real end too", async () => {
    const s = await setup();
    const done = await conversation(s, "Done");
    await s.t.run(async (ctx) => await ctx.db.patch(done.turnId, { status: "running", endedAt: undefined }));
    await s.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: done.threadId, promptMessageId: done.promptMessageId,
      requestedStatus: "completed", endedAt: START, stepCount: 1,
    });
    expect(await s.t.run((ctx) => ctx.db.get(done.turnId))).toMatchObject({ status: "completed", endedAt: START, actionEndedAt: START });
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

describe("a conversation being deleted (round 2 N2 to N4)", () => {
  async function markDeleting(s: Setup, threadId: string) {
    await s.t.run(async (ctx) => {
      const row = await ctx.db.query("agentChatThreads").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId)).unique();
      if (!row) throw new Error("missing thread");
      await ctx.db.patch(row._id, { deletingAt: START, deletingBy: s.adminId });
    });
  }

  test("threadStatus says open, archived, deleting or missing, by id", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "Status");
    const status = () => s.writer.query(api.chatV2.threadStatus, { threadId });
    expect(await status()).toBe("open");
    await s.writer.mutation(api.chatV2.archiveThread, { threadId });
    expect(await status()).toBe("archived");
    await markDeleting(s, threadId);
    expect(await status()).toBe("deleting");
    expect(await s.writer.query(api.chatV2.threadStatus, { threadId: "nowhere" })).toBe("missing");
    // Out of the viewer's reach reads as missing, never as its real state.
    expect(await s.t.query(api.chatV2.threadStatus, { threadId })).toBe("missing");
  });

  test("a conversation beyond the menu's 50 rows is still open", async () => {
    const s = await setup();
    const oldest = await conversation(s, "Oldest", { createdAt: START - 100_000 });
    for (let i = 0; i < 50; i += 1) await conversation(s, `Newer ${i}`, { createdAt: START - 50_000 + i });
    const listed = await s.writer.query(api.chatV2.listThreads, { reportId: s.reportId });
    expect(listed).toHaveLength(50);
    expect(listed.map((row) => row.agentThreadId)).not.toContain(oldest.threadId);
    expect(await s.writer.query(api.chatV2.threadStatus, { threadId: oldest.threadId })).toBe("open");
  });

  test("card actions refuse and the checklist reads empty; research cards are unaffected (N3)", async () => {
    const s = await setup();
    const doomed = await conversation(s, "Doomed cards");
    const ids = await s.t.run(async (ctx) => {
      const card = async (agentThreadId: string, state: "pending" | "applied") => {
        const proposalId = await ctx.db.insert("chatProposals", {
          agentThreadId, projectId: s.projectId, reportId: s.reportId, kind: "edit", state,
          targetText: "Old wording", newText: "New wording", createdAt: Date.now(),
        });
        if (state === "applied") {
          const appliedChangeId = await ctx.db.insert("chatProposalAppliedChanges", {
            proposalId, projectId: s.projectId, revisionNumber: 1, appliedAt: Date.now(), appliedBy: s.writerId,
            hunks: [{ before: "Old wording", after: "New wording" }],
          });
          await ctx.db.patch(proposalId, { appliedChangeId });
        }
        return proposalId;
      };
      const pending = await card(doomed.threadId, "pending");
      const applied = await card(doomed.threadId, "applied");
      const research = await card("research:session-1", "pending");
      await ctx.db.insert("chatProposalItems", { proposalId: pending, projectId: s.projectId, itemId: "i-1", status: "resolved", reason: "Fictional", createdAt: Date.now() });
      await ctx.db.insert("chatProposalItems", { proposalId: research, projectId: s.projectId, itemId: "i-2", status: "resolved", reason: "Fictional", createdAt: Date.now() });
      return { pending, applied, research };
    });
    expect(await s.writer.query(api.chatV2.listProposalItems, { proposalId: ids.pending })).toHaveLength(1);
    await markDeleting(s, doomed.threadId);
    const gone = { data: { code: "NOT_FOUND", message: "This conversation no longer exists" } };
    await expect(s.admin.mutation(api.chatV2.applyProposal, { proposalId: ids.pending })).rejects.toMatchObject(gone);
    await expect(s.admin.mutation(api.chatV2.markProposalApplied, { proposalId: ids.pending, content: "{}", expectedRevisionNumber: 0 })).rejects.toMatchObject(gone);
    await expect(s.admin.mutation(api.chatV2.updateProposalWording, { proposalId: ids.pending, newText: "Other wording" })).rejects.toMatchObject(gone);
    await expect(s.admin.mutation(api.chatV2.rejectProposal, { proposalId: ids.pending })).rejects.toMatchObject(gone);
    await expect(s.admin.mutation(api.chatV2.undoProposal, { proposalId: ids.applied })).rejects.toMatchObject(gone);
    expect(await s.writer.query(api.chatV2.listProposalItems, { proposalId: ids.pending })).toEqual([]);
    expect(await s.t.run((ctx) => ctx.db.get(ids.pending))).toMatchObject({ state: "pending", newText: "New wording" });
    // A research card is no chat conversation's: it still acts.
    expect(await s.writer.query(api.chatV2.listProposalItems, { proposalId: ids.research })).toHaveLength(1);
    await s.admin.mutation(api.chatV2.rejectProposal, { proposalId: ids.research });
    expect(await s.t.run((ctx) => ctx.db.get(ids.research))).toMatchObject({ state: "rejected" });
  });

  test("report chat activity skips a conversation being deleted (N3)", async () => {
    const s = await setup();
    const busy = await conversation(s, "Busy");
    await s.t.run(async (ctx) => await ctx.db.patch(busy.turnId, { status: "running" }));
    expect(await s.writer.query(api.chatV2.reportChatActivity, { reportId: s.reportId })).toMatchObject({ active: true, mineActive: true });
    await markDeleting(s, busy.threadId);
    expect(await s.writer.query(api.chatV2.reportChatActivity, { reportId: s.reportId })).toMatchObject({ active: false, mineActive: false });
  });

  test("the chat's file tools treat it as gone (chatDocuments guard, N4)", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "Files");
    const documentId = await s.t.run((ctx) => ctx.db.insert("projectDocuments", {
      projectId: s.projectId, fileName: "kiln-log.txt", fileType: "txt", content: "Kiln held 78 C for six hours.",
      source: "upload", uploadedBy: "conv-writer", createdAt: START,
    }));
    // Typed by hand, as in chatDocuments.test.ts: api.d.ts lists the module after codegen.
    const readDocument = makeFunctionReference("chatDocuments:readDocumentForChat") as unknown as FunctionReference<
      "query", "internal", { agentThreadId: string; documentId: Id<"projectDocuments">; start: number; maxChars: number }, { status: string }
    >;
    const read = () => s.t.query(readDocument, { agentThreadId: threadId, documentId, start: 0, maxChars: 100 });
    expect(await read()).toMatchObject({ status: "ok" });
    await markDeleting(s, threadId);
    expect(await read()).toEqual({ status: "unavailable" });
  });

  test("getViewerVotes reads nothing (chatFeedback guard, N4)", async () => {
    const s = await setup();
    const { threadId, turnId, promptMessageId } = await conversation(s, "Votes");
    await s.t.run((ctx) => ctx.db.insert("chatAnswerFeedback", {
      turnId, userId: s.writerId, projectId: s.projectId, reportId: s.reportId, agentThreadId: threadId,
      promptMessageId, answerMessageId: "answer", promptText: "p", answerText: "a", vote: 1, createdAt: START,
    }));
    const votes = () => s.writer.query(api.chatFeedback.getViewerVotes, { reportId: s.reportId, threadId, turnIds: [turnId] });
    expect(await votes()).toEqual([{ turnId, vote: 1 }]);
    await markDeleting(s, threadId);
    expect(await votes()).toEqual([]);
  });

  test("noteThreadSend neither restores nor touches it (chatThreads guard, N4)", async () => {
    const s = await setup();
    const { threadId } = await conversation(s, "Archived then deleting", { lastActivityAt: START - 1 });
    await s.writer.mutation(api.chatV2.archiveThread, { threadId });
    await markDeleting(s, threadId);
    vi.setSystemTime(START + 60_000);
    await s.t.run(async (ctx) => await noteThreadSend(ctx, threadId));
    expect(await threadRow(s, threadId)).toMatchObject({ archivedAt: START, lastActivityAt: START - 1, deletingAt: START });
  });
});
