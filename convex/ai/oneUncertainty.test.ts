/// <reference types="vite/client" />
import { describe, expect, it, vi } from "vitest";
import {
  NO_STYLE_OVERRIDES,
  STYLE_OVERRIDE_KEYS,
  normalizeHouseRuleModes,
  resolveEffectiveOverrides,
  type StyleOverrides,
} from "../../shared/styleOverrides";
import { RULES_REPORT_SKELETON } from "../../shared/houseRules";
import {
  ACRONYM_RULE,
  GENERAL_PRACTICE_SCOPE,
  RULES_EVIDENCE_KINDS,
  RULES_GAPS_NOT_FOR_RECORD_FACTS,
  RULES_HUMAN_PROSE,
  RULES_NO_NOTES_IN_REPORT_TEXT,
  RULES_SEED_WORDING,
  findDashConnectors,
} from "../../shared/humanProse";
import {
  ANALYZER_CHOSEN_UNCERTAINTIES,
  ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
  ANALYZER_GAPS_RULES,
  ANALYZER_SYSTEM_PROMPT,
  CHAT_NOTHING_LEARNED,
  CHAT_STANDARD_APPROACH,
  CLAIMANT_LINE,
  QA_246_OPENING_NOTE,
  QA_GAPS_ONCE,
  QA_NO_NOTES_IN_TEXT,
  QA_NOTHING_LEARNED_YET,
  QA_STANDARD_APPROACH_CHECK,
  QA_WAIVED_OPENERS_NOTHING_LEARNED,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_244_EXPERIMENT_RULES,
  SECTION_244_WORK_IN_FULL,
  SECTION_246_ADVANCEMENT_RULES,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_NO_RESULT,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_OVERALL_ADVANCEMENT,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_246_SELF_CHECK_EXCEPTION,
  SECTION_246_STATUS_NO_RESULT,
  SECTION_EVIDENCE_POINTER,
  SECTION_UNCERTAINTY_SCOPE,
  SELF_CHECK_NO_NOTES_RULE,
  SELF_CHECK_SYSTEM_PROMPT,
  SELF_CHECK_UNCERTAINTY_SCOPE_RULE,
  SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT,
  buildChatSystemPromptV2,
  buildQaSystemPrompt,
  buildSection242Instructions,
  buildSection244Instructions,
  buildSection246Instructions,
  buildSectionDraftRequest,
  buildSectionStructureRules,
  buildSharedWritingRules,
  claimantBlock,
  claimantLine,
} from "./prompts";
import { SELF_CHECK_REQUEST } from "./promptDefinitions";
import { buildSelfCheckUserMessage, reportUncertaintiesBody, type SelfCheckModelInput } from "./selfCheck";
import {
  NOTES_TO_WRITER,
  checkBannedWords,
  checkCRAOpeners,
  findNotesToWriter,
  sectionDeterministicFindings,
} from "./qaChecks";
import { QA_REQUEST, runQAAgent } from "./qaAgent";
import { buildSeedPrompt, buildTrustedContext } from "./trustedContext";
import { runSection242Agent } from "./section242Agent";
import { withPlaceholders } from "./placeholderClient";
import type { GenerationClient } from "./openrouterCore";
import type { TranscriptAnalysis } from "./analyzerAgent";
import { buildPlaceholderMap, pseudonymize, restorePlaceholders } from "../lib/deidentify";
import { claimantNameFor } from "../lib/transcriptPlaceholders";
import {
  NOTES_TO_WRITER_KEY,
  repairIssues,
  runDeterministicSelfCheck,
} from "../lib/selfCheckRules";
import type { OrderedProfileContext } from "../lib/orderedChain";
import {
  ONE_UNCERTAINTY_ADDITIONS,
  ONE_UNCERTAINTY_SWAPS,
  withoutOneUncertaintyText,
} from "../oneUncertainty.fixture";

/**
 * 2026-10-30 (owner, "please fix all properly"): one set of uncertainties
 * for all three Lines, the claimant named, Lines 242 and 246 tightened, no
 * notes to the writer in report text, and readable QA items (the last in
 * src/lib/qa/qaScorecard.test.ts). Every example here is fictional.
 */

const SHIPPED_DEFAULT = resolveEffectiveOverrides(normalizeHouseRuleModes(undefined), NO_STYLE_OVERRIDES);
const EVERY_BUILD: StyleOverrides[] = [
  NO_STYLE_OVERRIDES,
  SHIPPED_DEFAULT,
  ...STYLE_OVERRIDE_KEYS.map((key) => ({ ...NO_STYLE_OVERRIDES, [key]: true })),
];
const DEFAULT_BUILDS = EVERY_BUILD.filter((overrides) => !overrides.reportSkeleton);

const COMPANY = "Quillmere Analytics Ltd.";

