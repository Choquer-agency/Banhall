import {
  DEFAULT_BUILD_ORDER,
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
 * Conservative by design: a missed cap is reported nowhere, but a false cap
 * shortens a section through repair. Grammar (Design Notes of story 3):
 * 1. Build Order is read per line, before any other split: the bounded run
 *    of section numbers directly after a build-order cue (at most three,
 *    separated by `,` `;` `/` `→` `->` `>` `then` `and` or whitespace). The
 *    run stops at the first other token and the rest of the line goes on to
 *    cap extraction. A run of one or more sections is the raw list and always
 *    goes through resolveBuildOrder, so a one-section run ("Build order: 246
 *    first.") falls back to the default order with its reason. A cue with no
 *    section number directly after it gives no Build Order.
 * 2. Segments: lines (or the rest of a Build Order line) split on `;` and at
 *    sentence ends. A segment is read only when it names exactly one section.
 * 3. Whole-section scope only: a segment that mentions, anywhere, a
 *    per-item cue (`each`, `per`, `every`, `apiece`), a sub-unit noun
 *    (sentences, paragraphs, bullets, …) or a part-of-section word (first,
 *    opening, summary, …) gives no cap at all. This runs on the whole
 *    segment, before any clause split, and wins over every later rule;
 *    missing a real cap is the accepted cost.
 * 4. A cap number is a number (comma thousands separators allowed) followed
 *    by a word or line unit that is not followed by `of` ("40 lines of
 *    code"). No part of a decimal or of a period- or space-grouped digit run
 *    is ever a cap number ("2.5 lines", "1.500 words", "1 500 words").
 * 5. It counts as a maximum only when it directly follows an upper-bound cue
 *    (an optional `a total of` or `of` between), its unit is directly
 *    followed by a trailing cue, or it directly follows `and` or `,` after a
 *    number that counted. A negated cue ("not under"), every lower-bound cue
 *    before the number, and a lower-bound cue directly after its unit
 *    ("minimum", "at least", "or more") govern a minimum, which is ignored
 *    and never continues a chain. The first maximum per unit wins.
 */

// Guard: a number followed by a unit is a cap, never a section, and a digit
// group after a thousands comma ("1,246") is never a section either.
const SECTION_PATTERN =
  /(?<![\w§]|\d,)(?:(?:line|section|s)\s*|§\s*)?(242|244|246)(?!\d)(?!\s*(?:words?|lines?)\b)/gi;
const CAP_PATTERN =
  /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?!\d)\s*(words?|lines?)\b(?!\s+of\b)/gi;

// Each "directly before the number" pattern is anchored at the end of the
// text preceding the number: the cue, then only `a total of` or `of`.
const BEFORE_NUMBER_TAIL = String.raw`\s*(?:(?:a total )?of\s+)?$`;
const CUE_START = String.raw`(?:^|[^\p{L}\p{N}_])`;
const UPPER_BOUND_BEFORE = new RegExp(
  `${CUE_START}(?:(not|never)\\s+)?(?:max(?:imum)?|at most|no more than|up to|not (?:to )?exceed|limit(?:ed)? (?:to|of)|cap(?:ped)? at|under|within|below|≤|<=)${BEFORE_NUMBER_TAIL}`,
  "iu"
);
const LOWER_BOUND_BEFORE = new RegExp(
  `${CUE_START}(?:at least|min(?:imum)?|no fewer than|no less than|more than|over|≥|>=|(?:not|never)\\s+(?:under|below|within|less than))${BEFORE_NUMBER_TAIL}`,
  "iu"
);
const TRAILING_UPPER_CUE = /^\s*(?:max(?:imum)?|or (?:less|fewer)|at most)\b/i;
// A lower-bound cue directly after the unit governs a minimum: "300 words
// minimum", "300 words at least", "300 words or more".
const TRAILING_LOWER_CUE = /^\s*(?:min(?:imum)?|at least|or more)\b/i;
// Ambiguous numbers are never caps: a decimal ("2.5 lines") and a period- or
// space-grouped run ("1.500 words", "1 500 words"). Comma grouping is the one
// accepted thousands form. Applies to cap numbers only.
const AMBIGUOUS_NUMBER_PATTERNS = [/\d+\.\d+/g, /\d{1,3}(?:[. ]\d{3})+/g];
const CHAIN_GAP = /^\s*(?:and|,)\s*$/i;
// Rule 4: a cap binds a whole section, so a segment that talks about any part
// of one gives no cap. Checked on the whole segment, before any clause split.
const PER_ITEM_CUES = String.raw`each|per|every|apiece`;
const SUB_UNIT_NOUNS = String.raw`sentences?|paragraphs?|bullets?|points?|items?|experiments?|examples?|headings?|sub-?sections?|tables?|figures?|lists?|steps?|quotes?|quotations?|phrases?|titles?|captions?|clauses?`;
const PART_OF_SECTION_WORDS = String.raw`first|last|opening|intro|introduction|conclusion|summary|overview|start|end|beginning`;
const PARTIAL_SCOPE = new RegExp(
  `\\b(?:${PER_ITEM_CUES}|${SUB_UNIT_NOUNS}|${PART_OF_SECTION_WORDS})\\b`,
  "i"
);

const BUILD_ORDER_CUE =
  /\b(?:build order|drafting order|generation order|order of (?:drafting|generation))\b/i;
const RUN_LEAD = /^\s*(?:(?:[:=\-–—]|is\b)\s*)?/i;
const RUN_SECTION = /^(?:(?:lines?|sections?|s)\s*|§\s*)?(242|244|246)(?!\d)/i;
const RUN_SEPARATOR = /^(?:\s*(?:,|;|\/|→|->|>|\bthen\b|\band\b)\s*)+|^\s+/i;
/** A Build Order run is bounded by the number of sections. */
const MAX_BUILD_ORDER_RUN = DEFAULT_BUILD_ORDER.length;

const MAX_CAP_VALUE = 9999;

export type ExtractedSettingsRules = {
  /** Raw section list in order of appearance; resolveBuildOrder validates it. */
  buildOrder?: string[];
  selfCheckRules: SelfCheckRule[];
};

/** `;` and sentence ends. */
function segmentsOf(text: string): string[] {
  return text
    .split(/;|(?<=[.!?])\s+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function sectionsIn(text: string): SectionNumber[] {
  return [...text.matchAll(SECTION_PATTERN)].map((match) => match[1] as SectionNumber);
}

/** Spans of the decimals and period- or space-grouped digit runs of a segment. */
function ambiguousNumberRanges(segment: string): Array<[number, number]> {
  return AMBIGUOUS_NUMBER_PATTERNS.flatMap((pattern) =>
    [...segment.matchAll(pattern)].map(
      (match): [number, number] => [match.index ?? 0, (match.index ?? 0) + match[0].length]
    )
  );
}

type Unit = "words" | "lines";

/** The maxima a segment states, per unit, in order of appearance. */
function segmentMaxima(segment: string): Array<{ unit: Unit; value: number }> {
  const ambiguous = ambiguousNumberRanges(segment);
  const out: Array<{ unit: Unit; value: number }> = [];
  let previousCountedEnd: number | null = null;
  for (const match of segment.matchAll(CAP_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const numberEnd = start + match[1].length;
    const value = Number(match[1].replace(/,/g, ""));
    const partOfAmbiguousNumber = ambiguous.some(([from, to]) => start < to && from < numberEnd);
    if (
      partOfAmbiguousNumber ||
      !Number.isInteger(value) ||
      value <= 0 ||
      value > MAX_CAP_VALUE
    ) {
      previousCountedEnd = null;
      continue;
    }
    const before = segment.slice(0, start);
    const upper = UPPER_BOUND_BEFORE.exec(before);
    let counts: boolean;
    if (TRAILING_LOWER_CUE.test(segment.slice(end))) {
      // A trailing lower-bound cue governs a minimum, whatever precedes it,
      // and a governed number never continues an `and` / `,` chain.
      counts = false;
    } else if (upper && !upper[1]) {
      counts = true;
    } else if (upper || LOWER_BOUND_BEFORE.test(before)) {
      // A negated or lower-bound cue governs a minimum: never a maximum.
      counts = false;
    } else {
      counts =
        TRAILING_UPPER_CUE.test(segment.slice(end)) ||
        (previousCountedEnd !== null && CHAIN_GAP.test(segment.slice(previousCountedEnd, start)));
    }
    if (counts) {
      out.push({ unit: match[2].toLowerCase().startsWith("word") ? "words" : "lines", value });
      previousCountedEnd = end;
    } else {
      previousCountedEnd = null;
    }
  }
  return out;
}

function capRule(segment: string): SelfCheckRule | null {
  // Rule 4 wins over every later rule: a limit on part of a section is never
  // a whole-section cap, wherever in the segment the part is named.
  if (PARTIAL_SCOPE.test(segment)) return null;
  const sections = new Set(sectionsIn(segment));
  if (sections.size !== 1) return null;
  let maxWords: number | undefined;
  let maxLines: number | undefined;
  for (const { unit, value } of segmentMaxima(segment)) {
    if (unit === "words") maxWords ??= value;
    else maxLines ??= value;
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

/**
 * The bounded run of section numbers directly after a build-order cue, and
 * the text of the line left for cap extraction, or null when no section
 * number directly follows the cue. A partial run is still returned: the
 * caller hands it to resolveBuildOrder, whose fallback reason reports it.
 */
function buildOrderRun(line: string): { order: SectionNumber[]; capText: string } | null {
  const cue = BUILD_ORDER_CUE.exec(line);
  if (!cue) return null;
  const after = line.slice(cue.index + cue[0].length);
  let position = (RUN_LEAD.exec(after)?.[0] ?? "").length;
  let restStart = position;
  const order: SectionNumber[] = [];
  while (order.length < MAX_BUILD_ORDER_RUN) {
    if (order.length > 0) {
      const separator = RUN_SEPARATOR.exec(after.slice(position));
      if (!separator) break;
      position += separator[0].length;
    }
    const section = RUN_SECTION.exec(after.slice(position));
    if (!section) break;
    order.push(section[1] as SectionNumber);
    position += section[0].length;
    restStart = position;
  }
  if (order.length === 0) return null;
  return { order, capText: `${line.slice(0, cue.index)};${after.slice(restStart)}` };
}

export function extractSettingsRules(text: string): ExtractedSettingsRules {
  const selfCheckRules: SelfCheckRule[] = [];
  let buildOrder: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    if (selfCheckRules.length >= MAX_SELF_CHECK_RULES && buildOrder !== undefined) break;
    let capText = line;
    if (buildOrder === undefined) {
      const run = buildOrderRun(line);
      if (run) {
        buildOrder = run.order;
        capText = run.capText;
      }
    }
    for (const segment of segmentsOf(capText)) {
      if (selfCheckRules.length >= MAX_SELF_CHECK_RULES) break;
      const rule = capRule(segment);
      if (rule) selfCheckRules.push(rule);
    }
  }
  return { ...(buildOrder ? { buildOrder } : {}), selfCheckRules };
}
