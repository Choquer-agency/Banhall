import { describe, expect, it } from "vitest";
import { buildTiptapDocument } from "../../../convex/lib/tiptapReport";
import { CHECK_SOURCES_OPTION, startOptions } from "./startOptions";

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
const report = (s242: string, s244: string, s246: string) => JSON.stringify(buildTiptapDocument("Report", s242, s244, s246));
// Every Line fits and none is under half its word limit (350, 700, 350).
const settled = report(words(200), words(400), words(200));

describe("startOptions", () => {
  it("offers one Shorten option per Line over its word limit, in Line order", () => {
    expect(startOptions(report(words(385), words(400), words(400)))).toEqual([
      "Shorten Line 242 to 350 words",
      "Shorten Line 246 to 350 words",
    ]);
  });

  it("offers Add detail for a Line under half its word limit, and Draft for an empty one", () => {
    expect(startOptions(report(words(200), words(249), words(174)))).toEqual([
      "Add detail to Line 244 from the source files",
      "Add detail to Line 246 from the source files",
    ]);
    expect(startOptions(report(words(200), "", words(175)))).toEqual(["Draft Line 244 from the source files"]);
  });

  it("puts Shorten first, then the QA issues, then thin Lines, and keeps three", () => {
    const qa = [
      { line: "244" as const, text: "No baseline is stated for the first experiment." },
      { line: "242" as const, text: "The uncertainty restates the goal." },
    ];
    expect(startOptions(report(words(385), words(400), words(100)), qa)).toEqual([
      "Shorten Line 242 to 350 words",
      "Fix the QA issue in Line 244: No baseline is stated for the first experiment.",
      "Fix the QA issue in Line 242: The uncertainty restates the goal.",
    ]);
  });

  it("offers the source check when nothing else applies, and nothing without a report", () => {
    expect(startOptions(settled)).toEqual([CHECK_SOURCES_OPTION]);
    expect(startOptions(null)).toEqual([]);
  });
});
