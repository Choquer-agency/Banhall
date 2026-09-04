import { describe, expect, it } from "vitest";
import {
  buildSharedWritingRules,
  buildSection242SystemPrompt,
  buildSection244SystemPrompt,
  buildSection246SystemPrompt,
  buildQaSystemPrompt,
  buildSectionStructureRules,
  buildChatSystemPromptV2,
  waivedCategoryLabels,
} from "./prompts";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  normalizeStyleOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { findDashConnectors, RULES_HUMAN_PROSE } from "../../shared/humanProse";

// PSOS-49: prompt assembly under per-writer house-style waivers. A waived
// category's rule text must be OMITTED (conflict resolved before the prompt),
// while every CRA-compliance rule survives all waiver combinations.

const waive = (...keys: Array<keyof StyleOverrides>): StyleOverrides =>
  normalizeStyleOverrides(Object.fromEntries(keys.map((k) => [k, true])));

const ALL_WAIVED = waive(...STYLE_OVERRIDE_KEYS);
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
  it("mandates literal openers by default", () => {
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
    expect(allWaived).toContain("exactly 5 paragraphs");
    expect(allWaived).toContain("CRITICAL DISTINCTION between Paragraph 3 and Paragraph 5");
    expect(allWaived).toContain("The BECAUSE clause is what makes an uncertainty credible");
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
    expect(s242).not.toContain("## Paragraph Structure");
    expect(s242).not.toContain("It MUST open with");

    const s244 = buildSection244SystemPrompt(skeletonWaived);
    expect(s244).toContain("## Section Architecture (writer-defined)");
    expect(s244).not.toContain("PROBLEM STATEMENT");
    expect(s244).not.toContain('This paragraph MUST open with: "It was hypothesized that if');

    const s246 = buildSection246SystemPrompt(skeletonWaived);
    expect(s246).toContain("## Section Architecture (writer-defined)");
    expect(s246).not.toContain("KNOWLEDGE FIRST, CAPABILITIES SECOND");
    expect(s246).not.toContain("At least 2 of the 3 advancement paragraphs");
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
    expect(prompt).not.toContain("At least 2 of the 3 advancement paragraphs MUST open with");
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
  it("deducts for missing openers by default", () => {
    expect(buildQaSystemPrompt()).toContain("If not, flag and deduct 5 points from 242");
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
    expect(rules).toContain("Line 242: Scientific/Technological Uncertainty** (5 paragraphs)");
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
