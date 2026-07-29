import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "../../../shared/workflowStages";
import {
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

  it("returns only matrix-valid transitions authorized for the viewer", () => {
    const options = workflowStageOptions("drafting", ["owner"]);
    expect(options.map((option) => option.to)).toEqual(
      allowedNextWorkflowStages("drafting")
    );
    expect(workflowStageOptions("delivered", ["owner"]).map((option) => option.to)).toEqual([
      "revisions",
    ]);
    expect(workflowStageOptions("delivered", ["manager"]).map((option) => option.to)).toEqual([
      "revisions",
      "on_hold",
    ]);
    expect(workflowStageOptions("drafting", [])).toEqual([]);
  });

  it("marks storage-gated transitions unavailable with plain reasons", () => {
    const drafting = workflowStageOptions("drafting", ["owner"]);
    expect(drafting.find((option) => option.to === "ready_for_delivery")?.disabledReason).toMatch(
      /promoted report branch/i
    );
    const delivery = workflowStageOptions("ready_for_delivery", ["owner"]);
    expect(delivery.find((option) => option.to === "delivered")?.disabledReason).toMatch(
      /delivery or filing outcome/i
    );
    const resume = workflowStageOptions("on_hold", ["owner"]);
    expect(resume.find((option) => option.to === "internal_review")?.disabledReason).toMatch(
      /internal-review handoff/i
    );
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
