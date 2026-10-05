import { describe, expect, it } from "vitest";
import {
  capWithinLocked,
  effectiveLineLimits,
  lineDraftWordTarget,
  ruleBearsOnLine,
  wordsForLines,
  writerCapText,
  writerLineCap,
} from "./writerLineCap";
import { draftWordTarget } from "./lineLimits";
import { runDeterministicSelfCheck } from "./selfCheckRules";
import type { OrderedProfileContext, SectionNumber, SelfCheckRule } from "./orderedChain";

// 2026-10-04 (first): the word caps of the release suite fixture
// writer-settings-document (fictional Velloway powder-on-MDF project).
const VELLOWAY_RULES: SelfCheckRule[] = [
  { section: "242", instruction: "- Line 242: no more than 260 words.", maxWords: 260 },
  { section: "244", instruction: "- Line 244: no more than 520 words.", maxWords: 520 },
  { section: "246", instruction: "- Line 246: no more than 260 words.", maxWords: 260 },
];

function profileWith(rules: SelfCheckRule[]): OrderedProfileContext {
  return {
    profileState: "applied",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: rules,
  };
}

/** `count` words of plain text in one paragraph. */
function wordsText(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

describe("the writer's whole-Line cap (2026-10-04, first)", () => {
  it("reads each Line's cap from the rule for that Line", () => {
    expect(writerLineCap("242", VELLOWAY_RULES)).toEqual({ words: 260 });
    expect(writerLineCap("244", VELLOWAY_RULES)).toEqual({ words: 520 });
    expect(writerLineCap("246", VELLOWAY_RULES)).toEqual({ words: 260 });
  });

  it("applies a rule with no section to every Line, and one for another Line to none", () => {
    const everyLine: SelfCheckRule[] = [{ instruction: "Keep every Line under 300 words.", maxWords: 300 }];
    expect(writerLineCap("242", everyLine)).toEqual({ words: 300 });
    expect(writerLineCap("246", everyLine)).toEqual({ words: 300 });
    // 300 is under Line 244's 700-word Locked cap too.
    expect(writerLineCap("244", everyLine)).toEqual({ words: 300 });
    expect(writerLineCap("244", [VELLOWAY_RULES[0]!])).toBeNull();
    expect(ruleBearsOnLine({}, "244")).toBe(true);
    expect(ruleBearsOnLine({ section: "242" }, "244")).toBe(false);
  });

  it("never treats a paragraph-scoped rule as a whole-Line cap", () => {
    const paragraph: SelfCheckRule[] = [
      { section: "242", paragraphIndex: 0, instruction: "Paragraph 1: at most 40 words.", maxWords: 40 },
    ];
    expect(writerLineCap("242", paragraph)).toBeNull();
  });

  it("clips a cap to the Locked cap, and a cap at or above it changes nothing", () => {
    expect(capWithinLocked(400, 350)).toBe(350);
    expect(capWithinLocked(260, 350)).toBe(260);
    expect(writerLineCap("242", [{ section: "242", instruction: "At most 350 words.", maxWords: 350 }])).toBeNull();
    expect(writerLineCap("242", [{ section: "242", instruction: "At most 400 words.", maxWords: 400 }])).toBeNull();
    expect(writerLineCap("244", [{ section: "244", instruction: "At most 100 lines.", maxLines: 100 }])).toBeNull();
    expect(writerLineCap("244", [{ section: "244", instruction: "At most 120 lines.", maxLines: 120 }])).toBeNull();
  });

  it("takes the tightest of several caps, words and lines on their own", () => {
    const rules: SelfCheckRule[] = [
      { instruction: "Each Line: at most 300 words.", maxWords: 300 },
      { section: "246", instruction: "Line 246: at most 240 words and 40 lines.", maxWords: 240, maxLines: 40 },
      { section: "246", instruction: "Line 246: at most 45 lines.", maxLines: 45 },
    ];
    expect(writerLineCap("246", rules)).toEqual({ words: 240, lines: 40 });
    expect(writerLineCap("242", rules)).toEqual({ words: 300 });
    expect(writerCapText({ words: 240, lines: 40 })).toBe("240 words and 40 form lines");
    expect(writerCapText({ lines: 40 })).toBe("40 form lines");
  });

  it("the Self-check measures and clips the very same rules", () => {
    // A cap above the Locked cap is clipped in both places, so neither
    // drafting nor the Self-check holds the Line to more than 350 words.
    const clipped = runDeterministicSelfCheck({
      section: "242",
      text: wordsText(300),
      brief: null,
      profile: profileWith([{ section: "242", instruction: "At most 400 words.", maxWords: 400 }]),
      isFirstInOrder: false,
    }).entries.find((entry) => entry.key === "rule:0");
    expect(clipped?.row).toMatchObject({ outcome: "applied", tier: "conflict" });
    expect(clipped?.measuredCap).toMatchObject({ kind: "writer", wholeLine: true, limits: "350 words", over: [] });

    // At the writer's cap the row is met; one word over, it is not.
    for (const [section, cap] of [["242", 260], ["244", 520], ["246", 260]] as Array<[SectionNumber, number]>) {
      const rowAt = (words: number) =>
        runDeterministicSelfCheck({
          section,
          text: wordsText(words),
          brief: null,
          profile: profileWith(VELLOWAY_RULES),
          isFirstInOrder: false,
        }).entries.find((entry) => entry.measuredCap?.kind === "writer");
      expect(writerLineCap(section, VELLOWAY_RULES)).toEqual({ words: cap });
      expect(rowAt(cap)?.row.outcome).toBe("applied");
      expect(rowAt(cap + 1)?.row.outcome).toBe("not_applied");
      expect(rowAt(cap + 1)?.measuredCap).toMatchObject({ wholeLine: true, limits: `${cap} words`, over: [`${cap + 1}/${cap} words`] });
    }
  });
});

describe("the draft target under the writer's cap (2026-10-04, first)", () => {
  it("is the Locked draft target without a writer's cap", () => {
    for (const key of ["s242", "s244", "s246"] as const) {
      for (const target of ["concise", "standard", "full"] as const) {
        expect(lineDraftWordTarget(key, target, null)).toBe(draftWordTarget(key, target));
      }
    }
    expect(lineDraftWordTarget("s242", "standard", null)).toBe(297);
    expect(lineDraftWordTarget("s244", "standard", null)).toBe(595);
  });

  it("asks for 85 percent of the writer's word cap, the release suite fixture's 221, 442 and 221", () => {
    expect(lineDraftWordTarget("s242", "standard", writerLineCap("242", VELLOWAY_RULES))).toBe(221);
    expect(lineDraftWordTarget("s244", "standard", writerLineCap("244", VELLOWAY_RULES))).toBe(442);
    expect(lineDraftWordTarget("s246", "standard", writerLineCap("246", VELLOWAY_RULES))).toBe(221);
    // A concise budget already under that share stays as it is.
    expect(lineDraftWordTarget("s242", "concise", { words: 340 })).toBe(draftWordTarget("s242", "concise"));
  });

  it("reads a line cap as the words that fit it, with the same share", () => {
    expect(wordsForLines(40)).toBe(306);
    expect(lineDraftWordTarget("s242", "standard", { lines: 40 })).toBe(260);
    expect(lineDraftWordTarget("s242", "standard", { words: 280, lines: 40 })).toBe(238);
  });

  it("the limits a Line must meet are the writer's where set, else the Locked ones", () => {
    expect(effectiveLineLimits("s242", null)).toEqual({ wordCap: 350, lineLimit: 50 });
    expect(effectiveLineLimits("s242", { words: 260 })).toEqual({ wordCap: 260, lineLimit: 50 });
    expect(effectiveLineLimits("s244", { lines: 80 })).toEqual({ wordCap: 700, lineLimit: 80 });
  });
});
