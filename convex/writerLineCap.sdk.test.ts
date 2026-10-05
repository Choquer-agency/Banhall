/// <reference types="vite/client" />
/**
 * 2026-10-04 (first): a writer's settings govern length and the Compliance
 * Note. Release suite 2026-10-04 (fixture writer-settings-document) drafted
 * 323 of 260, 602 of 520 and 274 of 260 words: the drafter and the repair
 * were asked for the Locked target only, the shortening passes aimed only at
 * the Locked cap, and the Self-check wrote "word cap ok" beside a cap row
 * that was not met.
 *
 * A Single draft runs through the ordered chain with the real entry
 * actions, the real Anthropic SDK and the production instrumented client,
 * with only `fetch` stubbed. The saved Writer Profile caps Line 246 at 200
 * words, below its 350-word Locked cap; Lines 242 and 244 have no cap of
 * their own, so their requests are sent as before. Fictional project.
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
import { lengthBudgetBlock } from "./ai/pipeline";
import { draftWordTarget, sectionMetrics } from "./lib/lineLimits";

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
  vi.useFakeTimers({ now: new Date("2026-10-04T12:00:00Z"), toFake: ["Date"] });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── A fictional project: the Tarrow kiln-drying sensor ────────────────────

const TRANSCRIPT =
  "Interviewer: What was uncertain?\nClient: Nobody knew whether a capacitive probe could read board moisture above 60 degrees C in the kiln. " +
  "The team ran four probe designs through twelve kiln charges.";

/** The saved Writer Profile: a settings document whose cap the extractor reads. */
const SETTINGS = [
  "# PD Writing Customized Settings",
  "Use the term kiln charge, never batch or load.",
  "- Line 246: no more than 200 words.",
  "Write in the third person throughout.",
].join("\n\n");
const CAP_RULE = "- Line 246: no more than 200 words.";

function sectionText(tag: string, count: number, sentences: number): string {
  return Array.from({ length: count }, (_, paragraph) =>
    Array.from(
      { length: sentences },
      (_, index) =>
        `The ${tag} trial ${paragraph + 1}.${index + 1} compared a capacitive probe with oven-dry samples in the kiln charge.`
    ).join(" ")
  ).join("\n\n");
}

const DRAFT_242 = sectionText("uncertainty", 2, 3);
const DRAFT_244 = sectionText("work", 3, 4);
/** Line 246: within its 350-word Locked cap, over the writer's 200. */
const DRAFT_246 = sectionText("advancement", 4, 4);
/** Line 246 shortened under the writer's cap. */
const FIT_246 = sectionText("advancement", 3, 3);

const PROFILE_VERDICT_REASON = "Terms, banned words, third person, and word cap all followed.";

// ─── The stubbed provider ──────────────────────────────────────────────────

type Script = {
  /** Self-check rules stored on the saved Writer Profile (no extraction then). */
  profileRules?: Array<{ section?: Line; paragraphIndex?: number; instruction: string; maxWords?: number }>;
  /** Compression answers for Line 246, in order; an empty queue echoes. */
  compressions?: string[];
  /** Every compression request fails with an HTTP 400. */
  failCompressions?: boolean;
  /** Line 246's repair answer; absent, the Line as drafted. */
  repair246?: string;
  /** Self-check verdicts for Line 246's checks; other Lines get none. */
  verdicts246?: unknown[];
};
type Sent = { stage: string; json: Record<string, unknown>; user: string };

