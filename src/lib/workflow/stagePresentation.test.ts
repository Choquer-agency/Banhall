import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGES } from "../../../shared/workflowStages";
import {
  stageBadgeClasses,
  stageCardCharcoalTheme,
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
    // 2026-08-10 owner direction: On hold reads violet (distinct from the
    // purple client-review tone); abandoned stays muted gray.
    expect(stageBadgeClasses("on_hold").badge).toContain("violet");
  });

  it("defines a labelled low-alpha charcoal treatment for the dark workspace shell", () => {
    for (const stage of WORKFLOW_STAGES) {
      expect(stageBadgeClasses(stage).charcoalBadge).toContain("text-");
      expect(stageBadgeClasses(stage).charcoalDot).toContain("bg-");
      expect(stageCardCharcoalTheme(stage).border).toContain("border-");
      expect(stageCardCharcoalTheme(stage).shellBg).toContain("bg-");
      expect(stageCardCharcoalTheme(stage).footerBg).toContain("bg-");
    }
    // Paused work stays dashed and muted on charcoal, delivery keeps lagoon.
    expect(stageCardCharcoalTheme("on_hold").border).toContain("border-dashed");
    expect(stageCardCharcoalTheme("abandoned").border).toContain("border-dashed");
    expect(stageCardCharcoalTheme("delivered").footerText).toContain("primary");
    expect(stageBadgeClasses("delivered").charcoalBadge).toContain("primary");
  });
});