/** Every new text this change sends, for the writing rules every prompt follows. */
const NEW_TEXTS = {
  ACRONYM_RULE,
  GENERAL_PRACTICE_SCOPE,
  RULES_NO_NOTES_IN_REPORT_TEXT,
  RULES_GAPS_NOT_FOR_RECORD_FACTS,
  ANALYZER_CHOSEN_UNCERTAINTIES,
  ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
  ANALYZER_GAPS_RULES,
  claimantLine: claimantLine(COMPANY),
  SECTION_UNCERTAINTY_SCOPE,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_244_WORK_IN_FULL,
  SECTION_246_NO_RESULT,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_SELF_CHECK_EXCEPTION,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_246_STATUS_NO_RESULT,
  SELF_CHECK_UNCERTAINTY_SCOPE_RULE,
  SELF_CHECK_NO_NOTES_RULE,
  QA_STANDARD_APPROACH_CHECK,
  QA_246_OPENING_NOTE,
  QA_NOTHING_LEARNED_YET,
  QA_WAIVED_OPENERS_NOTHING_LEARNED,
  QA_GAPS_ONCE,
  QA_NO_NOTES_IN_TEXT,
  CHAT_STANDARD_APPROACH,
  CHAT_NOTHING_LEARNED,
  RULES_REPORT_SKELETON,
  reportUncertainties: JSON.stringify(SELF_CHECK_REQUEST.reportUncertainties),
  notesToWriter: JSON.stringify(NOTES_TO_WRITER),
} as const;

describe("the new wording follows the writing rules", () => {
  it("uses no dash connector and no banned word", () => {
    for (const [name, text] of Object.entries(NEW_TEXTS)) {
      expect([name, findDashConnectors(text)]).toEqual([name, []]);
      expect([name, text]).not.toEqual([name, expect.stringMatching(/[–—]/)]);
      expect([name, checkBannedWords(text, "", "").found.map((hit) => hit.word)]).toEqual([name, []]);
    }
  });
  it("RULES_EVIDENCE_KINDS, with its new lines and examples, still uses no dash connector or banned word", () => {
    expect(findDashConnectors(RULES_EVIDENCE_KINDS)).toEqual([]);
    expect(checkBannedWords(RULES_EVIDENCE_KINDS, "", "").found).toEqual([]);
  });
});

// ─── Item 1: one set of uncertainties ───────────────────────────────────────

describe("one set of uncertainties for all three Lines (item 1)", () => {
  it("the analyzer chooses them once, from the writer's notes, and the rest of the analysis follows", () => {
    expect(ANALYZER_SYSTEM_PROMPT).toContain(
      `These describe challenges in achieving the technological objective.${ANALYZER_CHOSEN_UNCERTAINTIES}\n\n7. **technological_objective**`
    );
    expect(ANALYZER_CHOSEN_UNCERTAINTIES).toBe(
      `\n\n   passive_uncertainties and active_uncertainties are the report's uncertainties, chosen here once for all three Lines. When the writer's notes say which uncertainties the report covers, or how many (for example "one main uncertainty"), the two lists cover exactly those. When the notes give only a number, choose the ones the source gives the most evidence of investigation for. work_performed, advancements_achieved and remaining_uncertainties then cover only the chosen uncertainties. Another technical challenge the source names may appear only as part of the work on a chosen uncertainty, never as an uncertainty of its own. With no such note, list every uncertainty the source supports.`
    );
    expect(ANALYZER_SYSTEM_PROMPT.split(ANALYZER_CHOSEN_UNCERTAINTIES)).toHaveLength(2);
  });

  const requestOf = (contentPlanBlock: string) =>
    buildSectionDraftRequest({
      instructions: buildSection242Instructions(),
      analysisJson: "{}",
      brainExemplars: "\n\nBRAIN",
      lengthBudget: "\n\nBUDGET",
      styleGuidance: "",
      contentPlanBlock,
      briefBlock: "\n\nBRIEF",
    }).messages[0]!.content[1]!.text;

  it("every draft and repair with no signed-off plan says the analysis's lists are the report's uncertainties", () => {
    expect(SECTION_UNCERTAINTY_SCOPE).toBe(
      "\n\nThe report's uncertainties are the ones in the analysis's passive_uncertainties and active_uncertainties, chosen once for all three Lines. Write about those only: raise no other uncertainty, hypothesis or advancement from the source, even one the source discusses. Another technical challenge the source names may appear only as part of the work on one of them."
    );
    const task = requestOf("");
    expect(task).toContain(`${SECTION_EVIDENCE_POINTER}${SECTION_UNCERTAINTY_SCOPE}\n\nBRAIN\n\nBUDGET\n\nBRIEF`);
    expect(task.split(SECTION_UNCERTAINTY_SCOPE)).toHaveLength(2);
  });

  it("in Step by step and Summary mode the signed-off plan sets the scope, so the rule is not sent", () => {
    const task = requestOf("\n\n--- BEGIN [SIGNED-OFF CONTENT PLAN] ---\nplan\n--- END [SIGNED-OFF CONTENT PLAN] ---");
    expect(task).not.toContain(SECTION_UNCERTAINTY_SCOPE);
    expect(task).toContain(`${SECTION_EVIDENCE_POINTER}\n\nBRAIN`);
  });

  it("the Single draft and Compare Self-check fails a Line that raises another; the Summary Self-check is unchanged", () => {
    expect(SELF_CHECK_SYSTEM_PROMPT).toContain(SELF_CHECK_UNCERTAINTY_SCOPE_RULE);
    expect(SELF_CHECK_SYSTEM_PROMPT.split(SELF_CHECK_UNCERTAINTY_SCOPE_RULE)).toHaveLength(2);
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).not.toContain(SELF_CHECK_UNCERTAINTY_SCOPE_RULE);
    expect(SELF_CHECK_UNCERTAINTY_SCOPE_RULE).toBe(
      "\n- The REPORT UNCERTAINTIES block, when present, lists the report's uncertainties, chosen once for all three Lines. A paragraph that raises an uncertainty, a hypothesis or an advancement outside them is not allowed, even where the source discusses it; another technical challenge may appear only as part of the work on a listed uncertainty. Its repairGuidance asks to take it out, or to fold it into the work on a listed uncertainty."
    );
  });

  const checkInput = (extra: Partial<SelfCheckModelInput> = {}): SelfCheckModelInput => ({
    section: "246",
    text: "The work sought knowledge of how to hold a cold room at its setpoint.",
    storylineText: "",
    confidenceMap: [],
    glossaryCandidates: [],
    rules: [],
    model: "claude-sonnet-5",
    ...extra,
  });

  it("gives the Self-check the analysis's lists as its last data block, and nothing when they are empty", () => {
    const lists = {
      passive: ["Setpoint tables assume a closed room."],
      active: ["Whether a control step can follow the heat load of an open dock door."],
    };
    expect(reportUncertaintiesBody(lists)).toBe(
      "Limitations of standard practice (passive_uncertainties):\n- Setpoint tables assume a closed room.\nUncertainties of the approach (active_uncertainties):\n- Whether a control step can follow the heat load of an open dock door."
    );
    const message = buildSelfCheckUserMessage(checkInput({ reportUncertainties: lists }));
    expect(message.endsWith(`\n\n--- BEGIN [REPORT UNCERTAINTIES] ---\n${reportUncertaintiesBody(lists)}\n--- END [REPORT UNCERTAINTIES] ---`)).toBe(true);
    // Absent or empty: the request is as before.
    const without = buildSelfCheckUserMessage(checkInput());
    expect(buildSelfCheckUserMessage(checkInput({ reportUncertainties: { passive: [], active: [" "] } }))).toBe(without);
    expect(without).not.toContain("REPORT UNCERTAINTIES");
  });
});

