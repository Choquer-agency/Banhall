/**
 * Asking for a Brief preparation (2026-09-26, decision 65). Called only
 * from server mutations that change a writing project's evidence (a
 * transcript or file added, replaced, archived, restored or deleted, a
 * speaker role, a finished intake turn build, the client name or fiscal
 * year), never from a read, a page mount or an admin backfill. It debounces
 * on the trailing edge: every change moves the start to
 * PREPARATION_DEBOUNCE_MS after itself, so a burst of changes (a batch of
 * uploads) asks once, after its last change. Whether it is worth a paid call is decided when it
 * starts (convex/briefPreparations.ts).
 */
import { internal } from "../_generated/api";
import type { MutationCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { WorkflowStage } from "../../shared/workflowStages";
import { firmDayNumber } from "../../shared/firmTime";
import { briefPreparationEnabled } from "../appSettings";
import { effectiveProjectType } from "../../shared/projectTypes";

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
  | "fiscal_year_changed"
  // 2026-09-27 (fourth): the project page's start dialog leave-out list.
  | "selection_changed";

/**
 * How long a project's start dialog leave-out list (2026-09-27, fourth)
 * stays with its preparations: a new queued row takes it over from the
 * row before it while it is this fresh, so an evidence change while the
 * dialog is open still prepares exactly the ticked files. Older, it no
 * longer applies (a tab closed with the dialog open).
 */
export const SELECTION_FRESH_MS = 10 * 60 * 1000;

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
 * today (firm day). It never starts spend on its own. Returns the queued
 * row, or null when nothing was queued.
 */
export async function requestBriefPreparation(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  trigger: { userId?: Id<"users">; reason: PreparationTriggerReason },
  delayMs: number = PREPARATION_DEBOUNCE_MS
): Promise<Id<"briefPreparations"> | null> {
  if (!(await briefPreparationEnabled(ctx))) return null;
  const project = await ctx.db.get(projectId);
  if (!project || project.deletionStartedAt !== undefined) return null;
  if (effectiveProjectType(project) !== "writing" || !preparationStageAllows(project)) return null;
  const now = Date.now();
  const queued = await ctx.db
    .query("briefPreparations")
    .withIndex("by_projectId_and_status", (q) => q.eq("projectId", projectId).eq("status", "queued"))
    .first();
  const latest = await ctx.db
    .query("briefPreparations")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .order("desc")
    .first();
  let triggeredBy = trigger.userId ?? queued?.triggeredBy;
  if (!triggeredBy) {
    const recent =
      latest !== null &&
      (latest.status === "running" ||
        (latest.status === "ready" && latest.firmDay === firmDayNumber(now)));
    if (!recent) return null;
    triggeredBy = latest.triggeredBy;
  }
  if (queued) {
    // The start this change replaces has not run yet: it would do nothing
    // (older revision), so it is not left in the queue.
    if (queued.scheduledJobId && queued.runAt > now) await ctx.scheduler.cancel(queued.scheduledJobId);
    const revision = queued.revision + 1;
    const scheduledJobId = await ctx.scheduler.runAfter(delayMs, internal.briefPreparations.startBriefPreparation, {
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
    return queued._id;
  }
  // A start dialog leave-out list set a moment ago still applies.
  const selection =
    latest?.selectionAt !== undefined && latest.selectionAt > now - SELECTION_FRESH_MS
      ? {
          ...(latest.excludedTranscriptIds ? { excludedTranscriptIds: latest.excludedTranscriptIds } : {}),
          ...(latest.excludedDocumentIds ? { excludedDocumentIds: latest.excludedDocumentIds } : {}),
          selectionAt: latest.selectionAt,
        }
      : {};
  const preparationId = await ctx.db.insert("briefPreparations", {
    projectId,
    status: "queued",
    revision: 1,
    runAt: now + delayMs,
    triggeredBy,
    triggerReason: trigger.reason,
    ...selection,
    createdAt: now,
    updatedAt: now,
  });
  const scheduledJobId = await ctx.scheduler.runAfter(delayMs, internal.briefPreparations.startBriefPreparation, {
    preparationId,
    revision: 1,
  });
  await ctx.db.patch(preparationId, { scheduledJobId });
  return preparationId;
}
