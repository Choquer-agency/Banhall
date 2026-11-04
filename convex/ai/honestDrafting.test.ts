/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  normalizeHouseRuleModes,
  resolveEffectiveOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import {
  GENERAL_FACTUAL_ARGUMENT_RULE,
  LOCKED_RULES,
  RULES_CRA_OPENERS,
  RULES_GENERAL,
  RULES_REPORT_SKELETON,
} from "../../shared/houseRules";
import { GENERAL_PRACTICE_SCOPE, RULES_EVIDENCE_KINDS, findDashConnectors } from "../../shared/humanProse";
import { PD_SUBSECTIONS, pdSubsectionStepSubtitle } from "../../shared/pdSubsections";
import {
  ANALYZER_IMPLIED_LABEL,
  ANALYZER_SYSTEM_PROMPT,
  CHAT_ADVANCEMENT_STATUS,
  CHAT_EXPERIMENT_ORDER,
  CHAT_LIMITS_AT_EXPORT,
  CHAT_NOTHING_LEARNED,
  CHAT_RETRY_WHEN,
  QA_246_OPENING_NOTE,
  QA_NOTHING_LEARNED_YET,
  QA_WAIVED_OPENERS_NOTHING_LEARNED,
  SECTION_242_GENERAL_PRACTICE_ALLOWED,
  SECTION_246_NO_RESULT,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_SELF_CHECK_EXCEPTION,
  SECTION_EVIDENCE_POINTER,
  CHAT_HYPOTHESIS_THEN,
  CHAT_STANDARD_APPROACH,
  QA_EXPERIMENT_ARC_CHECK,
  QA_GAPS_ONCE,
  QA_GOAL_AS_RESULT_CHECK,
  QA_HONEST_GAP_RULE,
  QA_HYPOTHESIS_CHECK,
  QA_SOURCE_EVIDENCE_ITEM,
  QA_SOURCE_FAITHFULNESS,
  QA_STANDARD_APPROACH_CHECK,
  SECTION_242_CAUSE_FIRST,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_244_EXPERIMENT_RULES,
  SECTION_244_HYPOTHESIS_RULES,
  SECTION_244_YEAR_END_CLOSE,
  SECTION_246_ADVANCEMENT_RULES,
  SECTION_246_GOAL_CLOSE,
  SECTION_246_OVERALL_ADVANCEMENT,
  SELF_CHECK_GOAL_AS_RESULT_RULE,
  SELF_CHECK_SYSTEM_PROMPT,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  buildChatSystemPromptV2,
  buildQaSystemPrompt,
  buildSection242Instructions,
  buildSection244Instructions,
  buildSection246Instructions,
  buildSectionStructureRules,
  buildSharedWritingRules,
} from "./prompts";
import {
  COMPRESSION_LIMITS_AT_EXPORT,
  COMPRESSION_REQUEST,
  FACTS_GOAL_AS_RESULT,
  ORDERED_PROMPT_SCAFFOLDS,
  gapsAlreadyAskedBlock,
} from "./promptDefinitions";
import { compressToFit, compressWithinLimit, compressionTargetWords, finalCutTargetWords } from "./pipeline";
import {
  GENERATION_LIMIT_ALLOWANCE,
  generationCeiling,
  overGenerationCeiling,
  sectionMetrics,
} from "../lib/lineLimits";
import { draftingLineLimits } from "../lib/writerLineCap";
import { LOCKED_WITHIN_ALLOWANCE } from "../lib/selfCheckRules";
import { factsMatchSourcesInstruction } from "./selfCheck";
import { checkBannedWords, checkBecauseClauses, checkCRAOpeners } from "./qaChecks";
import { QA_REQUEST, qaSourceEvidenceBlock, runQAAgent } from "./qaAgent";
import { draftedPriorSectionsBlock } from "./orderedGeneration";
import { priorSectionsBlock } from "./iterative";
import type { GenerationClient } from "./openrouterCore";
import type { TranscriptAnalysis } from "./analyzerAgent";
import {
  HONEST_DRAFTING_ADDITIONS,
  HONEST_DRAFTING_SWAPS,
  PINNED_GENERAL_PERSUASIVE_RULE,
  withoutHonestDraftingText,
} from "../honestDrafting.fixture";
import { decisionFixture } from "../seedDecision.fixture";
import { internal } from "../_generated/api";
import { SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES } from "../lib/seedRevisions";

/**
 * 2026-10-29 (third, owner: "Yes relax the rule", and "Sure" to items 3, 4
 * and 5): the older drafting rules no longer push a fixed story shape the
 * evidence may not give, QA no longer rewards invention, QA reads the
 * source, and a later Line asks no client question an earlier one asked.
 * The wording follows the firm's 16 approved Brain PDs; every example here
 * and in the prompts is fictional.
 */

const SHIPPED_DEFAULT = resolveEffectiveOverrides(normalizeHouseRuleModes(undefined), NO_STYLE_OVERRIDES);
const EVERY_BUILD: StyleOverrides[] = [
  NO_STYLE_OVERRIDES,
  SHIPPED_DEFAULT,
  ...STYLE_OVERRIDE_KEYS.map((key) => ({ ...NO_STYLE_OVERRIDES, [key]: true })),
];
const DEFAULT_BUILDS = EVERY_BUILD.filter((overrides) => !overrides.reportSkeleton);

/** Every new text this change sends, for the writing rules every prompt follows. */
const NEW_TEXTS = {
  GENERAL_FACTUAL_ARGUMENT_RULE,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_242_CAUSE_FIRST,
  SECTION_244_HYPOTHESIS_RULES,
  SECTION_244_EXPERIMENT_RULES,
  SECTION_244_YEAR_END_CLOSE,
  SECTION_246_OVERALL_ADVANCEMENT,
  SECTION_246_ADVANCEMENT_RULES,
  SECTION_246_GOAL_CLOSE,
  QA_HYPOTHESIS_CHECK,
  QA_EXPERIMENT_ARC_CHECK,
  QA_STANDARD_APPROACH_CHECK,
  QA_SOURCE_FAITHFULNESS,
  QA_SOURCE_EVIDENCE_ITEM,
  QA_GOAL_AS_RESULT_CHECK,
  QA_HONEST_GAP_RULE,
  QA_GAPS_ONCE,
  SELF_CHECK_GOAL_AS_RESULT_RULE,
  FACTS_GOAL_AS_RESULT,
  CHAT_STANDARD_APPROACH,
  CHAT_HYPOTHESIS_THEN,
  CHAT_EXPERIMENT_ORDER,
  CHAT_ADVANCEMENT_STATUS,
  RULES_EVIDENCE_KINDS,
  RULES_REPORT_SKELETON,
  GENERAL_PRACTICE_SCOPE,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_SELF_CHECK_EXCEPTION,
  QA_NOTHING_LEARNED_YET,
  QA_WAIVED_OPENERS_NOTHING_LEARNED,
  QA_246_OPENING_NOTE,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_242_GENERAL_PRACTICE_ALLOWED,
  lockedLengthLimits: LOCKED_RULES[0]!.summary,
  CHAT_NOTHING_LEARNED,
  CHAT_RETRY_WHEN,
  SECTION_EVIDENCE_POINTER,
  gapsAsked: JSON.stringify(ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.gapsAsked),
  sourceScaffold: JSON.stringify(QA_REQUEST.sourceScaffold),
} as const;

