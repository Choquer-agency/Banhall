import { describe, expect, it } from "vitest";
import {
  confirmedConflictParagraph,
  confirmedConflictsOf,
  conflictExclusionsPhrase,
  feedbackForLine,
  feedbackRulesOutTerm,
  glossaryTermsSetAside,
  ideaWords,
  namesTerm,
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
  const spindleIdeas = [["Force control came from a compliant spindle."]];

  it("sets aside a Glossary Term an active Feedback instruction rules out, with the instruction as the reason", () => {
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head", "burr height estimation", "Floating head"],
      feedback,
      editedItems: [],
      selectionWording: spindleIdeas,
    })).toEqual([{
      term: "floating head",
      reason: `the writer's Feedback on Company / Context rules out this term: "${SPINDLE}"`,
    }]);
  });

  it("reads hyphens and spaces alike, case aside, singular or plural, never inside a longer word (review P3-2)", () => {
    const setAside = (instruction: string, term = "floating head") => glossaryTermsSetAside({
      glossaryTerms: [term],
      feedback: [{ roleId: "company_context", instruction }],
      editedItems: [],
      selectionWording: spindleIdeas,
    }).length;
    expect(setAside("Never say floating-head.")).toBe(1);
    expect(setAside("Never say Floating Heads.")).toBe(1);
    expect(setAside("Never say floating head.", "floating heads")).toBe(1);
    expect(setAside("Never say floating  head.", "floating-head")).toBe(1);
    expect(setAside("Call it the free-floating headstock.")).toBe(0);
    expect(namesTerm("the floating heads", "floating head")).toBe(true);
    expect(namesTerm("the floatinghead", "floating head")).toBe(false);
    expect(namesTerm("two batches", "batch")).toBe(true);
    expect(namesTerm("glass", "glas")).toBe(false);
  });

  it("never sets aside a term a signed-off idea drafted in the Line still uses (Feedback endorsing it, or a later edit)", () => {
    // Feedback that endorses the Glossary Term: the ideas use it.
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head"],
      feedback: [{ roleId: "company_context", instruction: "Call the deburring tool the floating head." }],
      editedItems: [],
      selectionWording: [["Force control came from the floating head."]],
    })).toEqual([]);
    // Lead decision P2-2: Feedback forbids the term, a later signed-off edit
    // uses it, and the edit wins in its Line.
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head"],
      feedback,
      editedItems: [{
        original: ["Force control came from a compliant spindle."],
        edited: ["Force control came from the floating head after all."],
      }],
      selectionWording: [["Force control came from the floating head after all."]],
    })).toEqual([]);
    // A common one-word term the Feedback mentions stays while ideas use it.
    expect(glossaryTermsSetAside({
      glossaryTerms: ["sensor"],
      feedback: [{ roleId: "company_context", instruction: "Say sensor array, not sensor bank." }],
      editedItems: [],
      selectionWording: [["Each sensor drifted by 2 C per month."]],
    })).toEqual([]);
  });

  it("keeps a Glossary Term an active Feedback instruction endorses in force (PR #22 review G10)", () => {
    // No idea of the Line uses the term, so only the Feedback decides.
    const setAside = (instruction: string, term = "floating head") => glossaryTermsSetAside({
      glossaryTerms: [term],
      feedback: [{ roleId: "company_context", instruction }],
      editedItems: [],
      selectionWording: [["Force control held the burr height within tolerance."]],
    });
    for (const endorsing of [
      "Call the deburring tool the floating head.",
      "CALL THE DEBURRING TOOL THE FLOATING HEAD, here and in every later step",
      "Always say floating head; it is the shop's word.",
      "Keep using floating-head in every step.",
      "The floating head is the right name, use it everywhere.",
      "Use the floating head, not the compliant spindle.",
      "Use no other name than floating head.",
      "Replace the compliant spindle with the floating head.",
      "Change the compliant spindle to the floating head.",
      "Stop saying compliant spindle and say floating head.",
      "Don't call it the compliant spindle, call it the floating head.",
      "Not the compliant spindle but the floating head.",
      "Instead of the compliant spindle, write floating head.",
    ]) {
      expect(setAside(endorsing), endorsing).toEqual([]);
    }
    // The run 6 instruction endorses "compliant spindle" and rules out
    // "floating head".
    expect(setAside(SPINDLE, "compliant spindle")).toEqual([]);
    expect(setAside(SPINDLE, "deburring tool")).toEqual([]);
    expect(setAside(SPINDLE)).toEqual([{
      term: "floating head",
      reason: `the writer's Feedback on Company / Context rules out this term: "${SPINDLE}"`,
    }]);
  });

  it("sets aside a Glossary Term an active Feedback instruction rejects or replaces, in any case and with contractions", () => {
    const rulesOut = (instruction: string) => feedbackRulesOutTerm(instruction, "floating head");
    const rejecting = [
      SPINDLE,
      SPINDLE.toUpperCase(),
      "Never say floating head.",
      "never say Floating-Heads",
      "Don't call it the floating head.",
      "Don\u2019t call it the floating head.",
      "DONT CALL IT THE FLOATING HEAD",
      "Do not use floating head in any Line.",
      "We shouldn't write floating head.",
      "Avoid floating head.",
      "Stop calling it the floating head.",
      "No floating head anywhere.",
      "Call it compliant spindle not floating head",
      "Call it the compliant spindle (not the floating head).",
      "Say compliant spindle, never floating head or float.",
      "The floating head is wrong.",
      "\"Floating head\" is not the right term.",
      "Floating head should not be used.",
      "Floating head can't be used here.",
      "Terminology: never floating head.",
      // PR #22 review, round 2: explicit bans.
      "Floating head is not allowed.",
      "The floating head isn't permitted in this report.",
      "Floating head is not acceptable.",
      "Floating head is prohibited.",
      "Floating heads are disallowed.",
      "We prohibit floating head.",
      "Disallow floating head everywhere.",
    ];
    const replacing = [
      "Use compliant spindle instead of floating head.",
      "Say compliant spindle rather than floating head.",
      "Write compliant spindle in place of floating head.",
      "Replace floating head with compliant spindle.",
      "Replacing the floating head by the compliant spindle, please.",
      "Change the floating head to the compliant spindle.",
      "Rename the floating head as the compliant spindle.",
      "Switch from floating head to compliant spindle.",
      "Instead of floating head, write compliant spindle.",
      "Floating head should be replaced by compliant spindle.",
      "floating head -> compliant spindle",
      "Call it Y not X: compliant spindle, not floating head.",
    ];
    for (const instruction of [...rejecting, ...replacing]) {
      expect(rulesOut(instruction), instruction).toBe(true);
    }
    for (const instruction of [
      "Call the deburring tool the floating head.",
      "Use the floating head, not the compliant spindle.",
      "Replace the compliant spindle with the floating head.",
      "Don't call it the compliant spindle, call it the floating head.",
      "Say Grandbois, Quebec.",
      "The floating head is allowed.",
      "Floating head is permitted here.",
    ]) {
      expect(rulesOut(instruction), instruction).toBe(false);
    }
  });

  it("sets aside a Glossary Term the writer's edit took out, unless another idea of the Line still uses it", () => {
    const edit = {
      original: ["Force control came from a floating head in the pilot cell."],
      edited: ["Force control came from a compliant spindle in the pilot cell."],
    };
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head", "pilot cell"],
      feedback: [],
      editedItems: [edit],
      selectionWording: [edit.edited],
    })).toEqual([{
      term: "floating head",
      reason:
        "the writer's edit to the signed-off idea \"Force control came from a compliant spindle in the pilot cell.\" took this term out",
    }]);
    // One edit dropped it incidentally; another idea keeps it.
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head"],
      feedback: [],
      editedItems: [edit],
      selectionWording: [edit.edited, ["The floating head held the radius."]],
    })).toEqual([]);
  });

  it("sets nothing aside without Feedback or an edit that names the term", () => {
    expect(glossaryTermsSetAside({
      glossaryTerms: ["floating head"],
      feedback: [{ roleId: "company_context", instruction: "Say Grandbois, Quebec." }],
      editedItems: [{ original: ["The pilot cell ran."], edited: ["The pilot cell in Bay 4 ran."] }],
      selectionWording: [["The pilot cell in Bay 4 ran."]],
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

  it("locates the excluded words as written, a fallback that never shows the idea is covered (review P2-1)", () => {
    const [conflict] = confirmedConflictsOf([kept], exclusions);
    const covered = [
      "The first paragraph.",
      "The work also covered this: migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty.",
    ].join("\n\n");
    expect(confirmedConflictParagraph(covered, conflict!)).toBe(1);
    // A disclaimer holds the same words: only a coverage verdict decides
    // whether the idea is stated as work the project did.
    const disclaimer = "The migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty, and it is not claimed.";
    expect(confirmedConflictParagraph(disclaimer, conflict!)).toBe(0);
    expect(confirmedConflictParagraph("The first paragraph.", conflict!)).toBeUndefined();
  });

  it("names every Claim Exclusion an idea matches (review P3-7)", () => {
    expect(conflictExclusionsPhrase([])).toBe("a Claim Exclusion");
    expect(conflictExclusionsPhrase(["A."])).toBe('the Claim Exclusion "A."');
    expect(conflictExclusionsPhrase(["A.", "B."])).toBe('the Claim Exclusions "A." and "B."');
    expect(conflictExclusionsPhrase(["A.", "B.", "C."])).toBe('the Claim Exclusions "A.", "B." and "C."');
    const both = confirmedConflictsOf([{ ...kept, wording: [BILLING, "Redesign of the dashboard colours and layout was cosmetic, not technological."] }], exclusions);
    expect(both[0]?.exclusions.map((entry) => entry.text)).toEqual(exclusions.map((entry) => entry.text));
  });

  it("names an idea by its words, shortened only at a word boundary (privacy re-check P3)", () => {
    expect(ideaWords(["One.", "Two."])).toBe("One. Two.");
    // A cut never leaves a fragment of a name such as "Quillmer".
    expect(ideaWords(["The work at Quillmere Analytics Ltd. ran long."], 22)).toBe("The work at...");
    expect(ideaWords(["x".repeat(200)], 20)).toBe("...");
  });
});
