import { v, type Infer } from "convex/values";
import { styleOverridesValidator } from "./styleOverrides";

/**
 * Story 2 (CAP-5, AD-24): shared vocabulary for ordered, ungated section
 * generation. Framework-free (no "use node"): the schema, the writer-profile
 * read path, the chain mutations in convex/generations.ts and the node chain
 * actions in convex/ai/orderedGeneration.ts all read these definitions, so a
 * section, a Build Order or a chain payload cannot mean two things.
 */

export const SECTION_NUMBERS = ["242", "244", "246"] as const;
export type SectionNumber = (typeof SECTION_NUMBERS)[number];
export type SectionKeyOf = "s242" | "s244" | "s246";

/** House Rules default Build Order: the Locked Rules presentation order. */
export const DEFAULT_BUILD_ORDER: readonly SectionNumber[] = SECTION_NUMBERS;

// A valid Build Order is a permutation of SECTION_NUMBERS (length 3); this is
// a write-time input-size backstop, not the read-time validity check
// (resolveBuildOrder below), which stays the source of truth for shape.
export const MAX_BUILD_ORDER_ENTRIES = 10;

export const sectionNumberValidator = v.union(
  v.literal("242"),
  v.literal("244"),
  v.literal("246")
);

export function sectionKeyOf(section: SectionNumber): SectionKeyOf {
  return `s${section}` as SectionKeyOf;
}

export function isSectionNumber(value: string): value is SectionNumber {
  return (SECTION_NUMBERS as readonly string[]).includes(value);
}

// ─── Writer Profile Self-check rules ────────────────────────────────────────

export const MAX_SELF_CHECK_RULES = 20;
export const MAX_SELF_CHECK_INSTRUCTION_CHARS = 500;

/**
 * One per-paragraph (or per-section) Self-check the writer attaches in their
 * profile. Caps are clipped to the Locked caps at check time and reported as
 * `tier: conflict` when the rule asks for more than the Locked Rules allow.
 */
export const selfCheckRuleValidator = v.object({
  section: v.optional(sectionNumberValidator),
  paragraphIndex: v.optional(v.number()),
  instruction: v.string(),
  maxWords: v.optional(v.number()),
  maxLines: v.optional(v.number()),
});
export type SelfCheckRule = Infer<typeof selfCheckRuleValidator>;

// ─── AD-26: per-category outcomes and profile state ─────────────────────────

export const complianceTierValidator = v.union(
  v.literal("locked"),
  v.literal("org_enforced"),
  v.literal("conflict"),
  v.literal("missing_fact"),
  v.literal("none")
);
export type ComplianceTier = Infer<typeof complianceTierValidator>;

export const profileStateValidator = v.union(
  v.literal("applied"),
  v.literal("disabled"),
  v.literal("missing")
);
export type ProfileState = Infer<typeof profileStateValidator>;

export const styleCategoryValidator = v.union(
  v.literal("bannedWords"),
  v.literal("paragraphDensity"),
  v.literal("sentenceConstruction"),
  v.literal("repetitionCaps"),
  v.literal("openingClauses"),
  v.literal("reportSkeleton")
);

export const houseRuleModeValidator = v.union(
  v.literal("writer_choice"),
  v.literal("enforced"),
  v.literal("off")
);

export const categoryOutcomeValidator = v.object({
  category: styleCategoryValidator,
  mode: houseRuleModeValidator,
  /** true = the House Rule is waived for this generation. */
  effective: v.boolean(),
  tier: v.union(v.literal("org_enforced"), v.literal("none")),
  /**
   * Story 3: the applied Writer Profile asked to waive this House Rule.
   * `requested && !effective` is a waiver an org `enforced` mode ignored.
   * Optional so already-scheduled chain payloads still validate.
   */
  requested: v.optional(v.boolean()),
});
export type CategoryOutcome = Infer<typeof categoryOutcomeValidator>;

/** Everything ordered generation reads from the Writer Profile, never null. */
export const orderedProfileContextValidator = v.object({
  profileState: profileStateValidator,
  categoryOutcomes: v.array(categoryOutcomeValidator),
  buildOrder: v.array(sectionNumberValidator),
  buildOrderFallbackReason: v.optional(v.string()),
  selfCheckRules: v.array(selfCheckRuleValidator),
  /** Story 3: the Writer Profile row's reason when a profile applied. */
  profileReason: v.optional(v.string()),
  /** Story 3: a settings document applied, but its waivers were not analysed. */
  waiverAnalysisFailed: v.optional(v.boolean()),
});
export type OrderedProfileContext = Infer<typeof orderedProfileContextValidator>;

