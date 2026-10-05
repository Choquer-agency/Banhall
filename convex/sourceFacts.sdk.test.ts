/// <reference types="vite/client" />
/**
 * 2026-10-04 (second): figures stay with their group, and no detail beyond
 * the sources.
 *
 * Release suite run of 2026-10-04 (fixture "writer-settings-document",
 * fictional Velloway powder on MDF): Line 244 said the deep cove profile fell
 * short "on 4 percent of its panels", although 4 percent was the rate over all
 * 600 pilot panels and the deep cove rate was 13 percent of 180; and it said
 * the datasheet values were "developed for flat steel panels", although the
 * sources say only flat panels ("steel" belongs to the engineer's background
 * and to standard powder). The Self-check never saw the sources, so it could
 * not catch either.
 *
 * Every test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The data reuses the fixture's fictional Velloway facts.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { parseTranscriptAnalysis } from "./ai/analyzerAgent";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import {
  draftCheckedSection,
  FACTS_INSTRUCTION,
  reportFactsBlock,
} from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  FACTS_BREAK_UNLOCATED_REASON,
  PLAN_FACTS_NOT_CHECKED_REASON,
  sourceFactsBody,
} from "./ai/selfCheck";
import {
  buildFrozenSummaryPlan,
  FACTS_MATCH_SOURCES_RULE_ID,
  RESULTS_AGAINST_TARGETS_RULE_ID,
} from "./lib/seedRevisions";
import { renderBriefBlock } from "./lib/briefRender";
import type { OrderedPayload } from "./lib/orderedChain";
import { FACT_RULES } from "../shared/humanProse";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";
const SUMMARY_VERSION = "summary-version-velloway" as Id<"summaryVersions">;

beforeAll(async () => {
  await import("./modelCatalog");
  await import("./providerCredit");
});
beforeEach(() => {
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── The fictional Velloway sources, plan and Brief ───────────────────────

/** What drafting read: the transcript analysis (fictional). */
const ANALYSIS = {
  company_context:
    "Velloway Panel Finishing finishes MDF cabinet doors on a solvent-borne lacquer line. Its process engineer spent eight years on automotive powder lines for steel parts.",
  project_goal: "Powder coat 25 mm routed MDF doors at 2.5 metres per minute.",
  business_problem: "Two large customers asked for a powder finish.",
  scientific_technical_problem:
    "Normal powder for steel cures at 160 to 200 C, and MDF outgasses above about 120 C.",
  technological_objective: "Edge coverage of at least 60 microns without outgassing defects.",
  work_performed: {
    experiments_iterations: [
      {
        problem_addressed: "Whether the supplier's datasheet process works on routed MDF.",
        approach: "Trial 1: IR preheat to 110 C and a 135 C air cure for 10 minutes.",
        results: "Board peaked at 131 C; 14 outgassing defects per square metre; edges 35 microns.",
        conclusions: "The datasheet cure numbers are for thin flat panels, and defects track peak board temperature.",
      },
      {
        problem_addressed: "Whether the process holds at line speed.",
        approach: "Trial 5: a production pilot of 600 doors, 420 shaker and 180 deep cove.",
        results:
          "Outgassing defects averaged 0.9 per square metre. 4 percent of all 600 panels had edge coverage below 60 microns, and every one of them was a deep cove panel. By profile: no shaker panel and 24 of the 180 deep cove panels (13.3 percent) fell below 60 microns.",
        conclusions: "Shaker edges are ready; the deep cove edge is still open.",
      },
    ],
  },
  project_status: "Shaker doors ready; deep cove edge coverage open for fiscal 2027.",
};
const STORYLINE = "The pilot showed the shaker profile met edge coverage while the deep cove profile did not.";
const CONFIDENCE = [
  { text: "The cause of the deep cove shortfall, a shielding effect of the concave cove, is suspected, not shown.", confidence: "partial" },
];
const BRIEF = {
  storylineText: STORYLINE,
  claimExclusions: [],
  confidenceMap: CONFIDENCE.map((entry, index) => ({ ...entry, entryId: `entry-${index}` })),
  glossaryTerms: [],
};
const BRIEF_BLOCK = renderBriefBlock(STORYLINE, CONFIDENCE.map((entry) => ({ group: "confidenceMap" as const, ...entry })));

