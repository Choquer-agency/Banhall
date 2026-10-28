/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Owner 2026-10-28: one suggestion card per Line, each reviewed and accepted
 * on its own, and up to three options for an edit inside one Line.
 */
const heading = (level: number, text: string) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    heading(1, "Alloy fatigue PD"),
    heading(2, "Line 242 — Scientific/Technological Uncertainty"),
    paragraph("It was not known how the prototype alloy would behave under load."),
    heading(2, "Line 244 — Work Performed"),
    paragraph("The team cycled 46 coupons of the prototype alloy."),
    heading(2, "Line 246 — Scientific/Technological Advancement"),
    paragraph("The work established the fatigue limit."),
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: "lines-owner", role: "writer", firstName: "Owen" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD", clientName: "Acme Metals", status: "client_review",
      createdBy: ownerId, ownerId, shareToken: "lines-token", createdAt: now, updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: REPORT_DOC, version: 1, generatedAt: now, updatedAt: now, revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "lines-thread", title: "Chat", createdAt: now });
    return { projectId, reportId };
  });
  const owner = t.withIdentity({ subject: "lines-owner" });
  const content = async () => (await t.run((ctx) => ctx.db.get(ids.reportId)))?.content ?? "";
  const cards = async () =>
    await t.run((ctx) =>
      ctx.db.query("chatProposals").withIndex("by_agentThreadId", (q) => q.eq("agentThreadId", "lines-thread")).collect()
    );
  return { t, owner, content, cards, ...ids };
}

describe("one card per Line", () => {
  it("saves a passage set that touches two Lines as one card for each, in Line order", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "lines-thread", toolCallId: "call-two-lines", kind: "replacements", requireUniqueTargets: true,
      replacements: [
        { find: "The work established the fatigue limit.", replaceWith: "The work set the fatigue limit." },
        { find: "It was not known how the prototype alloy would behave under load.", replaceWith: "Its behaviour under load was unknown." },
      ],
    });
    if (!saved.ok) throw new Error(saved.reason);
    expect(saved.proposalIds).toHaveLength(2);
    const rows = await f.cards();
    expect(rows.map((row) => row.section)).toEqual(["242", "246"]);
    expect(rows[0].replacements).toEqual([
      { find: "It was not known how the prototype alloy would behave under load.", replaceWith: "Its behaviour under load was unknown." },
    ]);

    // Accepting Line 246 leaves Line 242 untouched.
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: rows[1]._id })).toMatchObject({ applied: true });
    expect(await f.content()).toContain("The work set the fatigue limit.");
    expect(await f.content()).toContain("It was not known how the prototype alloy");
  });

  it("returns every card of a retried tool call", async () => {
    const f = await setup();
    const args = {
      agentThreadId: "lines-thread", toolCallId: "call-retry", kind: "replacements" as const,
      replacements: [{ find: "prototype alloy", replaceWith: "test alloy" }],
    };
    const first = await f.t.mutation(internal.chatV2.saveProposal, args);
    const again = await f.t.mutation(internal.chatV2.saveProposal, args);
    if (!first.ok || !again.ok) throw new Error("refused");
    expect(again.proposalIds).toEqual(first.proposalIds);
    expect(await f.cards()).toHaveLength(2);
  });

  it("splits a report-wide find/replace by Line and applies each card inside its own Line", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "lines-thread", kind: "replacements",
      replacements: [{ find: "prototype alloy", replaceWith: "test alloy" }],
    });
    if (!saved.ok) throw new Error(saved.reason);
    const rows = await f.cards();
    expect(rows.map((row) => row.section)).toEqual(["242", "244"]);

    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: rows[1]._id })).toMatchObject({ applied: true, count: 1 });
    const after = await f.content();
    expect(after).toContain("46 coupons of the test alloy");
    expect(after).toContain("how the prototype alloy would behave");
  });

  it("keeps an edit inside one Line as one card with its Line", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "lines-thread", kind: "edit", targetText: "cycled 46 coupons", newText: "fatigue-tested 46 coupons",
    });
    if (!saved.ok) throw new Error(saved.reason);
    const rows = await f.cards();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "edit", section: "244", requireUniqueTarget: true });
  });
});

describe("options", () => {
  const optionArgs = {
    agentThreadId: "lines-thread", kind: "edit" as const,
    targetText: "The work established the fatigue limit.", newText: "The work set the fatigue limit.",
    alternatives: [
      { replacements: [{ find: "The work established the fatigue limit.", replaceWith: "The fatigue limit was found." }] },
      { replacements: [{ find: "The work established the fatigue limit.", replaceWith: "The team found the fatigue limit." }] },
    ],
  };

  it("stores up to two more versions and applies the one the writer picks", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, optionArgs);
    if (!saved.ok) throw new Error(saved.reason);
    const [card] = await f.cards();
    expect(card.alternatives).toHaveLength(2);

    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: card._id, option: 2 })).toMatchObject({ applied: true });
    expect(await f.content()).toContain("The team found the fatigue limit.");
    expect((await f.cards())[0]).toMatchObject({ state: "applied", appliedOption: 2 });

    // Undo puts the report back and forgets the option.
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: card._id });
    expect(await f.content()).toContain("The work established the fatigue limit.");
    const undone = (await f.cards())[0];
    expect(undone.state).toBe("pending");
    expect(undone.appliedOption).toBeUndefined();
  });

  it("applies Option 1 by default", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, optionArgs);
    if (!saved.ok) throw new Error(saved.reason);
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: saved.proposalId });
    expect(await f.content()).toContain("The work set the fatigue limit.");
    expect((await f.cards())[0].appliedOption).toBe(0);
  });

  it("refuses an option the card does not have", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, optionArgs);
    if (!saved.ok) throw new Error(saved.reason);
    await expect(f.owner.mutation(api.chatV2.applyProposal, { proposalId: saved.proposalId, option: 3 })).rejects.toThrow(
      /not part of this suggestion/
    );
  });

  it("refuses options for a change that touches more than one Line", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "lines-thread", kind: "replacements", requireUniqueTargets: true,
      replacements: [
        { find: "The work established the fatigue limit.", replaceWith: "The work set the fatigue limit." },
        { find: "cycled 46 coupons", replaceWith: "tested 46 coupons" },
      ],
      alternatives: [{ replacements: [{ find: "cycled 46 coupons", replaceWith: "ran 46 coupons" }] }],
    });
    expect(saved).toMatchObject({ ok: false, reason: expect.stringContaining("only for an edit inside one Line") });
    expect(await f.cards()).toHaveLength(0);
  });

  it("refuses an option that edits a different Line", async () => {
    const f = await setup();
    const saved = await f.t.mutation(internal.chatV2.saveProposal, {
      ...optionArgs,
      alternatives: [{ replacements: [{ find: "cycled 46 coupons", replaceWith: "ran 46 coupons" }] }],
    });
    expect(saved).toMatchObject({ ok: false, reason: "Option 2 must edit the same Line as Option 1." });
  });
});
