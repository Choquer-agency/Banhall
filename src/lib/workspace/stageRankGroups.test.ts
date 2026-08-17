import { describe, expect, it } from "vitest";
import {
  groupRowsByStageRank,
  verifiedStageCounts,
  visibleStageGroups,
} from "./stageRankGroups";
import {
  WORKFLOW_STAGE_LEGACY_RANK,
  WORKFLOW_STAGE_PIPELINE_ORDER,
  workflowStageRank,
} from "../../../shared/workflowStages";

type Row = {
  id: string;
  workflowStage?: (typeof WORKFLOW_STAGE_PIPELINE_ORDER)[number];
  workflowStageRank?: number;
};

/** Ranked row exactly as the server projection returns it. */
const row = (id: string, workflowStage?: Row["workflowStage"]): Row =>
  workflowStage
    ? { id, workflowStage, workflowStageRank: workflowStageRank(workflowStage) }
    : { id, workflowStageRank: WORKFLOW_STAGE_LEGACY_RANK };

/** Pre-projection row: has a stage but no persisted rank (sorts first). */
const unrankedRow = (id: string, workflowStage: Row["workflowStage"]): Row => ({
  id,
  workflowStage,
});

describe("groupRowsByStageRank", () => {
  it("re-maps frozen-rank server order (on_hold before delivered) into pipeline order losslessly", () => {
    // Server order by frozen rank: intake(0) → on_hold(7) → delivered(8) → legacy(1000).
    const rows = [row("a", "intake"), row("b", "on_hold"), row("c", "delivered"), row("d")];
    const groups = groupRowsByStageRank(rows, true);
    expect(groups.map((group) => group.id)).toEqual([...WORKFLOW_STAGE_PIPELINE_ORDER, "legacy"]);
    // Pipeline order presents delivered BEFORE on_hold even though the
    // persisted rank order is the reverse.
    const delivered = groups.findIndex((group) => group.id === "delivered");
    const onHold = groups.findIndex((group) => group.id === "on_hold");
    expect(delivered).toBeLessThan(onHold);
    expect(groups.find((group) => group.id === "on_hold")?.rows).toEqual([row("b", "on_hold")]);
    expect(groups.find((group) => group.id === "legacy")?.rows).toEqual([row("d")]);
    // Exhausted pagination: every group is provably complete.
    expect(groups.every((group) => !group.maybeIncomplete)).toBe(true);
  });

  it("marks only the deepest loaded run and unreached runs incomplete while pagination is unexhausted", () => {
    // Loaded through the drafting run (rank 2); intake (0) and
    // interview_complete (1) runs are provably complete.
    const rows = [row("a", "intake"), row("b", "interview_complete"), row("c", "drafting")];
    const groups = groupRowsByStageRank(rows, false);
    const byId = new Map(groups.map((group) => [group.id, group]));
    expect(byId.get("intake")?.maybeIncomplete).toBe(false);
    expect(byId.get("interview_complete")?.maybeIncomplete).toBe(false);
    expect(byId.get("drafting")?.maybeIncomplete).toBe(true);
    expect(byId.get("delivered")?.maybeIncomplete).toBe(true);
    expect(byId.get("legacy")?.maybeIncomplete).toBe(true);
  });

  it("fails EVERY group honest while any loaded row is missing its persisted rank (H2)", () => {
    // An unranked delivered row sorts first and jumps maxLoadedRank to 8 —
    // without the guard, intake through ready_for_delivery would falsely
    // claim completeness.
    const rows = [unrankedRow("x", "delivered"), row("a", "intake")];
    const groups = groupRowsByStageRank(rows, false);
    expect(groups.every((group) => group.maybeIncomplete)).toBe(true);
    // Exhausted pagination is still complete truth: everything is loaded.
    expect(groupRowsByStageRank(rows, true).every((group) => !group.maybeIncomplete)).toBe(true);
  });
});

