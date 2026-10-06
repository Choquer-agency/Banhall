/// <reference types="vite/client" />
/**
 * 2026-09-28 (second): Step-by-step Sections stay within the line limits.
 *
 * The first release suite run drafted Line 246 at 440 words against its
 * 350-word Locked cap: both compression passes came back almost as long (the
 * request named only the line limit, which the 45-line draft already met),
 * and the repair, a whole new draft, was never compressed or measured again.
 *
 * 2026-09-28 (second, full suite): the full release suite still shipped Lines over their
 * caps in 4 of 5 fixtures. Drafts overshot a 337-word ask, 40 compression
 * passes came back at 94 percent of their input on average, and the passes
 * that did cut were refused for dropping any number or negation at all. The
 * tests below reproduce those shapes: a small overage closed by an honest
 * pass, and the guard kept to Must keep content and [GAP] markers.
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
import {
  compressionLoss,
  compressionTargetWords,
  endedMidSentence,
  finalCutTargetWords,
  withinFinalCutReach,
} from "./ai/pipeline";
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

/**
 * Line 246 of a fictional analyzer project: the load-bearing sentences
 * (numbers, negations, a [GAP] marker) every compression must keep.
 */
const GAP = "[GAP: confirm whether the day 90 coupon was sent for surface analysis]";
const CORE_246 = [
  "The team learned that a sol-gel silica coating with a fluorinated top layer held 87 percent transmission at 254 nanometres after 38 days in secondary effluent, above the 85 percent target. Uncoated control windows fell below 60 percent within 12 days.",
  "Coupon screening compared four coating candidates against uncoated controls over 42 days, with transmission measured every 3 days. Two candidates did not survive chlorinated water past day 20, which showed that UV clarity alone was not enough.",
  "The team also learned that biofilm is not a spectrally flat filter. Attenuation at 254 nanometres ran 1.8 times the attenuation at 365 nanometres, so a simple ratio correction could not compensate for fouling.",
  "A correction keyed to accumulated reference loss held corrected drift under 2 percent to day 52 and day 55 on secondary effluent, against the 30-day target.",
  `On chlorinated final effluent, one unit's coating lost 9 percent transmission between day 70 and day 90, and the cause was not established by year end. ${GAP}`,
];
/** Supporting sentences: no digits and no negations, so a pass may cut them. */
const SUPPORT = [
  "The field notes describe how the coated window behaved across the exposure period and how the team read each transmission reading against the control.",
  "Each reading was logged beside the plant operating conditions so that reviewers could follow the reasoning behind every coating choice.",
  "The engineers discussed these readings at the weekly review and agreed which coating variant deserved a longer exposure run.",
];
/** Line 246 with `support` supporting sentences spread across its paragraphs. */
function line246(support: number): string {
  return CORE_246.map((core, paragraph) => {
    const extra = Array.from(
      { length: Math.floor(support / CORE_246.length) + (paragraph < support % CORE_246.length ? 1 : 0) },
      (_, index) => SUPPORT[(paragraph + index) % SUPPORT.length]
    );
    return [core, ...extra].join(" ");
  }).join("\n\n");
}

/**
 * 2026-09-28 (second, full suite): supporting detail of the kind the release suite's
 * drafts carried, with numbers and negations no Must keep line holds. An
 * honest shortening pass drops it.
 */
const DETAIL_246 = [
  "Transmission was read on a bench spectrometer every 3 days, and the first 6 readings were not corrected for lamp ageing.",
  "The coupons sat in a 40-litre tank fed from the plant's secondary clarifier, without temperature control.",
];
/** Line 246 with the detail sentences added to its second and fourth paragraphs. */
function line246WithDetail(support: number): string {
  return line246(support)
    .split("\n\n")
    .map((paragraph, index) =>
      index === 1 ? `${paragraph} ${DETAIL_246[0]}` : index === 3 ? `${paragraph} ${DETAIL_246[1]}` : paragraph
    )
    .join("\n\n");
}

