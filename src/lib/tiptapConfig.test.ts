import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { getEditorExtensions } from "./tiptapConfig";

const underlinedDocument = {
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{ type: "text", text: "Alpha", marks: [{ type: "underline" }] }],
  }],
};
const plainDocument = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Alpha" }] }],
};

function verifyUnderline(editable: boolean) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  let editor: Editor | undefined;
  try {
    editor = new Editor({
      element: null,
      editable,
      injectCSS: false,
      extensions: getEditorExtensions({ editable }),
      content: underlinedDocument,
    });
    expect.soft(editor.extensionManager.extensions.filter(({ name }) => name === "underline")).toHaveLength(1);
    expect(editor.getJSON()).toEqual(underlinedDocument);
    if (editable) {
      expect(editor.commands.setTextSelection({ from: 1, to: 6 })).toBe(true);
      expect(editor.commands.toggleUnderline()).toBe(true);
      expect(editor.getJSON()).toEqual(plainDocument);
      expect(editor.commands.toggleUnderline()).toBe(true);
    }
    expect(editor.getJSON()).toEqual(underlinedDocument);
    expect.soft(warn.mock.calls.filter((args) => args.join(" ").includes("Duplicate extension"))).toEqual([]);
  } finally {
    try {
      editor?.destroy();
    } finally {
      warn.mockRestore();
    }
  }
}

describe("getEditorExtensions underline", () => {
  it("registers underline once and preserves editable JSON through off/on toggles", () => {
    verifyUnderline(true);
  });

  it("registers underline once and preserves read-only JSON", () => {
    verifyUnderline(false);
  });
});