describe("verifiedStageCounts", () => {
  it("passes through an internally consistent record", () => {
    expect(verifiedStageCounts({ intake: 1, drafting: 2 }, 3)).toEqual({ intake: 1, drafting: 2 });
    expect(verifiedStageCounts(undefined, 3)).toBeUndefined();
  });

  it("rejects an empty record on a row that still counts projects, and any sum mismatch (H3)", () => {
    expect(verifiedStageCounts({}, 2)).toBeUndefined();
    expect(verifiedStageCounts({ intake: 1 }, 2)).toBeUndefined();
    expect(verifiedStageCounts({ intake: 3 }, 2)).toBeUndefined();
    // Genuinely empty rows cannot occur (deleted at projectCount 0), but the
    // degenerate pair is still consistent.
    expect(verifiedStageCounts({}, 0)).toEqual({});
  });
});

describe("visibleStageGroups", () => {
  it("hides only exact-zero stages when stageCounts exist and hide-empty is on", () => {
    const groups = groupRowsByStageRank([row("a", "drafting")], true);
    const visible = visibleStageGroups(groups, { drafting: 1, intake: 2 }, true);
    expect(visible.hideDisabled).toBe(false);
    expect(visible.groups.map((group) => group.id)).toEqual(["intake", "drafting"]);
    // 9 canonical zero-count stages hidden; legacy is conditional, not hidden.
    expect(visible.hiddenCount).toBe(9);
    // Exact counts carry no + qualifier and no unverified marker.
    expect(visible.groups.every((group) => group.countSuffix === "" && !group.unverified)).toBe(
      true
    );
    expect(visible.groups.find((group) => group.id === "intake")?.count).toBe(2);
  });

  it("fails honest before backfill: stageCounts absent disables hiding and qualifies counts", () => {
    const groups = groupRowsByStageRank([row("a", "intake"), row("b", "drafting")], false);
    const visible = visibleStageGroups(groups, undefined, true);
    expect(visible.hideDisabled).toBe(true);
    expect(visible.hiddenCount).toBe(0);
    // All ten canonical stages render (legacy stays conditional).
    expect(visible.groups.map((group) => group.id)).toEqual([...WORKFLOW_STAGE_PIPELINE_ORDER]);
    const intake = visible.groups.find((group) => group.id === "intake");
    const drafting = visible.groups.find((group) => group.id === "drafting");
    // Complete run (below the deepest loaded rank) is exact-loaded; the tail
    // run carries the + qualifier.
    expect(intake?.countSuffix).toBe("");
    expect(intake?.unverified).toBe(false);
    expect(drafting?.countSuffix).toBe("+");
    expect(drafting?.unverified).toBe(true);
  });

  it("never renders 0+: zero-loaded incomplete groups carry the explicit unverified marker instead", () => {
    const groups = groupRowsByStageRank([row("a", "intake")], false);
    const visible = visibleStageGroups(groups, undefined, true);
    const delivered = visible.groups.find((group) => group.id === "delivered");
    expect(delivered?.count).toBe(0);
    expect(delivered?.countSuffix).toBe("");
    expect(delivered?.unverified).toBe(true);
    // No display group anywhere combines a zero count with a + suffix.
    expect(visible.groups.some((group) => group.count === 0 && group.countSuffix === "+")).toBe(
      false
    );
  });

  it("never hides a stage with a loaded row even when the exact count disagrees", () => {
    const groups = groupRowsByStageRank([row("a", "drafting")], true);
    const visible = visibleStageGroups(groups, { drafting: 0 }, true);
    expect(visible.groups.some((group) => group.id === "drafting")).toBe(true);
  });

  it("keeps legacy conditional: rendered only while rows or counts exist", () => {
    const withLegacy = visibleStageGroups(
      groupRowsByStageRank([row("a")], true),
      { legacy: 1 },
      true
    );
    expect(withLegacy.groups.some((group) => group.id === "legacy")).toBe(true);
    const withoutLegacy = visibleStageGroups(groupRowsByStageRank([], true), {}, false);
    expect(withoutLegacy.groups.some((group) => group.id === "legacy")).toBe(false);
  });
});
