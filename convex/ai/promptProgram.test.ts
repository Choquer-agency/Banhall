/// <reference types="vite/client" />

// Story 2 (CAP-5/10, AD-24): ordered, ungated generation in single and
// compare, driven through the real entry action and the real scheduled chain
// actions, with the provider stubbed at the Anthropic client boundary (the
// same seam pipeline.compare.test.ts uses). Every scheduled job is run from
// its persisted payload, one at a time, under fake timers.

import type Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { api, internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import schema from "../schema";
// DW-107: the one definition of the Brief entry-row bound, so the over-bound
// fixture below cannot drift from the reader that enforces it.
import { MAX_BRIEF_ENTRY_ROWS } from "../generations";
import type { GenerationMessageParams } from "./openrouterCore";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import { COMPRESSION_REQUEST, ORDERED_PROMPT_SCAFFOLDS } from "./promptDefinitions";
import { generationPromptProgram } from "./promptProgram";
import { readOrderedProfileContext } from "./pipeline";
import { sectionMetrics } from "../lib/lineLimits";
import { parseCanonicalReport } from "../../src/lib/reportSections";
import { NOT_GENERATED_PLACEHOLDER } from "../lib/tiptapReport";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));
const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, load]) => [
    path.startsWith("./") ? `../ai/${path.slice(2)}` : path,
    load,
  ])
);

type Section = "242" | "244" | "246";
const SECTION_REQUESTS = {
  "242": SECTION_242_REQUEST,
  "244": SECTION_244_REQUEST,
  "246": SECTION_246_REQUEST,
} as const;
const DRAFTS: Record<Section, string> = {
  "242": "S242-DRAFT: The team could not predict the controller response under load.",
  "244": "S244-DRAFT: The team built three prototype controllers and measured each.",
  "246": "S246-DRAFT: The work established how the controller behaves under load.",
};
const PAIR = ["claude-opus-4-8", "claude-haiku-4-5-20251001"];
const AUTH_ID = "ordered-chain-writer";
const PRIOR_HEADING = ORDERED_PROMPT_SCAFFOLDS.draftedPriorSections.prefix;

const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};
const qa = {
  overall_score: 88,
  section_scores: {},
  cra_compliance: {},
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: { type?: string; text?: string }) => (block.type === "text" ? block.text ?? "" : ""))
    .join("");
}
function userText(params: GenerationMessageParams | Anthropic.MessageCreateParamsNonStreaming): string {
  return params.messages
    .filter((message) => message.role === "user")
    .map((message) => blocksText(message.content))
    .join("\n");
}
function systemText(params: GenerationMessageParams): string {
  return blocksText((params as { system?: unknown }).system);
}
function draftSectionOf(user: string): Section | null {
  for (const section of ["242", "244", "246"] as const) {
    if (user.startsWith(SECTION_REQUESTS[section].userPrefix)) return section;
  }
  return null;
}
const isRepair = (user: string) => user.includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix);

