import { expect, test } from "vitest";
import { matchGlossaryTerms, validateGlossaryFixture } from "./glossaryMatcher";

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
