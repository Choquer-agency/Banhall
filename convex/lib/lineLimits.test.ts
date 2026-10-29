import { describe, expect, test } from "vitest";
import {
  CHARS_PER_LINE,
  GAP_MARKER_RE,
  INFERRED_MARKER_RE,
  LINE_LIMITS,
  NOTE_MARKER_RE,
  WORD_CAPS,
  findReportNotes,
  overflowStartOffset,
  sectionMetrics,
  stripGapMarkers,
  stripInferredMarkers,
  stripNoteMarkers,
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

// 2026-10-29 (owner): a claim that follows from the evidence but is not
// stated in it is written and marked [INFERRED: what it rests on]. The
// marker is a note to the writer: it never counts toward a Line's words or
// form lines, and deleting it changes no count.
describe("INFERRED_MARKER_RE and the note helpers", () => {
  const MARK = "[INFERRED: the source asks for stability over time, not single-point checks]";

  test("matches empty and non-empty markers, case-insensitive, and never a gap", () => {
    for (const sample of ["[INFERRED: text]", "[INFERRED:]", "[inferred: x]", "[Inferred:  y ]"]) {
      expect(new RegExp(INFERRED_MARKER_RE.source, "i").test(sample)).toBe(true);
    }
    expect(new RegExp(INFERRED_MARKER_RE.source, "i").test("[GAP: x]")).toBe(false);
    expect(new RegExp(INFERRED_MARKER_RE.source, "i").test("[INFERRED: unterminated")).toBe(false);
    expect(new RegExp(INFERRED_MARKER_RE.source, "i").test("[INFERRED]")).toBe(false);
    expect(new RegExp(GAP_MARKER_RE.source, "i").test(MARK)).toBe(false);
  });

  test("NOTE_MARKER_RE matches both kinds, and only them", () => {
    const text = `a [GAP: one] b ${MARK} c [CLIENT_1] d [1]`;
    expect([...text.matchAll(NOTE_MARKER_RE)].map((m) => m[0])).toEqual(["[GAP: one]", MARK]);
  });

  test("strip helpers remove their own kind and collapse the doubled space", () => {
    const text = `Readiness was first judged from single readings. ${MARK} Then [GAP: the hold time] passed.`;
    expect(stripInferredMarkers(text)).toBe("Readiness was first judged from single readings. Then [GAP: the hold time] passed.");
    expect(stripGapMarkers(text)).toBe(`Readiness was first judged from single readings. ${MARK} Then passed.`);
    expect(stripNoteMarkers(text)).toBe("Readiness was first judged from single readings. Then passed.");
    // Global regexes: a second call strips as well (no lastIndex leakage).
    expect(stripInferredMarkers(text)).toBe(stripInferredMarkers(text));
    expect(stripInferredMarkers("a [INFERRED: x]\nb")).toBe("a \nb");
  });

  test("findReportNotes lists every marker in text order with its kind and note", () => {
    const text = `One. ${MARK} Two [GAP: the load]. Three. [inferred:] [GAP:  ]`;
    expect(findReportNotes(text)).toEqual([
      { kind: "inferred", text: MARK, note: "the source asks for stability over time, not single-point checks", index: 5 },
      { kind: "gap", text: "[GAP: the load]", note: "the load", index: text.indexOf("[GAP: the load]") },
      { kind: "inferred", text: "[inferred:]", note: "", index: text.indexOf("[inferred:]") },
      { kind: "gap", text: "[GAP:  ]", note: "", index: text.indexOf("[GAP:  ]") },
    ]);
    expect(findReportNotes("No notes here.")).toEqual([]);
  });

  test("marker text never counts toward words or lines, and adds nothing to the with-gaps figure", () => {
    const clean = "Readiness was first judged from single readings. The team then held each sample for an hour.";
    const marked = `Readiness was first judged from single readings. ${MARK} The team then held each sample for an hour.`;
    const mClean = sectionMetrics(clean, "s244");
    const mMarked = sectionMetrics(marked, "s244");
    expect(mMarked.words).toBe(mClean.words);
    expect(mMarked.lines).toBe(mClean.lines);
    // Deleting the marker (accepting the inference) adds nothing: no "+ with gaps".
    expect(mMarked.rawWords).toBe(mMarked.words);
    expect(mMarked.rawLines).toBe(mMarked.lines);
    expect(mMarked.overLimitWithGaps).toBe(mMarked.overLimit);
  });

  test("with gaps and inferences together, only the gap text is in the raw counts", () => {
    const gapOnly = "Readiness was judged from single readings [GAP: the reading interval] before the change.";
    const both = `${gapOnly} ${MARK}`;
    const mGap = sectionMetrics(gapOnly, "s242");
    const mBoth = sectionMetrics(both, "s242");
    expect(mBoth.words).toBe(mGap.words);
    expect(mBoth.rawWords).toBe(mGap.rawWords);
    expect(mBoth.rawWords).toBeGreaterThan(mBoth.words);
  });

  test("an inference marker alone never pushes a Line over its limits", () => {
    const atLimit = exactLines(LINE_LIMITS.s242);
    const text = `${atLimit} ${MARK} ${MARK}`;
    const m = sectionMetrics(text, "s242");
    expect(m.lines).toBe(LINE_LIMITS.s242);
    expect(m.overLimit).toBe(false);
    expect(m.overLimitWithGaps).toBe(false);
    expect(overflowStartOffset(text, "s242")).toBeNull();
  });

  // Review round 2 (P3-2): an opening left unclosed swallows nothing after it.
  test("an unclosed note never swallows the text after it, in its paragraph or the next", () => {
    // The probe: 11 words, which the old match counted as 3.
    const probe = "One two [INFERRED: three four five\n\nsix seven eight nine ten eleven] end";
    expect(sectionMetrics(probe, "s244").words).toBe(sectionMetrics(probe.replace(/[[\]]/g, ""), "s244").words);
    expect(findReportNotes(probe)).toEqual([]);
    // Another opening bracket ends it too, so the later marker is still found whole.
    const nested = "Alpha [INFERRED: beta gamma [GAP: the load] delta.";
    expect(findReportNotes(nested).map((note) => note.text)).toEqual(["[GAP: the load]"]);
    expect(sectionMetrics(nested, "s244").words).toBe(5);
    // A single line break (a hard break) may still sit inside a note.
    expect(findReportNotes("A [INFERRED: one\ntwo] b").map((note) => note.note)).toEqual(["one\ntwo"]);
    expect(findReportNotes("A [GAP: one\n  \ntwo] b")).toEqual([]);
  });

  test("word-cap overflow ignores inference marker words", () => {
    const words = Array.from({ length: WORD_CAPS.s242 }, () => "w").join(" ");
    expect(overflowStartOffset(`${words} ${MARK}`, "s242")).toBeNull();
    const over = `${words} ${MARK} extra`;
    expect(overflowStartOffset(over, "s242")).toBe(over.lastIndexOf("extra"));
  });
});
