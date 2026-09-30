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
      "\n\n# WORK ANSWERS LINE 242 (outranks the Brief)\nDescribe work in this Line only for an uncertainty that Line 242 states, or work a COVER item holds or needs as its evidence. Line 242 is among the previously drafted sections above. Work a COVER item holds is a COVER experiment of this Line and what its work plan and hypothesis items state. Work a COVER item needs as its evidence is the work and figures behind a signed-off Line 246 item: those items are listed after this rule by step, and their work stays in this Line. Leave out Brief content that describes work on any other uncertainty, even where the Storyline or the Confidence Map supports it. Project status and next steps are not work to remove."
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
    expect(SUMMARY_PLAN_SELF_CHECK_REQUEST.workAnswers242.instruction).toContain(
      "Before you judge it not applied, compare the work with every COVER item in the plan checks and every Line 246 item in the wording. Work one of them states, and the work and figures that are its evidence, never make this check not applied."
    );
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
      "- Paragraph 4: describe work only for an uncertainty Line 242 states, or work a COVER item holds or needs as its evidence, and leave out the rest, but keep everything a COVER item holds or needs as its evidence. Leave out the sensor experiment in P4."
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
      "Describe work only for an uncertainty Line 242 states, or work a signed-off item holds or needs as its evidence"
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

  it("keeps the checked draft when a Rule C repair loses a COVER item the first check found covered (review P2-2)", async () => {
    // P2 mixes the signed-off stall result with Brief-only sensor work; the
    // repair drops the whole paragraph.
    const mixed = [P1, `${P2} The same loops also tested in-tank sensors, which drifted 8 percent by day 10.`, P3].join("\n\n");
    const gutted = [P1, P3].join("\n\n");
    installFetch({
      draft: mixed,
      repair: gutted,
      checks: [
        [skipHonoured, ...allCovered, { ...sensorStray, paragraph: 2, reason: "P2 adds sensor work, not in 242." }],
        [skipHonoured, covered(ITEM.workplan, 1), { itemId: ITEM.stall, mergedItemIds: [ITEM.stall], paragraph: 0, outcome: "not_applied", reason: "The stall result is gone." }, covered(ITEM.dose, 2), workAnswers],
      ],
    });
    const result = await draft("244", claimDrafted());
    expect(result.draftText).toBe(mixed);
    expect(rowOf(result, (ref) => ref.itemId === ITEM.stall)).toMatchObject({ outcome: "applied", repaired: false });
    expect(rowOf(result, (ref) => ref.ruleId === "work_answers_242")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: `P2 adds sensor work, not in 242.; repair not used (the repaired text no longer covers the signed-off item "${STALL}", and a leave-out fix must keep what a COVER item holds, so the checked draft was kept)`,
    });
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
  `The flagged content is a signed-off item: the Self-check flagged paragraph ${paragraph} ("${reason}"), but every figure it cited (${cited}) is in the signed-off plan's wording, and the paragraph holds none of the dropped uncertainty's own figures (${DROPPED_FIGURES}). Not sent to the repair.`;
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
