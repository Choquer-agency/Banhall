import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { savedPreferencesIn } from "./savedPreferences";

/**
 * E1b review: the saved preferences a generation's frozen style used, so
 * its Compliance Note rows never carry their text (convex/lib/
 * savedPreferences.ts, `withoutSavedPreferenceText`). Reads the frozen
 * style only when the generation recorded that it used some.
 */
export async function savedPreferencesOfGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Pick<Doc<"generations">, "_id" | "writerSettings">
): Promise<string[]> {
  if (!generation.writerSettings?.savedPreferences?.count) return [];
  for (const kind of ["writer_style", "brain_blocks"] as const) {
    const artifact = await ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", generation._id).eq("kind", kind))
      .first();
    if (!artifact?.content) continue;
    try {
      const parsed = JSON.parse(artifact.content) as { writerFlavor?: unknown };
      return savedPreferencesIn(typeof parsed.writerFlavor === "string" ? parsed.writerFlavor : undefined);
    } catch {
      return [];
    }
  }
  return [];
}
