import { describe, expect, it } from "vitest";
import {
  ANALYZER_SYSTEM_PROMPT,
  buildSharedWritingRules,
  buildSection242SystemPrompt,
  buildSection244SystemPrompt,
  buildSection246SystemPrompt,
  buildQaSystemPrompt,
  buildSectionStructureRules,
  buildChatSystemPromptV2,
  CHAT_EVIDENCE_GUIDANCE,
  waivedCategoryLabels,
} from "./prompts";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  normalizeHouseRuleModes,
  normalizeStyleOverrides,
  resolveEffectiveOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import {
  findDashConnectors,
  RULES_ANALYSIS_FIGURES,
  RULES_HUMAN_PROSE,
  RULES_SEED_WORDING,
} from "../../shared/humanProse";
import { ANALYZER_REQUEST } from "./analyzerAgent";
import { CHAT_READ_MAX_TURN_CHARS } from "../chatDocuments";
import {
  ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
  CONSISTENCY_SYSTEM_PROMPT,
  PD_REVIEW_SYSTEM_PROMPT,
  QA_LINE_242_OPENING_CHECK,
  SECTION_242_OPENING_RULES,
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
} from "./prompts";
import { COMPRESSION_KEEPS_PLAIN_OPENING, COMPRESSION_REQUEST } from "./promptDefinitions";
import { BRIEF_SYSTEM_PROMPT } from "./brief";
import { CHRONOLOGY_SYSTEM_PROMPT } from "./chronologyAgent";
import { buildSeedSystemPrompt } from "./trustedContext";
import { BULK_EDIT_REFINE_RULE, BULK_EDIT_SIZE_RULE } from "../lib/completionReport";

// PSOS-49: prompt assembly under per-writer house-style waivers. A waived
// category's rule text must be OMITTED (conflict resolved before the prompt),
// while every CRA-compliance rule survives all waiver combinations.

const waive = (...keys: Array<keyof StyleOverrides>): StyleOverrides =>
  normalizeStyleOverrides(Object.fromEntries(keys.map((k) => [k, true])));

const ALL_WAIVED = waive(...STYLE_OVERRIDE_KEYS);
// What every writer gets with no house-style row stored and no profile:
// since 2026-09-15 that waives the mandated opening clauses and nothing else.
const SHIPPED_DEFAULT = resolveEffectiveOverrides(
  normalizeHouseRuleModes(undefined),
  NO_STYLE_OVERRIDES
);
// Every house-style category waived but the skeleton kept (the PSOS-49 set).
const ALL_HOUSE_STYLE_WAIVED = waive(
  ...STYLE_OVERRIDE_KEYS.filter((key) => key !== "reportSkeleton")
);

describe("buildSharedWritingRules", () => {
  it("includes every house-style block by default and no waiver footer", () => {
    const rules = buildSharedWritingRules();
    for (const heading of [
      "WRITING VOICE:",
      "VOICE CONSISTENCY IN MANDATED-OPENER PARAGRAPHS:",
      "SENTENCE CONSTRUCTION:",
      "CRA KEYWORD VISIBILITY:",
      "BANNED WORDS AND PHRASES",
      "HUMAN PROSE (MANDATORY",
      "REPETITION CONTROL:",
      "PARAGRAPH DENSITY:",
      "GENERAL RULES:",
      "REPETITION TRACKING (MANDATORY):",
      "FINAL SELF-CHECK (MANDATORY",
    ]) {
      expect(rules).toContain(heading);
    }
    expect(rules).not.toContain("HOUSE-RULE WAIVERS:");
  });

  const blockOwners: Array<[keyof StyleOverrides, string[]]> = [
    ["bannedWords", ["BANNED WORDS AND PHRASES", "FINAL SELF-CHECK (MANDATORY"]],
    ["paragraphDensity", ["PARAGRAPH DENSITY:"]],
    ["sentenceConstruction", ["SENTENCE CONSTRUCTION:"]],
    ["repetitionCaps", ["REPETITION CONTROL:", "REPETITION TRACKING (MANDATORY):"]],
    ["openingClauses", ["CRA KEYWORD VISIBILITY:"]],
  ];

  for (const [key, headings] of blockOwners) {
    it(`waiving ${key} removes exactly its blocks and adds the waiver footer`, () => {
      const rules = buildSharedWritingRules(waive(key));
      for (const heading of headings) {
        expect(rules).not.toContain(heading);
      }
      // Every other category's blocks survive.
      for (const [otherKey, otherHeadings] of blockOwners) {
        if (otherKey === key) continue;
        for (const heading of otherHeadings) {
          expect(rules).toContain(heading);
        }
      }
      expect(rules).toContain("HOUSE-RULE WAIVERS:");
    });
  }

  it("keeps the locked blocks under every single-waiver and the all-waived build", () => {
    const combos = [
      ...STYLE_OVERRIDE_KEYS.map((key) => waive(key)),
      ALL_WAIVED,
    ];
    for (const overrides of combos) {
      const rules = buildSharedWritingRules(overrides);
      expect(rules).toContain("WRITING VOICE:");
      expect(rules).toContain("GENERAL RULES:");
      expect(rules).toContain("NEVER hallucinate or fabricate technical details");
      expect(rules).toContain("[GAP: description of what information is needed]");
      expect(rules).toContain("NO bullet points");
    }
  });

  it("the waiver footer names each waived category", () => {
    const rules = buildSharedWritingRules(waive("bannedWords", "paragraphDensity"));
    expect(rules).toContain("banned words and phrases");
    expect(rules).toContain("paragraph density");
    // And keeps CRA supremacy explicit.
    expect(rules).toContain("remains mandatory");
  });
});

describe("waivedCategoryLabels", () => {
  it("is empty for the default and lists waived categories", () => {
    expect(waivedCategoryLabels(NO_STYLE_OVERRIDES)).toEqual([]);
    expect(waivedCategoryLabels(waive("repetitionCaps"))).toEqual([
      "phrase repetition caps",
    ]);
  });
});

