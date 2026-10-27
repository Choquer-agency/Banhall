import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { legacySavedPreferenceTexts, writerWordingRulesFor } from "./settingsExtraction";

/** What a generation's Compliance Note rows are checked against before they are stored. */
export type SavedPreferenceMatch = {
  /** The saved preference texts (for a style frozen before they were kept, every line of the block). */
  texts: string[];
  /**
   * Eighth re-check: the words of the wording rules read from those texts
   * (banned words and their forms, required terms and the words banned in
   * their place, required openings). The Writer Profile's own rules are not
   * among them.
   */
  wording: string[];
};

const NO_MATCH: SavedPreferenceMatch = { texts: [], wording: [] };

/**
 * E1b review: the saved preferences a generation's frozen style used, so
 * its Compliance Note rows never carry their text (convex/lib/
 * savedPreferences.ts, `withoutSavedPreferenceText`). Reads the frozen
 * style only when the generation recorded that it used some.
 */
export async function savedPreferenceMatchOfGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Pick<Doc<"generations">, "_id" | "writerSettings">
): Promise<SavedPreferenceMatch> {
  if (!generation.writerSettings?.savedPreferences?.count) return NO_MATCH;
  for (const kind of ["writer_style", "brain_blocks"] as const) {
    const artifact = await ctx.db
      .query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", generation._id).eq("kind", kind))
      .first();
    if (!artifact?.content) continue;
    try {
      const parsed = JSON.parse(artifact.content) as { writerFlavor?: unknown; savedPreferenceTexts?: unknown };
      const flavor = typeof parsed.writerFlavor === "string" ? parsed.writerFlavor : undefined;
      // Sixth re-check: the texts frozen beside the composed text; a style
      // frozen before they were kept is read back from the composed text.
      const frozen = parsed.savedPreferenceTexts;
      const kept = Array.isArray(frozen) && frozen.every((text) => typeof text === "string") ? (frozen as string[]) : undefined;
      const rules = flavor ? writerWordingRulesFor(flavor, kept) : null;
      const wording = rules
        ? [
            ...rules.terms.filter((rule) => rule.savedPreference).flatMap((rule) => [rule.term, ...rule.banned]),
            ...rules.banned.filter((rule) => rule.savedPreference).flatMap((rule) => [rule.phrase, ...rule.forms]),
            ...rules.openings.filter((rule) => rule.savedPreference).map((rule) => rule.opening),
          ]
        : [];
      return { texts: kept ?? legacySavedPreferenceTexts(flavor), wording };
    } catch {
      return NO_MATCH;
    }
  }
  return NO_MATCH;
}

/** The saved preference texts alone (see savedPreferenceMatchOfGeneration). */
export async function savedPreferencesOfGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Pick<Doc<"generations">, "_id" | "writerSettings">
): Promise<string[]> {
  return (await savedPreferenceMatchOfGeneration(ctx, generation)).texts;
}
