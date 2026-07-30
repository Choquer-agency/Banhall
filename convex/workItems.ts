import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  domainError,
  workflowStageValidator,
  workItemKindValidator,
} from "./lib/contracts";
import { requireCurrentUser } from "./lib/auth";
import {
  getEffectiveCapabilityLevel,
  requireCapability,
} from "./lib/roleCapabilities";
import {
  isTeamRosterMember,
  userDisplayLabel,
} from "./lib/teamRoster";
import {
  MAX_WORK_ITEM_CREATE_REQUEST_ID_CHARS,
  MAX_WORK_ITEM_INSTRUCTIONS_CHARS,
  MAX_WORK_ITEM_INSTRUCTIONS_PREVIEW_CHARS,
  MAX_WORK_ITEM_RESOLUTION_CHARS,
  MAX_WORK_ITEM_DUE_AT,
  workItemDueSortAt,
} from "../shared/workItems";
import { requireEligibleProjectOwner } from "./lib/eligibleOwner";
import { deleteOversightForItem, syncOversightForItem } from "./lib/workItemOversight";
import { workflowStageRank } from "../shared/workflowStages";
import { findWorkflowTransition } from "../shared/workflowTransitions";

function validateVersion(expectedVersion: number) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    domainError("INVALID_INPUT", "Expected work-item version must be a non-negative integer");
  }
}

function boundedText(value: string | undefined, limit: number, label: string, required = false) {
  const normalized = value?.trim() ?? "";
  if (required && !normalized) domainError("INVALID_INPUT", `${label} is required`);
  if (normalized.length > limit) {
    domainError("INVALID_INPUT", `${label} must be ${limit.toLocaleString("en-CA")} characters or fewer`);
  }
  return normalized;
}

function validateDueAt(dueAt: number | undefined) {
  if (dueAt === undefined) return;
  if (!Number.isFinite(dueAt) || !Number.isInteger(dueAt) || dueAt <= 0 || dueAt > MAX_WORK_ITEM_DUE_AT) {
    domainError("INVALID_INPUT", "Due date must be a valid timestamp");
  }
}

function createFingerprint(args: {
  projectId: Id<"projects">;
  kind: Doc<"workItems">["kind"];
  assigneeId: Id<"users">;
  blocking: boolean;
  dueAt?: number;
  instructions: string;
  confirmedStageChange?: "internal_review";
  expectedWorkflowVersion?: number;
}) {
  return JSON.stringify({
    projectId: args.projectId,
    kind: args.kind,
    assigneeId: args.assigneeId,
    blocking: args.blocking,
    dueAt: args.dueAt ?? null,
    instructions: args.instructions,
    confirmedStageChange: args.confirmedStageChange ?? null,
    expectedWorkflowVersion: args.expectedWorkflowVersion ?? null,
  });
}

function initials(user: Pick<Doc<"users">, "firstName" | "lastName" | "name" | "email">) {
  const label = userDisplayLabel(user);
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
    : label.slice(0, 2)
  ).toUpperCase();
}

async function requireInternalActor(ctx: MutationCtx | QueryCtx) {
  const user = await requireCurrentUser(ctx);
  if (user.isAnonymous === true) domainError("NOT_AUTHENTICATED", "Authentication required");
  if (!user.role) domainError("NOT_AUTHORIZED", "An active internal role is required");
  return user;
}

function workItemVersion(item: Doc<"workItems">) {
  return item.version;
}

function assertExpectedVersion(item: Doc<"workItems">, expectedVersion: number) {
  validateVersion(expectedVersion);
  if (workItemVersion(item) !== expectedVersion) {
    domainError("STALE_REVISION", "This work item changed while you were reviewing it");
  }
}

function workflowVersion(project: Doc<"projects">) {
  return project.workflowVersion ?? 0;
}

async function eligibleAssignee(ctx: MutationCtx, userId: Id<"users">) {
  return await requireEligibleProjectOwner(ctx, userId);
}

async function getOpenBlocking(ctx: MutationCtx, projectId: Id<"projects">) {
  const rows = await ctx.db
    .query("workItems")
    .withIndex("by_projectId_and_status_and_blocking", (q) =>
      q.eq("projectId", projectId).eq("status", "open").eq("blocking", true)
    )
    .take(2);
  if (rows.length > 1) domainError("INVALID_STATE", "This project has multiple blocking handoffs");
  return rows[0] ?? null;
}

