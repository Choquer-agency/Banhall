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
 * The saved preferences a frozen style text holds, read back from the block
 * `composeWithSavedPreferences` wrote (E1b review). A profile that writes
 * the same heading itself is read the same way, which only hides more.
 */
export function savedPreferencesIn(styleText: string | undefined): string[] {
  if (!styleText) return [];
  const at = styleText.lastIndexOf(`${SAVED_PREFERENCES_HEADING}\n`);
  if (at < 0) return [];
  return styleText
    .slice(at + SAVED_PREFERENCES_HEADING.length + 1)
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

const folded = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** What a Compliance Note row about a saved preference says instead of its text. */
export const SAVED_PREFERENCE_NOTE = {
  instruction: "Saved preference",
  reason: "Checked against one of the writer's saved preferences, which only that writer can see.",
} as const;

/** Every run of `size` words in order (the whole text when it is shorter). */
function wordRuns(words: readonly string[], size: number): string[] {
  if (words.length <= size) return [words.join(" ")];
  const runs: string[] = [];
  for (let start = 0; start + size <= words.length; start += 1) runs.push(words.slice(start, start + size).join(" "));
  return runs;
}

/** Shortest run of a preference's words that counts as quoting it. */
const QUOTED_RUN_WORDS = 3;

/**
 * E1b review and re-check: a Compliance Note row that quotes a saved
 * preference, in its instruction or its reason, names it only as a saved
 * preference, since people other than the writer can read the notes. Any
 * three of its words in a row count as a quote ("sentences under 25 words"),
 * so a row may be hidden that only shares three words with one; that errs on
 * the private side. Other rows are unchanged.
 */
export function withoutSavedPreferenceText<T extends { instruction: string; reason: string }>(
  note: T,
  saved: readonly string[]
): T {
  if (saved.length === 0) return note;
  const fields = ` ${folded(note.instruction)} | ${folded(note.reason)} `;
  const quotes = saved.some((text) => {
    const words = folded(text).split(" ").filter(Boolean);
    if (words.length === 0) return false;
    return wordRuns(words, QUOTED_RUN_WORDS).some((run) => fields.includes(` ${run} `));
  });
  return quotes ? { ...note, ...SAVED_PREFERENCE_NOTE } : note;
}
