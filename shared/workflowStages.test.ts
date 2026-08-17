import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES, WORKFLOW_STAGE_PIPELINE_ORDER, workflowStageRank } from "./workflowStages";

describe("workflow pipeline order", () => {
  it("is an exact permutation and keeps terminal stages last", () => {
    expect([...WORKFLOW_STAGE_PIPELINE_ORDER].sort()).toEqual([...WORKFLOW_STAGES].sort());
    expect(workflowStageRank("ready_for_delivery")).toBeLessThan(workflowStageRank("delivered"));
    expect(workflowStageRank("delivered")).toBeLessThan(workflowStageRank("abandoned"));
  });

  it("presents delivery before the paused terminal exceptions (product-domain stage table)", () => {
    const order = WORKFLOW_STAGE_PIPELINE_ORDER;
    expect(order.indexOf("ready_for_delivery")).toBeLessThan(order.indexOf("delivered"));
    expect(order.indexOf("delivered")).toBeLessThan(order.indexOf("on_hold"));
    expect(order.indexOf("on_hold")).toBeLessThan(order.indexOf("abandoned"));
  });

  it("keeps persisted workflowStageRank values frozen at their historical numbering", () => {
    // These exact numbers are stored in projects.workflowStageRank rows and
    // backing indexes. Changing any of them requires the audited re-rank
    // backfill (myWorkBackfill) plus a product-domain amendment.
    expect(WORKFLOW_STAGES.map((stage) => [stage, workflowStageRank(stage)])).toEqual([
      ["intake", 0],
      ["interview_complete", 1],
      ["drafting", 2],
      ["internal_review", 3],
      ["edits", 3.5],
      ["client_review", 4],
      ["revisions", 5],
      ["ready_for_delivery", 6],
      ["delivered", 8],
      ["on_hold", 7],
      ["abandoned", 9],
    ]);
    expect(workflowStageRank(undefined)).toBe(1_000);
  });
});
