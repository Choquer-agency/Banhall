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

  it("refuses a rewrite with a different number of paragraphs, or no change", () => {
    const target = "First paragraph, long.\n\nThird paragraph, long.";
    expect(editPassages(target, "One merged paragraph.")).toEqual({
      ok: false,
      reason: "targetText has 2 paragraphs but newText has 1. A proposal keeps the paragraph count: give newText one paragraph for each paragraph of targetText, in the same order, separated by a blank line.",
    });
    expect(editPassages(target, target).ok).toBe(false);
  });

  // Review 2026-10-21: a blank line inside one paragraph's new text would
  // only put a line break in that paragraph.
  it("refuses splitting one paragraph into two", () => {
    expect(editPassages("First paragraph, long.", "First half.\n\nSecond half.")).toMatchObject({
      ok: false,
      reason: expect.stringContaining("targetText has 1 paragraph but newText has 2"),
    });
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