async function requireOpenItem(ctx: MutationCtx, workItemId: Id<"workItems">) {
  await requireInternalActor(ctx);
  const item = await ctx.db.get(workItemId);
  if (!item) domainError("NOT_FOUND", "Work item not found");
  const project = await ctx.db.get(item.projectId);
  if (!project) domainError("NOT_FOUND", "Project not found");
  return { item, project };
}

async function requireManageAuthority(
  ctx: MutationCtx,
  item: Doc<"workItems">,
  project: Doc<"projects">
) {
  return await requireCapability(ctx, "workItem.cancelOrReassign", {
    ownedBy: [item.assignerId, ...(project.ownerId ? [project.ownerId] : [])],
  });
}

async function assertPointer(ctx: MutationCtx, project: Doc<"projects">, item: Doc<"workItems">) {
  if (!item.blocking || item.status !== "open") return;
  if (project.currentHandoffId !== item._id) {
    domainError("INVALID_STATE", "The project's current handoff pointer is inconsistent");
  }
  const blocking = await getOpenBlocking(ctx, project._id);
  if (blocking?._id !== item._id) {
    domainError("INVALID_STATE", "The project's blocking handoff is inconsistent");
  }
}

async function patchWorkflowPointer(
  ctx: MutationCtx,
  project: Doc<"projects">,
  currentHandoffId: Id<"workItems"> | undefined
) {
  await ctx.db.patch(project._id, {
    currentHandoffId,
    workflowVersion: workflowVersion(project) + 1,
    workflowUpdatedAt: Date.now(),
  });
}

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    kind: workItemKindValidator,
    assigneeId: v.id("users"),
    blocking: v.boolean(),
    dueAt: v.optional(v.number()),
    instructions: v.string(),
    createRequestId: v.string(),
    confirmedStageChange: v.optional(v.literal("internal_review")),
    expectedWorkflowVersion: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireInternalActor(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");
    const { user } = await requireCapability(ctx, "workItem.create", {
      ownedBy: project.ownerId ? [project.ownerId] : [],
    });
    if (args.kind === "financial" && user.role !== "manager" && user.role !== "admin") {
      domainError("NOT_AUTHORIZED", "Only a Manager or Administrator can create financial work items");
    }
    const instructions = boundedText(args.instructions, MAX_WORK_ITEM_INSTRUCTIONS_CHARS, "Instructions", true);
    if (args.confirmedStageChange && args.expectedWorkflowVersion === undefined) {
      domainError("INVALID_INPUT", "Expected workflow version is required for a confirmed Stage change");
    }
    if (args.expectedWorkflowVersion !== undefined) validateVersion(args.expectedWorkflowVersion);
    const createRequestId = boundedText(
      args.createRequestId,
      MAX_WORK_ITEM_CREATE_REQUEST_ID_CHARS,
      "Create request ID",
      true
    );
    validateDueAt(args.dueAt);
    const fingerprint = createFingerprint({ ...args, instructions });
    const replays = await ctx.db
      .query("workItems")
      .withIndex("by_assignerId_and_createRequestId", (q) =>
        q.eq("assignerId", actor._id).eq("createRequestId", createRequestId)
      )
      .take(2);
    if (replays.length > 1) domainError("INVALID_STATE", "Duplicate work-item create request IDs exist");
    const replay = replays[0];
    if (replay) {
      if (replay.createRequestFingerprint !== fingerprint) {
        domainError("INVALID_INPUT", "This create request ID was already used with different values");
      }
      const replayProject = await ctx.db.get(replay.projectId);
      return {
        status: "noop" as const,
        workItemId: replay._id,
        version: replay.version,
        workflowVersion: replayProject ? workflowVersion(replayProject) : 0,
        stageChanged: args.confirmedStageChange === "internal_review",
      };
    }
    if (project.workflowStage === "delivered" || project.workflowStage === "abandoned") {
      domainError("INVALID_STATE", "Reopen this project before assigning new work");
    }
    await eligibleAssignee(ctx, args.assigneeId);
    if (args.blocking) {
      const existing = await getOpenBlocking(ctx, project._id);
      if (existing) {
        domainError("BLOCKING_EXISTS", "This project already has an open blocking handoff", {
          workItemId: existing._id,
        });
      }
      if (project.currentHandoffId) {
        domainError("INVALID_STATE", "The project's current handoff pointer is inconsistent");
      }
    }
    const fromStage = project.workflowStage ?? "intake";
    if (args.confirmedStageChange) {
      if (args.kind !== "internal_review" || args.blocking !== true) {
        domainError("INVALID_INPUT", "A confirmed Internal review Stage requires a blocking internal-review item");
      }
      if (workflowVersion(project) !== args.expectedWorkflowVersion) {
        domainError("STALE_REVISION", "The project workflow changed while you were reviewing it");
      }
      const transition = findWorkflowTransition(fromStage, "internal_review");
      const authorized = transition?.authorities.some((authority) =>
        authority === "owner"
          ? project.ownerId === user._id
          : authority === "manager"
            ? user.role === "manager"
            : authority === "admin" && user.role === "admin"
      );
      if (!transition || !authorized) {
        domainError("NOT_AUTHORIZED", "You cannot move this project to Internal review");
      }
    }
    const now = Date.now();
    const workItemId = await ctx.db.insert("workItems", {
      projectId: project._id,
      kind: args.kind,
      assigneeId: args.assigneeId,
      assignerId: user._id,
      ...(args.dueAt === undefined ? {} : { dueAt: args.dueAt }),
      dueSortAt: workItemDueSortAt(args.dueAt),
      instructions,
      blocking: args.blocking,
      status: "open",
      version: 0,
      createRequestId,
      createRequestFingerprint: fingerprint,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("workItemEvents", {
      workItemId,
      projectId: project._id,
      type: "created",
      actorId: user._id,
      at: now,
      itemVersion: 0,
      detail: {
        kind: args.kind,
        assigneeId: args.assigneeId,
        blocking: args.blocking,
        ...(args.dueAt === undefined ? {} : { dueAt: args.dueAt }),
      },
    });
    if (args.confirmedStageChange) {
      const nextWorkflowVersion = workflowVersion(project) + 1;
      await ctx.db.patch(project._id, {
        currentHandoffId: workItemId,
        workflowStage: "internal_review",
        workflowStageRank: workflowStageRank("internal_review"),
        workflowVersion: nextWorkflowVersion,
        workflowUpdatedAt: now,
      });
      await ctx.db.insert("projectEvents", {
        projectId: project._id,
        type: "stage_changed",
        actorId: user._id,
        ...(project.workflowStage ? { from: project.workflowStage } : {}),
        to: "internal_review",
        at: now,
      });
      const createdItem = await ctx.db.get(workItemId);
      if (createdItem) await syncOversightForItem(ctx, createdItem, { ...project, ownerId: project.ownerId });
      return {
        status: "created" as const,
        workItemId,
        version: 0,
        workflowVersion: nextWorkflowVersion,
        stageChanged: true,
      };
    }
    if (args.blocking) await patchWorkflowPointer(ctx, project, workItemId);
    const createdItem = await ctx.db.get(workItemId);
    if (createdItem) await syncOversightForItem(ctx, createdItem, project);
    return {
      status: "created" as const,
      workItemId,
      version: 0,
      workflowVersion: args.blocking ? workflowVersion(project) + 1 : workflowVersion(project),
      stageChanged: false,
    };
  },
});

