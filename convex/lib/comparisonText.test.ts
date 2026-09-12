import { describe, expect, it } from "vitest";
import { comparisonPlainText } from "./comparisonText";

// AD-29 (story 6): `draftTextMatches` is only meaningful if both sides of the
// comparison — the stored revision and the judge's pasted strip — go through
// one normalization rule. These cases pin that rule.

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
      "The team could not predict the fatigue limit.\nThe alloy failed early."
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

    expect(comparisonPlainText(tiptap)).toBe(
      "The fatigue limit was unknown.\nThe team ran the coupon series.\nA revised fatigue model resulted."
    );
    expect(comparisonPlainText(strip)).toBe(comparisonPlainText(tiptap));
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
    expect(comparisonPlainText(original)).toBe("Alpha.\nBeta.\nGamma.");
  });

  it("distinguishes a different draft", () => {
    expect(comparisonPlainText("The alloy failed early.")).not.toBe(
      comparisonPlainText("A different draft entirely.")
    );
  });

  it("returns an empty string for content with no prose", () => {
    expect(comparisonPlainText("   \n\n\t  ")).toBe("");
  });
});