const ITEM_TRIAL_1 = "item-velloway-trial-1" as Id<"summaryItems">;
const ITEM_PILOT = "item-velloway-pilot" as Id<"summaryItems">;
const TRIAL_1 = "Trial 1 used the supplier's datasheet preheat and cure settings on routed MDF panels.";
const PILOT = "The production pilot ran 600 doors at line speed, shaker and deep cove.";

/** Line 244 of a signed-off plan, with the facts and targets checks as admitted. */
function plan244(options: { facts?: boolean } = {}) {
  return buildFrozenSummaryPlan({
    section: "s244",
    items: [
      { itemId: ITEM_TRIAL_1, roleId: "experimentation", kind: "multiple", bullets: [TRIAL_1], support: "source_supported" },
      { itemId: ITEM_PILOT, roleId: "experimentation", kind: "multiple", bullets: [PILOT], support: "source_supported" },
    ],
    skippedRoleIds: [],
    resultsAgainstTargets: true,
    ...(options.facts === false ? {} : { factsMatchSources: true }),
  });
}

function claimFor(plan?: ReturnType<typeof plan244>) {
  return {
    projectId: "project-velloway",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 1,
    isFirstInOrder: false,
    priorSections: [],
    briefBlock: BRIEF_BLOCK,
    brief: BRIEF,
    planBlock: plan ? `\n\n${plan.block}` : "",
    planChecksBlock: plan?.checksBlock ?? "",
    planChecks: plan?.checks ?? [],
    editedTerms: [],
    droppedNotChecked: [],
    answers242: null,
    workAnswers242: null,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

function payload(summaryVersionId?: Id<"summaryVersions">): OrderedPayload {
  return {
    analysis: JSON.stringify(ANALYSIS),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    orderedContext: {
      profileState: "missing",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [],
    },
    frozenStyleGuidance: "",
    ...(summaryVersionId ? { summaryVersionId } : {}),
  } as OrderedPayload;
}

// The two errors of the 2026-10-04 run, in fictional text.
const DRAFT_244 = [
  "Trial 1 ran the supplier's datasheet process on the routed MDF panels, preheating to 110 C and curing at 135 C air. This showed the datasheet values, developed for flat steel panels, did not transfer to thick routed MDF.",
  "Trial 5, a production pilot of 600 doors at line speed, held outgassing defects to 0.9 per square metre. The shaker profile met the 60 micron edge coverage target on all panels; the deep cove profile fell short of that target on 4 percent of its panels.",
].join("\n\n");
const REPAIRED_244 = [
  "Trial 1 ran the supplier's datasheet process on the routed MDF panels, preheating to 110 C and curing at 135 C air. This showed the datasheet values, developed for thin flat panels, did not transfer to thick routed MDF.",
  "Trial 5, a production pilot of 600 doors at line speed, held outgassing defects to 0.9 per square metre. The shaker profile met the 60 micron edge coverage target on all panels; the deep cove profile fell short of it on 13 percent of its 180 panels, 4 percent of all 600 pilot panels.",
].join("\n\n");
// A figure the sources give for the same group, and a rounded figure.
const FAITHFUL_244 = [
  "Trial 1 ran the supplier's datasheet process on the routed MDF panels. The datasheet cure numbers were for thin flat panels and did not transfer.",
  "In the 600-door pilot, no shaker panel fell below 60 microns of edge coverage, while about 13 percent of the 180 deep cove panels did.",
].join("\n\n");

// ─── The stubbed provider ──────────────────────────────────────────────────

type Sent = { stage: string; json: Record<string, unknown>; user: string };

function userOf(json: Record<string, unknown>): string {
  const messages = (json.messages ?? []) as Array<{ role: string; content: unknown }>;
  return messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : Array.isArray(message.content)
          ? message.content.map((block: { text?: string }) => block.text ?? "").join("")
          : "")
    .join("\n");
}

/** Scripts one Section: the draft, the repair, the compression and each Self-check answer, in order. */
function installFetch(script: { draft: string; repair?: string; compressed?: string; checks: unknown[] }): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const stage = tool === "submit_self_check"
        ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction)
          ? "finalCoverage"
          : user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.prefix) ? "followUp" : "selfCheck"
        : tool ?? (user.includes(COMPRESSION_REQUEST.userScaffold.wordsToLimit)
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
      sent.push({ stage, json, user });
      const base = {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
      };
      if (tool === "submit_self_check") {
        const answer = checks.shift();
        if (answer === undefined) throw new Error("No Self-check answer scripted");
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_self_check", name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text = stage === "repair"
        ? script.repair ?? script.draft
        : stage === "compression" ? script.compressed ?? script.draft : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(claim: ReturnType<typeof claimFor>, summaryVersionId?: Id<"summaryVersions">) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: payload(summaryVersionId), section: "244", clientFor });
  });
}

