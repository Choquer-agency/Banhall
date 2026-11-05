/**
 * The company profile's Overview table (2026-11-04, docs/product-domain.md
 * "The company profile"): a company's projects as one table (#, project,
 * stage, fiscal year, owner, last updated), 10 a page with page numbers, a
 * search, filters for stage, fiscal year and owner, and a sort (last updated
 * first). The fiscal year sections of cards stay on the Projects page.
 *
 * Bounded read: the company's COMPANY_PROJECTS_READ newest projects (by when
 * they were made, `by_dashboardCompanyKey`) are read once; projects being
 * deleted are left out, and the search, filters, sort and page work on what
 * was read, so the total and the page numbers are exact for that set
 * (`truncated` says when the company has more). Filters list only values
 * present among the projects read. No `.filter` on the database query.
 *
 * Authorization: D1, firm-wide read visibility for internal users, as the
 * company page and every dashboard read.
 */
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireInternalActor } from "./lib/auth";
import { workflowStageValidator } from "./lib/contracts";
import { userDisplayLabel } from "./lib/teamRoster";
import {
  DASHBOARD_UNNAMED_COMPANY_KEY,
  dashboardFiscalYear,
  normalizeDashboardText,
} from "../shared/dashboardProjection";
import { WORKFLOW_STAGE_PIPELINE_ORDER, type WorkflowStage } from "../shared/workflowStages";
import { effectiveWorkflowStage } from "../shared/workflowLabels";

/** Most projects one read takes for a company (newest first). */
export const COMPANY_PROJECTS_READ = 300;
/** Rows a page shows. */
export const COMPANY_PROJECTS_PAGE_SIZE = 10;

const sortValidator = v.union(v.literal("updated"), v.literal("title"), v.literal("number"));
type Sort = "updated" | "title" | "number";

const rowValidator = v.object({
  _id: v.id("projects"),
  title: v.string(),
  projectNumber: v.optional(v.string()),
  stage: workflowStageValidator,
  fiscalYear: v.union(v.number(), v.null()),
  ownerId: v.optional(v.id("users")),
  ownerName: v.optional(v.string()),
  updatedAt: v.number(),
});

/** A project number's order: numbers first (1, 2, 10), then letters (A, B), then none. */
function numberOrder(value: string | undefined): [number, number, string] {
  if (!value) return [2, 0, ""];
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? [0, asNumber, ""] : [1, 0, value];
}

function compare(sort: Sort, a: Doc<"projects">, b: Doc<"projects">): number {
  if (sort === "title") {
    const byTitle = a.title.localeCompare(b.title, "en-CA", { sensitivity: "base" });
    if (byTitle !== 0) return byTitle;
  } else if (sort === "number") {
    const [ag, an, as] = numberOrder(a.projectNumber);
    const [bg, bn, bs] = numberOrder(b.projectNumber);
    if (ag !== bg) return ag - bg;
    if (an !== bn) return an - bn;
    if (as !== bs) return as < bs ? -1 : 1;
  }
  return b.updatedAt - a.updatedAt || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0);
}

