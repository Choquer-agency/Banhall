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
    ["Section 242: at most 40 lines and 300 words minimum", { section: "242", maxLines: 40 }],
    ["Section 242: max 40 lines and 300 words or more", { section: "242", maxLines: 40 }],
  ] as const)("%j", (text, expected) => {
    expect(extractSettingsRules(text)).toEqual({
      selfCheckRules: [{ instruction: text, ...expected }],
    });
  });

  it.each(["Build order: 246, 242, 244", "Build order: 246; 242; 244"])("%j", (text) => {
    const extracted = extractSettingsRules(text);
    expect(extracted).toEqual({ buildOrder: ["246", "242", "244"], selfCheckRules: [] });
    expect(resolveBuildOrder(extracted.buildOrder)).toEqual({ buildOrder: ["246", "242", "244"] });
  });

  it("a Build Order line that also states a cap gives both", () => {
    const extracted = extractSettingsRules("Build order: 246, 242, 244; line 246 max 30 lines");
    expect(extracted).toEqual({
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ section: "246", instruction: "line 246 max 30 lines", maxLines: 30 }],
    });
    expect(resolveBuildOrder(extracted.buildOrder)).toEqual({ buildOrder: ["246", "242", "244"] });
  });

  it.each([
    "Section 244: up to 3 experiments, 100 words each",
    "Section 244: each experiment at most 100 words",
    "Line 244: 100 words per paragraph",
    "Section 244 describes work under 40 lines of code",
    "Line 244: not under 200 words",
    "Keep paragraphs under 120 words.",
    "Line 246: 2.5 lines max",
    "Line 244: 1.500 words max",
    "Line 244: 1 500 words max",
    "Line 244: no more than 1.500 words",
    "Section 242: 300 words at least",
    "Section 244: each paragraph, no more than 100 words",
    "Section 244: keep sentences under 25 words",
    "Line 244: at most 100 words in the first paragraph",
    "Section 242: opening under 50 words",
    "Section 246: bullets of no more than 20 words",
    "Section 242: a summary of the work, at most 40 lines",
  ])("%j gives no rule", (text) => {
    expect(extractSettingsRules(text)).toEqual({ selfCheckRules: [] });
  });
});

describe("ambiguous numbers are never caps (rule 5)", () => {
  it("no part of a decimal or a period- or space-grouped run is a cap number", () => {
    for (const text of [
      "Line 246: at most 2.5 lines",
      "Line 246: 12.75 lines or less",
      "Line 244: up to 1.500.000 words",
      "Line 244: at most 1 500 000 words",
      "Line 244: 300 000 words max",
    ]) {
      expect(extractSettingsRules(text).selfCheckRules, text).toEqual([]);
    }
  });

  it("comma grouping stays the one accepted thousands form", () => {
    expect(extractSettingsRules("Line 244: 1,500 words max").selfCheckRules).toEqual([
      { section: "244", instruction: "Line 244: 1,500 words max", maxWords: 1500 },
    ]);
  });

  it("an ambiguous number breaks a chain but does not hide other caps in the segment", () => {
    expect(extractSettingsRules("Line 242: at most 2.5 lines and 300 words").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Line 242: at most 40 lines, at most 1.500 words").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 40 lines, at most 1.500 words", maxLines: 40 },
    ]);
  });

  it("applies to cap numbers only: a section number beside a cap names the section and yields no cap", () => {
    expect(extractSettingsRules("Section 242 300 words max").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Build order: 246 242 244").buildOrder).toEqual(["246", "242", "244"]);
  });
});

describe("trailing lower-bound cues (rule 7)", () => {
  it.each(["minimum", "min", "at least", "or more"])("`%s` after the unit governs a minimum", (cue) => {
    expect(extractSettingsRules(`Line 244: 300 words ${cue}`).selfCheckRules).toEqual([]);
    // Even directly after an upper-bound cue.
    expect(extractSettingsRules(`Line 244: at most 300 words ${cue}`).selfCheckRules).toEqual([]);
  });

  it("a governed number does not continue a chain", () => {
    expect(
      extractSettingsRules("Section 242: at most 40 lines and 300 words minimum, 20 lines").selfCheckRules
    ).toEqual([
      {
        section: "242",
        instruction: "Section 242: at most 40 lines and 300 words minimum, 20 lines",
        maxLines: 40,
      },
    ]);
    expect(
      extractSettingsRules("Section 242: 300 words at least and 40 lines").selfCheckRules
    ).toEqual([]);
  });

  it("does not read a longer word as a cue", () => {
    expect(extractSettingsRules("Line 246: at most 30 lines minutes aside").selfCheckRules).toEqual([
      { section: "246", instruction: "Line 246: at most 30 lines minutes aside", maxLines: 30 },
    ]);
  });
});

