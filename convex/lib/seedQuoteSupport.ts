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
 *   Seed's bullets, together or one by one (stop words, fillers and
 *   contractions ignored, light plural and prefix matching, acronyms);
 * - reused: in a fresh Batch, the same excerpt is cited on more than one
 *   Seed, and this Seed neither owns it nor quotes it word for word.
 *
 * A flagged citation is kept and marked for a check; nothing is dropped.
 */
import { findExactQuoteSpans } from "../../shared/exactQuote";

/**
 * Words that carry no claim, matched as written and in their folded form
 * ("others", "worked"): function words, indefinite pronouns, and a few
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
    "across along already among anybody anyone anything anywhere besides beyond cannot despite everybody " +
    "everyone everything everywhere making neither nobody none nothing nowhere perhaps probably regarding somebody someone " +
    "something sometimes somewhere toward towards unless usually using versus " +
    "company project projects team work worked working"
  ).split(" ")
);

/**
 * Spoken fillers, matched only as written (2026-10-19), so a word that folds
 * to the same stem still counts: "sorting" is not the filler "sort", nor
 * "rights" the filler "right".
 */
const FILLER_WORDS: ReadonlySet<string> = new Set(
  (
    "actually basically bit get gets getting got gotten gonna gotta guess guessing hmm kinda know knew knowing " +
    "knows lot lots maybe mean obviously oh okay ok pretty right say said saying says sorta stuff sure thing " +
    "things think thinking thinks thought uh um wanna whoa wow yeah yes"
  ).split(" ")
);

/** Filler phrases dropped before words are read: "kind of", "sort of", "you know". */
const FILLER_PHRASES =
  /\b(?:kind\s+of|sort\s+of|a\s+lot\s+of|lots\s+of|a\s+lot|you\s+know|i\s+mean|in\s+essence|for\s+example)\b/giu;

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
 * a number glued to its unit split from it ("15MPa"). Filler phrases go.
 */