describe("section 242 prompt", () => {
  it("mandates literal openers under full enforcement (an admin 'enforced' row)", () => {
    expect(buildSection242SystemPrompt()).toContain(
      'It MUST open with: "The limitations to standard practice were that..."'
    );
    expect(buildSection242SystemPrompt()).toContain(
      'This paragraph MUST open with: "The technological objective was to advance the understanding of'
    );
  });

  it("waiving openingClauses frees the phrasing but keeps the content mandate", () => {
    const prompt = buildSection242SystemPrompt(waive("openingClauses"));
    expect(prompt).not.toContain(
      'It MUST open with: "The limitations to standard practice were that..."'
    );
    expect(prompt).not.toContain(
      'This paragraph MUST open with: "The technological objective was to advance the understanding of'
    );
    // Content requirements stay.
    expect(prompt).toContain("limitations to standard practice");
    expect(prompt).toContain("technological objective");
    // Locked structure stays under the full house-style waiver set too.
    const allWaived = buildSection242SystemPrompt(ALL_HOUSE_STYLE_WAIVED);
    expect(allWaived).toContain(
      "Line 242 must cover, in this order: company context, goal/problem, limitations of standard practice (passive uncertainties), technological objective, active uncertainties."
    );
    expect(allWaived).toContain("CRITICAL DISTINCTION between passive and active uncertainties");
    expect(allWaived).toContain("The BECAUSE clause is what makes an uncertainty credible");
  });

  // 2026-10-19 (owner approved, client meeting of 2026-10-16): Line 242 opens
  // with who the company is, then the business goal in plain words, then the
  // context that makes the SR&ED work credible; the old "NOT a company bio"
  // rule, which made drafts open on technical detail, is gone.
  it("opens with a plain company sentence, then the plain business goal, then the SR&ED context", () => {
    for (const prompt of [
      buildSection242SystemPrompt(),
      buildSection242SystemPrompt(SHIPPED_DEFAULT),
      buildSection242SystemPrompt(ALL_HOUSE_STYLE_WAIVED),
    ]) {
      expect(prompt).toContain(SECTION_242_OPENING_RULES);
      const company = prompt.indexOf(
        "Open Line 242 with one plain, high-level sentence on who the company is and what it does"
      );
      const goal = prompt.indexOf("state the project's business goal in one plain, non-technical sentence");
      const context = prompt.indexOf("Then give the context that makes this SR&ED work credible");
      const limitations = prompt.indexOf("**PASSIVE TECHNOLOGICAL UNCERTAINTIES/LIMITATIONS:**");
      expect(company).toBeGreaterThan(-1);
      expect(goal).toBeGreaterThan(company);
      expect(context).toBeGreaterThan(goal);
      expect(limitations).toBeGreaterThan(context);
      expect(prompt).toContain("Everything after them is technical and SR&ED focused.");
      // No invention: only the material, the most general accurate description.
      expect(prompt).toContain("Use only what the provided material says about the company.");
      expect(prompt).toContain("write the most general accurate description it supports");
      expect(prompt).toContain("never guess specifics");
      // Short, not a bio.
      expect(prompt).toContain("no customer lists, markets served, company history, size or awards");
      expect(prompt).toContain("take one or two sentences together");
      // The old rule is gone.
      expect(prompt).not.toContain("NOT a company bio");
      expect(prompt).not.toContain("BAD example (generic company description)");
      expect(prompt).not.toContain("it is the physical or practical objective");
    }
    // A waived skeleton leaves the opening to the writer's preferences.
    expect(buildSection242SystemPrompt(waive("reportSkeleton"))).not.toContain(SECTION_242_OPENING_RULES);
  });

  it("carries the plain opening through the analysis, QA and shortening (2026-10-19)", () => {
    expect(ANALYZER_SYSTEM_PROMPT).toContain(ANALYZER_COMPANY_AND_GOAL_CATEGORIES);
    expect(ANALYZER_SYSTEM_PROMPT).toContain("Who the company is and what it does, in one plain, high-level line");
    expect(ANALYZER_SYSTEM_PROMPT).not.toContain("Only include context relevant to the SR&ED project.");
    expect(buildQaSystemPrompt()).toContain(QA_LINE_242_OPENING_CHECK);
    expect(buildQaSystemPrompt(SHIPPED_DEFAULT)).toContain(QA_LINE_242_OPENING_CHECK);
    expect(buildQaSystemPrompt(waive("reportSkeleton"))).not.toContain(QA_LINE_242_OPENING_CHECK);
    expect(COMPRESSION_REQUEST.system).toContain(COMPRESSION_KEEPS_PLAIN_OPENING);
    for (const text of [
      SECTION_242_OPENING_RULES,
      ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
      QA_LINE_242_OPENING_CHECK,
      COMPRESSION_KEEPS_PLAIN_OPENING,
    ]) {
      expect(findDashConnectors(text)).toEqual([]);
      expect(text).not.toMatch(/[–—]/);
    }
  });
});

