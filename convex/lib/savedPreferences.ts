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