export const reassign = mutation({
  args: {
    workItemId: v.id("workItems"),
    toAssigneeId: v.id("users"),
    note: v.optional(v.string()),
    expectedVersion: v.number(),
  },
  handler: async (ctx, args) => {
    const { item, project } = await requireOpenItem(ctx, args.workItemId);
    const { user } = await requireManageAuthority(ctx, item, project);
    validateVersion(args.expectedVersion);
    if (item.status !== "open") domainError("INVALID_STATE", "Closed work items cannot be reassigned");
    if (item.assigneeId === args.toAssigneeId) {
      return { status: "noop" as const, version: item.version };
    }
    assertExpectedVersion(item, args.expectedVersion);
    await eligibleAssignee(ctx, args.toAssigneeId);
    await assertPointer(ctx, project, item);
    const note = boundedText(args.note, MAX_WORK_ITEM_RESOLUTION_CHARS, "Reassignment note");
    const now = Date.now();
    const version = item.version + 1;
    await ctx.db.patch(item._id, { assigneeId: args.toAssigneeId, version, updatedAt: now });
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "reassigned", actorId: user._id,
      at: now, itemVersion: version,
      detail: { fromAssigneeId: item.assigneeId, toAssigneeId: args.toAssigneeId, ...(note ? { note } : {}) },
    });
    if (item.blocking) await patchWorkflowPointer(ctx, project, item._id);
    await syncOversightForItem(ctx, { ...item, assigneeId: args.toAssigneeId, version, updatedAt: now }, project);
    return { status: "updated" as const, version };
  },
});

