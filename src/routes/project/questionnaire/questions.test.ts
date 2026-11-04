import { describe, expect, it } from "vitest";
import { QUESTIONS } from "./questions";

/**
 * 2026-10-29 (third), review round 1 (P3-8): the client questionnaire asks
 * for the usual approach and why it did not work, and for what the client
 * expected and why. It no longer suggests a "no documented methods" claim
 * or a measurable outcome the client may not have.
 */
const question = (id: string) => {
  const found = QUESTIONS.find((entry) => entry.id === id);
  if (!found) throw new Error(`No question ${id}`);
  return found;
};

describe("the client questionnaire", () => {
  it("asks for the usual approach and why it did not work", () => {
    const technical = question("technical_problem");
    expect(technical.question).toBe(
      "What is the technical problem behind it? What is the usual way to solve a problem like this, and why did it not work for you?"
    );
    expect(technical.placeholder).toContain("That did not work for us because");
    expect(technical.placeholder).not.toMatch(/no documented methods/i);
  });

  it("asks what the client expected and why, not for a measurable outcome", () => {
    const hypothesis = question("hypothesis");
    expect(hypothesis.question).toBe(
      "What did you expect to happen, and why? For example: if we tried this approach, we expected this result, because..."
    );
    expect(hypothesis.question).not.toMatch(/measurable/i);
    expect(hypothesis.placeholder).not.toMatch(/\d/);
  });

  it("uses no typographic dash anywhere", () => {
    for (const entry of QUESTIONS) {
      expect(`${entry.label} ${entry.question} ${entry.placeholder}`).not.toMatch(/[\u2010-\u2015\u2212]/);
    }
  });
});