describe("the new wording follows the writing rules", () => {
  it("uses no dash connector and, outside the Bad examples, no banned word", () => {
    for (const [name, text] of Object.entries(NEW_TEXTS)) {
      expect([name, findDashConnectors(text)]).toEqual([name, []]);
      expect([name, text]).not.toEqual([name, expect.stringMatching(/[–—]/)]);
      expect([name, checkBannedWords(text, "", "").found.map((hit) => hit.word)]).toEqual([name, []]);
    }
  });
});

describe("house rules: a factual record, not a persuasive essay (1e)", () => {
  it("replaces the PERSUASIVE ESSAY line in GENERAL RULES, for every writer", () => {
    expect(GENERAL_FACTUAL_ARGUMENT_RULE).toBe(
      "- Write a factual technical record for a CRA reviewer: specific, measured, and candid about failures and open questions. The case is made by specifics, not adjectives, and never by claims the evidence does not support."
    );
    expect(RULES_GENERAL.split("\n")[1]).toBe(GENERAL_FACTUAL_ARGUMENT_RULE);
    expect(RULES_GENERAL).not.toContain("PERSUASIVE");
    expect(RULES_GENERAL).not.toContain("Every sentence must serve the SR&ED argument");
    for (const overrides of EVERY_BUILD) {
      expect(buildSharedWritingRules(overrides)).toContain(GENERAL_FACTUAL_ARGUMENT_RULE);
      expect(buildSharedWritingRules(overrides)).not.toContain("PERSUASIVE");
    }
    expect(buildChatSystemPromptV2()).toContain(GENERAL_FACTUAL_ARGUMENT_RULE);
  });

  it("says so on the House Rules page, under the same Locked title stored analyses name", () => {
    const rule = LOCKED_RULES.find((entry) => entry.title === "Formal prose and evidence discipline");
    expect(rule?.summary).toContain("A factual technical record for a CRA reviewer");
    expect(rule?.summary).toContain("No bullet points or numbered lists");
    expect(LOCKED_RULES.map((entry) => entry.title)).toEqual([
      "CRA form length limits",
      "No fabrication",
      "Formal prose and evidence discipline",
      "Human prose: plain hyphens and plain language",
      "Voice consistency in mandated-opener paragraphs",
    ]);
  });

  it("the report skeleton the admin page shows follows the relaxed rules", () => {
    expect(RULES_REPORT_SKELETON).toContain("the standard approaches, what they do and why they fall short here");
    expect(RULES_REPORT_SKELETON).toContain("a number only from the evidence");
    expect(RULES_REPORT_SKELETON).toContain("as far as the evidence shows");
    expect(RULES_REPORT_SKELETON).toContain("each with its status only as the evidence shows");
    expect(RULES_REPORT_SKELETON).not.toContain("measurable then-clause");
    expect(RULES_REPORT_SKELETON).not.toContain("finding → adaptation");
  });
});

describe("Line 244 experiments: the story's order where the evidence gives it (1a)", () => {
  it("drops the five-element mandate and the QA threat, and asks for one gap per paragraph", () => {
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection244Instructions(overrides);
      expect(prompt).toContain(SECTION_244_EXPERIMENT_RULES);
      expect(prompt).not.toContain("ALL five elements");
      expect(prompt).not.toContain("will be flagged by QA");
      expect(prompt).not.toContain("They must have tension");
      expect(prompt).not.toContain("WHAT WENT WRONG OR WAS LEARNED");
      expect(prompt).toContain(SECTION_244_YEAR_END_CLOSE);
    }
    expect(SECTION_244_EXPERIMENT_RULES).toContain("Tell each experiment in order, as far as the evidence goes:");
    expect(SECTION_244_EXPERIMENT_RULES).toContain(
      "A failure, a surprise or a change of approach belongs in a paragraph only where the evidence shows one; never invent one to complete the story."
    );
    expect(SECTION_244_EXPERIMENT_RULES).toContain(
      "close the paragraph with ONE [GAP: ...] that names every missing step together. Never write a sentence frame for each missing step."
    );
    expect(SECTION_244_EXPERIMENT_RULES).toContain("let one experiment run across consecutive paragraphs");
    expect(SECTION_244_EXPERIMENT_RULES).toContain("A confirmation of a predicted challenge, a comparison between options with the choice made and why, an observation phase, or work still in progress is reported as that.");
    // The gap-frame Bad example is the rerun's own pattern.
    expect(SECTION_244_EXPERIMENT_RULES).toContain('BAD (a frame for each missing step): "The outcome of the early runs was [GAP: the outcome]. Changes made in response were [GAP: the changes]."');
    // The Good example with no outcome holds exactly one gap.
    const missing = SECTION_244_EXPERIMENT_RULES.split("\n").find((line) => line.startsWith('"The team ran the controller with a 30-second step'));
    expect(missing?.match(/\[GAP:/g)).toHaveLength(1);
  });

  it("a writer-defined skeleton is unchanged", () => {
    const prompt = buildSection244Instructions({ ...NO_STYLE_OVERRIDES, reportSkeleton: true });
    expect(prompt).not.toContain(SECTION_244_EXPERIMENT_RULES);
    expect(prompt).toContain("Do not invent experiments not present in the source material.");
  });
});

