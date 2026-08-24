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
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
  type StyleOverrides,
} from "../shared/styleOverrides";
import { getHouseRuleModes } from "./houseStyle";

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

async function upsertProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  customInstructions: string,
  enabled: boolean,
  updatedBy: Id<"users">,
  // undefined = caller did not send the field (e.g. a stale client) — preserve
  // whatever waivers are stored rather than silently resetting them.
  styleOverrides: StyleOverrides | undefined
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("writerProfiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, {
      customInstructions,
      enabled,
      ...(styleOverrides !== undefined ? { styleOverrides } : {}),
      updatedBy,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("writerProfiles", {
    userId,
    customInstructions,
    enabled,
    ...(styleOverrides !== undefined ? { styleOverrides } : {}),
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
        : normalizeStyleOverrides(args.styleOverrides)
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
        : normalizeStyleOverrides(args.styleOverrides)
    );
    return null;
  },
});

/**
 * THE effective-style policy (PSOS-49/50): the org's global modes resolved
 * against the writer's (enabled) profile toggles. "off" waives a category for
 * everyone — userId absent / profile missing included; "enforced" ignores
 * writer waivers; "writer_choice" defers to the profile. Shared by generation
 * (via getProfileForGeneration), research, and proposal-apply paths so the
 * precedence contract cannot drift per call site.
 */
export async function getEffectiveWriterStyle(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users"> | undefined
): Promise<{ customInstructions: string | null; styleOverrides: StyleOverrides }> {
  const [modes, profile] = await Promise.all([
    getHouseRuleModes(ctx),
    userId
      ? ctx.db
          .query("writerProfiles")
          .withIndex("by_userId", (q) => q.eq("userId", userId))
          .unique()
      : Promise.resolve(null),
  ]);
  const applyProfile = profile !== null && profile.enabled;
  const instructions = applyProfile ? profile.customInstructions.trim() : "";
  const writerOverrides = applyProfile
    ? normalizeStyleOverrides(profile.styleOverrides)
    : NO_STYLE_OVERRIDES;
  return {
    customInstructions: instructions.length > 0 ? instructions : null,
    styleOverrides: resolveEffectiveOverrides(modes, writerOverrides),
  };
}

/**
 * Pipeline read: the requesting writer's instructions plus their EFFECTIVE
 * house-style waivers (see getEffectiveWriterStyle). Returns null only when
 * there is nothing to apply. Called from generation entry points inside a
 * try/catch — a failure here must never break generation.
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
    return style;
  },
});
