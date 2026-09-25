/// <reference types="vite/client" />
/**
 * The action deadline inside a real generation action (2026-09-25, cutoff
 * review P2-2): prepareSeedDraftingInputs runs the retrieval brief and the
 * transcript analysis one after another. When the analysis comes back cut
 * off late in the action, its repair would run past the Convex action limit.
 * The repair is not sent; the action fails fast through its own failure
 * handling (the drafting context is marked failed, for the writer to retry)
 * instead of being killed with the row left "preparing".
 */
import { convexTest } from "convex-test";
import { afterEach, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { GenerationMessageParams } from "./ai/openrouterCore";
import { ACTION_REQUEST_WINDOW_MS, CONVEX_ACTION_LIMIT_MS } from "./ai/actionDeadline";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));

const modules = import.meta.glob("./**/*.ts");

const TRANSCRIPT =
  "Interviewer: What was uncertain?\nClient: The team tested a control loop and could not predict how it would respond at peak load.";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function seedGeneration() {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const t = convexTest(schema, modules);
  const generationId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "deadline-writer", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Deadline",
      clientName: "Client",
      status: "generating",
      ownerId: userId,
      createdBy: userId,
      shareToken: "deadline-start",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", { projectId, content: TRANSCRIPT, createdAt: 1 });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      requestedAt: 1,
      requestedBy: userId,
      startedAt: 1,
      previousProjectStatus: "draft",
      singleModelId: "claude-sonnet-5",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Frozen transcript",
      content: TRANSCRIPT,
      contentHash: "deadline-source-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    return generationId;
  });
  return { t, generationId };
}

function toolResponse(name: string, input: unknown, stopReason = "tool_use") {
  return {
    id: `response-${name}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "tool_use", id: `tool-${name}`, name, input }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

it("a cut-off analysis late in prepareSeedDraftingInputs fails fast instead of overrunning the action", async () => {
  const start = Date.parse("2026-09-25T12:00:00Z");
  vi.useFakeTimers({ now: start, toFake: ["Date"] });
  const { t, generationId } = await seedGeneration();
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name ?? "text";
    if (name === "submit_generation_brief") {
      return toolResponse(name, { storyline: "A stable operating range.", storylineClaims: [], claimExclusions: [], confidenceMap: [], glossaryTerms: [] });
    }
    if (name === "submit_retrieval_brief") {
      return toolResponse(name, { problem: "p", uncertainty: "u", work: "w", advancement: "a" });
    }
    if (name === "submit_transcript_analysis") {
      // A long analysis, cut off at max_tokens, 530 s into the action.
      vi.setSystemTime(Date.now() + 530_000);
      return toolResponse(name, { company_context: "Test company" }, "max_tokens");
    }
    throw new Error(`Unexpected provider call ${name}`);
  });

  // Startup schedules the background step, which the scheduler runs here.
  await t.action(internal.ai.iterative.startIterativeGeneration, { generationId });
  await t.finishInProgressScheduledFunctions();
  const actionEnd = Date.now();

  const calls = network.create.mock.calls as Array<[GenerationMessageParams, { timeout?: number; maxRetries?: number }?]>;
  const analyses = calls.filter(([params]) => params.tool_choice?.name === "submit_transcript_analysis");
  // One analysis request; its repair was never sent.
  expect(analyses).toHaveLength(1);
  // The first request ran with the full timeout: time was plentiful then.
  // The SDK is sent no retry of its own; the wrapper decides each retry
  // against the time left when a failure happens (review 2026-09-25, P2-2).
  expect(analyses[0][1]).toEqual({ timeout: 240_000, maxRetries: 0 });
  // The action finished inside the request window, not at the Convex limit:
  // the only time that passed is the 530 s the cut analysis took.
  expect(actionEnd - start).toBe(530_000);
  expect(actionEnd - start).toBeLessThanOrEqual(ACTION_REQUEST_WINDOW_MS);
  expect(actionEnd - start).toBeLessThan(CONVEX_ACTION_LIMIT_MS);
  // The existing failure handling ran: the writer can retry the drafting context.
  const generation = await t.run((ctx) => ctx.db.get(generationId));
  expect(generation?.draftingInputs).toMatchObject({ status: "failed", attempt: 1 });
});