describe("the hypothesis: a measure only from the evidence (1c)", () => {
  it("accepts a prediction with its reason or an exploratory form, one per uncertainty", () => {
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection244Instructions(overrides);
      expect(prompt).toContain(SECTION_244_HYPOTHESIS_RULES);
      expect(prompt).not.toContain("The THEN clause MUST contain at least one concrete, measurable outcome");
      expect(prompt).not.toContain("specific measurable outcome related to the technological advancement");
      expect(prompt).toContain("[the expected outcome, or the knowledge sought]");
    }
    expect(SECTION_244_HYPOTHESIS_RULES).toContain("Write one hypothesis for each uncertainty from Line 242 that the work addressed");
    expect(SECTION_244_HYPOTHESIS_RULES).toContain("if [approach or condition], then [expected outcome], because [reason].");
    expect(SECTION_244_HYPOTHESIS_RULES).toContain("then [it would gain knowledge of how Y affects Z]");
    expect(SECTION_244_HYPOTHESIS_RULES).toContain("write [GAP: the measure or target that would show success]");
    expect(SECTION_244_HYPOTHESIS_RULES).toContain(
      "Never invent a test, a number or a threshold, and never tie a stated figure to a test the evidence does not describe"
    );
    expect(SECTION_244_HYPOTHESIS_RULES).toContain('BAD (an invented threshold):');
    // The emptiness test stays.
    expect(SECTION_244_HYPOTHESIS_RULES).toContain('If it says "then it would work" or "then the system would function as intended", the hypothesis is too vague.');
    // No Good example puts a number in the THEN clause.
    for (const line of SECTION_244_HYPOTHESIS_RULES.split("\n").filter((text) => text.startsWith('"It was hypothesized'))) {
      if (!line.includes("95 percent")) expect(line).not.toMatch(/\d/);
    }
  });

  it("QA accepts both forms and never deducts for a missing number or its gap", () => {
    for (const overrides of EVERY_BUILD) {
      const prompt = buildQaSystemPrompt(overrides);
      expect(prompt).toContain(QA_HYPOTHESIS_CHECK);
      expect(prompt).not.toContain("Does the THEN clause name a measurable outcome?");
    }
    expect(QA_HYPOTHESIS_CHECK).toContain("never deduct for its absence, or for a [GAP: ...] where the measure of success is missing");
    expect(QA_HYPOTHESIS_CHECK).toContain("Flag and deduct for a number, threshold or test the evidence does not give.");
  });

  it("the Assistant's skeleton asks for no measurable then-clause either", () => {
    for (const overrides of [NO_STYLE_OVERRIDES, SHIPPED_DEFAULT]) {
      const rules = buildSectionStructureRules(overrides);
      expect(rules).toContain(CHAT_HYPOTHESIS_THEN);
      expect(rules).toContain(CHAT_EXPERIMENT_ORDER);
      expect(rules).toContain(CHAT_ADVANCEMENT_STATUS);
      expect(rules).toContain(CHAT_STANDARD_APPROACH);
      expect(rules).not.toContain("measurable then-clause");
      expect(rules).not.toContain("revised approach → conclusion");
    }
  });
});

describe("QA's experiment check: no deduction for an honest gap (1b)", () => {
  it("flags only an invented step, or no outcome where the evidence has one", () => {
    for (const overrides of EVERY_BUILD) {
      const prompt = buildQaSystemPrompt(overrides);
      expect(prompt).toContain(`### Experimentation Narrative Arc Check (Section 244 only)\n${QA_EXPERIMENT_ARC_CHECK}`);
      expect(prompt).not.toContain("an unexpected finding or failure, a revised approach");
      expect(prompt).not.toContain("flat description without tension or adaptation");
    }
    expect(QA_EXPERIMENT_ARC_CHECK).toContain(
      "Flag and deduct only for a step the evidence does not describe (an invented failure, surprise, change or result), or for a paragraph that reports no outcome where the evidence gives one."
    );
    expect(QA_EXPERIMENT_ARC_CHECK).toContain("never deduct for a step a [GAP: ...] marks as missing from the evidence.");
    expect(QA_EXPERIMENT_ARC_CHECK).toContain("Never flag a missing surprise or change of approach");
  });
});

describe("Line 246: status as the evidence shows, a goal is not a result (1d)", () => {
  it("drops the per-paragraph template and the proven or disproven opening", () => {
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection246Instructions(overrides);
      expect(prompt).not.toContain('2. "This resolved the uncertainty regarding..." (TIE BACK TO 242)');
      expect(prompt).not.toContain('3. "This knowledge was applied to..."');
      expect(prompt).not.toContain("proven, disproven, or partially proven");
      expect(prompt).not.toContain("how reality differed from our expectations");
      expect(prompt).toContain(SECTION_246_OVERALL_ADVANCEMENT);
      expect(prompt).toContain(SECTION_246_ADVANCEMENT_RULES);
      expect(prompt).toContain(SECTION_246_GOAL_CLOSE);
      expect(prompt).toContain("KNOWLEDGE FIRST, CAPABILITIES SECOND");
    }
    expect(SECTION_246_OVERALL_ADVANCEMENT).toContain(
      '"The technological advancement achieved in the field of [field] was knowledge gained in methods for [what the work taught]."'
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("resolved, resolved for the conditions tested, partially resolved, or unresolved");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(
      'A stated purpose or design intent ("to ensure...", "designed to...", "so that...") is a goal, not a result: never write it as achieved.'
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("Never build a paragraph from gap frames");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain('BAD (a paragraph built from gap frames):');
    expect(SECTION_246_GOAL_CLOSE).toContain("the one place to say how the knowledge was applied: say it once here, not in every paragraph");
  });
});

describe("Line 242: the standard approach and why it falls short (3)", () => {
  it("teaches the standard approach, its shortfall and what that means for knowledge, never a bare claim", () => {
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection242Instructions(overrides);
      expect(prompt).toContain(SECTION_242_STANDARD_APPROACH_RULES);
      expect(prompt).toContain(SECTION_242_CAUSE_FIRST);
      // The old taught phrases are gone, apart from the rule against them and the Bad example.
      expect(prompt).not.toContain('- "No documented methods existed for..."');
      expect(prompt).not.toContain('- "The knowledge required to [X] was insufficient..."');
      expect(prompt).not.toContain("as no documented methods or training data existed");
      // The knowledge-gap versus product-gap teaching stays.
      expect(prompt).toContain('"Am I describing what people don\'t KNOW, or what products can\'t DO?"');
      expect(prompt).toContain("Every limitation must reference the knowledge gap, not the tool gap.");
    }
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(
      // 2026-10-30, review round 1 (wording P3-9): what each does well, as the evidence states it.
      "1. Name the standard approach or approaches a competent practitioner would reach for first, and say briefly what each does well, as the evidence states it; for general practice, only what it is and where it is used."
    );
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain("[INFERRED: general practice, not in the source: what the writer should confirm with the client]");
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain("Never say or suggest that the company tried a standard approach unless the evidence says so.");
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain("The uncertainty never rests on simply using a standard mechanism.");
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain('Never write a bare "no documented methods existed for..."');
    expect(SECTION_242_CAUSE_FIRST).toContain('"Because [cause], it was uncertain whether [X] could [Y] without [Z]."');
  });

  it("the evidence rule allows general practice, marked, and nothing more of the model's own", () => {
    expect(RULES_EVIDENCE_KINDS).toContain("- General practice is the one use of your own knowledge.");
    expect(RULES_EVIDENCE_KINDS).toContain("[INFERRED: general practice, not in the source: what the writer should confirm with the client]");
    expect(RULES_EVIDENCE_KINDS).toContain("never say or suggest that the company tried it unless the evidence says so");
    expect(RULES_EVIDENCE_KINDS).toContain("- Events are never inferred.");
    expect(RULES_EVIDENCE_KINDS).toContain('Good, where the evidence names no standard approach: "Cold-room controllers commonly hold temperature');
    expect(RULES_EVIDENCE_KINDS).toContain('Bad: "No documented method existed for holding a cold room at its setpoint while its doors stay open."');
    expect(RULES_EVIDENCE_KINDS).toContain('Bad: "The team first tried the standard setpoint tables.');
  });

  it("QA reads the standard approach and its shortfall as knowledge language, and flags a bare claim", () => {
    for (const overrides of EVERY_BUILD) {
      const prompt = buildQaSystemPrompt(overrides);
      expect(prompt).toContain(QA_STANDARD_APPROACH_CHECK);
      expect(prompt).not.toContain('Phrases like "no documented methods existed for X", "no established approaches for X"');
      // 2026-10-30, after the live rerun (R6b): and a gap or a cause in the next sentence.
      expect(prompt).toContain(
        'scanning for the words "because" or "given that" (or a [GAP: ...] that asks why, in it or right after it, or a next sentence that opens "Because", "This is because", "This was because" or "Given that") in each uncertainty statement'
      );
    }
    expect(QA_STANDARD_APPROACH_CHECK).toContain('Flag a limitation that is only a bare claim ("no documented methods existed for X")');
    expect(QA_STANDARD_APPROACH_CHECK).toContain("marked [INFERRED: general practice, not in the source: ...], is allowed");
  });

  it("the BECAUSE scan accepts a cause given first", () => {
    const text = "Given that the dock doors stay open, it was uncertain whether a fixed step could hold the room. It was uncertain whether the probes drift.";
    expect(checkBecauseClauses(text).details.map((detail) => detail.hasBecause)).toEqual([true, false]);
    expect(checkBecauseClauses("Because the doors stay open, it was uncertain whether the room holds.").withBecause).toBe(1);
    // A word that only holds the letters is not a cause.
    expect(checkBecauseClauses("It was uncertain whether becausewise tables hold.").withBecause).toBe(0);
  });
});

