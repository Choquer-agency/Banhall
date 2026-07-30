/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", { authId: "wi-admin", role: "admin", firstName: "Ada" });
    const managerId = await ctx.db.insert("users", { authId: "wi-manager", role: "manager", firstName: "Mara" });
    const ownerId = await ctx.db.insert("users", { authId: "wi-owner", role: "writer", firstName: "Owen" });
    const assigneeId = await ctx.db.insert("users", { authId: "wi-assignee", role: "writer", firstName: "Alex" });
    const otherId = await ctx.db.insert("users", { authId: "wi-other", role: "writer", firstName: "Taylor" });
    const rolelessId = await ctx.db.insert("users", { authId: "wi-roleless", firstName: "None" });
    const anonymousId = await ctx.db.insert("users", { authId: "wi-anon", role: "writer", isAnonymous: true });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Work item project", clientName: "Client", ownerId, workflowStage: "drafting",
      workflowVersion: 0, status: "review", createdBy: ownerId, shareToken: "wi-project",
      createdAt: now, updatedAt: now,
    });
    return { adminId, managerId, ownerId, assigneeId, otherId, rolelessId, anonymousId, projectId };
  });
  return {
    t, ...ids,
    admin: t.withIdentity({ subject: "wi-admin" }),
    manager: t.withIdentity({ subject: "wi-manager" }),
    owner: t.withIdentity({ subject: "wi-owner" }),
    assignee: t.withIdentity({ subject: "wi-assignee" }),
    other: t.withIdentity({ subject: "wi-other" }),
    roleless: t.withIdentity({ subject: "wi-roleless" }),
    anonymous: t.withIdentity({ subject: "wi-anon" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

type CreateOverrides = Partial<{
  kind: "internal_review" | "revision" | "interview_followup" | "delivery_prep" | "financial" | "other";
  assigneeId: Id<"users">;
  blocking: boolean;
  dueAt: number;
  instructions: string;
  createRequestId: string;
}>;

async function createItem(f: Fixture, overrides: CreateOverrides = {}) {
  return await f.owner.mutation(api.workItems.create, {
    projectId: f.projectId,
    kind: "internal_review",
    assigneeId: f.assigneeId,
    blocking: true,
    instructions: "Review the draft",
    createRequestId: `request-${Math.random()}`,
    ...overrides,
  });
}

async function itemEvents(f: Fixture, workItemId: Id<"workItems">) {
  return await f.t.run((ctx) => ctx.db.query("workItemEvents")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", workItemId)).take(20));
}

describe("work item creation and handoff invariant", () => {
  it("does not reveal project existence before internal authentication", async () => {
    const f = await setup();
    const missingProjectId = await f.t.run(async (ctx) => {
      const id = await ctx.db.insert("projects", { title: "Deleted", clientName: "Deleted", status: "draft", createdBy: f.ownerId, shareToken: "deleted-project", createdAt: Date.now(), updatedAt: Date.now() });
      await ctx.db.delete(id);
      return id;
    });
    await expect(f.t.query(api.workItems.listAssigneeCandidates, { projectId: f.projectId })).rejects.toThrow(/NOT_AUTHENTICATED|Authentication required/i);
    await expect(f.t.query(api.workItems.listAssigneeCandidates, { projectId: missingProjectId })).rejects.toThrow(/NOT_AUTHENTICATED|Authentication required/i);
    await expect(f.roleless.query(api.workItems.listAssigneeCandidates, { projectId: f.projectId })).rejects.toThrow(/NOT_AUTHORIZED|active internal role/i);
    await expect(f.anonymous.query(api.workItems.listAssigneeCandidates, { projectId: f.projectId })).rejects.toThrow(/NOT_AUTHENTICATED|Authentication required/i);
  });

  it("creates one blocking handoff atomically and rejects a second", async () => {
    const f = await setup();
    const created = await createItem(f);
    const project = await f.t.run((ctx) => ctx.db.get(f.projectId));
    expect(project).toMatchObject({ currentHandoffId: created.workItemId, workflowVersion: 1 });
    await expect(createItem(f, { createRequestId: "second" })).rejects.toThrow(/BLOCKING_EXISTS|blocking handoff/i);
    expect(await itemEvents(f, created.workItemId)).toHaveLength(1);
  });

  it("atomically creates an internal-review handoff and changes Stage when confirmed", async () => {
    const f = await setup();
    const result = await f.owner.mutation(api.workItems.create, {
      projectId: f.projectId,
      kind: "internal_review",
      assigneeId: f.assigneeId,
      blocking: true,
      instructions: "Review the current draft",
      createRequestId: "atomic-review",
      confirmedStageChange: "internal_review",
      expectedWorkflowVersion: 0,
    });
    expect(result).toMatchObject({ status: "created", stageChanged: true, workflowVersion: 1 });
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toMatchObject({
      currentHandoffId: result.workItemId,
      workflowStage: "internal_review",
      workflowVersion: 1,
    });
    const projectEvents = await f.t.run((ctx) => ctx.db.query("projectEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId)).take(10));
    expect(projectEvents).toEqual([expect.objectContaining({ type: "stage_changed", to: "internal_review" })]);
    expect(await itemEvents(f, result.workItemId)).toHaveLength(1);
    await expect(f.owner.mutation(api.workItems.create, {
      projectId: f.projectId,
      kind: "internal_review",
      assigneeId: f.assigneeId,
      blocking: true,
      instructions: "Review the current draft",
      createRequestId: "atomic-review",
      confirmedStageChange: "internal_review",
      expectedWorkflowVersion: 0,
    })).resolves.toMatchObject({ status: "noop", workItemId: result.workItemId, stageChanged: true });
    expect(await itemEvents(f, result.workItemId)).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.query("projectEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId)).take(10))).toHaveLength(1);
  });

  it("rolls back a confirmed atomic shortcut when its workflow version is stale", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { workflowVersion: 2 }));
    await expect(f.owner.mutation(api.workItems.create, {
      projectId: f.projectId,
      kind: "internal_review",
      assigneeId: f.assigneeId,
      blocking: true,
      instructions: "Review the current draft",
      createRequestId: "stale-atomic-review",
      confirmedStageChange: "internal_review",
      expectedWorkflowVersion: 0,
    })).rejects.toThrow(/STALE_REVISION|changed/i);
    expect(await f.t.run((ctx) => ctx.db.query("workItems")
      .withIndex("by_projectId_and_status", (q) => q.eq("projectId", f.projectId).eq("status", "open")).take(10))).toHaveLength(0);
  });

  it("creates the handoff without changing Stage when the offer is declined", async () => {
    const f = await setup();
    const result = await createItem(f);
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toMatchObject({
      currentHandoffId: result.workItemId,
      workflowStage: "drafting",
      workflowVersion: 1,
    });
    expect(await f.t.run((ctx) => ctx.db.query("projectEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", f.projectId)).take(10))).toHaveLength(0);
  });

  it("deduplicates exact create retries and rejects key reuse with different values", async () => {
    const f = await setup();
    const args = { createRequestId: "stable-request", blocking: false } as const;
    const first = await createItem(f, args);
    await expect(createItem(f, args)).resolves.toMatchObject({ status: "noop", workItemId: first.workItemId, version: 0, stageChanged: false });
    await f.owner.mutation(api.workItems.reassign, {
      workItemId: first.workItemId,
      toAssigneeId: f.otherId,
      expectedVersion: 0,
    });
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { workflowStage: "delivered" }));
    await expect(createItem(f, args)).resolves.toMatchObject({ status: "noop", workItemId: first.workItemId, version: 1, stageChanged: false });
    await expect(createItem(f, { ...args, assigneeId: f.otherId })).rejects.toThrow(/different values/i);
    await expect(f.owner.mutation(api.workItems.create, {
      projectId: f.projectId,
      kind: "internal_review",
      assigneeId: f.assigneeId,
      blocking: false,
      instructions: "Review the draft",
      createRequestId: "stable-request",
      dueAt: Number.NaN,
    })).rejects.toThrow(/valid timestamp/i);
    expect((await itemEvents(f, first.workItemId)).filter((event) => event.type === "created")).toHaveLength(1);
  });

  it("allows non-blocking items without changing the current handoff", async () => {
    const f = await setup();
    const first = await createItem(f);
    await createItem(f, { blocking: false, createRequestId: "nonblocking-1" });
    await createItem(f, { blocking: false, createRequestId: "nonblocking-2" });
    expect(await f.t.run((ctx) => ctx.db.get(f.projectId))).toMatchObject({ currentHandoffId: first.workItemId });
  });

  it("projects eligible assignment candidates and the current handoff without unsafe roles", async () => {
    const f = await setup();
    const created = await createItem(f);
    const candidates = await f.owner.query(api.workItems.listAssigneeCandidates, { projectId: f.projectId });
    expect(candidates.candidates.map((candidate) => candidate.userId)).toEqual(
      expect.arrayContaining([f.ownerId, f.managerId, f.assigneeId, f.otherId])
    );
    expect(candidates.candidates.map((candidate) => candidate.userId)).not.toEqual(
      expect.arrayContaining([f.adminId, f.rolelessId, f.anonymousId])
    );
    const panel = await f.owner.query(api.workItems.getProjectWorkPanel, { projectId: f.projectId });
    expect(panel).toMatchObject({ currentHandoffId: created.workItemId, pointerHealthy: true });
    expect(panel?.openItems[0]).toMatchObject({ workItemId: created.workItemId, viewerCanManage: true });
  });
});

describe("work item lifecycle", () => {
  it("reassigns, changes blocking state, changes due date, and preserves event history", async () => {
    const f = await setup();
    const created = await createItem(f);
    await f.owner.mutation(api.workItems.reassign, { workItemId: created.workItemId, toAssigneeId: f.otherId, expectedVersion: 0 });
    await f.owner.mutation(api.workItems.setBlocking, { workItemId: created.workItemId, blocking: false, expectedVersion: 1 });
    await f.owner.mutation(api.workItems.changeDueDate, { workItemId: created.workItemId, dueAt: 2_000_000_000_000, expectedVersion: 2 });
    const item = await f.t.run((ctx) => ctx.db.get(created.workItemId));
    const project = await f.t.run((ctx) => ctx.db.get(f.projectId));
    expect(item).toMatchObject({ assigneeId: f.otherId, blocking: false, dueAt: 2_000_000_000_000, version: 3 });
    expect(project?.currentHandoffId).toBeUndefined();
    expect((await itemEvents(f, created.workItemId)).map((event) => event.type)).toEqual([
      "created", "reassigned", "blocking_changed", "due_changed",
    ]);
  });

  it("keeps terminal retries idempotent and disallows a different terminal state", async () => {
    const f = await setup();
    const created = await createItem(f);
    await expect(f.assignee.mutation(api.workItems.complete, { workItemId: created.workItemId, expectedVersion: 0 }))
      .resolves.toEqual({ status: "updated", version: 1 });
    await expect(f.assignee.mutation(api.workItems.complete, { workItemId: created.workItemId, expectedVersion: 0 }))
      .resolves.toEqual({ status: "noop", version: 1 });
    await expect(f.assignee.mutation(api.workItems.decline, { workItemId: created.workItemId, expectedVersion: 1, reason: "No" }))
      .rejects.toThrow(/already closed|INVALID_STATE/i);
    expect((await itemEvents(f, created.workItemId)).filter((event) => event.type === "completed")).toHaveLength(1);
    expect((await f.t.run((ctx) => ctx.db.get(f.projectId)))?.currentHandoffId).toBeUndefined();
  });

  it("requires a reason for decline and administrative completion", async () => {
    const f = await setup();
    const declined = await createItem(f);
    await expect(f.assignee.mutation(api.workItems.decline, { workItemId: declined.workItemId, expectedVersion: 0, reason: "  " }))
      .rejects.toThrow(/required/i);
    const completed = await createItem(f, { blocking: false, createRequestId: "admin-complete" });
    await expect(f.manager.mutation(api.workItems.complete, { workItemId: completed.workItemId, expectedVersion: 0 }))
      .rejects.toThrow(/required/i);
    await expect(f.manager.mutation(api.workItems.complete, { workItemId: completed.workItemId, expectedVersion: 0, resolutionNote: "Covering leave" }))
      .resolves.toMatchObject({ status: "updated" });
  });
});

describe("work item authorization and project state", () => {
  it("denies unrelated Consultants for every managed operation", async () => {
    const f = await setup();
    const created = await createItem(f, { assigneeId: f.ownerId });
    await expect(f.other.mutation(api.workItems.reassign, {
      workItemId: created.workItemId, toAssigneeId: f.otherId, expectedVersion: 0,
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    await expect(f.other.mutation(api.workItems.setBlocking, {
      workItemId: created.workItemId, blocking: false, expectedVersion: 0,
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    await expect(f.other.mutation(api.workItems.changeDueDate, {
      workItemId: created.workItemId, dueAt: Date.now() + 86_400_000, expectedVersion: 0,
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    await expect(f.other.mutation(api.workItems.cancel, {
      workItemId: created.workItemId, expectedVersion: 0,
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    await expect(f.other.mutation(api.workItems.complete, {
      workItemId: created.workItemId, expectedVersion: 0,
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
  });

  it("enforces role and object-level authority", async () => {
    const f = await setup();
    await expect(f.other.mutation(api.workItems.create, {
      projectId: f.projectId, kind: "other", assigneeId: f.assigneeId, blocking: false, instructions: "Task", createRequestId: "unauthorized",
    })).rejects.toThrow(/NOT_AUTHORIZED|permission/i);
    for (const actor of [f.roleless, f.anonymous]) {
      await expect(actor.mutation(api.workItems.create, {
        projectId: f.projectId, kind: "other", assigneeId: f.assigneeId, blocking: false, instructions: "Task", createRequestId: `invalid-${Math.random()}`,
      })).rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED|permission|Authentication/i);
    }
    await expect(f.owner.mutation(api.workItems.create, {
      projectId: f.projectId, kind: "other", assigneeId: f.adminId, blocking: false, instructions: "Task", createRequestId: "admin-assignee",
    })).rejects.toThrow(/Consultant or Manager/i);
    await expect(f.owner.mutation(api.workItems.create, {
      projectId: f.projectId, kind: "financial", assigneeId: f.assigneeId, blocking: false, instructions: "Financial task", createRequestId: "financial",
    })).rejects.toThrow(/Manager or Administrator/i);
  });

  it("denies roleless and anonymous reads and terminal retries", async () => {
    const f = await setup();
    const created = await createItem(f);
    await f.assignee.mutation(api.workItems.complete, {
      workItemId: created.workItemId,
      expectedVersion: 0,
    });
    for (const actor of [f.roleless, f.anonymous]) {
      await expect(actor.query(api.workItems.get, { workItemId: created.workItemId }))
        .rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED/i);
      await expect(actor.query(api.workItems.listByProject, {
        projectId: f.projectId,
        paginationOpts: { cursor: null, numItems: 10 },
      })).rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED/i);
      await expect(actor.mutation(api.workItems.complete, {
        workItemId: created.workItemId,
        expectedVersion: 999,
      })).rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED/i);
    }
  });

  it("lets only the assignee decline and blocks new work on delivered or abandoned projects", async () => {
    const f = await setup();
    const created = await createItem(f);
    await expect(f.owner.mutation(api.workItems.decline, { workItemId: created.workItemId, expectedVersion: 0, reason: "No" }))
      .rejects.toThrow(/current assignee/i);
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { workflowStage: "delivered" }));
    await expect(createItem(f, { blocking: false, createRequestId: "delivered" })).rejects.toThrow(/Reopen/i);
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { workflowStage: "abandoned" }));
    await expect(createItem(f, { blocking: false, createRequestId: "abandoned" })).rejects.toThrow(/Reopen/i);
  });

  it("blocks promotion to a handoff on delivered or abandoned projects", async () => {
    const f = await setup();
    const created = await createItem(f, { blocking: false });
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { workflowStage: "delivered" }));
    await expect(f.owner.mutation(api.workItems.setBlocking, {
      workItemId: created.workItemId,
      blocking: true,
      expectedVersion: 0,
    })).rejects.toThrow(/Reopen|INVALID_STATE/i);
  });

  it("maintains the current-handoff pointer across lifecycle sequences", async () => {
    const operations = ["reassign", "demote", "promote", "complete"] as const;
    for (let seed = 0; seed < 8; seed += 1) {
      const f = await setup();
      const created = await createItem(f);
      let version = 0;
      for (let step = 0; step < 8; step += 1) {
        const operation = operations[(seed + step) % operations.length];
        const item = await f.t.run((ctx) => ctx.db.get(created.workItemId));
        if (!item || item.status !== "open") break;
        version = item.version;
        if (operation === "reassign") {
          const target = item.assigneeId === f.assigneeId ? f.otherId : f.assigneeId;
          await f.owner.mutation(api.workItems.reassign, { workItemId: item._id, toAssigneeId: target, expectedVersion: version });
        } else if (operation === "demote" && item.blocking) {
          await f.owner.mutation(api.workItems.setBlocking, { workItemId: item._id, blocking: false, expectedVersion: version });
        } else if (operation === "promote" && !item.blocking) {
          await f.owner.mutation(api.workItems.setBlocking, { workItemId: item._id, blocking: true, expectedVersion: version });
        } else if (operation === "complete") {
          const actor = item.assigneeId === f.assigneeId ? f.assignee : f.other;
          await actor.mutation(api.workItems.complete, { workItemId: item._id, expectedVersion: version });
        }
        const [stored, project, blockers] = await f.t.run(async (ctx) => [
          await ctx.db.get(created.workItemId),
          await ctx.db.get(f.projectId),
          await ctx.db.query("workItems")
            .withIndex("by_projectId_and_status_and_blocking", (q) =>
              q.eq("projectId", f.projectId).eq("status", "open").eq("blocking", true)
            ).take(2),
        ] as const);
        expect(blockers.length).toBeLessThanOrEqual(1);
        if (stored?.status === "open" && stored.blocking) {
          expect(project?.currentHandoffId).toBe(stored._id);
          expect(blockers[0]?._id).toBe(stored._id);
        } else {
          expect(project?.currentHandoffId).toBeUndefined();
          expect(blockers).toHaveLength(0);
        }
      }
    }
  });

  it("rejects stale lifecycle writes without adding events", async () => {
    const f = await setup();
    const created = await createItem(f);
    await f.owner.mutation(api.workItems.reassign, {
      workItemId: created.workItemId,
      toAssigneeId: f.otherId,
      expectedVersion: 0,
    });
    for (const call of [
      f.owner.mutation(api.workItems.changeDueDate, { workItemId: created.workItemId, dueAt: Date.now(), expectedVersion: 0 }),
      f.owner.mutation(api.workItems.setBlocking, { workItemId: created.workItemId, blocking: false, expectedVersion: 0 }),
      f.other.mutation(api.workItems.complete, { workItemId: created.workItemId, expectedVersion: 0 }),
    ]) {
      await expect(call).rejects.toThrow(/STALE_REVISION|changed/i);
    }
    expect(await itemEvents(f, created.workItemId)).toHaveLength(2);
  });

  it("blocks project deletion while open work remains", async () => {
    const f = await setup();
    await createItem(f, { blocking: false });
    await expect(f.owner.mutation(api.projects.deleteProject, { projectId: f.projectId }))
      .rejects.toThrow(/open work|INVALID_STATE/i);
  });

  it("blocks abandonment with open work and allows it after work is closed", async () => {
    const f = await setup();
    const created = await createItem(f, { blocking: false });
    await expect(f.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId: f.projectId, toStage: "abandoned", note: "No longer proceeding", expectedVersion: 0,
    })).rejects.toThrow(/open work|INVALID_STATE/i);
    await f.owner.mutation(api.workItems.cancel, { workItemId: created.workItemId, expectedVersion: 0, reason: "Scope ended" });
    await expect(f.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId: f.projectId, toStage: "abandoned", note: "No longer proceeding", expectedVersion: 0,
    })).resolves.toMatchObject({ status: "updated", version: 1 });
  });
});
