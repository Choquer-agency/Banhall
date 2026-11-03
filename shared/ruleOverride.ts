/**
 * Rule overrides (client meeting, 2026-11-02). House rules, the template and
 * the CRA limits stay the default. When the writer explicitly asks for a
 * change that goes against one, the Assistant proposes it anyway and names
 * each rule it breaks (`chatProposals.rulesBroken`). The person applying it
 * confirms those rules by name: anyone who may edit the report for a
 * template rule or an approved banned word, a Manager or an Admin
 * (`report.overrideRules`) for a house rule or a CRA limit; the server re-checks both and records the override on the
 * card (`chatProposals.ruleOverrides`). Agents still propose and humans still
 * apply.
 *
 * Pure and framework-free, so the server, the tool and the card share one
 * wording and one confirmation rule.
 */

export const BROKEN_RULE_KINDS = ["house_rule", "template", "cra_limit", "banned_words"] as const;
export type BrokenRuleKind = (typeof BROKEN_RULE_KINDS)[number];

export type BrokenRule = {
  kind: BrokenRuleKind;
  /** The rule's name as the writer knows it, for example "First person". */
  name: string;
  /** One short sentence: how the change goes against it. */
  reason: string;
};

export type RuleOverrideRecord = {
  userId: string;
  at: number;
  /** The rule names confirmed, in the card's order. */
  rules: string[];
};

/** The most rules one card may name. More means the change is not one request. */
export const MAX_BROKEN_RULES = 5;
/** Cap on a rule name, so a card and a confirmation stay readable. */
export const MAX_BROKEN_RULE_NAME_CHARS = 80;
/** Cap on a reason. */
export const MAX_BROKEN_RULE_REASON_CHARS = 300;

const KIND_LABEL: Record<BrokenRuleKind, string> = {
  house_rule: "the house rule",
  template: "the template rule",
  cra_limit: "the CRA limit",
  banned_words: "the banned word",
};

/** "the house rule "First person"". */
export function brokenRuleLabel(rule: Pick<BrokenRule, "kind" | "name">): string {
  return `${KIND_LABEL[rule.kind] ?? "the rule"} "${rule.name.trim()}"`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** "This change goes against the house rule "First person"." */
export function describeBrokenRules(rules: ReadonlyArray<Pick<BrokenRule, "kind" | "name">>): string {
  return `This change goes against ${joinList(rules.map(brokenRuleLabel))}.`;
}

/** The applied card's note: "Applied against the house rule "First person"." */
export function appliedAgainstRules(rules: ReadonlyArray<Pick<BrokenRule, "kind" | "name">>): string {
  return `Applied against ${joinList(rules.map(brokenRuleLabel))}.`;
}

/**
 * 2026-11-02 (owner): a Line may go past its CRA limit by override, but
 * Export refuses it (the CRA form would cut it off), so the confirmation
 * says so before the manager applies it.
 */
export const CRA_LIMIT_EXPORT_NOTE =
  "Export stays blocked until the Line fits the CRA limit again, because the CRA form would cut off the extra lines or words.";

/** Whether a card's rules include a CRA limit. */
export function breaksCraLimit(rules: ReadonlyArray<Pick<BrokenRule, "kind">>): boolean {
  return rules.some((rule) => rule.kind === "cra_limit");
}

/**
 * Owner, 2026-11-02 (second): the template is a guide, so a writer confirms
 * a template change or an approved banned word themselves. A house rule
 * (voice, sentence length, repetition) and a CRA limit still need a
 * Manager or an Admin (`report.overrideRules`).
 */
export const MANAGER_RULE_KINDS: ReadonlySet<BrokenRuleKind> = new Set(["house_rule", "cra_limit"]);

/** Whether applying a card with these rules needs `report.overrideRules`. */
export function rulesNeedManager(rules: ReadonlyArray<Pick<BrokenRule, "kind">>): boolean {
  return rules.some((rule) => MANAGER_RULE_KINDS.has(rule.kind));
}

/** Whether a card names an approved banned word, so the banned-word scrub leaves it. */
export function approvesBannedWords(rules: ReadonlyArray<Pick<BrokenRule, "kind">> | undefined): boolean {
  return (rules ?? []).some((rule) => rule.kind === "banned_words");
}

/**
 * Owner, 2026-11-02 (second): bullet points and numbered lists never go in
 * report text, whoever asks: the CRA form takes plain paragraphs, and a list
 * would show its dashes and numbers and use a form line each. A line that
 * opens with a dash, an asterisk, a bullet sign, or a number or letter with
 * a full stop or bracket counts as a list line.
 */
const LIST_LINE = /(?:^|\n)[^\S\n]*(?:[-*\u2022\u2023\u25e6\u25aa\u25cf\u2043]|\d{1,3}[.)]|[a-zA-Z][)])[^\S\n]+\S/u;