function install() {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const usage = { input_tokens: 10, output_tokens: 5 };
    if (name) {
      const input =
        name === "submit_transcript_analysis"
          ? analysisOutput
          : name === "submit_qa_scorecard"
            ? qa
            : name === "submit_self_check"
              ? { verdicts: [] }
              : name === "submit_consistency_findings"
                ? { findings: [] }
                : { entries: [] };
      return { content: [{ type: "tool_use", id: "tool-1", name, input }], usage };
    }
    const user = userText(params);
    if (systemText(params) === COMPRESSION_REQUEST.system) {
      return {
        content: [{ type: "text", text: user.split(COMPRESSION_REQUEST.userScaffold.targetToText)[1] ?? "" }],
        usage,
      };
    }
    const section = draftSectionOf(user);
    return { content: [{ type: "text", text: section ? DRAFTS[section] : "Unrouted text." }], usage };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Network disabled in test");
  }));
  install();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function fixture(
  t: ReturnType<typeof convexTest>,
  options: {
    mode: "single" | "compare" | "iterative";
    profile?: { enabled: boolean; buildOrder?: string[] };
  }
) {
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `ordered-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const content = "The team tested controller response through prototype trials.";
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content, createdAt: now });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      startedAt: now,
      candidateMode: options.mode,
      compareModelIds: PAIR,
      singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    await ctx.db.patch(projectId, { status: "generating", activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Interview transcript",
      content,
      contentHash: "ordered-frozen-hash",
      truncated: false,
      originalLength: content.length,
      capturedAt: now,
    });
    if (options.profile) {
      await ctx.db.insert("writerProfiles", {
        userId,
        customInstructions: "",
        enabled: options.profile.enabled,
        ...(options.profile.buildOrder ? { buildOrder: options.profile.buildOrder } : {}),
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
      });
    }
    return { generationId, projectId, userId };
  });
  return { ...ids, asWriter: t.withIdentity({ subject: AUTH_ID }) };
}

const CANDIDATE_JOB = "ai/pipeline:generateCandidate";
const SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";
const ITERATIVE_SECTION_JOB = "ai/iterative:generateSection";

async function pending(t: ReturnType<typeof convexTest>, names: string[]) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.state.kind === "pending" && names.includes(job.name)
    )
  );
}

type Job = Awaited<ReturnType<typeof pending>>[number];

async function runJob(t: ReturnType<typeof convexTest>, job: Job) {
  await t.run((ctx) => ctx.scheduler.cancel(job._id));
  const args = job.args[0];
  if (job.name === CANDIDATE_JOB) {
    await t.action(internal.ai.pipeline.generateCandidate, args as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>);
  } else if (job.name === SECTION_JOB) {
    await t.action(internal.ai.orderedGeneration.generateOrderedSection, args as FunctionArgs<typeof internal.ai.orderedGeneration.generateOrderedSection>);
  } else if (job.name === FINALIZE_JOB) {
    await t.action(internal.ai.orderedGeneration.finalizeOrderedCandidate, args as FunctionArgs<typeof internal.ai.orderedGeneration.finalizeOrderedCandidate>);
  } else if (job.name === ITERATIVE_SECTION_JOB) {
    await t.action(internal.ai.iterative.generateSection, args as FunctionArgs<typeof internal.ai.iterative.generateSection>);
  } else {
    throw new Error(`Unexpected job ${job.name}`);
  }
}

async function runCandidates(t: ReturnType<typeof convexTest>) {
  for (const job of await pending(t, [CANDIDATE_JOB])) await runJob(t, job);
}

/** Run the chain one job at a time; returns the step labels in run order. */
async function drainChain(
  t: ReturnType<typeof convexTest>,
  beforeEach?: (job: Job) => Promise<void>,
  afterEach?: (job: Job) => Promise<void>
): Promise<string[]> {
  const steps: string[] = [];
  for (let round = 0; round < 60; round += 1) {
    const [job] = await pending(t, [SECTION_JOB, FINALIZE_JOB]);
    if (!job) return steps;
    await beforeEach?.(job);
    steps.push(
      job.name === SECTION_JOB ? (job.args[0] as { section: string }).section : "finalize"
    );
    await runJob(t, job);
    await afterEach?.(job);
  }
  throw new Error("The ordered chain did not drain");
}

function toolCalls(tool: string) {
  return network.create.mock.calls
    .map(([params]) => params as GenerationMessageParams)
    .filter((params) => params.tool_choice?.name === tool);
}
function firstDraftPrompts(): string[] {
  return network.create.mock.calls
    .map(([params]) => userText(params as GenerationMessageParams))
    .filter((user) => draftSectionOf(user) !== null && !isRepair(user));
}
const priorBlock = (section: Section) =>
  `### ${{ "242": "Line 242 — Uncertainty", "244": "Line 244 — Work performed", "246": "Line 246 — Advancement" }[section]} (DRAFTED)\n${DRAFTS[section]}`;

async function generationOf(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  return (await t.run((ctx) => ctx.db.get(generationId))) as Doc<"generations">;
}

describe("ordered, ungated generation (single)", () => {
  it("drafts 242 → 244 → 246 as separate scheduled actions, each with exactly the prior drafted sections, with no gate", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "single" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);

    const statuses: string[] = [];
    const seen: {
      beforeFinalize: Array<{ section: string }> | null;
      consistencyCallsBeforeFinalize: number;
    } = { beforeFinalize: null, consistencyCallsBeforeFinalize: -1 };
    const steps = await drainChain(
      t,
      async (job) => {
        if (job.name === FINALIZE_JOB) {
          seen.beforeFinalize = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
          seen.consistencyCallsBeforeFinalize = toolCalls("submit_consistency_findings").length;
        }
      },
      async () => {
        statuses.push((await generationOf(t, generationId)).status);
      }
    );

    // One scheduled action per section, in order, then one finalize.
    expect(steps).toEqual(["242", "244", "246", "finalize"]);
    // Ungated: the generation never waits on the writer between sections.
    expect(statuses).not.toContain("awaiting_input");
    expect(statuses.slice(0, -1).every((status) => status === "running")).toBe(true);
    expect(statuses.at(-1)).toBe("completed");

    const prompts = firstDraftPrompts();
    expect(prompts.map(draftSectionOf)).toEqual(["242", "244", "246"]);
    expect(prompts[0]).not.toContain(PRIOR_HEADING);
    expect(prompts[1]).toContain(PRIOR_HEADING);
    expect(prompts[1]).toContain(priorBlock("242"));
    expect(prompts[1]).not.toContain(DRAFTS["244"]);
    expect(prompts[1]).not.toContain(DRAFTS["246"]);
    expect(prompts[2]).toContain(priorBlock("242"));
    expect(prompts[2]).toContain(priorBlock("244"));
    expect(prompts[2].indexOf(priorBlock("242"))).toBeLessThan(prompts[2].indexOf(priorBlock("244")));
    expect(prompts[2]).not.toContain(DRAFTS["246"]);

    // Exactly one consistency pass, run by finalize, and the last section in
    // order stays withheld until that pass is recorded.
    expect(seen.consistencyCallsBeforeFinalize).toBe(0);
    expect(toolCalls("submit_consistency_findings")).toHaveLength(1);
    expect((seen.beforeFinalize ?? []).map((draft) => draft.section)).toEqual(["242", "244"]);
    const afterFinalize = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
    expect((afterFinalize ?? []).map((draft) => draft.section)).toEqual(["242", "244", "246"]);
    // One Self-check per section.
    expect(toolCalls("submit_self_check")).toHaveLength(3);

    const generation = await generationOf(t, generationId);
    expect(generation.productionOrder).toEqual(["242", "244", "246"]);
    expect(generation.stoppedAfterSection).toBeUndefined();
    const outputs = JSON.parse(generation.agentOutputs ?? "null");
    expect(outputs.productionOrder).toEqual(["242", "244", "246"]);
    expect(outputs.callBudget).toEqual({
      counts: {
        "section:242": 1,
        "section:244": 1,
        "section:246": 1,
        "selfCheck:242": 1,
        "selfCheck:244": 1,
        "selfCheck:246": 1,
        consistency: 1,
        qa: 1,
        chronology: 1,
      },
      overrun: [],
    });
    expect(Object.keys(outputs.selfCheck).sort()).toEqual(["242", "244", "246"]);

    const rows = await t.run((ctx) =>
      ctx.db.query("generationSectionRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(rows.map((row) => [row.section, row.orderIndex, row.status])).toEqual([
      ["s242", 0, "drafted"],
      ["s244", 1, "drafted"],
      ["s246", 2, "drafted"],
    ]);
    expect(rows.every((row) => row.candidateRunId !== undefined)).toBe(true);

    const [report] = await t.run((ctx) => ctx.db.query("reports").collect());
    const parsed = parseCanonicalReport(report.content);
    expect(parsed.sections.s242.plainText).toBe(DRAFTS["242"]);
    expect(parsed.sections.s244.plainText).toBe(DRAFTS["244"]);
    expect(parsed.sections.s246.plainText).toBe(DRAFTS["246"]);
  });

  it("runs an enabled Writer Profile's custom Build Order 246 → 242 → 244", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, {
      mode: "single",
      profile: { enabled: true, buildOrder: ["246", "242", "244"] },
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    const seen: { beforeFinalize: Array<{ section: string }> | null } = { beforeFinalize: null };
    const steps = await drainChain(t, async (job) => {
      if (job.name === FINALIZE_JOB) {
        seen.beforeFinalize = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
      }
    });
    expect(steps).toEqual(["246", "242", "244", "finalize"]);

    const prompts = firstDraftPrompts();
    expect(prompts.map(draftSectionOf)).toEqual(["246", "242", "244"]);
    expect(prompts[0]).not.toContain(PRIOR_HEADING);
    expect(prompts[1]).toContain(priorBlock("246"));
    expect(prompts[1]).not.toContain(DRAFTS["242"]);
    expect(prompts[1]).not.toContain(DRAFTS["244"]);
    expect(prompts[2]).toContain(priorBlock("246"));
    expect(prompts[2]).toContain(priorBlock("242"));
    expect(prompts[2].indexOf(priorBlock("246"))).toBeLessThan(prompts[2].indexOf(priorBlock("242")));

    // The last section in THIS order (244) is the one withheld.
    expect((seen.beforeFinalize ?? []).map((draft) => draft.section)).toEqual(["246", "242"]);

    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(generation.productionOrder).toEqual(["246", "242", "244"]);
    expect(generation.progressLog?.some((line) => line.startsWith("No effective writer profile"))).toBe(false);

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    const buildOrderRows = notes.filter((note) => note.instruction === "Build Order");
    expect(buildOrderRows).toEqual([
      expect.objectContaining({ section: "246", outcome: "applied", reason: "Build Order 246 → 242 → 244" }),
    ]);
    for (const section of ["242", "244", "246"]) {
      expect(notes.filter((note) => note.section === section && note.instruction === "Writer Profile")).toEqual([
        expect.objectContaining({ outcome: "applied", reason: "Writer Profile applied" }),
      ]);
    }
  });

  it.each([
    ["disabled", { enabled: false, buildOrder: ["246", "242", "244"] }, "no Writer Profile applied (disabled)"],
    ["missing", undefined, "no Writer Profile applied (missing)"],
  ] as const)(
    "a %s Writer Profile drafts 242 → 244 → 246 and every section's note says no Writer Profile applied",
    async (state, profile, reason) => {
      const t = convexTest(schema, modules);
      const { generationId, asWriter } = await fixture(t, {
        mode: "single",
        ...(profile ? { profile: { ...profile, buildOrder: [...profile.buildOrder] } } : {}),
      });
      await t.action(internal.ai.pipeline.generateReport, { generationId });
      await runCandidates(t);
      expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);
      const generation = await generationOf(t, generationId);
      expect(generation.productionOrder).toEqual(["242", "244", "246"]);
      expect(generation.progressLog).toContain(
        `No effective writer profile (${state}): House Rules apply and sections draft in the default order 242 → 244 → 246.`
      );
      const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
      for (const section of ["242", "244", "246"]) {
        expect(notes.filter((note) => note.section === section && note.instruction === "Writer Profile")).toEqual([
          expect.objectContaining({ outcome: "not_applied", reason, tier: "none" }),
        ]);
      }
    }
  );

  it("an invalid Build Order falls back to 242 → 244 → 246 with the reason on every section", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, {
      mode: "single",
      profile: { enabled: true, buildOrder: ["242", "245", "246"] },
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);
    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(generation.productionOrder).toEqual(["242", "244", "246"]);
    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    for (const section of ["242", "244", "246"]) {
      const rows = notes.filter((note) => note.section === section && note.instruction === "Build Order");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ outcome: "not_applied" });
      expect(rows[0].reason).toMatch(/^invalid section in Build Order: 245; House Rules default 242 → 244 → 246 used$/);
    }
  });
});

