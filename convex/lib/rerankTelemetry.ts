import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export type RerankOutcome = "success" | "fallback" | "skip" | "search_error";

/** Best-effort operational observation, independent of billed usage. */
export async function recordRerankOutcome(
  ctx: ActionCtx,
  outcome: RerankOutcome,
  callSite: string
): Promise<void> {
  try {
    // Generated once per terminal observation; mutation retries retain this ID.
    await ctx.runMutation(internal.learningHealth.recordRerankOutcome, {
      operationId: crypto.randomUUID(),
      observedAt: Date.now(),
      outcome,
      callSite,
    });
  } catch {
    // Do not log provider errors, queries or exemplar prose in this diagnostic.
    console.error("brain rerank outcome recording failed", { outcome, callSite });
  }
}