const TOOL_ANSWERS: Record<string, unknown> = {
  submit_transcript_analysis: {
    company_context: "A fictional maker of kiln sensors",
    project_goal: "A probe that reads board moisture in a hot kiln",
    business_problem: "Operators pulled sample boards by hand",
    scientific_technical_problem: "No probe was known to stay accurate above 60 degrees C",
    technological_objective: "An accurate in-kiln moisture probe",
    work_performed: {},
    project_status: "completed",
  },
  submit_generation_brief: {
    storyline: "The team tested probe designs through kiln charges.",
    storylineClaims: [],
    claimExclusions: [],
    confidenceMap: [],
    glossaryTerms: [],
  },
  submit_retrieval_brief: {
    problem: "Moisture readings in a hot kiln.",
    uncertainty: "Whether a capacitive probe stays accurate above 60 degrees C.",
    work: "Four probe designs through twelve kiln charges.",
    advancement: "A probe design that held accuracy.",
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

const DRAFTS: Record<Line, string> = { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 };

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
          tool === "submit_self_check"
            ? { verdicts: user.includes("advancement trial") ? script.verdicts246 ?? [] : [] }
            : TOOL_ANSWERS[tool];
        if (answer === undefined) throw new Error(`Unexpected tool ${tool}`);
        return Response.json({
          ...base,
          content: [{ type: "tool_use", id: `toolu_${tool}`, name: tool, input: answer }],
          stop_reason: "tool_use",
        });
      }
      let text: string;
      if (stage === "compression" && script.failCompressions) {
        return Response.json(
          { type: "error", error: { type: "invalid_request_error", message: "Synthetic refusal" } },
          { status: 400 }
        );
      }
      if (stage === "compression") {
        text = compressions.shift() ?? user.split(COMPRESSION_REQUEST.userScaffold.percentToText)[1] ??
          user.split(COMPRESSION_REQUEST.finalCut.userScaffold.targetToText)[1] ?? "";
      } else if (stage.startsWith("repair:")) {
        // A repair that changes nothing, unless scripted: the Line as drafted.
        const line = stage.slice("repair:".length) as Line;
        text = (line === "246" ? script.repair246 : undefined) ?? DRAFTS[line];
      } else {
        text = DRAFTS[stage.slice("section:".length) as Line];
      }
      return Response.json({ ...base, content: [{ type: "text", text }], stop_reason: "end_turn" });
    })
  );
  return sent;
}

// ─── A Single draft run through the ordered chain ──────────────────────────

async function fixture(profileRules?: Script["profileRules"]) {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "cap-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "In-kiln moisture probe",
      clientName: "Fictional Tarrow Lumber",
      status: "generating",
      ownerId: userId,
      createdBy: userId,
      shareToken: "cap-token",
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
      contentHash: "cap-source-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    await ctx.db.insert("writerProfiles", {
      userId,
      customInstructions: SETTINGS,
      enabled: true,
      ...(profileRules ? { selfCheckRules: profileRules } : {}),
      updatedBy: userId,
      createdAt: 1,
      updatedAt: 1,
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
  const f = await fixture(script.profileRules);
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
  const text = (line: Line) => {
    const found = state.rows.find((item) => item.section === `s${line}`);
    if (!found) throw new Error(`No row for Line ${line}`);
    return found.draftText ?? "";
  };
  const note = (line: Line, instruction: string) =>
    state.notes.find((row: Doc<"complianceNotes">) => row.section === line && row.instruction === instruction);
  const modelNotes = (line: Line) =>
    state.notes.filter((row: Doc<"complianceNotes">) => row.section === line && row.source === "model");
  const requests = (stage: string, line?: Line) =>
    sent.filter((request) => request.stage === stage && (line === undefined || request.user.includes(`${{ "242": "uncertainty", "244": "work", "246": "advancement" }[line]} trial`)));
  return { sent, text, note, modelNotes, requests };
}

// Review P3-2: a real model quotes the document cut short, not whole.
const profileVerdict = {
  paragraph: 0,
  check: "instruction",
  instruction: "# PD Writing Customized Settings ...",
  outcome: "applied",
  reason: PROFILE_VERDICT_REASON,
};
/** The Self-check sentence for Line 246's cap (review P2-1). */
const MEASURED_CAPS =
  `\n\nCode measures these caps of the writer's and reports them on their own: "${CAP_RULE}". In the verdicts for the WRITER INSTRUCTIONS block, do not judge these caps, and do not mention this section's word or line count. Judge every other rule, including any other length rule.`;

