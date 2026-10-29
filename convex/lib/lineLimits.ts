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
 * 2026-10-29 (third, item 7, owner: "Its for when we export that they need
 * to fit CRA's template, during generation we can be 15-20% over if needed
 * to get the point across but shouldn't be a bottleneck."): the CRA limits
 * above are export limits. While drafting, a Line may run up to this share
 * over its word cap and its line limit; compression runs only above that
 * ceiling, and aims under it, never down to the export limit. Export, its
 * validation, the editor's meters and the Assistant's shorten options still
 * hold a Line to the CRA limits. One number, so it can be tuned.
 */
export const GENERATION_LIMIT_ALLOWANCE = 0.2;

/** The most a Line may hold while drafting: its CRA limits plus the allowance (420/840/420 words, 60/120/60 lines). */
export function generationCeiling(section: SectionKey): { wordCap: number; lineLimit: number } {
  return {
    wordCap: Math.floor(WORD_CAPS[section] * (1 + GENERATION_LIMIT_ALLOWANCE)),
    lineLimit: Math.floor(LINE_LIMITS[section] * (1 + GENERATION_LIMIT_ALLOWANCE)),
  };
}

/** Whether measured text is over the drafting ceiling (gap-stripped, like the CRA limits). */
export function overGenerationCeiling(metrics: { words: number; lines: number }, section: SectionKey): boolean {
  const ceiling = generationCeiling(section);
  return metrics.words > ceiling.wordCap || metrics.lines > ceiling.lineLimit;
}

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
export const WORD_BUDGET_USABLE_LINE_FACTOR = 0.9;
export const WORD_BUDGET_WORDS_PER_LINE = 8.5;
export type LengthTarget = keyof typeof LENGTH_TARGETS;

export type SectionKey = keyof typeof LINE_LIMITS;

/**
 * Inline client-info placeholders (`[GAP: what's needed]`) are prompts, not
 * filing prose — they are excluded from the CRA line/word math. `*` (not `+`)
 * inside so an emptied-out `[GAP:]` still matches.
 *
 * CAUTION: this regex is global — `.test()`/`.exec()` on it are stateful
 * (lastIndex). Use `matchAll`/`replace` (which reset it), or build a fresh
 * non-global copy via `new RegExp(GAP_MARKER_RE.source, "i")`.
 */
/**
 * What a note holds between its colon and its "]": anything but another
 * note's opening or a blank line (review round 2 of the inference marker),
 * so an opening left unclosed never swallows the text after it, in its
 * paragraph or the next. A single line break (a hard break) may sit inside a
 * note, and so may one level of plain brackets such as a "[3]" citation
 * (review round 3). Each branch starts on a different character, so the
 * match stays linear.
 */
// The opening test spells out both cases, so a copy of these patterns made
// without the "i" flag (tiptapReport's GAP_CAPTURE_RE) still stops at a
// lowercase "[inferred:" (review round 4).
const NOTE_BODY = String.raw`(?:[^\[\]\n]|\[(?!(?:[Gg][Aa][Pp]|[Ii][Nn][Ff][Ee][Rr][Rr][Ee][Dd]):)[^\[\]\n]*\]|\n(?![^\S\n]*\n))*`;

export const GAP_MARKER_RE = new RegExp(String.raw`\[GAP:${NOTE_BODY}\]`, "gi");

/**
 * 2026-10-29 (owner): a claim the evidence does not state but that follows
 * from it is written and marked `[INFERRED: what it rests on]` right after
 * the sentence, so the writer knows which sentence to check and why. Like a
 * gap, the marker is a note to the writer, not filing prose: its text never
 * counts toward a Line's words or form lines. Deleting it (the writer
 * accepting the inference) therefore changes no count. Same caution as
 * GAP_MARKER_RE: global, so use `matchAll`/`replace` or a fresh copy.
 */
export const INFERRED_MARKER_RE = new RegExp(String.raw`\[INFERRED:${NOTE_BODY}\]`, "gi");

/** Either note marker: a [GAP: ...] or an [INFERRED: ...]. Global, as above. */
export const NOTE_MARKER_RE = new RegExp(String.raw`\[(?:GAP|INFERRED):${NOTE_BODY}\]`, "gi");

/** Collapse the doubled spaces a marker's removal creates while PRESERVING
 * newlines (every explicit break costs a CRA form line). */
function collapseRemovalSpaces(text: string): string {
  return text.replace(/[^\S\n]{2,}/g, " ");
}

/** Remove gap markers; collapse the doubled spaces removal creates while
 * PRESERVING newlines (every explicit break costs a CRA form line). */
export function stripGapMarkers(text: string): string {
  return collapseRemovalSpaces(text.replace(GAP_MARKER_RE, ""));
}

/** Remove [INFERRED: ...] markers, the same way stripGapMarkers removes gaps. */
export function stripInferredMarkers(text: string): string {
  return collapseRemovalSpaces(text.replace(INFERRED_MARKER_RE, ""));
}

/** Remove both kinds of note marker. */
export function stripNoteMarkers(text: string): string {
  return collapseRemovalSpaces(text.replace(NOTE_MARKER_RE, ""));
}

/** One note marker in a text: its kind, its whole text, what it says, and where. */
export type ReportNoteMatch = {
  kind: "gap" | "inferred";
  /** The whole marker as written, brackets included. */
  text: string;
  /** What it says after the colon, trimmed ("" for an empty marker). */
  note: string;
  index: number;
};

/** Every [GAP: ...] and [INFERRED: ...] marker in `text`, in text order. */
export function findReportNotes(text: string): ReportNoteMatch[] {
  return [...text.matchAll(NOTE_MARKER_RE)].map((match) => {
    const kind = /^\[GAP/i.test(match[0]) ? "gap" : "inferred";
    return {
      kind,
      text: match[0],
      note: match[0].slice(match[0].indexOf(":") + 1, -1).trim(),
      index: match.index,
    };
  });
}

/** Half-open [start, end) spans of every note marker (gap or inferred) in `text`. */
function noteRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const match of text.matchAll(NOTE_MARKER_RE)) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

export type SectionMetrics = {
  /** Canonical (gap-stripped) form-line count. */
  lines: number;
  /** Canonical (gap-stripped) word count. */
  words: number;
  paragraphs: number;
  limit: number;
  wordCap: number;
  /** Over the CRA limits on gap-stripped text (the filing-blocking signal). */
  overLimit: boolean;
  /** Line count including [GAP: …] marker text (never [INFERRED: …] text). */
  rawLines: number;
  /** Word count including [GAP: …] marker text (never [INFERRED: …] text). */
  rawWords: number;
  /** Over the CRA limits only once gap text is counted. */
  overLimitWithGaps: boolean;
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

/**
 * First character offset (in the ORIGINAL string — editor decorations map
 * these to ProseMirror positions) where the section exceeds its CRA limits.
 *
 * [GAP: …] and [INFERRED: …] marker text does not count: tokens fully inside
 * a marker contribute neither words nor line length; partially overlapping
 * tokens contribute only their characters outside it. A section that
 * overflows only because of marker text returns null.
 */
export function overflowStartOffset(
  text: string,
  section: SectionKey
): number | null {
  const lineLimit = LINE_LIMITS[section];
  const wordCap = WORD_CAPS[section];
  const gaps = noteRanges(text);
  let gapIndex = 0; // markers are in document order; tokens are visited in order

  /** Non-marker character count and first non-marker offset of [start, end). */
  const effectiveSpan = (
    start: number,
    end: number
  ): { length: number; firstVisible: number } => {
    // Skip markers that end at or before this token.
    while (gapIndex < gaps.length && gaps[gapIndex][1] <= start) gapIndex += 1;
    let length = end - start;
    let firstVisible = start;
    for (let i = gapIndex; i < gaps.length && gaps[i][0] < end; i += 1) {
      const overlapStart = Math.max(start, gaps[i][0]);
      const overlapEnd = Math.min(end, gaps[i][1]);
      length -= overlapEnd - overlapStart;
      if (firstVisible >= overlapStart && firstVisible < overlapEnd) {
        firstVisible = overlapEnd;
      }
    }
    return { length, firstVisible: Math.min(firstVisible, end - 1) };
  };

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
      const span = effectiveSpan(wordStart, wordStart + word.length);
      // Token entirely inside a [GAP: …] or [INFERRED: …] marker: free, no word, no width.
      if (span.length === 0) continue;
      words += 1;
      if (words > wordCap) return span.firstVisible;

      if (lineLength > 0 && lineLength + 1 + span.length <= CHARS_PER_LINE) {
        lineLength += 1 + span.length;
        continue;
      }
      if (lineLength > 0) {
        lineCount += 1;
        lineLength = 0;
        if (consumedLines + lineCount > lineLimit) return span.firstVisible;
      }

      const extraLines = Math.floor((span.length - 1) / CHARS_PER_LINE);
      if (consumedLines + lineCount + extraLines > lineLimit) {
        const available = (lineLimit - consumedLines - lineCount + 1) * CHARS_PER_LINE;
        return Math.min(
          span.firstVisible + Math.max(0, available),
          lineStart + line.length - 1
        );
      }
      lineCount += extraLines;
      lineLength = ((span.length - 1) % CHARS_PER_LINE) + 1;
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

/** Line/word counts for already-newline-normalized text. */
function countLinesAndWords(normalized: string): { lines: number; words: number } {
  const physicalLines = normalized === "" ? [] : normalized.split("\n");
  const lines = physicalLines.reduce(
    (total, line) => total + (line.trim() ? wrappedLineCount(line) : 1),
    0
  );
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return { lines, words };
}

/** Form-accurate metrics for one section's text. The canonical `lines`/`words`
 * exclude [GAP: …] and [INFERRED: …] marker text; `rawLines`/`rawWords`
 * include the gap text only, so their difference is what replacing the gaps
 * with real text would add ("+3 with gaps"). Deleting an [INFERRED: …]
 * marker changes neither. With no gaps present the two are identical. */
export function sectionMetrics(text: string, section: SectionKey): SectionMetrics {
  const normalized = text.replace(/\r\n?/g, "\n");
  const paras = toParagraphs(normalized);
  const withGaps = stripInferredMarkers(normalized);
  const raw = countLinesAndWords(withGaps);
  const stripped = countLinesAndWords(stripGapMarkers(withGaps));
  const limit = LINE_LIMITS[section];
  const wordCap = WORD_CAPS[section];
  return {
    lines: stripped.lines,
    words: stripped.words,
    paragraphs: paras.length,
    limit,
    wordCap,
    overLimit: stripped.lines > limit || stripped.words > wordCap,
    rawLines: raw.lines,
    rawWords: raw.words,
    overLimitWithGaps: raw.lines > limit || raw.words > wordCap,
  };
}

/** Word budget to hand the model for a given section + length preference.
 * Empirical: this corpus runs ~8.5 words per 78-char line; paragraph breaks
 * eat ~10% of the line budget. */
export function wordBudget(section: SectionKey, target: LengthTarget): number {
  const usableLines =
    LINE_LIMITS[section] *
    LENGTH_TARGETS[target] *
    WORD_BUDGET_USABLE_LINE_FACTOR;
  return Math.min(
    Math.round(usableLines * WORD_BUDGET_WORDS_PER_LINE),
    WORD_CAPS[section]
  );
}

/**
 * 2026-09-28 (second, full suite): the share of the Locked word cap an ordered-chain draft
 * aims for. The release suite's drafts overshot a 337-word ask by 15 to 40
 * percent, so the ask leaves real headroom under the cap.
 */
export const DRAFT_WORD_CAP_SHARE = 0.85;

/**
 * The words an ordered-chain draft (and its repair) is asked for: the length
 * budget, never above `DRAFT_WORD_CAP_SHARE` of the Locked word cap (297 for
 * Lines 242 and 246, 595 for Line 244).
 */
export function draftWordTarget(section: SectionKey, target: LengthTarget): number {
  return Math.min(
    wordBudget(section, target),
    Math.floor(WORD_CAPS[section] * DRAFT_WORD_CAP_SHARE)
  );
}
