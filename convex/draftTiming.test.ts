/// <reference types="vite/client" />
// 2026-11-02: how long a finished draft took, read from stored stamps only
// (convex/lib/generations/draftTiming.ts), and where it is exposed: the
// report's generation view and the version history list.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256 } from "./lib/contracts";
import { draftTimingOf } from "./lib/generations/draftTiming";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "draft-timing-reader";
const MIN = 60_000;
const T0 = 1_800_000_000_000;

type GenerationFields = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

async function setup() {
  const t = convexTest(schema, modules);
  const base = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "writer", name: "Timing Reader" });
    const projectId = await ctx.db.insert("projects", {
      title: "Timing project",
      clientName: "Client",
      status: "review",
      createdBy: userId,
      ownerId: userId,
      shareToken: "draft-timing-token",
      createdAt: T0,
      updatedAt: T0,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      label: "Interview",
      position: 0,
      content: "Interview body",
      createdAt: T0,
    });
    return { userId, projectId, transcriptId };
  });

  async function generation(fields: GenerationFields) {
    return await t.run(async (ctx) =>
      await ctx.db.insert("generations", {
        projectId: base.projectId,
        transcriptId: base.transcriptId,
        status: "completed",
        requestedBy: base.userId,
        startedAt: T0,
        ...fields,
      })
    );
  }

  async function candidateRun(
    generationId: Id<"generations">,
    fields: Partial<Omit<Doc<"generationCandidateRuns">, "_id" | "_creationTime">>
  ) {
    await t.run(async (ctx) => {
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId: base.projectId,
        model: "model-a",
        label: "Model A",
        status: "succeeded",
        queuedAt: T0,
        ...fields,
      });
    });
  }

  async function signOff(generationId: Id<"generations">, signedOffAt: number) {
    return await t.run(async (ctx) => {
      const briefVersionId = await ctx.db.insert("generationBriefs", {
        projectId: base.projectId,
        generationId,
        inputsHash: "hash",
        version: 1,
        origin: "derived",
        storylineText: "Storyline",
        createdAt: T0,
      });
      return await ctx.db.insert("summaryVersions", {
        projectId: base.projectId,
        generationId,
        version: 1,
        originGenerationId: generationId,
        briefVersionId,
        settingsHash: "settings",
        skippedRoleIds: [],
        readiness: true,
        signedOffBy: base.userId,
        signedOffAt,
      });
    });
  }

  async function timing(generationId: Id<"generations">) {
    return await t.run(async (ctx) => {
      const row = await ctx.db.get(generationId);
      if (!row) throw new Error("missing generation");
      return await draftTimingOf(ctx, row);
    });
  }

  return { t, reader: t.withIdentity({ subject: AUTH_ID }), ...base, generation, candidateRun, signOff, timing };
}

