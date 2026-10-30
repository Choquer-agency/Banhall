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
  CHAT_ADVANCEMENT_STATUS,
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
  SECTION_246_GOAL_CLOSE,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_NO_RESULT,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_OVERALL_ADVANCEMENT,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_246_SELF_CHECK_EXCEPTION,
  SECTION_246_STATUS_NO_RESULT,
  SECTION_246_STATUS_WITH_RESULTS,
  SECTION_246_RESULT_DEFINITION,
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
  SECTION_246_STATUS_WITH_RESULTS,
  SECTION_246_RESULT_DEFINITION,
  CHAT_ADVANCEMENT_STATUS,
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
      // Review round 1 (wording P2-7): the passive list keeps the limitations
      // behind the chosen uncertainties, and work_performed keeps all the work.
      `\n\n   passive_uncertainties and active_uncertainties are the report's uncertainties, chosen here once for all three Lines. When the writer's notes say which uncertainties the report covers, or how many (for example "one main uncertainty"), the active list holds exactly those, and the passive list keeps the limitations of standard practice behind them. When the notes give only a number, choose the ones the source gives the most evidence of investigation for. work_performed keeps all the work done toward the chosen uncertainties, including work on other challenges met along the way; advancements_achieved and remaining_uncertainties cover only the chosen uncertainties. Another technical challenge the source names may appear only as part of the work on a chosen uncertainty, never as an uncertainty of its own. With no such note, list every uncertainty the source supports.`
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
      "CLAIMANT: Quillmere Analytics Ltd.\nThis is the company that did the work and files this claim. Name it exactly as written here. Any other company the materials name, in a file name, a title or the text, other than a short form, trade name or former name of this company, is a customer, partner or supplier of the claimant, never the claimant: call it what the materials say it is, or leave it out."
    );
    expect(claimantLine("Cedarline  Systems")).toBe(`CLAIMANT: Cedarline Systems${CLAIMANT_LINE.rule}`);
    for (const none of [undefined, null, "", "   "]) {
      expect(claimantLine(none)).toBe("");
      expect(claimantBlock(none)).toBe("");
    }
    expect(claimantBlock(COMPANY)).toBe(`\n\n${claimantLine(COMPANY)}`);
  });

  it("uses the record's name only when the run's frozen map hides all of it, or placeholders were switched off", () => {
    const map = buildPlaceholderMap({ clientName: COMPANY, companies: [], people: [] });
    expect(claimantNameFor(COMPANY, map, undefined)).toBe(COMPANY);
    expect(claimantNameFor(` ${COMPANY} `, map, undefined)).toBe(COMPANY);
    // Renamed after the map froze: the new name is not hidden, so no line.
    expect(claimantNameFor("Quillmere Robotics Inc.", map, undefined)).toBeUndefined();
    expect(claimantNameFor("Cedarline Systems", map, undefined)).toBeUndefined();
    // Placeholders switched off at reservation: every name is sent as written.
    expect(claimantNameFor(COMPANY, [], true)).toBe(COMPANY);
    expect(claimantNameFor(COMPANY, undefined, true)).toBe(COMPANY);
    expect(claimantNameFor("", map, undefined)).toBeUndefined();
    expect(claimantNameFor(undefined, map, true)).toBeUndefined();
  });

  // Review round 1 (plumbing P1-a): an empty map is not the switch being off,
  // and what is left of a partly hidden name is not hidden.
  it("never sends a name the map leaves empty or hides in part", () => {
    const short = buildPlaceholderMap({ clientName: "AB", companies: [], people: [] });
    expect(short).toEqual([]);
    expect(claimantNameFor("AB", short, undefined)).toBeUndefined();
    expect(claimantNameFor("AB", short, false)).toBeUndefined();
    expect(claimantNameFor("AB", [], undefined)).toBeUndefined();
    const part = buildPlaceholderMap({ clientName: "Quillmere", companies: [], people: [] });
    expect(pseudonymize("Quillmere 42", part)).toBe("[CLIENT_1] 42");
    expect(claimantNameFor("Quillmere 42", part, undefined)).toBeUndefined();
    expect(claimantNameFor("Quillmere-42", part, undefined)).toBeUndefined();
    expect(claimantNameFor("Quillmere", part, undefined)).toBe("Quillmere");
  });

  it("sends no claimant line to the provider for a name too short or partly hidden", async () => {
    for (const [name, map] of [
      ["AB", buildPlaceholderMap({ clientName: "AB", companies: [], people: [] })],
      ["Quillmere 42", buildPlaceholderMap({ clientName: "Quillmere", companies: [], people: [] })],
    ] as const) {
      const sent: string[] = [];
      const create = vi.fn(async (params: { system?: string; messages: Array<{ content: Array<{ text: string }> }> }) => {
        sent.push(params.system ?? "", ...params.messages.flatMap((message) => message.content.map((block) => block.text)));
        return { content: [{ type: "text", text: "Drafted." }], stop_reason: "end_turn" };
      });
      const client = withPlaceholders({ messages: { create } } as unknown as GenerationClient, map);
      const analysis = { company_context: "A fictional maker of packaging lines" } as unknown as TranscriptAnalysis;
      await runSection242Agent(client, analysis, "claude-sonnet-5", "", "", "", undefined, "", "", claimantNameFor(name, map, undefined));
      const request = sent.join("\n");
      expect(request).not.toContain(CLAIMANT_LINE.prefix);
      expect(request).not.toMatch(/\bAB\b/);
      expect(request).not.toMatch(/\b42\b/);
    }
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
    const name = claimantNameFor(COMPANY, map, undefined);
    expect(name).toBe(COMPANY);
    const line = claimantLine(name);
    expect(pseudonymize(line, map)).toBe(`CLAIMANT: [CLIENT_1]${CLAIMANT_LINE.rule}`);
    const sent: string[] = [];
    const create = vi.fn(async (params: { system?: string; messages: Array<{ content: Array<{ text: string }> }> }) => {
      sent.push(params.system ?? "", ...params.messages.flatMap((message) => message.content.map((block) => block.text)));
      return {
        content: [{ type: "text", text: "[CLIENT_1] is a maker of packaging lines. CLIENT_1 services the lines of [CLIENT_2]." }],
        stop_reason: "end_turn",
      };
    });
    const client = withPlaceholders({ messages: { create } } as unknown as GenerationClient, map);
    const analysis = { company_context: "Northbay Retail packaging lines" } as unknown as TranscriptAnalysis;
    const text = await runSection242Agent(client, analysis, "claude-sonnet-5", "", "", "", undefined, "", "", name);
    const request = sent.join("\n");
    expect(request).toContain(`CLAIMANT: [CLIENT_1]${CLAIMANT_LINE.rule}`);
    expect(request).not.toContain("Quillmere");
    expect(request).not.toContain("Northbay");
    expect(text).toBe("Quillmere Analytics Ltd. is a maker of packaging lines. Quillmere Analytics Ltd. services the lines of Northbay Retail.");
    expect(restorePlaceholders("CLIENT_1", map)).toBe(COMPANY);
  });

  // Review round 1 (wording P2-8): the claimant's short forms are hidden as
  // forms of the same placeholder, and the line says a short form, trade
  // name or former name is this company, not another one.
  it("hides and restores the claimant's short forms as forms of its own placeholder", () => {
    expect(CLAIMANT_LINE.rule).toContain(
      "Any other company the materials name, in a file name, a title or the text, other than a short form, trade name or former name of this company, is a customer, partner or supplier of the claimant"
    );
    const map = buildPlaceholderMap({ clientName: COMPANY, companies: ["Northbay Retail"], people: [] });
    const text = "Quillmere Analytics Ltd. (Quillmere Analytics, or just Quillmere) runs packaging lines for Northbay Retail.";
    const masked = pseudonymize(text, map);
    expect(masked).toBe("[CLIENT_1] ([CLIENT_1_SHORT], or just [CLIENT_1_FIRST]) runs packaging lines for [CLIENT_2].");
    expect(restorePlaceholders(masked, map)).toBe(text);
  });
});

