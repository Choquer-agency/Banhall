import {
  DEFAULT_BUILD_ORDER,
  MAX_SELF_CHECK_INSTRUCTION_CHARS,
  MAX_SELF_CHECK_RULES,
  type SectionNumber,
  type SelfCheckRule,
} from "./orderedChain";
import type {
  BannedWordRule,
  RequiredOpeningRule,
  RequiredTermRule,
  WriterWordingRules,
} from "./writerWording";

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

// ─── 2026-10-04 (first), Round 5: the writer's wording rules ───────────────

/**
 * 2026-10-04 (first), Round 5 (owner approved 2026-10-05, "Build code
 * checks"): the writer's wording rules code measures, read from the same
 * effective instruction text as the caps (a saved profile or a settings
 * document). Only clear statements are read, and a line that is not one of
 * these shapes gives nothing: missing a rule is the accepted cost, a false
 * rule is never read. Each rule keeps its line as written (`source`).
 *
 * Grammar (one line at a time; a list item is a top-level "- ", "* " or
 * "1. " line, never an indented one):
 * 1. A required term, only inside a terms list: a heading, or a lead line,
 *    that names a glossary or the terms to use ("glossary", "terminology",
 *    "vocabulary", "required terms", "use these exact terms") opens it, and
 *    it ends at the next heading, at a blank line or other line after its
 *    first item. Each list item reads `<term>: <anything>. Never write A, B
 *    or C[ on their own].` The term is one to five words of letters,
 *    spaces and hyphens, not a label such as "Example", "Note", "Voice" or
 *    "Spelling", and its definition does not open with a quotation mark.
 *    The ban is a whole sentence of the item that opens "Never write",
 *    "Never use", "Never say", "Do not write", "Do not use" or "Don't
 *    write" and is nothing but a list of one to four word items (quotes
 *    around an item allowed) separated by commas and "or" ("A and B" stays
 *    one item); an item that carries an exception ("except", "unless",
 *    "alone", "by", "without", "even", "when", "if", "only", "outside",
 *    "but") makes the whole ban unread. " on their own" (or " on its own")
 *    at its end allows the banned words in a sentence that also holds the
 *    term. A banned item inside the term itself is never counted there.
 * 2. Banned words: a lead line that says "Never use these words (or
 *    phrases, terms)", "Do not use the following words" and the like and
 *    ends with a colon, or a heading "Banned words" (or "Banned phrases",
 *    "Banned words and phrases"), then its list items: blank lines are
 *    allowed before the first, and a blank line, a heading or any other
 *    line after one ends the list. Each item is one to four words of
 *    letters, spaces and hyphens, optionally followed by "(also A, B and
 *    the like)" whose one or two word items are its forms; an item with
 *    any other parenthesis, or of any other shape, gives nothing.
 * 3. A required opening: a line that tells the writer to open (begin,
 *    start) with "these exact words" or "the exact words", at the start of
 *    the line, after a colon, or after "must", "should" or "always", then
 *    two to fifteen words in quotation marks, and names exactly one Line
 *    (242, 244 or 246) before that. "objective" or "uncertainty" there
 *    names the statement. A line that negates it, says it would, could,
 *    can or may, if, rather than, instead of, by default, in older or
 *    previous reports, or calls itself an example gives nothing.
 */

const LIST_MARKER = /^(?:[-*\u2022]|\d+[.)])\s+/;
const HEADING = /^#{1,6}\s/;
const TERMS_CUE =
  /\b(?:glossary|terminology|vocabulary|(?:required|preferred|exact|named|core)\s+(?:variable\s+)?terms|use\s+these\s+(?:exact\s+)?terms)\b/i;
const TERM_HEAD = /^([A-Za-z][A-Za-z -]*?)\s*:\s+(.+)$/;
const TERM_LABEL_WORDS =
  /\b(?:example|examples|note|notes|tip|tips|e\.g|i\.e|for instance|such as|warning|important|voice|spelling|tense|tone|person|numbers?|units?|company|name|why|reason|acronyms?|abbreviations?|style|format|formatting|headings?|citations?|dates?|currency|capitali[sz]ation|punctuation|grammar|rule|rules|pronouns?|jargon|hedging|hedges?|results?|claims?|language|wording|marketing)\b/i;
