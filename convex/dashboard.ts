import { paginationOptsValidator } from "convex/server";
import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser } from "./lib/auth";
import { projectTypeValidator } from "./lib/contracts";
import { dashboardProjectRow } from "./lib/dashboardProjection";
import { userDisplayLabel } from "./lib/teamRoster";
import { DASHBOARD_FACET_LIMIT } from "../shared/dashboardProjection";
import {
  WORKFLOW_STAGES,
  workflowStageRank,
  type WorkflowStage,
} from "../shared/workflowStages";
import type { Doc, Id } from "./_generated/dataModel";
import { effectiveProjectType, type ProjectType } from "../shared/projectTypes";

const sortValidator = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("viewed")
);
const stageFilterValidator = v.union(
  ...WORKFLOW_STAGES.map((stage) => v.literal(stage)),
  v.literal("legacy")
);
const clientSortValidator = v.union(
  v.literal("project_number"),
  v.literal("created"),
  v.literal("updated")
);

type FlatFilterArgs = {
  stage?: (typeof WORKFLOW_STAGES)[number] | "legacy";
  ownerId?: Id<"users">;
  industry?: string;
  scienceCode?: string;
  tagIds?: Id<"tags">[];
  projectType?: ProjectType;
  currentAssigneeId?: Id<"users">;
};

function matchesFlatFilters(project: Doc<"projects">, args: FlatFilterArgs) {
  if (args.stage === "legacy" && project.workflowStage !== undefined) return false;
  if (args.stage && args.stage !== "legacy" && project.workflowStage !== args.stage) return false;
  if (args.ownerId && project.ownerId !== args.ownerId) return false;
  if (args.industry && project.industry !== args.industry) return false;
  if (args.scienceCode && project.scienceCode !== args.scienceCode) return false;
  if (args.projectType && effectiveProjectType(project) !== args.projectType) return false;
  if (
    args.tagIds?.length &&
    !(project.tagIds ?? []).some((id) => args.tagIds?.includes(id))
  ) {
    return false;
  }
  return true;
}

function projectNumberSortKey(projectNumber: string | undefined) {
  const normalized = projectNumber?.trim().toUpperCase() ?? "";
  const numbered = normalized.match(/^([0-9]+)([A-Z]?)$/);
  if (numbered) {
    return `0:${Number(numbered[1]).toString().padStart(3, "0")}:${numbered[2]}`;
  }
  if (/^[A-Z]$/.test(normalized)) return `1:${normalized}`;
  return "2:";
}

function compareClientProjects(
  a: ReturnType<typeof dashboardProjectRow>,
  b: ReturnType<typeof dashboardProjectRow>,
  sortBy: "project_number" | "created" | "updated"
) {
  const byFiscal = a.dashboardFiscalYearRank - b.dashboardFiscalYearRank;
  if (byFiscal) return byFiscal;
  if (sortBy === "created") {
    const byCreated = (b.createdAt ?? b._creationTime) - (a.createdAt ?? a._creationTime);
    if (byCreated) return byCreated;
  } else if (sortBy === "updated") {
    const byUpdated = b.updatedAt - a.updatedAt;
    if (byUpdated) return byUpdated;
  } else {
    const byNumber = projectNumberSortKey(a.projectNumber).localeCompare(
      projectNumberSortKey(b.projectNumber),
      "en-CA"
    );
    if (byNumber) return byNumber;
  }
  return a.title.localeCompare(b.title, "en-CA", { sensitivity: "base" });
}

async function dashboardRowsWithOwnerLabels(
  ctx: QueryCtx,
  projects: Doc<"projects">[]
) {
  // Bounded per-page current-handoff projection (2026-08-10 amendment lifting
  // the 2026-08-08 board-card deferral): one deduplicated `workItems` get per
  // pointered row on the already-bounded page, with assignee labels resolved
  // in the same user batch as owner labels. Never per-card subscriptions.
  // Defensive truth: the pointer contract is "one OPEN blocking item per
  // project" — a stale pointer (missing, non-open, or cross-project item)
  // projects nothing rather than a wrong "With".
  const handoffByProject = new Map<Id<"projects">, Doc<"workItems">>();
  const userIds = new Set<Id<"users">>();
  for (const project of projects) {
    if (project.ownerId) userIds.add(project.ownerId);
    if (!project.currentHandoffId) continue;
    const item = await ctx.db.get(project.currentHandoffId);
    if (item && item.status === "open" && item.projectId === project._id) {
      handoffByProject.set(project._id, item);
      userIds.add(item.assigneeId);
    }
  }
  const userLabels = new Map<Id<"users">, string>();
  for (const userId of userIds) {
    const user = await ctx.db.get(userId);
    if (user) userLabels.set(userId, userDisplayLabel(user));
  }
  return projects.map((project) => {
    const handoff = handoffByProject.get(project._id);
    return {
      ...dashboardProjectRow(project),
      ownerLabel: project.ownerId ? userLabels.get(project.ownerId) : undefined,
      currentHandoff: handoff
        ? {
            kind: handoff.kind,
            assigneeId: handoff.assigneeId,
            assigneeLabel: userLabels.get(handoff.assigneeId) ?? "Unknown team member",
            blocking: handoff.blocking,
            dueAt: handoff.dueAt ?? null,
          }
        : undefined,
    };
  });
}

