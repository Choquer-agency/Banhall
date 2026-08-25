/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const WRITER_AUTH = "writer-review-writer";

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: WRITER_AUTH,
      role: "writer",
      name: "Tracy",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Reviewed project",
      clientName: "Client",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "writer-review-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Report body",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return { projectId, reportId };
  });
  return { t, writer: t.withIdentity({ subject: WRITER_AUTH }), ...ids };
}

async function reviews(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => ctx.db.query("writerReviews").collect());
}

async function nominationJobs(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) => job.name === "brain:nominateFromReport");
  });
}

describe("submitWriterReview", () => {
  test("high review is persisted and schedules one nomination", async () => {
    const { t, writer, reportId } = await setup();

    const reviewId = await writer.mutation(api.reviews.submitWriterReview, {
      reportId,
      score: 90,
    });

    const rows = await reviews(t);
    expect(rows).toHaveLength(1);
    expect(rows[0]._id).toBe(reviewId);
    expect(rows[0].score).toBe(90);

    const jobs = await nominationJobs(t);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].args[0]).toMatchObject({ reportId, score: 90 });
  });

  test("updating a high review patches the row and schedules another nomination", async () => {
    const { t, writer, reportId } = await setup();
    const first = await writer.mutation(api.reviews.submitWriterReview, {
      reportId,
      score: 90,
    });
    const second = await writer.mutation(api.reviews.submitWriterReview, {
      reportId,
      score: 95,
    });

    expect(second).toBe(first);
    const rows = await reviews(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(95);
    expect(await nominationJobs(t)).toHaveLength(2);
  });

  test("low review is persisted without a nomination", async () => {
    const { t, writer, reportId } = await setup();
    await writer.mutation(api.reviews.submitWriterReview, { reportId, score: 60 });

    const rows = await reviews(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(60);
    expect(await nominationJobs(t)).toHaveLength(0);
  });

  test("a review rejected before the write leaves no row and no nomination", async () => {
    const { t, writer, reportId } = await setup();
    await t.run(async (ctx) => ctx.db.delete(reportId));

    await expect(
      writer.mutation(api.reviews.submitWriterReview, { reportId, score: 90 })
    ).rejects.toThrow("Report not found");

    expect(await reviews(t)).toHaveLength(0);
    expect(await nominationJobs(t)).toHaveLength(0);
  });
});
