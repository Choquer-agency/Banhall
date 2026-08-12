import { DEFAULT_LANE_SORT, parseLaneSortMode, type LaneSortMode } from "$lib/mywork/laneSort";

export type MyWorkPreferences = {
  /**
   * Presentation reorder of loaded rows (never a grouping axis or filter).
   * The retired Board/List `layout` key (2026-08-06 second amendment: the
   * queue-first My Work has exactly one presentation) parses fail-safe —
   * stored copies are ignored and dropped on the next write.
   */
  laneSort: LaneSortMode;
};

export const DEFAULT_MY_WORK_PREFERENCES: MyWorkPreferences = {
  laneSort: DEFAULT_LANE_SORT,
};

export function parseMyWorkPreferences(raw: string | null): MyWorkPreferences {
  if (!raw) return { ...DEFAULT_MY_WORK_PREFERENCES };
  try {
    const parsed = JSON.parse(raw) as { laneSort?: string };
    return {
      // Fail closed: anything unrecognized falls back to the default order.
      laneSort: parseLaneSortMode(parsed.laneSort),
    };
  } catch {
    return { ...DEFAULT_MY_WORK_PREFERENCES };
  }
}

export function serializeMyWorkPreferences(preferences: MyWorkPreferences) {
  return JSON.stringify(preferences);
}