export const setBlocking = mutation({
  args: { workItemId: v.id("workItems"), blocking: v.boolean(), note: v.optional(v.string()), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const { item, project } = await requireOpenItem(ctx, args.workItemId);
    const { user } = await requireManageAuthority(ctx, item, project);
    validateVersion(args.expectedVersion);
    if (item.status !== "open") domainError("INVALID_STATE", "Closed work items cannot change handoff status");
    if (item.blocking && item.blocking === args.blocking) await assertPointer(ctx, project, item);
    if (item.blocking === args.blocking) return { status: "noop" as const, version: item.version };
    assertExpectedVersion(item, args.expectedVersion);
    const note = boundedText(args.note, MAX_WORK_ITEM_RESOLUTION_CHARS, "Handoff note");
    if (
      args.blocking &&
      (project.workflowStage === "delivered" || project.workflowStage === "abandoned")
    ) {
      domainError("INVALID_STATE", "Reopen this project before creating a blocking handoff");
    }
    if (args.blocking) {
      const existing = await getOpenBlocking(ctx, project._id);
      if (existing) domainError("BLOCKING_EXISTS", "This project already has an open blocking handoff", { workItemId: existing._id });
      if (project.currentHandoffId) domainError("INVALID_STATE", "The project's current handoff pointer is inconsistent");
    } else {
      await assertPointer(ctx, project, item);
    }
    const now = Date.now();
    const version = item.version + 1;
    await ctx.db.patch(item._id, { blocking: args.blocking, version, updatedAt: now });
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "blocking_changed", actorId: user._id,
      at: now, itemVersion: version,
      detail: { fromBlocking: item.blocking, toBlocking: args.blocking, ...(note ? { note } : {}) },
    });
    await patchWorkflowPointer(ctx, project, args.blocking ? item._id : undefined);
    return { status: "updated" as const, version };
  },
});

export const changeDueDate = mutation({
  args: { workItemId: v.id("workItems"), dueAt: v.optional(v.number()), note: v.optional(v.string()), expectedVersion: v.number() },
  handler: async (ctx, args) => {
    const { item, project } = await requireOpenItem(ctx, args.workItemId);
    const { user } = await requireManageAuthority(ctx, item, project);
    validateVersion(args.expectedVersion);
    validateDueAt(args.dueAt);
    if (item.status !== "open") domainError("INVALID_STATE", "Closed work items cannot change due dates");
    if (item.dueAt === args.dueAt) return { status: "noop" as const, version: item.version };
    assertExpectedVersion(item, args.expectedVersion);
    const note = boundedText(args.note, MAX_WORK_ITEM_RESOLUTION_CHARS, "Due-date note");
    const now = Date.now();
    const version = item.version + 1;
    await ctx.db.patch(item._id, { dueAt: args.dueAt, dueSortAt: workItemDueSortAt(args.dueAt), version, updatedAt: now });
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "due_changed", actorId: user._id,
      at: now, itemVersion: version,
      detail: { ...(item.dueAt === undefined ? {} : { fromDueAt: item.dueAt }), ...(args.dueAt === undefined ? {} : { toDueAt: args.dueAt }), ...(note ? { note } : {}) },
    });
    await syncOversightForItem(ctx, { ...item, dueAt: args.dueAt, dueSortAt: workItemDueSortAt(args.dueAt), version, updatedAt: now }, project);
    return { status: "updated" as const, version };
  },
});

