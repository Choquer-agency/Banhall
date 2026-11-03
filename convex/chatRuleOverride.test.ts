/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { CHAT_OVERRIDE_DECISION_NOTE, decisionsTextFrom } from "./ai/chatEvidence";

const modules = import.meta.glob("./**/*.ts");

// 2026-11-02 (client meeting, rule overrides): a chat card that goes against
// a house rule, the template or a CRA limit is applied only by a holder of
// `report.overrideRules` (Managers and Admins) who confirmed those rules by
// name. The server checks both on every apply path and records the override.

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    paragraph("The team tested the alloy under load."),
    paragraph("The company measured the coating."),
  ],
});

const RULES = [
  { kind: "house_rule" as const, name: "First person", reason: "The transcript wording says the company, not we." },
];

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: "ro-writer", role: "writer", firstName: "Wren" });
    const managerId = await ctx.db.insert("users", { authId: "ro-manager", role: "manager", firstName: "Mara" });
    const adminId = await ctx.db.insert("users", { authId: "ro-admin", role: "admin", firstName: "Ada" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "ro-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    await ctx.db.insert("agentChatThreads", {
      projectId,
      reportId,
      agentThreadId: "ro-thread",
      title: "Chat",
      createdAt: now,
    });
    const base = {
      agentThreadId: "ro-thread",
      projectId,
      reportId,
      kind: "edit" as const,
      requireUniqueTarget: true,
      state: "pending" as const,
      createdAt: now,
    };
    // A banned word ("novel") in the new text: an override keeps it verbatim.
    const overrideId = await ctx.db.insert("chatProposals", {
      ...base,
      targetText: "The team tested the alloy under load.",
      newText: "The company tested a novel alloy under load.",
      rulesBroken: RULES,
    });
    const plainId = await ctx.db.insert("chatProposals", {
      ...base,
      targetText: "The company measured the coating.",
      newText: "We measured the novel coating.",
    });
    return { ownerId, managerId, adminId, projectId, reportId, overrideId, plainId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "ro-writer" }),
    manager: t.withIdentity({ subject: "ro-manager" }),
    admin: t.withIdentity({ subject: "ro-admin" }),
  };
}

async function failure(call: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data as { code?: string; message?: string } | undefined;
    return { code: String(data?.code ?? "UNTYPED"), message: String(data?.message ?? (error as Error).message) };
  }
  return { code: "NO_ERROR", message: "" };
}

async function reportText(t: ReturnType<typeof convexTest>, reportId: Id<"reports">) {
  return await t.run(async (ctx) => (await ctx.db.get(reportId))!.content);
}

