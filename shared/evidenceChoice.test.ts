import { describe, expect, it } from "vitest";
import {
  chooseEvidence,
  endAtWordBoundary,
  evidenceWords,
  foldForSearch,
  maskOutside,
  nameSafeRange,
  partRange,
  scoreParts,
  startAtWordBoundary,
  subjectOf,
  utf16Size,
  utf8Size,
} from "./evidenceChoice";

/** Plain filler sentences, different per seed, sharing only common lab words. */
function filler(seed: number, chars: number): string {
  const parts = ["seal", "valve", "pump", "gasket", "bracket", "housing", "coil", "shaft"];
  const outcomes = ["held", "leaked", "drifted", "stabilized"];
  let text = "";
  let n = seed;
  while (text.length < chars) {
    n = (n * 1103515245 + 12345) % 2147483648;
    text += `The ${parts[n % parts.length]} ${outcomes[(n >> 3) % outcomes.length]} after ${n % 900} cycles on the bench. `;
    if (n % 7 === 0) text += "\n\n";
  }
  return text.slice(0, chars);
}

/** True when an edge at `at` of `text` falls between two word characters. */
function insideWord(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false;
  return /[\p{L}\p{N}]/u.test(text[at - 1]!) && /[\p{L}\p{N}]/u.test(text[at]!);
}

describe("words and folding", () => {
  it("folds accents and case, and keeps words of 3 or more that are not stop words", () => {
    expect(foldForSearch("Étalonnage CONTRÔLE")).toBe("etalonnage controle");
    expect(evidenceWords(foldForSearch("The cold-soak test of the O-ring and the pump, at -40 C."))).toEqual([
      "cold-soak",
      "test",
      "o-ring",
      "pump",
    ]);
  });

  it("weighs a subject word more the more it is said, up to 3", () => {
    const subject = subjectOf(["cryogenic seal", "cryogenic seal again", "cryogenic"]);
    expect(subject.get("cryogenic")).toBeCloseTo(1 + Math.log(3));
    expect(subject.get("seal")).toBeCloseTo(1 + Math.log(2));
    expect(subject.has("again")).toBe(false);
  });
});

describe("name-safe edges", () => {
  it("an end cut still backs off before a whole word (moved here unchanged)", () => {
    expect(endAtWordBoundary("Met Quillm", "ere today")).toBe("Met ");
    expect(endAtWordBoundary("Met Whitfield-", "Smith")).toBe("Met ");
    expect(endAtWordBoundary("Met ", "Quillmere")).toBe("Met ");
  });

  it("a start cut skips the rest of the word it falls in, hyphens and apostrophes included", () => {
    expect(startAtWordBoundary("Met Quill", "mere today")).toBe("mere".length);
    expect(startAtWordBoundary("Met Whitfield", "-Smith said")).toBe("-Smith".length);
    expect(startAtWordBoundary("Met O", "'Neil now")).toBe("'Neil".length);
    expect(startAtWordBoundary("Met ", "Quillmere")).toBe(0);
    // A run over 64 letters is no word of a name: cut where asked.
    expect(startAtWordBoundary("x".repeat(40), "y".repeat(40))).toBe(0);
  });

  it("narrows a range so neither edge splits a word or a surrogate pair", () => {
    const text = "Dana Quillmere ran trial 12 on the 😀 rig with Whitfield-Smith.";
    const inside = nameSafeRange(text, text.indexOf("illmere"), text.indexOf("Smith") + 2);
    expect(text.slice(inside.start, inside.end)).toBe(" ran trial 12 on the 😀 rig with ");
    const emoji = text.indexOf("😀");
    const split = nameSafeRange(text, emoji + 1, text.length);
    expect(split.start).toBe(emoji + 2);
    const word = nameSafeRange(text, text.indexOf("uill"), text.indexOf("uill") + 3);
    expect(word.end).toBe(word.start);
  });
});