async function closeItem(
  ctx: MutationCtx,
  args: { workItemId: Id<"workItems">; expectedVersion: number; resolutionNote?: string },
  target: "completed" | "declined" | "canceled"
) {
  const user = await requireInternalActor(ctx);
  const { item, project } = await requireOpenItem(ctx, args.workItemId);
  validateVersion(args.expectedVersion);
  let onBehalfOfAssignee = false;
  if (target === "completed") {
    if (user._id === item.assigneeId) {
      await requireCapability(ctx, "workItem.completeOwn", { ownedBy: [item.assigneeId] });
    } else {
      await requireCapability(ctx, "workItem.completeOthers");
      onBehalfOfAssignee = true;
    }
  } else if (target === "declined") {
    if (user._id !== item.assigneeId) domainError("NOT_AUTHORIZED", "Only the current assignee can decline this work item");
    await requireCapability(ctx, "workItem.completeOwn", { ownedBy: [item.assigneeId] });
  } else {
    await requireManageAuthority(ctx, item, project);
  }
  if (item.status === target) {
    return { status: "noop" as const, version: item.version };
  }
  if (item.status !== "open") domainError("INVALID_STATE", "This work item is already closed");
  assertExpectedVersion(item, args.expectedVersion);
  await assertPointer(ctx, project, item);
  const required = target === "declined" || (target === "completed" && onBehalfOfAssignee);
  const resolutionNote = boundedText(
    args.resolutionNote,
    MAX_WORK_ITEM_RESOLUTION_CHARS,
    target === "declined" ? "Decline reason" : "Resolution note",
    required
  );
  const now = Date.now();
  const version = item.version + 1;
  await ctx.db.patch(item._id, {
    status: target,
    completedAt: now,
    completedBy: user._id,
    ...(resolutionNote ? { resolutionNote } : {}),
    version,
    updatedAt: now,
  });
  if (target === "completed") {
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "completed", actorId: user._id,
      at: now, itemVersion: version,
      detail: { ...(resolutionNote ? { resolutionNote } : {}), onBehalfOfAssignee },
    });
  } else if (target === "declined") {
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "declined", actorId: user._id,
      at: now, itemVersion: version, detail: { reason: resolutionNote },
    });
  } else {
    await ctx.db.insert("workItemEvents", {
      workItemId: item._id, projectId: item.projectId, type: "canceled", actorId: user._id,
      at: now, itemVersion: version, detail: { ...(resolutionNote ? { reason: resolutionNote } : {}) },
    });
  }
  if (item.blocking) await patchWorkflowPointer(ctx, project, undefined);
  await deleteOversightForItem(ctx, item._id);
  return { status: "updated" as const, version };
}

export const complete = mutation({
  args: { workItemId: v.id("workItems"), expectedVersion: v.number(), resolutionNote: v.optional(v.string()) },
  handler: async (ctx, args) => await closeItem(ctx, args, "completed"),
});

export const decline = mutation({
  args: { workItemId: v.id("workItems"), expectedVersion: v.number(), reason: v.string() },
  handler: async (ctx, args) => await closeItem(ctx, { ...args, resolutionNote: args.reason }, "declined"),
});