// 2026-09-01 amendment: reportSkeleton hands section architecture to the
// writer's own document; only the length budget and evidence rules survive.
describe("reportSkeleton waiver", () => {
  const skeletonWaived = waive("reportSkeleton");

  it("replaces the fixed paragraph roles in every section prompt", () => {
    const s242 = buildSection242SystemPrompt(skeletonWaived);
    expect(s242).toContain("## Section Architecture (writer-defined)");
    expect(s242).not.toContain("exactly 5 paragraphs");
    expect(s242).not.toContain("## Required Content");
    expect(s242).not.toContain("It MUST open with");

    const s244 = buildSection244SystemPrompt(skeletonWaived);
    expect(s244).toContain("## Section Architecture (writer-defined)");
    expect(s244).not.toContain("PROBLEM STATEMENT");
    expect(s244).not.toContain('This paragraph MUST open with: "It was hypothesized that if');

    const s246 = buildSection246SystemPrompt(skeletonWaived);
    expect(s246).toContain("## Section Architecture (writer-defined)");
    expect(s246).not.toContain("KNOWLEDGE FIRST, CAPABILITIES SECOND");
    expect(s246).not.toContain("Most advancement paragraphs MUST open with");
  });

  it("keeps the length budget and evidence rules locked", () => {
    for (const prompt of [
      buildSection242SystemPrompt(ALL_WAIVED),
      buildSection244SystemPrompt(ALL_WAIVED),
      buildSection246SystemPrompt(ALL_WAIVED),
    ]) {
      expect(prompt).toContain("stay within the length budget");
      expect(prompt).toContain("[GAP: ...] placeholder, never an invention");
      expect(prompt).toContain("NEVER hallucinate or fabricate technical details");
      expect(prompt).toContain("Do NOT fall back to a fixed paragraph count");
      // The waiver footer no longer asserts structure supremacy.
      expect(prompt).toContain("Only the length budget and the evidence rules");
      expect(prompt).not.toContain("section structure, paragraph roles, required content, length limits, and evidence rules) remains mandatory");
    }
  });

  it("other house-style toggles still govern their own blocks", () => {
    const prompt = buildSection242SystemPrompt(skeletonWaived);
    expect(prompt).toContain("BANNED WORDS AND PHRASES");
    expect(prompt).toContain("CRA KEYWORD VISIBILITY:");
    const both = buildSection242SystemPrompt(waive("reportSkeleton", "bannedWords"));
    expect(both).not.toContain("BANNED WORDS AND PHRASES");
  });

  it("QA prompt waives structure and positional checks", () => {
    const prompt = buildQaSystemPrompt(skeletonWaived);
    expect(prompt).toContain("### Structure Compliance: WAIVED");
    expect(prompt).toContain("### CRA Keyword Visibility Check: WAIVED");
    expect(prompt).not.toContain("Does Section 242 contain all 5 required paragraphs");
    expect(prompt).not.toContain("If not, flag and deduct 5 points from 242");
    // User absolute CAP-8 resolution supersedes the methodology waiver.
    expect(prompt).toContain("Substantive CRA methodology remains mandatory under every skeleton");
    // Faithfulness and prose checks survive.
    expect(prompt).toContain("### Faithfulness");
    expect(prompt).toContain("### Human Prose Check");
  });

  it("chat skeleton rules defer to the writer's architecture", () => {
    const rules = buildSectionStructureRules(skeletonWaived);
    expect(rules).toContain("SR&ED report architecture (writer-defined)");
    expect(rules).not.toContain("NEVER break this");
    expect(rules).not.toContain("(5 paragraphs)");
    expect(rules).toContain("CRA form length limit");
    const chat = buildChatSystemPromptV2(skeletonWaived);
    expect(chat).toContain("SR&ED report architecture (writer-defined)");
    expect(chat).not.toContain("SR&ED report skeleton (NEVER break this");
  });
});

describe("section 244 prompt", () => {
  it("waiving openingClauses keeps the if/then hypothesis contract", () => {
    const prompt = buildSection244SystemPrompt(waive("openingClauses"));
    expect(prompt).not.toContain(
      'This paragraph MUST open with: "It was hypothesized that if'
    );
    expect(prompt).toContain("if/then");
    expect(prompt).toContain("The hypothesis MUST be falsifiable");
  });

  it("waiving repetitionCaps drops the per-section phrase cap only", () => {
    const prompt = buildSection244SystemPrompt(waive("repetitionCaps"));
    expect(prompt).not.toContain("NO MORE THAN TWICE");
    expect(prompt).toContain("Demonstrate the systematic approach through the content itself");
    // Experimentation narrative arc is locked.
    expect(prompt).toContain("PROBLEM STATEMENT");
  });
});

describe("section 246 prompt", () => {
  it("waiving openingClauses keeps knowledge-first but frees the phrasing", () => {
    const prompt = buildSection246SystemPrompt(waive("openingClauses"));
    expect(prompt).not.toContain("Most advancement paragraphs MUST open with");
    expect(prompt).toContain("KNOWLEDGE FIRST, CAPABILITIES SECOND");
    expect(prompt).toContain("knowledge finding");
  });

  it("waiving paragraphDensity drops the P6 sentence cap", () => {
    expect(buildSection246SystemPrompt()).toContain("Keep it concise: 3-4 sentences maximum.");
    const prompt = buildSection246SystemPrompt(waive("paragraphDensity"));
    expect(prompt).not.toContain("3-4 sentences maximum");
  });

  it("waiving repetitionCaps drops the technological-uncertainty cap", () => {
    const prompt = buildSection246SystemPrompt(waive("repetitionCaps"));
    expect(prompt).not.toContain('Use the phrase "technological uncertainty" no more than 3 times');
  });
});

