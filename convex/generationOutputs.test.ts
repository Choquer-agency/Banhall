/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import {
  agentOutputsOf,
  outputArtifact,
  readBrainProvenance,
  readBrainRetrievalBrief,
} from "./lib/generationOutputs";
import { buildTiptapDocument } from "./lib/tiptapReport";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "outputs-writer";
const DAY = 86_400_000;

type GenerationFixture = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "admin", name: "Admin" });
    const projectId = await ctx.db.insert("projects", {
      title: "Outputs",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "outputs-token",
      createdAt: 1,
      updatedAt: 1,
    });
    return { userId, projectId };
  });
  return { t, authed: t.withIdentity({ subject: AUTH_ID }), ...ids };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function insertGeneration(f: Fixture, fields: GenerationFixture = {}) {
  return await f.t.run(async (ctx) => {
    const generationId = await ctx.db.insert("generations", {
      projectId: f.projectId,
      status: "running",
      candidateMode: "single",
      requestedBy: f.userId,
      startedAt: Date.now(),
      ...fields,
    });
    await ctx.db.patch(f.projectId, { activeGenerationId: generationId });
    return generationId;
  });
}

async function completeSingleCandidate(f: Fixture, generationId: Id<"generations">, agentOutputs: string) {
  const candidateRunId = await f.t.run((ctx) =>
    ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId: f.projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "running",
      queuedAt: 1,
      startedAt: 1,
    })
  );
  const content = JSON.stringify(buildTiptapDocument("Outputs", "A because B.", "Work", "Advance"));
  await f.t.mutation(internal.generations.completeCandidateRun, {
    candidateRunId,
    content,
    agentOutputs,
  });
}

