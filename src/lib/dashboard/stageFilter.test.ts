import { describe, expect, it } from "vitest";
import {
  countProjectsByStage,
  LEGACY_STAGE_FILTER,
  matchesStageFilter,
  stageFilterItems,
  stageFilterKey,
} from "./stageFilter";

const projects = [
  { workflowStage: "drafting" as const, status: "review" },
  { workflowStage: "on_hold" as const, status: "review" },
  { workflowStage: "drafting" as const, status: "final" },
  { status: "review" },
];

describe("dashboard workflow-stage filters", () => {
  it("uses canonical stage even when legacy status disagrees", () => {
    expect(stageFilterKey(projects[0])).toBe("drafting");
    expect(matchesStageFilter(projects[0], "drafting")).toBe(true);
    expect(matchesStageFilter(projects[0], "internal_review")).toBe(false);
    expect(matchesStageFilter(projects[1], "on_hold")).toBe(true);
  });

  it("isolates stage-less compatibility rows in a labelled legacy bucket", () => {
    expect(stageFilterKey(projects[3])).toBe(LEGACY_STAGE_FILTER);
    expect(matchesStageFilter(projects[3], LEGACY_STAGE_FILTER)).toBe(true);
    expect(countProjectsByStage(projects)).toEqual({ drafting: 2, on_hold: 1, legacy: 1 });
  });

  it("returns only populated stage options and totals every project once", () => {
    expect(stageFilterItems(projects)).toEqual([
      { value: "all", label: "All stages (4)" },
      { value: "drafting", label: "Drafting (2)" },
      { value: "on_hold", label: "On hold (1)" },
      { value: "legacy", label: "Legacy status (1)" },
    ]);
  });
});
