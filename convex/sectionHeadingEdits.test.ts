/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";

const modules = import.meta.glob("./**/*.ts");

/**
 * Review g1 follow-up (2026-09-25): skipping Section headings on the server
 * must not retarget an edit aimed at heading text onto a lone body match. A
 * client suggestion or an AI edit that targets a heading is refused plainly.
 */
const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const NODES = [
  heading(1, "Alloy fatigue PD"),
  heading(2, "Line 242 — Scientific/Technological Uncertainty"),
  paragraph("The technological uncertainty was the fatigue limit of the alloy."),
  heading(2, "Line 244 — Work Performed"),
  paragraph("The work performed in phase 2 cycled 46 coupons."),
  heading(2, "Line 246 — Scientific/Technological Advancement"),
  paragraph("The work established the limit."),
  paragraph("The coupons survived 10,000 cycles."),
];
const REPORT_DOC = JSON.stringify({ type: "doc", content: NODES });
const HEADING_MESSAGE = "Section headings can't be edited.";

/** A ProseMirror selection of `text` inside top-level node `index`. */
function selection(index: number, text: string) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += 2 + NODES[i].content[0].text.length;
  const from = pos + 1 + NODES[index].content[0].text.indexOf(text);
  return { from, to: from + text.length };
}

async function setup(comment: { text: string; suggestion: string; at: { from: number; to: number } }) {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: "she-owner", role: "writer", firstName: "Owen" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD", clientName: "Acme Metals", status: "client_review",
      createdBy: ownerId, ownerId, shareToken: "she-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: REPORT_DOC, version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "she-thread", title: "Chat", createdAt: now });
    const commenterId = await ctx.db.insert("commenters", { projectId, name: "Casey Client", color: "#818CF8", createdAt: now });
    const commentId = await ctx.db.insert("comments", {
      projectId, reportId, commenterId, commenterType: "client", highlightFrom: comment.at.from, highlightTo: comment.at.to,
      highlightText: comment.text, body: "Please reword.", suggestedEdit: comment.suggestion,
      resolved: false, createdAt: now,
    });
    return { projectId, reportId, commentId, ownerId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "she-owner" }) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function reportContent(f: Fixture) {
  return (await f.t.run((ctx) => ctx.db.get(f.reportId)))?.content;
}

/** A research edit as research.ts stores it: single target, with the writer's selection. */
async function researchProposal(f: Fixture, target: string, at: { from: number; to: number }, newText: string) {
  return await f.t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("researchSessions", {
      projectId: f.projectId, reportId: f.reportId, requestedBy: f.ownerId, selectedText: target,
      selectionFrom: at.from, selectionTo: at.to, surroundingContext: "", instruction: "Check the count.",
      externalBrief: "", reportRevisionNumber: 0, status: "completed", createdAt: Date.now(), updatedAt: Date.now(),
    } as never);
    return await ctx.db.insert("chatProposals", {
      agentThreadId: `research:${sessionId}`, projectId: f.projectId, reportId: f.reportId, kind: "edit",
      targetText: target, newText, researchSessionId: sessionId, requireUniqueTarget: true, state: "pending", createdAt: Date.now(),
    });
  });
}

const proposalState = (f: Fixture, id: Id<"chatProposals">) => f.t.run(async (ctx) => (await ctx.db.get(id))?.state);

const bodyComment = { text: "work performed", suggestion: "tests run", at: selection(4, "work performed") };

describe("research edits on body text that a heading also contains (review follow-up)", () => {
  it("applies \"46\" in the body although \"Line 246\" contains it", async () => {
    const f = await setup(bodyComment);
    const id = await researchProposal(f, "46", selection(4, "46"), "48");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true, count: 1 });
    expect(await reportContent(f)).toContain("cycled 48 coupons");
    expect(await reportContent(f)).toContain("Line 246 — Scientific/Technological Advancement");
    expect(await proposalState(f, id)).toBe("applied");
  });

  it("applies a body phrase that the 242 heading also contains", async () => {
    const f = await setup(bodyComment);
    const id = await researchProposal(f, "technological uncertainty", selection(2, "technological uncertainty"), "technical question");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true });
    expect(await reportContent(f)).toContain("The technical question was");
    expect(await reportContent(f)).toContain("Line 242 — Scientific/Technological Uncertainty");
  });

  it("refuses a research edit whose selection sits in a heading, and marks it stale", async () => {
    const f = await setup(bodyComment);
    const id = await researchProposal(f, "Work Performed", selection(3, "Work Performed"), "Experimental work");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: false, reason: HEADING_MESSAGE });
    expect(await reportContent(f)).toBe(REPORT_DOC);
    expect(await proposalState(f, id)).toBe("stale");
  });
});

