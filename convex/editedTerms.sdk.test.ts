/// <reference types="vite/client" />
/**
 * 2026-09-28 (second, edited terms): a writer's edited term survives drafting,
 * compression and the repair (CAP-13).
 *
 * Release suite run 4 ("Carried old selections"): the writer added "The team
 * calls the graded structure the cascade-fired lattice." to a Company /
 * Context Seed. The first draft of Line 242 used the term, the Self-check
 * called it invented, and the repair, whose text was used, removed it; the
 * final coverage check then recorded "Missing the 'cascade-fired lattice'
 * team term."
 *
 * Every test drafts Line 242 through draftCheckedSection with the real
 * Anthropic SDK and the production instrumented client; only `fetch` is
 * stubbed. The Line text and the company are fictional.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { draftCheckedSection, repairDroppedTermReason } from "./ai/orderedGeneration";
import { compressionLoss } from "./ai/pipeline";
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import {
  serializeFrozenSummaryPlanChecks,
  type FrozenSummaryPlanCheck,
} from "./lib/seedRevisions";
import type { OrderedPayload } from "./lib/orderedChain";
import { sectionMetrics } from "./lib/lineLimits";

const modules = import.meta.glob("./**/*.ts");
type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;
const SONNET = "claude-sonnet-5";
const TERM = "cascade-fired lattice";

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

// ─── A fictional Line 242: graded foam filters (Brackenridge Kilnworks) ────

const CONTEXT_P1 =
  "Brackenridge Kilnworks has made foam ceramic filters for metal foundries for a little over twenty years, using a replication process that coats a polyurethane sponge with ceramic slurry and fires it. The team calls the graded structure the cascade-fired lattice.";
const GOAL_P2 =
  "The goal was a single filter with a pore-size gradient through its 50mm thickness: a coarser entry face and a finer exit layer that resists cracking while raising fine inclusion capture.";
const UNCERTAINTY_P3 =
  "It was unknown whether two pore-size templates could be graded without delaminating during firing, since differing slurry pick-up by zone causes shrinkage mismatch between them.";
/** Supporting detail a compression may cut: no numbers, negations or terms. */
const SUPPORT =
  "The kiln notes describe how each template behaved in the dip line and how the engineers compared every fired part with the standard filter.";

const DRAFT = [CONTEXT_P1, GOAL_P2, UNCERTAINTY_P3].join("\n\n");
/** The run 4 repair: the team term paraphrased away. */
const WITHOUT_TERM = DRAFT.replace(
  " The team calls the graded structure the cascade-fired lattice.",
  " The team gave the graded structure its own working name."
);
/** Line 242 over its 350-word cap, the term in its first paragraph. */
const LONG_DRAFT = [
  `${CONTEXT_P1} ${Array(5).fill(SUPPORT).join(" ")}`,
  `${GOAL_P2} ${Array(5).fill(SUPPORT).join(" ")}`,
  `${UNCERTAINTY_P3} ${Array(5).fill(SUPPORT).join(" ")}`,
].join("\n\n");
const FITTED = [
  `${CONTEXT_P1} ${SUPPORT} ${SUPPORT}`,
  `${GOAL_P2} ${SUPPORT} ${SUPPORT}`,
  `${UNCERTAINTY_P3} ${SUPPORT} ${SUPPORT}`,
].join("\n\n");
/** A pass that fits but paraphrases the term ("cascade fired", no hyphen). */
const FITTED_PARAPHRASED = FITTED.replace(TERM, "cascade fired structure");

const ITEM_CONTEXT = "item-brackenridge-context" as Id<"summaryItems">;
const ITEM_GOAL = "item-brackenridge-goal" as Id<"summaryItems">;

const PLAN_CHECKS: FrozenSummaryPlanCheck[] = [
  {
    itemId: ITEM_CONTEXT,
    roleId: "company_context",
    mergedItemIds: [ITEM_CONTEXT],
    instruction: "cover",
    confirmedExclusion: false,
    support: "writer_asserted",
    wording: [
      "The company has made foam ceramic filters for metal foundries for a little over twenty years. The team calls the graded structure the cascade-fired lattice.",
    ],
    relationshipReferences: [],
    sourceReferences: [],
  },
  {
    itemId: ITEM_GOAL,
    roleId: "goal_problem",
    mergedItemIds: [ITEM_GOAL],
    instruction: "cover",
    confirmedExclusion: false,
    support: "source_supported",
    wording: ["A single graded filter that resists cracking and captures fine inclusions."],
    relationshipReferences: [],
    sourceReferences: [],
  },
];

