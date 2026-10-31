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
  RULES_STATUS_ONLY_FROM_EVIDENCE,
  findDashConnectors,
} from "../../shared/humanProse";
import {
  ANALYZER_CHOSEN_UNCERTAINTIES,
  ANALYZER_COMPANY_AND_GOAL_CATEGORIES,
  ANALYZER_GAPS_RULES,
  ANALYZER_SYSTEM_PROMPT,
  CHAT_EXPERIMENT_ORDER,
  SECTION_244_YEAR_END_CLOSE,
  QA_NO_STATUS_NOT_MISSING,
  QA_NO_UNSOURCED_CONCLUSION,
  QA_REASON_NEXT_SENTENCE,
  QA_SOURCE_FAITHFULNESS,
  SECTION_242_NO_UNSOURCED_CONCLUSION,
  CHAT_ADVANCEMENT_STATUS,
  CHAT_NOTHING_LEARNED,
  CHAT_STANDARD_APPROACH,
  CLAIMANT_LINE,
  QA_246_OPENING_NOTE,
  QA_GAPS_ONCE,
  QA_HYPOTHESIS_CHECK,
  QA_NO_NOTES_IN_TEXT,
  QA_NOTHING_LEARNED_YET,
  QA_STANDARD_APPROACH_CHECK,
  QA_WAIVED_OPENERS_NOTHING_LEARNED,
  SECTION_242_STANDARD_APPROACH_RULES,
  SECTION_244_EXPERIMENT_RULES,
  SECTION_244_HYPOTHESIS_NEVER_A_GAP,
  SECTION_244_HYPOTHESIS_RULES,
  SECTION_244_WORK_IN_FULL,
  SECTION_246_ADVANCEMENT_RULES,
  SECTION_246_GOAL_CLOSE,
  SECTION_246_KNOWLEDGE_FIRST_EXCEPTION,
  SECTION_246_NEXT_PERIOD_PLAN,
  SECTION_246_NO_FINDING_PARAGRAPH,
  SECTION_246_NO_RESULT,
  SECTION_246_NOTHING_LEARNED_YET,
  SECTION_246_OVERALL_ADVANCEMENT,
  SECTION_246_OVERALL_NOTHING_LEARNED,
  SECTION_246_SELF_CHECK_EXCEPTION,
  SECTION_246_STATUS_NO_RESULT,
  SECTION_246_STATUS_WITH_RESULTS,
  SECTION_246_RESULT_DEFINITION,
  SECTION_246_STATUS_ONLY_FROM_EVIDENCE,
  SECTION_EVIDENCE_POINTER,
  SECTION_UNCERTAINTY_SCOPE,
  SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE,
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
import { ORDERED_PROMPT_SCAFFOLDS, REPAIR_NO_ATTRIBUTION_HEDGE, SELF_CHECK_REQUEST } from "./promptDefinitions";
import { BRIEF_STORYLINE_MAIN_UNCERTAINTY, BRIEF_SYSTEM_PROMPT } from "../lib/briefRequest";
import { buildSelfCheckUserMessage, reportUncertaintiesBody, type SelfCheckModelInput } from "./selfCheck";
import {
  NOTES_TO_WRITER,
  checkBannedWords,
  checkBecauseClauses,
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
  SECTION_246_NEXT_PERIOD_PLAN,
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
  SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE,
  REPAIR_NO_ATTRIBUTION_HEDGE,
  BRIEF_STORYLINE_MAIN_UNCERTAINTY,
  SECTION_246_STATUS_ONLY_FROM_EVIDENCE,
  SECTION_244_HYPOTHESIS_NEVER_A_GAP,
  QA_HYPOTHESIS_CHECK,
  // Rerun C (S1 to S3).
  RULES_STATUS_ONLY_FROM_EVIDENCE,
  SECTION_242_NO_UNSOURCED_CONCLUSION,
  QA_NO_UNSOURCED_CONCLUSION,
  QA_REASON_NEXT_SENTENCE,
  QA_NO_STATUS_NOT_MISSING,
  QA_SOURCE_FAITHFULNESS,
  // Review round 6.
  SECTION_244_YEAR_END_CLOSE,
  CHAT_EXPERIMENT_ORDER,
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
      `\n\n   passive_uncertainties and active_uncertainties are the report's uncertainties, chosen here once for all three Lines. When the writer's notes say which uncertainties the report covers, or how many (for example "one main uncertainty"), the active list holds exactly those, and the passive list keeps the limitations of standard practice behind them. When the notes give only a count (for example "one main uncertainty") and do not name which, choose the ones the source gives the most evidence of investigation for, and state each as the underlying technological problem its related challenges share, not the narrowest of them (for a count of one, the one question the work set out to answer): its related challenges become parts of it, and a challenge related to no chosen uncertainty stays out of the lists. State each as specifically as the evidence allows (the technical question, the conditions, why standard practice does not answer it), never as the project goal. work_performed keeps all the work done toward the chosen uncertainties, including work on the challenges that are parts of them and on other challenges met along the way, with their validation checks, thresholds and measurements; advancements_achieved and remaining_uncertainties cover only the chosen uncertainties. Another technical challenge the source names may appear only as part of the work on a chosen uncertainty, never as an uncertainty of its own. With no such note, list every uncertainty the source supports.`
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
      "The marker covers only what the approach is and where it is generally used. Never explain how it works on this kind of problem or how it would handle it: that argues against the uncertainty. Why it falls short here must come from stated facts about this project; where the evidence gives no reason, write one [GAP: why the standard approach does not work here] instead, never a general-practice sentence that supplies or suggests a reason. Never put a fact about this project, its conditions or its work in a general-practice sentence. Write at most one general-practice sentence in a Line. When the company's own approach is itself a standard mechanism, never present it as common practice that handles the problem: say what it does not handle here, from the evidence, or ask in the one gap, and never draw a contrast the evidence does not give. For any further limitation with no standard approach in the evidence, write one [GAP: which standard approaches the team knew of, and why they fall short here] in its place."
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
      "- Flag and deduct for a general-practice sentence that explains how the standard approach works on this problem or would handle it, or that supplies or suggests a reason it falls short the evidence does not give, and for more than one general-practice sentence in a Line. Flag and deduct, too, for a general-practice sentence that presents the company's own chosen approach as common practice, and for a contrast with it the evidence does not give.\n- A [GAP: ...] asking why the standard approach does not work here is honest, not a defect: never deduct because the reason the standard approach falls short is a [GAP: ...], and count that gap as the reason in the checks above."
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
      "it gets no paragraph of its own. Cover every such uncertainty together in one paragraph: the knowledge the work sought, then any observation the evidence states, then a single [GAP: ...] for whatever of their results and status the evidence does not give. Put that paragraph after the advancement paragraphs; when no uncertainty has a result, it is the opening paragraph. Write at most one sentence in it on what remains open, and only where the evidence says it is open, and do not repeat Line 242's reasons for the uncertainty or Line 244's work. Its single gap also covers those uncertainties' hypotheses, so the opening asks for them nowhere else"
    );
    expect(SECTION_246_RESULT_DEFINITION).toBe(
      // Review round 2 (P2-1): a conclusion, not a reading or an event.
      "An uncertainty has a result when the evidence states something the work established about it, in whole or in part: a conclusion the evidence draws, not only a reading or event it records. That uncertainty gets its own paragraph. An observation that settles nothing on its own (a reading, a failure seen in one run) does not by itself give an uncertainty a result: where that uncertainty has no other result, the observation goes in the paragraph for the uncertainties with no result."
    );
    // Review round 2 (P2-2): the shared paragraph's gap covers the hypotheses
    // of those uncertainties, and PROJECT STATUS covers only the others.
    // Review round 3 (P3-3): the first branch, and the next period's plan for every uncertainty.
    // Review round 4 (wording P3-6): only where the evidence says something remains open.
    expect(SECTION_246_STATUS_WITH_RESULTS).toBe(
      "For the uncertainties with results only (any paragraph for the rest already covers those), where the evidence says something remains open: "
    );
    expect(SECTION_246_NEXT_PERIOD_PLAN).toBe(
      "Where the evidence says the work continues and gives a plan, describe the planned approach for the next fiscal period, for every uncertainty it covers."
    );
    // Review round 2 (P2-3): the close claims nothing learned where nothing was.
    expect(SECTION_246_GOAL_CLOSE).toContain(
      // Review round 3 (P3-4): no second sentence that the work continues.
      "Where no uncertainty has a result, name the project goal in one sentence and, only where the evidence gives a plan, tie the planned work above to it without restating the plan; claim no knowledge gained or applied."
    );
    expect(SECTION_246_NO_FINDING_PARAGRAPH).toBe(
      ` These paragraphs are for the uncertainties the evidence reports a result for. ${SECTION_246_RESULT_DEFINITION} Where the evidence reports no result for an uncertainty, ${SECTION_246_NO_RESULT}.`
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain(SECTION_246_NO_FINDING_PARAGRAPH);
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("Where the evidence gives a finding but not the whole result, state what it does establish");
    // (P2-5) the opening's no-result branch comes after its other sentences and replaces them.
    expect(SECTION_246_OVERALL_NOTHING_LEARNED).toBe(
      " Where the evidence reports no result for any uncertainty, write none of the above: open instead with the knowledge the work sought, then any observation the evidence states, then a single [GAP: ...] for whatever of the results and status the evidence does not give, which also covers the hypothesis and how far the objective was met."
    );
    expect(SECTION_246_OVERALL_ADVANCEMENT).toContain(
      // Review round 3 (P2-2): the opening asks for no hypothesis result of its own.
      `where it does not, say nothing about that hypothesis here: the gap in that uncertainty's paragraph, or in the paragraph for the uncertainties with no result, asks for it.${SECTION_246_OVERALL_NOTHING_LEARNED} This ties back directly to Section 242.`
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
      expect(prompt).toContain(`${SECTION_246_NEXT_PERIOD_PLAN} ${SECTION_246_STATUS_NO_RESULT} ${SECTION_246_STATUS_ONLY_FROM_EVIDENCE}\n`);
      expect(prompt).toContain("**TECHNOLOGICAL ADVANCEMENTS (one paragraph per uncertainty from 242 that the evidence reports a result for):**");
      expect(prompt).toContain("one per uncertainty the evidence reports a result for, never padded to a count");
      expect(prompt).toContain("the specific technological advancements (one per uncertainty the evidence reports a result for)");
    }
    expect(SECTION_246_STATUS_NO_RESULT).toBe(
      "Where no uncertainty has a result, add the next period's plan only where the evidence gives one: the single gap above already asks for the status."
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
    expect(QA_246_OPENING_NOTE).toContain("or, where the evidence reports no result for any uncertainty, with the knowledge the work sought, then any observation the evidence states and a single [GAP: ...] for whatever of the results and status the evidence does not give. Do NOT apply the advancement-paragraph opener rule to it.");
    expect(buildQaSystemPrompt()).toContain(QA_246_OPENING_NOTE);
    expect(buildQaSystemPrompt(SHIPPED_DEFAULT)).toContain(QA_WAIVED_OPENERS_NOTHING_LEARNED);
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_NOTHING_LEARNED_YET);
    expect(buildSectionStructureRules()).toContain(CHAT_NOTHING_LEARNED);
    // Review round 2 (P3-6): with no result at all, the shared paragraph opens the Line.
    expect(RULES_REPORT_SKELETON).toContain("the uncertainties with no result share one paragraph after them, or, when none has a result, that paragraph opens the Line in place of the overall advancement: what the work set out to learn, any observation the evidence states and a single gap for whatever of the results and status the evidence does not give");
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
      // After the live rerun (R2, R4b): validation checks and thresholds, and no plan estimates.
      "Describe in full the work the evidence reports for the report's uncertainties, in the order it was done: the work plan steps, what was built, what was tested and where, the validation checks and the thresholds set, and what was measured or monitored. A missing result is one [GAP: ...], never a reason to leave out work that was done. Never present listed or planned work as done unless the evidence says it was done. A work plan's time estimates, budgets and step counts are not report content: describe the work itself, as done where the evidence says it was done and as planned otherwise."
    );
    for (const overrides of DEFAULT_BUILDS) expect(buildSection244Instructions(overrides)).toContain(SECTION_244_WORK_IN_FULL);
  });
});