describe("ordered, ungated generation (compare)", () => {
  it("runs the chain once per candidate, scopes every row by candidateRunId, and the report inherits the selected candidate's notes", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "compare" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    // Both candidates carry the same ordered context read once by generateReport.
    const candidateJobs = await pending(t, [CANDIDATE_JOB]);
    expect(candidateJobs).toHaveLength(2);
    const contexts = candidateJobs.map((job) => JSON.stringify((job.args[0] as { orderedContext?: unknown }).orderedContext));
    expect(contexts[0]).toBe(contexts[1]);
    expect(contexts[0]).toContain('"buildOrder":["242","244","246"]');
    await runCandidates(t);
    const steps = await drainChain(t);
    expect(steps.filter((step) => step === "finalize")).toHaveLength(2);
    expect(steps.filter((step) => step !== "finalize")).toHaveLength(6);

    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("awaiting_selection");
    expect(generation.productionOrder).toEqual(["242", "244", "246"]);

    const runs = await t.run((ctx) =>
      ctx.db.query("generationCandidateRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.status === "succeeded" && run.consistencyCheckedAt !== undefined)).toBe(true);
    const runIds = new Set(runs.map((run) => run._id));

    const sectionRows = await t.run((ctx) =>
      ctx.db.query("generationSectionRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(sectionRows).toHaveLength(6);
    for (const run of runs) {
      const own = sectionRows.filter((row) => row.candidateRunId === run._id);
      expect(own.map((row) => [row.section, row.orderIndex])).toEqual([
        ["s242", 0],
        ["s244", 1],
        ["s246", 2],
      ]);
    }

    const allNotes = await t.run((ctx) => ctx.db.query("complianceNotes").collect());
    expect(allNotes.length).toBeGreaterThan(0);
    expect(allNotes.every((note) => note.candidateRunId !== undefined && runIds.has(note.candidateRunId))).toBe(true);
    // One consistency pass per candidate, on that candidate's model.
    expect(toolCalls("submit_consistency_findings").map((params) => params.model).sort()).toEqual([...PAIR].sort());

    const selectedRun = runs.find((run) => run.model === PAIR[1])!;
    const otherRun = runs.find((run) => run.model === PAIR[0])!;
    const candidates = await t.run((ctx) => ctx.db.query("reportCandidates").collect());
    const selected = candidates.find((candidate) => candidate.model === PAIR[1])!;
    await asWriter.mutation(api.generations.selectReportCandidate, {
      generationId,
      candidateId: selected._id,
    });
    const inherited = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(inherited.length).toBe(allNotes.filter((note) => note.candidateRunId === selectedRun._id).length);
    expect(inherited.every((note) => note.candidateRunId === selectedRun._id)).toBe(true);
    const other = await asWriter.query(api.complianceNotes.listForGeneration, {
      generationId,
      candidateRunId: otherRun._id,
    });
    expect(other.length).toBeGreaterThan(0);
    expect(other.every((note) => note.candidateRunId === otherRun._id)).toBe(true);
  });
});

describe("iterative mode is unchanged", () => {
  it("still stops at awaiting_input after its first section, and its ghost still runs the one-shot pipeline", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await fixture(t, { mode: "iterative" });
    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });

    const [sectionJob] = await pending(t, [ITERATIVE_SECTION_JOB]);
    expect(sectionJob.args).toEqual([{ generationId, section: "s242" }]);
    await runJob(t, sectionJob);
    expect((await generationOf(t, generationId)).status).toBe("awaiting_input");

    const [ghostJob] = await pending(t, [CANDIDATE_JOB]);
    network.create.mockClear();
    await runJob(t, ghostJob);
    // One action drafted all three sections in parallel with no Self-check and
    // no chain: that is runPipelineForModel, not the ordered chain.
    const ghostPrompts = firstDraftPrompts();
    expect(ghostPrompts.map(draftSectionOf).sort()).toEqual(["242", "244", "246"]);
    expect(ghostPrompts.every((prompt) => !prompt.includes(PRIOR_HEADING))).toBe(true);
    expect(toolCalls("submit_self_check")).toHaveLength(0);
    expect(toolCalls("submit_consistency_findings")).toHaveLength(0);
    expect(await pending(t, [SECTION_JOB, FINALIZE_JOB])).toHaveLength(0);

    const ghostRun = (await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect())).find((run) => run.ghost);
    expect(ghostRun?.status).toBe("succeeded");
    expect(ghostRun?.candidateId).toBeDefined();
    const orderedRows = (await t.run((ctx) => ctx.db.query("generationSectionRuns").collect())).filter(
      (row) => row.candidateRunId !== undefined
    );
    expect(orderedRows).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("complianceNotes").collect())).toHaveLength(0);
    expect((await generationOf(t, generationId)).status).toBe("awaiting_input");
    // The iterative topology keeps its gate and its one-shot ghost.
    expect(generationPromptProgram.topology.modes.iterative.sections).toContain("section-242-human-review");
    expect(generationPromptProgram.topology.modes.iterative.sections).toContain("one-shot-ghost-candidate-pipeline");
    expect(generationPromptProgram.topology.modes.iterative.seeds).toContain("seed-stage-human-gate");
    expect(generationPromptProgram.topology.modes.iterative.seeds).not.toContain("one-shot-ghost-candidate-pipeline");
    expect(generationPromptProgram.topology.modes.iterative.selectedBy).toBe(
      "stored-gatedWorkflow"
    );
  });
});

