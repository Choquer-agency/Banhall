/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import {
  completionReportItems,
  type CompletionReportFinding,
  type CompletionReportItem,
} from "./lib/completionReport";

const modules = import.meta.glob("./**/*.ts");

/**
 * Story 5 (CAP-13, AD-28): the Completion Report is persisted by
 * `internal.chatV2.saveProposal` and by nothing else, in the same transaction
 * as its `chatProposals` parent. This suite pins the four properties a pure
 * test cannot reach: the rows land 1:1 with the tool's findings, a retried tool
 * call writes none, an anchor the report does not have writes neither the
 * proposal nor a row, and `applyProposal` is unchanged and leaves the rows be.
 */

/** 242 holds 5 paragraphs, 244 holds 7, 246 holds 6: the CAP-12 fixture. */
const section = (label: string, n: number): Array<Record<string, unknown>> =>
  Array.from({ length: n }, (_, i) => ({
    type: "paragraph",
    content: [{ type: "text", text: `${label} paragraph ${i + 1} body ${label}${i + 1}.` }],
  }));

const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Alloy fatigue PD" }] },
    heading("Line 242 — Scientific/Technological Uncertainty"),
    ...section("s242", 5),
    heading("Line 244 — Work Performed"),
    ...section("s244", 7),
    heading("Line 246 — Scientific/Technological Advancement"),
    ...section("s246", 6),
  ],
});

/** 16 findings: 14 resolved over 14 edits, 1 blocked, 1 conflicting. */
function sixteen(): {
  edits: Array<{ targetText: string; newText: string }>;
  findings: CompletionReportFinding[];
} {
  const edits: Array<{ targetText: string; newText: string }> = [];
  const findings: CompletionReportFinding[] = [];
  const spread: Array<["242" | "244" | "246", string, number]> = [
    ...Array.from({ length: 5 }, (_, i) => ["242", "s242", i + 1] as ["242", string, number]),
    ...Array.from({ length: 7 }, (_, i) => ["244", "s244", i + 1] as ["244", string, number]),
    ...Array.from({ length: 2 }, (_, i) => ["246", "s246", i + 1] as ["246", string, number]),
  ];
  spread.forEach(([sectionNumber, label, paragraph], index) => {
    edits.push({
      targetText: `${label} paragraph ${paragraph} body ${label}${paragraph}.`,
      newText: `${label} paragraph ${paragraph} revised ${label}${paragraph}.`,
    });
    findings.push({
      id: `r-${sectionNumber}-${paragraph}-1`,
      section: sectionNumber,
      paragraph,
      kind: "rule",
      rule: `Paragraph ${paragraph} rule for Line ${sectionNumber}`,
      status: "resolved",
      editNumbers: [index + 1],
    });
  });
  findings.push({
    id: "c-246-3-1",
    section: "246",
    paragraph: 3,
    kind: "content",
    status: "blocked",
    reason: "The draft cannot state the cycle count.",
    missingFact: "The number of fatigue cycles run in 2025.",
    missingFactSource: "The March interview transcript.",
  });
  findings.push({
    id: "x-246-4-1",
    section: "246",
    paragraph: 4,
    kind: "reference",
    status: "conflicting",
    reason: "The Reference PD adds a fifth advancement paragraph.",
    lockedRule: "Line 246 line cap of 50.",
    alternative: "Fold the fifth advancement into paragraph 4 inside the cap.",
  });
  return { edits, findings };
}

async function setup() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: "cpi-owner",
      role: "writer",
      firstName: "Owen",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "cpi-project-token",
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
      agentThreadId: "cpi-thread",
      title: "Chat",
      createdAt: now,
    });
    return { projectId, reportId, ownerId };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "cpi-owner" }) };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function save(
  f: Fixture,
  args: {
    edits: Array<{ targetText: string; newText: string }>;
    items: CompletionReportItem[];
    toolCallId?: string;
    promptMessageId?: string;
  }
) {
  return await f.t.mutation(internal.chatV2.saveProposal, {
    agentThreadId: "cpi-thread",
    kind: "replacements",
    requireUniqueTargets: true,
    replacements: args.edits.map((edit) => ({
      find: edit.targetText,
      replaceWith: edit.newText,
    })),
    items: args.items,
    ...(args.toolCallId ? { toolCallId: args.toolCallId } : {}),
    ...(args.promptMessageId ? { promptMessageId: args.promptMessageId } : {}),
  });
}

async function rows(f: Fixture) {
  return await f.t.run(async (ctx) => ({
    proposals: await ctx.db.query("chatProposals").collect(),
    items: await ctx.db.query("chatProposalItems").collect(),
  }));
}

