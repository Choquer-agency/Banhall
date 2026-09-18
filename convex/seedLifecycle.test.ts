/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi, afterEach } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { PD_SUBSECTIONS } from "../shared/pdSubsections";
import { SEED_INITIALIZATION_ERROR } from "./generations";

const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class { messages = { create: network.create }; },
}));
const modules = import.meta.glob("./**/*.ts");
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const userId = await ctx.db.insert("users", { authId: "seed-owner", role: "writer" });
    const outsiderId = await ctx.db.insert("users", { authId: "seed-other", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Seeds", clientName: "Client", status: "generating",
      ownerId: userId, createdBy: userId, shareToken: "seed-lifecycle", createdAt: 1, updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId, status: "running", candidateMode: "iterative", gatedWorkflow: "seeds",
      startedAt: 1, requestedBy: userId, previousProjectStatus: "draft",
      writerSettings: { profileState: "missing", source: "none", matchesProfile: false,
        savedProfileSuperseded: false, waiverAnalysis: "none", truncated: false },
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    for (const kind of ["analysis", "brain_blocks"] as const) {
      await ctx.db.insert("generationArtifacts", { generationId, kind, content: "{}" });
    }
    const briefId = await ctx.db.insert("generationBriefs", {
      generationId, projectId, inputsHash: "frozen", version: 1, origin: "derived",
      storylineText: "Original Brief", createdAt: 1,
    });
    return { userId, outsiderId, projectId, generationId, briefId };
  });
  return { t, ...ids, writer: t.withIdentity({ subject: "seed-owner" }), outsider: t.withIdentity({ subject: "seed-other" }) };
}

async function initialize(s: Awaited<ReturnType<typeof setup>>) {
  await s.t.mutation(internal.generations.pinSeedBrief, { generationId: s.generationId, inputsHash: "frozen" });
  await s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId });
}

