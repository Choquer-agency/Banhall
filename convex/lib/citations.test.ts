import { expect, test } from "vitest";
import { citeQuote, findQuoteInSources, validateCitation } from "./citations";
import type { Id } from "../_generated/dataModel";

const source = (id: string, content: string, contentHash: string) => ({
  _id: id as Id<"generationSources">,
  content,
  contentHash,
});

test("findQuoteInSources: first match in source order wins", () => {
  const sources = [
    source("s1", "The team observed control drift under load.", "h1"),
    source("s2", "Control drift under load was also seen elsewhere.", "h2"),
  ];
  const found = findQuoteInSources(sources, "under load");
  expect(found).toEqual({ source: sources[0], startOffset: "The team observed control drift ".length });
});

test("findQuoteInSources: empty quote never matches", () => {
  const sources = [source("s1", "anything", "h1")];
  expect(findQuoteInSources(sources, "")).toBeNull();
});

test("findQuoteInSources: no match returns null", () => {
  const sources = [source("s1", "anything", "h1")];
  expect(findQuoteInSources(sources, "not present")).toBeNull();
});

test("citeQuote: resolves a quote to an exact-offset citation", () => {
  const sources = [source("s1", "Prototype trials began in March.", "hash-abc")];
  const citation = citeQuote(sources, "Prototype trials");
  expect(citation).toEqual({
    sourceId: "s1",
    sourceContentHash: "hash-abc",
    exactExcerpt: "Prototype trials",
    startOffset: 0,
    endOffset: "Prototype trials".length,
  });
});

test("citeQuote: returns null when the quote cannot be found byte-for-byte", () => {
  const sources = [source("s1", "Prototype trials began in March.", "hash-abc")];
  expect(citeQuote(sources, "prototype Trials")).toBeNull();
});

test("validateCitation: accepts an exact byte-match against the frozen source", () => {
  const src = source("s1", "Prototype trials began in March.", "hash-abc");
  const citation = citeQuote([src], "began in March")!;
  expect(validateCitation(src, citation)).toBe(true);
});

test("validateCitation: rejects a stale contentHash (source changed underneath)", () => {
  const src = source("s1", "Prototype trials began in March.", "hash-abc");
  const citation = citeQuote([src], "began in March")!;
  expect(validateCitation({ ...src, contentHash: "different-hash" }, citation)).toBe(false);
});

test("validateCitation: rejects an out-of-range offset", () => {
  const src = source("s1", "Prototype trials began in March.", "hash-abc");
  expect(
    validateCitation(src, {
      sourceContentHash: "hash-abc",
      startOffset: 0,
      endOffset: src.content.length + 10,
      exactExcerpt: src.content,
    })
  ).toBe(false);
});

test("validateCitation: rejects a mismatched excerpt", () => {
  const src = source("s1", "Prototype trials began in March.", "hash-abc");
  expect(
    validateCitation(src, {
      sourceContentHash: "hash-abc",
      startOffset: 0,
      endOffset: 9,
      exactExcerpt: "something else",
    })
  ).toBe(false);
});

test("validateCitation: rejects a missing source", () => {
  expect(
    validateCitation(null, {
      sourceContentHash: "hash-abc",
      startOffset: 0,
      endOffset: 5,
      exactExcerpt: "abcde",
    })
  ).toBe(false);
});
