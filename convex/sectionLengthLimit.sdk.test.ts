/// <reference types="vite/client" />
/**
 * 2026-09-28 (second): Step-by-step Sections stay within the line limits.
 *
 * The first release suite run drafted Line 246 at 440 words against its
 * 350-word Locked cap: both compression passes came back almost as long (the
 * request named only the line limit, which the 45-line draft already met),
 * and the repair, a whole new draft, was never compressed or measured again.
 *
 * Every test here runs the ordered chain through the real entry actions, the
 * real Anthropic SDK and the production instrumented client, with only
 * `fetch` stubbed, and scripts each Line's draft, compression and repair.
 */
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import { freezeModelsForGeneration } from "./lib/modelRoles";
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./ai/promptDefinitions";
import { SECTION_242_REQUEST } from "./ai/section242Agent";
import { SECTION_244_REQUEST } from "./ai/section244Agent";
import { SECTION_246_REQUEST } from "./ai/section246Agent";
import { resetGenerationModelCache, resetGenerationPlaceholderCache } from "./ai/providers";
import { planLengthBudgetBlock } from "./ai/orderedGeneration";
import { compressionTargetWords } from "./ai/pipeline";
import { sectionMetrics } from "./lib/lineLimits";

const modules = import.meta.glob("./**/*.ts");
type T = ReturnType<typeof convexTest<typeof schema.tables>>;
type Line = "242" | "244" | "246";

const SONNET = "claude-sonnet-5";