// ─── Item 2: the claimant ───────────────────────────────────────────────────

describe("the claimant is named from the project record (item 2)", () => {
  it("builds one line from the company name, and none without one", () => {
    expect(claimantLine(COMPANY)).toBe(
      "CLAIMANT: Quillmere Analytics Ltd.\nThis is the company that did the work and files this claim. Name it exactly as written here. Any other company the materials name, in a file name, a title or the text, is a customer, partner or supplier of the claimant, never the claimant: call it what the materials say it is, or leave it out."
    );
    expect(claimantLine("Cedarline  Systems")).toBe(`CLAIMANT: Cedarline Systems${CLAIMANT_LINE.rule}`);
    for (const none of [undefined, null, "", "   "]) {
      expect(claimantLine(none)).toBe("");
      expect(claimantBlock(none)).toBe("");
    }
    expect(claimantBlock(COMPANY)).toBe(`\n\n${claimantLine(COMPANY)}`);
  });

  it("uses the record's name only when the run's frozen map hides all of it", () => {
    const map = buildPlaceholderMap({ clientName: COMPANY, companies: [], people: [] });
    expect(claimantNameFor(COMPANY, map)).toBe(COMPANY);
    expect(claimantNameFor(` ${COMPANY} `, map)).toBe(COMPANY);
    // Renamed after the map froze: the new name is not hidden, so no line.
    expect(claimantNameFor("Quillmere Robotics Inc.", map)).toBeUndefined();
    expect(claimantNameFor("Cedarline Systems", map)).toBeUndefined();
    // Placeholders switched off: every name is sent as written.
    expect(claimantNameFor(COMPANY, [])).toBe(COMPANY);
    expect(claimantNameFor(COMPANY, undefined)).toBe(COMPANY);
    expect(claimantNameFor("", map)).toBeUndefined();
    expect(claimantNameFor(undefined, map)).toBeUndefined();
  });

  it("the analyzer reads it after the transcript block, and its company line names the claimant", () => {
    const parts = [{ label: "Interview", content: "We hold cold rooms at setpoint." }];
    const without = buildTrustedContext({ transcriptParts: parts }).userMessage;
    const withName = buildTrustedContext({ transcriptParts: parts, claimantName: COMPANY }).userMessage;
    expect(withName.replace(claimantBlock(COMPANY), "")).toBe(without);
    expect(withName).toContain(`--- END [INTERVIEW TRANSCRIPT] ---${claimantBlock(COMPANY)}\n\n\n## How to use the attached contextual materials`);
    // With no transcript, it follows the no-transcript line.
    const docsOnly = buildTrustedContext({ claimantName: COMPANY }).userMessage;
    expect(docsOnly).toContain(`never invent interview content.${claimantBlock(COMPANY)}\n\n`);
    expect(ANALYZER_COMPANY_AND_GOAL_CATEGORIES).toContain(
      "The line names the claimant as the CLAIMANT line gives it, when there is one, and says what the claimant does: never take the company's name from a file name or a title, and never describe another company the materials name as the claimant."
    );
  });

  it("the analyzer asks who paid and who owns the results when the work looks done for another company", () => {
    expect(ANALYZER_SYSTEM_PROMPT).toContain(
      `These are areas where the writer will need to follow up with the client.${ANALYZER_GAPS_RULES}\n`
    );
    expect(ANALYZER_GAPS_RULES).toContain(
      "add one gap asking who paid for the work and who owns its results, since that decides whether the claimant can claim it"
    );
  });

  it("every Line draft and repair ends its shared block with the line; none without a name", () => {
    const base = {
      instructions: buildSection246Instructions(),
      analysisJson: "{\"company_context\":\"\"}",
      brainExemplars: "",
      lengthBudget: "",
      styleGuidance: "",
      contentPlanBlock: "",
      briefBlock: "",
    };
    const shared = buildSectionDraftRequest({ ...base, claimantName: COMPANY }).messages[0]!.content[0]!.text;
    expect(shared).toBe(`Here is the structured transcript analysis. Use ONLY this information to draft the line named after it.\n\n{"company_context":""}${claimantBlock(COMPANY)}`);
    const plain = buildSectionDraftRequest(base);
    expect(plain.messages[0]!.content[0]!.text).not.toContain("CLAIMANT:");
    // The task block is the same with or without it.
    expect(buildSectionDraftRequest({ ...base, claimantName: COMPANY }).messages[0]!.content[1]).toEqual(plain.messages[0]!.content[1]);
  });

  it("QA reads it after the pre-computed checks, and nothing changes without it", async () => {
    const analysis = { company_context: "A fictional cold-storage controls maker" } as unknown as TranscriptAnalysis;
    const userOf = async (claimant?: string) => {
      const create = vi.fn(async () => ({
        content: [{ type: "tool_use", id: "t", name: QA_REQUEST.toolName, input: { overall_score: 80, section_scores: {} } }],
        stop_reason: "tool_use",
      }));
      const client = { messages: { create } } as unknown as GenerationClient;
      await runQAAgent(client, analysis, "Line 242.", "Line 244.", "Line 246.", "claude-sonnet-5", undefined, undefined, null, null, claimant);
      const params = (create.mock.calls[0] as unknown as [{ messages: Array<{ content: string }> }])[0];
      return params.messages[0]!.content;
    };
    const withName = await userOf(COMPANY);
    const without = await userOf();
    expect(withName.replace(claimantBlock(COMPANY), "")).toBe(without);
    expect(withName).toContain(`${claimantBlock(COMPANY)}${QA_REQUEST.userScaffold.analysisHeading}`);
  });

  it("every Seed request carries it after the guidance, in the prefix every role shares", () => {
    const input = {
      mode: "batch" as const,
      objective: "Say in one plain sentence who the company is.",
      brief: { entries: [] },
      sources: [],
      projection: { decisions: "[]", feedback: "[]" },
      writerSettings: { styleGuidance: "", styleOverrides: {} },
      lengthTarget: "standard",
    };
    const withName = buildSeedPrompt({ ...input, claimantName: COMPANY });
    const without = buildSeedPrompt(input);
    expect(withName.userBlocks[0]!.text).toContain(`${claimantLine(COMPANY)}\n\n--- BEGIN [FROZEN BRIEF] ---`);
    expect(withName.userBlocks[0]!.text.replace(claimantBlock(COMPANY), "")).toBe(without.userBlocks[0]!.text);
    expect(withName.userBlocks[1]).toEqual(without.userBlocks[1]);
  });

  it("reaches the model as its placeholder and comes back as the name, bare token too (decision 26)", async () => {
    const map = buildPlaceholderMap({ clientName: COMPANY, companies: ["Northbay Retail"], people: [] });
    const name = claimantNameFor(COMPANY, map);
    expect(name).toBe(COMPANY);
    const line = claimantLine(name);
    expect(pseudonymize(line, map)).toBe(`CLAIMANT: [CLIENT_1]${CLAIMANT_LINE.rule}`);
    const sent: string[] = [];
    const create = vi.fn(async (params: { system?: string; messages: Array<{ content: Array<{ text: string }> }> }) => {
      sent.push(params.system ?? "", ...params.messages.flatMap((message) => message.content.map((block) => block.text)));
      return {
        content: [{ type: "text", text: "[CLIENT_1] is a software firm that builds data tools. CLIENT_1 hosts the systems of [CLIENT_2]." }],
        stop_reason: "end_turn",
      };
    });
    const client = withPlaceholders({ messages: { create } } as unknown as GenerationClient, map);
    const analysis = { company_context: "Northbay Retail order data" } as unknown as TranscriptAnalysis;
    const text = await runSection242Agent(client, analysis, "claude-sonnet-5", "", "", "", undefined, "", "", name);
    const request = sent.join("\n");
    expect(request).toContain(`CLAIMANT: [CLIENT_1]${CLAIMANT_LINE.rule}`);
    expect(request).not.toContain("Quillmere");
    expect(request).not.toContain("Northbay");
    expect(text).toBe("Quillmere Analytics Ltd. is a software firm that builds data tools. Quillmere Analytics Ltd. hosts the systems of Northbay Retail.");
    expect(restorePlaceholders("CLIENT_1", map)).toBe(COMPANY);
  });
});

