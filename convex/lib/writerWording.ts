/**
 * 2026-10-04 (first), Round 5 (owner approved 2026-10-05, "Build code
 * checks"): the writer's wording rules that code measures, as
 * extractWriterWordingRules (settingsExtraction.ts) reads them from the
 * effective instruction text, and the matcher every measure uses.
 *
 * The matcher reads words as the release suite's settings checks do: whole
 * words, any case, a space or hyphen between the words of a phrase, and the
 * last word singular or with an s or es ending. A required term's banned
 * synonyms may be allowed in a sentence that also holds the term ("never
 * write pinholes on their own"). A required opening starts a sentence: a
 * paragraph, a line, or the text after . ! or ? (and any closing quotes or
 * brackets) or after a closing bracket such as a [GAP: ...] marker.
 */
import type { SectionNumber } from "./orderedChain";
import { sectionParagraphs } from "./tiptapReport";

export type RequiredTermRule = {
  /** The writer's term, as written. */
  term: string;
  /** The words the writer bans in its place. */
  banned: string[];
  /** "on their own": a banned word in a sentence that also holds the term is allowed. */
  allowedWithTerm: boolean;
  /** The writer's line as written. */
  source: string;
};

export type BannedWordRule = {
  phrase: string;
  /** Forms the writer listed beside it ("also optimise, optimized"). */
  forms: string[];
  /** The writer's line as written. */
  source: string;
};

export type RequiredOpeningRule = {
  /** The exact words, as written between the quotes. */
  opening: string;
  section: SectionNumber;
  /** The statement the writer names, when stated. */
  statement?: "objective" | "uncertainty";
  /** The writer's line as written. */
  source: string;
};

export type WriterWordingRules = {
  terms: RequiredTermRule[];
  banned: BannedWordRule[];
  openings: RequiredOpeningRule[];
};

export const NO_WRITER_WORDING_RULES: WriterWordingRules = { terms: [], banned: [], openings: [] };

export function hasWriterWordingRules(rules: WriterWordingRules | null | undefined): rules is WriterWordingRules {
  return !!rules && rules.terms.length + rules.banned.length + rules.openings.length > 0;
}

const escapeWord = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The phrase as the settings matcher reads it (global, any case). */
export function wordingPattern(phrase: string): RegExp {
  const words = phrase.trim().split(/[\s-]+/).filter(Boolean);
  if (words.length === 0) return /(?!)/g;
  const last = words[words.length - 1]!;
  const stem = last.length > 3 && /[^sui]s$/i.test(last) ? last.slice(0, -1) : last;
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${[...words.slice(0, -1).map(escapeWord), `${escapeWord(stem)}(?:s|es)?`].join("[\\s-]+")}(?![\\p{L}\\p{N}])`,
    "giu"
  );
}

export function holdsPhrase(text: string, phrase: string): boolean {
  return phrase.trim() !== "" && wordingPattern(phrase).test(text);
}

/**
 * A sentence end: . ! or ?, any closing quotes or brackets, then whitespace.
 * Review P3-1: the dot of "e.g.", "i.e.", "etc.", "vs." and "cf." is no end.
 */
const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs|cf|approx|incl|fig|no))[.!?]["'\u2019\u201d)\]]*\s+/gi;

/** The sentence of a paragraph that holds the span at `at`. */
function sentenceAround(paragraph: string, at: number, length: number): string {
  let start = 0;
  for (const match of paragraph.slice(0, at).matchAll(SENTENCE_END)) start = (match.index ?? 0) + match[0].length;
  const end = [...paragraph.slice(at + length).matchAll(SENTENCE_END)][0];
  return paragraph.slice(start, end ? at + length + (end.index ?? 0) + 1 : paragraph.length);
}

/** One place a banned word appears: its paragraph (from 0) and the words as written. */
export type WordingHit = { paragraphIndex: number; words: string; banned: string };

function hitsOf(
  text: string,
  phrases: readonly string[],
  counts: (sentence: string) => boolean = () => true,
  /** Review P1-1 (b): a match inside one of these terms is the term, never a ban. */
  protectedTerms: readonly string[] = []
): WordingHit[] {
  const hits: WordingHit[] = [];
  sectionParagraphs(text).forEach((paragraph, paragraphIndex) => {
    const protectedSpans = protectedTerms.flatMap((term) =>
      [...paragraph.matchAll(wordingPattern(term))].map((match): [number, number] => [match.index ?? 0, (match.index ?? 0) + match[0].length])
    );
    for (const banned of phrases) {
      if (!banned.trim()) continue;
      for (const match of paragraph.matchAll(wordingPattern(banned))) {
        const at = match.index ?? 0;
        // Only a ban inside the term's own words: a ban that holds the term
        // ("trial and error" beside the term "trial") is still counted.
        if (protectedSpans.some(([from, to]) => from <= at && at + match[0].length <= to)) continue;
        if (!counts(sentenceAround(paragraph, at, match[0].length))) continue;
        if (hits.some((hit) => hit.paragraphIndex === paragraphIndex && hit.words.toLowerCase() === match[0].toLowerCase())) continue;
        hits.push({ paragraphIndex, words: match[0], banned });
      }
    }
  });
  return hits.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
}

/**
 * Every banned synonym of a required term the text uses, the "on their own"
 * exception applied, never inside a use of the term itself (or of another
 * required term).
 */
export function termRuleHits(text: string, rule: RequiredTermRule, otherTerms: readonly string[] = []): WordingHit[] {
  return hitsOf(
    text,
    rule.banned,
    rule.allowedWithTerm ? (sentence) => !holdsPhrase(sentence, rule.term) : undefined,
    [rule.term, ...otherTerms]
  );
}

/** Every use of a banned word or one of its listed forms, never inside a required term. */
export function bannedRuleHits(text: string, rule: BannedWordRule, terms: readonly string[] = []): WordingHit[] {
  return hitsOf(text, [rule.phrase, ...rule.forms], undefined, terms);
}

/** Review P3-2: curly apostrophes and quotes read as straight ones (same length). */
const straightQuotes = (text: string) => text.replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');

/** Where a sentence of the text opens with the words: its paragraph (from 0), or null. */
export function openingAt(text: string, opening: string): { paragraphIndex: number; opensParagraph: boolean } | null {
  const words = straightQuotes(opening).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = new RegExp(
    `(?:^|\\n\\s*|[.!?]["'\\u2019\\u201d)\\]]*\\s+|\\]\\s+)${words.map(escapeWord).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "iu"
  );
  const paragraphs = sectionParagraphs(text);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = pattern.exec(straightQuotes(paragraphs[index]!));
    if (match) return { paragraphIndex: index, opensParagraph: match.index === 0 };
  }
  return null;
}