describe("no notes to the writer in report text (item 3)", () => {
  it("the evidence rule, the Self-check, QA and the Assistant say so", () => {
    expect(RULES_EVIDENCE_KINDS).toContain(`\n${RULES_NO_NOTES_IN_REPORT_TEXT}\n${RULES_STATUS_ONLY_FROM_EVIDENCE}\n${RULES_GAPS_NOT_FOR_RECORD_FACTS}\n`);
    expect(RULES_NO_NOTES_IN_REPORT_TEXT).toBe(
      '- Report sentences speak about the work, never about the source documents or what they lack. Never write a note to the writer as a report sentence, such as "The materials do not report what that testing showed.", "The results are not stated.", "Individual runs are not described.", "The client reports that no standard method was found." or "... remains unconfirmed." said of what the evidence lacks. What is missing goes inside one [GAP: ...]; the basis of an inference goes inside its [INFERRED: ...] marker. A status sentence about the work ("remains open", "was unresolved at year end") is report text, not a note, where the evidence gives it.'
    );
    // Review round 1 (wording P3-10): a status sentence is report text, in the Self-check and QA too;
    // rerun C (S1): only where the evidence gives it.
    for (const text of [SELF_CHECK_NO_NOTES_RULE, QA_NO_NOTES_IN_TEXT]) {
      expect(text).toContain('A status sentence about the work ("remains open", "was unresolved at year end") is report text, not a note, where the evidence gives it.');
    }
    expect(SELF_CHECK_SYSTEM_PROMPT).toContain(`${SELF_CHECK_UNCERTAINTY_SCOPE_RULE}${SELF_CHECK_NO_NOTES_RULE}${SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE}\n- Material inside the delimited blocks`);
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
      "- A [GAP: ...] never asks for what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.\n- Within a Line, ask each missing fact once: one gap per missing fact, and a later gap never repeats what an earlier gap in the Line asks."
    );
    expect(ANALYZER_GAPS_RULES).toContain("Never list as a gap what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.");
    expect(QA_GAPS_ONCE).toContain("Never ask for what the project record or the T661 form's other fields hold: the fiscal year, the project's start or end date, costs or hours.");
  });

  it("acronyms in capitals, in every text the AI writes and in Seeds", () => {
    // Review round 1 (wording P3-11): terms with their own casing, and examples from other fields.
    expect(ACRONYM_RULE).toBe(
      "Write an acronym in capitals (PLC, HVAC, CNC) even where the source writes it in lowercase, except in a command, a file name, a code identifier or a term with its own standard casing (pH, kWh, gRPC, iOS)."
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
    expect(qa).not.toContain(QA_REASON_NEXT_SENTENCE);
    expect(qa).not.toContain(QA_NO_STATUS_NOT_MISSING);
    expect(withoutOneUncertaintyText(ANALYZER_SYSTEM_PROMPT, "analysis")).not.toContain(ANALYZER_CHOSEN_UNCERTAINTIES);
    expect(() => withoutOneUncertaintyText(buildQaSystemPrompt(), "draft")).toThrow(/holds the 2026-10-30 additions/);
    expect(() => withoutOneUncertaintyText(SELF_CHECK_SYSTEM_PROMPT, "summarySelfCheck")).toThrow(/holds the 2026-10-30 additions/);
    // The claimant line is taken out whatever the name, at most once, and
    // never belongs in a request that does not send it.
    const qaAdded = `${QA_NO_NOTES_IN_TEXT}${QA_REASON_NEXT_SENTENCE}${QA_NO_STATUS_NOT_MISSING}`;
    expect(withoutOneUncertaintyText(`x${qaAdded}${claimantBlock("[CLIENT_1]")}`, "qa")).toBe("x");
    expect(withoutOneUncertaintyText(`x${qaAdded}${claimantBlock(COMPANY)}`, "qa")).toBe("x");
    expect(() => withoutOneUncertaintyText(`x${qaAdded}${claimantBlock(COMPANY)}${claimantBlock("[CLIENT_1]")}`, "qa")).toThrow(/holds the 2026-10-30 additions/);
    // Rerun C: a QA request without one of its new lines is refused too.
    expect(() => withoutOneUncertaintyText(`x${QA_NO_NOTES_IN_TEXT}${QA_REASON_NEXT_SENTENCE}`, "qa")).toThrow(/holds the 2026-10-30 additions/);
    expect(() => withoutOneUncertaintyText(`x${claimantBlock("[CLIENT_1]")}`, "compression")).toThrow(/holds the 2026-10-30 additions/);
    // A Seed request is told apart by its own heading, and may hold the line.
    expect(withoutOneUncertaintyText(`# SEED REQUEST\n\nguidance${claimantBlock("[CLIENT_1]")}`, "none")).toBe("# SEED REQUEST\n\nguidance");
  });
});

