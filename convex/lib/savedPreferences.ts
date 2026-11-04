import * as houseRules from "../../shared/houseRules";
import * as humanProse from "../../shared/humanProse";
import { BANNED_SCAN_TERMS } from "../../shared/bannedWords";
import { appVocabulary } from "./preferenceCheck";
import { holdsPhrase, SAVED_PREFERENCE_ROW_INSTRUCTION, wordingPattern } from "./writerWording";

/**
 * 2026-10-27 (Phase E, E1b): a writer's approved and on saved preferences
 * (convex/writerMemory.ts) join their Writer Profile text wherever the
 * profile applies, after it, so every reader of the writer's style (drafting
 * guidance, first-person detection, wording rules, the Self-check's verdicts
 * on the writer's settings, QA's writer instructions, chat) reads both. The
 * stored profile text is never changed, so matching a settings document
 * against it is unchanged. With no saved preference the text is unchanged,
 * byte for byte.
 */
export const SAVED_PREFERENCES_HEADING = "Saved preferences:";

/** Whether a composed style holds a saved preferences block (a line that is the heading). */
export function holdsSavedBlock(composed: string): boolean {
  return composed.split(/\r?\n/).some((line) => line.trim() === SAVED_PREFERENCES_HEADING);
}

export function composeWithSavedPreferences(profileText: string, saved: readonly string[]): string {
  const lines = saved.map((text) => text.trim()).filter(Boolean);
  if (lines.length === 0) return profileText;
  const block = `${SAVED_PREFERENCES_HEADING}\n${lines.map((text) => `- ${text}`).join("\n")}`;
  return profileText ? `${profileText}\n\n${block}` : block;
}

/** "1 saved preference used." / "3 saved preferences used." */
export function savedPreferencesLine(count: number): string | null {
  if (count <= 0) return null;
  return count === 1 ? "1 saved preference used." : `${count} saved preferences used.`;
}

const folded = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What a Compliance Note row about a saved preference says instead of its text. */
export const SAVED_PREFERENCE_NOTE = {
  instruction: SAVED_PREFERENCE_ROW_INSTRUCTION,
  reason: "Checked against one of the writer's saved preferences, which only that writer can see.",
} as const;

/** Every run of `size` words in order (the whole text when it is shorter). */
function wordRuns(words: readonly string[], size: number): string[] {
  if (words.length <= size) return [words.join(" ")];
  const runs: string[] = [];
  for (let start = 0; start + size <= words.length; start += 1) runs.push(words.slice(start, start + size).join(" "));
  return runs;
}

/** Words a run must hold more than, to count as quoting anything. */
const COMMON_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "by", "as", "is", "are", "be", "it", "its",
  "that", "this", "than", "then", "we", "our", "each", "every", "no", "not", "one", "all",
]);
const allCommon = (run: string) => run.split(" ").every((word) => COMMON_WORDS.has(word));
/** Words too plain to give a saved rule away when quoted on their own. */
const FUNCTION_WORDS = new Set([...COMMON_WORDS, "us", "i", "my", "me", "was", "were", "has", "have", "had", "will", "would", "can", "so", "but", "if", "from", "into", "these", "those", "there"]);

let houseRuleTermList: string[] | null = null;
/** The House Rules' banned terms, folded: public rule wording. */
function houseRuleTerms(): string[] {
  houseRuleTermList ??= BANNED_SCAN_TERMS.map(folded).filter(Boolean);
  return houseRuleTermList;
}

let houseRuleLines: string[] | null = null;
/** The House Rules' and plain-language rules' own lines, folded. */
function houseRuleText(): string[] {
  if (houseRuleLines) return houseRuleLines;
  const texts: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") texts.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(houseRules);
  collect(humanProse);
  houseRuleLines = texts.flatMap((text) => text.split(/\r?\n|(?<=[.!?:])\s+/)).map((line) => ` ${folded(line)} `);
  return houseRuleLines;
}

