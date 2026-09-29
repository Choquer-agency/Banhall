/// <reference types="vite/client" />
/**
 * 2026-09-29 (second): the writer's decisions outrank the Brief in drafting
 * (CAP-13 rules 4 and 5).
 *
 * Release suite run 6 (commit c8ce1fe2):
 * - "Exclusion-matching selection": the writer kept an Experimentation idea
 *   although it matches the Claim Exclusion on the billing portal move. Line
 *   244 left it out ("billing", "portal" and "migration" occur 0 times) while
 *   its Compliance Note row read "The writer confirmed a Brief Claim
 *   Exclusion conflict at sign-off." without looking at the text.
 * - "Corrected then withdrawn Feedback": the writer's active Feedback said
 *   "Call the deburring tool the compliant spindle, never the floating head,
 *   here and in every later step", and every Line said "floating head"
 *   because the Brief's Glossary Term was enforced.
 *
 * Every test drafts one Line through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The companies and their work are fictional.
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
  keptIdeaRepairIssue,
  keptIdeaReason,
  repairDroppedKeptIdeaReason,
  writerDecisionsBlock,
} from "./ai/orderedGeneration";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
  SUMMARY_PLAN_SELF_CHECK_REQUEST,
} from "./ai/promptDefinitions";
import { SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT } from "./ai/prompts";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  serializeFrozenSummaryPlanChecks,
  type FrozenSummaryPlanCheck,
} from "./lib/seedRevisions";
import type { OrderedPayload } from "./lib/orderedChain";
import { sectionMetrics } from "./lib/lineLimits";
import type { GlossarySetAside, WriterFeedback } from "./lib/writerPrecedence";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const SONNET = "claude-sonnet-5";

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

// ─── The stubbed provider ──────────────────────────────────────────────────

type PlanAnswer = {
  itemId: string;
  mergedItemIds: string[];
  paragraph: number;
  outcome: "applied" | "not_applied";
  reason: string;
  repairGuidance?: string;
};
type Sent = { stage: string; json: Record<string, unknown>; user: string; system: string };

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

/**
 * Scripts one Line: its draft, its compression passes (an empty queue echoes
 * the text), its repair and the plan verdicts of each Self-check request.
 */
function installFetch(script: {
  draft: string;
  compressions?: string[];
  repair?: string;
  checks: PlanAnswer[][];
  ordinary?: unknown[];
}): Sent[] {
  const sent: Sent[] = [];
  const compressions = [...(script.compressions ?? [])];
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
      const system = textOf(json.system);
      const tool = toolOf(json);
      const stage = tool
        ? tool
        : system.startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix)
            ? "repair"
            : "section";
      sent.push({ stage, json, user, system });
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
          content: [{
            type: "tool_use",
            id: "toolu_self_check",
            name: tool,
            input: {
              verdicts: user.includes(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction)
                ? []
                : script.ordinary ?? [],
              planVerdicts: next,
            },
          }],
          stop_reason: "tool_use",
        });
      }
      if (tool) throw new Error(`Unexpected tool ${tool}`);
      const text =
        stage === "compression"
          ? compressions.shift() ?? user.split(COMPRESSION_REQUEST.userScaffold.percentToText)[1]
          : stage === "repair"
            ? script.repair ?? script.draft
            : script.draft;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

const PAYLOAD = {
  analysis: JSON.stringify({
    company_context: "A fictional maker of grain dryer controllers",
    project_goal: "Early warning of burner and column faults",
    business_problem: "Sensor drift raised false alarms",
    scientific_technical_problem: "No method separated slow drift from slow faults",
    technological_objective: "A drift-tolerant anomaly model",
    work_performed: {},
    project_status: "in progress",
  }),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
  summaryVersionId: "summary-version-writer-precedence" as Id<"summaryVersions">,
  frozenStyleGuidance: "",
} satisfies OrderedPayload;

type Brief = {
  storylineText: string;
  claimExclusions: Array<{ text: string; exactExcerpt?: string; reason?: string }>;
  confidenceMap: Array<{ text: string; confidence?: string }>;
  glossaryTerms: string[];
};

