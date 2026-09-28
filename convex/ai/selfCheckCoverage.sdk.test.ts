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
  SKIP_BREAK_UNLOCATED_REASON,
  summaryChecklist,
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
const EMPTY_VERDICTS = "Return an empty verdicts list: every label already has its verdict.";
const EMPTY_PLAN_VERDICTS =
  "Return an empty planVerdicts list: every plan check already has its verdict.";

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

/** A request's data blocks: the user text before its closing checklist. */
function dataOf(
  body: WireBody,
  ordinary: readonly SummaryOrdinaryCheck[],
  plans: readonly SelfCheckPlanCheck[]
): string {
  const closing = `\n\n${checklistLines(ordinary, plans)}`;
  const user = userOf(body);
  if (!user.endsWith(closing)) throw new Error("Request does not end with its checklist");
  return user.slice(0, -closing.length);
}

function checklistLines(
  ordinary: readonly SummaryOrdinaryCheck[],
  plans: readonly SelfCheckPlanCheck[]
): string {
  return [
    ...(ordinary.length
      ? [[
          `Return exactly ${ordinary.length} ${ordinary.length === 1 ? "verdict" : "verdicts"} in verdicts, one for each label below, even when nothing in the section bears on the label:`,
          ...ordinary.map((check) => `- ${check.label} (check ${check.check})`),
        ].join("\n")]
      : []),
    ...(plans.length
      ? [[
          `Return exactly ${plans.length} ${plans.length === 1 ? "planVerdict" : "planVerdicts"}, one for each plan check below:`,
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
    // The follow-up repeats the data blocks, not the full list, and names
    // only what is missing.
    const data = dataOf(first, ordinary, plans);
    expect(data).toContain("[P1] Kestrel Instruments builds in-line water analyzers");
    expect(userOf(followUp)).toBe(
      `${data}\n\n${FOLLOW_UP_TEXT}\n\n${checklistLines(missing, missingPlans)}`
    );
    expect(userOf(followUp)).not.toContain("Return exactly 22 verdicts");
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
      "Return exactly 1 planVerdict, one for each plan check below:\n- skippedRoleId prior_year_status"
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

  it("keeps a follow-up's valid verdicts and drops only the label nobody supplied", async () => {
    const input = inputFor(CASE_246);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const firstAnswer = {
      verdicts: ordinary.slice(0, 8).map(verdictFor),
      planVerdicts: plans.slice(0, 4).map(planVerdictFor),
    };
    // The follow-up answers everything missing, plus a label nobody
    // supplied: that one verdict is dropped (2026-09-28, run 4).
    const { result, bodies } = await runThroughSdk(input, [firstAnswer, {
      verdicts: [
        ...ordinary.slice(8).map(verdictFor),
        { ...verdictFor(ordinary[1]!), instruction: "confidence:C99" },
      ],
      planVerdicts: [planVerdictFor(plans[4]!, 4)],
    }]);

    expect(bodies).toHaveLength(2);
    expect(result.verdicts).toHaveLength(19);
    expect(result.verdicts.every((verdict) => verdict.outcome === "applied" && !verdict.notChecked))
      .toBe(true);
    expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
  });

  it("keeps the first answer and records every missing label as not checked when the follow-up is unusable", async () => {
    const input = inputFor(CASE_246);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const firstAnswer = {
      verdicts: ordinary.slice(0, 8).map(verdictFor),
      planVerdicts: plans.slice(0, 4).map(planVerdictFor),
    };
    // More than half of the follow-up's verdicts are invalid: it is set aside.
    const { result, bodies } = await runThroughSdk(input, [firstAnswer, {
      verdicts: [
        verdictFor(ordinary[8]!),
        ...ordinary.slice(9).map((check) => ({ ...verdictFor(check), instruction: "confidence:C99" })),
      ],
      planVerdicts: [planVerdictFor(plans[4]!, 4)],
    }]);

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

  it("drops re-sent verdicts for plan checks already answered and merges the missing labels", async () => {
    const input = inputFor(CASE_244);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const allPlanVerdicts = plans.map(planVerdictFor);
    const { result, bodies } = await runThroughSdk(input, [
      // Every plan verdict, ten of 17 labels.
      { verdicts: ordinary.slice(0, 10).map(verdictFor), planVerdicts: allPlanVerdicts },
      // The follow-up sends the seven missing labels and every plan verdict
      // again, one of them now not applied.
      {
        verdicts: ordinary.slice(10).map(verdictFor),
        planVerdicts: allPlanVerdicts.map((verdict, index) =>
          index === 1 ? { ...verdict, outcome: "not_applied", reason: "Changed its mind." } : verdict),
      },
    ]);

    expect(bodies).toHaveLength(2);
    const [first, followUp] = bodies as [WireBody, WireBody];
    expect(userOf(followUp)).toBe(
      `${dataOf(first, ordinary, plans)}\n\n${FOLLOW_UP_TEXT}\n\n` +
        `${checklistLines(ordinary.slice(10), [])}\n\n${EMPTY_PLAN_VERDICTS}`
    );
    expect(schemaOf(followUp).planVerdicts.maxItems).toBe(0);
    // The labels merge; the first answer's plan verdicts stand, once each.
    expect(result.verdicts).toHaveLength(17);
    expect(result.verdicts.some((verdict) => verdict.notChecked)).toBe(false);
    expect(result.verdicts.map((verdict) => verdict.instruction))
      .toEqual(ordinary.map((check) => check.instruction));
    expect(result.planVerdicts).toHaveLength(plans.length);
    expect(result.planVerdicts.every((verdict) =>
      verdict.outcome === "applied" && verdict.reason !== "Changed its mind.")).toBe(true);
  });

  it("asks for an empty verdicts list when only plan checks are missing", async () => {
    const input = inputFor(CASE_242);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const { result, bodies } = await runThroughSdk(input, [
      { verdicts: ordinary.map(verdictFor), planVerdicts: plans.slice(0, 5).map(planVerdictFor) },
      { verdicts: [], planVerdicts: [planVerdictFor(plans[5]!, 5)] },
    ]);

    const [first, followUp] = bodies as [WireBody, WireBody];
    expect(userOf(followUp)).toBe(
      `${dataOf(first, ordinary, plans)}\n\n${FOLLOW_UP_TEXT}\n\n` +
        `${checklistLines([], plans.slice(5))}\n\n${EMPTY_VERDICTS}`
    );
    expect(userOf(followUp)).toContain("Return exactly 1 planVerdict, one for each plan check below:");
    expect(schemaOf(followUp).verdicts.maxItems).toBe(0);
    expect(result.planVerdicts.map((verdict) => verdict.outcome))
      .toEqual(plans.map(() => "applied"));
  });

  it("words each count in the singular or the plural", () => {
    const ordinary = ordinaryOf(inputFor(CASE_242));
    const plans = planChecksFor(CASE_242);
    expect(summaryChecklist(ordinary.slice(0, 1), plans.slice(0, 1))).toBe(
      "Return exactly 1 verdict in verdicts, one for each label below, even when nothing in the section bears on the label:\n" +
        "- storyline (check storyline)\n\n" +
        "Return exactly 1 planVerdict, one for each plan check below:\n- itemId item-242-1"
    );
    expect(summaryChecklist(ordinary.slice(0, 2), plans.slice(0, 2))).toBe(
      "Return exactly 2 verdicts in verdicts, one for each label below, even when nothing in the section bears on the label:\n" +
        "- storyline (check storyline)\n- confidence:C1 (check confidence)\n\n" +
        "Return exactly 2 planVerdicts, one for each plan check below:\n- itemId item-242-1\n- itemId item-242-2"
    );
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
      // No plan check is missing, so that list is asked for empty.
      expect(userOf(followUp).endsWith(
        `\n\n${checklistLines(ordinary.slice(fixture.returned), [])}\n\n${EMPTY_PLAN_VERDICTS}`
      )).toBe(true);
      expect(schemaOf(followUp).planVerdicts.maxItems).toBe(0);
      expect(result.verdicts).toHaveLength(fixture.labels);
      expect(result.verdicts.some((verdict) => verdict.notChecked)).toBe(false);
      expect(result.planVerdicts).toHaveLength(plans.length);
      // Every item and the Skip carry the model's own verdict. An item is
      // covered where its paragraph says; a Skip is honoured by absence, so
      // it carries no paragraph (2026-09-28, third).
      expect(result.planVerdicts.every((verdict) =>
        verdict.outcome === "applied" &&
        (verdict.skippedRoleId ? verdict.paragraphIndex === undefined : verdict.paragraphIndex !== undefined)
      )).toBe(true);
    }
  );
});

// 2026-09-28 (third), release suite finding: "Omit signed-off role
// prior_year_status: not_applied; Applied plan verdict did not identify valid
// paragraph evidence." A Skip is honoured by absence, so an applied Skip
// needs no paragraph; a Skip that is not honoured names where the role is.
describe("Skips are honoured by absence (real SDK, fetch stubbed)", () => {
  const input = inputFor(CASE_244);
  const ordinary = ordinaryOf(input);
  const plans = input.planChecks ?? [];
  const skip = plans.find((check) => check.skippedRoleId)!;
  const answerWithSkip = (skipVerdict: Record<string, unknown>) => ({
    verdicts: ordinary.map(verdictFor),
    planVerdicts: plans.map((check, index) =>
      check.skippedRoleId ? skipVerdict : planVerdictFor(check, index)),
  });
  const skipOf = (result: ModelSelfCheckResult) =>
    result.planVerdicts.find((verdict) => verdict.skippedRoleId === skip.skippedRoleId)!;

  it("tells the model how a Skip carries its paragraph", async () => {
    const { bodies } = await runThroughSdk(input, [
      answerWithSkip({ skippedRoleId: skip.skippedRoleId, mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "The role is absent." }),
    ]);
    const [body] = bodies as [WireBody];
    expect(JSON.stringify(body.system)).toContain(
      "A Skip is honoured by absence: it is applied only when the role is absent, with paragraph 0. A Skip that is not applied names the paragraph where the role appears."
    );
    const paragraph = (body.tools[0]!.input_schema.properties.planVerdicts.items.properties as unknown as Record<string, { description?: string }>).paragraph;
    expect(paragraph?.description).toBe(
      "Item: the 1-based [P#] holding the evidence when applied, 0 when not applied. Skip: 0 when applied (the role is absent), the 1-based [P#] where the role appears when not applied."
    );
  });

  it.each([
    { name: "paragraph 0", paragraph: 0 as number | undefined },
    { name: "no paragraph", paragraph: undefined },
  ])("accepts a Skip honoured with $name", async ({ paragraph }) => {
    const { result, bodies } = await runThroughSdk(input, [
      answerWithSkip({
        skippedRoleId: skip.skippedRoleId,
        mergedItemIds: [],
        ...(paragraph === undefined ? {} : { paragraph }),
        outcome: "applied",
        reason: "The role is absent.",
      }),
    ]);
    expect(bodies).toHaveLength(1);
    expect(skipOf(result)).toEqual({
      skippedRoleId: skip.skippedRoleId,
      mergedItemIds: [],
      outcome: "applied",
      reason: "The role is absent.",
    });
  });

  it("records a broken Skip at the paragraph it cites, and sends it to the repair", async () => {
    const { result } = await runThroughSdk(input, [
      answerWithSkip({
        skippedRoleId: skip.skippedRoleId,
        mergedItemIds: [],
        paragraph: 2,
        outcome: "not_applied",
        reason: "P2 reports last year's status.",
        repairGuidance: "Remove the prior-year status from P2.",
      }),
    ]);
    expect(skipOf(result)).toEqual({
      skippedRoleId: skip.skippedRoleId,
      mergedItemIds: [],
      paragraphIndex: 1,
      outcome: "not_applied",
      reason: "P2 reports last year's status.",
      repairGuidance: "Remove the prior-year status from P2.",
      actionableRepair: true,
    });
  });

  it.each([
    { name: "no paragraph", paragraph: undefined as number | undefined },
    { name: "paragraph 0", paragraph: 0 },
    { name: "a paragraph past the Section", paragraph: PARAGRAPHS.length + 1 },
  ])("keeps a broken Skip that cites $name not honoured, with no repair", async ({ paragraph }) => {
    const { result } = await runThroughSdk(input, [
      answerWithSkip({
        skippedRoleId: skip.skippedRoleId,
        mergedItemIds: [],
        ...(paragraph === undefined ? {} : { paragraph }),
        outcome: "not_applied",
        reason: "The section reports last year's status.",
        repairGuidance: "Remove the prior-year status.",
      }),
    ]);
    expect(skipOf(result)).toEqual({
      skippedRoleId: skip.skippedRoleId,
      mergedItemIds: [],
      outcome: "not_applied",
      reason: SKIP_BREAK_UNLOCATED_REASON,
      actionableRepair: false,
    });
  });

  it("still asks an applied item for its paragraph", async () => {
    const item = plans.find((check) => check.itemId)!;
    const { result } = await runThroughSdk(input, [{
      verdicts: ordinary.map(verdictFor),
      planVerdicts: plans.map((check, index) =>
        check === item
          ? { itemId: item.itemId, mergedItemIds: [...item.mergedItemIds], paragraph: 0, outcome: "applied", reason: "Covered." }
          : planVerdictFor(check, index)),
    }]);
    expect(result.planVerdicts.find((verdict) => verdict.itemId === item.itemId)).toMatchObject({
      outcome: "not_applied",
      reason: "Applied plan verdict did not identify valid paragraph evidence.",
      actionableRepair: false,
    });
  });
});

// Release suite run 4 (exclusion-conflict, Line 246): "Self-check call failed
// (unknown: ordinary verdict 17: label of 2 escaped bytes matches no supplied
// label)". The model copied a short marker instead of the label, and that
// one verdict failed the whole check, so every plan row read "did not
// complete". Now the verdict is dropped and its label asked for once
// (2026-09-28, run 4).
describe("one garbled label no longer fails the Self-check (real SDK, fetch stubbed)", () => {
  it("drops ordinary verdict 17 with a 2-byte label and asks once for its label", async () => {
    const input = inputFor(CASE_246);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    expect(ordinary).toHaveLength(19);
    const garbled = ordinary[16]!;
    const first = {
      verdicts: ordinary.map((check, index) =>
        index === 16 ? { ...verdictFor(check), instruction: "C3" } : verdictFor(check)),
      planVerdicts: plans.map(planVerdictFor),
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { result, bodies } = await runThroughSdk(input, [
        first,
        { verdicts: [verdictFor(garbled)], planVerdicts: [] },
      ]);

      expect(bodies).toHaveLength(2);
      const [, followUp] = bodies as [WireBody, WireBody];
      expect(userOf(followUp).endsWith(
        `\n\n${checklistLines([garbled], [])}\n\n${EMPTY_PLAN_VERDICTS}`
      )).toBe(true);
      expect(schemaOf(followUp).verdicts.items.properties.instruction.enum).toEqual([garbled.label]);
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain("ordinary verdict 17: label of 2 escaped bytes matches no supplied label");
      expect(logged).not.toContain("Not mentioned in the section.");
      expect(result.verdicts).toHaveLength(19);
      expect(result.verdicts.every((verdict) => verdict.outcome === "applied" && !verdict.notChecked))
        .toBe(true);
      expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("records the garbled label as not checked when the follow-up repeats it", async () => {
    const input = inputFor(CASE_246);
    const ordinary = ordinaryOf(input);
    const plans = input.planChecks ?? [];
    const garbled = ordinary[16]!;
    const first = {
      verdicts: ordinary.map((check, index) =>
        index === 16 ? { ...verdictFor(check), instruction: "C3" } : verdictFor(check)),
      planVerdicts: plans.map(planVerdictFor),
    };
    const { result, bodies } = await runThroughSdk(input, [
      first,
      { verdicts: [{ ...verdictFor(garbled), instruction: "C3" }], planVerdicts: [] },
    ]);

    expect(bodies).toHaveLength(2);
    expect(result.verdicts.filter((verdict) => verdict.notChecked)).toEqual([
      expect.objectContaining({ instruction: garbled.instruction, reason: NOT_CHECKED_REASON }),
    ]);
    // The plan rows keep their verdicts: nothing about the plan failed.
    expect(result.planVerdicts.every((verdict) => verdict.outcome === "applied")).toBe(true);
  });
});
