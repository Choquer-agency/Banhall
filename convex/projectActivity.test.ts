/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { ACTIVITY_PAGE_SIZE } from "./projectActivity";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "activity-admin",
      role: "admin",
      firstName: "Avery",
      lastName: "Admin",
      email: "avery@example.com",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: "activity-owner",
      role: "writer",
      firstName: "Olivia",
      lastName: "Owner",
      email: "olivia@example.com",
    });
    const reviewerId = await ctx.db.insert("users", {
      authId: "activity-reviewer",
      role: "writer",
      firstName: "Riley",
      lastName: "Reviewer",
      email: "riley@example.com",
    });
    const rolelessId = await ctx.db.insert("users", {
      authId: "activity-roleless",
      firstName: "Roleless",
    });
    await ctx.db.insert("users", {
      authId: "activity-anonymous",
      role: "writer",
      isAnonymous: true,
      email: "anon@example.com",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Activity project",
      clientName: "Client",
      status: "review",
      ownerId,
      workflowStage: "internal_review",
      workflowUpdatedAt: now,
      createdBy: adminId,
      shareToken: "activity-token",
      createdAt: now,
      updatedAt: now,
    });
    return { adminId, ownerId, reviewerId, rolelessId, projectId, now };
  });
  return {
    t,
    ...ids,
    asAdmin: t.withIdentity({ subject: "activity-admin" }),
    asOwner: t.withIdentity({ subject: "activity-owner" }),
    asRoleless: t.withIdentity({ subject: "activity-roleless" }),
    asAnonymous: t.withIdentity({ subject: "activity-anonymous" }),
  };
}

