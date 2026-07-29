import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { WORKFLOW_STAGE_LABELS } from "../../../../shared/workflowLabels";
import { WORKFLOW_STAGES } from "../../../../shared/workflowStages";
import StageBadge from "./StageBadge.svelte";

describe("StageBadge", () => {
  it("renders every workflow stage as explicit text rather than color alone", async () => {
    for (const stage of WORKFLOW_STAGES) {
      const view = await render(StageBadge, { stage, dot: true });
      const badge = document.body.querySelector(`[data-stage-badge="${stage}"]`);
      expect(badge?.textContent).toContain(WORKFLOW_STAGE_LABELS[stage]);
      expect(badge?.querySelector('[aria-hidden="true"]')).not.toBeNull();
      view.unmount();
    }
  });

  it("uses a subdued non-error treatment for paused work", async () => {
    await render(StageBadge, { stage: "on_hold", dot: true });
    const badge = document.body.querySelector('[data-stage-badge="on_hold"]');
    expect(badge?.className).toContain("gray");
    expect(badge?.className).not.toContain("red");
    expect(badge?.textContent).toContain("On hold");
  });

  it("uses an opaque high-contrast treatment for delivery stages on dark surfaces", async () => {
    await render(StageBadge, { stage: "ready_for_delivery", dot: true, darkSurface: true });
    const badge = document.body.querySelector('[data-stage-badge="ready_for_delivery"]');
    expect(badge?.className).toContain("bg-white");
    expect(badge?.className).toContain("text-navy");
    expect(badge?.className).not.toContain("bg-primary/15");
  });
});
