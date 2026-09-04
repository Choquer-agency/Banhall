import { describe, expect, test } from "vitest";
import { buildTiptapDocument, textToParagraphs, extractReportSections } from "./tiptapReport";

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


describe("extractReportSections", () => {
  test("joins marked inline text and preserves separate paragraphs", () => {
    const content = JSON.stringify({ type: "doc", content: [
      { type: "heading", content: [{ type: "text", text: "Line 242 — Uncertainty" }] },
      { type: "paragraph", content: [
        { type: "text", text: "It was " },
        { type: "text", text: "uncertain", marks: [{ type: "bold" }] },
        { type: "text", text: " whether the method scales." },
      ] },
      { type: "paragraph", content: [{ type: "text", text: "Separate paragraph because this is unrelated." }] },
      { type: "heading", content: [{ type: "text", text: "Line 244 — Work" }] },
      { type: "paragraph", content: [{ type: "text", text: "Work performed." }] },
    ] });
    const sections = extractReportSections(content);
    expect(sections.s242.trim()).toBe("It was uncertain whether the method scales.\n\nSeparate paragraph because this is unrelated.");
    expect(sections.s244.trim()).toBe("Work performed.");
  });

  test("preserves CRLF legacy paragraphs and section boundaries", () => {
    const sections = extractReportSections("Line 242 — Uncertainty\r\n\r\nIt remained uncertain whether this scales.\r\n\r\nAnother paragraph because of context.\r\n\r\nLine 244 — Work\r\n\r\nExperimented.");
    expect(sections.s242.trim()).toBe("It remained uncertain whether this scales.\n\nAnother paragraph because of context.");
    expect(sections.s244.trim()).toBe("Experimented.");
  });
});

describe("section extraction boundary regressions", () => {
  test("retains heading-like body prose and excludes generated title preamble", () => {
    const sections = extractReportSections(JSON.stringify(buildTiptapDocument("It was uncertain whether title text applies.", "Line 244 — It was uncertain whether this scales.", "Work.", "Knowledge.")));
    expect(sections.s242.trim()).toBe("Line 244 — It was uncertain whether this scales.");
    expect(sections.s244.trim()).toBe("Work.");
  });
  test("parses standalone legacy headings separated by single newlines", () => {
    const sections = extractReportSections("Title\nLine 242 — Uncertainty\nIt was uncertain whether this scales.\nLine 244 — Work\nWork performed.\nLine 246 — Advancement\nKnowledge.");
    expect(sections.s242.trim()).toBe("It was uncertain whether this scales.");
    expect(sections.s244.trim()).toBe("Work performed.");
    expect(sections.s246.trim()).toBe("Knowledge.");
  });
  test("empty valid Tiptap documents produce empty sections", () => {
    expect(extractReportSections('{"type":"doc","content":[]}')).toEqual({ s242: "", s244: "", s246: "" });
  });
});


test("preserves soft line wraps in legacy uncertainty explanations", () => {
  const sections = extractReportSections("Line 242 — Uncertainty\nIt was uncertain whether\nthe alloy holds because its response was unknown.\n\nNext paragraph.");
  expect(sections.s242.trim()).toBe("It was uncertain whether\nthe alloy holds because its response was unknown.\n\nNext paragraph.");
});
