import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { getInternalProjectAccessOrNull } from "./lib/auth";
import { requireCapability } from "./lib/roleCapabilities";
import {
  domainError,
  workflowStageValidator,
} from "./lib/contracts";
import {
  getTeamRosterMemberOrNull,
  isTeamRosterMember,
  userDisplayLabel,
} from "./lib/teamRoster";
import {
  findWorkflowTransition,
  type TransitionAuthority,
} from "../shared/workflowTransitions";
import { MAX_WORKFLOW_NOTE_CHARS } from "../shared/workflowLabels";
import { patchProjectWorkflowStage } from "./lib/dashboardProjection";
import { scheduleOwnershipOversightRebuild } from "./oversight";

const transferCandidateRoleValidator = v.union(
  v.literal("writer"),
  v.literal("manager")
);
const transitionAuthorityValidator = v.union(
  v.literal("owner"),
  v.literal("handoff_assignee"),
  v.literal("manager"),
  v.literal("admin")
);

function userInitials(user: Pick<Doc<"users">, "firstName" | "lastName" | "name" | "email">) {
  const label = userDisplayLabel(user);
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts.length > 1
    ? `${parts[0][0]}${parts.at(-1)?.[0] ?? ""}`
    : label.slice(0, 2)
  ).toUpperCase();
}

function workflowVersion(project: Doc<"projects">) {
  return project.workflowVersion ?? 0;
}

function normalizedNote(note: string | undefined) {
  const value = note?.trim();
  if (!value) return undefined;
  if (value.length > MAX_WORKFLOW_NOTE_CHARS) {
    domainError(
      "INVALID_INPUT",
      `Workflow notes must be ${MAX_WORKFLOW_NOTE_CHARS.toLocaleString("en-CA")} characters or fewer`
    );
  }
  return value;
}

async function validCurrentHandoff(
  ctx: Parameters<typeof getInternalProjectAccessOrNull>[0],
  project: Doc<"projects">
) {
  if (!project.currentHandoffId) return null;
  const [pointed, blockers] = await Promise.all([
    ctx.db.get(project.currentHandoffId),
    ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status_and_blocking", (q) =>
        q.eq("projectId", project._id).eq("status", "open").eq("blocking", true)
      )
      .take(2),
  ]);
  if (
    !pointed ||
    pointed.projectId !== project._id ||
    pointed.status !== "open" ||
    pointed.blocking !== true ||
    blockers.length !== 1 ||
    blockers[0]._id !== pointed._id
  ) {
    return null;
  }
  return pointed;
}

export async function workflowAuthorities(
  ctx: Parameters<typeof getInternalProjectAccessOrNull>[0],
  project: Doc<"projects">,
  user: Doc<"users">
) {
  const authorities = new Set<TransitionAuthority>();
  if (user.isAnonymous === true || !user.role) return authorities;
  if (project.ownerId === user._id) authorities.add("owner");
  if (user.role === "manager") authorities.add("manager");
  if (user.role === "admin") authorities.add("admin");

  const handoff = await validCurrentHandoff(ctx, project);
  if (handoff?.assigneeId === user._id) authorities.add("handoff_assignee");
  return authorities;
}

async function requireAnyWorkflowAuthority(
  ctx: Parameters<typeof getInternalProjectAccessOrNull>[0],
  project: Doc<"projects">,
  user: Doc<"users">
) {
  const authorities = await workflowAuthorities(ctx, project, user);
  if (authorities.size === 0) {
    domainError(
      "NOT_AUTHORIZED",
      "Only the project owner, a manager, or an administrator can change workflow"
    );
  }
  return authorities;
}

async function requireInternalWorkflowActor(ctx: QueryCtx | MutationCtx) {
  return (await requireCapability(ctx, "project.readInternal")).user;
}

async function requireTransferAuthority(
  ctx: Parameters<typeof getInternalProjectAccessOrNull>[0],
  project: Doc<"projects">,
  user: Doc<"users">
) {
  const authorities = await workflowAuthorities(ctx, project, user);
  if (
    !authorities.has("owner") &&
    !authorities.has("manager") &&
    !authorities.has("admin")
  ) {
    domainError(
      "NOT_AUTHORIZED",
      "Only the project owner, a manager, or an administrator can transfer ownership"
    );
  }
  // A future handoff assignee may change only the two matrix edges that grant H
  // authority; being assigned work never grants ownership-transfer authority.
  return authorities;
}

