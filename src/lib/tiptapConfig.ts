import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import CharacterCount from "@tiptap/extension-character-count";
import Underline from "@tiptap/extension-underline";
import { Extension } from "@tiptap/core";

/**
 * Custom keyboard shortcuts extension.
 */
const CustomKeyboardShortcuts = Extension.create({
  name: "customKeyboardShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-h": () =>
        this.editor.chain().focus().toggleHighlight().run(),
    };
  },
});

export function getEditorExtensions({
  editable = true,
}: { editable?: boolean } = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      horizontalRule: {},
      codeBlock: {},
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === "heading") {
          return "Heading...";
        }
        return editable ? 'Type "/" for commands...' : "";
      },
    }),
    Highlight.configure({
      multicolor: true,
      HTMLAttributes: {
        class: "tiptap-highlight",
      },
    }),
    CharacterCount,
    Underline,
    CustomKeyboardShortcuts,
  ];
}
