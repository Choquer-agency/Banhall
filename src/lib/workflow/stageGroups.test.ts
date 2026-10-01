import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "../../../shared/workflowStages";
import { WORKFLOW_STAGE_GROUPS } from "./stageGroups";

describe("WORKFLOW_STAGE_GROUPS", () => {
  it("lists every stage exactly once", () => {
    const listed = WORKFLOW_STAGE_GROUPS.flatMap((group) => group.stages);
    expect([...listed].sort()).toEqual([...WORKFLOW_STAGES].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });
});
