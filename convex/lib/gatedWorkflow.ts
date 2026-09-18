import type { Doc } from "../_generated/dataModel";

/** Legacy iterative rows retain section approval without a backfill. */
export function resolveGatedWorkflow(
  generation: Pick<Doc<"generations">, "candidateMode" | "gatedWorkflow">
): Doc<"generations">["gatedWorkflow"] {
  return generation.gatedWorkflow ??
    (generation.candidateMode === "iterative" ? "sections" : undefined);
}
