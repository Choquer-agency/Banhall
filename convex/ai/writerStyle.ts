import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import {
  DEFAULT_BUILD_ORDER,
  type OrderedProfileContext,
} from "../lib/orderedChain";
import { waivedCategoryLabels } from "./prompts";

/**
 * The two progress-log lines for an applied Writer Profile. Shared with the
 * writer-settings resolver (convex/ai/writerSettings.ts) so the saved-profile
 * read and the resolver cannot drift.
 */
export const APPLYING_WRITER_STYLE_LOG =
  "Applying the requesting writer's personal style preferences.";
export function waivingHouseRulesLog(overrides: StyleOverrides): string {
  // Neutral copy: a waiver may come from the writer's profile OR an
  // org-wide mode set by an admin.
  return `Waiving default house-style rules: ${waivedCategoryLabels(overrides).join("; ")}.`;
}

/**
 * PSOS-49: the saved-profile read of a requesting writer's style (free-text
 * flavor + house-style waivers). Story 3: generation entry points resolve
 * writer settings through convex/ai/writerSettings.ts, which also applies a
 * settings document; this read is only its degrade path. Wrapped so a
 * profile failure can NEVER break generation; both fields are undefined when
 * there is nothing to apply.
 */
export async function fetchWriterStyle(
  ctx: Pick<ActionCtx, "runQuery">,
  requestedBy: Id<"users"> | undefined,
  log: (line: string) => Promise<unknown>
): Promise<{ writerFlavor?: string; styleOverrides?: StyleOverrides }> {
  const result: { writerFlavor?: string; styleOverrides?: StyleOverrides } = {};
  try {
    // Called even without a requestedBy: org-wide "off" modes (PSOS-50)
    // apply to legacy generations with no recorded requester too.
    const profile = await ctx.runQuery(
      internal.writerProfiles.getProfileForGeneration,
      requestedBy ? { userId: requestedBy } : {}
    );
    if (!profile) return result;
    if (profile.customInstructions) {
      result.writerFlavor = profile.customInstructions;
      await log(APPLYING_WRITER_STYLE_LOG);
    }
    const overrides = normalizeStyleOverrides(profile.styleOverrides);
    if (hasAnyStyleOverride(overrides)) {
      result.styleOverrides = overrides;
      await log(waivingHouseRulesLog(overrides));
    }
  } catch (err) {
    console.error("writer style fetch failed for generation", err);
  }
  return result;
}

/**
 * Story 2 (CAP-5/6, AD-26): the ordered-generation profile context from the
 * saved profile. Never fails generation: an unreadable profile degrades to
 * the House Rules default order with the reason recorded. The candidate
 * fallback for payloads without an ordered context, and the writer-settings
 * resolver's degrade path.
 */
export async function readOrderedProfileContext(
  ctx: Pick<ActionCtx, "runQuery">,
  requestedBy: Id<"users"> | undefined
): Promise<OrderedProfileContext> {
  try {
    return await ctx.runQuery(
      internal.writerProfiles.getGenerationProfileContext,
      requestedBy ? { userId: requestedBy } : {}
    );
  } catch (error) {
    console.error("ordered profile context read failed", error);
    return {
      profileState: "missing",
      categoryOutcomes: [],
      buildOrder: [...DEFAULT_BUILD_ORDER],
      buildOrderFallbackReason:
        "the Writer Profile could not be read; House Rules default 242 → 244 → 246 used",
      selfCheckRules: [],
    };
  }
}
