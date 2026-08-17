/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { WORKFLOW_STAGES, type WorkflowStage } from "../shared/workflowStages";
import {
  WORKFLOW_TRANSITIONS,
  findWorkflowTransition,
} from "../shared/workflowTransitions";

const modules = import.meta.glob("./**/*.ts");

async function setupFixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const adminId = await ctx.db.insert("users", {
      authId: "workflow-admin",
      role: "admin",
      firstName: "Avery",
      lastName: "Admin",
    });
    const managerId = await ctx.db.insert("users", {
      authId: "workflow-manager",
      role: "manager",
      firstName: "Morgan",
      lastName: "Manager",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: "workflow-owner",
      role: "writer",
      firstName: "Olivia",
      lastName: "Owner",
    });
    const otherWriterId = await ctx.db.insert("users", {
      authId: "workflow-other",
      role: "writer",
      firstName: "Taylor",
      lastName: "Writer",
    });
    const rolelessId = await ctx.db.insert("users", {
      authId: "workflow-roleless",
      firstName: "Roleless",
    });
    const anonymousId = await ctx.db.insert("users", {
      authId: "workflow-anonymous",
      role: "writer",
      isAnonymous: true,
    });
    return { adminId, managerId, ownerId, otherWriterId, rolelessId, anonymousId };
  });
  return {
    t,
    ...ids,
    admin: t.withIdentity({ subject: "workflow-admin" }),
    manager: t.withIdentity({ subject: "workflow-manager" }),
    owner: t.withIdentity({ subject: "workflow-owner" }),
    other: t.withIdentity({ subject: "workflow-other" }),
    roleless: t.withIdentity({ subject: "workflow-roleless" }),
    anonymous: t.withIdentity({ subject: "workflow-anonymous" }),
  };
}

type Setup = Awaited<ReturnType<typeof setupFixture>>;

async function insertProject(
  setup: Setup,
  options: {
    stage?: WorkflowStage;
    ownerId?: Id<"users"> | null;
    version?: number;
    review?: boolean;
  } = {}
) {
  return await setup.t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("projects", {
      title: `Workflow ${options.stage ?? "missing"} ${Math.random()}`,
      clientName: "Workflow Client",
      writer: "Historical Writer",
      ...(options.ownerId === null
        ? {}
        : { ownerId: options.ownerId ?? setup.ownerId }),
      ...(options.review ? { ownerBackfillStatus: "needs_review" as const } : {}),
      ...(options.stage ? { workflowStage: options.stage } : {}),
      ...(options.version === undefined ? {} : { workflowVersion: options.version }),
      workflowUpdatedAt: now - 100,
      status: "review",
      createdBy: setup.otherWriterId,
      shareToken: `workflow-${Math.random()}`,
      createdAt: now - 100,
      updatedAt: now - 50,
    });
  });
}

async function projectEvents(setup: Setup, projectId: Id<"projects">) {
  return await setup.t.run(async (ctx) =>
    ctx.db
      .query("projectEvents")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .take(20)
  );
}

describe("workflow transition matrix", () => {
  it("matches the exact approved 47-edge contract", () => {
    expect(WORKFLOW_TRANSITIONS).toHaveLength(47);
    expect(new Set(WORKFLOW_TRANSITIONS.map((rule) => `${rule.from}->${rule.to}`)).size).toBe(47);
    expect(findWorkflowTransition("internal_review", "edits")?.authorities).toContain(
      "handoff_assignee"
    );
    expect(findWorkflowTransition("ready_for_delivery", "delivered")?.requirements).toContain(
      "delivery_outcome"
    );
    expect(findWorkflowTransition("delivered", "on_hold")?.authorities).toEqual([
      "manager",
      "admin",
    ]);
    expect(findWorkflowTransition("abandoned", "drafting")?.requiresNote).toBe(true);
  });

  it("covers every N×N stage pair with success, noop, or the correct typed failure", async () => {
    const setup = await setupFixture();
    for (const from of WORKFLOW_STAGES) {
      for (const to of WORKFLOW_STAGES) {
        const projectId = await insertProject(setup, { stage: from });
        const transition = findWorkflowTransition(from, to);
        const before = Date.now();
        const call = setup.admin.mutation(api.projectWorkflow.setWorkflowStage, {
          projectId,
          toStage: to,
          note: "Matrix test reason",
          expectedVersion: 0,
        });

        if (from === to) {
          await expect(call).resolves.toEqual({ status: "noop", version: 0 });
        } else if (transition?.requirements?.includes("delivery_outcome")) {
          await expect(call).rejects.toThrow(/OUTCOME_REQUIRED|exact delivered/i);
        } else if (transition?.requirements?.includes("promoted_branch")) {
          await expect(call).rejects.toThrow(/INVALID_STATE|promoted report branch/i);
        } else if (transition?.requirements?.includes("review_handoff")) {
          await expect(call).rejects.toThrow(/INVALID_STATE|review handoff/i);
        } else if (transition) {
          await expect(call).resolves.toEqual({ status: "updated", version: 1 });
          const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
          expect(stored).toMatchObject({ workflowStage: to, workflowVersion: 1 });
          expect(stored?.workflowUpdatedAt).toBeGreaterThanOrEqual(before);
        } else {
          await expect(call).rejects.toThrow(/INVALID_TRANSITION|not allowed/i);
        }

        const events = await projectEvents(setup, projectId);
        expect(events).toHaveLength(
          from !== to && transition && !transition.requirements?.length ? 1 : 0
        );
        if (events.length) {
          expect(events[0]).toMatchObject({
            type: "stage_changed",
            actorId: setup.adminId,
            from,
            to,
            note: "Matrix test reason",
          });
        }
      }
    }
  });
});

