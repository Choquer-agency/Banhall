import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "./workflowStages";
import { handoffStageRefusal, workItemKindForHandoffStage } from "./workItems";

describe("handoffStageRefusal", () => {
  it("allows keeping an open stage and refuses keeping Delivered or Abandoned", () => {
    expect(handoffStageRefusal("drafting", "drafting")).toBeNull();
    expect(handoffStageRefusal("internal_review", "internal_review")).toBeNull();
    expect(handoffStageRefusal("delivered", "delivered")).toBe("reopen_first");
    expect(handoffStageRefusal("abandoned", "abandoned")).toBe("reopen_first");
  });

  it("refuses Abandoned from every other stage, because a handoff opens work", () => {
    for (const from of WORKFLOW_STAGES.filter((stage) => stage !== "abandoned")) {
      expect(handoffStageRefusal(from, "abandoned")).toBe("abandons");
    }
  });

  it("refuses the review-completion edges and edges whose requirement fails closed", () => {
    expect(handoffStageRefusal("internal_review", "edits")).toBe("review_decision");
    expect(handoffStageRefusal("internal_review", "ready_for_delivery")).toBe("review_decision");
    expect(handoffStageRefusal("drafting", "ready_for_delivery")).toBe("requirement");
    expect(handoffStageRefusal("drafting", "delivered")).toBe("requirement");
  });

  it("allows plain and note-required moves, including reopening", () => {
    expect(handoffStageRefusal("drafting", "internal_review")).toBeNull();
    expect(handoffStageRefusal("drafting", "on_hold")).toBeNull();
    expect(handoffStageRefusal("abandoned", "drafting")).toBeNull();
    expect(handoffStageRefusal("delivered", "revisions")).toBeNull();
  });

  it("keeps the work-item kind mapping for the stages it allows", () => {
    expect(workItemKindForHandoffStage("internal_review")).toBe("internal_review");
    expect(workItemKindForHandoffStage("edits")).toBe("revision");
  });
});
