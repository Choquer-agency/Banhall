import { expect, test } from "vitest";
import {
  flaggedGlossaryTerms,
  matchGlossaryTerms,
  matchGlossaryTermsAcrossSources,
  validateGlossaryFixture,
} from "./glossaryMatcher";
import type { Id } from "../_generated/dataModel";

test("glossaryMatcher: exact word matching (case-insensitive)", () => {
  const terms = [
    { term: "machine learning", inflections: [] },
    { term: "neural network", inflections: [] },
  ];

  const text = "We implemented a machine learning model. The neural network performed well.";
  const matches = matchGlossaryTerms(terms, text);

  expect(matches.length).toBe(2);
  expect(matches[0].canonicalTerm).toBe("machine learning");
  expect(matches[1].canonicalTerm).toBe("neural network");
});

test("glossaryMatcher: inflected form matching", () => {
  const terms = [
    { term: "algorithm", inflections: ["algorithms", "algorithmic"] },
  ];

  const text = "The algorithm was developed. Multiple algorithms were tested. Algorithmic improvements were made.";
  const matches = matchGlossaryTerms(terms, text);

  // Should match all three forms
  expect(matches.length).toBeGreaterThanOrEqual(1);
  expect(matches.some((m) => m.text.toLowerCase() === "algorithm")).toBe(true);
});

test("glossaryMatcher: byte offsets are accurate", () => {
  const terms = [
    { term: "database", inflections: [] },
  ];

  const text = "The database is large. Another database exists.";
  const matches = matchGlossaryTerms(terms, text);

  expect(matches.length).toBe(2);
  for (const match of matches) {
    // Verify the excerpt matches the offset range
    const excerpt = text.slice(match.startOffset, match.endOffset);
    expect(excerpt.toLowerCase()).toBe(match.text.toLowerCase());
  }
});

test("glossaryMatcher: no duplicate matches", () => {
  const terms = [
    { term: "data", inflections: ["data"] }, // inflection is same as term
  ];

  const text = "The data is important.";
  const matches = matchGlossaryTerms(terms, text);

  // Should not duplicate even if inflection overlaps with base term
  expect(matches.length).toBe(1);
});

test("glossaryMatcher: fixture validation", () => {
  const terms = [
    { term: "technical uncertainty", inflections: [] },
    { term: "systematic investigation", inflections: [] },
    { term: "technological advancement", inflections: [] },
  ];

  // Fixture text with all expected terms
  const fixtureText = `
    The project addresses technical uncertainty in the field.
    A systematic investigation was conducted.
    The results show technological advancement.
  `;

  const result = validateGlossaryFixture(terms, fixtureText, 3);

  expect(result.coverage).toBeGreaterThanOrEqual(0.95);
  expect(result.matched).toBe(3);
  expect(result.total).toBe(3);
});

test("glossaryMatcher: ruleBasedMatch flag", () => {
  const terms = [
    { term: "algorithm", inflections: [] },
  ];

  const text = "The algorithm is fast.";
  const matches = matchGlossaryTerms(terms, text);

  expect(matches.length).toBe(1);
  // All matches from the rule-based matcher should be marked as ruleBasedMatch=true
  expect(matches[0].ruleBasedMatch).toBe(true);
});

test("matchGlossaryTermsAcrossSources: offsets stay relative to each source, not a concatenated blob", () => {
  const terms = [{ term: "control loop", inflections: [] }];
  const sources = [
    { _id: "src1" as Id<"generationSources">, content: "Prelude text.", contentHash: "h1" },
    { _id: "src2" as Id<"generationSources">, content: "We tuned the control loop carefully.", contentHash: "h2" },
  ];
  const matches = matchGlossaryTermsAcrossSources(terms, sources);
  expect(matches).toHaveLength(1);
  expect(matches[0].sourceId).toBe("src2");
  expect(matches[0].sourceContentHash).toBe("h2");
  expect(
    sources[1].content.slice(matches[0].startOffset, matches[0].endOffset)
  ).toBe("control loop");
});

test("flaggedGlossaryTerms: a term the rules find zero occurrences of is flagged", () => {
  const terms = [
    { term: "control loop", inflections: [] },
    { term: "closed-loop controller", inflections: [] },
  ];
  const sources = [
    { _id: "src1" as Id<"generationSources">, content: "We tuned the control loop carefully.", contentHash: "h1" },
  ];
  const flagged = flaggedGlossaryTerms(terms, sources);
  // "control loop" is found verbatim — not flagged. "closed-loop
  // controller" never appears anywhere — flagged for model classification.
  expect(flagged).toEqual([{ term: "closed-loop controller", inflections: [] }]);
});

test("flaggedGlossaryTerms: nothing is flagged once every term has a rule-based match", () => {
  const terms = [{ term: "algorithm", inflections: ["algorithms"] }];
  const sources = [
    { _id: "src1" as Id<"generationSources">, content: "Multiple algorithms were tested.", contentHash: "h1" },
  ];
  expect(flaggedGlossaryTerms(terms, sources)).toEqual([]);
});

test("matchGlossaryTermsAcrossSources: at most one entry per canonical term, first occurrence wins", () => {
  const terms = [{ term: "algorithm", inflections: ["algorithms"] }];
  const sources = [
    { _id: "src1" as Id<"generationSources">, content: "The algorithm was fast.", contentHash: "h1" },
    { _id: "src2" as Id<"generationSources">, content: "Multiple algorithms were tested.", contentHash: "h2" },
  ];
  const matches = matchGlossaryTermsAcrossSources(terms, sources);
  expect(matches).toHaveLength(1);
  expect(matches[0].sourceId).toBe("src1");
});
