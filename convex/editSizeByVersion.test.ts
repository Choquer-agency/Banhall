/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { closeEditBurst, EDIT_SIZE_BURST_MS } from "./lib/editDistance";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * 2026-10-27 (Phase E, E3): edit size by version. Chat applies and editing
 * bursts record readings naming who edited; the Admin view averages one
 * reading per report per version. Every name and passage here is fictional.
 */

const doc = (...paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  });
const DRAFT = doc("The team ran a controlled trial.", "Results were inconclusive.");
const edited = (n: number) => doc("The team ran a controlled trial.", `Edit ${n} rewrote this whole closing line.`);

async function setup() {
  const t = convexTest({ schema, modules, transactionLimits: false });
  agentTest.register(t);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const ownerId = await ctx.db.insert("users", { authId: "size-owner", role: "writer", name: "Owen" });
    const managerId = await ctx.db.insert("users", { authId: "size-manager", role: "manager", name: "Mara" });
    await ctx.db.insert("users", { authId: "size-admin", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Coupon fatigue PD",
      clientName: "Quillfeather Metals",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "size-token",
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "completed",
      requestedBy: ownerId,
      candidateMode: "single",
      startedAt: now,
      completedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId,
      content: DRAFT,
      revisionNumber: 0,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("reportSnapshots", {
      projectId,
      reportId,
      generationId,
      content: DRAFT,
      sourceRevisionNumber: 0,
      reason: "generated",
      label: "AI draft (single)",
      createdByRole: "system",
      createdAt: now,
    });
    await ctx.db.insert("agentChatThreads", { projectId, reportId, agentThreadId: "size-thread", title: "Chat", createdAt: now });
    const digestId = await ctx.db.insert("learningDigests", {
      kind: "draft_style",
      content: "Prefer short sentences.",
      sourceCount: 4,
      feedbackCutoff: now,
      model: "test-model",
      createdAt: now,
    });
    await ctx.db.insert("chatTurns", {
      userId: ownerId,
      agentThreadId: "size-thread",
      promptMessageId: "size-prompt",
      order: 0,
      status: "completed",
      stepCount: 1,
      learningDigestId: digestId,
    });
    return { ownerId, managerId, projectId, generationId, reportId, digestId };
  });
  const owner = t.withIdentity({ subject: "size-owner" });
  const manager = t.withIdentity({ subject: "size-manager" });
  const revision = async () => (await t.run(async (ctx) => (await ctx.db.get(ids.reportId))!.revisionNumber ?? 0));
  const save = async (as: typeof owner, n: number) =>
    await as.mutation(api.reports.updateReportContent, {
      reportId: ids.reportId,
      content: edited(n),
      expectedRevisionNumber: await revision(),
    });
  const readings = () =>
    t.run((ctx) => ctx.db.query("reportEditDistance").withIndex("by_reportId", (q) => q.eq("reportId", ids.reportId)).collect());
  const due = () =>
    t.run((ctx) => ctx.db.query("reportEditSizeDue").withIndex("by_reportId", (q) => q.eq("reportId", ids.reportId)).collect());
  const burstJobs = () =>
    t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name.includes("recordEditBurst") && job.state.kind === "pending"
      )
    );
  const endBurst = async () => {
    vi.advanceTimersByTime(EDIT_SIZE_BURST_MS);
    await t.finishInProgressScheduledFunctions();
  };
  const propose = (find: string, replaceWith: string) =>
    t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "size-thread",
        promptMessageId: "size-prompt",
        projectId: ids.projectId,
        reportId: ids.reportId,
        kind: "edit" as const,
        targetText: find,
        newText: replaceWith,
        state: "pending" as const,
        createdAt: Date.now(),
      })
    );
  return { t, ...ids, owner, manager, admin: t.withIdentity({ subject: "size-admin" }), revision, save, readings, due, burstJobs, endBurst, propose };
}

