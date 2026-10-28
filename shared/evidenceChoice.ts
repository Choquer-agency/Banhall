/**
 * Choosing evidence by relevance (Phase D, owner decision "2026-10-28
 * (fourth)", plan `docs/todos/phase-d-evidence-layer.md`): pure, shared
 * helpers that pick the parts of a draft's frozen rows that best match a
 * subject, within a step's budget, so a step no longer reads its rows in
 * frozen order until the budget runs out.
 *
 * - Everything fits: every row is sent whole, exactly as before, so a small
 *   project is unchanged.
 * - Rows that must go in whole (the settings document, writer's notes) go
 *   first.
 * - The rest of the budget takes the best-scoring parts of the other rows
 *   (the same cut as search pieces), then the parts that match nothing, in
 *   row order, so with no subject the choice is the old order.
 * - Every range's start and end land between words, never inside one, so a
 *   cut never leaves a fragment of a name unmasked (names are masked only
 *   where they stand whole).
 *
 * The score is BM25 over the candidate parts: a rare word of the subject
 * counts for more than a common one, and a long part does not win by
 * length. Every input decides the output, and ties go to the earlier row
 * and the earlier position, so the same rows and subject give the same
 * choice (retries send the same bytes; a prepared Brief's key holds).
 */

import { splitSearchPieces } from "./searchPieces";

// ─── Folding and terms ───────────────────────────────────────────────────────

/** Lower case, compatibility forms folded and accents removed, for matching. */
export function foldForSearch(text: string): string {
  // Greek final sigma folds to sigma (review): lowercasing a whole word
  // gives "ς" at its end, one letter at a time gives "σ", and the excerpt
  // window folds letter by letter.
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/ς/g, "σ");
}

/**
 * Words too common to tell parts apart: Contextual Research's list, the
 * chat's French and short English words, and a few more of every report.
 */
export const EVIDENCE_STOP_WORDS: ReadonlySet<string> = new Set([
  "about", "after", "again", "also", "been", "before", "could", "from", "have", "into", "more",
  "other", "report", "research", "should", "that", "their", "there", "these", "they", "this",
  "through", "using", "what", "when", "where", "which", "with", "would",
  "les", "des", "une", "pour", "dans", "avec", "sur", "est", "que", "qui", "par", "pas",
  "aux", "ces", "son", "ses", "leur", "leurs", "mais", "plus", "comme", "nous", "vous",
  "the", "and", "for", "are", "was", "were", "has", "had", "not", "but", "you", "our", "can",
  "its", "all", "any", "one", "two", "how", "who", "why", "out", "than", "then", "them",
  "will", "just", "only", "some", "such", "each", "very", "into", "over", "your", "were",
]);

const WORD = /[\p{L}\p{N}](?:[\p{L}\p{N}]|-(?=[\p{L}\p{N}]))*/gu;

/**
 * Every word of folded text, in order and repeated: letters and digits,
 * joined by single hyphens, at least 3 characters, not a stop word.
 */
export function evidenceWords(folded: string): string[] {
  const words: string[] = [];
  for (const match of folded.matchAll(WORD)) {
    const word = match[0];
    if ([...word].length < 3 || EVIDENCE_STOP_WORDS.has(word)) continue;
    words.push(word);
  }
  return words;
}

/** How many times each word appears. */
function wordCounts(words: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return counts;
}

// ─── Name-safe edges ─────────────────────────────────────────────────────────

/**
 * Letters, digits and marks, and the joiners inside a name's word (final
 * privacy round P2): ASCII and Unicode hyphens (and the soft hyphen),
 * straight and curly apostrophes, the katakana middle dot and the middle
 * dot, so a cut backs off before the whole of "Whitfield-Smith",
 * "Jean-Philippe" or "O'Neil", never to "Whitfield-".
 */
const WORD_CHARS = "[\\p{L}\\p{N}\\p{M}\\-\\u2010\\u2011\\u00AD'\\u2018\\u2019\\u30FB\\u00B7]";
const LAST_WORD_RUN = new RegExp(`${WORD_CHARS}+$`, "u");
const FIRST_WORD_RUN = new RegExp(`^${WORD_CHARS}+`, "u");
/** The longest run of letters and digits a word of a name can be. */
const MAX_NAME_WORD = 64;

