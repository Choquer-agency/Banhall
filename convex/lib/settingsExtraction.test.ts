import { describe, expect, it } from "vitest";
import { extractSettingsRules } from "./settingsExtraction";
import { resolveBuildOrder } from "./orderedChain";

describe("extractSettingsRules golden examples (Design Notes)", () => {
  it.each([
    ["Line 246: no more than 80 lines.", { section: "246", maxLines: 80 }],
    ["Section 244 should be at most 600 words", { section: "244", maxWords: 600 }],
    ["242 — max 40 lines and 300 words", { section: "242", maxLines: 40, maxWords: 300 }],
    ["Section 242: at least 200 words, at most 300 words", { section: "242", maxWords: 300 }],
    ["Line 244: no more than 1,500 words", { section: "244", maxWords: 1500 }],
    ["Line 244: 650 words maximum.", { section: "244", maxWords: 650 }],
  ] as const)("%j", (text, expected) => {
    expect(extractSettingsRules(text)).toEqual({
      selfCheckRules: [{ instruction: text, ...expected }],
    });
  });

  it.each([
    "Section 244: up to 3 experiments, 100 words each",
    "Keep paragraphs under 120 words.",
  ])("%j gives no rule", (text) => {
    expect(extractSettingsRules(text)).toEqual({ selfCheckRules: [] });
  });

  it.each(["Build order: 246, 242, 244", "Build order: 246; 242; 244"])("%j", (text) => {
    const extracted = extractSettingsRules(text);
    expect(extracted).toEqual({ buildOrder: ["246", "242", "244"], selfCheckRules: [] });
    expect(resolveBuildOrder(extracted.buildOrder)).toEqual({ buildOrder: ["246", "242", "244"] });
  });
});

describe("extractSettingsRules grammar", () => {
  it("a segment with no section gives no rule", () => {
    expect(extractSettingsRules("At most 40 lines and 300 words.").selfCheckRules).toEqual([]);
  });

  it("a segment naming two sections gives no rule", () => {
    expect(extractSettingsRules("Lines 242 and 246 at most 40 lines each.").selfCheckRules).toEqual([]);
  });

  it("a cap number equal to a section number is not read as a second section", () => {
    expect(extractSettingsRules("Line 242: at most 246 words.").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 246 words.", maxWords: 246 },
    ]);
    expect(extractSettingsRules("Line 242: at most 1,246 words.").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 1,246 words.", maxWords: 1246 },
    ]);
  });

  it("needs an upper-bound cue governing the number", () => {
    expect(extractSettingsRules("Line 246 runs about 80 lines.").selfCheckRules).toEqual([]);
    for (const cue of [
      "max",
      "maximum",
      "at most",
      "no more than",
      "up to",
      "not to exceed",
      "not exceed",
      "limited to",
      "limit to",
      "capped at",
      "cap at",
      "under",
      "within",
      "≤",
      "<=",
    ]) {
      expect(extractSettingsRules(`Line 246 ${cue} 30 lines`).selfCheckRules, cue).toEqual([
        { section: "246", instruction: `Line 246 ${cue} 30 lines`, maxLines: 30 },
      ]);
    }
  });

  it("reads a trailing cue right after the unit", () => {
    for (const cue of ["max", "maximum", "or less", "or fewer", "at most"]) {
      expect(extractSettingsRules(`Line 246: 30 lines ${cue}`).selfCheckRules, cue).toEqual([
        { section: "246", instruction: `Line 246: 30 lines ${cue}`, maxLines: 30 },
      ]);
    }
    expect(extractSettingsRules("Line 246: 30 lines, then stop").selfCheckRules).toEqual([]);
  });

  it("ignores the numbers a lower-bound cue governs", () => {
    for (const cue of ["at least", "min", "minimum", "no fewer than", "no less than", "more than", "over", "≥", ">="]) {
      expect(extractSettingsRules(`Line 244 ${cue} 200 words`).selfCheckRules, cue).toEqual([]);
    }
    // A lower-bound cue between the upper cue and the number wins.
    expect(extractSettingsRules("Line 244 up to at least 200 words").selfCheckRules).toEqual([]);
    // An upper cue after the lower bound governs the later number.
    expect(extractSettingsRules("Section 244 at least 200 and at most 650 words").selfCheckRules).toEqual([
      { section: "244", instruction: "Section 244 at least 200 and at most 650 words", maxWords: 650 },
    ]);
  });

  it("the first maximum per unit wins", () => {
    expect(extractSettingsRules("Line 242 max 30 lines, max 20 lines").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242 max 30 lines, max 20 lines", maxLines: 30 },
    ]);
  });

  it("ignores 0 and values over 9999", () => {
    expect(extractSettingsRules("Line 242 at most 0 lines").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Line 242 at most 10,000 words").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Line 242 at most 9,999 words").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242 at most 9,999 words", maxWords: 9999 },
    ]);
  });

  it("splits on newlines, semicolons and sentence ends", () => {
    const { selfCheckRules } = extractSettingsRules(
      "Use active voice. Line 242: max 30 lines; s244 at most 500 words\n§246 no more than 200 words. Done."
    );
    expect(selfCheckRules.map((rule) => [rule.section, rule.maxLines ?? null, rule.maxWords ?? null])).toEqual([
      ["242", 30, null],
      ["244", null, 500],
      ["246", null, 200],
    ]);
  });

  it("trims the instruction to 500 characters", () => {
    const segment = `Line 246 no more than 40 lines ${"x".repeat(600)}`;
    const [rule] = extractSettingsRules(segment).selfCheckRules;
    expect(rule.instruction).toHaveLength(500);
  });

  it("keeps the first 20 rules", () => {
    const text = Array.from({ length: 25 }, (_, index) => `Line 242 at most ${index + 1} lines.`).join("\n");
    const { selfCheckRules } = extractSettingsRules(text);
    expect(selfCheckRules).toHaveLength(20);
    expect(selfCheckRules[0].maxLines).toBe(1);
    expect(selfCheckRules[19].maxLines).toBe(20);
  });

  it("reads the Build Order per line before any other split, and caps from the other lines", () => {
    expect(
      extractSettingsRules("Build order: 246; 242; 244\nLine 246: no more than 80 lines.")
    ).toEqual({
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ section: "246", instruction: "Line 246: no more than 80 lines.", maxLines: 80 }],
    });
  });

  it("a Build Order needs at least two sections; a partial or repeated one falls back in resolveBuildOrder", () => {
    expect(extractSettingsRules("Build order: 246 first.").buildOrder).toBeUndefined();
    const partial = extractSettingsRules("Drafting order: 246 then 242");
    expect(partial.buildOrder).toEqual(["246", "242"]);
    expect(resolveBuildOrder(partial.buildOrder).fallbackReason).toMatch(/missing section 244/);
    const repeated = extractSettingsRules("Order of generation: 246, 246, 242");
    expect(resolveBuildOrder(repeated.buildOrder).fallbackReason).toMatch(/repeats section 246/);
  });
});
