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
  number: "A preference can hold a number only as a length, such as \"under 25 words\", or a Line number.",
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
/** Units a number may stand before. */
const STYLE_UNITS = new Set([
  "word", "words", "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets", "line", "lines",
  "character", "characters", "page", "pages", "item", "items", "space", "spaces", "column", "columns", "level", "levels",
  "point", "points",
]);
/** What "per" may count by after a unit: "words per sentence", never "lines per minute". */
const PER_TARGETS = new Set([
  ...STYLE_UNITS, "section", "sections", "heading", "headings", "idea", "ideas", "list", "lists", "subsection", "subsections",
]);
/** Words that may sit between a number and its unit: "20 to 25 words", "three short paragraphs", "half a page". */
const LENGTH_FILLERS = new Set([
  "to", "or", "and", "a", "an", "in", "short", "shorter", "long", "longer", "full", "plain", "simple", "separate", "single",
  "clear", "more", "fewer", "less",
]);
/** Words that make a number a matter of how numbers are written: "Spells out numbers under ten." */
const NUMBER_TOPIC = new Set(["number", "numbers", "digit", "digits", "numeral", "numerals"]);
/**
 * Spelled-out numbers, ordinals and fractions (review, re-check); "one" and
 * "first" are too common in plain prose to refuse.
 */
const NUMBER_WORDS = new Set([
  "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen",
  "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety", "hundred", "thousand", "million", "billion", "dozen", "twice",
  "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "half", "halves", "quarter", "quarters",
]);
/** Ordinals that name a grammatical person: "third person", "second person". */
const PERSON_ORDINALS = new Set(["second", "third"]);

/**
 * Whether a number is a length: a style unit within the next few words, with
 * only other numbers and plain fillers between ("20 to 25 words", "three or
 * four sentences"), and a "per" after the unit only by a part of the text.
 */
function lengthFollows(after: string): boolean {
  const words = after.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(0, 6) ?? [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (STYLE_UNITS.has(word)) return words[index + 1] !== "per" || PER_TARGETS.has(words[index + 2] ?? "");
    if (LENGTH_FILLERS.has(word) || /^\d{1,3}$/.test(word) || NUMBER_WORDS.has(word)) continue;
    return false;
  }
  return false;
}

/** Whether a number is about how numbers are written ("numbers under ten"). */
function aboutNumbers(before: string): boolean {
  const words = before.toLowerCase().match(/[\p{L}\p{N}]+/gu)?.slice(-4) ?? [];
  return words.some((word) => NUMBER_TOPIC.has(word));
}
/** Letters of scripts with no capitals, which the name rules cannot read. */
const UNCASED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}]/u;
const LINE_NUMBERS = new Set(["242", "244", "246"]);
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
  // A number only as a short length ("under 25 words", "2-3 sentences") or a Line number.
  for (const match of plain.matchAll(/\d+(?:[.,]\d+)*(?:\s*-\s*\d+)?/g)) {
    const before = plain.slice(0, match.index);
    const after = plain.slice(match.index + match[0].length);
    const lineNumber = /\bLines?\s*$/i.test(before) && LINE_NUMBERS.has(match[0]);
    const short = /^\d{1,3}(?:\s*-\s*\d{1,3})?$/.test(match[0]);
    if (!lineNumber && !(short && (lengthFollows(after) || aboutNumbers(before)))) return { ok: false, reason: "number" };
  }
  for (const match of plain.matchAll(/[\p{L}]+/gu)) {
    const word = match[0].toLowerCase();
    if (!NUMBER_WORDS.has(word)) continue;
    const before = plain.slice(0, match.index);
    const after = plain.slice(match.index + match[0].length);
    const person = PERSON_ORDINALS.has(word) && /^\s+person\b/i.test(after);
    if (!person && !lengthFollows(after) && !aboutNumbers(before)) return { ok: false, reason: "number" };
  }
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