describe("QA system prompt", () => {
  it("deducts for missing openers under full enforcement", () => {
    expect(buildQaSystemPrompt()).toContain("If not, flag and deduct 5 points from 242");
  });

  it("judges structure by content coverage and order, never by paragraph count or position", () => {
    for (const prompt of [buildQaSystemPrompt(), buildQaSystemPrompt(SHIPPED_DEFAULT)]) {
      expect(prompt).toContain("Judge content coverage and order, never paragraph count.");
      expect(prompt).toContain("Do NOT deduct for the number of paragraphs");
      expect(prompt).toContain("Does Section 242 cover, in this order: company/context, goal/problem, passive uncertainties");
      expect(prompt).toContain("Identify them by their content, not their position.");
      expect(prompt).not.toContain("all 5 required paragraphs");
      expect(prompt).not.toContain("paragraphs 2, 3, and 4");
      expect(prompt).not.toContain("Paragraph 6");
      expect(prompt).not.toContain("paragraph 6");
      expect(prompt).not.toContain("fewer than 2/3");
      expect(prompt).not.toMatch(/Does paragraph \d/);
      // Methodology checks survive, now keyed on roles.
      expect(prompt).toContain("### Passive vs. Active Uncertainty Check");
      expect(prompt).toContain("### Hypothesis Specificity Check");
      expect(prompt).toContain("### Experimentation Narrative Arc Check");
      expect(prompt).toContain("### Knowledge vs. Capability Check");
    }
  });

  it("waiving openingClauses swaps deductions for a content-only check", () => {
    const prompt = buildQaSystemPrompt(waive("openingClauses"));
    expect(prompt).not.toContain("If not, flag and deduct 5 points from 242");
    expect(prompt).toContain("WAIVED");
    expect(prompt).toContain("Still verify the underlying CONTENT is present");
    // Locked scoring sections survive.
    expect(prompt).toContain("### Structure Compliance");
    expect(prompt).toContain("### Knowledge vs. Capability Check");
    expect(prompt).toContain("### Hypothesis Specificity Check");
  });

  it("waiving bannedWords and repetitionCaps disables those flags", () => {
    const prompt = buildQaSystemPrompt(waive("bannedWords", "repetitionCaps"));
    expect(prompt).toContain("BANNED-WORD SCANNING IS WAIVED");
    expect(prompt).toContain("REPETITION CAPS ARE WAIVED");
    expect(prompt).not.toContain("Identify any other phrase (not in the banned list) that appears 3+ times");
  });
});

describe("chat skeleton + system prompt", () => {
  it("waiving openingClauses removes the literal phrases but keeps the skeleton", () => {
    const rules = buildSectionStructureRules(waive("openingClauses"));
    expect(rules).not.toContain('P3 opens "The limitations to standard practice were..."');
    expect(rules).not.toContain('opens "It was hypothesized that if..."');
    expect(rules).toContain("Line 242: Scientific/Technological Uncertainty**: company context (one plain sentence on who the company is) → goal/problem (the business goal in plain words, then the context that makes the work credible) → passive uncertainties");
    expect(rules).toContain("never impose or restore a paragraph count");
    expect(rules).not.toContain("(5 paragraphs)");
    expect(rules).not.toContain("≈6 paragraphs");
    expect(rules).not.toContain("≥2 open");
    expect(rules).toContain('each needs a "because" clause');
    expect(rules).toContain("Never blur the two");
  });

  it("chat prompt embeds the override-aware rules", () => {
    const prompt = buildChatSystemPromptV2(waive("bannedWords"));
    expect(prompt).not.toContain("BANNED WORDS AND PHRASES");
    expect(prompt).toContain("HOUSE-RULE WAIVERS:");
    expect(prompt).toContain("SR&ED report skeleton (NEVER break this");
  });
});

/**
 * Story 5 (CAP-12 to CAP-15): the chat prompt is half of every contract the
 * tools enforce. If the prompt and `convex/lib/completionReport.ts` disagree on
 * the status names, or the prompt forgets a tool, the writer sees the drift as a
 * dropped item.
 */