export const getProjectWorkflowHeader = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.null(),
    v.object({
      workflowStage: workflowStageValidator,
      stageIsFallback: v.boolean(),
      workflowUpdatedAt: v.union(v.number(), v.null()),
      workflowVersion: v.number(),
      owner: v.union(
        v.null(),
        v.object({
          userId: v.id("users"),
          label: v.string(),
          initials: v.string(),
        })
      ),
      ownerNeedsReview: v.boolean(),
      createdByLabel: v.string(),
      viewerAuthorities: v.array(transitionAuthorityValidator),
    })
  ),
  handler: async (ctx, args) => {
    const access = await getInternalProjectAccessOrNull(ctx, args.projectId);
    if (!access) return null;
    const [owner, creator] = await Promise.all([
      access.project.ownerId ? ctx.db.get(access.project.ownerId) : Promise.resolve(null),
      ctx.db.get(access.project.createdBy),
    ]);
    const rosterOwner = isTeamRosterMember(owner) ? owner : null;
    return {
      workflowStage: access.project.workflowStage ?? "intake",
      stageIsFallback: access.project.workflowStage === undefined,
      workflowUpdatedAt: access.project.workflowUpdatedAt ?? null,
      workflowVersion: workflowVersion(access.project),
      owner: rosterOwner
        ? {
            userId: rosterOwner._id,
            label: userDisplayLabel(rosterOwner),
            initials: userInitials(rosterOwner),
          }
        : null,
      ownerNeedsReview: access.project.ownerBackfillStatus === "needs_review",
      createdByLabel: creator
        ? userDisplayLabel(creator)
        : access.project.writer?.trim() || "Unknown creator",
      viewerAuthorities: [...await workflowAuthorities(ctx, access.project, access.user)],
    };
  },
});

export const listOwnerTransferCandidates = query({
  args: { projectId: v.id("projects") },
  returns: v.object({
    candidates: v.array(
      v.object({
        userId: v.id("users"),
        label: v.string(),
        initials: v.string(),
        email: v.union(v.string(), v.null()),
        role: transferCandidateRoleValidator,
      })
    ),
    truncated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const user = await requireInternalWorkflowActor(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");
    await requireTransferAuthority(ctx, project, user);

    const rosterPage = await ctx.db.query("users").take(201);
    const roster = rosterPage.slice(0, 200).filter(isTeamRosterMember);
    const candidates = roster
      .filter(
        (candidate): candidate is Doc<"users"> & { role: "writer" | "manager" } =>
          candidate._id !== project.ownerId &&
          (candidate.role === "writer" || candidate.role === "manager")
      )
      .map((candidate) => ({
        userId: candidate._id,
        label: userDisplayLabel(candidate),
        initials: userInitials(candidate),
        email: candidate.email?.trim() || null,
        role: candidate.role,
      }))
      .sort((a, b) => {
        const byLabel = a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
        return byLabel || a.userId.localeCompare(b.userId);
      });
    return { candidates, truncated: rosterPage.length > 200 };
  },
});

function validateExpectedVersion(expectedVersion: number) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    domainError("INVALID_INPUT", "Expected workflow version must be a non-negative integer");
  }
}

function assertExpectedVersion(
  project: Doc<"projects">,
  expectedVersion: number
) {
  validateExpectedVersion(expectedVersion);
  if (workflowVersion(project) !== expectedVersion) {
    domainError("STALE_REVISION", "The project workflow changed while you were reviewing it");
  }
}

