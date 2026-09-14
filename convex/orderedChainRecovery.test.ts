/// <reference types="vite/client" />
/**
 * DW-119 (progress-aware recovery): failStaleGenerations must not reap an
 * ordered (single/compare) chain that is still progressing, however long ago
 * the generation started, while a chain whose current action died (no
 * progress for the window) is still failed, and iterative recovery is
 * unchanged. Time only ever moves with vi.setSystemTime, so convex-test's
 * scheduled chain actions never fire; the chain is driven through the real
 * fenced mutations instead.
 */
import { convexTest, type TestConvex } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { OrderedPayload } from "./lib/orderedChain";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINUTES = 60 * 1000;
const T0 = new Date("2026-09-14T09:00:00.000Z").getTime();

const PAYLOAD: OrderedPayload = {
  analysis: JSON.stringify({ project_goal: "Stabilize the control loop" }),
  brainExemplars: { analyzer: "", s242: "", s244: "", s246: "" },
  orderedContext: {
    profileState: "applied",
    categoryOutcomes: [],
    buildOrder: ["242", "244", "246"],
    selfCheckRules: [],
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedOrderedGeneration(
  t: TestConvex<typeof schema>,
  candidateMode: "compare" | "single" | "iterative"
) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "chain-user", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Ordered chain project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: "chain-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "running",
      candidateMode,
      previousProjectStatus: "draft",
      startedAt: now,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const candidateRunId = await ctx.db.insert("generationCandidateRuns", {
      generationId,
      projectId,
      model: "claude-sonnet-5",
      label: "Sonnet 5",
      status: "running",
      queuedAt: now,
      startedAt: now,
    });
    return { projectId, generationId, candidateRunId };
  });
}

type Seeded = Awaited<ReturnType<typeof seedOrderedGeneration>>;

async function completeSection(
  t: TestConvex<typeof schema>,
  ids: Seeded,
  section: "242" | "244" | "246"
) {
  return await t.mutation(internal.generations.completeOrderedSectionRun, {
    generationId: ids.generationId,
    candidateRunId: ids.candidateRunId,
    section,
    draftText: `Line ${section} draft`,
    metrics: "{}",
    selfCheck: JSON.stringify({ status: "passed" }),
    slotCounts: "{}",
    notes: [],
    payload: PAYLOAD,
  });
}

async function claimSection(
  t: TestConvex<typeof schema>,
  ids: Seeded,
  section: "242" | "244" | "246"
) {
  return await t.mutation(internal.generations.claimOrderedSectionRun, {
    generationId: ids.generationId,
    candidateRunId: ids.candidateRunId,
    section,
  });
}

async function reap(t: TestConvex<typeof schema>) {
  return await t.mutation(internal.generations.failStaleGenerations, {
    olderThanMinutes: 30,
  });
}

async function stateOf(t: TestConvex<typeof schema>, ids: Seeded) {
  return await t.run(async (ctx) => ({
    generation: await ctx.db.get(ids.generationId),
    run: await ctx.db.get(ids.candidateRunId),
    project: await ctx.db.get(ids.projectId),
    sections: (
      await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", ids.generationId))
        .collect()
    ).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  }));
}

