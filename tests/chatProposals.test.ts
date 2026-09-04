/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";
import { sha256 } from "../convex/lib/contracts";

const modules = import.meta.glob("../convex/**/*.ts");
type Role = "writer" | "manager" | "admin";
const originalContent = JSON.stringify({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Replace the exact target." }] }],
});

async function createFixture(role: Role, authId = "reviewer") {
  const t = convexTest(schema, modules);
  const originalHash = await sha256(originalContent);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authId: "owner", role: "writer" });
    const userId = await ctx.db.insert("users", { authId, role });
    const projectId = await ctx.db.insert("projects", {
      title: "Proposal fixture", clientName: "Fixture client", status: "review",
      createdBy: ownerId, ownerId, shareToken: "fixture-share", createdAt: 1, updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: "Evidence", createdAt: 1 });
    const generationId = await ctx.db.insert("generations", { projectId, transcriptId, status: "completed", startedAt: 1 });
    const provenanceId = await ctx.db.insert("reportProvenance", {
      projectId, generationId, sourceTranscriptId: transcriptId,
      contentHash: originalHash, status: "approved", claims: [], createdAt: 1,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId, content: originalContent, contentHash: originalHash, revisionNumber: 7,
      provenanceId, generationId, sourceTranscriptId: transcriptId,
      version: 1, generatedAt: 10, updatedAt: 10,
    });
    const latestReportId = await ctx.db.insert("reports", {
      projectId, content: "LATEST REPORT MUST REMAIN UNCHANGED", contentHash: "latest-hash",
      revisionNumber: 2, version: 2, generatedAt: 20, updatedAt: 20,
    });
    await ctx.db.insert("agentChatThreads", {
      agentThreadId: "agent-thread", projectId, reportId, title: "Chat", createdAt: 1,
    });
    // Proposal tools execute while a turn is active, not after it completes.
    const turnId = await ctx.db.insert("chatTurns", {
      agentThreadId: "agent-thread", promptMessageId: "prompt-message", order: 0,
      status: "running", stepCount: 0,
    });
    const proposalId = await ctx.db.insert("chatProposals", {
      agentThreadId: "agent-thread", promptMessageId: "prompt-message", projectId, reportId,
      kind: "edit", targetText: "exact target", newText: "approved replacement",
      state: "pending", createdAt: 30,
    });
    return { userId, projectId, reportId, latestReportId, transcriptId, generationId, provenanceId, proposalId, turnId };
  });
  return { t, caller: t.withIdentity({ subject: authId }), originalHash, ...ids };
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function state(f: Fixture) {
  return f.t.run(async (ctx) => ({
    report: await ctx.db.get(f.reportId),
    latest: await ctx.db.get(f.latestReportId),
    proposal: await ctx.db.get(f.proposalId),
    proposals: await ctx.db.query("chatProposals").collect(),
    snapshots: await ctx.db.query("reportSnapshots").collect(),
    wordingEvents: await ctx.db.query("proposalWordingEditEvents").collect(),
  }));
}

async function applyAndAssert(role: Role = "manager", authId = "reviewer", ownsProject = false) {
  const f = await createFixture(role, authId);
  if (ownsProject) await f.t.run((ctx) => ctx.db.patch(f.projectId, { ownerId: f.userId }));
  const before = await state(f);
  const result = await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
  const after = await state(f);
  expect(result).toEqual({ applied: true, count: 1 });
  expect(after.report?.content).toContain("approved replacement");
  expect(after.report?.content).not.toContain("exact target");
  expect(after.report?.revisionNumber).toBe(8);
  expect(after.report?.contentHash).toBe(await sha256(after.report?.content ?? ""));
  expect(after.report?.provenanceId).toBeUndefined();
  expect(after.latest?.content).toBe("LATEST REPORT MUST REMAIN UNCHANGED");
  expect(after.latest?.revisionNumber).toBe(2);
  expect(after.latest).toEqual(before.latest);
  expect(after.proposal?.state).toBe("applied");
  expect(after.snapshots).toHaveLength(1);
  expect(after.snapshots[0]).toMatchObject({
    projectId: f.projectId, reportId: f.reportId, content: originalContent,
    contentHash: f.originalHash, provenanceId: f.provenanceId, generationId: f.generationId,
    sourceTranscriptId: f.transcriptId, sourceTranscriptIds: [f.transcriptId],
    sourceRevisionNumber: 7, reason: "pre_chat_edit", label: "Before AI edit", createdByRole: "system",
  });
}

