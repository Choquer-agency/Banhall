import { unbackedBullets } from "../../../../convex/lib/seedQuoteSupport";

/**
 * A cited excerpt behind a Seed bullet, as the plan and the Summary show it
 * (exact-quote underlines, owner decision 17). `speaker` and `line` are
 * stamped when the Seed is written, from its frozen transcript. Older Seeds
 * and citations of other sources carry neither, so the quote card then shows
 * only the excerpt and its source.
 */
export type QuoteCitation = {
  sourceId: string;
  exactExcerpt: string;
  speaker?: string;
  line?: number;
  /**
   * The quoted turn's speaker had no confirmed role when the Seed was
   * written (owner decisions 24 and 25): the quote is shown with a gray
   * "Needs a check" note, never hidden or blocked.
   */
  needsSpeakerCheck?: boolean;
  /**
   * The quoted words share too few words with the Seed, or repeat another
   * Seed's quote (2026-09-27, third amendment): shown with a gray note and
   * a "Use it anyway" action, never hidden or blocked.
   */
  needsQuoteCheck?: boolean;
};

/** The note under a quote whose speaker is not confirmed yet. */
export const SPEAKER_CHECK_NOTE = "Needs a check: speaker not confirmed";

/** The note under a quote that may not back its seed (review P3-9). */
export const QUOTE_CHECK_NOTE = "This quote may not back this idea, so the draft will not use it as evidence.";

/** The action that keeps a seed's marked quotes as evidence. */
export const QUOTE_USE_ANYWAY = "Use it anyway";

/**
 * 2026-10-04 (second, round 3, owner approved 2026-10-05): the start of the
 * line that names the wording none of a seed's evidence quotes backs, when
 * one of its quotes is marked. The wording itself is never changed.
 */
export const UNBACKED_NOTE = "Its quotes do not back:";

/**
 * The card's line for wording its quotes do not back, or null: none for a
 * seed with no marked quote, and none once the writer edited the wording
 * (it is then the writer's own).
 */
export function unbackedNote(item: {
  bullets: readonly string[];
  edited: boolean;
  provenance: ReadonlyArray<Pick<QuoteCitation, "exactExcerpt" | "needsQuoteCheck">>;
}): string | null {
  if (item.edited) return null;
  const unbacked = unbackedBullets(item.bullets, item.provenance);
  return unbacked.length > 0 ? `${UNBACKED_NOTE} ${unbacked.map((bullet) => `"${bullet}"`).join(" ")}` : null;
}

/** "Priya, line 18", "Priya", "Line 18", or null; never a made-up attribution. */
export function citationSpeakerLine(citation: QuoteCitation): string | null {
  const speaker = citation.speaker?.trim() || null;
  const line =
    typeof citation.line === "number" && Number.isSafeInteger(citation.line) && citation.line > 0
      ? citation.line
      : null;
  if (speaker && line !== null) return `${speaker}, line ${line}`;
  if (speaker) return speaker;
  if (line !== null) return `Line ${line}`;
  return null;
}
