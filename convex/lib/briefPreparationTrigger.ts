/**
 * Asking for a Brief preparation (2026-09-26, decision 65). Called only
 * from server mutations that change a writing project's evidence (a
 * transcript or file added, replaced, archived, restored or deleted, a
 * speaker role, a finished turn build, the client name or fiscal year),
 * never from a read or a page mount. It debounces: the preparation starts
 * PREPARATION_DEBOUNCE_MS after the last change of a burst, so a batch of
 * uploads asks once. Whether it is worth a paid call is decided when it
 * starts (convex/briefPreparations.ts).
 */
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
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
 * Queue (or push back) the project's preparation. `userId` is the report
 * editor whose change this is; a system change (a finished turn build or
 * speaker classification) passes none and only follows up a preparation
 * someone already asked for.
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
  if (effectiveProjectType(project) !== "writing") return;
  const queued = await ctx.db
    .query("briefPreparations")
    .withIndex("by_projectId_and_status", (q) => q.eq("projectId", projectId).eq("status", "queued"))
    .first();
  let triggeredBy = trigger.userId ?? queued?.triggeredBy;
  if (!triggeredBy) {
    const latest = await ctx.db
      .query("briefPreparations")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .order("desc")
      .first();
    if (!latest || (latest.status !== "ready" && latest.status !== "running")) return;
    triggeredBy = latest.triggeredBy;
  }
  const now = Date.now();
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
