import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "../../../shared/workflowStages";
import {
  stageBadgeClasses,
  stageCardTheme,
  WORKFLOW_STAGE_TONES,
} from "./stagePresentation";

describe("workflow stage presentation", () => {
  it("defines an explicit readable badge and card theme for every workflow stage", () => {
    for (const stage of WORKFLOW_STAGES) {
      expect(WORKFLOW_STAGE_TONES[stage]).toBeTruthy();
      expect(stageBadgeClasses(stage).badge).toContain("text-");
      expect(stageBadgeClasses(stage).dot).toContain("bg-");
      expect(stageBadgeClasses(stage).darkBadge).toContain("text-");
      expect(stageBadgeClasses(stage).darkDot).toContain("bg-");
      expect(stageCardTheme(stage).border).toContain("border-");
      expect(stageCardTheme(stage).footerBg).toContain("bg-");
    }
  });

  it("gives paused and abandoned work a subdued dashed treatment", () => {
    expect(stageCardTheme("on_hold").border).toContain("border-dashed");
    expect(stageCardTheme("abandoned").border).toContain("border-dashed");
    expect(stageBadgeClasses("on_hold").badge).toContain("gray");
  });
});