export const transferOwnership = mutation({
  args: {
    projectId: v.id("projects"),
    toUserId: v.id("users"),
    note: v.optional(v.string()),
    expectedVersion: v.number(),
  },
  returns: v.object({
    status: v.union(v.literal("updated"), v.literal("noop")),
    version: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireInternalWorkflowActor(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");

    await requireTransferAuthority(ctx, project, user);
    validateExpectedVersion(args.expectedVersion);
    const version = workflowVersion(project);
    if (project.ownerId === args.toUserId) {
      return { status: "noop" as const, version };
    }

    assertExpectedVersion(project, args.expectedVersion);
    const target = await getTeamRosterMemberOrNull(ctx, args.toUserId);
    if (!target?.role) {
      domainError("INVALID_INPUT", "Choose an active team member with an assigned role");
    }
    if (target.role !== "writer" && target.role !== "manager") {
      domainError(
        "INVALID_INPUT",
        "Project ownership can be assigned only to a Consultant or Manager"
      );
    }

    const note = normalizedNote(args.note);
    const now = Date.now();
    const nextVersion = version + 1;
    await ctx.db.patch(project._id, {
      ownerId: target._id,
      ownerBackfillStatus: undefined,
      workflowUpdatedAt: now,
      workflowVersion: nextVersion,
    });
    await ctx.db.insert("projectEvents", {
      projectId: project._id,
      type: "ownership_transferred",
      actorId: user._id,
      ...(project.ownerId ? { from: project.ownerId } : {}),
      to: target._id,
      ...(note ? { note } : {}),
      at: now,
    });
    await scheduleOwnershipOversightRebuild(ctx, {
      projectId: project._id,
      reason: "ownership_transfer",
      ...(project.ownerId ? { fromOwnerId: project.ownerId } : {}),
      toOwnerId: target._id,
    });
    return { status: "updated" as const, version: nextVersion };
  },
});

export const setWorkflowStage = mutation({
  args: {
    projectId: v.id("projects"),
    toStage: workflowStageValidator,
    note: v.optional(v.string()),
    expectedVersion: v.number(),
  },
  returns: v.object({
    status: v.union(v.literal("updated"), v.literal("noop")),
    version: v.number(),
  }),
  handler: async (ctx, args) => {
    const user = await requireInternalWorkflowActor(ctx);
    const project = await ctx.db.get(args.projectId);
    if (!project) domainError("NOT_FOUND", "Project not found");

    const authorities = await requireAnyWorkflowAuthority(ctx, project, user);
    validateExpectedVersion(args.expectedVersion);
    const version = workflowVersion(project);
    const fromStage = project.workflowStage ?? "intake";
    if (fromStage === args.toStage) {
      return { status: "noop" as const, version };
    }

    assertExpectedVersion(project, args.expectedVersion);
    const transition = findWorkflowTransition(fromStage, args.toStage);
    if (!transition) {
      domainError("INVALID_TRANSITION", "This workflow transition is not allowed", {
        from: fromStage,
        to: args.toStage,
      });
    }
    if (!transition.authorities.some((authority) => authorities.has(authority))) {
      domainError("NOT_AUTHORIZED", "You do not have authority for this workflow transition");
    }

    const note = normalizedNote(args.note);
    if (transition.requiresNote && !note) {
      domainError("INVALID_INPUT", "Add a reason for this workflow transition");
    }
    if (transition.requirements?.includes("delivery_outcome")) {
      domainError(
        "OUTCOME_REQUIRED",
        "Record the exact delivered or filing outcome before marking this project delivered"
      );
    }
    if (transition.requirements?.includes("promoted_branch")) {
      domainError(
        "INVALID_STATE",
        "A promoted report branch is required before marking this project ready for delivery"
      );
    }
    if (transition.requirements?.includes("review_handoff")) {
      const handoff = await validCurrentHandoff(ctx, project);
      if (
        !handoff ||
        handoff.projectId !== project._id ||
        handoff.status !== "open" ||
        handoff.blocking !== true ||
        handoff.kind !== "internal_review"
      ) {
        domainError(
          "INVALID_STATE",
          "An active internal-review handoff is required before resuming internal review"
        );
      }
    }
    if (args.toStage === "abandoned") {
      const openWork = await ctx.db
        .query("workItems")
        .withIndex("by_projectId_and_status", (q) =>
          q.eq("projectId", project._id).eq("status", "open")
        )
        .first();
      if (openWork) {
        domainError(
          "INVALID_STATE",
          "Complete, decline, or cancel open work before abandoning this project"
        );
      }
    }

    const now = Date.now();
    const nextVersion = version + 1;
    // Centralized stage write (B1 correction): patchProjectWorkflowStage is
    // the ONLY sanctioned workflowStage writer. It patches stage + frozen
    // rank and moves the per-client stageCounts bucket in the same
    // transaction. The FROM bucket is the row's actually-occupied bucket
    // (workflowStage ?? "legacy") — NOT the "intake" fallback used for
    // transition authority — so a legacy row entering the workflow moves out
    // of the "legacy" bucket. Idempotent same-stage no-ops return above and
    // never touch the company row. No-ops honestly while the company row is
    // not yet backfilled (stageCounts absent) or the project is uncounted.
    await patchProjectWorkflowStage(ctx, project, args.toStage, {
      workflowUpdatedAt: now,
      workflowVersion: nextVersion,
    });
    await ctx.db.insert("projectEvents", {
      projectId: project._id,
      type: "stage_changed",
      actorId: user._id,
      ...(project.workflowStage ? { from: project.workflowStage } : {}),
      to: args.toStage,
      ...(note ? { note } : {}),
      at: now,
    });
    return { status: "updated" as const, version: nextVersion };
  },
});
