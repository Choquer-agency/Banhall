/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
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
    return { ownerId, userId, projectId, reportId, latestReportId, transcriptId, generationId, provenanceId, proposalId, turnId };
  });
  return { t, caller: t.withIdentity({ subject: authId }), originalHash, ...ids };
}
type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function state(f: Fixture) {
  return f.t.run(async (ctx) => ({
    project: await ctx.db.get(f.projectId),
    workItems: await ctx.db.query("workItems").collect(),
    report: await ctx.db.get(f.reportId),
    latest: await ctx.db.get(f.latestReportId),
    proposal: await ctx.db.get(f.proposalId),
    proposals: await ctx.db.query("chatProposals").collect(),
    snapshots: await ctx.db.query("reportSnapshots").collect(),
    wordingEvents: await ctx.db.query("proposalWordingEditEvents").collect(),
  }));
}

async function assignRevision(f: Fixture) {
  return f.t.run((ctx) => ctx.db.insert("workItems", {
    projectId: f.projectId, kind: "revision", assigneeId: f.userId, assignerId: f.ownerId,
    instructions: "Revise the report", blocking: false, status: "open", version: 1,
    createRequestId: "revision-request", createRequestFingerprint: "revision-fingerprint",
    createdAt: 1, updatedAt: 1,
  }));
}

async function applyAndAssertFixture(f: Fixture) {
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

async function applyAndAssert(role: Role = "manager", authId = "reviewer", ownsProject = false) {
  const f = await createFixture(role, authId);
  if (ownsProject) await f.t.run((ctx) => ctx.db.patch(f.projectId, { ownerId: f.userId }));
  await applyAndAssertFixture(f);
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
  test("a queued sendMessage turn saves its association and rejects absent targets without writes", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "fixture-only-no-provider-execution");
    try {
      const f = await createFixture("manager", "queued-manager");
      agentTest.register(f.t);
      const sent = await f.caller.mutation(api.chatV2.sendMessage, {
        reportId: f.reportId, content: "Help revise this report.", newThread: true,
      });
      const queuedState = () => f.t.run(async (ctx) => ({
        threads: await ctx.db.query("agentChatThreads").collect(),
        turns: await ctx.db.query("chatTurns").collect(),
      }));
      const queued = await queuedState();
      expect(queued.threads.filter((row) => row.agentThreadId === sent.threadId)).toHaveLength(1);
      expect(queued.turns.filter((row) => row.promptMessageId === sent.messageId)).toHaveLength(1);
      expect(queued.threads.find((row) => row.agentThreadId === sent.threadId)).toMatchObject({
        projectId: f.projectId, reportId: f.reportId,
      });
      expect(queued.turns.find((row) => row.promptMessageId === sent.messageId)).toMatchObject({
        agentThreadId: sent.threadId, userId: f.userId, status: "queued", stepCount: 0,
      });
      const before = await state(f);
      const args = {
        agentThreadId: sent.threadId, promptMessageId: sent.messageId,
        toolCallId: "queued-tool", kind: "edit" as const,
        targetText: "exact target", newText: "queued replacement",
      };
      expect(await f.t.mutation(internal.chatV2.saveProposal, {
        ...args, targetText: "wording absent from the current report",
      })).toMatchObject({ ok: false, reason: expect.stringContaining("not in the CURRENT REPORT") });
      expect(await state(f)).toEqual(before);
      expect(await queuedState()).toEqual(queued);
      const first = await f.t.mutation(internal.chatV2.saveProposal, args);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("Expected successful queued proposal save");
      const saved = await state(f);
      const rows = saved.proposals.filter((row) => row.agentThreadId === sent.threadId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        _id: first.proposalId, ...args, projectId: f.projectId, reportId: f.reportId,
        requireUniqueTarget: true, state: "pending",
      });
      expect(saved.report).toEqual(before.report);
      expect(saved.latest).toEqual(before.latest);
      expect(saved.snapshots).toEqual(before.snapshots);
      expect(saved.project).toEqual(before.project);
      expect(saved.workItems).toEqual(before.workItems);
      expect(saved.wordingEvents).toEqual(before.wordingEvents);
      expect(await f.t.mutation(internal.chatV2.saveProposal, args)).toEqual(first);
      expect(await f.t.mutation(internal.chatV2.saveProposal, {
        ...args, newText: "different queued retry wording",
      })).toEqual(first);
      expect(await state(f)).toEqual(saved);
      expect(await queuedState()).toEqual(queued);
    } finally {
      // Discard scheduled provider work without advancing or flushing it.
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
  test("deduplicates repeated tool execution", async () => {
    const f = await createFixture("manager");
    const args = { agentThreadId: "agent-thread", toolCallId: "tool-repeat", kind: "edit" as const,
      targetText: "exact target", newText: "approved replacement" };
    const first = await f.t.mutation(internal.chatV2.saveProposal, args);
    const second = await f.t.mutation(internal.chatV2.saveProposal, args);
    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    const saved = await state(f);
    expect(await f.t.mutation(internal.chatV2.saveProposal, {
      ...args, newText: "different retry wording",
    })).toEqual(first);
    expect(await state(f)).toEqual(saved);
    const rows = saved.proposals.filter((row) => row.toolCallId === "tool-repeat");
    expect(rows).toHaveLength(1);
    if (!first.ok) throw new Error("Expected successful proposal save");
    expect(rows[0]).toMatchObject({ _id: first.proposalId, newText: args.newText });
  });
});

