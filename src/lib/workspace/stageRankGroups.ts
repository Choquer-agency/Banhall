/**
 * Client → Status regrouping of stage-ranked server pages (2026-08-06 second
 * amendment). `dashboard.listCompanyProjectsByStageRank` returns rows in the
 * FROZEN persisted rank order (`on_hold` 7 before `delivered` 8, legacy
 * 1000 last); presentation re-maps complete rank runs into
 * `WORKFLOW_STAGE_PIPELINE_ORDER`. That re-map is lossless for every rank
 * run the server has fully returned; while pagination is unexhausted, only
 * the last loaded run may be incomplete and every not-yet-reached run is
 * unknown — those loaded-only counts carry the `+` qualifier.
 *
 * H2 correction (2026-08-06): a loaded row with a MISSING persisted rank
 * sorts before every ranked row, so its presence breaks the "runs strictly
 * below the deepest loaded rank are complete" inference entirely. When any
 * loaded row lacks a rank, every group fails honest (`maybeIncomplete`)
 * until pagination is exhausted.
 *
 * Count truth ladder (per surface):
 * 1. VERIFIED exact per-client `stageCounts` (transactionally maintained,
 *    verified backfill, and `sum === projectCount` — see
 *    `verifiedStageCounts`) — exact numbers, hide-empty allowed;
 * 2. absent/unverifiable `stageCounts` — loaded-only counts with `+`
 *    qualifiers (never rendered as `0+`; zero-loaded incomplete groups carry
 *    the explicit `unverified` marker instead), nothing hidden (fail honest,
 *    never treat absence as zero).
 */
import {
  WORKFLOW_STAGE_LEGACY_RANK,
  WORKFLOW_STAGE_PIPELINE_ORDER,
  workflowStageRank,
  type WorkflowStage,
} from "../../../shared/workflowStages";

export type StageGroupId = WorkflowStage | "legacy";

export type StageRankRow = {
  workflowStage?: WorkflowStage;
  /** Frozen persisted rank; undefined on rows that predate the projection. */
  workflowStageRank?: number;
};

export type StageGroup<T extends StageRankRow> = {
  id: StageGroupId;
  rows: T[];
  loadedCount: number;
  /**
   * True while the loaded rows may not be this group's complete population:
   * the group's frozen rank run is the last loaded run (possibly cut by the
   * page boundary) or has not been reached yet and pagination is not
   * exhausted — or any loaded row is missing its persisted rank, which
   * invalidates the run-completeness inference for every group.
   */
  maybeIncomplete: boolean;
};

function frozenRank(id: StageGroupId) {
  return id === "legacy" ? WORKFLOW_STAGE_LEGACY_RANK : workflowStageRank(id);
}

/**
 * H3 consumer defense (2026-08-06 correction): exact per-client stageCounts
 * are trusted ONLY when they are internally consistent with the maintained
 * projectCount. An empty record on a row that still counts projects, or any
 * sum mismatch, is treated as not-backfilled/unavailable — the surface then
 * fails honest (loaded-only counts, nothing hidden) instead of presenting a
 * divergent record as exact truth.
 */
export function verifiedStageCounts(
  stageCounts: Record<string, number> | undefined,
  projectCount: number
): Record<string, number> | undefined {
  if (stageCounts === undefined) return undefined;
  const sum = Object.values(stageCounts).reduce((total, count) => total + count, 0);
  if (sum !== projectCount) return undefined;
  return stageCounts;
}

/**
 * Buckets server-ordered rows into pipeline-ordered stage groups (legacy
 * last). Grouping by stage value is a lossless re-map of contiguous rank
 * runs; `exhausted` marks which groups are provably complete. Any loaded row
 * without a persisted rank fails every group honest (see module docs).
 */
