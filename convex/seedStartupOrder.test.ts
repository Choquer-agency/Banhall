/// <reference types="vite/client" />
/**
 * The reordered Step-by-step start (owner decision 32, 2026-09-25).
 *
 * The Brief runs beside the writer style as soon as the sources are frozen;
 * the seed stage opens as soon as the Brief exists; the transcript analysis
 * and Brain retrieval run as a separate background action and must be
 * complete before sign-off (convex/generationSeedSignoff.test.ts covers the
 * sign-off side). Every provider request is byte-for-byte what it was before
 * the reorder.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { GenerationMessageParams } from "./ai/openrouterCore";
import {
  prepareSeedDraftingInputsRef,
  runSeedDraftingInputs,
} from "./seedStartup.fixture";
import { DRAFTING_INPUTS_LEASE_MS } from "./lib/generations/draftingInputs";
import { decisionFixture } from "./seedDecision.fixture";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: network.create };
  },
}));

const modules = import.meta.glob("./**/*.ts");

const generateBatchRef = makeFunctionReference<
  "action",
  { batchId: Id<"seedBatches"> },
  unknown
>("ai/seeds:generateBatch");

const TRANSCRIPT =
  "Interviewer: What was uncertain?\nClient: The team tested a control loop and could not predict how it would respond at peak load. " +
  "They ran three load-band experiments and established a stable operating range.";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

async function startupFixture(workflow: "seeds" | "sections" = "seeds") {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  // No real network: every provider call goes through the mocked SDK.
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "startup-writer", role: "writer" });
    const outsiderId = await ctx.db.insert("users", { authId: "startup-outsider", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Reordered start",
      clientName: "Client",
      status: "generating",
      ownerId: userId,
      createdBy: userId,
      shareToken: "reordered-start",
      createdAt: 1,
      updatedAt: 1,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: TRANSCRIPT,
      createdAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      transcriptIds: [transcriptId],
      status: "reserved",
      candidateMode: "iterative",
      gatedWorkflow: workflow,
      requestedAt: 1,
      requestedBy: userId,
      startedAt: 1,
      previousProjectStatus: "draft",
      singleModelId: "claude-sonnet-5",
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const sourceId = await ctx.db.insert("generationSources", {
      projectId,
      generationId,
      kind: "transcript",
      transcriptId,
      label: "Frozen transcript",
      content: TRANSCRIPT,
      contentHash: "startup-source-hash",
      truncated: false,
      originalLength: TRANSCRIPT.length,
      capturedAt: 1,
    });
    await ctx.db.insert("writerProfiles", {
      userId,
      customInstructions: "Use a concise technical narrative.",
      enabled: true,
      buildOrder: ["242", "244", "246"],
      updatedBy: userId,
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, outsiderId, projectId, generationId, sourceId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "startup-writer" }),
    outsider: t.withIdentity({ subject: "startup-outsider" }),
  };
}

type Fixture = Awaited<ReturnType<typeof startupFixture>>;

const ANALYSIS = {
  company_context: "Test company",
  project_goal: "Stabilize the control loop",
  business_problem: "Output was unstable",
  scientific_technical_problem: "The response at peak load was unknown",
  technological_objective: "A stable control response",
  work_performed: {},
  project_status: "completed",
};

const BRIEF = {
  storyline: "The team tested a control loop and established a stable operating range.",
  storylineClaims: [],
  claimExclusions: [],
  confidenceMap: [],
  glossaryTerms: [{ term: "control loop" }],
};

const RETRIEVAL = {
  problem: "Unstable control loop output at peak load in an industrial controller.",
  uncertainty: "Whether the controller response at peak load could be predicted.",
  work: "Three load-band experiments on the control loop.",
  advancement: "A stable operating range for the control loop.",
};

const SEEDS = {
  seeds: [
    { bullets: ["The team could not predict the control loop response at peak load."], tags: ["technical"], provenance: [] },
    { bullets: ["Three load-band experiments established a stable operating range."], tags: ["detailed"], provenance: [] },
    { bullets: ["The operating range was new to the company."], tags: ["conservative"], provenance: [] },
  ],
};

