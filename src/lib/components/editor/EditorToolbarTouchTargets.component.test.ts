/**
 * The selection toolbar's buttons, measured under each pointer. This suite
 * runs twice, in the pointer instances of vitest.component.config.ts: with a
 * coarse pointer (a touch screen) the Vet and Research buttons measure at
 * least 44 px and stay inside the bar; with a fine pointer they keep their
 * 26 px board size. Each button takes its name from aria-label and keeps its
 * title tooltip. All text is fictional.
 */
import { describe, expect, inject, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import Editor from "./Editor.svelte";
import type { ResearchSelection } from "./types";

declare module "vitest" {
  export interface ProvidedContext {
    expectedPointer: "fine" | "coarse";
  }
}

const pointer = inject("expectedPointer");
const coarse = pointer === "coarse";
const TOUCH = 44;

const CONTENT = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Kiln drying above 80 C is known to warp birch boards." }] },
  ],
});

async function openToolbar() {
  const onResearch = vi.fn<(selection: ResearchSelection) => void>();
  const result = await render(Editor, { content: CONTENT, onResearch });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  await userEvent.tripleClick(page.getByText("Kiln drying above 80 C is known to warp birch boards."));
  await expect.poll(() => document.querySelector("[data-selection-toolbar]")).not.toBeNull();
}

const button = (name: string) => page.getByRole("button", { name, exact: true }).element() as HTMLElement;
const rootPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize);

describe(`selection toolbar buttons (${pointer} pointer)`, () => {
  it("runs under the pointer this instance declares", async () => {
    await expect.poll(() => window.matchMedia(`(pointer: ${pointer})`).matches).toBe(true);
  });

  it("names Vet and Research through aria-label and keeps their tooltips", async () => {
    await openToolbar();
    for (const name of ["Vet against public sources", "Research this selection", "Bold (Cmd+B)"]) {
      const element = button(name);
      expect(element.getAttribute("aria-label")).toBe(name);
      expect(element.getAttribute("title")).toBe(name);
    }
  });

  it(coarse ? "gives Vet and Research the 44 px floor inside the bar" : "keeps the 26 px board size", async () => {
    await openToolbar();
    const bar = (document.querySelector("[data-selection-toolbar]") as HTMLElement).getBoundingClientRect();
    for (const name of ["Vet against public sources", "Research this selection", "Bold (Cmd+B)"]) {
      const rect = button(name).getBoundingClientRect();
      if (coarse) {
        expect(rect.width, `${name} width`).toBeGreaterThanOrEqual(TOUCH);
        expect(rect.height, `${name} height`).toBeGreaterThanOrEqual(TOUCH);
        expect(rect.top, `${name} top`).toBeGreaterThanOrEqual(bar.top);
        expect(rect.bottom, `${name} bottom`).toBeLessThanOrEqual(bar.bottom);
      } else {
        // 1.625rem at whatever root the window sets (15 or 16 px here).
        expect(rect.width, `${name} width`).toBeCloseTo(1.625 * rootPx(), 1);
        expect(rect.height, `${name} height`).toBeCloseTo(1.625 * rootPx(), 1);
        expect(bar.height).toBeCloseTo(2.125 * rootPx(), 1);
      }
    }
  });
});