async function collectMatchingPage(
  ctx: QueryCtx,
  args: FlatFilterArgs & {
    paginationOpts: { numItems: number; cursor: string | null };
    sortBy: "created" | "updated" | "viewed";
  }
) {
  const target = Math.max(1, Math.min(args.paginationOpts.numItems, 100));
  const base =
    args.sortBy === "created"
      ? ctx.db.query("projects").withIndex("by_createdAt").order("desc")
      : args.sortBy === "viewed"
        ? ctx.db.query("projects").withIndex("by_lastViewedAt").order("desc")
        : ctx.db.query("projects").withIndex("by_updatedAt").order("desc");
  const result = await base.paginate({
    ...args.paginationOpts,
    numItems: target,
    maximumRowsRead: target * 8,
  });
  const matching = result.page.filter((project) => matchesFlatFilters(project, args));
  const projected = await dashboardRowsWithOwnerLabels(ctx, matching);
  const page = projected.filter(
    (row) =>
      !args.currentAssigneeId ||
      row.currentHandoff?.assigneeId === args.currentAssigneeId
  );
  return {
    ...result,
    page,
    scanTruncated: !result.isDone && page.length < result.page.length,
  };
}

export const listCompanies = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey")
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 40)),
      });
  },
});

/**
 * One recorded-client-name projection row for the focused client board
 * (2026-08-06 second amendment). Returns null when no projection row exists
 * (zero counted projects). Never a durable Client record.
 */
export const getCompany = query({
  args: { companyKey: v.string() },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("dashboardCompanies")
      .withIndex("by_companyKey", (q) => q.eq("companyKey", args.companyKey))
      .unique();
  },
});

export const listCompanyProjects = query({
  args: {
    companyKey: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    const result = await ctx.db
      .query("projects")
      .withIndex("by_dashboardCompanyKey_and_dashboardFiscalYearRank", (q) =>
        q.eq("dashboardCompanyKey", args.companyKey)
      )
      .order("asc")
      .paginate({
        ...args.paginationOpts,
        numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 100)),
      });
    return { ...result, page: await dashboardRowsWithOwnerLabels(ctx, result.page) };
  },
});

/**
 * Per-client stage-ordered projects (2026-08-06 second amendment): paginates
 * the by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt index
 * ascending, so Client → Status sub-groups are cut-points of a true server
 * order, never a client-side sort claim. Caveats the UI must honour:
 * - Ranks are the FROZEN persisted ranks (`on_hold` 7 before `delivered` 8);
 *   presentation re-maps complete rank runs into
 *   WORKFLOW_STAGE_PIPELINE_ORDER (lossless for complete runs; only the last
 *   loaded run may be incomplete while pagination is unexhausted → `+`).
 * - Rows with a missing rank sort before all ranked rows; the stageCounts
 *   backfill Pass 0 verifies rank presence.
 * - Legacy rows (rank 1000) arrive last as the qualified "Legacy status"
 *   sub-group.
 */
