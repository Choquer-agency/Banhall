import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import ViewModeToggle from "./ViewModeToggle.svelte";

describe("ViewModeToggle", () => {
  it("uses Board and List vocabulary with Board first and supports arrow-key selection", async () => {
    const onChange = vi.fn();
    await render(ViewModeToggle, {
      value: "board",
      onChange,
      label: "Project layout",
    });

    const board = document.querySelector<HTMLButtonElement>('[aria-label="Board view"]')!;
    const list = document.querySelector<HTMLButtonElement>('[aria-label="List view"]')!;
    expect(board.getAttribute("aria-pressed")).toBe("true");
    // A11y P0 (2026-08-08 authenticated audit): this is a role=group of
    // aria-pressed toggle buttons — EVERY control stays in the tab sequence.
    // The earlier roving tabindex (radio grammar) skipped the unselected
    // List control entirely for keyboard users; arrow keys remain a
    // convenience layer on top.
    expect(board.tabIndex).toBe(0);
    expect(list.tabIndex).toBe(0);
    // Board leads the group — it is the canonical default presentation.
    expect(board.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    board.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("keeps List reachable in one click from Board", async () => {
    const onChange = vi.fn();
    await render(ViewModeToggle, { value: "board", onChange, label: "Project layout" });

    const list = document.querySelector<HTMLButtonElement>('[aria-label="List view"]')!;
    list.click();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("list");
  });

  it("fits the list display actions below two mobile filters without clipping", async () => {
    await page.viewport(390, 844);
    const result = await render(ViewModeToggle, {
      value: "list",
      onChange: vi.fn(),
      label: "Project layout",
    });

    const toolbar = document.createElement("div");
    toolbar.className = "grid min-w-0 grid-cols-2 items-center gap-2 bg-white p-4 sm:flex sm:flex-wrap";
    toolbar.innerHTML = `
      <label class="relative min-w-0"><span class="sr-only">Filter projects by stage</span><select aria-label="Stage" class="h-11 w-full rounded-xl border border-line bg-white px-3"><option>All stages</option></select></label>
      <label class="relative min-w-0"><span class="sr-only">Sort projects</span><select aria-label="Sort" class="h-11 w-full rounded-xl border border-line bg-white px-3"><option>Recently edited</option></select></label>
      <div data-actions class="col-span-2 flex min-w-0 items-center justify-end gap-2 sm:ml-auto"><button aria-label="Project list display options" class="inline-flex h-11 items-center rounded-xl border border-line bg-white px-3">Display</button></div>
    `;
    document.body.append(toolbar);
    const actions = toolbar.querySelector<HTMLElement>("[data-actions]")!;
    actions.append(result.container);

    const controls = [...toolbar.querySelectorAll<HTMLElement>("select, button")];
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      expect(rect.height, control.getAttribute("aria-label") ?? control.textContent).toBeGreaterThanOrEqual(44);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(390);
    }
    expect(actions.getBoundingClientRect().top).toBeGreaterThan(toolbar.querySelector("select")!.getBoundingClientRect().bottom);
    expect(document.documentElement.scrollWidth).toBe(document.documentElement.clientWidth);

    toolbar.remove();
  });
});