describe("listProjectActivity", () => {
  it("returns null for unauthenticated, roleless, and anonymous callers", async () => {
    const setup1 = await setup();
    await expect(
      setup1.t.query(api.projectActivity.listProjectActivity, {
        projectId: setup1.projectId,
      })
    ).resolves.toBeNull();
    await expect(
      setup1.asRoleless.query(api.projectActivity.listProjectActivity, {
        projectId: setup1.projectId,
      })
    ).resolves.toBeNull();
    await expect(
      setup1.asAnonymous.query(api.projectActivity.listProjectActivity, {
        projectId: setup1.projectId,
      })
    ).resolves.toBeNull();
  });

  it("merges project and work-item events newest-first with resolved labels", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const workItemId = await ctx.db.insert("workItems", {
        projectId: s.projectId,
        kind: "internal_review",
        assigneeId: s.reviewerId,
        assignerId: s.ownerId,
        instructions: "Secret instructions that must not leak",
        blocking: true,
        status: "open",
        version: 2,
        createRequestId: "req-1",
        createRequestFingerprint: "fp-1",
        createdAt: s.now + 10,
        updatedAt: s.now + 20,
      });
      await ctx.db.insert("projectEvents", {
        projectId: s.projectId,
        type: "ownership_transferred",
        actorId: s.adminId,
        at: s.now + 1,
        to: s.ownerId,
        note: "Initial assignment",
      });
      await ctx.db.insert("projectEvents", {
        projectId: s.projectId,
        type: "stage_changed",
        actorId: s.ownerId,
        at: s.now + 5,
        from: "drafting",
        to: "internal_review",
      });
      await ctx.db.insert("workItemEvents", {
        workItemId,
        projectId: s.projectId,
        type: "created",
        actorId: s.ownerId,
        at: s.now + 10,
        itemVersion: 1,
        detail: {
          kind: "internal_review",
          assigneeId: s.reviewerId,
          blocking: true,
          dueAt: s.now + 1000,
        },
      });
      await ctx.db.insert("workItemEvents", {
        workItemId,
        projectId: s.projectId,
        type: "reassigned",
        actorId: s.adminId,
        at: s.now + 20,
        itemVersion: 2,
        detail: { fromAssigneeId: s.ownerId, toAssigneeId: s.reviewerId },
      });
    });

    const result = await s.asOwner.query(api.projectActivity.listProjectActivity, {
      projectId: s.projectId,
    });
    expect(result).not.toBeNull();
    expect(result!.truncated).toBe(false);
    expect(result!.entries.map((entry) => entry.kind)).toEqual([
      "work_reassigned",
      "work_created",
      "stage_changed",
      "ownership_transferred",
    ]);
    expect(result!.entries[0]).toMatchObject({
      kind: "work_reassigned",
      actor: { label: "Avery Admin", initials: "AA" },
      workKind: "internal_review",
      fromAssigneeLabel: "Olivia Owner",
      toAssigneeLabel: "Riley Reviewer",
    });
    expect(result!.entries[1]).toMatchObject({
      kind: "work_created",
      assigneeLabel: "Riley Reviewer",
      blocking: true,
      dueAt: s.now + 1000,
    });
    expect(result!.entries[2]).toMatchObject({
      kind: "stage_changed",
      fromStage: "drafting",
      toStage: "internal_review",
      note: null,
    });
    expect(result!.entries[3]).toMatchObject({
      kind: "ownership_transferred",
      fromLabel: null,
      toLabel: "Olivia Owner",
      note: "Initial assignment",
    });
    // Work-item instructions never appear in the activity projection.
    expect(JSON.stringify(result)).not.toContain("Secret instructions");
  });

  it("covers terminal work-item events with the item's assignee label", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const workItemId = await ctx.db.insert("workItems", {
        projectId: s.projectId,
        kind: "revision",
        assigneeId: s.reviewerId,
        assignerId: s.ownerId,
        instructions: "Fix section 2",
        blocking: false,
        status: "declined",
        version: 3,
        createRequestId: "req-2",
        createRequestFingerprint: "fp-2",
        createdAt: s.now,
        updatedAt: s.now + 40,
      });
      await ctx.db.insert("workItemEvents", {
        workItemId,
        projectId: s.projectId,
        type: "declined",
        actorId: s.reviewerId,
        at: s.now + 40,
        itemVersion: 3,
        detail: { reason: "Out of scope" },
      });
      await ctx.db.insert("workItemEvents", {
        workItemId,
        projectId: s.projectId,
        type: "due_changed",
        actorId: s.ownerId,
        at: s.now + 30,
        itemVersion: 2,
        detail: { fromDueAt: s.now + 500, toDueAt: s.now + 900 },
      });
    });

    const result = await s.asAdmin.query(api.projectActivity.listProjectActivity, {
      projectId: s.projectId,
    });
    expect(result!.entries[0]).toMatchObject({
      kind: "work_declined",
      workKind: "revision",
      assigneeLabel: "Riley Reviewer",
      reason: "Out of scope",
    });
    expect(result!.entries[1]).toMatchObject({
      kind: "work_due_changed",
      fromDueAt: s.now + 500,
      toDueAt: s.now + 900,
    });
  });

  it("discloses truncation when one source exceeds the page bound", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      for (let i = 0; i < ACTIVITY_PAGE_SIZE + 3; i++) {
        await ctx.db.insert("projectEvents", {
          projectId: s.projectId,
          type: "stage_changed",
          actorId: s.adminId,
          at: s.now + i,
          from: "drafting",
          to: "internal_review",
        });
      }
    });
    const result = await s.asAdmin.query(api.projectActivity.listProjectActivity, {
      projectId: s.projectId,
    });
    expect(result!.truncated).toBe(true);
    expect(result!.entries).toHaveLength(ACTIVITY_PAGE_SIZE);
    // Newest-first: the highest timestamp leads the page.
    expect(result!.entries[0].at).toBe(s.now + ACTIVITY_PAGE_SIZE + 2);
  });

  it("discloses truncation when only the merged set exceeds the page bound", async () => {
    const s = await setup();
    await s.t.run(async (ctx) => {
      const workItemId = await ctx.db.insert("workItems", {
        projectId: s.projectId,
        kind: "other",
        assigneeId: s.reviewerId,
        assignerId: s.ownerId,
        instructions: "x",
        blocking: false,
        status: "open",
        version: 1,
        createRequestId: "req-3",
        createRequestFingerprint: "fp-3",
        createdAt: s.now,
        updatedAt: s.now,
      });
      for (let i = 0; i < 15; i++) {
        await ctx.db.insert("projectEvents", {
          projectId: s.projectId,
          type: "stage_changed",
          actorId: s.adminId,
          at: s.now + i,
          to: "drafting",
        });
        await ctx.db.insert("workItemEvents", {
          workItemId,
          projectId: s.projectId,
          type: "due_changed",
          actorId: s.ownerId,
          at: s.now + 100 + i,
          itemVersion: i + 1,
          detail: { toDueAt: s.now + 1000 + i },
        });
      }
    });
    const result = await s.asAdmin.query(api.projectActivity.listProjectActivity, {
      projectId: s.projectId,
    });
    // 15 + 15 = 30 entries; neither source alone exceeds the bound.
    expect(result!.truncated).toBe(true);
    expect(result!.entries).toHaveLength(ACTIVITY_PAGE_SIZE);
  });

  it("returns an empty, non-truncated page for a project with no events", async () => {
    const s = await setup();
    const result = await s.asOwner.query(api.projectActivity.listProjectActivity, {
      projectId: s.projectId,
    });
    expect(result).toEqual({ entries: [], truncated: false });
  });
});
