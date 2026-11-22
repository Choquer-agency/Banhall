import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "./Editor.svelte";
import { buildTiptapDocument } from "../../../../convex/lib/tiptapReport";

function makeReport(s244: string) {
  return JSON.stringify(
    buildTiptapDocument(
      "Cold room study",
      "Line 242 baseline uncertainty.",
      s244,
      "Line 246 advancement achieved."
    )
  );
}

function getTiptap(container: HTMLElement): TiptapEditor | undefined {
  const pm = container.querySelector(".ProseMirror") as
    | (HTMLElement & { editor?: TiptapEditor })
    | null;
  return pm?.editor;
}

describe("Editor reliability and Schedule 60 toolbar alignment", () => {
  it("excludes external server content replacement from ProseMirror undo history", async () => {
    const initial = makeReport("Initial report prose.");
    const next = makeReport("Replaced server prose.");
    const { container, rerender } = await render(Editor, {
      content: initial,
      editable: true,
      presentation: "reading",
    });
    await expect.poll(() => getTiptap(container)).toBeDefined();
    const tiptap = getTiptap(container)!;

    await rerender({ content: next, editable: true, presentation: "reading" });
    await expect.poll(() => tiptap.state.doc.textContent).toContain("Replaced server prose.");
    expect(tiptap.can().undo()).toBe(false);
  });

  it("clears failed save deduplication so flushPendingSave retries the failed document", async () => {
    const initial = makeReport("Initial body text.");
    let failNext = true;
    const onUpdate = vi.fn(async () => {
      if (failNext) {
        failNext = false;
        throw new Error("Transient save failure");
      }
    });
    const { container, component } = await render(Editor, {
      content: initial,
      onUpdate,
      editable: true,
      presentation: "reading",
    });
    await expect.poll(() => getTiptap(container)).toBeDefined();
    const tiptap = getTiptap(container)!;

    // Insert an edit inside the body paragraph.
    const pos = tiptap.state.doc.content.size - 2;
    tiptap.commands.insertContentAt(pos, " Edited.");

    // First flush fails.
    await expect(component.flushPendingSave()).rejects.toThrow("Transient save failure");
    expect(onUpdate).toHaveBeenCalledTimes(1);

    // Second flush retries the exact same JSON instead of skipping it.
    await expect(component.flushPendingSave()).resolves.toBeUndefined();
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });

  it("only offers Paragraph in the block menu while still labeling legacy bullet lists", async () => {
    const initial = makeReport("Selectable paragraph text.");
    const { container } = await render(Editor, {
      content: initial,
      editable: true,
      presentation: "reading",
    });
    await expect.poll(() => getTiptap(container)).toBeDefined();
    const tiptap = getTiptap(container)!;

    const end = tiptap.state.doc.content.size - 2;
    tiptap.view.dom.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    tiptap.commands.setTextSelection({ from: end - 10, to: end - 2 });
    await expect.poll(() => document.querySelector("[data-selection-toolbar]")).not.toBeNull();

    const blockButton = document.querySelector<HTMLButtonElement>(
      '[data-selection-toolbar] button[title="Block type"]'
    )!;
    expect(blockButton.textContent?.trim()).toBe("Paragraph");
    blockButton.click();

    await expect.poll(() => document.querySelectorAll('[role="menuitemradio"]').length).toBe(1);
    const items = [...document.querySelectorAll('[role="menuitemradio"]')].map((el) =>
      el.textContent?.trim()
    );
    expect(items).toEqual(["Paragraph"]);
  });

  it("passes the mounted reportId when flushing a pending debounced edit on unmount", async () => {
    const initial = makeReport("Original report body.");
    const savedTargets: Array<{ reportId: string | undefined; json: string }> = [];
    const onUpdate = vi.fn(async (json: string, reportId?: string) => {
      savedTargets.push({ reportId, json });
    });

    const { container, unmount } = await render(Editor, {
      reportId: "report-v1",
      content: initial,
      onUpdate,
      editable: true,
      presentation: "reading",
    });
    await expect.poll(() => getTiptap(container)).toBeDefined();
    const tiptap = getTiptap(container)!;

    const pos = tiptap.state.doc.content.size - 2;
    tiptap.commands.insertContentAt(pos, " Unmount flush.");
    // Unmount before the 1s debounce fires.
    unmount();

    await expect.poll(() => savedTargets.length).toBe(1);
    expect(savedTargets[0]?.reportId).toBe("report-v1");
    expect(savedTargets[0]?.json).toContain("Unmount flush.");
  });
});