beforeAll(async () => {
  await import("./modelCatalog");
});
beforeEach(() => {
  resetGenerationModelCache();
  resetGenerationPlaceholderCache();
  vi.useFakeTimers({ now: new Date("2026-09-28T12:00:00Z"), toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── Fictional Section text ─────────────────────────────────────────────────

const TRANSCRIPT =
  "Interviewer: What was uncertain?\nClient: Nobody knew whether a coated window could stay clear at 254 nanometres for 30 days in secondary effluent. " +
  "The team screened four coatings on coupons and then ran four field units at the Harbourside plant.";

/** `count` paragraphs of `sentences` whole sentences each, tagged so each text is its own. */
function sectionText(tag: string, count: number, sentences: number): string {
  return Array.from({ length: count }, (_, paragraph) =>
    Array.from(
      { length: sentences },
      (_, index) =>
        `The ${tag} trial ${paragraph + 1}.${index + 1} compared a coated window with the uncoated control at 254 nanometres in secondary effluent.`
    ).join(" ")
  ).join("\n\n");
}

const DRAFT_242 = sectionText("uncertainty", 2, 4);
const DRAFT_244 = sectionText("work", 4, 5);
/** The release suite's shape: under the 50-line limit, over the 350-word cap. */
const DRAFT_246 = sectionText("advancement", 6, 4);
const FIT_246 = sectionText("fitted", 4, 4);

function words(text: string, line: Line = "246") {
  return sectionMetrics(text, `s${line}`).words;
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type Script = {
  drafts: Record<Line, string>;
  /** Compression answers for Line 246, in order; an empty queue echoes the text. */
  compressions?: string[];
  /** Repair answers per Line; absent echoes the draft being repaired. */
  repairs?: Partial<Record<Line, string>>;
  /** Self-check verdicts for the Section whose text includes the key. */
  verdictsFor?: (user: string) => unknown[];
};
type Sent = { stage: string; json: Record<string, unknown>; user: string };

const TOOL_ANSWERS: Record<string, unknown> = {
  submit_transcript_analysis: {
    company_context: "A fictional maker of optical water-quality analyzers",
    project_goal: "A coated window that stays clear for 30 days",
    business_problem: "Operators cleaned the windows too often",
    scientific_technical_problem: "No coating was known to stay UV-clear and resist biofilm",
    technological_objective: "A durable UV-clear anti-fouling window",
    work_performed: {},
    project_status: "completed",
  },
  submit_generation_brief: {
    storyline: "The team screened coatings and field-tested a coated window.",
    storylineClaims: [],
    claimExclusions: [],
    confidenceMap: [],
    glossaryTerms: [],
  },
  submit_retrieval_brief: {
    problem: "Biofilm fouling of optical windows in effluent.",
    uncertainty: "Whether a coating could stay UV-clear for 30 days.",
    work: "Coupon screening and a field trial.",
    advancement: "A coating that held transmission past 50 days.",
  },
  submit_qa_scorecard: {
    overall_score: 80,
    section_scores: {},
    cra_compliance: {},
    hallucination_risks: [],
    ai_language_flags: [],
    superlative_flags: [],
    gaps_requiring_client_followup: [],
    suggested_improvements: [],
  },
  submit_consistency_findings: { findings: [] },
  submit_chronology_table: { entries: [] },
};

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
function lineOf(user: string): Line {
  if (user.includes(SECTION_242_REQUEST.taskMarker)) return "242";
  if (user.includes(SECTION_244_REQUEST.taskMarker)) return "244";
  if (user.includes(SECTION_246_REQUEST.taskMarker)) return "246";
  throw new Error("A Section request named no Line");
}
function stageOf(json: Record<string, unknown>, user: string): string {
  const tool = toolOf(json);
  if (tool) return tool;
  if (textOf(json.system).startsWith(COMPRESSION_REQUEST.system.slice(0, 60))) return "compression";
  if (user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix)) return `repair:${lineOf(user)}`;
  return `section:${lineOf(user)}`;
}

function installFetch(script: Script): Sent[] {
  const sent: Sent[] = [];
  const compressions = [...(script.compressions ?? [])];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.url !== "https://api.anthropic.com/v1/messages") {
        throw new Error(`Unexpected HTTP transport ${request.url}`);
      }
      const json = JSON.parse(await request.text()) as Record<string, unknown>;
      const user = userOf(json);
      const stage = stageOf(json, user);
      sent.push({ stage, json, user });
      const base = {
        id: "msg_synthetic",
        type: "message",
        role: "assistant",
        model: json.model,
        stop_sequence: null,
        usage: { input_tokens: 40, output_tokens: 8 },
      };
      const tool = toolOf(json);
      if (tool) {
        const answer =
          tool === "submit_self_check" ? { verdicts: script.verdictsFor?.(user) ?? [] } : TOOL_ANSWERS[tool];
        if (answer === undefined) throw new Error(`Unexpected tool ${tool}`);
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: `toolu_${tool}`, name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      let text: string;
      if (stage === "compression") {
        text = compressions.shift() ?? user.split(COMPRESSION_REQUEST.userScaffold.targetToText)[1];
      } else if (stage.startsWith("repair:")) {
        const line = stage.slice("repair:".length) as Line;
        text = script.repairs?.[line] ?? user.split(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.draftPrefix)[1];
      } else {
        text = script.drafts[stage.slice("section:".length) as Line];
      }
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

// ─── A Single draft run through the ordered chain ──────────────────────────

async function fixture() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "length-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Fouling-resistant analyzer",
      clientName: "Fictional Hydrologic",
      status: "generating",
      ownerId: userId,
      createdBy: userId,
      shareToken: "length-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: 1 });
    const modelFreeze = await freezeModelsForGeneration(ctx, [SONNET], Date.now());
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      candidateMode: "single",
      requestedAt: 1,
      requestedBy: userId,
      startedAt: 1,
      previousProjectStatus: "draft",
      learningDigestIds: [],
      singleModelId: SONNET,
      modelFreeze,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Frozen transcript",
      content: TRANSCRIPT,
      contentHash: "length-source-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    return { generationId };
  });
  return { t, ...ids };
}

const JOBS = {
  "ai/pipeline:generateCandidate": internal.ai.pipeline.generateCandidate,
  "ai/orderedGeneration:generateOrderedSection": internal.ai.orderedGeneration.generateOrderedSection,
  "ai/orderedGeneration:finalizeOrderedCandidate": internal.ai.orderedGeneration.finalizeOrderedCandidate,
} as const;

async function drain(t: T) {
  for (let round = 0; round < 40; round += 1) {
    const job = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).find(
        (row) => row.state.kind === "pending" && row.name in JOBS
      )
    );
    if (!job) return;
    await t.run((ctx) => ctx.scheduler.cancel(job._id));
    const ref = JOBS[job.name as keyof typeof JOBS];
    await t.action(ref, job.args[0] as FunctionArgs<typeof ref>);
  }
  throw new Error("The scheduled work did not drain");
}

