/**
 * Named view presets for the Projects view (2026-08-13, Attio-research P1).
 *
 * A preset is a browser-local, named snapshot of the five display axes the
 * view already persists (layout / group / density / columns / hide-empty)
 * plus the two flat-view filters (stage, owner). Deliberately NOT a server
 * feature: presets ride the same fail-closed localStorage discipline as
 * `projectsTablePreferences`, and applying one simply writes those existing
 * preferences — no new query shapes, no shared state, no URL surface.
 */
import {
  DEFAULT_PROJECTS_TABLE_PREFERENCES,
  parseProjectsTablePreferences,
  type ProjectsTablePreferences,
} from "$lib/dashboard/projectsTablePreferences";

export type ProjectsViewPreset = {
  /** Trimmed, non-empty, unique per store (case-insensitive). */
  name: string;
  preferences: ProjectsTablePreferences;
  /** Flat-view filters captured with the preset (optional axes). */
  stage: string | null;
  ownerId: string | null;
  ownerLabel: string | null;
};

export const PROJECTS_VIEW_PRESETS_KEY = "banhall_projects_view_presets";
export const MAX_PRESETS = 12;
export const MAX_PRESET_NAME_LENGTH = 40;

export function parseViewPresets(raw: string | null): ProjectsViewPreset[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const presets: ProjectsViewPreset[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null) continue;
      const name =
        typeof (entry as { name?: unknown }).name === "string"
          ? (entry as { name: string }).name.trim().slice(0, MAX_PRESET_NAME_LENGTH)
          : "";
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      // Preferences re-parse through the canonical fail-closed parser so a
      // stale stored preset can never smuggle retired values back in.
      const preferences = parseProjectsTablePreferences(
        JSON.stringify((entry as { preferences?: unknown }).preferences ?? null)
      );
      const str = (v: unknown) => (typeof v === "string" && v ? v : null);
      presets.push({
        name,
        preferences,
        stage: str((entry as { stage?: unknown }).stage),
        ownerId: str((entry as { ownerId?: unknown }).ownerId),
        ownerLabel: str((entry as { ownerLabel?: unknown }).ownerLabel),
      });
      if (presets.length >= MAX_PRESETS) break;
    }
    return presets;
  } catch {
    return [];
  }
}

export function loadViewPresets(): ProjectsViewPreset[] {
  try {
    return parseViewPresets(localStorage.getItem(PROJECTS_VIEW_PRESETS_KEY));
  } catch {
    return [];
  }
}

export function persistViewPresets(presets: ProjectsViewPreset[]): void {
  try {
    localStorage.setItem(PROJECTS_VIEW_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Storage unavailable (private mode, quota): presets simply don't stick.
  }
}

/** Upsert by case-insensitive name; newest lands at the top of the list. */
export function saveViewPreset(
  presets: ProjectsViewPreset[],
  preset: ProjectsViewPreset
): ProjectsViewPreset[] {
  const name = preset.name.trim().slice(0, MAX_PRESET_NAME_LENGTH);
  if (!name) return presets;
  const rest = presets.filter((p) => p.name.toLowerCase() !== name.toLowerCase());
  return [{ ...preset, name }, ...rest].slice(0, MAX_PRESETS);
}

export function deleteViewPreset(
  presets: ProjectsViewPreset[],
  name: string
): ProjectsViewPreset[] {
  return presets.filter((p) => p.name.toLowerCase() !== name.trim().toLowerCase());
}

/** True when the preset describes exactly the given live view state. */
export function presetMatches(
  preset: ProjectsViewPreset,
  preferences: ProjectsTablePreferences,
  stage: string | null,
  ownerId: string | null
): boolean {
  return (
    JSON.stringify(preset.preferences) === JSON.stringify(preferences) &&
    (preset.stage ?? null) === (stage ?? null) &&
    (preset.ownerId ?? null) === (ownerId ?? null)
  );
}

/** The unnamed baseline every store starts from. */
export function defaultViewState(): {
  preferences: ProjectsTablePreferences;
  stage: string | null;
  ownerId: string | null;
} {
  return {
    preferences: structuredClone(DEFAULT_PROJECTS_TABLE_PREFERENCES),
    stage: null,
    ownerId: null,
  };
}
