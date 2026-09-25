/**
 * Desktop workspace-rail ergonomics preferences (2026-08-08 amendment,
 * docs/product-domain.md + docs/design-system.md): the fir navigation rail
 * is pointer- and keyboard-resizable and can fully hide/show. Width and
 * hidden state are browser-local presentation preferences (like the board
 * layout preference) and fail closed to the documented defaults — never a
 * server-side or domain concern.
 *
 * Contract:
 * - width clamps to [RAIL_MIN_WIDTH, RAIL_MAX_WIDTH]; default 200 (the
 *   owner-approved rail of ui-design-final.md, boards 1.1 and 1.2).
 * - hidden is independent of width: showing the rail restores the previously
 *   persisted expanded width.
 * - parse is fail-closed: any malformed/foreign value yields the defaults.
 */

export const RAIL_MIN_WIDTH = 180;
export const RAIL_DEFAULT_WIDTH = 200;
export const RAIL_MAX_WIDTH = 288;

/**
 * Collapsed desktop rail: an icons-only column (ui-design-final.md section 2,
 * board 1.2). The persisted `hidden` key keeps its name for compatibility and
 * now means "collapsed"; expanding restores the last expanded width.
 */
export const RAIL_COLLAPSED_WIDTH = 56;

/** Arrow-key resize step on the keyboard separator; Shift multiplies. */
export const RAIL_KEYBOARD_STEP = 8;
export const RAIL_KEYBOARD_STEP_LARGE = 32;

/**
 * v2 (2026-09-25): the default width moved from 275px to the boards' 200px.
 * Every browser had persisted the old default, so widths saved under the
 * legacy key are dropped; only the collapsed choice carries over.
 */
export const RAIL_PREFERENCES_KEY = "banhall.workspaceRail.v2";
export const LEGACY_RAIL_PREFERENCES_KEY = "banhall.workspaceRail";

export type RailPreferences = {
  /** Expanded rail width in px, always within [min, max]. */
  width: number;
  /** Rail fully hidden (desktop only; the mobile drawer is independent). */
  hidden: boolean;
};

export function defaultRailPreferences(): RailPreferences {
  return { width: RAIL_DEFAULT_WIDTH, hidden: false };
}

/** Clamp + round any candidate width; non-finite input falls to the default. */
export function clampRailWidth(width: number): number {
  if (!Number.isFinite(width)) return RAIL_DEFAULT_WIDTH;
  return Math.min(RAIL_MAX_WIDTH, Math.max(RAIL_MIN_WIDTH, Math.round(width)));
}

/** Fail-closed parse of the persisted preference payload. */
export function parseRailPreferences(raw: string | null | undefined): RailPreferences {
  const defaults = defaultRailPreferences();
  if (!raw) return defaults;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaults;
    const candidate = parsed as { width?: unknown; hidden?: unknown };
    return {
      width:
        typeof candidate.width === "number" ? clampRailWidth(candidate.width) : defaults.width,
      hidden: candidate.hidden === true,
    };
  } catch {
    return defaults;
  }
}

export function serializeRailPreferences(preferences: RailPreferences): string {
  return JSON.stringify({
    width: clampRailWidth(preferences.width),
    hidden: preferences.hidden === true,
  });
}

export function loadRailPreferences(): RailPreferences {
  try {
    const current = localStorage.getItem(RAIL_PREFERENCES_KEY);
    if (current === null) {
      const legacy = parseRailPreferences(localStorage.getItem(LEGACY_RAIL_PREFERENCES_KEY));
      return { width: RAIL_DEFAULT_WIDTH, hidden: legacy.hidden };
    }
    return parseRailPreferences(current);
  } catch {
    // Storage blocked (private mode, embedded contexts) — session-only prefs.
    return defaultRailPreferences();
  }
}

export function persistRailPreferences(preferences: RailPreferences): void {
  try {
    localStorage.setItem(RAIL_PREFERENCES_KEY, serializeRailPreferences(preferences));
  } catch {
    // Storage blocked — the in-memory preference still applies for the session.
  }
}

/**
 * Resolve an arrow/Home/End key on the separator to the next width, or null
 * when the key is not a resize key. Directions follow the visual edge: the
 * separator sits on the rail's right edge, so ArrowRight widens.
 */
export function railWidthForKey(
  key: string,
  currentWidth: number,
  shiftKey: boolean
): number | null {
  const step = shiftKey ? RAIL_KEYBOARD_STEP_LARGE : RAIL_KEYBOARD_STEP;
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return clampRailWidth(currentWidth + step);
    case "ArrowLeft":
    case "ArrowDown":
      return clampRailWidth(currentWidth - step);
    case "Home":
      return RAIL_MIN_WIDTH;
    case "End":
      return RAIL_MAX_WIDTH;
    default:
      return null;
  }
}