describe("stopOrderedGeneration", () => {
  it("after the first section, no further section is drafted and the generation completes with [NOT GENERATED] bodies", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "single" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);

    const [first] = await pending(t, [SECTION_JOB]);
    await runJob(t, first);
    // 242 finished and 244 is already scheduled; the writer stops now.
    await asWriter.mutation(api.generations.stopOrderedGeneration, { generationId });
    await asWriter.mutation(api.generations.stopOrderedGeneration, { generationId });
    expect(await drainChain(t)).toEqual(["244", "finalize"]);

    expect(firstDraftPrompts().map(draftSectionOf)).toEqual(["242"]);
    expect(toolCalls("submit_consistency_findings")).toHaveLength(0);
    expect(toolCalls("submit_qa_scorecard")).toHaveLength(0);

    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(generation.stopRequestedAt).toBeDefined();
    expect(generation.stoppedAfterSection).toBe("242");
    expect(generation.productionOrder).toEqual(["242", "244", "246"]);
    expect(JSON.parse(generation.agentOutputs ?? "null").stoppedAfterSection).toBe("242");

    const [report] = await t.run((ctx) => ctx.db.query("reports").collect());
    const parsed = parseCanonicalReport(report.content);
    expect(parsed.diagnostics.filter((issue) => issue.code === "MISSING_SECTION")).toEqual([]);
    expect(parsed.sections.s242.plainText).toBe(DRAFTS["242"]);
    expect(parsed.sections.s244.blocks).toEqual([{ kind: "paragraph", text: NOT_GENERATED_PLACEHOLDER }]);
    expect(parsed.sections.s246.blocks).toEqual([{ kind: "paragraph", text: NOT_GENERATED_PLACEHOLDER }]);

    const rows = await t.run((ctx) =>
      ctx.db.query("generationSectionRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(rows.map((row) => [row.section, row.status])).toEqual([
      ["s242", "drafted"],
      ["s244", "pending"],
      ["s246", "pending"],
    ]);
    // A completed generation is no longer active: stopping again is refused.
    await expect(
      asWriter.mutation(api.generations.stopOrderedGeneration, { generationId })
    ).rejects.toThrow(/no longer active/);
  });

  it("is refused for an iterative generation, which is cancelled instead", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "iterative" });
    await t.run((ctx) => ctx.db.patch(generationId, { status: "running" }));
    await expect(
      asWriter.mutation(api.generations.stopOrderedGeneration, { generationId })
    ).rejects.toThrow(/cancelled, not stopped/);
  });
});

