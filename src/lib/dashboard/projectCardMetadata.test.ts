import { describe, expect, it } from "vitest";
import { WORKFLOW_STAGE_LABELS } from "../../../shared/workflowLabels";
import { generationActivityLabel } from "./generationActivity";
import { stageCardTheme } from "../workflow/stagePresentation";

describe("project-card workflow metadata", () => {
  it("uses human stage labels with intake compatibility fallback", () => {
    expect(WORKFLOW_STAGE_LABELS.drafting).toBe("Drafting");
    expect(WORKFLOW_STAGE_LABELS.intake).toBe("Intake");
  });

  it("keeps generation activity secondary and explicitly scoped", () => {
    expect(generationActivityLabel("generating")).toMatch(/^AI/);
    expect(generationActivityLabel("awaiting_selection")).toMatch(/^Action needed/);
    expect(stageCardTheme("on_hold").border).toContain("border-dashed");
  });

});