describe("the analysis states, and labels what is only implied (1f)", () => {
  it("labels implied items, leaves results empty and keeps a goal out of the results", () => {
    expect(ANALYZER_SYSTEM_PROMPT).not.toContain("strongly implied");
    expect(ANALYZER_SYSTEM_PROMPT).toContain(`begin it with "${ANALYZER_IMPLIED_LABEL}"`);
    expect(ANALYZER_SYSTEM_PROMPT).toContain("Leave results and conclusions empty when the transcript gives none.");
    expect(ANALYZER_SYSTEM_PROMPT).toContain('A stated purpose or design intent ("to ensure...", "designed to...", "so that...") is a goal, never a result or a conclusion.');
    expect(ANALYZER_SYSTEM_PROMPT).toContain("An empty list when it reports none: a goal or a purpose is not an advancement.");
    expect(ANALYZER_SYSTEM_PROMPT).toContain("never infer an event (a trial, test, result, finding, first approach or change of approach) the transcript does not describe");
    expect(ANALYZER_IMPLIED_LABEL).toBe("Implied, not stated: ");
  });

  it("the drafter marks an implied entry or leaves it out", () => {
    expect(RULES_EVIDENCE_KINDS).toContain(
      `- An entry of the transcript analysis that begins "${ANALYZER_IMPLIED_LABEL.trim()}" is an inference, not a stated fact: write it as an inference and mark it, or leave it out.`
    );
  });
});

describe("a goal written as a result is flagged by every check (1g)", () => {
  it("the Self-check, in both modes", () => {
    for (const prompt of [SELF_CHECK_SYSTEM_PROMPT, SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT]) {
      expect(prompt.split(SELF_CHECK_GOAL_AS_RESULT_RULE)).toHaveLength(2);
    }
    expect(SELF_CHECK_GOAL_AS_RESULT_RULE).toContain("written as a result already achieved is not allowed, and neither is a test, trial or result the evidence does not describe, marked or not.");
  });

  it("the facts check, with every document read or not", () => {
    for (const complete of [true, false]) {
      expect(factsMatchSourcesInstruction(complete).split(FACTS_GOAL_AS_RESULT)).toHaveLength(2);
    }
    expect(FACTS_GOAL_AS_RESULT).toContain("that the section writes as a result already achieved is a finding");
    expect(FACTS_GOAL_AS_RESULT).toContain("So is a test, trial or result the sources do not describe, marked or not");
  });

  it("QA, under every build", () => {
    for (const overrides of EVERY_BUILD) {
      const prompt = buildQaSystemPrompt(overrides);
      expect(prompt.split(QA_GOAL_AS_RESULT_CHECK)).toHaveLength(2);
      expect(prompt.split(QA_HONEST_GAP_RULE)).toHaveLength(2);
    }
  });
});

