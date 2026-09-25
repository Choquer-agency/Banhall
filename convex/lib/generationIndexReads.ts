import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Generation-scoped reads backed by the 2026-09-25 indexes
 * (`seedProvenance.by_generationId_and_seedId`, `summaryItems.by_generationId`).
 * Each read is bounded: it returns at most `limit` rows and says whether that
 * was every row, so a caller never mistakes a prefix for the whole set.
 */

export type BoundedRead<T> = { rows: T[]; complete: boolean };

async function bounded<T>(rows: Promise<T[]>, limit: number): Promise<BoundedRead<T>> {
  const read = await rows;
  return read.length > limit
    ? { rows: read.slice(0, limit), complete: false }
    : { rows: read, complete: true };
}

/** Every Seed citation written for one generation (all of its Seeds). */
export async function listGenerationSeedProvenance(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  limit: number
): Promise<BoundedRead<Doc<"seedProvenance">>> {
  return await bounded(
    ctx.db
      .query("seedProvenance")
      .withIndex("by_generationId_and_seedId", (q) => q.eq("generationId", generationId))
      .take(limit + 1),
    limit
  );
}

/** One Seed's citations, scoped to the generation that owns the Seed. */
export async function listSeedProvenanceInGeneration(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  seedId: Id<"seeds">,
  limit: number
): Promise<BoundedRead<Doc<"seedProvenance">>> {
  return await bounded(
    ctx.db
      .query("seedProvenance")
      .withIndex("by_generationId_and_seedId", (q) =>
        q.eq("generationId", generationId).eq("seedId", seedId)
      )
      .take(limit + 1),
    limit
  );
}

/** Every Summary item frozen for one generation, across its Summary versions. */
export async function listGenerationSummaryItems(
  ctx: { db: QueryCtx["db"] },
  generationId: Id<"generations">,
  limit: number
): Promise<BoundedRead<Doc<"summaryItems">>> {
  return await bounded(
    ctx.db
      .query("summaryItems")
      .withIndex("by_generationId", (q) => q.eq("generationId", generationId))
      .take(limit + 1),
    limit
  );
}
