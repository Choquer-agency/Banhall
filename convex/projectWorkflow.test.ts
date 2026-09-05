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
  reviewDecisionForStage,
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

async function insertReport(
  setup: Setup,
  projectId: Id<"projects">,
  options: { legacy?: boolean; content?: string; contentHash?: string } = {}
) {
  const content = options.content ?? "Reviewed report content";
  return await setup.t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("reports", {
      projectId,
      content,
      version: 1,
      generatedAt: now - 100,
      updatedAt: now - 50,
      // A legacy row predates revisionNumber/contentHash; the decision row must
      // still pin a revision (0) and a freshly computed hash. `contentHash` is
      // overridable so the empty-string case can be driven explicitly.
      ...(options.legacy
        ? {}
        : { revisionNumber: 3, contentHash: options.contentHash ?? "hash-of-revision-3" }),
    });
  });
}

async function reviewDecisions(setup: Setup, projectId: Id<"projects">) {
  return await setup.t.run(async (ctx) =>
    ctx.db
      .query("reviewDecisions")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      // collect, not take(n): a bug that writes extra rows must fail a length
      // assertion rather than be silently truncated by the fence itself.
      .collect()
  );
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
  it("generates the full open matrix with the per-edge policy contract", () => {
    const fullSize = WORKFLOW_STAGES.length * (WORKFLOW_STAGES.length - 1);
    expect(WORKFLOW_TRANSITIONS).toHaveLength(fullSize);
    expect(new Set(WORKFLOW_TRANSITIONS.map((rule) => `${rule.from}->${rule.to}`)).size).toBe(
      fullSize
    );
    // Direct jumps exist (the 2026-08-17 amendment's motivating case).
    expect(findWorkflowTransition("intake", "internal_review")?.authorities).toEqual([
      "owner",
      "manager",
      "admin",
    ]);
    // Preserved policy: H on review completion, fail-closed requirements,
    // M/A-only terminal-stage exits, audit notes on pauses and reopenings.
    expect(findWorkflowTransition("internal_review", "edits")?.authorities).toContain(
      "handoff_assignee"
    );
    expect(findWorkflowTransition("internal_review", "drafting")?.authorities).not.toContain(
      "handoff_assignee"
    );
    expect(findWorkflowTransition("ready_for_delivery", "delivered")?.requirements).toContain(
      "delivery_outcome"
    );
    expect(findWorkflowTransition("intake", "delivered")?.requirements).toContain(
      "delivery_outcome"
    );
    expect(findWorkflowTransition("intake", "ready_for_delivery")?.requirements).toContain(
      "promoted_branch"
    );
    expect(findWorkflowTransition("delivered", "on_hold")?.authorities).toEqual([
      "manager",
      "admin",
    ]);
    expect(findWorkflowTransition("delivered", "drafting")?.requiresNote).toBe(true);
    expect(findWorkflowTransition("abandoned", "drafting")?.authorities).toEqual([
      "manager",
      "admin",
    ]);
    expect(findWorkflowTransition("abandoned", "drafting")?.requiresNote).toBe(true);
    expect(findWorkflowTransition("intake", "on_hold")?.requiresNote).toBe(true);
    expect(findWorkflowTransition("on_hold", "internal_review")?.requirements).toBeUndefined();
  });

  it("covers every N×N stage pair with success, noop, or the correct typed failure", async () => {
    const setup = await setupFixture();
    for (const from of WORKFLOW_STAGES) {
      for (const to of WORKFLOW_STAGES) {
        const projectId = await insertProject(setup, { stage: from });
        // Every project carries a report so the review-decision edges can pin
        // one; unrelated edges are unaffected by its presence.
        await insertReport(setup, projectId);
        const transition = findWorkflowTransition(from, to);
        const decision = transition?.requirements?.includes("review_decision")
          ? reviewDecisionForStage(to)
          : undefined;
        const before = Date.now();
        const call = setup.admin.mutation(api.projectWorkflow.setWorkflowStage, {
          projectId,
          toStage: to,
          note: "Matrix test reason",
          ...(decision ? { reviewDecision: { decision } } : {}),
          expectedVersion: 0,
        });

        if (from === to) {
          await expect(call).resolves.toEqual({ status: "noop", version: 0 });
        } else if (
          transition?.requirements?.includes("review_decision") &&
          transition.requirements.length === 1
        ) {
          // internal_review -> edits: the decision is supplied above, so the
          // edge succeeds and records exactly one decision row.
          await expect(call).resolves.toEqual({ status: "updated", version: 1 });
          const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
          expect(stored).toMatchObject({ workflowStage: to, workflowVersion: 1 });
          expect(await reviewDecisions(setup, projectId)).toHaveLength(1);
        } else if (transition?.requirements?.includes("delivery_outcome")) {
          await expect(call).rejects.toThrow(/OUTCOME_REQUIRED|exact delivered/i);
        } else if (transition?.requirements?.includes("promoted_branch")) {
          await expect(call).rejects.toThrow(/INVALID_STATE|promoted report branch/i);
        } else if (transition) {
          await expect(call).resolves.toEqual({ status: "updated", version: 1 });
          const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
          expect(stored).toMatchObject({ workflowStage: to, workflowVersion: 1 });
          expect(stored?.workflowUpdatedAt).toBeGreaterThanOrEqual(before);
        } else {
          // Open matrix: every from≠to pair must have a transition rule.
          await call.catch(() => undefined);
          expect.unreachable(`missing transition ${from} -> ${to}`);
        }

        const events = await projectEvents(setup, projectId);
        // An event is written exactly when the edge actually succeeded: no
        // requirements at all, or only the review decision (which was supplied).
        const succeeded =
          from !== to &&
          Boolean(transition) &&
          !transition!.requirements?.some(
            (requirement) => requirement !== "review_decision"
          );
        expect(events).toHaveLength(succeeded ? 1 : 0);
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

  it("keeps abandoned reopening Manager/Admin-only and scopes H authority to review completion edges", async () => {
    const setup = await setupFixture();
    const abandonedProject = await insertProject(setup, { stage: "abandoned" });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: abandonedProject,
        toStage: "drafting",
        note: "Owner reopen attempt",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|authority/i);
    await expect(
      setup.manager.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: abandonedProject,
        toStage: "drafting",
        note: "Manager reopen",
        expectedVersion: 0,
      })
    ).resolves.toMatchObject({ status: "updated" });

    const reviewProject = await insertProject(setup, { stage: "internal_review" });
    await setup.owner.mutation(api.workItems.create, {
      projectId: reviewProject,
      kind: "internal_review",
      assigneeId: setup.otherWriterId,
      blocking: true,
      instructions: "Review the draft",
      createRequestId: "h-authority-scope",
    });
    const afterCreate = await setup.t.run((ctx) => ctx.db.get(reviewProject));
    // The active handoff assignee may complete review (→ edits) but has no
    // authority on any other edge out of internal_review.
    await expect(
      setup.other.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: reviewProject,
        toStage: "drafting",
        expectedVersion: afterCreate?.workflowVersion ?? -1,
      })
    ).rejects.toThrow(/NOT_AUTHORIZED|authority/i);
    await insertReport(setup, reviewProject);
    await expect(
      setup.other.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId: reviewProject,
        toStage: "edits",
        reviewDecision: { decision: "return" },
        expectedVersion: afterCreate?.workflowVersion ?? -1,
      })
    ).resolves.toMatchObject({ status: "updated" });
    // Attribution follows the actual actor: the handoff assignee completed
    // this review, not the project owner.
    const decisions = await reviewDecisions(setup, reviewProject);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].reviewerId).toBe(setup.otherWriterId);
    expect(decisions[0].reviewerId).not.toBe(setup.ownerId);
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
    await insertReport(setup, projectId);
    await expect(setup.other.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "edits",
      reviewDecision: { decision: "return" },
      expectedVersion: 2,
    })).resolves.toEqual({ status: "updated", version: 3 });
    await expect(setup.other.mutation(api.projectWorkflow.transferOwnership, {
      projectId,
      toUserId: setup.managerId,
      expectedVersion: 3,
    })).rejects.toThrow(/NOT_AUTHORIZED|owner/i);
  });

  it("enters internal review without a handoff and revokes H authority once the handoff closes", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "on_hold" });
    // Stage and assignment are separate records (2026-08-17 open-matrix
    // amendment): no active review handoff is required to enter the stage.
    await expect(setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "internal_review",
      expectedVersion: 0,
    })).resolves.toEqual({ status: "updated", version: 1 });
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
    await expect(setup.other.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId,
      toStage: "edits",
      expectedVersion: afterClose?.workflowVersion ?? -1,
    })).rejects.toThrow(/NOT_AUTHORIZED|authority/i);
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