describe("applying a card that goes against a rule", () => {
  it("a manager applies it after confirming the rules, and the override is recorded", async () => {
    const s = await setup();
    const result = await s.manager.mutation(api.chatV2.applyProposal, {
      proposalId: s.overrideId,
      overrideRules: ["First person"],
    });
    expect(result.applied).toBe(true);
    const content = await reportText(s.t, s.reportId);
    // Owner, 2026-11-02 (second): a house-rule override is still scrubbed of
    // banned words; only an approved banned word stays.
    expect(content).not.toContain("novel alloy");
    expect(content).toContain("The company tested a");
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.overrideId));
    expect(row?.state).toBe("applied");
    expect(row?.ruleOverrides).toHaveLength(1);
    expect(row?.ruleOverrides?.[0]).toMatchObject({ userId: s.managerId, rules: ["First person"] });
    expect(typeof row?.ruleOverrides?.[0].at).toBe("number");
  });

  it("a writer confirms a template rule or an approved banned word themselves, and the word stays (owner, 2026-11-02 second)", async () => {
    const s = await setup();
    const ids = await s.t.run(async (ctx) => {
      const base = {
        agentThreadId: "ro-thread",
        projectId: s.projectId,
        reportId: s.reportId,
        kind: "edit" as const,
        requireUniqueTarget: true,
        state: "pending" as const,
        createdAt: Date.now(),
      };
      const template = await ctx.db.insert("chatProposals", {
        ...base,
        targetText: "The company measured the coating.",
        newText: "The company measured the coating at three loads.",
        rulesBroken: [{ kind: "template" as const, name: "No single-sentence paragraphs", reason: "The writer wants this point on its own." }],
      });
      return { template };
    });
    await s.writer.mutation(api.chatV2.applyProposal, { proposalId: ids.template, overrideRules: ["No single-sentence paragraphs"] });
    expect(await reportText(s.t, s.reportId)).toContain("The company measured the coating at three loads.");
    // An approved banned word: the writer confirms and the word is kept.
    const word = await s.t.run(async (ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "ro-thread",
        projectId: s.projectId,
        reportId: s.reportId,
        kind: "edit" as const,
        requireUniqueTarget: true,
        state: "pending" as const,
        createdAt: Date.now(),
        targetText: "The team tested the alloy under load.",
        newText: "The team tested a novel alloy under load.",
        rulesBroken: [{ kind: "banned_words" as const, name: "novel", reason: "The writer asked for this word and said yes." }],
      })
    );
    await s.writer.mutation(api.chatV2.applyProposal, { proposalId: word, overrideRules: ["novel"] });
    expect(await reportText(s.t, s.reportId)).toContain("The team tested a novel alloy under load.");
  });

  it("keeps only the banned word the card approved; another banned word in it, or added by a rewording, is scrubbed (review 2026-11-03)", async () => {
    const s = await setup();
    const word = await s.t.run(async (ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "ro-thread",
        projectId: s.projectId,
        reportId: s.reportId,
        kind: "edit" as const,
        requireUniqueTarget: true,
        state: "pending" as const,
        createdAt: Date.now(),
        targetText: "The team tested the alloy under load.",
        newText: "The team tested a novel alloy under load.",
        rulesBroken: [{ kind: "banned_words" as const, name: "Banned word: novel", reason: "The writer asked for this word and said yes." }],
      })
    );
    await s.writer.mutation(api.chatV2.updateProposalWording, {
      proposalId: word,
      newText: "The team tested a novel, cutting-edge alloy under load.",
    });
    await s.writer.mutation(api.chatV2.applyProposal, { proposalId: word, overrideRules: ["Banned word: novel"] });
    const text = await reportText(s.t, s.reportId);
    expect(text).toContain("The team tested a novel, advanced alloy under load.");
    expect(text).not.toContain("cutting-edge");
  });

  it("refuses a card or a rewording that holds a bullet or numbered list, whoever asks (owner, 2026-11-02 second)", async () => {
    const s = await setup();
    const refused = await failure(() =>
      s.manager.mutation(api.chatV2.updateProposalWording, {
        proposalId: s.overrideId,
        newText: "The company tested:\n- the alloy under load\n- the coating",
      })
    );
    expect(refused.code).toBe("INVALID_INPUT");
    expect(refused.message).toContain("Bullet points and numbered lists cannot go in the report");
  });

  it("an admin may apply it too", async () => {
    const s = await setup();
    const result = await s.admin.mutation(api.chatV2.applyProposal, {
      proposalId: s.overrideId,
      overrideRules: [" First person "],
    });
    expect(result.applied).toBe(true);
  });

  it("a writer who owns the report is refused, even with the confirmation, and nothing changes", async () => {
    const s = await setup();
    const refused = await failure(() =>
      s.writer.mutation(api.chatV2.applyProposal, { proposalId: s.overrideId, overrideRules: ["First person"] })
    );
    expect(refused.code).toBe("NOT_AUTHORIZED");
    expect(refused.message).toContain("A manager can apply this change");
    expect(refused.message).toContain('the house rule "First person"');
    expect(await reportText(s.t, s.reportId)).toBe(REPORT_DOC);
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.overrideId));
    expect(row?.state).toBe("pending");
    expect(row?.ruleOverrides).toBeUndefined();
  });

  it("a writer cannot reword the card either, and a manager can (review round 2)", async () => {
    const s = await setup();
    const refused = await failure(() =>
      s.writer.mutation(api.chatV2.updateProposalWording, { proposalId: s.overrideId, newText: "We changed it anyway." })
    );
    expect(refused.code).toBe("NOT_AUTHORIZED");
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.overrideId));
    expect(row?.newText).not.toBe("We changed it anyway.");
    await s.manager.mutation(api.chatV2.updateProposalWording, {
      proposalId: s.overrideId,
      newText: "The company ran the trials at three set points.",
    });
    expect((await s.t.run(async (ctx) => await ctx.db.get(s.overrideId)))?.newText).toBe(
      "The company ran the trials at three set points."
    );
  });

  it("a manager without the confirmation, or with the wrong rules, is refused", async () => {
    const s = await setup();
    for (const overrideRules of [undefined, [], ["Banned words"], ["First person", "First person"], ["First person", "Line 244 word cap"]]) {
      const refused = await failure(() =>
        s.manager.mutation(api.chatV2.applyProposal, {
          proposalId: s.overrideId,
          ...(overrideRules ? { overrideRules } : {}),
        })
      );
      expect(refused.code).toBe("INVALID_INPUT");
      expect(refused.message).toContain("Confirm the rules this change goes against");
    }
    expect(await reportText(s.t, s.reportId)).toBe(REPORT_DOC);
  });

  it("the one-by-one path checks the same right and confirmation", async () => {
    const s = await setup();
    const stepped = JSON.stringify({
      type: "doc",
      content: [paragraph("The company tested a novel alloy under load."), paragraph("The company measured the coating.")],
    });
    const asWriter = await failure(() =>
      s.writer.mutation(api.chatV2.markProposalApplied, {
        proposalId: s.overrideId,
        content: stepped,
        expectedRevisionNumber: 0,
        overrideRules: ["First person"],
      })
    );
    expect(asWriter.code).toBe("NOT_AUTHORIZED");
    const unconfirmed = await failure(() =>
      s.manager.mutation(api.chatV2.markProposalApplied, {
        proposalId: s.overrideId,
        content: stepped,
        expectedRevisionNumber: 0,
      })
    );
    expect(unconfirmed.code).toBe("INVALID_INPUT");
    expect(await reportText(s.t, s.reportId)).toBe(REPORT_DOC);
    const applied = await s.manager.mutation(api.chatV2.markProposalApplied, {
      proposalId: s.overrideId,
      content: stepped,
      expectedRevisionNumber: 0,
      overrideRules: ["First person"],
    });
    expect(applied.applied).toBe(true);
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.overrideId));
    expect(row?.ruleOverrides?.[0]).toMatchObject({ userId: s.managerId, rules: ["First person"] });
  });

  it("undo then apply again keeps the first override record and adds a second", async () => {
    const s = await setup();
    await s.manager.mutation(api.chatV2.applyProposal, { proposalId: s.overrideId, overrideRules: ["First person"] });
    await s.manager.mutation(api.chatV2.undoProposal, { proposalId: s.overrideId });
    // Back to pending: the confirmation is needed again.
    const again = await failure(() => s.admin.mutation(api.chatV2.applyProposal, { proposalId: s.overrideId }));
    expect(again.code).toBe("INVALID_INPUT");
    await s.admin.mutation(api.chatV2.applyProposal, { proposalId: s.overrideId, overrideRules: ["First person"] });
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.overrideId));
    expect(row?.ruleOverrides?.map((entry) => entry.userId)).toEqual([s.managerId, s.adminId]);
  });
});

