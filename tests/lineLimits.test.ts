import { describe, expect, test } from "bun:test";
import {
  overflowStartOffset,
  sectionMetrics,
  toParagraphs,
  type SectionKey,
} from "../convex/lib/lineLimits";

const limits: Array<{
  section: SectionKey;
  lineLimit: number;
  wordCap: number;
}> = [
  { section: "s242", lineLimit: 50, wordCap: 350 },
  { section: "s244", lineLimit: 100, wordCap: 700 },
  { section: "s246", lineLimit: 50, wordCap: 350 },
];

function oneWordPerLine(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    String.fromCharCode(97 + (index % 26)).repeat(78)
  ).join(" ");
}

function words(count: number): string {
  return Array.from({ length: count }, () => "x").join(" ");
}

describe("Schedule 60 sectionMetrics", () => {
  test.each(limits)(
    "$section accepts its exact line cap and rejects the next wrapped line",
    ({ section, lineLimit, wordCap }) => {
      const atLimit = sectionMetrics(oneWordPerLine(lineLimit), section);
      const overLimit = sectionMetrics(oneWordPerLine(lineLimit + 1), section);

      expect(atLimit).toEqual({
        lines: lineLimit,
        words: lineLimit,
        paragraphs: 1,
        limit: lineLimit,
        wordCap,
        overLimit: false,
      });
      expect(overLimit.lines).toBe(lineLimit + 1);
      expect(overLimit.overLimit).toBe(true);
    }
  );

  test.each(limits)(
    "$section accepts its exact CRA word ceiling and rejects one additional word",
    ({ section, lineLimit, wordCap }) => {
      const atCap = sectionMetrics(words(wordCap), section);
      const overCap = sectionMetrics(words(wordCap + 1), section);

      expect(atCap.words).toBe(wordCap);
      expect(atCap.lines).toBeLessThan(lineLimit);
      expect(atCap.overLimit).toBe(false);
      expect(overCap.words).toBe(wordCap + 1);
      expect(overCap.lines).toBeLessThan(lineLimit);
      expect(overCap.overLimit).toBe(true);
    }
  );

  test("wraps greedily at exactly 78 characters and charges a line for each paragraph break", () => {
    const exactlyOneLine = `${"a".repeat(39)} ${"b".repeat(38)}`;
    const wrapped = `${exactlyOneLine} c`;
    const threeParagraphLines = `${exactlyOneLine}\n\n${exactlyOneLine}`;

    expect(sectionMetrics(exactlyOneLine, "s242").lines).toBe(1);
    expect(sectionMetrics(wrapped, "s242").lines).toBe(2);
    expect(sectionMetrics(threeParagraphLines, "s242")).toMatchObject({
      lines: 3,
      words: 4,
      paragraphs: 2,
    });
  });

  test("counts every hard break, including repeated blank lines and CRLF", () => {
    expect(sectionMetrics("first line\nsecond line", "s242")).toMatchObject({
      lines: 2,
      words: 4,
      paragraphs: 1,
    });
    expect(sectionMetrics("first\n\n\nfourth", "s242")).toMatchObject({
      lines: 4,
      words: 2,
      paragraphs: 2,
    });
    expect(sectionMetrics("first\r\n\r\nsecond", "s242")).toMatchObject({
      lines: 3,
      words: 2,
      paragraphs: 2,
    });
  });

  test("wraps long unbroken text across every 78-character physical line", () => {
    expect(sectionMetrics("x".repeat(78), "s242").lines).toBe(1);
    expect(sectionMetrics("x".repeat(79), "s242").lines).toBe(2);
    expect(sectionMetrics("x".repeat(156), "s242").lines).toBe(2);
    expect(sectionMetrics(`${"x".repeat(79)} y`, "s242").lines).toBe(2);
  });

  test("reports over-limit when hard breaks alone cross a section boundary", () => {
    const atLimit = Array.from({ length: 50 }, () => "x").join("\n");
    const overLimit = `${atLimit}\n`;

    expect(sectionMetrics(atLimit, "s242")).toMatchObject({
      lines: 50,
      overLimit: false,
    });
    expect(sectionMetrics(overLimit, "s242")).toMatchObject({
      lines: 51,
      overLimit: true,
    });
  });

  test("normalizes internal whitespace while preserving blank-line paragraph boundaries", () => {
    expect(toParagraphs("  first\tphrase \n still first\n \n\tsecond   phrase  ")).toEqual([
      "first phrase still first",
      "second phrase",
    ]);
  });

  test("locates the first word beyond the section word cap", () => {
    const atCap = words(350);
    const overflow = `${atCap} overflow starts here`;
    const offset = overflowStartOffset(overflow, "s242");

    expect(overflowStartOffset(atCap, "s242")).toBeNull();
    expect(offset).not.toBeNull();
    expect(overflow.slice(offset ?? 0)).toBe("overflow starts here");
  });

  test("locates content beginning on the first physical line beyond the cap", () => {
    const atCap = Array.from({ length: 50 }, () => "x").join("\n");
    const overflow = `${atCap}\nfirst excess line`;
    const offset = overflowStartOffset(overflow, "s242");

    expect(overflowStartOffset(atCap, "s242")).toBeNull();
    expect(offset).not.toBeNull();
    expect(overflow.slice(offset ?? 0)).toBe("first excess line");
  });

  test.each(limits)(
    "$section overflow marker agrees with section metrics",
    ({ section, lineLimit, wordCap }) => {
      const samples = [
        words(wordCap),
        words(wordCap + 1),
        oneWordPerLine(lineLimit),
        oneWordPerLine(lineLimit + 1),
        `${"x".repeat(78 * lineLimit)} overflow`,
      ];

      for (const sample of samples) {
        const offset = overflowStartOffset(sample, section);
        expect(offset !== null).toBe(sectionMetrics(sample, section).overLimit);
        if (offset !== null && offset > 0 && /\w/.test(sample[offset] ?? "")) {
          expect(/\s/.test(sample[offset - 1] ?? "")).toBe(true);
        }
      }
    }
  );

  test("locates width overflow inside one unbroken token", () => {
    const atLimit = "x".repeat(78 * 50);
    const overflow = `${atLimit}x`;
    const offset = overflowStartOffset(overflow, "s242");

    expect(sectionMetrics(atLimit, "s242").overLimit).toBe(false);
    expect(sectionMetrics(overflow, "s242").overLimit).toBe(true);
    expect(offset).toBe(atLimit.length);
    expect(overflow.slice(offset ?? 0)).toBe("x");
  });
});