describe("saveProposal persists the Completion Report", () => {
  it("writes one row per item, in input order, with the tool's ids and anchors", async () => {
    const f = await setup();
    const { edits, findings } = sixteen();
    const items = completionReportItems(findings);
    const result = await save(f, { edits, items, toolCallId: "call-bulk" });
    expect(result).toMatchObject({ ok: true });

    const state = await rows(f);
    expect(state.proposals).toHaveLength(1);
    expect(state.items).toHaveLength(16);
    expect(state.items.map((row) => row.itemId)).toEqual(findings.map((finding) => finding.id));
    const proposalId = state.proposals[0]?._id;
    expect(state.items.every((row) => row.proposalId === proposalId)).toBe(true);
    expect(state.items.every((row) => row.projectId === f.projectId)).toBe(true);

    // Statuses and their evidence survive the round trip.
    expect(state.items.filter((row) => row.status === "resolved")).toHaveLength(14);
    const blocked = state.items.find((row) => row.itemId === "c-246-3-1");
    expect(blocked).toMatchObject({
      status: "blocked",
      section: "246",
      paragraphNumber: 3,
      kind: "content",
      missingFact: "The number of fatigue cycles run in 2025.",
      missingFactSource: "The March interview transcript.",
    });
    expect(blocked?.lockedRule).toBeUndefined();
    expect(state.items.find((row) => row.itemId === "x-246-4-1")).toMatchObject({
      status: "conflicting",
      kind: "reference",
      paragraphNumber: 4,
      lockedRule: "Line 246 line cap of 50.",
      alternative: "Fold the fifth advancement into paragraph 4 inside the cap.",
    });
    // A rule item keeps the rule it departs from.
    expect(state.items.find((row) => row.itemId === "r-242-1-1")?.rule).toBe(
      "Paragraph 1 rule for Line 242"
    );
  });

  it("writes no second set of rows for a retried tool call", async () => {
    const f = await setup();
    const { edits, findings } = sixteen();
    const items = completionReportItems(findings);
    const first = await save(f, { edits, items, toolCallId: "call-bulk" });
    const before = await rows(f);
    // The same tool call retried: the idempotency short-circuit returns the
    // existing proposal BEFORE any item insert.
    const second = await save(f, { edits, items, toolCallId: "call-bulk" });
    expect(second).toEqual(first);
    const after = await rows(f);
    expect(after.items).toHaveLength(16);
    expect(after).toEqual(before);
  });

  it("writes neither the proposal nor a row for an anchor the report does not have", async () => {
    const f = await setup();
    const { edits, findings } = sixteen();
    const bad = completionReportItems([
      ...findings.slice(0, 15),
      { ...findings[15]!, paragraph: 9 } as CompletionReportFinding,
    ]);
    const result = await save(f, { edits, items: bad, toolCallId: "call-bad" });
    expect(result).toMatchObject({ ok: false });
    expect("reason" in result ? result.reason : "").toContain(
      "names paragraph 9 of Line 246, which has 6 paragraph(s)"
    );
    // The refusal hands back the real counts for every section.
    expect("reason" in result ? result.reason : "").toContain(
      "Line 242 has 5 paragraph(s); Line 244 has 7 paragraph(s); Line 246 has 6 paragraph(s)"
    );
    const state = await rows(f);
    expect(state.proposals).toEqual([]);
    expect(state.items).toEqual([]);
  });

  it("writes neither the proposal nor a row for a stopped turn", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("chatTurns", {
        agentThreadId: "cpi-thread",
        promptMessageId: "prompt-stopped",
        order: 1,
        status: "aborted",
        stepCount: 0,
      });
    });
    const { edits, findings } = sixteen();
    const result = await save(f, {
      edits,
      items: completionReportItems(findings),
      toolCallId: "call-stopped",
      promptMessageId: "prompt-stopped",
    });
    expect(result).toMatchObject({ ok: false, stopped: true });
    const state = await rows(f);
    expect(state.proposals).toEqual([]);
    expect(state.items).toEqual([]);
  });
});

describe("applyProposal over a proposal that carries a Completion Report", () => {
  it("applies exactly as before and leaves every item row untouched", async () => {
    const f = await setup();
    const { edits, findings } = sixteen();
    const saved = await save(f, {
      edits,
      items: completionReportItems(findings),
      toolCallId: "call-bulk",
    });
    if (!saved.ok) throw new Error("setup proposal was refused");
    const before = await rows(f);

    const applied = await f.owner.mutation(api.chatV2.applyProposal, {
      proposalId: saved.proposalId,
    });
    expect(applied).toMatchObject({ applied: true, count: 14 });

    const after = await rows(f);
    // The proposal moved to applied; the 16 item rows did not move at all.
    expect(after.proposals[0]?.state).toBe("applied");
    expect(after.items).toEqual(before.items);

    const report = await f.t.run((ctx) => ctx.db.get(f.reportId));
    expect(report?.revisionNumber).toBe(1);
    expect(report?.content).toContain("s242 paragraph 1 revised s2421.");
    expect(report?.content).not.toContain("s242 paragraph 1 body s2421.");
    // AD-3: the pre-edit snapshot still lands, and provenance is cleared.
    const snapshots = await f.t.run((ctx) =>
      ctx.db
        .query("reportSnapshots")
        .withIndex("by_reportId", (q) => q.eq("reportId", f.reportId))
        .collect()
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ reason: "pre_chat_edit", content: REPORT_DOC });
    expect(report?.provenanceId).toBeUndefined();
  });
});

describe("saveProposal without items", () => {
  it("writes no item rows for every other proposal producer", async () => {
    const f = await setup();
    const result = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "cpi-thread",
      toolCallId: "call-single",
      kind: "edit",
      targetText: "s244 paragraph 1 body s2441.",
      newText: "s244 paragraph 1 revised s2441.",
    });
    expect(result).toMatchObject({ ok: true });
    const state = await rows(f);
    expect(state.proposals).toHaveLength(1);
    expect(state.items).toEqual([]);
  });
});