describe("client suggestions (review link, where heading text is selectable)", () => {
  it("refuses a suggestion selected in the 244 heading instead of rewriting the one body match", async () => {
    const f = await setup({ text: "Work Performed", suggestion: "Experimental work", at: selection(3, "Work Performed") });
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(HEADING_MESSAGE);
    expect(await reportContent(f)).toBe(REPORT_DOC);
    expect((await f.t.run((ctx) => ctx.db.get(f.commentId)))?.resolved).toBe(false);
  });

  it("applies a suggestion selected in the body although a heading has the same words", async () => {
    const f = await setup(bodyComment);
    await f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    expect(await reportContent(f)).toContain("The tests run in phase 2");
    expect(await reportContent(f)).toContain("Line 244 — Work Performed");
  });

  it("fails closed when the stored positions no longer hold the text and a heading matches", async () => {
    const f = await setup({ text: "Work Performed", suggestion: "Experimental work", at: { from: 1, to: 15 } });
    // "Work Performed" is now in the 244 heading and in the body: which one was meant is unknown.
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(
      "The report changed since this text was selected. Select it again."
    );
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });
});

describe("AI edits with no stored selection", () => {
  it("saves an edit whose one body match also appears in a heading, and names headings when only a heading matches", async () => {
    const f = await setup(bodyComment);
    const single = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "she-thread", kind: "edit", targetText: "work performed in phase 2", newText: "tests run in phase 2",
    });
    expect(single).toMatchObject({ ok: true });
    const headingOnly = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "she-thread", kind: "replacements", replacements: [{ find: "Scientific/Technological Uncertainty", replaceWith: "Question" }],
    });
    expect(headingOnly).toMatchObject({ ok: false, reason: expect.stringContaining(HEADING_MESSAGE) });
    const titleOnly = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "she-thread", kind: "edit", targetText: "Alloy fatigue PD", newText: "Alloy study",
    });
    expect(titleOnly).toMatchObject({ ok: false, reason: expect.stringContaining("The report title can't be edited.") });
  });

  it("marks a stored edit stale when its only match is heading text", async () => {
    const f = await setup(bodyComment);
    const proposalId = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "she-thread", projectId: f.projectId, reportId: f.reportId, kind: "edit",
        targetText: "Scientific/Technological Advancement", newText: "Progress", state: "pending", createdAt: Date.now(),
      })
    );
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId })).toMatchObject({ applied: false, reason: HEADING_MESSAGE });
    expect(await reportContent(f)).toBe(REPORT_DOC);
    expect(await proposalState(f, proposalId)).toBe("stale");
  });
});

/** Top-level node boundaries in ProseMirror positions. */
function nodeStart(index: number) {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += 2 + NODES[i].content[0].text.length;
  return pos;
}
const nodeEnd = (index: number) => nodeStart(index) + 2 + NODES[index].content[0].text.length;

describe("selections at a heading's edge (final round, item 1)", () => {
  it("applies a body selection that ends at the start of the next heading line", async () => {
    // Drag from the start of the last 242 paragraph to the start of the next line.
    const text = NODES[2].content[0].text;
    const f = await setup({ text, suggestion: "The open question was the fatigue limit of the alloy.", at: { from: nodeStart(2) + 1, to: nodeStart(3) + 1 } });
    await f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    expect(await reportContent(f)).toContain("The open question was the fatigue limit");
    expect(await reportContent(f)).toContain("Line 244 — Work Performed");
  });

  it("applies a selection that starts at the end of a heading's text", async () => {
    // Shift+Down from the end of the heading line into the body.
    const f = await setup({ text: "The work performed", suggestion: "The testing done", at: { from: nodeEnd(3) - 1, to: nodeStart(4) + 1 + "The work performed".length } });
    await f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    expect(await reportContent(f)).toContain("The testing done in phase 2");
    expect(await reportContent(f)).toContain("Line 244 — Work Performed");
  });
});