describe("scoring", () => {
  it("ranks a part holding a rare subject word above parts holding only common ones", () => {
    const parts = [
      "The seal held after 40 cycles on the bench.",
      "The seal leaked after 12 cycles. The seal was replaced.",
      "A cryogenic soak at minus 60 cracked the seal housing.",
      "Nothing about the subject here at all.",
    ];
    const scores = scoreParts(parts, subjectOf(["cryogenic seal failure"]));
    expect(scores[2]).toBeGreaterThan(scores[0]!);
    expect(scores[2]).toBeGreaterThan(scores[1]!);
    expect(scores[3]).toBe(0);
  });

  it("does not let a long part win by repeating a word", () => {
    const repeated = "seal ".repeat(200);
    const scores = scoreParts([repeated, "a cryogenic seal"], subjectOf(["cryogenic seal"]));
    expect(scores[1]).toBeGreaterThan(scores[0]!);
  });
});

describe("chooseEvidence", () => {
  it("sends every row whole when they all fit, so a small project is unchanged", () => {
    const rows = [{ text: filler(1, 3_000) }, { text: filler(2, 2_000), whole: true }];
    const chosen = chooseEvidence({ rows, subject: subjectOf(["seal"]), budget: 10_000, size: utf16Size });
    expect(chosen).toEqual([
      { ranges: [{ start: 0, end: 3_000 }], whole: true },
      { ranges: [{ start: 0, end: 2_000 }], whole: true },
    ]);
  });

  it("finds a fact only one late file holds (file 25 of 30), where the old order never reached it", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ text: filler(index + 1, 20_000) }));
    const fact = " The cryogenic soak at minus 60 cracked the Viton membrane on trial 418. ";
    rows[24] = { text: filler(99, 9_000) + fact + filler(98, 10_000) };
    const subject = subjectOf(["Why did the Viton membrane crack in the cryogenic soak?"]);
    const chosen = chooseEvidence({ rows, subject, budget: 12_000, size: utf16Size, excerptCost: 20 });
    const sent = chosen.flatMap((row, index) => row.ranges.map((range) => rows[index]!.text.slice(range.start, range.end)));
    expect(sent.join("")).toContain("Viton membrane on trial 418");
    // The old order would have sent the start of the first file only.
    expect(chosen[24]!.ranges.length).toBeGreaterThan(0);
  });

  it("puts the rows that must go in whole first, and never passes the budget, in either unit", () => {
    const rows = [
      { text: filler(3, 30_000) },
      { text: "Settings: write 'cold soak', never 'cold-soak'. Ünïcödé ✓ 😀", whole: true },
      { text: filler(4, 30_000) + " Ü".repeat(500) },
    ];
    for (const size of [utf16Size, utf8Size]) {
      const budget = 7_000;
      const chosen = chooseEvidence({ rows, subject: subjectOf(["bracket coil"]), budget, size, excerptCost: 15 });
      expect(chosen[1]).toEqual({ ranges: [{ start: 0, end: rows[1]!.text.length }], whole: true });
      const spent = chosen.reduce(
        (sum, row, index) =>
          sum + row.ranges.reduce((s, range) => s + size(rows[index]!.text.slice(range.start, range.end)) + (row.whole ? 0 : 15), 0),
        0
      );
      expect(spent).toBeLessThanOrEqual(budget);
    }
  });

  it("cuts a whole row too big for the budget at a name-safe end", () => {
    const text = "Notes for Dana Quillmere and the team. ".repeat(100);
    const chosen = chooseEvidence({ rows: [{ text, whole: true }, { text: filler(5, 5_000) }], subject: subjectOf([]), budget: 1_000, size: utf16Size });
    const range = chosen[0]!.ranges[0]!;
    expect(range.start).toBe(0);
    expect(range.end).toBeLessThanOrEqual(1_000);
    expect(insideWord(text, range.end)).toBe(false);
  });

  it("with no subject, fills in row order, as before", () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({ text: filler(index + 10, 8_000) }));
    const chosen = chooseEvidence({ rows, subject: subjectOf([]), budget: 9_000, size: utf16Size });
    expect(chosen[0]!.ranges.length).toBeGreaterThan(0);
    expect(chosen[0]!.ranges[0]!.start).toBe(0);
    expect(chosen.slice(2).every((row) => row.ranges.length === 0)).toBe(true);
  });

  it("gives the same choice for the same input, with edges never inside a word and touching parts joined", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({ text: filler(index + 20, 15_000) }));
    const input = { rows, subject: subjectOf(["gasket stabilized 417 cycles"]), budget: 20_000, size: utf8Size, excerptCost: 10 };
    const first = chooseEvidence(input);
    expect(chooseEvidence(input)).toEqual(first);
    first.forEach((row, index) => {
      const text = rows[index]!.text;
      for (let i = 0; i < row.ranges.length; i++) {
        const range = row.ranges[i]!;
        expect(insideWord(text, range.start)).toBe(false);
        expect(insideWord(text, range.end)).toBe(false);
        if (i > 0) expect(range.start).toBeGreaterThan(row.ranges[i - 1]!.end);
      }
    });
  });
});

