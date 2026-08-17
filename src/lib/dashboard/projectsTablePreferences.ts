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
export type ClientProjectSort = "project_number" | "created" | "updated";
/**
 * Client → Status grouping projection (2026-08-06 second amendment; Focus
 * drill-in retired 2026-08-12): valid on BOTH layouts. "client" groups the
 * List into client sections with status sub-headers and the Board into
 * stacked client lanes (each a horizontal row of all loaded project cards),
 * via the server projections (dashboard.listCompanies /
 * listCompanyProjectsByStageRank — index-backed, paginated). It is a display
 * grouping of free-text client names, never durable Client identity.
 */
export type ProjectGroupMode = "none" | "client";

export type ProjectsTablePreferences = {
  layout: ProjectLayoutMode;
  density: ProjectTableDensity;
  group: ProjectGroupMode;
  /** Sort inside each loaded Client → Fiscal year section. */
  clientSort: ClientProjectSort;
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
  // 2026-08-13 owner direction: the client-grouped List is the default
  // presentation (supersedes the 2026-08-05 board-default amendment). The
  // Board and flat views remain one toggle away and stored preferences win.
  layout: "list",
  density: "comfortable",
  group: "client",
  clientSort: "project_number",
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
    // Explicit stored choices win; anything unrecognized falls back to the
    // default (client-grouped List, 2026-08-13 owner direction). `grid` was a
    // briefly shipped experimental value; stored copies migrate to board
    // rather than stranding returning users on a retired layout.
    const rawLayout: string | undefined = parsed.layout;
    const layout =
      rawLayout === "board" || rawLayout === "grid"
        ? "board"
        : rawLayout === "list"
          ? "list"
          : DEFAULT_PROJECTS_TABLE_PREFERENCES.layout;
    const density = parsed.density === "compact" ? "compact" : "comfortable";
    // Explicit "none" (flat) is a real stored choice; unknown values fail
    // closed to the default grouping.
    const group =
      parsed.group === "client"
        ? "client"
        : parsed.group === "none"
          ? "none"
          : DEFAULT_PROJECTS_TABLE_PREFERENCES.group;
    const clientSort: ClientProjectSort =
      parsed.clientSort === "created" || parsed.clientSort === "updated"
        ? parsed.clientSort
        : "project_number";
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
    return { layout, density, group, clientSort, columns, hideEmptyBoard, hideEmptyClientGroups };
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

// The `?client=` board param (focused single-client drill-in) was retired on
// 2026-08-12 (owner direction): client lanes now show all loaded projects, so
// the parameter is ignored on /projects. The `/project/new?client=` wizard
// prefill is a separate, unrelated param and remains supported.

export function serializeProjectsTablePreferences(preferences: ProjectsTablePreferences) {
  return JSON.stringify(preferences);
}
