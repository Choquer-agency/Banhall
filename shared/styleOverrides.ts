/**
 * Per-writer house-style override toggles (PSOS-49).
 *
 * The SR&ED writing standard has two tiers. The locked tier (CRA form
 * line/word limits and the no-fabrication/evidence rules) applies to everyone.
 * The waivable tier below is enforced by default but a writer may waive
 * individual categories so their own "Writing preferences" document governs
 * that area instead. Since the 2026-09-01 amendment this includes
 * `reportSkeleton`: the whole built-in section skeleton (paragraph counts,
 * roles, ordering, framing conventions) — waiving it makes the writer's
 * document authoritative for report architecture, with only the line limits
 * and no-fabrication rules still enforced. A waived category is removed from the drafting
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
//   "writer_choice" — enforced by default, each writer may waive it (default)
//   "enforced"      — always enforced; writer waivers are ignored
//   "off"           — waived for everyone, profile or not
// Stored as JSON in the appSettings row "houseStyle.modes" (convex/houseStyle.ts).

export const HOUSE_RULE_MODES = ["writer_choice", "enforced", "off"] as const;

export type HouseRuleMode = (typeof HOUSE_RULE_MODES)[number];

export type HouseRuleModes = Record<StyleOverrideKey, HouseRuleMode>;

export const DEFAULT_HOUSE_RULE_MODES: HouseRuleModes = {
  bannedWords: "writer_choice",
  paragraphDensity: "writer_choice",
  sentenceConstruction: "writer_choice",
  repetitionCaps: "writer_choice",
  openingClauses: "writer_choice",
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
 * back to "writer_choice" — misconfiguration can never change behavior
 * beyond the pre-governance default.
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

/** Copy for the settings and admin toggle groups. */
export const STYLE_OVERRIDE_META: Record<
  StyleOverrideKey,
  { label: string; description: string }
> = {
  bannedWords: {
    label: "Banned words and phrases",
    description:
      "Skip the default banned-word list and automatic replacements; your instructions define the vocabulary rules.",
  },
  paragraphDensity: {
    label: "Paragraph density",
    description:
      "Waive the 4–7 sentences / 150-word paragraph rules; your instructions set paragraph length.",
  },
  sentenceConstruction: {
    label: "Sentence construction",
    description:
      "Waive the 40-word sentence cap and sentence-opening variety. The no-dash rule is house policy and stays on.",
  },
  repetitionCaps: {
    label: "Phrase repetition caps",
    description:
      'Waive the usage caps on "systematic investigation", "technological uncertainty", and repeated phrases.',
  },
  openingClauses: {
    label: "Mandated opening clauses",
    description:
      "Waive the literal CRA signal phrases that must open certain paragraphs; the required content still has to appear, in your phrasing.",
  },
  reportSkeleton: {
    label: "Report skeleton and paragraph roles",
    description:
      "Waive the built-in section skeleton: paragraph counts, paragraph roles, content ordering, and framing conventions. Your instructions define each line's architecture. The CRA form line/word limits and the no-fabrication rules always stay.",
  },
};
