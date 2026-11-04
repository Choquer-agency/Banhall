/**
 * The drawer rail's one remembered choice: whether its Admin group is open
 * (round 2, B1 and B2). The desktop rail's width and collapse are gone (the
 * page frame, owner 2026-10-28): the rail is a fixed 80px and Mod \ collapses
 * the section sidebar instead (`sectionSidebar.svelte.ts`). Browser-local
 * presentation only, failing closed to the default.
 *
 * The key stays `banhall.workspaceRail.v3`; any `width` and `hidden` values an
 * older build stored there are read past and dropped on the next write.
 */

export const RAIL_PREFERENCES_KEY = "banhall.workspaceRail.v3";
export const PREVIOUS_RAIL_PREFERENCES_KEY = "banhall.workspaceRail.v2";

export type RailPreferences = {
  /**
   * Admin group open in the drawer. Only the last choice made off the admin
   * pages; on `/admin/*` the group opens regardless. Closed by default.
   */
  adminOpen: boolean;
};

export function defaultRailPreferences(): RailPreferences {
  return { adminOpen: false };
}

/** Fail-closed parse of the stored preference payload. */
export function parseRailPreferences(raw: string | null | undefined): RailPreferences {
  if (!raw) return defaultRailPreferences();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultRailPreferences();
    return { adminOpen: (parsed as { adminOpen?: unknown }).adminOpen === true };
  } catch {
    return defaultRailPreferences();
  }
}

export function serializeRailPreferences(preferences: RailPreferences): string {
  return JSON.stringify({ adminOpen: preferences.adminOpen === true });
}

export function loadRailPreferences(): RailPreferences {
  try {
    const current = localStorage.getItem(RAIL_PREFERENCES_KEY);
    if (current !== null) return parseRailPreferences(current);
    return parseRailPreferences(localStorage.getItem(PREVIOUS_RAIL_PREFERENCES_KEY));
  } catch {
    // Storage blocked (private mode, embedded contexts): session-only prefs.
    return defaultRailPreferences();
  }
}

/** Persist a change, merged over what is stored. */
export function persistRailPreferences(update: Partial<RailPreferences>): void {
  try {
    const preferences = { ...loadRailPreferences(), ...update };
    localStorage.setItem(RAIL_PREFERENCES_KEY, serializeRailPreferences(preferences));
  } catch {
    // Storage blocked: the in-memory preference still applies for the session.
  }
}