/**
 * 2026-09-29 (second, privacy): a budget cut never ends inside a word. Names
 * are masked at the provider boundary only where they stand whole, so a cut
 * through "Quillmere" sent the fragment "Quillm" unmasked. When the kept
 * text ends in a letter or digit and the text after the cut goes on with
 * one, the cut backs off to just after the last white space or punctuation
 * (a hyphen, an apostrophe or a middle dot joins a word, never ends one).
 * A word the cut falls in that runs longer than 64 letters and digits, both
 * sides together, is no word of a name (a hash, an encoded blob, a long run
 * of unbroken script) and is cut where the budget ends, as before. It only
 * ever shortens, so the cut stays within budget.
 */
export function endAtWordBoundary(kept: string, rest: string): string {
  const before = LAST_WORD_RUN.exec(kept);
  const after = FIRST_WORD_RUN.exec(rest);
  if (!before || !after) return kept;
  // The word the cut falls in, both sides of it.
  if (before[0].length + after[0].length > MAX_NAME_WORD) return kept;
  return kept.slice(0, before.index);
}

/**
 * The start-side twin of `endAtWordBoundary` (Phase D, plan review round
 * 2): when an excerpt would start inside a word, it starts after that word
 * instead. Returns how many units of `kept` to skip. The same 64-character
 * rule applies, and it only ever shortens.
 */
