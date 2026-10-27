/**
 * 2026-10-27 (Phase E, E1a; part 5 of the first 2026-10-26 entry): "A
 * preference holds only how the writer likes to write, never facts about a
 * company or project. The server refuses a suggestion that contains a name,
 * placeholder or figure from the project it came from."
 *
 * `checkPreferenceText` is the server's check on every saved preference text:
 * a suggestion, a writer's edit of one, its approval, a written preference
 * and an edit of an approved one. It is pure; the caller gathers the names
 * and, for a suggestion, the masked texts of its whole request. A text that
 * passes still gets the model's style-only check (convex/ai/writerMemory.ts).
 */
import * as houseRules from "../../shared/houseRules";
import * as humanProse from "../../shared/humanProse";
import * as promptDefinitions from "../ai/promptDefinitions";

/** At most this many characters in one preference. */
export const MAX_PREFERENCE_CHARS = 160;

export type PreferenceRefusal =
  | "empty"
  | "too_long"
  | "placeholder"
  | "contact"
  | "number"
  | "code"
  | "capitalized"
  | "quote"
  | "name"
  | "request_capitalized"
  | "request_word"
  | "script";

/** What a refusal says to the writer, in plain words. */
export const PREFERENCE_REFUSAL_WORDS: Record<PreferenceRefusal, string> = {
  empty: "Write the preference first.",
  too_long: `Keep a preference to ${MAX_PREFERENCE_CHARS} characters.`,
  placeholder: "A preference cannot hold a hidden name such as [CLIENT_1].",
  contact: "A preference cannot hold an email, web address or phone number.",
  number: "A preference can hold a number only as part of how to write, such as \"under 25 words\" or \"spells out numbers under ten\", or as a Line number.",
  code: "A preference cannot hold a code or model name.",
  capitalized: "A preference cannot hold a name or a capitalized term. Describe how you like to write instead.",
  quote: "Quote at most three plain words, with no names or numbers.",
  name: "A preference cannot hold the name of a company, project or person.",
  request_capitalized: "This holds a name from the work it came from.",
  request_word: "This holds a term from the work it came from, not a way of writing.",
  script: "Write the preference in English or French.",
};

export type PreferenceCheckContext = {
  /** Names to refuse: companies (current and former), the firm's names, people and companies of the projects involved. */
  names: readonly string[];
  /** For a suggestion: the masked texts of its whole request, each with the company it came from. */
  request?: ReadonlyArray<{ text: string; company: string }>;
};

/** Words a style preference may capitalize after its first word. */
const STYLE_WORDS = new Set([
  "I", "Line", "Lines", "CRA", "SR&ED", "T661", "Seed", "Seeds", "Brief", "Storyline", "Summary",
  "English", "French", "Canadian", "British", "American", "Oxford", "Markdown", "US", "UK", "AI", "ALL", "CAPS",
  // Re-check of 29d88d40: "Uses SI units.", "Writes headings in Title Case."
  "SI", "Title", "Case",
]);
const STYLE_WORDS_LOWER = new Set([...STYLE_WORDS].map((word) => word.toLowerCase()));
/**
 * The number rule (fourth re-check, 2026-10-27): an allowlist, not a list
 * of words to refuse. Every number a preference holds (digits, number words
 * from zero up, ordinals, "twice", "doubled" and the like) must sit inside
 * one of a few complete ways of saying how to write; anything else is a
 * figure and refused. Each number is read as a placeholder in a joined,
 * lowercased text of the sentence:
 * - NUM: a short count (1 to 3 digits, "2-3", or number words such as
 *   "twenty-five" or "one hundred"); DEC: a short decimal ("1.5"); BIG: any
 *   other figure, never allowed;
 * - ORD: an ordinal from "second" to "tenth" ("first" is too common in
 *   plain prose to count); TWICE; MULT: "doubled", "halved" and the like,
 *   never allowed; DOUBLE: "double" or "triple".
 * "one" counts only as a count ("one employee"), not in "no one", "one of"
 * or "each one". A Line number (242, 244, 246 after "Line") is not a
 * figure.
 */
const CARDINAL_WORDS = new Set([
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
  "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty",
  "seventy", "eighty", "ninety", "hundred", "thousand", "million", "billion", "dozen", "half", "halves", "quarter", "quarters",
]);
const ORDINAL_WORDS = new Set(["second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"]);
const MULTIPLIER_WORDS = new Set([
  "doubled", "doubling", "tripled", "tripling", "quadrupled", "halved", "halving", "twofold", "threefold", "fourfold", "tenfold",
]);
/** Words around "one" that make it not a count: "no one", "one of", "each one", "one by one". */
const ONE_BEFORE = new Set(["no", "each", "any", "every", "the", "this", "that", "which"]);
const ONE_AFTER = new Set(["another", "of", "by", "at"]);