// ─── After the live rerun (2026-10-30) ──────────────────────────────────────

describe("after the live rerun: no hedge by attribution (R1)", () => {
  it("the Single draft and Compare Self-check fails an attribution hedge, as Summary mode does; the repair is told the same", () => {
    expect(SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE).toBe(
      // Review round 4 (wording P3-8): only for a fact that needs a hedge;
      // review round 5 (P2-1): the same entries check 2 fails a flat claim for.
      "\n- Where a fact needs a hedge (its Confidence Map entry is unresolved or unreliable), the hedge states the uncertainty or the range itself. A sentence that names where such a fact came from (the client, the company, the team, an interviewee, an interview, a document, or the claimant by name) is not a hedge: fail it like a flat claim. For a confidence verdict that is not applied, repairGuidance asks for the uncertainty itself, or for one [GAP: ...] or [INFERRED: ...] marker, never for a source or an attribution."
    );
    expect(SELF_CHECK_SYSTEM_PROMPT.split(SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE)).toHaveLength(2);
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).not.toContain(SELF_CHECK_NO_ATTRIBUTION_HEDGE_RULE);
    expect(REPAIR_NO_ATTRIBUTION_HEDGE).toBe(
      ' Hedge by stating the uncertainty or the range itself, or leave one [GAP: ...]: never by attributing the fact to a source ("The client states that...", "The company reports that...").'
    );
    expect(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix).toContain(`never state it flatly.${REPAIR_NO_ATTRIBUTION_HEDGE} Return ONLY the revised section text.`);
  });

  it("the notes check finds the company, the team, the interviewee or the claimant attributing a fact with \"that\"", () => {
    const name = "Quillmere Analytics Ltd.";
    const notes: Array<[string, string]> = [
      ["The company reports that no standard controller handled the load.", "The company reports that"],
      ["The team stated that the jams stopped after the change.", "The team stated that"],
      ["The team reports that the seal failed after 200 cycles.", "The team reports that"],
      ["The interviewee said that two builds failed.", "The interviewee said that"],
      ["Quillmere Analytics Ltd. states that no vendor tool fitted the line.", "Quillmere Analytics Ltd. states that"],
      ["Quillmere Analytics notes that the second line ran faster.", "Quillmere Analytics notes that"],
      ["[CLIENT_1] reported that the jam rate fell.", "[CLIENT_1] reported that"],
    ];
    for (const [text, phrase] of notes) {
      expect([text, findNotesToWriter(text, { claimantName: name }).map((hit) => hit.phrase)]).toEqual([text, [phrase]]);
    }
    const clean = [
      "The team reported the fault to the vendor.",
      "The company states its tolerances on every order sheet.",
      "The team noted the jam rate on each shift.",
      "Quillmere Analytics Ltd. reported the fault to the vendor.",
      "The supplier states that its sensors read to 0.1 degrees.",
      // Review round 4 (wording P2-2): the team noting or saying what the work found describes the work.
      "The team noted that the seal failed after 200 cycles.",
      "The team said that the second build ran faster.",
    ];
    for (const text of clean) expect([text, findNotesToWriter(text, { claimantName: name })]).toEqual([text, []]);
    // Without the name, the claimant's own name is not read; the generic subjects still are.
    expect(findNotesToWriter("Quillmere Analytics Ltd. states that no vendor tool fitted the line.")).toEqual([]);
    expect(sectionDeterministicFindings("s242", "Quillmere Analytics Ltd. states that no vendor tool fitted the line.", NO_STYLE_OVERRIDES, { claimantName: name })
      .filter((finding) => finding.check === "note_to_writer")).toHaveLength(1);
  });

  it("the Self-check's Locked row reads the claimant's name", () => {
    const profile = { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] } as unknown as OrderedProfileContext;
    const before = runDeterministicSelfCheck({
      section: "242",
      text: "Quillmere Analytics Ltd. states that no vendor tool fitted the line.",
      brief: null,
      profile,
      isFirstInOrder: true,
      claimantName: "Quillmere Analytics Ltd.",
    });
    expect(before.entries.find((entry) => entry.key === NOTES_TO_WRITER_KEY)?.row.reason).toBe(
      'a note to the writer in paragraph 1 ("Quillmere Analytics Ltd. states that")'
    );
  });
});