describe("seed initialization lifecycle", () => {
  it("atomically initializes thirteen roles once with one event and no prose jobs", async () => {
    const s = await setup();
    await initialize(s);
    await initialize(s);
    const state = await s.t.run(async ctx => ({
      generation: await ctx.db.get(s.generationId),
      rows: await ctx.db.query("seedSubsections").collect(),
      events: await ctx.db.query("seedDecisionEvents").collect(),
      sections: await ctx.db.query("generationSectionRuns").collect(),
      candidates: await ctx.db.query("generationCandidateRuns").collect(),
    }));
    expect(state.rows.map(row => row.roleId)).toEqual(PD_SUBSECTIONS.map(role => role.roleId));
    expect(state.rows.every(row => row.state === "untouched" && row.consecutiveFailures === 0)).toBe(true);
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ kind: "initialized", actorSystem: true });
    expect(state.generation).toMatchObject({ status: "awaiting_input", briefVersionId: s.briefId, seedStageVersion: 0, seedRequestsReserved: 0, lengthTarget: "standard" });
    expect(state.sections).toEqual([]);
    expect(state.candidates).toEqual([]);
    expect(await s.writer.query(api.generations.getIterativeState, { generationId: s.generationId }))
      .toMatchObject({ gatedWorkflow: "seeds", seedPhase: "seeding" });
  });

  it("pins reusable Brief identity across a later writer version", async () => {
    const s = await setup();
    const args = { generationId: s.generationId, inputsHash: "frozen" };
    expect(await s.t.mutation(internal.generations.pinSeedBrief, args)).toBe(s.briefId);
    const later = await s.t.run(ctx => ctx.db.insert("generationBriefs", {
      projectId: s.projectId, generationId: s.generationId, inputsHash: "frozen",
      version: 2, origin: "writer", storylineText: "Later writer edit", createdAt: 2,
    }));
    expect(await s.t.mutation(internal.generations.pinSeedBrief, args)).toBe(s.briefId);
    await s.t.mutation(internal.generations.stampGenerationBriefId, { generationId: s.generationId, briefId: later });
    expect((await s.t.run(ctx => ctx.db.get(s.generationId)))?.briefId).toBe(s.briefId);
  });

  it("pinned absence derives from frozen inputs and concurrent publication keeps the first result", async () => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.delete(s.briefId));
    expect(await s.t.mutation(internal.generations.pinSeedBrief, { generationId: s.generationId, inputsHash: "frozen" })).toBeNull();
    const later = await s.t.run(ctx => ctx.db.insert("generationBriefs", {
      projectId: s.projectId, generationId: s.generationId, inputsHash: "frozen",
      version: 1, origin: "writer", storylineText: "Must not adopt", createdAt: 2,
    }));
    const args = {
      generationId: s.generationId, projectId: s.projectId, inputsHash: "frozen",
      seedStartup: true, origin: "derived" as const, storylineText: "Frozen derivation",
      entries: [], baselineBriefId: null, baselineRetained: [], baselineRemoved: [],
    };
    const first = await s.t.mutation(internal.generations.persistDerivedBrief, args);
    expect(first).not.toBe(later);
    expect(await s.t.mutation(internal.generations.persistDerivedBrief, { ...args, storylineText: "Second model response" })).toBe(first);
    expect((await s.t.run(async ctx => first ? await ctx.db.get(first) : null))?.storylineText).toBe("Frozen derivation");
    await s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId });
    expect((await s.t.run(ctx => ctx.db.get(s.generationId)))?.briefVersionId).toBe(first);
  });

  it("refuses initialization before the frozen prerequisites without partial rows", async () => {
    const s = await setup();
    await expect(s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId })).rejects.toThrow("Frozen Brief");
    expect(await s.t.run(ctx => ctx.db.query("seedSubsections").collect())).toEqual([]);
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({ status: "running", seedStageError: SEED_INITIALIZATION_ERROR });
  });

  it("retry requires prose-edit authorization and queues only the frozen resume action once", async () => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    await expect(s.outsider.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId })).rejects.toThrow();
    await s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId });
    await expect(s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId })).rejects.toThrow("not waiting");
    const jobs = await s.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0].name).toContain("resumeSeedInitialization");
    const artifacts = await s.t.run(ctx => ctx.db.query("generationArtifacts").collect());
    expect(artifacts.map(row => row.content)).toEqual(["{}", "{}"]);
  });

  it.each(["anonymous", "roleless", "unmapped", "unauthenticated"] as const)("denies %s retry callers without scheduling", async actor => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    if (actor === "anonymous" || actor === "roleless") await s.t.run(async ctx => {
      await ctx.db.insert("users", { authId: actor, ...(actor === "anonymous" ? { isAnonymous: true, role: "admin" as const } : {}) });
    });
    const client = actor === "unauthenticated" ? s.t : s.t.withIdentity({ subject: actor });
    await expect(client.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId })).rejects.toThrow();
    expect(await s.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it.each(["manager", "admin"] as const)("allows the %s capability without ownership", async role => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.run(ctx => ctx.db.patch(s.outsiderId, { role }));
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    await s.outsider.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId });
    expect(await s.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
  });

  it.each(["open", "completed"] as const)("uses only an %s collaboration assignment for retry permission", async status => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.run(ctx => ctx.db.insert("workItems", {
      projectId: s.projectId, assigneeId: s.outsiderId, assignerId: s.userId,
      kind: "revision", instructions: "Review", blocking: false, status, version: 1,
      createRequestId: "seed-access", createRequestFingerprint: "seed-access",
      createdAt: 1, updatedAt: 1,
    }));
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    const retry = s.outsider.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId });
    if (status === "open") await expect(retry).resolves.toBeNull();
    else await expect(retry).rejects.toThrow();
  });

  it("does not grant retry permission from historical createdBy after ownership transfer", async () => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.patch(s.projectId, { ownerId: s.outsiderId }));
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    await expect(s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId })).rejects.toThrow();
  });

  it("freezes artifacts and settings after first seed capture", async () => {
    const s = await setup();
    await s.t.mutation(internal.generations.saveIterativeArtifacts, {
      generationId: s.generationId, analysis: "Later analysis", brainBlocks: "Later writer profile",
    });
    await s.t.mutation(internal.generations.recordWriterSettings, {
      generationId: s.generationId,
      writerSettings: { profileState: "applied", source: "profile", matchesProfile: true, savedProfileSuperseded: false, waiverAnalysis: "profile", truncated: false },
    });
    expect((await s.t.run(ctx => ctx.db.query("generationArtifacts").collect())).map(row => row.content)).toEqual(["{}", "{}"]);
    expect((await s.t.run(ctx => ctx.db.get(s.generationId)))?.writerSettings?.source).toBe("none");
  });

  it.each(["stale", "deleted", "sections"] as const)("refuses retry and initialization at the %s fence", async fence => {
    const s = await setup();
    await s.t.mutation(internal.generations.recordSeedInitializationFailure, { generationId: s.generationId });
    await s.t.run(async ctx => {
      if (fence === "stale") await ctx.db.patch(s.projectId, { activeGenerationId: undefined });
      if (fence === "deleted") await ctx.db.patch(s.projectId, { deletionStartedAt: Date.now() });
      if (fence === "sections") await ctx.db.patch(s.generationId, { gatedWorkflow: "sections" });
    });
    await expect(s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId })).rejects.toThrow();
    await expect(s.t.mutation(internal.generations.initializeSeedStage, { generationId: s.generationId })).rejects.toThrow();
    expect(await s.t.run(ctx => ctx.db.query("seedSubsections").collect())).toEqual([]);
  });

  it("legacy section write paths refuse seed generations", async () => {
    const s = await setup();
    await initialize(s);
    await expect(s.writer.mutation(api.generations.approveSectionDraft, { generationId: s.generationId, section: "s242", text: "Do not write" })).rejects.toThrow("Section operations");
    await expect(s.writer.mutation(api.generations.regenerateSectionDraft, { generationId: s.generationId, section: "s242" })).rejects.toThrow("Section operations");
  });

  it("reaper keeps seed initialization retryable and ignores writer thinking time", async () => {
    vi.useFakeTimers();
    const s = await setup();
    await s.t.mutation(internal.generations.failStaleGenerations, {});
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({ status: "running", seedStageError: SEED_INITIALIZATION_ERROR });
    await initialize(s);
    await s.t.mutation(internal.generations.failStaleGenerations, {});
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({ status: "awaiting_input" });
  });
});

