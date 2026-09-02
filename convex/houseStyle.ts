/**
 * PSOS-50: org-level governance of the house writing rules.
 *
 * Admins set a global mode per waivable category ("writer_choice" |
 * "enforced" | "off"), stored as JSON in the appSettings row
 * "houseStyle.modes" (same key/value convention as the other admin-tunable
 * settings). Missing/malformed rows normalize to "writer_choice" — the
 * pre-governance default. The rule TEXT itself stays in shared/houseRules.ts
 * (code-reviewed changes only); these modes govern enforcement.
 */
import { query, mutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireCurrentUser, requireRole } from "./lib/auth";
import {
  normalizeHouseRuleModes,
  type HouseRuleModes,
} from "../shared/styleOverrides";

export const HOUSE_STYLE_MODES_KEY = "houseStyle.modes";

const modeValidator = v.union(
  v.literal("writer_choice"),
  v.literal("enforced"),
  v.literal("off")
);

const modesValidator = v.object({
  bannedWords: modeValidator,
  paragraphDensity: modeValidator,
  sentenceConstruction: modeValidator,
  repetitionCaps: modeValidator,
  openingClauses: modeValidator,
  reportSkeleton: modeValidator,
});

/** Shared db read — also used by writerProfiles and research. */
export async function getHouseRuleModes(
  ctx: QueryCtx | MutationCtx
): Promise<HouseRuleModes> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", HOUSE_STYLE_MODES_KEY))
    .unique();
  return normalizeHouseRuleModes(row?.value);
}

/** Admin page: current modes plus audit fields. */
export const getConfig = query({
  args: {},
  returns: v.object({
    modes: modesValidator,
    updatedAt: v.union(v.number(), v.null()),
    updatedBy: v.union(v.id("users"), v.null()),
  }),
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const row = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", HOUSE_STYLE_MODES_KEY))
      .unique();
    return {
      modes: normalizeHouseRuleModes(row?.value),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
    };
  },
});

/**
 * Any signed-in user: modes only. The settings page needs these to render
 * admin-locked toggles ("enforced") and org-wide waivers ("off") honestly.
 */
export const getModesForMe = query({
  args: {},
  returns: modesValidator,
  handler: async (ctx) => {
    await requireCurrentUser(ctx);
    return await getHouseRuleModes(ctx);
  },
});

/** Admin: set the global mode per category. Applies to everyone immediately. */
export const setModes = mutation({
  args: { modes: modesValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await requireRole(ctx, ["admin"]);
    const value = JSON.stringify(args.modes);
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", HOUSE_STYLE_MODES_KEY))
      .unique();
    const patch = { value, updatedBy: admin._id, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("appSettings", { key: HOUSE_STYLE_MODES_KEY, ...patch });
    return null;
  },
});
