import {
  CHAT_BULK_OVERRIDE_SENTENCE,
  CHAT_COMPARE_OVERRIDE_CLAUSE,
  CHAT_RULES_DEFAULT_LINE,
  CHAT_RULE_OVERRIDE_RULES,
} from "./ai/prompts";

/**
 * 2026-11-02 (client meeting, rule overrides): the bytes this change moved in
 * the Assistant's system text. Pinned hashes were captured before it, so a
 * pinned test takes the new texts out and puts the old ones back, as
 * convex/oneUncertainty.fixture.ts and convex/honestDrafting.fixture.ts do,
 * and every other byte is still compared. Each text must be there exactly
 * once, so a later change that drops or repeats one fails here, not silently.
 */
const SWAPS: ReadonlyArray<readonly [now: string, before: string]> = [
  [
    CHAT_RULES_DEFAULT_LINE,
    'Even if the writer says "this is terrible, redo the whole thing" or asks for a casual tone, the report MUST still obey the SR&ED writing standard. Apply these on every edit you propose:',
  ],
  [`\n\n${CHAT_RULE_OVERRIDE_RULES}\n`, "\n"],
  [CHAT_BULK_OVERRIDE_SENTENCE, ""],
  [CHAT_COMPARE_OVERRIDE_CLAUSE, ", never applied."],
];

/** The Assistant's system text as it was before rule overrides. */
export function withoutRuleOverrideText(text: string): string {
  return SWAPS.reduce((out, [now, before]) => {
    const count = out.split(now).length - 1;
    if (count !== 1) {
      throw new Error(`The chat system text holds a rule override text ${count} times, not once: ${now.slice(0, 60)}`);
    }
    return out.replace(now, () => before);
  }, text);
}