function toolResponse(name: string, input: unknown) {
  return {
    id: `response-${name}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-5",
    content: [{ type: "tool_use", id: `tool-${name}`, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  };
}

type ProviderOptions = {
  /** Stages whose answer waits on a promise (controlled ordering). */
  holds?: Partial<Record<string, Promise<void>>>;
  /** Stages that fail with a provider error. */
  failing?: string[];
};

/** A provider that answers every stage at once, unless told otherwise. */
function configureProvider(options: ProviderOptions = {}) {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name ?? "text";
    const hold = options.holds?.[name];
    if (hold) await hold;
    if (options.failing?.includes(name)) throw new Error("Private provider failure text");
    if (name === "submit_transcript_analysis") return toolResponse(name, ANALYSIS);
    if (name === "submit_generation_brief") return toolResponse(name, BRIEF);
    if (name === "submit_retrieval_brief") return toolResponse(name, RETRIEVAL);
    if (name === "submit_seed_batch") return toolResponse(name, SEEDS);
    if (name === "text") {
      return {
        ...toolResponse(name, null),
        content: [{ type: "text", text: "Drafted section text." }],
        stop_reason: "end_turn",
      };
    }
    throw new Error(`Unexpected provider call ${name}`);
  });
}

function calledTools(): string[] {
  return (network.create.mock.calls as Array<[GenerationMessageParams]>).map(
    ([params]) => params.tool_choice?.name ?? "text"
  );
}

/** Convex test ids ("0000000000010028generationBriefs") depend on insertion
 * order across all tables, which the reorder changes; the request bodies are
 * compared with ids masked, so only their content counts. */
function maskIds(text: string): string {
  return text.replace(/\b\d{7,}[A-Za-z]+\b/g, "<id>");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The first request body of each stage, hashed. `maxTokens` replaces a
 * stage's `max_tokens` in place (same key position) before hashing. */
async function requestHashes(
  maxTokens: Partial<Record<string, number>> = {}
): Promise<Record<string, string>> {
  const firstByTool = new Map<string, string>();
  for (const [params] of network.create.mock.calls as Array<[GenerationMessageParams]>) {
    const name = params.tool_choice?.name ?? "text";
    if (firstByTool.has(name)) continue;
    const cap = maxTokens[name];
    const body = cap === undefined ? params : { ...params, max_tokens: cap };
    firstByTool.set(name, maskIds(JSON.stringify(body)));
  }
  const result: Record<string, string> = {};
  for (const [name, body] of [...firstByTool.entries()].sort()) {
    result[name] = await sha256Hex(body);
  }
  return result;
}

/** The output caps before the cut-off fix (fe75638c) raised them. */
const PRE_CUTOFF_CAPS = {
  submit_generation_brief: 8_192,
  submit_retrieval_brief: 1_024,
  submit_transcript_analysis: 8_192,
};

/** The hashes the reorder pinned, captured from this fixture on 9bed95c0. */
const PRE_REORDER_HASHES_9BED95C0 = {
  submit_generation_brief: "66095cb8cab5a57fd6c9f5e7ef84b89170d1b63d91aa96704c3977c018b0a9ba",
  submit_retrieval_brief: "404d7fc76b249891f6afca242c872beaad15682d7f449eff60fc2f9f16e579d3",
  submit_seed_batch: "2e71037c98d18d834150aa69c1a9903a420562310048f3ca9e5fa58181716e9a",
  submit_transcript_analysis: "3038f5a2a8ce1fb5de9788cbaba1768a273eaacd5970fe2a91b8724eeac49623",
};

async function openFirstRole(s: Fixture) {
  await s.writer.mutation(api.seeds.open, {
    generationId: s.generationId,
    roleId: "company_context",
    expectedSeedStageVersion: 0,
    commandId: "open-company-context",
  });
  const batch = await s.t.run(async (ctx) =>
    ctx.db.query("seedBatches")
      .withIndex("by_generationId_and_roleId", (q) =>
        q.eq("generationId", s.generationId).eq("roleId", "company_context"))
      .first()
  );
  if (!batch) throw new Error("Opening the first role dispatched no batch");
  // Run the batch here rather than through the scheduler, so no other
  // scheduled job runs alongside it.
  await s.t.run(async (ctx) => {
    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.name.includes("generateBatch") && job.state.kind === "pending") {
        await ctx.scheduler.cancel(job._id);
      }
    }
  });
  await s.t.action(generateBatchRef, { batchId: batch._id });
  return batch._id;
}

async function state(s: Fixture) {
  const read = await s.t.run(async (ctx) => {
    const artifacts = await ctx.db.query("generationArtifacts")
      .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", s.generationId))
      .collect();
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return {
      generation: await ctx.db.get(s.generationId),
      kinds: artifacts.map((row) => row.kind).sort(),
      contents: artifacts.map((row) => ({ kind: row.kind, content: row.content })),
      rows: (await ctx.db.query("seedSubsections")
        .withIndex("by_generationId", (q) => q.eq("generationId", s.generationId))
        .collect()).length,
      seeds: (await ctx.db.query("seeds").collect()).length,
      pendingPrepares: jobs.filter((job) =>
        job.name.includes("prepareSeedDraftingInputs") && job.state.kind === "pending").length,
      pendingExpiries: jobs.filter((job) =>
        job.name.includes("expireDraftingInputs") && job.state.kind === "pending").length,
    };
  });
  return {
    ...read,
    artifact: (kind: string) => read.contents.find((row) => row.kind === kind)?.content,
  };
}

/** Cancel the scheduled background attempt and return its arguments, so a
 * test can run it by hand at the moment it chooses. */
async function takeBackgroundAttempt(s: Fixture) {
  return await s.t.run(async (ctx) => {
    const job = (await ctx.db.system.query("_scheduled_functions").collect()).find(
      (row) => row.name.includes("prepareSeedDraftingInputs") && row.state.kind === "pending"
    );
    if (!job) throw new Error("No background attempt is scheduled");
    await ctx.scheduler.cancel(job._id);
    return job.args[0] as { generationId: Id<"generations">; attempt: number };
  });
}

async function outlineDraftingStatus(s: Fixture) {
  return (await s.writer.query(api.seeds.getOutline, { generationId: s.generationId }))
    .draftingInputs.status;
}

describe("reordered Step-by-step start (decision 32)", () => {
  it("sends each stage the same request body as before the reorder", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z"), toFake: ["Date"] });
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await runSeedDraftingInputs(s.t);
    await openFirstRole(s);
    // The stages moved, their provider requests did not. The seed batch hash
    // was captured from the same fixture on 9bed95c0, before the reorder. The
    // Brief, analysis and retrieval brief hashes were recaptured on the
    // integration branch after the cut-off fix raised their output caps
    // (16,000 / 16,000 / 2,048 tokens); the next test proves that with the
    // old caps put back they are the 9bed95c0 hashes exactly.
    expect(await requestHashes()).toEqual({
      submit_generation_brief: "768cad27ddf4db91f8237ad51714fdab8cdc5b0826a54a83cc3eba516c57434e",
      submit_retrieval_brief: "5ff41dc8effa6c1d3debffd0657f07c741a25549cd8bfe83863ea1ff0e4939a5",
      submit_seed_batch: "2e71037c98d18d834150aa69c1a9903a420562310048f3ca9e5fa58181716e9a",
      submit_transcript_analysis: "529909743af47708a90efdf4bf9fca2dcd76070b988cec16e438bc02a8195310",
    });
  });

  it("differs from the 9bed95c0 request bodies only in the raised output caps", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z"), toFake: ["Date"] });
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await runSeedDraftingInputs(s.t);
    await openFirstRole(s);
    const caps = Object.fromEntries(
      (network.create.mock.calls as Array<[GenerationMessageParams]>).map(([params]) => [
        params.tool_choice?.name ?? "text",
        params.max_tokens,
      ])
    );
    expect(caps).toMatchObject({
      submit_generation_brief: 16_000,
      submit_retrieval_brief: 2_048,
      submit_transcript_analysis: 16_000,
    });
    // The caps before the cut-off fix; every other byte is unchanged.
    expect(await requestHashes(PRE_CUTOFF_CAPS)).toEqual(PRE_REORDER_HASHES_9BED95C0);
  });

  it("opens the seed stage and serves the first Seeds before the analysis runs", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });

    // The Brief was the only model call on the way to the seed stage.
    expect(calledTools()).toEqual(["submit_generation_brief"]);
    const opened = await state(s);
    expect(opened.generation).toMatchObject({
      status: "awaiting_input",
      currentStep: "Seeds ready",
      draftingInputs: { status: "preparing", attempt: 1 },
    });
    expect(opened.generation?.briefVersionId).toBeDefined();
    expect(opened.rows).toBe(13);
    expect(opened.kinds).toEqual(["writer_style"]);
    expect(opened.pendingPrepares).toBe(1);
    expect(opened.pendingExpiries).toBe(1);
    expect(await outlineDraftingStatus(s)).toBe("preparing");

    // The first Seeds, still before any analysis or Brain retrieval.
    await openFirstRole(s);
    expect((await state(s)).seeds).toBe(3);
    expect(calledTools()).toEqual(["submit_generation_brief", "submit_seed_batch"]);
    const seedRequest = JSON.stringify(network.create.mock.calls[1][0]);
    expect(seedRequest).toContain("Use a concise technical narrative.");

    // The background step then freezes the drafting inputs.
    await runSeedDraftingInputs(s.t);
    expect(calledTools()).toEqual([
      "submit_generation_brief",
      "submit_seed_batch",
      "submit_retrieval_brief",
      "submit_transcript_analysis",
    ]);
    const done = await state(s);
    expect(done.generation).toMatchObject({
      status: "awaiting_input",
      draftingInputs: { status: "ready", attempt: 1 },
    });
    expect(done.kinds).toEqual(["analysis", "brain_blocks", "writer_style"]);
    expect(JSON.parse(done.artifact("analysis")!)).toMatchObject(ANALYSIS);
    // brain_blocks keeps its documented shape: the blocks, then the same
    // frozen style Seeds read, in the order it has always been stored.
    const brain = JSON.parse(done.artifact("brain_blocks")!) as Record<string, unknown>;
    const style = JSON.parse(done.artifact("writer_style")!) as Record<string, unknown>;
    expect(Object.keys(brain)).toEqual(["blocks", ...Object.keys(style)]);
    expect(brain).toEqual({ blocks: { analyzer: "", s242: "", s244: "", s246: "" }, ...style });
    expect(Object.keys(style)).toEqual(["styleGuidance", "orderedContext", "writerFlavor", "styleOverrides"]);
    expect(await outlineDraftingStatus(s)).toBe("ready");

    // The lease check finds nothing left to do.
    await s.t.mutation(internal.generations.expireDraftingInputs, {
      generationId: s.generationId,
      attempt: 1,
    });
    expect((await state(s)).generation?.draftingInputs?.status).toBe("ready");
  });

  it("an analysis failure leaves the seed stage open and offers a retry", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider({ failing: ["submit_transcript_analysis"] });
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await runSeedDraftingInputs(s.t);

    const failed = await state(s);
    expect(failed.generation).toMatchObject({
      status: "awaiting_input",
      draftingInputs: { status: "failed", attempt: 1 },
    });
    expect(failed.generation?.error).toBeUndefined();
    expect(JSON.stringify(failed.generation)).not.toContain("Private provider failure text");
    expect(failed.kinds).toEqual(["writer_style"]);
    expect(await outlineDraftingStatus(s)).toBe("failed");
    // The Seeds keep working while the drafting context waits for a retry.
    await openFirstRole(s);
    expect((await state(s)).seeds).toBe(3);

    // Retry needs the prose-edit capability.
    await expect(
      s.outsider.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId })
    ).rejects.toThrow();
    await expect(
      s.t.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId })
    ).rejects.toThrow();
    expect((await state(s)).pendingPrepares).toBe(0);

    configureProvider();
    await s.writer.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId });
    const retrying = await state(s);
    expect(retrying.generation?.draftingInputs).toMatchObject({ status: "preparing", attempt: 2 });
    expect(retrying.pendingPrepares).toBe(1);
    await expect(
      s.writer.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId })
    ).rejects.toThrow("not waiting for a retry");

    expect(await runSeedDraftingInputs(s.t)).toEqual([{ generationId: s.generationId, attempt: 2 }]);
    const ready = await state(s);
    expect(ready.generation?.draftingInputs).toMatchObject({ status: "ready", attempt: 2 });
    expect(ready.kinds).toEqual(["analysis", "brain_blocks", "writer_style"]);
  });

  it("an attempt that never answers is failed by its lease, and its late result is dropped", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    const attempt = await takeBackgroundAttempt(s);
    expect(attempt.attempt).toBe(1);

    // The lease check runs only after Convex's action limit has passed.
    expect(DRAFTING_INPUTS_LEASE_MS).toBeGreaterThan(10 * 60 * 1000);
    vi.advanceTimersByTime(DRAFTING_INPUTS_LEASE_MS);
    await s.t.finishInProgressScheduledFunctions();
    expect((await state(s)).generation?.draftingInputs).toMatchObject({ status: "failed", attempt: 1 });

    // The dead attempt answers late: nothing is frozen from it.
    await s.t.action(prepareSeedDraftingInputsRef, attempt);
    expect(calledTools()).toEqual(["submit_generation_brief"]);
    expect(
      await s.t.mutation(internal.generations.completeDraftingInputs, {
        ...attempt,
        analysis: JSON.stringify(ANALYSIS),
        brainBlocks: JSON.stringify({ analyzer: "", s242: "", s244: "", s246: "" }),
      })
    ).toBe("ignored");
    expect((await state(s)).kinds).toEqual(["writer_style"]);

    await s.writer.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId });
    await runSeedDraftingInputs(s.t);
    expect((await state(s)).generation?.draftingInputs).toMatchObject({ status: "ready", attempt: 2 });
  });

  it("a cancel before the background step stops it before any model call", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await s.writer.mutation(api.generations.cancelIterativeGeneration, { generationId: s.generationId });
    await runSeedDraftingInputs(s.t);
    const cancelled = await state(s);
    expect(cancelled.generation?.status).toBe("failed");
    expect(calledTools()).toEqual(["submit_generation_brief"]);
    expect(cancelled.kinds).toEqual(["writer_style"]);
    await expect(
      s.writer.mutation(api.generations.retryDraftingInputs, { generationId: s.generationId })
    ).rejects.toThrow("seed stage is closed");
    // The lease check leaves the cancelled generation alone.
    await s.t.mutation(internal.generations.expireDraftingInputs, { generationId: s.generationId, attempt: 1 });
    expect((await state(s)).generation).toMatchObject({ status: "failed", error: "Cancelled by writer" });
  });

  it("a cancel while the analysis is running drops its result", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    let release!: () => void;
    const analyzerHeld = new Promise<void>((resolve) => { release = resolve; });
    configureProvider({ holds: { submit_transcript_analysis: analyzerHeld } });
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    const attempt = await takeBackgroundAttempt(s);
    const background = s.t.action(prepareSeedDraftingInputsRef, attempt);
    await vi.waitFor(() => expect(calledTools()).toContain("submit_transcript_analysis"));

    await s.writer.mutation(api.generations.cancelIterativeGeneration, { generationId: s.generationId });
    release();
    await background;
    const cancelled = await state(s);
    expect(cancelled.generation?.status).toBe("failed");
    expect(cancelled.kinds).toEqual(["writer_style"]);
    expect(await s.t.run(async (ctx) => (await ctx.db.get(s.projectId))?.activeGenerationId ?? null)).toBeNull();
  });

  it("a seed-stage retry after a startup that died before scheduling the background step schedules it", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    // Rewind to the moment after the style was frozen and before the
    // background step was scheduled, with the Brief failed.
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
      for (const row of await ctx.db.query("seedSubsections")
        .withIndex("by_generationId", (q) => q.eq("generationId", s.generationId)).collect()) {
        await ctx.db.delete(row._id);
      }
      await ctx.db.replace(s.generationId, {
        ...(await ctx.db.get(s.generationId))!,
        status: "running",
        draftingInputs: undefined,
        seedStageError: "Seed preparation did not complete. Retry initialization.",
      });
    });
    await s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId });
    await s.t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.name.includes("resumeSeedInitialization") && job.state.kind === "pending") {
          await ctx.scheduler.cancel(job._id);
        }
      }
    });
    await s.t.action(internal.ai.iterative.resumeSeedInitialization, { generationId: s.generationId });
    const reopened = await state(s);
    expect(reopened.generation?.status).toBe("awaiting_input");
    expect(reopened.generation?.draftingInputs).toMatchObject({ status: "preparing", attempt: 1 });
    expect(reopened.pendingPrepares).toBe(1);
    await runSeedDraftingInputs(s.t);
    expect((await state(s)).generation?.draftingInputs?.status).toBe("ready");
  });

  it("the seed stage opens once and the background step is scheduled once", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    // A redelivered startup does nothing: the reservation was claimed.
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId });
    expect(await s.t.mutation(internal.generations.startDraftingInputs, { generationId: s.generationId }))
      .toBe("preparing");
    const once = await state(s);
    expect(once.rows).toBe(13);
    expect(once.pendingPrepares).toBe(1);
    expect(calledTools()).toEqual(["submit_generation_brief"]);
    const events = await s.t.run(async (ctx) =>
      (await ctx.db.query("seedDecisionEvents").collect()).filter((row) => row.kind === "initialized"));
    expect(events).toHaveLength(1);
  });
});

describe("generations started before the reorder", () => {
  /** A seed generation frozen the old way: analysis and brain_blocks (with
   * the style inside) before its seed stage opened, no writer_style, no
   * drafting-inputs sub-state. */
  async function legacyGeneration(s: Fixture) {
    await s.t.run(async (ctx) => {
      await ctx.db.patch(s.generationId, {
        status: "running",
        writerSettings: {
          profileState: "applied", source: "profile", matchesProfile: true,
          savedProfileSuperseded: false, waiverAnalysis: "profile", truncated: false,
        },
      });
    });
    // What the pre-reorder action saved, through the unchanged mutation.
    await s.t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId: s.generationId,
      analysis: JSON.stringify(ANALYSIS),
      brainBlocks: JSON.stringify({
        blocks: { analyzer: "", s242: "", s244: "", s246: "" },
        styleGuidance: "Legacy style guidance from brain blocks.",
        orderedContext: { profileState: "applied", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
        styleOverrides: {},
      }),
    });
  }

  it("a generation mid-startup at deploy opens its seed stage and reads its style from brain_blocks", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    configureProvider();
    await legacyGeneration(s);
    // The rest of the pre-reorder startup: the Brief, then initialization.
    await s.t.action(internal.ai.iterative.resumeSeedInitialization, { generationId: s.generationId });
    const opened = await state(s);
    expect(opened.generation?.status).toBe("awaiting_input");
    // Both inputs were frozen the old way: ready at once, nothing scheduled.
    expect(opened.generation?.draftingInputs).toMatchObject({ status: "ready", attempt: 0 });
    expect(opened.kinds).toEqual(["analysis", "brain_blocks"]);
    expect(opened.pendingPrepares).toBe(0);
    expect(await outlineDraftingStatus(s)).toBe("ready");

    await openFirstRole(s);
    expect((await state(s)).seeds).toBe(3);
    const seedRequest = JSON.stringify(
      (network.create.mock.calls as Array<[GenerationMessageParams]>)
        .find(([params]) => params.tool_choice?.name === "submit_seed_batch")![0]
    );
    expect(seedRequest).toContain("Legacy style guidance from brain blocks.");
  });

  it("a seed stage opened before the deploy has no drafting-inputs state and reads as ready", async () => {
    // The shared seed-stage fixture is exactly that: both inputs frozen the
    // old way, thirteen rows, no drafting-inputs state.
    const legacy = await decisionFixture();
    const generation = await legacy.t.run(async (ctx) => await ctx.db.get(legacy.generationId));
    expect(generation?.draftingInputs).toBeUndefined();
    const outline = await legacy.writer.query(api.seeds.getOutline, { generationId: legacy.generationId });
    expect(outline.draftingInputs.status).toBe("ready");
  });

  it("starting the background step for a generation that froze both inputs marks it ready at once", async () => {
    vi.useFakeTimers();
    const s = await startupFixture();
    await legacyGeneration(s);
    expect(await s.t.mutation(internal.generations.startDraftingInputs, { generationId: s.generationId }))
      .toBe("ready");
    const ready = await state(s);
    expect(ready.generation?.draftingInputs?.status).toBe("ready");
    expect(ready.pendingPrepares).toBe(0);
    expect(ready.pendingExpiries).toBe(0);
  });
});

describe("section approval is unchanged by the reorder", () => {
  it("sends the same requests and freezes the same artifacts as before", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-25T12:00:00Z") });
    const s = await startupFixture("sections");
    configureProvider();
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    await s.t.action(internal.ai.iterative.generateSection, { generationId: s.generationId, section: "s242" });
    const artifacts = await s.t.run(async (ctx) =>
      (await ctx.db.query("generationArtifacts")
        .withIndex("by_generationId_and_kind", (q) => q.eq("generationId", s.generationId))
        .collect()).map((row) => `${row.kind}:${row.content}`).sort());
    expect(artifacts.map((row) => row.split(":")[0])).toEqual(["analysis", "brain_blocks"]);
    // The section draft (`text`) hash was captured from the same fixture on
    // 9bed95c0, before the reorder. The other three were recaptured on the
    // integration branch after the cut-off fix raised their output caps; with
    // the old caps put back they are the 9bed95c0 hashes exactly.
    expect(await requestHashes()).toEqual({
      submit_generation_brief: "768cad27ddf4db91f8237ad51714fdab8cdc5b0826a54a83cc3eba516c57434e",
      submit_retrieval_brief: "5ff41dc8effa6c1d3debffd0657f07c741a25549cd8bfe83863ea1ff0e4939a5",
      submit_transcript_analysis: "529909743af47708a90efdf4bf9fca2dcd76070b988cec16e438bc02a8195310",
      text: "89121783d0eb621299c46695a2c96c1e5bc3c2fde9169e7d9cbd6e360274f2b0",
    });
    expect(await requestHashes(PRE_CUTOFF_CAPS)).toEqual({
      submit_generation_brief: PRE_REORDER_HASHES_9BED95C0.submit_generation_brief,
      submit_retrieval_brief: PRE_REORDER_HASHES_9BED95C0.submit_retrieval_brief,
      submit_transcript_analysis: PRE_REORDER_HASHES_9BED95C0.submit_transcript_analysis,
      text: "89121783d0eb621299c46695a2c96c1e5bc3c2fde9169e7d9cbd6e360274f2b0",
    });
    expect(await sha256Hex(JSON.stringify(artifacts))).toBe(
      "36d55d9baa2d2128651e646ed1b334a22301bc5201c7b2727b271eb04ccdcc96"
    );
  });
});