describe("proposal access", () => {
  test.each(["manager", "admin"] as const)("allows an internal %s to query proposals", async (role) => {
    const f = await createFixture(role);
    await expect(f.caller.query(api.chatV2.listProposals, { threadId: "agent-thread" })).resolves.toHaveLength(1);
  });
  test("allows an unrelated authenticated writer to query proposals", async () => {
    const f = await createFixture("writer", "unrelated-writer");
    await expect(f.caller.query(api.chatV2.listProposals, { threadId: "agent-thread" })).resolves.toHaveLength(1);
  });
  test("rejects an anonymous proposal reader", async () => {
    const f = await createFixture("writer");
    await expect(f.t.query(api.chatV2.listProposals, { threadId: "agent-thread" }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
  });
});

describe("proposal creation integrity", () => {
  test("rejects a target copied from an unapplied candidate", async () => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.proposalId, {
      newText: "This wording existed only in a rejected suggestion.", state: "rejected",
    }));
    const before = await state(f);
    const result = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "agent-thread", toolCallId: "tool-invalid", kind: "edit",
      targetText: "This wording existed only in a rejected suggestion.",
      newText: "A refined version of rejected wording.",
    });
    expect(result).toMatchObject({ ok: false });
    expect(await state(f)).toEqual(before);
  });
  test("stores tool association and enforces uniqueness for a valid edit", async () => {
    const f = await createFixture("manager");
    const before = await state(f);
    const result = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "agent-thread", toolCallId: "tool-valid", promptMessageId: "prompt-message",
      kind: "edit", targetText: "exact target", newText: "approved replacement",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected successful proposal save");
    const after = await state(f);
    expect(after.proposals).toHaveLength(2);
    expect(after.proposals.find((row) => row.toolCallId === "tool-valid")).toMatchObject({
      _id: result.proposalId, projectId: f.projectId, reportId: f.reportId,
      targetText: "exact target", newText: "approved replacement",
      toolCallId: "tool-valid", promptMessageId: "prompt-message", requireUniqueTarget: true, state: "pending",
    });
    expect(after.report).toEqual(before.report);
    expect(after.latest).toEqual(before.latest);
    expect(after.snapshots).toEqual(before.snapshots);
  });
  test.each(["completed", "aborted"] as const)("refuses proposal creation after a turn becomes %s", async (status) => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.turnId, { status }));
    const before = await state(f);
    const result = await f.t.mutation(internal.chatV2.saveProposal, {
      agentThreadId: "agent-thread", toolCallId: "tool-stopped", promptMessageId: "prompt-message",
      kind: "edit", targetText: "exact target", newText: "approved replacement",
    });
    expect(result).toMatchObject({ ok: false, stopped: true });
    expect(await state(f)).toEqual(before);
  });
  test("deduplicates repeated tool execution", async () => {
    const f = await createFixture("manager");
    const args = { agentThreadId: "agent-thread", toolCallId: "tool-repeat", kind: "edit" as const,
      targetText: "exact target", newText: "approved replacement" };
    const first = await f.t.mutation(internal.chatV2.saveProposal, args);
    const second = await f.t.mutation(internal.chatV2.saveProposal, args);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect((await state(f)).proposals.filter((row) => row.toolCallId === "tool-repeat")).toHaveLength(1);
  });
});

describe("proposal wording edits", () => {
  test("updates candidate wording without changing the canonical target", async () => {
    const f = await createFixture("manager");
    await expect(f.caller.mutation(api.chatV2.updateProposalWording, {
      proposalId: f.proposalId, newText: "writer-polished replacement",
    })).resolves.toEqual({ updated: true });
    const after = await state(f);
    expect(after.proposal?.targetText).toBe("exact target");
    expect(after.proposal?.newText).toBe("writer-polished replacement");
    expect(after.wordingEvents).toHaveLength(1);
    expect(after.wordingEvents[0]).toMatchObject({ proposalId: f.proposalId,
      originalText: "approved replacement", editedText: "writer-polished replacement" });
    expect(after.report?.content).toBe(originalContent);
  });
  test("refuses to change replacement targets", async () => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.proposalId, { kind: "replacements", targetText: undefined,
      newText: undefined, replacements: [{ find: "exact target", replaceWith: "approved replacement" }] }));
    const before = await state(f);
    await expect(f.caller.mutation(api.chatV2.updateProposalWording, {
      proposalId: f.proposalId, replacements: [{ find: "different target", replaceWith: "writer wording" }],
    })).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    expect(await state(f)).toEqual(before);
  });
});

