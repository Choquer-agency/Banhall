/**
 * Per-writer house-style override toggles (PSOS-49).
 *
 * The SR&ED writing standard has two tiers. The locked tier (CRA form
 * line/word limits and the no-fabrication/evidence rules) applies to everyone.
 * The waivable tier below is enforced by default (with one exception, below)
 * but a writer may waive individual categories so their own "Writing
 * preferences" document governs that area instead. Since the 2026-09-01
 * amendment this includes `reportSkeleton`: the whole built-in section
 * skeleton (the content each line covers, its order, framing conventions) —
 * waiving it makes the writer's document authoritative for report
 * architecture, with only the line limits and no-fabrication rules still
 * enforced. Since the 2026-09-15 owner decision the default skeleton mandates
 * no paragraph counts, and `openingClauses` (the literal CRA signal phrases)
 * is OFF by default for every writer; an admin can turn it back on
 * (DEFAULT_HOUSE_RULE_MODES). A waived category is removed from the drafting
 * prompts, skipped by the programmatic scrub/QA scans, and exempted from QA
 * deductions — conflicts are resolved before prompt assembly, never silently
 * inside it.
 *
 * Shared between the Convex backend and the Svelte client so the toggle list
 * cannot drift (same pattern as shared/writerProfileLimits.ts).
 */

export const STYLE_OVERRIDE_KEYS = [
  "bannedWords",
  "paragraphDensity",
  "sentenceConstruction",
  "repetitionCaps",
  "openingClauses",
  "reportSkeleton",
] as const;

export type StyleOverrideKey = (typeof STYLE_OVERRIDE_KEYS)[number];

/** true = the writer's own instructions govern this category. */
export type StyleOverrides = Record<StyleOverrideKey, boolean>;

export const NO_STYLE_OVERRIDES: StyleOverrides = {
  bannedWords: false,
  paragraphDensity: false,
  sentenceConstruction: false,
  repetitionCaps: false,
  openingClauses: false,
  reportSkeleton: false,
};

/**
 * Normalize a stored (possibly partial or absent) override object into a full
 * record. Legacy writerProfiles rows have no styleOverrides field — they
 * normalize to all-false, i.e. exactly the pre-override behavior.
 */
export function normalizeStyleOverrides(
  raw?: Partial<StyleOverrides> | null
): StyleOverrides {
  const out = { ...NO_STYLE_OVERRIDES };
  if (!raw) return out;
  for (const key of STYLE_OVERRIDE_KEYS) {
    if (raw[key] === true) out[key] = true;
  }
  return out;
}

export function hasAnyStyleOverride(overrides: StyleOverrides): boolean {
  return STYLE_OVERRIDE_KEYS.some((key) => overrides[key]);
}

/** Key-by-key equality, for dirty-state tracking in settings UIs. */
export function styleOverridesEqual(
  a: StyleOverrides,
  b: StyleOverrides
): boolean {
  return STYLE_OVERRIDE_KEYS.every((key) => a[key] === b[key]);
}

// ─── PSOS-50: org-level governance modes ────────────────────────────────────
//
// Each house-style category has an admin-set global mode:
//   "writer_choice" — enforced by default, each writer may waive it
//   "enforced"      — always enforced; writer waivers are ignored
//   "off"           — waived for everyone, profile or not
// Stored as JSON in the appSettings row "houseStyle.modes" (convex/houseStyle.ts).
// Default per category: "writer_choice", except `openingClauses`, which is
// "off" since the 2026-09-15 owner decision (mandated opening clauses are not
// enforced for anyone unless an admin turns them on).

export const HOUSE_RULE_MODES = ["writer_choice", "enforced", "off"] as const;

export type HouseRuleMode = (typeof HOUSE_RULE_MODES)[number];

export type HouseRuleModes = Record<StyleOverrideKey, HouseRuleMode>;

export const DEFAULT_HOUSE_RULE_MODES: HouseRuleModes = {
  bannedWords: "writer_choice",
  paragraphDensity: "writer_choice",
  sentenceConstruction: "writer_choice",
  repetitionCaps: "writer_choice",
  openingClauses: "off",
  reportSkeleton: "writer_choice",
};

export const HOUSE_RULE_MODE_LABELS: Record<HouseRuleMode, string> = {
  writer_choice: "Writer's choice",
  enforced: "Always enforced",
  off: "Off for everyone",
};

function isHouseRuleMode(value: unknown): value is HouseRuleMode {
  return (HOUSE_RULE_MODES as readonly unknown[]).includes(value);
}

/**
 * Normalize a stored value (raw JSON string or already-parsed object) into a
 * full mode record. Missing rows, malformed JSON, and unknown values all fall
 * back to DEFAULT_HOUSE_RULE_MODES — misconfiguration can never change
 * behavior beyond the documented default.
 */
export function normalizeHouseRuleModes(raw: unknown): HouseRuleModes {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const out = { ...DEFAULT_HOUSE_RULE_MODES };
  if (!parsed || typeof parsed !== "object") return out;
  for (const key of STYLE_OVERRIDE_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (isHouseRuleMode(value)) out[key] = value;
  }
  return out;
}

/**
 * The effective waivers for one writer: the org's global mode wins over the
 * writer's toggle in both directions ("off" waives for everyone, "enforced"
 * ignores the writer's waiver); "writer_choice" defers to the writer.
 */
export function resolveEffectiveOverrides(
  modes: HouseRuleModes,
  writerOverrides: StyleOverrides
): StyleOverrides {
  const out = { ...NO_STYLE_OVERRIDES };
  for (const key of STYLE_OVERRIDE_KEYS) {
    const mode = modes[key];
    out[key] =
      mode === "off" ? true : mode === "enforced" ? false : writerOverrides[key];
  }
  return out;
}

