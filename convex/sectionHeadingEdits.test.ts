/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Review g1 follow-up (2026-09-25): skipping Section headings on the server
 * must not retarget an edit aimed at heading text onto a lone body match. A
 * client suggestion or an AI edit that targets a heading is refused plainly.
 */
const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    heading(1, "Alloy fatigue PD"),
    heading(2, "Line 242 — Scientific/Technological Uncertainty"),
    paragraph("The team could not predict the fatigue limit."),
    heading(2, "Line 244 — Work Performed"),
    paragraph("The work performed in phase 2 cycled the coupons."),
    heading(2, "Line 246 — Scientific/Technological Advancement"),
    paragraph("The work established the limit."),
  ],
});
const HEADING_MESSAGE = "Section headings can't be edited.";

async function setup() {
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
      projectId, reportId, commenterId, commenterType: "client", highlightFrom: 0, highlightTo: 14,
      highlightText: "Work Performed", body: "Say what kind of work.", suggestedEdit: "Experimental work",
      resolved: false, createdAt: now,
    });
    return { projectId, reportId, commentId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "she-owner" }) };
}

async function reportContent(f: Awaited<ReturnType<typeof setup>>) {
  return (await f.t.run((ctx) => ctx.db.get(f.reportId)))?.content;
}

describe("edits aimed at Section heading text", () => {
  it("refuses a client suggestion on heading text instead of rewriting the one body match", async () => {
    const f = await setup();
    await expect(f.owner.mutation(api.comments.acceptEdit, { commentId: f.commentId })).rejects.toThrow(HEADING_MESSAGE);
    expect(await reportContent(f)).toBe(REPORT_DOC);
    expect((await f.t.run((ctx) => ctx.db.get(f.commentId)))?.resolved).toBe(false);
  });

  it("tells the model a heading edit is refused, not that the target is missing", async () => {
    const f = await setup();
    const single = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "she-thread", kind: "edit", targetText: "Work Performed", newText: "Experimental work",
    });
    expect(single).toMatchObject({ ok: false, reason: expect.stringContaining(HEADING_MESSAGE) });
    const headingOnly = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "she-thread", kind: "replacements", replacements: [{ find: "Scientific/Technological Uncertainty", replaceWith: "Question" }],
    });
    expect(headingOnly).toMatchObject({ ok: false, reason: expect.stringContaining(HEADING_MESSAGE) });
    expect(await f.t.run((ctx) => ctx.db.query("chatProposals").collect())).toEqual([]);
  });

  it("refuses to apply a stored single-passage edit whose target is also heading text", async () => {
    const f = await setup();
    const proposalId = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "she-thread", projectId: f.projectId, reportId: f.reportId, kind: "edit",
        targetText: "Work Performed", newText: "Experimental work", state: "pending", createdAt: Date.now(),
      })
    );
    const result = await f.owner.mutation(api.chatV2.applyProposal, { proposalId });
    expect(result).toMatchObject({ applied: false, reason: expect.stringContaining(HEADING_MESSAGE) });
    expect(await reportContent(f)).toBe(REPORT_DOC);
  });
});