const PAYLOAD = {
  analysis: JSON.stringify({
    company_context: "A fictional maker of foam ceramic filters",
    project_goal: "A graded filter that resists cracking",
    business_problem: "Filters cracked in service",
    scientific_technical_problem: "No method graded pore size through a replicated foam",
    technological_objective: "A graded foam ceramic filter",
    work_performed: {},
    project_status: "completed",
  }),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "missing",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
  summaryVersionId: "summary-version-brackenridge" as Id<"summaryVersions">,
  frozenStyleGuidance: "",
} satisfies OrderedPayload;

function claimFor(editedTerms: string[]) {
  return {
    projectId: "project-brackenridge",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 0,
    isFirstInOrder: true,
    priorSections: [],
    briefBlock: "\n\n--- BEGIN [GENERATION BRIEF] ---\n(fictional Brief)\n--- END [GENERATION BRIEF] ---",
    brief: null,
    planBlock: "\n\n--- BEGIN [SIGNED-OFF CONTENT PLAN] ---\n(fictional plan)\n--- END [SIGNED-OFF CONTENT PLAN] ---",
    planChecksBlock: serializeFrozenSummaryPlanChecks(PLAN_CHECKS),
    planChecks: PLAN_CHECKS,
    editedTerms,
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type PlanAnswer = {
  itemId: string;
  mergedItemIds: string[];
  paragraph: number;
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

/**
 * Scripts Line 242: its draft, its compression passes (an empty queue echoes
 * the text), its repair and the plan verdicts of each Self-check request.
 */
function installFetch(script: {
  draft: string;
  compressions?: string[];
  repair?: string;
  checks: PlanAnswer[][];
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
      const tool = toolOf(json);
      const stage = tool
        ? tool
        : textOf(json.system).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix)
            ? "repair"
            : "section";
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

async function draft(editedTerms: string[] = [TERM]) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  return await runAction(t, async (ctx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: claimFor(editedTerms),
      payload: PAYLOAD,
      section: "242",
      clientFor,
    });
  });
}

const covered = (itemId: string, paragraph: number): PlanAnswer => ({
  itemId,
  mergedItemIds: [itemId],
  paragraph,
  outcome: "applied",
  reason: "Covered.",
});
const bothCovered = [covered(ITEM_CONTEXT, 1), covered(ITEM_GOAL, 2)];
const termMissing: PlanAnswer = {
  itemId: ITEM_CONTEXT,
  mergedItemIds: [ITEM_CONTEXT],
  paragraph: 0,
  outcome: "not_applied",
  reason: "Missing the 'cascade-fired lattice' team term.",
  repairGuidance: "Use the team term 'cascade-fired lattice' for the graded structure.",
};
const goalMissing: PlanAnswer = {
  itemId: ITEM_GOAL,
  mergedItemIds: [ITEM_GOAL],
  paragraph: 0,
  outcome: "not_applied",
  reason: "P2 does not say the filter captures fine inclusions.",
  repairGuidance: "Say that the graded filter raises fine inclusion capture.",
};

function planRow(result: Awaited<ReturnType<typeof draft>>, itemId: string) {
  const row = result.notes.find((note) => note.planRef?.itemId === itemId);
  if (!row) throw new Error(`No plan row for ${itemId}`);
  return row;
}

describe("a writer's edited term survives drafting, compression and the repair (real SDK, fetch stubbed)", () => {
  it("the drafting request names the edited term to use word for word, after the plan and before the Locked length", async () => {
    const sent = installFetch({ draft: DRAFT, checks: [bothCovered] });
    const result = await draft();
    const section = sent.find((request) => request.stage === "section");
    if (!section) throw new Error("No Section request");
    const block = `${ORDERED_PROMPT_SCAFFOLDS.editedTerms.prefix}"${TERM}".`;
    expect(block).toBe(
      "\n\n# WRITER'S EXACT TERMS (use word for word)\nThe writer edited the plan to use these terms. Use each one in this Line exactly as written, word for word; never paraphrase, split or drop one, even where the Storyline or the sources do not use it: \"cascade-fired lattice\"."
    );
    const at = section.user.indexOf(block);
    expect(at).toBeGreaterThan(section.user.indexOf("--- END [SIGNED-OFF CONTENT PLAN] ---"));
    expect(at).toBeGreaterThan(section.user.indexOf("--- END [GENERATION BRIEF] ---"));
    expect(section.user.indexOf("# LENGTH (Locked Rule, outranks the plan)")).toBeGreaterThan(at);
    expect(sent.map((request) => request.stage)).toEqual(["section", "submit_self_check"]);
    expect(result.draftText).toBe(DRAFT);
    expect(planRow(result, ITEM_CONTEXT)).toMatchObject({ outcome: "applied" });
  });

  it("a Line without edited terms sends no terms block", async () => {
    const sent = installFetch({ draft: DRAFT, checks: [bothCovered] });
    await draft([]);
    for (const request of sent) {
      expect(request.user).not.toContain("WRITER'S EXACT TERMS");
      expect(request.user).not.toContain(COMPRESSION_REQUEST.exactTerms.prefix);
    }
  });

  it("a compression pass that paraphrases the edited term away is not kept; the next pass that keeps it is", async () => {
    expect(sectionMetrics(LONG_DRAFT, "s242").overLimit).toBe(true);
    expect(sectionMetrics(FITTED, "s242").overLimit).toBe(false);
    expect(compressionLoss(LONG_DRAFT, FITTED_PARAPHRASED, "s242", 297, [], [TERM])).toBe(
      `dropped the writer's term "${TERM}"`
    );
    // Without the exact term, the same pass is an ordinary shortening.
    expect(compressionLoss(LONG_DRAFT, FITTED_PARAPHRASED, "s242", 297)).toBeNull();

    const sent = installFetch({
      draft: LONG_DRAFT,
      compressions: [FITTED_PARAPHRASED, FITTED],
      checks: [bothCovered],
    });
    const result = await draft();
    const compressions = sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(2);
    // The term is word for word, unlike the Must keep points, which keep their point.
    expect(compressions[0].user).toContain(
      `${COMPRESSION_REQUEST.mustKeep.suffix}Writer's exact terms: keep each one word for word, exactly as written, not only its point: "${TERM}".\n\nThis section is `
    );
    // The second pass works from the draft, not from the refused pass.
    expect(compressions[1].user).toContain(LONG_DRAFT);
    expect(result.draftText).toBe(FITTED);
  });

  it("a repair asked for a missing edited term is told to keep it word for word, and its text is used", async () => {
    const withTerm = DRAFT;
    const sent = installFetch({
      draft: WITHOUT_TERM,
      repair: withTerm,
      // The first check misses the term; the final check sees it.
      checks: [[termMissing, covered(ITEM_GOAL, 2)], bothCovered],
    });
    const result = await draft();
    const repair = sent.find((request) => request.stage === "repair");
    if (!repair) throw new Error("No repair request");
    expect(repair.user).toContain(
      `${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.exactTermsPrefix}"${TERM}".${ORDERED_PROMPT_SCAFFOLDS.repairGuidance.draftPrefix}`
    );
    expect(repair.user).toContain(`${ORDERED_PROMPT_SCAFFOLDS.editedTerms.prefix}"${TERM}".`);
    expect(result.draftText).toBe(withTerm);
    expect(planRow(result, ITEM_CONTEXT)).toMatchObject({ outcome: "applied", repaired: true });
  });

  it("release suite run 4: a repair that drops the edited term the draft held is not used, and the term stays", async () => {
    const sent = installFetch({
      draft: DRAFT,
      repair: WITHOUT_TERM,
      checks: [[covered(ITEM_CONTEXT, 1), goalMissing]],
    });
    const result = await draft();
    const repair = sent.find((request) => request.stage === "repair");
    expect(repair?.user).toContain(
      `even where an issue above calls one unsupported or invented: "${TERM}".`
    );
    // The checked draft is kept whole, the term in it, and no final check runs.
    expect(result.draftText).toBe(DRAFT);
    expect(sent.filter((request) => request.stage === "submit_self_check")).toHaveLength(1);
    expect(planRow(result, ITEM_GOAL).reason).toContain(`repair not used (${repairDroppedTermReason(TERM)})`);
    expect(planRow(result, ITEM_CONTEXT)).toMatchObject({ outcome: "applied" });
  });
});
