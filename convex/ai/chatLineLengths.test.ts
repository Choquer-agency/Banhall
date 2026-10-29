import { describe, expect, it } from "vitest";
import { buildTiptapDocument } from "../lib/tiptapReport";
import { reportSectionMetrics } from "../../src/lib/reportSections";
import { lineLengthsAfterEdit, lineLengthsText } from "./chatLineLengths";

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

  // 2026-10-29: an [INFERRED] note is never counted, so the block says so
  // and the meter numbers stay the same with or without it.
  it("says a Line's [INFERRED] notes are not counted and change no number", () => {
    const mark = "[INFERRED: the source asks for stability over time, not single-point checks]";
    const marked = report({
      s242: `${sentence} ${mark}`,
      s244: `${sentence} [GAP: the access-interface load reduction] ${sentence} ${mark} ${mark}`,
      s246: sentence,
    });
    const plain = report({ s242: sentence, s244: `${sentence} [GAP: the access-interface load reduction] ${sentence}`, s246: sentence });
    expect(reportSectionMetrics(marked)).toEqual(reportSectionMetrics(plain));
    const text = lineLengthsText(marked)!;
    expect(text).toContain("No [GAP] notes. Its one [INFERRED] note is not counted either, and deleting one changes no count.");
    expect(text).toContain("Its one [GAP] note is not counted");
    expect(text).toContain("Its 2 [INFERRED] notes are not counted either, and deleting one changes no count.");
    // A Line with no notes of either kind reads as before.
    expect(text.split("\n")[2]).toMatch(/No \[GAP\] notes\.$/);
  });

  it("is left out when the report is not a readable editor document", () => {
    expect(lineLengthsText(null)).toBeNull();
    expect(lineLengthsText("not json")).toBeNull();
  });
});

describe("lineLengthsAfterEdit", () => {
  const sentence = "The company tested a cantilevered support under cyclic tug loading to find its fatigue limit.";
  const before = report({ s242: Array.from({ length: 4 }, () => sentence).join(" "), s244: sentence, s246: sentence });
  const after = report({ s242: Array.from({ length: 3 }, () => sentence).join(" "), s244: sentence, s246: sentence });

  it("states the meter of each Line the edit changes, once applied", () => {
    const b = reportSectionMetrics(before).s242;
    const a = reportSectionMetrics(after).s242;
    expect(lineLengthsAfterEdit(before, after)).toBe(
      `Once applied, Line 242 would have ${a.words} of 350 words (now ${b.words}) and ${a.lines} of 50 form lines (now ${b.lines}), within the CRA limits.`
    );
  });

  it("says nothing when no meter changes", () => {
    expect(lineLengthsAfterEdit(before, before)).toBeNull();
  });

  // 2026-10-29 (third), review round 1 (plumbing P2): a Line over a CRA limit
  // but within its drafting room is trimmed before export; only an edit that
  // takes it over that room asks for a tighter card.
  it("says whether an edit takes a Line over its drafting room, or leaves it within it", () => {
    const words = (count: number) => Array.from({ length: count }, (_, index) => `w${index % 50}`).join(" ");
    const at = (count: number) => report({ s242: sentence, s244: words(count), s246: sentence });
    const within = lineLengthsAfterEdit(at(760), at(761));
    expect(within).toContain("Line 244 would have 761 of 700 words (now 760)");
    expect(within).toContain("over a CRA limit but within its drafting room of 840 words and 120 form lines, so it must still be trimmed to fit before export.");
    expect(within).not.toContain("takes it over");
    expect(lineLengthsAfterEdit(at(830), at(845))).toContain(
      "over a CRA limit, and this edit takes it over its drafting room of 840 words and 120 form lines."
    );
    expect(lineLengthsAfterEdit(at(850), at(860))).toContain("this edit takes it over its drafting room");
    expect(lineLengthsAfterEdit(at(860), at(850))).toContain(
      "over a CRA limit and over its drafting room of 840 words and 120 form lines, no further than now."
    );
  });
});