describe("agent outputs off the generation row", () => {
  it("a new generation stores its outputs in an artifact row and the queries read them", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { outputsInArtifactsAt: 1 });
    await completeSingleCandidate(f, generationId, '{"section242":"a"}');
    const row = await f.t.run((ctx) => ctx.db.get(generationId));
    expect(row?.status).toBe("completed");
    expect(row?.agentOutputs).toBeUndefined();
    const artifact = await f.t.run((ctx) => outputArtifact(ctx, generationId, "agent_outputs"));
    expect(artifact?.content).toBe('{"section242":"a"}');
    const latest = await f.authed.query(api.generations.getLatestGeneration, { projectId: f.projectId });
    expect(latest?.agentOutputs).toBe('{"section242":"a"}');
    const exact = await f.authed.query(api.generations.getGeneration, { generationId });
    expect(exact?.agentOutputs).toBe('{"section242":"a"}');
  });

  it("reads a legacy row's field, and moves it to an artifact row on its first write", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, {
      status: "completed",
      agentOutputs: JSON.stringify({ analyzer: { subject: "x" }, section242: "legacy" }),
      brainProvenance: [{ entryId: "e1", score: 0.5 }],
      brainRetrievalBrief: '{"queries":[]}',
      postQaStatus: "running",
      postQaStartedAt: 5,
    });
    expect(
      JSON.parse(
        (await f.authed.query(api.generations.getLatestGeneration, { projectId: f.projectId }))
          ?.agentOutputs ?? "{}"
      ).section242
    ).toBe("legacy");
    await f.t.mutation(internal.generations.saveReportQa, {
      generationId,
      attemptStartedAt: 5,
      qa: JSON.stringify({ overall_score: 70 }),
      qaScore: 70,
    });
    const after = await f.t.run(async (ctx) => {
      const row = (await ctx.db.get(generationId))!;
      return {
        row,
        outputs: await agentOutputsOf(ctx, generationId),
        provenance: await readBrainProvenance(ctx, row),
        brief: await readBrainRetrievalBrief(ctx, row),
      };
    });
    expect(typeof after.row.outputsInArtifactsAt).toBe("number");
    // The legacy field is kept as it was; readers use the artifact row now.
    expect(JSON.parse(after.row.agentOutputs ?? "{}").qa).toBeUndefined();
    expect(JSON.parse(after.outputs ?? "{}")).toMatchObject({ section242: "legacy", qa: { overall_score: 70 } });
    expect(after.provenance).toEqual([{ entryId: "e1", score: 0.5 }]);
    expect(after.brief).toBe('{"queries":[]}');
  });

  it("setBrainProvenance writes typed provenance and the brief as artifact rows", async () => {
    const f = await setup();
    const generationId = await insertGeneration(f, { outputsInArtifactsAt: 1 });
    await f.t.mutation(internal.generations.setBrainProvenance, {
      generationId,
      exemplars: [{ entryId: "e1", score: 0.9, section: "242", searchScore: 0.8 }],
      brief: '{"queries":["q"]}',
    });
    const read = async () =>
      await f.t.run(async (ctx) => {
        const row = (await ctx.db.get(generationId))!;
        return {
          row,
          provenance: await readBrainProvenance(ctx, row),
          brief: await readBrainRetrievalBrief(ctx, row),
        };
      });
    const first = await read();
    expect(first.row.brainProvenance).toBeUndefined();
    expect(first.provenance).toEqual([{ entryId: "e1", score: 0.9, section: "242", searchScore: 0.8 }]);
    expect(first.brief).toBe('{"queries":["q"]}');
    // A later record without a brief clears it, as the row field did.
    await f.t.mutation(internal.generations.setBrainProvenance, { generationId, exemplars: [] });
    const second = await read();
    expect(second.provenance).toEqual([]);
    expect(second.brief).toBeUndefined();
  });

  it("learning health reads provenance from artifact rows and legacy rows alike", async () => {
    const f = await setup();
    const end = 100 * DAY;
    await f.t.run(async (ctx) => {
      const legacy = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: end - 2,
        brainProvenance: [{ entryId: "shared", score: 1 }],
      });
      const moved = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: end - 1,
        outputsInArtifactsAt: 1,
      });
      await ctx.db.insert("generationArtifacts", {
        generationId: moved,
        kind: "brain_provenance",
        content: "",
        brainProvenance: [{ entryId: "shared", score: 1 }],
      });
      for (const generationId of [legacy, moved]) {
        await ctx.db.insert("reports", {
          projectId: f.projectId,
          generationId,
          content: "",
          version: 1,
          generatedAt: end,
          updatedAt: end,
        });
      }
    });
    const health = await f.authed.query(api.learningHealth.getHealth, { start: end - DAY, end });
    expect(health.sources.rows.find((row) => row.identity === "entry:shared")).toMatchObject({
      generations: 2,
      passages: 2,
    });
  });

  it("report chat grounds on artifact outputs, including the completed-generation fallback", async () => {
    const f = await setup();
    const { own, fallback } = await f.t.run(async (ctx) => {
      const own = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: 1,
        outputsInArtifactsAt: 1,
      });
      await ctx.db.insert("generationArtifacts", {
        generationId: own,
        kind: "agent_outputs",
        content: '{"analyzer":"OWN-ARTIFACT-ANALYSIS"}',
      });
      const bare = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: 2,
        outputsInArtifactsAt: 1,
      });
      const fallback = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        startedAt: 3,
        outputsInArtifactsAt: 1,
      });
      await ctx.db.insert("generationArtifacts", {
        generationId: fallback,
        kind: "agent_outputs",
        content: '{"analyzer":"FALLBACK-ARTIFACT-ANALYSIS"}',
      });
      const ownReport = await ctx.db.insert("reports", {
        projectId: f.projectId,
        generationId: own,
        content: "{}",
        version: 1,
        generatedAt: 1,
        updatedAt: 1,
      });
      const bareReport = await ctx.db.insert("reports", {
        projectId: f.projectId,
        generationId: bare,
        content: "{}",
        version: 2,
        generatedAt: 2,
        updatedAt: 2,
      });
      return { own: ownReport, fallback: bareReport };
    });
    const ownContext = await f.t.query(internal.chatV2.getChatContextV2, {
      reportId: own,
      agentThreadId: "thread-own",
    });
    expect(ownContext.agentOutputs).toContain("OWN-ARTIFACT-ANALYSIS");
    const fallbackContext = await f.t.query(internal.chatV2.getChatContextV2, {
      reportId: fallback,
      agentThreadId: "thread-fallback",
    });
    expect(fallbackContext.agentOutputs).toContain("FALLBACK-ARTIFACT-ANALYSIS");
  });
});

