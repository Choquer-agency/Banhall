/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { saveMessage } from "@convex-dev/agent";
import { api, components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { MAX_CHAT_MESSAGE_CHARS } from "../shared/chatLimits";
import { excerptBlock } from "./lib/chatPath";

/**
 * Report chat parity, Phase C (2026-10-20), W2: Edit and Regenerate make an
 * alternative inside one conversation, and the conversation shows, and the
 * model, cards, jobs and chains read, only the active path. Fictional data
 * only.
 */

const modules = import.meta.glob("./**/*.ts");
const AUTH = "auth-alternatives";
const OTHER_AUTH = "auth-alternatives-other";

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH, role: "writer", firstName: "Avery", lastName: "Lane" });
    const otherId = await ctx.db.insert("users", { authId: OTHER_AUTH, role: "writer", firstName: "Jordan", lastName: "Reyes" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alternatives project", clientName: "Client", status: "review",
      createdBy: userId, ownerId: userId, shareToken: "alternatives-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: JSON.stringify({ type: "doc", content: [] }),
      version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId, fileName: "notes.txt", fileType: "txt", content: "Fictional notes.", source: "upload",
      uploadedBy: "writer", uploaderRole: "writer", category: "other", createdAt: now,
    });
    return { userId, otherId, projectId, reportId, documentId };
  });
  const actor = t.withIdentity({ subject: AUTH });
  const other = t.withIdentity({ subject: OTHER_AUTH });
  const first = await actor.mutation(api.chatV2.sendMessage, {
    reportId: ids.reportId, content: "Summarize Line 242.", newThread: true,
  });
  const threadId = first.threadId;
  const turns = () => t.run((ctx) => ctx.db
    .query("chatTurns")
    .withIndex("by_agentThreadId_and_order", (q) => q.eq("agentThreadId", threadId))
    .collect());
  const turnOf = async (promptMessageId: string) => (await turns()).find((row) => row.promptMessageId === promptMessageId)!;
  const thread = () => t.run((ctx) => ctx.db
    .query("agentChatThreads")
    .withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", threadId))
    .unique());
  /** End a turn the way the chat action does, with a saved reply. */
  const reply = async (promptMessageId: string, text: string, status: Doc<"chatTurns">["status"] = "completed") => {
    const turn = await turnOf(promptMessageId);
    await t.run(async (ctx) => {
      await ctx.db.patch(turn._id, { status, startedAt: Date.now() - 1_000, endedAt: Date.now() });
    });
    await t.run((ctx) => saveMessage(ctx, components.agent, {
      threadId, promptMessageId, agentName: "report-editor", message: { role: "assistant", content: text },
    }));
  };
  const send = async (content: string, who = actor) =>
    (await who.mutation(api.chatV2.sendMessage, { reportId: ids.reportId, content, threadId })).messageId;
  const messages = async (who = actor) =>
    (await who.query(api.chatV2.listMessages, {
      threadId, paginationOpts: { cursor: null, numItems: 50 }, streamArgs: undefined,
    })).page.sort((a, b) => a.order - b.order || a.stepOrder - b.stepOrder);
  const listTurns = (who = actor) => who.query(api.chatV2.listTurns, { threadId });
  const scheduled = () => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  const storedPrompt = async (messageId: string) => {
    const [doc] = await t.query(components.agent.messages.getMessagesByIds, { messageIds: [messageId] });
    return doc?.message?.content;
  };
  return { t, actor, other, ...ids, threadId, firstPrompt: first.messageId, turns, turnOf, thread, reply, send, messages, listTurns, scheduled, storedPrompt };
}

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

describe("sendMessage and the tip", () => {
  test("a send records its parent and its own text length; no tip until an alternative exists", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "Line 242 summary.");
    const second = await f.send("Now Line 244.");
    expect(await f.turnOf(f.firstPrompt)).toMatchObject({ writerTextLength: "Summarize Line 242.".length });
    expect((await f.turnOf(f.firstPrompt)).parentPromptMessageId).toBeUndefined();
    expect(await f.turnOf(second)).toMatchObject({ parentPromptMessageId: f.firstPrompt });
    expect((await f.thread())?.activeTipPromptMessageId).toBeUndefined();
    expect(await f.t.query(internal.chatV2.getChatHistoryPath, { agentThreadId: f.threadId })).toBeNull();
  });
});

