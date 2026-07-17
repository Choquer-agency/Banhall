import { describe, expect, test } from "vitest";
import { buildTiptapDocument, textToParagraphs } from "./tiptapReport";

describe("textToParagraphs", () => {
  test("splits on blank lines and drops empty paragraphs", () => {
    const nodes = textToParagraphs("first para\n\nsecond para\n\n\n");
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "first para" }],
    });
  });

  test("highlights [GAP: …] markers as separate marked text nodes", () => {
    const [node] = textToParagraphs("before [GAP: need dates] after");
    const content = node.content as Array<Record<string, unknown>>;
    expect(content).toHaveLength(3);
    expect(content[1]).toMatchObject({
      text: "[GAP: need dates]",
      marks: [{ type: "highlight", attrs: { color: "#FEF3C7" } }],
    });
  });
});

describe("buildTiptapDocument", () => {
  test("produces the exact section headings the export parser matches", () => {
    const doc = buildTiptapDocument("Title", "a", "b", "c");
    const headings = doc.content
      .filter((n) => n.type === "heading")
      .map(
        (n) =>
          (n.content as Array<{ text: string }> | undefined)?.[0]?.text ?? ""
      );
    expect(headings).toEqual([
      "Title",
      "Line 242 — Scientific/Technological Uncertainty",
      "Line 244 — Work Performed",
      "Line 246 — Scientific/Technological Advancement",
    ]);
  });

  test("keeps section prose under its own heading in order", () => {
    const doc = buildTiptapDocument("T", "uncertainty text", "work text", "adv text");
    const kinds = doc.content.map((n) => n.type);
    // h1, h2, p, hr, h2, p, hr, h2, p
    expect(kinds).toEqual([
      "heading",
      "heading",
      "paragraph",
      "horizontalRule",
      "heading",
      "paragraph",
      "horizontalRule",
      "heading",
      "paragraph",
    ]);
  });
});
