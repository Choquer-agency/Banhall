/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { firmDateStartAfterDays } from "../shared/firmTime";
import { workItemDueSortAt, WORK_ITEM_NO_DUE_SORT_AT } from "../shared/workItems";
import { workflowStageRank } from "../shared/workflowStages";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", { authId: "mw-owner", role: "writer", firstName: "Owner" });
    const reviewerId = await ctx.db.insert("users", { authId: "mw-reviewer", role: "writer", firstName: "Reviewer" });
    const adminId = await ctx.db.insert("users", { authId: "mw-admin", role: "admin", firstName: "Admin" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", { title: "Pipeline project", clientName: "Client", ownerId, workflowStage: "drafting", workflowStageRank: workflowStageRank("drafting"), workflowVersion: 0, status: "review", createdBy: ownerId, shareToken: "mw-project", createdAt: now, updatedAt: now });
    return { ownerId, reviewerId, adminId, projectId, now };
  });
  return { t, ...ids, owner: t.withIdentity({ subject: "mw-owner" }), reviewer: t.withIdentity({ subject: "mw-reviewer" }), admin: t.withIdentity({ subject: "mw-admin" }) };
}

async function createWork(f: Awaited<ReturnType<typeof setup>>, args: { assigneeId?: typeof f.reviewerId; dueAt?: number; kind?: "internal_review" | "revision" } = {}) {
  return await f.owner.mutation(api.workItems.create, { projectId: f.projectId, kind: args.kind ?? "revision", assigneeId: args.assigneeId ?? f.reviewerId, blocking: false, ...(args.dueAt ? { dueAt: args.dueAt } : {}), instructions: "Do the work", createRequestId: crypto.randomUUID() });
}