describe("Ask assistant with a highlight (final round, item 2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  async function askWithHighlight(f: Fixture, highlight: { text: string; from: number; to: number }) {
    return await f.owner.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, content: "Rewrite this.", newThread: true, highlight,
    });
  }

  it("refuses an edit aimed at a heading the writer selected, though the body has one match", async () => {
    const f = await setup(bodyComment);
    const sent = await askWithHighlight(f, { text: "Work Performed", ...selection(3, "Work Performed") });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "Work Performed", newText: "Experimental work",
    });
    expect(saved).toMatchObject({ ok: false, reason: expect.stringContaining(HEADING_MESSAGE) });
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });

  it("applies an edit aimed at the body passage the writer selected", async () => {
    const f = await setup(bodyComment);
    const sent = await askWithHighlight(f, { text: "work performed", ...selection(4, "work performed") });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "work performed", newText: "tests run",
    });
    if (!saved.ok) throw new Error(`refused: ${"reason" in saved ? saved.reason : ""}`);
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: saved.proposalId })).toMatchObject({ applied: true });
    expect(await reportContent(f)).toContain("The tests run in phase 2");
  });

  it("keeps the highlight's place when the writer regenerates the prompt", async () => {
    const f = await setup(bodyComment);
    const first = await askWithHighlight(f, { text: "Work Performed", ...selection(3, "Work Performed") });
    // The first reply has finished: a thread runs one turn at a time.
    await f.t.mutation(internal.chatV2.finishTurn, {
      agentThreadId: first.threadId, promptMessageId: first.messageId,
      requestedStatus: "completed", endedAt: Date.now(), stepCount: 1,
    });
    // Regenerate resends the stored prompt text, which carries only the excerpt.
    const again = await f.owner.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, threadId: first.threadId,
      content: 'Rewrite this.\n\n[Writer highlighted this excerpt from the report]:\n"""Work Performed"""',
    });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: again.threadId, promptMessageId: again.messageId, kind: "edit", targetText: "Work Performed", newText: "Experimental work",
    });
    expect(saved).toMatchObject({ ok: false, reason: expect.stringContaining(HEADING_MESSAGE) });
  });

  it("applies an edit inside a highlight that spans two paragraphs (P1)", async () => {
    const f = await setup(bodyComment);
    // The editor joins blocks with a newline (textBetween(from, to, "\\n")).
    const text = `${NODES[6].content[0].text}\n${NODES[7].content[0].text}`;
    const sent = await askWithHighlight(f, { text, from: nodeStart(6) + 1, to: nodeEnd(7) - 1 });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "10,000 cycles", newText: "12,000 cycles",
    });
    if (!saved.ok) throw new Error(`refused: ${"reason" in saved ? saved.reason : ""}`);
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: saved.proposalId })).toMatchObject({ applied: true });
    expect(await reportContent(f)).toContain("survived 12,000 cycles");
  });

  it("applies the second edit from one turn after the first changed the highlighted text (P1)", async () => {
    const f = await setup(bodyComment);
    const text = `${NODES[6].content[0].text}\n${NODES[7].content[0].text}`;
    const sent = await askWithHighlight(f, { text, from: nodeStart(6) + 1, to: nodeEnd(7) - 1 });
    const edit = (targetText: string, newText: string, toolCallId: string) =>
      f.t.mutation(internal.chatV2.saveProposal, { agentThreadId: sent.threadId, promptMessageId: sent.messageId, toolCallId, kind: "edit", targetText, newText });
    const first = await edit("The work established the limit.", "The work set the limit.", "call-1");
    const second = await edit("10,000 cycles", "12,000 cycles", "call-2");
    if (!first.ok || !second.ok) throw new Error("setup proposals were refused");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: first.proposalId })).toMatchObject({ applied: true });
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: second.proposalId })).toMatchObject({ applied: true });
    expect(await reportContent(f)).toContain("The work set the limit.");
    expect(await reportContent(f)).toContain("survived 12,000 cycles");
  });

  it("refuses a drifted heading highlight that now lies nearer a body match (P2)", async () => {
    const f = await setup(bodyComment);
    const body = selection(4, "work performed");
    const sent = await askWithHighlight(f, { text: "Work Performed", from: body.from - 2, to: body.to - 2 });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "Work Performed", newText: "Experimental work",
    });
    expect(saved).toMatchObject({ ok: false, reason: expect.stringContaining("The report changed since this text was selected.") });
  });

  it("lets through a body edit whose target text is not in any heading, though the writer highlighted a heading", async () => {
    const f = await setup(bodyComment);
    const sent = await askWithHighlight(f, { text: "Work Performed", ...selection(3, "Work Performed") });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "work performed in phase 2", newText: "tests run in phase 2",
    });
    expect(saved).toMatchObject({ ok: true });
  });

  it("refuses at Apply a stored edit whose turn selected the heading", async () => {
    const f = await setup(bodyComment);
    const sent = await askWithHighlight(f, { text: "Work Performed", ...selection(3, "Work Performed") });
    const proposalId = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: sent.threadId, promptMessageId: sent.messageId, projectId: f.projectId, reportId: f.reportId,
        kind: "edit", targetText: "Work Performed", newText: "Experimental work", state: "pending", createdAt: Date.now(),
      })
    );
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId })).toMatchObject({ applied: false, reason: HEADING_MESSAGE });
    expect(await proposalState(f, proposalId)).toBe("stale");
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });
});

