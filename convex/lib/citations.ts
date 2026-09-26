import type { Id } from "../_generated/dataModel";

/**
 * Shared citation matching + validation for anything that cites a frozen
 * `generationSources` row byte-for-byte — the same rule
 * `reports.createProvenance` (`convex/reports.ts:77-139`) enforces for report
 * claims, reused here for Generation Brief entries (story 1, CAP-1/2/4).
 *
 * Pure and offline-testable: no `ctx`, no network.
 */

export type FrozenSource = {
  _id: Id<"generationSources">;
  content: string;
  contentHash: string;
};

export type Citation = {
  sourceId: Id<"generationSources">;
  sourceContentHash: string;
  exactExcerpt: string;
  startOffset: number;
  endOffset: number;
};

/**
 * Locate a verbatim quote across a set of frozen sources. First match in
 * source order wins (mirrors `lib/transcripts.ts:findQuoteInParts`).
 */
export function findQuoteInSources<T extends FrozenSource>(
  sources: T[],
  quote: string
): { source: T; startOffset: number } | null {
  if (!quote) return null;
  for (const source of sources) {
    const startOffset = source.content.indexOf(quote);
    if (startOffset !== -1) return { source, startOffset };
  }
  return null;
}

/**
 * Resolve a model-proposed quote to a citation against the frozen source it
 * actually came from. Offsets are computed here — never trusted from the
 * model, which cannot know byte offsets — and are relative to the source
 * row's own `content`, which is what validation below byte-checks.
 */
export function citeQuote<T extends FrozenSource>(
  sources: T[],
  quote: string
): Citation | null {
  const found = findQuoteInSources(sources, quote);
  if (!found) return null;
  return {
    sourceId: found.source._id,
    sourceContentHash: found.source.contentHash,
    exactExcerpt: quote,
    startOffset: found.startOffset,
    endOffset: found.startOffset + quote.length,
  };
}

/**
 * Every place a verbatim quote occurs, in citeQuote's order (sources in the
 * given order, then position), at most `limit`. The first is exactly what
 * citeQuote returns. A caller that must skip some places (an interviewer's
 * turn, owner decision 25) takes the first acceptable one.
 */
export function quoteOccurrences<T extends FrozenSource>(
  sources: T[],
  quote: string,
  limit: number
): Citation[] {
  const found: Citation[] = [];
  if (!quote) return found;
  for (const source of sources) {
    for (
      let at = source.content.indexOf(quote);
      at !== -1 && found.length < limit;
      at = source.content.indexOf(quote, at + 1)
    ) {
      found.push({
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        exactExcerpt: quote,
        startOffset: at,
        endOffset: at + quote.length,
      });
    }
    if (found.length >= limit) break;
  }
  return found;
}

/**
 * Byte-match validation identical in behaviour to `reports.createProvenance`:
 * the source's contentHash matches, the offsets are in range, and the exact
 * slice equals the claimed excerpt.
 */
export function validateCitation<T extends FrozenSource>(
  source: T | null | undefined,
  citation: {
    sourceContentHash: string;
    startOffset: number;
    endOffset: number;
    exactExcerpt: string;
  }
): boolean {
  return (
    !!source &&
    source.contentHash === citation.sourceContentHash &&
    citation.startOffset >= 0 &&
    citation.endOffset > citation.startOffset &&
    citation.endOffset <= source.content.length &&
    source.content.slice(citation.startOffset, citation.endOffset) ===
      citation.exactExcerpt
  );
}
