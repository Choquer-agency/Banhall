import { describe, expect, test } from "vitest";
import { buildTiptapDocument, textToParagraphs, extractReportSections } from "./tiptapReport";
import {
  fillNotDraftedSections,
  NOT_GENERATED_PLACEHOLDER,
  notDraftedReportSections,
  sectionParagraphs,
} from "./tiptapReport";

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


test("nested rich-text containers preserve actual section boundaries", () => {
  const doc = buildTiptapDocument("Title", "Uncertainty.", "Work.", "Knowledge.");
  const sections = extractReportSections(JSON.stringify({ type: "doc", content: [{ type: "blockquote", content: doc.content }] }));
  expect(sections).toEqual({ s242: "Uncertainty.\n\n", s244: "Work.\n\n", s246: "Knowledge.\n\n" });
});

// ─── Story 2 (AD-24): a stopped ordered generation keeps three headings ────

describe("buildTiptapDocument for a stopped ordered generation", () => {
  test("renders [NOT GENERATED] under each undrafted heading and keeps the three H2s", () => {
    const doc = buildTiptapDocument("T", "uncertainty text", null, undefined);
    expect(doc.content.map((node) => node.type)).toEqual([
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
    const paragraphText = (node: Record<string, unknown>) =>
      (node.content as Array<{ text: string }>).map((part) => part.text).join("");
    const paragraphs = doc.content.filter((node) => node.type === "paragraph");
    expect(paragraphs.map(paragraphText)).toEqual([
      "uncertainty text",
      NOT_GENERATED_PLACEHOLDER,
      NOT_GENERATED_PLACEHOLDER,
    ]);
    // A drafted-but-empty section is not an undrafted one.
    const empty = buildTiptapDocument("T", "", "work", "adv");
    expect(empty.content.filter((node) => node.type === "paragraph")).toHaveLength(2);
  });

  test("sectionParagraphs is exactly the split the editor document uses", () => {
    const text = "first para\n\n  \n\nsecond\nsoft wrap\n\n\nthird";
    expect(sectionParagraphs(text)).toEqual(["first para", "second\nsoft wrap", "third"]);
    expect(textToParagraphs(text)).toHaveLength(sectionParagraphs(text).length);
  });
});

describe("Not drafted Sections (redraft after Stop)", () => {
  const stopped = () =>
    JSON.stringify(buildTiptapDocument("Title", "Drafted 242.", null, null));

  test("lists only Section bodies that are still the untouched placeholder", () => {
    expect(notDraftedReportSections(stopped())).toEqual(["s244", "s246"]);
    expect(notDraftedReportSections("plain text report")).toEqual([]);
  });

  test("fills a placeholder and carries every other node over unchanged", () => {
    const before = JSON.parse(stopped()) as { content: unknown[] };
    const result = fillNotDraftedSections(stopped(), {
      s244: "Work one.\n\nWork two.",
    });
    expect(result.filled).toEqual(["s244"]);
    expect(result.skipped).toEqual([]);
    const after = JSON.parse(result.content) as { content: unknown[] };
    // Title, 242 heading and body, divider, 244 heading are identical.
    expect(after.content.slice(0, 5)).toEqual(before.content.slice(0, 5));
    expect(after.content.slice(5, 7)).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "Work one." }] },
      { type: "paragraph", content: [{ type: "text", text: "Work two." }] },
    ]);
    // The 246 placeholder and its heading are untouched.
    expect(after.content.slice(7)).toEqual(before.content.slice(6));
    expect(notDraftedReportSections(result.content)).toEqual(["s246"]);
  });

  test("never overwrites a Section the writer typed into or already drafted", () => {
    const typed = stopped().replace(
      NOT_GENERATED_PLACEHOLDER,
      `${NOT_GENERATED_PLACEHOLDER} and a note from the writer`
    );
    const result = fillNotDraftedSections(typed, {
      s242: "Replacement 242.",
      s244: "Draft 244.",
      s246: "Draft 246.",
    });
    expect(result.filled).toEqual(["s246"]);
    expect(result.skipped).toEqual(["s242", "s244"]);
    expect(result.content).toContain("Drafted 242.");
    expect(result.content).toContain("and a note from the writer");
  });

  test("tolerates empty paragraphs around the placeholder and refuses duplicate headings", () => {
    const doc = JSON.parse(stopped()) as { content: Array<Record<string, unknown>> };
    const index = doc.content.findIndex((node) =>
      JSON.stringify(node).includes(NOT_GENERATED_PLACEHOLDER)
    );
    doc.content.splice(index, 0, { type: "paragraph" });
    expect(fillNotDraftedSections(JSON.stringify(doc), { s244: "Draft." }).filled)
      .toEqual(["s244"]);
    const heading244 = doc.content.find((node) => JSON.stringify(node).includes("Line 244"));
    doc.content.push(heading244 as Record<string, unknown>);
    expect(fillNotDraftedSections(JSON.stringify(doc), { s244: "Draft." }).filled)
      .toEqual([]);
  });
});