/** Units of writing a count may stand before: "under 25 words", "three short paragraphs", "the three Lines". */
const WRITING_UNITS =
  "(?:words?|sentences?|paragraphs?|bullets?|bullet points?|characters?|spaces?|headings?|subheadings?|sections?|subsections?|clauses?|syllables?|ideas?|topics?|claims?|terms?|lists?|columns?|Lines?|quotes?|acronyms?|abbreviations?|commas?|verbs?|adjectives?)";
/**
 * Units that are as often a figure as a length ("printed 40 pages", "prints
 * 40 lines", "20 items", "three levels", "five points"): a count of them is
 * style only with a bound in a sentence led by a way of writing ("Keeps each
 * Line to half a page"), with "per" a unit of writing, or in a fixed
 * construction ("three levels of headings", "a 12 point font").
 */
const LOOSE_UNITS = "(?:pages?|lines?|items?)";
/** What "per" may count by after a unit: "words per sentence", never "lines per minute". */
const PER_TARGETS = `(?:${WRITING_UNITS}|pages?|lines?|Line|tables?)`;
/** Words that may describe a unit after its count: "two or three short plain sentences". */
const DESCRIBING =
  "(?:short|shorter|long|longer|full|plain|simple|separate|single|clear|more|fewer|less|brief|briefer|concise|tight|complete|distinct|main|key|numbered|bulleted|blank|empty)";
/** A count, a range or a choice of counts: "25", "2-3", "20 to 25", "three or four", "40 and 60". */
const COUNT = "NUM(?: (?:to|or|and|through) NUM)*";
const NOT_BAD_PER = `(?! per (?!${PER_TARGETS}\\b))`;
/** Bounds before a count of a loose unit: "to half a page", "under 40 pages", "at most two pages". */
const BOUND = "(?:to|under|below|over|above|within|most|max|maximum|minimum|least|than|maximum of|minimum of|limit of|up to)";
/** Words that lead a sentence about how to write, after any of ADVERBS. */
const STYLE_LEADS = new Set([
  "keeps", "keep", "limits", "limit", "caps", "cap", "holds", "hold", "stays", "stay", "fits", "fit", "restricts", "restrict",
  "trims", "trim", "writes", "write", "uses", "use", "prefers", "prefer", "aims", "aim", "targets", "target", "shortens",
  "shorten", "sets", "set", "cuts", "cut",
  // A sentence that is itself a bound: "At most two pages per Line."
  "at", "no", "under", "up", "below", "within", "over", "more", "fewer", "less", "maximum", "max",
]);
const ADVERBS = new Set(["always", "never", "usually", "often", "generally", "only", "also", "then", "ideally", "preferably"]);
/** Words that lead a sentence reporting what happened: no number in it is a way of writing ("Says the paper had 12 sections"). */
const REPORTING_LEADS = new Set([
  "says", "said", "reports", "reported", "notes", "noted", "states", "stated", "mentions", "mentioned", "records", "recorded",
  "claims", "claimed", "confirms", "confirmed", "finds", "found",
]);
const CLAUSE_START = "(?<=(?:^|, |\\band |\\bbut |\\bthen )(?:(?:always|never|usually|often|generally|only|also) )*)";
/** Verbs that say how numbers are written: "Spells out numbers under ten", "Uses digits for 10 and above". */
const NUMBER_VERBS = "(?:writes?|spells?|spell|uses?|puts?|gives?|expresses?|renders?|keeps?|prefers?|shows?|sets?|formats?)";
const NUMBER_TOPIC = "(?:numbers|digits|numerals|figures)";
/** "under ten", "greater than nine", "one through nine", "10 and above", "10 or more", "from 10 upward". */
const NUMBER_RANGE =
  "(?:(?:under|below|over|above|up to|less than|fewer than|greater than|more than|lower than|higher than|larger than|smaller than) NUM" +
  "|(?:(?:from|between|for|of) )?NUM (?:to|through|and) NUM" +
  "|(?:(?:from|for|of) )?NUM (?:(?:and|or) (?:above|over|up|upward|upwards|more|higher|greater|larger|below|under|less|fewer|lower|smaller)|upward|upwards|onward|onwards))";
const AS_FORM = "(?: (?:in|as) (?:words|digits|numerals|figures|text|letters))?";

