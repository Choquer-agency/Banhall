import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-svelte";
import { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "./Editor.svelte";
import type { ResearchSelection } from "./types";

/**
 * Chat parity Phase C (W3): "Vet against public sources" sits beside
 * "Research this selection" in the selection toolbar and sends the same
 * selection with the vet preset. All text is fictional.
 */

const CONTENT = JSON.stringify({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "Kiln drying above 80 C is known to warp birch boards." }] },
  ],
});

async function selectWithMouse(onResearch: (selection: ResearchSelection) => void) {
  const result = await render(Editor, { content: CONTENT, onResearch });
  await expect.poll(() => result.container.querySelector(".tiptap-editor")).not.toBeNull();
  const element = result.container.querySelector(".tiptap-editor");
  if (!element || !("editor" in element) || !(element.editor instanceof TiptapEditor)) {
    throw new Error("Mounted Tiptap editor instance is unavailable");
  }
  const tiptap = element.editor;
  // The toolbar answers a writer's own selection: a real triple click.
  await userEvent.tripleClick(page.getByText("Kiln drying above 80 C is known to warp birch boards."));
  await expect.poll(() => document.querySelector('button[title="Vet against public sources"]')).not.toBeNull();
  return tiptap;
}

describe("Vet against public sources in the selection toolbar", () => {
  it("sends the selection with the vet preset; Research stays as it was", async () => {
    const onResearch = vi.fn<(selection: ResearchSelection) => void>();
    await selectWithMouse(onResearch);
    const vet = page.getByRole("button", { name: "Vet against public sources", exact: true });
    const research = page.getByRole("button", { name: "Research this selection", exact: true });
    await expect.element(vet).toBeInTheDocument();
    await expect.element(research).toBeInTheDocument();
    // Beside "Research this selection".
    expect(research.element().nextElementSibling).toBe(vet.element());
    // The toolbar floats above the first line, outside the test frame.
    (vet.element() as HTMLButtonElement).click();
    expect(onResearch).toHaveBeenCalledTimes(1);
    expect(onResearch.mock.calls[0][0]).toMatchObject({
      text: "Kiln drying above 80 C is known to warp birch boards.",
      preset: "vet",
    });
  });

  it("Research this selection sends no preset", async () => {
    const onResearch = vi.fn<(selection: ResearchSelection) => void>();
    await selectWithMouse(onResearch);
    (page.getByRole("button", { name: "Research this selection", exact: true }).element() as HTMLButtonElement).click();
    expect(onResearch).toHaveBeenCalledTimes(1);
    expect(onResearch.mock.calls[0][0]).not.toHaveProperty("preset");
  });
});