describe("chat prompt: tools, Completion Report and the converge guard", () => {
  const prompt = buildChatSystemPromptV2();

  it("names every chat tool the agent registers", () => {
    for (const tool of [
      "proposeEdit",
      "proposeReplacements",
      "proposeBulkEdits",
      "deviationInventory",
      "compareReferencePd",
      "highlightPassages",
      "searchBrain",
      "searchWeb",
      "readDocument",
      "searchDocuments",
      "readTranscript",
    ]) {
      expect(prompt, tool).toContain(tool);
    }
    // Both new tools are read only and say so.
    expect(prompt).toContain("call the matching read-only tool FIRST");
  });

  // Chat parity Phase B (2026-10-20): the reading lines of the lane.
  it("says the reading tools open what the evidence lacks, within one reply's allowance", () => {
    expect(prompt).toContain("the project files and transcripts you open in this reply with readDocument, searchDocuments, readTranscript or viewFile, and the files the writer pinned to the message.");
    expect(prompt).toContain("the lists of the project's files and transcripts");
    expect(prompt).toContain("Call no edit tool. When the answer needs a file or transcript the evidence does not show, open it first");
    expect(prompt).toContain(
      `one reply may read about ${CHAT_READ_MAX_TURN_CHARS.toLocaleString("en-US")} characters in all`
    );
    expect(prompt).toContain("Never tell the writer you read or checked something you did not open in this reply.");
    const readingLines = prompt.split("\n").filter((line) => /readDocument|reading tool|files and transcripts/.test(line));
    expect(readingLines.length).toBeGreaterThanOrEqual(4);
    for (const line of readingLines) {
      expect(findDashConnectors(line)).toEqual([]);
      expect(line).not.toMatch(/[\u2010-\u2015\u2212]/);
    }
  });

  // 2026-10-19 (first): a long list is revised one Line per reply, and the
  // assistant never claims to have read a file it cannot see.
  it("revises a long deviation list one Line per reply and names what it cannot see", () => {
    expect(prompt).toContain("work one Line per reply whenever the list holds more than 8 Deviations or spans more than one Line");
    expect(prompt).toContain("call deviationInventory with section set to the first Line");
    expect(prompt).toContain("are unverified, not Deviations");
    // Rule 8 as Phase B (2026-10-20) rewrote it, whole sentences only.
    expect(CHAT_EVIDENCE_GUIDANCE).toContain(
      "You can see only what is inside these blocks, what you open in this reply and the files the writer pinned to this message."
    );
    expect(CHAT_EVIDENCE_GUIDANCE).toContain(
      "Never say you checked, read or compared a file you cannot see or did not open in this reply,"
    );
    expect(CHAT_EVIDENCE_GUIDANCE).not.toContain("Never say you checked, read or compared a file you cannot see, and");
  });

  // Phase B (2026-10-20) and review R1 P3-3 and its test gap: the reading
  // guidance, and the analysis bullet that no longer contradicts it.
  it("lets a client turn opened in this reply back a claim, and says what is not kept", () => {
    expect(CHAT_EVIDENCE_GUIDANCE).toContain(
      "Do not exceed it, with one exception: a client's own words in a transcript turn you opened in this reply also back a claim. Where neither supports a claim, write a clearly marked [GAP: what is needed] instead of inventing."
    );
    expect(CHAT_EVIDENCE_GUIDANCE).not.toContain("Do not exceed it. Where it does not support a claim");
    expect(CHAT_EVIDENCE_GUIDANCE).toContain("Only the client's words back a claim about the company's work.");
    expect(CHAT_EVIDENCE_GUIDANCE).toContain(
      "It stays with you for this reply only: text opened in an earlier reply is not kept, so open it again when you need it."
    );
    expect(CHAT_EVIDENCE_GUIDANCE).toContain("A file with no text can be seen only with viewFile, when the files list says viewFile can show it.");
    expect(CHAT_EVIDENCE_GUIDANCE).toContain("Quote sparingly: a short phrase that settles a point, never long passages.");
    expect(findDashConnectors(CHAT_EVIDENCE_GUIDANCE)).toEqual([]);
  });

  // 2026-10-01 (first) and its review P2-2: a large revision is split into
  // calls of about 600 words, at most 3 per reply, blocked and conflicting
  // items first, so a turn's 5 steps hold the inventory, the calls and the
  // closing reply.
  it("tells the model to split a large revision within one reply's budget", () => {
    expect(BULK_EDIT_SIZE_RULE).toContain("at most about 600 words of new text across its edits");
    expect(BULK_EDIT_SIZE_RULE).toContain("Put every blocked and conflicting item in the first call");
    expect(BULK_EDIT_SIZE_RULE).toContain("Make at most 3 proposeBulkEdits calls in one reply.");
    // Phase A (2026-10-19): the writer continues from a button, and the
    // reply does not retype the ids the card already shows. Owner direction
    // 2026-10-21: the reply never tells the writer to say continue.
    expect(BULK_EDIT_SIZE_RULE).toContain(
      "If items are still left after that, say in one sentence how many are left and in which Lines, then stop. Do not tell the writer to say continue or how to move on."
    );
    expect(BULK_EDIT_SIZE_RULE).not.toContain("ask you to continue");
    expect(BULK_EDIT_SIZE_RULE).not.toContain("name their ids");
    expect(prompt).toContain(`when they fit in one call. ${BULK_EDIT_SIZE_RULE} ${BULK_EDIT_REFINE_RULE}`);
    // PR #24 round 2: a bulk card applies as a whole, so a refinement
    // re-proposes the whole set.
    expect(BULK_EDIT_REFINE_RULE).toBe(
      "A proposeBulkEdits card applies as a whole. To change part of an earlier pending proposeBulkEdits card in this conversation, propose its whole set again as one card: the unchanged passages plus the changed one, so the newest card carries every passage."
    );
    expect(prompt).not.toContain("Gather ALL affected passages into ONE coordinated proposal");
    expect(prompt).not.toContain("in one pass");
  });

  it("carries the three Completion Report statuses and no old status word", () => {
    for (const status of ["resolved", "blocked", "conflicting"]) {
      expect(prompt, status).toContain(status);
    }
    expect(prompt).toContain(
      "The Completion Report has exactly three statuses per item, resolved, blocked and conflicting"
    );
    // The PR #8 vocabulary is gone as a STATUS. "Proposed" survives only as the
    // reply's opening word, and "propose" as the verb.
    for (const phrase of [
      'label covered findings "proposed"',
      "gap/conflict statuses",
      "the gaps/conflicts",
      "evidence gap or enforced-rule conflict",
      'status "gap"',
      'status "conflict"',
    ]) {
      expect(prompt, phrase).not.toContain(phrase);
    }
  });

  it("tells the model to record an all-blocked report with zero edits instead of a dummy edit (DW-135)", () => {
    expect(prompt).toContain("empty edits list");
    expect(prompt).toContain("never invent a dummy edit");
    // The zero-edit reply must not open with "Proposed": nothing was proposed.
    expect(prompt).toContain('begin the reply with "Nothing to apply"');
  });

  it("carries the CAP-14 no-writer-artifact guard and points at the open questions", () => {
    expect(prompt).toContain("## When the writer asks how to converge");
    expect(prompt).toContain("OPEN QUESTIONS FOR THE CLIENT");
    expect(prompt).toContain(
      "NEVER ask the writer to author or supply a settings document, a storyline, a claim exclusion list, a glossary, a confidence map or any other new artifact"
    );
    expect(prompt).toContain("maximum input converging may require");
  });

  it("carries the CAP-15 rule: paragraphs, never a score, and Locked breaches conflicting", () => {
    expect(prompt).toContain("Report differences per paragraph as x- items");
    expect(prompt).toContain("NEVER answer with a similarity score, a percentage or a grade");
    expect(prompt).toContain("is reported conflicting with the rule named and an alternative offered, never applied");
  });

  it("states that the read-only branch beats the plain-question branch", () => {
    // Without this, "how does this draft differ from last year's PD?" is a
    // question, (a) says call no tool, and the comparison never runs.
    expect(prompt).toContain("Precedence when two of these fit: (d) beats (a).");
    expect(prompt).toContain("call the read-only tool named in (d) first");
    expect(prompt).toContain("(a) is for every OTHER question");
    // And a change request still routes to an edit tool.
    expect(prompt).toContain("(b) still wins over (d)");
  });

  it("tells the model to reuse the inventory ids verbatim", () => {
    expect(prompt).toContain("Use its ids verbatim as the finding ids");
    expect(prompt).toContain("never renumber them");
  });

  // Phase A (2026-10-19, CAP-13 change): the card shows the Completion
  // Report checklist, so the reply summarizes instead of retyping it.
  it("leaves the Completion Report checklist to the card", () => {
    expect(prompt).toContain(
      "For a bulk revision, the card also shows the writer its Completion Report checklist, which names each item by its Line and paragraph with its status and reason, so do not repeat the checklist: say in a sentence or two what the proposal covers and which items need the writer's decision."
    );
    expect(prompt).not.toContain("every item's original ID");
    expect(prompt).toContain("leave the checklist to the card");
    expect(prompt).not.toContain("include the Completion Report checklist returned by each proposeBulkEdits call verbatim");
    expect(prompt).not.toContain("keep the checklist");
    expect(prompt).not.toContain("ask the writer to say continue");
    expect(prompt).toContain(
      'The app continues a long job by itself, or the writer presses the Continue button under your reply; either way the message is "Continue with Line N.": read it as the same request for Line N.'
    );
    // Review P3-1: no rule promises a button that may not appear.
    expect(BULK_EDIT_SIZE_RULE).not.toContain("Continue button");
    // Review P2-2 and round 2 N1: marked items are skipped by default, and
    // the writer's message can reopen them; a refine re-proposes the whole set.
    expect(prompt).toContain("that still has unmarked Deviations");
    // Round 3 P3-B and P3-C: skipping means out of the edits and the
    // findings, and a reopened item's Line goes first.
    expect(prompt).toContain(
      "Skip marked items by default: leave them out of the edits and the findings, unless the writer's message reopens one, and revise the unmarked ones."
    );
    expect(prompt).toContain("A reopened item's Line comes first.");
    expect(prompt).toContain(
      "Revise a marked item when the writer's message reopens it: they supply the missing fact or make the decision it waits on, ask to refine its card, or ask for it to be redone."
    );
    expect(prompt).toContain("When refining a pending proposeBulkEdits card, propose its whole set again, marked items included.");
    expect(prompt).not.toContain("never propose a HANDLED item again");
  });

  // Owner direction 2026-10-21: a reply named "r-244-4-2" and ended with
  // "say 'continue' for Line 244". Ids stay in tool calls only, and the app
  // moves on by itself.
  it("keeps item ids out of the reply and names items by Line and paragraph", () => {
    expect(prompt).toContain(
      "Item ids (such as r-244-4-2, c-242-1-1 or x-246-3-1) are internal: never write one in a reply. Keep using them in tool calls, where proposeBulkEdits findings reuse the ids deviationInventory and compareReferencePd gave. In the reply, refer to an item by its Line and paragraph and briefly what it is about"
    );
    // The tool calls still reuse the inventory ids.
    expect(prompt).toContain("Use its ids verbatim as the finding ids");
    expect(prompt).toContain("Preserve the list and its ids in your tool calls");
  });

  it("never asks the writer to say continue", () => {
    expect(prompt).toContain(
      'Never ask the writer to say or type "continue", and never explain how to move on. The app starts the next Line by itself, or shows a Continue button when it cannot. You may say what comes next, for example "Line 244 is next."'
    );
    expect(prompt).not.toContain("ask you to continue");
    expect(prompt).not.toContain("ask me to continue");
  });

  // Phase A (2026-10-19): both outside-source tools are always offered and
  // enforce the per-message option in their bodies.
  it("says searchBrain and searchWeb search nothing when their option is off", () => {
    expect(prompt).toContain(
      "searchBrain searches only when the writer turned on Brain examples for this message; otherwise it searches nothing and says so."
    );
    expect(prompt).toContain(
      "searchWeb searches only when web search is on in this conversation; otherwise it searches nothing and says so."
    );
    expect(prompt).toContain('they can turn on "Use Brain examples for this message" in Message options');
    expect(prompt).not.toContain("searchBrain is available only when");
    expect(prompt).not.toContain("searchWeb is available only when");
  });
});