describe("review decisions on internal-review completion", () => {
  async function reviewProject(setup: Setup, options: { report?: boolean; legacy?: boolean } = {}) {
    const projectId = await insertProject(setup, { stage: "internal_review" });
    if (options.report !== false) {
      await insertReport(setup, projectId, { legacy: options.legacy === true });
    }
    return projectId;
  }

  it("records the reviewer decision pinned to the report revision alongside one stage event", async () => {
    const setup = await setupFixture();
    const projectId = await reviewProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        note: "  Needs tighter uncertainty  ",
        reviewDecision: { decision: "return" },
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "updated", version: 1 });

    const decisions = await reviewDecisions(setup, projectId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({
      projectId,
      reviewerId: setup.ownerId,
      revisionNumber: 3,
      contentHash: "hash-of-revision-3",
      decision: "return",
      toStage: "edits",
      note: "Needs tighter uncertainty",
    });
    const report = await setup.t.run(async (ctx) => ctx.db.get(decisions[0].reportId));
    expect(report?.projectId).toBe(projectId);

    const events = await projectEvents(setup, projectId);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "stage_changed", from: "internal_review", to: "edits" });
  });

  it("rejects the edits edge with REVIEW_DECISION_REQUIRED and writes nothing when the decision is missing", async () => {
    const setup = await setupFixture();
    const projectId = await reviewProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/REVIEW_DECISION_REQUIRED|approve or return/i);
    const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
    expect(stored).toMatchObject({ workflowStage: "internal_review" });
    expect(stored?.workflowVersion ?? 0).toBe(0);
    expect(await projectEvents(setup, projectId)).toHaveLength(0);
    expect(await reviewDecisions(setup, projectId)).toHaveLength(0);
  });

  it("rejects the ready_for_delivery edge for the missing decision before the promoted-branch check", async () => {
    const setup = await setupFixture();
    const projectId = await reviewProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "ready_for_delivery",
        expectedVersion: 0,
      })
    ).rejects.toThrow(/REVIEW_DECISION_REQUIRED|approve or return/i);
    // With the decision supplied the edge reaches the pre-existing fail-closed
    // promoted-branch requirement instead.
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "ready_for_delivery",
        reviewDecision: { decision: "approve" },
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_STATE|promoted report branch/i);
    expect(await reviewDecisions(setup, projectId)).toHaveLength(0);
  });

  it("rejects a decision that contradicts the destination edge", async () => {
    const setup = await setupFixture();
    const projectId = await reviewProject(setup);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        reviewDecision: { decision: "approve" },
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_INPUT|does not match/i);
    expect(await reviewDecisions(setup, projectId)).toHaveLength(0);
    expect(await projectEvents(setup, projectId)).toHaveLength(0);
  });

  it("rejects a decision supplied on an unrelated edge rather than dropping it", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "drafting" });
    await insertReport(setup, projectId);
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "client_review",
        reviewDecision: { decision: "approve" },
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_INPUT|only to internal-review/i);
    const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
    expect(stored).toMatchObject({ workflowStage: "drafting" });
    expect(await reviewDecisions(setup, projectId)).toHaveLength(0);
  });

  it("refuses to complete the review when the project has no report to pin the decision to", async () => {
    const setup = await setupFixture();
    const projectId = await reviewProject(setup, { report: false });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        reviewDecision: { decision: "return" },
        expectedVersion: 0,
      })
    ).rejects.toThrow(/INVALID_STATE|no report revision/i);
    const stored = await setup.t.run(async (ctx) => ctx.db.get(projectId));
    expect(stored).toMatchObject({ workflowStage: "internal_review" });
    expect(await reviewDecisions(setup, projectId)).toHaveLength(0);
  });

  it("pins revision 0 and a freshly computed hash for a legacy report row", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "internal_review" });
    await insertReport(setup, projectId, { legacy: true, content: "legacy body" });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        reviewDecision: { decision: "return" },
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "updated", version: 1 });
    const decisions = await reviewDecisions(setup, projectId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].revisionNumber).toBe(0);
    expect(decisions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(decisions[0].note).toBeUndefined();
  });

  it("recomputes the hash for a report whose stored contentHash is an empty string", async () => {
    const setup = await setupFixture();
    const projectId = await insertProject(setup, { stage: "internal_review" });
    // A stored "" is as unusable as an absent hash. This pins the falsy check
    // in the mutation: with a nullish (`??`) fallback the empty string would be
    // copied straight into the audit row and no other test would notice.
    await insertReport(setup, projectId, { contentHash: "", content: "hashless body" });
    await expect(
      setup.owner.mutation(api.projectWorkflow.setWorkflowStage, {
        projectId,
        toStage: "edits",
        reviewDecision: { decision: "return" },
        expectedVersion: 0,
      })
    ).resolves.toEqual({ status: "updated", version: 1 });
    const decisions = await reviewDecisions(setup, projectId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    // The revision itself is still the stored one, not the legacy fallback.
    expect(decisions[0].revisionNumber).toBe(3);
  });
});
