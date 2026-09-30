import { describe, expect, it } from "vitest";
import {
  confirmedConflictParagraph,
  confirmedConflictsOf,
  conflictExclusionsPhrase,
  feedbackForLine,
  GOVERNING_FEEDBACK_TIE_BREAK,
  glossaryTermPrecedence,
  governedTermReason,
  governingFeedbackPhrase,
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

describe("Glossary Terms the writer's Feedback governs (2026-09-29 second, CAP-13 rule 5, PR #22 lead decision)", () => {
  const company = (instruction: string) => ({ roleId: "company_context" as const, instruction });
  /** No idea of the Line uses the term, so only the Feedback and edits decide. */
  const precedence = (instruction: string, term = "floating head") => glossaryTermPrecedence({
    glossaryTerms: [term],
    feedback: [company(instruction)],
    editedItems: [],
    selectionWording: [["Force control held the burr height within tolerance."]],
  });

  it("gives a named term to the Feedback whichever way it points: ban, endorse, replace, double negative or compound", () => {
    // No phrase is read for its meaning: naming the term is what counts, and
    // the Self-check label judges whether the text follows the instruction.
    for (const instruction of [
      // Bans, including the three Greptile found the phrase rules misread.
      "Never say floating head.",
      "Floating head is not allowed.",
      "DON\u2019T call it the Floating-Head",
      // Endorsements.
      "Call the deburring tool the floating head.",
      "Always say floating head; it is the shop's word.",
      // Replacements, either way round.
      "Replace floating head with compliant spindle.",
      "Replace the compliant spindle with the floating head.",
      "floating head -> compliant spindle",
      // Double negatives and compounds.
      "Floating head is not allowed to be removed.",
      "Floating head is not allowed to be removed and not allowed to be used.",
      "Don't not call it the floating head.",
      SPINDLE,
    ]) {
      expect(precedence(instruction), instruction).toEqual({
        setAside: [],
        governed: [{ term: "floating head", feedback: [company(instruction)] }],
      });
    }
    // The run 6 instruction governs both of its terms; each label judges it.
    expect(precedence(SPINDLE, "compliant spindle").governed).toEqual([
      { term: "compliant spindle", feedback: [company(SPINDLE)] },
    ]);
  });

  it("names a term across hyphens, spaces, case and simple plurals, never inside a longer word (review P3-2)", () => {
    const governs = (instruction: string, term = "floating head") => precedence(instruction, term).governed.length;
    expect(governs("Say floating-head.")).toBe(1);
    expect(governs("Say Floating Heads.")).toBe(1);
    expect(governs("Say floating head.", "floating heads")).toBe(1);
    expect(governs("Say floating  head.", "floating-head")).toBe(1);
    expect(governs("Call it the free-floating headstock.")).toBe(0);
    expect(governs("Say Grandbois, Quebec.")).toBe(0);
    expect(namesTerm("the floating heads", "floating head")).toBe(true);
    expect(namesTerm("the floatinghead", "floating head")).toBe(false);
    expect(namesTerm("two batches", "batch")).toBe(true);
    expect(namesTerm("glass", "glas")).toBe(false);
  });

  it("round 4 review P3-3: reads y and ies after a consonant as one word, and keeps s and es", () => {
    expect(namesTerm("Two test assemblies failed.", "test assembly")).toBe(true);
    expect(namesTerm("The test assembly failed.", "test assemblies")).toBe(true);
    expect(namesTerm("The relays tripped.", "relay")).toBe(true);
    expect(namesTerm("The relaies tripped.", "relay")).toBe(false);
    expect(namesTerm("Two floating heads.", "floating head")).toBe(true);
    expect(namesTerm("Two batches.", "batch")).toBe(true);
    expect(namesTerm("The test assemblage.", "test assembly")).toBe(false);
    expect(precedence("Never say test assemblies.", "test assembly").governed).toHaveLength(1);
  });

  it("round 4 review P2-1: a term in quotes or with a possessive is named; an apostrophe inside a word is no edge", () => {
    for (const text of [
      "Never say 'floating head'.",
      "Never say \u2018floating head\u2019.",
      "Never say \"floating head\".",
      "Never say \u201cfloating head\u201d.",
      "'Floating-Head' is the shop's word.",
      "The floating head's radius drifted.",
      "Both floating heads' radii drifted.",
    ]) {
      expect(namesTerm(text, "floating head"), text).toBe(true);
    }
    expect(namesTerm("The o'floating head is a fixture.", "floating head")).toBe(false);
    expect(namesTerm("The o\u2019floating head is a fixture.", "floating head")).toBe(false);
    expect(namesTerm("The xfloating head.", "floating head")).toBe(false);
    // The same edge rule holds for the Feedback, the ideas and the edits.
    expect(precedence("Never say 'floating head'.")).toEqual({
      setAside: [],
      governed: [{ term: "floating head", feedback: [company("Never say 'floating head'.")] }],
    });
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [company("Never say 'floating head'.")],
      editedItems: [],
      selectionWording: [["Force control came from the \u2018floating head\u2019."]],
    })).toEqual({ setAside: [], governed: [] });
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [],
      editedItems: [{
        original: ["Force control came from the 'floating head'."],
        edited: ["Force control came from a compliant spindle."],
      }],
      selectionWording: [["Force control came from a compliant spindle."]],
    }).setAside).toHaveLength(1);
  });

  it("lists every instruction that names the term, in the order they reach the Line, and leaves other terms alone", () => {
    const feedback = [
      company(SPINDLE),
      { roleId: "experimentation" as const, instruction: "Name each test by its month." },
      { roleId: "experimentation" as const, instruction: "Keep floating heads out of the test names." },
    ];
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head", "burr height estimation", "Floating head"],
      feedback,
      editedItems: [],
      selectionWording: [["Force control came from a compliant spindle."]],
    })).toEqual({
      setAside: [],
      governed: [{ term: "floating head", feedback: [feedback[0], feedback[2]] }],
    });
  });

  it("keeps a term in force while a signed-off idea drafted in the Line uses it, whatever the Feedback says", () => {
    // Lead decision P2-2: the signed-off selections, edits included, outrank
    // the Feedback.
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [company(SPINDLE)],
      editedItems: [{
        original: ["Force control came from a compliant spindle."],
        edited: ["Force control came from the floating head after all."],
      }],
      selectionWording: [["Force control came from the floating head after all."]],
    })).toEqual({ setAside: [], governed: [] });
    expect(glossaryTermPrecedence({
      glossaryTerms: ["sensor"],
      feedback: [company("Say sensor array, not sensor bank.")],
      editedItems: [],
      selectionWording: [["Each sensor drifted by 2 C per month."]],
    })).toEqual({ setAside: [], governed: [] });
  });

  it("sets aside a term a signed-off edit took out, even where Feedback names it, unless another idea still uses it", () => {
    const edit = {
      original: ["Force control came from a floating head in the pilot cell."],
      edited: ["Force control came from a compliant spindle in the pilot cell."],
    };
    const reason =
      "the writer's edit to the signed-off idea \"Force control came from a compliant spindle in the pilot cell.\" took this term out";
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head", "pilot cell"],
      feedback: [],
      editedItems: [edit],
      selectionWording: [edit.edited],
    })).toEqual({ setAside: [{ term: "floating head", reason }], governed: [] });
    // The edit is a signed-off selection, which outranks the Feedback.
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [company("Always say floating head.")],
      editedItems: [edit],
      selectionWording: [edit.edited],
    })).toEqual({ setAside: [{ term: "floating head", reason }], governed: [] });
    // One edit dropped it incidentally; another idea keeps it.
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [],
      editedItems: [edit],
      selectionWording: [edit.edited, ["The floating head held the radius."]],
    })).toEqual({ setAside: [], governed: [] });
  });

  it("decides nothing without Feedback or an edit that names the term", () => {
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [company("Say Grandbois, Quebec.")],
      editedItems: [{ original: ["The pilot cell ran."], edited: ["The pilot cell in Bay 4 ran."] }],
      selectionWording: [["The pilot cell in Bay 4 ran."]],
    })).toEqual({ setAside: [], governed: [] });
  });

  it("round 4 review P3-2: lists several instructions in the order given and says the latest wins where they disagree", () => {
    const ban = company("Never say floating head.");
    const endorse = company("Call it the floating head after all.");
    expect(GOVERNING_FEEDBACK_TIE_BREAK).toBe("where they disagree, the latest instruction wins");
    // A ban, then a later endorsement; and the reverse.
    expect(glossaryTermPrecedence({
      glossaryTerms: ["floating head"],
      feedback: [ban, endorse],
      editedItems: [],
      selectionWording: [],
    }).governed).toEqual([{ term: "floating head", feedback: [ban, endorse] }]);
    expect(governingFeedbackPhrase([ban, endorse])).toBe(
      'on Company / Context: "Never say floating head."; then on Company / Context: "Call it the floating head after all." (where they disagree, the latest instruction wins)'
    );
    expect(governingFeedbackPhrase([endorse, ban])).toBe(
      'on Company / Context: "Call it the floating head after all."; then on Company / Context: "Never say floating head." (where they disagree, the latest instruction wins)'
    );
    // One instruction needs no tie-break.
    expect(governingFeedbackPhrase([ban])).toBe('on Company / Context: "Never say floating head."');
  });

  it("words the governed row in fixed text that quotes the Feedback, never the model's", () => {
    const feedback = [company(SPINDLE), { roleId: "experimentation" as const, instruction: "Keep \"floating head\" out of test names." }];
    const phrase =
      `on Company / Context: "${SPINDLE}"; then on Experimentation / Iterations: "Keep \\"floating head\\" out of test names." (where they disagree, the latest instruction wins)`;
    expect(governingFeedbackPhrase(feedback)).toBe(phrase);
    const base = `The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback ${phrase}.`;
    expect(governedTermReason(feedback, "followed")).toBe(`${base} The Self-check found that the text follows it.`);
    expect(governedTermReason(feedback, "not_followed")).toBe(`${base} The Self-check found that the text does not follow it`);
    expect(governedTermReason(feedback, "not_checked")).toBe(`${base} The Self-check gave no verdict for it, so it is not checked.`);
    expect(governedTermReason(feedback, "check_failed")).toBe(`${base} The Self-check did not run, so it is not checked.`);
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
