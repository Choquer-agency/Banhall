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
      const parsed = JSON.parse(artifact.content) as { writerFlavor?: unknown; savedPreferenceTexts?: unknown };
      // Sixth re-check: the texts frozen beside the composed text; a style
      // frozen before they were kept is read back from the composed text.
      const texts = parsed.savedPreferenceTexts;
      if (Array.isArray(texts) && texts.every((text) => typeof text === "string")) return texts;
      return savedPreferencesIn(typeof parsed.writerFlavor === "string" ? parsed.writerFlavor : undefined);
    } catch {
      return [];
    }
  }
  return [];
}