/** Exactly the ordered-profile fields of a wider effective-style result. */
export function pickOrderedProfileContext(
  style: OrderedProfileContext
): OrderedProfileContext {
  return {
    profileState: style.profileState,
    categoryOutcomes: style.categoryOutcomes,
    buildOrder: style.buildOrder,
    ...(style.buildOrderFallbackReason
      ? { buildOrderFallbackReason: style.buildOrderFallbackReason }
      : {}),
    selfCheckRules: style.selfCheckRules,
    ...(style.profileReason ? { profileReason: style.profileReason } : {}),
    ...(style.waiverAnalysisFailed ? { waiverAnalysisFailed: true } : {}),
  };
}

// ─── Story 3 (CAP-8, AD-26): the writer settings a generation ran under ─────

export const settingsSupplyPathValidator = v.union(
  v.literal("writer_notes"),
  v.literal("attachment")
);

export const writerSettingsSourceValidator = v.union(
  v.literal("profile"),
  v.literal("writer_notes"),
  v.literal("attachment"),
  v.literal("none")
);
export type WriterSettingsSource = Infer<typeof writerSettingsSourceValidator>;

export const waiverAnalysisValidator = v.union(
  v.literal("profile"),
  v.literal("cached"),
  v.literal("analyzed"),
  v.literal("failed"),
  v.literal("none")
);
export type WaiverAnalysis = Infer<typeof waiverAnalysisValidator>;

/** `generations.writerSettings`: written only by generations.recordWriterSettings. */
export const writerSettingsValidator = v.object({
  profileState: profileStateValidator,
  source: writerSettingsSourceValidator,
  generationSourceId: v.optional(v.id("generationSources")),
  projectDocumentId: v.optional(v.id("projectDocuments")),
  fileName: v.optional(v.string()),
  matchesProfile: v.boolean(),
  savedProfileSuperseded: v.boolean(),
  waiverAnalysis: waiverAnalysisValidator,
  truncated: v.boolean(),
});
export type WriterSettingsRecord = Infer<typeof writerSettingsValidator>;

// ─── Build Order read-validation ────────────────────────────────────────────

const DEFAULT_ORDER_TEXT = "House Rules default 242 → 244 → 246 used";

/**
 * Validate a stored Build Order on READ. It must be a permutation of exactly
 * 242/244/246; anything else falls back to the default with a reason the
 * Compliance Note records. Never throws: a malformed profile must never block
 * generation (spec Change Log, 2026-09-10).
 */
export function resolveBuildOrder(stored: readonly string[] | undefined): {
  buildOrder: SectionNumber[];
  fallbackReason?: string;
} {
  const entries = (stored ?? []).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) return { buildOrder: [...DEFAULT_BUILD_ORDER] };

  const invalid = entries.filter((entry) => !isSectionNumber(entry));
  if (invalid.length > 0) {
    return {
      buildOrder: [...DEFAULT_BUILD_ORDER],
      fallbackReason: `invalid section in Build Order: ${invalid.join(", ")}; ${DEFAULT_ORDER_TEXT}`,
    };
  }
  const duplicates = entries.filter(
    (entry, index) => entries.indexOf(entry) !== index
  );
  if (duplicates.length > 0) {
    return {
      buildOrder: [...DEFAULT_BUILD_ORDER],
      fallbackReason: `Build Order repeats section ${[...new Set(duplicates)].join(", ")}; ${DEFAULT_ORDER_TEXT}`,
    };
  }
  const missing = SECTION_NUMBERS.filter((section) => !entries.includes(section));
  if (missing.length > 0) {
    return {
      buildOrder: [...DEFAULT_BUILD_ORDER],
      fallbackReason: `Build Order is missing section ${missing.join(", ")}; ${DEFAULT_ORDER_TEXT}`,
    };
  }
  return { buildOrder: entries as SectionNumber[] };
}

// ─── Chain payload ──────────────────────────────────────────────────────────

export const brainExemplarsValidator = v.object({
  analyzer: v.string(),
  s242: v.string(),
  s244: v.string(),
  s246: v.string(),
});

/**
 * The frozen payload every chain action receives: exactly what
 * generateCandidate received (shared analysis, brain blocks, style fields)
 * plus the ordered profile context read once by generateReport, so every
 * compare candidate runs the same Build Order under the same rules.
 */
export const orderedPayloadValidator = v.object({
  analysis: v.string(),
  brainExemplars: brainExemplarsValidator,
  qaCalibration: v.optional(v.string()),
  draftStyle: v.optional(v.string()),
  qaCalibrationDigestId: v.optional(v.id("learningDigests")),
  draftStyleDigestId: v.optional(v.id("learningDigests")),
  writerFlavor: v.optional(v.string()),
  styleOverrides: v.optional(styleOverridesValidator),
  orderedContext: orderedProfileContextValidator,
});
export type OrderedPayload = Infer<typeof orderedPayloadValidator>;