describe("after the live rerun: one underlying uncertainty, in the analysis and the Storyline (R2)", () => {
  it("the Brief's Storyline frames the one main uncertainty as the shared problem", () => {
    expect(BRIEF_STORYLINE_MAIN_UNCERTAINTY).toBe(
      // Review round 4 (wording P2-3): a count without a name, and as specific as the evidence allows;
      // review round 5 (P3-4): each chosen uncertainty, "the one question" only for a count of one.
      ' When the writer\'s notes give only a count (for example "one main uncertainty") and do not name which, the Storyline frames each chosen uncertainty as the underlying technological problem its related challenges share, not the narrowest of them (for a count of one, the one question the work set out to answer), stated as specifically as the evidence allows (the technical question, the conditions, why standard practice does not answer it), never as the project goal: its related challenges are parts of it, the work on them (validation checks, thresholds and measurements included) stays in the Storyline, and a challenge related to no chosen uncertainty stays out.'
    );
    expect(BRIEF_SYSTEM_PROMPT).toContain(`with the exact supporting quote from the evidence.${BRIEF_STORYLINE_MAIN_UNCERTAINTY}\n2. Claim Exclusions:`);
  });
});

describe("after the live rerun: Line 246 says the work continues only where the evidence does (R3)", () => {
  it("in PROJECT STATUS, the shared paragraph, the advancement paragraphs and the goal close", () => {
    expect(SECTION_246_STATUS_ONLY_FROM_EVIDENCE).toBe(
      "Say the work continues, or describe a plan for the next period, only where the evidence says the work continues, and never say a question remains open unless the evidence says so. Where the evidence gives no status, the gaps already in the Line ask for it; add none here, and never ask about the next period in a gap of its own."
    );
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("Then it says what remains open, where the evidence says so.");
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("and say plainly what remains open where the evidence says so.");
    expect(SECTION_246_ADVANCEMENT_RULES).not.toContain("remains open.\"`");
    expect(SECTION_246_GOAL_CLOSE).toContain("and say what work continues only where the evidence says the work continues, unless PROJECT STATUS already said so.");
    // Review round 4 (wording P3-7): the first Good example infers nothing open.
    expect(SECTION_246_ADVANCEMENT_RULES).toContain("The uncertainty was resolved for those species and conditions.\"");
    expect(SECTION_246_ADVANCEMENT_RULES).not.toContain("is still open");
  });
});