describe("stale stored positions (final round, item 3)", () => {
  it("decides from the selected text when it now sits only in the body", async () => {
    // Positions moved (a paragraph was added above), but the text is still in the body.
    const at = selection(4, "cycled 46 coupons");
    const f = await setup({ text: "cycled 46 coupons", suggestion: "cycled 48 coupons", at: { from: at.from - 7, to: at.to - 7 } });
    await f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    expect(await reportContent(f)).toContain("cycled 48 coupons");
  });

  it("refuses a drifted heading selection that now lies nearer a body match (P2)", async () => {
    // "Work Performed" was selected in the 244 heading; text above it was then
    // trimmed, so the old positions sit nearer the body's "work performed".
    const body = selection(4, "work performed");
    const f = await setup({ text: "Work Performed", suggestion: "Experimental work", at: { from: body.from - 2, to: body.to - 2 } });
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(
      "The report changed since this text was selected. Select it again."
    );
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });

  it("says the report changed when the selected text is gone", async () => {
    const f = await setup({ text: "a sentence no longer here", suggestion: "new words", at: { from: 5, to: 30 } });
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(
      "The report changed since this text was selected. Select it again."
    );
  });
});

describe("accepting a suggestion twice (final round, item 4)", () => {
  it("refuses a comment that was already accepted", async () => {
    const f = await setup(bodyComment);
    await f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    const after = await reportContent(f);
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(/already/);
    expect(await reportContent(f)).toBe(after);
  });
});

describe("final narrow fixes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("P2-a: refuses a heading-text edit from a drifted highlight that crossed the heading", async () => {
    const f = await setup(bodyComment);
    // Dragged from the 242 body past the 244 heading: it holds the heading's
    // text, not the body's "work performed". The writer then typed above, so
    // the stored positions drifted and the two-block text is not found.
    const text = `${NODES[2].content[0].text}\n${NODES[3].content[0].text}`;
    const sent = await f.owner.mutation(api.chatV2.sendMessage, {
      reportId: f.reportId, content: "Rewrite this.", newThread: true,
      highlight: { text, from: nodeStart(2) + 1 + 5, to: nodeEnd(3) - 1 + 5 },
    });
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: sent.threadId, promptMessageId: sent.messageId, kind: "edit", targetText: "Work Performed", newText: "Experimental work",
    });
    expect(saved).toMatchObject({ ok: false, reason: expect.stringContaining("The report changed since this text was selected.") });
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });

  it("P2-b: applies a drifted research edit on \"46\" though \"Line 246\" contains it", async () => {
    const f = await setup(bodyComment);
    const at = selection(4, "46");
    const id = await researchProposal(f, "46", { from: at.from + 3, to: at.to + 3 }, "48");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: true });
    expect(await reportContent(f)).toContain("cycled 48 coupons");
    expect(await proposalState(f, id)).toBe("applied");
  });

  it("P2-b: still refuses a drifted research selection of a whole heading's text", async () => {
    const f = await setup(bodyComment);
    const whole = NODES[3].content[0].text;
    const id = await researchProposal(f, whole, { from: nodeStart(3) + 1 + 4, to: nodeEnd(3) - 1 + 4 }, "Line 244 — Experiments");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: id })).toMatchObject({ applied: false, reason: HEADING_MESSAGE });
    expect(await proposalState(f, id)).toBe("stale");
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });
});

