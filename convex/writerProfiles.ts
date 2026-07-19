import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireCurrentUser, requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";

/**
 * Per-writer "flavor" (Phase A): free-text personal writing instructions,
 * injected as a bounded, lowest-priority block into the section-drafting
 * prompts (see convex/ai/pipeline.ts). The prompt framing guarantees CRA
 * structure, phrasing/banned-word rules, and length budgets always win.
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
// full ChatGPT prompt docs. This is only a backstop against runaway payloads.
const MAX_INSTRUCTIONS_CHARS = 40_000;

const profileValidator = v.object({
  _id: v.id("writerProfiles"),
  _creationTime: v.number(),
  userId: v.id("users"),
  customInstructions: v.string(),
  enabled: v.boolean(),
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
  updatedBy: Id<"users">
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
      updatedBy,
      updatedAt: now,
    });
    return existing._id;
  }
  return await ctx.db.insert("writerProfiles", {
    userId,
    customInstructions,
    enabled,
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
      user._id
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
      admin._id
    );
    return null;
  },
});

/**
 * Pipeline read: the requesting writer's instructions, or null when the
 * profile is missing, disabled, or empty. Called from generateReport inside
 * a try/catch — a failure here must never break generation.
 */
export const getProfileForGeneration = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("writerProfiles")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .unique();
    if (!profile || !profile.enabled) return null;
    const instructions = profile.customInstructions.trim();
    return instructions.length > 0 ? instructions : null;
  },
});