describe("proposal apply integrity", () => {
  test("apply updates the pinned report and complete audit tuple", async () => { await applyAndAssert(); });
  test("a researched V2 edit keeps its evidence session on the version checkpoint", async () => {
    const f = await createFixture("manager");
    const researchSessionId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("researchSessions", {
        projectId: f.projectId, reportId: f.reportId, requestedBy: f.userId,
        selectedText: "exact target", selectionFrom: 0, selectionTo: 12, surroundingContext: "",
        instruction: "Research", externalBrief: "Research", reportRevisionNumber: 7,
        status: "completed", evidenceSourceCount: 2, createdAt: 1, updatedAt: 1,
      });
      await ctx.db.patch(f.proposalId, { researchSessionId: id });
      return id;
    });
    await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    expect((await state(f)).snapshots[0]).toMatchObject({
      label: "Before researched edit", researchSessionId, researchSourceCount: 2,
    });
  });
  test.each([
    ["requireUniqueTarget flag", "separate paragraphs"],
    ["legacy researchSessionId fallback", "separate paragraphs"],
    ["requireUniqueTarget flag", "same paragraph"],
    ["legacy researchSessionId fallback", "same paragraph"],
  ] as const)(
    "a single-target proposal (%s, %s) never replaces an ambiguous repeated passage", async (mode, layout) => {
      const f = await createFixture("manager");
      await f.t.run(async (ctx) => {
        if (mode === "requireUniqueTarget flag") await ctx.db.patch(f.proposalId, { requireUniqueTarget: true });
        else {
          const id = await ctx.db.insert("researchSessions", {
            projectId: f.projectId, reportId: f.reportId, requestedBy: f.userId,
            selectedText: "exact target", selectionFrom: 0, selectionTo: 12, surroundingContext: "",
            instruction: "Research", externalBrief: "Research", reportRevisionNumber: 7,
            status: "completed", createdAt: 1, updatedAt: 1,
          });
          await ctx.db.patch(f.proposalId, { researchSessionId: id });
        }
        await ctx.db.patch(f.reportId, { content: JSON.stringify({ type: "doc", content: layout === "separate paragraphs" ? [
          { type: "paragraph", content: [{ type: "text", text: "Replace the exact target." }] },
          { type: "paragraph", content: [{ type: "text", text: "A second exact target appears here." }] },
        ] : [
          { type: "paragraph", content: [{ type: "text", text: "exact target and a second exact target" }] },
        ] }) });
      });
      const before = await state(f);
      await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
        .rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
      expect(await state(f)).toEqual(before);
      expect(before.report?.content).toContain("exact target");
      expect(before.snapshots).toEqual([]);
      expect(before.proposal?.state).toBe("pending");
    });
  test("a missing target becomes stale and cannot be retried", async () => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.proposalId, { targetText: "wording that is absent" }));
    const result = await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    expect(result).toMatchObject({ applied: false, count: 0 });
    const after = await state(f);
    expect(after.proposal?.state).toBe("stale");
    expect(after.snapshots).toEqual([]);
    expect(after.report?.content).toBe(originalContent);
    await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });
  test("applying an already-applied proposal is idempotent", async () => {
    const f = await createFixture("manager");
    await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    const after = await state(f);
    const retry = await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    expect(retry).toMatchObject({ applied: true, alreadyApplied: true, count: 0 });
    expect(await state(f)).toEqual(after);
  });
  test("apply preserves deletion-only replacement behavior", async () => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.proposalId, { newText: "" }));
    const result = await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    expect(result.count).toBe(1);
    const after = await state(f);
    expect(after.report?.content).not.toContain("exact target");
    expect(after.report?.revisionNumber).toBe(8);
  });
  test("apply preserves ordered replacement-list behavior", async () => {
    const f = await createFixture("manager");
    await f.t.run((ctx) => ctx.db.patch(f.proposalId, { kind: "replacements", replacements: [
      { find: "Replace the", replaceWith: "update this" },
      { find: "exact target", replaceWith: "approved replacement" },
    ] }));
    const result = await f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId });
    expect(result.count).toBe(2);
    const after = await state(f);
    expect(after.report?.content).toContain("Update this approved replacement.");
    expect(after.report?.revisionNumber).toBe(8);
  });
  test("apply denies an unrelated authenticated writer without changing proposal or audit state", async () => {
    const f = await createFixture("writer", "unrelated-writer");
    const before = await state(f);
    await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(await state(f)).toEqual(before);
  });
  test("apply allows the writer who owns the project and preserves revision audit integrity", async () => {
    await applyAndAssert("writer", "project-owner", true);
  });
  test("an anonymous caller cannot apply a proposal", async () => {
    const f = await createFixture("writer");
    const before = await state(f);
    await expect(f.t.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(await state(f)).toEqual(before);
    expect(before.report?.content).toBe(originalContent);
    expect(before.report?.contentHash).toBe(f.originalHash);
    expect(before.report?.revisionNumber).toBe(7);
    expect(before.snapshots).toEqual([]);
  });
});

describe("proposal rejection", () => {
  test("an internal manager can reject a proposal", async () => {
    const f = await createFixture("manager");
    await f.caller.mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId });
    expect((await state(f)).proposal?.state).toBe("rejected");
  });
  test("an unrelated authenticated writer can reject a proposal", async () => {
    const f = await createFixture("writer", "unrelated-writer");
    await f.caller.mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId });
    expect((await state(f)).proposal?.state).toBe("rejected");
  });
  test("an anonymous caller cannot reject a proposal", async () => {
    const f = await createFixture("writer");
    await expect(f.t.mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect((await state(f)).proposal?.state).toBe("pending");
  });
});
