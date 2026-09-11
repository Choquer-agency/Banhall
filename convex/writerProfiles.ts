import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
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
  type StyleOverrides,
} from "../shared/styleOverrides";
import { getHouseRuleModes } from "./houseStyle";
import {
  DEFAULT_BUILD_ORDER,
  MAX_SELF_CHECK_INSTRUCTION_CHARS,
  MAX_SELF_CHECK_RULES,
  orderedProfileContextValidator,
  resolveBuildOrder,
  selfCheckRuleValidator,
  type CategoryOutcome,
  type OrderedProfileContext,
  type ProfileState,
  type SectionNumber,
  type SelfCheckRule,
} from "./lib/orderedChain";

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
      args.buildOrder,
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
      args.buildOrder,
      args.selfCheckRules === undefined
        ? undefined
        : validateSelfCheckRules(args.selfCheckRules)
    );
    return null;
  },
});

export type EffectiveWriterStyle = {
  customInstructions: string | null;
  styleOverrides: StyleOverrides;
} & OrderedProfileContext;

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
 * and the profile is never silent: `profileState` says whether it applied.
 */
export async function getEffectiveWriterStyle(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | undefined
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
  const profileState: ProfileState =
    profile === null ? "missing" : profile.enabled ? "applied" : "disabled";
  const applyProfile = profile !== null && profile.enabled;
  const instructions = applyProfile ? profile.customInstructions.trim() : "";
  const writerOverrides = applyProfile
    ? normalizeStyleOverrides(profile.styleOverrides)
    : NO_STYLE_OVERRIDES;
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
    })
  );
  // A disabled or missing profile contributes no Build Order: the default
  // applies and profileState reports why. Only an applied profile's stored
  // order is validated, and only its invalid order carries a fallback reason.
  const order = applyProfile
    ? resolveBuildOrder(profile.buildOrder)
    : { buildOrder: [...DEFAULT_BUILD_ORDER] as SectionNumber[] };
  return {
    customInstructions: instructions.length > 0 ? instructions : null,
    styleOverrides,
    profileState,
    categoryOutcomes,
    buildOrder: order.buildOrder,
    ...(order.fallbackReason
      ? { buildOrderFallbackReason: order.fallbackReason }
      : {}),
    selfCheckRules: applyProfile ? (profile.selfCheckRules ?? []) : [],
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
    return {
      profileState: style.profileState,
      categoryOutcomes: style.categoryOutcomes,
      buildOrder: style.buildOrder,
      ...(style.buildOrderFallbackReason
        ? { buildOrderFallbackReason: style.buildOrderFallbackReason }
        : {}),
      selfCheckRules: style.selfCheckRules,
    };
  },
});
