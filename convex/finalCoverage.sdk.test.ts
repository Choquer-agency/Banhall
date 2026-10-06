/// <reference types="vite/client" />
/**
 * 2026-09-28 (third): coverage is checked on the final text.
 *
 * The release suite recorded "Final coverage was not reverified after an
 * accepted repair changed the exact checked Section text." on every plan row
 * of every repaired Section: the coverage Self-check ran before the repair
 * and its compression, so once the text changed the record could not claim
 * coverage. Now a coverage-only Self-check (plan verdicts only, on the frozen
 * checking model, with the same one follow-up) checks the final text when an
 * accepted repair changed it, and the Compliance Note records its verdicts.
 * Since 2026-10-05 (Round 2, follow-up) that check is the full Self-check of
 * the final text, which carries the same plan checks.
 *
 * Every test drafts one Section through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed.
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
  FINAL_COVERAGE_NOT_CHECKED_REASON,
} from "./ai/orderedGeneration";
import {
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { PLAN_ITEM_NOT_CHECKED_REASON } from "./ai/selfCheck";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  serializeFrozenSummaryPlanChecks,
  type FrozenSummaryPlanCheck,
} from "./lib/seedRevisions";
import type { OrderedPayload } from "./lib/orderedChain";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const SONNET = "claude-sonnet-5";

/** Runs `body` inside a real Convex test action. */
function runAction<R>(t: TestConvex, body: (ctx: ActionCtx) => Promise<R>): Promise<R> {
  return t.action(body);
}

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

// ─── A fictional Line 244: the Marlow pump seal trials (Tidewater Pumps) ───

const DRAFT = [
  "Tidewater Pumps planned three seal trials on the Marlow slurry pump over the 2025 fiscal year.",
  "The team expected a graphite-filled face to outlast the carbon face in abrasive slurry.",
  "Bench runs compared both faces at 40 percent solids for 300 hours each.",
].join("\n\n");
const REPAIRED = [
  "Tidewater Pumps planned three seal trials on the Marlow slurry pump over the 2025 fiscal year.",
  "The team hypothesized that a graphite-filled face would outlast the carbon face in abrasive slurry.",
  "Bench runs compared both faces at 40 percent solids for 300 hours each, and the graphite face wore 30 percent less.",
].join("\n\n");

const ITEM_WORKPLAN = "item-marlow-workplan" as Id<"summaryItems">;
const ITEM_HYPOTHESIS = "item-marlow-hypothesis" as Id<"summaryItems">;

const PLAN_CHECKS: FrozenSummaryPlanCheck[] = [
  {
    skippedRoleId: "prior_year_status",
    roleId: "prior_year_status",
    mergedItemIds: [],
    instruction: "skip",
    confirmedExclusion: false,
    wording: [],
    relationshipReferences: [],
    sourceReferences: [],
  },
  {
    itemId: ITEM_WORKPLAN,
    roleId: "workplan",
    mergedItemIds: [ITEM_WORKPLAN],
    instruction: "cover",
    confirmedExclusion: false,
    support: "source_supported",
    wording: ["Three seal trials were planned for the 2025 fiscal year."],
    relationshipReferences: [],
    sourceReferences: [],
  },
  {
    itemId: ITEM_HYPOTHESIS,
    roleId: "hypothesis",
    mergedItemIds: [ITEM_HYPOTHESIS],
    instruction: "cover",
    confirmedExclusion: false,
    support: "source_supported",
    wording: ["A graphite-filled face would outlast the carbon face."],
    relationshipReferences: [],
    sourceReferences: [],
  },
];

const ANALYSIS = {
  company_context: "A fictional maker of slurry pumps",
  project_goal: "A pump seal that lasts a full season in abrasive slurry",
  business_problem: "Seals failed every few weeks",
  scientific_technical_problem: "No seal face was known to resist abrasive slurry wear",
  technological_objective: "A durable seal face for slurry pumps",
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
  summaryVersionId: "summary-version-marlow" as Id<"summaryVersions">,
  frozenStyleGuidance: "",
} satisfies OrderedPayload;