function normalizeText(text: string): string {
  const one = (word: string) => (word.toLowerCase() === "one" ? 1 : NUMBER_WORDS[word.toLowerCase()]);
  return text
    .replace(FILLER_PHRASES, " ")
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

/**
 * A word, as written in lower case, that carries no claim: a stop word, a
 * filler, another language's function word, a negated auxiliary ("doesn't",
 * "can't") or a contraction of a stop word or filler ("we're", "there's",
 * "I'd"), which spoken quotes are full of (2026-10-19).
 */
function isFunctionWord(lower: string): boolean {
  if (STOP_WORDS.has(lower) || FILLER_WORDS.has(lower) || FOREIGN_FUNCTION_WORDS.has(lower)) return true;
  const apostrophe = lower.indexOf("'");
  if (apostrophe < 0) return false;
  if (lower.endsWith("n't")) return true;
  const base = lower.slice(0, apostrophe);
  return STOP_WORDS.has(base) || FILLER_WORDS.has(base);
}

/** The meaningful words of `text`, normalized, without repeats. */
export function contentWords(text: string): string[] {
  const words = new Set<string>();
  for (const match of normalizeText(text).matchAll(WORD)) {
    const lower = match[0].toLowerCase().replace(/’/g, "'");
    if (isFunctionWord(lower)) continue;
    const word = normalizeWord(lower);
    if (!STOP_WORDS.has(word)) words.add(word);
  }
  return [...words];
}

/**
 * Two normalized words match when equal, or when the shorter (at least four
 * letters) opens the longer for its first min(6, length) letters:
 * "structure" and "structural", but not "process" and "procedure".
 */
export function sameWord(left: string, right: string): boolean {
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

/**
 * An all-capitals acronym of three to six letters, with an optional plural
 * "s". Two letters are too few: "ML" would fold "measured load" (review
 * round 1, P3-4).
 */
const ACRONYM = /\b(\p{Lu}{3,6})s?\b/gu;

/**
 * Both texts with a spelled-out acronym read as the acronym, when either
 * text uses it (2026-10-19): "multi-factor authentication" reads "MFA"
 * beside "MFA", and "large language models" reads "LLM" beside "LLMs".
 * Every spelled-out word has three or more letters and carries a claim.
 */
function withAcronyms(left: string, right: string): [string, string] {
  const acronyms = new Set(
    [...`${left} ${right}`.matchAll(ACRONYM)]
      .map((match) => match[1])
      .filter((acronym) => !isFunctionWord(acronym.toLowerCase()))
  );
  let pair: [string, string] = [left, right];
  for (const acronym of acronyms) {
    const run = [...acronym].map((letter) => `${letter}\\p{L}{2,}`).join("[\\s-]+");
    const spelled = new RegExp(`\\b${run}\\b`, "giu");
    pair = pair.map((text) =>
      text.replace(spelled, (match) =>
        match.split(/[\s-]+/).some((word) => isFunctionWord(word.toLowerCase())) ? match : ` ${acronym} `
      )
    ) as [string, string];
  }
  return pair;
}

/** How many meaningful words each side has, and the excerpt's words that appear in the Seed text. */
function overlap(seedText: string, excerpt: string): { excerptWords: number; seedWords: number; shared: string[] } {
  const [seed, quote] = withAcronyms(seedText, excerpt);
  const seedWords = contentWords(seed);
  const excerptWords = contentWords(quote);
  return {
    excerptWords: excerptWords.length,
    seedWords: seedWords.length,
    shared: excerptWords.filter((word) => seedWords.some((other) => sameWord(word, other))),
  };
}

/** How many of the excerpt's meaningful words appear in the Seed text. */
export function sharedContentWords(seedText: string, excerpt: string): number {
  return overlap(seedText, excerpt).shared.length;
}

/**
 * Meaningful words a citation must share with its Seed: at least two (all
 * of them when the excerpt has fewer), and at least a third of the smaller
 * side's meaningful words, though four always suffice. Tuned on the
 * Northwind live-test fixture (convex/lib/seedQuoteSupport.test.ts): every
 * card that cited its own line shared at least 5 words, 40 percent or more
 * of the smaller side, and every card that cited a neighbouring or
 * unrelated line shared at most 3, under 30 percent. The cap of four
 * (2026-10-19) is for whole interview turns cited behind two-sentence
 * cards: a third of the smaller side asked for five to nine shared words
 * there, and the 2026-10-08 run's related quotes shared four or five.
 */
export const MIN_SHARED_CONTENT_WORDS = 2;
export const MIN_SHARED_CONTENT_SHARE = 1 / 3;
export const ENOUGH_SHARED_CONTENT_WORDS = 4;
/**
 * One sentence of a card backs it on its own only when it has at least
 * four meaningful words and shares at least three with the quote, numbers
 * aside (review round 1, P2-1): "Cost rose." or "Testing ran for 12
 * weeks." must not let a quote about something else through.
 */
export const MIN_SENTENCE_CONTENT_WORDS = 4;
export const MIN_SENTENCE_SHARED_WORDS = 3;

/** True when the excerpt shares enough meaningful words with the Seed text. */
export function excerptSupportsSeed(seedText: string, excerpt: string): boolean {
  const { excerptWords, seedWords, shared } = overlap(seedText, excerpt);
  if (excerptWords === 0) return false;
  const smaller = Math.min(excerptWords, seedWords);
  const required = Math.max(
    Math.min(MIN_SHARED_CONTENT_WORDS, excerptWords),
    Math.min(ENOUGH_SHARED_CONTENT_WORDS, Math.ceil(smaller * MIN_SHARED_CONTENT_SHARE))
  );
  return shared.length >= required;
}

/**
 * True when the excerpt backs the Seed's wording as a whole or one of its
 * sentences (2026-10-19): a quote behind one sentence of a two-sentence
 * card is not unrelated to the card. A sentence counts on its own only with
 * MIN_SENTENCE_CONTENT_WORDS meaningful words, of which the quote shares
 * MIN_SENTENCE_SHARED_WORDS that are not numbers, besides the usual overlap.
 */
export function quoteBacksSeed(bullets: readonly string[], excerpt: string): boolean {
  if (excerptSupportsSeed(bullets.join(" "), excerpt)) return true;
  if (bullets.length < 2) return false;
  return bullets.some((bullet) => {
    const { seedWords, shared } = overlap(bullet, excerpt);
    return (
      seedWords >= MIN_SENTENCE_CONTENT_WORDS &&
      shared.filter((word) => /\p{L}/u.test(word)).length >= MIN_SENTENCE_SHARED_WORDS &&
      excerptSupportsSeed(bullet, excerpt)
    );
  });
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
 * enough meaningful words with the bullets, together or one by one
 * (`quoteBacksSeed`). A related piece cited by more
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
      piece.related ||= judged && quoteBacksSeed(seed.bullets, citation.exactExcerpt);
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

/**
 * 2026-10-04 (second, round 3, owner approved 2026-10-05): the sentences of a
 * Seed that its quotes do not back, when a quote is marked as possibly not
 * backing it. Pure, so the idea card and the facts check read the same
 * sentences.
 *
 * Only a quote marked as unrelated counts as marked here: a marked quote that
 * shares enough words with the Seed's own wording (`seedBullets`, together
 * or one sentence of it, `quoteBacksSeed`) was marked because another Seed
 * reused it, or under an older, stricter check (2026-10-19), and it backs
 * its sentence like any other quote (round 3 review, P3-2). Every other
 * quote is evidence.
 *
 * Every sentence that no evidence quote backs is named (`excerptSupportsSeed`,
 * a quote the check cannot judge counting as backing; Greptile on PR #26 at
 * 1da92721), and with no evidence quote at all that is every sentence
 * (re-check P3-2). A sentence holding a meaningful word (two characters or
 * more) that a marked quote has and no evidence quote has is named too, so
 * a good quote sharing other words with it cannot hide it (round 3 review,
 * P2-1), unless such a sentence is itself unbacked, which makes it the
 * marked quote's target, so a backed sentence that only shares a word with
 * the marked quote is not named (re-check P3-1). `bullets` are the
 * sentences to name from (the ones the writer has not changed). Empty for a
 * Seed with no unrelated marked quote: a well-quoted Seed is unchanged.
 */
export function unbackedBullets(
  bullets: readonly string[],
  quotes: ReadonlyArray<{ exactExcerpt: string; needsQuoteCheck?: boolean }>,
  seedBullets: readonly string[] = bullets
): string[] {
  const seedText = seedBullets.join(" ");
  const unrelated = (quote: { exactExcerpt: string; needsQuoteCheck?: boolean }) =>
    quote.needsQuoteCheck === true &&
    !(canJudgeQuote(seedText, quote.exactExcerpt) && quoteBacksSeed(seedBullets, quote.exactExcerpt));
  const marked = quotes.filter(unrelated);
  if (marked.length === 0) return [];
  const evidence = quotes.filter((quote) => !unrelated(quote));
  const sentences = bullets.filter((bullet) => bullet.trim() !== "");
  // Re-check P3-2: with no quote left to back anything, every sentence is named.
  if (evidence.length === 0) return sentences;
  const backed = (bullet: string) =>
    evidence.some((quote) => !canJudgeQuote(bullet, quote.exactExcerpt) || excerptSupportsSeed(bullet, quote.exactExcerpt));
  const markedWords = marked.flatMap((quote) => contentWords(quote.exactExcerpt));
  const evidenceWords = evidence.flatMap((quote) => contentWords(quote.exactExcerpt));
  // Judged on the Seed's own sentences, so a sentence the writer rewrote
  // still claims the marked quote's words and is simply no longer named.
  const onlyMarked = seedBullets.filter((bullet) =>
    contentWords(bullet).some((word) =>
      word.length >= 2 &&
      markedWords.some((other) => sameWord(word, other)) &&
      !evidenceWords.some((other) => sameWord(word, other))));
  // Greptile on PR #26 at 1da92721: every sentence is checked. A sentence no
  // other quote backs is always named. A sentence holding a word only a
  // marked quote has is named too, even beside a quote that shares other
  // words with it (review P2-1), unless one of those sentences is itself
  // unbacked: that one is the marked quote's target, already named, and a
  // backed sentence that merely shares a word with it is not (re-check P3-1).
  const target = onlyMarked.some((bullet) => !backed(bullet)) ? [] : onlyMarked;
  return sentences.filter((bullet) => !backed(bullet) || target.includes(bullet));
}
