import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  dashboardCompanyKey,
  dashboardFiscalYearRank,
  dashboardProjectionFields,
  type DashboardGenerationActivity,
} from "../../shared/dashboardProjection";
import { findActiveGeneration } from "./activeGeneration";

type Ctx = QueryCtx | MutationCtx;

type DashboardProjectionPatch = {
  dashboardCompanyKey: string;
  dashboardFiscalYearRank: number;
  dashboardSearchText: string;
  workflowStageRank: number;
};

export function projectDashboardProjectionPatch(
  project: Pick<
    Doc<"projects">,
    | "title"
    | "clientName"
    | "writer"
    | "interviewer"
    | "scienceCode"
    | "industry"
    | "fiscalYearEnd"
    | "workflowStage"
  >
): DashboardProjectionPatch {
  return dashboardProjectionFields(project);
}

export async function upsertDashboardCompany(
  ctx: MutationCtx,
  companyKey: string,
  clientName: string,
  projectCountDelta: number
) {
  const existing = await ctx.db
    .query("dashboardCompanies")
    .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
    .unique();
  const projectCount = Math.max(0, (existing?.projectCount ?? 0) + projectCountDelta);
  if (projectCount === 0) {
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const patch = {
    clientName:
      projectCountDelta > 0 || !existing
        ? clientName.trim() || "—"
        : existing.clientName,
    projectCount,
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("dashboardCompanies", { companyKey, ...patch });
  }
}

export async function syncProjectDashboardFields(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  next: Partial<Doc<"projects">> = {}
) {
  const project = await ctx.db.get(projectId);
  if (!project) return;
  const merged = { ...project, ...next };
  const patch = projectDashboardProjectionPatch(merged);
  const oldCompanyKey = project.dashboardCompanyKey ?? dashboardCompanyKey(project.clientName);
  const companyChanged = oldCompanyKey !== patch.dashboardCompanyKey;
  if (
    project.dashboardCompanyKey !== patch.dashboardCompanyKey ||
    project.dashboardFiscalYearRank !== patch.dashboardFiscalYearRank ||
    project.dashboardSearchText !== patch.dashboardSearchText ||
    project.workflowStageRank !== patch.workflowStageRank
  ) {
    await ctx.db.patch(projectId, patch);
  }
  if (companyChanged && project.dashboardCompanyCounted === true) {
    await upsertDashboardCompany(ctx, oldCompanyKey, project.clientName, -1);
    await upsertDashboardCompany(ctx, patch.dashboardCompanyKey, merged.clientName, 1);
  }
}

export function generationActivityFromStatus(
  status: Doc<"generations">["status"] | undefined
): DashboardGenerationActivity | undefined {
  if (status === "reserved" || status === "running") return "generating";
  if (status === "awaiting_selection" || status === "awaiting_input") return status;
  return undefined;
}

export async function resolveProjectGenerationActivity(
  ctx: Ctx,
  project: Doc<"projects">
) {
  const active = await findActiveGeneration(ctx, project, [
    "reserved",
    "running",
    "awaiting_selection",
    "awaiting_input",
  ]);
  return generationActivityFromStatus(active?.status);
}

export async function refreshProjectGenerationActivity(
  ctx: MutationCtx,
  projectId: Id<"projects">
) {
  const project = await ctx.db.get(projectId);
  if (!project) return;
  const generationActivity = await resolveProjectGenerationActivity(ctx, project);
  if (project.generationActivity !== generationActivity) {
    await ctx.db.patch(projectId, { generationActivity });
  }
}

export function dashboardProjectRow(project: Doc<"projects">) {
  return {
    _id: project._id,
    _creationTime: project._creationTime,
    title: project.title,
    clientName: project.clientName,
    writer: project.writer,
    interviewer: project.interviewer,
    tagIds: project.tagIds,
    fiscalYearEnd: project.fiscalYearEnd,
    industry: project.industry,
    scienceCode: project.scienceCode,
    mode: project.mode,
    ownerId: project.ownerId,
    workflowStage: project.workflowStage,
    status: project.status,
    createdBy: project.createdBy,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    lastViewedAt: project.lastViewedAt,
    generationActivity: project.generationActivity,
    dashboardCompanyKey:
      project.dashboardCompanyKey ?? dashboardCompanyKey(project.clientName),
    dashboardFiscalYearRank:
      project.dashboardFiscalYearRank ?? dashboardFiscalYearRank(project.fiscalYearEnd),
  };
}