export function holdsListLines(text: string): boolean {
  return LIST_LINE.test(text) || /\u2022/u.test(text);
}

export const LIST_NOT_ALLOWED_MESSAGE =
  "Bullet points and numbered lists cannot go in the report, because the CRA form takes plain paragraphs only. Ask for the same points written as sentences.";

/** The rule names a confirmation must carry, in the card's order. */
export function brokenRuleNames(rules: ReadonlyArray<Pick<BrokenRule, "name">>): string[] {
  return rules.map((rule) => rule.name.trim());
}

/**
 * Whether a confirmation names exactly the rules the card breaks: the same
 * names, each once, in any order. The server applies a rule-breaking card only
 * when this holds; a card that breaks no rule needs no confirmation.
 */
export function overrideConfirmationMatches(
  rules: ReadonlyArray<Pick<BrokenRule, "name">>,
  confirmed: ReadonlyArray<string> | undefined
): boolean {
  if (!confirmed) return false;
  const expected = brokenRuleNames(rules);
  const given = confirmed.map((name) => name.trim());
  if (new Set(given).size !== given.length || given.length !== expected.length) return false;
  const wanted = new Set(expected);
  return given.every((name) => wanted.has(name));
}

/**
 * Normalizes what the model sent: trims, drops blanks, keeps the first of a
 * repeated name, and returns an issue the tool hands back for a retry.
 */
export function normalizeBrokenRules(
  rules: ReadonlyArray<BrokenRule> | undefined
): { ok: true; rules: BrokenRule[] } | { ok: false; reason: string } {
  const kept: BrokenRule[] = [];
  const seen = new Set<string>();
  for (const rule of rules ?? []) {
    const name = rule.name.trim();
    const reason = rule.reason.trim();
    if (!name) continue;
    if (!BROKEN_RULE_KINDS.includes(rule.kind)) {
      return { ok: false, reason: `Each rule in breaksRules needs a kind: ${BROKEN_RULE_KINDS.join(", ")}.` };
    }
    if (name.length > MAX_BROKEN_RULE_NAME_CHARS) {
      return { ok: false, reason: `Keep each rule name in breaksRules under ${MAX_BROKEN_RULE_NAME_CHARS} characters.` };
    }
    if (!reason) return { ok: false, reason: `Give a short reason for "${name}" in breaksRules.` };
    if (reason.length > MAX_BROKEN_RULE_REASON_CHARS) {
      return { ok: false, reason: `Keep each reason in breaksRules under ${MAX_BROKEN_RULE_REASON_CHARS} characters.` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push({ kind: rule.kind, name, reason });
  }
  if (kept.length > MAX_BROKEN_RULES) {
    return { ok: false, reason: `Name at most ${MAX_BROKEN_RULES} rules in breaksRules.` };
  }
  return { ok: true, rules: kept };
}

/** The note a person without `report.overrideRules` sees on the card. */
export const RULE_OVERRIDE_MANAGER_ONLY = "A manager can apply this change.";

/** Server refusals, written for the person who pressed Accept. */
export const RULE_OVERRIDE_NOT_ALLOWED_MESSAGE =
  "A manager can apply this change, because it goes against a rule.";
export const RULE_OVERRIDE_CONFIRM_MESSAGE =
  "Confirm the rules this change goes against before you apply it.";