// ─── Item 3: Lines 242 and 246, and no notes in report text ────────────────

describe("Line 242: the reason the standard approach falls short comes from the evidence (item 3)", () => {
  it("general practice only names the approach, once, and a gap asks for a missing reason", () => {
    expect(GENERAL_PRACTICE_SCOPE).toBe(
      "The marker covers only what the approach is and where it is generally used. Never explain how it works on this kind of problem or how it would handle it: that argues against the uncertainty. Why it falls short here must come from stated facts about this project; where the evidence gives no reason, write one [GAP: why the standard approach does not work here] instead, never a general-practice sentence that supplies or suggests a reason. Never put a fact about this project, its conditions or its work in a general-practice sentence. Write at most one general-practice sentence in a Line. For any further limitation with no standard approach in the evidence, write one [GAP: which standard approaches the team knew of, and why they fall short here] in its place."
    );
    // Review round 1 (wording P3-9): step 1 agrees with the general-practice limits.
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(
      "1. Name the standard approach or approaches a competent practitioner would reach for first, and say briefly what each does well, as the evidence states it; for general practice, only what it is and where it is used."
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
    // Review round 1 (wording P2-3): one paragraph for every such
    // uncertainty, a single gap for all of them, after the advancement
    // paragraphs or as the opening; (P2-4) only an observation the evidence
    // states, and what a result is.
    expect(SECTION_246_NO_RESULT).toBe(
      "it gets no paragraph of its own. Cover every such uncertainty together in one paragraph: the knowledge the work sought, then any observation the evidence states, then a single [GAP: ...] that asks for the results and status of all of them. Put that paragraph after the advancement paragraphs; when no uncertainty has a result, it is the opening paragraph. Write at most one sentence in it on what remains open, and do not repeat Line 242's reasons for the uncertainty or Line 244's work. Its single gap also covers those uncertainties' hypotheses, so the opening asks for them nowhere else"
    );
    expect(SECTION_246_RESULT_DEFINITION).toBe(
      // Review round 2 (P2-1): a conclusion, not a reading or an event.
      "An uncertainty has a result when the evidence states something the work established about it, in whole or in part: a conclusion the evidence draws, not only a reading or event it records. That uncertainty gets its own paragraph. An observation that settles nothing on its own (a reading, a failure seen in one run) is not a result: it goes in the paragraph for the uncertainties with no result."
    );
    // Review round 2 (P2-2): the shared paragraph's gap covers the hypotheses
    // of those uncertainties, and PROJECT STATUS covers only the others.
    expect(SECTION_246_STATUS_WITH_RESULTS).toBe(
      "Where uncertainties have results, for those uncertainties only (the paragraph for the rest and its gap already cover them): "
    );
    // Review round 2 (P2-3): the close claims nothing learned where nothing was.
    expect(SECTION_246_GOAL_CLOSE).toContain(
      "Where no uncertainty has a result, name the project goal and say what work continues toward it; claim no knowledge gained or applied."
    );
    expect(SECTION_246_NO_FINDING_PARAGRAPH).toBe(
      ` These paragraphs are for the uncertainties the evidence reports a result for. ${SECTION_246_RESULT_DEFINITION} Where the evidence reports no result for an uncertainty, ${SECTION_246_NO_RESULT}.`
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(SECTION_246_NO_FINDING_PARAGRAPH);
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("Where the evidence gives a finding but not the whole result, state what it does establish");
    // (P2-5) the opening's no-result branch comes after its other sentences and replaces them.
    expect(SECTION_246_OVERALL_NOTHING_LEARNED).toBe(
      " Where the evidence reports no result for any uncertainty, write none of the above: open instead with the knowledge the work sought, then any observation the evidence states, then a single [GAP: ...] for the results and status, which also covers the hypothesis and how far the objective was met."
    );
    expect(SECTION_246_OVERALL_ADVANCEMENT).toContain(
      `where it does not, put one [GAP: ...] for the result.${SECTION_246_OVERALL_NOTHING_LEARNED} This ties back directly to Section 242.`
    );
    // The old per-paragraph exception and inferred findings are gone everywhere.
    for (const text of [SECTION_246_ADVANCEMENT_RULES, SECTION_246_NOTHING_LEARNED_YET, SECTION_246_KNOWLEDGE_FIRST_EXCEPTION, SECTION_246_SELF_CHECK_EXCEPTION, QA_NOTHING_LEARNED_YET, CHAT_NOTHING_LEARNED, RULES_REPORT_SKELETON]) {
      expect(text).not.toContain("opens with the uncertainty and its status");
      expect(text).not.toContain("marked as an inference");
    }
    expect(SECTION_246_ADVANCEMENT_RULES).not.toContain("The first runs showed");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(
      'GOOD (the evidence reports no result for any uncertainty, so this is the opening paragraph):\n"The work sought knowledge of how to hold a cold room within a degree of its setpoint while a dock door stays open. [GAP: what the runs with the shorter control step showed, and where the work stood at year end]"'
    );
    for (const overrides of DEFAULT_BUILDS) {
      const prompt = buildSection246Instructions(overrides);
      for (const text of [SECTION_246_NOTHING_LEARNED_YET, SECTION_246_KNOWLEDGE_FIRST_EXCEPTION, SECTION_246_SELF_CHECK_EXCEPTION, SECTION_246_ADVANCEMENT_RULES, SECTION_246_OVERALL_ADVANCEMENT]) {
        expect(prompt).toContain(text);
      }
      expect(prompt.split(SECTION_246_NO_RESULT)).toHaveLength(2);
      // (P2-5) PROJECT STATUS has a branch for each case; (P1-2) one paragraph per uncertainty with a result.
      expect(prompt).toContain(
        `**PROJECT STATUS & NEXT STEPS:**\n${SECTION_246_STATUS_WITH_RESULTS}Be specific about what is still unknown and WHY it remains uncertain.`
      );
      expect(prompt).toContain(`Describe the planned approach for the next fiscal period. ${SECTION_246_STATUS_NO_RESULT}\n`);
      expect(prompt).toContain("**TECHNOLOGICAL ADVANCEMENTS (one paragraph per uncertainty from 242 that the evidence reports a result for):**");
      expect(prompt).toContain("one per uncertainty the evidence reports a result for, never padded to a count");
      expect(prompt).toContain("the specific technological advancements (one per uncertainty the evidence reports a result for)");
    }
    expect(SECTION_246_STATUS_NO_RESULT).toBe(
      "Where no uncertainty has a result, add only the next period's plan, as the evidence gives it: the single gap above already asks for the status."
    );
    expect(buildQaSystemPrompt()).toContain("the specific advancements (one per uncertainty the evidence reports a result for)");
    expect(CHAT_ADVANCEMENT_STATUS).toBe(
      "one per uncertainty with a result, with its status only as the evidence shows: resolved, resolved for the conditions tested, partially resolved or unresolved"
    );
  });

  it("QA and the Assistant say the same, and QA flags the repetition", () => {
    // Review round 1 (wording P2-6): the flags are scoped to the shared paragraph.
    expect(QA_NOTHING_LEARNED_YET).toContain(
      "In the paragraph that covers the uncertainties with no result, flag more than one sentence on what remains open, and a repeat of Line 242's reasons for the uncertainty or of Line 244's work. Naming the uncertainty in a few words, as 'In addressing the uncertainty around X' does, is not a repeat."
    );
    expect(QA_246_OPENING_NOTE).toContain("or, where the evidence reports no result for any uncertainty, with the knowledge the work sought, then any observation the evidence states and a single [GAP: ...] for the results and status. Do NOT apply the advancement-paragraph opener rule to it.");
    expect(buildQaSystemPrompt()).toContain(QA_246_OPENING_NOTE);
    expect(buildQaSystemPrompt(SHIPPED_DEFAULT)).toContain(QA_WAIVED_OPENERS_NOTHING_LEARNED);
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_NOTHING_LEARNED_YET);
    expect(buildSectionStructureRules()).toContain(CHAT_NOTHING_LEARNED);
    // Review round 2 (P3-6): with no result at all, the shared paragraph opens the Line.
    expect(RULES_REPORT_SKELETON).toContain("the uncertainties with no result share one paragraph after them, or, when none has a result, that paragraph opens the Line in place of the overall advancement: what the work set out to learn, any observation the evidence states and a single gap for the results and status");
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
      '- Report sentences speak about the work, never about the source documents or what they lack. Never write a note to the writer as a report sentence, such as "The materials do not report what that testing showed.", "The results are not stated.", "Individual runs are not described.", "The client reports that no standard method was found." or "... remains unconfirmed." said of what the evidence lacks. What is missing goes inside one [GAP: ...]; the basis of an inference goes inside its [INFERRED: ...] marker. A status sentence about the work ("remains open", "was unresolved at year end") is report text, not a note.'
    );
    // Review round 1 (wording P3-10): a status sentence is report text, in the Self-check and QA too.
    for (const text of [SELF_CHECK_NO_NOTES_RULE, QA_NO_NOTES_IN_TEXT]) {
      expect(text).toContain('A status sentence about the work ("remains open", "was unresolved at year end") is report text, not a note.');
    }
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
    // Review round 1 (wording P3-11): terms with their own casing, and examples from other fields.
    expect(ACRONYM_RULE).toBe(
      "Write an acronym in capitals (PLC, HVAC, PVC) even where the source writes it in lowercase, except in a command, a file name, a code identifier or a term with its own standard casing (pH, kWh, gRPC, iOS)."
    );
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
      ["The client reports that no standard method was found.", "The client reports that"],
      ["The materials give no status at the end of the period.", "The materials give no status"],
      ["The answers do not give a date for the second run.", "The answers do not give"],
      ["The written answers state that three builds were made.", "The written answers state"],
      ["The transcript says the team ran three builds.", "The transcript says"],
      ["The interview does not describe the sensor layout.", "The interview does not describe"],
      ["The source files do not mention a rollback.", "The source files do not mention"],
      ["The materials provided do not describe the setup.", "The materials provided do not describe"],
      ["The client did not say which alloy was used.", "The client did not say"],
      ["The interview responses do not describe the second run.", "The interview responses do not describe"],
      ["The client said the second line was rebuilt in May.", "The client said"],
      ["The client noted that the jams stopped after the change.", "The client noted that"],
      ["The second run's result was not reported.", "result was not reported"],
      // Review round 2 (P3-4): "reported" after a word for what the work found.
      ["The results of these runs were not reported.", "runs were not reported"],
    ];
    for (const [text, phrase] of notes) expect([text, findNotesToWriter(text).map((hit) => hit.phrase)]).toEqual([text, [phrase]]);
  });

  it("leaves literature, a vendor datasheet, a client's systems, materials science and marker text alone", () => {
    const clean = [
      "The method is not described in published literature.",
      "Published studies report results for closed rooms only.",
      "The vendor datasheet does not state the limit for this alloy.",
      "The company maintains a client's packaging lines at two plants.",
      "A client reported a jam on its own packaging line before the work began.",
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

  // Review round 1 (wording P1): good technical prose the first version
  // flagged, in fictional domains (a message broker, a PLC, a speech app).
  it("leaves technical prose about sources, clients, responses and specifications alone", () => {
    const clean = [
      "The sources do not provide a global ordering of messages across topics.",
      "The sources record every message in their own commit logs.",
      "The sources confirm each message before the broker stores it.",
      "The responses state the valve position in percent.",
      "The client confirms each batch before the broker advances its read position.",
      "The client did not confirm the frame within the timeout.",
      "The client records each reading before the PLC moves to its next scan.",
      "The responses did not show any overshoot after the PLC was retuned.",
      "The responses indicated a lag of two seconds at the second pump.",
      "The behaviour of the PLC scan cycle under a full I/O load is not documented.",
      "The order of alarms across the two PLCs is not specified.",
      "The default gain was not given for the second pump.",
      "Before the change, dropped messages were not reported.",
      "The transcripts did not show speaker labels.",
      "The transcripts record each speaker turn with its start time.",
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
