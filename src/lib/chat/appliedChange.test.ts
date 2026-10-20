import { Editor } from "@tiptap/core";
import { describe, expect, it, vi } from "vitest";
import { getEditorExtensions } from "$lib/tiptapConfig";
import {
  canonicalBlockKey,
  computeAppliedHunks,
  hunksTouchedBy,
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

// Review R2 P2-1: runs that touched on one side only were left unmerged, and
// Undo could report success while duplicating a paragraph.
describe("repeated blocks with an inserted or deleted block", () => {
  const p = (value: string) => (value === "_" ? { type: "paragraph" } : paragraph(text(value)));
  const doc = (spec: string) => ({ type: "doc", content: spec.split(" ").map(p) });
  const keys = (value: unknown) =>
    ((value as { content: unknown[] }).content).map((block) => canonicalBlockKey(block));

  /** Either no Undo is offered, or Undo gives back exactly the stored document. */
  function expectExactOrNone(before: unknown, after: unknown) {
    const hunks = computeAppliedHunks(before, after);
    if (hunks === null) return "none";
    if (hunks.length === 0) {
      expect(keys(after)).toEqual(keys(before));
      return "unchanged";
    }
    const undone = undoAppliedHunks(after, hunks);
    expect(undone.ok).toBe(true);
    if (undone.ok) expect(keys(undone.doc)).toEqual(keys(before));
    return "exact";
  }

  it("reproduces the reviewer's case exactly: a stepper card changes A and C, Enter above A", () => {
    const before = doc("A _ B _ _ C _ D");
    const after = doc("_ A2 _ B _ _ C2 _ D");
    expect(expectExactOrNone(before, after)).toBe("exact");
  });

  it.each([
    ["an empty paragraph inserted between two changes", "A _ B _ C", "A2 _ B _ _ C2"],
    ["an empty paragraph deleted between two changes", "A _ _ B _ C", "A2 _ B _ C2"],
    ["a repeated block deleted next to a change", "A B B C", "A2 B C"],
    ["a repeated block inserted next to a change", "A B C B", "A B B C2 B"],
    ["every block repeated", "_ _ _ A _ _ _", "_ _ A2 _ _ _ _"],
  ])("handles %s", (_name, stored, applied) => {
    expect(expectExactOrNone(doc(stored), doc(applied))).not.toBe("unchanged");
  });

  it("offers no Undo when a changed run cannot be told apart from its copies", () => {
    // The new text exists twice and every neighbour repeats too.
    const before = doc("_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ A _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _");
    const after = doc("_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _");
    expect(computeAppliedHunks(before, after)).toBeNull();
  });

  it("never reports success with a wrong document (seeded randomized property)", () => {
    // mulberry32: deterministic, so a failure reproduces from the seed.
    let seed = 0x5eed_2026;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const ALPHABET = ["_", "_", "_", "A", "B", "C", "D"];
    const outcomes = { none: 0, exact: 0, unchanged: 0 };
    for (let run = 0; run < 3000; run += 1) {
      const stored = Array.from({ length: 3 + Math.floor(random() * 10) }, () => pick(ALPHABET));
      const applied = [...stored];
      const edits = 1 + Math.floor(random() * 3);
      for (let edit = 0; edit < edits; edit += 1) {
        const kind = random();
        const at = Math.floor(random() * (applied.length + 1));
        if (kind < 0.5 && applied.length) applied[Math.min(at, applied.length - 1)] = `X${run}x${edit}`;
        else if (kind < 0.8) applied.splice(at, 0, pick(ALPHABET));
        else if (applied.length > 1) applied.splice(Math.min(at, applied.length - 1), 1);
      }
      const before = doc(stored.join(" "));
      const after = doc(applied.join(" "));
      outcomes[expectExactOrNone(before, after) as keyof typeof outcomes] += 1;
    }
    // Most changes keep an Undo; the rest offer none rather than a wrong one.
    expect(outcomes.exact).toBeGreaterThan(2000);
  });
});

describe("hunksTouchedBy (a stepped apply)", () => {
  it("keeps the runs the card's pairs touched and drops the writer's other edits", () => {
    const middle = paragraph(text("Middle."));
    const before = { type: "doc", content: [paragraph(text("The team tested the alloy.")), middle, paragraph(text("Other.")), paragraph(text("End."))] };
    const after = { type: "doc", content: [paragraph(text("The team measured the alloy.")), middle, paragraph(text("Other, edited by hand.")), paragraph(text("End."))] };
    const hunks = computeAppliedHunks(before, after)!;
    expect(hunks).toHaveLength(2);
    const touched = hunksTouchedBy(hunks, [{ find: "tested", replaceWith: "measured" }]);
    expect(touched).toHaveLength(1);
    const undone = undoAppliedHunks(after, touched);
    expect(undone.ok && (undone.doc.content as unknown[])).toEqual([
      paragraph(text("The team tested the alloy.")),
      middle,
      paragraph(text("Other, edited by hand.")),
      paragraph(text("End.")),
    ]);
    expect(hunksTouchedBy(hunks, [{ find: "not in the report", replaceWith: "nor this" }])).toEqual([]);
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
