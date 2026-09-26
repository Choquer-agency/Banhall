import type { Role } from "../../../shared/roles";

/**
 * TEMPORARY STUB (WS2 branch). WS1 owns this module (round 2 index,
 * section 4) and lands the real store with sessionStorage, enter, switchTo,
 * exit and undo. This stub keeps WS2's pages compiling against the same
 * contract: View as is presentation only, and `effectiveViewer` maps the
 * viewed role onto the stored vocabulary. Delete on rebase onto WS1 PR 1.
 */
export type ViewAsRole = "owner" | "admin" | "manager" | "consultant";

export const viewAs = $state<{ role: ViewAsRole | null }>({ role: null });

export type EffectiveViewer = {
  role: Role | null;
  isOwner: boolean;
  isDeveloper: boolean;
  viewing: boolean;
};

const VIEWED: Record<ViewAsRole, { role: Role; isOwner: boolean }> = {
  owner: { role: "admin", isOwner: true },
  admin: { role: "admin", isOwner: false },
  manager: { role: "manager", isOwner: false },
  consultant: { role: "writer", isOwner: false },
};

export function effectiveViewer(
  user: { role?: Role | null; isOwner?: boolean; isDeveloper?: boolean } | null | undefined,
): EffectiveViewer {
  if (viewAs.role && user?.isDeveloper === true) {
    return { ...VIEWED[viewAs.role], isDeveloper: false, viewing: true };
  }
  return {
    role: user?.role ?? null,
    isOwner: user?.isOwner === true,
    isDeveloper: user?.isDeveloper === true,
    viewing: false,
  };
}

export function enter(role: ViewAsRole) {
  viewAs.role = role;
}

export function exit() {
  viewAs.role = null;
}