describe("sendAlternative", () => {
  test("Regenerate rebuilds the prompt on the server, copies pins and becomes the tip", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const card = await f.t.run((ctx) => ctx.db.insert("chatProposals", {
      agentThreadId: f.threadId, promptMessageId: f.firstPrompt, projectId: f.projectId, reportId: f.reportId,
      kind: "edit", targetText: "Old sentence.", newText: "New sentence.", state: "pending", createdAt: Date.now(),
    }));
    const second = (await f.actor.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: f.threadId, content: "Make it shorter.",
      highlight: { text: "A highlighted passage.", from: 3, to: 25 }, refineProposalId: card,
    })).messageId;
    await f.t.run(async (ctx) => {
      const turn = (await ctx.db.query("chatTurns").collect()).find((row) => row.promptMessageId === second)!;
      await ctx.db.patch(turn._id, { pinnedDocumentIds: [f.documentId] });
    });
    await f.reply(second, "Sibling reply that must disappear.");
    const original = await f.storedPrompt(second);

    const result = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: second, kind: "regenerate",
    });
    expect(result.threadId).toBe(f.threadId);
    expect(result.messageId).not.toBe(second);
    // The same blocks the send built, from the server's own records.
    expect(await f.storedPrompt(result.messageId)).toBe(original);
    const turn = await f.turnOf(result.messageId);
    expect(turn).toMatchObject({
      status: "queued", parentPromptMessageId: f.firstPrompt, alternativeOf: second, alternativeKind: "regenerate",
      refineProposalId: card, writerTextLength: "Make it shorter.".length,
      highlight: { text: "A highlighted passage.", from: 3, to: 25 }, pinnedDocumentIds: [f.documentId],
    });
    expect((await f.thread())?.activeTipPromptMessageId).toBe(result.messageId);
    const job = (await f.scheduled()).filter((row) => row.name.includes("streamChatReply")).at(-1)!;
    expect(job.args[0]).toMatchObject({
      agentThreadId: f.threadId, promptMessageId: result.messageId, reportId: f.reportId,
      userId: f.userId, allowWeb: true, pinnedDocumentIds: [f.documentId],
    });
    expect(job.args[0]).not.toHaveProperty("allowBrain");
  });

  test("Edit sends the new text with the source's highlight, and drops a refinement whose card was decided", async () => {
    const f = await setup();
    const card = await f.t.run((ctx) => ctx.db.insert("chatProposals", {
      agentThreadId: f.threadId, promptMessageId: f.firstPrompt, projectId: f.projectId, reportId: f.reportId,
      kind: "edit", targetText: "Old sentence.", newText: "New sentence.", state: "pending", createdAt: Date.now(),
    }));
    await f.reply(f.firstPrompt, "First reply.");
    const second = (await f.actor.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: f.threadId, content: "Refine it.",
      highlight: { text: "Passage.", from: 1, to: 9 }, refineProposalId: card,
    })).messageId;
    await f.reply(second, "Refined.");
    await f.t.run((ctx) => ctx.db.patch(card, { state: "rejected" }));

    const edited = await f.other.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: second, kind: "edit", content: "Refine it, but keep the numbers.",
    });
    expect(await f.storedPrompt(edited.messageId)).toBe(`Refine it, but keep the numbers.${excerptBlock("Passage.")}`);
    const turn = await f.turnOf(edited.messageId);
    expect(turn.refineProposalId).toBeUndefined();
    expect(turn).toMatchObject({ alternativeKind: "edit", userId: f.otherId, alternativeOf: second });
  });

  test("an older turn without a stored length is cut at its first server block", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      const turn = (await ctx.db.query("chatTurns").collect())[0]!;
      await ctx.db.patch(turn._id, { writerTextLength: undefined });
    });
    await f.reply(f.firstPrompt, "First reply.");
    const regenerated = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    });
    expect(await f.storedPrompt(regenerated.messageId)).toBe("Summarize Line 242.");
    // The first message's alternative is a root: no parent of its own.
    expect((await f.turnOf(regenerated.messageId)).parentPromptMessageId).toBeUndefined();
  });

  test("refuses while a reply runs, for a turn off the path, and for over-long or missing edit text", async () => {
    const f = await setup();
    // The first turn is still queued.
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    })).rejects.toThrow(/CHAT_TURN_ACTIVE|still being written/);
    await f.reply(f.firstPrompt, "First reply.");
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "edit", content: "x".repeat(MAX_CHAT_MESSAGE_CHARS + 1),
    })).rejects.toThrow(/CHAT_MESSAGE_TOO_LONG|limited to/);
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "edit",
    })).rejects.toThrow(/INVALID_INPUT|needs the new message/);
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate", content: "Sneaky text",
    })).rejects.toThrow(/INVALID_INPUT|as it was/);
    const regenerated = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    });
    await f.reply(regenerated.messageId, "Second try.");
    // The first turn is now on the other path.
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    })).rejects.toThrow(/NOT_FOUND|no longer in this conversation/);
    expect((await f.turns()).length).toBe(2);
  });

  test("an automatic Continue link can be regenerated but not edited", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const link = await f.send("Continue with Line 244.");
    await f.t.run(async (ctx) => {
      const turn = (await ctx.db.query("chatTurns").collect()).find((row) => row.promptMessageId === link)!;
      await ctx.db.patch(turn._id, { origin: "auto_continue" });
    });
    await f.reply(link, "Line 244 done.");
    await expect(f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: link, kind: "edit", content: "Something else.",
    })).rejects.toThrow(/cannot be edited/);
    const again = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: link, kind: "regenerate",
    });
    expect(await f.storedPrompt(again.messageId)).toBe("Continue with Line 244.");
    // Review P3-1: it is still a link: shown as one, not editable, and in its chain.
    expect(await f.turnOf(again.messageId)).toMatchObject({
      origin: "auto_continue", alternativeKind: "regenerate", alternativeOf: link,
    });
    expect((await f.listTurns()).at(-1)).toMatchObject({ promptMessageId: again.messageId, origin: "auto_continue" });
  });

  test("an older turn's refinement block is rebuilt from the card it names, while that card is pending", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const card = await f.t.run((ctx) => ctx.db.insert("chatProposals", {
      agentThreadId: f.threadId, promptMessageId: f.firstPrompt, projectId: f.projectId, reportId: f.reportId,
      kind: "edit", targetText: "Old sentence.", newText: "New sentence.", state: "pending", createdAt: Date.now(),
    }));
    const refining = (await f.actor.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: f.threadId, content: "Make it plainer.", refineProposalId: card,
    })).messageId;
    const original = await f.storedPrompt(refining);
    // As saved before `refineProposalId` and `writerTextLength` were recorded.
    await f.t.run(async (ctx) => {
      const turn = (await ctx.db.query("chatTurns").collect()).find((row) => row.promptMessageId === refining)!;
      await ctx.db.patch(turn._id, { refineProposalId: undefined, writerTextLength: undefined });
    });
    await f.reply(refining, "Plainer.");
    const again = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: refining, kind: "regenerate",
    });
    expect(await f.storedPrompt(again.messageId)).toBe(original);
    expect(await f.turnOf(again.messageId)).toMatchObject({ refineProposalId: card });

    // Once the card is decided, the block is dropped.
    await f.reply(again.messageId, "Plainer again.");
    await f.t.run((ctx) => ctx.db.patch(card, { state: "applied" }));
    const third = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: again.messageId, kind: "regenerate",
    });
    expect(await f.storedPrompt(third.messageId)).toBe("Make it plainer.");
  });
});

