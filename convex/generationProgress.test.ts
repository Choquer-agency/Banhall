/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";
import {
  allGenerationProgress,
  appendGenerationProgress,
  progressKind,
  PROGRESS_READ_LIMIT,
  readGenerationProgress,
} from "./lib/generationProgress";
import { PROGRESS_BACKFILL_MAX_LINES } from "./generations";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "progress-writer";

afterEach(() => {
  vi.useRealTimers();
});

type GenerationFixture = Partial<Omit<Doc<"generations">, "_id" | "_creationTime">>;

async function setup(generation: GenerationFixture = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId: AUTH_ID, role: "writer", name: "Writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Progress",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      ownerId: userId,
      shareToken: "progress-token",
      createdAt: 1,
      updatedAt: 1,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "running",
      candidateMode: "iterative",
      requestedBy: userId,
      requestedAt: 10,
      startedAt: 10,
      ...generation,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    return { userId, projectId, generationId };
  });
  return { t, authed: t.withIdentity({ subject: AUTH_ID }), ...ids };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

const progress = (f: Fixture) => f.t.run((ctx) => allGenerationProgress(ctx, f.generationId));
const childRows = (f: Fixture) =>
  f.t.run((ctx) =>
    ctx.db
      .query("generationProgress")
      .withIndex("by_generationId_and_at", (q) => q.eq("generationId", f.generationId))
      .collect()
  );

describe("progress writes", () => {
  it("derives the kind from the leading check or cross", () => {
    expect(progressKind("✓ Line 242 drafted.")).toBe("success");
    expect(progressKind("✗ Line 244 failed.")).toBe("failure");
    expect(progressKind("Drafting Line 246…")).toBe("info");
  });

  it("appends child rows in order and never rewrites the generation row", async () => {
    const f = await setup();
    const before = await f.t.run((ctx) => ctx.db.get(f.generationId));
    await f.t.mutation(internal.generations.appendProgress, {
      generationId: f.generationId,
      line: "Analyzing the transcript.",
    });
    await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      await appendGenerationProgress(ctx, generation, ["✓ Analysis ready.", "✗ Brain search failed."]);
    });
    const after = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(after).toEqual(before);
    expect((await childRows(f)).map((row) => [row.message, row.kind, row.projectId])).toEqual([
      ["Analyzing the transcript.", "info", f.projectId],
      ["✓ Analysis ready.", "success", f.projectId],
      ["✗ Brain search failed.", "failure", f.projectId],
    ]);
    expect(await progress(f)).toEqual([
      "Analyzing the transcript.",
      "✓ Analysis ready.",
      "✗ Brain search failed.",
    ]);
  });

  it("writes nothing for a project in deletion", async () => {
    const f = await setup();
    await f.t.run((ctx) => ctx.db.patch(f.projectId, { deletionStartedAt: 1 }));
    await f.t.mutation(internal.generations.appendProgress, {
      generationId: f.generationId,
      line: "Late line.",
    });
    expect(await childRows(f)).toEqual([]);
  });

  it("a real mutation narrates through child rows (section draft ready)", async () => {
    const f = await setup();
    await f.t.run((ctx) =>
      ctx.db.insert("generationSectionRuns", {
        generationId: f.generationId,
        projectId: f.projectId,
        section: "s242",
        status: "running",
        model: "model",
        label: "Model",
        attempt: 1,
        queuedAt: 1,
      })
    );
    await f.t.mutation(internal.generations.completeSectionRun, {
      generationId: f.generationId,
      section: "s242",
      draftText: "Draft",
      metrics: "{}",
      qa: "[]",
    });
    const row = await f.t.run((ctx) => ctx.db.get(f.generationId));
    expect(row?.progressLog).toBeUndefined();
    expect(await progress(f)).toEqual(["✓ Line 242 — Uncertainty draft ready for review."]);
  });
});

