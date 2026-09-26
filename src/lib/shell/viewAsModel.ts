/**
 * View as (round 2, D1 to D5): the pure model behind `viewAs.svelte.ts`.
 *
 * View as is presentation only (decision 53): it changes the rail, the page
 * gates and a few role-dependent labels in this browser tab. Every query and
 * mutation still runs with the developer's real access, so nothing here is
 * an authorization decision. Only developers can enter it; for anyone else a
 * stored value is ignored.
 */
import type { Role } from "../../../shared/roles";

export type ViewAsRole = "owner" | "admin" | "manager" | "consultant";

export const VIEW_AS_ROLES: readonly ViewAsRole[] = ["owner", "admin", "manager", "consultant"];

export const VIEW_AS_LABELS: Record<ViewAsRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  consultant: "Consultant",
};

/** Plural for the D4 hidden page body ("Consultants cannot open Admin"). */
export const VIEW_AS_PLURALS: Record<ViewAsRole, string> = {
  owner: "Owners",
  admin: "Admins",
  manager: "Managers",
  consultant: "Consultants",
};

/** Tab-scoped (sessionStorage), so it survives a reload but not a new tab. */
export const VIEW_AS_STORAGE_KEY = "banhall.viewAs.v1";

export type ViewAsState = {
  role: ViewAsRole | null;
  /** What `undo` restores (the D3 toast's Undo); undefined when nothing to undo. */
  previous?: ViewAsRole | null;
};

export function parseViewAsRole(raw: string | null | undefined): ViewAsRole | null {
  return VIEW_AS_ROLES.includes(raw as ViewAsRole) ? (raw as ViewAsRole) : null;
}

export function enterViewAs(state: ViewAsState, role: ViewAsRole): ViewAsState {
  return { role, previous: state.role };
}

export function exitViewAs(state: ViewAsState): ViewAsState {
  return { role: null, previous: state.role };
}

export function undoViewAs(state: ViewAsState): ViewAsState {
  if (state.previous === undefined) return state;
  return { role: state.previous, previous: undefined };
}

export type RealViewer = {
  role?: Role | null;
  isOwner?: boolean | null;
  isDeveloper?: boolean | null;
} | null | undefined;

export type EffectiveViewer = {
  role: Role | null;
  isOwner: boolean;
  isDeveloper: boolean;
  /** The View as role in force, or null when the developer sees their own view. */
  viewing: ViewAsRole | null;
};

const VIEW_AS_TO_ROLE: Record<ViewAsRole, Role> = {
  owner: "admin",
  admin: "admin",
  manager: "manager",
  consultant: "writer",
};

/**
 * The viewer every rail and page-gate decision reads. Owner maps to the Admin
 * role plus the Owner flag; Consultant to the stored `writer` role. While
 * viewing, the developer flag is off so developer-only navigation hides too.
 */
export function effectiveViewer(user: RealViewer, viewAsRole: ViewAsRole | null): EffectiveViewer {
  const real: EffectiveViewer = {
    role: user?.role ?? null,
    isOwner: user?.isOwner === true,
    isDeveloper: user?.isDeveloper === true,
    viewing: null,
  };
  if (!viewAsRole || !real.isDeveloper) return real;
  return {
    role: VIEW_AS_TO_ROLE[viewAsRole],
    isOwner: viewAsRole === "owner",
    isDeveloper: false,
    viewing: viewAsRole,
  };
}