describe("QA reads the source evidence (4)", () => {
  const analysis = { company_context: "A fictional cold-storage controls maker" } as unknown as TranscriptAnalysis;
  const evidence = {
    documents: [
      { label: "INTERVIEW TRANSCRIPT: Interview", content: "The dock doors stay open for most of a shift." },
      { label: "SCOPING NOTES: plan.md (excerpt 1 of 2)", content: "The controller is designed to recover its setpoint." },
    ],
    leftOut: [{ label: "OTHER SUPPORTING MATERIAL: old.md", bytes: 90_000 }],
    readInPart: [{ label: "SCOPING NOTES: plan.md", bytes: 60_000, sent: 4_000, matched: true as const }],
    budget: SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES,
  };

  it("names the source evidence and checks claims against it first", () => {
    for (const overrides of EVERY_BUILD) {
      const prompt = buildQaSystemPrompt(overrides);
      expect(prompt).toContain(`4. The drafted Section 246 (Scientific/Technological Advancement)${QA_SOURCE_EVIDENCE_ITEM}\n`);
      expect(prompt).toContain(`### Faithfulness\n${QA_SOURCE_FAITHFULNESS}\n`);
      expect(prompt).toContain(`- For each gap, formulate a specific follow-up question.${QA_GAPS_ONCE}`);
    }
    expect(QA_HONEST_GAP_RULE).toContain("A [GAP: ...] where the evidence lacks the fact is honest, never a defect: no deduction for it, here or in any other check.");
  });

  it("renders each document, then what it read in part and left out; nothing without documents", () => {
    const block = qaSourceEvidenceBlock(evidence);
    expect(block).toBe(
      `${QA_REQUEST.sourceScaffold.heading}\n[INTERVIEW TRANSCRIPT: Interview]\nThe dock doors stay open for most of a shift.\n\n[SCOPING NOTES: plan.md (excerpt 1 of 2)]\nThe controller is designed to recover its setpoint.` +
        `\n\nRead only in part, over QA's 48000-byte budget: SCOPING NOTES: plan.md (4000 of 60000 bytes).` +
        `\n\nLeft out, over QA's 48000-byte budget: OTHER SUPPORTING MATERIAL: old.md (90000 bytes).`
    );
    expect(qaSourceEvidenceBlock(null)).toBe("");
    expect(qaSourceEvidenceBlock(undefined)).toBe("");
    expect(qaSourceEvidenceBlock({ documents: [], leftOut: evidence.leftOut, budget: 48_000 })).toBe("");
  });

  async function qaUser(sourceEvidence?: typeof evidence): Promise<string> {
    const create = vi.fn(async () => ({
      content: [{ type: "tool_use", id: "t", name: QA_REQUEST.toolName, input: { overall_score: 80, section_scores: {} } }],
      stop_reason: "tool_use",
    }));
    const client = { messages: { create } } as unknown as GenerationClient;
    await runQAAgent(client, analysis, "Line 242 text.", "Line 244 text.", "Line 246 text.", "claude-sonnet-5", undefined, undefined, null, sourceEvidence);
    const params = (create.mock.calls[0] as unknown as [{ messages: Array<{ content: unknown }> }])[0];
    const content = params.messages[0]!.content;
    return JSON.stringify(content);
  }

  it("sends the block after the checks and before the analysis, and nothing more without it", async () => {
    const withEvidence = await qaUser(evidence);
    const without = await qaUser();
    const heading = JSON.stringify(QA_REQUEST.sourceScaffold.heading).slice(1, -1);
    const analysisHeading = JSON.stringify(QA_REQUEST.userScaffold.analysisHeading).slice(1, -1);
    const at = withEvidence.indexOf(heading);
    expect(at).toBeGreaterThan(0);
    expect(withEvidence.indexOf(analysisHeading)).toBeGreaterThan(at);
    expect(without).not.toContain(heading);
    // Taking the block out gives the request without it.
    const block = JSON.stringify(qaSourceEvidenceBlock(evidence)).slice(1, -1);
    expect(withEvidence.replace(block, "")).toBe(without);
  });

  // Review round 1: one unreadable frozen row no longer costs QA every source.
  it("skips a frozen row whose text cannot be read, and names it as left out", async () => {
    const s = await decisionFixture();
    await s.t.run(async (ctx) => {
      await ctx.db.insert("generationSources", {
        generationId: s.generationId,
        projectId: s.projectId,
        kind: "project_document",
        label: "scoping_notes:lost.md",
        contentHash: "lost-hash",
        textLength: 1200,
        truncated: false,
        originalLength: 1200,
        capturedAt: 2,
      });
    });
    const read = await s.t.query(internal.generations.getQaSourceEvidence, {
      generationId: s.generationId,
      subjectTexts: ["The work and its evidence."],
    });
    expect(read).toEqual({
      documents: [{ label: "INTERVIEW TRANSCRIPT: Interview", content: "Evidence alpha supports the work." }],
      leftOut: [],
      budget: SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES,
      unreadable: [{ label: "SCOPING NOTES: lost.md" }],
    });
    // QA is told it was left out because it could not be read, not for the budget.
    expect(qaSourceEvidenceBlock(read)).toBe(
      `${QA_REQUEST.sourceScaffold.heading}\n[INTERVIEW TRANSCRIPT: Interview]\nEvidence alpha supports the work.\n\nLeft out, as their text could not be read: SCOPING NOTES: lost.md.`
    );
  });

  it("reads the frozen sources the way the facts check does", async () => {
    const s = await decisionFixture();
    const read = await s.t.query(internal.generations.getQaSourceEvidence, {
      generationId: s.generationId,
      subjectTexts: ["The work and its evidence."],
    });
    expect(read).toEqual({
      documents: [{ label: "INTERVIEW TRANSCRIPT: Interview", content: "Evidence alpha supports the work." }],
      leftOut: [],
      budget: SOURCE_DOCUMENTS_BUDGET_UTF8_BYTES,
    });
  });
});

describe("a later Line asks no question an earlier one asked (5)", () => {
  const priors = [
    { section: "242" as const, text: "The controller overshot. [GAP: how far the room drifted after a door opening]\n\nIt was uncertain whether. [INFERRED: the doors stay open]" },
    { section: "244" as const, text: "The team ran a shorter step. [GAP: what these runs showed]\n\nAgain. [GAP: How far  the room drifted after a door opening]" },
  ];

  it("lists each earlier gap once, in build order, with the rule; inferences are not questions", () => {
    const block = gapsAlreadyAskedBlock(priors.map((prior) => ({ title: `Line ${prior.section}`, text: prior.text })));
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.gapsAsked;
    expect(block).toBe(
      `${scaffold.prefix}- Line 242: how far the room drifted after a door opening\n- Line 244: what these runs showed${scaffold.rule}`
    );
    expect(scaffold.rule).toContain("Do not ask any of these again in this Line");
    expect(scaffold.rule).toContain("where several facts are missing together, ask for them in one gap");
  });

  it("is empty, and the earlier Lines block unchanged, when no earlier Line holds a gap", () => {
    expect(gapsAlreadyAskedBlock([{ title: "Line 242", text: "No gaps. [INFERRED: a note]" }])).toBe("");
    const plain = [{ section: "242" as const, text: "No gaps here." }];
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections;
    expect(draftedPriorSectionsBlock(plain)).toBe(`${scaffold.prefix}${scaffold.itemTitlePrefix}Line 242 (Uncertainty)${scaffold.itemTitleSuffix}No gaps here.`);
    expect(draftedPriorSectionsBlock([])).toBe("");
  });

  it("follows the earlier Lines in every ordered draft, its repair and Draft the rest, and in a legacy draft", () => {
    const ordered = draftedPriorSectionsBlock(priors);
    expect(ordered.endsWith(gapsAlreadyAskedBlock(priors.map((prior) => ({ title: prior.section === "242" ? "Line 242 (Uncertainty)" : "Line 244 (Work performed)", text: prior.text }))))).toBe(true);
    expect(ordered).toContain("- Line 242 (Uncertainty): how far the room drifted after a door opening");
    const legacy = priorSectionsBlock([{ section: "s242", text: priors[0]!.text }]);
    expect(legacy).toContain("how far the room drifted after a door opening");
    expect(legacy).toContain(ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.gapsAsked.rule);
  });
});

