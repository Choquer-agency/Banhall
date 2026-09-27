/// <reference types="vite/client" />
/**
 * The server starts the first Seed Batch (owner decision 65, eighth
 * 2026-09-26 amendment). Once the seed stage opens, the first untouched
 * step's `open` Batch is dispatched by the server, not by a mounted Seed
 * workspace; the browser's open reuses it, and the "ideas ready"
 * notification still fires once.
 */
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { GenerationMessageParams } from "./ai/openrouterCore";
import { PD_SUBSECTIONS, type PdSubsectionRoleId } from "../shared/pdSubsections";

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  network.create.mockReset();
});

const SEEDS = {
  seeds: [
    { bullets: ["The team could not predict the control loop response at peak load."], tags: ["technical"], provenance: [] },
    { bullets: ["Three load-band experiments established a stable operating range."], tags: ["detailed"], provenance: [] },
    { bullets: ["The operating range was new to the company."], tags: ["conservative"], provenance: [] },
  ],
};

/** A provider that answers the seed tool, or fails every call. */
function configureProvider(fail = false) {
  network.create.mockReset().mockImplementation(async (params: GenerationMessageParams) => {
    const name = params.tool_choice?.name ?? params.tools?.[0]?.name ?? "text";
    if (fail) throw new Error("Private provider failure text");
    if (name !== "submit_seed_batch") throw new Error(`Unexpected provider call ${name}`);
    return {
      id: "response-seeds",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: "tool-seeds", name, input: SEEDS }],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    };
  });
}

const seedCalls = () =>
  (network.create.mock.calls as Array<[GenerationMessageParams]>).filter(
    ([params]) => (params.tool_choice?.name ?? params.tools?.[0]?.name) === "submit_seed_batch"
  ).length;

/** A seed generation whose Brief, style and drafting inputs are frozen, one
 * step before its seed stage opens. */
async function setup() {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected HTTP transport"); }));
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: "first-batch-writer", role: "writer", firstName: "Wren" });
    const projectId = await ctx.db.insert("projects", {
      title: "First batch", clientName: "Client", status: "generating",
      ownerId: userId, createdBy: userId, shareToken: "first-batch", createdAt: 1, updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId, status: "running", candidateMode: "iterative", gatedWorkflow: "seeds",
      startedAt: 1, requestedBy: userId, previousProjectStatus: "draft",
      singleModelId: "claude-sonnet-5",
      promptVersion: `sha256:${"a".repeat(64)}`,
      writerSettings: { profileState: "missing", source: "none", matchesProfile: false,
        savedProfileSuperseded: false, waiverAnalysis: "none", truncated: false },
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    // Both drafting inputs exist, so the stage opens with them ready and no
    // background step is scheduled beside the first Batch.
    await ctx.db.insert("generationArtifacts", {
      generationId, kind: "analysis",
      content: JSON.stringify({ company_context: "Test company", project_status: "completed" }),
    });
    await ctx.db.insert("generationArtifacts", {
      generationId, kind: "brain_blocks",
      content: JSON.stringify({
        blocks: { analyzer: "", s242: "", s244: "", s246: "" },
        styleGuidance: "Use direct language.",
        styleOverrides: {},
        orderedContext: { profileState: "missing", categoryOutcomes: [], buildOrder: ["242", "244", "246"], selfCheckRules: [] },
      }),
    });
    const content = "Client: The team tested a control loop and established a stable operating range.";
    await ctx.db.insert("generationSources", {
      generationId, projectId, kind: "transcript", label: "Interview", content,
      contentHash: "source-hash", truncated: false, originalLength: content.length, capturedAt: 1,
    });
    const briefId = await ctx.db.insert("generationBriefs", {
      generationId, projectId, inputsHash: "frozen", version: 1, origin: "derived",
      storylineText: "The team tested a control loop.", createdAt: 1,
    });
    return { userId, projectId, generationId, briefId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "first-batch-writer" }) };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function initialize(s: Fixture) {
  await s.t.mutation(internal.generations.pinSeedBrief, { generationId: s.generationId, inputsHash: "frozen" });
  await s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId });
}

