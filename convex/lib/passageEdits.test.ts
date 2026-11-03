import { describe, expect, it } from "vitest";
import { applyPassageEdits, editPassages } from "./passageEdits";
import { applyReplacements } from "./reportEdits";

const doc = (texts: string[]) => ({ type: "doc", content: texts.map(text => ({
  type: "paragraph", content: [{ type: "text", text }],
})) });

describe("independent passage revisions", () => {
  it("revises sixteen different passages and preserves unrelated prose", () => {
    const original = Array.from({ length: 16 }, (_, i) => `Finding ${i + 1}: old wording.`);
    const pairs = original.map((find, i) => ({ find, replaceWith: `Correction ${i + 1}: supported wording.` }));
    const input = doc([...original, "Unrelated passage."]);
    const before = JSON.stringify(input);
    expect(applyPassageEdits(input, pairs)).toEqual({
      ok: true, count: 16, doc: doc([...pairs.map(p => p.replaceWith), "Unrelated passage."]),
    });
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([
    [{ find: "missing", replaceWith: "new" }],
    [{ find: "one", replaceWith: "two" }, { find: "one", replaceWith: "three" }],
    [{ find: "one two", replaceWith: "three" }, { find: "two", replaceWith: "four" }],
  ])("rejects stale, repeated or overlapping targets", (...pairs) => {
    expect(applyPassageEdits(doc(["one two"]), pairs).ok).toBe(false);
  });

  it("applies original ranges once when new prose contains an old target", () => {
    expect(applyPassageEdits(doc(["Original sentence."]), [
      { find: "Original sentence.", replaceWith: "Original sentence. Added supported detail." },
    ])).toEqual({ ok: true, count: 1, doc: doc(["Original sentence. Added supported detail."]) });
    expect(applyPassageEdits(doc(["one two"]), [
      { find: "one", replaceWith: "two" }, { find: "two", replaceWith: "three" },
    ])).toEqual({ ok: true, count: 2, doc: doc(["two three"]) });
  });

  it("keeps numeric and private-use text targets from colliding with internal markers", () => {
    expect(applyPassageEdits(doc(["Introduction.", "0", "\uE000"]), [
      { find: "Introduction.", replaceWith: "Overview." },
      { find: "0", replaceWith: "1" },
      { find: "\uE000", replaceWith: "Label" },
    ])).toEqual({ ok: true, count: 3, doc: doc(["Overview.", "1", "Label"]) });
  });

  it("names Section headings when a passage's only match is heading text", () => {
    const withHeading = { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Line 244 — Work Performed" }] },
      { type: "paragraph", content: [{ type: "text", text: "Trials held one condition." }] },
    ] };
    const refused = applyPassageEdits(withHeading, [{ find: "Work Performed", replaceWith: "Experiments" }]);
    expect(refused).toMatchObject({ ok: false, reason: expect.stringContaining("Section headings can't be edited.") });
    // Text in both a heading and the body applies to the one body passage.
    const both = { type: "doc", content: [
      ...withHeading.content,
      { type: "paragraph", content: [{ type: "text", text: "The work performed in phase 2 cycled coupons." }] },
    ] };
    expect(applyPassageEdits(both, [{ find: "work performed", replaceWith: "tests run" }])).toMatchObject({ ok: true, count: 1 });
  });
});

// Owner, 2026-10-21: a trim across a whole Line once failed (a match never
// crosses a paragraph) and came back as four cards.
describe("editPassages", () => {
  const report = doc(["First paragraph, long.", "Second paragraph stays.", "Third paragraph, long."]);

  it("keeps a target inside one paragraph as one passage", () => {
    expect(editPassages("First paragraph, long.", "First paragraph.")).toEqual({
      ok: true,
      pairs: [{ find: "First paragraph, long.", replaceWith: "First paragraph." }],
    });
  });

  it("pairs each paragraph of a multi-paragraph target with its rewrite and drops unchanged ones", () => {
    const target = "First paragraph, long.\n\nSecond paragraph stays.\n\nThird paragraph, long.";
    // The whole target never matches: matching works one paragraph at a time.
    expect(applyReplacements(report, [{ find: target, replaceWith: "x" }]).count).toBe(0);
    const result = editPassages(target, "First paragraph.\n\nSecond paragraph stays.\n \nThird paragraph.");
    expect(result).toEqual({
      ok: true,
      pairs: [
        { find: "First paragraph, long.", replaceWith: "First paragraph." },
        { find: "Third paragraph, long.", replaceWith: "Third paragraph." },
      ],
    });
    expect(result.ok && applyPassageEdits(report, result.pairs)).toEqual({
      ok: true, count: 2, doc: doc(["First paragraph.", "Second paragraph stays.", "Third paragraph."]),
    });
  });

  it("refuses a rewrite with no change", () => {
    const target = "First paragraph, long.\n\nThird paragraph, long.";
    expect(editPassages(target, target).ok).toBe(false);
  });

  // 2026-11-03 (owner): a card can add, split and merge paragraphs.
  it("pairs a split or an added paragraph with the last target paragraph", () => {
    expect(editPassages("First paragraph, long.", "First half.\n\nSecond half.")).toEqual({
      ok: true,
      pairs: [{ find: "First paragraph, long.", replaceWith: "First half.\n\nSecond half." }],
    });
    expect(editPassages("One.\n\nTwo.", "One, reworded.\n\nTwo.\n\nA new third.")).toEqual({
      ok: true,
      pairs: [
        { find: "One.", replaceWith: "One, reworded." },
        { find: "Two.", replaceWith: "Two.\n\nA new third." },
      ],
    });
  });

  it("removes the target paragraphs a merge leaves over", () => {
    expect(editPassages("First paragraph, long.\n\nThird paragraph, long.", "One merged paragraph.")).toEqual({
      ok: true,
      pairs: [
        { find: "First paragraph, long.", replaceWith: "One merged paragraph." },
        { find: "Third paragraph, long.", replaceWith: "" },
      ],
    });
    expect(editPassages("First.", "")).toMatchObject({ ok: false });
  });

  it("applies a split, an added paragraph and a merge to whole top-level paragraphs, only when asked", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Line 244 - Work Performed" }] },
        { type: "paragraph", content: [{ type: "text", text: "Alpha one. Alpha two." }] },
        { type: "paragraph", content: [{ type: "text", text: "Beta. " }, { type: "text", text: "[GAP: when]", marks: [{ type: "highlight" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Gamma." }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item A." }] }] }] },
      ],
    };
    const on = { paragraphs: true };
    const texts = (d: unknown) =>
      ((d as { content: Array<{ type: string; content?: Array<{ text: string }> }> }).content)
        .filter((n) => n.type === "paragraph")
        .map((n) => n.content?.map((c) => c.text).join("") ?? "");
    const split = applyPassageEdits(doc, [{ find: "Alpha one. Alpha two.", replaceWith: "Alpha one.\n\nAlpha two." }], on);
    expect(split.ok && texts(split.doc)).toEqual(["Alpha one.", "Alpha two.", "Beta. [GAP: when]", "Gamma."]);
    const merged = applyPassageEdits(doc, [
      { find: "Alpha one. Alpha two.", replaceWith: "Alpha one, then Gamma." },
      { find: "Gamma.", replaceWith: "" },
    ], on);
    expect(merged.ok && texts(merged.doc)).toEqual(["Alpha one, then Gamma.", "Beta. [GAP: when]"]);
    // Adding after a paragraph keeps that paragraph's node, its gap highlight included.
    const added = applyReplacements(doc, [{ find: "Beta. [GAP: when]", replaceWith: "Beta. [GAP: when]\n\nDelta." }], on);
    expect((added.doc.content as unknown[])[2]).toBe(doc.content[2]);
    expect(texts(added.doc)).toEqual(["Alpha one. Alpha two.", "Beta. [GAP: when]", "Delta.", "Gamma."]);
    // Never a blank line inside a paragraph: a split of part of one matches nothing.
    expect(applyReplacements(doc, [{ find: "Alpha one.", replaceWith: "A.\n\nB." }], on).count).toBe(0);
    expect(applyPassageEdits(doc, [{ find: "Alpha one.", replaceWith: "A.\n\nB." }], on)).toMatchObject({ ok: false, reason: expect.stringContaining("needs whole paragraphs") });
    // A paragraph in a list keeps its place: only top-level paragraphs change.
    const listItem = applyReplacements(doc, [{ find: "Item A.", replaceWith: "" }], on);
    expect(JSON.stringify(listItem.doc)).toContain('"type":"listItem","content":[{"type":"paragraph"');
    // An empty replacement inside a paragraph still deletes that text only.
    expect(texts(applyReplacements(doc, [{ find: " Alpha two.", replaceWith: "" }], on).doc)[0]).toBe("Alpha one.");
    // Off (research edits, client suggestions): the old inline behaviour.
    const off = applyReplacements(doc, [{ find: "Gamma.", replaceWith: "" }]);
    expect(texts(off.doc)).toHaveLength(3);
  });

  it("never leaves an empty text node, and a passage set keeps an unchanged paragraph's marks (final review 2026-11-03)", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Beta. " }, { type: "text", text: "[GAP: when]", marks: [{ type: "highlight" }] }] },
        { type: "paragraph", content: [{ type: "text", text: "Gamma." }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Item A." }] }] }] },
      ],
    };
    const on = { paragraphs: true };
    expect(JSON.stringify(applyReplacements(doc, [{ find: "Item A.", replaceWith: "" }], on).doc)).not.toContain('"text":""');
    const set = applyPassageEdits(doc, [
      { find: "Beta. [GAP: when]", replaceWith: "Beta. [GAP: when]\n\nDelta." },
      { find: "Gamma.", replaceWith: "Gamma, reworded." },
    ], on);
    expect(set.ok && (set.doc.content as unknown[])[0]).toBe(doc.content[0]);
  });

  it("merges through the direct path without deleting the merged text (final review 2026-11-03)", () => {
    const doc = {
      type: "doc",
      content: ["Alpha one.", "Beta two.", "Gamma three."].map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    };
    const merged = applyReplacements(doc, [
      { find: "Alpha one.", replaceWith: "Alpha one. Beta two." },
      { find: "Beta two.", replaceWith: "" },
    ], { paragraphs: true });
    expect((merged.doc.content as Array<{ content: Array<{ text: string }> }>).map((p) => p.content[0].text)).toEqual([
      "Alpha one. Beta two.",
      "Gamma three.",
    ]);
  });

  it("refuses a passage set whose paragraph change no longer lands, leaving no marker behind (review 2026-11-03)", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Alpha." }] },
        { type: "paragraph", content: [{ type: "text", text: "Beta one. Beta two." }] },
      ],
    };
    // The card was made when the second paragraph read "Beta one."; the writer has since added to it.
    const result = applyPassageEdits(doc, [
      { find: "Alpha.", replaceWith: "Alpha, reworded." },
      { find: "Beta one.", replaceWith: "Beta one.\n\nNew paragraph." },
    ], { paragraphs: true });
    expect(result.ok).toBe(false);
  });

  it("reads Windows line breaks and trims a one-paragraph target", () => {
    expect(editPassages("First paragraph, long.\r\n\r\nThird paragraph, long.", "First.\r\n\r\nThird.")).toEqual({
      ok: true,
      pairs: [
        { find: "First paragraph, long.", replaceWith: "First." },
        { find: "Third paragraph, long.", replaceWith: "Third." },
      ],
    });
    expect(editPassages("First paragraph, long.\n", "First paragraph.\n")).toEqual({
      ok: true,
      pairs: [{ find: "First paragraph, long.", replaceWith: "First paragraph." }],
    });
  });

  it("treats a paragraph retyped with plain quotes and dashes as unchanged", () => {
    const target = "The \u201ckiln\u201d test \u2014 run once.\n\nThird paragraph, long.";
    expect(editPassages(target, "The \"kiln\" test - run once.\n\nThird.")).toEqual({
      ok: true,
      pairs: [{ find: "Third paragraph, long.", replaceWith: "Third." }],
    });
  });
});
