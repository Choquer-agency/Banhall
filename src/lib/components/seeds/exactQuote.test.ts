import { describe, expect, it } from "vitest";
import { findExactQuoteSpans, segmentBullet } from "./exactQuote";

describe("findExactQuoteSpans", () => {
  const bullet = "The team found measured output remained stable under load, but not at night.";

  it("underlines the longest word-for-word run shared with an excerpt", () => {
    const spans = findExactQuoteSpans(bullet, ["Honestly, measured output remained stable under load for weeks."]);
    expect(spans).toHaveLength(1);
    expect(bullet.slice(spans[0].start, spans[0].end)).toBe("measured output remained stable under load");
  });

  it("ignores case and punctuation between words", () => {
    const spans = findExactQuoteSpans("They said: Output, remained STABLE today.", ["output remained stable today"]);
    expect(spans).toHaveLength(1);
  });

  it("ignores short shared runs unless they are the whole excerpt", () => {
    expect(findExactQuoteSpans(bullet, ["the team found nothing"])).toHaveLength(0);
    const spans = findExactQuoteSpans(bullet, ["at night"]);
    expect(bullet.slice(spans[0].start, spans[0].end)).toBe("at night");
  });

  it("keeps the longer of two overlapping matches", () => {
    const spans = findExactQuoteSpans(bullet, ["output remained stable under", "found measured output remained stable under load"]);
    expect(spans).toHaveLength(1);
    expect(spans[0].citationIndex).toBe(1);
  });

  it("finds nothing in a paraphrase", () => {
    expect(findExactQuoteSpans("Throughput held steady when busy.", ["measured output remained stable under load"])).toEqual([]);
  });
});

describe("segmentBullet", () => {
  it("splits plain and quoted text in order", () => {
    const text = "a b c d e f";
    expect(segmentBullet(text, [{ start: 2, end: 9, citationIndex: 0 }])).toEqual([
      { text: "a " },
      { text: "b c d e", citationIndex: 0 },
      { text: " f" },
    ]);
  });
});
