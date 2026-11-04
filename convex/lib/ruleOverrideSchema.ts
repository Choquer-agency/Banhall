import { z } from "zod";
import {
  BROKEN_RULE_KINDS,
  MAX_BROKEN_RULES,
  describeBrokenRules,
  rulesNeedManager,
  type BrokenRule,
} from "../../shared/ruleOverride";

/**
 * 2026-11-02 (client meeting, rule overrides): the edit tools' `breaksRules`
 * input. The model fills it only when the writer explicitly asked for a change
 * that goes against a house rule, the template, a banned word or a CRA limit;
 * the card then waits for a confirmation (`shared/ruleOverride.ts`).
 */
export const breaksRulesSchema = z
  .array(
    z.object({
      kind: z
        .enum(BROKEN_RULE_KINDS)
        .describe(
          "template for the Line structure, paragraph order, a required opening clause, or paragraph length and sentence count; banned_words for a word or phrase on the banned list the writer asked for and approved (name the word); house_rule for any other house rule or writing preference area (voice, sentence length, repetition); cra_limit for a Line's form line or word cap."
        ),
      name: z
        .string()
        .min(1)
        .describe('The rule\'s name as the writer knows it, a few words, for example "First person" or "Line 244 word cap".'),
      reason: z.string().min(1).describe("One short sentence: how this change goes against the rule."),
    })
  )
  .max(MAX_BROKEN_RULES)
  .optional()
  .describe(
    "ONLY when the writer explicitly asked for this change although it goes against a house rule, the template or a CRA limit: every rule it goes against. Leave it out otherwise. Never use it for a made-up fact."
  );

/** The sentence a tool result adds for a card that goes against rules. */
export function brokenRulesToolNote(rules: ReadonlyArray<BrokenRule> | undefined): string {
  if (!rules?.length) return "";
  const who = rulesNeedManager(rules) ? "a manager" : "the writer";
  return ` ${describeBrokenRules(rules)} The card asks ${who} to confirm before it is applied. Say in one sentence which rule the change goes against.`;
}