describe("cards that break no rule are unchanged", () => {
  it("the owner applies a plain card with no confirmation, scrubbed as before, and nothing is recorded", async () => {
    const s = await setup();
    const result = await s.writer.mutation(api.chatV2.applyProposal, { proposalId: s.plainId });
    expect(result.applied).toBe(true);
    const content = await reportText(s.t, s.reportId);
    // The applier's banned-word scrub still runs.
    expect(content).toContain("We measured the new coating.");
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.plainId));
    expect(row?.ruleOverrides).toBeUndefined();
  });

  it("a stray confirmation on a plain card is ignored, not recorded", async () => {
    const s = await setup();
    await s.manager.mutation(api.chatV2.applyProposal, { proposalId: s.plainId, overrideRules: ["First person"] });
    const row = await s.t.run(async (ctx) => await ctx.db.get(s.plainId));
    expect(row?.state).toBe("applied");
    expect(row?.ruleOverrides).toBeUndefined();
  });
});

describe("saving a card that goes against a rule", () => {
  it("stores the rules, trimmed and without repeats, on the card", async () => {
    const s = await setup();
    const saved = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "The company measured the coating.",
      newText: "The company measured the coating twice.",
      rulesBroken: [
        { kind: "template", name: " Line 244 paragraph order ", reason: " Moves the result first. " },
        { kind: "template", name: "line 244 paragraph order", reason: "Repeat." },
      ],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const row = await s.t.run(async (ctx) => await ctx.db.get(saved.proposalId));
    expect(row?.rulesBroken).toEqual([{ kind: "template", name: "Line 244 paragraph order", reason: "Moves the result first." }]);
  });

  it("stores nothing for a card that names no rule", async () => {
    const s = await setup();
    const saved = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "The company measured the coating.",
      newText: "The company measured the coating twice.",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const row = await s.t.run(async (ctx) => await ctx.db.get(saved.proposalId));
    expect(row?.rulesBroken).toBeUndefined();
  });

  it("refuses rules on a highlight, and a rule with no reason", async () => {
    const s = await setup();
    const highlight = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "references",
      references: ["The company measured the coating."],
      rulesBroken: RULES,
    });
    expect(highlight).toMatchObject({ ok: false });
    const noReason = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "The company measured the coating.",
      newText: "The company measured the coating twice.",
      rulesBroken: [{ kind: "house_rule", name: "First person", reason: "  " }],
    });
    expect(noReason).toMatchObject({ ok: false });
    // Review 2026-11-03: a banned_words rule names one listed word.
    const unlisted = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "The company measured the coating.",
      newText: "The company measured the coating twice.",
      rulesBroken: [{ kind: "banned_words", name: "All banned words", reason: "The writer said yes." }],
    });
    expect(unlisted).toMatchObject({ ok: false });
    expect(unlisted.ok ? "" : unlisted.reason).toContain("is not on the banned words list");
  });
});

