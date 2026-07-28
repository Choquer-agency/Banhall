import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  CAPABILITIES,
  ROLE_CAPABILITY_PRESETS,
  getCapabilityCell,
  getEffectiveCapabilityLevel,
  hasCapability,
  listCapabilityMatrix,
  type Capability,
  type CapabilityLevel,
  type CapabilityRole,
} from "../../shared/capabilities";
import { domainError } from "./contracts";
import { getCurrentUserOrNull } from "./auth";

export {
  CAPABILITIES,
  ROLE_CAPABILITY_PRESETS,
  getCapabilityCell,
  getEffectiveCapabilityLevel,
  hasCapability,
  listCapabilityMatrix,
};
export type { Capability, CapabilityLevel, CapabilityRole };

type CapabilityCtx = QueryCtx | MutationCtx;

export type CapabilityScope = {
  /**
   * Object-level facts already loaded by the caller. The helper never scans
   * projects or work items. An `own` capability without a matching user id
   * fails closed; transition, readiness, and audit invariants stay at the call
   * site when PSOS-27 migrates functions.
   */
  ownedBy?: readonly Id<"users">[];
};

export async function requireCapability(
  ctx: CapabilityCtx,
  capability: Capability,
  scope?: CapabilityScope
) {
  const user = await getCurrentUserOrNull(ctx);
  if (!user) {
    domainError("NOT_AUTHENTICATED", "Authentication required", { capability });
  }

  const level = getEffectiveCapabilityLevel(user.role, capability);
  if (level === "all") return { user, level } as const;
  if (level === "own" && scope?.ownedBy?.includes(user._id)) {
    return { user, level } as const;
  }

  domainError("NOT_AUTHORIZED", "You do not have permission to perform this action", {
    capability,
    effectiveLevel: level,
  });
}
