/**
 * Idea card quotes support their card (2026-09-27, third amendment). Pure:
 * no ctx, no network.
 *
 * A citation can pass the byte check (its words are in the frozen source)
 * and still back nothing on its card: a live run cited a neighbouring line
 * and copied the Brief's excerpt onto cards it did not fit. Two cheap
 * lexical checks catch that after the byte check:
 *
 * - unrelated: the cited words share too few meaningful words with the
 *   Seed's bullets (stop words ignored, light plural and prefix matching);
 * - reused: in a fresh Batch, the same excerpt is cited on more than one
 *   Seed, and this Seed neither owns it nor quotes it word for word.
 *
 * A flagged citation is kept and marked for a check; nothing is dropped.
 */
import { findExactQuoteSpans } from "../../shared/exactQuote";

/**
 * Words that carry no claim. Function words, interview fillers, and a few
 * words every SR&ED interview uses about itself ("project", "company",
 * "work"), which would otherwise tie any two lines together.
 */
const STOP_WORDS: ReadonlySet<string> = new Set(
  (
    "a about above after again against all almost also although always am an and another any are around as at " +
    "be because been before being below between both but by can could did do does doing done down during each " +
    "either else enough even ever every for from further had has have having he her here hers herself him " +
    "himself his how however i if in into is it its itself just last least less like made make makes many may " +
    "me might more most much must my myself never next no nor not now of off often on once one only onto or " +
    "other others our ours ourselves out over own per quite rather really same shall she should since so some " +
    "such than that the their theirs them themselves then there these they this those though through thus to " +
    "too under until up upon us very via was we were what when where whether which while who whom whose why " +
    "will with within without would yet you your yours yourself " +
    "actually basically bit get gets getting got guess kind know lot lots maybe mean okay ok pretty right say " +
    "said sort stuff sure thing things think yeah yes " +
    "company project projects team work worked working"
  ).split(" ")
);

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const ONES = "one|two|three|four|five|six|seven|eight|nine";
const COMPOUND_NUMBER = new RegExp(`\\b(${TENS})[-\\s](${ONES})\\b`, "giu");
const NUMBER_WORD = new RegExp(`\\b(${Object.keys(NUMBER_WORDS).join("|")})\\b`, "giu");

/** Unit spellings folded to one symbol, after plurals fold. */
const UNITS: Readonly<Record<string, string>> = {
  millimeter: "mm", centimeter: "cm", kilometer: "km", kilogram: "kg", gram: "g",
  megapascal: "mpa", kilopascal: "kpa", deg: "degree",
};

/**
 * Spellings the check reads alike: degree signs and percent signs as words,
 * number words as digits ("twelve" and "12", "twenty-three" and "23"), and
 * a number glued to its unit split from it ("15MPa").
 */
function normalizeText(text: string): string {
  const one = (word: string) => (word.toLowerCase() === "one" ? 1 : NUMBER_WORDS[word.toLowerCase()]);
  return text
    .replace(/°\s*C\b|℃/gu, " degree celsius ")
    .replace(/°\s*F\b|℉/gu, " degree fahrenheit ")
    .replace(/°/gu, " degree ")
    .replace(/%/gu, " percent ")
    .replace(/(\p{N})(\p{L})/gu, "$1 $2")
    .replace(COMPOUND_NUMBER, (_match, tens: string, ones: string) => String(one(tens) + one(ones)))
    .replace(NUMBER_WORD, (word: string) => String(NUMBER_WORDS[word.toLowerCase()]));
}

/** A doubled final consonant left by -ing or -ed ("runn", "tapp"), but not ll, ss or zz. */
function undouble(stem: string): string {
  const last = stem[stem.length - 1];
  return stem.length >= 3 && last === stem[stem.length - 2] && /[bcdfghjkmnprtvw]/.test(last)
    ? stem.slice(0, -1)
    : stem;
}

/**
 * One word as the check compares it: lower case, no possessive, singular,
 * one spelling of a unit or of -re and -er ("fibre" and "fiber"), no -ing or
 * -ed, and no final "e", so "cure", "cured" and "curing" all read "cur".
 */
function normalizeWord(raw: string): string {
  let word = raw.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
  if (word.length > 4 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
  else if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) word = word.slice(0, -1);
  if (/[bt]re$/.test(word) && word.length > 4) word = `${word.slice(0, -2)}er`;
  word = UNITS[word] ?? word;
  if (word.length > 5 && word.endsWith("ing")) word = undouble(word.slice(0, -3));
  else if (word.length >= 4 && word.endsWith("ed") && !word.endsWith("eed")) word = undouble(word.slice(0, -2));
  if (word.length >= 3 && word.endsWith("e") && !word.endsWith("ee")) word = word.slice(0, -1);
  return word;
}

/** The meaningful words of `text`, normalized, without repeats. */
export function contentWords(text: string): string[] {
  const words = new Set<string>();
  for (const match of normalizeText(text).matchAll(WORD)) {
    const word = normalizeWord(match[0]);
    const lower = match[0].toLowerCase();
    if (!STOP_WORDS.has(word) && !STOP_WORDS.has(lower) && !FOREIGN_FUNCTION_WORDS.has(lower)) words.add(word);
  }
  return [...words];
}

