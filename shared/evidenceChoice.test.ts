import { describe, expect, it } from "vitest";
import {
  chooseEvidence,
  endAtWordBoundary,
  evidenceWords,
  foldForSearch,
  nameSafeRange,
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