function claimFor(args: {
  planChecks: FrozenSummaryPlanCheck[];
  brief: Brief;
  writerFeedback?: WriterFeedback[];
  glossarySetAside?: GlossarySetAside[];
}) {
  return {
    projectId: "project-writer-precedence",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 0,
    isFirstInOrder: true,
    priorSections: [],
    briefBlock: "\n\n--- BEGIN [GENERATION BRIEF] ---\n(fictional Brief)\n--- END [GENERATION BRIEF] ---",
    brief: args.brief,
    planBlock: "\n\n--- BEGIN [SIGNED-OFF CONTENT PLAN] ---\n(fictional plan)\n--- END [SIGNED-OFF CONTENT PLAN] ---",
    planChecksBlock: serializeFrozenSummaryPlanChecks(args.planChecks),
    planChecks: args.planChecks,
    editedTerms: [],
    writerFeedback: args.writerFeedback ?? [],
    glossarySetAside: args.glossarySetAside ?? [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

async function draft(section: "242" | "244", claim: ReturnType<typeof claimFor>) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await runAction(t, async (ctx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({ claim, payload: PAYLOAD, section, clientFor });
  });
}

const covered = (itemId: string, paragraph: number): PlanAnswer => ({
  itemId,
  mergedItemIds: [itemId],
  paragraph,
  outcome: "applied",
  reason: "Covered.",
});
const missing = (itemId: string, reason: string, repairGuidance?: string): PlanAnswer => ({
  itemId,
  mergedItemIds: [itemId],
  paragraph: 0,
  outcome: "not_applied",
  reason,
  ...(repairGuidance ? { repairGuidance } : {}),
});

// ─── Line 244: an idea kept despite a Claim Exclusion (CAP-13 rule 4) ─────

const BILLING =
  "Migration of the customer billing portal to a new cloud host was routine IT work with no uncertainty.";
const TRAINING =
  "Customer training sessions for dealers and farm operators are a business activity, not eligible work.";
const BRIEF_244: Brief = {
  storylineText: "",
  claimExclusions: [
    { text: BILLING, reason: "routine_engineering" },
    { text: TRAINING, reason: "business_risk" },
  ],
  confidenceMap: [],
  glossaryTerms: [],
};

const ITEM_PLAN = "item-harrowby-plan" as Id<"summaryItems">;
const ITEM_KEPT = "item-harrowby-kept" as Id<"summaryItems">;
const KEPT_WORDING = [
  "The rebuilt isolation forest baseline confirmed the drift problem, with false alarms rising from 0.3 to 2.6 per dryer-day as drift increased.",
  `The work also covered this: ${BILLING}`,
];
const PLAN_244: FrozenSummaryPlanCheck[] = [
  {
    itemId: ITEM_PLAN,
    roleId: "workplan",
    mergedItemIds: [ITEM_PLAN],
    instruction: "cover",
    confirmedExclusion: false,
    support: "source_supported",
    wording: ["The team fixed false alarm and lead time definitions in July 2025 before any experiment."],
    relationshipReferences: [],
    sourceReferences: [],
  },
  {
    itemId: ITEM_KEPT,
    roleId: "experimentation",
    mergedItemIds: [ITEM_KEPT],
    instruction: "cover",
    confirmedExclusion: true,
    support: "writer_asserted",
    wording: KEPT_WORDING,
    relationshipReferences: [],
    sourceReferences: [],
  },
];

const PLAN_P1 =
  "The team fixed false alarm and lead time definitions in July 2025 before running any experiment, so results could be compared across phases.";
const BASELINE_P2 =
  "The rebuilt isolation forest baseline confirmed the drift problem: false alarms rose from 0.3 to 2.6 per dryer-day as drift increased.";
const KEPT_SENTENCE = `The work also covered the ${BILLING.charAt(0).toLowerCase()}${BILLING.slice(1)}`;
const RESIDUAL_P3 =
  "The energy balance residual model with online bias tracking then held false alarms near 0.2 per dryer-day.";
/** The kept idea drafted, its excluded words as written. */
const WITH_KEPT = [PLAN_P1, `${BASELINE_P2} ${KEPT_SENTENCE}`, RESIDUAL_P3].join("\n\n");
/** Release suite run 6: the kept idea left out. */
const WITHOUT_KEPT = [PLAN_P1, BASELINE_P2, RESIDUAL_P3].join("\n\n");

const claim244 = () => claimFor({ planChecks: PLAN_244, brief: BRIEF_244 });

function planRow(result: Awaited<ReturnType<typeof draft>>, itemId: string) {
  const row = result.notes.find((note) => note.planRef?.itemId === itemId);
  if (!row) throw new Error(`No plan row for ${itemId}`);
  return row;
}
function exclusionRow(result: Awaited<ReturnType<typeof draft>>, text: string) {
  const row = result.notes.find((note) => note.instruction === `Claim Exclusion: ${text}`);
  if (!row) throw new Error(`No Claim Exclusion row for ${text}`);
  return row;
}

describe("an idea kept despite a Claim Exclusion is drafted and kept (real SDK, fetch stubbed)", () => {
  const keptBlock = writerDecisionsBlock({
    confirmed: [{ itemId: ITEM_KEPT, wording: KEPT_WORDING, exclusions: [BRIEF_244.claimExclusions[0]!] }],
    feedback: [],
    glossarySetAside: [],
  });

  it("the drafting request names the kept idea and its Claim Exclusion after the plan and the Brief, before the Locked length", async () => {
    expect(keptBlock).toBe(
      "\n\n# WRITER'S DECISIONS (outrank the Brief)\nThe writer made these decisions while planning. The Locked Rules outrank them, and they outrank the Brief, including its Claim Exclusions and Glossary Terms." +
        "\n\nIdeas kept despite a Claim Exclusion. At sign-off the writer confirmed each idea below although it matches a Claim Exclusion in the Brief. Write each one in this Line as the plan gives it; do not drop, soften or disclaim it. That Claim Exclusion does not apply to the idea's own content. Every other Claim Exclusion still applies." +
        `\n- "${KEPT_WORDING.join(" ")}" (matches the Claim Exclusion "${BILLING}")`
    );
    const sent = installFetch({ draft: WITH_KEPT, checks: [[covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)]] });
    const result = await draft("244", claim244());
    const section = sent.find((request) => request.stage === "section");
    if (!section) throw new Error("No Section request");
    const at = section.user.indexOf(keptBlock);
    expect(at).toBeGreaterThan(section.user.indexOf("--- END [SIGNED-OFF CONTENT PLAN] ---"));
    expect(at).toBeGreaterThan(section.user.indexOf("--- END [GENERATION BRIEF] ---"));
    expect(section.user.indexOf("# LENGTH (Locked Rule, outranks the plan)")).toBeGreaterThan(at);
    expect(sent.map((request) => request.stage)).toEqual(["section", "submit_self_check"]);
    expect(result.draftText).toBe(WITH_KEPT);
  });

  it("the Self-check judges the kept idea's coverage and never asks to remove it", async () => {
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).toContain(
      "An item with confirmedExclusion true was kept by the writer at sign-off although it matches a Brief Claim Exclusion: judge its coverage like any other item, applied when the section covers it, and never ask for it to be removed, softened or disclaimed."
    );
    expect(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT).not.toContain("always not_applied");
    const sent = installFetch({ draft: WITH_KEPT, checks: [[covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)]] });
    await draft("244", claim244());
    const check = sent.find((request) => request.stage === "submit_self_check");
    expect(check?.system).toBe(SUMMARY_PLAN_SELF_CHECK_SYSTEM_PROMPT);
    expect(check?.user).toContain('"confirmedExclusion":true');
  });

  it("a drafted kept idea is recorded as drafted despite the Claim Exclusion, and its exclusion is suspended, not repaired", async () => {
    installFetch({ draft: WITH_KEPT, checks: [[covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)]] });
    const result = await draft("244", claim244());
    expect(planRow(result, ITEM_KEPT)).toMatchObject({
      outcome: "applied",
      tier: "conflict",
      repaired: false,
      paragraphIndex: 1,
      reason: keptIdeaReason("drafted", `${KEPT_WORDING.join(" ").slice(0, 119).trimEnd()}...`, BILLING),
    });
    expect(planRow(result, ITEM_KEPT).reason).toContain(`Drafted despite the Claim Exclusion "${BILLING}"`);
    expect(exclusionRow(result, BILLING)).toMatchObject({
      outcome: "not_applied",
      tier: "conflict",
      paragraphIndex: 1,
      repaired: false,
      reason: "suspended for the idea the writer kept despite this Claim Exclusion: it appears in paragraph 2 (routine engineering) and is not repaired away",
    });
    // Every other Claim Exclusion is checked as before.
    expect(exclusionRow(result, TRAINING)).toMatchObject({
      outcome: "applied",
      tier: "none",
      reason: "excluded claim absent (business risk)",
    });
    expect(JSON.parse(result.selfCheck)).toMatchObject({
      status: "pass",
      repairAttempted: false,
      planCoverage: { status: "complete", applied: 2, total: 2 },
    });
  });

  it("release suite run 6: a draft that leaves the kept idea out is repaired to include it, never away from it", async () => {
    const sent = installFetch({
      draft: WITHOUT_KEPT,
      repair: WITH_KEPT,
      checks: [
        [covered(ITEM_PLAN, 1), missing(ITEM_KEPT, "The billing portal move is not in the section.")],
        [covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)],
      ],
    });
    const result = await draft("244", claim244());
    expect(sent.map((request) => request.stage)).toEqual([
      "section", "submit_self_check", "repair", "submit_self_check",
    ]);
    const repair = sent.find((request) => request.stage === "repair")!;
    // A fixed issue that names the idea's words, never model guidance.
    const issue = keptIdeaRepairIssue({ wording: KEPT_WORDING, exclusions: [BRIEF_244.claimExclusions[0]!] });
    expect(issue).toBe(
      `Whole section: write the idea the writer kept despite the Claim Exclusion "${BILLING}", as the plan gives it: "${KEPT_WORDING.join(" ")}"`
    );
    expect(repair.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.issuePrefix}${issue}`);
    expect(repair.user).toContain(
      `${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.writerDecisions}${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.draftPrefix}`
    );
    expect(repair.user).toContain(keptBlock);
    expect(repair.user).not.toContain("remove the excluded claim");
    expect(result.draftText).toBe(WITH_KEPT);
    expect(planRow(result, ITEM_KEPT)).toMatchObject({ outcome: "applied", tier: "conflict", repaired: false });
  });

  it("the kept idea stays on the compression's Must keep list", async () => {
    const support =
      "The dryer logs describe how each controller behaved through the season and how the engineers compared every alert with the operator notes.";
    const long = [
      `${PLAN_P1} ${Array(11).fill(support).join(" ")}`,
      `${BASELINE_P2} ${KEPT_SENTENCE} ${Array(11).fill(support).join(" ")}`,
      `${RESIDUAL_P3} ${Array(11).fill(support).join(" ")}`,
    ].join("\n\n");
    const fitted = [
      `${PLAN_P1} ${Array(5).fill(support).join(" ")}`,
      `${BASELINE_P2} ${KEPT_SENTENCE} ${Array(5).fill(support).join(" ")}`,
      `${RESIDUAL_P3} ${Array(5).fill(support).join(" ")}`,
    ].join("\n\n");
    expect(sectionMetrics(long, "s244").overLimit).toBe(true);
    expect(sectionMetrics(fitted, "s244").overLimit).toBe(false);
    const sent = installFetch({
      draft: long,
      compressions: [fitted],
      checks: [[covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)]],
    });
    const result = await draft("244", claim244());
    const compression = sent.find((request) => request.stage === "compression");
    if (!compression) throw new Error("No compression request");
    const mustKeep = COMPRESSION_REQUEST.mustKeep;
    expect(compression.user.startsWith(
      `${mustKeep.prefix}${mustKeep.itemPrefix}${PLAN_244[0]!.wording.join(" ")}${mustKeep.itemSeparator}${mustKeep.itemPrefix}${KEPT_WORDING.join(" ")}${mustKeep.suffix}`
    )).toBe(true);
    expect(result.draftText).toBe(fitted);
  });

  it("a repair that drops the kept idea's words the checked draft held is not used", async () => {
    const withoutAfterRepair = WITHOUT_KEPT.replace("so results could be compared", "so every result could be compared");
    const sent = installFetch({
      draft: WITH_KEPT,
      repair: withoutAfterRepair,
      checks: [[missing(ITEM_PLAN, "P1 misses the July 2025 date.", "Say the definitions were fixed in July 2025."), covered(ITEM_KEPT, 2)]],
    });
    const result = await draft("244", claim244());
    expect(sent.map((request) => request.stage)).toEqual(["section", "submit_self_check", "repair"]);
    expect(result.draftText).toBe(WITH_KEPT);
    const reason = repairDroppedKeptIdeaReason({ wording: KEPT_WORDING });
    expect(reason).toBe(
      `the repaired text dropped the idea the writer kept despite a Claim Exclusion ("${KEPT_WORDING.join(" ").slice(0, 119).trimEnd()}..."), so the checked draft was kept`
    );
    expect(planRow(result, ITEM_PLAN).reason).toContain(`repair not used (${reason})`);
    expect(planRow(result, ITEM_KEPT)).toMatchObject({ outcome: "applied", tier: "conflict", repaired: false });
  });

  it("a repair the final check finds without the kept idea the first check found is not used either", async () => {
    // The draft paraphrases the idea, so only the Self-check can see it.
    const paraphrased = WITH_KEPT.replace(KEPT_SENTENCE, "The team also moved the billing site to a new host, which was routine.");
    const repaired = WITHOUT_KEPT.replace("so results could be compared", "so every result could be compared");
    const sent = installFetch({
      draft: paraphrased,
      repair: repaired,
      checks: [
        [missing(ITEM_PLAN, "P1 misses the July 2025 date.", "Say the definitions were fixed in July 2025."), covered(ITEM_KEPT, 2)],
        [covered(ITEM_PLAN, 1), missing(ITEM_KEPT, "The billing work is gone.")],
      ],
    });
    const result = await draft("244", claim244());
    expect(sent.map((request) => request.stage)).toEqual([
      "section", "submit_self_check", "repair", "submit_self_check",
    ]);
    expect(result.draftText).toBe(paraphrased);
    expect(planRow(result, ITEM_KEPT)).toMatchObject({ outcome: "applied", tier: "conflict", paragraphIndex: 1 });
    expect(planRow(result, ITEM_PLAN).reason).toContain(
      `repair not used (${repairDroppedKeptIdeaReason({ wording: KEPT_WORDING })})`
    );
    expect(result.notes.some((note) => note.instruction === "Final coverage Self-check")).toBe(false);
  });

  it("a kept idea the final text still leaves out gets a visible not drafted row", async () => {
    installFetch({
      draft: WITHOUT_KEPT,
      repair: WITHOUT_KEPT.replace("so results could be compared", "so each result could be compared"),
      checks: [
        [covered(ITEM_PLAN, 1), missing(ITEM_KEPT, "The billing portal move is not in the section.")],
        [covered(ITEM_PLAN, 1), missing(ITEM_KEPT, "Still not in the section.")],
      ],
    });
    const result = await draft("244", claim244());
    const row = planRow(result, ITEM_KEPT);
    expect(row).toMatchObject({ outcome: "not_applied", tier: "conflict", repaired: false });
    expect(row.reason.startsWith("Not drafted: the writer kept the idea")).toBe(true);
    expect(row.reason).toContain(`despite the Claim Exclusion "${BILLING}", but the final text leaves it out.`);
    expect(JSON.parse(result.selfCheck)).toMatchObject({ planCoverage: { status: "incomplete" } });
  });

  it("an unkept idea that states an excluded claim is still repaired away", async () => {
    const withTraining = [PLAN_P1, `${BASELINE_P2} ${KEPT_SENTENCE}`, `${RESIDUAL_P3} ${TRAINING}`].join("\n\n");
    const sent = installFetch({
      draft: withTraining,
      repair: WITH_KEPT,
      checks: [
        [covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)],
        [covered(ITEM_PLAN, 1), covered(ITEM_KEPT, 2)],
      ],
    });
    const result = await draft("244", claim244());
    const repair = sent.find((request) => request.stage === "repair");
    if (!repair) throw new Error("The excluded claim was not repaired");
    expect(repair.user).toContain(`Paragraph 3: remove the excluded claim "${TRAINING}"`);
    expect(repair.user).not.toContain(`remove the excluded claim "${BILLING}"`);
    expect(result.draftText).toBe(WITH_KEPT);
    expect(exclusionRow(result, TRAINING)).toMatchObject({ outcome: "applied", repaired: true });
    expect(planRow(result, ITEM_KEPT)).toMatchObject({ outcome: "applied", tier: "conflict", repaired: false });
  });
});

// ─── Line 242: the writer's Feedback outranks a Glossary Term (rule 5) ────

const SPINDLE =
  "Call the deburring tool the compliant spindle, never the floating head, here and in every later step";
const FEEDBACK: WriterFeedback[] = [{ roleId: "company_context", instruction: SPINDLE }];
const SET_ASIDE: GlossarySetAside[] = [{
  term: "floating head",
  reason: `the writer's Feedback on Company / Context names this term: "${SPINDLE}"`,
}];
const BRIEF_242: Brief = {
  storylineText: "",
  claimExclusions: [],
  confidenceMap: [],
  glossaryTerms: ["floating head", "pilot cell"],
};
const ITEM_CONTEXT = "item-tessrow-context" as Id<"summaryItems">;
const PLAN_242: FrozenSummaryPlanCheck[] = [{
  itemId: ITEM_CONTEXT,
  roleId: "company_context",
  mergedItemIds: [ITEM_CONTEXT],
  instruction: "cover",
  confirmedExclusion: false,
  support: "source_supported",
  wording: ["Tessrow builds robotic finishing cells and wanted per-edge force control from a compliant spindle."],
  relationshipReferences: [],
  sourceReferences: [],
}];
const SPINDLE_DRAFT = [
  "Tessrow builds robotic finishing cells for aerospace brackets and runs its trials in the pilot cell in Bay 4.",
  "The company wanted per-edge force control from a compliant spindle instead of one fixed force.",
].join("\n\n");