describe("editing bursts (Phase E, E3)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("the first save opens a burst; later saves add no row or job; its end reads the latest revision once", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    await f.save(f.owner, 2);
    await f.save(f.owner, 3);
    expect(await f.due()).toHaveLength(1);
    expect(await f.burstJobs()).toHaveLength(1);
    expect(await f.readings()).toEqual([]);

    vi.advanceTimersByTime(EDIT_SIZE_BURST_MS - 1);
    await f.t.finishInProgressScheduledFunctions();
    expect(await f.readings()).toEqual([]);

    await f.endBurst();
    const rows = await f.readings();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trigger: "edit", revisionNumber: 3, editorUserId: f.ownerId, writerUserId: f.ownerId });
    expect(rows[0]!.ped).toBeGreaterThan(0);
    expect(await f.due()).toEqual([]);

    // A save after the burst ended opens a new one.
    await f.save(f.owner, 4);
    expect(await f.burstJobs()).toHaveLength(1);
    await f.endBurst();
    expect((await f.readings()).map((row) => [row.trigger, row.revisionNumber])).toEqual([
      ["edit", 3],
      ["edit", 4],
    ]);
  });

  it("names the burst's latest editor, while writerUserId stays the project owner", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    await f.save(f.manager, 2);
    await f.endBurst();
    expect(await f.readings()).toMatchObject([{ trigger: "edit", revisionNumber: 2, editorUserId: f.managerId, writerUserId: f.ownerId }]);
  });

  it("a chat apply first reads the person's open burst at their own revision, then records its own reading with who applied it and its turn's lesson set (re-check)", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    const card = await f.propose("rewrote this whole", "changed this");
    expect(await f.owner.mutation(api.chatV2.applyProposal, { proposalId: card })).toMatchObject({ applied: true });
    expect(await f.readings()).toMatchObject([
      { trigger: "edit", revisionNumber: 1, editorUserId: f.ownerId },
      { trigger: "chat_apply", revisionNumber: 2, editorUserId: f.ownerId, learningDigestId: f.digestId },
    ]);
    expect(await f.due()).toEqual([]);
    // The burst's job, when it fires, finds its burst closed and adds nothing.
    await f.endBurst();
    expect((await f.readings()).map((row) => row.trigger)).toEqual(["edit", "chat_apply"]);
  });

  it("a burst closed early never has its job cut the next burst short (re-check)", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    const card = await f.propose("rewrote this whole", "changed this");
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: card });
    // A new burst opens five minutes later; the first burst's job fires at ten.
    vi.advanceTimersByTime(EDIT_SIZE_BURST_MS / 2);
    await f.save(f.owner, 3);
    vi.advanceTimersByTime(EDIT_SIZE_BURST_MS / 2);
    await f.t.finishInProgressScheduledFunctions();
    expect(await f.due()).toHaveLength(1);
    expect((await f.readings()).map((row) => row.trigger)).toEqual(["edit", "chat_apply"]);
    // Its own job reads it at its end.
    vi.advanceTimersByTime(EDIT_SIZE_BURST_MS / 2);
    await f.t.finishInProgressScheduledFunctions();
    expect((await f.readings()).map((row) => [row.trigger, row.revisionNumber])).toEqual([
      ["edit", 1],
      ["chat_apply", 2],
      ["edit", 3],
    ]);
  });

  it("an Undo, a restore and an accepted client edit each take part in a burst", async () => {
    const f = await setup();
    const card = await f.propose("inconclusive", "clear");
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: card });
    await f.owner.mutation(api.chatV2.undoProposal, { proposalId: card });
    expect(await f.due()).toMatchObject([{ editorUserId: f.ownerId }]);
    await f.endBurst();
    expect((await f.readings()).map((row) => [row.trigger, row.revisionNumber])).toEqual([
      ["chat_apply", 1],
      ["edit", 2],
    ]);

    const snapshotId = await f.t.run(async (ctx) =>
      (await ctx.db.query("reportSnapshots").withIndex("by_reportId", (q) => q.eq("reportId", f.reportId)).collect()).find(
        (row) => row.reason === "pre_chat_edit"
      )!._id
    );
    await f.manager.mutation(api.snapshots.restoreSnapshot, {
      snapshotId,
      targetReportId: f.reportId,
      expectedRevisionNumber: await f.revision(),
    });
    expect(await f.due()).toMatchObject([{ editorUserId: f.managerId }]);
    await f.endBurst();

    const commentId = await f.t.run((ctx) =>
      ctx.db.insert("comments", {
        projectId: f.projectId,
        reportId: f.reportId,
        commenterId: "client-1",
        commenterType: "client",
        highlightFrom: 48,
        highlightTo: 60,
        highlightText: "inconclusive",
        body: "Say what the result was.",
        suggestedEdit: "mixed",
        resolved: false,
        createdAt: Date.now(),
      })
    );
    await f.owner.mutation(api.comments.acceptEdit, { commentId });
    expect(await f.due()).toMatchObject([{ editorUserId: f.ownerId }]);
    await f.endBurst();
    expect((await f.readings()).map((row) => [row.trigger, row.revisionNumber, row.editorUserId])).toEqual([
      ["chat_apply", 1, f.ownerId],
      ["edit", 2, f.ownerId],
      ["edit", 3, f.managerId],
      ["edit", 4, f.ownerId],
    ]);
  });

  it("an AI redraft first closes a person's open burst at the person's own revision (review)", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    // The redraft's write path closes the burst before the AI's text lands.
    await f.t.run(async (ctx) => {
      const report = (await ctx.db.get(f.reportId))!;
      await closeEditBurst(ctx, report);
      await ctx.db.patch(f.reportId, { content: doc("AI redrafted every Section here."), revisionNumber: (report.revisionNumber ?? 0) + 1 });
    });
    expect(await f.due()).toEqual([]);
    await f.endBurst();
    expect((await f.readings()).map((row) => [row.trigger, row.revisionNumber, row.editorUserId])).toEqual([["edit", 1, f.ownerId]]);
    // With no burst open, closing records nothing.
    await f.t.run(async (ctx) => closeEditBurst(ctx, (await ctx.db.get(f.reportId))!));
    expect(await f.readings()).toHaveLength(1);
  });

  it("a one-by-one apply records its reading too, and a card from no chat turn carries no lesson set (review)", async () => {
    const f = await setup();
    const card = await f.propose("inconclusive", "clear");
    await f.owner.mutation(api.chatV2.markProposalApplied, {
      proposalId: card,
      content: doc("The team ran a controlled trial.", "Results were clear."),
      expectedRevisionNumber: 0,
    });
    expect(await f.readings()).toMatchObject([{ trigger: "chat_apply", revisionNumber: 1, editorUserId: f.ownerId, learningDigestId: f.digestId }]);
    const loose = await f.t.run((ctx) =>
      ctx.db.insert("chatProposals", {
        agentThreadId: "size-thread", projectId: f.projectId, reportId: f.reportId, kind: "edit" as const,
        targetText: "clear", newText: "plain", state: "pending" as const, createdAt: Date.now(),
      })
    );
    await f.owner.mutation(api.chatV2.applyProposal, { proposalId: loose });
    const [, second] = await f.readings();
    expect(second).toMatchObject({ trigger: "chat_apply", revisionNumber: 2 });
    expect(second!.learningDigestId).toBeUndefined();
  });

  it("records nothing for a project being erased, and clears the burst", async () => {
    const f = await setup();
    await f.save(f.owner, 1);
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: Date.now() }));
    await f.endBurst();
    expect(await f.readings()).toEqual([]);
    expect(await f.due()).toEqual([]);
  });

  it("a burst with no reading left to take (its row already gone) does nothing", async () => {
    const f = await setup();
    await f.t.mutation(internal.reportEditDistance.recordEditBurst, { reportId: f.reportId });
    expect(await f.readings()).toEqual([]);
  });
});

