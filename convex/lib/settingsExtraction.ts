import {
  MAX_SELF_CHECK_INSTRUCTION_CHARS,
  MAX_SELF_CHECK_RULES,
  type SectionNumber,
  type SelfCheckRule,
} from "./orderedChain";

/**
 * Story 3 (CAP-6/8, AD-26): deterministic, conservative extraction of a
 * Build Order and cap rules from Writer Profile instruction text. It runs
 * identically on a saved profile's `customInstructions` and on a settings
 * document, and fills only what the source does not hold structurally.
 * Extracted caps are never trusted: the Self-check clips them to the Locked
 * caps and reports the clip (`tier: conflict`).
 *
 * Grammar:
 * - Build Order is read per line, before any other split: a line with a
 *   build-order cue gives its section numbers in order of appearance when
 *   there are at least two. resolveBuildOrder validates the raw list.
 * - Caps are read per segment (lines split on `;` and sentence ends). A
 *   segment naming exactly one section becomes a cap rule. Each segment is
 *   split into clauses on a comma followed by whitespace, so a thousands
 *   separator ("1,500") is never a clause break.
 * - A number is a maximum only when an upper-bound cue governs it: a cue
 *   earlier in its clause with no lower-bound cue in between, or a trailing
 *   cue right after its unit. A number a lower-bound cue governs is ignored.
 *   The first maximum per unit wins.
 */

// Guard: a number followed by a unit is a cap, never a section, and a digit
// group after a thousands comma ("1,246") is never a section either.
const SECTION_PATTERN =
  /(?<![\w§]|\d,)(?:(?:line|section|s)\s*|§\s*)?(242|244|246)(?!\d)(?!\s*(?:words?|lines?)\b)/gi;
const CAP_PATTERN = /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?!\d)\s*(words?|lines?)\b/gi;
const UPPER_BOUND_CUE =
  /\b(?:max(?:imum)?|at most|no more than|up to|not (?:to )?exceed|limit(?:ed)? to|cap(?:ped)? at|under|within)\b|≤|<=/gi;
const LOWER_BOUND_CUE =
  /\b(?:at least|min(?:imum)?|no fewer than|no less than|(?<!\bno |\bnot )more than|over)\b|≥|>=/gi;
const TRAILING_UPPER_CUE = /^\s*(?:max(?:imum)?|or (?:less|fewer)|at most)\b/i;
const BUILD_ORDER_CUE =
  /\b(?:build order|drafting order|generation order|order of (?:drafting|generation))\b/i;

const MAX_CAP_VALUE = 9999;

export type ExtractedSettingsRules = {
  /** Raw section list in order of appearance; resolveBuildOrder validates it. */
  buildOrder?: string[];
  selfCheckRules: SelfCheckRule[];
};

/** `;` and sentence ends within one line. */
function segmentsOf(line: string): string[] {
  return line
    .split(/;|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function sectionsIn(text: string): SectionNumber[] {
  return [...text.matchAll(SECTION_PATTERN)].map((match) => match[1] as SectionNumber);
}

/** Start index of the last match of `cue` in `text`, or -1. */
function lastCueIndex(cue: RegExp, text: string): number {
  let last = -1;
  for (const match of text.matchAll(cue)) last = match.index ?? last;
  return last;
}

/** The maxima the clause states, per unit, in order of appearance. */
function clauseMaxima(clause: string): Array<{ unit: "words" | "lines"; value: number }> {
  const out: Array<{ unit: "words" | "lines"; value: number }> = [];
  for (const match of clause.matchAll(CAP_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isInteger(value) || value <= 0 || value > MAX_CAP_VALUE) continue;
    const start = match.index ?? 0;
    const before = clause.slice(0, start);
    const after = clause.slice(start + match[0].length);
    const upper = lastCueIndex(UPPER_BOUND_CUE, before);
    const lower = lastCueIndex(LOWER_BOUND_CUE, before);
    // A lower bound governs the number: never a maximum.
    if (lower > upper) continue;
    if (upper >= 0 || TRAILING_UPPER_CUE.test(after)) {
      out.push({ unit: match[2].toLowerCase().startsWith("word") ? "words" : "lines", value });
    }
  }
  return out;
}

function capRule(segment: string): SelfCheckRule | null {
  const sections = new Set(sectionsIn(segment));
  if (sections.size !== 1) return null;
  let maxWords: number | undefined;
  let maxLines: number | undefined;
  for (const clause of segment.split(/,\s+/)) {
    for (const { unit, value } of clauseMaxima(clause)) {
      if (unit === "words") maxWords ??= value;
      else maxLines ??= value;
    }
  }
  if (maxWords === undefined && maxLines === undefined) return null;
  const [section] = [...sections];
  return {
    section,
    instruction: segment.slice(0, MAX_SELF_CHECK_INSTRUCTION_CHARS),
    ...(maxWords !== undefined ? { maxWords } : {}),
    ...(maxLines !== undefined ? { maxLines } : {}),
  };
}

export function extractSettingsRules(text: string): ExtractedSettingsRules {
  const selfCheckRules: SelfCheckRule[] = [];
  let buildOrder: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (buildOrder === undefined && BUILD_ORDER_CUE.test(line)) {
      const order = sectionsIn(line);
      if (order.length >= 2) {
        buildOrder = order;
        continue;
      }
    }
    for (const segment of segmentsOf(line)) {
      if (selfCheckRules.length >= MAX_SELF_CHECK_RULES) break;
      const rule = capRule(segment);
      if (rule) selfCheckRules.push(rule);
    }
  }
  return { ...(buildOrder ? { buildOrder } : {}), selfCheckRules };
}
