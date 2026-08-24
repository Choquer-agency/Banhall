import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import {
  hasAnyStyleOverride,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { waivedCategoryLabels } from "./prompts";

/**
 * PSOS-49: the ONE policy for resolving a requesting writer's saved style
 * (free-text flavor + house-style waivers) at a generation entry point.
 * Shared by the one-shot pipeline and the iterative flow so their waiver
 * semantics cannot drift. Wrapped so a profile failure can NEVER break
 * generation; both fields are undefined when there is nothing to apply.
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
      await log("Applying the requesting writer's personal style preferences.");
    }
    const overrides = normalizeStyleOverrides(profile.styleOverrides);
    if (hasAnyStyleOverride(overrides)) {
      result.styleOverrides = overrides;
      // Neutral copy: a waiver may come from the writer's profile OR an
      // org-wide mode set by an admin.
      await log(
        `Waiving default house-style rules: ${waivedCategoryLabels(overrides).join("; ")}.`
      );
    }
  } catch (err) {
    console.error("writer style fetch failed for generation", err);
  }
  return result;
}