// ─── Item 3: Lines 242 and 246, and no notes in report text ────────────────

describe("Line 242: the reason the standard approach falls short comes from the evidence (item 3)", () => {
  it("general practice only names the approach, once, and a gap asks for a missing reason", () => {
    expect(GENERAL_PRACTICE_SCOPE).toBe(
      "The marker covers only what the approach is and where it is generally used. Never explain how it works on this kind of problem or how it would handle it: that argues against the uncertainty. Why it falls short here must come from stated facts about this project; where the evidence gives no reason, write one [GAP: why the standard approach does not work here] instead, never a general-practice sentence that supplies or suggests a reason. Never put a fact about this project, its conditions or its work in a general-practice sentence. Write at most one general-practice sentence in a Line."
    );
    for (const text of [RULES_EVIDENCE_KINDS, SECTION_242_STANDARD_APPROACH_RULES]) expect(text).toContain(GENERAL_PRACTICE_SCOPE);
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(
      "2. Give the specific reason each falls short for this problem (the BECAUSE), as the evidence gives it: an input it lacks, a condition it does not support, a constraint it does not handle, or two methods that do not combine. Where the evidence gives no reason, write one [GAP: why the standard approach does not work here] in its place, and ask the client rather than supply a reason."
    );
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain("you may name well-known standard practice from general knowledge in one sentence, marked straight after it");
    expect(RULES_EVIDENCE_KINDS).toContain("you may name a well-known standard approach in one sentence, marked straight after it with [INFERRED: general practice, not in the source:");
    expect(RULES_EVIDENCE_KINDS).not.toContain("say what it is generally known to do");
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Good, where the evidence names no standard approach and gives no reason it falls short: "Cold-room controllers commonly hold temperature with a feedback loop. [INFERRED: general practice, not in the source: confirm with the client which control methods the team knew of] [GAP: why a standard feedback loop could not hold this warehouse\'s rooms at their setpoint]"'
    );
    expect(RULES_EVIDENCE_KINDS).toContain(
      'Bad: "Standard feedback loops recover the setpoint after a door opens by raising compressor output until the room is back in range. [INFERRED: general practice, not in the source: the usual recovery method]" (explains how the standard approach would handle the problem, which argues against the uncertainty'
    );
    for (const overrides of DEFAULT_BUILDS) expect(buildSection242Instructions(overrides)).toContain(SECTION_242_STANDARD_APPROACH_RULES);
  });

  it("QA flags general practice that explains the approach or supplies a reason, and accepts the gap", () => {
    expect(QA_STANDARD_APPROACH_CHECK).toContain(
      "- Flag and deduct for a general-practice sentence that explains how the standard approach works on this problem or would handle it, or that supplies or suggests a reason it falls short the evidence does not give, and for more than one general-practice sentence in a Line. A [GAP: ...] asking why the standard approach does not work here is honest, not a defect."
    );
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_STANDARD_APPROACH_CHECK);
    expect(CHAT_STANDARD_APPROACH).toBe(": the standard approaches, what they do and why they fall short here, the reason only from the evidence or else one gap asking for it");
    expect(buildSectionStructureRules()).toContain(CHAT_STANDARD_APPROACH);
    expect(RULES_REPORT_SKELETON).toContain("(the standard approaches, what they do and why they fall short here, the reason only from the evidence or else one gap asking for it)");
  });
});

