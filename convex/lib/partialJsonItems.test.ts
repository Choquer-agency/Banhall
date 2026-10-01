import { describe, expect, it } from "vitest";
import { PartialJsonItems, type PartialItem } from "./partialJsonItems";

const BRIEF = {
  storyline: 'The team asked "can the seal hold?" and {braces} [brackets] stayed in prose.',
  storylineClaims: [
    { text: "The seal failed at minus 30.", quote: "it cracked at \"minus 30\"" },
    { text: "Three rigs were built.", quote: "we built three rigs" },
  ],
  claimExclusions: [{ text: "Marketing spend", quote: "the brochure", reason: "business_risk" }],
  confidenceMap: [
    { text: "Leak rate fell.", quote: "the leak rate fell by half", confidence: "established" },
    { text: "Cause of cracking.", quote: "we never found why \\ it cracked", confidence: "unresolved" },
  ],
  glossaryTerms: [{ term: "FrostLine" }, { term: "leak rate", quote: "leakage" }],
};
const TEXT = JSON.stringify(BRIEF);

const summary = (items: PartialItem[]) => items.map((item) => [item.array, item.index, item.value]);

const EXPECTED = [
  ["storylineClaims", 0, BRIEF.storylineClaims[0]],
  ["storylineClaims", 1, BRIEF.storylineClaims[1]],
  ["confidenceMap", 0, BRIEF.confidenceMap[0]],
  ["confidenceMap", 1, BRIEF.confidenceMap[1]],
  ["glossaryTerms", 0, BRIEF.glossaryTerms[0]],
  ["glossaryTerms", 1, BRIEF.glossaryTerms[1]],
];

describe("PartialJsonItems", () => {
  it("finds every completed item in the watched arrays, and none in claimExclusions", () => {
    expect(summary(new PartialJsonItems().push(TEXT))).toEqual(EXPECTED);
  });

  it("returns the same items whatever the split point, each exactly once, only once complete", () => {
    for (let split = 0; split <= TEXT.length; split += 1) {
      const scanner = new PartialJsonItems();
      const first = scanner.push(TEXT.slice(0, split));
      for (const item of first) {
        // Nothing is emitted before its closing brace has arrived.
        const raw = JSON.stringify(item.value);
        expect(TEXT.slice(0, split).includes(raw), `split ${split}`).toBe(true);
      }
      const rest = scanner.push(TEXT);
      expect(summary([...first, ...rest]), `split ${split}`).toEqual(EXPECTED);
    }
  });

  it("reads a stream delivered one character at a time", () => {
    const scanner = new PartialJsonItems();
    const items: PartialItem[] = [];
    for (let end = 1; end <= TEXT.length; end += 1) items.push(...scanner.push(TEXT.slice(0, end)));
    expect(summary(items)).toEqual(EXPECTED);
  });

  it("starts over when the text gets shorter (a retried request)", () => {
    const scanner = new PartialJsonItems();
    expect(scanner.push(TEXT)).toHaveLength(6);
    const retry = JSON.stringify({ storyline: "x", storylineClaims: [{ text: "Again", quote: "again" }] });
    expect(summary(scanner.push(""))).toEqual([]);
    expect(summary(scanner.push(retry))).toEqual([["storylineClaims", 0, { text: "Again", quote: "again" }]]);
  });

  it("copes with whitespace between tokens and ignores nested watched names", () => {
    const text = `{\n  "storyline" : "s",\n  "claimExclusions": [ { "confidenceMap": [ {"x": 1} ] } ],\n  "confidenceMap" : [\n    { "text": "a", "quote": "b", "confidence": "partial" }\n  ]\n}`;
    expect(summary(new PartialJsonItems().push(text))).toEqual([
      ["confidenceMap", 0, { text: "a", quote: "b", confidence: "partial" }],
    ]);
  });
});
