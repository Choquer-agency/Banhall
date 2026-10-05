import { describe, expect, it } from "vitest";
import {
  assembleSectionNotes,
  paragraphWithCloseForm,
  repairIssues,
  runDeterministicSelfCheck,
  talksAboutLength,
  writerRowGuard,
  type DeterministicSelfCheck,
  type ModelVerdict,
} from "./selfCheckRules";
import { governedTermReason, type WriterFeedback } from "./writerPrecedence";
import type { OrderedProfileContext, SectionNumber, SelfCheckRule } from "./orderedChain";

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

// ─── 2026-10-04 (first): no Compliance Note row vouches for a measured cap ──

// A shortened stand-in for the release suite fixture's settings document
// (fictional Velloway Panel Finishing, writer-settings-document).
const SETTINGS = [
  "# PD Writing Customized Settings",
  "## 1. Core variable glossary\n\n- cure window: never write bake window or oven window.",
  "## 4. Word caps\n\n- Line 242: no more than 260 words.\n- Line 244: no more than 520 words.\n- Line 246: no more than 260 words.",
  "## 6. Style\n\nWrite in the third person throughout.",
].join("\n\n");
const CAP_RULES: SelfCheckRule[] = [
  { section: "242", instruction: "- Line 242: no more than 260 words.", maxWords: 260 },
  { section: "244", instruction: "- Line 244: no more than 520 words.", maxWords: 520 },
  { section: "246", instruction: "- Line 246: no more than 260 words.", maxWords: 260 },
];
const APPLIED: OrderedProfileContext = { ...PROFILE, profileState: "applied", selfCheckRules: CAP_RULES };

/** `count` words in three paragraphs. */
function lineOf(count: number): string {
  const words = Array.from({ length: count }, (_, index) => `word${index}`);
  const third = Math.ceil(count / 3);
  return [words.slice(0, third), words.slice(third, third * 2), words.slice(third * 2)]
    .map((part) => `${part.join(" ")}.`)
    .join("\n\n");
}

function notesFor(args: {
  section: SectionNumber;
  words: number;
  verdicts: ModelVerdict[];
  profile?: OrderedProfileContext;
  passes?: number;
}) {
  const text = lineOf(args.words);
  const before = runDeterministicSelfCheck({
    section: args.section,
    text,
    brief: null,
    profile: args.profile ?? APPLIED,
    isFirstInOrder: false,
  });
  return assembleSectionNotes({
    section: args.section,
    before,
    after: null,
    verdicts: args.verdicts,
    modelCheck: { ok: true },
    storylineQuestion: null,
    repair: { attempted: false, succeeded: false },
    finalText: text,
    compression: { passes: args.passes ?? 3 },
    writerInstructions: SETTINGS,
  }).rows;
}

const profileVerdict = (reason: string, outcome: "applied" | "not_applied" = "applied"): ModelVerdict => ({
  check: "instruction",
  instruction: SETTINGS,
  outcome,
  reason,
});

