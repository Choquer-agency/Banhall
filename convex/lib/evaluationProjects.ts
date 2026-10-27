import type { Doc } from "../_generated/dataModel";
import { PRODUCTION_DEPLOYMENTS } from "../../shared/releaseEval";

/**
 * 2026-10-27 (Phase E, E3): evaluation projects. The release suite
 * (scripts/seed-plan-eval.mjs) marks each project it makes, so its fictional
 * work never feeds learning (lesson set inputs and learning signals), writer
 * memory, edit size or Brain nomination.
 */
export function isEvaluationProject(project: Pick<Doc<"projects">, "evaluation"> | null | undefined): boolean {
  return project?.evaluation !== undefined;
}

/**
 * Why a deployment may not make evaluation projects, or null when it may.
 * E3 review: an allow list, not a deny list. A local backend may; any other
 * deployment only when the owner sets BANHALL_EVALUATION_PROJECTS to
 * "allowed" on it; production never, whatever is set.
 */
export function evaluationRefusal(): string | null {
  const url = (process.env.CONVEX_CLOUD_URL ?? "").toLowerCase();
  if (PRODUCTION_DEPLOYMENTS.some((name) => url.includes(name))) {
    return "Evaluation projects are never made on production";
  }
  const local = /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/.test(url);
  if (!local && process.env.BANHALL_EVALUATION_PROJECTS !== "allowed") {
    return "Evaluation projects are made only on a local deployment, or one where BANHALL_EVALUATION_PROJECTS is allowed";
  }
  return null;
}
