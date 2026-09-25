import { describe, expect, it } from "vitest";
import { applyReplacements, locateSelection, type PMNode } from "./reportEdits";
import { applyPassageEdits } from "./passageEdits";
import { buildTiptapDocument, extractReportSections } from "./tiptapReport";

/**
 * Review g1 (2026-09-25): the server's Apply path must never rewrite the
 * load-bearing "Line 24x" Section headings, or export loses the Section.
 */
const report = () =>
  buildTiptapDocument(
    "Report",
    "The technological uncertainty was whether the loop stays stable.",
    "Work performed in trials held one condition steady.",
    "The work clarified the technological advancement achieved."
  ) as unknown as PMNode;

const headings = (doc: PMNode) =>
  ((doc.content as PMNode[]) ?? [])
    .filter((node) => node.type === "heading")
    .map((node) => ((node.content as PMNode[]) ?? []).map((child) => child.text).join(""));

describe("Section headings on the server Apply path", () => {
  it("replaces prose but leaves the Line 242 heading intact", () => {
    const original = report();
    const { doc, count } = applyReplacements(original, [
      { find: "technological uncertainty", replaceWith: "technical question" },
    ]);
    expect(headings(doc)).toEqual(headings(original));
    expect(count).toBe(1);
    expect(extractReportSections(JSON.stringify(doc)).s242).toContain("The technical question was whether");
  });

  it("leaves every Section heading alone for work performed and advancement finds", () => {
    const original = report();
    const { doc } = applyReplacements(original, [
      { find: "work performed", replaceWith: "tasks done" },
      { find: "Technological Advancement", replaceWith: "progress" },
    ]);
    expect(headings(doc)).toEqual(headings(original));
    expect(extractReportSections(JSON.stringify(doc)).s244).toContain("Tasks done in trials");
  });

  it("does not let a passage edit target heading text", () => {
    const result = applyPassageEdits(report(), [
      { find: "Scientific/Technological Uncertainty", replaceWith: "Something else" },
    ]);
    expect(result.ok).toBe(false);
  });

  it("reports the matches it left in headings and in the hidden title", () => {
    const original = report();
    const result = applyReplacements(original, [
      { find: "work performed", replaceWith: "tasks done" },
      { find: "Report", replaceWith: "Paper" },
    ]);
    // "Work Performed" in the 244 heading and "Report" in the title stay put.
    expect(result.skippedInHeadings).toBe(1);
    expect(result.skippedInTitle).toBe(1);
    expect(headings(result.doc)).toEqual(headings(original));
    expect(result.count).toBe(1);
  });

  it("applies a replacement that contains its own search text once", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "The loop is stable under load." }] }] };
    const result = applyReplacements(doc, [{ find: "stable", replaceWith: "stable and repeatable" }]);
    expect(result.count).toBe(1);
    expect(nodeTextOf(result.doc)).toBe("The loop is stable and repeatable under load.");
  });

  it("still replaces a passage split across inline marks, once", () => {
    const doc = { type: "doc", content: [{ type: "paragraph", content: [
      { type: "text", text: "The team " },
      { type: "text", text: "tested", marks: [{ type: "bold" }] },
      { type: "text", text: " the alloy." },
    ] }] };
    const result = applyReplacements(doc, [{ find: "team tested the alloy", replaceWith: "team tested the alloy twice" }]);
    expect(result.count).toBe(1);
    expect(nodeTextOf(result.doc)).toBe("The team tested the alloy twice.");
  });
});

const nodeTextOf = (node: PMNode): string =>
  typeof node.text === "string" ? node.text : ((node.content as PMNode[] | undefined) ?? []).map(nodeTextOf).join("");

describe("stored selections", () => {
  it("locates a selection in the body, a Section heading or the title, and notices stale positions", () => {
    const doc = report();
    const content = doc.content as PMNode[];
    // Positions as ProseMirror counts them: each block opens and closes.
    let pos = 0;
    const starts: number[] = [];
    for (const node of content) {
      starts.push(pos);
      pos += 2 + nodeTextOf(node).length;
    }
    const title = { from: starts[0] + 1, to: starts[0] + 7, text: "Report" };
    const heading = { from: starts[1] + 1 + 11, to: starts[1] + 1 + 11 + 36, text: "Scientific/Technological Uncertainty" };
    const bodyText = nodeTextOf(content[2]);
    const at = bodyText.indexOf("technological uncertainty");
    const body = { from: starts[2] + 1 + at, to: starts[2] + 1 + at + 25, text: "technological uncertainty" };
    expect(locateSelection(doc, title)).toBe("title");
    expect(locateSelection(doc, heading)).toBe("section");
    expect(locateSelection(doc, body)).toBe("body");
    expect(locateSelection(doc, { ...body, text: "something else" })).toBeNull();
  });
});
