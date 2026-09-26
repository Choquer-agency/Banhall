import type { Doc } from "../_generated/dataModel";

/** Legacy iterative rows retain section approval without a backfill. */
export function resolveGatedWorkflow(
  generation: Pick<Doc<"generations">, "candidateMode" | "gatedWorkflow">
): Doc<"generations">["gatedWorkflow"] {
  return generation.gatedWorkflow ??
    (generation.candidateMode === "iterative" ? "sections" : undefined);
}

export type SeedPhase =
  | "initializing"
  | "seeding"
  | "closed"
  | "drafting"
  | "draftFailed"
  | "completed";

/**
 * The one Seed phase projection (AD-31/AD-40). Only an unsigned generation
 * waiting in `awaiting_input` with initialized rows is an open seed stage; a
 * failed or cancelled unsigned run is closed even when its rows exist, so
 * hosts route it through the existing failure retry and report surfaces.
 */
export function resolveSeedPhase(
  generation: Pick<
    Doc<"generations">,
    "candidateMode" | "gatedWorkflow" | "status" | "summaryVersionId"
  >,
  hasSeedRows: boolean
): SeedPhase | undefined {
  if (resolveGatedWorkflow(generation) !== "seeds") return undefined;
  if (generation.status === "completed") return "completed";
  if (generation.summaryVersionId) {
    return generation.status === "failed" ? "draftFailed" : "drafting";
  }
  if (generation.status === "failed" || generation.status === "superseded") {
    return "closed";
  }
  if (generation.status === "awaiting_input" && hasSeedRows) return "seeding";
  return "initializing";
}