/** Pending scheduled jobs by function name. */
async function pendingJobs(s: Fixture, name: string) {
  return await s.t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter(
      (job) => job.name.includes(name) && job.state.kind === "pending"
    )
  );
}

/** Cancel one pending job and run it here instead, so nothing else runs. */
async function takeJob(s: Fixture, name: string) {
  const jobs = await pendingJobs(s, name);
  if (jobs.length !== 1) throw new Error(`Expected one pending ${name}, found ${jobs.length}`);
  await s.t.run((ctx) => ctx.scheduler.cancel(jobs[0]._id));
  return jobs[0].args[0];
}

/** Run every job that is due now, and the jobs they schedule for now, as
 * the scheduler would with nobody watching; later jobs (a lease check) wait. */
async function runDueJobs(s: Fixture) {
  for (let round = 0; round < 10; round += 1) {
    const due = (await pendingJobs(s, "")).filter((job) => job.scheduledTime <= Date.now());
    if (due.length === 0) return;
    vi.advanceTimersByTime(1);
    await s.t.finishInProgressScheduledFunctions();
  }
  throw new Error("Scheduled jobs kept scheduling more");
}

async function runFirstBatchJob(s: Fixture) {
  const args = (await takeJob(s, "startFirstBatch")) as { generationId: Id<"generations"> };
  return await s.t.mutation(internal.seedRuns.startFirstBatch, args);
}

async function runGenerateBatchJob(s: Fixture) {
  const args = (await takeJob(s, "generateBatch")) as { batchId: Id<"seedBatches"> };
  await s.t.action(generateBatchRef, args);
}

async function read(s: Fixture) {
  return await s.t.run(async (ctx) => ({
    generation: await ctx.db.get(s.generationId),
    batches: await ctx.db.query("seedBatches")
      .withIndex("by_generationId_and_roleId", (q) => q.eq("generationId", s.generationId))
      .collect(),
    rows: await ctx.db.query("seedSubsections")
      .withIndex("by_generationId", (q) => q.eq("generationId", s.generationId))
      .collect(),
    seeds: await ctx.db.query("seeds").collect(),
    events: await ctx.db.query("seedDecisionEvents").collect(),
    notifications: await ctx.db.query("notifications").collect(),
  }));
}

const FIRST_ROLE: PdSubsectionRoleId = PD_SUBSECTIONS[0].roleId;

function openArgs(s: Fixture, version: number, commandId: string, roleId = FIRST_ROLE) {
  return { generationId: s.generationId, roleId, expectedSeedStageVersion: version, commandId };
}