describe("the active path", () => {
  test("messages, turns and cards show only the active path; the switcher moves it for everyone", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const second = await f.send("Second question.");
    await f.reply(second, "Old answer.");
    const oldCard = await f.t.run((ctx) => ctx.db.insert("chatProposals", {
      agentThreadId: f.threadId, promptMessageId: second, projectId: f.projectId, reportId: f.reportId,
      kind: "edit", targetText: "A.", newText: "B.", state: "pending", createdAt: Date.now(),
    }));
    const regenerated = await f.other.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: second, kind: "regenerate",
    });
    await f.reply(regenerated.messageId, "New answer.");

    const texts = (await f.messages()).map((message) => message.text);
    expect(texts).toEqual(["Summarize Line 242.", "First reply.", "Second question.", "New answer."]);
    expect(await f.actor.query(api.chatV2.listProposals, { threadId: f.threadId })).toEqual([]);

    const listed = await f.listTurns();
    expect(listed.map((turn) => turn.promptMessageId)).toEqual([f.firstPrompt, regenerated.messageId]);
    expect(listed[1]).toMatchObject({
      alternatives: { index: 2, count: 2, previousPromptMessageId: second },
      alternativeKind: "regenerate",
      alternativeAuthorName: "Jordan Reyes",
      fromCurrentUser: false,
    });
    expect(listed[0]).not.toHaveProperty("alternatives");

    // Back to the first answer: its card returns, pending as it was.
    const switched = await f.actor.mutation(api.chatV2.setActiveAlternative, {
      threadId: f.threadId, promptMessageId: second,
    });
    expect(switched.tipPromptMessageId).toBe(second);
    expect((await f.messages(f.other)).map((message) => message.text)).toEqual([
      "Summarize Line 242.", "First reply.", "Second question.", "Old answer.",
    ]);
    const cards = await f.actor.query(api.chatV2.listProposals, { threadId: f.threadId });
    expect(cards.map((card) => [card._id, card.state])).toEqual([[oldCard, "pending"]]);
    expect((await f.listTurns()).at(-1)).toMatchObject({
      promptMessageId: second, alternatives: { index: 1, count: 2, nextPromptMessageId: regenerated.messageId },
    });
  });

  test("a send follows the tip, and the switcher lands on the newest turn under an alternative", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const second = await f.send("Second.");
    await f.reply(second, "Second reply.");
    const third = await f.send("Third.");
    await f.reply(third, "Third reply.");
    const edited = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: second, kind: "edit", content: "Second, edited.",
    });
    await f.reply(edited.messageId, "Edited reply.");
    const after = await f.send("After the edit.");
    expect(await f.turnOf(after)).toMatchObject({ parentPromptMessageId: edited.messageId });
    expect((await f.thread())?.activeTipPromptMessageId).toBe(after);
    await f.reply(after, "After reply.");

    await f.actor.mutation(api.chatV2.setActiveAlternative, { threadId: f.threadId, promptMessageId: second });
    expect((await f.thread())?.activeTipPromptMessageId).toBe(third);
    await f.actor.mutation(api.chatV2.setActiveAlternative, { threadId: f.threadId, promptMessageId: edited.messageId });
    expect((await f.thread())?.activeTipPromptMessageId).toBe(after);
    const history = await f.t.query(internal.chatV2.getChatHistoryPath, { agentThreadId: f.threadId });
    const order = async (id: string) => (await f.turnOf(id)).order;
    expect(history).toEqual({
      orders: [await order(f.firstPrompt), await order(edited.messageId), await order(after)],
      belowOrder: await order(f.firstPrompt),
    });
  });

  test("a switch is refused while a reply runs", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const regenerated = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    });
    await expect(f.actor.mutation(api.chatV2.setActiveAlternative, {
      threadId: f.threadId, promptMessageId: f.firstPrompt,
    })).rejects.toThrow(/CHAT_TURN_ACTIVE|still being written/);
    await f.reply(regenerated.messageId, "Second try.");
    await expect(f.actor.mutation(api.chatV2.setActiveAlternative, {
      threadId: f.threadId, promptMessageId: "not-a-turn",
    })).rejects.toThrow(/NOT_FOUND|no longer in this conversation/);
  });
});