// The Summary Self-check's answers.
const ordinary = [
  { paragraph: 2, check: "storyline", instruction: "storyline", outcome: "applied", reason: "Matches the Storyline." },
  { paragraph: 0, check: "confidence", instruction: "confidence:C1", outcome: "applied", reason: "No cause is stated." },
];
const covered = [
  { itemId: ITEM_TRIAL_1, mergedItemIds: [ITEM_TRIAL_1], paragraph: 1, outcome: "applied", reason: "P1 states Trial 1." },
  { itemId: ITEM_PILOT, mergedItemIds: [ITEM_PILOT], paragraph: 2, outcome: "applied", reason: "P2 states the pilot." },
];
const targetsMet = { ruleId: RESULTS_AGAINST_TARGETS_RULE_ID, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Every comparison matches." };
const FACTS_WRONG_REASON = "P1 adds steel; P2 gives the all-panel 4% as deep cove's";
const FACTS_WRONG_GUIDANCE = "P1: the datasheet is for thin flat panels, not steel. P2: deep cove was 13% of 180; 4% is of all 600.";
const factsWrong = {
  ruleId: FACTS_MATCH_SOURCES_RULE_ID,
  mergedItemIds: [],
  paragraph: 1,
  outcome: "not_applied",
  reason: FACTS_WRONG_REASON,
  repairGuidance: FACTS_WRONG_GUIDANCE,
};
const factsMatch = { ruleId: FACTS_MATCH_SOURCES_RULE_ID, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Figures and details match the sources." };

// The analysis as drafting reads it: parsed, with the analyzer's defaults.
const SOURCE_FACTS = sourceFactsBody({
  analysis: parseTranscriptAnalysis(JSON.stringify(ANALYSIS)),
  storylineText: STORYLINE,
  confidenceMap: CONFIDENCE,
});
const SOURCE_FACTS_BLOCK = `--- BEGIN [SOURCE FACTS] ---\n${SOURCE_FACTS}\n--- END [SOURCE FACTS] ---`;

describe("figures stay with their group, and no detail beyond the sources (real SDK, fetch stubbed)", () => {
  it("shows the Self-check the sources, finds the group error and the invented detail, repairs both and says so on the row", async () => {
    const sent = installFetch({
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, factsWrong, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED_244);

    // Drafting reads the rule, in FACT_RULES' words, right after the Brief.
    const drafting = sent[0]!.user;
    for (const sentence of Object.values(FACT_RULES)) expect(drafting.split(sentence)).toHaveLength(2);
    expect(drafting).toContain(`${BRIEF_BLOCK}${reportFactsBlock()}`);

    // The Self-check reads what the draft was written from, once, right
    // after the plan checks: the all-panel rate and the per-profile rates,
    // and the datasheet's flat panels.
    const check = sent[1]!.user;
    expect(check.split(SOURCE_FACTS_BLOCK)).toHaveLength(2);
    expect(check).toContain(`--- END [CONTENT PLAN CHECKS] ---\n\n${SOURCE_FACTS_BLOCK}`);
    expect(SOURCE_FACTS).toContain("4 percent of all 600 panels had edge coverage below 60 microns, and every one of them was a deep cove panel");
    expect(SOURCE_FACTS).toContain("24 of the 180 deep cove panels (13.3 percent)");
    expect(SOURCE_FACTS).toContain("The datasheet cure numbers are for thin flat panels");
    expect(SOURCE_FACTS).toContain(`Storyline:\n${STORYLINE}`);
    expect(SOURCE_FACTS).toContain(`Confidence Map:\n- (partial) ${CONFIDENCE[0]!.text}`);
    expect(check.split(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction)).toHaveLength(2);
    expect(check).toContain(
      `${SUMMARY_PLAN_SELF_CHECK_REQUEST.resultsAgainstTargets.instruction}${SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction}`
    );
    expect(check).toContain(`"instruction":"match_sources","mergedItemIds":[],"relationshipReferences":[],"roleId":"experimentation","ruleId":"facts_match_sources"`);
    expect(check.endsWith(
      `Return exactly 4 planVerdicts, one for each plan check below:\n- itemId ${ITEM_TRIAL_1}\n- itemId ${ITEM_PILOT}\n- ruleId facts_match_sources\n- ruleId results_against_targets`
    )).toBe(true);
    const tool = (sent[1]!.json.tools as Array<{ input_schema: { properties: { planVerdicts: { items: { properties: Record<string, { enum?: string[] }> } } } } }>)[0]!;
    expect(tool.input_schema.properties.planVerdicts.items.properties.ruleId?.enum)
      .toEqual(["facts_match_sources", "results_against_targets"]);

    // The repair: one fix for the whole section, with every correction the
    // Self-check named; the rules again after the Brief.
    const repair = sent[2]!.user;
    expect(repair).toContain(`- Whole section: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${FACTS_WRONG_GUIDANCE}`);
    expect(repair.split(reportFactsBlock())).toHaveLength(2);

    // The check of the final text reads the same sources and rule.
    const final = sent[3]!.user;
    expect(final.split(SOURCE_FACTS_BLOCK)).toHaveLength(2);
    expect(final).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction);

    // The row says what was wrong, and that the repair fixed it.
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toEqual({
      section: "244",
      source: "model",
      instruction: FACTS_INSTRUCTION,
      outcome: "applied",
      tier: "none",
      reason: `Figures and details match the sources. Fixed by the repair: ${FACTS_WRONG_REASON}`,
      repaired: true,
      planRef: { summaryVersionId: SUMMARY_VERSION, ruleId: FACTS_MATCH_SOURCES_RULE_ID, mergedItemIds: [] },
    });
    expect(FACTS_INSTRUCTION).toBe("State figures and details as the sources give them");
    expect(JSON.parse(result.selfCheck).planCoverage).toEqual({ status: "complete", applied: 4, total: 4 });
  });

  it("records a finding the repair did not fix as not applied, with the final text's reason", async () => {
    const stillWrong = { ...factsWrong, paragraph: 2, reason: "P2 still gives 4% as deep cove's rate", repairGuidance: "Say 13% of 180." };
    installFetch({
      draft: DRAFT_244,
      repair: DRAFT_244.replace("flat steel panels", "thin flat panels"),
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, factsWrong, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, stillWrong, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      instruction: FACTS_INSTRUCTION,
      outcome: "not_applied",
      paragraphIndex: 1,
      reason: "P2 still gives 4% as deep cove's rate",
      repaired: false,
    });
  });

  it("lets a figure for the same group and a rounded figure pass with no repair", async () => {
    const sent = installFetch({
      draft: FAITHFUL_244,
      checks: [{ verdicts: ordinary, planVerdicts: [...covered, factsMatch, targetsMet] }],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    // The rule tells the checker that rounding and the same figure in
    // another form are fine, and never to fail wording alone.
    const check = sent[1]!.user;
    expect(check).toContain(FACT_RULES.allowed);
    expect(check).toContain("Never fail a figure or detail only because the sources word it another way.");
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(result.draftText).toBe(FAITHFUL_244);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "applied",
      reason: "Figures and details match the sources.",
      repaired: false,
    });
  });

  it("never repairs a finding that names no paragraph, and records a missing verdict as not checked", async () => {
    installFetch({
      draft: DRAFT_244,
      checks: [{ verdicts: ordinary, planVerdicts: [...covered, { ...factsWrong, paragraph: 0 }, targetsMet] }],
    });
    const unlocated = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(unlocated.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "not_applied",
      reason: FACTS_BREAK_UNLOCATED_REASON,
      repaired: false,
    });

    const sent = installFetch({
      draft: DRAFT_244,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, targetsMet] },
        { verdicts: [], planVerdicts: [] },
      ],
    });
    const missing = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "followUp"]);
    // The follow-up asks for the facts check alone, with the sources again.
    expect(sent[2]!.user).toContain(SOURCE_FACTS_BLOCK);
    expect(sent[2]!.user.endsWith("- ruleId facts_match_sources\n\nReturn an empty verdicts list: every label already has its verdict.")).toBe(true);
    expect(missing.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "not_applied",
      reason: PLAN_FACTS_NOT_CHECKED_REASON,
      repaired: false,
    });
  });

  it("never makes the facts fix a Must keep line of the repair's compression, so the wrong figure is not protected", async () => {
    const filler = (index: number) =>
      `Paragraph ${index}: the team logged the board temperature on every panel and changed one setting at a time, comparing each run with the one before and noting where the finish changed.`;
    const longRepair = [REPAIRED_244, ...Array.from({ length: 30 }, (_, index) => filler(index + 3))].join("\n\n");
    // Under the Line 244 cap and above the compression floor.
    const compressed = [REPAIRED_244, ...Array.from({ length: 14 }, (_, index) => filler(index + 3))].join("\n\n");
    const sent = installFetch({
      draft: DRAFT_244,
      repair: longRepair,
      compressed,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, factsWrong, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    const compressions = sent.filter((request) => request.stage === "compression");
    expect(compressions.length).toBeGreaterThan(0);
    for (const request of compressions) {
      expect(request.user).toContain(COMPRESSION_REQUEST.mustKeep.prefix);
      expect(request.user).not.toContain(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue);
      expect(request.user).not.toContain(FACTS_WRONG_GUIDANCE);
    }
    expect(result.draftText).toBe(compressed);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID))
      .toMatchObject({ outcome: "applied", repaired: true });
  });

  it("keeps the checked draft when the facts repair loses a signed-off item, and the row still says what was wrong", async () => {
    const lostPilot = REPAIRED_244.split("\n\n")[0]!;
    const pilotLost = { ...covered[1]!, paragraph: 0, outcome: "not_applied", reason: "The pilot is gone." };
    installFetch({
      draft: DRAFT_244,
      repair: lostPilot,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, factsWrong, targetsMet] },
        { verdicts: [], planVerdicts: [covered[0], pilotLost, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(result.draftText).toBe(DRAFT_244);
    const row = result.notes.find((note) => note.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID);
    expect(row).toMatchObject({ outcome: "not_applied", paragraphIndex: 0, repaired: false });
    expect(row?.reason.startsWith(`${FACTS_WRONG_REASON}; repair not used (the repaired text no longer covers the signed-off item "${PILOT}"`)).toBe(true);
  });
});

describe("requests without the facts check are unchanged (real SDK, fetch stubbed)", () => {
  it("sends no SOURCE FACTS block and no facts rule to a Single draft or to a plan frozen without the check", async () => {
    const single = installFetch({ draft: DRAFT_244, checks: [{ verdicts: [] }] });
    await draft(claimFor());
    expect(single.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    for (const request of single) {
      expect(request.user).not.toContain("[SOURCE FACTS]");
      expect(request.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction);
      expect(request.user).not.toContain(FACT_RULES.scope);
    }

    const older = installFetch({
      draft: DRAFT_244,
      checks: [{ verdicts: ordinary, planVerdicts: [...covered, targetsMet] }],
    });
    const result = await draft(claimFor(plan244({ facts: false })), SUMMARY_VERSION);
    expect(older.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(older[1]!.user).not.toContain("[SOURCE FACTS]");
    expect(older[1]!.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction);
    expect(result.notes.some((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toBe(false);
  });
});
