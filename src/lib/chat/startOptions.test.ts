import { describe, expect, it } from "vitest";
import { buildTiptapDocument } from "../../../convex/lib/tiptapReport";
import { startOptions } from "./startOptions";

const words = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
const report = (s242: string, s244: string, s246: string) => JSON.stringify(buildTiptapDocument("Report", s242, s244, s246));

describe("startOptions", () => {
  it("offers one Shorten option per Line over its word limit, in Line order", () => {
    expect(startOptions(report(words(385), words(20), words(400)))).toEqual([
      "Shorten Line 242 to 350 words",
      "Shorten Line 246 to 350 words",
    ]);
  });

  it("offers nothing when every Line fits", () => {
    expect(startOptions(report(words(30), words(30), words(30)))).toEqual([]);
    expect(startOptions(null)).toEqual([]);
  });
});
