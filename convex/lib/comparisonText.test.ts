import { describe, expect, it } from "vitest";
import { comparisonPlainText } from "./comparisonText";

// AD-29 (story 6): `draftTextMatches` is only meaningful if both sides of the
// comparison — the stored revision and the judge's pasted strip — go through
// one normalization rule. These cases pin that rule: layout never changes the
// result, words always do.

describe("comparisonPlainText", () => {
  it("normalizes the golden example identically with and without the section heading", () => {
    const withHeading = [
      "Line 242 — Technological Uncertainty",
      "  The team could not predict   the fatigue limit.",
      "",
      "The alloy failed early.",
    ].join("\n");
    const withoutHeading = [
      "The team could not predict the fatigue limit.",
      "",
      "The alloy failed early.",
    ].join("\n");

    expect(comparisonPlainText(withHeading)).toBe(
      "The team could not predict the fatigue limit. The alloy failed early."
    );
    expect(comparisonPlainText(withoutHeading)).toBe(
      comparisonPlainText(withHeading)
    );
  });

  it("is insensitive to CRLF, indentation, blank lines and internal whitespace runs", () => {
    const noisy =
      "Line 242 — Uncertainty\r\n\r\n\tThe  team   could not predict the fatigue limit.  \r\n\r\n";
    const clean = "The team could not predict the fatigue limit.";
    expect(comparisonPlainText(noisy)).toBe(clean);
  });

  // R12: a Tiptap revision emits one line per paragraph; a blinded strip is
  // usually hard-wrapped at some column. Neither wrapping nor the paragraph
  // separator convention may change prose equality.
  it("ignores soft line wraps and paragraph-separator conventions", () => {
    const unwrapped = [
      "The team could not predict the fatigue limit of the new alloy.",
      "The alloy failed early in every coupon series.",
    ].join("\n");
    const hardWrapped = [
      "The team could not predict the",
      "fatigue limit of the new alloy.",
      "",
      "",
      "The alloy failed early in",
      "   every coupon series.",
    ].join("\r\n");

    expect(comparisonPlainText(hardWrapped)).toBe(
      comparisonPlainText(unwrapped)
    );
    expect(comparisonPlainText(unwrapped)).toBe(
      "The team could not predict the fatigue limit of the new alloy. The alloy failed early in every coupon series."
    );
  });

  it("normalizes Tiptap JSON and the equivalent plain strip to the same text", () => {
    const tiptap = JSON.stringify({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "Line 242 — Scientific/Technological Uncertainty" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "The fatigue limit was unknown." }],
        },
        { type: "horizontalRule" },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Line 244 — Work Performed" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "The team ran the coupon series." }],
        },
        { type: "horizontalRule" },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "text", text: "Line 246 — Scientific/Technological Advancement" },
          ],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "A revised fatigue model resulted." }],
        },
      ],
    });
    const strip = [
      "The fatigue limit was unknown.",
      "The team ran the coupon series.",
      "A revised fatigue model resulted.",
    ].join("\n\n");
    // The same strip, hard-wrapped by whoever blinded it.
    const wrappedStrip =
      "The fatigue limit\nwas unknown.\nThe team ran\nthe coupon series.\nA revised fatigue\nmodel resulted.";

    expect(comparisonPlainText(tiptap)).toBe(
      "The fatigue limit was unknown. The team ran the coupon series. A revised fatigue model resulted."
    );
    expect(comparisonPlainText(strip)).toBe(comparisonPlainText(tiptap));
    expect(comparisonPlainText(wrappedStrip)).toBe(comparisonPlainText(tiptap));
  });

  it("keeps section prose in 242/244/246 order regardless of paste order", () => {
    const original = [
      "Line 242 — Uncertainty",
      "Alpha.",
      "Line 244 — Work",
      "Beta.",
      "Line 246 — Advancement",
      "Gamma.",
    ].join("\n");
    expect(comparisonPlainText(original)).toBe("Alpha. Beta. Gamma.");
  });

  it("distinguishes a different draft", () => {
    expect(comparisonPlainText("The alloy failed early.")).not.toBe(
      comparisonPlainText("A different draft entirely.")
    );
  });

  // Layout is invisible to the rule; a single changed word is not.
  it("still distinguishes a one-word change inside otherwise identical prose", () => {
    const before = "The team could not predict the fatigue limit.";
    const after = "The team could not predict the fracture limit.";
    expect(comparisonPlainText(before)).not.toBe(comparisonPlainText(after));
  });

  it("returns an empty string for content with no prose", () => {
    expect(comparisonPlainText("   \n\n\t  ")).toBe("");
    // Serialized input that carries no prose at all — R15's empty-match trap.
    expect(
      comparisonPlainText(JSON.stringify({ type: "doc", content: [] }))
    ).toBe("");
  });
});
