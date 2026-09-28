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

/** One word as the check compares it: lower case, no possessive, singular. */
function normalizeWord(raw: string): string {
  let word = raw.toLowerCase().replace(/’/g, "'").replace(/'s$/, "");
  if (word.length > 4 && word.endsWith("ies")) word = `${word.slice(0, -3)}y`;
  else if (word.length > 3 && word.endsWith("s") && !/(ss|us|is)$/.test(word)) word = word.slice(0, -1);
  return word;
}

/** The meaningful words of `text`, normalized, without repeats. */
export function contentWords(text: string): string[] {
  const words = new Set<string>();
  for (const match of text.matchAll(WORD)) {
    const word = normalizeWord(match[0]);
    if (!STOP_WORDS.has(word) && !STOP_WORDS.has(match[0].toLowerCase())) words.add(word);
  }
  return [...words];
}

/**
 * Two normalized words match when equal, or when the shorter (at least four
 * letters) opens the longer for its first min(6, length) letters: "cure"
 * and "cured", "drill" and "drilling", "structure" and "structural", but
 * not "process" and "procedure".
 */
function sameWord(left: string, right: string): boolean {
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 4) return false;
  return long.startsWith(short.slice(0, Math.min(6, short.length)));
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
        piece = { seedIndex, citationIndexes: [], related: false, quoted: false, shared: 0 };
        bySeed.set(key, piece);
        pieces.push(piece);
      }
      piece.citationIndexes.push(citationIndex);
      piece.related ||= excerptSupportsSeed(text, citation.exactExcerpt);
      piece.quoted ||= quotesExcerpt(seed.bullets, citation.exactExcerpt);
      piece.shared = Math.max(piece.shared, sharedContentWords(text, citation.exactExcerpt));
    });
  });

  const reused = new Set<Piece>();
  if (options.reuse) {
    const byKey = new Map<string, Piece[]>();
    for (const piece of pieces) {
      if (!piece.related) continue;
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
    const code = !piece.related ? "CITATION_UNRELATED" : reused.has(piece) ? "CITATION_REUSED" : null;
    if (!code) continue;
    for (const citationIndex of piece.citationIndexes) {
      issues.push({ code, seedIndex: piece.seedIndex, citationIndex });
    }
  }
  return issues.sort((left, right) => left.seedIndex - right.seedIndex || left.citationIndex - right.citationIndex);
}
