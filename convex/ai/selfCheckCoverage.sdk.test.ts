/// <reference types="vite/client" />

/**
 * The Summary plan coverage Self-check completes per label (2026-09-28,
 * release suite finding). Only `fetch` is stubbed: the Anthropic SDK, the
 * request instrumentation and the structured decoding are the production
 * ones.
 *
 * The first real release suite run failed every Section's coverage check:
 * the model returned 9 verdicts for 22 labels (6 for 17, 8 for 19) and the
 * exact-count rule rejected the whole answer, so every plan item and the
 * Skip were recorded as "did not complete". Now the request lists every
 * label and plan check with their counts, in the text and in the tool
 * schema; an answer that still misses some gets one follow-up for only
 * those; and whatever is still missing is recorded as not checked, one by
 * one. A full answer is accepted in one request, as before.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../schema";
import type { ActionCtx } from "../_generated/server";
import { instrumentedAnthropic } from "./instrument";
import type { GenerationClient } from "./openrouterCore";
import {
  NOT_CHECKED_REASON,
  PLAN_ITEM_NOT_CHECKED_REASON,
  PLAN_SKIP_NOT_CHECKED_REASON,
  runModelSelfCheck,
  type ModelSelfCheckResult,
  type SelfCheckModelInput,
  type SelfCheckPlanCheck,
} from "./selfCheck";
import {
  projectSummaryOrdinaryChecks,
  serializeFrozenSummaryPlanChecks,
  type SummaryOrdinaryCheck,
} from "../lib/seedRevisions";
import type { PdSubsectionRoleId } from "../../shared/pdSubsections";

// The credit latch read (decision 64) runs before each Anthropic request;
// load its module first so a cold import cannot race the fake clock.
beforeAll(async () => {
  await import("../providerCredit");
});

const modules = import.meta.glob("../**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

const MODEL = "claude-sonnet-5";
const FOLLOW_UP_TEXT =
  "Your previous answer gave no verdict for the labels and plan checks listed below. " +
  "Return verdicts for only these, under the same rules. " +
  "Do not repeat verdicts you already gave and leave out storylineQuestion.";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-self-check-key");
  // No request can escape even if a test forgets its own stub.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// A fictional project: the Tessel water analyzer (Kestrel Instruments).
const CONFIDENCE_MAP = Array.from({ length: 14 }, (_, index) => ({
  text: `Tessel bench result ${index + 1} is recorded in the lab notebook.`,
  confidence: index % 3 === 0 ? "partial" : "established",
}));
const GLOSSARY = [
  "fouling rig",
  "reference cell",
  "drift window",
  "wiper cycle",
  "coupon batch",
  "baseline trace",
  "correction curve",
];
const PARAGRAPHS = [
  "Kestrel Instruments builds in-line water analyzers for treatment plants.",
  "The Tessel analyzer lost calibration after 12 days in secondary effluent.",
  "The team could not predict how coating thickness would change drift.",
  "Hypothesis: a thin fluoropolymer layer slows fouling on the window.",
  "Coupons were soaked for 30 days and read every 3 days.",
];

type Fixture = {
  section: "242" | "244" | "246";
  labels: number;
  glossary: number;
  returned: number;
  roles: PdSubsectionRoleId[];
  skip?: PdSubsectionRoleId;
};

/** The reviewer's counts: 22, 17 and 19 labels; 15 items and one Skip. */
const REVIEWER_CASES: Fixture[] = [
  {
    section: "242",
    labels: 22,
    glossary: 7,
    returned: 9,
    roles: [
      "company_context",
      "goal_problem",
      "passive_limitations",
      "technological_objective",
      "active_uncertainties",
      "active_uncertainties",
    ],
  },
  {
    section: "244",
    labels: 17,
    glossary: 2,
    returned: 6,
    roles: ["workplan", "hypothesis", "experimentation", "experimentation"],
    skip: "prior_year_status",
  },
  {
    section: "246",
    labels: 19,
    glossary: 4,
    returned: 8,
    roles: [
      "overall_advancement",
      "specific_advancements",
      "specific_advancements",
      "project_status",
      "goal_improvements",
    ],
  },
];
const [CASE_242, CASE_244, CASE_246] = REVIEWER_CASES as [Fixture, Fixture, Fixture];

function planChecksFor(fixture: Fixture): SelfCheckPlanCheck[] {
  const items: SelfCheckPlanCheck[] = fixture.roles.map((roleId, index) => {
    const itemId = `item-${fixture.section}-${index + 1}`;
    return {
      itemId,
      roleId,
      mergedItemIds: [itemId],
      instruction: "cover",
      confirmedExclusion: false,
      support: "source_supported",
      wording: [`Signed-off Tessel point ${index + 1}.`],
      relationshipReferences: [],
      sourceReferences: [],
    };
  });
  return fixture.skip
    ? [
        {
          skippedRoleId: fixture.skip,
          roleId: fixture.skip,
          mergedItemIds: [],
          instruction: "skip",
          confirmedExclusion: false,
          wording: [],
          relationshipReferences: [],
          sourceReferences: [],
        },
        ...items,
      ]
    : items;
}

