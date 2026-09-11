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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FunctionArgs } from "convex/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";
import type { GenerationMessageParams } from "./openrouterCore";
import { SECTION_242_REQUEST } from "./section242Agent";
import { SECTION_244_REQUEST } from "./section244Agent";
import { SECTION_246_REQUEST } from "./section246Agent";
import { ORDERED_PROMPT_SCAFFOLDS } from "./promptDefinitions";

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
  contentHash: string
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
      candidateMode: "single" as const,
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

describe("Generation Brief reaches the drafting pipeline (story 1 wiring)", () => {
  it("renders the derived Brief into every section-agent prompt", async () => {
    const t = convexTest(schema, modules);
    const { userId, projectId } = await makeProject(t);
    const generationId = await makeGeneration(t, projectId, userId, TRANSCRIPT_TEXT, "wiring-hash");

    await t.action(internal.ai.pipeline.generateReport, { generationId });
    await runCandidates(t);

    const generation = await t.run((ctx) => ctx.db.get(generationId));
    expect(generation).toMatchObject({ status: "completed" });
    expect(generation?.briefId).toBeDefined();

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
    network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
      const name = params.tool_choice?.name;
      if (name === "submit_generation_brief") {
        // Invalid enum value fails `briefOutputSchema` on both the initial
        // attempt and the repair attempt, so `generateStructured` exhausts
        // the two-attempt-repair policy and throws.
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
  });
});
