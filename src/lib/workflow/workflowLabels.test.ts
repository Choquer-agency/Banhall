import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "../../../shared/workflowStages";
import {
  TRANSITION_REQUIREMENT_BLOCKERS,
  WORKFLOW_STAGE_DESCRIPTIONS,
  WORKFLOW_STAGE_LABELS,
  effectiveWorkflowStage,
  workflowStageOptions,
} from "../../../shared/workflowLabels";
import { allowedNextWorkflowStages } from "../../../shared/workflowTransitions";

describe("workflow labels and options", () => {
  it("labels and describes every canonical stage", () => {
    for (const stage of WORKFLOW_STAGES) {
      expect(WORKFLOW_STAGE_LABELS[stage]).not.toBe("");
      expect(WORKFLOW_STAGE_DESCRIPTIONS[stage]).not.toBe("");
    }
  });

  it("uses intake as the effective compatibility stage", () => {
    expect(effectiveWorkflowStage(undefined)).toBe("intake");
    expect(effectiveWorkflowStage(null)).toBe("intake");
    expect(effectiveWorkflowStage("drafting")).toBe("drafting");
  });

  it("offers every other stage the viewer is authorized for", () => {
    const options = workflowStageOptions("drafting", ["owner"]);
    expect(options.map((option) => option.to)).toEqual(
      allowedNextWorkflowStages("drafting")
    );
    expect(options.map((option) => option.to)).toEqual(
      WORKFLOW_STAGES.filter((stage) => stage !== "drafting")
    );
    // Delivered → on_hold stays a Manager/Admin-only administrative correction.
    expect(workflowStageOptions("delivered", ["owner"]).map((option) => option.to)).toEqual(
      WORKFLOW_STAGES.filter((stage) => stage !== "delivered" && stage !== "on_hold")
    );
    expect(workflowStageOptions("delivered", ["manager"]).map((option) => option.to)).toEqual(
      WORKFLOW_STAGES.filter((stage) => stage !== "delivered")
    );
    // Reopening an abandoned project stays Manager/Admin-only.
    expect(workflowStageOptions("abandoned", ["owner"])).toEqual([]);
    expect(workflowStageOptions("drafting", [])).toEqual([]);
  });

  it("keeps review and outcome-pinned transitions available now that productionOutcomes records them", () => {
    const drafting = workflowStageOptions("drafting", ["owner"]);
    expect(drafting.find((option) => option.to === "ready_for_delivery")?.disabledReason).toBeNull();
    const delivery = workflowStageOptions("ready_for_delivery", ["owner"]);
    expect(delivery.find((option) => option.to === "delivered")?.disabledReason).toBeNull();
    const resume = workflowStageOptions("on_hold", ["owner"]);
    expect(resume.find((option) => option.to === "internal_review")?.disabledReason).toBeNull();
    // `review_decision`, `promoted_branch`, and `delivery_outcome` are all
    // satisfied inline on `setWorkflowStage`, so none hard-disable UI options.
    const review = workflowStageOptions("internal_review", ["owner"]);
    expect(review.find((option) => option.to === "edits")?.disabledReason).toBeNull();
    expect(review.find((option) => option.to === "client_review")?.disabledReason).toBeNull();
    expect(review.find((option) => option.to === "ready_for_delivery")?.disabledReason).toBe(
      TRANSITION_REQUIREMENT_BLOCKERS.promoted_branch
    );
    expect(TRANSITION_REQUIREMENT_BLOCKERS.promoted_branch).toBeNull();
    expect(TRANSITION_REQUIREMENT_BLOCKERS.delivery_outcome).toBeNull();
  });

  it("carries audit-note requirements from the matrix", () => {
    expect(
      workflowStageOptions("intake", ["owner"]).find((option) => option.to === "on_hold")
        ?.requiresNote
    ).toBe(true);
    expect(
      workflowStageOptions("delivered", ["owner"]).find((option) => option.to === "revisions")
        ?.requiresNote
    ).toBe(true);
  });
});