/**
 * Two normalized words match when equal, or when the shorter (at least four
 * letters) opens the longer for its first min(6, length) letters:
 * "structure" and "structural", but not "process" and "procedure".
 */
function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 4) return false;
  return long.startsWith(short.slice(0, Math.min(6, short.length)));
}

type Script = "latin" | "cyrillic" | "greek" | "han" | "kana" | "hangul" | "thai" | "arabic" | "hebrew" | "devanagari";
const SCRIPTS: ReadonlyArray<[Script, RegExp]> = [
  ["latin", /\p{Script=Latin}/u],
  ["cyrillic", /\p{Script=Cyrillic}/u],
  ["greek", /\p{Script=Greek}/u],
  ["han", /\p{Script=Han}/u],
  ["kana", /[\p{Script=Hiragana}\p{Script=Katakana}]/u],
  ["hangul", /\p{Script=Hangul}/u],
  ["thai", /\p{Script=Thai}/u],
  ["arabic", /\p{Script=Arabic}/u],
  ["hebrew", /\p{Script=Hebrew}/u],
  ["devanagari", /\p{Script=Devanagari}/u],
];
/** Scripts written without spaces between words: the word check has no words to count. */
const UNSPACED: ReadonlySet<Script> = new Set(["han", "kana", "thai"]);

/** The script most of the letters are in, or null for no letters. */
function dominantScript(text: string): Script | null {
  const counts = new Map<Script, number>();
  for (const character of text) {
    const script = SCRIPTS.find(([, pattern]) => pattern.test(character))?.[0];
    if (script) counts.set(script, (counts.get(script) ?? 0) + 1);
  }
  let best: Script | null = null;
  for (const [script, count] of counts) if (best === null || count > (counts.get(best) ?? 0)) best = script;
  // Japanese mixes kanji and kana; either way it is unspaced.
  return best;
}

/** Function words that tell apart the Latin-script languages a quote may be in. */
const LANGUAGE_WORDS: ReadonlyArray<[string, ReadonlySet<string>]> = [
  ["en", new Set("the and of to is that it was for with we our are this they have".split(" "))],
  ["fr", new Set("le les des du et est une pour dans que qui pas sur avec au aux cette nous vous ils elle sont".split(" "))],
  ["es", new Set("el los las del y es una para que por con se su al lo son nosotros".split(" "))],
  ["de", new Set("der die das und ist nicht mit dem ein eine zu von auf für wir sie sind".split(" "))],
];

/**
 * The other languages' function words are not meaningful words either, so a
 * French card and quote are compared on their content. Words that are also
 * English content words ("pour", "son", "die") stay meaningful.
 */
const FOREIGN_FUNCTION_WORDS: ReadonlySet<string> = new Set(
  LANGUAGE_WORDS.filter(([language]) => language !== "en")
    .flatMap(([, words]) => [...words])
    .concat("la de en à un".split(" "))
    .filter((word) => !["pour", "son", "die"].includes(word))
);

/** The language with the most function words (at least two, no tie), or null. */
function languageOf(text: string): string | null {
  const words = [...text.toLowerCase().matchAll(WORD)].map((match) => match[0]);
  const scores = LANGUAGE_WORDS.map(([language, set]) => [language, words.filter((word) => set.has(word)).length] as const)
    .sort((left, right) => right[1] - left[1]);
  return scores[0][1] >= 2 && scores[0][1] > scores[1][1] ? scores[0][0] : null;
}

/**
 * Whether the word check can judge this quote against this Seed at all: both
 * in one script, that script written with spaces, not two different
 * languages, and the quote holding meaningful words. A quote it cannot judge
 * is never marked (2026-09-27, third amendment, review P2-3).
 */
export function canJudgeQuote(seedText: string, excerpt: string): boolean {
  const script = dominantScript(excerpt);
  if (script === null || UNSPACED.has(script) || dominantScript(seedText) !== script) return false;
  const quoteLanguage = languageOf(excerpt);
  const seedLanguage = languageOf(seedText);
  if (quoteLanguage && seedLanguage && quoteLanguage !== seedLanguage) return false;
  return contentWords(excerpt).length > 0;
}

/** How many of the excerpt's meaningful words appear in the Seed text. */
export function sharedContentWords(seedText: string, excerpt: string): number {
  const seedWords = contentWords(seedText);
  return contentWords(excerpt).filter((word) => seedWords.some((other) => sameWord(word, other))).length;
}

/**
 * Meaningful words a citation must share with its Seed: at least two (all
 * of them when the excerpt has fewer), and at least a third of the smaller
 * side's meaningful words. Tuned on the Northwind live-test fixture
 * (convex/lib/seedQuoteSupport.test.ts): every card that cited its own
 * line shared at least 5 words, 40 percent or more of the smaller side, and
 * every card that cited a neighbouring or unrelated line shared at most 3,
 * under 30 percent.
 */
