import { beforeEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { createRawSnippet } from "svelte";
import PanelToolbar from "./PanelToolbar.svelte";

/**
 * Panel toolbar (ui-design-final.md section 2): tabs left with a 2px
 * primary-selected underline on the active one; toggles right in the order
 * Full width, divider, Details, Assistant (Aurora mark), QA.
 */
const qaSnippet = createRawSnippet(() => ({
  render: () => '<button type="button" data-panel-toggle="qa" aria-label="QA">QA</button>',
}));

describe("PanelToolbar", () => {
  beforeEach(async () => {
    document.body.innerHTML = "";
    await page.viewport(1280, 800);
  });

  it("orders the toggles Full width, divider, Details, divider, Assistant, QA", async () => {
    await render(PanelToolbar, {
      tabs: [{ id: "report", label: "Report" }, { id: "sources", label: "Sources", count: 3 }],
      activeTab: "report",
      onSelectTab: () => {},
      showFullWidth: true,
      showAssistant: true,
      qa: qaSnippet,
    });
    const order = Array.from(
      document.querySelectorAll("[data-panel-toggles] [data-panel-toggle], [data-panel-toggles] [data-panel-toggle-divider]")
    ).map((el) => el.getAttribute("data-panel-toggle") ?? "divider");
    // Boards 2.1 and 2.2 draw a hairline on each side of Details.
    expect(order).toEqual(["full-width", "divider", "details", "divider", "assistant", "qa"]);
    expect(document.querySelector('[data-panel-toggle="assistant"] [data-ai-mark="aurora"]')).not.toBeNull();
  });

  it("marks the active tab with ink text and a 2px primary-selected underline", async () => {
    const onSelectTab = vi.fn();
    await render(PanelToolbar, {
      tabs: [
        { id: "plan", label: "Plan", done: true },
        { id: "summary", label: "Summary", status: "Ready" },
        { id: "report", label: "Report", disabled: true },
        { id: "sources", label: "Sources" },
      ],
      activeTab: "summary",
      onSelectTab,
    });
    const tab = (id: string) => document.querySelector<HTMLButtonElement>(`[data-panel-tab="${id}"]`)!;
    expect(tab("summary").getAttribute("aria-current")).toBe("page");
    expect(tab("summary").className).toContain("text-ink");
    const underline = tab("summary").querySelector<HTMLElement>("span.bg-primary-selected")!;
    expect(underline.getBoundingClientRect().height).toBe(2);
    expect(tab("plan").getAttribute("aria-current")).toBeNull();
    expect(tab("plan").textContent).toContain("done");
    expect(tab("summary").textContent).toContain("Ready");
    expect(tab("report").disabled).toBe(true);
    tab("sources").click();
    expect(onSelectTab).toHaveBeenCalledWith("sources");
  });

  it("shows an active toggle as a 26px selected tile", async () => {
    await render(PanelToolbar, {
      tabs: [{ id: "report", label: "Report" }],
      activeTab: "report",
      onSelectTab: () => {},
      detailsActive: true,
    });
    const details = document.querySelector<HTMLElement>('[data-panel-toggle="details"]')!;
    expect(details.getAttribute("aria-pressed")).toBe("true");
    expect(details.className).toContain("bg-workspace-rail-selected");
    expect(details.className).toContain("text-fir");
    expect(details.getBoundingClientRect().height).toBe(26);
    expect(document.querySelector('[data-panel-toggle="full-width"]')).toBeNull();
    expect(document.querySelector('[data-panel-toggle="assistant"]')).toBeNull();
  });
});