describe("backfillGenerationOutputs", () => {
  it("moves every older row once, keeps the row fields and is idempotent", async () => {
    const f = await setup();
    const legacyId = await insertGeneration(f, {
      status: "completed",
      agentOutputs: '{"section242":"old"}',
      brainProvenance: [{ entryId: "e", score: 1 }],
      brainRetrievalBrief: "brief",
    });
    const bareId = await insertGeneration(f, { status: "failed" });
    const newId = await insertGeneration(f, { status: "completed", outputsInArtifactsAt: 1 });

    const dry = await f.t.mutation(internal.generations.backfillGenerationOutputs, { dryRun: true });
    expect(dry.moved).toBe(2);
    expect((await f.t.run((ctx) => ctx.db.get(legacyId)))?.outputsInArtifactsAt).toBeUndefined();

    const first = await f.t.mutation(internal.generations.backfillGenerationOutputs, {});
    expect(first).toMatchObject({ moved: 2, isDone: true });
    const state = await f.t.run(async (ctx) => {
      const legacy = (await ctx.db.get(legacyId))!;
      return {
        legacy,
        bare: await ctx.db.get(bareId),
        fresh: await ctx.db.get(newId),
        outputs: await agentOutputsOf(ctx, legacyId),
        provenance: await readBrainProvenance(ctx, legacy),
        brief: await readBrainRetrievalBrief(ctx, legacy),
        artifacts: await ctx.db.query("generationArtifacts").collect(),
      };
    });
    expect(typeof state.legacy.outputsInArtifactsAt).toBe("number");
    expect(state.legacy.agentOutputs).toBe('{"section242":"old"}');
    expect(state.outputs).toBe('{"section242":"old"}');
    expect(state.provenance).toEqual([{ entryId: "e", score: 1 }]);
    expect(state.brief).toBe("brief");
    expect(typeof state.bare?.outputsInArtifactsAt).toBe("number");
    expect(state.fresh?.outputsInArtifactsAt).toBe(1);
    expect(state.artifacts).toHaveLength(3);

    const again = await f.t.mutation(internal.generations.backfillGenerationOutputs, {});
    expect(again.moved).toBe(0);
    expect(await f.t.run((ctx) => ctx.db.query("generationArtifacts").collect())).toHaveLength(3);
  });
});

describe("QA results keyed to the report revision", () => {
  async function completedWithReport(f: Fixture) {
    const generationId = await insertGeneration(f, {
      status: "completed",
      outputsInArtifactsAt: 1,
      postQaStatus: "running",
      postQaStartedAt: 7,
    });
    const content = JSON.stringify(buildTiptapDocument("Outputs", "A because B.", "Work", "Advance"));
    const reportId = await f.t.run(async (ctx) =>
      ctx.db.insert("reports", {
        projectId: f.projectId,
        generationId,
        content,
        contentHash: await sha256(content),
        revisionNumber: 2,
        version: 1,
        generatedAt: 1,
        updatedAt: 1,
      })
    );
    return { generationId, reportId, capturedRef: { reportId, revisionNumber: 2, contentHash: await sha256(content) } };
  }

  it("records the scored revision and reports whether it is still current", async () => {
    const f = await setup();
    const { generationId, reportId, capturedRef } = await completedWithReport(f);
    await f.t.mutation(internal.generations.saveReportQa, {
      generationId,
      attemptStartedAt: 7,
      capturedRef,
      qa: JSON.stringify({ overall_score: 88 }),
      chronology: "[]",
      qaScore: 88,
    });
    const rows = await f.t.run((ctx) => ctx.db.query("generationQaResults").collect());
    expect(rows).toEqual([
      expect.objectContaining({ ...capturedRef, generationId, status: "done", qaScore: 88, attemptStartedAt: 7 }),
    ]);
    expect(await f.authed.query(api.generations.getGenerationQaResult, { generationId })).toMatchObject({
      status: "done",
      revisionNumber: 2,
      qaScore: 88,
      current: true,
    });
    // The writer edits the report: the stored result no longer describes it.
    const edited = JSON.stringify(buildTiptapDocument("Outputs", "C because D.", "Work", "Advance"));
    await f.t.run(async (ctx) =>
      ctx.db.patch(reportId, { content: edited, contentHash: await sha256(edited), revisionNumber: 3 })
    );
    expect(await f.authed.query(api.generations.getGenerationQaResult, { generationId })).toMatchObject({
      revisionNumber: 2,
      current: false,
    });
  });

  it("records nothing for a legacy settle without a captured revision", async () => {
    const f = await setup();
    const { generationId } = await completedWithReport(f);
    await f.t.mutation(internal.generations.saveReportQa, {
      generationId,
      qa: JSON.stringify({ overall_score: 50 }),
    });
    expect(await f.t.run((ctx) => ctx.db.query("generationQaResults").collect())).toEqual([]);
    expect(await f.authed.query(api.generations.getGenerationQaResult, { generationId })).toBeNull();
    expect(JSON.parse((await f.t.run((ctx) => agentOutputsOf(ctx, generationId))) ?? "{}").qa).toEqual({
      overall_score: 50,
    });
  });
});