describe("Step-by-step Seeds ask for the same", () => {
  it("the Hypothesis, Experimentation and Specific advancements objectives and their subtitles", () => {
    const objective = (roleId: string) => PD_SUBSECTIONS.find((role) => role.roleId === roleId)!.objective;
    expect(objective("hypothesis")).toContain("with a measure only where the sources give one");
    expect(objective("hypothesis")).not.toContain("measured outcome");
    expect(objective("experimentation")).toContain("only as far as the sources show");
    expect(objective("specific_advancements")).toContain("for each uncertainty, and how far the sources show it was resolved");
    expect(pdSubsectionStepSubtitle("hypothesis")).not.toContain("measurable");
    expect(pdSubsectionStepSubtitle("experimentation")).toContain("what was learned or left open");
  });
});

describe("the pinned-request fixture", () => {
  it("puts back every changed text, and no addition holds another", () => {
    const additions = Object.values(HONEST_DRAFTING_ADDITIONS);
    expect(new Set(additions).size).toBe(additions.length);
    for (const one of additions) for (const other of additions) if (one !== other) expect(one.includes(other)).toBe(false);
    for (const [now] of HONEST_DRAFTING_SWAPS) expect(now.length).toBeGreaterThan(0);
    // The shared rules and the Assistant put back give the PERSUASIVE line.
    const restored = withoutHonestDraftingText(buildSharedWritingRules(), "draft");
    expect(restored).toContain(PINNED_GENERAL_PERSUASIVE_RULE);
    expect(restored).not.toContain(GENERAL_FACTUAL_ARGUMENT_RULE);
    // QA, put back, holds none of the new lines and the old checks again.
    const qa = withoutHonestDraftingText(buildQaSystemPrompt(), "qa");
    for (const text of [QA_GOAL_AS_RESULT_CHECK, QA_HONEST_GAP_RULE, QA_SOURCE_EVIDENCE_ITEM, QA_GAPS_ONCE, QA_EXPERIMENT_ARC_CHECK, QA_HYPOTHESIS_CHECK]) {
      expect(qa).not.toContain(text);
    }
    expect(qa).toContain("an unexpected finding or failure, a revised approach, and a conclusion?");
    expect(() => withoutHonestDraftingText(buildQaSystemPrompt(), "draft")).toThrow(/holds the honest drafting additions/);
    // A Line 244 draft put back holds the five elements again.
    expect(withoutHonestDraftingText(buildSection244Instructions(), "draft")).toContain("3. WHAT WENT WRONG OR WAS LEARNED (1-2 sentences)");
  });
});