const DRAFT_242 = sectionText("uncertainty", 2, 4);
const DRAFT_244 = sectionText("work", 4, 5);
/** The release suite's shape: under the 50-line limit, over the 350-word cap. */
const DRAFT_246 = line246(14);
const FIT_246 = line246(4);
/** The release suite's small overage (changed-advancement-links, 370 of 350 words). */
const NEAR_246 = line246WithDetail(8);
/** A Self-check fix holding a number and a negation, as a repair's Must keep line. */
const FIX_246 = "Say that two coating candidates did not survive chlorinated water past day 20.";

function words(text: string, line: Line = "246") {
  return sectionMetrics(text, `s${line}`).words;
}

// ─── The stubbed provider ──────────────────────────────────────────────────

type Script = {
  drafts: Record<Line, string>;
  /**
   * Compression answers for Line 246, in order; FAIL answers with an HTTP
   * 400; an empty queue echoes the text.
   */
  compressions?: Array<string | typeof FAIL>;
  /** Repair answers per Line; absent echoes the draft being repaired. */
  repairs?: Partial<Record<Line, string>>;
  /** Self-check verdicts for the Section whose text includes the key. */
  verdictsFor?: (user: string) => unknown[];
};
type Sent = { stage: string; json: Record<string, unknown>; user: string };
const FAIL = Symbol("fail");

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
        const next = compressions.shift();
        if (next === FAIL) {
          return Response.json(
            { type: "error", error: { type: "invalid_request_error", message: "Synthetic refusal" } },
            { status: 400 }
          );
        }
        text = next ?? user.split(COMPRESSION_REQUEST.userScaffold.percentToText)[1];
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
  const model = (line: Line, instruction: string) =>
    state.notes.find(
      (note: Doc<"complianceNotes">) =>
        note.section === line && note.source === "model" && note.instruction === instruction
    );
  return { sent, row, locked, model };
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

const storylineVerdict = [
  {
    paragraph: 1,
    check: "storyline",
    instruction: "Storyline",
    outcome: "not_applied",
    reason: "The paragraph drifts from the Storyline.",
    repairGuidance: "Tie the paragraph to the field trial.",
  },
];
/** One unmet verdict for Line 246 only, so only Line 246 is repaired. */
const verdictFor246 = (user: string) => (user.includes(CORE_246[0]) ? storylineVerdict : []);

