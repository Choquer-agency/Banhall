import { describe, expect, it } from "vitest";
import { applyReplacements, type PMNode } from "./reportEdits";
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
    expect(result.skippedInHeadings).toBe(2);
    expect(headings(result.doc)).toEqual(headings(original));
    expect(result.count).toBe(1);
  });
});