export function groupRowsByStageRank<T extends StageRankRow>(
  rows: readonly T[],
  exhausted: boolean
): StageGroup<T>[] {
  const buckets = new Map<StageGroupId, T[]>();
  for (const stage of WORKFLOW_STAGE_PIPELINE_ORDER) buckets.set(stage, []);
  buckets.set("legacy", []);
  let maxLoadedRank = Number.NEGATIVE_INFINITY;
  let hasUnrankedRow = false;
  for (const row of rows) {
    const id: StageGroupId = row.workflowStage ?? "legacy";
    buckets.get(id)?.push(row);
    if (row.workflowStageRank === undefined) hasUnrankedRow = true;
    const rank = frozenRank(id);
    if (rank > maxLoadedRank) maxLoadedRank = rank;
  }
  const ids: StageGroupId[] = [...WORKFLOW_STAGE_PIPELINE_ORDER, "legacy"];
  return ids.map((id) => {
    const groupRows = buckets.get(id) ?? [];
    return {
      id,
      rows: groupRows,
      loadedCount: groupRows.length,
      // Runs strictly below the deepest loaded frozen rank are complete
      // (index order guarantees the server passed them fully); the deepest
      // run and everything beyond it stay unknown until exhaustion. A loaded
      // unranked row voids the inference for every group (H2).
      maybeIncomplete: !exhausted && (hasUnrankedRow || frozenRank(id) >= maxLoadedRank),
    };
  });
}

export type StageGroupDisplay<T extends StageRankRow> = {
  id: StageGroupId;
  rows: T[];
  /** Count to render (exact when stageCounts backfilled, loaded-only otherwise). */
  count: number;
  /**
   * `+` when the count is a loaded-only lower bound WITH at least one loaded
   * row; empty when exact or when nothing is loaded (never `0+` — see
   * `unverified`).
   */
  countSuffix: "" | "+";
  /**
   * True when the rendered count is a loaded-only value that may under-count
   * (no exact source and this group's population is not provably complete).
   * Zero-count unverified groups must render an explicit "not fully loaded"
   * treatment instead of a bare (or `+`-suffixed) zero.
   */
  unverified: boolean;
};

export type VisibleStageGroups<T extends StageRankRow> = {
  groups: StageGroupDisplay<T>[];
  /** Canonical stages hidden by the hide-empty option (exact-zero only). */
  hiddenCount: number;
  /**
   * True while hide-empty cannot be honestly applied (stageCounts absent or
   * unverifiable — not yet backfilled). Nothing is hidden in that state.
   */
  hideDisabled: boolean;
};

/**
 * Applies the client-surface hide-empty contract: a canonical stage may be
 * hidden ONLY when the exact per-client stageCounts value is 0 (and no row
 * is loaded — a loaded row always renders). Legacy is a conditional
 * compatibility group: it renders only while legacy rows/counts exist and is
 * never part of the hidden-stage disclosure.
 *
 * Pass `stageCounts` through `verifiedStageCounts` first — this function
 * treats whatever record it receives as exact.
 */
export function visibleStageGroups<T extends StageRankRow>(
  groups: StageGroup<T>[],
  stageCounts: Record<string, number> | undefined,
  hideEmpty: boolean
): VisibleStageGroups<T> {
  const hideDisabled = stageCounts === undefined;
  const display: StageGroupDisplay<T>[] = [];
  let hiddenCount = 0;
  for (const group of groups) {
    const exact = stageCounts?.[group.id];
    const count = stageCounts !== undefined ? Math.max(exact ?? 0, group.loadedCount) : group.loadedCount;
    const unverified = stageCounts === undefined && group.maybeIncomplete;
    // Never render `0+`: a suffix only qualifies a positive loaded count;
    // zero-loaded incomplete groups carry the explicit `unverified` marker.
    const countSuffix: "" | "+" = unverified && count > 0 ? "+" : "";
    if (group.id === "legacy") {
      // Conditional compatibility group — renders only while it truthfully
      // has rows or a recorded count; never advertised empty.
      if (count > 0 || group.loadedCount > 0) {
        display.push({ id: group.id, rows: group.rows, count, countSuffix, unverified });
      }
      continue;
    }
    const provablyEmpty = stageCounts !== undefined && count === 0 && group.loadedCount === 0;
    if (hideEmpty && !hideDisabled && provablyEmpty) {
      hiddenCount += 1;
      continue;
    }
    display.push({ id: group.id, rows: group.rows, count, countSuffix, unverified });
  }
  return { groups: display, hiddenCount, hideDisabled };
}
