/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "header-admin",
      role: "admin",
      firstName: "Avery",
      lastName: "Admin",
      email: "avery@example.com",
    });
    const managerId = await ctx.db.insert("users", {
      authId: "header-manager",
      role: "manager",
      firstName: "Morgan",
      lastName: "Manager",
      email: "morgan@example.com",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: "header-owner",
      role: "writer",
      firstName: "Olivia",
      lastName: "Owner",
      email: "olivia@example.com",
    });
    const writerId = await ctx.db.insert("users", {
      authId: "header-writer",
      role: "writer",
      firstName: "Taylor",
      lastName: "Writer",
      email: "taylor@example.com",
    });
    const rolelessId = await ctx.db.insert("users", {
      authId: "header-roleless",
      firstName: "Roleless",
    });
    await ctx.db.insert("users", {
      authId: "header-anonymous",
      role: "writer",
      isAnonymous: true,
      email: "anon@example.com",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Header fixture",
      clientName: "Workflow Client",
      writer: "Historical Creator",
      ownerId,
      ownerBackfillStatus: "needs_review",
      status: "review",
      createdBy: writerId,
      shareToken: "header-fixture",
      createdAt: now - 100,
      updatedAt: now - 50,
    });
    return { adminId, managerId, ownerId, writerId, rolelessId, projectId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "header-admin" }),
    manager: t.withIdentity({ subject: "header-manager" }),
    owner: t.withIdentity({ subject: "header-owner" }),
    writer: t.withIdentity({ subject: "header-writer" }),
    roleless: t.withIdentity({ subject: "header-roleless" }),
  };
}

describe("project workflow header", () => {
  it("returns null without internal authentication", async () => {
    const fixture = await setup();
    await expect(
      fixture.t.query(api.projectWorkflow.getProjectWorkflowHeader, {
        projectId: fixture.projectId,
      })
    ).resolves.toBeNull();
  });

  it("keeps owner and creator separate and projects compatibility defaults", async () => {
    const fixture = await setup();
    await expect(
      fixture.owner.query(api.projectWorkflow.getProjectWorkflowHeader, {
        projectId: fixture.projectId,
      })
    ).resolves.toMatchObject({
      workflowStage: "intake",
      stageIsFallback: true,
      workflowVersion: 0,
      owner: { userId: fixture.ownerId, label: "Olivia Owner", initials: "OO" },
      ownerNeedsReview: true,
      createdByLabel: "Taylor Writer",
      viewerAuthorities: ["owner"],
    });
  });

  it("returns live owner labels and role-specific authorities", async () => {
    const fixture = await setup();
    await fixture.t.run(async (ctx) => {
      await ctx.db.patch(fixture.ownerId, { firstName: "Updated" });
    });
    const ownerHeader = await fixture.owner.query(api.projectWorkflow.getProjectWorkflowHeader, {
      projectId: fixture.projectId,
    });
    expect(ownerHeader?.owner?.label).toBe("Updated Owner");
    expect(
      (
        await fixture.manager.query(api.projectWorkflow.getProjectWorkflowHeader, {
          projectId: fixture.projectId,
        })
      )?.viewerAuthorities
    ).toEqual(["manager"]);
    expect(
      (
        await fixture.admin.query(api.projectWorkflow.getProjectWorkflowHeader, {
          projectId: fixture.projectId,
        })
      )?.viewerAuthorities
    ).toEqual(["admin"]);
    expect(
      (
        await fixture.writer.query(api.projectWorkflow.getProjectWorkflowHeader, {
          projectId: fixture.projectId,
        })
      )?.viewerAuthorities
    ).toEqual([]);
    await expect(
      fixture.roleless.query(api.projectWorkflow.getProjectWorkflowHeader, {
        projectId: fixture.projectId,
      })
    ).resolves.toBeNull();
  });

  it("returns only eligible transfer candidates and excludes the current owner", async () => {
    const fixture = await setup();
    const result = await fixture.owner.query(api.projectWorkflow.listOwnerTransferCandidates, {
      projectId: fixture.projectId,
    });
    expect(result.truncated).toBe(false);
    expect(result.candidates).toEqual([
      expect.objectContaining({ userId: fixture.managerId, role: "manager" }),
      expect.objectContaining({ userId: fixture.writerId, role: "writer" }),
    ]);
    expect(result.candidates.some((candidate) => candidate.userId === fixture.adminId)).toBe(false);
    expect(result.candidates.some((candidate) => candidate.userId === fixture.ownerId)).toBe(false);
    expect(result.candidates.some((candidate) => candidate.userId === fixture.rolelessId)).toBe(false);
  });

  it("reacts after a successful transfer and writes exactly one immutable event", async () => {
    const fixture = await setup();
    await fixture.owner.mutation(api.projectWorkflow.transferOwnership, {
      projectId: fixture.projectId,
      toUserId: fixture.managerId,
      expectedVersion: 0,
    });
    const header = await fixture.manager.query(api.projectWorkflow.getProjectWorkflowHeader, {
      projectId: fixture.projectId,
    });
    expect(header).toMatchObject({
      workflowVersion: 1,
      owner: { userId: fixture.managerId, label: "Morgan Manager" },
      viewerAuthorities: ["owner", "manager"],
    });
    const events = await fixture.t.run(async (ctx) =>
      ctx.db
        .query("projectEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", fixture.projectId))
        .take(10)
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "ownership_transferred",
      from: fixture.ownerId,
      to: fixture.managerId,
    });
  });

  it("denies candidate roster access to an unrelated consultant", async () => {
    const fixture = await setup();
    await expect(
      fixture.writer.query(api.projectWorkflow.listOwnerTransferCandidates, {
        projectId: fixture.projectId,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|project owner/i);
  });
});