describe("drafts may run over the CRA limits until export (7)", () => {
  /** `count` words in short sentences, one paragraph; no digit or negation. */
  const words = (count: number) =>
    `${Array.from({ length: count }, (_, index) => `word${String.fromCharCode(97 + (index % 26))}`).join(" ")}.`;
  /** A client that answers each compression request with the next text, then echoes nothing new. */
  function compressor(answers: string[]) {
    const queue = [...answers];
    const create = vi.fn(async () => ({
      content: [{ type: "text", text: queue.shift() ?? "" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const anthropic = { messages: { create } } as unknown as GenerationClient;
    return { create, anthropicFor: () => anthropic };
  }

  it("has one allowance, 20 percent, over each CRA limit", () => {
    expect(GENERATION_LIMIT_ALLOWANCE).toBe(0.2);
    expect(generationCeiling("s242")).toEqual({ wordCap: 420, lineLimit: 60 });
    expect(generationCeiling("s244")).toEqual({ wordCap: 840, lineLimit: 120 });
    expect(generationCeiling("s246")).toEqual({ wordCap: 420, lineLimit: 60 });
    expect(overGenerationCeiling({ words: 420, lines: 60 }, "s246")).toBe(false);
    expect(overGenerationCeiling({ words: 421, lines: 30 }, "s246")).toBe(true);
    expect(overGenerationCeiling({ words: 300, lines: 61 }, "s246")).toBe(true);
    // The writer's own cap stays; without one, the ceiling is the limit while drafting.
    expect(draftingLineLimits("s246", null)).toEqual({ wordCap: 420, lineLimit: 60 });
    expect(draftingLineLimits("s246", { words: 260 })).toEqual({ wordCap: 260, lineLimit: 60 });
    expect(draftingLineLimits("s246", { lines: 40 })).toEqual({ wordCap: 420, lineLimit: 40 });
  });

  it("does not compress a Line at 110 percent of its limit", async () => {
    const text = words(385);
    expect(sectionMetrics(text, "s246")).toMatchObject({ words: 385, overLimit: true });
    const run = compressor([]);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", text, "standard", undefined, [], [], { finalCut: true });
    expect(run.create).not.toHaveBeenCalled();
    expect(fit).toEqual({ text, passes: 0, overLimit: false });
    expect(await compressToFit(run.anthropicFor, "claude-sonnet-5", "s246", text, "standard")).toBe(text);
  });

  it("compresses a Line above 120 percent to under 120 percent, not down to the export limit", async () => {
    const text = words(480);
    const underCeiling = words(400);
    expect(overGenerationCeiling(sectionMetrics(text, "s246"), "s246")).toBe(true);
    const run = compressor([underCeiling]);
    const fit = await compressWithinLimit(run.anthropicFor, "claude-sonnet-5", "s246", text, "standard", undefined, [], [], { finalCut: true });
    // One pass, kept at 400 words: over the CRA limit, under the ceiling, so it stops.
    expect(run.create).toHaveBeenCalledTimes(1);
    expect(fit).toEqual({ text: underCeiling, passes: 1, overLimit: false });
    expect(sectionMetrics(fit.text, "s246").overLimit).toBe(true);
    // The pass aims at the lower of the length budget and 85 percent of the
    // ceiling, and names the ceiling after the CRA limits.
    expect(compressionTargetWords("s246", "standard")).toBe(337);
    expect(compressionTargetWords("s244", "standard")).toBe(673);
    // Review round 1: a concise or full length choice still sets the aim, under the ceiling.
    expect(compressionTargetWords("s246", "concise")).toBe(268);
    expect(compressionTargetWords("s246", "full")).toBe(350);
    expect(compressionTargetWords("s244", "full")).toBe(700);
    expect(finalCutTargetWords("s246", { words: 440, lines: 40 })).toBe(399);
    const params = (run.create.mock.calls[0] as unknown as [{ system: string; messages: Array<{ content: string }> }])[0];
    expect(params.messages[0]!.content).toContain(
      "and at most 350 words, which it must meet before export. While drafting it may run up to 20 percent over them, to 60 lines and 420 words, and it is over that. Rewrite it to AT MOST 337 words"
    );
    expect(params.system).toContain(COMPRESSION_LIMITS_AT_EXPORT);
    expect(COMPRESSION_REQUEST.system).not.toContain("cannot be filed");
  });

  it("names the drafting allowance in the Locked row (convex/sectionLengthLimit.sdk.test.ts runs it)", () => {
    expect(LOCKED_WITHIN_ALLOWANCE).toBe("over the CRA limit but within the drafting allowance");
  });

  it("the Assistant says the limits apply at export", () => {
    const prompt = buildChatSystemPromptV2();
    expect(prompt).toContain(CHAT_LIMITS_AT_EXPORT);
    expect(CHAT_LIMITS_AT_EXPORT).toBe(
      " Both apply at export: a Line over either one must be trimmed to fit before it is exported. While drafting, a Line may run over them, up to 20 percent, to get its point across."
    );
    expect(prompt).not.toContain("cannot be filed");
    for (const text of [CHAT_LIMITS_AT_EXPORT, COMPRESSION_LIMITS_AT_EXPORT, LOCKED_WITHIN_ALLOWANCE]) {
      expect(findDashConnectors(text)).toEqual([]);
    }
  });
});

describe("review round 1 of the third amendment", () => {
  it("P2-1: Line 246 opens an uncertainty with nothing learned yet with its status and one gap, never an invented finding", () => {
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection246Instructions(overrides);
      expect(prompt).toContain(SECTION_246_NOTHING_LEARNED_YET);
      expect(prompt).toContain(`Every paragraph must lead with knowledge or understanding gained${SECTION_246_KNOWLEDGE_FIRST_EXCEPTION}.`);
      expect(prompt).toContain(`not the claim itself.${SECTION_246_SELF_CHECK_EXCEPTION}`);
    }
    // 2026-10-30 (owner, item 3) replaces this exception: an uncertainty with
    // no result gets no paragraph of its own (convex/ai/oneUncertainty.test.ts).
    expect(SECTION_246_NOTHING_LEARNED_YET).toContain("this opening rule does not apply: it gets no advancement paragraph");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(
      "GOOD (the evidence reports no result for any uncertainty, so this is the opening paragraph):"
    );
    for (const overrides of [NO_STYLE_OVERRIDES, SHIPPED_DEFAULT]) {
      expect(buildSectionStructureRules(overrides)).toContain(`${CHAT_NOTHING_LEARNED})`);
    }
    for (const overrides of EVERY_BUILD) {
      expect(buildQaSystemPrompt(overrides).split(QA_NOTHING_LEARNED_YET)).toHaveLength(2);
    }
    // The content check QA runs with the opening phrases waived (the shipped
    // default) takes the same exception, and only there.
    expect(buildQaSystemPrompt(SHIPPED_DEFAULT)).toContain(
      `246 advancement paragraphs open with knowledge findings${QA_WAIVED_OPENERS_NOTHING_LEARNED}. Identify each by its content`
    );
    for (const overrides of EVERY_BUILD) {
      const waived = overrides.openingClauses && !overrides.reportSkeleton;
      expect(buildQaSystemPrompt(overrides).includes(QA_WAIVED_OPENERS_NOTHING_LEARNED)).toBe(Boolean(waived));
    }
  });

  it("P2-2: a general-practice sentence holds no fact about the project, in the rule, Line 242 and QA", () => {
    // 2026-10-30 (owner, item 3) narrows the scope further (convex/ai/oneUncertainty.test.ts); the project-fact rule stays.
    expect(GENERAL_PRACTICE_SCOPE).toContain(
      "Never put a fact about this project, its conditions or its work in a general-practice sentence."
    );
    expect(RULES_EVIDENCE_KINDS).toContain(GENERAL_PRACTICE_SCOPE);
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(GENERAL_PRACTICE_SCOPE);
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Bad: "Standard PID tuning assumes steady loads, and the company\'s lines switch products hourly. [INFERRED: general practice, not in the source: PID tuning is the usual method]"'
    );
    expect(QA_STANDARD_APPROACH_CHECK).toContain(
      "unless it says the company tried that practice and the evidence does not, or states a fact about this project the evidence does not give."
    );
  });

  it("P3-1 and P3-2: the pointer and the rule name what the instructions still ask for, and allow general practice", () => {
    expect(SECTION_EVIDENCE_POINTER).toContain("such as a step of an experiment, a result, a measure of success or a status");
    expect(SECTION_EVIDENCE_POINTER).toContain("(general practice in Line 242's limitations aside)");
    expect(SECTION_EVIDENCE_POINTER).not.toContain("an unexpected finding");
    expect(SECTION_EVIDENCE_POINTER).not.toContain("will be flagged");
    expect(RULES_EVIDENCE_KINDS).not.toContain("an unexpected finding");
    expect(RULES_EVIDENCE_KINDS).toContain("(general practice in Line 242's limitations aside). Never make it up to fill the shape.");
    for (const overrides of DEFAULT_BUILDS) {
      // Review round 2 (P3-E): without "below", since the writer's own
      // structure has no limitations rule after it.
      expect(buildSection242Instructions(overrides)).toContain(
        "Use ONLY the information provided (and well-known general practice, as the limitations rule allows)."
      );
    }
  });

  it("P3-3 and P3-4: the examples say what evidence they assume, and general practice falls short on a stated project fact", () => {
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Good, where the evidence names no standard approach: "Cold-room controllers commonly hold temperature with a feedback loop tuned for a closed room. [INFERRED: general practice, not in the source: confirm with the client which control methods the team knew of] The warehouse\'s dock doors stay open for most of a shift, which a loop tuned for a closed room does not allow for."'
    );
    expect(SECTION_244_EXPERIMENT_RULES).toContain("BAD (an invented finding and change, where the evidence is as in the second Good example):");
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain("GOOD (the evidence names both approaches;");
  });

  it("P3-5 and P3-6: QA's 246 checks name one uncertainty, and the opener options accept item 1d's opening", () => {
    for (const overrides of EVERY_BUILD) {
      expect(buildQaSystemPrompt(overrides)).not.toContain("one resolved uncertainty");
    }
    expect(buildQaSystemPrompt()).toContain(`NOTE: ${QA_246_OPENING_NOTE}`);
    expect(QA_246_OPENING_NOTE).toContain("SHOULD open with the advancement as knowledge gained in the field");
    expect(checkCRAOpeners("Overall.\n\nIn addressing the uncertainty around door loads, the company gained knowledge that a fixed step lags.").results[0]?.passes).toBe(true);
    expect(RULES_CRA_OPENERS).toContain('"Through systematic investigation, it was determined that..." or "In addressing the uncertainty around..."');
    expect(buildSection246Instructions(NO_STYLE_OVERRIDES)).toContain('or "In addressing the uncertainty around [X], ..."');
  });

  it("P3-7: a Hypothesis Seed takes one uncertainty, and the limitations Seed names the standard approach", () => {
    const objective = (roleId: string) => PD_SUBSECTIONS.find((role) => role.roleId === roleId)!.objective;
    expect(objective("hypothesis")).toContain("for one uncertainty the work addressed, in under 20 words");
    expect(objective("hypothesis")).toContain("so one can be picked for each");
    expect(objective("passive_limitations")).toBe(
      "Name the standard approach a practitioner would use, what it does, and why it falls short here: the limitation in existing knowledge before a solution was chosen."
    );
    expect(pdSubsectionStepSubtitle("passive_limitations")).toBe("The standard approach, what it does, and why it falls short here.");
  });

  it("plumbing P2: the Assistant sends a tighter card only when asked about length, or when an edit takes a Line over its drafting room", () => {
    const prompt = buildChatSystemPromptV2();
    expect(prompt.split(CHAT_RETRY_WHEN)).toHaveLength(4);
    expect(prompt).not.toContain("when its result shows the Line still over a CRA limit.");
    expect(prompt).not.toContain("Only if the result shows the Line still over a CRA limit");
  });

  it("plumbing P3: a redraft sends only the gap notes of a Line after it", () => {
    const later = [{ section: "246" as const, text: "Later text. [GAP: how many trials ran]" }];
    const block = draftedPriorSectionsBlock([], later);
    expect(block).toBe(gapsAlreadyAskedBlock([{ title: "Line 246 (Advancement)", text: later[0]!.text }]));
    expect(block).toContain("- Line 246 (Advancement): how many trials ran");
    expect(block).not.toContain("Later text.");
    expect(draftedPriorSectionsBlock([], [])).toBe("");
  });
});

describe("review round 2 of the third amendment", () => {
  it("P3-A: an uncertainty with no finding gets its status only as the evidence gives it, or a gap, in every place the exception is", () => {
    // 2026-10-30 (owner, item 3): the exception is now that such an
    // uncertainty gets no paragraph; the Line states the knowledge sought,
    // any finding and one gap, once (SECTION_246_NO_RESULT, tested in
    // convex/ai/oneUncertainty.test.ts). Still no invented status anywhere.
    expect(SECTION_246_NO_RESULT).toContain("then a single [GAP: ...] for whatever of their results and status the evidence does not give");
    expect(SECTION_246_NOTHING_LEARNED_YET).toContain("Where the evidence reports no result for an uncertainty, this opening rule does not apply");
    expect(SECTION_246_SELF_CHECK_EXCEPTION).toContain("never write one that leads with a finding the evidence does not give");
    expect(SECTION_246_KNOWLEDGE_FIRST_EXCEPTION).toContain("one paragraph states the knowledge sought, any observation the evidence states and a single [GAP: ...] instead");
    // No example status for the model to copy.
    expect(SECTION_246_NOTHING_LEARNED_YET).not.toContain("still in progress");
    // The paragraph rules ("states what was learned about it") take the same exception.
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(
      `Each paragraph names the uncertainty, states what was learned about it, and gives its status in plain words`
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(`[what remains open]."${SECTION_246_NO_FINDING_PARAGRAPH}\n\nClaim no more resolution`);
    expect(SECTION_246_NO_FINDING_PARAGRAPH).toContain(SECTION_246_NO_RESULT);
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection246Instructions(overrides);
      expect(prompt).toContain(SECTION_246_NOTHING_LEARNED_YET);
      expect(prompt).toContain(SECTION_246_NO_FINDING_PARAGRAPH);
      expect(prompt).toContain(SECTION_246_SELF_CHECK_EXCEPTION);
    }
  });

  it("P3-B: the line opens by restating the objective where nothing has been learned yet, and QA's note agrees", () => {
    // 2026-10-30 (owner, item 3): the opening is the knowledge sought, any finding and the Line's one gap.
    expect(SECTION_246_OVERALL_NOTHING_LEARNED).toContain(
      " Where the evidence reports no result for any uncertainty, write none of the above: open instead with the knowledge the work sought, then any observation the evidence states, then a single [GAP: ...] for whatever of the results and status the evidence does not give"
    );
    // 2026-10-30, review round 1 (wording P2-5): after the opening's other sentences, which it replaces.
    expect(SECTION_246_OVERALL_ADVANCEMENT).toContain(
      // Review round 3 (P2-2): no hypothesis gap in the opening; the Line's other gaps ask for it.
      `or in the paragraph for the uncertainties with no result, asks for it.${SECTION_246_OVERALL_NOTHING_LEARNED} This ties back`
    );
    expect(QA_246_OPENING_NOTE).toBe(
      "The opening paragraph of 246 SHOULD open with the advancement as knowledge gained in the field, or, where the evidence reports no result for any uncertainty, with the knowledge the work sought, then any observation the evidence states and a single [GAP: ...] for whatever of the results and status the evidence does not give. Do NOT apply the advancement-paragraph opener rule to it."
    );
  });

  it("P3-D: the report skeleton takes the no-finding exception, and the locked length rule applies at export", () => {
    // 2026-10-30 (owner, item 3): an uncertainty with no result gets no paragraph.
    expect(RULES_REPORT_SKELETON).toContain(
      "each with its status only as the evidence shows; the uncertainties with no result share one paragraph after them, or, when none has a result, that paragraph opens the Line in place of the overall advancement: what the work set out to learn, any observation the evidence states and a single gap for whatever of the results and status the evidence does not give"
    );
    const length = LOCKED_RULES.find((entry) => entry.title === "CRA form length limits");
    expect(length?.summary).toBe(
      "Line/word caps from the T661 form (50/100/50 lines); enforced at export; drafts may run up to 20% over."
    );
    expect(length?.summary).toContain(`${Math.round(GENERATION_LIMIT_ALLOWANCE * 100)}% over`);
    expect(length?.summary).not.toContain("compression");
  });

  it("P3-E: the writer's-own-structure build of Line 242 allows general practice too", () => {
    for (const overrides of EVERY_BUILD.filter((build) => build.reportSkeleton)) {
      expect(buildSection242Instructions(overrides)).toContain(
        "Use ONLY the information provided (and well-known general practice, as the limitations rule allows)."
      );
    }
    expect(SECTION_242_GENERAL_PRACTICE_ALLOWED).not.toContain("below");
  });
});
