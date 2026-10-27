import * as houseRules from "../../shared/houseRules";
import * as humanProse from "../../shared/humanProse";
import { appVocabulary } from "./preferenceCheck";
import { SAVED_PREFERENCE_ROW_INSTRUCTION } from "./writerWording";

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

/**
 * What a style frozen before the saved preference texts were kept beside it
 * holds of them, for privacy matching only (E1b review; seventh re-check).
 * Read from the first heading at the start of a line, so a heading inside a
 * saved preference cannot hide the ones before it. Where one preference
 * ends cannot be told for certain, so this returns each bulleted item with
 * the lines that follow it, and the whole block as well: a line without a
 * bullet ("Prefer crisp verbs ...") is never dropped. A profile that writes
 * the same heading itself only hides more.
 */
export function savedPreferencesIn(styleText: string | undefined): string[] {
  if (!styleText) return [];
  const heading = new RegExp(`(?:^|\n)${SAVED_PREFERENCES_HEADING}\n`).exec(styleText);
  if (!heading) return [];
  const lines = styleText.slice(heading.index + heading[0].length).split("\n");
  const items: string[] = [];
  for (const line of lines) {
    if (line.startsWith("- ")) items.push(line.slice(2).trim());
    else if (items.length > 0 && line.trim()) items[items.length - 1] = `${items[items.length - 1]}\n${line.trim()}`;
  }
  const whole = lines
    .map((line) => (line.startsWith("- ") ? line.slice(2) : line).trim())
    .filter(Boolean)
    .join("\n");
  const found = items.filter(Boolean);
  return whole && !found.includes(whole) ? [...found, whole] : found;
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
 *   all common words ("under 25 words"). Only in a row explaining a House
 *   Rule (its instruction is House Rule text) is a part of a preference
 *   that is House Rule wording ("active voice") not a quote of it.
 * - The whole preference in either field; a preference of one or two words
 *   only when it is the whole field.
 * - Part of it, unquoted: five of its words in a row, or four when one of
 *   them is a number or a word the app's own rules and prompts never use
 *   (the writer's own wording), unless they are all common words.
 * An instruction that is House Rule text ("Write in dense, formal
 * paragraphs") is the House Rule's, so only the reason is read then.
 * A paraphrase ("asked us to avoid jargon") is not recognized: a known limit.
 */
export function withoutSavedPreferenceText<T extends { instruction: string; reason: string; source?: string }>(
  note: T,
  saved: readonly string[]
): T {
  if (saved.length === 0 || note.source !== "model") return note;
  const houseRuleRow = isHouseRuleText(note.instruction);
  const raw = houseRuleRow ? [note.reason] : [note.instruction, note.reason];
  const fields = raw.map(folded);
  const spans = raw.flatMap(quotedSpans);
  const joined = ` ${fields.join(" | ")} `;
  const vocabulary = appVocabulary();
  const ownWording = (run: string) => run.split(" ").some((word) => /\p{N}/u.test(word) || !vocabulary.has(word));
  const quotes = saved.some((text) => {
    const preference = folded(text);
    const words = preference.split(" ").filter(Boolean);
    if (words.length === 0) return false;
    // A quote of the whole preference always counts, House Rule words or
    // not ('The writer requested "Active voice."'). Part of it counts unless
    // the row explains a House Rule and the part is that rule's wording.
    const quoted = spans.some(({ text: span, wholeOnly }) => {
      if (span === preference || (!wholeOnly && ` ${span} `.includes(` ${preference} `))) return true;
      if (wholeOnly || span.split(" ").length < 2 || allCommon(span) || !` ${preference} `.includes(` ${span} `)) return false;
      return !(houseRuleRow && inHouseRules(span));
    });
    if (quoted) return true;
    if (words.length < 3) return fields.includes(preference);
    if (joined.includes(` ${preference} `)) return true;
    const quotesRun = (run: string) => !allCommon(run) && joined.includes(` ${run} `);
    return wordRuns(words, 5).some(quotesRun) || wordRuns(words, 4).some((run) => ownWording(run) && quotesRun(run));
  });
  return quotes ? { ...note, ...SAVED_PREFERENCE_NOTE } : note;
}
