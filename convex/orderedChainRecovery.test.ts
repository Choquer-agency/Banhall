/// <reference types="vite/client" />
/**
 * DW-119 (progress-aware recovery): failStaleGenerations must not reap an
 * ordered (single/compare) chain that is still progressing, however long ago
 * the generation started, while a chain whose current action died (no
 * progress for the window) is still failed, and iterative recovery is
 * unchanged. Time only ever moves with vi.setSystemTime, so convex-test's
 * scheduled chain actions never fire; the chain is driven through the real
 * fenced mutations instead.
 *
 * Every stamp site (createOrderedSectionRuns, claimOrderedSectionRun,
 * completeOrderedSectionRun) is exercised at its own distinct time, and each
 * reaper check below sits in a window where exactly one of those stamps is
 * recent — so removing any single stamp site fails a test.
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
/** The reaper's page over running generations (generations.ts
 * STALE_GENERATION_SCAN_PAGE_SIZE); spelled out so the seed below fills
 * exactly one production-sized page. */
const SCAN_PAGE_SIZE = 100;
/** The generation started (analyzer / Brief phase) well before its chain. */
const STARTED_AT = T0 - 40 * MINUTES;

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

type T = TestConvex<typeof schema>;
type Section = "242" | "244" | "246";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

async function seedProject(t: T) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", { authId: "chain-user", role: "writer" });
    const projectId = await ctx.db.insert("projects", {
      title: "Ordered chain project",
      clientName: "Client",
      status: "generating",
      createdBy: userId,
      shareToken: `chain-token-${now}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
    const transcriptId = await ctx.db.insert("transcripts", {
      projectId,
      content: "Interview content",
      createdAt: now,
    });
    return { projectId, transcriptId };
  });
}

async function seedOrderedGeneration(
  t: T,
  candidateMode: "compare" | "single" | "iterative",
  options: { candidates?: number; startedAt?: number } = {}
) {
  const { projectId, transcriptId } = await seedProject(t);
  return await t.run(async (ctx) => {
    const now = Date.now();
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId,
      status: "running",
      candidateMode,
      previousProjectStatus: "draft",
      startedAt: options.startedAt ?? STARTED_AT,
    });
    await ctx.db.patch(projectId, { activeGenerationId: generationId });
    const candidateRunIds: Id<"generationCandidateRuns">[] = [];
    for (let index = 0; index < (options.candidates ?? 1); index += 1) {
      candidateRunIds.push(
        await ctx.db.insert("generationCandidateRuns", {
          generationId,
          projectId,
          model: index === 0 ? "claude-sonnet-5" : "openai/gpt-5.1",
          label: index === 0 ? "Sonnet 5" : "GPT-5.1",
          status: "running",
          queuedAt: now,
          startedAt: now,
        })
      );
    }
    return { projectId, generationId, candidateRunId: candidateRunIds[0], candidateRunIds };
  });
}

type Seeded = Awaited<ReturnType<typeof seedOrderedGeneration>>;

function chainOf(
  t: T,
  generationId: Id<"generations">,
  candidateRunId: Id<"generationCandidateRuns">
) {
  return {
    create: () =>
      t.mutation(internal.generations.createOrderedSectionRuns, {
        generationId,
        candidateRunId,
        payload: PAYLOAD,
      }),
    claim: (section: Section) =>
      t.mutation(internal.generations.claimOrderedSectionRun, {
        generationId,
        candidateRunId,
        section,
      }),
    complete: (section: Section) =>
      t.mutation(internal.generations.completeOrderedSectionRun, {
        generationId,
        candidateRunId,
        section,
        draftText: `Line ${section} draft`,
        metrics: "{}",
        selfCheck: JSON.stringify({ status: "passed" }),
        slotCounts: "{}",
        notes: [],
        payload: PAYLOAD,
      }),
  };
}

async function reapAt(t: T, atMs: number) {
  vi.setSystemTime(atMs);
  return await t.mutation(internal.generations.failStaleGenerations, {
    olderThanMinutes: 30,
  });
}

async function stateOf(t: T, ids: Seeded) {
  return await t.run(async (ctx) => ({
    generation: await ctx.db.get(ids.generationId),
    runs: await Promise.all(ids.candidateRunIds.map((id) => ctx.db.get(id))),
    project: await ctx.db.get(ids.projectId),
    sections: (
      await ctx.db
        .query("generationSectionRuns")
        .withIndex("by_generationId", (q) => q.eq("generationId", ids.generationId))
        .collect()
    ).sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0)),
  }));
}

async function expectLive(t: T, ids: Seeded) {
  const state = await stateOf(t, ids);
  expect(state.generation?.status).toBe("running");
  for (const run of state.runs) expect(run?.status).toBe("running");
  expect(state.project?.activeGenerationId).toBe(ids.generationId);
  return state;
}

async function expectWholeFailed(t: T, ids: Seeded) {
  const state = await stateOf(t, ids);
  expect(state.generation?.status).toBe("failed");
  expect(state.generation?.error).toBe("Timed out before generation completed.");
  for (const run of state.runs) {
    expect(run?.status).toBe("failed");
    expect(run?.error).toBe("Timed out before the draft completed.");
  }
  expect(state.project?.activeGenerationId).toBeUndefined();
  expect(state.project?.status).toBe("draft");
  return state;
}

describe("DW-119: failStaleGenerations is progress-aware for ordered chains", () => {
  it("(a) never reaps a chain whose sections keep completing; each stamp site alone keeps it live in its window", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "compare");
    const chain = chainOf(t, ids.generationId, ids.candidateRunId);

    // T0: the chain is created 40 minutes after startedAt; the first action
    // has not claimed yet (scheduler lag). Only the CREATE stamp is recent.
    expect(await chain.create()).toBe(true);
    expect((await reapAt(t, T0 + 5 * MINUTES)).failed).toBe(0);
    await expectLive(t, ids);

    // T0+20: the action claims 242. At T0+45 the cutoff is T0+15, so the
    // create stamp (T0) is stale and only the CLAIM stamp keeps it live.
    vi.setSystemTime(T0 + 20 * MINUTES);
    expect(await chain.claim("242")).not.toBeNull();
    expect((await reapAt(t, T0 + 45 * MINUTES)).failed).toBe(0);
    let state = await expectLive(t, ids);
    expect(state.sections.map((row) => row.status)).toEqual(["running", "pending", "pending"]);

    // T0+50: 242 drafted (244 queued, not yet claimed). At T0+75 the cutoff
    // is T0+45, so only the COMPLETION stamp keeps it live.
    vi.setSystemTime(T0 + 50 * MINUTES);
    expect(await chain.complete("242")).toBe(true);
    expect((await reapAt(t, T0 + 75 * MINUTES)).failed).toBe(0);
    state = await expectLive(t, ids);
    expect(state.sections.map((row) => row.status)).toEqual(["drafted", "queued", "pending"]);

    // The rest of the chain, well past 30 minutes since startedAt.
    vi.setSystemTime(T0 + 80 * MINUTES);
    expect(await chain.claim("244")).not.toBeNull();
    vi.setSystemTime(T0 + 100 * MINUTES);
    expect(await chain.complete("244")).toBe(true);
    vi.setSystemTime(T0 + 105 * MINUTES);
    expect(await chain.claim("246")).not.toBeNull();
    expect((await reapAt(t, T0 + 130 * MINUTES)).failed).toBe(0);
    state = await expectLive(t, ids);
    expect(state.sections.map((row) => row.status)).toEqual(["drafted", "drafted", "running"]);
  });

  it("(a') a stamp exactly at the cutoff is still progress; one millisecond past it is not", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "single");
    const chain = chainOf(t, ids.generationId, ids.candidateRunId);
    expect(await chain.create()).toBe(true);
    vi.setSystemTime(T0 + 20 * MINUTES);
    expect(await chain.claim("242")).not.toBeNull();

    // cutoff === lastProgressAt: live.
    expect((await reapAt(t, T0 + 50 * MINUTES)).failed).toBe(0);
    await expectLive(t, ids);
    // cutoff === lastProgressAt + 1 ms: stale.
    expect((await reapAt(t, T0 + 50 * MINUTES + 1)).failed).toBe(1);
    await expectWholeFailed(t, ids);
  });

  it("(b) reaps a chain with no progress for 30 minutes after its last drafted section", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "single");
    const chain = chainOf(t, ids.generationId, ids.candidateRunId);
    expect(await chain.create()).toBe(true);
    vi.setSystemTime(T0 + 5 * MINUTES);
    expect(await chain.claim("242")).not.toBeNull();

    // 242 drafted at T0+20, 244 claimed at T0+25, then its action dies:
    // nothing stamps progress again. 29 minutes after the last stamp: live.
    vi.setSystemTime(T0 + 20 * MINUTES);
    expect(await chain.complete("242")).toBe(true);
    vi.setSystemTime(T0 + 25 * MINUTES);
    expect(await chain.claim("244")).not.toBeNull();
    expect((await reapAt(t, T0 + 54 * MINUTES)).failed).toBe(0);
    await expectLive(t, ids);

    // 31 minutes after the last stamp: reaped exactly as before DW-119.
    expect((await reapAt(t, T0 + 56 * MINUTES)).failed).toBe(1);
    const state = await expectWholeFailed(t, ids);
    expect(state.sections.map((row) => row.status)).toEqual(["drafted", "running", "pending"]);
  });

  it("(b') a first section action that never completes is reaped 30 minutes after its claim", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "compare");
    const chain = chainOf(t, ids.generationId, ids.candidateRunId);
    expect(await chain.create()).toBe(true);
    vi.setSystemTime(T0 + 3 * MINUTES);
    expect(await chain.claim("242")).not.toBeNull();

    expect((await reapAt(t, T0 + 34 * MINUTES)).failed).toBe(1);
    await expectWholeFailed(t, ids);
  });

  it("(b'') two compare candidates share one progress clock: a stuck candidate is protected by the other's progress, then reaped with it", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "compare", { candidates: 2 });
    const [runA, runB] = ids.candidateRunIds;
    const chainA = chainOf(t, ids.generationId, runA);
    const chainB = chainOf(t, ids.generationId, runB);
    expect(await chainA.create()).toBe(true);
    expect(await chainB.create()).toBe(true);
    vi.setSystemTime(T0 + 1 * MINUTES);
    expect(await chainA.claim("242")).not.toBeNull();
    vi.setSystemTime(T0 + 2 * MINUTES);
    expect(await chainB.claim("242")).not.toBeNull();

    // B's action dies; A drafts 242 at T0+30. At T0+55 (cutoff T0+25) A's
    // completion is the generation's only recent progress: B is untouched.
    vi.setSystemTime(T0 + 30 * MINUTES);
    expect(await chainA.complete("242")).toBe(true);
    expect((await reapAt(t, T0 + 55 * MINUTES)).failed).toBe(0);
    await expectLive(t, ids);

    // A's next action never claims either: no progress from anyone for 31
    // minutes fails the generation and both candidate runs together.
    expect((await reapAt(t, T0 + 61 * MINUTES)).failed).toBe(1);
    await expectWholeFailed(t, ids);
  });

  async function seedStaleIterativeSection(t: T, ids: Seeded) {
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
    t: T,
    ids: Seeded,
    sectionRunId: Id<"generationSectionRuns">
  ) {
    expect((await reapAt(t, T0 + 31 * MINUTES)).failed).toBe(1);
    const state = await stateOf(t, ids);
    const section = await t.run((ctx) => ctx.db.get(sectionRunId));
    expect(state.generation?.status).toBe("awaiting_input");
    expect(state.generation?.currentStep).toBe("Section draft timed out — regenerate to retry");
    expect(section?.status).toBe("failed");
    expect(section?.error).toBe("Timed out before the section draft completed.");
    // Iterative's per-section recovery never touches the candidate run or
    // the project's active pointer.
    expect(state.runs[0]?.status).toBe("running");
    expect(state.project?.activeGenerationId).toBe(ids.generationId);
  }

  it("(c) iterative recovery is unchanged: a stale section run fails alone and hands control back to the writer", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "iterative", { startedAt: T0 });
    const sectionRunId = await seedStaleIterativeSection(t, ids);
    await expectIterativeSectionRecovery(t, ids, sectionRunId);
  });

  it("(c') a progress stamp never governs iterative recovery, which keys on the section run's own clock", async () => {
    const t = convexTest(schema, modules);
    const ids = await seedOrderedGeneration(t, "iterative", { startedAt: T0 });
    const sectionRunId = await seedStaleIterativeSection(t, ids);
    // Iterative never stamps progress; even a fresh stamp must not change it.
    vi.setSystemTime(T0 + 30 * MINUTES);
    await t.run((ctx) => ctx.db.patch(ids.generationId, { lastProgressAt: Date.now() }));
    await expectIterativeSectionRecovery(t, ids, sectionRunId);
  });
});

describe("DW-119 review: the running scan pages past live chains", () => {
  it("fails a stalled generation behind a full page of older, still-progressing ones", async () => {
    const t = convexTest(schema, modules);
    const { projectId, transcriptId } = await seedProject(t);
    const stalled = await seedOrderedGeneration(t, "single", { startedAt: T0 - 60 * MINUTES });
    // 100 generations older than the stalled one (index order is startedAt
    // ascending), every one of them progressing — they fill the first page.
    const liveIds = await t.run(async (ctx) => {
      const ids: Id<"generations">[] = [];
      for (let index = 0; index < SCAN_PAGE_SIZE; index += 1) {
        ids.push(
          await ctx.db.insert("generations", {
            projectId,
            transcriptId,
            status: "running",
            candidateMode: "compare",
            previousProjectStatus: "draft",
            startedAt: T0 - 120 * MINUTES + index,
            lastProgressAt: T0 + 60 * MINUTES,
          })
        );
      }
      return ids;
    });
    // The stalled chain: claimed at T0, then nothing.
    const chain = chainOf(t, stalled.generationId, stalled.candidateRunId);
    expect(await chain.create()).toBe(true);
    expect(await chain.claim("242")).not.toBeNull();

    const first = await reapAt(t, T0 + 61 * MINUTES);
    // The cron's single call plus whatever it scheduled for itself.
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expectWholeFailed(t, stalled);
    const live = await t.run(async (ctx) =>
      await Promise.all(liveIds.map((id) => ctx.db.get(id)))
    );
    for (const generation of live) expect(generation?.status).toBe("running");
    // One bounded page per transaction; the rest was handed off, not dropped.
    expect(first.scanned).toBe(SCAN_PAGE_SIZE);
    expect(first.isDone).toBe(false);
  });
});