describe("Line 246: the knowledge sought, any finding and one gap where there is no result (item 3)", () => {
  it("an uncertainty with no result gets no paragraph, one gap for the Line, one sentence on what is open", () => {
    expect(SECTION_246_NO_RESULT).toBe(
      "it gets no paragraph of its own. State the knowledge the work sought, then any finding the evidence does support (stated, or marked as an inference), then one [GAP: ...] for the results and status, once in the Line for every such uncertainty; when no uncertainty has a result, this is the opening paragraph. Write at most one sentence on what remains open, and never restate Line 242's uncertainty or Line 244's work"
    );
    expect(SECTION_246_NO_FINDING_PARAGRAPH).toBe(
      ` These paragraphs are for the uncertainties the evidence reports a result for. Where the evidence reports no result for an uncertainty, ${SECTION_246_NO_RESULT}.`
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(SECTION_246_NO_FINDING_PARAGRAPH);
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(`\n\n${SECTION_246_STATUS_NO_RESULT}\n\n`);
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("Where the evidence gives a finding but not the whole result, state what it does establish");
    expect(SECTION_246_OVERALL_ADVANCEMENT).toContain(SECTION_246_OVERALL_NOTHING_LEARNED);
    expect(SECTION_246_OVERALL_NOTHING_LEARNED).toContain("that one gap also covers the hypothesis and how far the objective was met, so the Line asks for them nowhere else");
    // The old per-paragraph exception is gone everywhere.
    for (const text of [SECTION_246_ADVANCEMENT_RULES, SECTION_246_NOTHING_LEARNED_YET, SECTION_246_KNOWLEDGE_FIRST_EXCEPTION, SECTION_246_SELF_CHECK_EXCEPTION, QA_NOTHING_LEARNED_YET, CHAT_NOTHING_LEARNED, RULES_REPORT_SKELETON]) {
      expect(text).not.toContain("opens with the uncertainty and its status");
    }
    expect(SECTION_246_ADVANCEMENT_RULES).not.toContain("the work was still in progress at year end. [GAP: what has been learned about it so far]");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(
      'GOOD (the evidence describes runs with one finding and reports no result yet; with no uncertainty resolved, this is the opening paragraph):\n"The work sought knowledge of how to hold a cold room within a degree of its setpoint while a dock door stays open. The first runs showed the room drifting up to 6 degrees above setpoint during long openings. [GAP: what the later runs showed, and where the work stood at year end]"'
    );
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection246Instructions(overrides);
      for (const text of [SECTION_246_NOTHING_LEARNED_YET, SECTION_246_KNOWLEDGE_FIRST_EXCEPTION, SECTION_246_SELF_CHECK_EXCEPTION, SECTION_246_ADVANCEMENT_RULES, SECTION_246_OVERALL_ADVANCEMENT]) {
        expect(prompt).toContain(text);
      }
      expect(prompt.split(SECTION_246_NO_RESULT)).toHaveLength(2);
    }
  });

  it("QA and the Assistant say the same, and QA flags the repetition", () => {
    expect(QA_NOTHING_LEARNED_YET).toContain("Flag a paragraph for each uncertainty that only says it is still open, more than one sentence on what remains open, and Line 242's uncertainty or Line 244's work restated in Line 246.");
    expect(QA_246_OPENING_NOTE).toContain("or, where the evidence reports no result yet, with the knowledge the work sought, then any finding the evidence supports and one [GAP: ...] for the results and status. Do NOT apply the advancement-paragraph opener rule to it.");
    expect(buildQaSystemPrompt()).toContain(QA_246_OPENING_NOTE);
    expect(buildQaSystemPrompt(SHIPPED_DEFAULT)).toContain(QA_WAIVED_OPENERS_NOTHING_LEARNED);
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_NOTHING_LEARNED_YET);
    expect(buildSectionStructureRules()).toContain(CHAT_NOTHING_LEARNED);
    expect(RULES_REPORT_SKELETON).toContain("an uncertainty with no result gets no paragraph: the Line states what the work set out to learn, any finding the evidence supports and one gap for the results and status, once");
  });

  it("the opener scan leaves the opening paragraph, where the no-result content goes, unscanned", () => {
    const line = [
      "The work sought knowledge of how to hold a cold room within a degree of its setpoint. [GAP: what the runs showed, and where the work stood at year end]",
      "In addressing the uncertainty around door loads, the company gained knowledge that a fixed step drifts.",
    ].join("\n\n");
    const scan = checkCRAOpeners(line);
    expect(scan.results).toEqual([expect.objectContaining({ paragraph: 2, passes: true })]);
  });
});