describe("workflow authorization and validation", () => {
  it("allows owner, manager, and admin while denying unrelated, role-less, anonymous, and unauthenticated actors", async () => {
    const setup = await setupFixture();
    for (const actor of [setup.owner, setup.manager, setup.admin]) {
      const projectId = await insertProject(setup, { stage: "intake" });
      await expect(
        actor.mutation(api.projectWorkflow.setWorkflowStage, {
          projectId,
          toStage: "drafting",
          expectedVersion: 0,
        })
      ).resolves.toMatchObject({ status: "updated" });
    }
    for (const actor of [setup.other, setup.roleless, setup.anonymous]) {
      const projectId = await insertProject(setup, { stage: "intake" });
      await expect(
        actor.mutation(api.projectWorkflow.setWorkflowStage, {
          projectId,
          toStage: "drafting",
          expectedVersion: 0,
        })
      ).rejects.toThrow(/NOT_AUTHORIZED|NOT_AUTHENTICATED|Authentication required|authority|owner/i);
    }
    const projectId = await insertProject(setup, { stage: "intake" });
    await expect(
      setup.t.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "drafting",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_AUTHENTICATED|Authentication/i);
  });

  it("enforces manager/admin-only edges and required audit notes", async () => {
    const setup = await setupFixture();
    const ownerProject = await insertProject(setup, { stage: "delivered" });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: ownerProject,
        toStage: "on_hold",
        note: "Administrative correction",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|authority/i);

    const managerProject = await insertProject(setup, { stage: "delivered" });
    await expect(
      setup.manager.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: managerProject,
        toStage: "on_hold",
        note: "Administrative correction",
        expectedVersion: 0,
      })
    ).resolves.toMatchObject({ status: "updated" });

    for (const transition of WORKFLOW_TRANSITIONS.filter(
      (candidate) => candidate.requiresNote
    )) {
      const projectId = await insertProject(setup, { stage: transition.from });
      await expect(
        setup.admin.mutation(api.projectWorkflow.setWorkflowStage, {
          projectId,
          toStage: transition.to,
          note: "   ",
          expectedVersion: 0,
        })
      ).rejects.toThrow(/INVALID_INPUT|reason/i);
    }
  });

  it("treats a missing stage as intake and uses a monotonic shared OCC version", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "drafting",
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "updated", version: 1 });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "client_review",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/STALE_REVISION|changed/i);
    expect(await projectEvents(setup, projectId)).toEqual([
      expect.objectContaining({ type: "stage_changed", to: "drafting" }),
    ]);
    expect((await projectEvents(setup, projectId))[0]).not.toHaveProperty("from");
  });
});

describe("work-item workflow authority", () => {
  it("allows a valid internal-review handoff to satisfy review resumption and grants only H-authorized edges", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "on_hold" });
    const created = await setup.owner.mutation(api.workItems.create, {
      projectId,
      kind: "internal_review",
      assigneeId: setup.otherWriterId,
      blocking: true,
      instructions: "Review the current draft",
      createRequestId: "workflow-review-handoff",
    });
    const project = await setup.t.run((ctx) => ctx.db.get(projectId));
    expect(project).toMatchObject({ currentHandoffId: created.workItemId, workflowVersion: 1 });
    await expect(setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "internal_review",
      expectedVersion: 1,
    })).resolves.toEqual({ status: "updated", version: 2 });
    await expect(setup.other.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "edits",
      expectedVersion: 2,
    })).resolves.toEqual({ status: "updated", version: 3 });
    await expect(setup.other.mutation(api.projectWorkflow.transferOwnership, {
      projectId,
      toUserId: setup.managerId,
      expectedVersion: 3,
    })).rejects.toThrow(/NOT_AUTHORIZED|owner/i);
  });

  it("rejects missing, wrong-kind, closed, and foreign review handoffs", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "on_hold" });
    const wrongKind = await setup.owner.mutation(api.workItems.create, {
      projectId,
      kind: "other",
      assigneeId: setup.otherWriterId,
      blocking: true,
      instructions: "Other task",
      createRequestId: "wrong-kind",
    });
    await expect(setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "internal_review",
      expectedVersion: 1,
    })).rejects.toThrow(/review handoff|INVALID_STATE/i);
    await setup.owner.mutation(api.workItems.cancel, {
      workItemId: wrongKind.workItemId,
      expectedVersion: 0,
      reason: "Replace task",
    });
    const closed = await setup.owner.mutation(api.workItems.create, {
      projectId,
      kind: "internal_review",
      assigneeId: setup.otherWriterId,
      blocking: true,
      instructions: "Review task",
      createRequestId: "closed-review",
    });
    await setup.owner.mutation(api.workItems.cancel, {
      workItemId: closed.workItemId,
      expectedVersion: 0,
    });
    const afterClose = await setup.t.run((ctx) => ctx.db.get(projectId));
    await expect(setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "internal_review",
      expectedVersion: afterClose?.workflowVersion ?? -1,
    })).rejects.toThrow(/review handoff|INVALID_STATE/i);
  });
});

