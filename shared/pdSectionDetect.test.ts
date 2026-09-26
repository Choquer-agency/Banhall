import { describe, expect, it } from "vitest";
import {
  detectPdSections,
  detectedSectionText,
  pageForOffset,
  pageRangeLabel,
  sectionsFoundLabel,
} from "./pdSectionDetect";

const numbers = (text: string, offsets?: number[]) =>
  detectPdSections(text, offsets).map((section) => section.number);

describe("detectPdSections", () => {
  it("finds Word-style headings with their CRA titles and splits the text between them", () => {
    const text = [
      "Project 1: Adaptive heat recovery",
      "",
      "Line 242 Technological uncertainty",
      "The team did not know whether the valve could hold 2 bar.",
      "",
      "Line 244 Work performed",
      "We built three prototypes and tested 242 samples.",
      "",
      "Line 246 Technological advancement",
      "The controller now holds temperature within 0.5 C.",
    ].join("\n");
    const sections = detectPdSections(text);
    expect(sections.map((s) => [s.number, s.title])).toEqual([
      ["242", "Technological uncertainty"],
      ["244", "Work performed"],
      ["246", "Technological advancement"],
    ]);
    expect(detectedSectionText(text, sections[0])).toBe(
      "The team did not know whether the valve could hold 2 bar."
    );
    // "242 samples" inside Line 244's prose is not a heading.
    expect(detectedSectionText(text, sections[1])).toBe(
      "We built three prototypes and tested 242 samples."
    );
    expect(detectedSectionText(text, sections[2])).toBe(
      "The controller now holds temperature within 0.5 C."
    );
  });

  it("finds the CRA questions in a PDF page run with no line breaks", () => {
    const text =
      "Schedule 60 Part 2 Project information " +
      "242 What scientific or technological uncertainties did you attempt to overcome? The furnace ran hot. " +
      "244 What work did you perform in the tax year to overcome the technological uncertainties? We logged heat. " +
      "246 What scientific or technological advancements did you achieve? A stable loop.";
    const sections = detectPdSections(text);
    expect(sections.map((s) => s.number)).toEqual(["242", "244", "246"]);
    expect(detectedSectionText(text, sections[0])).toBe("The furnace ran hot.");
    expect(detectedSectionText(text, sections[2])).toBe("A stable loop.");
  });

  it("reads headings inside table cells", () => {
    const text = [
      "| 242 | Technological uncertainty |",
      "| Whether the sensor survives 900 C. |",
      "| 244 | Work performed |",
      "| Built a test rig. |",
      "| 246 | Technological advancements |",
      "| A new sensor housing. |",
    ].join("\n");
    expect(numbers(text)).toEqual(["242", "244", "246"]);
  });

  it("accepts Section and colon forms and bare numbers on their own line", () => {
    expect(numbers("Section 242:\nText\nSection 244:\nMore\nSection 246:\nEnd")).toEqual([
      "242",
      "244",
      "246",
    ]);
    expect(numbers("242.\nUncertain.\n244.\nWork.\n246.\nAdvance.")).toEqual(["242", "244", "246"]);
  });

  it("reports only the Sections present", () => {
    const text = "Line 242 Technological uncertainty\nOnly this.\nLine 246 Technological advancement\nAnd this.";
    expect(numbers(text)).toEqual(["242", "246"]);
    expect(numbers("A plain memo about 242 samples and 246 tests.")).toEqual([]);
  });

  it("does not take a number repeated in prose over the real heading", () => {
    const text = [
      "Line 242 Technological uncertainty",
      "As Line 244 explains, we ran 244 trials.",
      "Line 244 Work performed",
      "Trials.",
      "Line 246 Technological advancement",
      "Result.",
    ].join("\n");
    const sections = detectPdSections(text);
    expect(detectedSectionText(text, sections[0])).toBe("As Line 244 explains, we ran 244 trials.");
    expect(detectedSectionText(text, sections[1])).toBe("Trials.");
  });

  it("keeps form order, so an early mention of a later Line is not taken first", () => {
    const text = "Line 246 is reviewed last.\nLine 242 Technological uncertainty\nA.\nLine 244 Work performed\nB.\nLine 246 Technological advancement\nC.";
    const sections = detectPdSections(text);
    expect(sections.map((s) => s.number)).toEqual(["242", "244", "246"]);
    expect(detectedSectionText(text, sections[2])).toBe("C.");
  });

  it("maps headings to pages with the parser's page offsets", () => {
    const pages = [
      "Cover page for the claim. ",
      "Line 242 Technological uncertainty We did not know. ",
      "More uncertainty. ",
      "Line 244 Work performed Built it. ",
      "Tested it. ",
      "Line 246 Technological advancement It works.",
    ];
    const offsets: number[] = [];
    let text = "";
    for (const page of pages) {
      offsets.push(text.length);
      text += page;
    }
    const sections = detectPdSections(text, offsets);
    expect(sections.map((s) => [s.number, s.pageStart, s.pageEnd])).toEqual([
      ["242", 2, 3],
      ["244", 4, 5],
      ["246", 6, 6],
    ]);
  });
});

describe("helpers", () => {
  it("finds the page that holds an offset", () => {
    expect(pageForOffset(0, [0, 10, 20])).toBe(1);
    expect(pageForOffset(10, [0, 10, 20])).toBe(2);
    expect(pageForOffset(99, [0, 10, 20])).toBe(3);
  });

  it("labels page ranges and counts", () => {
    expect(pageRangeLabel(2, 2)).toBe("Page 2");
    expect(pageRangeLabel(4, 9)).toBe("Pages 4 to 9");
    expect(sectionsFoundLabel(3)).toBe("3 sections found");
    expect(sectionsFoundLabel(1)).toBe("1 section found");
    expect(sectionsFoundLabel(0)).toBeNull();
  });
});
