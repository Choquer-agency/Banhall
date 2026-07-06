// BNH-45: CRA Schedule 60 (T661 Part 2) line-limit math.
//
// The form's section fields are fixed-width: 78 characters per line, with
// hard line caps per section. Calibrated against the client's own at-limit
// example (Tracy/Acuity FY25 → 49/100/50 vs limits 50/100/50): lines are
// counted with GREEDY WORD WRAP at 78 chars, and each paragraph break
// (blank line between paragraphs) costs one full line.
//
// Shared by generation-time enforcement (convex/ai/*) and UI meters
// (option cards, QA panel). Keep framework-free.

export const CHARS_PER_LINE = 78;

/** Hard line caps per section (client email 2026-07; matches their example). */
export const LINE_LIMITS = { s242: 50, s244: 100, s246: 50 } as const;

/** Secondary hard word ceilings (ticket): never exceed even if lines pass. */
export const WORD_CAPS = { s242: 500, s244: 1000, s246: 500 } as const;

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

/** Greedy word-wrap line count for one paragraph at the form's width. */
function wrappedLineCount(paragraph: string, width = CHARS_PER_LINE): number {
  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let lineLen = 0;
  let lines = 1;
  for (const w of words) {
    const need = lineLen === 0 ? w.length : lineLen + 1 + w.length;
    if (need <= width) {
      lineLen = need;
    } else {
      lines += 1;
      lineLen = Math.min(w.length, width);
    }
  }
  return lines;
}

/** Split section text into trimmed paragraphs (blank-line separated). */
export function toParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Form-accurate metrics for one section's text. */
export function sectionMetrics(text: string, section: SectionKey): SectionMetrics {
  const paras = toParagraphs(text);
  const textLines = paras.reduce((n, p) => n + wrappedLineCount(p), 0);
  const breaks = Math.max(0, paras.length - 1); // each blank line costs a line
  const lines = textLines + breaks;
  const words = paras.join(" ").split(/\s+/).filter(Boolean).length;
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