function claimFor(planChecks: FrozenSummaryPlanCheck[]) {
  return {
    projectId: "project-marlow",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 1,
    isFirstInOrder: false,
    priorSections: [],
    briefBlock: "",
    brief: null,
    planBlock: "--- BEGIN [SIGNED-OFF CONTENT PLAN] ---\n(fictional plan)\n--- END [SIGNED-OFF CONTENT PLAN] ---",
    planChecksBlock: serializeFrozenSummaryPlanChecks(planChecks),
    planChecks,
    // 2026-09-28 (second, edited terms): every claim carries its Line's
    // edited terms; this plan has none.
    editedTerms: [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type PlanAnswer = {
  itemId?: string;
  skippedRoleId?: string;
  mergedItemIds: string[];
  paragraph?: number;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
};
type Sent = { stage: string; json: Record<string, unknown>; user: string };

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((block: { text?: string }) => block.text ?? "").join("");
}
function userOf(json: Record<string, unknown>): string {
  const messages = (json.messages ?? []) as Array<{ role: string; content: unknown }>;
  return messages.filter((message) => message.role === "user").map((message) => textOf(message.content)).join("\n");
}
function toolOf(json: Record<string, unknown>): string | null {
  return (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
}
function schemaOf(sent: Sent) {
  return (sent.json.tools as Array<{ input_schema: { properties: Record<string, { maxItems?: number }> } }>)[0]!
    .input_schema.properties;
}

/**
 * Scripts one Section: its draft, its repair and the plan verdicts of each
 * Self-check request in order (the first check, then the check of the final
 * text and its follow-up). An answer may be a raw tool input. Since
 * 2026-10-05 (Round 2, follow-up) the check of the final text is the full
 * Self-check, so a Self-check sent after the repair is "finalCoverage".
 */
function installFetch(script: { repair?: string; checks: Array<PlanAnswer[] | { raw: unknown }> }): Sent[] {
  const sent: Sent[] = [];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.anthropic.com/v1/messages") {
        throw new Error(`Unexpected HTTP transport ${request.url}`);
      }
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const tool = toolOf(json);
      const stage = tool === "submit_self_check"
        ? sent.some((request) => request.stage === "repair") ? "finalCoverage" : "selfCheck"
        : tool ?? (user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section");
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
        const answer = "raw" in next ? next.raw : { verdicts: [], planVerdicts: next };
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: "toolu_self_check", name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text = stage === "repair" ? script.repair ?? DRAFT : DRAFT;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(planChecks: FrozenSummaryPlanCheck[] = PLAN_CHECKS) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await runAction(t, async (ctx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: claimFor(planChecks),
      payload: PAYLOAD,
      section: "244",
      clientFor,
    });
  });
}

const skipHonoured: PlanAnswer = {
  skippedRoleId: "prior_year_status",
  mergedItemIds: [],
  paragraph: 0,
  outcome: "applied",
  reason: "The role is absent.",
};
const workplanCovered = (paragraph: number): PlanAnswer => ({
  itemId: ITEM_WORKPLAN,
  mergedItemIds: [ITEM_WORKPLAN],
  paragraph,
  outcome: "applied",
  reason: "Covered.",
});
const hypothesisMissing: PlanAnswer = {
  itemId: ITEM_HYPOTHESIS,
  mergedItemIds: [ITEM_HYPOTHESIS],
  paragraph: 0,
  outcome: "not_applied",
  reason: "P2 states an expectation, not a hypothesis.",
  repairGuidance: "State the graphite face claim as the hypothesis.",
};
const hypothesisCovered = (paragraph: number): PlanAnswer => ({
  itemId: ITEM_HYPOTHESIS,
  mergedItemIds: [ITEM_HYPOTHESIS],
  paragraph,
  outcome: "applied",
  reason: "P2 states the hypothesis.",
});

function planRows(result: Awaited<ReturnType<typeof draft>>) {
  return result.notes.filter((note) => note.planRef);
}
function rowFor(result: Awaited<ReturnType<typeof draft>>, ref: string) {
  const row = planRows(result).find((note) =>
    note.planRef?.itemId === ref || note.planRef?.skippedRoleId === ref);
  if (!row) throw new Error(`No plan row for ${ref}`);
  return row;
}

describe("coverage is checked on the final text (real SDK, fetch stubbed)", () => {
  it("a repaired Section gets a coverage record on its final text", async () => {
    const sent = installFetch({
      repair: REPAIRED,
      checks: [
        [skipHonoured, workplanCovered(1), hypothesisMissing],
        [skipHonoured, workplanCovered(1), hypothesisCovered(2)],
      ],
    });
    const result = await draft();

    expect(result.draftText).toBe(REPAIRED);
    expect(sent.map((request) => request.stage)).toEqual([
      "section",
      "selfCheck",
      "repair",
      "finalCoverage",
    ]);
    const final = sent[3]!;
    // The final text and the plan checks. Since 2026-10-05 (Round 2,
    // follow-up) this is the full Self-check, the first check's request on
    // the final text, never the coverage-only one.
    expect(final.user).toContain("[P3] Bench runs compared both faces at 40 percent solids for 300 hours each, and the graphite face wore 30 percent less.");
    expect(final.user).not.toContain("The team expected a graphite-filled face");
    expect(final.user).toContain("--- BEGIN [CONTENT PLAN CHECKS] ---");
    expect(final.user.endsWith(
      "Return exactly 3 planVerdicts, one for each plan check below:\n" +
        `- skippedRoleId prior_year_status\n- itemId ${ITEM_WORKPLAN}\n- itemId ${ITEM_HYPOTHESIS}`
    )).toBe(true);
    const asDrafted = REPAIRED.split("\n\n").reduce(
      (user, paragraph, index) => user.replace(paragraph, DRAFT.split("\n\n")[index]!),
      final.user
    );
    expect(asDrafted).toBe(sent[1]!.user);
    expect(final.json.tools).toEqual(sent[1]!.json.tools);
    expect(schemaOf(final).planVerdicts?.maxItems).toBe(3);
    // The frozen checking model, the same one as the first check.
    expect(final.json.model).toBe(sent[1]!.json.model);

    expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({
      outcome: "applied",
      paragraphIndex: 1,
      reason: "P2 states the hypothesis.",
      repaired: true,
    });
    expect(rowFor(result, ITEM_WORKPLAN)).toMatchObject({
      outcome: "applied",
      paragraphIndex: 0,
      repaired: false,
    });
    expect(rowFor(result, "prior_year_status")).toMatchObject({ outcome: "applied", repaired: false });
    expect(rowFor(result, "prior_year_status").paragraphIndex).toBeUndefined();
    expect(result.notes.some((note) => note.reason.includes("not reverified"))).toBe(false);
    expect(JSON.parse(result.selfCheck)).not.toHaveProperty("finalCoverageCheckDetail");
    expect(result.notes.some((note) => note.instruction === "Final coverage Self-check")).toBe(false);
    expect(JSON.parse(result.selfCheck)).toMatchObject({
      planCoverage: { status: "complete", applied: 3, total: 3 },
    });
  });

  it("an unchanged Section makes no extra call", async () => {
    const sent = installFetch({
      checks: [[skipHonoured, workplanCovered(1), hypothesisCovered(2)]],
    });
    const result = await draft();

    expect(result.draftText).toBe(DRAFT);
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    expect(planRows(result).every((row) => row.outcome === "applied")).toBe(true);
  });

  it("a repair that comes back byte for byte the checked text makes no extra call", async () => {
    const sent = installFetch({
      repair: DRAFT,
      checks: [[skipHonoured, workplanCovered(1), hypothesisMissing]],
    });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair"]);
    // 2026-10-05 (Round 2 follow-up, review P2): the repair left the checked
    // text as it was, so the first verdict stands and nothing was repaired.
    expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "P2 states an expectation, not a hypothesis.; the repair left the checked text as it was",
    });
    expect(rowFor(result, ITEM_WORKPLAN)).toMatchObject({ outcome: "applied", paragraphIndex: 0 });
  });

  it("asks once more for a plan check the final answer missed, and records it as not checked when still missing", async () => {
    const sent = installFetch({
      repair: REPAIRED,
      checks: [
        [skipHonoured, workplanCovered(1), hypothesisMissing],
        [skipHonoured, workplanCovered(1)],
        [],
      ],
    });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual([
      "section",
      "selfCheck",
      "repair",
      "finalCoverage",
      "finalCoverage",
    ]);
    const followUp = sent[4]!;
    expect(followUp.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.missingFollowUp.prefix.trim());
    expect(followUp.user).toContain(`Return exactly 1 planVerdict, one for each plan check below:\n- itemId ${ITEM_HYPOTHESIS}`);
    expect(schemaOf(followUp).planVerdicts?.maxItems).toBe(1);
    expect(result.draftText).toBe(REPAIRED);
    expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({
      outcome: "not_applied",
      reason: PLAN_ITEM_NOT_CHECKED_REASON,
      repaired: false,
    });
    expect(rowFor(result, ITEM_WORKPLAN)).toMatchObject({ outcome: "applied", paragraphIndex: 0 });
    expect(JSON.parse(result.selfCheck)).toMatchObject({
      planCoverage: { status: "incomplete", applied: 2, total: 3 },
    });
  });

  it("records every plan row as not checked when the final coverage check fails as a whole", async () => {
    const sent = installFetch({
      repair: REPAIRED,
      checks: [
        [skipHonoured, workplanCovered(1), hypothesisMissing],
        // Its only verdict names an id nobody supplied: more invalid
        // verdicts than valid ones reject the whole answer.
        { raw: { verdicts: [], planVerdicts: [{ ...workplanCovered(1), itemId: "item-unknown", mergedItemIds: [] }] } },
      ],
    });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "repair", "finalCoverage"]);
    expect(result.draftText).toBe(REPAIRED);
    for (const row of planRows(result)) {
      expect(row).toMatchObject({
        outcome: "not_applied",
        reason: FINAL_COVERAGE_NOT_CHECKED_REASON,
        repaired: false,
      });
      expect(row.paragraphIndex).toBeUndefined();
    }
    // The first check itself ran, so the Section's Self-check stays ok.
    const summary = JSON.parse(result.selfCheck);
    expect(summary).toMatchObject({
      modelCheck: "ok",
      planCoverage: { status: "incomplete", applied: 0, total: 3 },
    });
    expect(summary).not.toHaveProperty("modelCheckDetail");
    // Why it failed is stored beside modelCheckDetail and shown on its own
    // row, like the Model Self-check row (2026-09-28, run 4).
    const detail = "1 of 1 verdicts invalid; first plan verdict 1: itemId of 12 escaped bytes matches no plan check";
    expect(summary.finalCoverageCheckDetail).toBe(detail);
    expect(summary.finalCoverageCheckDetail).not.toContain("item-unknown");
    expect(summary.finalCoverageCheckDetail).not.toContain("Covered.");
    expect(result.notes.find((note) => note.instruction === "Final coverage Self-check")).toMatchObject({
      source: "deterministic",
      outcome: "not_applied",
      tier: "none",
      reason: `Final coverage Self-check failed (unknown: ${detail}); plan rows not checked on the final text`,
    });
  });

  // Release suite run 4 (withdrawn-feedback, Line 246): the final answer's
  // verdict for a merged item repeated only its own id, and that one verdict
  // rejected the whole final check, so every plan row read "Not checked".
  // Now the verdict is dropped and the item asked for once (2026-09-28,
  // run 4).
  it("drops a final verdict with incomplete merged ids and asks once for that item", async () => {
    const mergedPartner = "item-marlow-bench-log" as Id<"summaryItems">;
    const merged = PLAN_CHECKS.map((check) =>
      check.itemId === ITEM_HYPOTHESIS
        ? { ...check, mergedItemIds: [ITEM_HYPOTHESIS, mergedPartner] }
        : check);
    const mergedMissing = { ...hypothesisMissing, mergedItemIds: [ITEM_HYPOTHESIS, mergedPartner] };
    const mergedCovered = { ...hypothesisCovered(2), mergedItemIds: [ITEM_HYPOTHESIS, mergedPartner] };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const sent = installFetch({
        repair: REPAIRED,
        checks: [
          [skipHonoured, workplanCovered(1), mergedMissing],
          [skipHonoured, workplanCovered(1), { ...mergedCovered, mergedItemIds: [ITEM_HYPOTHESIS] }],
          [mergedCovered],
        ],
      });
      const result = await draft(merged);

      expect(sent.map((request) => request.stage)).toEqual([
        "section",
        "selfCheck",
        "repair",
        "finalCoverage",
        "finalCoverage",
      ]);
      // The list names the merged ids the verdict must repeat.
      expect(sent[3]!.user).toContain(
        `- itemId ${ITEM_HYPOTHESIS} with mergedItemIds [${ITEM_HYPOTHESIS}, ${mergedPartner}] in that order`
      );
      const followUp = sent[4]!;
      expect(followUp.user).toContain(
        "Return exactly 1 planVerdict, one for each plan check below:\n" +
          `- itemId ${ITEM_HYPOTHESIS} with mergedItemIds [${ITEM_HYPOTHESIS}, ${mergedPartner}] in that order`
      );
      const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).toContain(
        `plan verdict 3 (item ${ITEM_HYPOTHESIS}): mergedItemIds has 1 ids, expected [${ITEM_HYPOTHESIS}, ${mergedPartner}] in that order`
      );
      expect(logged).not.toContain("P2 states the hypothesis");
      expect(result.draftText).toBe(REPAIRED);
      expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({
        outcome: "applied",
        paragraphIndex: 1,
        repaired: true,
        planRef: expect.objectContaining({ mergedItemIds: [ITEM_HYPOTHESIS, mergedPartner] }),
      });
      expect(planRows(result).every((row) => row.outcome === "applied")).toBe(true);
      expect(JSON.parse(result.selfCheck)).toMatchObject({
        planCoverage: { status: "complete", applied: 3, total: 3 },
      });
    } finally {
      warn.mockRestore();
    }
  });
});

