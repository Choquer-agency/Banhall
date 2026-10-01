/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { scheduleOwnershipOversightRebuild } from "./oversight";
import { syncOversightForItem } from "./lib/workItemOversight";
import { dashboardCompanyKey } from "../shared/dashboardProjection";
import { workItemDueSortAt } from "../shared/workItems";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setupUsers(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "erasure-workflow-admin",
      role: "admin",
      firstName: "Admin",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: "erasure-workflow-owner",
      role: "writer",
      firstName: "Owner",
    });
    const assigneeId = await ctx.db.insert("users", {
      authId: "erasure-workflow-assignee",
      role: "writer",
      firstName: "Assignee",
    });
    const replacementId = await ctx.db.insert("users", {
      authId: "erasure-workflow-replacement",
      role: "writer",
      firstName: "Replacement",
    });
    return { adminId, ownerId, assigneeId, replacementId };
  });
}

function deletingProjectFields(ownerId: Id<"users">, suffix: string) {
  const now = Date.now();
  return {
    title: `Deleting project ${suffix}`,
    clientName: "Deletion barrier client",
    ownerId,
    workflowStage: "drafting" as const,
    workflowVersion: 0,
    status: "review" as const,
    createdBy: ownerId,
    shareToken: `deletion-barrier-${suffix}`,
    createdAt: now,
    updatedAt: now,
    deletionStartedAt: now,
  };
}