describe("edit size by version (Phase E, E3)", () => {
  const DAY = 86_400_000;

  async function seedVersions() {
    const f = await setup();
    const end = Date.now() + DAY;
    const seeded = await f.t.run(async (ctx) => {
      const lessonA = await ctx.db.insert("learningDigests", {
        kind: "draft_style",
        content: "Lead with the uncertainty.",
        sourceCount: 3,
        feedbackCutoff: 1,
        model: "m",
        createdAt: 1_000,
      });
      const writerSettings = (count: number) => ({
        profileState: "missing" as const,
        source: "none" as const,
        matchesProfile: false,
        savedProfileSuperseded: false,
        truncated: false,
        waiverAnalysis: "none" as const,
        ...(count ? { savedPreferences: { count, textHash: "h" } } : {}),
      });
      const generation = (promptVersion: string, learningDigestIds: Id<"learningDigests">[], saved: number) =>
        ctx.db.insert("generations", {
          projectId: f.projectId,
          status: "completed",
          startedAt: 1,
          promptVersion,
          learningDigestIds,
          writerSettings: writerSettings(saved),
        });
      const v1 = await generation("v1", [], 0);
      const v2 = await generation("v2", [lessonA], 2);
      const report = (generationId: Id<"generations">) =>
        ctx.db.insert("reports", { projectId: f.projectId, generationId, content: DRAFT, version: 1, generatedAt: 1, updatedAt: 1 });
      const r1 = await report(v1);
      const r2 = await report(v1);
      const r3 = await report(v2);
      const reading = (
        reportId: Id<"reports">,
        generationId: Id<"generations">,
        ped: number,
        computedAt: number,
        extra: { trigger?: "edit" | "chat_apply" | "milestone"; learningDigestId?: Id<"learningDigests"> } = {}
      ) =>
        ctx.db.insert("reportEditDistance", {
          reportId,
          projectId: f.projectId,
          generationId,
          revisionNumber: 1,
          ped,
          computedAt,
          trigger: extra.trigger ?? "edit",
          ...(extra.learningDigestId ? { learningDigestId: extra.learningDigestId } : {}),
        });
      const now = end - DAY;
      // r1: two readings, the latest (0.2) counts. r2: one reading (0.4).
      await reading(r1, v1, 0.9, now - 3 * DAY);
      await reading(r1, v1, 0.2, now - 2 * DAY);
      await reading(r2, v1, 0.4, now - 2 * DAY);
      // r3: a chat apply under lesson A, then an edit; the edit is latest.
      await reading(r3, v2, 0.5, now - 2 * DAY, { trigger: "chat_apply", learningDigestId: lessonA });
      await reading(r3, v2, 0.1, now - DAY);
      // A chat apply with no lesson set, and a reading outside the window.
      await reading(r2, v1, 0.3, now - 3 * DAY, { trigger: "chat_apply" });
      await reading(r1, v1, 0.99, end - 100 * DAY);
      return { lessonA };
    });
    return { ...f, ...seeded, end, start: end - 90 * DAY };
  }

  it("averages one reading per report per version, the latest, with counts", async () => {
    const f = await seedVersions();
    const view = await f.admin.query(api.learningHealth.getEditSizeByVersion, { start: f.start, end: f.end });
    expect(view.partial).toBe(false);
    expect(view.readings).toBe(6);
    const v1 = view.byVersion.find((row) => row.promptVersion === "v1")!;
    expect(v1).toMatchObject({ lessonSets: [], savedPreferencesUsed: false, known: true, reports: 2, readings: 4 });
    expect(v1.mean).toBeCloseTo((0.2 + 0.4) / 2);
    const v2 = view.byVersion.find((row) => row.promptVersion === "v2")!;
    expect(v2).toMatchObject({ savedPreferencesUsed: true, reports: 1, readings: 2 });
    expect(v2.lessonSets).toEqual([{ id: f.lessonA, kind: "draft_style", createdAt: 1_000 }]);
    expect(v2.mean).toBeCloseTo(0.1);
    // The setup's own report has no reading in the window.
    expect(view.byVersion).toHaveLength(2);
  });

  it("groups chat applies by the lesson set their chat turn used", async () => {
    const f = await seedVersions();
    const view = await f.admin.query(api.learningHealth.getEditSizeByVersion, { start: f.start, end: f.end });
    expect(view.byChatLessonSet).toHaveLength(2);
    expect(view.byChatLessonSet.find((row) => row.lessonSet?.id === f.lessonA)).toMatchObject({ mean: 0.5, reports: 1, readings: 1 });
    expect(view.byChatLessonSet.find((row) => row.lessonSet === null)).toMatchObject({ mean: 0.3, reports: 1, readings: 1 });
  });

  it("keeps Learning health's chart to the three milestone readings (review)", async () => {
    const f = await seedVersions();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("reportEditDistance", {
        reportId: f.reportId, projectId: f.projectId, revisionNumber: 1, ped: 0.6, computedAt: f.end - DAY, trigger: "milestone",
      });
    });
    const health = await f.admin.query(api.learningHealth.getHealth, { start: f.end - 30 * DAY, end: f.end });
    // Only the milestone reading; the edit and chat apply readings are left out.
    expect(health.ped.samples).toBe(1);
    expect(health.ped.mean).toBeCloseTo(0.6);
  });

  it("leaves evaluation projects' drafts out of the Brain source table (re-check)", async () => {
    const f = await seedVersions();
    await f.t.run(async (ctx) => {
      const evaluation = await ctx.db.insert("projects", {
        title: "Release eval - Seals", clientName: "Q", status: "draft", createdBy: f.ownerId, shareToken: "eval-src",
        createdAt: 1, updatedAt: 1, evaluation: { markedAt: 1 },
      });
      for (const projectId of [f.projectId, evaluation]) {
        await ctx.db.insert("generations", {
          projectId, status: "completed", startedAt: f.end - DAY, brainProvenance: [{ entryId: `entry-${projectId}`, score: 1 }],
        });
      }
    });
    const health = await f.admin.query(api.learningHealth.getHealth, { start: f.end - 30 * DAY, end: f.end });
    expect(health.sources.rows.map((row) => row.identity)).toEqual([`entry:entry-${f.projectId}`]);
  });

  it("gives partial results within the read budget when drafts are large (review)", async () => {
    const f = await seedVersions();
    await f.t.run(async (ctx) => {
      const big = "x".repeat(900_000);
      for (let index = 0; index < 12; index += 1) {
        const generationId = await ctx.db.insert("generations", { projectId: f.projectId, status: "completed", startedAt: 1, agentOutputs: big });
        await ctx.db.insert("reportEditDistance", {
          reportId: f.reportId, projectId: f.projectId, generationId, revisionNumber: 1, ped: 0.5, computedAt: f.end - DAY - index, trigger: "edit",
        });
      }
    });
    const view = await f.admin.query(api.learningHealth.getEditSizeByVersion, { start: f.start, end: f.end });
    expect(view.partial).toBe(true);
    expect(view.truncated).toContain("read byte budget");
    expect(view.notLoaded).toBeGreaterThan(0);
  });

  it("is for administrators only, over at most 90 days", async () => {
    const f = await seedVersions();
    await expect(f.manager.query(api.learningHealth.getEditSizeByVersion, { start: f.start, end: f.end })).rejects.toThrow();
    await expect(f.owner.query(api.learningHealth.getEditSizeByVersion, { start: f.start, end: f.end })).rejects.toThrow();
    await expect(
      f.admin.query(api.learningHealth.getEditSizeByVersion, { start: f.end - 91 * DAY, end: f.end })
    ).rejects.toThrow(/90 days/);
  });
});
