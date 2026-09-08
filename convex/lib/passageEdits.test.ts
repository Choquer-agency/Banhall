import { describe, expect, it } from "vitest";
import { applyPassageEdits } from "./passageEdits";

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
});
