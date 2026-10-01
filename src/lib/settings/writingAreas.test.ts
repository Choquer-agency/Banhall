import { describe, expect, it } from "vitest";
import { STYLE_OVERRIDE_KEYS } from "../../../shared/styleOverrides";
import { WRITING_AREAS, coverageHeading, instructionsExcerpt, writingAreaLabel } from "./writingAreas";

describe("writing areas", () => {
  it("names every waivable category once", () => {
    expect(WRITING_AREAS.map((area) => area.key).sort()).toEqual([...STYLE_OVERRIDE_KEYS].sort());
    expect(writingAreaLabel("bannedWords")).toBe("Word list");
    expect(writingAreaLabel("openingClauses")).toBe("Opening phrases");
  });

  it("words the coverage heading", () => {
    expect(coverageHeading(3)).toBe("Your preferences cover 3 of 6 areas");
    expect(coverageHeading(0)).toBe("Your preferences do not cover any area yet");
  });

  it("cuts the excerpt at a word within 200 characters", () => {
    expect(instructionsExcerpt("  Short   sentences. ")).toBe("Short sentences.");
    const long = "word ".repeat(80);
    const excerpt = instructionsExcerpt(long);
    expect(excerpt.endsWith("...")).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(203);
    expect(excerpt).not.toMatch(/…/);
  });
});
