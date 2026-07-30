import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { query } from "./_generated/server";
import { requireCapability } from "./lib/roleCapabilities";
import { getEffectiveCapabilityLevel } from "./lib/roleCapabilities";
import { domainError } from "./lib/contracts";
import { userDisplayLabel } from "./lib/teamRoster";
import { isFirmDateStart, firmDateStartAfterDays } from "../shared/firmTime";
import { MY_WORK_DUE_SOON_DAYS, MY_WORK_MAX_PAGE_SIZE } from "../shared/workItems";
import { workflowStageRank } from "../shared/workflowStages";

const KILL_SWITCH_KEY = "myWork.killSwitch";
const DEFAULT_VIEW_KEY = "myWork.defaultView";
const READINESS_KEY = "myWork.readiness";

function pageSize(value: number) {
  if (!Number.isFinite(value)) domainError("INVALID_INPUT", "Page size must be finite");
  return Math.min(Math.max(Math.floor(value), 1), MY_WORK_MAX_PAGE_SIZE);
}

function initials(user: Pick<Doc<"users">, "firstName" | "lastName" | "name" | "email">) {
  const label = userDisplayLabel(user);
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}` : label.slice(0, 2)).toUpperCase();
}

async function setting(ctx: QueryCtx, key: string) {
  return await ctx.db.query("appSettings").withIndex("by_key", (q) => q.eq("key", key)).unique();
}

async function viewer(ctx: QueryCtx) {
  const { user } = await requireCapability(ctx, "project.readInternal");
  return user;
}

async function projectAndUsers(ctx: QueryCtx, items: Doc<"workItems">[]) {
  const projects = new Map<Id<"projects">, Doc<"projects">>();
  const users = new Map<Id<"users">, Doc<"users">>();
  for (const projectId of new Set(items.map((item) => item.projectId))) {
    const project = await ctx.db.get(projectId);
    if (project) projects.set(projectId, project);
  }
  for (const userId of new Set(items.flatMap((item) => [item.assigneeId, item.assignerId]))) {
    const user = await ctx.db.get(userId);
    if (user) users.set(userId, user);
  }
  return { projects, users };
}

function party(users: Map<Id<"users">, Doc<"users">>, userId: Id<"users">) {
  const user = users.get(userId);
  return user
    ? { userId, label: userDisplayLabel(user), initials: initials(user) }
    : { userId, label: "Unknown team member", initials: "?" };
}

function permissions(viewerUser: Doc<"users">, item: Doc<"workItems">, project: Doc<"projects">) {
  const manage = getEffectiveCapabilityLevel(viewerUser.role, "workItem.cancelOrReassign");
  return {
    viewerCanComplete: item.assigneeId === viewerUser._id && getEffectiveCapabilityLevel(viewerUser.role, "workItem.completeOwn") !== "none",
    viewerCanCompleteOthers: item.assigneeId !== viewerUser._id && getEffectiveCapabilityLevel(viewerUser.role, "workItem.completeOthers") === "all",
    viewerCanManage:
      manage === "all" ||
      (manage === "own" && (item.assignerId === viewerUser._id || project.ownerId === viewerUser._id)),
  };
}

function workRow(
  viewerUser: Doc<"users">,
  item: Doc<"workItems">,
  project: Doc<"projects">,
  users: Map<Id<"users">, Doc<"users">>
) {
  return {
    workItemId: item._id,
    version: item.version,
    projectId: project._id,
    projectTitle: project.title,
    clientName: project.clientName,
    workflowStage: project.workflowStage ?? "intake",
    stageIsFallback: project.workflowStage === undefined,
    kind: item.kind,
    blocking: item.blocking,
    isCurrentHandoff: project.currentHandoffId === item._id,
    dueAt: item.dueAt ?? null,
    assignee: party(users, item.assigneeId),
    assigner: party(users, item.assignerId),
    ...permissions(viewerUser, item, project),
  };
}

async function projectRows(ctx: QueryCtx, viewerUser: Doc<"users">, items: Doc<"workItems">[]) {
  const { projects, users } = await projectAndUsers(ctx, items);
  return items.flatMap((item) => {
    const project = projects.get(item.projectId);
    return project ? [workRow(viewerUser, item, project, users)] : [];
  });
}

export const getViewConfig = query({
  args: {},
  handler: async (ctx) => {
    await viewer(ctx);
    const [kill, configured, ready] = await Promise.all([
      setting(ctx, KILL_SWITCH_KEY),
      setting(ctx, DEFAULT_VIEW_KEY),
      setting(ctx, READINESS_KEY),
    ]);
    return {
      killSwitch: kill?.value === "on",
      configuredDefault: configured?.value === "my_work" ? "my_work" as const : "all_projects" as const,
      ready: ready?.value === "ready",
    };
  },
});

export const listAssignedToMe = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const result = await ctx.db.query("workItems")
      .withIndex("by_assigneeId_and_status_and_dueSortAt", (q) => q.eq("assigneeId", user._id).eq("status", "open"))
      .order("asc").paginate({ ...args.paginationOpts, numItems: pageSize(args.paginationOpts.numItems) });
    return { ...result, page: await projectRows(ctx, user, result.page) };
  },
});

export const listReviews = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const result = await ctx.db.query("workItems")
      .withIndex("by_assigneeId_and_status_and_kind_and_dueSortAt", (q) => q.eq("assigneeId", user._id).eq("status", "open").eq("kind", "internal_review"))
      .order("asc").paginate({ ...args.paginationOpts, numItems: pageSize(args.paginationOpts.numItems) });
    return { ...result, page: await projectRows(ctx, user, result.page) };
  },
});

export const listDueSoon = query({
  args: { paginationOpts: paginationOptsValidator, windowEndAt: v.number() },
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const expected = firmDateStartAfterDays(Date.now(), MY_WORK_DUE_SOON_DAYS);
    if (!isFirmDateStart(args.windowEndAt) || Math.abs(args.windowEndAt - expected) > 2 * 86_400_000) {
      domainError("INVALID_INPUT", "Due-soon boundary is not a valid Vancouver date boundary");
    }
    const result = await ctx.db.query("workItems")
      .withIndex("by_assigneeId_and_status_and_dueSortAt", (q) => q.eq("assigneeId", user._id).eq("status", "open").lt("dueSortAt", args.windowEndAt))
      .order("asc").paginate({ ...args.paginationOpts, numItems: pageSize(args.paginationOpts.numItems) });
    return { ...result, page: await projectRows(ctx, user, result.page) };
  },
});

async function waitingLaneState(ctx: QueryCtx, viewerId: Id<"users">) {
  const rows = await ctx.db.query("oversightSyncing").withIndex("by_viewerId", (q) => q.eq("viewerId", viewerId)).take(201);
  let syncing = false;
  let failed = false;
  for (const row of rows) {
    const rebuild = await ctx.db.get(row.rebuildId);
    if (rebuild?.status === "failed") failed = true;
    else if (rebuild?.status === "pending" || rebuild?.status === "running") syncing = true;
  }
  if (!failed) {
    const [failedFrom, failedTo] = await Promise.all([
      ctx.db.query("oversightRebuilds").withIndex("by_fromOwnerId_and_status", (q) => q.eq("fromOwnerId", viewerId).eq("status", "failed")).first(),
      ctx.db.query("oversightRebuilds").withIndex("by_toOwnerId_and_status", (q) => q.eq("toOwnerId", viewerId).eq("status", "failed")).first(),
    ]);
    failed = Boolean(failedFrom || failedTo);
  }
  return { syncing, failed };
}

export const getWaitingLaneState = query({
  args: {},
  handler: async (ctx) => {
    const user = await viewer(ctx);
    return await waitingLaneState(ctx, user._id);
  },
});

export const listWaitingOnOthers = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const state = await waitingLaneState(ctx, user._id);
    if (state.failed) return { page: [], isDone: true, continueCursor: "", laneState: "failed" as const };
    if (state.syncing) return { page: [], isDone: true, continueCursor: "", laneState: "syncing" as const };
    const result = await ctx.db.query("workItemOversight")
      .withIndex("by_viewerId_and_dueSortAt", (q) => q.eq("viewerId", user._id))
      .order("asc").paginate({ ...args.paginationOpts, numItems: pageSize(args.paginationOpts.numItems) });
    const items: Doc<"workItems">[] = [];
    for (const row of result.page) {
      const item = await ctx.db.get(row.workItemId);
      if (item?.status === "open" && item.assigneeId !== user._id) items.push(item);
    }
    return { ...result, page: await projectRows(ctx, user, items), laneState: "ok" as const };
  },
});

export const listOwnedByMe = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const user = await viewer(ctx);
    const result = await ctx.db.query("projects")
      .withIndex("by_ownerId_and_workflowStageRank_and_updatedAt", (q) => q.eq("ownerId", user._id))
      .order("asc").paginate({ ...args.paginationOpts, numItems: pageSize(args.paginationOpts.numItems) });
    const page = [];
    for (const project of result.page) {
      const handoff = project.currentHandoffId ? await ctx.db.get(project.currentHandoffId) : null;
      let handoffParties = null;
      if (handoff && handoff.status === "open" && handoff.projectId === project._id) {
        const users = new Map<Id<"users">, Doc<"users">>();
        for (const userId of new Set([handoff.assigneeId, handoff.assignerId])) {
          const member = await ctx.db.get(userId);
          if (member) users.set(userId, member);
        }
        handoffParties = {
          workItemId: handoff._id,
          kind: handoff.kind,
          dueAt: handoff.dueAt ?? null,
          assignee: party(users, handoff.assigneeId),
          assigner: party(users, handoff.assignerId),
        };
      }
      page.push({
        projectId: project._id,
        projectTitle: project.title,
        clientName: project.clientName,
        workflowStage: project.workflowStage ?? "intake",
        stageIsFallback: project.workflowStage === undefined,
        workflowStageRank: project.workflowStageRank ?? workflowStageRank(project.workflowStage),
        updatedAt: project.updatedAt,
        currentHandoff: handoffParties,
      });
    }
    return { ...result, page };
  },
});
