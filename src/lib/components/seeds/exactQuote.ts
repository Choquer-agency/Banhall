/**
 * Exact-quote underlines for Seed bullets (ui-design-final.md section 11,
 * owner decision 17). A phrase is underlined only when it matches a cited
 * excerpt word for word: the longest run of consecutive words shared by the
 * bullet and the excerpt, compared case-insensitively and ignoring
 * punctuation between words. Runs shorter than MIN_QUOTE_WORDS are ignored
 * unless they cover the whole excerpt. Paraphrase detection is out of scope.
 */
export const MIN_QUOTE_WORDS = 4;

export type ExactQuoteSpan = {
  /** Character offsets into the bullet text, end exclusive. */
  start: number;
  end: number;
  /** Index into the citations passed in. */
  citationIndex: number;
};

type Token = { word: string; start: number; end: number };

const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(WORD)) {
    const start = match.index ?? 0;
    tokens.push({ word: match[0].toLowerCase().replace(/’/g, "'"), start, end: start + match[0].length });
  }
  return tokens;
}

function longestSharedRun(a: Token[], b: Token[]): { aStart: number; length: number } {
  let best = { aStart: 0, length: 0 };
  let previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1].word === b[j - 1].word) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best.length) best = { aStart: i - current[j], length: current[j] };
      }
    }
    previous = current;
  }
  return best;
}

export function findExactQuoteSpans(
  bullet: string,
  excerpts: readonly string[],
): ExactQuoteSpan[] {
  const bulletTokens = tokenize(bullet);
  const candidates: Array<ExactQuoteSpan & { words: number }> = [];
  excerpts.forEach((excerpt, citationIndex) => {
    const excerptTokens = tokenize(excerpt);
    if (excerptTokens.length === 0) return;
    const run = longestSharedRun(bulletTokens, excerptTokens);
    const wholeExcerpt = run.length === excerptTokens.length && run.length >= 2;
    if (run.length < MIN_QUOTE_WORDS && !wholeExcerpt) return;
    candidates.push({
      start: bulletTokens[run.aStart].start,
      end: bulletTokens[run.aStart + run.length - 1].end,
      citationIndex,
      words: run.length,
    });
  });
  // Longest first, then keep only spans that do not overlap a kept one.
  candidates.sort((x, y) => y.words - x.words || x.start - y.start);
  const kept: ExactQuoteSpan[] = [];
  for (const candidate of candidates) {
    if (kept.some((span) => candidate.start < span.end && span.start < candidate.end)) continue;
    kept.push({ start: candidate.start, end: candidate.end, citationIndex: candidate.citationIndex });
  }
  return kept.sort((x, y) => x.start - y.start);
}

/** Splits the bullet into plain and quoted segments for rendering. */
export function segmentBullet(
  bullet: string,
  spans: readonly ExactQuoteSpan[],
): Array<{ text: string; citationIndex?: number }> {
  const segments: Array<{ text: string; citationIndex?: number }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) segments.push({ text: bullet.slice(cursor, span.start) });
    segments.push({ text: bullet.slice(span.start, span.end), citationIndex: span.citationIndex });
    cursor = span.end;
  }
  if (cursor < bullet.length) segments.push({ text: bullet.slice(cursor) });
  return segments;
}
