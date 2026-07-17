import { describe, expect, test } from "vitest";
import {
  CHARS_PER_LINE,
  GAP_MARKER_RE,
  LINE_LIMITS,
  WORD_CAPS,
  overflowStartOffset,
  sectionMetrics,
  stripGapMarkers,
} from "./lineLimits";

/** A single physical line of exactly `n` form lines (78-char words wrap 1:1). */
function exactLines(n: number): string {
  // 77-char word + space + ... : each 78-char chunk holds exactly one word.
  const word = "x".repeat(CHARS_PER_LINE - 1);
  return Array.from({ length: n }, () => word).join(" ");
}

describe("stripGapMarkers", () => {
  test("removes a marker and collapses the doubled space it leaves", () => {
    expect(stripGapMarkers("alpha [GAP: need dates] beta")).toBe("alpha beta");
  });

  test("tolerates an empty [GAP:] marker", () => {
    expect(stripGapMarkers("alpha [GAP:] beta")).toBe("alpha beta");
  });

  test("is case-insensitive and tolerates missing space after colon", () => {
    expect(stripGapMarkers("a [gap:hours worked] b")).toBe("a b");
  });

  test("preserves newlines while collapsing horizontal whitespace", () => {
    // The single space left before the newline is harmless (wrap math trims);
    // only DOUBLED spaces created by removal are collapsed.
    expect(stripGapMarkers("alpha [GAP: x]\nbeta")).toBe("alpha \nbeta");
    expect(stripGapMarkers("alpha [GAP: x] beta\ny")).toBe("alpha beta\ny");
    expect(stripGapMarkers("alpha\n\n[GAP: x]\n\nbeta")).toBe("alpha\n\n\n\nbeta");
  });

  test("no-gap text is returned unchanged", () => {
    const text = "plain text  with  pre-existing doubles\nand a newline";
    // Doubles collapse only via the second replace; document the behavior:
    expect(stripGapMarkers("plain text\nno gaps")).toBe("plain text\nno gaps");
    expect(stripGapMarkers(text)).toBe(
      "plain text with pre-existing doubles\nand a newline"
    );
  });

  test("multiple gaps in one line", () => {
    expect(stripGapMarkers("a [GAP: one] b [GAP: two] c")).toBe("a b c");
  });

  test("GAP_MARKER_RE is safe to reuse (no lastIndex leakage)", () => {
    const text = "x [GAP: a] y";
    // Consecutive calls must both strip; a stale lastIndex would break this.
    expect(stripGapMarkers(text)).toBe("x y");
    expect(stripGapMarkers(text)).toBe("x y");
  });
});

describe("sectionMetrics", () => {
  test("no-gap text: stripped fields equal raw fields (regression invariant)", () => {
    const text = "First paragraph of ordinary prose.\n\nSecond paragraph here.";
    const m = sectionMetrics(text, "s242");
    expect(m.rawLines).toBe(m.lines);
    expect(m.rawWords).toBe(m.words);
    expect(m.overLimitWithGaps).toBe(m.overLimit);
  });

  test("gap mid-sentence is excluded from words and lines", () => {
    const clean = "The system failed under load and required a redesign.";
    const withGap =
      "The system failed under load [GAP: what load level?] and required a redesign.";
    const mClean = sectionMetrics(clean, "s242");
    const mGap = sectionMetrics(withGap, "s242");
    expect(mGap.words).toBe(mClean.words);
    expect(mGap.lines).toBe(mClean.lines);
    expect(mGap.rawWords).toBeGreaterThan(mGap.words);
  });

  test("paragraph that is only a gap contributes no words", () => {
    const m = sectionMetrics("[GAP: entire paragraph missing]", "s242");
    expect(m.words).toBe(0);
    expect(m.rawWords).toBe(4);
    expect(m.overLimit).toBe(false);
  });

  test("gap pushing raw over the limit -> overLimit false, overLimitWithGaps true", () => {
    // Exactly at the 50-line limit without the gap...
    const atLimit = exactLines(LINE_LIMITS.s242);
    const m0 = sectionMetrics(atLimit, "s242");
    expect(m0.lines).toBe(LINE_LIMITS.s242);
    expect(m0.overLimit).toBe(false);

    // ...then a gap marker pushes the RAW count over.
    const withGap = atLimit + " [GAP: need client confirmation of the final metric]";
    const m1 = sectionMetrics(withGap, "s242");
    expect(m1.lines).toBe(LINE_LIMITS.s242);
    expect(m1.overLimit).toBe(false);
    expect(m1.rawLines).toBeGreaterThan(LINE_LIMITS.s242);
    expect(m1.overLimitWithGaps).toBe(true);
  });

  test("genuinely over the limit -> both flags set", () => {
    const over = exactLines(LINE_LIMITS.s242 + 1);
    const m = sectionMetrics(over, "s242");
    expect(m.overLimit).toBe(true);
    expect(m.overLimitWithGaps).toBe(true);
  });

  test("word cap uses gap-stripped words", () => {
    const words = Array.from({ length: WORD_CAPS.s242 }, (_, i) => `w${i}`).join(" ");
    const m0 = sectionMetrics(words, "s242");
    expect(m0.words).toBe(WORD_CAPS.s242);
    const withGap = words + " [GAP: three more words]";
    const m1 = sectionMetrics(withGap, "s242");
    expect(m1.words).toBe(WORD_CAPS.s242);
    expect(m1.overLimit).toBe(m1.lines > m1.limit); // not over on words
    expect(m1.rawWords).toBe(WORD_CAPS.s242 + 4);
  });

  test("empty text", () => {
    const m = sectionMetrics("", "s242");
    expect(m.lines).toBe(0);
    expect(m.rawLines).toBe(0);
    expect(m.words).toBe(0);
    expect(m.rawWords).toBe(0);
  });
});