/** "P3 says \"pinhole formation\"", for each hit, joined. */
export function hitsPhrase(hits: readonly WordingHit[]): string {
  const parts = hits.slice(0, 4).map((hit) => `P${hit.paragraphIndex + 1} says "${hit.words}"`);
  const more = hits.length - parts.length;
  const listed = more > 0 ? [...parts, `${more} more`] : parts;
  return listed.length <= 1 ? listed.join("") : `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}`;
}

/** The Compliance Note instruction of a term rule's row. */
export const termRowInstruction = (rule: Pick<RequiredTermRule, "term">) => `Writer's term: ${rule.term}`;
/** The Compliance Note instruction of a banned word rule's row. */
export const bannedRowInstruction = (rule: Pick<BannedWordRule, "phrase">) => `Writer's banned word: ${rule.phrase}`;
/** The statement an opening rule names, in words. */
export const openingStatement = (rule: Pick<RequiredOpeningRule, "statement">) =>
  rule.statement ? `the ${rule.statement} statement` : "the statement the writer's settings name";
/** The Compliance Note instruction of an opening rule's row. */
export const openingRowInstruction = (rule: Pick<RequiredOpeningRule, "statement" | "opening">) =>
  `Writer's opening for ${openingStatement(rule)}: "${rule.opening}"`;

/**
 * Round 5 (rule 4): how a text broke a measured wording rule its input
 * kept: the reason and the row of the rule, or null. It removed a required
 * opening the input held, used a banned word or synonym more often than the
 * input did (compared by rule, not by form), or removed the last use of a
 * required term the input held.
 */
export function wordingLossDetail(
  input: string,
  output: string,
  rules: WriterWordingRules,
  section: SectionNumber
): { reason: string; instruction: string } | null {
  for (const rule of rules.openings) {
    if (rule.section !== section) continue;
    if (openingAt(input, rule.opening) && !openingAt(output, rule.opening)) {
      return { reason: `removed the opening "${rule.opening}" the writer's settings require`, instruction: openingRowInstruction(rule) };
    }
  }
  // Review P3-7: by rule, not by form: "pinhole" made "pinholes" adds none.
  const introduced = (before: WordingHit[], after: WordingHit[]) =>
    after.length > before.length
      ? after.find((hit) => !before.some((other) => other.words.toLowerCase() === hit.words.toLowerCase())) ?? after[after.length - 1]
      : undefined;
  const terms = rules.terms.map((rule) => rule.term);
  for (const rule of rules.terms) {
    const others = terms.filter((term) => term !== rule.term);
    const added = introduced(termRuleHits(input, rule, others), termRuleHits(output, rule, others));
    if (added) {
      return { reason: `wrote "${added.words}", which the writer's settings ban in favour of "${rule.term}"`, instruction: termRowInstruction(rule) };
    }
    if (holdsPhrase(input, rule.term) && !holdsPhrase(output, rule.term)) {
      return { reason: `removed the last use of "${rule.term}", the writer's term`, instruction: termRowInstruction(rule) };
    }
  }
  for (const rule of rules.banned) {
    const added = introduced(bannedRuleHits(input, rule, terms), bannedRuleHits(output, rule, terms));
    if (added) return { reason: `wrote "${added.words}", which the writer's settings ban`, instruction: bannedRowInstruction(rule) };
  }
  return null;
}

/** wordingLossDetail's reason alone (the shortening guard). */
export function wordingLoss(
  input: string,
  output: string,
  rules: WriterWordingRules,
  section: SectionNumber
): string | null {
  return wordingLossDetail(input, output, rules, section)?.reason ?? null;
}
