// Canonical banned-word machinery for CRA-bound report prose. The word list
// mirrors SHARED_WRITING_RULES in convex/ai/prompts.ts; the scrubber is the
// programmatic safety net behind the LLM self-check (generation pipeline +
// chat edits), and the QA scan (convex/ai/qaChecks.ts) derives its term list
// from the same tables so scrubber and scanner cannot diverge.

/**
 * Whole-word, case-insensitive replacements (surface form → substitute).
 * Substitutes are meaning-preserving and inflection-matched. The scrubber
 * carries a leading capital (and full ALL-CAPS) from the matched word onto
 * the substitute. Hyphenated and multi-word terms are allowed; internal
 * spaces match any whitespace run. Word boundaries are strict: "novelty",
 * "uniquely", and "transformation" are never touched.
 */
export const BANNED_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["novel", "new"],
  ["pioneering", "new"],
  ["revolutionary", "new"],
  ["groundbreaking", "new"],
  ["innovative", "new"],
  ["pivotal", "critical"],
  ["seamless", "smooth"],
  ["substantial", "considerable"],
  ["substantially", "considerably"],
  ["significant", "marked"],
  ["significantly", "markedly"],
  ["unique", "distinct"],
  ["cutting-edge", "advanced"],
  ["state-of-the-art", "current"],
  ["comprehensive", "thorough"],
  ["robust", "reliable"],
  ["holistic", "complete"],
  ["synergy", "coordination"],
  ["leverage", "use"],
  ["leverages", "uses"],
  ["leveraged", "used"],
  ["leveraging", "using"],
  ["harness", "use"],
  ["harnesses", "uses"],
  ["harnessed", "used"],
  ["harnessing", "using"],
  ["revolutionize", "change"],
  ["revolutionizes", "changes"],
  ["revolutionized", "changed"],
  ["revolutionizing", "changing"],
  ["transformative", "important"],
  ["game-changing", "important"],
  ["paradigm", "approach"],
  ["ecosystem", "environment"],
  ["spearheading", "leading"],
  ["delving into", "examining"],
];

/**
 * Connectives/intensifiers deleted outright (no meaning-preserving substitute
 * exists — prompts.ts says "just start the next sentence"). Deletion consumes
 * a trailing comma, collapses the surrounding whitespace, and when the deleted
 * word opened a sentence the following word is re-capitalized:
 * "Furthermore, the tests passed." → "The tests passed."
 */
export const BANNED_DELETIONS: readonly string[] = [
  "fundamentally",
  "furthermore",
  "moreover",
  "additionally",
];

/**
 * Banned terms with no safe mechanical fix — "transform" is also a technical
 * noun (Fourier transform), and the phrases need a real rewrite ("measurable
 * improvement" must become the actual measurement). Scanned by QA, left for a
 * human/LLM to rework.
 */
export const SCAN_ONLY_TERMS: readonly string[] = [
  "transform",
  "delving",
  "formed the foundation",
  "paved the way",
  "serves as a testament",
  "measurable improvement",
];

/**
 * Every term the QA banned-word scan flags: all scrubbable surface forms plus
 * the scan-only terms above. Derived, never hand-maintained. A phrase whose
 * leading word is itself a listed term ("delving into" vs "delving") would
 * flag the same span twice — keep the shorter term, which matches every
 * occurrence of the longer one.
 */
export const BANNED_SCAN_TERMS: readonly string[] = (() => {
  const all = [
    ...new Set([
      ...BANNED_REPLACEMENTS.map(([term]) => term),
      ...BANNED_DELETIONS,
      ...SCAN_ONLY_TERMS,
    ]),
  ];
  return all.filter(
    (term) => !all.some((other) => other !== term && term.startsWith(other + " "))
  );
})();

/** Escape a term for regex use; internal spaces match any whitespace run. */
function escapeTerm(term: string): string {
  return term
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
}

/** Fresh whole-word, case-insensitive matcher for one banned term. */
export function bannedTermPattern(term: string): RegExp {
  return new RegExp(`\\b${escapeTerm(term)}\\b`, "gi");
}

/** Carry the matched word's leading capital (or full ALL-CAPS) onto the substitute. */
function preserveCase(matched: string, replacement: string): string {
  if (
    matched.length > 1 &&
    matched === matched.toUpperCase() &&
    matched !== matched.toLowerCase()
  ) {
    return replacement.toUpperCase();
  }
  const first = matched[0];
  if (first === first.toUpperCase() && first !== first.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// End-of-`before` shapes that mean the match opened a sentence.
const SENTENCE_START = /(?:^|[.!?]["')\]]*\s|\n)[ \t]*$/;

/**
 * Delete every occurrence of `term`, consuming a trailing comma + whitespace,
 * dropping both commas of a parenthetical ("was, fundamentally, a" → "was a"),
 * and re-capitalizing the following word when the deleted term opened a
 * sentence. Loops to a fixpoint so stacked connectives ("Furthermore,
 * additionally, …") cannot survive a single scrub.
 */
function deleteTerm(text: string, term: string): string {
  const re = new RegExp(
    `(,[ \\t]*)?\\b${escapeTerm(term)}\\b(,?[ \\t]*)([A-Za-z])?`,
    "gi"
  );
  const pass = (input: string) =>
    input.replace(
      re,
      (
        _match: string,
        preComma: string | undefined,
        trailing: string,
        nextLetter: string | undefined,
        offset: number,
        whole: string
      ) => {
        if (nextLetter === undefined) return "";
        if (SENTENCE_START.test(whole.slice(0, offset))) {
          return nextLetter.toUpperCase();
        }
        // Parenthetical: both commas go. Clause comma with no trailing comma:
        // the comma belongs to the sentence and stays.
        if (preComma && trailing.startsWith(",")) return ` ${nextLetter}`;
        if (preComma) return preComma + nextLetter;
        return nextLetter;
      }
    );
  let prev: string;
  let result = text;
  do {
    prev = result;
    result = pass(result);
  } while (result !== prev);
  return result;
}

/**
 * Programmatic safety net: replace/delete banned words the LLM self-check
 * missed. Case-preserving, whole-word, punctuation-safe; output is stable
 * under re-scrubbing (no substitute or deletion artifact is itself banned).
 */
export function scrubBannedWords(text: string): string {
  let result = text;
  for (const [term, replacement] of BANNED_REPLACEMENTS) {
    result = result.replace(bannedTermPattern(term), (matched) =>
      preserveCase(matched, replacement)
    );
  }
  for (const term of BANNED_DELETIONS) {
    result = deleteTerm(result, term);
  }
  // Deletion artifacts: space left before punctuation, doubled spaces.
  return result
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
}