describe("a card that adds, splits or merges paragraphs (owner, 2026-11-03)", () => {
  it("saves, applies and undoes an added paragraph", async () => {
    const s = await setup();
    const saved = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "The company measured the coating.",
      newText: "The company measured the coating.\n\nThe team then repeated the test at a higher load.",
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    await s.writer.mutation(api.chatV2.applyProposal, { proposalId: saved.proposalId });
    const after = JSON.parse(await reportText(s.t, s.reportId)) as { content: Array<{ content: Array<{ text: string }> }> };
    expect(after.content.map((block) => block.content[0].text)).toEqual([
      "The team tested the alloy under load.",
      "The company measured the coating.",
      "The team then repeated the test at a higher load.",
    ]);
    await s.writer.mutation(api.chatV2.undoProposal, { proposalId: saved.proposalId });
    expect(JSON.parse(await reportText(s.t, s.reportId))).toEqual(JSON.parse(REPORT_DOC));
  });

  it("refuses a split of part of a paragraph, naming whole paragraphs", async () => {
    const s = await setup();
    const saved = await s.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "ro-thread",
      kind: "edit",
      targetText: "measured the coating.",
      newText: "measured\n\nthe coating.",
    });
    expect(saved).toMatchObject({ ok: false });
    expect(saved.ok ? "" : saved.reason).toContain("needs whole paragraphs");
  });
});

describe("the Assistant's memory of an applied override", () => {
  it("marks the applied card as kept on purpose, naming the rules", async () => {
    const s = await setup();
    await s.manager.mutation(api.chatV2.applyProposal, { proposalId: s.overrideId, overrideRules: ["First person"] });
    const context = await s.t.query(internal.chatV2.getChatContextV2, {
      reportId: s.reportId,
      agentThreadId: "ro-thread",
    });
    const decisions = context.decisions as Array<{ state: string; overriddenRules?: string[] }>;
    const applied = decisions.find((decision) => decision.state === "applied");
    expect(applied?.overriddenRules).toEqual(["First person"]);
    const pending = decisions.find((decision) => decision.state === "pending");
    expect(pending?.overriddenRules).toBeUndefined();
    const text = decisionsTextFrom(context.decisions);
    expect(text).toContain(`${CHAT_OVERRIDE_DECISION_NOTE} "First person".`);
  });

  it("leaves a decision with no override byte for byte as before", () => {
    expect(decisionsTextFrom([{ state: "applied", target: "a", candidate: "b" }])).toBe(
      "[Edit 1: APPLIED]\nCanonical target from report: a\nCandidate replacement: b"
    );
  });
});