describe("after the live rerun: Line 244's hypothesis and work plan (R4)", () => {
  it("never leaves the hypothesis as a gap, and builds a marked one from the stated approach; QA accepts it", () => {
    expect(SECTION_244_HYPOTHESIS_NEVER_A_GAP).toBe(
      "- Never put the hypothesis itself in a [GAP: ...]: a hypothesis is the expectation behind the stated approach, not an event. Write it in if/then form from the stated objective and approach, in a form the rules above allow: a prediction only where the evidence gives its reason, otherwise the exploratory form. Add no outcome, figure or reason the evidence does not give. Where the evidence states no hypothesis, write one from the stated approach and mark it straight after with [INFERRED: built from the stated approach; confirm the expected outcome with the client]."
    );
    expect(SECTION_244_HYPOTHESIS_RULES).toContain(SECTION_244_HYPOTHESIS_NEVER_A_GAP);
    // The measure of success may still be a gap (2026-10-29, third, item 1c).
    expect(SECTION_244_HYPOTHESIS_RULES).toContain("write [GAP: the measure or target that would show success]");
    expect(RULES_EVIDENCE_KINDS).toContain("and for a hypothesis built from the stated approach where the evidence states none.");
    expect(QA_HYPOTHESIS_CHECK).toContain(
      "- Where the evidence states no hypothesis, one built from the stated objective and approach and marked [INFERRED: built from the stated approach; ...] is correct: do not deduct for it, or call it unsupported for lack of a stated hypothesis. A hypothesis left as a [GAP: ...] is missing: flag it."
    );
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_HYPOTHESIS_CHECK);
  });
});