export function startAtWordBoundary(before: string, kept: string): number {
  const prior = LAST_WORD_RUN.exec(before);
  const first = FIRST_WORD_RUN.exec(kept);
  if (!prior || !first) return 0;
  if (prior[0].length + first[0].length > MAX_NAME_WORD) return 0;
  return first[0].length;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * `[start, end)` of `text`, narrowed so neither edge splits a surrogate pair
 * or falls inside a word. May come back empty (`start >= end`) when the
 * range holds no whole word.
 */
export function nameSafeRange(text: string, start: number, end: number): { start: number; end: number } {
  let from = Math.max(0, Math.min(start, text.length));
  let to = Math.max(from, Math.min(end, text.length));
  if (from > 0 && from < text.length && isLow(text.charCodeAt(from))) from += 1;
  if (to > 0 && to < text.length && isHigh(text.charCodeAt(to - 1))) to -= 1;
  if (to <= from) return { start: from, end: from };
  if (from > 0) from += startAtWordBoundary(text.slice(Math.max(0, from - MAX_NAME_WORD), from), text.slice(from, to));
  if (to < text.length && to > from) {
    to = from + endAtWordBoundary(text.slice(from, to), text.slice(to, to + MAX_NAME_WORD)).length;
  }
  return to > from ? { start: from, end: to } : { start: from, end: from };
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/** The subject's words and how much each counts: more often said, more weight, up to 3. */
export type Subject = ReadonlyMap<string, number>;

/** A subject from texts (interview facts, the storyline, glossary terms, a Line's claims). */
export function subjectOf(texts: readonly string[]): Subject {
  const counts = wordCounts(texts.flatMap((text) => evidenceWords(foldForSearch(text))));
  const subject = new Map<string, number>();
  for (const [word, count] of [...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    subject.set(word, Math.min(3, 1 + Math.log(count)));
  }
  return subject;
}

const K1 = 1.2;
const B = 0.75;

/**
 * BM25 scores of `parts` (their text) for `subject`, with word rarity
 * measured over the parts themselves. A part that holds no subject word
 * scores 0.
 */
export function scoreParts(parts: readonly string[], subject: Subject): number[] {
  if (parts.length === 0 || subject.size === 0) return parts.map(() => 0);
  const counted = parts.map((text) => {
    const words = evidenceWords(foldForSearch(text));
    return { counts: wordCounts(words), length: words.length };
  });
  const documents = new Map<string, number>();
  for (const { counts } of counted) {
    for (const word of counts.keys()) if (subject.has(word)) documents.set(word, (documents.get(word) ?? 0) + 1);
  }
  const total = parts.length;
  const averageLength = counted.reduce((sum, part) => sum + part.length, 0) / total || 1;
  return counted.map(({ counts, length }) => {
    let score = 0;
    for (const [word, weight] of subject) {
      const frequency = counts.get(word);
      if (!frequency) continue;
      const containing = documents.get(word) ?? 0;
      const rarity = Math.log(1 + (total - containing + 0.5) / (containing + 0.5));
      score += weight * rarity * ((frequency * (K1 + 1)) / (frequency + K1 * (1 - B + (B * length) / averageLength)));
    }
    return score;
  });
}

// ─── Choosing ────────────────────────────────────────────────────────────────

export type ChoiceRow = {
  text: string;
  /** Sent whole, ahead of every part (the settings document, writer's notes). */
  whole?: boolean;
};

export type ChosenRow = {
  /** Every range sent, in order, not overlapping; empty when none was. */
  ranges: Array<{ start: number; end: number }>;
  /** True when the row went in whole. */
  whole: boolean;
};

export type ChoiceInput = {
  rows: readonly ChoiceRow[];
  subject: Subject;
  /** In the unit `size` measures. */
  budget: number;
  /** A text's size in the step's unit: UTF-16 length or UTF-8 bytes. */
  size: (text: string) => number;
  /** What one more excerpt of a row costs beyond its text (its separator). */
  excerptCost?: number;
};

/** The size of a whole row, as each step measures it. */
export const utf16Size = (text: string) => text.length;
const encoder = new TextEncoder();
export const utf8Size = (text: string) => encoder.encode(text).length;

/**
 * The parts of every row to send within `budget`. Pure and deterministic.
 * Every row whole when all fit; else the `whole` rows first (whole if they
 * fit, else their name-safe start), then the best-scoring parts of the
 * rest, then the unmatched parts in row order. A part that does not fit is
 * passed over for a later, smaller one. Touching chosen parts of a row join
 * into one range. `budget` is what the rows' text may take: a step takes
 * its headers and notices off first.
 */
export function chooseEvidence(input: ChoiceInput): ChosenRow[] {
  const { rows, size } = input;
  const excerptCost = input.excerptCost ?? 0;
  const result: ChosenRow[] = rows.map(() => ({ ranges: [], whole: false }));
  const totalWhole = rows.reduce((sum, row) => sum + size(row.text), 0);
  if (totalWhole <= input.budget) {
    rows.forEach((row, index) => {
      result[index] = { ranges: row.text.length > 0 ? [{ start: 0, end: row.text.length }] : [], whole: true };
    });
    return result;
  }
  let remaining = input.budget;

  // The rows that go in whole, in row order.
  rows.forEach((row, index) => {
    if (!row.whole || row.text.length === 0 || remaining <= 0) return;
    const cost = size(row.text);
    if (cost <= remaining) {
      result[index] = { ranges: [{ start: 0, end: row.text.length }], whole: true };
      remaining -= cost;
      return;
    }
    const end = fittingEnd(row.text, 0, remaining, size);
    const safe = nameSafeRange(row.text, 0, end);
    if (safe.end > safe.start) {
      result[index] = { ranges: [safe], whole: false };
      remaining -= size(row.text.slice(safe.start, safe.end));
    }
  });

  // Every other row's parts, scored together.
  type Candidate = { row: number; start: number; end: number; score: number };
  const candidates: Candidate[] = [];
  const texts: string[] = [];
  rows.forEach((row, index) => {
    if (row.whole || row.text.length === 0) return;
    for (const piece of splitSearchPieces(row.text)) {
      candidates.push({ row: index, start: piece.start, end: piece.end, score: 0 });
      texts.push(row.text.slice(piece.start, piece.end));
    }
  });
  const scores = scoreParts(texts, input.subject);
  candidates.forEach((candidate, index) => {
    candidate.score = scores[index] ?? 0;
  });
  candidates.sort((a, b) => b.score - a.score || a.row - b.row || a.start - b.start);

  const chosen = new Map<number, Array<{ start: number; end: number }>>();
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    const text = rows[candidate.row]!.text;
    const safe = nameSafeRange(text, candidate.start, candidate.end);
    if (safe.end <= safe.start) continue;
    const cost = size(text.slice(safe.start, safe.end)) + excerptCost;
    if (cost > remaining) continue;
    const list = chosen.get(candidate.row) ?? [];
    list.push(safe);
    chosen.set(candidate.row, list);
    remaining -= cost;
  }
  for (const [row, ranges] of chosen) {
    const joined = joinRanges(ranges);
    const text = rows[row]!.text;
    // A row whose parts were all chosen went in whole after all.
    result[row] = { ranges: joined, whole: joined.length === 1 && joined[0]!.start === 0 && joined[0]!.end === text.length };
  }
  return result;
}

/**
 * Sorted, with ranges that touch or overlap joined, so a run of chosen
 * parts reads as one excerpt. Only touching ranges join: text between two
 * ranges was not counted against the budget.
 */
function joinRanges(ranges: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const joined: Array<{ start: number; end: number }> = [];
  for (const range of sorted) {
    const last = joined.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else joined.push({ ...range });
  }
  return joined;
}

/** The largest end at or after `start` whose slice fits `budget` (binary search on the size). */
function fittingEnd(text: string, start: number, budget: number, size: (text: string) => number): number {
  let low = start;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (size(text.slice(start, middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return low;
}