describe("proposal wording edits", () => {
  test("updates candidate wording without changing the canonical target", async () => {
    const f = await createFixture("manager");
    const before = await state(f);
    await expect(f.caller.mutation(api.chatV2.updateProposalWording, {
      proposalId: f.proposalId, newText: "writer-polished replacement",
    })).resolves.toEqual({ updated: true });
    const after = await state(f);
    expect(after.proposal?.targetText).toBe("exact target");
    expect(after.proposal?.newText).toBe("writer-polished replacement");
    expect(after.proposal?.wordingEditedBy).toBe(f.userId);
    expect(after.proposal?.wordingEditCount).toBe(1);
    expect(after.wordingEvents).toHaveLength(1);
    expect(after.wordingEvents[0]).toMatchObject({ proposalId: f.proposalId,
      projectId: f.projectId, reportId: f.reportId, userId: f.userId,
      originalText: "approved replacement", editedText: "writer-polished replacement" });
    expect(after.report?.content).toBe(originalContent);
    expect(after.report).toEqual(before.report);
    expect(after.latest).toEqual(before.latest);
    expect(after.snapshots).toEqual(before.snapshots);
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
    expect(after.report?.content).toBe(JSON.stringify({
      type: "doc", content: [{ type: "paragraph", content: [
        { type: "text", text: "Update this approved replacement." },
      ] }],
    }));
    expect(after.report?.revisionNumber).toBe(8);
  });
  test("apply denies an unrelated authenticated writer without changing proposal or audit state", async () => {
    const f = await createFixture("writer", "unrelated-writer");
    const before = await state(f);
    await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(await state(f)).toEqual(before);
  });
  test("an open revision assignment lets a non-owner writer apply with the complete audit tuple", async () => {
    const f = await createFixture("writer", "assigned-writer");
    expect(f.userId).not.toBe(f.ownerId);
    const workItemId = await assignRevision(f);
    expect(await f.t.run((ctx) => ctx.db.get(workItemId))).toMatchObject({ status: "open", assigneeId: f.userId });
    await applyAndAssertFixture(f);
  });
  test("a completed revision assignment denies a fresh pending proposal without writes", async () => {
    const f = await createFixture("writer", "closed-assignee");
    const workItemId = await assignRevision(f);
    await f.t.run((ctx) => ctx.db.patch(workItemId, { status: "completed" }));
    const before = await state(f);
    expect(before.proposal?.state).toBe("pending");
    expect(before.workItems).toMatchObject([{ _id: workItemId, status: "completed" }]);
    await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    expect(await state(f)).toEqual(before);
  });
  test("creator attribution grants no prose entitlement without ownership or assignment", async () => {
    const f = await createFixture("writer", "creator-only");
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { createdBy: f.userId }));
    const before = await state(f);
    expect(before.project).toMatchObject({ createdBy: f.userId, ownerId: f.ownerId });
    expect(f.userId).not.toBe(f.ownerId);
    expect(before.workItems).toEqual([]);
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
  test("a manager cannot reject an applied proposal or change its audit state", async () => {
    const f = await createFixture("manager");
    await expect(f.caller.mutation(api.chatV2.applyProposal, { proposalId: f.proposalId }))
      .resolves.toEqual({ applied: true, count: 1 });
    const before = await state(f);
    expect(before.proposal?.state).toBe("applied");
    await expect(f.caller.mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    expect(await state(f)).toEqual(before);
  });
  test("an anonymous caller cannot reject a proposal", async () => {
    const f = await createFixture("writer");
    const before = await state(f);
    await expect(f.t.mutation(api.chatV2.rejectProposal, { proposalId: f.proposalId }))
      .rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    expect(await state(f)).toEqual(before);
    expect(before.proposal?.state).toBe("pending");
  });
});
