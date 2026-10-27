import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { WriterWordingRules } from "./writerWording";
import { holdsSavedBlock } from "./savedPreferences";
import { extractWriterWordingRules, writerWordingRulesFor } from "./settingsExtraction";

/** What a generation's Compliance Note rows are checked against before they are stored. */
export type SavedPreferenceMatch = {
  /** The saved preference texts, whole, as frozen beside the style. */
  texts: string[];
  /**
   * Eighth re-check: the words of the wording rules read from saved
   * preferences (banned words and their forms, required terms and the words
   * banned in their place, required openings).
   */
  wording: string[];
  /** Ninth re-check: the same of the Writer Profile's own rules, which are public. */
  publicWording: string[];
  /**
   * Tenth re-check: the style holds a saved block but no saved texts beside
   * it, which only this branch's own test deployments made (saved
   * preferences never shipped before). What is private in that block cannot
   * be told for certain, so every row the Self-check model wrote is hidden.
   */
  hideModelRows?: true;
};

const NO_MATCH: SavedPreferenceMatch = { texts: [], wording: [], publicWording: [] };

function ruleWords(rules: WriterWordingRules, saved: boolean | "all"): string[] {
  const own = <T extends { savedPreference?: true }>(rule: T) => saved === "all" || (rule.savedPreference === true) === saved;
  return [
    ...rules.terms.filter(own).flatMap((rule) => [rule.term, ...rule.banned]),
    ...rules.banned.filter(own).flatMap((rule) => [rule.phrase, ...rule.forms]),
    ...rules.openings.filter(own).map((rule) => rule.opening),
  ];
}

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
      // Sixth re-check: the texts frozen beside the composed text.
      const frozen = parsed.savedPreferenceTexts;
      const kept = Array.isArray(frozen) && frozen.every((text) => typeof text === "string") ? (frozen as string[]) : undefined;
      if (!kept) return flavor && holdsSavedBlock(flavor) ? { ...NO_MATCH, hideModelRows: true } : NO_MATCH;
      // Eleventh re-check: the private words come from each saved text read
      // on its own, before any merging with the Writer Profile's rules, so a
      // synonym or form a preference adds to a rule the profile also holds
      // stays private. A word is public only when the profile's own rules
      // (or the House Rules) hold it.
      const rules = flavor ? writerWordingRulesFor(flavor, kept) : null;
      return {
        texts: kept,
        wording: kept.flatMap((text) => ruleWords(extractWriterWordingRules(text), "all")),
        publicWording: rules ? ruleWords(rules, false) : [],
      };
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
