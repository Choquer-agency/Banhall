import {
  query,
  mutation,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  getInternalProjectAccessOrNull,
  requireCurrentUser,
  requireRole,
} from "./lib/auth";
import { domainError, sha256 } from "./lib/contracts";
import { MAX_INSTRUCTIONS_CHARS } from "../shared/writerProfileLimits";
import {
  styleOverridesValidator,
  normalizedStyleOverridesValidator,
} from "./lib/styleOverrides";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
  type StyleOverrideKey,
  type StyleOverrides,
} from "../shared/styleOverrides";
import { getHouseRuleModes } from "./houseStyle";
import {
  DEFAULT_BUILD_ORDER,
  MAX_BUILD_ORDER_ENTRIES,
  MAX_SELF_CHECK_INSTRUCTION_CHARS,
  MAX_SELF_CHECK_RULES,
  orderedProfileContextValidator,
  pickOrderedProfileContext,
  profileStateValidator,
  resolveBuildOrder,
  selfCheckRuleValidator,
  settingsSupplyPathValidator,
  styleCategoryValidator,
  writerSettingsSourceValidator,
  type CategoryOutcome,
  type OrderedProfileContext,
  type ProfileState,
  type SectionNumber,
  type SelfCheckRule,
  type WriterSettingsSource,
  waiverAnalysisValidator,
} from "./lib/orderedChain";
import {
  detectSettingsDocument,
  normalizeSettingsText,
  parseSourceLabel,
  settingsDocumentText,
  settingsSupplyLabel,
  type SettingsSupplyPath,
} from "./lib/settingsDocument";
import { extractSettingsRules } from "./lib/settingsExtraction";
import { MAX_TRANSCRIPTS_PER_PROJECT } from "./lib/transcripts";

/**
 * Per-writer "flavor" (Phase A): free-text personal writing instructions,
 * injected as a bounded block into the section-drafting prompts (see
 * convex/ai/pipeline.ts). CRA structure and length budgets always win.
 * PSOS-49: house-style rules (banned words, density, sentence construction,
 * repetition caps, literal opening clauses) win by default, but the writer
 * can waive individual categories via styleOverrides — a waived category's
 * rule text is removed from the prompts and its scrub/QA enforcement is
 * skipped, so the writer's instructions govern that area.
 *
 * Story 2 (CAP-5/9): the profile also carries a Build Order (stored as sent,
 * validated on read) and per-paragraph Self-check rules (validated on save).
 *
 * Roadmap:
 * - Phase B: per-user learning digests — learningDigests now carries an
 *   optional userId + by_kind_and_userId index; a per-writer distillation
 *   job would write one draft_style digest per active writer and the
 *   pipeline would prefer the requesting writer's digest over the global one.
 * - Phase C: per-user RAG boost — when retrieving Brain exemplars, boost
 *   brainSources authored by the requesting writer (writerName/sourceId is
 *   already on retrieval provenance) so each writer sees more of their own
 *   past phrasing.
 */

// Jul 17 meeting: the visible 4k limit was removed so writers can paste their
// full prompt documents. The shared MAX_INSTRUCTIONS_CHARS limit is a backstop against runaway
// payloads and keeps both writer/admin clients aligned with server validation.

