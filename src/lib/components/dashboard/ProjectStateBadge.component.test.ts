import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-svelte";
import ProjectStateBadge from "./ProjectStateBadge.svelte";

describe("ProjectStateBadge", () => {
  it("renders canonical stage and suppresses a conflicting legacy project status", async () => {
    await render(ProjectStateBadge, {
      workflowStage: "on_hold",
      legacyStatus: "review",
    });
    expect(document.body.textContent).toContain("On hold");
    expect(document.body.textContent).not.toContain("Review");
    expect(document.body.querySelector("[data-legacy-project-status]")).toBeNull();
  });

  it("uses an explicitly qualified legacy fallback when workflow stage is absent", async () => {
    await render(ProjectStateBadge, { legacyStatus: "review" });
    expect(document.body.textContent).toContain("Review");
    expect(document.body.textContent).toContain("Legacy status");
    const fallback = document.body.querySelector("[data-legacy-project-status]");
    expect(fallback).not.toBeNull();
    expect(fallback?.querySelector("[data-legacy-status-qualifier]")?.className).toContain(
      "text-ink-secondary"
    );
  });

  it("keeps the legacy qualifier visible on dark workspace surfaces", async () => {
    await render(ProjectStateBadge, { legacyStatus: "final", darkSurface: true });
    expect(document.body.textContent).toContain("Final");
    expect(document.body.textContent).toContain("Legacy status");
    const fallback = document.body.querySelector("[data-legacy-project-status]");
    expect(fallback?.querySelector("span:first-child")?.className).toContain("bg-white");
    expect(fallback?.querySelector("span:first-child")?.className).toContain("text-navy");
    const qualifier = fallback?.querySelector("[data-legacy-status-qualifier]");
    expect(qualifier?.className).toContain("text-white");
    expect(qualifier?.className).not.toContain("hidden");
  });
});