describe("coverage and chains on the path", () => {
  const item = (proposalId: Id<"chatProposals">, projectId: Id<"projects">, itemId: string) => ({
    proposalId, projectId, itemId, status: "resolved" as const, reason: "Fixed.", section: "242" as const,
    paragraphNumber: 1, kind: "rule" as const, createdAt: Date.now(),
  });

  test("coverage reads the path's cards plus cards applied on any path", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const second = await f.send("Fix Line 242.");
    await f.reply(second, "Cards saved.");
    await f.t.run(async (ctx) => {
      const pending = await ctx.db.insert("chatProposals", {
        agentThreadId: f.threadId, promptMessageId: second, projectId: f.projectId, reportId: f.reportId,
        kind: "replacements", replacements: [{ find: "A.", replaceWith: "B." }], state: "pending", createdAt: Date.now(),
      });
      const applied = await ctx.db.insert("chatProposals", {
        agentThreadId: f.threadId, promptMessageId: second, projectId: f.projectId, reportId: f.reportId,
        kind: "replacements", replacements: [{ find: "C.", replaceWith: "D." }], state: "applied", createdAt: Date.now(),
      });
      await ctx.db.insert("chatProposalItems", item(pending, f.projectId, "r-242-pending"));
      await ctx.db.insert("chatProposalItems", item(applied, f.projectId, "r-242-applied"));
    });
    const handled = async () => (await f.t.query(internal.chatV2.getThreadItemCoverage, { agentThreadId: f.threadId }))
      .filter((row) => row.handled).map((row) => row.itemId).sort();
    expect(await handled()).toEqual(["r-242-applied", "r-242-pending"]);

    const regenerated = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: second, kind: "regenerate",
    });
    expect(await handled()).toEqual(["r-242-applied"]);
    await f.reply(regenerated.messageId, "Again.");
    await f.actor.mutation(api.chatV2.setActiveAlternative, { threadId: f.threadId, promptMessageId: second });
    expect(await handled()).toEqual(["r-242-applied", "r-242-pending"]);
  });

  test("a link continues the tip only; its parent is the turn it continues", async () => {
    const f = await setup();
    await f.reply(f.firstPrompt, "First reply.");
    const regenerated = await f.actor.mutation(api.chatV2.sendAlternative, {
      threadId: f.threadId, ofPromptMessageId: f.firstPrompt, kind: "regenerate",
    });
    const offer = { reason: "lines_left" as const, nextSection: "244" as const, remaining: 2 };
    await f.reply(regenerated.messageId, "Line 242 done.");
    await f.t.run(async (ctx) => {
      for (const turn of await ctx.db.query("chatTurns").collect()) await ctx.db.patch(turn._id, { continuation: offer });
    });
    // The first turn is on the other path: it starts nothing.
    expect(await f.t.mutation(internal.chatV2.continueChain, {
      agentThreadId: f.threadId, promptMessageId: f.firstPrompt,
    })).toEqual({ kind: "none" });
    const linked = await f.t.mutation(internal.chatV2.continueChain, {
      agentThreadId: f.threadId, promptMessageId: regenerated.messageId,
    });
    expect(linked.kind).toBe("linked");
    if (linked.kind !== "linked") return;
    expect(await f.turnOf(linked.promptMessageId)).toMatchObject({
      origin: "auto_continue", parentPromptMessageId: regenerated.messageId,
    });
    expect((await f.thread())?.activeTipPromptMessageId).toBe(linked.promptMessageId);
    // Stop on the turn just continued stops that link.
    const stopped = await f.actor.mutation(api.chatV2.abortStreaming, {
      threadId: f.threadId, order: (await f.turnOf(regenerated.messageId)).order,
    });
    expect(stopped).toBe(true);
    expect((await f.turnOf(linked.promptMessageId)).status).toBe("aborted");
  });
});