/** Whether a model row's instruction is House Rule text: at least three words of one of their lines, in order. */
function isHouseRuleText(instruction: string): boolean {
  const text = folded(instruction);
  if (text.split(" ").length < 3) return false;
  return houseRuleText().some((line) => line.includes(` ${text} `));
}

/** Whether a quote of two or more words is House Rule wording ("active voice"), which no saved preference makes private. */
function inHouseRules(span: string): boolean {
  return span.includes(" ") && houseRuleText().some((line) => line.includes(` ${span} `));
}

/**
 * The texts a field puts in quotes: double quotes, or single quotes. A
 * single-quoted word ('Concise.') counts only as a whole saved preference,
 * since single quotes also mark apostrophes and plain words.
 */
function quotedSpans(field: string): Array<{ text: string; wholeOnly: boolean }> {
  const spans: Array<{ text: string; wholeOnly: boolean }> = [];
  for (const match of field.matchAll(/["“]([^"“”]+)["”]/gu)) spans.push({ text: folded(match[1]!), wholeOnly: false });
  for (const match of field.matchAll(/(?<![\p{L}\p{N}])['‘]([^'‘’]+?)['’](?![\p{L}\p{N}])/gu)) {
    spans.push({ text: folded(match[1]!), wholeOnly: !/\S\s+\S/.test(match[1]!) });
  }
  return spans.filter((span) => span.text !== "");
}

/**
 * E1b review and re-checks: a Compliance Note row that quotes a saved
 * preference names it only as a saved preference, since people other than
 * the writer can read the notes. Only rows the Self-check model wrote are
 * read here. Code reads saved preferences too: a wording rule read from one
 * (a banned word, a required term or opening) is read from that preference
 * on its own and marked (settingsExtraction.writerWordingRulesFor), and its
 * rows carry the saved-preference label from the start (selfCheckRules.ts,
 * writerWording.ts). Every other row code writes comes from fixed labels,
 * the House Rules and the Writer Profile's or settings document's own rules
 * (fifth and sixth re-checks).
 * - A quote, in the instruction or the reason: the whole preference
 *   (one word in single quotes too: 'Concise.'), even in House Rule words,
 *   a quote holding it, or two or more of its words in a row that are not
 *   all common words ("under 25 words"). A part that is public is not a
 *   quote of it: a Writer Profile rule the preference repeats ("velvet
 *   fog"), a House Rule banned term, or, in a row explaining a House Rule
 *   (its instruction is House Rule text), House Rule wording ("active
 *   voice").
 * - A quote holding a saved wording rule's phrase, or any word of it that is
 *   not a function word ('the word "sought"'), unless public rules use it
 *   (eighth and ninth re-checks).
 * - The whole preference in either field; a preference of one or two words
 *   only when it is the whole field.
 * - Part of it, unquoted: five of its words in a row, or four when one of
 *   them is a number or a word the app's own rules and prompts never use
 *   (the writer's own wording), unless they are all common words.
 * An instruction that is House Rule text ("Write in dense, formal
 * paragraphs") is the House Rule's, so only the reason is read then.
 * A paraphrase ("asked us to avoid jargon"), or a saved word not in quotes,
 * is not recognized: a known limit. Tenth re-check: in an older draft (a
 * saved block in its style, no texts beside it) every model row is hidden.
 */
export function withoutSavedPreferenceText<T extends { instruction: string; reason: string; source?: string }>(
  note: T,
  /** Whole saved preferences, as frozen beside the style. */
  saved: readonly string[],
  extra: {
    /** Eighth re-check: the words of the wording rules read from saved preferences. */
    wording?: readonly string[];
    /** Ninth re-check: the words of the Writer Profile's own wording rules, which are public. */
    publicWording?: readonly string[];
    /** Tenth re-check: an older draft (a saved block, no texts beside it): every model row is hidden. */
    hideModelRows?: true;
  } = {}
): T {
  if (note.source !== "model") return note;
  const hidden = { ...note, ...SAVED_PREFERENCE_NOTE };
  if (extra.hideModelRows) return hidden;
  const wording = extra.wording ?? [];
  if (saved.length === 0 && wording.length === 0) return note;
  const houseRuleRow = isHouseRuleText(note.instruction);
  const raw = houseRuleRow ? [note.reason] : [note.instruction, note.reason];
  const fields = raw.map(folded);
  const spans = raw.flatMap(quotedSpans);
  const publicTerms = [...(extra.publicWording ?? []).map(folded).filter(Boolean), ...houseRuleTerms()];
  // Whether any of these texts holds the phrase, in any form the wording
  // checker reads ("velvet fog" in "velvet fogs", "bauble" in "baubles").
  const heldBy = (texts: readonly string[], phrase: string) => {
    const pattern = wordingPattern(phrase);
    return texts.some((text) => {
      pattern.lastIndex = 0;
      return pattern.test(text);
    });
  };
  // Public: part of a Writer Profile rule or of a House Rule banned term,
  // in any form (eleventh re-check).
  const publicTerm = (span: string) => heldBy(publicTerms, span);
  // Public wording: a public term, or words the House Rules or
  // plain-language rules use.
  const publicWords = (phrase: string) => publicTerm(phrase) || heldBy(houseRuleText(), phrase);

  // Eighth to tenth re-checks: a quote holding a saved rule's phrase, or any
  // word of it that is not a function word ('the word "sought"'), in any form
  // the wording checker reads ('bans "baubles"' for a ban on "bauble"),
  // unless the public rules use it too.
  const privateTerms = wording.map(folded).filter((term) => term !== "" && !publicWords(term));
  const privateWords = [
    ...new Set(privateTerms.flatMap((term) => term.split(" ")).filter((word) => !FUNCTION_WORDS.has(word) && !publicWords(word))),
  ];
  if (spans.some(({ text: span }) => [...privateTerms, ...privateWords].some((phrase) => holdsPhrase(span, phrase)))) {
    return hidden;
  }

  const joined = ` ${fields.join(" | ")} `;
  const vocabulary = appVocabulary();
  const ownWording = (run: string) => run.split(" ").some((word) => /\p{N}/u.test(word) || !vocabulary.has(word));
  // Eleventh re-check: a run the public rules hold is theirs ("veiled amber
  // lattice coats" when the Writer Profile bans it too).
  const unquotedRun = (words: readonly string[]) => {
    const quotesRun = (run: string) => !allCommon(run) && joined.includes(` ${run} `) && !publicWords(run);
    return wordRuns(words, 5).some(quotesRun) || wordRuns(words, 4).some((run) => ownWording(run) && quotesRun(run));
  };
  // A part of a preference quoted: two or more of its words in a row, not
  // all common words, and not public (a Writer Profile rule the saved
  // preference repeats, a House Rule term, or House Rule wording in a row
  // explaining a House Rule).
  const quotesPart = (preference: string, span: string) =>
    span.split(" ").length >= 2 &&
    !allCommon(span) &&
    ` ${preference} `.includes(` ${span} `) &&
    !publicTerm(span) &&
    !(houseRuleRow && inHouseRules(span));
  const quotes = saved.some((text) => {
    const preference = folded(text);
    const words = preference.split(" ").filter(Boolean);
    if (words.length === 0) return false;
    // A quote of the whole preference always counts, House Rule words or
    // not ('The writer requested "Active voice."').
    const quoted = spans.some(({ text: span, wholeOnly }) =>
      span === preference || (!wholeOnly && ` ${span} `.includes(` ${preference} `)) || (!wholeOnly && quotesPart(preference, span))
    );
    if (quoted) return true;
    if (words.length < 3) return fields.includes(preference);
    if (joined.includes(` ${preference} `)) return true;
    return unquotedRun(words);
  });
  return quotes ? hidden : note;
}