// 2026-09-15 owner decision: the default skeleton mandates content coverage
// and order, never a paragraph count or numbered paragraph roles; the
// mandated opening clauses are off for everyone unless an admin turns them on.
describe("2026-09-15 re-tiering: no paragraph counts, openers off by default", () => {
  const COUNT_MANDATES = [
    /exactly \d+ paragraphs?/i,
    /\*\*Paragraphs? \d/,
    /Paragraphs? \d+;/,
    /≈\d+ paragraphs/,
    /≥\d+ open/,
    /\d+ of the \d+ advancement paragraphs/,
    /paragraphs 2, 3,? and 4/i,
    /SELF-CHECK FOR PARAGRAPHS/,
    /fewer than \d+ (distinct experiments|advancements)/,
  ];

  it("the shipped default waives openers only", () => {
    expect(SHIPPED_DEFAULT).toEqual({ ...NO_STYLE_OVERRIDES, openingClauses: true });
  });

  it("no default section or QA prompt carries a paragraph-count or numbered-paragraph mandate", () => {
    for (const overrides of [NO_STYLE_OVERRIDES, SHIPPED_DEFAULT, ALL_HOUSE_STYLE_WAIVED]) {
      for (const [name, prompt] of [
        ["242", buildSection242SystemPrompt(overrides)],
        ["244", buildSection244SystemPrompt(overrides)],
        ["246", buildSection246SystemPrompt(overrides)],
        ["qa", buildQaSystemPrompt(overrides)],
        ["chat", buildChatSystemPromptV2(overrides)],
      ] as const) {
        for (const pattern of COUNT_MANDATES) {
          expect(prompt, `${name}: ${pattern}`).not.toMatch(pattern);
        }
      }
    }
  });

  it("default prompts keep the role lists in order, the passive/active rule and the content rules", () => {
    for (const overrides of [NO_STYLE_OVERRIDES, SHIPPED_DEFAULT]) {
      const s242 = buildSection242SystemPrompt(overrides);
      expect(s242).toContain(
        "Line 242 must cover, in this order: company context, goal/problem, limitations of standard practice (passive uncertainties), technological objective, active uncertainties."
      );
      expect(s242).toContain("Use as many paragraphs as the material warrants");
      expect(s242).toContain("a role may share a paragraph with its neighbour or span more than one");
      for (const role of [
        "**COMPANY/CONTEXT:**",
        "**GOAL/PROBLEM:**",
        "**PASSIVE TECHNOLOGICAL UNCERTAINTIES/LIMITATIONS:**",
        "**TECHNOLOGICAL OBJECTIVE:**",
        "**ACTIVE TECHNOLOGICAL UNCERTAINTIES:**",
      ]) {
        expect(s242).toContain(role);
      }
      expect(s242).toContain("CRITICAL DISTINCTION between passive and active uncertainties");
      expect(s242).toContain("The BECAUSE clause is what makes an uncertainty credible");
      expect(s242).toContain("The first clause is CONCEPTUAL");
      expect(s242).toContain("Respond with ONLY the paragraphs of text.");

      const s244 = buildSection244SystemPrompt(overrides);
      expect(s244).toContain(
        "Line 244 must cover, in this order: prior-year status (only for a continuing project), workplan, hypothesis, experimentation/iterations."
      );
      expect(s244).toContain("**HYPOTHESIS:**");
      expect(s244).toContain("strict if/then structure");
      expect(s244).toContain("The THEN clause MUST contain at least one concrete, measurable outcome");
      expect(s244).toContain("**EXPERIMENTATION/ITERATIONS:**");
      expect(s244).toContain("Write one experimentation paragraph per distinct experiment or iteration the source material supports");
      for (const element of ["PROBLEM STATEMENT", "INITIAL APPROACH", "WHAT WENT WRONG OR WAS LEARNED", "REVISED APPROACH", "CONCLUSION"]) {
        expect(s244).toContain(element);
      }
      expect(s244).toContain("never pad to a count, and never invent experiments");

      const s246 = buildSection246SystemPrompt(overrides);
      expect(s246).toContain(
        "Line 246 must cover, in this order: overall advancement to science/technology, the specific technological advancements (one per resolved uncertainty), project status and next steps, project goal and improvements."
      );
      expect(s246).toContain("KNOWLEDGE FIRST, CAPABILITIES SECOND");
      expect(s246).toContain("SELF-CHECK FOR EVERY ADVANCEMENT PARAGRAPH");
      expect(s246).toContain("**TECHNOLOGICAL ADVANCEMENTS (one paragraph per resolved uncertainty):**");
      expect(s246).toContain("one per advancement it supports, never padded to a count");
      expect(s246).toContain("**PROJECT GOAL & IMPROVEMENTS:**");
    }
  });

  it("with no stored house-style row, every prompt waives the openers but keeps the content", () => {
    const shared = buildSharedWritingRules(SHIPPED_DEFAULT);
    expect(shared).not.toContain("CRA KEYWORD VISIBILITY:");
    expect(shared).toContain("HOUSE-RULE WAIVERS:");
    expect(shared).toContain("mandated opening clauses");

    const s242 = buildSection242SystemPrompt(SHIPPED_DEFAULT);
    expect(s242).not.toContain('It MUST open with: "The limitations to standard practice were that..."');
    expect(s242).not.toContain('This paragraph MUST open with: "The technological objective was to');
    expect(s242).toContain("direct statement of the limitations to standard practice");
    expect(s242).toContain("both clauses must appear");

    const s244 = buildSection244SystemPrompt(SHIPPED_DEFAULT);
    expect(s244).not.toContain('This paragraph MUST open with: "It was hypothesized that if');
    expect(s244).toContain("strict if/then form");

    const s246 = buildSection246SystemPrompt(SHIPPED_DEFAULT);
    expect(s246).not.toContain("Most advancement paragraphs MUST open with");
    expect(s246).toContain("Every advancement paragraph MUST open with the knowledge finding itself");

    const qa = buildQaSystemPrompt(SHIPPED_DEFAULT);
    expect(qa).not.toContain("If not, flag and deduct 5 points from 242");
    expect(qa).toContain("Still verify the underlying CONTENT is present");
    expect(qa).toContain("Identify each by its content, not its position.");

    const chat = buildSectionStructureRules(SHIPPED_DEFAULT);
    expect(chat).toContain("the literal opening phrases are not required");
    expect(chat).not.toContain('opens "The limitations to standard practice were..."');
  });

  it("an explicit enforced row restores the literal openers everywhere", () => {
    const enforced = resolveEffectiveOverrides(
      normalizeHouseRuleModes({ openingClauses: "enforced" }),
      normalizeStyleOverrides({ openingClauses: true })
    );
    expect(enforced.openingClauses).toBe(false);
    expect(buildSharedWritingRules(enforced)).toContain("CRA KEYWORD VISIBILITY:");
    expect(buildSection242SystemPrompt(enforced)).toContain(
      'It MUST open with: "The limitations to standard practice were that..."'
    );
    expect(buildSection244SystemPrompt(enforced)).toContain(
      'This paragraph MUST open with: "It was hypothesized that if'
    );
    expect(buildSection246SystemPrompt(enforced)).toContain(
      "Most advancement paragraphs MUST open with"
    );
    expect(buildQaSystemPrompt(enforced)).toContain("If not, flag and deduct 5 points from 242");
    expect(buildQaSystemPrompt(enforced)).toContain("If most advancement paragraphs FAIL, deduct 5 points from 246");
    expect(buildSectionStructureRules(enforced)).toContain(
      'opens "The limitations to standard practice were..."'
    );
  });

  it("the writer-defined (reportSkeleton) branches no longer claim the default has fixed counts", () => {
    for (const prompt of [
      buildSection242SystemPrompt(waive("reportSkeleton")),
      buildQaSystemPrompt(waive("reportSkeleton")),
      buildSectionStructureRules(waive("reportSkeleton")),
    ]) {
      expect(prompt).not.toMatch(/(P3|P5|paragraphs 2, 3, and 4)/);
    }
  });
});