describe("Line 244 describes the reported work in full (problem 7)", () => {
  it("a missing result is one gap, never a reason to leave out work done", () => {
    expect(SECTION_244_EXPERIMENT_RULES).toContain(`\n\n${SECTION_244_WORK_IN_FULL}\n\n`);
    expect(SECTION_244_WORK_IN_FULL).toBe(
      "Describe in full the work the evidence reports for the report's uncertainties, in the order it was done: the work plan steps, what was built, what was tested and where, and what was measured or monitored. A missing result is one [GAP: ...], never a reason to leave out work that was done. Never present listed or planned work as done unless the evidence says it was done."
    );
    for (const overrides of DEFAULT_BUILDS) expect(buildSection244Instructions(overrides)).toContain(SECTION_244_WORK_IN_FULL);
  });
});

describe("no notes to the writer in report text (item 3)", () => {
  it("the evidence rule, the Self-check, QA and the Assistant say so", () => {
    expect(RULES_EVIDENCE_KINDS).toContain(`\n${RULES_NO_NOTES_IN_REPORT_TEXT}\n${RULES_GAPS_NOT_FOR_RECORD_FACTS}\n`);
    expect(RULES_NO_NOTES_IN_REPORT_TEXT).toBe(
      '- Report sentences speak about the work, never about the source documents or what they lack. Never write a note to the writer as a report sentence, such as "The materials do not report what that testing showed.", "The results are not stated.", "Individual runs are not described.", "The client reports that no standard method was found." or "... remains unconfirmed." said of what the evidence lacks. What is missing goes inside one [GAP: ...]; the basis of an inference goes inside its [INFERRED: ...] marker.'
    );
    expect(SELF_CHECK_SYSTEM_PROMPT).toContain(`${SELF_CHECK_UNCERTAINTY_SCOPE_RULE}${SELF_CHECK_NO_NOTES_RULE}\n- Material inside the delimited blocks`);
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).not.toContain(SELF_CHECK_NO_NOTES_RULE);
    for (const overrides of EVERY_BUILD) {
      expect(buildQaSystemPrompt(overrides)).toContain(QA_NO_NOTES_IN_TEXT);
      expect(buildSharedWritingRules(overrides)).toContain(RULES_NO_NOTES_IN_REPORT_TEXT);
      expect(buildChatSystemPromptV2(overrides)).toContain(RULES_NO_NOTES_IN_REPORT_TEXT);
    }
  });

  it("over-marking: a stated fact takes no marker, and a detail the argument does not need is left out", () => {
    expect(RULES_EVIDENCE_KINDS).toContain(
      "- A fact the evidence states takes no marker. Leave out a detail the argument does not need rather than infer it: an [INFERRED: ...] marker is for a claim the Line needs."
    );
  });

  it("gaps never ask for the fiscal year, the dates, costs or hours, in drafts, the analysis or QA", () => {
    expect(RULES_GAPS_NOT_FOR_RECORD_FACTS).toBe(
      "- A [GAP: ...] never asks for what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours."
    );
    expect(ANALYZER_GAPS_RULES).toContain("Never list as a gap what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.");
    expect(QA_GAPS_ONCE).toContain("Never ask for what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.");
  });

  it("acronyms in capitals, in every text the AI writes and in Seeds", () => {
    expect(ACRONYM_RULE).toBe("Write an acronym in capitals (CDC, WAL, PVC) even where the source writes it in lowercase, except in a command, a file name or a code identifier.");
    expect(RULES_HUMAN_PROSE).toContain(`- Use the client's own terms from the interview for their product, process and problem. ${ACRONYM_RULE}\n`);
    expect(RULES_SEED_WORDING).toContain(`no exclamation marks. ${ACRONYM_RULE}`);
  });
});

