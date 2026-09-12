import { describe, expect, test } from "vitest";
// Plain-JS harness module: JSDoc-typed, so it checks like any other import.
import {
  asksWriterForArtifact,
  mentionsNumericScore,
  namesParagraph,
} from "../scripts/chat-behavior-checks.mjs";

// Story 5 (CAP-14, CAP-15). The live chat-behaviour harness is opt-in and
// billable, so its grading predicates are the only enforcement of the converge
// guard and the no-score rule, and they are the part most likely to rot into
// something that passes everything. These cases pin them.

const guarded: string[] = [
  "Send me your settings document and I can align the draft.",
  // Verbs and short forms the first version of this predicate missed.
  "I need your settings doc to proceed.",
  "Please send over your storyline.",
  "Let me have your glossary and I will follow it.",
  "This requires a claim exclusions list from you.",
  "I will need your style guide before the next pass.",
  "Aligning the terminology requires your glossary.",
  "Could you provide the confidence map from your side?",
  "If you could share the storyline you used, I will follow it.",
  "Please provide a glossary of the terms you want.",
  "It would help to put together a confidence map for these facts.",
  "Write up an exclusion list and I will respect it.",
  "I need a style guide from you before I can proceed.",
  "Upload a template for the section and I will match it.",
  "A claim exclusions list would let me avoid those statements.",
];

const allowed: string[] = [
  "Two facts are missing: how many cycles each trial ran, and the salinity the supplier datasheet contradicts. Ask the client for both.",
  "I can propose three changes now: paragraph 2 still says pressure range, paragraph 4 repeats the objective, and paragraph 6 states an unresolved fact flatly.",
  "The Brief already carries the storyline and the glossary, so nothing is needed from you.",
  "The confidence map marks the cycle count unresolved, which is why paragraph 3 hedges.",
  "Tell me the commissioning date and I will state it in paragraph 5.",
  // A negated verb is not an ask.
  "I do not need your glossary; the Brief already carries it.",
  "Nothing is required from you: the storyline is already derived.",
];

describe("asksWriterForArtifact (CAP-14 converge guard)", () => {
  for (const text of guarded) {
    test(`flags: ${text.slice(0, 48)}`, () => {
      expect(asksWriterForArtifact(text)).toBe(true);
    });
  }

  for (const text of allowed) {
    test(`allows: ${text.slice(0, 48)}`, () => {
      expect(asksWriterForArtifact(text)).toBe(false);
    });
  }

  test("a request split across sentences is not matched across the boundary", () => {
    expect(
      asksWriterForArtifact(
        "I will draft the section now. The glossary is already in the Brief."
      )
    ).toBe(false);
  });
});

describe("mentionsNumericScore (CAP-15)", () => {
  const scores = [
    "The draft is a 72% match to last year's PD.",
    "Similarity score: 8 out of a possible range.",
    "Overlap rating of 4.",
    "I would rate the alignment 7/10.",
    "They agree about 85 percent of the time.",
  ];
  for (const text of scores) {
    test(`flags: ${text}`, () => {
      expect(mentionsNumericScore(text)).toBe(true);
    });
  }

  const prose = [
    "Paragraph 2 names the objective; the Reference PD names it in paragraph 1.",
    "Line 244 has 7 paragraphs against the Reference PD's 6.",
    "The Reference PD uses operating envelope where paragraph 3 says range.",
    // A COUNT is not a score. Counting what changed is the behaviour CAP-15
    // asks for, so flagging these would punish the right answer.
    "5/10 paragraphs were rewritten to use the operating envelope.",
    "100% of the Locked caps hold in the proposed revision.",
    "5 of 10 paragraphs name the objective the Reference PD names.",
    "3/10 of the terms differ from the Reference PD's glossary.",
    "All 16 items are accounted for; 14 of 16 are resolved.",
  ];
  for (const text of prose) {
    test(`allows: ${text}`, () => {
      expect(mentionsNumericScore(text)).toBe(false);
    });
  }
});

describe("the predicates' own limits", () => {
  // Stated in the module comment and in the OQ7 record: a fixed artifact list
  // cannot grade the prompt's open-ended "any other new artifact" rule. This
  // case pins the gap so nobody reads a green harness run as proof.
  test("an artifact name outside the list is not caught", () => {
    expect(
      asksWriterForArtifact("Send me a terminology matrix and a scoping sheet.")
    ).toBe(false);
  });
});

describe("namesParagraph (CAP-15)", () => {
  test("true when a paragraph is named", () => {
    expect(namesParagraph("Paragraph 4 drops the hypothesis clause.")).toBe(true);
    expect(namesParagraph("the differences sit in paragraph 2 and paragraph 5")).toBe(
      true
    );
    expect(namesParagraph("the differences are in paragraphs 3 and 4")).toBe(true);
  });

  test("false for a reply that names no paragraph", () => {
    expect(namesParagraph("The two documents differ in tone and structure.")).toBe(
      false
    );
  });
});
