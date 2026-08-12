import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  dashboardCompanyKey,
  dashboardFiscalYearRank,
  dashboardProjectionFields,
  type DashboardGenerationActivity,
} from "../../shared/dashboardProjection";
import { workflowStageRank, type WorkflowStage } from "../../shared/workflowStages";
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

/**
 * Stage bucket key for `dashboardCompanies.stageCounts` (2026-08-06 second
 * amendment): the canonical stage literal, or "legacy" for rows without a
 * workflow stage.
 */
export function stageCountBucket(stage: Doc<"projects">["workflowStage"]) {
  return stage ?? "legacy";
}

function adjustedStageCounts(
  existing: Record<string, number> | undefined,
  isNewRow: boolean,
  bucket: string | undefined,
  delta: number
): Record<string, number> | undefined {
  // Honesty contract: an absent stageCounts means "not yet backfilled" and
  // must stay absent — adjusting only new deltas onto an unknown base would
  // fabricate exact-looking counts. A brand-new company row starts exact by
  // construction, so it initializes the record.
  if (bucket === undefined) return existing;
  if (existing === undefined && !isNewRow) return undefined;
  const next = { ...(existing ?? {}) };
  const value = (next[bucket] ?? 0) + delta;
  if (value <= 0) delete next[bucket];
  else next[bucket] = value;
  return next;
}

export async function upsertDashboardCompany(
  ctx: MutationCtx,
  companyKey: string,
  clientName: string,
  projectCountDelta: number,
  /**
   * Stage bucket the delta applies to (stageCountBucket of the project being
   * counted/uncounted). Omitted only by legacy callers; without it an
   * existing exact stageCounts record would drift, so the record is cleared
   * to stay honest (absent = not backfilled) rather than kept wrong.
   */
  stageBucket?: string
) {
  const existing = await ctx.db
    .query("dashboardCompanies")
    .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
    .unique();
  const projectCount = Math.max(0, (existing?.projectCount ?? 0) + projectCountDelta);
  if (projectCount === 0) {
    // stageCounts lives and dies with the row (deleted at projectCount 0).
    if (existing) await ctx.db.delete(existing._id);
    return;
  }
  const stageCounts =
    stageBucket === undefined
      ? undefined
      : adjustedStageCounts(existing?.stageCounts, !existing, stageBucket, projectCountDelta);
  const patch = {
    clientName:
      projectCountDelta > 0 || !existing
        ? clientName.trim() || "—"
        : existing.clientName,
    projectCount,
    stageCounts,
    updatedAt: Date.now(),
  };
  if (existing) {
    await ctx.db.patch(existing._id, patch);
  } else {
    await ctx.db.insert("dashboardCompanies", { companyKey, ...patch });
  }
}

/**
 * Same-transaction stage-count move for a stage transition on one project
 * (2026-08-06 second amendment). No-ops honestly when the company row is
 * missing or not yet backfilled (stageCounts absent); the verified backfill
 * establishes the record later.
 */
export async function moveDashboardCompanyStageCount(
  ctx: MutationCtx,
  companyKey: string,
  fromBucket: string,
  toBucket: string
) {
  if (fromBucket === toBucket) return;
  const existing = await ctx.db
    .query("dashboardCompanies")
    .withIndex("by_companyKey", (q) => q.eq("companyKey", companyKey))
    .unique();
  if (!existing || existing.stageCounts === undefined) return;
  const next = { ...existing.stageCounts };
  const fromValue = (next[fromBucket] ?? 0) - 1;
  if (fromValue <= 0) delete next[fromBucket];
  else next[fromBucket] = fromValue;
  next[toBucket] = (next[toBucket] ?? 0) + 1;
  await ctx.db.patch(existing._id, { stageCounts: next, updatedAt: Date.now() });
}

/**
 * THE one sanctioned way to change `projects.workflowStage` on an existing
 * row (2026-08-06 second amendment correction, B1). Patches the project's
 * stage + frozen persisted rank (plus any caller fields) and, in the SAME
 * transaction, moves the per-client `dashboardCompanies.stageCounts` bucket
 * for counted projects. Every direct `workflowStage` writer must go through
 * this helper — writing the field with a bare `ctx.db.patch` silently drifts
 * the exact per-client counts while keeping `sum === projectCount` intact,
 * which no sum-based verification can see.
 *
 * No-ops honestly on uncounted rows and on not-yet-backfilled company rows
 * (stageCounts absent). Same-stage idempotent no-ops must be handled by the
 * caller BEFORE patching (the bucket move is skipped either way).
 */
export async function patchProjectWorkflowStage(
  ctx: MutationCtx,
  project: Doc<"projects">,
  toStage: WorkflowStage,
  extraPatch: Partial<Doc<"projects">> = {}
) {
  await ctx.db.patch(project._id, {
    ...extraPatch,
    workflowStage: toStage,
    workflowStageRank: workflowStageRank(toStage),
  });
  if (project.dashboardCompanyCounted === true) {
    await moveDashboardCompanyStageCount(
      ctx,
      project.dashboardCompanyKey ?? dashboardCompanyKey(project.clientName),
      stageCountBucket(project.workflowStage),
      toStage
    );
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
    // Client-name reassignment moves the project's stage bucket between both
    // affected company rows in the same transaction (2026-08-06 second
    // amendment). The stage itself is unchanged by a rename, so one bucket
    // serves both sides.
    const bucket = stageCountBucket(merged.workflowStage);
    await upsertDashboardCompany(ctx, oldCompanyKey, project.clientName, -1, bucket);
    await upsertDashboardCompany(ctx, patch.dashboardCompanyKey, merged.clientName, 1, bucket);
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
    // 2026-08-11 amendment: pass-through of the per-company project number /
    // draft letter from the raw project doc (no derived/stored projection).
    projectNumber: project.projectNumber,
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
    // Exposed so presentation can fail honest when a row predates the rank
    // projection (H2 correction): unranked rows sort before every ranked row
    // in the stage-ranked index, so their presence invalidates every "this
    // group is complete" inference client-side.
    workflowStageRank: project.workflowStageRank,
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