describe("findNotesToWriter: the Locked deterministic check", () => {
  it("finds a source noun as the subject of a reporting verb, the client reporting, and a passive note", () => {
    const notes: Array<[string, string]> = [
      ["The team ran the controller. The materials do not report what that testing showed.", "The materials do not report"],
      ["Testing was reported; individual runs are not described.", "are not described"],
      ["Findings about the drift are not stated.", "are not stated"],
      ["The client reports that no standard method was found.", "The client reports"],
      ["The materials give no status at the end of the period.", "The materials give no status"],
      ["The answers do not give a date for the second run.", "The answers do not give"],
      ["The written answers state that three builds were made.", "The written answers state"],
      ["The transcript says the team ran three builds.", "The transcript says"],
      ["The interview does not describe the sensor layout.", "The interview does not describe"],
      ["The source files do not mention a rollback.", "The source files do not mention"],
      ["The materials provided do not describe the setup.", "The materials provided do not describe"],
      ["The client did not say which alloy was used.", "The client did not say"],
    ];
    for (const [text, phrase] of notes) expect([text, findNotesToWriter(text).map((hit) => hit.phrase)]).toEqual([text, [phrase]]);
  });

  it("leaves literature, a vendor datasheet, a client's systems, materials science and marker text alone", () => {
    const clean = [
      "The method is not described in published literature.",
      "Published studies report results for closed rooms only.",
      "The vendor datasheet does not state the limit for this alloy.",
      "The company replicates a client's production databases to a standby site.",
      "A client reported lag on its own database before the work began.",
      "The materials showed cracking after 400 cycles.",
      "The materials do not show signs of corrosion.",
      "The materials give no sign of fatigue after 400 cycles.",
      "The step responses showed an overshoot of 6 degrees.",
      "The source code does not describe the retry path.",
      "The light sources reported their output over the bus.",
      "The drift was not measured during the first runs.",
      "The team ran three builds. [GAP: what the materials report about the third build]",
      "The rate held. [INFERRED: the transcript says the rate held in two runs]",
    ];
    for (const text of clean) expect([text, findNotesToWriter(text)]).toEqual([text, []]);
  });

  it("is a finding of every Line under every waiver", () => {
    const text = "The team ran the controller during loading shifts. The materials do not report what that testing showed.";
    for (const overrides of EVERY_BUILD) {
      for (const section of ["s242", "s244", "s246"] as const) {
        const findings = sectionDeterministicFindings(section, text, overrides).filter((finding) => finding.check === "note_to_writer");
        expect(findings).toHaveLength(1);
        expect(findings[0]!.message).toContain('Note to the writer in report text ("The materials do not report")');
      }
    }
    expect(sectionDeterministicFindings("s244", "The team ran the controller. [GAP: what the runs showed]").some((finding) => finding.check === "note_to_writer")).toBe(false);
  });
});

