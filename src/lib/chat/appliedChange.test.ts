import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { getEditorExtensions } from "$lib/tiptapConfig";
import {
  canonicalBlockKey,
  computeAppliedHunks,
  undoAppliedHunks,
} from "../../../convex/lib/appliedChange";
import { applyReplacements, type PMNode } from "../../../convex/lib/reportEdits";

/**
 * Chat parity Phase B (W3): Undo matches the applied blocks in a canonical
 * form, so a report the editor re-saved after the apply still matches. These
 * run the real editor (Tiptap's `getJSON`, which is how the report page
 * saves) over the applied document. Fictional text only.
 */

const text = (value: string, marks?: Array<Record<string, unknown>>) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: object[]) => ({ type: "paragraph", content });

const ORIGINAL = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [text("Line 242")] },
    paragraph(
      text("The team "),
      text("tested", [{ type: "bold" }]),
      text(" the coupon at "),
      // Stored without the highlight's color: the editor adds `color: null`.
      text("[GAP: load]", [{ type: "highlight" }]),
      text(" cycles.")
    ),
    paragraph(text("The coating was "), text("sprayed", [{ type: "italic" }, { type: "bold" }]), text(" twice.")),
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Fixture A"))] }] },
    paragraph(text("The rig ran overnight.")),
  ],
};

function editorResave(doc: unknown): Record<string, unknown> {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const editor = new Editor({ element: null, injectCSS: false, extensions: getEditorExtensions(), content: doc as object });
  try {
    return editor.getJSON() as Record<string, unknown>;
  } finally {
    editor.destroy();
    warn.mockRestore();
  }
}

describe("canonicalBlockKey", () => {
  it("ignores key order, null attributes, empty attrs and marks, mark order and split text runs", () => {
    const stored = paragraph(text("The coating was "), text("sprayed", [{ type: "italic" }, { type: "bold" }]));
    const resaved = {
      content: [
        { text: "The coating ", type: "text" },
        { type: "text", text: "was ", marks: [] },
        { type: "text", text: "sprayed", marks: [{ type: "bold", attrs: {} }, { type: "italic" }] },
      ],
      attrs: { textAlign: null },
      type: "paragraph",
    };
    expect(canonicalBlockKey(resaved)).toBe(canonicalBlockKey(stored));
    expect(canonicalBlockKey(paragraph(text("Other")))).not.toBe(canonicalBlockKey(stored));
    // A real attribute still counts.
    expect(canonicalBlockKey({ type: "heading", attrs: { level: 2 } })).not.toBe(canonicalBlockKey({ type: "heading", attrs: { level: 3 } }));
  });
});

describe("computeAppliedHunks", () => {
  it("records only the changed blocks, and nothing when nothing changed", () => {
    expect(computeAppliedHunks(ORIGINAL, structuredClone(ORIGINAL))).toEqual([]);
    const after = structuredClone(ORIGINAL);
    after.content[4] = paragraph(text("The rig ran for 14 hours."));
    const hunks = computeAppliedHunks(ORIGINAL, after)!;
    expect(hunks).toEqual([
      { before: JSON.stringify([ORIGINAL.content[4]]), after: JSON.stringify([after.content[4]]) },
    ]);
  });

  it("gives an inserted or deleted block a neighbour, so Undo can find it", () => {
    const deleted = { ...ORIGINAL, content: ORIGINAL.content.filter((_, index) => index !== 2) };
    const hunks = computeAppliedHunks(ORIGINAL, deleted)!;
    expect(hunks).toHaveLength(1);
    expect(JSON.parse(hunks[0]!.after).length).toBeGreaterThan(0);
    expect(undoAppliedHunks(deleted, hunks)).toEqual({ ok: true, doc: ORIGINAL });
  });

  it("grows a run whose new text repeats elsewhere until it is unique", () => {
    const doc = { type: "doc", content: [paragraph(text("A")), paragraph(text("Same")), paragraph(text("B")), paragraph(text("Old"))] };
    const after = structuredClone(doc);
    after.content[3] = paragraph(text("Same"));
    const hunks = computeAppliedHunks(doc, after)!;
    expect(JSON.parse(hunks[0]!.after)).toEqual([paragraph(text("B")), paragraph(text("Same"))]);
    expect(undoAppliedHunks(after, hunks)).toEqual({ ok: true, doc });
  });

  it("returns null for something that is not a document", () => {
    expect(computeAppliedHunks(null, ORIGINAL)).toBeNull();
    expect(computeAppliedHunks(ORIGINAL, { type: "doc" })).toBeNull();
  });
});

describe("undoAppliedHunks after the editor re-saves the report", () => {
  it("restores a passage whose apply rebuilt its block as plain text", () => {
    const { doc: applied } = applyReplacements(ORIGINAL as PMNode, [
      { find: "The team tested the coupon at [GAP: load] cycles.", replaceWith: "The team cycled the coupon at [GAP: load] cycles." },
    ]);
    const hunks = computeAppliedHunks(ORIGINAL, applied)!;
    const resaved = editorResave(applied);
    // The editor really did re-save it differently.
    expect(JSON.stringify(resaved)).not.toBe(JSON.stringify(applied));
    const undone = undoAppliedHunks(resaved, hunks);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect((undone.doc.content as unknown[])[1]).toEqual(ORIGINAL.content[1]);
  });

  it("restores marks in a block whose text node kept them", () => {
    const { doc: applied } = applyReplacements(ORIGINAL as PMNode, [{ find: "sprayed", replaceWith: "brushed" }]);
    const hunks = computeAppliedHunks(ORIGINAL, applied)!;
    const resaved = editorResave(applied);
    // The writer then edits another paragraph in the editor.
    const edited = editorResave({ type: "doc", content: [paragraph(text("The rig ran overnight, twice."))] });
    (resaved.content as Array<Record<string, unknown>>)[4] = (edited.content as Array<Record<string, unknown>>)[0]!;
    const undone = undoAppliedHunks(resaved, hunks);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    const content = undone.doc.content as unknown[];
    expect(content[2]).toEqual(ORIGINAL.content[2]);
    expect(content[4]).toEqual(paragraph(text("The rig ran overnight, twice.")));
  });

  it("refuses when the passage changed after the apply, and when runs overlap", () => {
    const { doc: applied } = applyReplacements(ORIGINAL as PMNode, [{ find: "overnight", replaceWith: "all night" }]);
    const hunks = computeAppliedHunks(ORIGINAL, applied)!;
    const edited = editorResave(applied);
    (edited.content as Array<Record<string, unknown>>)[4] = paragraph(text("The rig ran all night and day."));
    expect(undoAppliedHunks(edited, hunks)).toEqual({ ok: false });
    expect(undoAppliedHunks(applied, [...hunks, ...hunks])).toEqual({ ok: false });
    expect(undoAppliedHunks(applied, [])).toEqual({ ok: false });
    expect(undoAppliedHunks(applied, [{ before: "not json", after: hunks[0]!.after }])).toEqual({ ok: false });
  });
});
