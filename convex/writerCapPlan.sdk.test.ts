/// <reference types="vite/client" />
/**
 * 2026-10-04 (first), owner decision: signed-off items outrank the writer's
 * cap, and the Locked cap outranks both. A signed-off Line 242 whose
 * Writer Profile caps it at 120 words, below its 350-word Locked cap, is
 * drafted through draftCheckedSection with the real Anthropic SDK and the
 * production instrumented client, only `fetch` stubbed. Fictional project.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import schema from "./schema";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { instrumentedAnthropic } from "./ai/instrument";
import type { GenerationClient } from "./ai/openrouterCore";
import { draftCheckedSection, planLengthBudgetBlock } from "./ai/orderedGeneration";
import { NOT_CHECKED_ON_FINAL_TEXT } from "./lib/selfCheckRules";
import { governedTermReason, type FeedbackGovernedTerm } from "./lib/writerPrecedence";
import {
  COMPRESSION_REQUEST,
  ORDERED_PROMPT_SCAFFOLDS,
} from "./ai/promptDefinitions";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { buildFrozenSummaryPlan } from "./lib/seedRevisions";
import { sectionMetrics } from "./lib/lineLimits";
import type { OrderedPayload } from "./lib/orderedChain";

const modules = import.meta.glob("./**/*.ts");
const SONNET = "claude-sonnet-5";

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
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── A fictional project: the Corrin board-finishing line ─────────────────

const SETTINGS = "# PD Writing Customized Settings\n\n- Line 242: no more than 120 words.\n\nWrite in the third person throughout.";
const CAP_RULE = "- Line 242: no more than 120 words.";
/** The signed-off COVER item: no number and no negation, so only the new guard protects it. */
const COVER = "The edge sealer separated conductivity from heat on routed board panels.";
const FILLER = "The team logged each trial in the shop book and compared it with the run before.";
const fillers = (count: number) => Array.from({ length: count }, () => FILLER).join(" ");
/** 164 words: within the Locked cap, over the writer's 120. */
const DRAFT = [
  `The company finishes routed board panels for cabinet makers. ${fillers(3)}`,
  `${COVER} ${fillers(3)}`,
  fillers(3),
].join("\n\n");
/** Shorter, but without the signed-off item. */
const WITHOUT_ITEM = [`The company finishes routed board panels for cabinet makers. ${fillers(2)}`, fillers(2)].join("\n\n");

/** Without the signed-off item's sentence, but still over the writer's 120 words. */
const OVER_WITHOUT_ITEM = DRAFT.replace(`${COVER} `, "");

const ITEM = "item-corrin-sealer" as Id<"summaryItems">;

function plan() {
  return buildFrozenSummaryPlan({
    section: "s242",
    items: [{ itemId: ITEM, roleId: "active_uncertainties", kind: "standard", bullets: [COVER], support: "source_supported" }],
    skippedRoleIds: ["prior_year_status"],
  });
}

function payload(): OrderedPayload {
  return {
    analysis: JSON.stringify({
      company_context: "A fictional board finisher",
      project_goal: "Powder coat routed panels",
      business_problem: "Lacquer lines were slow",
      scientific_technical_problem: "Heat drove gas out of the board",
      technological_objective: "Edge coverage without outgassing",
      work_performed: {},
      project_status: "completed",
    }),
    brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
    writerFlavor: SETTINGS,
    orderedContext: {
      profileState: "applied",
      categoryOutcomes: [],
      buildOrder: ["242", "244", "246"],
      selfCheckRules: [{ section: "242", instruction: CAP_RULE, maxWords: 120 }],
    },
    frozenStyleGuidance: "",
    summaryVersionId: "summary-version-corrin" as Id<"summaryVersions">,
  } as OrderedPayload;
}

function claim(signedOff: ReturnType<typeof plan>) {
  return {
    projectId: "project-corrin",
    model: SONNET,
    label: "Single draft",
    lengthTarget: "standard",
    orderIndex: 0,
    isFirstInOrder: true,
    priorSections: [],
    briefBlock: "",
    brief: null,
    planBlock: `\n\n${signedOff.block}`,
    planChecksBlock: signedOff.checksBlock,
    planChecks: signedOff.checks,
    editedTerms: [],
  } as unknown as Parameters<typeof draftCheckedSection>[0]["claim"];
}

