import { describe, expect, it } from "vitest";
import {
  MAX_BROKEN_RULES,
  RULE_OVERRIDE_CONFIRM_MESSAGE,
  RULE_OVERRIDE_MANAGER_ONLY,
  RULE_OVERRIDE_NOT_ALLOWED_MESSAGE,
  appliedAgainstRules,
  approvedBannedTerms,
  bannedWordOf,
  brokenRuleLabel,
  unlistedBannedWord,
  describeBrokenRules,
  normalizeBrokenRules,
  rulesNeedManager,
  holdsListLines,
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

describe("owner, 2026-11-02 (second): who confirms, and lists", () => {
  it("needs a manager for a house rule or a CRA limit, not for a template rule or an approved banned word", () => {
    expect(rulesNeedManager([{ kind: "template" }])).toBe(false);
    expect(rulesNeedManager([{ kind: "banned_words" }])).toBe(false);
    expect(rulesNeedManager([{ kind: "template" }, { kind: "house_rule" }])).toBe(true);
    expect(rulesNeedManager([{ kind: "cra_limit" }])).toBe(true);
  });

  it("finds bullet and numbered list lines, and leaves ordinary prose and hyphens alone", () => {
    for (const text of [
      "- one\n- two", "Tests:\n* load", "\u2022 load", "1. Load\n2. Heat", "a) load", "Intro\n  3) heat",
      // Review 2026-11-03: lettered, Roman and bracketed items.
      "A. First point\nB. Second point", "a. first\nb. second", "(1) first\n(2) second", "(a) first", "i. first\nii. second",
    ]) {
      expect(holdsListLines(text), text).toBe(true);
    }
    for (const text of [
      "A low-temperature test - at minus forty - held.", "Line 244 ran 3 trials.", "The team ran 2. Then it stopped.", "One\n---\nTwo",
      "A. Smith led the trials.", "The rig (a) held and (b) failed.",
    ]) {
      expect(holdsListLines(text), text).toBe(false);
    }
  });
});

describe("brokenRuleLabel", () => {
  it("does not repeat the kind the AI put at the start of the name", () => {
    expect(brokenRuleLabel({ kind: "banned_words", name: "Banned word: novel" })).toBe('the banned word "novel"');
    expect(brokenRuleLabel({ kind: "template", name: "Template rule - required opener" })).toBe('the template rule "required opener"');
    expect(brokenRuleLabel({ kind: "house_rule", name: "First person" })).toBe('the house rule "First person"');
    expect(brokenRuleLabel({ kind: "cra_limit", name: "CRA limit:" })).toBe('the CRA limit "CRA limit:"');
    // Only the rule's own kind, and only before a colon or a spaced hyphen.
    expect(brokenRuleLabel({ kind: "template", name: "Template-based opener" })).toBe('the template rule "Template-based opener"');
    expect(brokenRuleLabel({ kind: "house_rule", name: "Banned words: plain English" })).toBe('the house rule "Banned words: plain English"');
  });
});

describe("approved banned words (review 2026-11-03)", () => {
  it("reads the one word each banned_words rule names", () => {
    expect(bannedWordOf({ name: "Banned word: Novel" })).toBe("novel");
    expect(bannedWordOf({ name: "\u201ccutting-edge\u201d" })).toBe("cutting-edge");
    expect(
      approvedBannedTerms([
        { kind: "banned_words", name: "novel" },
        { kind: "template", name: "Required opener" },
      ])
    ).toEqual(["novel"]);
    expect(approvedBannedTerms(undefined)).toEqual([]);
  });

  it("names a banned_words rule whose word is not on the list", () => {
    expect(unlistedBannedWord([{ kind: "banned_words", name: "novel" }])).toBeNull();
    expect(unlistedBannedWord([{ kind: "banned_words", name: "Everything on the list" }])).toBe("Everything on the list");
    expect(unlistedBannedWord([{ kind: "house_rule", name: "Everything on the list" }])).toBeNull();
  });
});
