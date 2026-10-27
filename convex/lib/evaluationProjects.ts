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

/** True on a production deployment, where projects are never marked. */
export function onProductionDeployment(): boolean {
  const url = (process.env.CONVEX_CLOUD_URL ?? "").toLowerCase();
  return PRODUCTION_DEPLOYMENTS.some((name) => url.includes(name));
}