describe("prompt dash hygiene", () => {
  // The prompts ban em dashes; they must not model the banned form themselves.
  // The only permitted hits are the labelled examples inside RULES_HUMAN_PROSE.
  it("section, QA, and chat prompts contain no dash connectors beyond the HUMAN PROSE examples", () => {
    const allowed = findDashConnectors(RULES_HUMAN_PROSE).length;
    for (const prompt of [
      buildSection242SystemPrompt(),
      buildSection244SystemPrompt(),
      buildSection246SystemPrompt(),
      buildQaSystemPrompt(),
      buildChatSystemPromptV2(),
      buildSharedWritingRules(waive("bannedWords", "sentenceConstruction", "repetitionCaps", "paragraphDensity", "openingClauses")),
      buildSection242SystemPrompt(ALL_WAIVED),
      buildSection244SystemPrompt(ALL_WAIVED),
      buildSection246SystemPrompt(ALL_WAIVED),
      buildQaSystemPrompt(ALL_WAIVED),
      buildChatSystemPromptV2(ALL_WAIVED),
    ]) {
      expect(findDashConnectors(prompt.replace(RULES_HUMAN_PROSE, "")).map((h) => h.context)).toEqual([]);
      expect(findDashConnectors(prompt).length).toBeLessThanOrEqual(allowed);
    }
  });
});

