/// <reference types="vite/client" />
/**
 * CAP-11: the orphaned-project sweep walks projects.by_status ("generating")
 * in bounded pages, one page per transaction, until every eligible project is
 * reached. Nothing here reads more than one page in a single mutation, and no
 * fixed cap (the old take(500)) limits how far the sweep goes.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { STALE_PROJECT_SWEEP_PAGE_SIZE } from "./generations";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const MINUTES = 60 * 1000;
const ORPHANED_COUNT = 7;
const PAGE_SIZE = 3;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

type Seed = Awaited<ReturnType<typeof seed>>;

/**
 * 7 orphaned "generating" projects (stale, no pointer, no live generation —
 * two carry terminal failed/superseded attempt history), 2 review projects,
 * 1 "generating" project fenced on a live running generation, and 1
 * "generating" project touched after the cutoff. The "generating" index range
 * therefore holds 9 rows.
 */
async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const now = Date.now();
    const old = now - 60 * MINUTES;
    const cutoff = now - 30 * MINUTES;
    const userId = await ctx.db.insert("users", { authId: "reaper-user", role: "writer" });
    const insertProject = async (
      title: string,
      status: "generating" | "review",
      updatedAt: number
    ) =>
      await ctx.db.insert("projects", {
        title,
        clientName: "Client",
        status,
        createdBy: userId,
        shareToken: `token-${title}`,
        createdAt: old,
        updatedAt,
      });
    const insertGeneration = async (
      projectId: Id<"projects">,
      status: "failed" | "superseded" | "running",
      startedAt: number
    ) => {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Interview content",
        createdAt: old,
      });
      return await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status,
        candidateMode: "compare",
        previousProjectStatus: "draft",
        startedAt,
        ...(status === "running" ? {} : { completedAt: startedAt }),
      });
    };

    const orphaned: Id<"projects">[] = [];
    for (let i = 0; i < ORPHANED_COUNT; i += 1) {
      orphaned.push(await insertProject(`orphan-${i}`, "generating", old));
    }
    await insertGeneration(orphaned[0], "failed", old);
    await insertGeneration(orphaned[1], "superseded", old);
    const review = [
      await insertProject("review-0", "review", old),
      await insertProject("review-1", "review", old),
    ];
    const liveProjectId = await insertProject("live", "generating", old);
    const liveGenerationId = await insertGeneration(liveProjectId, "running", now);
    await ctx.db.patch(liveProjectId, { activeGenerationId: liveGenerationId });
    const freshProjectId = await insertProject("fresh", "generating", now);
    return { cutoff, old, orphaned, review, liveProjectId, liveGenerationId, freshProjectId };
  });
}

async function sweepJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    (await ctx.db.system.query("_scheduled_functions").collect()).filter((job) =>
      job.name.includes("freeOrphanedGeneratingProjects")
    )
  );
}

async function snapshot(t: ReturnType<typeof convexTest>, s: Seed) {
  return await t.run(async (ctx) => ({
    orphaned: await Promise.all(s.orphaned.map((id) => ctx.db.get(id))),
    review: await Promise.all(s.review.map((id) => ctx.db.get(id))),
    live: await ctx.db.get(s.liveProjectId),
    fresh: await ctx.db.get(s.freshProjectId),
  }));
}

function expectAllOrphansFreed(state: Awaited<ReturnType<typeof snapshot>>) {
  expect(state.orphaned).toHaveLength(ORPHANED_COUNT);
  for (const project of state.orphaned) {
    expect(project?.status).toBe("draft");
    expect(project?.activeGenerationId).toBeUndefined();
    expect(project?.generationActivity).toBeUndefined();
  }
}

function expectIneligibleUntouched(state: Awaited<ReturnType<typeof snapshot>>, s: Seed) {
  for (const project of state.review) {
    expect(project?.status).toBe("review");
    expect(project?.updatedAt).toBe(s.old);
  }
  // Fenced on a live generation: skipped even though it is older than the cutoff.
  expect(state.live?.status).toBe("generating");
  expect(state.live?.activeGenerationId).toBe(s.liveGenerationId);
  expect(state.live?.updatedAt).toBe(s.old);
  // Touched after the cutoff: not stale yet.
  expect(state.fresh?.status).toBe("generating");
}

describe("freeOrphanedGeneratingProjects", () => {
  it("frees every orphaned project across pages, one bounded page per transaction", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const first = await t.mutation(internal.generations.freeOrphanedGeneratingProjects, {
      cutoff: s.cutoff,
      pageSize: PAGE_SIZE,
    });
    // The first transaction read exactly one page and handed off the rest.
    expect(first.scanned).toBe(PAGE_SIZE);
    expect(first.isDone).toBe(false);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const state = await snapshot(t, s);
    expectAllOrphansFreed(state);
    expectIneligibleUntouched(state, s);

    // 9 rows sit in the "generating" index range; at 3 per page that is
    // ceil(9/3) = 3 transactions: the direct call plus two scheduled
    // continuations, each carrying the cursor and the overridden page size.
    const jobs = await sweepJobs(t);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.state.kind).toBe("success");
      expect(job.args[0]).toMatchObject({ cutoff: s.cutoff, pageSize: PAGE_SIZE });
      expect(typeof job.args[0].cursor).toBe("string");
    }
  });

  it("finishes in one transaction when the default page holds every project", async () => {
    expect(STALE_PROJECT_SWEEP_PAGE_SIZE).toBe(100);
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const result = await t.mutation(internal.generations.freeOrphanedGeneratingProjects, {
      cutoff: s.cutoff,
    });
    expect(result).toEqual({ freed: ORPHANED_COUNT, scanned: ORPHANED_COUNT + 2, isDone: true });
    expect(await sweepJobs(t)).toHaveLength(0);

    const state = await snapshot(t, s);
    expectAllOrphansFreed(state);
    expectIneligibleUntouched(state, s);
  });

  it("is scheduled by failStaleGenerations instead of scanning inline", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);

    const result = await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });
    const pending = await sweepJobs(t);
    expect(pending).toHaveLength(1);
    expect(pending[0]._id).toBe(result.projectSweepJobId);
    expect(pending[0].state.kind).toBe("pending");
    // The first page starts from the beginning of the range at the default size.
    expect(Object.keys(pending[0].args[0])).toEqual(["cutoff"]);
    expect(pending[0].args[0].cutoff).toBeGreaterThanOrEqual(s.cutoff);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const state = await snapshot(t, s);
    expectAllOrphansFreed(state);
    expectIneligibleUntouched(state, s);
    // The live generation is fresh, so the whole-fail sweep left it alone too.
    const live = await t.run(async (ctx) => await ctx.db.get(s.liveGenerationId));
    expect(live?.status).toBe("running");
  });
});