describe("a writer's cap governs drafting, repair, shortening and the Compliance Note (2026-10-04, first)", () => {
  it("the fixture: Line 246 is within its Locked cap but over the writer's, and the others have no cap", () => {
    expect(sectionMetrics(DRAFT_246, "s246")).toMatchObject({ words: 240, overLimit: false });
    expect(sectionMetrics(FIT_246, "s246").words).toBeLessThanOrEqual(200);
    expect(sectionMetrics(FIT_246, "s246").words).toBeGreaterThan(Math.floor(170 * COMPRESSION_REQUEST.targetFloor));
  });

  it("asks the drafter for a target under the writer's cap, shortens to it, and records the cap met", async () => {
    const run = await runSingle({ compressions: [FIT_246], verdicts246: [profileVerdict] });
    // The drafter of Line 246 reads the writer's cap as the writer's settings
    // and a target under it (170, 85 percent of 200).
    const draft246 = run.requests("section:246");
    expect(draft246).toHaveLength(1);
    expect(draft246[0]!.user).toContain(lengthBudgetBlock("s246", "standard", 170, { words: 200 }));
    expect(draft246[0]!.user).not.toContain(lengthBudgetBlock("s246", "standard", 297));
    // Lines 242 and 244 have no cap of their own: their blocks are as before.
    for (const line of ["242", "244"] as const) {
      const key = `s${line}` as const;
      expect(run.requests(`section:${line}`)[0]!.user).toContain(lengthBudgetBlock(key, "standard", draftWordTarget(key, "standard")));
      expect(run.requests(`section:${line}`)[0]!.user).not.toContain("The writer's settings ask for at most");
    }
    // Within its Locked cap, Line 246 is still shortened, toward the writer's cap.
    const compressions = run.requests("compression");
    expect(compressions).toHaveLength(1);
    expect(compressions[0]!.user).toContain(
      "and at most 350 words, and the writer's settings ask for at most 200 words in this section. Rewrite it to AT MOST 170 words: cut at least 70 words"
    );
    expect(run.text("246")).toBe(FIT_246);
    expect(run.note("246", CAP_RULE)).toMatchObject({ outcome: "applied", reason: `${sectionMetrics(FIT_246, "s246").words}/200 words` });
    expect(run.note("246", "Writer Profile")).toMatchObject({ outcome: "applied", reason: "Writer Profile applied" });
    expect(run.modelNotes("246")).toEqual([
      expect.objectContaining({ outcome: "applied", reason: PROFILE_VERDICT_REASON }),
    ]);
    expect(run.requests("repair:246")).toEqual([]);
    // The Self-check of Line 246 is told code measures caps; the other
    // Lines, with no cap of the writer's, are asked as before.
    expect(run.requests("submit_self_check", "246")[0]!.user).toContain(MEASURED_CAPS);
    for (const line of ["242", "244"] as const) {
      expect(run.requests("submit_self_check", line)[0]!.user).not.toContain("Code measures these caps");
    }
  });

  it("repairs with the same target, never cuts the text to fit, and no row vouches for the cap it missed", async () => {
    // Every shortening pass comes back as long as it went in.
    const run = await runSingle({ verdicts246: [profileVerdict] });
    const draft = run.requests("section:246")[0]!.user;
    const repair = run.requests("repair:246");
    expect(repair).toHaveLength(1);
    // The repair is asked for the same target under the same block, and for
    // the writer's cap as its issue: never 297 beside 200.
    const block = lengthBudgetBlock("s246", "standard", 170, { words: 200 });
    expect(draft).toContain(block);
    expect(repair[0]!.user).toContain(block);
    expect(repair[0]!.user).toContain(`- Shorten Line 246 to at most 200 words (writer rule: "${CAP_RULE}").`);
    expect(repair[0]!.user).not.toContain("Write AT MOST 297");
    // Two squeezes on the draft and two on the repair, each aimed at the
    // writer's cap; 240 words is beyond the targeted pass's reach of it.
    const compressions = run.requests("compression");
    expect(compressions).toHaveLength(4);
    for (const request of compressions) {
      expect(request.user).toContain("the writer's settings ask for at most 200 words in this section");
    }
    // Nothing was cut to fit.
    expect(run.text("246")).toBe(DRAFT_246);
    expect(run.note("246", CAP_RULE)).toMatchObject({
      outcome: "not_applied",
      reason:
        "exceeds: 240/200 words; repair failed; still over after 2 shortening passes. The text was not cut to fit: shorten Line 246 to 200 words to meet the writer's settings",
    });
    expect(run.note("246", "Writer Profile")).toMatchObject({
      outcome: "applied",
      reason:
        "Writer Profile applied. It was used to draft this Line, but not every rule it sets was met: Line 246 is over the writer's cap at 240/200 words (see that row).",
    });
    // The settings row can no longer say the word cap was followed.
    expect(run.modelNotes("246")).toEqual([
      expect.objectContaining({
        outcome: "not_applied",
        reason:
          "Not followed in full: Line 246 is over the writer's cap at 240/200 words (measured by code; see the cap row). Otherwise followed: Terms, banned words, third person.",
      }),
    ]);
    // The Locked cap held throughout.
    expect(run.note("246", "Locked Rule: Line 246 holds at most 350 words and 50 form lines")).toMatchObject({ outcome: "applied" });
  });

  it("keeps a draft within the Locked cap when a shortening pass for the writer's cap fails (review P2-3)", async () => {
    const run = await runSingle({ failCompressions: true, verdicts246: [profileVerdict] });
    // The Section is kept as drafted, never failed, and the row says why.
    expect(run.text("246")).toBe(DRAFT_246);
    expect(run.note("246", CAP_RULE)).toMatchObject({
      outcome: "not_applied",
      reason: expect.stringMatching(/^exceeds: 240\/200 words; repair failed; still over after 1 shortening pass\. A shortening pass failed \([a-z_]+\)\. The text was not cut to fit/),
    });
    expect(run.note("246", "Locked Rule: Line 246 holds at most 350 words and 50 form lines")).toMatchObject({ outcome: "applied" });
  });

  it("does not use a repair made only to shorten that comes back further over the writer's cap (review P3-1)", async () => {
    const longer = sectionText("advancement", 5, 4);
    expect(sectionMetrics(longer, "s246")).toMatchObject({ words: 300, overLimit: false });
    const run = await runSingle({ repair246: longer, verdicts246: [profileVerdict] });
    expect(run.requests("repair:246")).toHaveLength(1);
    expect(run.text("246")).toBe(DRAFT_246);
    expect(run.note("246", CAP_RULE)?.reason).toMatch(
      /^exceeds: 240\/200 words; repair not used \(the repaired text came out at 300 words, \d+ lines, further over the writer's cap of 200 words than the checked draft, so the checked draft was kept\); still over after 2 shortening passes/
    );
  });

  it("uses a repair within the writer's whole-Line cap when only a paragraph cap was over (review re-check P3-2)", async () => {
    const lineRule = "Line 246: at most 280 words.";
    const paragraphRule = "Paragraph 1 of Line 246: at most 40 words.";
    // Paragraph 1 cut to two sentences; the Line grows but stays within 280.
    const repaired = [
      "The advancement trial 1.1 compared a capacitive probe with oven-dry samples in the kiln charge. The probe held its reading through every charge.",
      sectionText("advancement", 3, 5),
    ].join("\n\n");
    const words = sectionMetrics(repaired, "s246").words;
    expect(words).toBeGreaterThan(240);
    expect(words).toBeLessThanOrEqual(280);
    const run = await runSingle({
      profileRules: [
        { section: "246", instruction: lineRule, maxWords: 280 },
        { section: "246", paragraphIndex: 0, instruction: paragraphRule, maxWords: 40 },
      ],
      repair246: repaired,
    });
    expect(run.requests("repair:246")).toHaveLength(1);
    expect(run.text("246")).toBe(repaired);
    expect(run.note("246", paragraphRule)).toMatchObject({ outcome: "applied" });
    expect(run.note("246", lineRule)).toMatchObject({ outcome: "applied", reason: `${words}/280 words` });
  });
});