describe("the notes check reaches the Self-check's repair", () => {
  const profile = {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  } as unknown as OrderedProfileContext;
  const check = (text: string, notesToWriterRow?: boolean) =>
    runDeterministicSelfCheck({
      section: "244",
      text,
      brief: null,
      profile,
      isFirstInOrder: false,
      ...(notesToWriterRow ? { notesToWriterRow } : {}),
    });

  it("a note gets a Locked row the repair fixes, with fixed words that name the paragraph and the phrase", () => {
    const before = check("The team ran the controller during loading shifts.\n\nThe answers do not give a date for the second run.");
    const entry = before.entries.find((candidate) => candidate.key === NOTES_TO_WRITER_KEY);
    expect(entry).toMatchObject({
      repairable: true,
      row: { instruction: NOTES_TO_WRITER.instruction, outcome: "not_applied", tier: "locked", paragraphIndex: 1 },
    });
    expect(entry!.row.reason).toBe('a note to the writer in paragraph 2 ("The answers do not give")');
    const fix = `Paragraph 2: ${NOTES_TO_WRITER.fix} ("The answers do not give"). ${NOTES_TO_WRITER.rule}`;
    expect(entry!.guidance).toBe(fix);
    expect(repairIssues(before, [])).toContain(fix);
  });

  it("a Line with no note has no row, so its rows and requests are as before; the final check keeps the row to say it was fixed", () => {
    expect(check("The team ran the controller. [GAP: what the runs showed]").entries.some((entry) => entry.key === NOTES_TO_WRITER_KEY)).toBe(false);
    const after = check("The team ran the controller. [GAP: what the runs showed]", true);
    expect(after.entries.find((entry) => entry.key === NOTES_TO_WRITER_KEY)).toMatchObject({
      repairable: false,
      row: { instruction: NOTES_TO_WRITER.instruction, outcome: "applied", tier: "locked", reason: NOTES_TO_WRITER.applied },
    });
  });

  it("in a signed-off plan run, words the source-talk check names are left to it", () => {
    const before = runDeterministicSelfCheck({
      section: "244",
      text: "The transcript states that three builds were made.\n\nThe answers do not give a date for the second run.",
      brief: null,
      profile,
      isFirstInOrder: false,
      sourceTalk: { subjectText: [] },
    });
    const notes = before.entries.find((entry) => entry.key === NOTES_TO_WRITER_KEY);
    expect(notes!.row.reason).toBe('a note to the writer in paragraph 2 ("The answers do not give")');
    expect(before.entries.find((entry) => entry.key === "sourceTalk")!.row.outcome).toBe("not_applied");
  });
});

// ─── The pinned-request fixture ─────────────────────────────────────────────

describe("the pinned-request fixture", () => {
  it("takes out every added text, puts back the acronym sentence, and refuses one in the wrong request", () => {
    const additions = Object.values(ONE_UNCERTAINTY_ADDITIONS);
    expect(new Set(additions).size).toBe(additions.length);
    for (const one of additions) for (const other of additions) if (one !== other) expect(one.includes(other)).toBe(false);
    for (const [now] of ONE_UNCERTAINTY_SWAPS) expect(now.length).toBeGreaterThan(0);
    const selfCheck = withoutOneUncertaintyText(SELF_CHECK_SYSTEM_PROMPT, "selfCheck");
    expect(selfCheck).not.toContain(SELF_CHECK_UNCERTAINTY_SCOPE_RULE);
    expect(selfCheck).not.toContain(SELF_CHECK_NO_NOTES_RULE);
    expect(selfCheck).not.toContain(ACRONYM_RULE);
    expect(selfCheck).toContain("- Use the client's own terms from the interview for their product, process and problem.\n");
    const qa = withoutOneUncertaintyText(buildQaSystemPrompt(), "qa");
    expect(qa).not.toContain(QA_NO_NOTES_IN_TEXT);
    expect(withoutOneUncertaintyText(ANALYZER_SYSTEM_PROMPT, "analysis")).not.toContain(ANALYZER_CHOSEN_UNCERTAINTIES);
    expect(() => withoutOneUncertaintyText(buildQaSystemPrompt(), "draft")).toThrow(/holds the 2026-10-30 additions/);
    expect(() => withoutOneUncertaintyText(SELF_CHECK_SYSTEM_PROMPT, "summarySelfCheck")).toThrow(/holds the 2026-10-30 additions/);
    // The claimant line is taken out whatever the name, at most once, and
    // never belongs in a request that does not send it.
    expect(withoutOneUncertaintyText(`x${QA_NO_NOTES_IN_TEXT}${claimantBlock("[CLIENT_1]")}`, "qa")).toBe("x");
    expect(withoutOneUncertaintyText(`x${QA_NO_NOTES_IN_TEXT}${claimantBlock(COMPANY)}`, "qa")).toBe("x");
    expect(() => withoutOneUncertaintyText(`x${QA_NO_NOTES_IN_TEXT}${claimantBlock(COMPANY)}${claimantBlock("[CLIENT_1]")}`, "qa")).toThrow(/holds the 2026-10-30 additions/);
    expect(() => withoutOneUncertaintyText(`x${claimantBlock("[CLIENT_1]")}`, "compression")).toThrow(/holds the 2026-10-30 additions/);
    // A Seed request is told apart by its own heading, and may hold the line.
    expect(withoutOneUncertaintyText(`# SEED REQUEST\n\nguidance${claimantBlock("[CLIENT_1]")}`, "none")).toBe("# SEED REQUEST\n\nguidance");
  });
});
