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
};

export type BannedWordRule = {
  phrase: string;
  /** Forms the writer listed beside it ("also optimise, optimized"). */
  forms: string[];
};

export type RequiredOpeningRule = {
  /** The exact words, as written between the quotes. */
  opening: string;
  section: SectionNumber;
  /** The statement the writer names, when stated. */
  statement?: "objective" | "uncertainty";
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

/** A sentence end: . ! or ?, any closing quotes or brackets, then whitespace. */
const SENTENCE_END = /[.!?]["'’”)\]]*\s+/g;

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
  counts: (sentence: string) => boolean = () => true
): WordingHit[] {
  const hits: WordingHit[] = [];
  sectionParagraphs(text).forEach((paragraph, paragraphIndex) => {
    for (const banned of phrases) {
      if (!banned.trim()) continue;
      for (const match of paragraph.matchAll(wordingPattern(banned))) {
        const at = match.index ?? 0;
        if (!counts(sentenceAround(paragraph, at, match[0].length))) continue;
        if (hits.some((hit) => hit.paragraphIndex === paragraphIndex && hit.words.toLowerCase() === match[0].toLowerCase())) continue;
        hits.push({ paragraphIndex, words: match[0], banned });
      }
    }
  });
  return hits.sort((a, b) => a.paragraphIndex - b.paragraphIndex);
}

/** Every banned synonym of a required term the text uses, the "on their own" exception applied. */
export function termRuleHits(text: string, rule: RequiredTermRule): WordingHit[] {
  return hitsOf(text, rule.banned, rule.allowedWithTerm ? (sentence) => !holdsPhrase(sentence, rule.term) : undefined);
}

/** Every use of a banned word or one of its listed forms. */
export function bannedRuleHits(text: string, rule: BannedWordRule): WordingHit[] {
  return hitsOf(text, [rule.phrase, ...rule.forms]);
}

/** Where a sentence of the text opens with the words: its paragraph (from 0), or null. */
export function openingAt(text: string, opening: string): { paragraphIndex: number; opensParagraph: boolean } | null {
  const words = opening.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const pattern = new RegExp(
    `(?:^|\\n\\s*|[.!?]["'\\u2019\\u201d)\\]]*\\s+|\\]\\s+)${words.map(escapeWord).join("\\s+")}(?![\\p{L}\\p{N}])`,
    "iu"
  );
  const paragraphs = sectionParagraphs(text);
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = pattern.exec(paragraphs[index]!);
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

/**
 * Round 5 (rule 4): why a shortening pass broke a measured wording rule its
 * input kept, or null. A pass is never kept when it removes a required
 * opening the input held, uses a banned word or synonym the input did not,
 * or removes the last use of a required term the input held.
 */
export function wordingLoss(
  input: string,
  output: string,
  rules: WriterWordingRules,
  section: SectionNumber
): string | null {
  for (const rule of rules.openings) {
    if (rule.section !== section) continue;
    if (openingAt(input, rule.opening) && !openingAt(output, rule.opening)) {
      return `removed the opening "${rule.opening}" the writer's settings require`;
    }
  }
  const introduced = (before: WordingHit[], after: WordingHit[]) =>
    after.find((hit) => !before.some((other) => other.words.toLowerCase() === hit.words.toLowerCase()));
  for (const rule of rules.terms) {
    const added = introduced(termRuleHits(input, rule), termRuleHits(output, rule));
    if (added) return `wrote "${added.words}", which the writer's settings ban in favour of "${rule.term}"`;
    if (holdsPhrase(input, rule.term) && !holdsPhrase(output, rule.term)) {
      return `removed the last use of "${rule.term}", the writer's term`;
    }
  }
  for (const rule of rules.banned) {
    const added = introduced(bannedRuleHits(input, rule), bannedRuleHits(output, rule));
    if (added) return `wrote "${added.words}", which the writer's settings ban`;
  }
  return null;
}