export const listCompanyProjectsByStageRank = query({
  args: {
    companyKey: v.string(),
    stage: v.optional(stageFilterValidator),
    ownerId: v.optional(v.id("users")),
    currentAssigneeId: v.optional(v.id("users")),
    projectType: v.optional(projectTypeValidator),
    sortBy: v.optional(clientSortValidator),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    const rank = args.stage
      ? workflowStageRank(args.stage === "legacy" ? undefined : args.stage as WorkflowStage)
      : undefined;
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 100)),
    };
    const result = args.ownerId
      ? await ctx.db
          .query("projects")
          .withIndex(
            "by_client_owner_stage_rank_updated",
            (q) => {
              const byClientAndOwner = q
                .eq("dashboardCompanyKey", args.companyKey)
                .eq("ownerId", args.ownerId);
              return rank === undefined
                ? byClientAndOwner
                : byClientAndOwner.eq("workflowStageRank", rank);
            }
          )
          .order("asc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("projects")
          .withIndex(
            "by_dashboardCompanyKey_and_workflowStageRank_and_updatedAt",
            (q) => {
              const byClient = q.eq("dashboardCompanyKey", args.companyKey);
              return rank === undefined ? byClient : byClient.eq("workflowStageRank", rank);
            }
          )
          .order("asc")
          .paginate(paginationOpts);
    const rows = await dashboardRowsWithOwnerLabels(ctx, result.page);
    const page = rows
      .filter((row) => !args.projectType || row.projectType === args.projectType)
      .filter(
        (row) =>
          !args.currentAssigneeId ||
          row.currentHandoff?.assigneeId === args.currentAssigneeId
      );
    if (args.sortBy) {
      page.sort((a, b) => compareClientProjects(a, b, args.sortBy!));
    }
    return {
      ...result,
      page,
      scanTruncated: page.length < result.page.length,
    };
  },
});

export const listFlatProjects = query({
  args: {
    paginationOpts: paginationOptsValidator,
    sortBy: sortValidator,
    stage: v.optional(stageFilterValidator),
    ownerId: v.optional(v.id("users")),
    industry: v.optional(v.string()),
    scienceCode: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    currentAssigneeId: v.optional(v.id("users")),
    projectType: v.optional(projectTypeValidator),
  },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    return await collectMatchingPage(ctx, args);
  },
});

export const searchProjects = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.string(),
    stage: v.optional(stageFilterValidator),
    ownerId: v.optional(v.id("users")),
    industry: v.optional(v.string()),
    scienceCode: v.optional(v.string()),
    tagIds: v.optional(v.array(v.id("tags"))),
    currentAssigneeId: v.optional(v.id("users")),
    projectType: v.optional(projectTypeValidator),
  },
  handler: async (ctx, args) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    const search = args.search.trim();
    if (!search) return { page: [], isDone: true, continueCursor: "" };
    let searchQuery = ctx.db
      .query("projects")
      .withSearchIndex("search_dashboardSearchText", (q) => {
        let builder = q.search("dashboardSearchText", search);
        if (args.stage && args.stage !== "legacy") builder = builder.eq("workflowStage", args.stage);
        if (args.ownerId) builder = builder.eq("ownerId", args.ownerId);
        if (args.industry) builder = builder.eq("industry", args.industry);
        if (args.scienceCode) builder = builder.eq("scienceCode", args.scienceCode);
        return builder;
      });
    const result = await searchQuery.paginate({
      ...args.paginationOpts,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 100)),
    });
    const tagIds = new Set(args.tagIds ?? []);
    const matching = result.page.filter((project) => {
      if (args.stage === "legacy" && project.workflowStage !== undefined) return false;
      if (args.projectType && effectiveProjectType(project) !== args.projectType) return false;
      return tagIds.size === 0 || (project.tagIds ?? []).some((id) => tagIds.has(id));
    });
    const projected = await dashboardRowsWithOwnerLabels(ctx, matching);
    const page = projected.filter(
      (row) =>
        !args.currentAssigneeId ||
        row.currentHandoff?.assigneeId === args.currentAssigneeId
    );
    return { ...result, page, scanTruncated: page.length < result.page.length };
  },
});

export const getFacets = query({
  args: {},
  handler: async (ctx) => {
    // Decision D1 (pre-existing read contract, reaffirmed 2026-08-06
    // correction): firm-wide read visibility for authenticated internal
    // users — identical to every other dashboard read. Capability hardening
    // is out of scope for the redesign (D1: "preserve current read
    // visibility unless separately approved and tested").
    await requireCurrentUser(ctx);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_updatedAt")
      .order("desc")
      .take(DASHBOARD_FACET_LIMIT + 1);
    const bounded = projects.slice(0, DASHBOARD_FACET_LIMIT);
    const stageCounts: Record<string, number> = {};
    const ownerIds = new Set<string>();
    const industries = new Set<string>();
    const scienceCodes = new Set<string>();
    for (const project of bounded) {
      const stage = project.workflowStage ?? "legacy";
      stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
      if (project.ownerId) ownerIds.add(project.ownerId);
      if (project.industry?.trim()) industries.add(project.industry);
      if (project.scienceCode?.trim()) scienceCodes.add(project.scienceCode);
    }
    return {
      total: bounded.length,
      truncated: projects.length > DASHBOARD_FACET_LIMIT,
      stageCounts,
      ownerIds: [...ownerIds],
      industries: [...industries].sort(),
      scienceCodes: [...scienceCodes].sort(),
    };
  },
});