describe("seed initialization action boundary", () => {
  it("the real post-analysis seam initializes seeds without scheduling sections or a ghost", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const s = await setup();
    await s.t.run(async ctx => {
      const transcriptId = await ctx.db.insert("transcripts", { projectId: s.projectId, content: "The team tested a control loop.", createdAt: 1 });
      await ctx.db.patch(s.generationId, { status: "reserved", transcriptId, transcriptIds: [transcriptId] });
      await ctx.db.insert("generationSources", {
        projectId: s.projectId, generationId: s.generationId, kind: "transcript", transcriptId,
        label: "Frozen transcript", content: "The team tested a control loop.", contentHash: "original-hash",
        truncated: false, originalLength: 29, capturedAt: 1,
      });
    });
    network.create.mockReset().mockImplementation(async params => ({
      id: "startup-response", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: "startup-tool", name: params.tool_choice.name,
        input: params.tool_choice.name === "submit_transcript_analysis" ? {
          company_context: "Test company", project_goal: "Control loop",
          business_problem: "Unstable output", scientific_technical_problem: "Response is unknown",
          technological_objective: "Stable control", work_performed: {}, project_status: "completed",
        } : {
          storyline: "The team tested a control loop.", storylineClaims: [],
          claimExclusions: [], confidenceMap: [], glossaryTerms: [],
        } }],
      stop_reason: "tool_use", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }));
    await s.t.action(internal.ai.iterative.startIterativeGeneration, { generationId: s.generationId });
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({ status: "awaiting_input" });
    expect(await s.t.run(ctx => ctx.db.query("seedSubsections").collect())).toHaveLength(13);
    expect(await s.t.run(ctx => ctx.db.query("generationSectionRuns").collect())).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query("generationCandidateRuns").collect())).toEqual([]);
    const jobs = await s.t.run(ctx => ctx.db.system.query("_scheduled_functions").collect());
    expect(jobs.some(job => /draftSection|generateCandidate/.test(job.name))).toBe(false);
  });

  it("a Brief failure stays retryable, and resume consumes frozen sources without analysis or retrieval", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const s = await setup();
    await s.t.run(async ctx => {
      const transcriptId = await ctx.db.insert("transcripts", { projectId: s.projectId, content: "The team tested a control loop.", createdAt: 1 });
      await ctx.db.patch(s.generationId, { transcriptId, transcriptIds: [transcriptId] });
      await ctx.db.insert("generationSources", {
        projectId: s.projectId, generationId: s.generationId, kind: "transcript", transcriptId,
        label: "Frozen transcript", content: "The team tested a control loop.", contentHash: "original-hash",
        truncated: false, originalLength: 29, capturedAt: 1,
      });
    });
    network.create.mockReset().mockRejectedValue(new Error("Private provider/source error"));
    await s.t.action(internal.ai.iterative.resumeSeedInitialization, { generationId: s.generationId });
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({
      status: "running", seedBriefPin: null, seedStageError: SEED_INITIALIZATION_ERROR,
    });
    expect(await s.t.run(ctx => ctx.db.query("seedSubsections").collect())).toEqual([]);
    network.create.mockReset().mockResolvedValue({
      id: "brief-response", type: "message", role: "assistant", model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: "brief-tool", name: "submit_generation_brief", input: {
        storyline: "The team tested a control loop.", storylineClaims: [],
        claimExclusions: [], confidenceMap: [], glossaryTerms: [],
      } }],
      stop_reason: "tool_use", stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    await s.writer.mutation(api.generations.retryInitializeSeedStage, { generationId: s.generationId });
    await s.t.action(internal.ai.iterative.resumeSeedInitialization, { generationId: s.generationId });
    expect(await s.t.run(ctx => ctx.db.get(s.generationId))).toMatchObject({ status: "awaiting_input" });
    expect(network.create).toHaveBeenCalledTimes(1);
    expect(network.create.mock.calls[0][0].tool_choice.name).toBe("submit_generation_brief");
    expect(await s.t.run(ctx => ctx.db.query("generationSectionRuns").collect())).toEqual([]);
    expect(await s.t.run(ctx => ctx.db.query("generationCandidateRuns").collect())).toEqual([]);
    vi.unstubAllEnvs();
  });
});
