import { describe, expect, it } from "vitest";
import { buildTiptapDocument } from "../lib/tiptapReport";
import { reportSectionMetrics } from "../../src/lib/reportSections";
import { lineLengthsText } from "./chatLineLengths";

// Owner, 2026-10-21: the Assistant answers questions about a Line's meter
// from the numbers on the writer's screen, measured the editor's own way.
function report(sections: { s242: string; s244: string; s246: string }): string {
  return JSON.stringify(buildTiptapDocument("Test project", sections.s242, sections.s244, sections.s246));
}

describe("lineLengthsText", () => {
  const sentence = "The company tested a cantilevered support under cyclic tug loading to find its fatigue limit.";
  const content = report({
    s242: Array.from({ length: 3 }, () => sentence).join(" "),
    s244: `${sentence} [GAP: the measured displacement at the ramp hinge, in millimetres, from the sea trials] ${sentence}\n\n${sentence} [GAP: the access-interface load reduction] ${sentence}`,
    s246: Array.from({ length: 50 }, () => sentence).join(" "),
  });

  it("states each Line's lines and words exactly as the editor's meters", () => {
    const text = lineLengthsText(content)!;
    const metrics = reportSectionMetrics(content);
    expect(text).toContain(`Line 242: ${metrics.s242.lines} of 50 form lines and ${metrics.s242.words} of 350 words, within the CRA limits. No [GAP] notes.`);
    const extra = metrics.s244.rawLines - metrics.s244.lines;
    expect(extra).toBeGreaterThan(0);
    expect(text).toContain(`Line 244: ${metrics.s244.lines} of 100 form lines`);
    expect(text).toContain("Its 2 [GAP] notes are not counted");
    expect(text).toContain(`The meter shows this as "(+${extra} with gaps)".`);
  });

  it("names how far a Line is over a CRA limit", () => {
    const metrics = reportSectionMetrics(content);
    expect(metrics.s246.words).toBeGreaterThan(350);
    expect(lineLengthsText(content)).toContain(`${metrics.s246.words - 350} words over the CRA limit`);
  });

  it("is left out when the report is not a readable editor document", () => {
    expect(lineLengthsText(null)).toBeNull();
    expect(lineLengthsText("not json")).toBeNull();
  });
});
