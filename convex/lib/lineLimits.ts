// BNH-45: CRA Schedule 60 (T661 Part 2) line-limit math.
//
// The form's section fields are fixed-width: 78 characters per line, with
// hard line caps per section. Calibrated against the client's own at-limit
// example (Tracy/Acuity FY25 → 49/100/50 vs limits 50/100/50): each physical
// line is wrapped greedily at 78 characters, and every explicit line break
// (including repeated blank lines) consumes a form line.
//
// Shared by generation-time enforcement (convex/ai/*) and UI meters
// (option cards, QA panel). Keep framework-free.

export const CHARS_PER_LINE = 78;

/** Hard line caps per section (client email 2026-07; matches their example). */
export const LINE_LIMITS = { s242: 50, s244: 100, s246: 50 } as const;

/** Current CRA T661 project-description word ceilings. */
export const WORD_CAPS = { s242: 350, s244: 700, s246: 350 } as const;

/**
 * Length preference (client email: parameterizable — shorter for quick
 * review, fuller for trim-down editing). Fraction of the line limit the
 * generator should aim for.
 */
export const LENGTH_TARGETS = {
  concise: 0.7,
  standard: 0.88,
  full: 1.0,
} as const;
export type LengthTarget = keyof typeof LENGTH_TARGETS;

export type SectionKey = keyof typeof LINE_LIMITS;

export type SectionMetrics = {
  lines: number;
  words: number;
  paragraphs: number;
  limit: number;
  wordCap: number;
  overLimit: boolean;
};

/** Greedy word-wrap line count for one non-empty physical line. */
function wrappedLineCount(line: string, width = CHARS_PER_LINE): number {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;

  let lines = 1;
  let lineLength = 0;
  for (const word of words) {
    if (lineLength > 0 && lineLength + 1 + word.length <= width) {
      lineLength += 1 + word.length;
      continue;
    }

    if (lineLength > 0) {
      lines += 1;
      lineLength = 0;
    }

    // An unbroken token wider than the form still occupies every 78-character
    // chunk; keep the final chunk available for the next word when it fits.
    lines += Math.floor((word.length - 1) / width);
    lineLength = ((word.length - 1) % width) + 1;
  }
  return lines;
}

export function overflowStartOffset(
  text: string,
  section: SectionKey
): number | null {
  const lineLimit = LINE_LIMITS[section];
  const wordCap = WORD_CAPS[section];
  let consumedLines = 0;
  let words = 0;
  let lineStart = 0;
  const physicalLines = text.match(/.*(?:\r\n|\r|\n|$)/g) ?? [];

  for (const physicalLine of physicalLines) {
    if (!physicalLine) continue;
    const newline = physicalLine.match(/\r\n$|\r$|\n$/)?.[0] ?? "";
    const line = physicalLine.slice(0, physicalLine.length - newline.length);

    if (!line.trim()) {
      consumedLines += 1;
      if (consumedLines > lineLimit) return lineStart;
      lineStart += physicalLine.length;
      continue;
    }

    let lineLength = 0;
    let lineCount = 1;
    for (const match of line.matchAll(/\S+/g)) {
      const word = match[0];
      const wordStart = lineStart + match.index;
      words += 1;
      if (words > wordCap) return wordStart;

      if (lineLength > 0 && lineLength + 1 + word.length <= CHARS_PER_LINE) {
        lineLength += 1 + word.length;
        continue;
      }
      if (lineLength > 0) {
        lineCount += 1;
        lineLength = 0;
        if (consumedLines + lineCount > lineLimit) return wordStart;
      }

      const extraLines = Math.floor((word.length - 1) / CHARS_PER_LINE);
      if (consumedLines + lineCount + extraLines > lineLimit) {
        const available = (lineLimit - consumedLines - lineCount + 1) * CHARS_PER_LINE;
        return wordStart + Math.max(0, available);
      }
      lineCount += extraLines;
      lineLength = ((word.length - 1) % CHARS_PER_LINE) + 1;
    }
    consumedLines += lineCount;
    if (consumedLines > lineLimit) return lineStart;
    lineStart += physicalLine.length;
  }
  return null;
}

/** Split section text into normalized, non-empty paragraphs. */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[^\S\n]*\n+/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Form-accurate metrics for one section's text. */
export function sectionMetrics(text: string, section: SectionKey): SectionMetrics {
  const normalized = text.replace(/\r\n?/g, "\n");
  const paras = toParagraphs(normalized);
  const physicalLines = normalized === "" ? [] : normalized.split("\n");
  const lines = physicalLines.reduce(
    (total, line) => total + (line.trim() ? wrappedLineCount(line) : 1),
    0
  );
  const words = normalized.split(/\s+/).filter(Boolean).length;
  const limit = LINE_LIMITS[section];
  const wordCap = WORD_CAPS[section];
  return {
    lines,
    words,
    paragraphs: paras.length,
    limit,
    wordCap,
    overLimit: lines > limit || words > wordCap,
  };
}

/** Word budget to hand the model for a given section + length preference.
 * Empirical: this corpus runs ~8.5 words per 78-char line; paragraph breaks
 * eat ~10% of the line budget. */
export function wordBudget(section: SectionKey, target: LengthTarget): number {
  const usableLines = LINE_LIMITS[section] * LENGTH_TARGETS[target] * 0.9;
  return Math.min(Math.round(usableLines * 8.5), WORD_CAPS[section]);
}