describe("extractSettingsRules grammar", () => {
  it("a segment with no section gives no rule", () => {
    expect(extractSettingsRules("At most 40 lines and 300 words.").selfCheckRules).toEqual([]);
  });

  it("a segment naming two sections gives no rule", () => {
    expect(extractSettingsRules("Lines 242 and 246 at most 40 lines.").selfCheckRules).toEqual([]);
  });

  it("a cap number equal to a section number is not read as a second section", () => {
    expect(extractSettingsRules("Line 242: at most 246 words.").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 246 words.", maxWords: 246 },
    ]);
    expect(extractSettingsRules("Line 242: at most 1,246 words.").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242: at most 1,246 words.", maxWords: 1246 },
    ]);
  });

  it("counts a number that directly follows an upper-bound cue", () => {
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
      "limit of",
      "capped at",
      "cap at",
      "under",
      "within",
      "below",
      "≤",
      "<=",
    ]) {
      expect(extractSettingsRules(`Line 246 ${cue} 30 lines`).selfCheckRules, cue).toEqual([
        { section: "246", instruction: `Line 246 ${cue} 30 lines`, maxLines: 30 },
      ]);
    }
  });

  it("allows only an optional `a total of` or `of` between the cue and the number", () => {
    expect(extractSettingsRules("Line 246 up to a total of 30 lines").selfCheckRules).toEqual([
      { section: "246", instruction: "Line 246 up to a total of 30 lines", maxLines: 30 },
    ]);
    expect(extractSettingsRules("Line 246 a maximum of 30 lines").selfCheckRules).toEqual([
      { section: "246", instruction: "Line 246 a maximum of 30 lines", maxLines: 30 },
    ]);
    // A cue that is not adjacent governs nothing.
    expect(extractSettingsRules("Line 246 runs about 80 lines.").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Section 246 max length is 30 lines").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Section 244 stays under budget with 40 lines").selfCheckRules).toEqual([]);
  });

  it("reads a trailing cue directly after the unit", () => {
    for (const cue of ["max", "maximum", "or less", "or fewer", "at most"]) {
      expect(extractSettingsRules(`Line 246: 30 lines ${cue}`).selfCheckRules, cue).toEqual([
        { section: "246", instruction: `Line 246: 30 lines ${cue}`, maxLines: 30 },
      ]);
    }
    expect(extractSettingsRules("Line 246: 30 lines, then stop").selfCheckRules).toEqual([]);
  });

  it("chains `and` or `,` only after a number that counted", () => {
    expect(extractSettingsRules("Line 242 at most 40 lines, 300 words").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242 at most 40 lines, 300 words", maxLines: 40, maxWords: 300 },
    ]);
    // A digit group after a bare comma is a thousands group, never a chain.
    expect(extractSettingsRules("Line 242 at most 40 lines,300 words").selfCheckRules).toEqual([
      { section: "242", instruction: "Line 242 at most 40 lines,300 words", maxLines: 40 },
    ]);
    expect(extractSettingsRules("Line 242: at least 20 lines and 300 words").selfCheckRules).toEqual([]);
  });

  it("a unit followed by `of` is never a cap", () => {
    expect(extractSettingsRules("Line 244: at most 40 lines of code").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Line 244: no more than 300 words of background").selfCheckRules).toEqual([]);
  });

  it("a per-item cue anywhere in the segment gives no cap (rule 4)", () => {
    for (const text of [
      "Line 244: at most 100 words per experiment",
      "Line 244: at most 100 words for every trial",
      "Line 244: two examples at most 50 words apiece",
      // The cue in an earlier or later clause still scopes the whole segment.
      "Line 244: 100 words per trial, at most 600 words",
      "Line 244: at most 600 words, 100 words each",
    ]) {
      expect(extractSettingsRules(text).selfCheckRules, text).toEqual([]);
    }
  });

  it.each([
    "each", "per", "every", "apiece",
    "sentence", "sentences", "paragraph", "paragraphs", "bullet", "bullets", "point", "points",
    "item", "items", "experiment", "experiments", "example", "examples", "heading", "headings",
    "subsection", "sub-section", "subsections", "sub-sections", "table", "tables", "figure", "figures",
    "list", "lists", "step", "steps", "quote", "quotes", "quotation", "quotations", "phrase", "phrases",
    "title", "titles", "caption", "captions", "clause", "clauses",
    "first", "last", "opening", "intro", "introduction", "conclusion", "summary", "overview",
    "start", "end", "beginning",
  ])("`%s` anywhere in the segment scopes it to part of a section: no cap (rule 4)", (word) => {
    expect(extractSettingsRules(`Line 244: at most 300 words, ${word}`).selfCheckRules).toEqual([]);
    expect(extractSettingsRules(`Line 244 ${word}: at most 300 words`).selfCheckRules).toEqual([]);
  });

  it("the scope check reads whole words only: a longer word does not scope the segment", () => {
    for (const text of ["Line 244: at most 300 words, extended", "Line 244: at most 300 words, sectioned"]) {
      expect(extractSettingsRules(text).selfCheckRules, text).toEqual([
        { section: "244", instruction: text, maxWords: 300 },
      ]);
    }
  });

  it("the scope check is per segment: another sentence keeps its whole-section cap", () => {
    expect(
      extractSettingsRules("Line 244: keep sentences under 25 words. Line 244: at most 600 words.").selfCheckRules
    ).toEqual([{ section: "244", instruction: "Line 244: at most 600 words.", maxWords: 600 }]);
  });

  it("ignores numbers a lower-bound or negated cue governs", () => {
    for (const cue of ["at least", "min", "minimum", "no fewer than", "no less than", "more than", "over", "≥", ">="]) {
      expect(extractSettingsRules(`Line 244 ${cue} 200 words`).selfCheckRules, cue).toEqual([]);
    }
    for (const cue of ["not under", "never under", "not below", "not within", "not less than", "never below"]) {
      expect(extractSettingsRules(`Line 244 ${cue} 200 words`).selfCheckRules, cue).toEqual([]);
    }
    // A lower bound directly before the number wins over a trailing cue.
    expect(extractSettingsRules("Line 244 at least 200 words max").selfCheckRules).toEqual([]);
    expect(extractSettingsRules("Line 244 up to at least 200 words").selfCheckRules).toEqual([]);
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
});

describe("Build Order run", () => {
  it("is read per line, before any other split, and caps come from the other lines", () => {
    expect(
      extractSettingsRules("Build order: 246; 242; 244\nLine 246: no more than 80 lines.")
    ).toEqual({
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ section: "246", instruction: "Line 246: no more than 80 lines.", maxLines: 80 }],
    });
  });

  it("accepts every separator and section prefix", () => {
    for (const text of [
      "Drafting order: 246 → 242 → 244",
      "Generation order 246 -> 242 -> 244",
      "Order of drafting: 246 > 242 > 244",
      "Build order: 246/242/244",
      "Build order is 246, then 242 and 244",
      "Build order: Line 246, Section 242, s244",
      "Build order: 246 242 244",
    ]) {
      expect(extractSettingsRules(text).buildOrder, text).toEqual(["246", "242", "244"]);
    }
  });

  it("stops at the first other token and is bounded at three sections", () => {
    expect(extractSettingsRules("Build order: 246, 242 then the rest; Line 244 at most 90 lines")).toEqual({
      buildOrder: ["246", "242"],
      selfCheckRules: [{ section: "244", instruction: "Line 244 at most 90 lines", maxLines: 90 }],
    });
    expect(extractSettingsRules("Build order: 246, 242, 244, 246").buildOrder).toEqual(["246", "242", "244"]);
    // The text before the cue still goes on to cap extraction.
    expect(extractSettingsRules("Line 242 max 30 lines; build order: 246, 242, 244")).toEqual({
      buildOrder: ["246", "242", "244"],
      selfCheckRules: [{ section: "242", instruction: "Line 242 max 30 lines", maxLines: 30 }],
    });
  });

  it("a one-section run is kept and falls back in resolveBuildOrder with its reason", () => {
    // Golden (Design Notes rule 1): never dropped without a note.
    const single = extractSettingsRules("Build order: 246 first.");
    expect(single).toEqual({ buildOrder: ["246"], selfCheckRules: [] });
    expect(resolveBuildOrder(single.buildOrder)).toEqual({
      buildOrder: ["242", "244", "246"],
      fallbackReason: expect.stringMatching(/^Build Order is missing section 242, 244; /),
    });
  });

  it("needs a section directly after the cue; a partial or repeated run falls back in resolveBuildOrder", () => {
    expect(extractSettingsRules("Build order follows the client: 246, 242, 244").buildOrder).toBeUndefined();
    expect(extractSettingsRules("Build order: to be decided.").buildOrder).toBeUndefined();
    const partial = extractSettingsRules("Drafting order: 246 then 242");
    expect(partial.buildOrder).toEqual(["246", "242"]);
    expect(resolveBuildOrder(partial.buildOrder).fallbackReason).toMatch(/missing section 244/);
    const repeated = extractSettingsRules("Order of generation: 246, 246, 242");
    expect(resolveBuildOrder(repeated.buildOrder).fallbackReason).toMatch(/repeats section 246/);
  });

  it("only the first Build Order line counts", () => {
    expect(extractSettingsRules("Build order: 246, 242, 244\nBuild order: 242, 244, 246").buildOrder).toEqual([
      "246",
      "242",
      "244",
    ]);
  });
});
