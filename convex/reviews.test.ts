/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// CAP-4b (story 5): submitWriterReview nominates a highly rated report to the
// Brain only after its writerReviews row is persisted, and the nomination
// carries that row's id. Scheduler calls inside a mutation commit with the
// mutation, so a rejected or failed write leaves no nomination behind.

const REPORT_DOC = JSON.stringify({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "The team tested the alloy at low temperature and recorded the fatigue curve.",
        },
      ],
    },
  ],
});

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", {
      authId: "rv-writer",
      role: "writer",
      firstName: "Tracy",
      lastName: "Chen",
    });
    // Mapped and signed in, but holds no internal role.
    await ctx.db.insert("users", { authId: "rv-roleless", firstName: "Rory" });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "review",
      industry: "manufacturing",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "rv-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 2,
      generatedAt: now,
      updatedAt: now,
    });
    // A report id that resolves to nothing: the failed-lookup case.
    const missingReportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    await ctx.db.delete(missingReportId);
    return { writerId, projectId, reportId, missingReportId };
  });
  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "rv-writer" }),
    roleless: t.withIdentity({ subject: "rv-roleless" }),
    // No JWT at all.
    noIdentity: t,
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function writerReviews(f: Fixture) {
  return await f.t.run((ctx) => ctx.db.query("writerReviews").take(50));
}

/** Brain nominations queued by the mutation under test, in any state. */
async function nominations(f: Fixture) {
  return await f.t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name.includes("nominateFromReport"));
  });
}

/** Typed domain-error code of a rejected call, or a marker for other outcomes. */
async function errorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

// The harness runs a runAfter(0) job on the next real macrotask. Fake timers
// keep every scheduled job pending until a test advances them explicitly, so
// the scheduled-function table can be inspected deterministically.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitWriterReview Brain nomination", () => {
  test("a score of 85 or more persists the review and schedules exactly one nomination carrying its id", async () => {
    const f = await setup();
    const reviewId = await f.writer.mutation(api.reviews.submitWriterReview, {
      reportId: f.reportId,
      score: 90,
      comment: "  Strong draft  ",
      aiScore: 82,
    });

    const rows = await writerReviews(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(reviewId);
    expect(rows[0]).toMatchObject({
      projectId: f.projectId,
      reportId: f.reportId,
      reportVersion: 2,
      userId: f.writerId,
      writerName: "Tracy Chen",
      score: 90,
      comment: "Strong draft",
      aiScore: 82,
    });

    const jobs = await nominations(f);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state.kind).toBe("pending");
    expect(jobs[0].args[0]).toMatchObject({
      reportId: f.reportId,
      writerName: "Tracy Chen",
      score: 90,
      reviewId,
    });
  });

  test("the scheduled nomination lands a pending Brain source whose actor records the review id", async () => {
    const f = await setup();
    const reviewId = await f.writer.mutation(api.reviews.submitWriterReview, {
      reportId: f.reportId,
      score: 92,
    });

    vi.runAllTimers();
    await f.t.finishInProgressScheduledFunctions();

    const jobs = await nominations(f);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].state.kind).toBe("success");

    const actor = `auto-nominate:score-92:review-${reviewId}`;
    const sources = await f.t.run((ctx) => ctx.db.query("brainSources").take(10));
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      kind: "pd_pair",
      // Never auto-approved: the admin queue stays the only gate.
      status: "pending",
      sourceProjectId: f.projectId,
      writerName: "Tracy Chen",
      createdBy: actor,
    });
    const audit = await f.t.run((ctx) => ctx.db.query("brainAuditLog").take(10));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "ingest",
      sourceId: sources[0]._id,
      actorId: actor,
    });
  });

  test("re-submitting updates the same row and nominates with that same id", async () => {
    const f = await setup();
    const first = await f.writer.mutation(api.reviews.submitWriterReview, {
      reportId: f.reportId,
      score: 70,
    });
    expect(await nominations(f)).toEqual([]);

    const second = await f.writer.mutation(api.reviews.submitWriterReview, {
      reportId: f.reportId,
      score: 88,
      comment: "Better after edits",
    });
    expect(second).toBe(first);

    const rows = await writerReviews(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: first, score: 88, comment: "Better after edits" });

    const jobs = await nominations(f);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({ score: 88, reviewId: first });
  });

  test("a score below 85 persists the review and schedules no nomination", async () => {
    const f = await setup();
    const reviewId = await f.writer.mutation(api.reviews.submitWriterReview, {
      reportId: f.reportId,
      score: 84,
    });
    const rows = await writerReviews(f);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ _id: reviewId, score: 84 });
    expect(await nominations(f)).toEqual([]);
  });

  test("a missing report throws, leaving no review row and no nomination", async () => {
    const f = await setup();
    expect(
      await errorCode(() =>
        f.writer.mutation(api.reviews.submitWriterReview, {
          reportId: f.missingReportId,
          score: 95,
        })
      )
    ).toBe("NOT_FOUND");
    expect(await writerReviews(f)).toEqual([]);
    expect(await nominations(f)).toEqual([]);
  });

  test("an ineligible caller is rejected, leaving no review row and no nomination", async () => {
    const f = await setup();
    expect(
      await errorCode(() =>
        f.roleless.mutation(api.reviews.submitWriterReview, {
          reportId: f.reportId,
          score: 95,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(
      await errorCode(() =>
        f.noIdentity.mutation(api.reviews.submitWriterReview, {
          reportId: f.reportId,
          score: 95,
        })
      )
    ).toBe("NOT_AUTHENTICATED");
    expect(await writerReviews(f)).toEqual([]);
    expect(await nominations(f)).toEqual([]);
  });
});