export const cancel = mutation({
  args: { workItemId: v.id("workItems"), expectedVersion: v.number(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => await closeItem(ctx, { ...args, resolutionNote: args.reason }, "canceled"),
});

export const getProjectWorkPanel = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    if (user.isAnonymous === true || !user.role) return null;
    if (getEffectiveCapabilityLevel(user.role, "project.readInternal") === "none") return null;
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    const rows = await ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status_and_dueAt", (q) =>
        q.eq("projectId", project._id).eq("status", "open")
      )
      .take(51);
    const openItems = rows.slice(0, 50);
    const manageLevel = getEffectiveCapabilityLevel(user.role, "workItem.cancelOrReassign");
    const blockers = await ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status_and_blocking", (q) =>
        q.eq("projectId", project._id).eq("status", "open").eq("blocking", true)
      )
      .take(2);
    const currentHandoff = blockers.length === 1 && project.currentHandoffId === blockers[0]._id
      ? blockers[0]
      : null;
    const projectedItems = [
      ...(currentHandoff && !openItems.some((item) => item._id === currentHandoff._id) ? [currentHandoff] : []),
      ...openItems,
    ];
    const userIds = new Set<Id<"users">>();
    for (const item of projectedItems) {
      userIds.add(item.assigneeId);
      userIds.add(item.assignerId);
    }
    const users = new Map<Id<"users">, Doc<"users">>();
    for (const userId of userIds) {
      const member = await ctx.db.get(userId);
      if (member) users.set(userId, member);
    }
    const summarizeParty = (userId: Id<"users">) => {
      const party = users.get(userId);
      return party
        ? { userId, label: userDisplayLabel(party), initials: initials(party) }
        : { userId, label: "Unknown team member", initials: "?" };
    };
    return {
      projectStage: project.workflowStage ?? "intake",
      stageIsFallback: project.workflowStage === undefined,
      workflowVersion: workflowVersion(project),
      assignable: project.workflowStage !== "delivered" && project.workflowStage !== "abandoned",
      assignableReason:
        project.workflowStage === "delivered" || project.workflowStage === "abandoned"
          ? "Reopen this project before assigning new work."
          : null,
      pointerHealthy:
        (blockers.length === 0 && !project.currentHandoffId) ||
        (blockers.length === 1 && project.currentHandoffId === blockers[0]._id),
      viewer: {
        userId: user._id,
        canCreate:
          getEffectiveCapabilityLevel(user.role, "workItem.create") === "all" ||
          project.ownerId === user._id,
        canCreateFinancial: user.role === "manager" || user.role === "admin",
      },
      currentHandoffId: currentHandoff?._id ?? null,
      openItems: projectedItems.map((item) => ({
        workItemId: item._id,
        kind: item.kind,
        blocking: item.blocking,
        isCurrentHandoff: currentHandoff?._id === item._id,
        dueAt: item.dueAt ?? null,
        instructionsPreview:
          item.instructions.length > MAX_WORK_ITEM_INSTRUCTIONS_PREVIEW_CHARS
            ? `${item.instructions.slice(0, MAX_WORK_ITEM_INSTRUCTIONS_PREVIEW_CHARS - 1)}…`
            : item.instructions,
        instructionsTruncated: item.instructions.length > MAX_WORK_ITEM_INSTRUCTIONS_PREVIEW_CHARS,
        version: item.version,
        createdAt: item.createdAt,
        assignee: summarizeParty(item.assigneeId),
        assigner: summarizeParty(item.assignerId),
        viewerCanManage:
          manageLevel === "all" ||
          (manageLevel === "own" &&
            (item.assignerId === user._id || project.ownerId === user._id)),
      })),
      truncated: rows.length > 50,
    };
  },
});

export const listAssigneeCandidates = query({
  args: { projectId: v.id("projects"), workItemId: v.optional(v.id("workItems")) },
  handler: async (ctx, args) => {
    await requireInternalActor(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");
    if (args.workItemId) {
      const item = await ctx.db.get(args.workItemId);
      if (!item || item.projectId !== project._id) domainError("NOT_FOUND", "Work item not found");
      await requireCapability(ctx, "workItem.cancelOrReassign", {
        ownedBy: [item.assignerId, ...(project.ownerId ? [project.ownerId] : [])],
      });
    } else {
      await requireCapability(ctx, "workItem.create", {
        ownedBy: project.ownerId ? [project.ownerId] : [],
      });
    }
    const page = await ctx.db.query("users").take(201);
    const candidates = page
      .slice(0, 200)
      .filter(
        (candidate): candidate is Doc<"users"> & { role: "writer" | "manager" } =>
          isTeamRosterMember(candidate) &&
          (candidate.role === "writer" || candidate.role === "manager")
      )
      .map((candidate) => ({
        userId: candidate._id,
        label: userDisplayLabel(candidate),
        initials: initials(candidate),
        email: candidate.email?.trim() || null,
        role: candidate.role,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) || a.userId.localeCompare(b.userId));
    return { candidates, truncated: page.length > 200 };
  },
});

export const get = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "project.readInternal");
    return await ctx.db.get(args.workItemId);
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects"), status: v.optional(v.union(v.literal("open"), v.literal("completed"), v.literal("declined"), v.literal("canceled"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireCapability(ctx, "project.readInternal");
    if (!Number.isFinite(args.paginationOpts.numItems)) {
      domainError("INVALID_INPUT", "Page size must be a finite number");
    }
    const numItems = Math.min(Math.max(Math.floor(args.paginationOpts.numItems), 1), 100);
    if (args.status) {
      return await ctx.db.query("workItems")
        .withIndex("by_projectId_and_status_and_dueAt", (q) => q.eq("projectId", args.projectId).eq("status", args.status!))
        .paginate({ ...args.paginationOpts, numItems });
    }
    return await ctx.db.query("workItems")
      .withIndex("by_projectId_and_status", (q) => q.eq("projectId", args.projectId))
      .paginate({ ...args.paginationOpts, numItems });
  },
});
