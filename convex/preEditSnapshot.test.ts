/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "pre-edit-owner";

/**
 * End-to-end fences for the pre-edit checkpoint written by
 * `lib/snapshots.writePreEditSnapshot` on the `api.chatV2.applyProposal` path.
 * The direct-writer cases live in `snapshots.test.ts`; these pin the wiring —
 * that the mutation passes the reason, the threaded timestamp, and (only on a
 * researched proposal) the session id and its label.
 */

const PARAGRAPH = "The team tested the alloy at low temperature.";
const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: PARAGRAPH }],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      firstName: "Owen",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "pre-edit-token",
      createdAt: now,
      updatedAt: now,
    });

    async function report() {
      return await ctx.db.insert("reports", {
        projectId,
        content: REPORT_DOC,
        version: 1,
        generatedAt: now,
        updatedAt: now,
        revisionNumber: 0,
      });
    }
    async function proposal(
      reportId: Id<"reports">,
      researchSessionId?: Id<"researchSessions">
    ) {
      return await ctx.db.insert("chatProposals", {
        agentThreadId: "pre-edit-thread",
        projectId,
        reportId,
        kind: "edit",
        targetText: "tested the alloy",
        newText: "measured the alloy",
        state: "pending",
        createdAt: now,
        ...(researchSessionId ? { researchSessionId } : {}),
      });
    }

    // Separate reports so each apply leaves exactly one snapshot to inspect.
    const plainReportId = await report();
    const plainProposalId = await proposal(plainReportId);

    const researchedReportId = await report();
    const researchSessionId = await ctx.db.insert("researchSessions", {
      projectId,
      reportId: researchedReportId,
      requestedBy: ownerId,
      selectedText: "tested the alloy",
      selectionFrom: 0,
      selectionTo: 16,
      surroundingContext: "The team tested the alloy at low temperature.",
      instruction: "Back this with sources",
      externalBrief: "Redacted brief",
      reportRevisionNumber: 0,
      status: "completed",
      evidenceSourceCount: 4,
      createdAt: now,
      updatedAt: now,
    });
    const researchedProposalId = await proposal(
      researchedReportId,
      researchSessionId
    );

    // The stepped (`markProposalApplied`) path and the client-suggestion
    // (`acceptEdit`) path each get their own report as well.
    const steppedReportId = await report();
    const steppedProposalId = await proposal(steppedReportId);

    const clientReportId = await report();
    const commenterId = await ctx.db.insert("commenters", {
      projectId,
      name: "Casey Client",
      color: "#818CF8",
      createdAt: now,
    });
    const highlightFrom = PARAGRAPH.indexOf("tested the alloy");
    const clientCommentId = await ctx.db.insert("comments", {
      projectId,
      reportId: clientReportId,
      commenterId,
      commenterType: "client",
      highlightFrom,
      highlightTo: highlightFrom + "tested the alloy".length,
      highlightText: "tested the alloy",
      body: "We measured rather than tested here.",
      suggestedEdit: "measured the alloy",
      resolved: false,
      createdAt: now,
    });

    return {
      projectId,
      plainReportId,
      plainProposalId,
      researchedReportId,
      researchedProposalId,
      researchSessionId,
      steppedReportId,
      steppedProposalId,
      clientReportId,
      clientCommentId,
    };
  });

  return { t: t.withIdentity({ subject: AUTH_ID }), raw: t, ...ids };
}

/** The snapshot rows for one report, newest last. */
async function snapshotsFor(
  raw: Awaited<ReturnType<typeof setup>>["raw"],
  reportId: Id<"reports">
) {
  return await raw.run((ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
      .collect()
  );
}

describe("applyProposal writes the pre-edit checkpoint", () => {
  it("checkpoints a plain proposal with no research trail", async () => {
    const { t, raw, plainReportId, plainProposalId } = await setup();

    const result = await t.mutation(api.chatV2.applyProposal, {
      proposalId: plainProposalId,
    });
    expect(result).toMatchObject({ applied: true, count: 1 });

    const snapshots = await snapshotsFor(raw, plainReportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "pre_chat_edit",
      label: "Before AI edit",
      createdByRole: "system",
      content: REPORT_DOC,
      sourceRevisionNumber: 0,
      contentHash: await sha256(REPORT_DOC),
    });
    expect(snapshots[0].researchSessionId).toBeUndefined();
    expect(snapshots[0].researchSourceCount).toBeUndefined();

    // The checkpoint and the report patch share one timestamp, so version
    // history and the report agree on when the edit landed.
    const report = await raw.run((ctx) => ctx.db.get(plainReportId));
    expect(report?.revisionNumber).toBe(1);
    expect(report?.content).toContain("measured the alloy");
    expect(snapshots[0].createdAt).toBe(report?.updatedAt);
  });

  it("carries the session id, label and source count of a researched proposal", async () => {
    const { t, raw, researchedReportId, researchedProposalId, researchSessionId } =
      await setup();

    const result = await t.mutation(api.chatV2.applyProposal, {
      proposalId: researchedProposalId,
    });
    expect(result).toMatchObject({ applied: true, count: 1 });

    const snapshots = await snapshotsFor(raw, researchedReportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "pre_chat_edit",
      label: "Before researched edit",
      createdByRole: "system",
      content: REPORT_DOC,
      sourceRevisionNumber: 0,
      contentHash: await sha256(REPORT_DOC),
      researchSessionId,
      researchSourceCount: 4,
    });

    const report = await raw.run((ctx) => ctx.db.get(researchedReportId));
    expect(snapshots[0].createdAt).toBe(report?.updatedAt);
  });
});

describe("the other two pre-edit sites share the checkpoint's clock", () => {
  // `chatProposals.test.ts` and `comments.test.ts` fence the stored row on
  // these paths but never read `createdAt`, so a caller that reached for its
  // own `Date.now()` instead of the patch's `now` would slip through there.
  it("markProposalApplied stamps the checkpoint with the report's updatedAt", async () => {
    const { t, raw, steppedReportId, steppedProposalId } = await setup();

    const steppedDoc = REPORT_DOC.replace("tested the alloy", "measured the alloy");
    const result = await t.mutation(api.chatV2.markProposalApplied, {
      proposalId: steppedProposalId,
      content: steppedDoc,
      expectedRevisionNumber: 0,
    });
    expect(result).toMatchObject({ applied: true, revisionNumber: 1 });

    const snapshots = await snapshotsFor(raw, steppedReportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "pre_chat_edit",
      label: "Before AI edit",
      content: REPORT_DOC,
    });
    const report = await raw.run((ctx) => ctx.db.get(steppedReportId));
    expect(report?.content).toBe(steppedDoc);
    expect(snapshots[0].createdAt).toBe(report?.updatedAt);
  });

  it("acceptEdit stamps the checkpoint with the report's updatedAt", async () => {
    const { t, raw, clientReportId, clientCommentId } = await setup();

    await t.mutation(api.comments.acceptEdit, { commentId: clientCommentId });

    const snapshots = await snapshotsFor(raw, clientReportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "pre_client_edit",
      label: "Before client edit",
      content: REPORT_DOC,
    });
    const report = await raw.run((ctx) => ctx.db.get(clientReportId));
    expect(report?.content).toContain("measured the alloy");
    expect(snapshots[0].createdAt).toBe(report?.updatedAt);
  });
});
