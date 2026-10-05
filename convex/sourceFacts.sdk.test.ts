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
  MAX_SUMMARY_SELF_CHECK_FACTS_GUIDANCE_ESCAPED_UTF8_BYTES,
  MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES,
  RESULTS_AGAINST_TARGETS_RULE_ID,
} from "./lib/seedRevisions";
import { renderBriefBlock } from "./lib/briefRender";
import { sectionMetrics } from "./lib/lineLimits";
import { talksAboutLength } from "./lib/selfCheckRules";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";
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
const STATUS_246 = "Deep cove edge coverage stays open for fiscal 2027.";
/** Every Line's signed-off items, as the frozen plan gives them (claim.planWording). */
const PLAN_WORDING = [[TRIAL_1], [PILOT], [STATUS_246]];

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

function claimFor(
  plan?: { block: string; checksBlock: string; checks: unknown[] },
  extra: Record<string, unknown> = {}
) {
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
    planWording: PLAN_WORDING,
    ...extra,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

function payload(summaryVersionId?: Id<"summaryVersions">, writerFlavor?: string): OrderedPayload {
  return {
    analysis: JSON.stringify(ANALYSIS),
    ...(writerFlavor ? { writerFlavor } : {}),
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

async function draft(
  claim: ReturnType<typeof claimFor>,
  summaryVersionId?: Id<"summaryVersions">,
  options: { section?: SectionNumber; writerFlavor?: string } = {}
) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim,
      payload: payload(summaryVersionId, options.writerFlavor),
      section: options.section ?? "244",
      clientFor,
    });
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
  planWording: PLAN_WORDING,
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
    // Review round 1, P2-1: every Line's signed-off items, not only this Line's.
    expect(SOURCE_FACTS).toContain(`Signed-off plan items, every Line:\n- ${TRIAL_1}\n- ${PILOT}\n- ${STATUS_246}`);
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

// ─── Review round 1 ────────────────────────────────────────────────────────

const ITEM_STATUS = "item-velloway-status" as Id<"summaryItems">;
/** A writer's edit to a Line 244 item that adds a figure the analysis lacks. */
const EDITED_244 = "An edge-only sealer trial on the deep cove panels cut the shortfall to 9 percent.";
/** A Line 246 item of its own with a figure the analysis lacks. */
const STATUS_246_FIGURE = "An edge-only sealer cut the deep cove shortfall to 7 percent; deep cove edge coverage stays open for fiscal 2027.";
const WRITER_FLAVOR = "Write in the third person. The claim year is fiscal 2026.";
const writerProfile = { paragraph: 0, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Third person throughout." };

function plan246(bullet = STATUS_246) {
  return buildFrozenSummaryPlan({
    section: "s246",
    items: [{ itemId: ITEM_STATUS, roleId: "project_status", kind: "standard", bullets: [bullet], support: "source_supported" }],
    skippedRoleIds: [],
    resultsAgainstTargets: true,
    factsMatchSources: true,
  });
}

describe("review round 1: the sources, the guidance, the figure guard and edited terms (real SDK, fetch stubbed)", () => {
  it("P2-1, P2-3 and P3-4: Line 246 reads every Line's signed-off items and the writer's instructions, and a facts repair that drops a figure of its own signed-off item is set aside", async () => {
    const draft246 = [
      "The pilot showed the shaker profile met edge coverage on every panel.",
      "An edge-only sealer cut the deep cove shortfall to 7 percent, and deep cove edge coverage stays open for fiscal 2027.",
    ].join("\n\n");
    const stripped = draft246.replace(" to 7 percent", "");
    const statusCovered = { itemId: ITEM_STATUS, mergedItemIds: [ITEM_STATUS], paragraph: 2, outcome: "applied", reason: "P2 states the open edge." };
    // A wrong verdict: 7 percent is in this Line's own signed-off item.
    const factsWrongFigure = { ...factsWrong, paragraph: 2, reason: "P2 gives 7%, not in the sources", repairGuidance: "Take out the 7 percent figure." };
    const sent = installFetch({
      draft: draft246,
      repair: stripped,
      checks: [{ verdicts: [...ordinary, writerProfile], planVerdicts: [statusCovered, factsWrongFigure, targetsMet] }],
    });
    const result = await draft(
      claimFor(plan246(STATUS_246_FIGURE), { planWording: [[TRIAL_1], [PILOT], [EDITED_244], [STATUS_246_FIGURE]] }),
      SUMMARY_VERSION,
      { section: "246", writerFlavor: WRITER_FLAVOR }
    );
    const check = sent[1]!.user;
    expect(check).toContain(`Signed-off plan items, every Line:\n- ${TRIAL_1}\n- ${PILOT}\n- ${EDITED_244}\n- ${STATUS_246_FIGURE}`);
    expect(check).toContain(`Writer instructions:\n- ${WRITER_FLAVOR}\n--- END [SOURCE FACTS] ---`);
    expect(check).toContain("A figure or detail a signed-off item of any Line gives is supported as that item gives it, for the same thing.");
    // The repair dropped "7 percent", which this Line's own signed-off item
    // gives: it is set aside before any check of its text, and the row says why.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(result.draftText).toBe(draft246);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      section: "246",
      instruction: FACTS_INSTRUCTION,
      outcome: "not_applied",
      repaired: false,
      reason: 'P2 gives 7%, not in the sources; repair not used (the repaired text no longer holds the signed-off figure "7 percent", which the checked draft held, and a repair must keep every figure a signed-off item gives, so the checked draft was kept)',
    });
  });

  it("P2-2: the facts verdict lists every correction, past 90 characters, and the repair gets all of them unclipped", async () => {
    const withCause = DRAFT_244.replace("on 4 percent of its panels.", "on 4 percent of its panels, caused by the shielding of the concave cove.");
    const repaired = REPAIRED_244.replace("4 percent of all 600 pilot panels.", "4 percent of all 600 pilot panels; the shielding of the concave cove is suspected.");
    const threeCorrections =
      "P1: the datasheet numbers are for thin flat panels; drop steel. P2: 4% is of all 600 panels, every one deep cove; deep cove was 24 of 180. P2: the cove shielding is suspected, not shown; say it is suspected.";
    expect(new TextEncoder().encode(threeCorrections).byteLength).toBeGreaterThan(MAX_SUMMARY_SELF_CHECK_GUIDANCE_ESCAPED_UTF8_BYTES);
    const sent = installFetch({
      draft: withCause,
      repair: repaired,
      checks: [
        { verdicts: [...ordinary, writerProfile], planVerdicts: [...covered, { ...factsWrong, repairGuidance: threeCorrections }, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION, { writerFlavor: WRITER_FLAVOR });
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    // The rule and the tool schema both allow the longer guidance.
    const check = sent[1]!;
    expect(check.user).toContain("For this check, repairGuidance lists every correction in the section");
    expect(check.user).toContain("it may run past 90 characters, up to about 380.");
    const guidance = (check.json.tools as Array<{ input_schema: { properties: { planVerdicts: { items: { properties: { repairGuidance: { maxLength: number; description: string } } } } } } }>)[0]!
      .input_schema.properties.planVerdicts.items.properties.repairGuidance;
    expect(guidance.maxLength).toBe(MAX_SUMMARY_SELF_CHECK_FACTS_GUIDANCE_ESCAPED_UTF8_BYTES);
    expect(guidance.description).toContain("For ruleId facts_match_sources, list every correction instead, one after another.");
    // Nothing clips it on its way to the repair.
    expect(sent[2]!.user).toContain(`- Whole section: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${threeCorrections}`);
    // The check of the final text has no WRITER INSTRUCTIONS block, but its
    // SOURCE FACTS still hold the writer's instructions.
    expect(sent[3]!.user).not.toContain("[WRITER INSTRUCTIONS]");
    expect(sent[3]!.user).toContain(`Writer instructions:\n- ${WRITER_FLAVOR}`);
    expect(result.draftText).toBe(repaired);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("Greptile round 1, P1 (PR #26): a facts objection to a claim made with a writer's edited term is repaired, and the term is kept", async () => {
    // "deep cove" is the writer's edited term; the draft uses it for the
    // datasheet panels, a claim no source makes.
    const misused = DRAFT_244.replace("developed for flat steel panels", "developed for deep cove panels");
    const objection = {
      ...factsWrong,
      reason: 'P1 calls the datasheet panels "deep cove", unsupported',
      repairGuidance: 'P1: the datasheet numbers are for thin flat panels, not "deep cove" panels.',
    };
    const sent = installFetch({
      draft: misused,
      repair: REPAIRED_244,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, objection, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244(), { editedTerms: ["deep cove"] }), SUMMARY_VERSION);
    // The rule tells the check the term is the writer's own wording.
    expect(sent[1]!.user).toContain(
      "The writer's exact terms are the writer's own wording: never object to such a term itself, only to a figure or detail the section states with it."
    );
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(sent[2]!.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${objection.repairGuidance}`);
    // The repair keeps the term: the drafting rules ask for it word for word.
    expect(sent[2]!.user).toContain('Keep the writer\'s exact terms word for word, even where an issue above calls one unsupported or invented: "deep cove".');
    expect(result.draftText).toBe(REPAIRED_244);
    expect(result.draftText).toContain("deep cove");
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: `Figures and details match the sources. Fixed by the repair: ${objection.reason}`,
    });
  });

  it("Greptile round 1, P1 (PR #26): a repair that drops an edited term anyway is set aside, and the row says so", async () => {
    const objection = { ...factsWrong, reason: 'P1 "thin flat panels" is not in the sources', repairGuidance: 'Take out "thin flat panels".' };
    const sent = installFetch({
      draft: REPAIRED_244,
      repair: REPAIRED_244.replace("thin flat panels", "the panels suppliers show"),
      checks: [{ verdicts: ordinary, planVerdicts: [...covered, objection, targetsMet] }],
    });
    const result = await draft(claimFor(plan244(), { editedTerms: ["thin flat panels"] }), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(result.draftText).toBe(REPAIRED_244);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: `${objection.reason}; repair not used (the repaired text dropped the writer's edited term "thin flat panels", so the checked draft was kept)`,
    });
  });

  it("Greptile round 1, P1 (PR #26): a facts repair drops another Line's figure the draft put on the wrong subject", async () => {
    // Line 242's item gives 160 to 200 C for standard powder on steel; the
    // Line 244 draft calls it the company's own MDF cure temperature.
    const LINE_242 = "Standard powder cure temperatures of 160 to 200 C for steel exceed what MDF can tolerate.";
    const moved = [
      "Trial 1 cured the routed MDF panels at 160 to 200 C, the company's own cure temperature, after a 110 C preheat.",
      DRAFT_244.split("\n\n")[1]!.replace("on 4 percent of its panels", "on some of its panels"),
    ].join("\n\n");
    const fixed = moved.replace("at 160 to 200 C, the company's own cure temperature,", "at 135 C air");
    const objection = {
      ...factsWrong,
      reason: "P1 gives standard powder's 160 to 200 C as the MDF cure",
      repairGuidance: "P1: Trial 1 cured at 135 C air; 160 to 200 C is standard powder on steel.",
    };
    const sent = installFetch({
      draft: moved,
      repair: fixed,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, objection, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244(), { planWording: [[LINE_242], [TRIAL_1], [PILOT]] }), SUMMARY_VERSION);
    // The figure stays in Line 242, whose item holds it; Line 244 may drop it.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(fixed);
    expect(result.draftText).not.toContain("160 to 200 C");
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "applied",
      repaired: true,
    });
  });

  it("re-check P2: a real facts error that only mentions an edited term, or cites a figure outside one, is still repaired", async () => {
    // The re-check's probe: "deep cove" is the writer's edited term, and the
    // verdict, unquoted, calls the release suite's own error unsupported.
    const probe = {
      ...factsWrong,
      paragraph: 2,
      reason: "P2 gives the all-panel 4% as deep cove's, unsupported",
      repairGuidance: "P2: 4% is of all 600 panels, every one deep cove; deep cove was 13 percent of 180.",
    };
    const sent = installFetch({
      draft: DRAFT_244,
      repair: REPAIRED_244,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, probe, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244(), { editedTerms: ["deep cove"] }), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(sent[2]!.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${probe.repairGuidance}`);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: `Figures and details match the sources. Fixed by the repair: ${probe.reason}`,
    });

    // Quoted edited term, but it also cites a figure no edited term holds.
    const quotedWithFigure = {
      ...factsWrong,
      reason: 'P1 "thin flat panels" is not in the sources',
      repairGuidance: 'Take out "thin flat panels". P2: 4% is of all 600 panels.',
    };
    const again = installFetch({
      draft: REPAIRED_244,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, quotedWithFigure, targetsMet] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    await draft(claimFor(plan244(), { editedTerms: ["thin flat panels"] }), SUMMARY_VERSION);
    // Sent to the repair (whose text here comes back unchanged, so there is no check of a final text).
    expect(again.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(again[2]!.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${quotedWithFigure.repairGuidance}`);
  });

  it("P3-4: a facts fix and a targets fix on the same sentence both go to the one repair, and both rows record it", async () => {
    const sentence = "In the pilot, outgassing defects averaged 0.9 per square metre, over the 1 per square metre limit, and the deep cove profile fell short of 60 microns on 4 percent of its panels.";
    const fixed = "In the pilot, outgassing defects averaged 0.9 per square metre, within the 1 per square metre limit, and 4 percent of all 600 pilot panels fell short of 60 microns, every one of them a deep cove panel.";
    const twoErrors = [DRAFT_244.split("\n\n")[0]!.replace("flat steel panels", "thin flat panels"), sentence].join("\n\n");
    const repaired = [twoErrors.split("\n\n")[0]!, fixed].join("\n\n");
    const factsOnP2 = { ...factsWrong, paragraph: 2, reason: "P2 gives the all-panel 4% as deep cove's", repairGuidance: "P2: 4% is of all 600 panels, every one deep cove." };
    const targetsOnP2 = { ruleId: RESULTS_AGAINST_TARGETS_RULE_ID, mergedItemIds: [], paragraph: 2, outcome: "not_applied", reason: "P2 calls 0.9 over the limit of 1", repairGuidance: "Say 0.9 met the limit of 1." };
    const sent = installFetch({
      draft: twoErrors,
      repair: repaired,
      checks: [
        { verdicts: ordinary, planVerdicts: [...covered, factsOnP2, targetsOnP2] },
        { verdicts: [], planVerdicts: [...covered, factsMatch, targetsMet] },
      ],
    });
    const result = await draft(claimFor(plan244()), SUMMARY_VERSION);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    const repair = sent[2]!.user;
    expect(repair).toContain(`- Whole section: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}P2: 4% is of all 600 panels, every one deep cove.`);
    expect(repair).toContain(`- Paragraph 2: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.targetsIssue}Say 0.9 met the limit of 1.`);
    expect(result.draftText).toBe(repaired);
    expect(result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "Figures and details match the sources. Fixed by the repair: P2 gives the all-panel 4% as deep cove's",
    });
    expect(result.notes.find((row) => row.planRef?.ruleId === RESULTS_AGAINST_TARGETS_RULE_ID)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "Every comparison matches.",
    });
  });
});

// ─── With the writer's measured caps (2026-10-04, first, after the merge) ──

describe("the first Self-check with both the writer's measured caps and the facts check (real SDK, fetch stubbed)", () => {
  const CAP_RULE = "- Line 244: no more than 60 words.";
  const WRITER_WITH_CAP = `Write in the third person throughout.\n\n${CAP_RULE}`;
  /** A facts finding whose words sound like length: a guard on it would rewrite it. */
  const FACTS_CAP_REASON = "P2 says deep cove stayed under the cap of 5%; sources give 13%";
  const FACTS_CAP_GUIDANCE = "P2: deep cove fell short on 13% of its 180 panels, 4% of all 600.";
  const STILL_WRONG_REASON = "P2 still says deep cove stayed under the cap of 5%";
  const REPAIRED = DRAFT_244.replace("flat steel panels", "thin flat panels");
  const MEASURED_CAPS =
    `\n\nCode measures these caps of the writer's and reports them on their own: "${CAP_RULE}". In the verdicts for the WRITER INSTRUCTIONS block, do not judge these caps, and do not mention this section's word or line count. Judge every other rule, including any other length rule.`;

  /** Like installFetch, but a shortening pass for the writer's cap is told apart and echoes its text. */
  function installCapFetch(script: { repair: string; checks: unknown[] }): Sent[] {
    const sent: Sent[] = [];
    const checks = [...script.checks];
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input, init) => {
        const json = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
        const user = userOf(json);
        const system = typeof json.system === "string"
          ? json.system
          : Array.isArray(json.system) ? json.system.map((block: { text?: string }) => block.text ?? "").join("") : "";
        const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
        const stage = tool === "submit_self_check"
          ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction) ? "finalCoverage" : "selfCheck"
          : system.startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
            ? "compression"
            : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section";
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
        const text = stage === "compression"
          ? user.split(COMPRESSION_REQUEST.writerCap.userScaffold.percentToText)[1] ??
            user.split(COMPRESSION_REQUEST.writerCap.finalCutScaffold.targetToText)[1] ?? ""
          : stage === "repair" ? script.repair : DRAFT_244;
        return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
      })
    );
    return sent;
  }

  it("holds the caps sentence and the facts check once each; the facts finding still reaches the repair and its row is never rewritten", async () => {
    const sent = installCapFetch({
      repair: REPAIRED,
      checks: [
        {
          verdicts: [
            ...ordinary,
            { paragraph: 0, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Third person throughout; word cap ok." },
          ],
          planVerdicts: [
            ...covered,
            { ...factsWrong, paragraph: 2, reason: FACTS_CAP_REASON, repairGuidance: FACTS_CAP_GUIDANCE },
            targetsMet,
          ],
        },
        {
          verdicts: [],
          planVerdicts: [...covered, { ...factsWrong, paragraph: 2, reason: STILL_WRONG_REASON, repairGuidance: FACTS_CAP_GUIDANCE }, targetsMet],
        },
      ],
    });
    const t = convexTest(schema, modules);
    rateLimiterTest.register(t);
    const result = await t.action(async (ctx: ActionCtx) => {
      const clientFor = Object.assign(
        (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
        { modelFor: () => SONNET }
      );
      const base = payload(SUMMARY_VERSION, WRITER_WITH_CAP);
      return await draftCheckedSection({
        claim: claimFor(plan244()),
        payload: {
          ...base,
          orderedContext: {
            ...base.orderedContext,
            profileState: "applied",
            selfCheckRules: [{ section: "244", instruction: CAP_RULE, maxWords: 60 }],
          },
        },
        section: "244",
        clientFor,
      });
    });
    expect(sectionMetrics(DRAFT_244, "s244").words).toBeGreaterThan(60);
    expect(sent.map((request) => request.stage)).toEqual([
      "section", "compression", "compression", "selfCheck", "repair", "compression", "compression", "finalCoverage",
    ]);

    // The first Self-check: the caps sentence once, scoped to the WRITER
    // INSTRUCTIONS verdicts, after the data blocks; the SOURCE FACTS block
    // and the facts instruction once each.
    const check = sent.find((request) => request.stage === "selfCheck")!.user;
    expect(check.split(MEASURED_CAPS)).toHaveLength(2);
    expect(check.split("In the verdicts for the WRITER INSTRUCTIONS block")).toHaveLength(2);
    expect(check.split("--- BEGIN [WRITER INSTRUCTIONS] ---")).toHaveLength(2);
    expect(check.split("--- BEGIN [SOURCE FACTS] ---")).toHaveLength(2);
    expect(check).toContain(`Writer instructions:\n- ${WRITER_WITH_CAP}\n--- END [SOURCE FACTS] ---`);
    expect(check.split(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction)).toHaveLength(2);
    expect(check).toContain(`--- END [SOURCE FACTS] ---${MEASURED_CAPS}`);
    expect(check.indexOf(MEASURED_CAPS)).toBeLessThan(check.indexOf(SUMMARY_PLAN_SELF_CHECK_REQUEST.factsMatchSources.instruction));

    // The facts finding still goes to the repair, with its guidance whole.
    const repair = sent.find((request) => request.stage === "repair")!.user;
    expect(repair).toContain(`- Whole section: ${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.factsIssue}${FACTS_CAP_GUIDANCE}`);
    expect(repair).toContain(`- Shorten Line 244 to at most 60 words (writer rule: "${CAP_RULE}").`);

    // The facts row keeps the final check's own words, though they mention
    // a cap (the guard would read them as length talk); the writer's
    // settings row beside it is guarded.
    expect(talksAboutLength(STILL_WRONG_REASON)).toBe(true);
    const facts = result.notes.find((row) => row.planRef?.ruleId === FACTS_MATCH_SOURCES_RULE_ID);
    expect(facts).toMatchObject({ instruction: FACTS_INSTRUCTION, outcome: "not_applied", reason: STILL_WRONG_REASON, repaired: false });
    expect(facts?.reason).not.toContain("measured by code");
    expect(result.notes.find((row) => row.instruction === CAP_RULE)).toMatchObject({ outcome: "not_applied" });
    expect(result.notes.find((row) => row.source === "model" && row.instruction === WRITER_WITH_CAP)).toMatchObject({
      outcome: "not_applied",
      reason: expect.stringMatching(/^Not followed in full: Line 244 is over the writer's cap at \d+\/60 words \(measured by code; see the cap row\)\. Otherwise followed: Third person throughout\.$/),
    });
  });
});