describe("draftTimingOf", () => {
  it("times a single draft from start to completion", async () => {
    const s = await setup();
    const id = await s.generation({ candidateMode: "single", completedAt: T0 + 12 * MIN });
    expect(await s.timing(id)).toEqual({ draftMs: 12 * MIN, stepByStepMs: null });
  });

  it("times a compare draft to the last candidate settling, not to the writer's pick", async () => {
    const s = await setup();
    const id = await s.generation({ candidateMode: "compare", completedAt: T0 + 3 * 60 * MIN });
    await s.candidateRun(id, { model: "a", completedAt: T0 + 9 * MIN });
    await s.candidateRun(id, { model: "b", status: "failed", completedAt: T0 + 14 * MIN });
    // A ghost and an unsettled run never count.
    await s.candidateRun(id, { model: "ghost", ghost: true, completedAt: T0 + 50 * MIN });
    await s.candidateRun(id, { model: "c", status: "running" });
    expect(await s.timing(id)).toEqual({ draftMs: 14 * MIN, stepByStepMs: null });
  });

  it("reads a legacy row without a mode as compare and shows nothing without run stamps", async () => {
    const s = await setup();
    const id = await s.generation({ completedAt: T0 + 30 * MIN });
    await s.candidateRun(id, { model: "a" });
    expect(await s.timing(id)).toBeNull();
  });

  it("splits a Step by step draft at the Summary sign-off", async () => {
    const s = await setup();
    const id = await s.generation({
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      completedAt: T0 + 74 * MIN,
    });
    const summaryVersionId = await s.signOff(id, T0 + 65 * MIN);
    await s.t.run(async (ctx) => ctx.db.patch(id, { summaryVersionId }));
    expect(await s.timing(id)).toEqual({ draftMs: 9 * MIN, stepByStepMs: 65 * MIN });
  });

  it("times a retry from a signed-off Summary from its own start, with the origin run's Step by step time", async () => {
    const s = await setup();
    const origin = await s.generation({
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      status: "failed",
      completedAt: T0 + 70 * MIN,
    });
    const summaryVersionId = await s.signOff(origin, T0 + 40 * MIN);
    await s.t.run(async (ctx) => ctx.db.patch(origin, { summaryVersionId }));
    const retry = await s.generation({
      candidateMode: "iterative",
      gatedWorkflow: "seeds",
      summaryVersionId,
      originGenerationId: origin,
      startedAt: T0 + 120 * MIN,
      completedAt: T0 + 131 * MIN,
    });
    expect(await s.timing(retry)).toEqual({ draftMs: 11 * MIN, stepByStepMs: 40 * MIN });
    // The failed origin is not a finished draft.
    expect(await s.timing(origin)).toBeNull();
  });

  it("shows nothing for a run still going, a legacy section-by-section run, or a row without a finish stamp", async () => {
    const s = await setup();
    const running = await s.generation({ candidateMode: "single", status: "running" });
    const sections = await s.generation({ candidateMode: "iterative", completedAt: T0 + 30 * MIN });
    const unsigned = await s.generation({ candidateMode: "iterative", gatedWorkflow: "seeds", completedAt: T0 + 30 * MIN });
    const noFinish = await s.generation({ candidateMode: "single" });
    for (const id of [running, sections, unsigned, noFinish]) expect(await s.timing(id)).toBeNull();
  });
});

describe("draft timing on the project page and in version history", () => {
  it("returns the report's draft timing to a project reader", async () => {
    const s = await setup();
    const id = await s.generation({ candidateMode: "single", completedAt: T0 + 15 * MIN });
    const view = await s.reader.query(api.generations.getGenerationSeedView, { generationId: id });
    expect(view?.draftTiming).toEqual({ draftMs: 15 * MIN, stepByStepMs: null });
  });

  it("times each generated draft in the version history and no other snapshot", async () => {
    const s = await setup();
    const id = await s.generation({ candidateMode: "single", completedAt: T0 + 20 * MIN });
    const reportId = await s.t.run(async (ctx) => {
      const content = "Draft body";
      const reportId = await ctx.db.insert("reports", {
        projectId: s.projectId,
        generationId: id,
        content,
        contentHash: await sha256(content),
        revisionNumber: 0,
        version: 1,
        generatedAt: T0,
        updatedAt: T0,
      });
      for (const [reason, createdAt] of [["generated", T0 + 20 * MIN], ["manual", T0 + 30 * MIN]] as const) {
        await ctx.db.insert("reportSnapshots", {
          projectId: s.projectId,
          reportId,
          generationId: id,
          content,
          reason,
          createdByRole: reason === "generated" ? "system" : "writer",
          createdAt,
        });
      }
      return reportId;
    });
    const rows = await s.reader.query(api.snapshots.listSnapshots, { reportId });
    expect(rows.map((row) => [row.reason, row.draftTiming])).toEqual([
      ["manual", null],
      ["generated", { draftMs: 20 * MIN, stepByStepMs: null }],
    ]);
  });
});
