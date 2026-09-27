/**
 * Asking for a Brief preparation (2026-09-26, decision 65). Called only
 * from server mutations that change a writing project's evidence (a
 * transcript or file added, replaced, archived, restored or deleted, a
 * speaker role, a finished intake turn build, the client name or fiscal
 * year), never from a read, a page mount or an admin backfill. It debounces: the preparation starts
 * PREPARATION_DEBOUNCE_MS after the last change of a burst, so a batch of
 * uploads asks once. Whether it is worth a paid call is decided when it
 * starts (convex/briefPreparations.ts).
 */
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { WorkflowStage } from "../../shared/workflowStages";
import { firmDayNumber } from "../../shared/firmTime";
import { briefPreparationEnabled } from "../appSettings";
import { effectiveProjectType } from "../../shared/projectTypes";
import { startBriefPreparationRef } from "./briefPreparationRefs";

/** Quiet time after the last evidence change before a preparation starts. */
export const PREPARATION_DEBOUNCE_MS = 5_000;

export type PreparationTriggerReason =
  | "project_created"
  | "transcript_added"
  | "transcript_replaced"
  | "transcript_removed"
  | "document_added"
  | "document_archived"
  | "document_restored"
  | "document_deleted"
  | "speakers_changed"
  | "structure_ready"
  | "identity_changed"
  | "fiscal_year_changed";

/**
 * Workflow stages in which a project may be prepared: the writing stages.
 * A project in review, submitted, delivered, on hold or abandoned is never
 * prepared. A project without a stage (older rows) counts as writing.
 */
export const PREPARATION_STAGES: ReadonlySet<WorkflowStage> = new Set<WorkflowStage>([
  "intake",
  "interview_complete",
  "drafting",
  "edits",
  "revisions",
]);

export function preparationStageAllows(project: Pick<Doc<"projects">, "workflowStage">): boolean {
  return project.workflowStage === undefined || PREPARATION_STAGES.has(project.workflowStage);
}

/**
 * Queue (or push back) the project's preparation. `userId` is the report
 * editor whose change this is. A system change (a finished intake turn
 * build or speaker classification) passes none and only follows up work
 * someone asked for recently: a queued or running row, or a row made ready
 * today (firm day). It never starts spend on its own.
 */
export async function requestBriefPreparation(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  trigger: { userId?: Id<"users">; reason: PreparationTriggerReason },
  delayMs: number = PREPARATION_DEBOUNCE_MS
): Promise<void> {
  if (!(await briefPreparationEnabled(ctx))) return;
  const project = await ctx.db.get(projectId);
  if (!project || project.deletionStartedAt !== undefined) return;
  if (effectiveProjectType(project) !== "writing" || !preparationStageAllows(project)) return;
  const now = Date.now();
  const queued = await ctx.db
    .query("briefPreparations")
    .withIndex("by_projectId_and_status", (q) => q.eq("projectId", projectId).eq("status", "queued"))
    .first();
  // A start already pending that is not waiting on anything reads the
  // evidence when it runs, this change included: nothing to write, so
  // parallel uploads do not contend on the row.
  if (queued && queued.runAt > now && queued.waitingFor === undefined) return;
  let triggeredBy = trigger.userId ?? queued?.triggeredBy;
  if (!triggeredBy) {
    const latest = await ctx.db
      .query("briefPreparations")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    const recent =
      latest !== null &&
      (latest.status === "running" ||
        (latest.status === "ready" && latest.firmDay === firmDayNumber(now)));
    if (!recent) return;
    triggeredBy = latest.triggeredBy;
  }
  if (queued) {
    const revision = queued.revision + 1;
    const scheduledJobId = await ctx.scheduler.runAfter(delayMs, startBriefPreparationRef, {
      preparationId: queued._id,
      revision,
    });
    await ctx.db.patch(queued._id, {
      revision,
      runAt: now + delayMs,
      scheduledJobId,
      triggeredBy,
      triggerReason: trigger.reason,
      waitingFor: undefined,
      updatedAt: now,
    });
    return;
  }
  const preparationId = await ctx.db.insert("briefPreparations", {
    projectId,
    status: "queued",
    revision: 1,
    runAt: now + delayMs,
    triggeredBy,
    triggerReason: trigger.reason,
    createdAt: now,
    updatedAt: now,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(delayMs, startBriefPreparationRef, {
    preparationId,
    revision: 1,
  });
  await ctx.db.patch(preparationId, { scheduledJobId });
}