/** Re-check P1-2: a heading or lead that names writing style opens no terms list. */
const STYLE_CUE = /\b(?:style|voice|tone|language|writing)\b/i;
/** Re-check P2-2: a scope inside a term ban ("in results", "in Line 246") leaves it unread. */
const TERM_BAN_SCOPE = /\b(?:in|within|for|during|before|after|line|lines)\b|\d/i;
/** Re-check P3: a heading that scopes its lists to a Line, or "only", leaves them unread. */
const SCOPED_HEADING = /\bonly\b/i;
const BAN_SENTENCE = /^(?:never\s+(?:write|use|say)|do\s+not\s+(?:write|use|say)|don['\u2019]t\s+(?:write|use|say))\s+(.+?)[.!]?$/i;
const OWN_SUFFIX = /\s+on\s+(?:their|its)\s+own$/i;
const LIST_ITEM_WORDS = /^[A-Za-z0-9][A-Za-z0-9 -]*$/;
const EXCEPTION_WORDS = /\b(?:except|unless|alone|by|without|even|when|if|only|outside|but)\b/i;
const BAN_LEAD =
  /^(?:#+\s*)?(?:\d+\.\s*)?(?:never|do\s+not|don['\u2019]t)\s+use\s+(?:any\s+of\s+)?(?:these|the\s+following)\s+(?:words?|phrases?|terms?)(?:\s+(?:or|and)\s+(?:words?|phrases?|terms?))?(?:\s*,\s*in\s+any\s+form)?\s*:\s*$/i;
const BAN_HEADING = /^#+\s*(?:\d+\.\s*)?banned\s+(?:words|phrases|terms|words\s+and\s+phrases)\s*$/i;
const FORMS_PARENTHESIS = /^\(\s*(?:also|including)\s+(.+?)(?:,?\s+(?:and|or)\s+the\s+like|,?\s+etc\.?)?\s*\)$/i;
const OPENING_CUE =
  /(?:^|:\s*|\b(?:must|should|always)\s+)(?:open|begin|start)\b[^"\u201c]*?\bwith\s+(?:these|the)\s+exact\s+words\s*:?\s*["\u201c]([^"\u201d]+)["\u201d]/i;
const OPENING_NEGATED = /\b(?:never|not|don['\u2019]t|avoid)\b[^"\u201c]*?\b(?:open|begin|start)\b/i;
const OPENING_NOT_AN_INSTRUCTION =
  /\b(?:would|could|can|may|might|if|when|where|once|unless|except|only|provided|assuming|subject\s+to|as\s+long\s+as|rather\s+than|instead\s+of|default|older|previous|used\s+to|example|e\.g)\b/i;

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** "A, B or C": one to four word items with no exception, or null for any other shape. */
function listItems(list: string): string[] | null {
  const items = list
    .split(/\s*,\s*(?:or\s+)?|\s+or\s+/i)
    .map((item) => item.trim().replace(/^["'\u201c\u2018](.*)["'\u201d\u2019]$/, "$1").trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  for (const item of items) {
    if (!LIST_ITEM_WORDS.test(item) || wordCount(item) > 4 || EXCEPTION_WORDS.test(item)) return null;
  }
  return items;
}

function termRule(body: string): RequiredTermRule | null {
  const head = TERM_HEAD.exec(body);
  if (!head) return null;
  const term = head[1]!.trim();
  const rest = head[2]!;
  // Final re-check P3-A5: a single Title-case word ("Readability",
  // "Audience") is a label, not a term.
  if (wordCount(term) > 5 || TERM_LABEL_WORDS.test(term) || /^[A-Z][a-z]+$/.test(term) || /^["'\u201c\u2018]/.test(rest.trim())) return null;
  for (const sentence of rest.split(/(?<=[.!?])\s+/)) {
    const ban = BAN_SENTENCE.exec(sentence.trim());
    if (!ban) continue;
    let list = ban[1]!.trim();
    const own = OWN_SUFFIX.test(list);
    if (own) list = list.replace(OWN_SUFFIX, "");
    const banned = listItems(list);
    if (!banned || banned.some((item) => TERM_BAN_SCOPE.test(item))) return null;
    const normalized = term.toLowerCase();
    if (banned.some((item) => item.toLowerCase() === normalized)) return null;
    return { term, banned, allowedWithTerm: own, source: body };
  }
  return null;
}

function bannedItem(body: string): BannedWordRule | null {
  const match = /^([A-Za-z][A-Za-z -]*?)\s*(\(.*\))?\s*\.?$/.exec(body);
  if (!match) return null;
  const phrase = match[1]!.trim();
  if (!LIST_ITEM_WORDS.test(phrase) || wordCount(phrase) > 4 || EXCEPTION_WORDS.test(phrase)) return null;
  const parenthesis = match[2]?.trim();
  if (!parenthesis) return { phrase, forms: [], source: body };
  // A parenthesis that is not a list of forms may qualify the ban: unread.
  const listed = FORMS_PARENTHESIS.exec(parenthesis);
  const items = listed ? listItems(listed[1]!) : null;
  return items && items.every((item) => wordCount(item) <= 2) ? { phrase, forms: items, source: body } : null;
}

function openingRule(body: string): RequiredOpeningRule | null {
  const cue = OPENING_CUE.exec(body);
  if (!cue) return null;
  const outsideQuotes = body.replace(/["\u201c][^"\u201d]*["\u201d]/g, " ");
  if (OPENING_NEGATED.test(outsideQuotes) || OPENING_NOT_AN_INSTRUCTION.test(outsideQuotes)) return null;
  const opening = cue[1]!.trim();
  const words = wordCount(opening);
  if (words < 2 || words > 15) return null;
  const before = body.slice(0, cue.index);
  const sections = [...new Set(sectionsIn(before))];
  if (sections.length !== 1) return null;
  const statement = /\bobjectives?\b/i.test(before)
    ? "objective" as const
    : /\buncertaint(?:y|ies)\b/i.test(before)
      ? "uncertainty" as const
      : undefined;
  return { opening, section: sections[0]!, ...(statement ? { statement } : {}), source: body };
}

type ListState = "none" | "terms" | "banned";

/** Whether a non-heading line leads a terms list: it names terms or a glossary, and says to use them or ends with a colon. */
function termsLead(trimmed: string): boolean {
  return TERMS_CUE.test(trimmed) && !STYLE_CUE.test(trimmed) && (/\b(?:use|uses|using)\b/i.test(trimmed) || /:\s*$/.test(trimmed));
}

/**
 * Round 5 (re-check P1-1 b): the lines that opened a list from which a rule
 * was read, so a ban-like sentence there is accounted for.
 */
export function extractWriterWordingRulesWithLeads(text: string): { rules: WriterWordingRules; leads: string[] } {
  const terms: RequiredTermRule[] = [];
  const banned: BannedWordRule[] = [];
  const openings: RequiredOpeningRule[] = [];
  const leads: string[] = [];
  let state: ListState = "none";
  let itemsSeen = false;
  let listLeads: string[] = [];
  let readFromList = false;
  // Re-check P3: the last heading scoped its lists (a Line, or "only").
  let scoped = false;
  const open = (next: ListState, lead?: string) => {
    if (readFromList) leads.push(...listLeads);
    state = next;
    itemsSeen = false;
    readFromList = false;
    listLeads = lead ? [lead] : [];
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    const item = LIST_MARKER.test(line);
    const indented = !item && /^\s+(?:[-*\u2022]|\d+[.)])\s+/.test(line);
    if (state !== "none") {
      if (item) {
        itemsSeen = true;
        const body = line.replace(LIST_MARKER, "").trim();
        if (state === "terms") {
          const term = termRule(body);
          if (term && !terms.some((entry) => entry.term.toLowerCase() === term.term.toLowerCase())) {
            terms.push(term);
            readFromList = true;
          }
        } else {
          const entry = bannedItem(body);
          if (entry && !banned.some((other) => other.phrase.toLowerCase() === entry.phrase.toLowerCase())) {
            banned.push(entry);
            readFromList = true;
          }
        }
        continue;
      }
      // A sub-item is never read, and does not end the list.
      if (indented) continue;
      // Before the first item: blank lines, and the list's own lead line.
      if (!itemsSeen && !HEADING.test(trimmed)) {
        if (trimmed === "") continue;
        if (state === "terms" && termsLead(trimmed)) {
          listLeads.push(trimmed);
          continue;
        }
        if (state === "banned" && BAN_LEAD.test(trimmed)) {
          listLeads.push(trimmed);
          continue;
        }
      }
      // A blank line, a heading or any other line ends the list; the line
      // itself is read below.
      open("none");
    }
    if (trimmed === "") continue;
    if (HEADING.test(trimmed)) scoped = sectionsIn(trimmed).length > 0 || SCOPED_HEADING.test(trimmed);
    if (BAN_LEAD.test(trimmed) || BAN_HEADING.test(trimmed)) {
      if (!scoped) open("banned", trimmed);
      continue;
    }
    if (
      !scoped &&
      ((HEADING.test(trimmed) && TERMS_CUE.test(trimmed) && !STYLE_CUE.test(trimmed)) || (!item && termsLead(trimmed)))
    ) {
      open("terms", trimmed);
      continue;
    }
    const body = (item ? line.replace(LIST_MARKER, "") : line).trim();
    const opening = openingRule(body);
    if (opening && !openings.some((entry) => entry.section === opening.section && entry.opening === opening.opening)) {
      openings.push(opening);
    }
  }
  open("none");
  return { rules: { terms, banned, openings }, leads };
}

/** Round 5: the writer's terms, banned words and required openings. */
export function extractWriterWordingRules(text: string): WriterWordingRules {
  return extractWriterWordingRulesWithLeads(text).rules;
}

// Final re-check P2-A2: "Avoid ...", "Never include ...", "banned",
// "forbidden", "prohibited" and "No <kind> words" read as bans too ("Do
// not describe" or "claim" are topic rules, never word bans).
const BAN_LIKE_WORDS =
  /\b(?:(?:never|do\s+not|don['\u2019]t)\s+(?:write|use|say|include)|avoid|banned|forbidden|prohibited|no\s+[\w-]+\s+words)\b/i;
/** A ban sentence in a lead line that refers to the list below it. */
const LIST_REFERENCE = /\b(?:alternatives?|listed|these|those|them|following|above|below)\b/i;
const FIRST_PERSON_ONLY = /^(?:we|our|ours|us|ourselves|i|me|my|mine)$/i;
// Final re-check P2-A2: any quote mark, and no "with" needed ("should
// begin \"The advancement sought was\"").
const OPENING_LIKE = /\b(?:open|begin|start)\w*\b[^.]*?["\u201c'\u2018]/i;

/**
 * Round 5 follow-up (re-check P1-1 b): whether the settings hold a word ban
 * or an opening instruction the extractor did not read. A ban of
 * first-person pronouns only is no word ban here; its pronouns are returned
 * so the settle step counts it as accounted for only while the text holds
 * none of them (we, our, ours, us, ourselves, and I, me, my, mine when the
 * ban lists them).
 */
export function unreadWritingRules(text: string): { wordBans: boolean; openings: boolean; pronouns?: string[] } {
  const { rules, leads } = extractWriterWordingRulesWithLeads(text);
  const termSources = new Set(rules.terms.map((rule) => rule.source));
  const bannedSources = new Set(rules.banned.map((rule) => rule.source));
  const openingSources = new Set(rules.openings.map((rule) => rule.source));
  const leadSet = new Set(leads);
  let wordBans = false;
  let openings = false;
  const pronouns = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const body = raw.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, "").trim();
    // A banned item is read whole.
    if (!body || bannedSources.has(body)) continue;
    const isLead = leadSet.has(body);
    if (isLead && HEADING.test(body)) continue;
    // Final re-check P3-A3: only the sentence a rule was read from is
    // accounted for; any other ban on the same line still counts.
    let termBanRead = !termSources.has(body);
    for (const part of body.split(/(?<=[.!?])\s+/)) {
      const sentence = part.trim();
      if (!termBanRead && BAN_SENTENCE.test(sentence)) {
        termBanRead = true;
        continue;
      }
      if (openingSources.has(body) && OPENING_CUE.test(sentence)) continue;
      if (isLead && (BAN_LEAD.test(sentence) || (BAN_SENTENCE.test(sentence) && LIST_REFERENCE.test(sentence)))) continue;
      const ban = BAN_SENTENCE.exec(sentence);
      if (ban) {
        const items = ban[1]!.replace(OWN_SUFFIX, "").split(/\s*,\s*(?:or\s+|and\s+)?|\s+or\s+|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
        if (!items.every((item) => FIRST_PERSON_ONLY.test(item))) wordBans = true;
        else for (const item of items) pronouns.add(item.toLowerCase());
      } else if (BAN_LIKE_WORDS.test(sentence)) {
        wordBans = true;
      }
      if (OPENING_LIKE.test(sentence)) openings = true;
    }
  }
  // A first-person ban counts as accounted for only while the text holds
  // none of its pronouns (settleWriterSettingsVerdicts checks).
  return { wordBans, openings, ...(pronouns.size > 0 ? { pronouns: [...pronouns] } : {}) };
}