describe("assembled-draft consistency pass (CAP-10)", () => {
  it("records a cross-section contradiction as model rows naming the sections and paragraph, and still shows the section", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    const issue =
      "Line 246 says the controller behaviour was established; Line 242 says it could not be predicted.";
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      if (params.tool_choice?.name === "submit_consistency_findings") {
        return {
          content: [
            {
              type: "tool_use",
              id: "tool-consistency",
              name: "submit_consistency_findings",
              input: {
                findings: [
                  { section: "246", paragraph: 1, sections: ["242", "246"], kind: "contradiction", issue },
                ],
              },
            },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      }
      return base(params);
    });

    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    await drainChain(t);

    expect(toolCalls("submit_consistency_findings")).toHaveLength(1);
    // Flagged, never blocking: the generation still completes.
    expect((await generationOf(t, generationId)).status).toBe("completed");

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    const findings = notes.filter((note) => note.instruction === "Consistency pass (contradiction)");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      section: "246",
      paragraphIndex: 0,
      source: "model",
      outcome: "not_applied",
      repaired: false,
    });
    expect(findings[0].candidateRunId).toBeDefined();
    expect(findings[0].reason).toContain("Line 246 paragraph 1");
    expect(findings[0].reason).toContain("sections 242, 246");
    expect(findings[0].reason).toContain(issue);
    const summary = notes.filter((note) => note.instruction === "Consistency pass");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ section: "246", source: "deterministic", outcome: "applied" });
    expect(summary[0].reason).toContain("1 finding(s)");

    // The flagged section is shown to the writer, unchanged.
    const drafts = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
    expect((drafts ?? []).map((draft) => draft.section)).toEqual(["242", "244", "246"]);
    expect(drafts?.find((draft) => draft.section === "246")?.text).toBe(DRAFTS["246"]);
    const report = await t.run((ctx) =>
      ctx.db.query("reports").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).first()
    );
    expect(report?.content).toContain(DRAFTS["246"]);
  });
});

/** A stored Brief on the generation carrying only Claim Exclusions. */
async function seedBrief(
  t: ReturnType<typeof convexTest>,
  ids: { projectId: Id<"projects">; generationId: Id<"generations"> },
  exclusions: Array<{ text: string; change?: "added" | "removed" }>
) {
  await t.run(async (ctx) => {
    const source = (await ctx.db.query("generationSources").collect()).find(
      (row) => row.generationId === ids.generationId
    );
    if (!source) throw new Error("frozen source missing");
    const now = Date.now();
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: ids.projectId,
      generationId: ids.generationId,
      inputsHash: "seeded-brief",
      version: 1,
      origin: "derived",
      storylineText: "",
      createdAt: now,
    });
    for (const exclusion of exclusions) {
      await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId: ids.projectId,
        group: "claimExclusion",
        text: exclusion.text,
        reason: "business_risk",
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: exclusion.text.length,
        exactExcerpt: exclusion.text,
        ...(exclusion.change ? { change: exclusion.change } : {}),
        createdAt: now,
      });
    }
    await ctx.db.patch(ids.generationId, { briefId });
  });
}

/** The delimiter `lib/briefRender.ts` wraps a rendered Brief in. */
const BRIEF_BLOCK_MARKER = "--- BEGIN [GENERATION BRIEF] ---";
/** Shared prefix of every row `seedOverBoundBrief` writes, so a test can
 * assert no individual row leaked, not merely that the block is absent. */
const OVER_BOUND_ENTRY_TEXT = "over-bound exclusion";

/**
 * A stored Brief that is over the entry-row bound and therefore unreadable.
 * Reachable in production two ways (neither passes through the derivation's
 * fail-open catch): `ai/brief.ts:289-305` reuses a Brief by parent row alone,
 * and `persistDerivedBrief`'s `entries` argument is uncapped. Every
 * generation consumer must omit it whole and keep drafting — a throw from
 * `loadBriefCheck` would roll the section's CAS claim back and strand the row
 * `queued` (`orderedGeneration.ts:173-178` sits outside its `try` at `:200`).
 */
async function seedOverBoundBrief(
  t: ReturnType<typeof convexTest>,
  ids: { projectId: Id<"projects">; generationId: Id<"generations"> }
) {
  await t.run(async (ctx) => {
    const source = (await ctx.db.query("generationSources").collect()).find(
      (row) => row.generationId === ids.generationId
    );
    if (!source) throw new Error("frozen source missing");
    const now = Date.now();
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: ids.projectId,
      generationId: ids.generationId,
      inputsHash: "over-bound-brief",
      version: 1,
      origin: "derived",
      storylineText: "A Storyline no prompt may ever see in part.",
      createdAt: now,
    });
    for (let i = 0; i <= MAX_BRIEF_ENTRY_ROWS; i += 1) {
      await ctx.db.insert("generationBriefEntries", {
        briefId,
        projectId: ids.projectId,
        group: "claimExclusion",
        text: `${OVER_BOUND_ENTRY_TEXT} ${i}`,
        reason: "business_risk",
        sourceId: source._id,
        sourceContentHash: source.contentHash,
        startOffset: 0,
        endOffset: 1,
        exactExcerpt: source.content.slice(0, 1),
        createdAt: now,
      });
    }
    await ctx.db.patch(ids.generationId, { briefId });
  });
}

/** Shared prefix of every row `seedByteHeavyBrief` writes. */
const BYTE_HEAVY_ENTRY_TEXT = "byte-heavy exclusion";

/**
 * DW-152: a stored Brief under the entry-row bound whose rows together exceed
 * Convex's 16 MiB transaction read limit (450 rows of about 42 KB). Writer
 * edits (`briefs.saveEntryEdit`) accept any non-empty text, so this is
 * reachable without passing the row bound. Seeded in batches of 100 so no
 * seeding transaction trips the enforced write limit; use it with
 * `convexTest({ ..., transactionLimits: true })`.
 */
async function seedByteHeavyBrief(
  t: ReturnType<typeof convexTest>,
  ids: { projectId: Id<"projects">; generationId: Id<"generations"> }
) {
  const ROWS = 450;
  const TEXT_BYTES = 42_000;
  expect(ROWS).toBeLessThanOrEqual(MAX_BRIEF_ENTRY_ROWS);
  expect(ROWS * TEXT_BYTES).toBeGreaterThan(16 * 1024 * 1024);
  const { briefId, source } = await t.run(async (ctx) => {
    const source = (await ctx.db.query("generationSources").collect()).find(
      (row) => row.generationId === ids.generationId
    );
    if (!source) throw new Error("frozen source missing");
    const briefId = await ctx.db.insert("generationBriefs", {
      projectId: ids.projectId,
      generationId: ids.generationId,
      inputsHash: "byte-heavy-brief",
      version: 1,
      origin: "writer",
      storylineText: "A Storyline no prompt may ever see in part.",
      createdAt: Date.now(),
    });
    return { briefId, source };
  });
  for (let from = 0; from < ROWS; from += 100) {
    await t.run(async (ctx) => {
      const now = Date.now();
      for (let i = from; i < Math.min(ROWS, from + 100); i += 1) {
        await ctx.db.insert("generationBriefEntries", {
          briefId,
          projectId: ids.projectId,
          group: "claimExclusion",
          text: `${BYTE_HEAVY_ENTRY_TEXT} ${i} ${"x".repeat(TEXT_BYTES)}`,
          reason: "business_risk",
          sourceId: source._id,
          sourceContentHash: source.contentHash,
          startOffset: 0,
          endOffset: 1,
          exactExcerpt: source.content.slice(0, 1),
          createdAt: now,
        });
      }
    });
  }
  await t.run((ctx) => ctx.db.patch(ids.generationId, { briefId }));
}