describe("after the live rerun: the BECAUSE check reads a gap or a cause in the next sentence (R6b)", () => {
  it("passes an uncertainty whose reason is a gap or the next sentence, and still fails one with neither", () => {
    const text = [
      "It was uncertain whether a fixed step could hold the line speed. [GAP: why the standard step falls short here]",
      "It was uncertain whether the sensor could read through the film. This is because the film scatters the beam.",
      "It was uncertain whether the jam rate would fall. Because the belts stretch, the gap between parts changes.",
      "It was uncertain whether the labels would hold at low temperatures. Given that the rooms run at 2 degrees, the glue may set late.",
      // Review round 4 (wording P2-1): a gap counts only when it asks why.
      "It was uncertain whether the [GAP: which controller] could keep pace.",
      "It was uncertain whether the controller could hold [GAP: the setpoint tolerance] under door loads.",
      "It was uncertain whether the controller could hold the speed [GAP: why the standard step falls short at this speed].",
      "It was uncertain whether the line could run at full speed after a jam. The team ran three builds.",
    ].join("\n\n");
    expect(checkBecauseClauses(text).details.map((detail) => detail.hasBecause)).toEqual([true, true, true, true, false, false, true, false]);
    // The count of uncertainty statements, which the report checks read, is unchanged.
    expect(checkBecauseClauses(text).uncertaintyCount).toBe(8);
    // A cause in another paragraph does not count.
    expect(checkBecauseClauses("It was uncertain whether the line could run at full speed.\n\nBecause the belts stretch, parts drift.").withBecause).toBe(0);
  });
});

describe("after the live rerun: QA never deducts the gap for the reason (R6a), and gaps once in a Line (R7)", () => {
  it("says so", () => {
    expect(QA_STANDARD_APPROACH_CHECK).toContain("never deduct because the reason the standard approach falls short is a [GAP: ...]");
    // Review round 4 (wording P3-5): no cap of one gap per paragraph; review round 5 (P3-5): said once.
    expect(RULES_EVIDENCE_KINDS).toContain("- Within a Line, ask each missing fact once: one gap per missing fact, and a later gap never repeats what an earlier gap in the Line asks.");
    expect(RULES_EVIDENCE_KINDS).not.toContain("at most one [GAP: ...]");
    expect(GENERAL_PRACTICE_SCOPE).toContain("When the company's own approach is itself a standard mechanism, never present it as common practice that handles the problem");
  });
});

// ─── Review round 4 ─────────────────────────────────────────────────────────