describe("the server starts the first Seed Batch (decision 65)", () => {
  it("schedules one first-Batch command when the stage opens, and none on a repeated initialization", async () => {
    const s = await setup();
    await initialize(s);
    await initialize(s);
    const jobs = await pendingJobs(s, "startFirstBatch");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toEqual({ generationId: s.generationId });
    // Nothing is dispatched inside the initialization itself.
    const opened = await read(s);
    expect(opened.batches).toEqual([]);
    expect(opened.generation).toMatchObject({ status: "awaiting_input", seedStageVersion: 0 });
    expect(opened.generation?.draftingInputs?.status).toBe("ready");
  });

  it("dispatches the first step's open Batch on the planning route, as the system", async () => {
    const s = await setup();
    await initialize(s);
    const result = await runFirstBatchJob(s);
    expect(result).toMatchObject({ kind: "dispatched" });
    const state = await read(s);
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0]).toMatchObject({
      roleId: FIRST_ROLE,
      operation: "open",
      status: "queued",
      commandId: `server-open:${s.generationId}`,
      roleOpen: true,
      startedBy: "server",
      briefVersionId: s.briefId,
      model: "claude-sonnet-5",
      slot: `generation:seeds:${FIRST_ROLE}`,
    });
    const row = state.rows.find((candidate) => candidate.roleId === FIRST_ROLE);
    expect(row).toMatchObject({ state: "generating", priorState: "untouched", pendingBatchId: state.batches[0]._id });
    expect(state.rows.filter((candidate) => candidate.state === "untouched")).toHaveLength(12);
    const dispatched = state.events.filter((event) => event.kind === "batchDispatched");
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({ actorSystem: true, batchId: state.batches[0]._id });
    expect(dispatched[0]).not.toHaveProperty("actorUserId");
    expect(state.generation).toMatchObject({ seedStageVersion: 1, seedRequestsReserved: 2 });
    // The attempt and its lease check are scheduled, like a browser open.
    expect(await pendingJobs(s, "generateBatch")).toHaveLength(1);
    expect(await pendingJobs(s, "expireAttempt")).toHaveLength(1);
  });

  it("is idempotent under a repeated delivery of the command", async () => {
    const s = await setup();
    await initialize(s);
    const args = { generationId: s.generationId };
    expect(await s.t.mutation(internal.seedRuns.startFirstBatch, args)).toMatchObject({ kind: "dispatched" });
    const once = await read(s);
    expect(await s.t.mutation(internal.seedRuns.startFirstBatch, args)).toEqual({ kind: "skipped", reason: "started" });
    // The scheduled delivery itself arrives last and does nothing either.
    expect(await runFirstBatchJob(s)).toEqual({ kind: "skipped", reason: "started" });
    expect(await read(s)).toEqual(once);
    expect(await pendingJobs(s, "generateBatch")).toHaveLength(1);
  });

  it("lets the browser's open at mount reuse the pending Batch, at the version it saw or the current one", async () => {
    const s = await setup();
    await initialize(s);
    const dispatched = await runFirstBatchJob(s);
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    const before = await read(s);
    // The workspace mounted on the version it saw when the stage opened (0),
    // and a second mount on the current one: both reuse, neither is refused.
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:mount-1")))
      .toEqual({ kind: "reused", batchId: dispatched.batchId, seedStageVersion: 1 });
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 1, "open:mount-2")))
      .toEqual({ kind: "reused", batchId: dispatched.batchId, seedStageVersion: 1 });
    expect(await read(s)).toEqual(before);
    // Once the attempt is running, a mount on either earlier version reuses it too.
    await s.t.mutation(internal.seedRuns.claimAttempt, { batchId: dispatched.batchId });
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:mount-3")))
      .toMatchObject({ kind: "reused", batchId: dispatched.batchId, seedStageVersion: 2 });
  });

  it("leaves the browser's own open alone when it gets there first", async () => {
    const s = await setup();
    await initialize(s);
    const opened = await s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:mount"));
    expect(opened).toMatchObject({ kind: "dispatched", seedStageVersion: 1 });
    expect(await runFirstBatchJob(s)).toEqual({ kind: "skipped", reason: "started" });
    const state = await read(s);
    expect(state.batches).toHaveLength(1);
    expect(state.batches[0].commandId).toBe("open:mount");
    // A writer's own open is not tagged as the server's.
    expect(state.batches[0]).not.toHaveProperty("startedBy");
    expect(state.generation?.seedStageVersion).toBe(1);
  });

  it("writes the first ideas and notifies once even if nobody opens the Seed workspace", async () => {
    const s = await setup();
    configureProvider();
    await initialize(s);
    // No browser: the stage opening alone starts and finishes the Batch.
    await runDueJobs(s);
    const done = await read(s);
    expect(seedCalls()).toBe(1);
    expect(done.batches).toHaveLength(1);
    expect(done.batches[0]).toMatchObject({ status: "shown", operation: "open", requestsMade: 1 });
    expect(done.seeds).toHaveLength(3);
    expect(done.rows.find((row) => row.roleId === FIRST_ROLE)).toMatchObject({
      state: "in_progress",
      shownBatchId: done.batches[0]._id,
      consecutiveFailures: 0,
    });
    expect(done.generation).toMatchObject({ status: "awaiting_input", seedRequestsReserved: 1 });
    expect(done.notifications).toHaveLength(1);
    expect(done.notifications[0]).toMatchObject({
      userId: s.userId,
      kind: "ideas_ready",
      dedupeKey: `ideas_ready:${s.generationId}:${FIRST_ROLE}`,
    });

    // The writer comes back later: the open on mount reuses the shown Batch
    // at any version and writes, dispatches and notifies nothing more.
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:later")))
      .toMatchObject({ kind: "reused", batchId: done.batches[0]._id });
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, done.generation!.seedStageVersion!, "open:later-2")))
      .toMatchObject({ kind: "reused", batchId: done.batches[0]._id });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await read(s)).toEqual(done);
    expect(seedCalls()).toBe(1);
  });

  it("answers a mount after a failed first Batch with that attempt, not STALE_REVISION, and keeps retry", async () => {
    const s = await setup();
    configureProvider(true);
    await initialize(s);
    await runFirstBatchJob(s);
    await runGenerateBatchJob(s);
    const failed = await read(s);
    expect(failed.batches[0]).toMatchObject({ status: "failed" });
    expect(failed.rows.find((row) => row.roleId === FIRST_ROLE)).toMatchObject({
      state: "untouched",
      consecutiveFailures: 1,
    });
    expect(failed.notifications).toEqual([]);
    const version = failed.generation!.seedStageVersion!;
    expect(version).toBeGreaterThan(0);
    // Behind (the version seen when the stage opened) and current: both
    // name the failed attempt; nothing is dispatched again on its own.
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:behind")))
      .toEqual({ kind: "history", batchId: failed.batches[0]._id, seedStageVersion: version });
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, version, "open:current")))
      .toEqual({ kind: "history", batchId: failed.batches[0]._id, seedStageVersion: version });
    expect(await read(s)).toEqual(failed);
    // The writer's retry goes through the unchanged retry path.
    configureProvider();
    const retried = await s.writer.mutation(api.seeds.retry, openArgs(s, version, "retry-1"));
    expect(retried).toMatchObject({ kind: "dispatched" });
    await runGenerateBatchJob(s);
    const done = await read(s);
    expect(done.batches.find((batch) => batch.operation === "retry")).toMatchObject({ status: "shown" });
    // Only an open Batch says ideas are ready; the retry does not.
    expect(done.notifications).toEqual([]);
  });

  it("keeps the existing fences: a step with no Batch still needs the current decisions", async () => {
    const s = await setup();
    await initialize(s);
    await runFirstBatchJob(s);
    await expect(
      s.writer.mutation(api.seeds.open, openArgs(s, 0, "open:other", "goal_problem"))
    ).rejects.toThrow(/STALE_REVISION/);
    expect(await s.writer.mutation(api.seeds.open, openArgs(s, 1, "open:other-current", "goal_problem")))
      .toMatchObject({ kind: "dispatched", seedStageVersion: 2 });
  });

  it("does nothing once the stage is closed before the command runs", async () => {
    const s = await setup();
    await initialize(s);
    await s.writer.mutation(api.generations.cancelIterativeGeneration, { generationId: s.generationId });
    expect(await runFirstBatchJob(s)).toEqual({ kind: "skipped", reason: "closed" });
    expect((await read(s)).batches).toEqual([]);
  });

  it("stops the first Batch with the stage: a cancel after dispatch terminates it and no late result lands", async () => {
    const s = await setup();
    configureProvider();
    await initialize(s);
    const dispatched = await runFirstBatchJob(s);
    if (dispatched.kind !== "dispatched") throw new Error("not dispatched");
    await s.writer.mutation(api.generations.cancelIterativeGeneration, { generationId: s.generationId });
    await s.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const state = await read(s);
    expect(state.batches[0]).toMatchObject({ status: "failed", error: "GENERATION_TERMINATED" });
    expect(state.seeds).toEqual([]);
    expect(state.notifications).toEqual([]);
    expect(seedCalls()).toBe(0);
  });
});