/** This generation's section rows, in insertion (production) order. */
async function sectionRowsOf(t: ReturnType<typeof convexTest>, generationId: Id<"generations">) {
  const rows = await t.run((ctx) => ctx.db.query("generationSectionRuns").collect());
  return rows.filter((row) => row.generationId === generationId) as Doc<"generationSectionRuns">[];
}

describe("chain failure paths never strand a candidate", () => {
  it("a section whose draft call fails fails its candidate, marks the later sections undrafted and ends a single generation", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      const user = userText(params);
      if (!params.tool_choice && draftSectionOf(user) === "244" && !isRepair(user)) {
        throw new Error("provider unavailable");
      }
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244"]);

    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => [row.section, row.status])).toEqual([
      ["s242", "drafted"],
      ["s244", "failed"],
      ["s246", "failed"],
    ]);
    expect(rows[2].error).toBe("Not drafted: an earlier section failed.");
    const [run] = await t.run((ctx) =>
      ctx.db.query("generationCandidateRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    expect(run.status).toBe("failed");
    expect(run.error).toContain("Line 244 draft failed");
    expect((await generationOf(t, generationId)).status).toBe("failed");
    const project = await t.run((ctx) => ctx.db.get(projectId));
    expect(project?.activeGenerationId).toBeUndefined();

    // 242 is still status "drafted" on its own row, but its candidate run
    // failed: getOrderedSectionDrafts must not surface it as a valid draft.
    const drafts = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
    expect(drafts).toEqual([]);
  });

  it("a section draft the banned-word scrub empties fails the section instead of persisting an empty body", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      const user = userText(params);
      if (!params.tool_choice && draftSectionOf(user) === "242" && !isRepair(user)) {
        // Non-empty raw text (passes requireTextResponse); the scrub deletes
        // this connective outright and leaves nothing behind.
        return { content: [{ type: "text", text: "fundamentally" }], usage: { input_tokens: 10, output_tokens: 5 } };
      }
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242"]);

    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => [row.section, row.status])).toEqual([
      ["s242", "failed"],
      ["s244", "failed"],
      ["s246", "failed"],
    ]);
    expect(rows[0].error).toContain("empty after the banned-word scrub");
    expect((await generationOf(t, generationId)).status).toBe("failed");
  });

  it("a compression pass the banned-word scrub empties fails the section instead of persisting an empty body", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await fixture(t, { mode: "single" });
    // Over the 350-word cap, so compressToFit's first squeeze actually runs.
    const long = Array.from({ length: 10 }, (_, paragraph) =>
      Array.from({ length: 38 }, (_, index) => `measurement${(paragraph + index) % 7}`).join(" ")
    ).join("\n\n");
    expect(sectionMetrics(long, "s242").overLimit).toBe(true);
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      const user = userText(params);
      if (!params.tool_choice && draftSectionOf(user) === "242" && !isRepair(user)) {
        return { content: [{ type: "text", text: long }], usage: { input_tokens: 10, output_tokens: 5 } };
      }
      if (systemText(params) === COMPRESSION_REQUEST.system) {
        // Non-empty compressed text (compressSection's own empty-response
        // fallback never fires); the banned-word scrub deletes this
        // connective outright and leaves nothing behind.
        return { content: [{ type: "text", text: "fundamentally" }], usage: { input_tokens: 10, output_tokens: 5 } };
      }
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242"]);

    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => [row.section, row.status])).toEqual([
      ["s242", "failed"],
      ["s244", "failed"],
      ["s246", "failed"],
    ]);
    expect(rows[0].error).toContain("empty after compression");
    expect((await generationOf(t, generationId)).status).toBe("failed");
  });

  it("a failed model Self-check call never blocks a section: deterministic checks only, recorded per section", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      if (params.tool_choice?.name === "submit_self_check") throw new Error("self-check unavailable");
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);
    expect((await generationOf(t, generationId)).status).toBe("completed");

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    const failed = notes.filter((note) => note.instruction === "Model Self-check");
    expect(failed.map((note) => note.section).sort()).toEqual(["242", "244", "246"]);
    expect(failed.every((note) => note.outcome === "not_applied" && note.reason.includes("Self-check call failed"))).toBe(true);
    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => JSON.parse(row.selfCheck ?? "{}").modelCheck)).toEqual(["failed", "failed", "failed"]);
  });

  it("a failed consistency call is recorded as advisory, still releases the last section and completes", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      if (params.tool_choice?.name === "submit_consistency_findings") throw new Error("consistency unavailable");
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    await drainChain(t);
    expect((await generationOf(t, generationId)).status).toBe("completed");

    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    const summary = notes.filter((note) => note.instruction === "Consistency pass");
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ section: "246", outcome: "not_applied" });
    expect(summary[0].reason).toContain("consistency pass call failed");
    const drafts = await asWriter.query(api.generations.getOrderedSectionDrafts, { generationId });
    expect((drafts ?? []).map((draft) => draft.section)).toEqual(["242", "244", "246"]);
  });

  it("QA and chronology failing at the same time are both advisory: the candidate still completes with neither recorded", async () => {
    const t = convexTest(schema, modules);
    const { generationId } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      if (name === "submit_qa_scorecard" || name === "submit_chronology_table") {
        throw new Error(`${name} unavailable`);
      }
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    await drainChain(t);
    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    const outputs = JSON.parse(generation.agentOutputs ?? "null");
    expect(outputs.qa).toBeNull();
    expect(outputs.chronology).toBeNull();
  });

  it("an unreadable Writer Profile degrades to the House Rules order with the reason instead of failing", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const context = await readOrderedProfileContext(
      {
        runQuery: async () => {
          throw new Error("profile read failed");
        },
      } as unknown as Parameters<typeof readOrderedProfileContext>[0],
      undefined
    );
    quiet.mockRestore();
    expect(context.buildOrder).toEqual(["242", "244", "246"]);
    expect(context.profileState).toBe("missing");
    expect(context.buildOrderFallbackReason).toContain("could not be read");
  });
});

