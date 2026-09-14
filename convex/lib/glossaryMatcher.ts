import type { Doc, Id } from "../_generated/dataModel";

/**
 * A glossary term that the Brief uses consistently.
 */
export interface GlossaryTerm {
  term: string;
  // Optional: inflected forms (plurals, past tense, etc.)
  inflections?: string[];
  definition?: string;
}

/**
 * Result of matching a term in text: the matched text and its location.
 */
export interface MatchedTerm {
  text: string;
  startOffset: number;
  endOffset: number;
  // The canonical glossary term this matches
  canonicalTerm: string;
  // Whether this was matched by the rule-based matcher (true) or
  // flagged as a candidate for model review (false means model classification)
  ruleBasedMatch: boolean;
}

/**
 * Rule-based glossary matcher: exact + inflected word matching.
 *
 * The matcher is deterministic and offline-testable. It:
 * 1. Matches exact word boundaries (case-insensitive)
 * 2. Matches inflected forms (plurals, past tense) via a fixed set
 * 3. Flags candidates that exceed rule coverage for model classification
 *
 * The fixture validates ≥95% coverage of known synonyms. Model classification
 * is only applied to flagged candidates, reducing model cost.
 *
 * Returns matches in order of appearance in the text.
 */
export function matchGlossaryTerms(
  glossaryTerms: GlossaryTerm[],
  text: string,
  _trustedSources?: Array<Omit<Doc<"generationSources">, "_id" | "_creationTime">>
): MatchedTerm[] {
  const matches: MatchedTerm[] = [];

  // Build a set of all matchable forms (term + inflections) → canonical term
  // Sorted by length (longest first) to match multi-word terms first
  const termsByLength: Array<{ pattern: string; canonical: string; length: number }> = [];

  for (const term of glossaryTerms) {
    const canonical = term.term.toLowerCase();
    termsByLength.push({
      pattern: canonical,
      canonical,
      length: canonical.split(/\s+/).length,
    });

    // Add inflections if provided
    if (term.inflections) {
      for (const inflection of term.inflections) {
        const lower = inflection.toLowerCase();
        termsByLength.push({
          pattern: lower,
          canonical,
          length: lower.split(/\s+/).length,
        });
      }
    }
  }

  // Sort by length descending, then lexicographically (for determinism)
  termsByLength.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    return a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0;
  });

  // Track used ranges to avoid overlaps
  const used = new Set<string>();

  // Search for matches
  for (const { pattern, canonical } of termsByLength) {
    const lowerText = text.toLowerCase();
    let searchPos = 0;

    while (true) {
      const index = lowerText.indexOf(pattern, searchPos);
      if (index === -1) break;

      // Check if this range is already used
      const key = `${index}-${index + pattern.length}`;
      if (used.has(key)) {
        searchPos = index + 1;
        continue;
      }

      // Check word boundaries (if needed for single words)
      const charBefore = index > 0 ? text[index - 1] : " ";
      const charAfter = index + pattern.length < text.length ? text[index + pattern.length] : " ";

      const isBoundaryBefore = !/[a-z0-9]/i.test(charBefore);
      const isBoundaryAfter = !/[a-z0-9]/i.test(charAfter);

      if (isBoundaryBefore && isBoundaryAfter) {
        // Valid match
        used.add(key);
        matches.push({
          text: text.slice(index, index + pattern.length),
          startOffset: index,
          endOffset: index + pattern.length,
          canonicalTerm: canonical,
          ruleBasedMatch: true,
        });
      }

      searchPos = index + 1;
    }
  }

  // Sort matches by position
  matches.sort((a, b) => a.startOffset - b.startOffset);

  return matches;
}

/** A rule-based glossary match resolved to the frozen source row it cites. */
export interface GlossarySourceMatch extends MatchedTerm {
  sourceId: Id<"generationSources">;
  sourceContentHash: string;
}

/**
 * Match glossary terms across a set of frozen sources, one source at a time
 * (never a concatenated blob — offsets stay relative to each source's own
 * content, which is what citation byte-match validation checks). Returns at
 * most one entry per canonical term: the first occurrence found, in source
 * order, so a common term doesn't flood the Brief with a row per mention.
 */
export function matchGlossaryTermsAcrossSources(
  glossaryTerms: GlossaryTerm[],
  sources: Array<Pick<Doc<"generationSources">, "_id" | "content" | "contentHash">>
): GlossarySourceMatch[] {
  const seenCanonicalTerms = new Set<string>();
  const results: GlossarySourceMatch[] = [];
  for (const source of sources) {
    const matches = matchGlossaryTerms(glossaryTerms, source.content);
    for (const match of matches) {
      if (seenCanonicalTerms.has(match.canonicalTerm)) continue;
      seenCanonicalTerms.add(match.canonicalTerm);
      results.push({
        ...match,
        sourceId: source._id,
        sourceContentHash: source.contentHash,
      });
    }
  }
  return results;
}

/**
 * The glossary terms the rule-based matcher (exact + inflected) found ZERO
 * occurrences of anywhere in the frozen sources. These are the "candidates
 * the matcher flags" the Boundaries rule requires: a term genuinely present
 * in the project but expressed in words the rule set doesn't cover (a real
 * synonym, not a plural/past-tense the inflection list already handles)
 * would show up here. Model classification (`brief.ts`) is the only
 * consumer, and only for these — a term the rules already matched is never
 * re-sent to the model.
 */
export function flaggedGlossaryTerms(
  glossaryTerms: GlossaryTerm[],
  sources: Array<Pick<Doc<"generationSources">, "_id" | "content" | "contentHash">>
): GlossaryTerm[] {
  const matchedCanonicalTerms = new Set(
    matchGlossaryTermsAcrossSources(glossaryTerms, sources).map((m) => m.canonicalTerm)
  );
  return glossaryTerms.filter(
    (term) => !matchedCanonicalTerms.has(term.term.toLowerCase())
  );
}

/**
 * Test fixture validation: check that the matcher identifies ≥95% of known
 * synonyms in a fixture. Used to validate the rule set before deployment.
 *
 * Returns {coverage: 0..1, matched: count, total: count}.
 */
export function validateGlossaryFixture(
  glossaryTerms: GlossaryTerm[],
  fixtureText: string,
  expectedMatches: number
): { coverage: number; matched: number; total: number } {
  const matches = matchGlossaryTerms(glossaryTerms, fixtureText);
  const matched = matches.filter((m) => m.ruleBasedMatch).length;
  const coverage = matched / expectedMatches;
  return { coverage, matched, total: expectedMatches };
}
