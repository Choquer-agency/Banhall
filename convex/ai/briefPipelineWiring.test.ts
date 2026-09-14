/// <reference types="vite/client" />

// Story 1 (CAP-1/2/4): proves the Generation Brief actually reaches the
// drafting pipeline, and that a failed derivation never fails the generation.
//
// `brief.test.ts` only ever drives `internal.ai.pipeline.generateReport` and
// stops — it never runs the scheduled `generateCandidate` action, so nothing
// there ever inspects a section-agent prompt. This file is the missing
// end-to-end check: it runs `generateCandidate` to completion (the same way
// `pipeline.compare.test.ts` does) and asserts the rendered Brief block is
// actually present in what the model receives.
//
// A separate file, not an addition to `brief.test.ts`: `generateReport`
// schedules `generateCandidate` with `ctx.scheduler.runAfter(0, ...)`, and
// under real timers convex-test can run that scheduled job automatically in
// the background, racing an explicit manual `runCandidates` call and
// double-drafting every section. `pipeline.compare.test.ts` avoids this with
// `vi.useFakeTimers()`; putting these tests in their own file (rather than
// adding fake timers to `brief.test.ts`, which never needed them and whose
// other tests never drive `generateCandidate`) keeps that guard scoped to
// exactly the tests that need it.