function inputFor(fixture: Fixture): SelfCheckModelInput {
  const planChecks = planChecksFor(fixture);
  return {
    section: fixture.section,
    text: PARAGRAPHS.join("\n\n"),
    storylineText: "Kestrel set out to keep the Tessel window clean for 30 days.",
    confidenceMap: CONFIDENCE_MAP,
    glossaryCandidates: GLOSSARY.slice(0, fixture.glossary),
    rules: [],
    model: MODEL,
    planChecks,
    planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks),
  };
}

function ordinaryOf(input: SelfCheckModelInput): SummaryOrdinaryCheck[] {
  return projectSummaryOrdinaryChecks({
    storylineText: input.storylineText,
    confidenceMap: input.confidenceMap,
    glossaryTerms: input.glossaryCandidates,
    rules: input.rules,
  });
}

const verdictFor = (check: SummaryOrdinaryCheck) => ({
  paragraph: 0,
  check: check.check,
  instruction: check.label,
  outcome: "applied",
  reason: "Not mentioned in the section.",
});
const planVerdictFor = (check: SelfCheckPlanCheck, index: number) => ({
  ...(check.itemId ? { itemId: check.itemId } : { skippedRoleId: check.skippedRoleId }),
  mergedItemIds: [...check.mergedItemIds],
  paragraph: (index % PARAGRAPHS.length) + 1,
  outcome: "applied",
  reason: check.itemId ? "Covered." : "The role is absent.",
});

type WireSchema = {
  properties: {
    verdicts: {
      minItems: number;
      maxItems: number;
      items: { properties: { instruction: { enum?: string[] } } };
    };
    planVerdicts: {
      minItems: number;
      maxItems: number;
      items: {
        properties: {
          itemId: { enum?: string[] };
          skippedRoleId: { enum?: string[] };
        };
      };
    };
  };
};
type WireBody = {
  model: string;
  max_tokens: number;
  system: unknown;
  tools: Array<{ name: string; input_schema: WireSchema }>;
  messages: Array<{ role: string; content: unknown }>;
};

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) =>
      block && typeof block === "object" && "text" in block && typeof block.text === "string"
        ? block.text
        : "")
    .join("");
}
const userOf = (body: WireBody) => body.messages.map((message) => textOf(message.content)).join("");
const schemaOf = (body: WireBody) => {
  const tool = body.tools[0];
  if (!tool) throw new Error("Request carried no tool");
  return tool.input_schema.properties;
};

function toolAnswer(input: unknown) {
  return Response.json({
    id: "msg_self_check",
    type: "message",
    role: "assistant",
    model: MODEL,
    content: [{ type: "tool_use", id: "toolu_self_check", name: "submit_self_check", input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 40, output_tokens: 900 },
  });
}

/** Runs the Self-check through the real SDK; `answers` are sent in order. */
async function runThroughSdk(
  input: SelfCheckModelInput,
  answers: unknown[]
): Promise<{ result: ModelSelfCheckResult; bodies: WireBody[] }> {
  const t = convexTest(schema, modules);
  const bodies: WireBody[] = [];
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (request, init) => {
    bodies.push(await new Request(request, init).json() as WireBody);
    const answer = answers[bodies.length - 1];
    if (answer === undefined) throw new Error("No answer scripted for this request");
    return toolAnswer(answer);
  }));
  const result = await runAction(t, async (ctx) =>
    runModelSelfCheck(
      instrumentedAnthropic(ctx, { callSite: "self-check-coverage" }) as unknown as GenerationClient,
      input
    ));
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { result, bodies };
}

function checklistLines(
  ordinary: readonly SummaryOrdinaryCheck[],
  plans: readonly SelfCheckPlanCheck[]
): string {
  return [
    ...(ordinary.length
      ? [[
          `Return exactly ${ordinary.length} verdicts in verdicts, one for each label below, even when nothing in the section bears on the label:`,
          ...ordinary.map((check) => `- ${check.label} (check ${check.check})`),
        ].join("\n")]
      : []),
    ...(plans.length
      ? [[
          `Return exactly ${plans.length} planVerdicts, one for each plan check below:`,
          ...plans.map((check) =>
            check.itemId ? `- itemId ${check.itemId}` : `- skippedRoleId ${check.skippedRoleId}`),
        ].join("\n")]
      : []),
  ].join("\n\n");
}