describe("PSOS-14 My Work projections", () => {
  vi.useFakeTimers();
  it("stores undated items after dated items and builds exact waiting rows", async () => {
    const f = await setup();
    const dated = await createWork(f, { dueAt: f.now + 86_400_000 });
    const undated = await createWork(f);
    const stored = await f.t.run(async (ctx) => ({ dated: await ctx.db.get(dated.workItemId), undated: await ctx.db.get(undated.workItemId), oversight: await ctx.db.query("workItemOversight").take(10) }));
    expect(stored.dated?.dueSortAt).toBe(workItemDueSortAt(f.now + 86_400_000));
    expect(stored.undated?.dueSortAt).toBe(WORK_ITEM_NO_DUE_SORT_AT);
    expect(stored.oversight.filter((row) => row.viewerId === f.ownerId)).toHaveLength(2);
  });

  it("paginates assigned, review, due-soon, waiting, and owned lanes", async () => {
    const f = await setup();
    await createWork(f, { dueAt: f.now - 86_400_000, kind: "internal_review" });
    const paginationOpts = { cursor: null, numItems: 25 };
    const boundary = firmDateStartAfterDays(Date.now(), 7);
    expect((await f.reviewer.query(api.myWork.listAssignedToMe, { paginationOpts })).page).toHaveLength(1);
    expect((await f.reviewer.query(api.myWork.listReviews, { paginationOpts })).page).toHaveLength(1);
    expect((await f.reviewer.query(api.myWork.listDueSoon, { paginationOpts, windowEndAt: boundary })).page).toHaveLength(1);
    expect((await f.owner.query(api.myWork.listWaitingOnOthers, { paginationOpts })).page).toHaveLength(1);
    expect((await f.owner.query(api.myWork.listOwnedByMe, { paginationOpts })).page).toHaveLength(1);
  });

  it("gates Waiting on others during ownership reconciliation", async () => {
    const f = await setup();
    await createWork(f);
    await f.admin.mutation(api.projectWorkflow.transferOwnership, { projectId: f.projectId, toUserId: f.reviewerId, expectedVersion: 0 });
    const during = await f.owner.query(api.myWork.listWaitingOnOthers, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(during.laneState).toBe("syncing");
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const after = await f.owner.query(api.myWork.listWaitingOnOthers, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(after.laneState).toBe("ok");
  });

  it("drains inherited syncing rows after chained ownership transfers", async () => {
    const f = await setup();
    const managerId = await f.t.run((ctx) => ctx.db.insert("users", { authId: "mw-manager", role: "manager", firstName: "Manager" }));
    await createWork(f);
    await f.admin.mutation(api.projectWorkflow.transferOwnership, { projectId: f.projectId, toUserId: managerId, expectedVersion: 0 });
    await f.admin.mutation(api.projectWorkflow.transferOwnership, { projectId: f.projectId, toUserId: f.reviewerId, expectedVersion: 1 });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const syncing = await f.t.run((ctx) => ctx.db.query("oversightSyncing").take(20));
    expect(syncing).toHaveLength(0);
    const lane = await f.owner.query(api.myWork.listWaitingOnOthers, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(lane.laneState).toBe("ok");
  });

  it("keeps every inherited viewer fail-closed when a chained rebuild fails", async () => {
    const f = await setup();
    const managerId = await f.t.run((ctx) => ctx.db.insert("users", { authId: "mw-failure-manager", role: "manager", firstName: "Manager" }));
    await createWork(f);
    await f.admin.mutation(api.projectWorkflow.transferOwnership, { projectId: f.projectId, toUserId: managerId, expectedVersion: 0 });
    await f.admin.mutation(api.projectWorkflow.transferOwnership, { projectId: f.projectId, toUserId: f.reviewerId, expectedVersion: 1 });
    const rebuildId = await f.t.run(async (ctx) => {
      const rebuilds = await ctx.db.query("oversightRebuilds").withIndex("by_projectId_and_status", (q) => q.eq("projectId", f.projectId).eq("status", "pending")).take(10);
      const rebuild = rebuilds.find((row) => row.toOwnerId === f.reviewerId)!;
      await ctx.db.patch(rebuild._id, { status: "failed", attempts: 5 });
      return rebuild._id;
    });
    expect(await f.owner.query(api.myWork.getWaitingLaneState, {})).toMatchObject({ failed: true });
    expect((await f.owner.query(api.myWork.listWaitingOnOthers, { paginationOpts: { cursor: null, numItems: 25 } })).laneState).toBe("failed");
    await f.t.mutation(internal.oversight.repairFailed, { rebuildId });
    expect(await f.owner.query(api.myWork.getWaitingLaneState, {})).toMatchObject({ syncing: true, failed: false });
  });

  it("resets verification counters when resuming a mismatch failure", async () => {
    const f = await setup();
    const now = Date.now();
    await f.t.run((ctx) => ctx.db.insert("myWorkBackfillRuns", {
      runKey: "psos14-resume-verification",
      status: "failed",
      phase: "verifyWorkItems",
      dryRun: false,
      scanned: 2,
      patched: 0,
      verificationMismatches: 3,
      startedAt: now - 1_000,
      updatedAt: now,
      verifiedAt: now,
      lastError: "Verification found 3 mismatches",
    }));
    await f.admin.mutation(api.myWorkBackfill.resume, { runKey: "psos14-resume-verification" });
    const run = await f.t.run((ctx) => ctx.db.query("myWorkBackfillRuns").withIndex("by_runKey", (q) => q.eq("runKey", "psos14-resume-verification")).unique());
    expect(run).toMatchObject({ status: "running", phase: "workItems", verificationMismatches: 0 });
  });

  it("repairs a verification mismatch and completes after resume", async () => {
    const f = await setup();
    const item = await createWork(f);
    await f.t.run(async (ctx) => {
      const oversight = await ctx.db.query("workItemOversight").withIndex("by_workItemId", (q) => q.eq("workItemId", item.workItemId)).first();
      if (oversight) await ctx.db.delete(oversight._id);
      const now = Date.now();
      await ctx.db.insert("myWorkBackfillRuns", {
        runKey: "psos14-resume-repair",
        status: "failed",
        phase: "verifyWorkItems",
        dryRun: false,
        scanned: 2,
        patched: 0,
        verificationMismatches: 1,
        startedAt: now - 1_000,
        updatedAt: now,
        verifiedAt: now,
        lastError: "Verification found 1 mismatch",
      });
    });
    await f.admin.mutation(api.myWorkBackfill.resume, { runKey: "psos14-resume-repair" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await f.t.run(async (ctx) => ({
      run: await ctx.db.query("myWorkBackfillRuns").withIndex("by_runKey", (q) => q.eq("runKey", "psos14-resume-repair")).unique(),
      oversight: await ctx.db.query("workItemOversight").withIndex("by_workItemId", (q) => q.eq("workItemId", item.workItemId)).take(5),
    }));
    expect(state.run).toMatchObject({ status: "completed", verificationMismatches: 0 });
    expect(state.oversight).toHaveLength(1);
  });

  it("backfills rank, due-sort, oversight projections and records verification", async () => {
    const f = await setup();
    const item = await createWork(f);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.projectId, { workflowStageRank: undefined });
      await ctx.db.patch(item.workItemId, { dueSortAt: undefined });
      const oversight = await ctx.db.query("workItemOversight").withIndex("by_workItemId", (q) => q.eq("workItemId", item.workItemId)).first();
      if (oversight) await ctx.db.delete(oversight._id);
    });
    await f.admin.mutation(api.myWorkBackfill.run, { dryRun: false, runKey: "psos14-test" });
    await f.t.finishAllScheduledFunctions(vi.runAllTimers);
    const state = await f.t.run(async (ctx) => ({ project: await ctx.db.get(f.projectId), item: await ctx.db.get(item.workItemId), oversight: await ctx.db.query("workItemOversight").withIndex("by_workItemId", (q) => q.eq("workItemId", item.workItemId)).take(5), run: await ctx.db.query("myWorkBackfillRuns").withIndex("by_runKey", (q) => q.eq("runKey", "psos14-test")).unique() }));
    expect(state.project?.workflowStageRank).toBe(workflowStageRank("drafting"));
    expect(state.item?.dueSortAt).toBe(WORK_ITEM_NO_DUE_SORT_AT);
    expect(state.oversight).toHaveLength(1);
    expect(state.run).toMatchObject({ status: "completed", verificationMismatches: 0 });
    expect(state.run?.verifiedAt).toEqual(expect.any(Number));
  });
});

describe("Home reads (ui-design-final.md section 9)", () => {
  it("adds the project's own edit time to assigned rows", async () => {
    const f = await setup();
    await createWork(f);
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { updatedAt: 1_700_000_000_000 }));
    const lane = await f.reviewer.query(api.myWork.listAssignedToMe, { paginationOpts: { cursor: null, numItems: 25 } });
    expect(lane.page[0].projectUpdatedAt).toBe(1_700_000_000_000);
  });

  it("returns live rows for device-recorded ids in order and drops unusable ids", async () => {
    const f = await setup();
    const ids = await f.t.run(async (ctx) => {
      const base = { ownerId: f.ownerId, status: "draft" as const, createdBy: f.ownerId, createdAt: f.now, updatedAt: f.now };
      const second = await ctx.db.insert("projects", { ...base, title: "Second", clientName: "Beta", shareToken: "mw-second" });
      const deleting = await ctx.db.insert("projects", { ...base, title: "Deleting", clientName: "Gamma", shareToken: "mw-deleting", deletionStartedAt: f.now });
      const gone = await ctx.db.insert("projects", { ...base, title: "Gone", clientName: "Delta", shareToken: "mw-gone" });
      await ctx.db.delete(gone);
      return { second, deleting, gone };
    });
    const rows = await f.reviewer.query(api.myWork.listRecentProjects, {
      projectIds: [ids.second, "not-an-id", ids.deleting, ids.gone, f.projectId, ids.second],
    });
    expect(rows.map((row) => row.projectTitle)).toEqual(["Second", "Pipeline project"]);
    expect(rows[0]).toMatchObject({ clientName: "Beta", workflowStage: "intake", stageIsFallback: true });
    expect(rows[1]).toMatchObject({ workflowStage: "drafting", stageIsFallback: false });
  });

  it("reads at most ten recorded ids", async () => {
    const f = await setup();
    const rows = await f.reviewer.query(api.myWork.listRecentProjects, {
      projectIds: [...Array.from({ length: 10 }, () => "not-an-id"), f.projectId],
    });
    expect(rows).toEqual([]);
  });

  it("requires a signed-in internal viewer", async () => {
    const f = await setup();
    await expect(f.t.query(api.myWork.listRecentProjects, { projectIds: [f.projectId] })).rejects.toThrow();
    await expect(f.t.query(api.myWork.getContinueWorking, { projectId: f.projectId })).rejects.toThrow();
  });

  it("counts pending edit proposals on the latest report only", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.projectId, { fiscalYearEnd: Date.UTC(2026, 5, 30, 12), projectNumber: "01A" });
      const report = { projectId: f.projectId, content: "<p>x</p>", version: 1, generatedAt: f.now, updatedAt: f.now };
      const older = await ctx.db.insert("reports", report);
      const latest = await ctx.db.insert("reports", { ...report, version: 2 });
      const proposal = { agentThreadId: "thread", projectId: f.projectId, createdAt: f.now };
      await ctx.db.insert("chatProposals", { ...proposal, reportId: latest, kind: "edit", targetText: "a", newText: "b", state: "pending" });
      await ctx.db.insert("chatProposals", { ...proposal, reportId: latest, kind: "replacements", replacements: [{ find: "a", replaceWith: "b" }], state: "pending" });
      await ctx.db.insert("chatProposals", { ...proposal, reportId: latest, kind: "edit", targetText: "a", newText: "b", state: "applied" });
      await ctx.db.insert("chatProposals", { ...proposal, reportId: latest, kind: "references", references: ["a"], state: "pending" });
      await ctx.db.insert("chatProposals", { ...proposal, reportId: older, kind: "edit", targetText: "a", newText: "b", state: "pending" });
    });
    const summary = await f.reviewer.query(api.myWork.getContinueWorking, { projectId: f.projectId });
    expect(summary).toMatchObject({
      projectTitle: "Pipeline project",
      clientName: "Client",
      projectNumber: "01A",
      workflowStage: "drafting",
      pendingProposals: 2,
      pendingProposalsTruncated: false,
    });
    expect(summary?.fiscalYearEnd).toBe(Date.UTC(2026, 5, 30, 12));
  });

  it("reports no proposals without a report and null for unusable ids", async () => {
    const f = await setup();
    expect(await f.reviewer.query(api.myWork.getContinueWorking, { projectId: f.projectId })).toMatchObject({
      pendingProposals: 0,
      fiscalYearEnd: null,
      projectNumber: null,
    });
    expect(await f.reviewer.query(api.myWork.getContinueWorking, { projectId: "not-an-id" })).toBeNull();
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: f.now }));
    expect(await f.reviewer.query(api.myWork.getContinueWorking, { projectId: f.projectId })).toBeNull();
  });
});
