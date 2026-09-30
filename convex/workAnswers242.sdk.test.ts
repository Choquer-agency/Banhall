/// <reference types="vite/client" />
/**
 * 2026-09-30 (second): Line 244 work answers Line 242 (Rule C), and quieter
 * Compliance Note rows when the flagged content is a signed-off item.
 *
 * Release suite run 11 (commit 9de29da9, pack
 * _bmad-output/test-artifacts/seed-plan-eval/2026-09-30-run2), fixture
 * changed-advancement-links (fictional Marrowgate cold-water biofilter): Line
 * 244 narrated a Brief-only sensor experiment for an uncertainty Line 242
 * never states, and its LEAVE OUT row read not applied ("P3 states stall
 * durations (19 vs 6 days), close to dropped...") for signed-off experiment
 * item 9. In carried-old-selections the capture trials back signed-off Line
 * 246 item 13, so the work behind a Line 246 item stays.
 *
 * Every test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The data is fictional.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import {
  draftCheckedSection,
  leaveOutFigureBackstop,
  leaveOutInstruction,
  lostPlanFigure,
  repairDroppedCoverItemReason,
  repairLostPlanFigureReason,
  WORK_ANSWERS_242_INSTRUCTION,
} from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import {
  PLAN_WORK_RULE_NOT_CHECKED_REASON,
  WORK_RULE_BREAK_UNLOCATED_REASON,
} from "./ai/selfCheck";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  buildFrozenSummaryPlan,
  FROZEN_SUMMARY_PLAN_SCAFFOLD,
  line244Reference,
  type FrozenDroppedUncertainty,
} from "./lib/seedRevisions";
import type { OrderedPayload, SectionNumber } from "./lib/orderedChain";
import type { PdSubsectionRoleId } from "../shared/pdSubsections";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";
const SUMMARY_VERSION = "summary-version-marrowgate-c" as Id<"summaryVersions">;

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

// ─── The fictional Marrowgate plan of release suite run 11 ─────────────────

const U_NITRITE = "Nitrite oxidizing bacteria were suspected but not confirmed as the rate-limiting bottleneck under cold shock.";
const U_DOSING = "Whether feed-forward alkalinity dosing could hold TAN under target through a feeding pulse was unproven.";
const WORKPLAN = "The three uncertainties were investigated separately. Start-up runs over weeks, feeding spikes over hours and sensor reliability is a continuous measurement question.";
const STALL = "The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.";
const DOSE = "Baseline pH-setpoint dosing let TAN peak at 2.3 mg/L; feed-forward dosing cut it to 1.2 mg/L.";
const SCIENCE = "Stepwise acclimation of seed media cut cold-water start-up roughly in half, to about 31 days at 8 degrees C.";
const GOALS = "The start-up and ammonia control goals were met together.";

const ITEM = {
  nitrite: "item-u-nitrite",
  dosing: "item-u-dosing",
  workplan: "item-workplan",
  stall: "item-stall",
  dose: "item-dose",
  science: "item-science",
  goals: "item-goals",
} as const;

type PlanItem = {
  itemId: string;
  roleId: PdSubsectionRoleId;
  kind: "standard" | "optional" | "multiple";
  bullets: string[];
  support: "source_supported" | "writer_asserted";
};
const ITEMS: PlanItem[] = [
  { itemId: ITEM.nitrite, roleId: "active_uncertainties", kind: "standard", bullets: [U_NITRITE], support: "source_supported" },
  { itemId: ITEM.dosing, roleId: "active_uncertainties", kind: "standard", bullets: [U_DOSING], support: "source_supported" },
  { itemId: ITEM.workplan, roleId: "workplan", kind: "optional", bullets: [WORKPLAN], support: "source_supported" },
  { itemId: ITEM.stall, roleId: "experimentation", kind: "multiple", bullets: [STALL], support: "source_supported" },
  { itemId: ITEM.dose, roleId: "experimentation", kind: "multiple", bullets: [DOSE], support: "source_supported" },
  { itemId: ITEM.science, roleId: "overall_advancement", kind: "standard", bullets: [SCIENCE], support: "source_supported" },
  { itemId: ITEM.goals, roleId: "goal_improvements", kind: "standard", bullets: [GOALS], support: "writer_asserted" },
];
const PLAN_WORDING = ITEMS.map((item) => item.bullets);
const LINE_242 = [
  "Marrowgate designs recirculating aquaculture systems for cold-water trout farms.",
  `It was uncertain whether nitrite oxidizing bacteria were the bottleneck under cold shock. ${U_DOSING}`,
].join("\n\n");
const ITEMS_242 = [
  { roleId: "active_uncertainties" as const, wording: [U_NITRITE] },
  { roleId: "active_uncertainties" as const, wording: [U_DOSING] },
];
const ITEMS_246 = [
  { roleId: "overall_advancement" as const, wording: [SCIENCE] },
  { roleId: "goal_improvements" as const, wording: [GOALS] },
];

const P1 = "The team treated start-up, feeding spikes and sensor reliability as separate problems on different timescales.";
const P2 = "The first experiment ran three loops at 8 C: the nitrite stall lasted 19 days unacclimated and 6 days acclimated.";
const P3 = "Feed-forward dosing cut peak TAN from 2.3 mg/L to 1.2 mg/L.";
const P4_SENSOR = "A third experiment compared direct in-tank sensors with a bypass loop: the direct sensors drifted 8 percent by day 10.";
const DRAFT = [P1, P2, P3, P4_SENSOR].join("\n\n");
const REPAIRED = [P1, P2, P3].join("\n\n");

const ANALYSIS = {
  company_context: "A fictional designer of recirculating aquaculture systems",
  project_goal: "Biofilter start-up under 5 weeks at 8 C",
  business_problem: "Start-up took 9 to 10 weeks below 10 C",
  scientific_technical_problem: "Seed media goes into shock in cold water",
  technological_objective: "A cold-water start-up method",
  work_performed: {},
  project_status: "completed",
};
const PAYLOAD = {
  analysis: JSON.stringify(ANALYSIS),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
  summaryVersionId: SUMMARY_VERSION,
  frozenStyleGuidance: "",
} satisfies OrderedPayload;

function plan244(options: { line242Text?: string; rule?: boolean; dropped?: FrozenDroppedUncertainty[] } = {}) {
  return buildFrozenSummaryPlan({
    section: "s244",
    items: ITEMS,
    skippedRoleIds: ["prior_year_status"],
    ...(options.dropped ? { droppedUncertainties: options.dropped } : {}),
    ...(options.rule === false ? {} : { workAnswers242: options.line242Text === undefined ? {} : { line242Text: options.line242Text } }),
  });
}

function claimFor(args: {
  section: SectionNumber;
  plan: ReturnType<typeof buildFrozenSummaryPlan>;
  priorSections?: Array<{ section: SectionNumber; text: string }>;
  workAnswers242?: unknown;
  planWording?: string[][];
}) {
  return {
    projectId: "project-marrowgate",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 1,
    isFirstInOrder: false,
    priorSections: args.priorSections ?? [],
    briefBlock: "",
    brief: null,
    planBlock: `\n\n${args.plan.block}`,
    planChecksBlock: args.plan.checksBlock,
    planChecks: args.plan.checks,
    editedTerms: [],
    droppedNotChecked: [],
    answers242: null,
    workAnswers242: args.workAnswers242 ?? null,
    planWording: args.planWording ?? PLAN_WORDING,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

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
function planVerdictSchemaOf(sent: Sent) {
  const tool = (sent.json.tools as Array<{ input_schema: { properties: { planVerdicts: { items: { properties: Record<string, { enum?: string[] }>; oneOf: unknown[] } } } } }>)[0]!;
  return tool.input_schema.properties.planVerdicts.items;
}

function installFetch(script: {
  draft: string;
  repair?: string;
  compressed?: string;
  checks: Array<unknown[]>;
}): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const followUp = user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.prefix.trim());
      const stage = tool === "submit_self_check"
        ? user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction)
          ? "finalCoverage"
          : followUp ? "followUp" : "selfCheck"
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
        const next = checks.shift();
        if (next === undefined) throw new Error("No Self-check answer scripted");
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_self_check", name: tool, input: { verdicts: [], planVerdicts: next } }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text = stage === "repair"
        ? script.repair ?? script.draft
        : stage === "compression"
          ? script.compressed ?? script.draft
          : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(section: SectionNumber, claim: ReturnType<typeof claimFor>) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: PAYLOAD, section, clientFor });
  });
}

function rowOf(result: Awaited<ReturnType<typeof draft>>, match: (ref: NonNullable<(typeof result.notes)[number]["planRef"]>) => boolean) {
  const row = result.notes.find((note) => note.planRef && match(note.planRef));
  if (!row) throw new Error("No such plan row");
  return row;
}
function planCoverage(result: Awaited<ReturnType<typeof draft>>) {
  return (JSON.parse(result.selfCheck) as { planCoverage?: unknown }).planCoverage;
}

const skipHonoured = { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "The role is absent." };
const covered = (itemId: string, paragraph: number) => ({ itemId, mergedItemIds: [itemId], paragraph, outcome: "applied", reason: `P${paragraph} covers it.` });
const allCovered = [covered(ITEM.workplan, 1), covered(ITEM.stall, 2), covered(ITEM.dose, 3)];
const workAnswers = { ruleId: "work_answers_242", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "All work answers 242 or a plan item." };
const sensorStray = {
  ruleId: "work_answers_242",
  mergedItemIds: [],
  paragraph: 4,
  outcome: "not_applied",
  reason: "P4 narrates a sensor trial, not in 242.",
  repairGuidance: "Leave out the sensor experiment in P4.",
};
const claimDrafted = (plan = plan244({ line242Text: LINE_242 })) => claimFor({
  section: "244",
  plan,
  priorSections: [{ section: "242", text: LINE_242 }],
  workAnswers242: { line242Drafted: true, line246Items: ITEMS_246 },
});

describe("Line 244 work answers Line 242, or is work a signed-off item holds or needs (Rule C, real SDK, fetch stubbed)", () => {
  it("tells the drafter, checks the work against Line 242 and Line 246's items, repairs Brief-only work and records the final text", async () => {
    const sent = installFetch({
      draft: DRAFT,
      repair: REPAIRED,
      checks: [[skipHonoured, ...allCovered, sensorStray], [skipHonoured, ...allCovered, workAnswers]],
    });
    const result = await draft("244", claimDrafted());

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED);
    // Drafting: Line 242 as a prior section, then the rule and the Line 246
    // items after the plan and the Brief, before the Locked length.
    const drafting = sent[0]!.user;
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.workAnswers242;
    const rule = `${scaffold.heading}${scaffold.drafted}${scaffold.rest}${scaffold.line246Heading}\n- Advancement to science / technology: "${SCIENCE}"\n- Overall company / project goal improvements: "${GOALS}"`;
    expect(drafting).toContain(`${ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.itemTitlePrefix}Line 242 (Uncertainty)${ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.itemTitleSuffix}${LINE_242}`);
    expect(drafting).toContain(rule);
    expect(drafting.indexOf(FROZEN_SUMMARY_PLAN_SCAFFOLD.end)).toBeLessThan(drafting.indexOf(rule));
    expect(drafting.indexOf(rule)).toBeLessThan(drafting.indexOf(ORDERED_PROMPT_SCAFFOLDS.planLengthBudget.prefix));
    expect(drafting).not.toContain(ORDERED_PROMPT_SCAFFOLDS.advancementsAnswer242.heading);
    expect(drafting).toContain(
      "\n\n# WORK ANSWERS LINE 242 (outranks the Brief)\nDescribe work in this Line only for an uncertainty that Line 242 states, or work that is the evidence a signed-off item needs. Line 242 is among the previously drafted sections above. The evidence a signed-off item of any Line needs is a COVER experiment of this Line, the work behind a COVER hypothesis, and the work and figures behind a signed-off Line 246 item: those items are listed after this rule by step, and their work stays in this Line. Keep the work plan's own sentences as written, but an area the work plan names is no reason to describe a Brief experiment on an uncertainty Line 242 does not state. Leave out Brief content that describes work on any other uncertainty, even where the Storyline or the Confidence Map supports it. Project status and next steps are not work to remove."
    );
    expect(drafting).toContain(
      "The writer's Feedback outranks this rule, as it outranks the Brief. Claim Exclusions still apply to it: never claim excluded work because a Feedback instruction asks for it."
    );
    // The Self-check: Line 242 and Line 246's items as data in the check, its rule and schema.
    const check = sent[1]!;
    expect(check.user).toContain(`"ruleId":"work_answers_242","sourceReferences":[],"wording":${JSON.stringify([
      line244Reference({ items242: ITEMS_242, line242Text: LINE_242, items246: ITEMS_246 }),
    ])}`);
    expect(check.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction);
    // Review P2-2: naming an area in the work plan licenses no Brief experiment.
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction).toContain(
      "is the evidence a signed-off item of any Line needs (a COVER experiment, the work behind a COVER hypothesis, or the work and figures behind a signed-off Line 246 item), or follows the writer's Feedback. The work plan's own sentences are covered as written, but an area the work plan names is no reason to describe a Brief experiment on an uncertainty Line 242 does not state."
    );
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction).not.toContain("what a work plan or hypothesis item states");
    expect(check.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction);
    expect(check.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(check.user.endsWith(
      `- skippedRoleId prior_year_status\n- itemId ${ITEM.workplan}\n- itemId ${ITEM.stall}\n- itemId ${ITEM.dose}\n- ruleId work_answers_242`
    )).toBe(true);
    const schema = planVerdictSchemaOf(check);
    expect(schema.properties.ruleId?.enum).toEqual(["work_answers_242"]);
    expect(schema.properties).not.toHaveProperty("droppedSeedId");
    expect(schema.oneOf).toEqual([{ required: ["itemId"] }, { required: ["skippedRoleId"] }, { required: ["ruleId"] }]);
    // The repair gets a fixed start, then the guidance.
    expect(sent[2]!.user).toContain(
      "- Paragraph 4: describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs, and leave out the rest (an area the work plan names is no reason to keep a Brief experiment), but keep the work plan's own sentences, every COVER experiment and the evidence a signed-off item needs. Leave out the sensor experiment in P4."
    );
    expect(sent[3]!.user.endsWith("- ruleId work_answers_242")).toBe(true);
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toEqual({
      section: "244",
      source: "model",
      instruction: WORK_ANSWERS_242_INSTRUCTION,
      outcome: "applied",
      tier: "none",
      reason: "All work answers 242 or a plan item.",
      repaired: true,
      planRef: { summaryVersionId: SUMMARY_VERSION, ruleId: "work_answers_242", mergedItemIds: [] },
    });
    expect(WORK_ANSWERS_242_INSTRUCTION).toBe(
      "Describe work only for an uncertainty Line 242 states, or work that is the evidence a signed-off item needs"
    );
    expect(planCoverage(result)).toEqual({ status: "complete", applied: 5, total: 5 });
  });

  it("keeps the work behind a signed-off Line 246 item: the capture trials that back goal item 13 are judged applied and not repaired (carried-old-selections)", async () => {
    const capture = "Trial 4 and trial 5 compared capture on a flow rig: the graded filter captured 36 percent more inclusions.";
    const captureGoals = "The graded filter program met both the firing survival and the capture goals together.";
    const items = [
      { itemId: "item-u-bond", roleId: "active_uncertainties" as const, kind: "standard" as const, bullets: ["It was unknown whether two-zone templates survive firing without delaminating."], support: "source_supported" as const },
      { itemId: "item-trial-1", roleId: "experimentation" as const, kind: "multiple" as const, bullets: ["Trial 1 bonded 10 ppi and 30 ppi sheets; 18 of 24 parts delaminated."], support: "source_supported" as const },
      { itemId: "item-goals-13", roleId: "goal_improvements" as const, kind: "standard" as const, bullets: [captureGoals], support: "source_supported" as const },
    ];
    const plan = buildFrozenSummaryPlan({
      section: "s244",
      items,
      skippedRoleIds: ["prior_year_status"],
      workAnswers242: { line242Text: "It was unknown whether two-zone templates survive firing without delaminating." },
    });
    const text = ["Trial 1 bonded 10 ppi and 30 ppi sheets; 18 of 24 parts delaminated.", capture].join("\n\n");
    const sent = installFetch({
      draft: text,
      checks: [[
        skipHonoured,
        covered("item-trial-1", 1),
        { ...workAnswers, reason: "P2 capture backs Line 246 goal item." },
      ]],
    });
    const result = await draft("244", claimFor({
      section: "244",
      plan,
      priorSections: [{ section: "242", text: "It was unknown whether two-zone templates survive firing without delaminating." }],
      workAnswers242: { line242Drafted: true, line246Items: [{ roleId: "goal_improvements", wording: [captureGoals] }] },
      planWording: items.map((item) => item.bullets),
    }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    // The goal item that needs the capture work is in the drafting rule and in the check.
    expect(sent[0]!.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.workAnswers242.line246Heading}\n- Overall company / project goal improvements: "${captureGoals}"`);
    expect(sent[1]!.user).toContain(JSON.stringify(`${FROZEN_SUMMARY_PLAN_SCAFFOLD.line246PlanHeading}\n- Overall company / project goal improvements: ${captureGoals}`).slice(1, -1));
    expect(result.draftText).toBe(text);
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({ outcome: "applied", repaired: false });
  });

  it("lists Line 242's signed-off items by step when Line 244 is drafted before Line 242", async () => {
    const sent = installFetch({ draft: REPAIRED, checks: [[skipHonoured, ...allCovered, workAnswers]] });
    await draft("244", claimFor({
      section: "244",
      plan: plan244(),
      workAnswers242: { line242Drafted: false, items: ITEMS_242, line246Items: ITEMS_246 },
    }));
    const scaffold = ORDERED_PROMPT_SCAFFOLDS.workAnswers242;
    expect(sent[0]!.user).toContain(
      `${scaffold.heading}${scaffold.planned}${scaffold.rest}${scaffold.line242Heading}\n- Technological uncertainties: "${U_NITRITE}"\n- Technological uncertainties: "${U_DOSING}"${scaffold.line246Heading}\n- Advancement to science / technology: "${SCIENCE}"\n- Overall company / project goal improvements: "${GOALS}"`
    );
    expect(sent[0]!.user).not.toContain(ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.prefix);
    expect(sent[1]!.user).toContain(`"wording":${JSON.stringify([
      line244Reference({ items242: ITEMS_242, items246: ITEMS_246 }),
    ])}`);
  });

  it("sets a Rule C repair aside when it loses a signed-off figure, before any check of its text (review P2-1)", async () => {
    // P2 mixes the signed-off stall result with Brief-only sensor work; the
    // repair drops the whole paragraph, and with it "8 C", "19 days" and
    // "6 days", which signed-off items use.
    const mixed = [P1, `${P2} The same loops also tested in-tank sensors, which drifted 8 percent by day 10.`, P3].join("\n\n");
    const gutted = [P1, P3].join("\n\n");
    const sent = installFetch({
      draft: mixed,
      repair: gutted,
      checks: [[skipHonoured, ...allCovered, { ...sensorStray, paragraph: 2, reason: "P2 adds sensor work, not in 242." }]],
    });
    const result = await draft("244", claimDrafted());
    // No check of the repaired text is needed: nothing replaced the draft.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(result.draftText).toBe(mixed);
    expect(lostPlanFigure(mixed, gutted, PLAN_WORDING)).toEqual({ figure: "8 C", before: 1, after: 0 });
    expect(rowOf(result, (ref) => ref.itemId === ITEM.stall)).toMatchObject({ outcome: "applied", repaired: false });
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: `P2 adds sensor work, not in 242.; repair not used (the repaired text mentions the signed-off figure "8 C" 0 times where the checked draft mentioned it once, and a fix that leaves out work must keep the evidence a signed-off item needs, so the checked draft was kept)`,
    });
  });

  it("re-check: uses a Rule C repair that removes Brief-only work and merges two paragraphs, since every signed-off figure keeps its count", async () => {
    // The sensor paragraph goes, and P2 and P3 become one paragraph: the
    // per-paragraph count of "8 C", "19 days" and "2.3 mg/L" would change,
    // but their mentions in the text do not.
    const merged = [P1, `${P2} ${P3}`].join("\n\n");
    expect(lostPlanFigure(DRAFT, merged, PLAN_WORDING)).toBeUndefined();
    const sent = installFetch({
      draft: DRAFT,
      repair: merged,
      checks: [
        [skipHonoured, ...allCovered, sensorStray],
        [skipHonoured, covered(ITEM.workplan, 1), covered(ITEM.stall, 2), covered(ITEM.dose, 2), workAnswers],
      ],
    });
    const result = await draft("244", claimDrafted());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(merged);
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("sets aside a Rule C repair that cuts the capture trials behind goal item 13, and lets the sensor experiment go (release suite run 11)", async () => {
    // carried-old-selections, run 11: Line 244 as drafted, and the signed-off
    // items (skipped steps aside) as frozen. Goal item 13 says both goals were
    // met together; the capture trials (P6, P7) are its evidence and hold
    // "20 ppi" and "30 ppi", which the hypothesis and work plan items use.
    const capturePlan = {
      items: [
        ["It was unknown whether two-zone sponge templates could survive firing without delaminating at the bond line.", "Shrinkage could not be calculated because it depends on slurry loading, pore size, viscosity and roller pressure."],
        ["The working hypothesis proposed a two-zone template, 10 ppi entry and 30 ppi exit, matched for slurry mass per volume.", "This was expected to hold shrinkage mismatch within 0.5 percent and survive firing without delamination."],
        ["If a two-zone template matches slurry mass per volume, then shrinkage mismatch stays within 0.5 percent and survives firing without delamination.", "If that hypothesis holds, then capture rises at least 30 percent over the 20 ppi standard with no more than a 10 percent flow penalty."],
        ["Trial 1 bonded 10 ppi and 30 ppi sponge sheets with adhesive and a single slurry dip.", "Eighteen of 24 parts delaminated at the bond line, with a 1.4 percent shrinkage mismatch."],
        ["Trial 3 slowed the ramp through 1,100 to 1,350 C, meeting the 0.5 percent mismatch target.", "This confirmed the hypothesis that matching slurry mass per volume controls firing survival."],
        ["The graded filter program aimed to combine breakage resistance with fine inclusion capture in one part.", "Trial results confirmed the two zone approach met both the firing survival and capture goals together."],
      ],
      roles: ["active_uncertainties", "workplan", "hypothesis", "experimentation", "overall_advancement", "goal_improvements"] as PdSubsectionRoleId[],
    };
    const items = capturePlan.items.map((bullets, index) => ({
      itemId: `item-capture-${index}`,
      roleId: capturePlan.roles[index]!,
      kind: capturePlan.roles[index] === "experimentation" ? "multiple" as const : "standard" as const,
      bullets,
      support: "source_supported" as const,
    }));
    const plan = buildFrozenSummaryPlan({ section: "s244", items, skippedRoleIds: ["prior_year_status"], workAnswers242: { line242Text: "It was unknown whether two-zone templates survive firing." } });
    const paragraphs = [
      "The company ran a planned trial series, from bonding method through slurry control, firing curve, flow and capture testing and thermal shock testing.",
      "The working hypothesis proposed a two-zone template, 10 pores per inch (ppi) entry and 30 ppi exit, matched for slurry mass per volume. If that held, capture was expected to rise at least 30 percent over the 20 ppi standard with no more than a 10 percent flow penalty.",
      "Trial 1 bonded 10 ppi and 30 ppi sponge sheets with polyurethane adhesive, applied a single slurry dip, and fired 24 parts. Eighteen of 24 delaminated at the bond line, with survivors showing a 1.4 percent shrinkage mismatch.",
      "Trial 3 kept the two-stage dip and slowed the firing ramp through the 1,100 to 1,350 C sintering window. Mismatch measured 0.4 percent, meeting the 0.5 percent target.",
      "Trial 4 used a flow rig with 50 kg A356 pours at 720 C to compare standard 20 ppi, standard 30 ppi, and a graded filter with a 25 mm fine zone. The graded filter flowed at 3.8 kg/s and captured 41 percent more inclusions, but 2 of 6 pours choked late.",
      "Trial 5 cut the fine zone to 15 mm against a 35 mm coarse zone. Flow held at 3.9 kg/s with no choking, and capture reached 36 percent above the 20 ppi standard.",
    ];
    const text = paragraphs.join("\n\n");
    const withoutCapture = paragraphs.slice(0, 4).join("\n\n");
    const coverAnswers = plan.checks.flatMap((check) =>
      check.itemId ? [covered(check.itemId, check.roleId === "workplan" ? 1 : check.roleId === "hypothesis" ? 2 : 3)] : []);
    const sent = installFetch({
      draft: text,
      repair: withoutCapture,
      checks: [[skipHonoured, ...coverAnswers, { ...sensorStray, paragraph: 5, reason: "P5 and P6 test capture, not in 242.", repairGuidance: "Leave out Trials 4 and 5." }]],
    });
    const result = await draft("244", claimFor({
      section: "244",
      plan,
      priorSections: [{ section: "242", text: "It was unknown whether two-zone templates survive firing." }],
      workAnswers242: { line242Drafted: true, line246Items: [{ roleId: "goal_improvements", wording: capturePlan.items[5]! }] },
      planWording: capturePlan.items,
    }));
    const lost = lostPlanFigure(text, withoutCapture, capturePlan.items)!;
    expect(lost).toMatchObject({ after: lost.before - (lost.figure === "20 ppi" ? 2 : 1) });
    expect(["20 ppi", "30 ppi"]).toContain(lost.figure);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    expect(result.draftText).toBe(text);
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: `P5 and P6 test capture, not in 242.; repair not used (${repairLostPlanFigureReason(lost)})`,
    });
  });

  it("lets a Rule C repair remove run 11's Brief-only sensor experiment: it holds no signed-off figure (changed-advancement-links)", async () => {
    const runItems = [
      ["Nitrite oxidizing bacteria were suspected but not confirmed as the rate-limiting bottleneck under cold shock.", "The duration of the nitrite stall under acclimation versus no acclimation was unknown before testing."],
      ["The three uncertainties were investigated separately because they fail on different timescales and mechanisms.", "Start-up runs over weeks, feeding spikes over hours and sensor reliability is a continuous measurement question."],
      ["If alkalinity is dosed ahead of each feeding in proportion to feed mass, then the biofilter keeps nitrifying at full rate through the ammonia pulse.", "This feed-forward approach should hold total ammonia nitrogen under 1 mg per litre, unlike reactive pH-setpoint dosing."],
      ["The nitrite stall lasted 19 days in unacclimated seed but only 6 days in acclimated seed.", "This confirmed nitrite oxidizing bacteria as the rate-limiting step under cold shock."],
      ["Baseline pH-setpoint dosing let TAN peak at 2.3 mg/L with alkalinity and pH falling during the pulse.", "Switching to feed-forward dosing cut peak TAN to 1.2 mg/L and held alkalinity above 130 mg/L."],
      ["The original goal was to shorten biofilter start-up below 10 C from 9 to 10 weeks toward under 5 weeks.", "Stepwise acclimation of seed media closed that gap, reaching full nitrification in about 31 days at 8 C."],
    ];
    const roles: PdSubsectionRoleId[] = ["active_uncertainties", "workplan", "hypothesis", "experimentation", "experimentation", "goal_improvements"];
    const items = runItems.map((bullets, index) => ({
      itemId: `item-run11-${index}`,
      roleId: roles[index]!,
      kind: roles[index] === "experimentation" ? "multiple" as const : "standard" as const,
      bullets,
      support: "source_supported" as const,
    }));
    const plan = buildFrozenSummaryPlan({ section: "s244", items, skippedRoleIds: ["prior_year_status"], workAnswers242: { line242Text: LINE_242 } });
    const paragraphs = [
      "The company undertook a series of experiments covering biofilter start-up speed below 10°C, ammonia control through feeding-induced spikes, and sensor accuracy in biofilm-heavy water. Start-up runs over weeks, feeding spikes over hours, and sensor reliability is a continuous measurement question.",
      "It was hypothesized that if alkalinity is dosed ahead of each feeding in proportion to feed mass, then the biofilter keeps nitrifying at full rate. This feed-forward approach should hold total ammonia nitrogen under 1 mg per litre.",
      "Three pilot loops at 8°C were run in parallel. The nitrite stall lasted 19 days in the unacclimated loop but only 6 days in the acclimated loop.",
      "Baseline pH-setpoint dosing let total ammonia nitrogen peak at 2.3 mg/L. Feed-forward dosing cut peak total ammonia nitrogen to 1.2 mg/L and held alkalinity above 130 mg/L.",
      "Direct in-tank sensors cleaned weekly by hand were compared against a bypass sampling loop fitted with a 50-micron screen and automatic compressed-air blast every 6 hours. The direct sensors drifted 8% low on dissolved oxygen by day 10 and 0.4 mg/L per week on ammonium. The bypass configuration held dissolved oxygen within 3% for 28 days, improving further to within 0.12 mg/L over 4 weeks.",
    ];
    const text = paragraphs.join("\n\n");
    const withoutSensor = paragraphs.slice(0, 4).join("\n\n");
    expect(lostPlanFigure(text, withoutSensor, runItems)).toBeUndefined();
    const coverAnswers = plan.checks.flatMap((check) =>
      check.itemId ? [covered(check.itemId, check.roleId === "workplan" ? 1 : check.roleId === "hypothesis" ? 2 : check.itemId === "item-run11-3" ? 3 : 4)] : []);
    const sent = installFetch({
      draft: text,
      repair: withoutSensor,
      checks: [
        [skipHonoured, ...coverAnswers, { ...sensorStray, paragraph: 5, reason: "P5 narrates a sensor trial, not in 242." }],
        [skipHonoured, ...coverAnswers, workAnswers],
      ],
    });
    const result = await draft("244", claimFor({
      section: "244",
      plan,
      priorSections: [{ section: "242", text: LINE_242 }],
      workAnswers242: { line242Drafted: true, line246Items: [{ roleId: "goal_improvements", wording: runItems[5]! }] },
      planWording: runItems,
    }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(withoutSensor);
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("re-check: uses a targets repair that drops a figure mention, and sets aside a targets repair that loses a COVER item (review P3)", async () => {
    const plan = buildFrozenSummaryPlan({
      section: "s244",
      items: ITEMS,
      skippedRoleIds: ["prior_year_status"],
      resultsAgainstTargets: true,
      workAnswers242: { line242Text: LINE_242 },
    });
    const targets = {
      ruleId: "results_against_targets",
      mergedItemIds: [],
      paragraph: 3,
      outcome: "not_applied",
      reason: "P3 hides that 1.2 mg/L missed the target.",
      repairGuidance: "Say 1.2 mg/L missed the under-1 target.",
    };
    const targetsMet = { ruleId: "results_against_targets", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Results match targets." };
    // The repair restates P3 and drops "2.3 mg/L". A targets fix restates
    // rather than removes work, so no figure guard sets it aside; the check
    // of its final text decides.
    const restated = [P1, P2, "Feed-forward dosing cut peak TAN to 1.2 mg/L, which missed the under-1 target."].join("\n\n");
    expect(lostPlanFigure(REPAIRED, restated, PLAN_WORDING)).toMatchObject({ figure: "2.3 mg/L" });
    const sent = installFetch({
      draft: REPAIRED,
      repair: restated,
      checks: [[skipHonoured, ...allCovered, targets, workAnswers], [skipHonoured, ...allCovered, targetsMet, workAnswers]],
    });
    const result = await draft("244", claimFor({
      section: "244",
      plan,
      priorSections: [{ section: "242", text: LINE_242 }],
      workAnswers242: { line242Drafted: true, line246Items: ITEMS_246 },
    }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(restated);
    expect(rowOf(result, (ref) => ref.ruleId === "results_against_targets")).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "Results match targets.",
    });

    // A targets repair that keeps every figure but loses the work plan
    // sentence: the check of its final text finds the COVER item gone.
    const workplanGone = ["The team compared loops.", P2, `${P3} This missed the under-1 target.`].join("\n\n");
    const second = installFetch({
      draft: REPAIRED,
      repair: workplanGone,
      checks: [
        [skipHonoured, ...allCovered, targets, workAnswers],
        [skipHonoured, { itemId: ITEM.workplan, mergedItemIds: [ITEM.workplan], paragraph: 0, outcome: "not_applied", reason: "The work plan is gone." }, covered(ITEM.stall, 2), covered(ITEM.dose, 3), targetsMet, workAnswers],
      ],
    });
    const kept = await draft("244", claimFor({
      section: "244",
      plan,
      priorSections: [{ section: "242", text: LINE_242 }],
      workAnswers242: { line242Drafted: true, line246Items: ITEMS_246 },
    }));
    expect(second.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(kept.draftText).toBe(REPAIRED);
    expect(rowOf(kept, (ref) => ref.ruleId === "results_against_targets")).toMatchObject({
      outcome: "not_applied",
      reason: `P3 hides that 1.2 mg/L missed the target.; repair not used (${repairDroppedCoverItemReason({ wording: [WORKPLAN] })})`,
    });
  });

  it("re-check: uses a Line 246 targets repair that corrects a met target and drops a repeated figure (withdrawn-feedback, run 11)", async () => {
    // Run 11's Line 246 and its signed-off Line 246 items. P1 calls two met
    // targets "close to but not exceeding"; the repair says they were met and
    // drops P1's repeat of "0.6 mm", which P3 still states.
    const science = ["Two-angle imaging cut vision error to 0.07 millimetres RMS at 95 milliseconds per edge, meeting both targets.", "The non-linear force map, with a knee near 0.6 millimetres, let force scale correctly with burr height across the range."];
    const single = ["Single-angle 2D vision on cast aluminium failed to reach the accuracy or speed target.", "The error was 0.18 millimetres RMS at 210 milliseconds per edge, revealing a limit of single-angle imaging."];
    const status = ["The project remains active in the pilot cell in Bay 4, with no production cell shipped yet.", "The team is running parts close to the cycle time limit, leaving no room for extra steps."];
    const goals = ["The project set out to replace manual deburring with a controlled process holding edge radius within 0.2 to 0.5 millimetres.", "The knowledge gained lets the compliant spindle set force per edge from a 2D burr height estimate, meeting that original goal."];
    const items = [
      { itemId: "item-wf-science", roleId: "overall_advancement" as const, kind: "standard" as const, bullets: science, support: "source_supported" as const },
      { itemId: "item-wf-single", roleId: "specific_advancements" as const, kind: "multiple" as const, bullets: single, support: "source_supported" as const },
      { itemId: "item-wf-status", roleId: "project_status" as const, kind: "standard" as const, bullets: status, support: "source_supported" as const },
      { itemId: "item-wf-goals", roleId: "goal_improvements" as const, kind: "standard" as const, bullets: goals, support: "source_supported" as const },
    ];
    const plan = buildFrozenSummaryPlan({ section: "s246", items, skippedRoleIds: [], resultsAgainstTargets: true });
    const P1_WF = "The technological objective was to advance real-time 2D vision-based burr height estimation and adaptive force control of a compliant spindle for deburring cast A357 aerospace brackets. This objective was met. Two-angle imaging cut vision error to 0.07 mm RMS at 95 ms per edge, meeting both targets, and the non-linear force map, with a knee near 0.6 mm, let force scale correctly with burr height across the range. Combined, these results reached 97.8 percent of edges in the edge radius window and 2.6 percent rejects, close to but not exceeding the 97 percent and 3 percent targets.";
    const rest = [
      "Single-angle 2D vision on cast aluminum could not reach the accuracy or speed target needed for per-edge force control. The 0.18 mm RMS error at 210 ms per edge revealed a limit of single-angle imaging, traced to specular reflection on machined faces.",
      "The relationship between burr height and required compliant spindle force is non-linear, with a repeatable knee near 0.6 mm. This was used to build a force map that scales contact force correctly across the 0.1-1.2 mm burr range.",
      "The project remains active in the pilot cell in Bay 4, with no production cell shipped. Cycle time now runs close to the 4-minute limit, leaving no margin for added steps.",
      "The original goal was to replace manual deburring with a controlled process holding edge radius within the 0.2 to 0.5 mm edge radius window. The knowledge gained lets the compliant spindle set force per edge from a 2D burr height estimate, meeting that goal and cutting rejects from 9 percent under manual deburring to 2.6 percent.",
    ];
    const text = [P1_WF, ...rest].join("\n\n");
    const corrected = [
      "The technological objective was to advance real-time 2D vision-based burr height estimation and adaptive force control of a compliant spindle for deburring cast A357 aerospace brackets. This objective was met. Two-angle imaging cut vision error to 0.07 mm RMS at 95 ms per edge, meeting both targets, and the non-linear force map let force scale correctly with burr height. Combined, these results reached 97.8 percent of edges in the edge radius window, meeting the 97 percent target, and 2.6 percent rejects, within the 3 percent limit.",
      ...rest,
    ].join("\n\n");
    // P1 drops its repeat of "0.6 mm": a Rule C guard would have counted a loss.
    expect(lostPlanFigure(text, corrected, items.map((item) => item.bullets))).toEqual({ figure: "0.6 mm", before: 2, after: 1 });
    const coverAnswers = [covered("item-wf-science", 1), covered("item-wf-single", 2), covered("item-wf-status", 4), covered("item-wf-goals", 5)];
    const misstated = {
      ruleId: "results_against_targets",
      mergedItemIds: [],
      paragraph: 1,
      outcome: "not_applied",
      reason: "P1 calls met targets close to but not exceeding.",
      repairGuidance: "Say both targets were met.",
    };
    const sent = installFetch({
      draft: text,
      repair: corrected,
      checks: [
        [...coverAnswers, misstated],
        [...coverAnswers, { ruleId: "results_against_targets", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Results match targets." }],
      ],
    });
    const result = await draft("246", claimFor({ section: "246", plan, planWording: items.map((item) => item.bullets) }));
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(corrected);
    expect(rowOf(result, (ref) => ref.ruleId === "results_against_targets")).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("honours Rule C by absence: a break with no paragraph is not repaired, and a missing verdict is asked for once", async () => {
    const unlocated = installFetch({ draft: DRAFT, checks: [[skipHonoured, ...allCovered, { ...sensorStray, paragraph: 0 }]] });
    const broken = await draft("244", claimDrafted());
    expect(unlocated.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(rowOf(broken, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: WORK_RULE_BREAK_UNLOCATED_REASON,
    });

    const missing = installFetch({ draft: REPAIRED, checks: [[skipHonoured, ...allCovered], []] });
    const unanswered = await draft("244", claimDrafted());
    expect(missing.map((request) => request.stage)).toEqual(["section", "selfCheck", "followUp"]);
    expect(missing[2]!.user.endsWith(`- ruleId work_answers_242\n\n${SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.emptyVerdicts}`)).toBe(true);
    expect(rowOf(unanswered, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: PLAN_WORK_RULE_NOT_CHECKED_REASON,
    });
  });

  it("gives Lines 242 and 246 no work rule", async () => {
    const plan246 = buildFrozenSummaryPlan({ section: "s246", items: ITEMS, skippedRoleIds: [] });
    const sent = installFetch({
      draft: SCIENCE,
      checks: [[covered(ITEM.science, 1), covered(ITEM.goals, 1)]],
    });
    await draft("246", claimFor({
      section: "246",
      plan: plan246,
      workAnswers242: { line242Drafted: true, line246Items: ITEMS_246 },
    }));
    expect(sent[0]!.user).not.toContain(ORDERED_PROMPT_SCAFFOLDS.workAnswers242.heading);
    expect(sent[1]!.user).not.toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction);
  });
});

// ─── The LEAVE OUT figure check (2026-09-30 second, item 2) ────────────────

const DROPPED_ID = "u-acclimation-works";
const DROPPED: FrozenDroppedUncertainty = {
  seedId: DROPPED_ID,
  wording: [
    "It was uncertain whether stepwise acclimation would actually work rather than just delay cold shock.",
    "The team did not know what seed fraction would be needed at colder temperatures like 6 degrees C.",
  ],
  experiments: [{
    seedId: "e-trial-2",
    wording: ["Trial 2 at 6 C compared 5 and 15 percent acclimated seed.", "The loops took 44 and 29 days."],
  }],
  advancements: [{ seedId: "a-unacclimated", wording: ["Unacclimated seed took 47 days at 8 C."] }],
};
const DROPPED_FIGURES = "6 C, 5 percent, 15 percent, 44 days, 29 days, 47 days";
const P4_LEAK = "Trial 2 at 6 C took 44 days with 5 percent seed and 29 days with 15 percent seed.";
const leftOut = { droppedSeedId: DROPPED_ID, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Nothing of the dropped uncertainty." };
// Release suite run 11's verdict on signed-off experiment item 9.
const onTheStall = {
  droppedSeedId: DROPPED_ID,
  mergedItemIds: [],
  paragraph: 2,
  outcome: "not_applied",
  reason: "P2 states stall durations (19 vs 6 days), close to dropped.",
  repairGuidance: "Remove the stall figures from P2.",
};
const backstopReason = (paragraph: number, reason: string, cited: string) =>
  `The flagged content is a signed-off item: the Self-check flagged paragraph ${paragraph} ("${reason}"), but every figure it cited (${cited}) is in the signed-off plan's wording, and no paragraph of this Line holds one of the dropped uncertainty's own figures (${DROPPED_FIGURES}) or restates it. Not sent to the repair.`;
const claimLeaveOut = () => claimFor({ section: "244", plan: plan244({ rule: false, dropped: [DROPPED] }) });

describe("a LEAVE OUT verdict that flags a signed-off item by its figures is recorded applied (real SDK, fetch stubbed)", () => {
  it("records run 11's verdict on the signed-off stall experiment applied and sends it to no repair", async () => {
    const sent = installFetch({ draft: REPAIRED, checks: [[skipHonoured, ...allCovered, onTheStall]] });
    const result = await draft("244", claimLeaveOut());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    // The strengthened rule is on the wire: compare with every COVER item first.
    expect(sent[1]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction);
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.leaveOut.instruction).toContain(
      "Before you judge it not applied, compare that content with every COVER item in the plan checks. Content a COVER item states, and the work and figures that are its evidence, never make this check not applied, even where they share words or figures with the dropped uncertainty. Judge it not applied only when the section holds content of the dropped uncertainty that is neither: name the first paragraph that holds it, say what to leave out, and name in the reason the words that are neither."
    );
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.answers242.instruction).toContain(
      "Before you judge it not applied, compare the advancement or result with every COVER item in the plan checks."
    );
    expect(result.draftText).toBe(REPAIRED);
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toEqual({
      section: "244",
      source: "model",
      instruction: leaveOutInstruction(DROPPED.wording),
      outcome: "applied",
      tier: "none",
      reason: backstopReason(2, onTheStall.reason, "19 days, 6 days"),
      repaired: false,
      planRef: { summaryVersionId: SUMMARY_VERSION, droppedSeedId: DROPPED_ID, mergedItemIds: [] },
    });
    expect(planCoverage(result)).toEqual({ status: "complete", applied: 5, total: 5 });
  });

  it("keeps a real leak not applied and repairs it: the flagged paragraph holds a dropped figure, whatever its reason cites", async () => {
    for (const reason of ["P4 narrates Trial 2 at 6 C (44 days).", "P4 repeats the 19 vs 6 days result."]) {
      const sent = installFetch({
        draft: [P1, P2, P3, P4_LEAK].join("\n\n"),
        repair: REPAIRED,
        checks: [
          [skipHonoured, ...allCovered, { ...onTheStall, paragraph: 4, reason }],
          [skipHonoured, ...allCovered, leftOut],
        ],
      });
      const result = await draft("244", claimLeaveOut());
      expect(sent.map((request) => request.stage), reason).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
      expect(sent[2]!.user, reason).toContain("- Paragraph 4: leave out the uncertainty the writer dropped (");
      expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID), reason).toMatchObject({
        outcome: "applied",
        repaired: true,
        reason: "Nothing of the dropped uncertainty.",
      });
    }
  });

  it("keeps the model's verdict when its reason cites no figure, or one no signed-off item uses", async () => {
    for (const reason of ["P2 restates whether acclimation works.", "P2 cites 12 days of stall."]) {
      const sent = installFetch({
        draft: REPAIRED,
        repair: REPAIRED.replace("6 days acclimated", "about 6 days acclimated"),
        checks: [[skipHonoured, ...allCovered, { ...onTheStall, reason }], [skipHonoured, ...allCovered, { ...onTheStall, reason }]],
      });
      const result = await draft("244", claimLeaveOut());
      expect(sent.map((request) => request.stage), reason).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
      expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID), reason).toMatchObject({
        outcome: "not_applied",
        reason,
      });
    }
  });

  it("applies to the check of the final text after a repair made for another issue", async () => {
    const withoutDose = [P1, P2].join("\n\n");
    const sent = installFetch({
      draft: withoutDose,
      repair: REPAIRED,
      checks: [
        [skipHonoured, covered(ITEM.workplan, 1), covered(ITEM.stall, 2), { itemId: ITEM.dose, mergedItemIds: [ITEM.dose], paragraph: 0, outcome: "not_applied", reason: "The dosing result is missing.", repairGuidance: "Add the dosing result." }, leftOut],
        [skipHonoured, ...allCovered, onTheStall],
      ],
    });
    const result = await draft("244", claimLeaveOut());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED);
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({
      outcome: "applied",
      repaired: false,
      reason: backstopReason(2, onTheStall.reason, "19 days, 6 days"),
    });
    expect(rowOf(result, (ref) => ref.itemId === ITEM.dose)).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("review P2-5: keeps a verdict when another paragraph of the Line holds a dropped figure, when a sentence restates the dropped uncertainty, or when its guidance cites a figure no signed-off item uses", async () => {
    const check = plan244({ rule: false, dropped: [DROPPED] }).checks.find((candidate) => candidate.droppedSeedId)!;
    const verdict = { droppedSeedId: DROPPED_ID, mergedItemIds: [], paragraphIndex: 1, outcome: "not_applied" as const, reason: onTheStall.reason, actionableRepair: true };
    // (a) The flagged P2 holds none, but P4 holds 44 days and 6 C.
    const leakElsewhere = [P1, P2, P3, P4_LEAK].join("\n\n");
    expect(leaveOutFigureBackstop({ check, verdict, text: leakElsewhere, planWording: PLAN_WORDING })).toBeNull();
    // (c) A "44-day" run is the dropped figure too.
    expect(leaveOutFigureBackstop({ check, verdict, text: `${REPAIRED}\n\nA later 44-day run confirmed it.`, planWording: PLAN_WORDING })).toBeNull();
    // (d) A sentence of the Line restates the dropped uncertainty, with no figure.
    const restated = REPAIRED.replace(P1, `${P1} It was uncertain whether stepwise acclimation would actually work or only delay cold shock.`);
    expect(leaveOutFigureBackstop({ check, verdict, text: restated, planWording: PLAN_WORDING })).toBeNull();
    // (b) The reason cites no figure, the guidance cites signed-off ones: applied.
    expect(leaveOutFigureBackstop({
      check,
      verdict: { ...verdict, reason: "P2 flags the stall result.", repairGuidance: "Drop the 19 vs 6 days result." },
      text: REPAIRED,
      planWording: PLAN_WORDING,
    })?.outcome).toBe("applied");
    // (b) The guidance, or the unclipped text, cites a dropped figure: kept.
    expect(leaveOutFigureBackstop({
      check,
      verdict: { ...verdict, repairGuidance: "Drop 19 vs 6 days and the 29 days result." },
      text: REPAIRED,
      planWording: PLAN_WORDING,
    })).toBeNull();
    expect(leaveOutFigureBackstop({
      check,
      verdict: { ...verdict, repairText: "P2 states 19 vs 6 days, and the Trial 2 run took 29 days." },
      text: REPAIRED,
      planWording: PLAN_WORDING,
    })).toBeNull();

    // End to end: the leak in P4 keeps run 11's verdict, which goes to the repair.
    const sent = installFetch({
      draft: leakElsewhere,
      repair: REPAIRED,
      checks: [[skipHonoured, ...allCovered, onTheStall], [skipHonoured, ...allCovered, leftOut]],
    });
    const result = await draft("244", claimLeaveOut());
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED);
    expect(rowOf(result, (ref) => ref.droppedSeedId === DROPPED_ID)).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("reads nothing when the dropped uncertainty has no figure of its own, or the check is not a LEAVE OUT", () => {
    const check = plan244({ rule: false, dropped: [DROPPED] }).checks.find((candidate) => candidate.droppedSeedId)!;
    const verdict = { droppedSeedId: DROPPED_ID, mergedItemIds: [], paragraphIndex: 1, outcome: "not_applied" as const, reason: onTheStall.reason, actionableRepair: true };
    expect(leaveOutFigureBackstop({ check, verdict, text: REPAIRED, planWording: PLAN_WORDING })?.outcome).toBe("applied");
    // Every figure of the dropped uncertainty is also in the plan: no evidence either way.
    const figureless = { ...check, wording: ["It was uncertain whether acclimation works."], relationshipReferences: [{ seedId: "e", wording: [STALL] }] };
    expect(leaveOutFigureBackstop({ check: figureless, verdict, text: REPAIRED, planWording: PLAN_WORDING })).toBeNull();
    // A verdict with no valid paragraph, an applied one and a Skip are left alone.
    expect(leaveOutFigureBackstop({ check, verdict: { ...verdict, paragraphIndex: undefined }, text: REPAIRED, planWording: PLAN_WORDING })).toBeNull();
    expect(leaveOutFigureBackstop({ check, verdict: { ...verdict, paragraphIndex: 7 }, text: REPAIRED, planWording: PLAN_WORDING })).toBeNull();
    expect(leaveOutFigureBackstop({ check, verdict: { ...verdict, outcome: "applied" }, text: REPAIRED, planWording: PLAN_WORDING })).toBeNull();
    expect(leaveOutFigureBackstop({ check: { ...check, instruction: "skip" }, verdict, text: REPAIRED, planWording: PLAN_WORDING })).toBeNull();
    // A "6°C" in the flagged paragraph is the dropped uncertainty's own figure.
    const degreeSign = REPAIRED.replace(P2, "At 6°C the stall lasted 19 days unacclimated and 6 days acclimated.");
    expect(leaveOutFigureBackstop({ check, verdict, text: degreeSign, planWording: PLAN_WORDING })).toBeNull();
  });
});