describe("project erasure workflow barriers", () => {
  it("rejects work-item and workflow writes after deletion starts", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupUsers(t);
    const seeded = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert(
        "projects",
        deletingProjectFields(ids.ownerId, "public-writes")
      );
      const workItemId = await ctx.db.insert("workItems", {
        projectId,
        kind: "revision",
        assigneeId: ids.assigneeId,
        assignerId: ids.ownerId,
        dueSortAt: workItemDueSortAt(undefined),
        instructions: "Existing assignment",
        blocking: false,
        status: "open",
        version: 0,
        createRequestId: "existing-request",
        createRequestFingerprint: "existing-fingerprint",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { projectId, workItemId };
    });
    const admin = t.withIdentity({ subject: "erasure-workflow-admin" });

    await expect(
      admin.mutation(api.workItems.create, {
        projectId: seeded.projectId,
        kind: "revision",
        assigneeId: ids.assigneeId,
        blocking: false,
        instructions: "Late assignment",
        createRequestId: "late-request",
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);
    await expect(
      admin.mutation(api.workItems.reassign, {
        workItemId: seeded.workItemId,
        toAssigneeId: ids.replacementId,
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);
    await expect(
      admin.mutation(api.projectWorkflow.transferOwnership, {
        projectId: seeded.projectId,
        toUserId: ids.replacementId,
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);
    await expect(
      admin.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: seeded.projectId,
        toStage: "on_hold",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);

    const after = await t.run(async (ctx) => ({
      project: await ctx.db.get(seeded.projectId),
      item: await ctx.db.get(seeded.workItemId),
      workItems: await ctx.db
        .query("workItems")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
      events: await ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
      rebuilds: await ctx.db
        .query("oversightRebuilds")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
    }));
    expect(after.project).toMatchObject({
      ownerId: ids.ownerId,
      workflowStage: "drafting",
      workflowVersion: 0,
    });
    expect(after.item).toMatchObject({ assigneeId: ids.assigneeId, version: 0 });
    expect(after.workItems).toHaveLength(1);
    expect(after.events).toHaveLength(0);
    expect(after.rebuilds).toHaveLength(0);
  });

  it("skips deleting projects in the ownership backfill and rejects review writes", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupUsers(t);
    const projectIds = await t.run(async (ctx) => {
      const now = Date.now();
      const backfillId = await ctx.db.insert("projects", {
        title: "Deleting legacy project",
        clientName: "Legacy client",
        status: "draft",
        createdBy: ids.ownerId,
        shareToken: "deleting-legacy-project",
        createdAt: now,
        updatedAt: now,
        deletionStartedAt: now,
      });
      const reviewId = await ctx.db.insert("projects", {
        ...deletingProjectFields(ids.ownerId, "review"),
        ownerBackfillStatus: "needs_review",
      });
      return { backfillId, reviewId };
    });

    await t.mutation(internal.ownerBackfill.backfillOwnership, {
      paginationOpts: { cursor: null, numItems: 10 },
      actorId: ids.adminId,
      dryRun: false,
    });
    const admin = t.withIdentity({ subject: "erasure-workflow-admin" });
    await expect(
      admin.mutation(api.ownerBackfill.assignOwnerFromReview, {
        projectId: projectIds.reviewId,
        toUserId: ids.replacementId,
        expectedOwnerId: ids.ownerId,
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);
    await expect(
      admin.mutation(api.ownerBackfill.confirmFallbackOwner, {
        projectId: projectIds.reviewId,
        expectedOwnerId: ids.ownerId,
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);

    const after = await t.run(async (ctx) => ({
      backfill: await ctx.db.get(projectIds.backfillId),
      review: await ctx.db.get(projectIds.reviewId),
      events: await ctx.db.query("projectEvents").collect(),
      rebuilds: await ctx.db.query("oversightRebuilds").collect(),
      syncing: await ctx.db.query("oversightSyncing").collect(),
    }));
    expect(after.backfill?.ownerId).toBeUndefined();
    expect(after.backfill?.workflowStage).toBeUndefined();
    expect(after.review).toMatchObject({
      ownerId: ids.ownerId,
      ownerBackfillStatus: "needs_review",
      workflowVersion: 0,
    });
    expect(after.events).toHaveLength(0);
    expect(after.rebuilds).toHaveLength(0);
    expect(after.syncing).toHaveLength(0);
  });

  it("does not attach an ingestion port to a matched deleting project", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupUsers(t);
    const seeded = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        ...deletingProjectFields(ids.ownerId, "ingestion"),
        dashboardCompanyKey: dashboardCompanyKey("Acme"),
        dashboardFiscalYearRank: -2025,
      });
      const itemId = await ctx.db.insert("ingestionItems", {
        driveItemId: "deletion-port-drive-item",
        path: "Acme/2025 - Dec 31/Submitted/PD.docx",
        name: "PD.docx",
        clientName: "Acme",
        fiscalYearLabel: "2025 - Dec 31",
        fiscalYear: 2025,
        docKind: "pd",
        size: 100,
        lastModifiedAt: Date.now(),
        contentHash: "deletion-port-content",
        text: "Historical PD",
        status: "approved",
        pairGroupKey: "Acme::2025 - Dec 31",
        updatedAt: Date.now(),
      });
      return { projectId, itemId };
    });
    const admin = t.withIdentity({ subject: "erasure-workflow-admin" });

    await expect(
      admin.mutation(internal.ingestionPort.finalizePort, {
        itemId: seeded.itemId,
        content: "Historical PD",
      })
    ).rejects.toThrow(/NOT_FOUND|Project not found/i);

    const after = await t.run(async (ctx) => ({
      item: await ctx.db.get(seeded.itemId),
      documents: await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
      transcripts: await ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
    }));
    expect(after.item?.portedProjectId).toBeUndefined();
    expect(after.item?.portedDocumentId).toBeUndefined();
    expect(after.documents).toHaveLength(0);
    expect(after.transcripts).toHaveLength(0);
  });

  it("makes projection and rebuild helpers no-op for deleting and missing projects", async () => {
    const t = convexTest(schema, modules);
    const ids = await setupUsers(t);
    const seeded = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert("projects", {
        ...deletingProjectFields(ids.ownerId, "oversight"),
        deletionStartedAt: undefined,
      });
      const project = await ctx.db.get(projectId);
      if (!project) throw new Error("Expected seeded project");
      const workItemId = await ctx.db.insert("workItems", {
        projectId,
        kind: "revision",
        assigneeId: ids.assigneeId,
        assignerId: ids.ownerId,
        dueSortAt: workItemDueSortAt(undefined),
        instructions: "Late projection",
        blocking: false,
        status: "open",
        version: 0,
        createRequestId: "oversight-request",
        createRequestFingerprint: "oversight-fingerprint",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const item = await ctx.db.get(workItemId);
      if (!item) throw new Error("Expected seeded work item");
      await ctx.db.patch(projectId, { deletionStartedAt: Date.now() });
      const pendingRebuildId = await ctx.db.insert("oversightRebuilds", {
        projectId,
        reason: "ownership_transfer",
        fromOwnerId: ids.ownerId,
        toOwnerId: ids.replacementId,
        affectedViewerIds: [ids.ownerId],
        status: "pending",
        attempts: 0,
        startedAt: Date.now(),
        updatedAt: Date.now(),
      });
      const failedRebuildId = await ctx.db.insert("oversightRebuilds", {
        projectId,
        reason: "ownership_transfer",
        fromOwnerId: ids.ownerId,
        toOwnerId: ids.replacementId,
        affectedViewerIds: [ids.ownerId],
        status: "failed",
        attempts: 5,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        lastError: "seeded failure",
      });
      return { project, item, projectId, pendingRebuildId, failedRebuildId };
    });

    await t.run(async (ctx) => {
      await syncOversightForItem(ctx, seeded.item, seeded.project);
      await scheduleOwnershipOversightRebuild(ctx, {
        projectId: seeded.projectId,
        reason: "ownership_transfer",
        fromOwnerId: ids.ownerId,
        toOwnerId: ids.replacementId,
      });
    });
    await t.mutation(internal.oversight.reconcileProject, {
      rebuildId: seeded.pendingRebuildId,
    });
    await t.mutation(internal.oversight.repairFailed, {
      rebuildId: seeded.failedRebuildId,
    });

    const deletingState = await t.run(async (ctx) => ({
      oversight: await ctx.db.query("workItemOversight").collect(),
      syncing: await ctx.db.query("oversightSyncing").collect(),
      rebuilds: await ctx.db
        .query("oversightRebuilds")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
    }));
    expect(deletingState.oversight).toHaveLength(0);
    expect(deletingState.syncing).toHaveLength(0);
    expect(deletingState.rebuilds).toHaveLength(2);
    expect(deletingState.rebuilds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _id: seeded.pendingRebuildId, status: "pending" }),
        expect.objectContaining({
          _id: seeded.failedRebuildId,
          status: "failed",
          attempts: 5,
          lastError: "seeded failure",
        }),
      ])
    );

    await t.run(async (ctx) => {
      await ctx.db.delete(seeded.projectId);
      await syncOversightForItem(ctx, seeded.item, seeded.project);
      await scheduleOwnershipOversightRebuild(ctx, {
        projectId: seeded.projectId,
        reason: "ownership_transfer",
        fromOwnerId: ids.ownerId,
        toOwnerId: ids.replacementId,
      });
    });
    const missingState = await t.run(async (ctx) => ({
      oversight: await ctx.db.query("workItemOversight").collect(),
      syncing: await ctx.db.query("oversightSyncing").collect(),
      rebuilds: await ctx.db
        .query("oversightRebuilds")
        .withIndex("by_projectId_and_status", (q) => q.eq("projectId", seeded.projectId))
        .collect(),
    }));
    expect(missingState).toEqual(deletingState);
  });
});