/** The complete ways a number may be part of how to write; each match covers the numbers inside it. */
const ALLOWED_NUMBER_USES: readonly RegExp[] = [
  // A length in units of writing.
  new RegExp(`\\b${COUNT}(?: (?:a|an))?(?: ${DESCRIBING}){0,3} ${WRITING_UNITS}\\b${NOT_BAD_PER}`, "g"),
  // A loose unit counted by a unit of writing: "five items per list".
  new RegExp(`\\b${COUNT}(?: (?:a|an))?(?: ${DESCRIBING}){0,3} (?:${LOOSE_UNITS}|levels?|points?) per ${PER_TARGETS}\\b`, "g"),
  // Fixed constructions.
  new RegExp(`\\b${COUNT} (?:levels?|tiers?) of (?:headings?|subheadings?|bullets?|lists?|nesting|indentation)\\b`, "g"),
  new RegExp(`\\b${COUNT} (?:points?|pt) (?:font|fonts|type|text|size)\\b`, "g"),
  new RegExp(`\\b(?:NUM|DEC) (?:line )?(?:spacing|spaced)\\b`, "g"),
  new RegExp(`\\b${COUNT} (?:blank|empty) lines? (?:between|after|before)\\b`, "g"),
  new RegExp(`\\b${COUNT} (?:decimal places?|significant (?:figures?|digits?)|digit (?:years?|dates?))\\b`, "g"),
  new RegExp(`\\bnumbered (?:lists?|steps?|items?|points?|bullets?) (?:that )?(?:starts?|starting|begins?|beginning) (?:at|from|with) NUM\\b`, "g"),
  new RegExp(`\\bDOUBLE (?:quotes?|quotation marks?|spacing|line spacing|spaces?|negatives?|hyphens?)\\b`, "g"),
  new RegExp(`\\bORD person\\b`, "g"),
  new RegExp(`\\bORD(?: ${DESCRIBING}){0,2} ${WRITING_UNITS}\\b`, "g"),
  new RegExp(`\\b(?:TWICE|NUM times) (?:in|per) (?:a|an|NUM|the same|each|every|any) ${WRITING_UNITS}\\b`, "g"),
  // How numbers are written, led by a verb of writing.
  new RegExp(
    `${CLAUSE_START}${NUMBER_VERBS} (?:out )?(?:(?:digits|numerals|figures|words) (?:for|from) (?:(?:all )?(?:the )?numbers )?|(?:all )?(?:the )?${NUMBER_TOPIC} )${NUMBER_RANGE}${AS_FORM}`,
    "g"
  ),
  new RegExp(`${CLAUSE_START}(?:spells?|spell|writes?|write) out ${NUMBER_RANGE}${AS_FORM}`, "g"),
  new RegExp(`^${NUMBER_TOPIC} ${NUMBER_RANGE} (?:are )?(?:(?:spelled|spelt|written) out|in words|as words|as digits|in digits|as numerals)`, "g"),
];
/** A loose unit with a bound, allowed only in a sentence led by a way of writing. */
const BOUNDED_LOOSE_UNIT = new RegExp(
  `\\b${BOUND} ${COUNT}(?: (?:a|an))?(?: ${DESCRIBING}){0,3} ${LOOSE_UNITS}\\b${NOT_BAD_PER}`,
  "g"
);
const LINE_NUMBERS = new Set(["242", "244", "246"]);
const NUMBER_PLACEHOLDER = /\b(?:NUM|DEC|BIG|ORD|TWICE|MULT|DOUBLE)\b/g;

/** One sentence of a preference as the number rule reads it. */
type NumberSentence = { text: string; styleLead: boolean; reportingLead: boolean };