describe("progress reads (dual read)", () => {
  it("reads a legacy array, then lines written since, through the public queries", async () => {
    const f = await setup({ progressLog: ["Generation started.", "✓ Analysis ready."] });
    await f.t.mutation(internal.generations.appendProgress, {
      generationId: f.generationId,
      line: "✗ Line 242 failed: raw provider text.",
    });
    const latest = await f.authed.query(api.generations.getLatestGeneration, {
      projectId: f.projectId,
    });
    expect(latest?.progressLog).toEqual([
      "Generation started.",
      "✓ Analysis ready.",
      "✗ Line 242 failed.",
    ]);
    const state = await f.authed.query(api.generations.getIterativeState, {
      generationId: f.generationId,
    });
    expect(state?.progressLog).toEqual(latest?.progressLog);
  });

  it("returns only the newest lines", async () => {
    const f = await setup({ progressLog: ["legacy 1", "legacy 2"] });
    await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      await appendGenerationProgress(
        ctx,
        generation,
        Array.from({ length: PROGRESS_READ_LIMIT + 5 }, (_, index) => `line ${index}`)
      );
    });
    const lines = await f.t.run(async (ctx) => {
      const generation = (await ctx.db.get(f.generationId))!;
      return await readGenerationProgress(ctx, generation);
    });
    expect(lines).toHaveLength(PROGRESS_READ_LIMIT);
    expect(lines[0]).toBe("line 5");
    expect(lines.at(-1)).toBe(`line ${PROGRESS_READ_LIMIT + 4}`);
  });
});

describe("backfillGenerationProgress", () => {
  it("copies legacy arrays once, before lines written since, and is idempotent", async () => {
    vi.useFakeTimers();
    const f = await setup({ progressLog: ["Generation started.", "✓ Analysis ready."] });
    // An in-flight generation already wrote a line after the move.
    vi.setSystemTime(1_000);
    await f.t.mutation(internal.generations.appendProgress, {
      generationId: f.generationId,
      line: "Drafting Line 244…",
    });
    // A second, finished legacy generation and one with no log at all.
    const { otherId, emptyId } = await f.t.run(async (ctx) => ({
      otherId: await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "completed",
        requestedAt: 5,
        startedAt: 5,
        progressLog: ["Old run."],
      }),
      emptyId: await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "failed",
        startedAt: 6,
      }),
    }));
    const before = await progress(f);

    const dry = await f.t.mutation(internal.generations.backfillGenerationProgress, { dryRun: true });
    expect(dry).toMatchObject({ copiedGenerations: 2, copiedLines: 3 });
    expect(await childRows(f)).toHaveLength(1);

    const first = await f.t.mutation(internal.generations.backfillGenerationProgress, { pageSize: 1 });
    expect(first.isDone).toBe(false);
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const after = await f.t.run(async (ctx) => ({
      generation: await ctx.db.get(f.generationId),
      other: await ctx.db.get(otherId),
      empty: await ctx.db.get(emptyId),
    }));
    expect(typeof after.generation?.progressLogCopiedAt).toBe("number");
    expect(typeof after.other?.progressLogCopiedAt).toBe("number");
    expect(after.empty?.progressLogCopiedAt).toBeUndefined();
    // The array is kept; readers now read the child rows alone, in order.
    expect(after.generation?.progressLog).toEqual(["Generation started.", "✓ Analysis ready."]);
    expect(await progress(f)).toEqual(before);
    expect(await f.t.run((ctx) => allGenerationProgress(ctx, otherId))).toEqual(["Old run."]);

    const again = await f.t.mutation(internal.generations.backfillGenerationProgress, {});
    expect(again).toMatchObject({ copiedGenerations: 0, copiedLines: 0 });
    expect(await childRows(f)).toHaveLength(3);
  });

  it("copies the newest lines of a very long log and skips projects in deletion", async () => {
    const long = Array.from({ length: PROGRESS_BACKFILL_MAX_LINES + 3 }, (_, index) => `line ${index}`);
    const f = await setup({ progressLog: long });
    const deleting = await setup({ progressLog: ["Doomed."] });
    await deleting.t.run((ctx) => ctx.db.patch(deleting.projectId, { deletionStartedAt: 1 }));

    await f.t.mutation(internal.generations.backfillGenerationProgress, {});
    const rows = await childRows(f);
    expect(rows).toHaveLength(PROGRESS_BACKFILL_MAX_LINES);
    expect(rows[0].message).toBe("line 3");
    const lines = await progress(f);
    expect(lines.at(-1)).toBe(`line ${PROGRESS_BACKFILL_MAX_LINES + 2}`);

    const skipped = await deleting.t.mutation(internal.generations.backfillGenerationProgress, {});
    expect(skipped.copiedGenerations).toBe(0);
    expect(await childRows(deleting)).toEqual([]);
  });
});