describe("review round 4: sentence ends in the BECAUSE check (A2)", () => {
  it("does not end a sentence at an abbreviation, an initial or a full stop inside a marker", () => {
    const pass = [
      "It was uncertain whether the controller supplied by Acme Inc. could hold the speed. Because the belts stretch, the load varies.",
      "It was uncertain whether a sensor, e.g. the optical one, could read through film. This is because the film scatters light.",
      "It was uncertain whether the design by J. Ortiz could hold the load. Given that the frame flexes, the load shifts.",
      "It was uncertain whether the labels would hold. [GAP: why. Ask the client which glue the line used.]",
      "It was uncertain whether the [GAP: which sensor. Ask the client.] could read through film. Because the film scatters light, readings drift.",
      "It was uncertain whether line No. 4 could run unattended. Because its feeder jams, parts stall.",
    ];
    for (const text of pass) expect([text, checkBecauseClauses(text).details.map((detail) => detail.hasBecause)]).toEqual([text, [true]]);
    const fail = [
      "It was uncertain whether the controller supplied by Acme Inc. could hold the speed. The team ran three builds.",
      "It was uncertain whether a sensor, e.g. the optical one, could read through film. The film was replaced.",
      "It was uncertain whether the labels would hold. [GAP: the glue the line used. Ask the client.]",
    ];
    for (const text of fail) expect([text, checkBecauseClauses(text).details.map((detail) => detail.hasBecause)]).toEqual([text, [false]]);
  });
});

describe("review round 4: a short claimant name (A3)", () => {
  it("is read as written between word edges, and its letters elsewhere are left alone", () => {
    const options = { claimantName: "AB Ltd." };
    expect(findNotesToWriter("AB states that the load fell.", options).map((hit) => hit.phrase)).toEqual(["AB states that"]);
    expect(findNotesToWriter("AB Ltd. reported that the load fell.", options).map((hit) => hit.phrase)).toEqual(["AB Ltd. reported that"]);
    for (const text of [
      "CAB reports that the load fell.",
      "The ab reports that came in were late.",
      "Line AB reported the fault to the vendor.",
      "The AB-12 valve reports that it is open.",
    ]) {
      expect([text, findNotesToWriter(text, options)]).toEqual([text, []]);
    }
    // A short name that is also a common word is matched only as written.
    const shortWord = { claimantName: "IT Ltd." };
    expect(findNotesToWriter("IT states that the seal held.", shortWord).map((hit) => hit.phrase)).toEqual(["IT states that"]);
    expect(findNotesToWriter("The standard is plain: it states that a seal must hold for 200 cycles.", shortWord)).toEqual([]);
  });
});

describe("review round 5", () => {
  it("ends a sentence at a capital or an abbreviation when a sentence opener follows (P3-2)", () => {
    const fail = [
      "It was uncertain whether the loop held under load B. The rig ran at 40 C because the room was warm.",
      "It was uncertain whether the controller could hold the speed set by Acme Inc. The team ran three builds. Because the belts stretch, the load varies.",
      "It was uncertain whether the seals, gaskets, etc. would hold. The team ran three builds. Because the belts stretch, the load varies.",
    ];
    for (const text of fail) expect([text, checkBecauseClauses(text).details.map((detail) => detail.hasBecause)]).toEqual([text, [false]]);
    const pass = [
      "It was uncertain whether the controller supplied by Acme Inc. could hold the speed. Because the belts stretch, the load varies.",
      "It was uncertain whether the design by J. A. Ortiz could hold the load. Because the frame flexes, the load shifts.",
      "It was uncertain whether the loop held under load B. Because the rig ran warm, readings drifted.",
    ];
    for (const text of pass) expect([text, checkBecauseClauses(text).details.map((detail) => detail.hasBecause)]).toEqual([text, [true]]);
  });

  it("counts a gap as asking why only for the whole word (P3-3)", () => {
    const text = [
      "It was uncertain whether the seal could last [GAP: a reasonable cycle count] under door loads.",
      "It was uncertain whether the seal could last under door loads. [GAP: a reasonable cycle count]",
      "It was uncertain whether the seal could last under door loads [GAP: the reasons the standard gasket fails here].",
      "It was uncertain whether the seal could last under door loads. [GAP: what caused the early failures]",
    ].join("\n\n");
    expect(checkBecauseClauses(text).details.map((detail) => detail.hasBecause)).toEqual([false, false, true, true]);
  });
});

