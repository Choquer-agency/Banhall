import { describe, expect, it } from "vitest";
import {
  confirmedConflictParagraph,
  confirmedConflictsOf,
  feedbackForLine,
  glossaryTermsSetAside,
  ideaWords,
} from "./writerPrecedence";

// Fictional wording from the run 6 release suite fixtures (commit c8ce1fe2).
const SPINDLE =
  "Call the deburring tool the compliant spindle, never the floating head, here and in every later step";
const KESTREL = "Call the pilot cell the Kestrel line";
const BILLING =
  "Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty.";

describe("the active Feedback that reaches a Line (2026-09-29 second, CAP-13 rule 5)", () => {
  const rows = [
    { roleId: "experimentation" as const, instruction: "Name each test by its month.", status: "active" },
    { roleId: "company_context" as const, instruction: SPINDLE, status: "active" },
    { roleId: "company_context" as const, instruction: KESTREL, status: "withdrawn" },
    { roleId: "workplan" as const, instruction: "Keep the plan to three stages.", status: "suspendedBySkip" },
    { roleId: "project_status" as const, instruction: "Say the cell is still in Bay 4.", status: "active" },
  ];

  it("reaches the Line of its step and every later Line, in step order", () => {
    expect(feedbackForLine("242", rows)).toEqual([
      { roleId: "company_context", instruction: SPINDLE },
    ]);
    expect(feedbackForLine("244", rows)).toEqual([
      { roleId: "company_context", instruction: SPINDLE },
      { roleId: "experimentation", instruction: "Name each test by its month." },
    ]);
    expect(feedbackForLine("246", rows)).toEqual([
      { roleId: "company_context", instruction: SPINDLE },
      { roleId: "experimentation", instruction: "Name each test by its month." },
      { roleId: "project_status", instruction: "Say the cell is still in Bay 4." },
    ]);
  });

  it("never carries withdrawn Feedback, Feedback a Skip suspended, or Feedback on a skipped step", () => {
    for (const section of ["242", "244", "246"] as const) {
      const text = JSON.stringify(feedbackForLine(section, rows, ["experimentation"]));
      expect(text).not.toContain("Kestrel");
      expect(text).not.toContain("three stages");
      expect(text).not.toContain("by its month");
    }
  });
});

describe("Glossary Terms the writer's wording sets aside (2026-09-29 second, CAP-13 rule 5)", () => {
  const feedback = [{ roleId: "company_context" as const, instruction: SPINDLE }];

  it("sets aside a Glossary Term an active Feedback instruction names, with the instruction as the reason", () => {
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head", "burr height estimation", "Floating head"],
      feedback,
      editedItems: [],
    })).toEqual([{
      term: "floating head",
      reason: `the writer's Feedback on Company / Context names this term: "${SPINDLE}"`,
    }]);
  });

  it("matches the term word for word, singular or plural, and never inside a longer word", () => {
    const plural = [{ roleId: "company_context" as const, instruction: "Never say floating heads." }];
    expect(glossaryTermsSetAside({ glossaryTerms: ["floating head"], feedback: plural, editedItems: [] }))
      .toHaveLength(1);
    const inside = [{ roleId: "company_context" as const, instruction: "Call it the free-floating headstock." }];
    expect(glossaryTermsSetAside({ glossaryTerms: ["floating head"], feedback: inside, editedItems: [] }))
      .toEqual([]);
  });

  it("sets aside a Glossary Term the writer's edit took out of a signed-off idea", () => {
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head", "pilot cell"],
      feedback: [],
      editedItems: [{
        original: ["Force control came from a floating head in the pilot cell."],
        edited: ["Force control came from a compliant spindle in the pilot cell."],
      }],
    })).toEqual([{
      term: "floating head",
      reason:
        "the writer's edit to the signed-off idea \"Force control came from a compliant spindle in the pilot cell.\" took this term out",
    }]);
  });

  it("sets nothing aside without Feedback or an edit that names the term", () => {
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head"],
      feedback: [{ roleId: "company_context", instruction: "Say Grandbois, Quebec." }],
      editedItems: [{ original: ["The pilot cell ran."], edited: ["The pilot cell in Bay 4 ran."] }],
    })).toEqual([]);
  });
});

describe("ideas kept despite a Claim Exclusion (2026-09-29 second, CAP-13 rule 4)", () => {
  const kept = {
    itemId: "item-kept",
    instruction: "cover" as const,
    confirmedExclusion: true,
    wording: [
      "The rebuilt isolation forest baseline confirmed the drift problem.",
      `The work also covered this: ${BILLING}`,
    ],
  };
  const exclusions = [
    { text: BILLING, reason: "routine_engineering" },
    { text: "Redesign of the dashboard colours and layout was cosmetic, not technological." },
  ];

  it("names each kept idea with the exclusions it matches, and no other item", () => {
    const conflicts = confirmedConflictsOf([
      kept,
      { itemId: "item-other", instruction: "cover", confirmedExclusion: false, wording: [BILLING] },
      { instruction: "skip", confirmedExclusion: false, wording: [] },
    ], exclusions);
    expect(conflicts).toEqual([{ itemId: "item-kept", wording: kept.wording, exclusions: [exclusions[0]] }]);
  });

  it("finds the paragraph that holds the excluded words as written, whatever the case or punctuation", () => {
    const [conflict] = confirmedConflictsOf([kept], exclusions);
    const text = [
      "The first paragraph.",
      "The team also did work that was not claimed: migration of the customer billing portal to a new cloud host was routine IT work, with no uncertainty.",
    ].join("\n\n");
    expect(confirmedConflictParagraph(text, conflict!)).toBe(1);
    expect(confirmedConflictParagraph("The first paragraph.", conflict!)).toBeUndefined();
  });

  it("names an idea by its words, clipped", () => {
    expect(ideaWords(["One.", "Two."])).toBe("One. Two.");
    expect(ideaWords(["x".repeat(200)], 20)).toBe(`${"x".repeat(19)}...`);
  });
});
