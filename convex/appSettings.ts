/**
 * Admin-tunable app settings (one row per key). First setting: the default
 * generation model — used whenever a writer doesn't explicitly pick a model
 * (single/iterative modes, and the "Default" picker option). Falls back to
 * the registry default (shared/generationModels MODEL) when unset.
 */
import { mutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { requireRole } from "./lib/auth";
import { domainError } from "./lib/contracts";
import { MODEL, modelById } from "../shared/generationModels";

const DEFAULT_MODEL_KEY = "defaultModel";

export async function defaultModelId(ctx: QueryCtx | MutationCtx): Promise<string> {
  const row = await ctx.db
    .query("appSettings")
    .withIndex("by_key", (q) => q.eq("key", DEFAULT_MODEL_KEY))
    .unique();
  // A stale setting (model removed from the registry) falls back to the
  // registry default rather than breaking generations.
  return row && modelById(row.value) ? row.value : MODEL;
}

export const getDefaultModel = internalQuery({
  args: {},
  handler: async (ctx) => defaultModelId(ctx),
});

export const setDefaultModel = mutation({
  args: { modelId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, ["admin"]);
    if (!modelById(args.modelId)) {
      domainError("INVALID_INPUT", "Unknown model id");
    }
    const now = Date.now();
    const existing = await ctx.db
      .query("appSettings")
      .withIndex("by_key", (q) => q.eq("key", DEFAULT_MODEL_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.modelId,
        updatedBy: user._id,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("appSettings", {
        key: DEFAULT_MODEL_KEY,
        value: args.modelId,
        updatedBy: user._id,
        updatedAt: now,
      });
    }
  },
});
