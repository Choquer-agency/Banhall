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
 * line that names the wording a seed's quotes do not back, when one of its
 * quotes is marked (`unbackedBullets`). The wording itself is never changed.
 */
export const UNBACKED_NOTE = "Its quotes do not back:";

/**
 * The card's line for wording its quotes do not back, or null: none for a
 * seed without a quote marked as unrelated. Round 3 review (P2-2): only the
 * sentences the writer has not changed are judged, so a fix to another
 * sentence keeps the line; a changed sentence is the writer's own. Without
 * the original wording an edited seed shows no line. Quoted with the same
 * curly marks as the quote card.
 */
export function unbackedNote(item: {
  bullets: readonly string[];
  originalBullets?: readonly string[];
  edited: boolean;
  provenance: ReadonlyArray<Pick<QuoteCitation, "exactExcerpt" | "needsQuoteCheck">>;
}): string | null {
  if (item.edited && !item.originalBullets) return null;
  const original = item.originalBullets ?? item.bullets;
  const unchanged = item.bullets.filter((bullet) => original.includes(bullet));
  const unbacked = unbackedBullets(unchanged, item.provenance, original);
  return unbacked.length > 0 ? `${UNBACKED_NOTE} ${unbacked.map((bullet) => `“${bullet}”`).join(" ")}` : null;
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