describe("no Compliance Note row vouches for a cap code measured (2026-10-04, first)", () => {
  it("run 2026-10-04's Line 244 row can no longer say the word cap was ok beside a cap row that failed", () => {
    const rows = notesFor({
      section: "244",
      words: 602,
      verdicts: [profileVerdict("Glossary terms used, no banned words, third person, word cap ok.")],
    });
    expect(rows.find((row) => row.instruction === "- Line 244: no more than 520 words.")).toMatchObject({
      outcome: "not_applied",
      reason:
        "exceeds: 602/520 words; still over after 3 shortening passes. The text was not cut to fit: shorten Line 244 to 520 words to meet the writer's settings",
    });
    expect(rows.find((row) => row.instruction === "Writer Profile")).toMatchObject({
      outcome: "applied",
      reason:
        "Writer Profile applied. It was used to draft this Line, but not every rule it sets was met: Line 244 is over the writer's cap at 602/520 words (see that row).",
    });
    const settingsRow = rows.find((row) => row.source === "model");
    expect(settingsRow).toMatchObject({
      outcome: "not_applied",
      reason:
        "Not followed in full: Line 244 is over the writer's cap at 602/520 words (measured by code; see the cap row). The Self-check found the other rules followed.",
    });
    expect(settingsRow?.reason).not.toMatch(/cap ok/);
  });

  it("keeps the model's words when they say nothing about length (run 2026-10-04, Lines 242 and 246)", () => {
    const line242 = notesFor({
      section: "242",
      words: 323,
      verdicts: [profileVerdict("Required openers used, no banned words, third person.")],
    }).find((row) => row.source === "model");
    expect(line242).toMatchObject({
      outcome: "not_applied",
      reason:
        "Not followed in full: Line 242 is over the writer's cap at 323/260 words (measured by code; see the cap row). Otherwise followed: Required openers used, no banned words, third person.",
    });
    const line246 = notesFor({
      section: "246",
      words: 274,
      verdicts: [profileVerdict("Terms, banned words, third person, and word cap all followed.")],
    }).find((row) => row.source === "model");
    expect(line246).toMatchObject({
      outcome: "not_applied",
      reason:
        "Not followed in full: Line 246 is over the writer's cap at 274/260 words (measured by code; see the cap row). The Self-check found the other rules followed.",
    });
  });

  it("leaves every row as before when the measured caps are met", () => {
    const rows = notesFor({
      section: "244",
      words: 500,
      verdicts: [profileVerdict("Glossary terms used, no banned words, third person.")],
    });
    expect(rows.find((row) => row.instruction === "- Line 244: no more than 520 words.")).toMatchObject({
      outcome: "applied",
      reason: "500/520 words",
    });
    expect(rows.find((row) => row.instruction === "Writer Profile")?.reason).toBe("Writer Profile applied");
    expect(rows.find((row) => row.source === "model")).toMatchObject({
      outcome: "applied",
      reason: "Glossary terms used, no banned words, third person.",
    });
  });

  it("guards a quoted cap rule, and leaves a quoted rule about something else alone", () => {
    const rows = notesFor({
      section: "244",
      words: 602,
      verdicts: [
        { check: "instruction", instruction: "Line 244: no more than 520 words.", outcome: "applied", reason: "Fine." },
        { check: "instruction", instruction: "Write in the third person throughout.", outcome: "applied", reason: "Third person used." },
      ],
    }).filter((row) => row.source === "model");
    expect(rows[0]).toMatchObject({
      outcome: "not_applied",
      reason:
        "Not followed in full: Line 244 is over the writer's cap at 602/520 words (measured by code; see the cap row). Otherwise followed: Fine.",
    });
    expect(rows[1]).toMatchObject({ outcome: "applied", reason: "Third person used." });
  });

  it("names the cap beside the model's own failure, and drops a model reason about length", () => {
    const rows = notesFor({
      section: "244",
      words: 602,
      verdicts: [profileVerdict("P2 says bake window.", "not_applied")],
    });
    expect(rows.find((row) => row.source === "model")).toMatchObject({
      outcome: "not_applied",
      reason:
        "Not followed: Line 244 is over the writer's cap at 602/520 words (measured by code; see the cap row). Also: P2 says bake window.",
    });
    const lengthOnly = notesFor({
      section: "244",
      words: 602,
      verdicts: [profileVerdict("Over the 520-word cap.", "not_applied")],
    });
    expect(lengthOnly.find((row) => row.source === "model")?.reason).toBe(
      "Not followed: Line 244 is over the writer's cap at 602/520 words (measured by code; see the cap row)."
    );
  });

  it("over the Locked cap only, a profile with no cap keeps its verdict but never vouches for length", () => {
    const noCaps: OrderedProfileContext = { ...APPLIED, selfCheckRules: [] };
    const rows = notesFor({
      section: "242",
      words: 360,
      profile: noCaps,
      verdicts: [profileVerdict("Third person, terms used, within the word limit.")],
    });
    expect(rows.find((row) => row.instruction === "Writer Profile")?.reason).toBe("Writer Profile applied");
    expect(rows.find((row) => row.source === "model")).toMatchObject({
      outcome: "applied",
      reason:
        "Followed, as the Self-check found. Length is measured by code: Line 242 is over the Locked cap at 360/350 words (see the cap row).",
    });
  });

  it("never touches other kinds of rows, nor a not checked label", () => {
    const failed = [{ kind: "writer" as const, scope: "Line 242", wholeLine: true, over: ["300/260 words"], limits: "260 words", instruction: "- Line 242: no more than 260 words." }];
    const row = { section: "242" as const, source: "model" as const, instruction: SETTINGS, outcome: "applied" as const, tier: "none" as const, reason: "ok", repaired: false };
    expect(writerRowGuard({ verdict: { instruction: SETTINGS, outcome: "applied", reason: "ok" }, row, failedCaps: [] })).toBeNull();
    expect(writerRowGuard({ verdict: { instruction: "Use British spelling.", outcome: "applied", reason: "British spelling used." }, row, failedCaps: failed, writerInstructions: SETTINGS })).toBeNull();
    const rows = notesFor({
      section: "242",
      words: 323,
      verdicts: [{ ...profileVerdict("Not checked."), outcome: "not_applied", notChecked: true }],
    });
    expect(rows.find((candidate) => candidate.source === "model")).toMatchObject({ outcome: "not_applied", reason: "Not checked." });
  });

  it("reads length talk broadly, and plain rule talk as nothing about length", () => {
    for (const reason of ["word cap ok", "Terms, banned words, third person, and word cap all followed.", "within limits", "Length is fine.", "Section is 300 words.", "602/520 words"]) {
      expect(talksAboutLength(reason)).toBe(true);
    }
    for (const reason of ["Required openers used, no banned words, third person.", "Glossary terms used.", "Technological limitations stated.", "No capital spending claimed."]) {
      expect(talksAboutLength(reason)).toBe(false);
    }
  });
});
