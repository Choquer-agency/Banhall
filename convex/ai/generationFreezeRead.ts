"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { ModelFreeze } from "../lib/modelCatalogValidators";
import { generationModelsRef } from "../lib/modelCatalogRefs";

/**
 * A generation's freeze, read once per action invocation (keyed by its
 * ctx), so a step's routing and its prompt version come from one snapshot.
 * The freeze changes when the generation leaves a model its tier was moved
 * back from (2026-10-23, second): a new action reads it afresh, while one
 * action keeps the models it started with. Pass the action's own ctx; a
 * spread copy reads again.
 */
let freezeCache = new WeakMap<object, Map<string, Promise<ModelFreeze | null>>>();

/** Test seam: forget cached generation freezes. */
export function resetGenerationFreezeReads(): void {
  freezeCache = new WeakMap();
}

export async function readGenerationFreeze(
  ctx: Pick<ActionCtx, "runQuery">,
  generationId: Id<"generations">
): Promise<ModelFreeze | null> {
  let cache = freezeCache.get(ctx);
  if (!cache) {
    cache = new Map();
    freezeCache.set(ctx, cache);
  }
  let pending = cache.get(generationId);
  if (!pending) {
    const owner = cache;
    pending = ctx.runQuery(generationModelsRef, { generationId }).catch((error: unknown) => {
      owner.delete(generationId);
      throw error;
    });
    cache.set(generationId, pending);
  }
  return await pending;
}
