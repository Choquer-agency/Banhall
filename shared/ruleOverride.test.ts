import { describe, expect, it } from "vitest";
import {
  MAX_BROKEN_RULES,
  RULE_OVERRIDE_CONFIRM_MESSAGE,
  RULE_OVERRIDE_MANAGER_ONLY,
  RULE_OVERRIDE_NOT_ALLOWED_MESSAGE,
  appliedAgainstRules,
  describeBrokenRules,
  normalizeBrokenRules,
  overrideConfirmationMatches,
  type BrokenRule,
} from "./ruleOverride";
import { findDashConnectors } from "./humanProse";

const firstPerson: BrokenRule = { kind: "house_rule", name: "First person", reason: "Uses the company." };
const order: BrokenRule = { kind: "template", name: "Line 244 paragraph order", reason: "Result first." };
const cap: BrokenRule = { kind: "cra_limit", name: "Line 244 word cap", reason: "Adds 40 words." };

describe("rule override wording", () => {
  it("names each rule with its kind, in the owner's sentence", () => {
    expect(describeBrokenRules([firstPerson])).toBe('This change goes against the house rule "First person".');
    expect(describeBrokenRules([firstPerson, cap])).toBe(
      'This change goes against the house rule "First person" and the CRA limit "Line 244 word cap".'
    );
    expect(describeBrokenRules([firstPerson, order, cap])).toBe(
      'This change goes against the house rule "First person", the template rule "Line 244 paragraph order" and the CRA limit "Line 244 word cap".'
    );
    expect(appliedAgainstRules([firstPerson])).toBe('Applied against the house rule "First person".');
  });

  it("uses plain hyphens only", () => {
    for (const text of [
      RULE_OVERRIDE_MANAGER_ONLY,
      RULE_OVERRIDE_NOT_ALLOWED_MESSAGE,
      RULE_OVERRIDE_CONFIRM_MESSAGE,
      describeBrokenRules([firstPerson, order, cap]),
    ]) {
      expect(text).not.toMatch(/[\u2013\u2014]/);
      expect(findDashConnectors(text)).toEqual([]);
    }
  });
});

describe("the confirmation must name exactly the card's rules", () => {
  it("accepts the same names in any order, trimmed", () => {
    expect(overrideConfirmationMatches([firstPerson, cap], ["Line 244 word cap", " First person"])).toBe(true);
  });

  it("refuses a missing, partial, extra, repeated or wrong confirmation", () => {
    expect(overrideConfirmationMatches([firstPerson], undefined)).toBe(false);
    expect(overrideConfirmationMatches([firstPerson], [])).toBe(false);
    expect(overrideConfirmationMatches([firstPerson, cap], ["First person"])).toBe(false);
    expect(overrideConfirmationMatches([firstPerson], ["First person", "Line 244 word cap"])).toBe(false);
    expect(overrideConfirmationMatches([firstPerson, cap], ["First person", "First person"])).toBe(false);
    expect(overrideConfirmationMatches([firstPerson], ["first person"])).toBe(false);
  });
});

describe("normalizing what the model sent", () => {
  it("trims, drops blank names and keeps the first of a repeated name", () => {
    const result = normalizeBrokenRules([
      { ...firstPerson, name: " First person ", reason: " Uses the company. " },
      { ...firstPerson, name: "first PERSON", reason: "Again." },
      { ...cap, name: "  " },
    ]);
    expect(result).toEqual({ ok: true, rules: [firstPerson] });
  });

  it("refuses a missing reason and too many rules", () => {
    expect(normalizeBrokenRules([{ ...firstPerson, reason: " " }]).ok).toBe(false);
    const many = Array.from({ length: MAX_BROKEN_RULES + 1 }, (_, index) => ({ ...cap, name: `Rule ${index}` }));
    expect(normalizeBrokenRules(many).ok).toBe(false);
  });

  it("is empty for no rules", () => {
    expect(normalizeBrokenRules(undefined)).toEqual({ ok: true, rules: [] });
  });
});