async function runSingle(script: Script) {
  const sent = installFetch(script);
  const f = await fixture();
  await f.t.action(internal.ai.pipeline.generateReport, { generationId: f.generationId });
  await drain(f.t);
  const state = await f.t.run(async (ctx) => ({
    generation: await ctx.db.get(f.generationId),
    rows: await ctx.db
      .query("generationSectionRuns")
      .withIndex("by_generationId", (q) => q.eq("generationId", f.generationId))
      .collect(),
    notes: await ctx.db
      .query("complianceNotes")
      .withIndex("by_generationId_and_section", (q) => q.eq("generationId", f.generationId))
      .collect(),
  }));
  expect(state.generation?.status).toBe("completed");
  const row = (line: Line) => {
    const found = state.rows.find((item) => item.section === `s${line}`);
    if (!found) throw new Error(`No row for Line ${line}`);
    return found;
  };
  const locked = (line: Line) =>
    state.notes.filter(
      (note: Doc<"complianceNotes">) => note.section === line && note.tier === "locked"
    );
  return { sent, row, locked };
}

function expectOtherLinesUnchanged(run: Awaited<ReturnType<typeof runSingle>>) {
  expect(run.row("242").draftText).toBe(DRAFT_242);
  expect(run.row("244").draftText).toBe(DRAFT_244);
  for (const line of ["242", "244"] as const) {
    expect(run.sent.filter((request) => request.stage === `repair:${line}`)).toEqual([]);
    expect(run.locked(line)).toEqual([
      expect.objectContaining({ outcome: "applied", reason: expect.stringMatching(/^within cap at /) }),
    ]);
  }
  // Only Line 246 was ever compressed.
  for (const request of run.sent.filter((item) => item.stage === "compression")) {
    expect(request.user).not.toContain("uncertainty trial");
    expect(request.user).not.toContain("work trial");
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Step-by-step Sections stay within the line limits (real SDK, fetch stubbed)", () => {
  it("the fixture is the release suite's shape: Line 246 under its line limit but over its word cap", () => {
    const metrics = sectionMetrics(DRAFT_246, "s246");
    expect(metrics.lines).toBeLessThanOrEqual(50);
    expect(metrics.words).toBeGreaterThan(350);
    expect(sectionMetrics(FIT_246, "s246").overLimit).toBe(false);
    expect(sectionMetrics(DRAFT_242, "s242").overLimit).toBe(false);
    expect(sectionMetrics(DRAFT_244, "s244").overLimit).toBe(false);
  });

  it("an over-limit Line 246 draft is compressed under the limit, and the other Lines are unchanged", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      compressions: [FIT_246],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(1);
    // The request names the word cap it breaks, with headroom under it.
    const { lines, words: draftWords } = sectionMetrics(DRAFT_246, "s246");
    expect(compressions[0].user).toContain(
      `This section is ${lines} lines and ${draftWords} words, but the CRA field allows at most 50 lines of 78 characters (blank lines between paragraphs each cost one line) and at most 350 words. Rewrite it to AT MOST ${compressionTargetWords("s246", "standard")} words`
    );
    expect(compressionTargetWords("s246", "standard")).toBe(315);
    expect(compressions[0].json.model).toBe(SONNET);
    expect(compressions[0].json.thinking).toEqual({ type: "disabled" });

    expect(run.row("246").draftText).toBe(FIT_246);
    expect(JSON.parse(run.row("246").metrics ?? "null")).toMatchObject({ overLimit: false, words: words(FIT_246) });
    expect(run.locked("246")).toEqual([
      expect.objectContaining({
        outcome: "applied",
        reason: `within cap at ${words(FIT_246)}/350 words, ${sectionMetrics(FIT_246, "s246").lines}/50 lines`,
      }),
    ]);
    expect(run.sent.filter((request) => request.stage === "repair:246")).toEqual([]);
    expectOtherLinesUnchanged(run);
  });

  it("a compression that cannot reach the limit keeps the best attempt whole and records the breach", async () => {
    const closest = sectionText("closest", 6, 3) + " " + sectionText("closest tail", 1, 2);
    const longer = sectionText("longer", 6, 4);
    const repaired = sectionText("repaired", 7, 4);
    const repairedShorter = sectionText("repaired shorter", 6, 4);
    expect(words(closest)).toBeGreaterThan(350);
    expect(words(longer)).toBeGreaterThan(words(closest));
    expect(words(repairedShorter)).toBeGreaterThan(words(closest));

    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      // Draft passes: closer, then longer (never kept). Repair passes: a
      // little shorter than the repair, still further over than `closest`.
      compressions: [closest, longer, repairedShorter, repaired],
      repairs: { "246": repaired },
    });
    expect(run.sent.filter((request) => request.stage === "compression")).toHaveLength(4);
    expect(run.sent.filter((request) => request.stage === "repair:246")).toHaveLength(1);
    // The Locked breach went to the repair as its first issue.
    const repairRequest = run.sent.find((request) => request.stage === "repair:246");
    expect(repairRequest?.user).toContain(`Shorten Line 246 to at most 350 words and 50 form lines (now ${words(closest)} words`);

    // The best attempt, byte for byte: never clipped to fit.
    expect(run.row("246").draftText).toBe(closest);
    const [locked] = run.locked("246");
    expect(locked).toMatchObject({ outcome: "not_applied", tier: "locked", source: "deterministic" });
    expect(locked.reason).toContain(`cap breach at ${words(closest)}/350 words`);
    expect(locked.reason).toContain(
      `repair not used (the repaired text came out at ${words(repairedShorter)}/350 words`
    );
    expect(locked.reason).toContain(
      "still over after 4 shortening passes. The text was not cut to fit: shorten Line 246 to 350 words and 50 lines before filing"
    );
    expect(JSON.parse(run.row("246").selfCheck ?? "null")).toMatchObject({
      status: "repair_failed",
      repairAttempted: true,
    });
    expect(JSON.parse(run.row("246").slotCounts ?? "null")).toMatchObject({ "compression:246": 4, "repair:246": 1 });
    expectOtherLinesUnchanged(run);
  });

  it("a repair that comes back over the limit is compressed before it replaces the checked draft", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      compressions: [sectionText("fitted repair", 4, 4)],
      repairs: { "246": DRAFT_246 },
      verdictsFor: (user) =>
        user.includes("fitted trial")
          ? [
              {
                paragraph: 1,
                check: "storyline",
                instruction: "Storyline",
                outcome: "not_applied",
                reason: "The paragraph drifts from the Storyline.",
                repairGuidance: "Tie the paragraph to the field trial.",
              },
            ]
          : [],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    // Nothing to compress before the repair; one pass on the repair.
    expect(compressions).toHaveLength(1);
    expect(compressions[0].user).toContain(DRAFT_246);
    expect(run.row("246").draftText).toBe(sectionText("fitted repair", 4, 4));
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expect(JSON.parse(run.row("246").selfCheck ?? "null")).toMatchObject({ status: "repair_attempted" });
    expectOtherLinesUnchanged(run);
  });

  it("restates the Locked length after a signed-off plan", () => {
    expect(planLengthBudgetBlock("s246", "standard")).toBe(
      "\n\n# LENGTH (Locked Rule, outranks the plan)\nThis Line holds at most 350 words and 50 form lines. Write AT MOST 337 words in all. Cover every COVER item in as few words as it needs: when the plan holds more than fits, give each item fewer words rather than go over."
    );
  });
});
