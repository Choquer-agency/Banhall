import { paginationOptsValidator } from "convex/server";
import { query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser } from "./lib/auth";
import { dashboardProjectRow } from "./lib/dashboardProjection";
import { DASHBOARD_FACET_LIMIT } from "../shared/dashboardProjection";
import { WORKFLOW_STAGES } from "../shared/workflowStages";
import type { Doc, Id } from "./_generated/dataModel";

const sortValidator = v.union(
  v.literal("created"),
  v.literal("updated"),
  v.literal("viewed")
);
const stageFilterValidator = v.union(
  ...WORKFLOW_STAGES.map((stage) => v.literal(stage)),
  v.literal("legacy")
);

type FlatFilterArgs = {
  stage?: (typeof WORKFLOW_STAGES)[number] | "legacy";
  ownerId?: Id<"users">;
  industry?: string;
  scienceCode?: string;
  tagIds?: Id<"tags">[];
};

function matchesFlatFilters(project: Doc<"projects">, args: FlatFilterArgs) {
  if (args.stage === "legacy" && project.workflowStage !== undefined) return false;
  if (args.stage && args.stage !== "legacy" && project.workflowStage !== args.stage) return false;
  if (args.ownerId && project.ownerId !== args.ownerId) return false;
  if (args.industry && project.industry !== args.industry) return false;
  if (args.scienceCode && project.scienceCode !== args.scienceCode) return false;
  if (
    args.tagIds?.length &&
    !(project.tagIds ?? []).some((id) => args.tagIds?.includes(id))
  ) {
    return false;
  }
  return true;
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
  const page = result.page.filter((project) => matchesFlatFilters(project, args));
  return {
    ...result,
    page: page.map(dashboardProjectRow),
    scanTruncated: !result.isDone && page.length < result.page.length,
  };
}

export const listCompanies = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
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

export const listCompanyProjects = query({
  args: {
    companyKey: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
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
    return { ...result, page: result.page.map(dashboardProjectRow) };
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
  },
  handler: async (ctx, args) => {
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
  },
  handler: async (ctx, args) => {
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
    const page = result.page
      .filter((project) => {
        if (args.stage === "legacy" && project.workflowStage !== undefined) return false;
        return tagIds.size === 0 || (project.tagIds ?? []).some((id) => tagIds.has(id));
      })
      .map(dashboardProjectRow);
    return { ...result, page, scanTruncated: page.length < result.page.length };
  },
});

export const getFacets = query({
  args: {},
  handler: async (ctx) => {
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