describe("the Brief a section is drafted with and checked against", () => {
  it("enforces live Claim Exclusions only; an empty repair keeps the draft and flags Self-check repair failed", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId, asWriter } = await fixture(t, { mode: "single" });
    const base = network.create.getMockImplementation();
    if (!base) throw new Error("provider stub not installed");
    network.create.mockImplementation(async (params: GenerationMessageParams) => {
      const user = userText(params);
      if (!params.tool_choice && draftSectionOf(user) !== null && isRepair(user)) {
        return { content: [{ type: "text", text: "" }], usage: { input_tokens: 10, output_tokens: 5 } };
      }
      return base(params);
    });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    // A re-derivation dropped the 242 exclusion; only its "removed" marker remains.
    await seedBrief(t, { projectId, generationId }, [
      { text: "three prototype controllers", change: "added" },
      { text: "controller response under load", change: "removed" },
    ]);
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);

    const prompts = firstDraftPrompts();
    const promptFor = (section: Section) => prompts.find((prompt) => draftSectionOf(prompt) === section) ?? "";
    expect(promptFor("244")).toContain("- three prototype controllers (business risk)");
    expect(promptFor("242")).not.toContain("controller response under load");
    const repairs = network.create.mock.calls
      .map(([params]) => userText(params as GenerationMessageParams))
      .filter((user) => draftSectionOf(user) !== null && isRepair(user));
    expect(repairs.map(draftSectionOf)).toEqual(["244"]);

    const row244 = (await sectionRowsOf(t, generationId)).find((row) => row.section === "s244");
    expect(row244?.draftText).toBe(DRAFTS["244"]);
    expect(JSON.parse(row244?.selfCheck ?? "{}").status).toBe("repair_failed");
    const generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(
      (generation.progressLog ?? []).filter((line) => line.includes("drafted (Self-check repair failed)"))
    ).toHaveLength(1);
    const notes = await asWriter.query(api.complianceNotes.listForGeneration, { generationId });
    expect(
      notes.some((note) => note.section === "244" && note.outcome === "not_applied" && note.reason.includes("repair call failed"))
    ).toBe(true);
    expect(
      notes.some(
        (note) =>
          note.instruction.includes("controller response under load") || note.reason.includes("controller response under load")
      )
    ).toBe(false);
  });

  it("iterative's one-shot ghost still drafts every section with the stored Brief block (story 1 wiring)", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId } = await fixture(t, { mode: "iterative" });
    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
    const [sectionJob] = await pending(t, [ITERATIVE_SECTION_JOB]);
    await runJob(t, sectionJob);
    // A live exclusion plus one a re-derivation dropped: the ghost family
    // reads through renderBriefForGeneration, so its `removed` filtering needs
    // proving here too (the ordered 242 case above only covers loadBriefCheck).
    await seedBrief(t, { projectId, generationId }, [
      { text: "three prototype controllers" },
      { text: "controller response under load", change: "removed" },
    ]);

    const [ghostJob] = await pending(t, [CANDIDATE_JOB]);
    network.create.mockClear();
    await runJob(t, ghostJob);
    const ghostPrompts = firstDraftPrompts();
    expect(ghostPrompts.map(draftSectionOf).sort()).toEqual(["242", "244", "246"]);
    for (const prompt of ghostPrompts) {
      expect(prompt).toContain("--- BEGIN [GENERATION BRIEF] ---");
      expect(prompt).toContain("- three prototype controllers (business risk)");
      expect(prompt).not.toContain("controller response under load");
    }
  });

  it("omits an over-bound Brief from the ordered chain: every section drafts, none is left queued", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId } = await fixture(t, { mode: "single" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await seedOverBoundBrief(t, { projectId, generationId });

    // Scope the prompt assertions below to this chain's own calls.
    network.create.mockClear();
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);

    const prompts = firstDraftPrompts();
    expect(prompts.map(draftSectionOf)).toEqual(["242", "244", "246"]);
    for (const prompt of prompts) expect(prompt).not.toContain(BRIEF_BLOCK_MARKER);
    // Not one of the 501 rows leaked either: omission is whole, not a prefix.
    for (const prompt of prompts) expect(prompt).not.toContain(OVER_BOUND_ENTRY_TEXT);

    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => row.status)).toEqual(["drafted", "drafted", "drafted"]);
    expect((await generationOf(t, generationId)).status).toBe("completed");
  });

  it("omits an over-bound Brief from iterative's own section and from its one-shot ghost", async () => {
    const t = convexTest(schema, modules);
    const { generationId, projectId } = await fixture(t, { mode: "iterative" });
    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
    await seedOverBoundBrief(t, { projectId, generationId });

    // iterative.ts:406-410 reads the Brief for its own gated section; a throw
    // there fails the section outright.
    const [sectionJob] = await pending(t, [ITERATIVE_SECTION_JOB]);
    network.create.mockClear();
    await runJob(t, sectionJob);
    const sectionPrompts = firstDraftPrompts();
    expect(sectionPrompts.map(draftSectionOf)).toEqual(["242"]);
    expect(sectionPrompts[0]).not.toContain(BRIEF_BLOCK_MARKER);
    // Omission is whole: not one of the 501 rows leaks in either.
    expect(sectionPrompts[0]).not.toContain(OVER_BOUND_ENTRY_TEXT);
    // 242 reviewed, 244/246 not yet reachable — the iterative gate, unchanged.
    expect((await sectionRowsOf(t, generationId)).map((row) => row.status)).toEqual([
      "awaiting_review",
      "pending",
      "pending",
    ]);
    expect((await generationOf(t, generationId)).status).toBe("awaiting_input");

    // pipeline.ts:957-961 reads it for the ghost one-shot candidate.
    const [ghostJob] = await pending(t, [CANDIDATE_JOB]);
    network.create.mockClear();
    await runJob(t, ghostJob);
    const ghostPrompts = firstDraftPrompts();
    expect(ghostPrompts.map(draftSectionOf).sort()).toEqual(["242", "244", "246"]);
    for (const prompt of ghostPrompts) {
      expect(prompt).not.toContain(BRIEF_BLOCK_MARKER);
      expect(prompt).not.toContain(OVER_BOUND_ENTRY_TEXT);
    }
    const ghostRun = (await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect())).find(
      (run) => run.ghost
    );
    expect(ghostRun?.status).toBe("succeeded");
    expect((await generationOf(t, generationId)).status).toBe("awaiting_input");
  });

  it("omits a byte-heavy Brief from the ordered chain under enforced transaction limits: every section drafts, none is left queued (DW-152)", async () => {
    // transactionLimits: true makes convex-test enforce Convex's 16 MiB read
    // limit, so a byte-unbounded Brief read throws inside
    // claimOrderedSectionRun (awaited at orderedGeneration.ts:174, outside
    // the try at :200) and getOrderedCandidateDrafts (:374, outside :410).
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { generationId, projectId } = await fixture(t, { mode: "single" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await seedByteHeavyBrief(t, { projectId, generationId });

    network.create.mockClear();
    await runCandidates(t);
    expect(await drainChain(t)).toEqual(["242", "244", "246", "finalize"]);

    const prompts = firstDraftPrompts();
    expect(prompts.map(draftSectionOf)).toEqual(["242", "244", "246"]);
    for (const prompt of prompts) {
      expect(prompt).not.toContain(BRIEF_BLOCK_MARKER);
      expect(prompt).not.toContain(BYTE_HEAVY_ENTRY_TEXT);
    }
    const rows = await sectionRowsOf(t, generationId);
    expect(rows.map((row) => row.status)).toEqual(["drafted", "drafted", "drafted"]);
    expect((await generationOf(t, generationId)).status).toBe("completed");
  });

  it("omits a byte-heavy Brief from iterative's own section and from its one-shot ghost under enforced transaction limits (DW-152)", async () => {
    const t = convexTest({ schema, modules, transactionLimits: true });
    const { generationId, projectId } = await fixture(t, { mode: "iterative" });
    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
    await seedByteHeavyBrief(t, { projectId, generationId });

    // renderBriefForGeneration via iterative.ts:406-410.
    const [sectionJob] = await pending(t, [ITERATIVE_SECTION_JOB]);
    network.create.mockClear();
    await runJob(t, sectionJob);
    const sectionPrompts = firstDraftPrompts();
    expect(sectionPrompts.map(draftSectionOf)).toEqual(["242"]);
    expect(sectionPrompts[0]).not.toContain(BRIEF_BLOCK_MARKER);
    expect(sectionPrompts[0]).not.toContain(BYTE_HEAVY_ENTRY_TEXT);
    expect((await sectionRowsOf(t, generationId)).map((row) => row.status)).toEqual([
      "awaiting_review",
      "pending",
      "pending",
    ]);

    // renderBriefForGeneration via pipeline.ts:957-961 for the ghost one-shot.
    const [ghostJob] = await pending(t, [CANDIDATE_JOB]);
    network.create.mockClear();
    await runJob(t, ghostJob);
    const ghostPrompts = firstDraftPrompts();
    expect(ghostPrompts.map(draftSectionOf).sort()).toEqual(["242", "244", "246"]);
    for (const prompt of ghostPrompts) {
      expect(prompt).not.toContain(BRIEF_BLOCK_MARKER);
      expect(prompt).not.toContain(BYTE_HEAVY_ENTRY_TEXT);
    }
    const ghostRun = (await t.run((ctx) => ctx.db.query("generationCandidateRuns").collect())).find(
      (run) => run.ghost
    );
    expect(ghostRun?.status).toBe("succeeded");
  });
});