import type Anthropic from "@anthropic-ai/sdk";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getFunctionName, type FunctionArgs, type FunctionReference } from "convex/server";
import { api, internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { GenerationMessageParams } from "./openrouterCore";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import { ORDERED_PROMPT_SCAFFOLDS } from "./promptDefinitions";
import {
  BRIEF_OUTCOME_DETAIL_CHARS,
  describeBriefOutcome,
  type BriefOutcome,
} from "../lib/briefRender";
import {
  briefFailureOutcome,
  runGenerationBriefStage,
  type BriefPublishCtx,
} from "./brief";
import type { GenerationClient } from "./openrouterCore";

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

const analysisOutput = {
  company_context: "Test company",
  project_goal: "Resolve the control uncertainty",
  business_problem: "Existing control fails",
  scientific_technical_problem: "Response under load is unknown",
  technological_objective: "A repeatable control",
  work_performed: {},
  project_status: "completed",
};

const qaOutput = {
  overall_score: 88,
  section_scores: {},
  cra_compliance: {},
  hallucination_risks: [],
  ai_language_flags: [],
  superlative_flags: [],
  gaps_requiring_client_followup: [],
  suggested_improvements: [],
};

const TRANSCRIPT_TEXT =
  "The team built a custom control loop to stabilize output. Marketing decided to redesign the logo, which is unrelated to engineering. Response time under load was not measured.";

const briefOutput = {
  storyline: "The team pursued a custom control loop to stabilize output.",
  storylineClaims: [
    {
      text: "The team pursued a custom control loop.",
      quote: "The team built a custom control loop to stabilize output.",
    },
  ],
  claimExclusions: [
    {
      text: "Logo redesign is out of scope.",
      quote: "Marketing decided to redesign the logo",
      reason: "business_risk",
    },
  ],
  confidenceMap: [
    {
      text: "Response time under load is unresolved.",
      quote: "Response time under load was not measured.",
      confidence: "unresolved",
    },
  ],
  glossaryTerms: [{ term: "control loop" }],
};

function mockNetworkThroughQa() {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    const input =
      name === "submit_transcript_analysis"
        ? analysisOutput
        : name === "submit_generation_brief"
          ? briefOutput
          : name === "submit_qa_scorecard"
            ? qaOutput
            : { entries: [] };
    return {
      content: name
        ? [{ type: "tool_use", id: "tool-1", name, input }]
        : [{ type: "text", text: TRANSCRIPT_TEXT }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("VOYAGE_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network disabled in test");
    })
  );
  mockNetworkThroughQa();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function makeProject(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "brief-wiring-writer", role: "admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Control experiment",
      clientName: "Client",
      status: "draft",
      createdBy: userId,
      shareToken: `brief-wiring-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    return { userId, projectId };
  });
}

async function makeGeneration(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  userId: Id<"users">,
  content: string,
  contentHash: string,
  options: { mode?: "single" | "iterative"; frozenSource?: boolean } = {}
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content, createdAt: now });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      requestedAt: now,
      requestedBy: userId,
      startedAt: now,
      candidateMode: options.mode ?? "single",
      singleModelId: "claude-opus-4-8",
      previousProjectStatus: "draft",
      learningDigestIds: [],
    });
    await ctx.db.patch(projectId, { status: "generating", activeGenerationId: generationId });
    if (options.frozenSource === false) return generationId;
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Interview transcript",
      content,
      contentHash,
      truncated: false,
      originalLength: content.length,
      capturedAt: now,
    });
    return generationId;
  });
}

async function candidateJobs(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name === "ai/pipeline:generateCandidate"
    )
  );
}

// Use the exact persisted scheduler payload (mirrors pipeline.compare.test.ts).
async function runCandidates(t: ReturnType<typeof convexTest>) {
  for (const job of await candidateJobs(t)) {
    const args = job.args[0] as FunctionArgs<typeof internal.ai.pipeline.generateCandidate>;
    await t.action(internal.ai.pipeline.generateCandidate, args);
  }
  await drainOrderedChains(t);
}

// Story 2 (AD-24): single/compare candidates run the ordered chain — one
// scheduled action per section, then finalize. Run exactly those persisted
// payloads (cancel first so a fake-timer flush can never run one twice).
const ORDERED_SECTION_JOB = "ai/orderedGeneration:generateOrderedSection";
const ORDERED_FINALIZE_JOB = "ai/orderedGeneration:finalizeOrderedCandidate";
async function drainOrderedChains(t: ReturnType<typeof convexTest>) {
  for (let round = 0; round < 50; round += 1) {
    const jobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) =>
          (job.name === ORDERED_SECTION_JOB || job.name === ORDERED_FINALIZE_JOB) &&
          job.state.kind === "pending"
      )
    );
    if (jobs.length === 0) return;
    for (const job of jobs) {
      await t.run((ctx) => ctx.scheduler.cancel(job._id));
      if (job.name === ORDERED_SECTION_JOB) {
        await t.action(
          internal.ai.orderedGeneration.generateOrderedSection,
          job.args[0] as FunctionArgs<typeof internal.ai.orderedGeneration.generateOrderedSection>
        );
      } else {
        await t.action(
          internal.ai.orderedGeneration.finalizeOrderedCandidate,
          job.args[0] as FunctionArgs<typeof internal.ai.orderedGeneration.finalizeOrderedCandidate>
        );
      }
    }
  }
  throw new Error("The ordered section chain did not drain");
}

function userText(params: Anthropic.MessageCreateParamsNonStreaming): string {
  return params.messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((block) => (block.type === "text" ? block.text : "")).join("")
    )
    .join("\n");
}

const sectionRequests = [SECTION_242_REQUEST, SECTION_244_REQUEST, SECTION_246_REQUEST];

// Spelled out, not imported: the writer-facing copy is the contract.
const BRIEF_FAILED_LINE = "Generation Brief derivation failed — drafting without a Brief.";
const WRITER_AUTH_ID = "brief-wiring-writer";

function briefCalls() {
  return network.create.mock.calls.filter(
    ([params]) => params.tool_choice?.name === "submit_generation_brief"
  );
}

/** The Brief tool output fails `briefOutputSchema` (invalid enum value) on
 * both the initial attempt and the repair attempt, so `generateStructured`
 * exhausts the two-attempt-repair policy and throws. Everything else answers
 * as `mockNetworkThroughQa` does. */
function mockBriefFailure() {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name;
    if (name === "submit_generation_brief") {
      return {
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name,
            input: {
              storyline: "x",
              storylineClaims: [],
              claimExclusions: [{ text: "x", quote: "x", reason: "not_a_real_reason" }],
              confidenceMap: [],
              glossaryTerms: [],
            },
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    }
    const input =
      name === "submit_transcript_analysis"
        ? analysisOutput
        : name === "submit_qa_scorecard"
          ? qaOutput
          : { entries: [] };
    return {
      content: name
        ? [{ type: "tool_use", id: "tool-1", name, input }]
        : [{ type: "text", text: TRANSCRIPT_TEXT }],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
  });
}

/** The generation row carries exactly `outcome`, and `progressLog` carries
 * that outcome's authored line exactly once. Returns the row. */
async function expectRecordedBriefOutcome(
  t: ReturnType<typeof convexTest>,
  generationId: Id<"generations">,
  outcome: BriefOutcome
) {
  const generation = await t.run((ctx) => ctx.db.get(generationId));
  expect(generation?.briefOutcome).toEqual(outcome);
  const line = describeBriefOutcome(outcome);
  const progressLog: string[] = generation?.progressLog ?? [];
  expect(progressLog.filter((entry) => entry === line)).toHaveLength(1);
  return generation!;
}

const FAILED_OUTCOME = {
  kind: "failed",
  code: "unknown",
  detail: expect.stringContaining("submit_generation_brief"),
} as unknown as BriefOutcome;

describe("Generation Brief reaches the drafting pipeline (story 1 wiring)", () => {
  it("renders the derived Brief into every section-agent prompt", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "wiring-hash");

    await t.action(internal.ai.pipeline.generateReport, { generationId });
    // DW-109/DW-120: the derived attempt is recorded and narrated once.
    expect(briefCalls()).toHaveLength(1);
    await expectRecordedBriefOutcome(t, generationId, { kind: "derived" });
    await runCandidates(t);

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({ status: "completed" });
    expect(generation?.briefId).toBeDefined();
    // Later stages never re-record or re-narrate the outcome.
    expect(generation?.briefOutcome).toEqual({ kind: "derived" });
    expect(
      generation?.progressLog?.filter((line) => line === describeBriefOutcome({ kind: "derived" }))
    ).toHaveLength(1);

    for (const section of sectionRequests) {
      // The fixture transcript contains the Brief's Claim Exclusion, so each
      // section's deterministic Self-check triggers its one repair (this
      // mock's model Self-check call has no submit_self_check branch and
      // fails, contributing no verdicts of its own); count first drafts only.
      const drafts = network.create.mock.calls.filter(
        ([params]) =>
          userText(params).startsWith(section.userPrefix) &&
          !userText(params).includes(ORDERED_PROMPT_SCAFFOLDS.repairGuidance.prefix)
      );
      expect(drafts).toHaveLength(1);
      const prompt = userText(drafts[0][0]);
      expect(prompt).toContain("--- BEGIN [GENERATION BRIEF] ---");
      expect(prompt).toContain(briefOutput.storyline);
    }
  });

  it("never fails the generation when Brief derivation fails — completes with no Brief and no rendered block", async () => {
    mockBriefFailure();

    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "brief-failure-hash");

    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({ status: "completed" });
    expect(generation?.briefId).toBeUndefined();

    const drafts = network.create.mock.calls.filter(([params]) =>
      userText(params).startsWith(SECTION_242_REQUEST.userPrefix)
    );
    expect(drafts).toHaveLength(1);
    expect(userText(drafts[0][0])).not.toContain("--- BEGIN [GENERATION BRIEF] ---");

    // No Brief row was ever persisted for this generation.
    expect(await t.run((ctx) => ctx.db.query("generationBriefs").collect())).toHaveLength(0);

    // DW-109: the failed attempt is recorded on the row for ops, with the
    // provider code and the raw (bounded) error text naming the failed call.
    expect(generation?.briefOutcome).toEqual({
      kind: "failed",
      code: "unknown",
      detail: expect.stringContaining("submit_generation_brief"),
    });
    const detail = (generation?.briefOutcome as { detail: string }).detail;
    // DW-120: the writer sees one authored line, verbatim, and never the raw
    // error text, through the writer-facing progress surface.
    expect(generation?.progressLog?.filter((line) => line === BRIEF_FAILED_LINE)).toHaveLength(1);
    const latest = await t
      .withIdentity({ subject: WRITER_AUTH_ID })
      .query(api.generations.getLatestGeneration, { projectId });
    expect(latest?.progressLog).toContain(BRIEF_FAILED_LINE);
    expect(latest?.progressLog?.some((line) => line.includes(detail))).toBe(false);
    expect(latest).not.toHaveProperty("briefOutcome");
    expect(generation?.progressLog?.some((line) => line.includes(detail))).toBe(false);
  });
});

describe("Generation Brief attempt outcomes (DW-109/DW-120)", () => {
  it("reused: identical frozen inputs stamp the same Brief with no second call, record { kind: reused } and narrate it once", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const firstGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "reuse-outcome-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: firstGenerationId });
    const first = await expectRecordedBriefOutcome(t, firstGenerationId, { kind: "derived" });

    await t.run((ctx) => ctx.db.patch(projectId, { status: "review", activeGenerationId: undefined }));
    const secondGenerationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "reuse-outcome-hash");
    await t.action(internal.ai.pipeline.generateReport, { generationId: secondGenerationId });

    expect(briefCalls()).toHaveLength(1);
    const second = await expectRecordedBriefOutcome(t, secondGenerationId, { kind: "reused" });
    expect(second.briefId).toBe(first.briefId);
    expect(second.progressLog).not.toContain(describeBriefOutcome({ kind: "derived" }));
  });

  it("no evidence: zero frozen sources make no Brief call, stamp no Brief, record { kind: no_evidence } and narrate it once", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "unused-hash", {
      frozenSource: false,
    });

    await t.action(internal.ai.pipeline.generateReport, { generationId });

    expect(briefCalls()).toHaveLength(0);
    const generation = await expectRecordedBriefOutcome(t, generationId, { kind: "no_evidence" });
    expect(generation.briefId).toBeUndefined();
  });

  it("iterative: a failed derivation records the same failed outcome, still schedules s242, and narrates verbatim through getIterativeState", async () => {
    mockBriefFailure();
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "iterative-failure-hash", {
      mode: "iterative",
    });

    await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });

    const generation = await expectRecordedBriefOutcome(t, generationId, FAILED_OUTCOME);
    expect(generation.status).not.toBe("failed");
    expect(generation.briefId).toBeUndefined();
    const sectionJobs = await t.run(async (ctx) =>
      (await ctx.db.system.query("_scheduled_functions").collect()).filter(
        (job) => job.name === "ai/iterative:generateSection" && job.state.kind === "pending"
      )
    );
    expect(sectionJobs.map((job) => job.args)).toEqual([[{ generationId, section: "s242" }]]);

    const detail = (generation.briefOutcome as { detail: string }).detail;
    const state = await t
      .withIdentity({ subject: WRITER_AUTH_ID })
      .query(api.generations.getIterativeState, { generationId });
    expect(state?.progressLog).toContain(BRIEF_FAILED_LINE);
    expect(state?.progressLog?.some((line) => line.includes(detail))).toBe(false);
    expect(state).not.toHaveProperty("briefOutcome");
  });
});

describe("recordBriefOutcome mutation boundary (DW-109/DW-120)", () => {
  it("returns null without recreating a missing generation", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(
      t,
      projectId,
      userId,
      TRANSCRIPT_TEXT,
      "missing-generation-outcome-hash"
    );
    await t.run((ctx) => ctx.db.delete(generationId));

    await expect(
      t.mutation(internal.generations.recordBriefOutcome, {
        generationId,
        outcome: { kind: "failed", code: "unknown", detail: "generation disappeared" },
      })
    ).resolves.toBeNull();

    expect(await t.run((ctx) => ctx.db.get(generationId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("generations").collect())).toHaveLength(0);
  });
});

describe("runGenerationBriefStage never throws (DW-109)", () => {
  const generationId = "generation-under-test" as Id<"generations">;
  const projectId = "project-under-test" as Id<"projects">;
  // Never reached: every case below ends before the model call.
  const client = {} as GenerationClient;
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errors.mockRestore();
  });

  /** A ctx whose first read fails with `readError` (or returns no sources),
   * recording each mutation call and optionally rejecting it. */
  function fakeCtx(options: { readError?: unknown; recordError?: unknown }) {
    const recorded: Array<{ name: string; args: unknown }> = [];
    const ctx = {
      runQuery: async () => {
        if ("readError" in options) throw options.readError;
        return [];
      },
      runMutation: async (reference: FunctionReference<"mutation", "internal">, args: unknown) => {
        recorded.push({ name: getFunctionName(reference), args });
        if ("recordError" in options) throw options.recordError;
        return null;
      },
    } as unknown as BriefPublishCtx;
    return { ctx, recorded };
  }

  it("bounds a 1,000-character stage error to BRIEF_OUTCOME_DETAIL_CHARS and still logs the original error", async () => {
    const readError = new Error("x".repeat(1_000));
    const { ctx, recorded } = fakeCtx({ readError });

    await runGenerationBriefStage(ctx, client, { projectId, generationId });

    expect(BRIEF_OUTCOME_DETAIL_CHARS).toBe(300);
    expect(recorded).toEqual([
      {
        name: "generations:recordBriefOutcome",
        args: {
          generationId,
          outcome: { kind: "failed", code: "unknown", detail: "x".repeat(BRIEF_OUTCOME_DETAIL_CHARS) },
        },
      },
    ]);
    expect(errors).toHaveBeenCalledWith(
      "Generation Brief derivation failed; continuing without a Brief",
      generationId,
      readError
    );
  });

  it("resolves when recording the outcome rejects, logging that failure", async () => {
    const readError = new Error("derivation broke");
    const recordError = new Error("record rejected");
    const { ctx, recorded } = fakeCtx({ readError, recordError });

    await expect(runGenerationBriefStage(ctx, client, { projectId, generationId })).resolves.toBeUndefined();

    expect(recorded.map((call) => call.name)).toEqual(["generations:recordBriefOutcome"]);
    expect(errors).toHaveBeenCalledWith(
      "Generation Brief outcome not recorded",
      generationId,
      "failed",
      recordError
    );
  });

  it("resolves and records an unknown failure when the thrown value defeats stringification and provider normalization", async () => {
    const readError = new Proxy(Object.create(null), {
      get() {
        throw new Error("property access rejected");
      },
      has() {
        throw new Error("property lookup rejected");
      },
    });
    const { ctx, recorded } = fakeCtx({ readError });

    await expect(
      runGenerationBriefStage(ctx, client, { projectId, generationId })
    ).resolves.toBeUndefined();

    expect(recorded).toEqual([
      {
        name: "generations:recordBriefOutcome",
        args: {
          generationId,
          outcome: {
            kind: "failed",
            code: "unknown",
            detail: expect.any(String),
          },
        },
      },
    ]);
    const call = recorded[0];
    expect(call).toBeDefined();
    if (!call || typeof call.args !== "object" || call.args === null || !("outcome" in call.args)) {
      throw new Error("Expected the Brief outcome recording call");
    }
    const outcome = call.args.outcome;
    expect(outcome).toMatchObject({ kind: "failed", code: "unknown" });
    if (
      typeof outcome !== "object" ||
      outcome === null ||
      !("detail" in outcome) ||
      typeof outcome.detail !== "string"
    ) {
      throw new Error("Expected a string failure detail");
    }
    expect(outcome.detail.length).toBeGreaterThan(0);
    expect(outcome.detail.length).toBeLessThanOrEqual(BRIEF_OUTCOME_DETAIL_CHARS);
  });

  it("resolves when both derivation and recording error logging throw", async () => {
    const readError = new Error("derivation broke");
    const recordError = new Error("record rejected");
    const { ctx, recorded } = fakeCtx({ readError, recordError });
    errors.mockImplementation(() => {
      throw new Error("logger rejected");
    });

    await expect(
      runGenerationBriefStage(ctx, client, { projectId, generationId })
    ).resolves.toBeUndefined();

    expect(recorded.map((call) => call.name)).toEqual([
      "generations:recordBriefOutcome",
    ]);
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("classifies with the provider code, keeps non-Error text, and never cuts a surrogate pair in half", () => {
    const rateLimited = Object.assign(new Error("Too many requests"), { status: 429 });
    expect(briefFailureOutcome(rateLimited)).toEqual({
      kind: "failed",
      code: "rate_limited",
      detail: "Too many requests",
    });
    expect(briefFailureOutcome("plain failure")).toEqual({
      kind: "failed",
      code: "unknown",
      detail: "plain failure",
    });
    const straddling = `${"a".repeat(BRIEF_OUTCOME_DETAIL_CHARS - 1)}\u{1F600}tail`;
    const outcome = briefFailureOutcome(new Error(straddling));
    expect(outcome.detail).toBe("a".repeat(BRIEF_OUTCOME_DETAIL_CHARS - 1));
    expect(briefFailureOutcome("left\uD800right\uDC00").detail).toBe(
      "left\uFFFDright\uFFFD"
    );
  });
});
