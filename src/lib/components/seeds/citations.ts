/**
 * A cited excerpt behind a Seed bullet, as the plan and the Summary show it
 * (exact-quote underlines, owner decision 17). `speaker` and `line` are not
 * sent yet: deriving them needs each citation stamped when the Seed is
 * generated. Until then the quote card shows the excerpt and its source.
 */
export type QuoteCitation = {
  sourceId: string;
  exactExcerpt: string;
  speaker?: string;
  line?: number;
};

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