describe("Step-by-step Sections stay within the line limits (real SDK, fetch stubbed)", () => {
  it("the fixture is the release suite's shape: Line 246 under its line limit but over its word cap", () => {
    const metrics = sectionMetrics(DRAFT_246, "s246");
    expect(metrics.lines).toBeLessThanOrEqual(50);
    expect(metrics.words).toBeGreaterThan(350);
    expect(sectionMetrics(FIT_246, "s246").overLimit).toBe(false);
    expect(words(FIT_246)).toBeGreaterThan(Math.floor(297 * COMPRESSION_REQUEST.targetFloor));
    expect(sectionMetrics(DRAFT_242, "s242").overLimit).toBe(false);
    expect(sectionMetrics(DRAFT_244, "s244").overLimit).toBe(false);
    expect(compressionLoss(DRAFT_246, FIT_246, "s246", 297)).toBeNull();
    expect(words(NEAR_246)).toBeGreaterThan(350);
    expect(words(NEAR_246)).toBeLessThanOrEqual(375);
  });

  it("an over-limit Line 246 draft is compressed under the limit, and the other Lines are unchanged", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      compressions: [FIT_246],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(1);
    // The request names the word cap it breaks, with headroom under it,
    // and has nothing to list as must-keep (no plan, no repair yet).
    const { lines, words: draftWords } = sectionMetrics(DRAFT_246, "s246");
    // 2026-09-28 (second, full suite): it aims at 85 percent of the cap and says how
    // much to cut.
    const cut = draftWords - 297;
    expect(compressions[0].user.startsWith(
      `This section is ${lines} lines and ${draftWords} words, but the CRA field allows at most 50 lines of 78 characters (blank lines between paragraphs each cost one line) and at most 350 words. Rewrite it to AT MOST 297 words: cut at least ${cut} words, about ${Math.round((cut / draftWords) * 100)} percent of it, while preserving the technical substance.`
    )).toBe(true);
    expect(compressionTargetWords("s246", "standard")).toBe(297);
    expect(compressionTargetWords("s244", "standard")).toBe(595);
    expect(textOf(compressions[0].json.system)).toContain(
      "so reaching the word target comes first. Keep every [GAP: …] marker verbatim (never remove or reword one), every point in the Must keep list and every writer instruction the text follows. To reach the target, cut in this order: repetition and restated context, then framing and filler, then the least important supporting detail"
    );
    expect(textOf(compressions[0].json.system)).toContain(
      "A number or negation may go only together with the detail it belongs to: never change a number and never turn a negative statement into a positive one."
    );
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

  it("a pass that drops the only [GAP] marker is not kept; the next pass that keeps it is", async () => {
    const broken = FIT_246.replace(` ${GAP}`, "");
    expect(compressionLoss(DRAFT_246, broken, "s246", 297)).toBe(`dropped the marker ${GAP}`);
    // [GAP] markers stay strict with or without a Must keep list.
    expect(compressionLoss(DRAFT_246, broken, "s246", 297, [FIX_246])).toBe(`dropped the marker ${GAP}`);
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      compressions: [broken, FIT_246],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(2);
    // The second pass works from the draft, not from the rejected pass.
    expect(compressions[1].user).toContain(DRAFT_246);
    expect(run.row("246").draftText).toBe(FIT_246);
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expectOtherLinesUnchanged(run);
  });

  it("release suite: a small overage is closed by an honest pass that drops detail numbers and negations no Must keep line holds", async () => {
    // Before, this pass was refused ("dropped the number 6"), so the Line
    // shipped over its cap.
    expect(compressionLoss(NEAR_246, FIT_246, "s246", 297)).toBeNull();
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": NEAR_246 },
      compressions: [FIT_246],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(1);
    const near = words(NEAR_246);
    expect(compressions[0].user).toContain(
      `and at most 350 words. Rewrite it to AT MOST 297 words: cut at least ${near - 297} words, about ${Math.round(((near - 297) / near) * 100)} percent of it`
    );
    expect(run.row("246").draftText).toBe(FIT_246);
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expect(run.sent.filter((request) => request.stage === "repair:246")).toEqual([]);
    expectOtherLinesUnchanged(run);
  });

  it("a number or negation a Must keep line holds may not be dropped, but may move elsewhere in the Line", () => {
    const mustKeep = [`Paragraph 2: ${FIX_246}`];
    const noNumber = FIT_246.replace("did not survive chlorinated water past day 20", "did not survive chlorinated water for long");
    expect(compressionLoss(NEAR_246, noNumber, "s246", 297, mustKeep)).toBe(
      "dropped the number 20, which a Must keep line holds"
    );
    const flipped = FIT_246.replace("did not survive chlorinated water", "failed in chlorinated water");
    expect(compressionLoss(NEAR_246, flipped, "s246", 297, mustKeep)).toBe(
      'dropped the negation "not survive", which a Must keep line holds'
    );
    // The same fact elsewhere in the Line is kept: the number and the
    // negation moved to another sentence, the contraction reads as "not".
    const moved = flipped.replace(
      "Uncoated control windows fell below 60 percent within 12 days.",
      "Uncoated control windows fell below 60 percent within 12 days, and two candidates didn't survive past day 20."
    );
    expect(compressionLoss(NEAR_246, moved, "s246", 297, mustKeep)).toBeNull();
    // Without the Must keep line, both are ordinary detail.
    expect(compressionLoss(NEAR_246, flipped, "s246", 297)).toBeNull();
    // The fix's "Paragraph 2" label is not a number the text must keep.
    expect(compressionLoss("Paragraph 2 held. The 2 coupons did not crack.", "The coupons did not crack.", "s246", 1, mustKeep)).toBeNull();
    // An article after the negation is skipped: "not a flat filter" reads "not flat".
    expect(
      compressionLoss(
        "Biofilm is not a flat filter at 254 nanometres.",
        "Biofilm is a steep filter at 254 nanometres.",
        "s246",
        1,
        ["Biofilm is not a flat filter."]
      )
    ).toBe('dropped the negation "not flat", which a Must keep line holds');
  });

  it("on a repair, a pass that drops the fix's number or negation is not kept; the next pass that keeps them is", async () => {
    const flipped = FIT_246.replace("did not survive chlorinated water", "failed in chlorinated water");
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      compressions: [flipped, FIT_246],
      repairs: { "246": NEAR_246 },
      verdictsFor: (user) =>
        user.includes(CORE_246[0]) ? [{ ...storylineVerdict[0], paragraph: 2, repairGuidance: FIX_246 }] : [],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(2);
    expect(compressions[0].user.startsWith(`${COMPRESSION_REQUEST.mustKeep.prefix}- Paragraph 2: ${FIX_246}\n\n`)).toBe(true);
    // The second pass works from the repair, not from the refused pass.
    expect(compressions[1].user).toContain(NEAR_246);
    expect(compressions[1].user).toContain("AT MOST 252 words");
    expect(run.row("246").draftText).toBe(FIT_246);
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expectOtherLinesUnchanged(run);
  });

  it("the draft and its repair ask for 85 percent of the word cap, with the line limit in view", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      repairs: { "246": FIT_246 },
      verdictsFor: verdictFor246,
    });
    const bodyOf = (stage: string) => JSON.stringify(run.sent.find((request) => request.stage === stage)?.json ?? {});
    for (const [line, target] of [["242", 297], ["244", 595], ["246", 297]] as const) {
      expect(bodyOf(`section:${line}`)).toContain(
        `holds at most ${line === "244" ? 100 : 50} lines of 78 characters, and EVERY blank line between paragraphs also costs one full line. Write AT MOST ${target} words total.`
      );
    }
    expect(bodyOf("repair:246")).toContain("Write AT MOST 297 words total.");
    expect(draftWordTarget("s246", "concise")).toBe(268);
    expect(draftWordTarget("s246", "full")).toBe(297);
    expect(draftWordTarget("s244", "full")).toBe(595);
  });

  it("a pass under 60 percent of its word target cut content, not wording, and is not kept", () => {
    const short = CORE_246.slice(0, 2).join("\n\n");
    expect(compressionLoss(CORE_246.join("\n\n"), short, "s246", 297)).toMatch(/^dropped/);
    const keepsEverything = CORE_246.join(" ");
    expect(words(keepsEverything)).toBeLessThan(178);
    expect(compressionLoss(CORE_246.join("\n\n"), keepsEverything, "s246", 297)).toBe(
      `came out at ${words(keepsEverything)} words, under the 178-word floor`
    );
  });

  it("a Line over on lines alone is asked for the words that fit its lines", () => {
    expect(compressionTargetWords("s242", "standard", 1, { words: 300, lines: 60 })).toBe(212);
    expect(compressionTargetWords("s242", "standard", 0.85, { words: 300, lines: 60 })).toBe(180);
    // Within its lines: the word target alone.
    expect(compressionTargetWords("s242", "standard", 1, { words: 400, lines: 45 })).toBe(297);
    expect(compressionTargetWords("s242", "standard", 0.85, { words: 400, lines: 45 })).toBe(252);
  });

  it("a compression that cannot reach the limit keeps the best attempt whole and records the breach", async () => {
    const closest = line246(10);
    const longer = line246(12);
    const repaired = line246(16);
    const repairedShorter = line246(11);
    expect(words(closest)).toBeGreaterThan(350);
    expect(words(longer)).toBeGreaterThan(words(closest));
    expect(words(repairedShorter)).toBeGreaterThan(words(closest));

    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      // Draft passes: closer, then longer (never kept); `closest` is within
      // 10 percent of the cap, so the targeted pass follows and comes back
      // longer too (2026-09-28, fifth). Repair passes: a little shorter than
      // the repair, still further over than `closest` and more than 10
      // percent over, so no targeted pass.
      compressions: [closest, longer, longer, repairedShorter, repaired],
      repairs: { "246": repaired },
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(5);
    expect(compressions[2].user.startsWith(COMPRESSION_REQUEST.finalCut.userScaffold.prefix)).toBe(true);
    expect(compressions[2].user).toContain(`Cut at least ${words(closest) - 332} words, so that it ends at 332 words or fewer`);
    // The repair's compressions keep its fixes; the length guidance is not one.
    expect(compressions[3].user.startsWith(COMPRESSION_REQUEST.mustKeep.prefix)).toBe(false);
    expect(run.sent.filter((request) => request.stage === "repair:246")).toHaveLength(1);
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
    // Only the passes on the kept text count (review P3-6).
    expect(locked.reason).toContain(
      "still over after 3 shortening passes. The text was not cut to fit: shorten Line 246 to 350 words and 50 lines before filing"
    );
    expect(JSON.parse(run.row("246").selfCheck ?? "null")).toMatchObject({
      status: "repair_failed",
      repairAttempted: true,
    });
    expect(JSON.parse(run.row("246").slotCounts ?? "null")).toMatchObject({ "compression:246": 5, "repair:246": 1 });
    expectOtherLinesUnchanged(run);
  });

  it("a repair that comes back over the limit is compressed, keeping its fixes, before it replaces the checked draft", async () => {
    const fittedRepair = line246(5);
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      compressions: [fittedRepair],
      repairs: { "246": DRAFT_246 },
      verdictsFor: verdictFor246,
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    // Nothing to compress before the repair; one pass on the repair, which
    // lists the fix it was made for as must-keep.
    expect(compressions).toHaveLength(1);
    expect(compressions[0].user.slice(0, compressions[0].user.indexOf("This section is ") + 16)).toBe(
      `${COMPRESSION_REQUEST.mustKeep.prefix}- Paragraph 1: Tie the paragraph to the field trial.\n\nThis section is `
    );
    expect(compressions[0].user).toContain(DRAFT_246);
    expect(run.row("246").draftText).toBe(fittedRepair);
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    // Round 2 (2026-10-05, owner decision): compression changed the repair
    // after the fix, so the Self-check judges the final text again, and the
    // row describes the text that ships (the stub still finds the drift).
    const checks246 = run.sent.filter((request) => request.stage === "submit_self_check" && request.user.includes(CORE_246[0]!));
    expect(checks246).toHaveLength(2);
    expect(checks246[1]!.user).toContain(fittedRepair.split("\n\n")[0]!);
    expect(JSON.parse(run.row("246").selfCheck ?? "null")).toMatchObject({ status: "repair_failed" });
    expect(run.model("246", "Storyline")).toMatchObject({
      outcome: "not_applied",
      repaired: false,
      reason: "The paragraph drifts from the Storyline.; checked again on the final text",
    });
    expectOtherLinesUnchanged(run);
  });

  it("a failed second pass keeps the first pass's text instead of failing the Section", async () => {
    const closer = line246(10);
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      // Draft: a closer pass, then a failure. Repair (the draft echoed):
      // a failure before any pass.
      compressions: [closer, FAIL, FAIL],
    });
    expect(run.row("246").status).toBe("drafted");
    expect(run.row("246").draftText).toBe(closer);
    const [locked] = run.locked("246");
    expect(locked.outcome).toBe("not_applied");
    expect(locked.reason).toMatch(/still over after 2 shortening passes \(a shortening pass failed: [A-Za-z_]+\)\. The text was not cut to fit/);
    expect(JSON.parse(run.row("246").slotCounts ?? "null")).toMatchObject({ "compression:246": 3, "repair:246": 1 });
    expectOtherLinesUnchanged(run);
  });

  it("a repair whose compression fails is judged on its best text, and the note says compression failed", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      compressions: [line246(10), FAIL],
      repairs: { "246": DRAFT_246 },
      verdictsFor: verdictFor246,
    });
    expect(run.sent.filter((request) => request.stage === "compression")).toHaveLength(2);
    // The best compressed repair is still further over than the checked
    // draft, so the checked draft is kept.
    expect(run.row("246").draftText).toBe(FIT_246);
    expect(run.model("246", "Storyline")?.reason).toMatch(
      new RegExp(`repair not used \\(the repaired text came out at ${words(line246(10))}/350 words, .*; compression of the repair failed \\([A-Za-z_]+\\)\\)$`)
    );
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expectOtherLinesUnchanged(run);
  });

  // 2026-09-28 (fifth, release suite run 6): "skipped-role-supported" shipped
  // Line 246 at 355 of 350 words, 36 of 50 lines, after the repair's two
  // shortening passes. line246(9) is that shape: 354 words, 36 lines.
  const RUN6_246 = line246(9);
  const CUT_246 = line246(8);

  it("the run 6 shape: a small overage is within reach of the targeted pass, which aims 5 percent under the cap", () => {
    expect(sectionMetrics(RUN6_246, "s246")).toMatchObject({ words: 354, lines: 36, overLimit: true });
    expect(sectionMetrics(CUT_246, "s246").overLimit).toBe(false);
    expect(finalCutTargetWords("s246", { words: 354, lines: 36 })).toBe(332);
    expect(finalCutTargetWords("s242", { words: 360, lines: 40 })).toBe(332);
    expect(finalCutTargetWords("s244", { words: 712, lines: 80 })).toBe(665);
    // Over on lines: the words that fit the lines, 5 percent under.
    expect(finalCutTargetWords("s246", { words: 300, lines: 55 })).toBe(259);
    const at = (words: number, lines: number) =>
      withinFinalCutReach({ overLimit: words > 350 || lines > 50, words, wordCap: 350, lines, limit: 50 });
    expect(at(355, 36)).toBe(true);
    expect(at(385, 36)).toBe(true);
    expect(at(386, 36)).toBe(false);
    expect(at(300, 55)).toBe(true);
    expect(at(300, 56)).toBe(false);
    expect(at(350, 50)).toBe(false);
  });

  it("run 6: a repair still a little over after its two passes gets one targeted pass that must cut the stated words, and fits", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": FIT_246 },
      // The repair's two passes come back barely shorter, as in run 6; the
      // targeted pass cuts two supporting sentences.
      compressions: [line246(10), RUN6_246, CUT_246],
      repairs: { "246": DRAFT_246 },
      verdictsFor: verdictFor246,
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(3);
    expect(compressions[1].user).toContain("AT MOST 252 words");
    // The same content guards: the fix stays a Must keep line, the system
    // prompt is the compression prompt, and the request names the cut.
    expect(compressions[2].user).toBe(
      `${COMPRESSION_REQUEST.mustKeep.prefix}- Paragraph 1: Tie the paragraph to the field trial.\n\n` +
        "This section is still over the CRA limit after the earlier shortening passes: it is 36 lines and 354 words, and the CRA field allows at most 50 lines of 78 characters (blank lines between paragraphs each cost one line) and at most 350 words. " +
        "Cut at least 22 words, so that it ends at 332 words or fewer: that is what it is over by, plus about 5 percent headroom. Take the words from whole phrases, clauses or sentences of the least important supporting detail, not by trimming single words here and there. Leave everything else as it is, and end every paragraph on a complete sentence.\n\n" +
        RUN6_246
    );
    expect(textOf(compressions[2].json.system)).toBe(textOf(compressions[0].json.system));
    expect(compressions[2].json.model).toBe(SONNET);
    expect(run.row("246").draftText).toBe(CUT_246);
    expect(run.locked("246")).toEqual([
      expect.objectContaining({
        outcome: "applied",
        reason: `within cap at ${words(CUT_246)}/350 words, ${sectionMetrics(CUT_246, "s246").lines}/50 lines`,
      }),
    ]);
    expect(JSON.parse(run.row("246").slotCounts ?? "null")).toMatchObject({ "compression:246": 3, "repair:246": 1 });
    expectOtherLinesUnchanged(run);
  });

  it("a draft still a little over after its two passes gets the targeted pass too; one that fits stops there", async () => {
    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      compressions: [line246(10), RUN6_246, CUT_246],
    });
    const compressions = run.sent.filter((request) => request.stage === "compression");
    expect(compressions).toHaveLength(3);
    // No Must keep list before the repair.
    expect(compressions[2].user.startsWith(COMPRESSION_REQUEST.finalCut.userScaffold.prefix)).toBe(true);
    expect(run.row("246").draftText).toBe(CUT_246);
    expect(run.sent.filter((request) => request.stage === "repair:246")).toEqual([]);
    expect(run.locked("246")).toEqual([expect.objectContaining({ outcome: "applied" })]);
    expectOtherLinesUnchanged(run);
  });

  it("a targeted pass that ends a paragraph mid-sentence, or drops the [GAP] marker, is not kept; the text is never clipped", async () => {
    const paragraphs = CUT_246.split("\n\n");
    paragraphs[1] = paragraphs[1].replace(/ \S+ \S+\.$/, "");
    const clipped = paragraphs.join("\n\n");
    expect(endedMidSentence(RUN6_246, clipped)).toBe("ended paragraph 2 mid-sentence");
    expect(endedMidSentence(RUN6_246, CUT_246)).toBeNull();
    // A [GAP] marker or a closing quote ends a paragraph as well as a full stop.
    expect(endedMidSentence("One. [GAP: two]", "One. [GAP: two]")).toBeNull();
    // A text whose paragraphs already ended oddly is left to the other guards.
    expect(endedMidSentence("One and", "One")).toBeNull();
    expect(compressionLoss(RUN6_246, clipped, "s246", 332)).toBeNull();

    const run = await runSingle({
      drafts: { "242": DRAFT_242, "244": DRAFT_244, "246": DRAFT_246 },
      // Draft: two passes to 354 words, then a clipped targeted pass. Repair
      // (asked to shorten, echoes the draft): the same, with a targeted pass
      // that drops the [GAP] marker.
      compressions: [
        line246(10), RUN6_246, clipped,
        line246(10), RUN6_246, CUT_246.replace(` ${GAP}`, ""),
      ],
    });
    expect(run.sent.filter((request) => request.stage === "compression")).toHaveLength(6);
    // The best whole text stays, byte for byte.
    expect(run.row("246").draftText).toBe(RUN6_246);
    const [locked] = run.locked("246");
    expect(locked).toMatchObject({ outcome: "not_applied", tier: "locked" });
    expect(locked.reason).toContain("cap breach at 354/350 words, 36/50 lines");
    expect(locked.reason).toContain(
      "still over after 3 shortening passes. The text was not cut to fit: shorten Line 246 to 350 words and 50 lines before filing"
    );
    // 6 compression requests: within the ordered allowance, no overrun.
    expect(JSON.parse(run.row("246").slotCounts ?? "null")).toMatchObject({ "compression:246": 6, "repair:246": 1 });
    expectOtherLinesUnchanged(run);
  });

  it("restates the Locked length after a signed-off plan", () => {
    expect(planLengthBudgetBlock("s246", "standard")).toBe(
      "\n\n# LENGTH (Locked Rule, outranks the plan)\nThis Line holds at most 350 words and 50 form lines. Write AT MOST 297 words in all. Cover every COVER item in as few words as it needs: when the plan holds more than fits, give each item fewer words rather than go over."
    );
  });
});
