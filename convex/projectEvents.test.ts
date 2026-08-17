/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";
import { WORKFLOW_STAGES } from "../shared/workflowStages";

const modules = import.meta.glob("./**/*.ts");

async function setupWorkflowSchema() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const actorId = await ctx.db.insert("users", {
      authId: "workflow-actor",
      role: "admin",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: "workflow-owner",
      role: "writer",
    });
    const now = Date.now();
    const legacyProjectId = await ctx.db.insert("projects", {
      title: "Legacy project",
      clientName: "Client",
      status: "draft",
      createdBy: actorId,
      shareToken: "legacy-workflow-token",
      createdAt: now,
      updatedAt: now,
    });
    const widenedProjectId = await ctx.db.insert("projects", {
      title: "Widened project",
      clientName: "Client",
      status: "review",
      ownerId,
      workflowStage: "internal_review",
      workflowUpdatedAt: now,
      createdBy: actorId,
      shareToken: "widened-workflow-token",
      createdAt: now,
      updatedAt: now,
    });
    return { actorId, ownerId, legacyProjectId, widenedProjectId, now };
  });
  return { t, ...ids };
}

describe("PSOS-07 project workflow schema widen", () => {
  it("accepts legacy projects and projects with the optional workflow fields", async () => {
    const setup = await setupWorkflowSchema();
    const rows = await setup.t.run(async (ctx) => ({
      legacy: await ctx.db.get(setup.legacyProjectId),
      widened: await ctx.db.get(setup.widenedProjectId),
    }));

    expect(rows.legacy).not.toHaveProperty("ownerId");
    expect(rows.legacy).not.toHaveProperty("workflowStage");
    expect(rows.widened).toMatchObject({
      ownerId: setup.ownerId,
      workflowStage: "internal_review",
      workflowUpdatedAt: setup.now,
    });
  });

  it("stores typed ownership and stage events and serves both indexes", async () => {
    const setup = await setupWorkflowSchema();
    const eventIds = await setup.t.run(async (ctx) => {
      const ownershipId = await ctx.db.insert("projectEvents", {
        projectId: setup.widenedProjectId,
        type: "ownership_transferred",
        actorId: setup.actorId,
        to: setup.ownerId,
        note: "Initial assignment",
        at: setup.now,
      });
      const stageId = await ctx.db.insert("projectEvents", {
        projectId: setup.widenedProjectId,
        type: "stage_changed",
        actorId: setup.actorId,
        from: "drafting",
        to: "internal_review",
        at: setup.now + 1,
      });
      return { ownershipId, stageId };
    });

    const indexed = await setup.t.run(async (ctx) => ({
      all: await ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", setup.widenedProjectId))
        .take(10),
      stage: await ctx.db
        .query("projectEvents")
        .withIndex("by_projectId_and_type", (q) =>
          q.eq("projectId", setup.widenedProjectId).eq("type", "stage_changed")
        )
        .take(10),
    }));

    expect(indexed.all.map((event) => event._id)).toEqual(
      expect.arrayContaining([eventIds.ownershipId, eventIds.stageId])
    );
    expect(indexed.stage).toEqual([
      expect.objectContaining({
        _id: eventIds.stageId,
        from: "drafting",
        to: "internal_review",
      }),
    ]);
  });

  it("indexes projects whose optional workflow fields are not backfilled yet", async () => {
    const setup = await setupWorkflowSchema();
    const unbackfilled = await setup.t.run(async (ctx) =>
      ctx.db
        .query("projects")
        .withIndex("by_ownerId", (q) => q.eq("ownerId", undefined))
        .take(10)
    );

    expect(unbackfilled.map((project) => project._id)).toContain(setup.legacyProjectId);
    expect(unbackfilled.map((project) => project._id)).not.toContain(
      setup.widenedProjectId
    );
  });

  it("serves owner-and-stage and stage-only project indexes", async () => {
    const setup = await setupWorkflowSchema();
    const indexed = await setup.t.run(async (ctx) => ({
      ownerStage: await ctx.db
        .query("projects")
        .withIndex("by_ownerId_and_workflowStage", (q) =>
          q.eq("ownerId", setup.ownerId).eq("workflowStage", "internal_review")
        )
        .take(10),
      stage: await ctx.db
        .query("projects")
        .withIndex("by_workflowStage", (q) =>
          q.eq("workflowStage", "internal_review")
        )
        .take(10),
    }));

    expect(indexed.ownerStage.map((project) => project._id)).toEqual([
      setup.widenedProjectId,
    ]);
    expect(indexed.stage.map((project) => project._id)).toContain(
      setup.widenedProjectId
    );
  });

  it("rejects event payloads that mix ownership identifiers with workflow stages", async () => {
    const setup = await setupWorkflowSchema();
    await expect(
      setup.t.run(async (ctx) =>
        // @ts-expect-error Deliberately bypass the compile-time discriminant to
        // prove the deployed schema also rejects this corrupted audit shape.
        ctx.db.insert("projectEvents", {
          projectId: setup.widenedProjectId,
          type: "stage_changed",
          actorId: setup.actorId,
          to: setup.ownerId,
          at: setup.now,
        })
      )
    ).rejects.toThrow();
  });

  it("exports the exact approved workflow-stage vocabulary", () => {
    expect(WORKFLOW_STAGES).toEqual([
      "intake",
      "interview_complete",
      "drafting",
      "internal_review",
      "edits",
      "client_review",
      "revisions",
      "ready_for_delivery",
      "delivered",
      "on_hold",
      "abandoned",
    ]);
  });
});