describe("ownership transfer", () => {
  it("transfers atomically, clears review state, preserves legacy fields, and writes exactly one event", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "drafting", review: true });
    const before = await setup.t.run(async (ctx) => ctx.db.get(projectId));
    await expect(
      setup.owner.mutation(api.projectWorkflow.transferOwnership, {
        projectId,
        toUserId: setup.otherWriterId,
        note: "  Planned handoff  ",
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "updated", version: 1 });
    const after = await setup.t.run(async (ctx) => ctx.db.get(projectId));
    expect(after).toMatchObject({
      ownerId: setup.otherWriterId,
      workflowVersion: 1,
      createdBy: before?.createdBy,
      writer: before?.writer,
      status: before?.status,
      updatedAt: before?.updatedAt,
    });
    expect(after).not.toHaveProperty("ownerBackfillStatus");
    expect(await projectEvents(setup, projectId)).toEqual([
      expect.objectContaining({
        type: "ownership_transferred",
        actorId: setup.ownerId,
        from: setup.ownerId,
        to: setup.otherWriterId,
        note: "Planned handoff",
      }),
    ]);
  });

  it("enforces actor authority, target eligibility, idempotency, and stale-version failure", async () => {
    const setup = await setupFixture();
    const unauthorizedProject = await insertProject(setup);
    await expect(
      setup.other.mutation(api.projectWorkflow.transferOwnership, {
        projectId: unauthorizedProject,
        toUserId: setup.managerId,
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|owner/i);

    const ownerToAdmin = await insertProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.transferOwnership, {
        projectId: ownerToAdmin,
        toUserId: setup.adminId,
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_INPUT|Consultant or Manager/i);

    for (const invalidId of [setup.adminId, setup.rolelessId, setup.anonymousId]) {
      const invalidTarget = await insertProject(setup);
      await expect(
        setup.admin.mutation(api.projectWorkflow.transferOwnership, {
          projectId: invalidTarget,
          toUserId: invalidId,
          expectedVersion: 0,
        })
      ).rejects.toThrow(/INVALID_INPUT|active team member/i);
    }

    const noopProject = await insertProject(setup, { version: 3 });
    await expect(
      setup.owner.mutation(api.projectWorkflow.transferOwnership, {
        projectId: noopProject,
        toUserId: setup.ownerId,
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "noop", version: 3 });
    await expect(
      setup.owner.mutation(api.projectWorkflow.transferOwnership, {
        projectId: noopProject,
        toUserId: setup.ownerId,
        expectedVersion: -1,
      })
    ).rejects.toThrow(/INVALID_INPUT|non-negative integer/i);
    expect(await projectEvents(setup, noopProject)).toHaveLength(0);

    const longNoteProject = await insertProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.transferOwnership, {
        projectId: longNoteProject,
        toUserId: setup.managerId,
        note: "x".repeat(2_001),
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_INPUT|2,000 characters/i);

    const staleProject = await insertProject(setup);
    await setup.manager.mutation(api.projectWorkflow.transferOwnership, {
      projectId: staleProject,
      toUserId: setup.otherWriterId,
      expectedVersion: 0,
    });
    await expect(
      setup.admin.mutation(api.projectWorkflow.transferOwnership, {
        projectId: staleProject,
        toUserId: setup.adminId,
        expectedVersion: 0,
      })
    ).rejects.toThrow(/STALE_REVISION|changed/i);
    expect(await projectEvents(setup, staleProject)).toHaveLength(1);
  });

  it("allows manager/admin first assignment while omitting an absent from-owner", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { ownerId: null });
    await setup.admin.mutation(api.projectWorkflow.transferOwnership, {
      projectId,
      toUserId: setup.managerId,
      expectedVersion: 0,
    });
    const [event] = await projectEvents(setup, projectId);
    expect(event).toMatchObject({ type: "ownership_transferred", to: setup.managerId });
    expect(event).not.toHaveProperty("from");
  });
});