describe("Summary plan coverage Self-check through the SDK boundary", () => {
  it("lists every label and plan check with their counts and accepts a full answer in one request", async () => {
    const input = inputFor(CASE_242);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    expect(ordinary).toHaveLength(22);
    const full = {
      verdicts: ordinary.map(verdictFor),
      planVerdicts: plans.map(planVerdictFor),
    };
    const { result, bodies } = await runThroughSdk(input, [full]);

    expect(bodies).toHaveLength(1);
    const body = bodies[0]!;
    expect(body.model).toBe(MODEL);
    expect(body.max_tokens).toBe(16_384);
    const system = JSON.stringify(body.system);
    expect(system).toContain("Signed-off content plan (Summary mode)");
    expect(system).toContain("A label nothing in the section bears on still gets its verdict");
    // Every label and plan check is listed at the end of the request.
    expect(userOf(body).endsWith(`\n\n${checklistLines(ordinary, plans)}`)).toBe(true);
    // And the tool schema holds the same values and counts.
    const toolSchema = schemaOf(body);
    expect(toolSchema.verdicts.minItems).toBe(22);
    expect(toolSchema.verdicts.maxItems).toBe(22);
    expect(toolSchema.verdicts.items.properties.instruction.enum)
      .toEqual(ordinary.map((check) => check.label));
    expect(toolSchema.planVerdicts.minItems).toBe(plans.length);
    expect(toolSchema.planVerdicts.maxItems).toBe(plans.length);
    expect(toolSchema.planVerdicts.items.properties.itemId.enum)
      .toEqual(plans.map((check) => check.itemId));
    expect(toolSchema.planVerdicts.items.properties.skippedRoleId.enum).toBeUndefined();

    // The answer is used as it came: no follow-up, nothing not checked.
    expect(result.verdicts).toHaveLength(22);
    expect(result.verdicts.map((verdict) => verdict.instruction))
      .toEqual(ordinary.map((check) => check.instruction));
    expect(result.verdicts.every((verdict) =>
      verdict.outcome === "applied" && !verdict.notChecked && verdict.paragraphIndex === undefined
    )).toBe(true);
    expect(result.planVerdicts.map((verdict) =>
      [verdict.itemId, verdict.outcome, verdict.paragraphIndex]))
      .toEqual(plans.map((check, index) => [check.itemId, "applied", index % PARAGRAPHS.length]));
  });

  it("completes a short answer with one follow-up for only the missing labels and plan checks", async () => {
    const input = inputFor(CASE_242);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const answered = ordinary.slice(0, 9);
    const missing = ordinary.slice(9);
    const answeredPlans = plans.slice(0, 4);
    const missingPlans = plans.slice(4);
    const { result, bodies } = await runThroughSdk(input, [
      { verdicts: answered.map(verdictFor), planVerdicts: answeredPlans.map(planVerdictFor) },
      {
        verdicts: missing.map(verdictFor),
        planVerdicts: missingPlans.map((check, index) => planVerdictFor(check, index + 4)),
      },
    ]);

    expect(bodies).toHaveLength(2);
    const [first, followUp] = bodies as [WireBody, WireBody];
    // The follow-up repeats the request and names only what is missing.
    expect(userOf(followUp)).toBe(
      `${userOf(first)}\n\n${FOLLOW_UP_TEXT}\n\n${checklistLines(missing, missingPlans)}`
    );
    expect(followUp.system).toEqual(first.system);
    expect(followUp.model).toBe(MODEL);
    const toolSchema = schemaOf(followUp);
    expect(toolSchema.verdicts.minItems).toBe(13);
    expect(toolSchema.verdicts.items.properties.instruction.enum)
      .toEqual(missing.map((check) => check.label));
    expect(toolSchema.planVerdicts.minItems).toBe(2);
    expect(toolSchema.planVerdicts.items.properties.itemId.enum)
      .toEqual(missingPlans.map((check) => check.itemId));

    expect(result.verdicts).toHaveLength(22);
    expect(result.verdicts.some((verdict) => verdict.notChecked)).toBe(false);
    expect(result.verdicts.map((verdict) => verdict.instruction))
      .toEqual(ordinary.map((check) => check.instruction));
    expect(result.planVerdicts.map((verdict) => verdict.outcome))
      .toEqual(plans.map(() => "applied"));
    expect(result.planVerdicts.map((verdict) => verdict.itemId))
      .toEqual(plans.map((check) => check.itemId));
  });

  it("records each label still missing after the follow-up as not checked, never as covered", async () => {
    const input = inputFor(CASE_244);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    expect(ordinary).toHaveLength(17);
    expect(plans[0]?.skippedRoleId).toBe("prior_year_status");
    const { result, bodies } = await runThroughSdk(input, [
      // Six labels, and every item but not the Skip.
      {
        verdicts: ordinary.slice(0, 6).map(verdictFor),
        planVerdicts: plans.slice(1).map((check, index) => planVerdictFor(check, index + 1)),
      },
      // The follow-up answers 8 of the 11 missing labels, and not the Skip.
      { verdicts: ordinary.slice(6, 14).map(verdictFor), planVerdicts: [] },
    ]);

    // One follow-up only.
    expect(bodies).toHaveLength(2);
    expect(userOf(bodies[1]!).endsWith(
      "Return exactly 1 planVerdicts, one for each plan check below:\n- skippedRoleId prior_year_status"
    )).toBe(true);
    expect(result.verdicts).toHaveLength(17);
    const notChecked = result.verdicts.filter((verdict) => verdict.notChecked);
    expect(notChecked.map((verdict) => verdict.instruction))
      .toEqual(ordinary.slice(14).map((check) => check.instruction));
    expect(notChecked.every((verdict) =>
      verdict.outcome === "not_applied" &&
      verdict.reason === NOT_CHECKED_REASON &&
      verdict.paragraphIndex === undefined &&
      verdict.repairGuidance === undefined
    )).toBe(true);
    expect(result.verdicts.filter((verdict) => !verdict.notChecked)
      .every((verdict) => verdict.outcome === "applied")).toBe(true);
    // The Skip is not checked: not honoured, and not a repair.
    expect(result.planVerdicts[0]).toEqual({
      skippedRoleId: "prior_year_status",
      mergedItemIds: [],
      outcome: "not_applied",
      reason: PLAN_SKIP_NOT_CHECKED_REASON,
      actionableRepair: false,
    });
    expect(result.planVerdicts.slice(1).every((verdict) => verdict.outcome === "applied"))
      .toBe(true);
  });

  it("keeps the first answer and records every missing label as not checked when the follow-up is unusable", async () => {
    const input = inputFor(CASE_246);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const firstAnswer = {
      verdicts: ordinary.slice(0, 8).map(verdictFor),
      planVerdicts: plans.slice(0, 4).map(planVerdictFor),
    };
    // The follow-up repeats the first answer: labels nobody asked for.
    const { result, bodies } = await runThroughSdk(input, [firstAnswer, firstAnswer]);

    expect(bodies).toHaveLength(2);
    expect(result.verdicts).toHaveLength(19);
    expect(result.verdicts.slice(0, 8).every((verdict) => verdict.outcome === "applied")).toBe(true);
    expect(result.verdicts.slice(8).every((verdict) =>
      verdict.notChecked && verdict.reason === NOT_CHECKED_REASON)).toBe(true);
    expect(result.planVerdicts.slice(0, 4).every((verdict) => verdict.outcome === "applied"))
      .toBe(true);
    expect(result.planVerdicts[4]).toEqual({
      itemId: plans[4]?.itemId,
      mergedItemIds: [plans[4]?.itemId],
      outcome: "not_applied",
      reason: PLAN_ITEM_NOT_CHECKED_REASON,
      actionableRepair: false,
    });
  });

  it.each(REVIEWER_CASES)(
    "completes the reviewer's Line $section case ($returned verdicts for $labels labels)",
    async (fixture) => {
      const input = inputFor(fixture);
      const ordinary = ordinaryOf(input);
      const plans = input.planChecks ?? [];
      expect(ordinary).toHaveLength(fixture.labels);
      const { result, bodies } = await runThroughSdk(input, [
        // As in the release suite run: every plan verdict, too few labels.
        {
          verdicts: ordinary.slice(0, fixture.returned).map(verdictFor),
          planVerdicts: plans.map(planVerdictFor),
        },
        { verdicts: ordinary.slice(fixture.returned).map(verdictFor), planVerdicts: [] },
      ]);

      expect(bodies).toHaveLength(2);
      const [first, followUp] = bodies as [WireBody, WireBody];
      expect(userOf(first)).toContain(
        `Return exactly ${fixture.labels} verdicts in verdicts, one for each label below`
      );
      expect(userOf(followUp).endsWith(
        `\n\n${checklistLines(ordinary.slice(fixture.returned), [])}`
      )).toBe(true);
      expect(schemaOf(followUp).planVerdicts.maxItems).toBe(0);
      expect(result.verdicts).toHaveLength(fixture.labels);
      expect(result.verdicts.some((verdict) => verdict.notChecked)).toBe(false);
      expect(result.planVerdicts).toHaveLength(plans.length);
      // Every item and the Skip carry the model's own verdict.
      expect(result.planVerdicts.every((verdict) =>
        verdict.outcome === "applied" && verdict.paragraphIndex !== undefined)).toBe(true);
    }
  );
});