/** Splits a preference into sentences and reads each number as a placeholder. */
function numberSentences(text: string): NumberSentence[] {
  const raw = [...text.matchAll(/\d+(?:[.,]\d+)*(?:\s*-\s*\d+(?:[.,]\d+)*)?|[\p{L}]+(?:['’][\p{L}]+)*|[.!?;:,]/gu)].map(
    (match) => match[0]
  );
  const sentences: string[][] = [[]];
  let lineNumberChain = false;
  raw.forEach((token, index) => {
    if (/^[.!?;:]$/.test(token)) {
      sentences.push([]);
      lineNumberChain = false;
      return;
    }
    const current = sentences[sentences.length - 1]!;
    const previous = (raw[index - 1] ?? "").toLowerCase();
    const next = (raw[index + 1] ?? "").toLowerCase();
    if (/^\d/.test(token)) {
      if (LINE_NUMBERS.has(token) && (/^lines?$/.test(previous) || (lineNumberChain && /^(?:and|or|to|,)$/.test(previous)))) {
        current.push("LINENO");
        lineNumberChain = true;
        return;
      }
      current.push(/^\d{1,3}(?:\s*-\s*\d{1,3})?$/.test(token) ? "NUM" : /^\d{1,2}\.\d{1,2}$/.test(token) ? "DEC" : "BIG");
      return;
    }
    if (token !== "," && !/^(?:and|or|to)$/i.test(token)) lineNumberChain = false;
    if (token === ",") {
      current.push(",");
      return;
    }
    const word = token.toLowerCase();
    let placeholder: string | null = null;
    if (word === "one") placeholder = ONE_BEFORE.has(previous) || ONE_AFTER.has(next) ? null : "NUM";
    else if (CARDINAL_WORDS.has(word)) placeholder = "NUM";
    else if (ORDINAL_WORDS.has(word)) placeholder = "ORD";
    else if (word === "twice") placeholder = "TWICE";
    else if (MULTIPLIER_WORDS.has(word)) placeholder = "MULT";
    else if (word === "double" || word === "triple") placeholder = "DOUBLE";
    if (placeholder === "NUM" && current[current.length - 1] === "NUM" && /^[\p{L}]/u.test(raw[index - 1] ?? "")) return; // "twenty-five", "one hundred"
    current.push(placeholder ?? (token === "Line" || token === "Lines" ? token : word));
  });
  return sentences
    .filter((tokens) => tokens.length > 0)
    .map((tokens) => {
      const lead = tokens.find((token) => !ADVERBS.has(token)) ?? "";
      return { text: tokens.join(" ").replace(/ ,/g, ","), styleLead: STYLE_LEADS.has(lead), reportingLead: REPORTING_LEADS.has(lead) };
    });
}

/** Whether every number in a preference is part of how to write. */
function numbersAreStyle(text: string): boolean {
  for (const sentence of numberSentences(text)) {
    const slots = [...sentence.text.matchAll(NUMBER_PLACEHOLDER)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
    if (slots.length === 0) continue;
    if (sentence.reportingLead) return false;
    const covered = new Set<number>();
    const patterns = sentence.styleLead ? [...ALLOWED_NUMBER_USES, BOUNDED_LOOSE_UNIT] : ALLOWED_NUMBER_USES;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(sentence.text); match; match = pattern.exec(sentence.text)) {
        const end = match.index + match[0].length;
        slots.forEach((slot, index) => {
          if (slot.start >= match!.index && slot.end <= end) covered.add(index);
        });
        // Overlapping uses of one pattern each get their turn.
        pattern.lastIndex = match.index + 1;
      }
    }
    if (covered.size < slots.length) return false;
  }
  return true;
}

/** Letters of scripts with no capitals, which the name rules cannot read. */
const UNCASED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;
/** Common words a preference uses that the app's own text may not. */
const PLAIN_WORDS = [
  "prefers", "prefer", "rather", "instead", "always", "never", "writes", "write", "keeps", "keep", "starts", "start",
  "begins", "begin", "opens", "open", "closes", "close", "short", "shorter", "long", "longer", "plain", "simple",
  "active", "passive", "voice", "tense", "present", "past", "first", "person", "third", "company", "team", "client",
  "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets", "heading", "headings", "words", "uses",
  "avoid", "avoids", "spell", "spelling", "comma", "commas", "colon", "colons", "dashes", "hyphen", "numbers",
  "figures", "metric", "metrics", "result", "results", "method", "methods", "lead", "leads", "names", "naming",
];

function tokens(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}][\p{L}'-]*/gu) ?? [];
}

function stringsOf(value: unknown, into: string[]): void {
  if (typeof value === "string") into.push(value);
  else if (Array.isArray(value)) for (const item of value) stringsOf(item, into);
  else if (value && typeof value === "object") for (const item of Object.values(value)) stringsOf(item, into);
}

let vocabulary: Set<string> | null = null;
/** The app's own words: its House Rules, plain-language rules and prompt text, and common style words. */
export function appVocabulary(): ReadonlySet<string> {
  if (vocabulary) return vocabulary;
  const texts: string[] = [];
  stringsOf(houseRules, texts);
  stringsOf(humanProse, texts);
  stringsOf(promptDefinitions, texts);
  vocabulary = new Set([...texts.flatMap(tokens), ...PLAIN_WORDS]);
  return vocabulary;
}

/** Where each sentence starts: the text's start and after . ! ? : or a line break. */
function sentenceStarts(text: string): Set<number> {
  const starts = new Set<number>([0]);
  for (const match of text.matchAll(/(?:[.!?:]\s+|\n\s*|^[-*]\s+|["'“‘]\s*)/gmu)) starts.add(match.index + match[0].length);
  return starts;
}

/** Words a text capitalizes in the middle of a sentence, and words it writes in lowercase. */
function capitalization(text: string): { midCapital: Set<string>; lower: Set<string> } {
  const starts = sentenceStarts(text);
  const midCapital = new Set<string>();
  const lower = new Set<string>();
  for (const match of text.matchAll(/[\p{L}][\p{L}'&-]*/gu)) {
    const word = match[0];
    if (word === word.toLowerCase()) lower.add(word);
    else if (!starts.has(match.index)) midCapital.add(word.toLowerCase());
  }
  return { midCapital, lower };
}

function containsWhole(haystack: string, needle: string): boolean {
  const escaped = needle.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (escaped.length < 3) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").test(haystack);
}

/**
 * Refuses a preference text that is not only about how to write. The first
 * reason found is returned; `ok` means every rule passed.
 */
export function checkPreferenceText(
  input: string,
  context: PreferenceCheckContext
): { ok: true } | { ok: false; reason: PreferenceRefusal } {
  const text = input.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_PREFERENCE_CHARS) return { ok: false, reason: "too_long" };
  if (/\[[A-Z][A-Z_]*_\d+\]|\b[A-Z][A-Z]+_\d+\b/.test(text)) return { ok: false, reason: "placeholder" };
  if (/\S+@\S+\.\S+|https?:\/\/|\bwww\./i.test(text) || /\+?\d[\d\s().-]{6,}\d/.test(text)) {
    return { ok: false, reason: "contact" };
  }
  if (UNCASED_SCRIPT.test(text)) return { ok: false, reason: "script" };
  // The form's own name is a style word, never a figure or a code.
  const plain = text.replace(/\bT661\b/g, "form");
  // A letter-and-number code ("XR-200", "OS1").
  if (/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}-]*\p{L})(?=[\p{L}\p{N}-]*\p{N})[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/u.test(plain)) {
    return { ok: false, reason: "code" };
  }
  // A number only as part of how to write ("under 25 words", "spells out
  // numbers under ten", "two decimal places") or a Line number.
  if (!numbersAreStyle(plain)) return { ok: false, reason: "number" };
  const vocabulary = appVocabulary();
  for (const quote of text.matchAll(/["\u201c]([^"\u201d]*)["\u201d]|(?<![\p{L}])['\u2018]([^'\u2019]*)['\u2019](?![\p{L}])/gu)) {
    const inner = (quote[1] ?? quote[2] ?? "").trim();
    const words = inner.split(/\s+/).filter(Boolean);
    if (words.length > 3 || /\p{N}/u.test(inner)) return { ok: false, reason: "quote" };
    // A capital only in a style word ("I", "CRA"), or a quoted word of the
    // app's own vocabulary ("'The'").
    const capitalsOk = words.every(
      (word) =>
        word === word.toLowerCase() ||
        STYLE_WORDS.has(word) ||
        (vocabulary.has(word.toLowerCase()) && word.slice(1) === word.slice(1).toLowerCase())
    );
    if (!capitalsOk) return { ok: false, reason: "quote" };
  }
  const starts = sentenceStarts(plain);
  for (const match of plain.matchAll(/[\p{L}][\p{L}'&-]*/gu)) {
    const word = match[0].replace(/['\u2019]s$/u, "");
    if (word !== word.toLowerCase() && !starts.has(match.index) && !STYLE_WORDS.has(word)) {
      return { ok: false, reason: "capitalized" };
    }
  }
  for (const name of context.names) if (containsWhole(text, name)) return { ok: false, reason: "name" };
  if (context.request && context.request.length > 0) {
    const words = new Set(tokens(text));
    const seen = context.request.map((entry) => ({ ...capitalization(entry.text), company: entry.company, words: new Set(tokens(entry.text)) }));
    const midCapital = new Set(seen.flatMap((entry) => [...entry.midCapital]));
    const lower = new Set(seen.flatMap((entry) => [...entry.lower]));
    for (const word of words) {
      if (STYLE_WORDS_LOWER.has(word)) continue;
      if (midCapital.has(word) && !lower.has(word)) return { ok: false, reason: "request_capitalized" };
    }
    for (const word of words) {
      if (word.length < 5 || vocabulary.has(word)) continue;
      const companies = new Set(seen.filter((entry) => entry.words.has(word)).map((entry) => entry.company));
      if (companies.size > 0 && companies.size < 3) return { ok: false, reason: "request_word" };
    }
  }
  return { ok: true };
}

/** A text's key: folded, so the same preference written twice matches. */
export function preferenceTextKey(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