describe("review fixes (2026-10-28)", () => {
  it("chooses within 3 MiB of unbroken script well inside a mutation's time (it took seconds before)", () => {
    // Long runs of letters with no space, the slow case of an unanchored match.
    const run = (n: number) => "\u0E01\u0E02\u0E03\u0E04".repeat(Math.ceil(n / 4)).slice(0, n);
    const rows = Array.from({ length: 16 }, (_, index) => ({
      text: Array.from({ length: 1_000 }, (_, i) => run(40 + ((index + i) % 160))).join(". ").slice(0, 200_000),
    }));
    const started = performance.now();
    chooseEvidence({ rows, subject: subjectOf(["\u0E01\u0E02\u0E03 seal"]), budget: 48_000, size: utf8Size, excerptCost: 60 });
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it("moves a part's edges to a sentence end within reach, so a name wrapped over two lines stays whole", () => {
    const text = `${"The seal held. ".repeat(20)}Dana visited Northern\nRobotics Inc. on Monday. ${"The pump drifted. ".repeat(20)}`;
    const wrap = text.indexOf("\nRobotics");
    const range = partRange(text, 0, wrap);
    const sent = text.slice(range.start, range.end);
    expect(sent).not.toContain("Northern");
    expect(sent.endsWith("The seal held. ")).toBe(true);
    // The other side never starts with the name's second half alone.
    const later = partRange(text, wrap + 1, text.length);
    expect(text.slice(later.start, later.end).startsWith("Robotics")).toBe(false);
  });

  it("marks a must-have row cut to fit as its start, and charges each row its own excerpt cost", () => {
    const notes = "Write cold soak, never cold-soak. ".repeat(200);
    const chosen = chooseEvidence({
      rows: [{ text: notes, whole: true }, { text: "seal ".repeat(4_000), excerptCost: 500 }],
      subject: subjectOf(["seal"]),
      budget: 2_000,
      size: utf16Size,
    });
    expect(chosen[0]).toMatchObject({ whole: false, cut: true });
    const spent = chosen[0]!.ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    for (const range of chosen[1]!.ranges) expect(range.end - range.start + 500).toBeLessThanOrEqual(2_000 - spent);
  });

  it("sends an empty row as it is, even over the budget", () => {
    const chosen = chooseEvidence({ rows: [{ text: "" }, { text: "seal held. ".repeat(500) }], subject: subjectOf([]), budget: 100, size: utf16Size });
    expect(chosen[0]).toEqual({ ranges: [], whole: true });
  });
});

describe("review round 2 fixes (2026-10-28)", () => {
  const sentences = (count: number, from = 1) =>
    Array.from({ length: count }, (_, index) => `Sentence number ${from + index} says the seal held out. `).join("");

  it("joins neighbouring chosen parts before moving edges, so no sentence between them is lost", () => {
    const text = sentences(400);
    const chosen = chooseEvidence({ rows: [{ text }, { text: filler(7, 40_000) }], subject: subjectOf(["sentence number seal"]), budget: 30_000, size: utf16Size, excerptCost: 10 });
    const ranges = chosen[0]!.ranges;
    expect(ranges.length).toBeGreaterThan(0);
    // One run, or several far apart: never two runs only a sentence apart.
    for (let i = 1; i < ranges.length; i++) expect(ranges[i]!.start - ranges[i - 1]!.end).toBeGreaterThan(200);
  });

  it("keeps a part's first sentence when the part already starts at a sentence", () => {
    const text = `${sentences(10)}${sentences(10, 11)}`;
    const at = text.indexOf("Sentence number 11");
    const range = partRange(text, at, at + 400);
    expect(range.start).toBe(at);
  });

  it("does not take an abbreviation or an initial for a sentence end", () => {
    const text = `${"The seal held at the plant. ".repeat(3)}Work with St. Laurent Robotics continued for J. Smith and Acme Inc. Montreal. ${"The pump drifted. ".repeat(10)}`;
    const mid = text.indexOf("Laurent") + 2;
    const sent = text.slice(...Object.values(partRange(text, mid, text.length)) as [number, number]);
    expect(sent.startsWith("Laurent")).toBe(false);
    expect(sent.startsWith("Smith")).toBe(false);
    expect(sent.startsWith("Montreal")).toBe(false);
  });

  it("treats a Windows line ending like any other", () => {
    const text = `${"The seal held.\r\n".repeat(30)}\r\nNorthern\r\nRobotics Inc. joined.\r\n${"The pump drifted.\r\n".repeat(30)}`;
    const wrap = text.indexOf("\r\nRobotics");
    const range = partRange(text, 0, wrap);
    expect(text.slice(range.start, range.end)).not.toContain("Northern");
  });
});

describe("Brief review fixes (2026-10-28)", () => {
  it("keeps the first sentence of a part that starts after a paragraph ending in a period", () => {
    for (const gap of ["\n\n", ". \n\n", "\r\n\r\n", "\n\n\n", "\r\n\r\n\r\n", "\n  \n  \n"]) {
      // With and without a period before the blank lines (a heading has none).
      const text = `${"The seal held at the plant. ".repeat(20)}Overview${gap.startsWith(".") ? "" : gap.length > 2 ? "" : "."}${gap}Zorbatron calibration failed first. ${"The pump drifted. ".repeat(20)}`;
      const at = text.indexOf("Zorbatron");
      const range = partRange(text, at, at + 500);
      expect(range.start).toBe(at);
    }
  });

  it("blanks everything outside the ranges and keeps every position", () => {
    expect(maskOutside("abcdefgh", [{ start: 2, end: 4 }])).toBe("\u0000\u0000cd\u0000\u0000\u0000\u0000");
    expect(maskOutside("abcdefgh", [{ start: 5, end: 7 }, { start: 0, end: 2 }])).toBe("ab\u0000\u0000\u0000fg\u0000");
    expect(maskOutside("abcdefgh", [{ start: 1, end: 5 }, { start: 3, end: 6 }])).toBe("\u0000bcdef\u0000\u0000");
    expect(maskOutside("abcdefgh", [])).toBe("\u0000".repeat(8));
    expect(maskOutside("abcdefgh", [{ start: 0, end: 8 }])).toBe("abcdefgh");
  });
});

describe("a row's opening cost (Seeds review, 2026-10-28)", () => {
  it("charges a row's frame with its first part only, and nothing for a row that sends nothing", () => {
    const rows = [
      { text: "seal ".repeat(400), openCost: 300 },
      { text: "pump ".repeat(400), openCost: 300 },
    ];
    // Each row is one 2,000-character part: room for one part and one frame (2,305), not two (4,610).
    const chosen = chooseEvidence({ rows, subject: subjectOf(["seal"]), budget: 4_000, size: utf16Size, excerptCost: 5 });
    const spent = (index: number) => chosen[index]!.ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    expect(spent(0)).toBeGreaterThan(0);
    expect(spent(0)).toBeLessThanOrEqual(4_000 - 300 - 5);
    expect(spent(1)).toBe(0);
  });
});