describe("copy skills reach every writing path (dashfix + copywriting, owner 2026-09-23)", () => {
  // Every path that writes text a person reads gets the shared rules; Seeds
  // get the one-sentence-safe variant. None may model a dash in its own text.
  const ruled: Array<[string, string]> = [
    ["compression", COMPRESSION_REQUEST.system],
    ["brief", BRIEF_SYSTEM_PROMPT],
    ["self-check", SELF_CHECK_SYSTEM_PROMPT],
    ["summary self-check", SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT],
    ["consistency", CONSISTENCY_SYSTEM_PROMPT],
    ["pd review", PD_REVIEW_SYSTEM_PROMPT],
    ["chronology", CHRONOLOGY_SYSTEM_PROMPT],
    ["qa", buildQaSystemPrompt()],
  ];

  it.each(ruled)("%s carries RULES_HUMAN_PROSE and no dash of its own", (_name, prompt) => {
    expect(prompt).toContain(RULES_HUMAN_PROSE);
    expect(findDashConnectors(prompt.replace(RULES_HUMAN_PROSE, "")).map((hit) => hit.context)).toEqual([]);
  });

  it("the Seed system prompt carries the Seed wording rules, with or without waivers", () => {
    for (const overrides of [{}, { bannedWords: true, sentenceConstruction: true }]) {
      const prompt = buildSeedSystemPrompt(overrides);
      expect(prompt).toContain(RULES_SEED_WORDING);
      expect(findDashConnectors(prompt)).toEqual([]);
    }
  });
});

describe("the analyzer keeps figures with their group and adds no qualifier (2026-10-04 second, review round 1, P2-4 (a))", () => {
  it("reads the figure rules once, among its Critical Rules, in plain words", () => {
    expect(ANALYZER_SYSTEM_PROMPT.split(RULES_ANALYSIS_FIGURES)).toHaveLength(2);
    const rules = ANALYZER_SYSTEM_PROMPT.indexOf("## Critical Rules");
    const output = ANALYZER_SYSTEM_PROMPT.indexOf("## Output Format");
    const at = ANALYZER_SYSTEM_PROMPT.indexOf(RULES_ANALYSIS_FIGURES);
    expect(at).toBeGreaterThan(rules);
    expect(at).toBeLessThan(output);
    expect(ANALYZER_SYSTEM_PROMPT).toContain(
      "- If the transcript is vague on a topic, flag it as a gap rather than filling in assumptions.\n" + RULES_ANALYSIS_FIGURES + "\n- For software projects:"
    );
    expect(findDashConnectors(RULES_ANALYSIS_FIGURES)).toEqual([]);
    expect(RULES_ANALYSIS_FIGURES).toContain("keep each group's figure with its count, and mark a figure over all groups as over all groups");
    expect(RULES_ANALYSIS_FIGURES).toContain('no "typically X", "and/or X" or "such as X" from your own knowledge');
    // Round 2 (owner approved 2026-10-05): run 4's analysis still merged what
    // standard powder needs with what the datasheets cover.
    expect(RULES_ANALYSIS_FIGURES).toContain(
      "- Keep statements about different things apart. What one material or process needs, and what a datasheet, supplier or standard covers, are separate statements: never merge them into one claim. Example: if a source says standard glue needs high heat on glass, and that the supplier's sheet is written for thin flat boards, do not write that the sheet is written for glass boards."
    );
    // No fixture term in the rule. Round 2: "datasheet" is the owner's own
    // general wording for the kind of statement to keep apart.
    for (const term of ["deep cove", "steel", "mdf", "powder", "13 percent"]) {
      expect(RULES_ANALYSIS_FIGURES.toLowerCase()).not.toContain(term);
    }
  });

  it("keeps the analysis size limits and the shorter-analysis retry as they were", () => {
    expect(ANALYZER_REQUEST.maxTokens).toBe(16_000);
    expect(ANALYZER_REQUEST.shorterRetryNote).toContain("keep each text field to three sentences or fewer");
    expect(ANALYZER_REQUEST.shorterRetryNote).toContain("give at most 8 experiments or iterations");
  });
});
