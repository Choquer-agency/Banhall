/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  normalizeHouseRuleModes,
  resolveEffectiveOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { GENERAL_FACTUAL_ARGUMENT_RULE, LOCKED_RULES, RULES_GENERAL, RULES_REPORT_SKELETON } from "../../shared/houseRules";
import { RULES_EVIDENCE_KINDS, findDashConnectors } from "../../shared/humanProse";
import { PD_SUBSECTIONS, pdSubsectionStepSubtitle } from "../../shared/pdSubsections";
import {
  ANALYZER_IMPLIED_LABEL,
  ANALYZER_SYSTEM_PROMPT,
  CHAT_ADVANCEMENT_STATUS,
  CHAT_EXPERIMENT_ORDER,
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
import { FACTS_GOAL_AS_RESULT, ORDERED_PROMPT_SCAFFOLDS, gapsAlreadyAskedBlock } from "./promptDefinitions";
import { factsMatchSourcesInstruction } from "./selfCheck";
import { checkBannedWords, checkBecauseClauses } from "./qaChecks";
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
      "1. Name the standard approach or approaches a competent practitioner would reach for first, and say briefly what each does well."
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
      expect(prompt).toContain('scanning for the words "because" or "given that" in each uncertainty statement');
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
