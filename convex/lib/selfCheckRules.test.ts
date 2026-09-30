import { describe, expect, it } from "vitest";
import {
  paragraphWithCloseForm,
  repairIssues,
  runDeterministicSelfCheck,
  type DeterministicSelfCheck,
} from "./selfCheckRules";
import { governedTermReason, type WriterFeedback } from "./writerPrecedence";
import type { OrderedProfileContext } from "./orderedChain";

// Fictional wording from release suite run 11 (commit 9de29da9), fixture
// exclusion-conflict (Quillmere burner anomaly model).
const EXCLUSION =
  "Migration of the customer billing portal to a new cloud host was routine IT work following a vendor migration guide.";
// Signed-off item 9 as the writer edited it and confirmed it at Approve.
const KEPT_IDEA = [
  "The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month.",
  `The work also covered this: ${EXCLUSION}`,
];
// Line 244 paragraph 3 of run 11, first two sentences.
const CLOSE_FORM_P3 =
  "The first uncertainty was whether the existing unsupervised approach could survive drift in the field at all. The team rebuilt the isolation forest baseline and tested it with injected drift of 1 to 3 degrees C per month; this work also covered migration of the customer billing portal to a new cloud host, which was routine IT work following a vendor migration guide.";

const PROFILE: OrderedProfileContext = {
  profileState: "missing",
  categoryOutcomes: [],
  buildOrder: ["242", "244", "246"],
  selfCheckRules: [],
};

function exclusionRow(text: string) {
  const check = runDeterministicSelfCheck({
    section: "244",
    text,
    brief: {
      storylineText: "",
      claimExclusions: [{ text: EXCLUSION, reason: "routine_engineering" }],
      confidenceMap: [],
      glossaryTerms: [],
    },
    profile: PROFILE,
    isFirstInOrder: false,
    confirmedPlanConflicts: [KEPT_IDEA],
  });
  const entry = check.entries.find((candidate) => candidate.row.instruction === `Claim Exclusion: ${EXCLUSION}`);
  if (!entry) throw new Error("No Claim Exclusion row");
  return entry;
}

describe("the suspended Claim Exclusion row names a close form of its words (2026-09-30, second)", () => {
  it("says where a close form of the exclusion's words is, as run 11's Line 244 paragraph 3 holds", () => {
    const text = ["The work plan had three phases.", "Drift rates were logged per dryer.", CLOSE_FORM_P3].join("\n\n");
    const entry = exclusionRow(text);
    expect(entry.repairable).toBe(false);
    expect(entry.row).toMatchObject({
      outcome: "not_applied",
      tier: "conflict",
      paragraphIndex: 2,
      reason: "suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering): its exact words are not in this Line, but a close form of its words is in paragraph 3 and is not repaired away; the idea's own row says whether it was drafted",
    });
    expect(paragraphWithCloseForm(text.split("\n\n"), EXCLUSION)).toBe(2);
    // Case and punctuation aside.
    expect(paragraphWithCloseForm([CLOSE_FORM_P3.toUpperCase().replace(/,/g, " ;")], EXCLUSION)).toBe(0);
  });

  it("keeps the exact wording when the words stand as written, and \"not in this Line\" only when truly absent", () => {
    const exact = exclusionRow(["The work plan had three phases.", EXCLUSION].join("\n\n"));
    expect(exact.row.reason).toBe(
      "suspended in this Line for the idea the writer kept despite this Claim Exclusion: its words appear in paragraph 2 (routine engineering) and are not repaired away; this word check cannot tell that idea from other content with the same words"
    );
    // A paragraph that shares only a topic ("billing", "cloud") is no close form.
    const absent = exclusionRow([
      "The work plan had three phases.",
      "The model ran on a cloud host and sent alerts to the billing team's pager.",
    ].join("\n\n"));
    expect(absent.row).not.toHaveProperty("paragraphIndex");
    expect(absent.row.reason).toBe(
      "suspended in this Line for the idea the writer kept despite this Claim Exclusion (routine engineering); its words are not in this Line as written, and the idea's own row says whether it was drafted"
    );
    expect(paragraphWithCloseForm(["", "   "], EXCLUSION)).toBe(-1);
    expect(paragraphWithCloseForm([CLOSE_FORM_P3], "the and of")).toBe(-1);
  });
});

describe("a term the writer's Feedback governs where an unedited signed-off idea uses it (2026-09-30, second)", () => {
  const spindle: WriterFeedback[] = [{
    roleId: "company_context",
    instruction: "Call the deburring tool the compliant spindle, never the floating head, here and in every later step.",
  }];
  const before: DeterministicSelfCheck = { entries: [], glossaryCandidates: [], modelRules: [], paragraphs: [] };
  const verdict = {
    paragraphIndex: 4,
    check: "instruction" as const,
    instruction: "Glossary Term: floating head",
    feedbackTerm: "floating head",
    outcome: "not_applied" as const,
    reason: "P5 says floating head force.",
    repairGuidance: "Say compliant spindle force in P5.",
  };

  it("repairs toward the Feedback and says renaming keeps the idea's meaning", () => {
    expect(repairIssues(before, [verdict], [{ term: "floating head", feedback: spindle, inSignedOffIdea: true }])).toEqual([
      `Paragraph 5: for the term "floating head", follow the writer's Feedback on Company / Context: "${spindle[0]!.instruction}", also where a signed-off idea uses the term (renaming it is wording, not meaning: keep the idea's meaning). Say compliant spindle force in P5.`,
    ]);
    // Without such an idea the issue is worded as before.
    expect(repairIssues(before, [verdict], [{ term: "floating head", feedback: spindle }])).toEqual([
      `Paragraph 5: for the term "floating head", follow the writer's Feedback on Company / Context: "${spindle[0]!.instruction}". Say compliant spindle force in P5.`,
    ]);
  });

  it("says so in the row, and words every other row as before", () => {
    expect(governedTermReason(spindle, "followed", undefined, true)).toBe(
      `The writer's Feedback governs this term in this Line, not the Brief, even where a signed-off idea uses it (renaming is wording, not meaning, so the idea's meaning stays): follow the writer's Feedback on Company / Context: "${spindle[0]!.instruction}". The Self-check found that the text follows it.`
    );
    expect(governedTermReason(spindle, "followed")).toBe(
      `The writer's Feedback governs this term in this Line, not the Brief: follow the writer's Feedback on Company / Context: "${spindle[0]!.instruction}". The Self-check found that the text follows it.`
    );
  });
});
