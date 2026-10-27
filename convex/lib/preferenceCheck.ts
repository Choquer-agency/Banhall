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
  | "request_word";

/** What a refusal says to the writer, in plain words. */
export const PREFERENCE_REFUSAL_WORDS: Record<PreferenceRefusal, string> = {
  empty: "Write the preference first.",
  too_long: `Keep a preference to ${MAX_PREFERENCE_CHARS} characters.`,
  placeholder: "A preference cannot hold a hidden name such as [CLIENT_1].",
  contact: "A preference cannot hold an email, web address or phone number.",
  number: "A preference can hold a number only as a length, such as \"under 25 words\".",
  code: "A preference cannot hold a code or model name.",
  capitalized: "A preference cannot hold a name. Describe how you like to write instead.",
  quote: "Quote at most three plain words, with no names or numbers.",
  name: "A preference cannot hold the name of a company, project or person.",
  request_capitalized: "This holds a name from the work it came from.",
  request_word: "This holds a term from the work it came from, not a way of writing.",
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
  "English", "French", "Canadian", "British", "American", "Oxford", "Markdown",
]);
/** Units a number may stand before. */
const STYLE_UNITS = /^\s*(?:words?|sentences?|paragraphs?|bullets?|lines?|characters?|pages?|items?)\b/i;
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
  // A letter-and-number code ("XR-200", "OS1").
  if (/(?<![\p{L}\p{N}])(?=[\p{L}\p{N}-]*\p{L})(?=[\p{L}\p{N}-]*\p{N})[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/u.test(text.replace(/\bT661\b/g, ""))) {
    return { ok: false, reason: "code" };
  }
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    const lineNumber = /\bLines?\s*$/i.test(before) && LINE_NUMBERS.has(match[0]);
    if (!lineNumber && !STYLE_UNITS.test(after)) return { ok: false, reason: "number" };
  }
  for (const quote of text.matchAll(/["“]([^"”]*)["”]|(?<![\p{L}])['‘]([^'’]*)['’](?![\p{L}])/gu)) {
    const inner = (quote[1] ?? quote[2] ?? "").trim();
    if (inner.split(/\s+/).filter(Boolean).length > 3 || /[\p{Lu}\p{N}]/u.test(inner)) return { ok: false, reason: "quote" };
  }
  const starts = sentenceStarts(text);
  for (const match of text.matchAll(/[\p{L}][\p{L}'&-]*/gu)) {
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
      if (midCapital.has(word) && !lower.has(word)) return { ok: false, reason: "request_capitalized" };
    }
    const vocabularyWords = appVocabulary();
    for (const word of words) {
      if (word.length < 5 || vocabularyWords.has(word)) continue;
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
