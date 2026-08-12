export const PROJECT_COLUMN_IDS = [
  "clientName",
  "stage",
  "owner",
  "generationActivity",
  "updated",
] as const;

export type ProjectColumnId = (typeof PROJECT_COLUMN_IDS)[number];
export type ProjectTableDensity = "comfortable" | "compact";
export type ProjectLayoutMode = "board" | "list";
/**
 * Client → Status grouping projection (2026-08-06 second amendment): valid
 * on BOTH layouts. "client" groups the List into client sections with status
 * sub-headers and the Board into stacked client lanes with a focused
 * single-client drill-in, via the server projections
 * (dashboard.listCompanies / listCompanyProjectsByStageRank — index-backed,
 * paginated). It is a display grouping of free-text client names, never
 * durable Client identity.
 */
export type ProjectGroupMode = "none" | "client";

export type ProjectsTablePreferences = {
  layout: ProjectLayoutMode;
  density: ProjectTableDensity;
  group: ProjectGroupMode;
  columns: Record<ProjectColumnId, boolean>;
  /**
   * "Hide empty stages" on the global stage-first Board (2026-08-06 second
   * amendment). Default OFF — all ten canonical stages render. The hide
   * criterion is the bounded facet count (never loaded rows).
   */
  hideEmptyBoard: boolean;
  /**
   * "Hide empty stages" inside client-scoped surfaces (List sub-sections,
   * client lanes, the focused client board). Default ON — structural
   * sparsity makes it load-bearing. The hide criterion is the exact
   * per-client stageCounts record; while it is absent (not yet backfilled)
   * nothing is hidden regardless of this preference.
   */
  hideEmptyClientGroups: boolean;
};

export const DEFAULT_PROJECTS_TABLE_PREFERENCES: ProjectsTablePreferences = {
  layout: "board",
  density: "comfortable",
  group: "none",
  columns: {
    clientName: true,
    stage: true,
    owner: true,
    generationActivity: true,
    updated: true,
  },
  // 2026-08-10 owner direction: empty stages hide by default on the global
  // board too (supersedes the 2026-08-06 board-OFF default); the disclosure
  // affordance keeps hidden stages reachable.
  hideEmptyBoard: true,
  hideEmptyClientGroups: true,
};

export function parseProjectsTablePreferences(raw: string | null): ProjectsTablePreferences {
  if (!raw) return structuredClone(DEFAULT_PROJECTS_TABLE_PREFERENCES);
  try {
    const parsed = JSON.parse(raw) as Partial<ProjectsTablePreferences> & { layout?: string };
    // The workflow-stage Board is the canonical default (product-domain
    // amendment 2026-08-05). `grid` was a briefly shipped experimental value;
    // stored copies migrate to board rather than stranding returning users
    // on a retired layout.
    const layout = parsed.layout === "list" ? "list" : "board";
    const density = parsed.density === "compact" ? "compact" : "comfortable";
    // Fail closed: anything but the known "client" grouping falls back to the
    // flat List.
    const group = parsed.group === "client" ? "client" : "none";
    const columns = { ...DEFAULT_PROJECTS_TABLE_PREFERENCES.columns };
    for (const id of PROJECT_COLUMN_IDS) {
      if (typeof parsed.columns?.[id] === "boolean") columns[id] = parsed.columns[id];
    }
    // Fail closed: anything but an explicit boolean falls back to the
    // documented defaults (hide-empty ON everywhere, 2026-08-10).
    const hideEmptyBoard =
      typeof parsed.hideEmptyBoard === "boolean"
        ? parsed.hideEmptyBoard
        : DEFAULT_PROJECTS_TABLE_PREFERENCES.hideEmptyBoard;
    const hideEmptyClientGroups =
      typeof parsed.hideEmptyClientGroups === "boolean"
        ? parsed.hideEmptyClientGroups
        : DEFAULT_PROJECTS_TABLE_PREFERENCES.hideEmptyClientGroups;
    return { layout, density, group, columns, hideEmptyBoard, hideEmptyClientGroups };
  } catch {
    return structuredClone(DEFAULT_PROJECTS_TABLE_PREFERENCES);
  }
}

export function parseProjectLayoutParam(raw: string | null): ProjectLayoutMode | null {
  if (raw === "list") return "list";
  // `grid` is the retired experimental value; saved links resolve to board.
  if (raw === "board" || raw === "grid") return "board";
  return null;
}

export function withProjectLayoutParam(url: URL, layout: ProjectLayoutMode) {
  const next = new URL(url);
  next.searchParams.set("layout", layout);
  return next;
}

export function parseProjectGroupParam(raw: string | null): ProjectGroupMode | null {
  if (raw === "client") return "client";
  if (raw === "none") return "none";
  // Unknown values fail closed to "no opinion" — preference/default apply.
  return null;
}

export function withProjectGroupParam(url: URL, group: ProjectGroupMode) {
  const next = new URL(url);
  if (group === "none") next.searchParams.delete("group");
  else next.searchParams.set("group", group);
  return next;
}

/**
 * URL param for the Board hide-empty display option (`?hideEmpty=0|1`).
 * Fail-closed: anything unrecognized is "no opinion" (preference applies).
 * URL wins over the stored preference (same contract as `?layout`/`?group`).
 */
export function parseHideEmptyParam(raw: string | null): boolean | null {
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

export function withHideEmptyParam(url: URL, hideEmpty: boolean | null) {
  const next = new URL(url);
  if (hideEmpty === null) next.searchParams.delete("hideEmpty");
  else next.searchParams.set("hideEmpty", hideEmpty ? "1" : "0");
  return next;
}

/**
 * Focused-client board param (`?client=<companyKey>`): a recorded-client-name
 * projection key, never a durable Client id. Fail-closed to "no focus" on
 * empty values.
 */
export function parseClientFocusParam(raw: string | null): string | null {
  const value = raw?.trim();
  return value ? value : null;
}

export function withClientFocusParam(url: URL, companyKey: string | null) {
  const next = new URL(url);
  if (companyKey === null) next.searchParams.delete("client");
  else next.searchParams.set("client", companyKey);
  return next;
}

export function serializeProjectsTablePreferences(preferences: ProjectsTablePreferences) {
  return JSON.stringify(preferences);
}