describe("DW-119: failStaleGenerations is progress-aware for ordered chains", () => {
  it("(a) never reaps a chain whose sections keep completing past 30 minutes since startedAt", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "compare");
    expect(
      await t.mutation(internal.generations.createOrderedSectionRuns, {
        generationId: ids.generationId,
        candidateRunId: ids.candidateRunId,
        payload: PAYLOAD,
      })
    ).toBe(true);
    expect(await claimSection(t, ids, "242")).not.toBeNull();

    // A slow first section: drafted 25 minutes in, which schedules 244.
    vi.setSystemTime(T0 + 25 * MINUTES);
    expect(await completeSection(t, ids, "242")).toBe(true);
    expect(await claimSection(t, ids, "244")).not.toBeNull();

    // 35 minutes after startedAt, with 244 in flight for 10 minutes: live.
    vi.setSystemTime(T0 + 35 * MINUTES);
    expect((await reap(t)).failed).toBe(0);
    let state = await stateOf(t, ids);
    expect(state.generation?.status).toBe("running");
    expect(state.run?.status).toBe("running");
    expect(state.sections.map((row) => row.status)).toEqual(["drafted", "running", "pending"]);

    // 244 drafted at 55 minutes; 246 in flight at 65 minutes: still live.
    vi.setSystemTime(T0 + 55 * MINUTES);
    expect(await completeSection(t, ids, "244")).toBe(true);
    expect(await claimSection(t, ids, "246")).not.toBeNull();
    vi.setSystemTime(T0 + 65 * MINUTES);
    expect((await reap(t)).failed).toBe(0);
    state = await stateOf(t, ids);
    expect(state.generation?.status).toBe("running");
    expect(state.run?.status).toBe("running");
    expect(state.project?.activeGenerationId).toBe(ids.generationId);
    expect(state.sections.map((row) => row.status)).toEqual(["drafted", "drafted", "running"]);
  });

  it("(b) reaps a chain with no progress for 30 minutes, including a single stuck first action", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "single");
    await t.mutation(internal.generations.createOrderedSectionRuns, {
      generationId: ids.generationId,
      candidateRunId: ids.candidateRunId,
      payload: PAYLOAD,
    });
    expect(await claimSection(t, ids, "242")).not.toBeNull();

    // 242 drafted at 20 minutes, then 244's action dies mid-flight: nothing
    // stamps progress again. 29 minutes after the last progress: still live.
    vi.setSystemTime(T0 + 20 * MINUTES);
    expect(await completeSection(t, ids, "242")).toBe(true);
    expect(await claimSection(t, ids, "244")).not.toBeNull();
    vi.setSystemTime(T0 + 49 * MINUTES);
    expect((await reap(t)).failed).toBe(0);
    expect((await stateOf(t, ids)).generation?.status).toBe("running");

    // 31 minutes after the last progress: reaped exactly as before DW-119.
    vi.setSystemTime(T0 + 51 * MINUTES);
    expect((await reap(t)).failed).toBe(1);
    const state = await stateOf(t, ids);
    expect(state.generation?.status).toBe("failed");
    expect(state.generation?.error).toBe("Timed out before generation completed.");
    expect(state.run?.status).toBe("failed");
    expect(state.run?.error).toBe("Timed out before the draft completed.");
    expect(state.project?.activeGenerationId).toBeUndefined();
    expect(state.project?.status).toBe("draft");
  });

  it("(b') a first section action that never completes is reaped 30 minutes after its claim", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "compare");
    await t.mutation(internal.generations.createOrderedSectionRuns, {
      generationId: ids.generationId,
      candidateRunId: ids.candidateRunId,
      payload: PAYLOAD,
    });
    expect(await claimSection(t, ids, "242")).not.toBeNull();

    vi.setSystemTime(T0 + 31 * MINUTES);
    expect((await reap(t)).failed).toBe(1);
    const state = await stateOf(t, ids);
    expect(state.generation?.status).toBe("failed");
    expect(state.run?.status).toBe("failed");
  });

  async function seedStaleIterativeSection(t: TestConvex<typeof schema>, ids: Seeded) {
    return await t.run(async (ctx) => {
      return await ctx.db.insert("generationSectionRuns", {
        generationId: ids.generationId,
        projectId: ids.projectId,
        section: "s242",
        status: "running",
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        attempt: 1,
        queuedAt: Date.now(),
        startedAt: Date.now(),
      });
    });
  }

  async function expectIterativeSectionRecovery(
    t: TestConvex<typeof schema>,
    ids: Seeded,
    sectionRunId: Id<"generationSectionRuns">
  ) {
    vi.setSystemTime(T0 + 31 * MINUTES);
    expect((await reap(t)).failed).toBe(1);
    const state = await stateOf(t, ids);
    const section = await t.run((ctx) => ctx.db.get(sectionRunId));
    expect(state.generation?.status).toBe("awaiting_input");
    expect(state.generation?.currentStep).toBe("Section draft timed out — regenerate to retry");
    expect(section?.status).toBe("failed");
    expect(section?.error).toBe("Timed out before the section draft completed.");
    // Iterative's per-section recovery never touches the candidate run or
    // the project's active pointer.
    expect(state.run?.status).toBe("running");
    expect(state.project?.activeGenerationId).toBe(ids.generationId);
  }

  it("(c) iterative recovery is unchanged: a stale section run fails alone and hands control back to the writer", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "iterative");
    const sectionRunId = await seedStaleIterativeSection(t, ids);
    await expectIterativeSectionRecovery(t, ids, sectionRunId);
  });

  it("(c') a progress stamp never governs iterative recovery, which keys on the section run's own clock", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "iterative");
    const sectionRunId = await seedStaleIterativeSection(t, ids);
    // Iterative never stamps progress; even a fresh stamp must not change it.
    vi.setSystemTime(T0 + 30 * MINUTES);
    await t.run((ctx) => ctx.db.patch(ids.generationId, { lastProgressAt: Date.now() }));
    await expectIterativeSectionRecovery(t, ids, sectionRunId);
  });
});