describe("stopOrderedGeneration in compare", () => {
  it("candidates stop independently and the generation takes the selected candidate's stop", async () => {
    const t = convexTest(schema, modules);
    const { generationId, asWriter } = await fixture(t, { mode: "compare" });
    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);
    for (const job of await pending(t, [SECTION_JOB])) await runJob(t, job);
    // One candidate also drafts 244 before the writer stops.
    const [ahead] = await pending(t, [SECTION_JOB]);
    const aheadRunId = (ahead.args[0] as { candidateRunId: Id<"generationCandidateRuns"> }).candidateRunId;
    await runJob(t, ahead);
    await asWriter.mutation(api.generations.stopOrderedGeneration, { generationId });
    await drainChain(t);

    let generation = await generationOf(t, generationId);
    expect(generation.status).toBe("awaiting_selection");
    expect(generation.stoppedAfterSection).toBeUndefined();
    const runs = await t.run((ctx) =>
      ctx.db.query("generationCandidateRuns").withIndex("by_generationId", (q) => q.eq("generationId", generationId)).collect()
    );
    const candidates = await t.run((ctx) => ctx.db.query("reportCandidates").collect());
    const stopOf = (runId: Id<"generationCandidateRuns">) => {
      const run = runs.find((row) => row._id === runId);
      const candidate = candidates.find((row) => row._id === run?.candidateId);
      return JSON.parse(candidate?.agentOutputs ?? "{}").stoppedAfterSection;
    };
    const behind = runs.find((run) => run._id !== aheadRunId);
    if (!behind?.candidateId) throw new Error("the behind candidate did not complete");
    expect(stopOf(aheadRunId)).toBe("244");
    expect(stopOf(behind._id)).toBe("242");

    await asWriter.mutation(api.generations.selectReportCandidate, {
      generationId,
      candidateId: behind.candidateId,
    });
    generation = await generationOf(t, generationId);
    expect(generation.status).toBe("completed");
    expect(generation.stoppedAfterSection).toBe("242");
  });
});