describe("rerun C at 999cefd3 (S1 to S3)", () => {
  it("S1: every Line says a question remains open, or the work continues, only where the evidence says so", () => {
    expect(RULES_STATUS_ONLY_FROM_EVIDENCE).toBe(
      // Review round 6 (P3-2): a Line may hold no gap for the results.
      "- In any Line, say a question remains open, or that the work continues, only where the evidence says so; where it gives no status, write none, and add no gap for the status alone (a gap that asks for the results covers it)."
    );
    for (const overrides of EVERY_BUILD) {
      expect(buildSharedWritingRules(overrides)).toContain(RULES_STATUS_ONLY_FROM_EVIDENCE);
      expect(buildChatSystemPromptV2(overrides)).toContain(RULES_STATUS_ONLY_FROM_EVIDENCE);
    }
    // Line 246 keeps its own fuller rule for PROJECT STATUS.
    expect(buildSection246Instructions(NO_STYLE_OVERRIDES)).toContain(SECTION_246_STATUS_ONLY_FROM_EVIDENCE);
  });

  it("S2: Line 242 draws no conclusion about the named methods beyond the reasons the evidence gives", () => {
    expect(SECTION_242_NO_UNSOURCED_CONCLUSION).toBe(
      "Never add a sentence concluding that the named methods, together or alone, give no known way to do the work, other than step 3's closing sentence where the evidence gives its reasons: say why they fall short only from the evidence, or leave it to the one gap."
    );
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(
      "3. Where the evidence gives the reasons in step 2, close with one sentence on what that means for available knowledge, tied to the approaches you named and claiming no more than those reasons show, such as that they did not provide a known method for what this project needed."
    );
    expect(SECTION_242_STANDARD_APPROACH_RULES).toContain(`${GENERAL_PRACTICE_SCOPE} ${SECTION_242_NO_UNSOURCED_CONCLUSION} Facts the evidence gives`);
    expect(QA_NO_UNSOURCED_CONCLUSION).toBe(
      "\n- Flag and deduct for a sentence concluding that the named methods, together or alone, give no known way to do the work where the evidence gives no reason that shows it. Where the reason is a [GAP: ...], a missing closing sentence on knowledge is correct: do not deduct for it."
    );
    expect(QA_STANDARD_APPROACH_CHECK.endsWith(QA_NO_UNSOURCED_CONCLUSION)).toBe(true);
    for (const overrides of EVERY_BUILD) expect(buildQaSystemPrompt(overrides)).toContain(QA_NO_UNSOURCED_CONCLUSION);
  });

  it("S3: QA reads a reason in the next sentence, a status the evidence does not give, and source-stated claims as the rules do", () => {
    expect(QA_REASON_NEXT_SENTENCE).toBe(
      // Review round 6 (P3-3): it never overturns the computed result.
      " The detection already counts a next sentence that opens with those words. Outside that detection, a reason given in the sentence right after an uncertainty, in any words, counts as its BECAUSE: never deduct in another check for a missing reason that sentence gives."
    );
    expect(QA_NO_STATUS_NOT_MISSING).toBe(
      "\n- Never deduct for a missing status or next-steps paragraph when the evidence gives no status and a gap in the report asks for it."
    );
    expect(QA_SOURCE_FAITHFULNESS).toContain(
      "Before calling a claim unsupported, look for it in the source evidence: a claim the source evidence states is supported, even where the analysis leaves it out."
    );
    for (const overrides of EVERY_BUILD) {
      const qa = buildQaSystemPrompt(overrides);
      expect(qa).toContain(`Trust these results; do not re-evaluate them.${QA_REASON_NEXT_SENTENCE}\n`);
      expect(qa).toContain(QA_SOURCE_FAITHFULNESS);
    }
    // Where the built-in skeleton is checked, the missing status paragraph is not deducted.
    for (const overrides of DEFAULT_BUILDS) {
      expect(buildQaSystemPrompt(overrides)).toMatch(/- Does Section 246 cover, in this order: [^\n]*\?\n- Never deduct for a missing status or next-steps paragraph/);
    }
    for (const overrides of EVERY_BUILD.filter((build) => build.reportSkeleton)) {
      expect(buildQaSystemPrompt(overrides)).not.toContain(QA_NO_STATUS_NOT_MISSING);
    }
  });
});

describe("review round 6", () => {
  it("Line 244, the Assistant and the skeleton ask for the year-end status only where the evidence gives it (P2-1)", () => {
    expect(SECTION_244_YEAR_END_CLOSE).toBe(
      "Close Line 244 with where the work stood at the end of the fiscal year, only where the evidence gives it; where it gives none, end with the last experiment, and write no status sentence and no gap for it alone."
    );
    for (const overrides of DEFAULT_BUILDS) expect(buildSection244Instructions(overrides)).toContain(SECTION_244_YEAR_END_CLOSE);
    expect(CHAT_EXPERIMENT_ORDER.endsWith("), then the year-end status, only where the evidence gives it")).toBe(true);
    for (const overrides of DEFAULT_BUILDS) expect(buildChatSystemPromptV2(overrides)).toContain(CHAT_EXPERIMENT_ORDER);
    expect(RULES_REPORT_SKELETON).toContain("and ending with what was learned or what stayed unresolved → the year-end status, where the evidence gives it.\n");
  });

  it("a hyphenated word after an abbreviation is not a sentence opener (P3-4)", () => {
    const text = "It was uncertain whether the A-frame mount, e.g. A-frame rigs, could hold because of vibration.";
    expect(checkBecauseClauses(text).details.map((detail) => detail.hasBecause)).toEqual([true]);
    // An opener that is a whole word still ends the sentence.
    const split = "It was uncertain whether the frame held, e.g. A frame of steel. It shook because of vibration.";
    expect(checkBecauseClauses(split).details.map((detail) => detail.hasBecause)).toEqual([false]);
  });
});