describe("overflowStartOffset", () => {
  test("no overflow -> null", () => {
    expect(overflowStartOffset("short text", "s242")).toBeNull();
  });

  test("overflow caused only by gap text -> null", () => {
    const atLimit = exactLines(LINE_LIMITS.s242);
    const withGap =
      atLimit + " [GAP: this trailing marker alone would push the section over]";
    expect(overflowStartOffset(atLimit, "s242")).toBeNull();
    expect(overflowStartOffset(withGap, "s242")).toBeNull();
  });

  test("genuine overflow past gaps -> offset is a valid index onto a non-gap word", () => {
    const gap = "[GAP: what was measured?] ";
    // gap first, then enough real content to overflow s242 (50 lines).
    const text = gap + exactLines(LINE_LIMITS.s242 + 2);
    const offset = overflowStartOffset(text, "s242");
    expect(offset).not.toBeNull();
    expect(offset!).toBeGreaterThanOrEqual(0);
    expect(offset!).toBeLessThan(text.length);
    // Offset must land on real (non-gap) content in the ORIGINAL string.
    expect(text.slice(offset!, offset! + 1)).toBe("x");
    // And it must be past the gap marker entirely.
    expect(offset!).toBeGreaterThanOrEqual(gap.length);
  });

  test("offset matches the no-gap offset shifted by the gap prefix", () => {
    const body = exactLines(LINE_LIMITS.s242 + 2);
    const gap = "[GAP: missing context] ";
    const plain = overflowStartOffset(body, "s242");
    const withGap = overflowStartOffset(gap + body, "s242");
    expect(plain).not.toBeNull();
    expect(withGap).not.toBeNull();
    expect(withGap!).toBe(plain! + gap.length);
  });

  test("gap spanning the 78-char wrap boundary does not consume line budget", () => {
    // One physical line: 70 real chars, then a gap crossing char 78, then more
    // real text. Effective length must ignore every gap char.
    const line = "y".repeat(70) + " [GAP: crosses the wrap boundary here] " + "z".repeat(5);
    const m = sectionMetrics(line, "s242");
    expect(m.lines).toBe(1); // 70 + 1 + 5 = 76 effective chars
    expect(overflowStartOffset(line, "s242")).toBeNull();
  });

  test("multiple gaps on one line are all excluded", () => {
    const line =
      "a".repeat(30) +
      " [GAP: one] " +
      "b".repeat(30) +
      " [GAP: two] " +
      "c".repeat(10);
    // Effective: 30 + 1 + 30 + 1 + 10 = 72 chars -> one line.
    const m = sectionMetrics(line, "s242");
    expect(m.lines).toBe(1);
    expect(overflowStartOffset(line, "s242")).toBeNull();
  });

  test("word-cap overflow ignores gap words", () => {
    const cap = WORD_CAPS.s242;
    const gap = "[GAP: alpha beta gamma] ";
    const body = Array.from({ length: cap + 1 }, (_, i) => `w${i}`).join(" ");
    const text = gap + body;
    const offset = overflowStartOffset(text, "s242");
    expect(offset).not.toBeNull();
    // The (cap+1)-th REAL word starts the overflow: last word "w350".
    const lastWordStart = text.lastIndexOf(`w${cap}`);
    expect(offset).toBe(lastWordStart);
  });

  test("word-cap not triggered when only gap words push past the cap", () => {
    const cap = WORD_CAPS.s242;
    const body = Array.from({ length: cap }, (_, i) => `w${i}`).join(" ");
    const text = body + " [GAP: alpha beta gamma delta]";
    expect(overflowStartOffset(text, "s242")).toBeNull();
  });

  test("blank-line handling unchanged: repeated blank lines consume budget", () => {
    // 49 content lines + 2 blank lines = 51 > 50 -> overflow at a blank line.
    const text = exactLines(LINE_LIMITS.s242 - 1) + "\n\n\nx";
    const offset = overflowStartOffset(text, "s242");
    expect(offset).not.toBeNull();
  });
});

describe("GAP_MARKER_RE", () => {
  test("matches empty and non-empty markers, case-insensitive", () => {
    for (const sample of ["[GAP: text]", "[GAP:]", "[gap: x]", "[Gap:  y ]"]) {
      expect(new RegExp(GAP_MARKER_RE.source, "i").test(sample)).toBe(true);
    }
  });

  test("does not match across paragraphs (no ] until later)", () => {
    const re = new RegExp(GAP_MARKER_RE.source, "i");
    expect(re.test("[GAP: unterminated")).toBe(false);
  });
});