// Release suite run 6 (withdrawn-feedback, Line 246): the first check's
// answer sent planVerdicts as a string, so the whole check failed ("Self-check
// call failed (unknown: response failed validation: planVerdicts
// invalid_type)") and every plan row read "did not complete". Now the list is
// read as empty and its plan checks asked for once, in the first check and in
// the final coverage check alike (2026-09-28, fifth).
describe("a plan verdict list sent as a string is asked for again (real SDK, fetch stubbed)", () => {
  const asString = (answers: PlanAnswer[]) => ({ raw: { verdicts: [], planVerdicts: JSON.stringify(answers) } });

  it("the first check asks once for every plan check and records the follow-up's verdicts", async () => {
    const sent = installFetch({
      checks: [
        asString([skipHonoured, workplanCovered(1), hypothesisCovered(2)]),
        [skipHonoured, workplanCovered(1), hypothesisCovered(2)],
      ],
    });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "selfCheck"]);
    expect(sent[2]!.user).toContain(
      "Return exactly 3 planVerdicts, one for each plan check below:\n" +
        `- skippedRoleId prior_year_status\n- itemId ${ITEM_WORKPLAN}\n- itemId ${ITEM_HYPOTHESIS}`
    );
    expect(planRows(result).every((row) => row.outcome === "applied")).toBe(true);
    const summary = JSON.parse(result.selfCheck);
    expect(summary).toMatchObject({ modelCheck: "ok", planCoverage: { status: "complete", applied: 3, total: 3 } });
    expect(summary).not.toHaveProperty("modelCheckDetail");
    expect(result.notes.some((note) => note.reason.includes("did not complete"))).toBe(false);
  });

  it("the run 6 shape: a follow-up that sends a string again leaves each plan row not checked, and the check still ran", async () => {
    const answers = [skipHonoured, workplanCovered(1), hypothesisCovered(2)];
    const sent = installFetch({ checks: [asString(answers), asString(answers)] });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck", "selfCheck"]);
    expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({
      outcome: "not_applied",
      reason: PLAN_ITEM_NOT_CHECKED_REASON,
    });
    expect(rowFor(result, "prior_year_status").reason).toMatch(/^Not checked: /);
    const summary = JSON.parse(result.selfCheck);
    expect(summary).toMatchObject({ modelCheck: "ok", planCoverage: { status: "incomplete", applied: 0, total: 3 } });
    expect(result.notes.some((note) => note.reason.includes("did not complete"))).toBe(false);
    // Not checked is never a prose defect: no repair.
    expect(sent.some((request) => request.stage === "repair")).toBe(false);
  });

  it("the final coverage check asks once for every plan check and records the follow-up's verdicts", async () => {
    const sent = installFetch({
      repair: REPAIRED,
      checks: [
        [skipHonoured, workplanCovered(1), hypothesisMissing],
        asString([skipHonoured, workplanCovered(1), hypothesisCovered(2)]),
        [skipHonoured, workplanCovered(1), hypothesisCovered(2)],
      ],
    });
    const result = await draft();

    expect(sent.map((request) => request.stage)).toEqual([
      "section",
      "selfCheck",
      "repair",
      "finalCoverage",
      "finalCoverage",
    ]);
    expect(schemaOf(sent[4]!).planVerdicts?.maxItems).toBe(3);
    expect(result.draftText).toBe(REPAIRED);
    expect(rowFor(result, ITEM_HYPOTHESIS)).toMatchObject({ outcome: "applied", paragraphIndex: 1, repaired: true });
    const summary = JSON.parse(result.selfCheck);
    expect(summary).toMatchObject({ planCoverage: { status: "complete", applied: 3, total: 3 } });
    expect(summary).not.toHaveProperty("finalCoverageCheckDetail");
  });

  it("an answer with neither list still fails the whole check, and says why", async () => {
    const sent = installFetch({
      checks: [{ raw: { verdicts: "[]", planVerdicts: JSON.stringify([skipHonoured, workplanCovered(1)]) } }],
    });
    const result = await draft();

    // One attempt: nothing in the answer could be read, so no follow-up.
    expect(sent.map((request) => request.stage)).toEqual(["section", "selfCheck"]);
    const detail = "response failed validation: (root) neither verdicts nor planVerdicts is a list";
    expect(JSON.parse(result.selfCheck)).toMatchObject({ modelCheckDetail: detail });
    expect(planRows(result).every((row) =>
      row.outcome === "not_applied" && row.reason === "The plan coverage Self-check did not complete.")).toBe(true);
  });
});
