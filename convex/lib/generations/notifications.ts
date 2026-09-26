/**
 * Round 2 AI-run notifications (WS3 spec section 6, F6): the three emitters
 * a generation raises for the writer who started it (`requestedBy`), written
 * through WS1's `notify` with `shared/notifications.ts` copy. Each runs in the
 * mutation that makes the move, so the row lands in the same transaction.
 * `notify` itself skips inactive recipients, switched-off kinds and repeated
 * dedupe keys, so a retried mutation never writes a second row.
 */
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { notify } from "../notify";
import { notificationCopy } from "../../../shared/notifications";
import {
  PD_SUBSECTIONS,
  type PdSubsectionRoleId,
} from "../../../shared/pdSubsections";

type GenerationForNotify = Pick<
  Doc<"generations">,
  "_id" | "projectId" | "requestedBy"
>;

/** The project page; the toaster navigates here. */
export function projectPageHref(projectId: Doc<"projects">["_id"]): string {
  return `/project/${projectId}`;
}

/** The project page opened on one Plan step (`?step=` is read by the seed
 * workspace, WS3 spec section 5 "Deep link"). */
export function projectStepHref(
  projectId: Doc<"projects">["_id"],
  roleId: PdSubsectionRoleId
): string {
  return `${projectPageHref(projectId)}?step=${encodeURIComponent(roleId)}`;
}

/** The step's label as the Plan outline shows it ("Company / Context"). */
export function seedStepLabel(roleId: PdSubsectionRoleId): string {
  return PD_SUBSECTIONS.find((subsection) => subsection.roleId === roleId)?.title ?? roleId;
}

async function projectOf(ctx: MutationCtx, generation: GenerationForNotify) {
  const project = await ctx.db.get(generation.projectId);
  if (!project || project.deletionStartedAt !== undefined) return null;
  return project;
}

/** `ideas_ready`: the first `open` Batch of a step became `shown`. */
export async function notifyIdeasReady(
  ctx: MutationCtx,
  generation: GenerationForNotify,
  roleId: PdSubsectionRoleId
) {
  if (!generation.requestedBy) return null;
  const project = await projectOf(ctx, generation);
  if (!project) return null;
  const copy = notificationCopy.ideasReady({
    step: seedStepLabel(roleId),
    project: project.title,
  });
  return await notify(ctx, {
    userId: generation.requestedBy,
    kind: "ideas_ready",
    projectId: project._id,
    generationId: generation._id,
    title: copy.title,
    body: copy.body,
    href: projectStepHref(project._id, roleId),
    dedupeKey: `ideas_ready:${generation._id}:${roleId}`,
  });
}

/** `draft_ready`: a Single or signed-off Step-by-step generation moved
 * `running` to `completed`. */
export async function notifyDraftReady(
  ctx: MutationCtx,
  generation: GenerationForNotify
) {
  if (!generation.requestedBy) return null;
  const project = await projectOf(ctx, generation);
  if (!project) return null;
  // Read after the transition's patch: only a running QA pass earns
  // "QA is checking it".
  const fresh = await ctx.db.get(generation._id);
  const copy = notificationCopy.draftReady({
    project: project.title,
    qaRunning: fresh?.postQaStatus === "running",
  });
  return await notify(ctx, {
    userId: generation.requestedBy,
    kind: "draft_ready",
    projectId: project._id,
    generationId: generation._id,
    title: copy.title,
    body: copy.body,
    href: projectPageHref(project._id),
    dedupeKey: `draft_ready:${generation._id}`,
  });
}

/** `qa_finished`: a post-QA pass moved to `done`. Each pass has its own
 * `completedAt`, so a rerun from the QA panel notifies again while a retried
 * save of the same pass does not. Without a score there is no copy to show,
 * so nothing is written. */
export async function notifyQaFinished(
  ctx: MutationCtx,
  generation: GenerationForNotify,
  pass: { score: number | undefined; completedAt: number }
) {
  if (!generation.requestedBy) return null;
  if (pass.score === undefined || !Number.isFinite(pass.score)) return null;
  const project = await projectOf(ctx, generation);
  if (!project) return null;
  const copy = notificationCopy.qaFinished({
    project: project.title,
    score: Math.round(pass.score),
  });
  return await notify(ctx, {
    userId: generation.requestedBy,
    kind: "qa_finished",
    projectId: project._id,
    generationId: generation._id,
    title: copy.title,
    body: copy.body,
    href: projectPageHref(project._id),
    dedupeKey: `qa_finished:${generation._id}:${pass.completedAt}`,
  });
}