const profileValidator = v.object({
  _id: v.id("writerProfiles"),
  _creationTime: v.number(),
  userId: v.id("users"),
  customInstructions: v.string(),
  enabled: v.boolean(),
  styleOverrides: v.optional(styleOverridesValidator),
  buildOrder: v.optional(v.array(v.string())),
  selfCheckRules: v.optional(v.array(selfCheckRuleValidator)),
  updatedBy: v.id("users"),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function validateInstructions(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_INSTRUCTIONS_CHARS) {
    domainError(
      "INVALID_INPUT",
      `Writing preferences are limited to ${MAX_INSTRUCTIONS_CHARS} characters.`
    );
  }
  return trimmed;
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

/** Save-time input-size backstop for Build Order; shape/validity is decided
 * on read (resolveBuildOrder). Returns the array unchanged. */
function validateBuildOrderLength(buildOrder: string[]): string[] {
  if (buildOrder.length > MAX_BUILD_ORDER_ENTRIES) {
    domainError(
      "INVALID_INPUT",
      `A Writer Profile Build Order holds at most ${MAX_BUILD_ORDER_ENTRIES} entries.`
    );
  }
  return buildOrder;
}

/** Save-time validation of Self-check rules; returns the trimmed rules. */
function validateSelfCheckRules(rules: SelfCheckRule[]): SelfCheckRule[] {
  if (rules.length > MAX_SELF_CHECK_RULES) {
    domainError(
      "INVALID_INPUT",
      `A Writer Profile holds at most ${MAX_SELF_CHECK_RULES} Self-check rules.`
    );
  }
  return rules.map((rule) => {
    const instruction = rule.instruction.trim();
    if (!instruction) {
      domainError("INVALID_INPUT", "A Self-check rule needs an instruction.");
    }
    if (instruction.length > MAX_SELF_CHECK_INSTRUCTION_CHARS) {
      domainError(
        "INVALID_INPUT",
        `A Self-check rule instruction is limited to ${MAX_SELF_CHECK_INSTRUCTION_CHARS} characters.`
      );
    }
    for (const [label, cap] of [
      ["maxWords", rule.maxWords],
      ["maxLines", rule.maxLines],
    ] as const) {
      if (cap !== undefined && !isPositiveInteger(cap)) {
        domainError(
          "INVALID_INPUT",
          `A Self-check rule's ${label} must be a positive whole number.`
        );
      }
    }
    if (
      rule.paragraphIndex !== undefined &&
      !(Number.isInteger(rule.paragraphIndex) && rule.paragraphIndex >= 0)
    ) {
      domainError(
        "INVALID_INPUT",
        "A Self-check rule's paragraph must be a non-negative whole number."
      );
    }
    return {
      ...(rule.section !== undefined ? { section: rule.section } : {}),
      ...(rule.paragraphIndex !== undefined
        ? { paragraphIndex: rule.paragraphIndex }
        : {}),
      instruction,
      ...(rule.maxWords !== undefined ? { maxWords: rule.maxWords } : {}),
      ...(rule.maxLines !== undefined ? { maxLines: rule.maxLines } : {}),
    };
  });
}

async function upsertProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  customInstructions: string,
  enabled: boolean,
  updatedBy: Id<"users">,
  // undefined = caller did not send the field (e.g. a stale client) — preserve
  // whatever is stored rather than silently resetting it. Same rule for the
  // Build Order and the Self-check rules.
  styleOverrides: StyleOverrides | undefined,
  buildOrder: string[] | undefined,
  selfCheckRules: SelfCheckRule[] | undefined
) {
  const now = Date.now();
  // Stored as sent (trimmed); validity is decided on read so an invalid order
  // reaches the Compliance Note as a fallback reason instead of vanishing.
  const storedOrder = buildOrder?.map((entry) => entry.trim());
  const optionalFields = {
    ...(styleOverrides !== undefined ? { styleOverrides } : {}),
    ...(storedOrder !== undefined ? { buildOrder: storedOrder } : {}),
    ...(selfCheckRules !== undefined ? { selfCheckRules } : {}),
  };

  const existing = await ctx.db
    .query("writerProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      customInstructions,
      enabled,
      ...optionalFields,
      updatedBy,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("writerProfiles", {
    userId,
    customInstructions,
    enabled,
    ...optionalFields,
    updatedBy,
    createdAt: now,
    updatedAt: now,
  });
}

/** The signed-in user's own flavor profile, or null if never saved. */
export const getMyProfile = query({
  args: {},
  returns: v.union(profileValidator, v.null()),
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db
      .query("writerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .unique();
  },
});

/** Save (upsert) the signed-in user's own flavor profile. */
export const saveMyProfile = mutation({
  args: {
    customInstructions: v.string(),
    enabled: v.boolean(),
    styleOverrides: v.optional(styleOverridesValidator),
    buildOrder: v.optional(v.array(v.string())),
    selfCheckRules: v.optional(v.array(selfCheckRuleValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const customInstructions = validateInstructions(args.customInstructions);
    await upsertProfile(
      ctx,
      user._id,
      customInstructions,
      args.enabled,
      user._id,
      args.styleOverrides === undefined
        ? undefined
        : normalizeStyleOverrides(args.styleOverrides),
      args.buildOrder === undefined ? undefined : validateBuildOrderLength(args.buildOrder),
      args.selfCheckRules === undefined
        ? undefined
        : validateSelfCheckRules(args.selfCheckRules)
    );
    return null;
  },
});

/** Admin: every saved profile joined with the owning user's name/email. */
export const listProfiles = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("writerProfiles"),
      userId: v.id("users"),
      customInstructions: v.string(),
      enabled: v.boolean(),
      styleOverrides: v.optional(styleOverridesValidator),
      updatedAt: v.number(),
      userName: v.optional(v.string()),
      userEmail: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const profiles = await ctx.db.query("writerProfiles").take(500);
    return await Promise.all(
      profiles.map(async (profile) => {
        const user = await ctx.db.get(profile.userId);
        return {
          _id: profile._id,
          userId: profile.userId,
          customInstructions: profile.customInstructions,
          enabled: profile.enabled,
          styleOverrides: profile.styleOverrides,
          updatedAt: profile.updatedAt,
          userName: user?.name,
          userEmail: user?.email,
        };
      })
    );
  },
});

/** Admin: save (upsert) any user's flavor profile on their behalf. */
export const saveProfileForUser = mutation({
  args: {
    userId: v.id("users"),
    customInstructions: v.string(),
    enabled: v.boolean(),
    styleOverrides: v.optional(styleOverridesValidator),
    buildOrder: v.optional(v.array(v.string())),
    selfCheckRules: v.optional(v.array(selfCheckRuleValidator)),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const target = await ctx.db.get(args.userId);
    if (!target) domainError("NOT_FOUND", "User not found");
    const customInstructions = validateInstructions(args.customInstructions);
    await upsertProfile(
      ctx,
      args.userId,
      customInstructions,
      args.enabled,
      admin._id,
      args.styleOverrides === undefined
        ? undefined
        : normalizeStyleOverrides(args.styleOverrides),
      args.buildOrder === undefined ? undefined : validateBuildOrderLength(args.buildOrder),
      args.selfCheckRules === undefined
        ? undefined
        : validateSelfCheckRules(args.selfCheckRules)
    );
    return null;
  },
});

/**
 * Story 3 (CAP-8): a settings document detected in a generation's frozen
 * sources, as the effective-style policy receives it. `addressedCategories`
 * is the style classifier's result; `null` means the analysis failed.
 */
export type SettingsDocumentInput = {
  text: string;
  supplyPath: SettingsSupplyPath;
  addressedCategories: StyleOverrideKey[] | null;
  fileName?: string;
};

export const settingsDocumentInputValidator = v.object({
  text: v.string(),
  supplyPath: settingsSupplyPathValidator,
  addressedCategories: v.union(v.array(styleCategoryValidator), v.null()),
  fileName: v.optional(v.string()),
});

export type EffectiveWriterStyle = {
  customInstructions: string | null;
  styleOverrides: StyleOverrides;
  /** Where the applied Writer Profile came from ("none" when none applied). */
  settingsSource: WriterSettingsSource;
  /** A settings document replaced an enabled saved profile it differs from. */
  savedProfileSuperseded: boolean;
  /** A settings document equals the enabled saved profile, which applies. */
  matchesProfile: boolean;
} & OrderedProfileContext;

const effectiveWriterStyleValidator = v.object({
  customInstructions: v.union(v.string(), v.null()),
  styleOverrides: normalizedStyleOverridesValidator,
  settingsSource: writerSettingsSourceValidator,
  savedProfileSuperseded: v.boolean(),
  matchesProfile: v.boolean(),
  ...orderedProfileContextValidator.fields,
});

function overridesFromCategories(
  categories: readonly StyleOverrideKey[] | null
): StyleOverrides {
  const out = { ...NO_STYLE_OVERRIDES };
  for (const category of categories ?? []) out[category] = true;
  return out;
}

/**
 * THE effective-style policy (PSOS-49/50, AD-26): the org's global modes
 * resolved against the writer's (enabled) profile toggles. "off" waives a
 * category for everyone — userId absent / profile missing included;
 * "enforced" ignores writer waivers; "writer_choice" defers to the profile.
 * Shared by generation, research, and proposal-apply paths so the precedence
 * contract cannot drift per call site.
 *
 * AD-26: this is the only place a category `tier` is computed —
 * `org_enforced` when the org mode is `enforced` or `off`, otherwise `none` —
 * and the profile is never silent: `profileState` says whether it applied,
 * and `requested` says which waivers the applied profile asked for, so a
 * waiver an `enforced` mode ignores is reported, not dropped.
 *
 * Story 3 (CAP-8): a detected settings document is applied as the Writer
 * Profile for that generation. When its whitespace-normalized text equals an
 * enabled saved profile's instructions the saved profile applies unchanged
 * (`matchesProfile`); otherwise the document replaces it, never merges
 * (`savedProfileSuperseded`). Build Order and cap rules are extracted from
 * the effective instruction text only where the source holds none
 * structurally (`undefined`; an explicitly stored `[]` stays empty).
 */
export async function getEffectiveWriterStyle(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | undefined,
  settingsDocument?: SettingsDocumentInput
): Promise<EffectiveWriterStyle> {
  const [modes, profile] = await Promise.all([
    getHouseRuleModes(ctx),
    userId
      ? ctx.db
          .query("writerProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique()
      : Promise.resolve(null),
  ]);
  const savedEnabled = profile !== null && profile.enabled;
  const matchesProfile =
    settingsDocument !== undefined &&
    profile !== null &&
    profile.enabled &&
    normalizeSettingsText(settingsDocument.text) ===
      normalizeSettingsText(profile.customInstructions);
  const document = settingsDocument !== undefined && !matchesProfile ? settingsDocument : undefined;

  let profileState: ProfileState;
  let instructions: string;
  let writerOverrides: StyleOverrides;
  let storedBuildOrder: string[] | undefined;
  let storedSelfCheckRules: SelfCheckRule[] | undefined;
  let settingsSource: WriterSettingsSource;
  if (document) {
    profileState = "applied";
    instructions = document.text.trim();
    writerOverrides = overridesFromCategories(document.addressedCategories);
    // A document holds no structured Build Order or Self-check rules.
    storedBuildOrder = undefined;
    storedSelfCheckRules = undefined;
    settingsSource = document.supplyPath;
  } else if (profile !== null && profile.enabled) {
    profileState = "applied";
    instructions = profile.customInstructions.trim();
    writerOverrides = normalizeStyleOverrides(profile.styleOverrides);
    storedBuildOrder = profile.buildOrder;
    storedSelfCheckRules = profile.selfCheckRules;
    settingsSource = "profile";
  } else {
    profileState = profile === null ? "missing" : "disabled";
    instructions = "";
    writerOverrides = NO_STYLE_OVERRIDES;
    storedBuildOrder = undefined;
    storedSelfCheckRules = undefined;
    settingsSource = "none";
  }
  const applied = profileState === "applied";

  const styleOverrides = resolveEffectiveOverrides(modes, writerOverrides);
  const categoryOutcomes: CategoryOutcome[] = STYLE_OVERRIDE_KEYS.map(
    (category) => ({
      category,
      mode: modes[category],
      effective: styleOverrides[category],
      tier:
        modes[category] === "enforced" || modes[category] === "off"
          ? ("org_enforced" as const)
          : ("none" as const),
      requested: writerOverrides[category],
    })
  );

  // Extraction fills only what the applied source does not hold structurally.
  const extracted =
    applied && (storedBuildOrder === undefined || storedSelfCheckRules === undefined)
      ? extractSettingsRules(instructions)
      : null;
  // A disabled or missing profile contributes no Build Order: the default
  // applies and profileState reports why. Only an applied profile's order
  // (stored or extracted) is validated, and only an invalid one carries a
  // fallback reason.
  const order = applied
    ? resolveBuildOrder(storedBuildOrder ?? extracted?.buildOrder)
    : { buildOrder: [...DEFAULT_BUILD_ORDER] as SectionNumber[] };
  const selfCheckRules = applied
    ? (storedSelfCheckRules ?? extracted?.selfCheckRules ?? [])
    : [];

  const savedProfileSuperseded = document !== undefined && savedEnabled;
  const profileReason =
    document && savedProfileSuperseded
      ? `Writer Profile applied from the settings document${document.fileName ? ` ${document.fileName}` : ""} ${settingsSupplyLabel(document.supplyPath)}; the saved Writer Profile was superseded for this generation`
      : undefined;
  return {
    customInstructions: instructions.length > 0 ? instructions : null,
    styleOverrides,
    settingsSource,
    savedProfileSuperseded,
    matchesProfile,
    profileState,
    categoryOutcomes,
    buildOrder: order.buildOrder,
    ...(order.fallbackReason
      ? { buildOrderFallbackReason: order.fallbackReason }
      : {}),
    selfCheckRules,
    ...(profileReason ? { profileReason } : {}),
    ...(document && document.addressedCategories === null
      ? { waiverAnalysisFailed: true }
      : {}),
  };
}

/**
 * Pipeline read: the requesting writer's instructions plus their EFFECTIVE
 * house-style waivers (see getEffectiveWriterStyle). Returns null only when
 * there is nothing to apply. Called from generation entry points inside a
 * try/catch — a failure here must never break generation. The ordered
 * generation context is a separate read (getGenerationProfileContext).
 */
export const getProfileForGeneration = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  returns: v.union(
    v.object({
      customInstructions: v.union(v.string(), v.null()),
      styleOverrides: normalizedStyleOverridesValidator,
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    const style = await getEffectiveWriterStyle(ctx, args.userId);
    if (
      style.customInstructions === null &&
      !hasAnyStyleOverride(style.styleOverrides)
    ) {
      return null;
    }
    return {
      customInstructions: style.customInstructions,
      styleOverrides: style.styleOverrides,
    };
  },
});

/**
 * Story 2 (CAP-5/6/9, AD-26): everything ordered generation reads from the
 * Writer Profile — profile state, per-category outcomes, the validated Build
 * Order (with its fallback reason) and the Self-check rules. Never null: a
 * missing or disabled profile still yields the House Rules default order.
 */
export const getGenerationProfileContext = internalQuery({
  args: { userId: v.optional(v.id("users")) },
  returns: orderedProfileContextValidator,
  handler: async (ctx, args): Promise<OrderedProfileContext> => {
    const style = await getEffectiveWriterStyle(ctx, args.userId);
    return pickOrderedProfileContext(style);
  },
});

// ─── Story 3 (CAP-6/8, AD-26): settings documents at generation entry ───────

/** Story 4's "no Writer Profile applied" line. */
export const NO_PROFILE_LINE = "No Writer Profile applied — House Rules in full.";

const settingsCandidateValidator = v.object({
  generationSourceId: v.id("generationSources"),
  projectDocumentId: v.optional(v.id("projectDocuments")),
  fileName: v.string(),
  supplyPath: settingsSupplyPathValidator,
  text: v.string(),
  truncated: v.boolean(),
  /** sha256 of `text`: the classifier cache key with the projectId. */
  contentHash: v.string(),
});

// Every frozen source a generation can hold: one transcript and one digest
// row per transcript, 50 context documents, and a writer Storyline.
const MAX_GENERATION_SOURCES = 2 * MAX_TRANSCRIPTS_PER_PROJECT + 52;

/** A cached waiver analysis at exactly this classifier version, or null. */
async function readSettingsAnalysis(
  ctx: QueryCtx | MutationCtx,
  key: { projectId: Id<"projects">; contentHash: string; classifierVersion: string }
) {
  return await ctx.db
    .query("settingsDocumentAnalyses")
    .withIndex("by_projectId_and_contentHash_and_classifierVersion", (q) =>
      q
        .eq("projectId", key.projectId)
        .eq("contentHash", key.contentHash)
        .eq("classifierVersion", key.classifierVersion)
    )
    .first();
}

/**
 * The settings document a generation would apply (trust floor and title
 * pattern in convex/lib/settingsDocument.ts), whether it equals the
 * requester's enabled saved profile, and its cached waiver analysis at the
 * caller's classifier version (a row at another version is never served).
 */
export const getSettingsDocumentCandidate = internalQuery({
  args: {
    generationId: v.id("generations"),
    userId: v.optional(v.id("users")),
    classifierVersion: v.string(),
  },
  returns: v.object({
    document: v.union(settingsCandidateValidator, v.null()),
    matchesProfile: v.boolean(),
    cachedAddressed: v.union(v.array(styleCategoryValidator), v.null()),
  }),
  handler: async (ctx, args) => {
    const none = { document: null, matchesProfile: false, cachedAddressed: null };
    const generation = await ctx.db.get(args.generationId);
    if (!generation) return none;
    const sources = await ctx.db
      .query("generationSources")
      .withIndex("by_generationId", (q) => q.eq("generationId", generation._id))
      .take(MAX_GENERATION_SOURCES);
    const detected = detectSettingsDocument(sources);
    if (!detected) return none;
    const contentHash = await sha256(detected.text);
    const userId = args.userId;
    const profile = userId
      ? await ctx.db
          .query("writerProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique()
      : null;
    const matchesProfile =
      profile !== null &&
      profile.enabled &&
      normalizeSettingsText(detected.text) ===
        normalizeSettingsText(profile.customInstructions);
    let cachedAddressed: StyleOverrideKey[] | null = null;
    if (!matchesProfile) {
      const cached = await readSettingsAnalysis(ctx, {
        projectId: generation.projectId,
        contentHash,
        classifierVersion: args.classifierVersion,
      });
      cachedAddressed = cached ? cached.addressedCategories : null;
    }
    return { document: { ...detected, contentHash }, matchesProfile, cachedAddressed };
  },
});

/**
 * Cache one classifier result per (projectId, contentHash, classifierVersion).
 * Idempotent: an existing row wins. The only writer of
 * `settingsDocumentAnalyses`.
 */
export const recordSettingsAnalysis = internalMutation({
  args: {
    projectId: v.id("projects"),
    contentHash: v.string(),
    classifierVersion: v.string(),
    addressedCategories: v.array(styleCategoryValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await readSettingsAnalysis(ctx, args);
    if (existing) return null;
    await ctx.db.insert("settingsDocumentAnalyses", {
      projectId: args.projectId,
      contentHash: args.contentHash,
      classifierVersion: args.classifierVersion,
      addressedCategories: [...new Set(args.addressedCategories)],
      analyzedAt: Date.now(),
    });
    return null;
  },
});

/** The effective style for a generation, settings document included. */
export const getGenerationWriterStyle = internalQuery({
  args: {
    userId: v.optional(v.id("users")),
    settingsDocument: v.optional(settingsDocumentInputValidator),
  },
  returns: effectiveWriterStyleValidator,
  handler: async (ctx, args): Promise<EffectiveWriterStyle> => {
    return await getEffectiveWriterStyle(ctx, args.userId, args.settingsDocument);
  },
});

/**
 * The Writer Profile a generation ran under, for the Brief's "no Writer
 * Profile applied" line and the save offer (story 4), and for the settings
 * page prefill. Null for an outsider, a missing generation, or a legacy row
 * with no record.
 */
export const getGenerationWriterSettings = query({
  args: { generationId: v.id("generations") },
  returns: v.union(
    v.null(),
    v.object({
      profileState: profileStateValidator,
      source: writerSettingsSourceValidator,
      fileName: v.optional(v.string()),
      matchesProfile: v.boolean(),
      savedProfileSuperseded: v.boolean(),
      waiverAnalysis: waiverAnalysisValidator,
      noProfileLine: v.union(v.string(), v.null()),
      offer: v.union(
        v.null(),
        v.object({
          supplyPath: settingsSupplyPathValidator,
          fileName: v.string(),
          text: v.string(),
          truncated: v.boolean(),
          addressedCategories: v.union(v.array(styleCategoryValidator), v.null()),
        })
      ),
    })
  ),
  handler: async (ctx, args) => {
    const generation = await ctx.db.get(args.generationId);
    if (
      !generation ||
      !(await getInternalProjectAccessOrNull(ctx, generation.projectId))
    ) {
      return null;
    }
    const record = generation.writerSettings;
    if (!record) return null;
    let offer: {
      supplyPath: SettingsSupplyPath;
      fileName: string;
      text: string;
      truncated: boolean;
      addressedCategories: StyleOverrideKey[] | null;
    } | null = null;
    const supplyPath =
      record.source === "writer_notes" || record.source === "attachment"
        ? record.source
        : null;
    if (supplyPath && record.generationSourceId) {
      const source = await ctx.db.get(record.generationSourceId);
      const text = source ? settingsDocumentText(source.content) : "";
      if (source && text) {
        offer = {
          supplyPath,
          fileName: record.fileName ?? parseSourceLabel(source.label).fileName,
          text,
          truncated: record.truncated,
          // Exactly the waivers this generation applied, recorded at
          // resolution; null when the analysis failed or is absent, so saving
          // the prefill never invents a waiver. The analysis cache is never
          // read here.
          addressedCategories: record.addressedCategories ?? null,
        };
      }
    }
    return {
      profileState: record.profileState,
      source: record.source,
      ...(record.fileName !== undefined ? { fileName: record.fileName } : {}),
      matchesProfile: record.matchesProfile,
      savedProfileSuperseded: record.savedProfileSuperseded,
      waiverAnalysis: record.waiverAnalysis,
      noProfileLine: record.profileState === "applied" ? null : NO_PROFILE_LINE,
      offer,
    };
  },
});
