// Search continuity + truthful shortcut copy for the workspace header.
//
// 1) Shortcut hint. Both search shortcuts accept Meta OR Control, but the
//    visible hint previously lied on one platform ("⌃K" in the header,
//    "⌘K" in the standalone field). The hint now names the key the user's
//    platform actually favours — never two different glyphs for one action.
//
// 2) Search handoff. `/my-work` and `/projects` are separate routes, so
//    typing a query from My Work (search is project discovery and navigates
//    to Projects) remounts WorkspaceDashboard and would drop the in-flight
//    query. The handoff stashes the query across that one client-side
//    remount. Deliberately NOT URL state: the approved URL surface for the
//    projects view is `layout`/`group`/`hideEmpty`/`client` only.

export function searchShortcutHint(
  platform: string = typeof navigator !== "undefined" ? navigator.platform : ""
): string {
  return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘K" : "Ctrl K";
}

/** Stale stashes are discarded — continuity is for an immediate remount,
 * never a resurrected query minutes later. */
export const SEARCH_HANDOFF_TTL_MS = 5_000;

let stashed: { value: string; at: number } | null = null;

export function stashWorkspaceSearch(value: string, now: number = Date.now()): void {
  stashed = value ? { value, at: now } : null;
}

export function takeWorkspaceSearch(now: number = Date.now()): string {
  const current = stashed;
  stashed = null;
  if (!current || now - current.at > SEARCH_HANDOFF_TTL_MS) return "";
  return current.value;
}

// 3) Focus handoff (2026-08-10 chrome-less Home). Home renders no search
//    field: invoking search there (rail button, ⌘K) navigates to /projects,
//    which remounts WorkspaceDashboard. This one-shot intent survives that
//    remount so the Projects header can focus its search field on arrival.
//    Same TTL discipline as the query stash.
let focusIntentAt: number | null = null;

export function stashWorkspaceSearchFocus(now: number = Date.now()): void {
  focusIntentAt = now;
}

export function takeWorkspaceSearchFocus(now: number = Date.now()): boolean {
  const at = focusIntentAt;
  focusIntentAt = null;
  return at !== null && now - at <= SEARCH_HANDOFF_TTL_MS;
}