type Sent = { stage: string; user: string };

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
function systemOf(json: Record<string, unknown>): string {
  return typeof json.system === "string"
    ? json.system
    : Array.isArray(json.system)
      ? json.system.map((block: { text?: string }) => block.text ?? "").join("")
      : "";
}

/** Scripts the draft, each compression, the repair and each Self-check answer. */
function installFetch(script: { compressions: string[]; repair: string; checks: unknown[] }): Sent[] {
  const sent: Sent[] = [];
  const compressions = [...script.compressions];
  const checks = [...script.checks];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const json = JSON.parse(await new Request(input, init).text()) as Record<string, unknown>;
      const tool = (json.tools as Array<{ name: string }> | undefined)?.[0]?.name ?? null;
      const user = userOf(json);
      const stage = tool === "submit_self_check"
        ? "selfCheck"
        : systemOf(json).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))
          ? "compression"
          : user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix) ? "repair" : "section";
      sent.push({ stage, user });
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
        ? compressions.shift() ?? user.split(COMPRESSION_REQUEST.writerCap.userScaffold.percentToText)[1] ??
          user.split(COMPRESSION_REQUEST.writerCap.finalCutScaffold.targetToText)[1] ?? DRAFT
        : stage === "repair" ? script.repair : DRAFT;
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

async function draft(
  script: { compressions: string[]; repair: string; checks: unknown[] },
  claimExtra: Record<string, unknown> = {}
) {
  const sent = installFetch(script);
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const signedOff = plan();
  const result = await t.action(async (ctx: ActionCtx) => {
    const clientFor = Object.assign(
      (callSite: string) => instrumentedAnthropic(ctx, { callSite }) as unknown as GenerationClient,
      { modelFor: () => SONNET }
    );
    return await draftCheckedSection({
      claim: { ...claim(signedOff), ...claimExtra } as ReturnType<typeof claim>,
      payload: payload(),
      section: "242",
      clientFor,
    });
  });
  const note = (instruction: string) => result.notes.find((row) => row.instruction === instruction);
  return { sent, result, note };
}

