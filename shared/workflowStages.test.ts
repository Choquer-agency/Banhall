import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES, WORKFLOW_STAGE_PIPELINE_ORDER, workflowStageRank } from "./workflowStages";

describe("workflow pipeline order", () => {
  it("is an exact permutation and keeps terminal stages last", () => {
    expect([...WORKFLOW_STAGE_PIPELINE_ORDER].sort()).toEqual([...WORKFLOW_STAGES].sort());
    expect(workflowStageRank("ready_for_delivery")).toBeLessThan(workflowStageRank("delivered"));
    expect(workflowStageRank("delivered")).toBeLessThan(workflowStageRank("abandoned"));
  });
});
