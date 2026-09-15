import type { Doc, Id } from "../_generated/dataModel";
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
import {
  getCurrentUserOrNull,
  getInternalProjectAccessOrNull,
  requireInternalProjectAccess,
} from "./auth";

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
  if (!user || user.isAnonymous === true) {
    domainError("NOT_AUTHENTICATED", "Authentication required", { capability });
  }
  if (!user.role) {
    domainError("NOT_AUTHORIZED", "An active internal role is required", { capability });
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

// ─── Object-level capability helpers (2026-09-01 audit, findings S1/S2) ─────
// The capability matrix (shared/capabilities.ts) is the approved contract:
// `report.editProse` is Own for Consultants and All for Managers/Admins;
// `financial.read`/`financial.write` are None for Consultants. These helpers
// are the single enforcement points for those cells so every prose-writing
// and financial mutation shares one definition of "own".

/**
 * "Own" for report prose = the project's durable Owner (`projects.ownerId`)
 * or a Consultant currently assigned an OPEN work item on the project (the
 * contract's "assigned collaboration contexts"). `createdBy` is never
 * consulted: the creator is the initial Owner by amendment, and ownership
 * transfers move the right with `ownerId`.
 */
async function reportEditLevelAllows(
  ctx: CapabilityCtx,
  access: { project: Doc<"projects">; user: Doc<"users"> }
): Promise<boolean> {
  const { project, user } = access;
  const level = getEffectiveCapabilityLevel(user.role, "report.editProse");
  if (level === "all") return true;
  if (level === "own") {
    if (project.ownerId === user._id) return true;
    const openItems = await ctx.db
      .query("workItems")
      .withIndex("by_projectId_and_status", (q) =>
        q.eq("projectId", project._id).eq("status", "open")
      )
      .take(100);
    if (openItems.some((item) => item.assigneeId === user._id)) return true;
  }
  return false;
}

/**
 * Nullable twin of `requireReportEditAccess` (story 4: the Brief's `canEdit`).
 * The same decision, but an outsider or a caller without `report.editProse`
 * on this project gets `null` instead of an error.
 */
export async function getReportEditAccessOrNull(
  ctx: CapabilityCtx,
  projectId: Id<"projects">
) {
  const access = await getInternalProjectAccessOrNull(ctx, projectId);
  if (!access) return null;
  return (await reportEditLevelAllows(ctx, access)) ? access : null;
}

export async function requireReportEditAccess(
  ctx: CapabilityCtx,
  projectId: Id<"projects">
) {
  const access = await requireInternalProjectAccess(ctx, projectId);
  if (await reportEditLevelAllows(ctx, access)) return access;
  domainError(
    "NOT_AUTHORIZED",
    "Only the project owner, an assigned collaborator, a manager, or an administrator can edit this report",
    {
      capability: "report.editProse",
      effectiveLevel: getEffectiveCapabilityLevel(access.user.role, "report.editProse"),
    }
  );
}

/**
 * Owner decision (2026-09-15): a project's descriptive metadata (titles,
 * client name, industry, science code, project number, tags, fiscal
 * year-end) is edited by the same people who may edit its report prose —
 * the Owner, a writer currently handed off to via an open work item, or a
 * Manager/Admin. Delegates to `reportEditLevelAllows` so the rule has one
 * implementation and no separate capability key; only the message differs.
 * `bulkUpdateProjects` keeps its stricter owner-only Consultant scope on
 * purpose (mass-change safeguard) and does not use this gate.
 */
export async function requireProjectMetadataAccess(
  ctx: CapabilityCtx,
  projectId: Id<"projects">
) {
  const access = await requireInternalProjectAccess(ctx, projectId);
  if (await reportEditLevelAllows(ctx, access)) return access;
  domainError(
    "NOT_AUTHORIZED",
    "Only the project owner, an assigned collaborator, a manager, or an administrator can edit project details",
    {
      capability: "report.editProse",
      effectiveLevel: getEffectiveCapabilityLevel(access.user.role, "report.editProse"),
    }
  );
}

/** Nullable read gate for financial queries: internal access AND financial.read. */
export async function getFinancialReadAccessOrNull(
  ctx: CapabilityCtx,
  projectId: Id<"projects">
) {
  const access = await getInternalProjectAccessOrNull(ctx, projectId);
  if (!access || !hasCapability(access.user.role, "financial.read")) return null;
  return access;
}

/** Throwing write gate for financial mutations: internal access AND financial.write. */
export async function requireFinancialWriteAccess(
  ctx: CapabilityCtx,
  projectId: Id<"projects">
) {
  const access = await requireInternalProjectAccess(ctx, projectId);
  if (!hasCapability(access.user.role, "financial.write")) {
    domainError(
      "NOT_AUTHORIZED",
      "Financial data can be changed by managers and administrators only",
      { capability: "financial.write" }
    );
  }
  return access;
}
