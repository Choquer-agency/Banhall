import { describe, expect, it } from "vitest";
import { PD_SUBSECTIONS } from "../../../../shared/pdSubsections";
import { stepHeadingTitle } from "./sectionTitles";

describe("stepHeadingTitle", () => {
  it("reads an Outline label with a slash as a title (boards 3.1 and 3.2)", () => {
    expect(stepHeadingTitle("Company / Context")).toBe("Company and context");
    expect(stepHeadingTitle("Experimentation / Iterations")).toBe("Experimentation and iterations");
    expect(stepHeadingTitle("Advancement to science / technology")).toBe("Advancement to science and technology");
  });

  it("leaves titles without a slash as they are, and never adds a slash or dash", () => {
    expect(stepHeadingTitle("Previous-year status")).toBe("Previous-year status");
    expect(stepHeadingTitle("Hypothesis")).toBe("Hypothesis");
    for (const definition of PD_SUBSECTIONS) {
      const heading = stepHeadingTitle(definition.title);
      expect(heading).not.toContain("/");
      expect(heading).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