/**
 * Copy for each waivable area, the one source for the admin pages and the
 * writer's Writing preferences page (2026-10-19 meeting fixes: the info
 * popover there shows houseRule, example and whenOn).
 */
export type StyleOverrideMeta = {
  /**
   * The admin name. The drafting prompts (convex/ai/prompts.ts) and the
   * style analysis prompt (convex/ai/styleAnalysis.ts) quote it, so changing
   * it changes those prompts and their versions.
   */
  label: string;
  /** One line for the admin pages: what waiving the area does. */
  description: string;
  /** The writer's name for the area on Writing preferences. */
  writerLabel: string;
  /** A few words under the writer's name: what the house rule is about. */
  summary: string;
  /** What the house rule checks, in plain words. */
  houseRule: string;
  /** One concrete example of the house rule at work. Fictional. */
  example: string;
  /** What changes when the writer turns the area's switch on. */
  whenOn: string;
};

export const STYLE_OVERRIDE_META: Record<StyleOverrideKey, StyleOverrideMeta> = {
  bannedWords: {
    label: "Banned words and phrases",
    description:
      "Skip the house list of words to avoid and its automatic replacements. The writer's instructions set the word rules.",
    writerLabel: "Word list",
    summary: "House list of words to avoid",
    houseRule:
      'Banhall keeps a list of words drafts must not use, such as "novel", "robust" and "leverage". If one slips into a draft, Banhall swaps it for a plainer word or removes it.',
    example: 'A draft that says "a novel, robust method" comes out as "a new, reliable method".',
    whenOn:
      "The house list and its swaps stop. Your instructions decide which words to avoid, which to prefer and what to use instead.",
  },
  paragraphDensity: {
    label: "Paragraph density",
    description:
      "Waive the paragraph rules: 4 to 7 sentences and no more than 150 words. The writer's instructions set paragraph length.",
    writerLabel: "Paragraph length",
    summary: "4 to 7 sentences, up to 150 words",
    houseRule:
      "Each paragraph has 4 to 7 sentences and no more than 150 words. One-sentence paragraphs are not allowed.",
    example: "A 9-sentence paragraph about pump failures is split into two paragraphs.",
    whenOn:
      "Your instructions set paragraph length. CRA line limits still cap the length of each line.",
  },
  sentenceConstruction: {
    label: "Sentence construction",
    description:
      "Waive the 40-word sentence cap and the sentence-opening rules. The no-dash rule is house policy and stays on.",
    writerLabel: "Sentence length",
    summary: "Sentences of 40 words or fewer",
    houseRule:
      'No sentence runs over 40 words. Each paragraph opens with its main point. Sentences use active voice with the company as the subject, and no more than two in a row start with "The".',
    example: "A 55-word sentence about three test runs is split into two shorter sentences.",
    whenOn:
      "Your instructions set sentence length, voice and how sentences open. The no-dash rule still applies.",
  },
  repetitionCaps: {
    label: "Phrase repetition caps",
    description:
      'Waive the caps on "systematic investigation", "technological uncertainty" and other repeated phrases.',
    writerLabel: "Repeated phrases",
    summary: "Caps on repeated CRA phrases",
    houseRule:
      '"Systematic investigation" can appear 3 times in a report and "technological uncertainty" 4 times. Any other phrase can appear twice. After that, drafts use other wording.',
    example: 'The fourth "systematic investigation" in a report becomes "the experimental work".',
    whenOn: "These caps stop. Your instructions decide how often a phrase can repeat.",
  },
  openingClauses: {
    label: "Mandated opening clauses",
    description:
      "The literal CRA signal phrases that open certain paragraphs. Off by default: the required content still has to appear, in the writer's own words. An admin can turn the phrases back on.",
    writerLabel: "Opening phrases",
    summary: "Set CRA phrases that open paragraphs",
    houseRule:
      'Some paragraphs must open with a set CRA phrase, such as "The technological objective was to..." in line 242 or "It was hypothesized that if..." in line 244.',
    example:
      'The hypothesis paragraph starts "It was hypothesized that if the coating cures at 80 degrees..."',
    whenOn:
      "Your instructions decide how those paragraphs open. The content they carry still has to be there.",
  },
  reportSkeleton: {
    label: "Report skeleton and paragraph roles",
    description:
      "Waive the built-in section skeleton: the content each line must cover, its order and the framing conventions. The writer's instructions define each line's structure. The CRA line and word limits and the no-fabrication rules always stay.",
    writerLabel: "Section structure",
    summary: "What each CRA line covers, in order",
    houseRule:
      'Each CRA line covers set content in a set order. Line 242 opens with who the company is and its business goal, then the limits of standard practice, the objective and each uncertainty. Line 244 states the hypothesis as "if ... then ..." with a result you can measure. Line 246 leads with what was learned.',
    example:
      'Line 244 says "if the coating cures at 80 degrees, then peel strength rises by 20 percent" before it describes the trials.',
    whenOn:
      "Your instructions decide what each line covers and in what order. CRA line limits and the rule against made-up facts still apply.",
  },
};

/** What the org's mode means for one writer's area, or null when the writer decides. */
export function houseRuleModeNote(mode: HouseRuleMode): string | null {
  if (mode === "enforced") return "Your organization always applies this house rule, so its switch is locked.";
  if (mode === "off") return "Your organization turned this house rule off for everyone, so your instructions already apply here.";
  return null;
}