describe("the writer's Feedback outranks a Brief Glossary Term (real SDK, fetch stubbed)", () => {
  it("the drafting request carries the Feedback and sets the Glossary Term aside; the Self-check gets the Feedback, not the term", async () => {
    const sent = installFetch({ draft: SPINDLE_DRAFT, checks: [[covered(ITEM_CONTEXT, 2)]] });
    const result = await draft("242", claimFor({
      planChecks: PLAN_242,
      brief: BRIEF_242,
      writerFeedback: FEEDBACK,
      glossarySetAside: SET_ASIDE,
    }));

    const block = writerDecisionsBlock({ confirmed: [], feedback: FEEDBACK, glossarySetAside: SET_ASIDE });
    expect(block).toBe(
      "\n\n# WRITER'S DECISIONS (outrank the Brief)\nThe writer made these decisions while planning. The Locked Rules outrank them, and they outrank the Brief, including its Claim Exclusions and Glossary Terms." +
        "\n\nThe writer's Feedback. Each instruction was given on the step named and applies to that step and every later step, as it did while the ideas were written. Follow each one wherever it applies in this Line, even where the Brief or a plan item's wording says otherwise, and still cover every COVER item of the plan." +
        `\n- On Company / Context: "${SPINDLE}"` +
        "\n\nGlossary Terms set aside in this Line. The writer's own wording governs these terms here: never use one to replace the writer's wording, and never add one where the writer's wording or Feedback avoids it." +
        "\n- \"floating head\""
    );
    const section = sent.find((request) => request.stage === "section")!;
    const at = section.user.indexOf(block);
    expect(at).toBeGreaterThan(section.user.indexOf("--- END [GENERATION BRIEF] ---"));
    expect(section.user.indexOf("# LENGTH (Locked Rule, outranks the plan)")).toBeGreaterThan(at);

    const check = sent.find((request) => request.stage === "submit_self_check")!;
    const feedback = SUMMARY_PLAN_SELF_CHECK_REQUEST.writerFeedback;
    const feedbackBlock = `--- BEGIN [${feedback.blockLabel}] ---\n- On Company / Context: "${SPINDLE}"\n--- END [${feedback.blockLabel}] ---`;
    expect(check.user).toContain(feedbackBlock);
    expect(check.user).toContain(`${feedbackBlock}${feedback.instruction}`);
    // No Glossary candidate, so no label that could ask for "floating head".
    expect(check.user).not.toContain("GLOSSARY CANDIDATES");
    expect(check.user).not.toContain("glossary:G");

    // Nothing to repair: the writer's term is not an issue.
    expect(sent.map((request) => request.stage)).toEqual(["section", "submit_self_check"]);
    expect(result.draftText).toBe(SPINDLE_DRAFT);
    expect(result.notes.find((note) => note.instruction === "Glossary Term: floating head")).toMatchObject({
      source: "deterministic",
      outcome: "not_applied",
      tier: "conflict",
      repaired: false,
      reason: `Not enforced in this Line: the writer's Feedback on Company / Context names this term: "${SPINDLE}". The writer's wording outranks the Brief.`,
    });
    // Every other Glossary Term is checked as before.
    expect(result.notes.find((note) => note.instruction === "Glossary Term: pilot cell")).toMatchObject({
      outcome: "applied",
      tier: "none",
      reason: "Glossary Term used (paragraph 1)",
    });
  });

  it("without the writer's Feedback the Glossary Term is enforced as before and no decisions are sent", async () => {
    const sent = installFetch({
      draft: SPINDLE_DRAFT,
      repair: SPINDLE_DRAFT.replace("compliant spindle", "floating head"),
      checks: [[covered(ITEM_CONTEXT, 2)], [covered(ITEM_CONTEXT, 2)]],
      ordinary: [{
        paragraph: 2,
        check: "glossary",
        instruction: "glossary:G1",
        outcome: "not_applied",
        reason: "P2 says compliant spindle.",
        repairGuidance: "Say floating head in paragraph 2.",
      }],
    });
    const result = await draft("242", claimFor({ planChecks: PLAN_242, brief: BRIEF_242 }));
    for (const request of sent) {
      expect(request.user).not.toContain("WRITER'S DECISIONS");
      expect(request.user).not.toContain("WRITER'S FEEDBACK");
    }
    const check = sent.find((request) => request.stage === "submit_self_check")!;
    expect(check.user).toContain("GLOSSARY CANDIDATES");
    expect(result.draftText).toContain("floating head");
  });

  it("a repair for another issue is told the writer's decisions outrank its issues", async () => {
    const sent = installFetch({
      draft: SPINDLE_DRAFT,
      repair: SPINDLE_DRAFT.replace("instead of one fixed force", "in place of one fixed force"),
      checks: [
        [missing(ITEM_CONTEXT, "P2 misses the robotic cells.", "Name the robotic finishing cells in paragraph 2.")],
        [covered(ITEM_CONTEXT, 2)],
      ],
    });
    await draft("242", claimFor({
      planChecks: PLAN_242,
      brief: BRIEF_242,
      writerFeedback: FEEDBACK,
      glossarySetAside: SET_ASIDE,
    }));
    const repair = sent.find((request) => request.stage === "repair");
    if (!repair) throw new Error("No repair request");
    expect(repair.user).toContain(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.writerDecisions);
    expect(repair.user).toContain(`- On Company / Context: "${SPINDLE}"`);
    // The final coverage check gets the Feedback too.
    const checks = sent.filter((request) => request.stage === "submit_self_check");
    expect(checks).toHaveLength(2);
    expect(checks[1]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.finalCoverage.instruction);
    expect(checks[1]!.user).toContain(SUMMARY_PLAN_SELF_CHECK_REQUEST.writerFeedback.instruction);
  });
});