export const listCompanyProjects = query({
  args: {
    companyKey: v.string(),
    search: v.optional(v.string()),
    stage: v.optional(workflowStageValidator),
    /** A fiscal year (2026), or null for projects with none. Absent: every year. */
    fiscalYear: v.optional(v.union(v.number(), v.null())),
    ownerId: v.optional(v.id("users")),
    sort: v.optional(sortValidator),
    /** 1 for the first page; past the last page reads the last one. */
    page: v.optional(v.number()),
  },
  returns: v.object({
    rows: v.array(rowValidator),
    /** Projects matching the search and filters, among those read. */
    total: v.number(),
    /** Every live project read for the company, before the search and filters. */
    all: v.number(),
    page: v.number(),
    pageCount: v.number(),
    pageSize: v.number(),
    /** The company has more projects than one read takes. */
    truncated: v.boolean(),
    options: v.object({
      stages: v.array(workflowStageValidator),
      fiscalYears: v.array(v.number()),
      /** Some project has no fiscal year. */
      noFiscalYear: v.boolean(),
      owners: v.array(v.object({ id: v.id("users"), name: v.string() })),
    }),
  }),
  handler: async (ctx, args) => {
    await requireInternalActor(ctx);
    const empty = {
      rows: [],
      total: 0,
      all: 0,
      page: 1,
      pageCount: 1,
      pageSize: COMPANY_PROJECTS_PAGE_SIZE,
      truncated: false,
      options: { stages: [], fiscalYears: [], noFiscalYear: false, owners: [] },
    };
    if (args.companyKey === DASHBOARD_UNNAMED_COMPANY_KEY) return empty;
    const read = await ctx.db
      .query("projects")
      .withIndex("by_dashboardCompanyKey", (q) => q.eq("dashboardCompanyKey", args.companyKey))
      .order("desc")
      .take(COMPANY_PROJECTS_READ + 1);
    const truncated = read.length > COMPANY_PROJECTS_READ;
    const live = read.slice(0, COMPANY_PROJECTS_READ).filter((project) => project.deletionStartedAt === undefined);

    // Owner names, once each.
    const ownerNames = new Map<Id<"users">, string>();
    for (const project of live) {
      if (!project.ownerId || ownerNames.has(project.ownerId)) continue;
      const owner = await ctx.db.get(project.ownerId);
      ownerNames.set(project.ownerId, owner ? userDisplayLabel(owner) : "A former team member");
    }

    const stagesPresent = new Set<WorkflowStage>();
    const yearsPresent = new Set<number>();
    let noFiscalYear = false;
    for (const project of live) {
      stagesPresent.add(effectiveWorkflowStage(project.workflowStage));
      const year = dashboardFiscalYear(project.fiscalYearEnd);
      if (year === null) noFiscalYear = true;
      else yearsPresent.add(year);
    }

    const search = normalizeDashboardText(args.search ?? "");
    const matching = live.filter((project) => {
      if (args.stage !== undefined && effectiveWorkflowStage(project.workflowStage) !== args.stage) return false;
      if (args.fiscalYear !== undefined && dashboardFiscalYear(project.fiscalYearEnd) !== args.fiscalYear) return false;
      if (args.ownerId !== undefined && project.ownerId !== args.ownerId) return false;
      if (search) {
        const haystack = normalizeDashboardText(
          [project.title, project.projectNumber ? `#${project.projectNumber}` : "", project.ownerId ? ownerNames.get(project.ownerId) : ""]
            .filter(Boolean)
            .join(" ")
        );
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    const sort = args.sort ?? "updated";
    matching.sort((a, b) => compare(sort, a, b));

    const pageCount = Math.max(1, Math.ceil(matching.length / COMPANY_PROJECTS_PAGE_SIZE));
    const requested = Number.isFinite(args.page) ? Math.floor(args.page ?? 1) : 1;
    const page = Math.min(Math.max(1, requested), pageCount);
    const start = (page - 1) * COMPANY_PROJECTS_PAGE_SIZE;
    const rows = matching.slice(start, start + COMPANY_PROJECTS_PAGE_SIZE).map((project) => ({
      _id: project._id,
      title: project.title,
      ...(project.projectNumber ? { projectNumber: project.projectNumber } : {}),
      stage: effectiveWorkflowStage(project.workflowStage),
      fiscalYear: dashboardFiscalYear(project.fiscalYearEnd),
      ...(project.ownerId ? { ownerId: project.ownerId, ownerName: ownerNames.get(project.ownerId) } : {}),
      updatedAt: project.updatedAt,
    }));

    return {
      rows,
      total: matching.length,
      all: live.length,
      page,
      pageCount,
      pageSize: COMPANY_PROJECTS_PAGE_SIZE,
      truncated,
      options: {
        stages: WORKFLOW_STAGE_PIPELINE_ORDER.filter((stage) => stagesPresent.has(stage)),
        fiscalYears: [...yearsPresent].sort((a, b) => b - a),
        noFiscalYear,
        owners: [...ownerNames.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name, "en-CA", { sensitivity: "base" })),
      },
    };
  },
});