/** The first Self-check: the item covered in paragraph 2, the Skip honoured. */
const FIRST_CHECK = {
  verdicts: [{ paragraph: 0, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Third person used." }],
  planVerdicts: [
    { itemId: ITEM, mergedItemIds: [ITEM], paragraph: 2, outcome: "applied", reason: "P2 states the sealer." },
    { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
  ],
};

describe("signed-off items outrank the writer's cap; the Locked cap outranks both (owner decision, 2026-10-04)", () => {
  it("the fixture: within the Locked cap, over the writer's, the item only in the draft", () => {
    expect(sectionMetrics(DRAFT, "s242")).toMatchObject({ words: 164, overLimit: false });
    expect(sectionMetrics(WITHOUT_ITEM, "s242").words).toBeLessThan(120);
    expect(WITHOUT_ITEM).not.toContain("sealer");
  });

  it("tells the drafter to cover every item even over the writer's cap, and never shortens an item away for it", async () => {
    // Every shortening pass drops the item; the repair changes nothing.
    const run = await draft({ compressions: [WITHOUT_ITEM, WITHOUT_ITEM, WITHOUT_ITEM, WITHOUT_ITEM], repair: DRAFT, checks: [FIRST_CHECK] });
    const section = run.sent.find((request) => request.stage === "section")!;
    expect(section.user).toContain(planLengthBudgetBlock("s242", "standard", { words: 120 }));
    expect(section.user).toContain("# LENGTH (the Locked Rule outranks the plan; the writer's settings ask for less)");
    expect(section.user).toContain("cover every COVER item even if that goes over the writer's cap, never over the Locked cap");
    // Two squeezes on the draft and two on the repair, each held for the item.
    expect(run.sent.filter((request) => request.stage === "compression")).toHaveLength(4);
    expect(run.result.draftText).toBe(DRAFT);
    expect(run.note(CAP_RULE)).toMatchObject({
      outcome: "not_applied",
      reason:
        "exceeds: 164/120 words; repair failed; over the writer's cap at 164/120 words to keep every signed-off item (a shortening pass that met the cap but dropped one was not kept); cut by hand if needed",
    });
  });

  it("does not use a repair that drops a signed-off item to meet the writer's cap", async () => {
    const run = await draft({
      compressions: [],
      repair: WITHOUT_ITEM,
      checks: [
        FIRST_CHECK,
        // The final text no longer covers the item.
        {
          verdicts: FIRST_CHECK.verdicts,
          planVerdicts: [
            { itemId: ITEM, mergedItemIds: [ITEM], paragraph: 0, outcome: "not_applied", reason: "The sealer is gone." },
            { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
          ],
        },
      ],
    });
    // Round 2 follow-up: the check of the final text after a used repair is the full Self-check.
    expect(run.sent.filter((request) => request.stage === "selfCheck")).toHaveLength(2);
    expect(run.result.draftText).toBe(DRAFT);
    const cap = run.note(CAP_RULE);
    expect(cap?.outcome).toBe("not_applied");
    expect(cap?.reason).toMatch(/^exceeds: 164\/120 words; repair not used \(/);
    expect(cap?.reason).toMatch(
      /; over the writer's cap at 164\/120 words to keep every signed-off item \(the repair that met the cap but dropped one was not used\); cut by hand if needed$/
    );
  });

  it("says the item is not why the Line is over when the held passes were over the cap too (re-check P2-a)", async () => {
    expect(sectionMetrics(OVER_WITHOUT_ITEM, "s242").words).toBeGreaterThan(120);
    const run = await draft({
      compressions: [OVER_WITHOUT_ITEM, OVER_WITHOUT_ITEM, OVER_WITHOUT_ITEM, OVER_WITHOUT_ITEM],
      repair: DRAFT,
      checks: [FIRST_CHECK],
    });
    expect(run.result.draftText).toBe(DRAFT);
    expect(run.note(CAP_RULE)).toMatchObject({
      outcome: "not_applied",
      reason:
        "exceeds: 164/120 words; repair failed; still over after 2 shortening passes. 2 passes were not kept because they dropped a signed-off item, though they would not have met the cap either. The text was not cut to fit: shorten Line 242 to 120 words to meet the writer's settings",
    });
  });

  it("rolls back a repair that drops the item while still over the cap, without blaming the item (re-check P2-a)", async () => {
    const run = await draft({
      compressions: [],
      repair: OVER_WITHOUT_ITEM,
      checks: [
        FIRST_CHECK,
        {
          verdicts: FIRST_CHECK.verdicts,
          planVerdicts: [
            { itemId: ITEM, mergedItemIds: [ITEM], paragraph: 0, outcome: "not_applied", reason: "The sealer is gone." },
            { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
          ],
        },
      ],
    });
    expect(run.result.draftText).toBe(DRAFT);
    const reason = run.note(CAP_RULE)?.reason ?? "";
    expect(reason).toMatch(/^exceeds: 164\/120 words; repair not used \(the repaired text no longer covers the signed-off item .*, and a repair must keep what a COVER item holds, so the checked draft was kept\); still over after 2 shortening passes\. The text was not cut to fit: shorten Line 242 to 120 words to meet the writer's settings$/);
    expect(reason).not.toContain("to keep every signed-off item");
  });

  // ─── Round 2 (2026-10-05): every row describes the text that ships ──────
  /** The repair, shortened under the writer's cap with the signed-off item kept. */
  const SHORT_WITH_ITEM = [
    `The company finishes routed board panels for cabinet makers. ${fillers(1)}`,
    `${COVER} ${fillers(2)}`,
  ].join("\n\n");
  const OPENER_MISSED = {
    verdicts: [{ paragraph: 0, check: "instruction", instruction: "writer:profile", outcome: "not_applied", reason: "Opener not used verbatim.", repairGuidance: "Open P1 with the opener." }],
    planVerdicts: FIRST_CHECK.planVerdicts,
  };

  it("checks the final text again when shortening changed the repair, in place of the coverage-only check (round 2)", async () => {
    expect(sectionMetrics(SHORT_WITH_ITEM, "s242").words).toBeLessThanOrEqual(120);
    const run = await draft({
      compressions: [DRAFT, DRAFT, SHORT_WITH_ITEM],
      repair: DRAFT,
      checks: [
        OPENER_MISSED,
        {
          verdicts: [{ paragraph: 1, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Opener used verbatim." }],
          planVerdicts: FIRST_CHECK.planVerdicts,
        },
      ],
    });
    expect(run.result.draftText).toBe(SHORT_WITH_ITEM);
    // One check of the final text, with the labels and the plan: no request
    // is added (the coverage-only check it replaced is gone since the
    // 2026-10-05 follow-up).
    const stages = run.sent.map((request) => request.stage);
    expect(stages.filter((stage) => stage === "selfCheck")).toHaveLength(2);
    const finalCheck = run.sent.filter((request) => request.stage === "selfCheck")[1]!.user;
    expect(finalCheck).toContain("--- BEGIN [WRITER INSTRUCTIONS] ---");
    expect(finalCheck).toContain(SHORT_WITH_ITEM.split("\n\n")[0]!);
    // The row says what the final text does, never "not re-verified".
    expect(run.result.notes.find((row) => row.source === "model" && row.instruction === SETTINGS)).toMatchObject({
      outcome: "applied",
      repaired: true,
      reason: "Opener used verbatim.; repaired, and checked again on the final text",
    });
    expect(run.result.notes.map((row) => row.reason).join(" ")).not.toContain("not re-verified");
    expect(run.note(CAP_RULE)).toMatchObject({ outcome: "applied" });
  });

  it("says a row was not checked on the final text when that check fails (round 2)", async () => {
    // Only the first check is scripted: the check of the final text fails.
    const run = await draft({ compressions: [DRAFT, DRAFT, SHORT_WITH_ITEM], repair: DRAFT, checks: [OPENER_MISSED] });
    expect(run.result.draftText).toBe(SHORT_WITH_ITEM);
    const row = run.result.notes.find((candidate) => candidate.source === "model" && candidate.instruction === SETTINGS);
    expect(row).toMatchObject({ outcome: "not_applied", repaired: false });
    expect(row?.reason).toMatch(new RegExp(`^${NOT_CHECKED_ON_FINAL_TEXT} \\(the check of the final text did not complete: [a-z_]+\\)$`));
    expect(row?.reason).not.toContain("Opener not used verbatim");
  });

  it("rolls back a shortened repair that loses a signed-off item, and the rows describe the checked draft again (review P3-7)", async () => {
    // The repair drops the item's sentence; shortening keeps what is left.
    const shorterWithout = [`The company finishes routed board panels for cabinet makers. ${fillers(2)}`, fillers(2)].join("\n\n");
    const run = await draft({
      compressions: [DRAFT, DRAFT, shorterWithout],
      repair: OVER_WITHOUT_ITEM,
      checks: [
        OPENER_MISSED,
        {
          verdicts: [{ paragraph: 1, check: "instruction", instruction: "writer:profile", outcome: "applied", reason: "Opener used verbatim." }],
          planVerdicts: [
            { itemId: ITEM, mergedItemIds: [ITEM], paragraph: 0, outcome: "not_applied", reason: "The sealer is gone." },
            { skippedRoleId: "prior_year_status", mergedItemIds: [], paragraph: 0, outcome: "applied", reason: "Absent." },
          ],
        },
      ],
    });
    // The full check of the final text ran, then the repair was not used.
    expect(run.sent.filter((request) => request.stage === "selfCheck")).toHaveLength(2);
    expect(run.result.draftText).toBe(DRAFT);
    const row = run.result.notes.find((candidate) => candidate.source === "model" && candidate.instruction === SETTINGS);
    expect(row?.outcome).toBe("not_applied");
    expect(row?.reason).toContain("Opener not used verbatim.; repair not used (the repaired text no longer covers the signed-off item");
    expect(row?.reason).not.toContain("checked again on the final text");
    expect(row?.reason).not.toContain("Opener used verbatim");
  });

  it("governed terms follow the check of the final text when the run has no plan checks (review P3-2)", async () => {
    const feedbackTerms: FeedbackGovernedTerm[] = [
      { term: "sealer", feedback: [{ roleId: "company_context", instruction: "Call it the sealer coat." }] },
    ];
    const run = await draft(
      { compressions: [DRAFT, DRAFT, SHORT_WITH_ITEM], repair: DRAFT, checks: [{ verdicts: [] }, { verdicts: [] }] },
      { planChecks: [], planChecksBlock: "", feedbackTerms }
    );
    expect(run.sent.filter((request) => request.stage === "selfCheck")).toHaveLength(2);
    expect(run.result.draftText).toBe(SHORT_WITH_ITEM);
    // Judged on the final text: no verdict there, so "not checked on the
    // final text", not the first check's state.
    expect(run.result.notes.find((candidate) => candidate.instruction === "Glossary Term: sealer")?.reason).toBe(
      governedTermReason(feedbackTerms[0]!.feedback, "final_not_checked")
    );
    expect(governedTermReason(feedbackTerms[0]!.feedback, "final_not_checked")).not.toBe(
      governedTermReason(feedbackTerms[0]!.feedback, "not_checked")
    );
  });
});