export const MIN_SHARED_CONTENT_WORDS = 2;
export const MIN_SHARED_CONTENT_SHARE = 1 / 3;

/** True when the excerpt shares enough meaningful words with the Seed text. */
export function excerptSupportsSeed(seedText: string, excerpt: string): boolean {
  const excerptWords = contentWords(excerpt).length;
  if (excerptWords === 0) return false;
  const smaller = Math.min(excerptWords, contentWords(seedText).length);
  const required = Math.max(
    Math.min(MIN_SHARED_CONTENT_WORDS, excerptWords),
    Math.ceil(smaller * MIN_SHARED_CONTENT_SHARE)
  );
  return sharedContentWords(seedText, excerpt) >= required;
}

/** True when one of the bullets would underline part of the excerpt. */
export function quotesExcerpt(bullets: readonly string[], excerpt: string): boolean {
  return bullets.some((bullet) => findExactQuoteSpans(bullet, [excerpt]).length > 0);
}

export type QuoteCheckCitation = {
  sourceId: string;
  startOffset: number;
  endOffset: number;
  exactExcerpt: string;
  factId?: string;
};

export type QuoteCheckIssue = {
  code: "CITATION_UNRELATED" | "CITATION_REUSED";
  /** Index into the Seeds passed in. */
  seedIndex: number;
  /** Index into that Seed's provenance. */
  citationIndex: number;
};

/**
 * What a Seed cites as one piece of evidence: a fact (its quotes back the
 * Seed together) or one span.
 */
function evidenceKey(citation: QuoteCheckCitation): string {
  return citation.factId !== undefined
    ? `fact|${citation.sourceId}|${citation.factId}`
    : `span|${citation.sourceId}|${citation.startOffset}|${citation.endOffset}`;
}

/**
 * The quote issues of one Batch, in Seed and citation order. `reuse` is on
 * for a fresh Batch only: the one to three Revised Seeds of a Feedback
 * request revise one Seed and may all cite its line.
 *
 * Per Seed, a fact or span is unrelated when none of its quotes shares
 * enough meaningful words with the bullets. A related piece cited by more
 * than one Seed belongs to the first Seed that quotes it word for word, or,
 * when none does, to the one sharing the most meaningful words (the
 * earlier on a tie); every other Seed citing it is flagged as reusing it
 * unless that Seed also quotes it word for word.
 */
export function quoteCheckIssues(
  seeds: ReadonlyArray<{ bullets: readonly string[]; provenance: readonly QuoteCheckCitation[] }>,
  options: { reuse: boolean }
): QuoteCheckIssue[] {
  type Piece = {
    seedIndex: number;
    citationIndexes: number[];
    judged: boolean;
    related: boolean;
    quoted: boolean;
    shared: number;
  };
  const pieces: Piece[] = [];
  seeds.forEach((seed, seedIndex) => {
    const text = seed.bullets.join(" ");
    const bySeed = new Map<string, Piece>();
    seed.provenance.forEach((citation, citationIndex) => {
      const key = evidenceKey(citation);
      let piece = bySeed.get(key);
      if (!piece) {
        piece = { seedIndex, citationIndexes: [], judged: false, related: false, quoted: false, shared: 0 };
        bySeed.set(key, piece);
        pieces.push(piece);
      }
      piece.citationIndexes.push(citationIndex);
      const judged = canJudgeQuote(text, citation.exactExcerpt);
      piece.judged ||= judged;
      piece.related ||= judged && excerptSupportsSeed(text, citation.exactExcerpt);
      piece.quoted ||= quotesExcerpt(seed.bullets, citation.exactExcerpt);
      piece.shared = Math.max(piece.shared, sharedContentWords(text, citation.exactExcerpt));
    });
  });

  const reused = new Set<Piece>();
  if (options.reuse) {
    const byKey = new Map<string, Piece[]>();
    for (const piece of pieces) {
      if (!piece.judged || !piece.related) continue;
      const citation = seeds[piece.seedIndex].provenance[piece.citationIndexes[0]];
      const list = byKey.get(evidenceKey(citation)) ?? [];
      list.push(piece);
      byKey.set(evidenceKey(citation), list);
    }
    for (const list of byKey.values()) {
      if (list.length < 2) continue;
      const owner =
        list.find((piece) => piece.quoted) ??
        list.reduce((best, piece) => (piece.shared > best.shared ? piece : best));
      for (const piece of list) {
        if (piece !== owner && !piece.quoted) reused.add(piece);
      }
    }
  }

  const issues: QuoteCheckIssue[] = [];
  for (const piece of pieces) {
    // A quote the word check cannot judge (another script or language, no
    // usable words) is never marked.
    if (!piece.judged) continue;
    const code = !piece.related ? "CITATION_UNRELATED" : reused.has(piece) ? "CITATION_REUSED" : null;
    if (!code) continue;
    for (const citationIndex of piece.citationIndexes) {
      issues.push({ code, seedIndex: piece.seedIndex, citationIndex });
    }
  }
  return issues.sort((left, right) => left.seedIndex - right.seedIndex || left.citationIndex - right.citationIndex);
}
