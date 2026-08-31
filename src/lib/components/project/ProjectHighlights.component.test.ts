import { beforeEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import { page } from "vitest/browser";
import ProjectHighlights from "./ProjectHighlights.svelte";
import { __resetConvexStub, __setQueryData } from "$lib/test/convex-svelte-stub.svelte";

function seedHighlights({ owner = true }: { owner?: boolean } = {}) {
  __setQueryData("projectWorkflow:getProjectWorkflowHeader", {
    workflowStage: "drafting",
    workflowUpdatedAt: Date.now() - 19 * 86_400_000,
    owner: owner ? { initials: "DW", label: "Demo Writer" } : null,
    ownerNeedsReview: false,
    stageIsFallback: false,
    workflowVersion: 1,
    viewerAuthorities: ["owner"],
  });
  __setQueryData("workItems:getProjectWorkPanel", {
    currentHandoffId: null,
    openItems: [],
    viewer: { canCreate: true, canCreateFinancial: false },
    assignable: true,
    assignableReason: null,
    pointerHealthy: true,
    truncated: false,
  });
}

describe("ProjectHighlights", () => {
  beforeEach(() => {
    __resetConvexStub();
    document.body.innerHTML = "";
  });

  it("renders a quiet project masthead while preserving the four project facts", async () => {
    seedHighlights();
    await render(ProjectHighlights, {
      projectId: "project-1" as never,
      fiscalYearEnd: new Date(2025, 11, 31).getTime(),
    });

    const summary = document.querySelector<HTMLElement>("[data-project-highlights]")!;
    expect(summary.getAttribute("aria-label")).toBe("Project workflow summary");
    expect(summary.className).toContain("border-t");
    expect(summary.className).not.toContain("rounded-xl");
    expect(document.querySelector('[data-project-highlight="stage"]')?.className).not.toContain(
      "bg-primary-wash"
    );
    expect(summary.textContent).toContain("Drafting");
    expect(summary.textContent).toContain("Demo Writer");
    expect(summary.textContent).toContain("Nothing in flight");
    expect(summary.textContent).toContain("FYE Dec 31, 2025");
    expect(
      document.querySelector('button[aria-label="Change workflow stage, current stage Drafting"]')
    ).not.toBeNull();
  });

  it("recomposes from its own width instead of the viewport", async () => {
    await page.viewport(1100, 700);
    seedHighlights();
    const screen = await render(ProjectHighlights, {
      projectId: "project-1" as never,
      fiscalYearEnd: new Date(2025, 11, 31).getTime(),
    });

    screen.container.style.width = "320px";
    const stage = document.querySelector<HTMLElement>('[data-project-highlight="stage"]')!;
    const owner = document.querySelector<HTMLElement>('[data-project-highlight="owner"]')!;
    const handoff = document.querySelector<HTMLElement>('[data-project-highlight="handoff"]')!;
    expect(owner.getBoundingClientRect().top).toBeGreaterThan(stage.getBoundingClientRect().top);
    expect(handoff.getBoundingClientRect().top).toBeGreaterThan(owner.getBoundingClientRect().top);

    screen.container.style.width = "760px";
    await expect.poll(() => owner.getBoundingClientRect().left).toBeGreaterThan(
      stage.getBoundingClientRect().left
    );
    expect(Math.abs(handoff.getBoundingClientRect().top - owner.getBoundingClientRect().top)).toBeLessThan(2);
  });

  it("keeps missing ownership and claim data explicit", async () => {
    seedHighlights({ owner: false });
    await render(ProjectHighlights, {
      projectId: "project-1" as never,
      fiscalYearEnd: null,
    });

    const summary = document.querySelector<HTMLElement>("[data-project-highlights]")!;
    expect(summary.textContent).toContain("No owner recorded");
    expect(summary.textContent).toContain("No fiscal year-end");
  });
});
