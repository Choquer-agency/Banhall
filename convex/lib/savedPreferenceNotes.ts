import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import type { WriterWordingRules } from "./writerWording";
import { extractWriterWordingRules, legacySavedBlock, legacySavedPreferenceTexts, writerWordingRulesFor } from "./settingsExtraction";

/** What a generation's Compliance Note rows are checked against before they are stored. */
export type SavedPreferenceMatch = {
  /** The saved preference texts, whole, as frozen beside the style. */
  texts: string[];
  /**
   * Ninth re-check: for a style frozen before the texts were kept beside it,
   * every line of the saved block and the whole block, matched as parts.
   */
  parts: string[];
  /**
   * Eighth re-check: the words of the wording rules read from saved
   * preferences (banned words and their forms, required terms and the words
   * banned in their place, required openings).
   */
  wording: string[];
  /** Ninth re-check: the same of the Writer Profile's own rules, which are public. */
  publicWording: string[];
};

const NO_MATCH: SavedPreferenceMatch = { texts: [], parts: [], wording: [], publicWording: [] };

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
      // Sixth re-check: the texts frozen beside the composed text. A style
      // frozen before they were kept has its saved block matched as parts,
      // and none of its rules come from that block (writerWordingRulesFor).
      const frozen = parsed.savedPreferenceTexts;
      const kept = Array.isArray(frozen) && frozen.every((text) => typeof text === "string") ? (frozen as string[]) : undefined;
      const rules = flavor ? writerWordingRulesFor(flavor, kept) : null;
      // An older draft's block is read for its rule words too, for this match
      // only: never measured, and any it reads by mistake only hides more.
      const wording = kept ? (rules ? ruleWords(rules, true) : []) : ruleWords(extractWriterWordingRules(legacySavedBlock(flavor)), "all");
      return {
        texts: kept ?? [],
        parts: kept ? [] : legacySavedPreferenceTexts(flavor),
        wording,
        publicWording: rules ? ruleWords(rules, false) : [],
      };
    } catch {
      return NO_MATCH;
    }
  }
  return NO_MATCH;
}

/** The saved preference texts, or an older draft's parts (see savedPreferenceMatchOfGeneration). */
export async function savedPreferencesOfGeneration(
  ctx: { db: QueryCtx["db"] },
  generation: Pick<Doc<"generations">, "_id" | "writerSettings">
): Promise<string[]> {
  const match = await savedPreferenceMatchOfGeneration(ctx, generation);
  return [...match.texts, ...match.parts];
}
