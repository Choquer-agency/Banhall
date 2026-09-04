/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { sha256 } from "./lib/contracts";

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

describe("CAP-9 review provenance", () => {
  test.each([
    {
      revisionNumber: 4,
      contentHash: "stored-report-hash",
      expectedRevision: 4,
    },
    {
      revisionNumber: undefined,
      contentHash: "stored-legacy-hash",
      expectedRevision: 0,
    },
    { revisionNumber: 6, contentHash: undefined, expectedRevision: 6 },
  ])(
    "new writer and QA reviews independently pin revision $revisionNumber and hash $contentHash",
    async ({ revisionNumber, contentHash, expectedRevision }) => {
      const f = await setup();
      await f.t.run((ctx) =>
        ctx.db.patch(f.reportId, { revisionNumber, contentHash })
      );
      const writerId = await f.writer.mutation(api.reviews.submitWriterReview, {
        reportId: f.reportId,
        score: 70,
      });
      const qaId = await f.writer.mutation(api.reviews.saveQaItemFeedback, {
        target: { reportId: f.reportId },
        itemKey: "risk",
        itemKind: "issue",
        section: "242",
        itemText: "Risk",
        vote: 1,
      });
      for (const id of [writerId, qaId]) {
        expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
          revisionNumber: expectedRevision,
          contentHash: contentHash ?? (await sha256(REPORT_DOC)),
          userId: f.writerId,
        });
      }
    }
  );

  test.each([undefined, ""])(
    "legacy report hash %s falls back for writer and QA inserts and updates",
    async (contentHash) => {
      const f = await setup();
      await f.t.run((ctx) => ctx.db.patch(f.reportId, { contentHash }));
      const writerId = await f.writer.mutation(api.reviews.submitWriterReview, {
        reportId: f.reportId,
        score: 70,
      });
      const feedback = {
        target: { reportId: f.reportId },
        itemKey: "risk",
        itemKind: "issue" as const,
        section: "242",
        itemText: "Clarify uncertainty",
        vote: 1 as const,
      };
      const qaId = await f.writer.mutation(
        api.reviews.saveQaItemFeedback,
        feedback
      );
      const expectedHash = await sha256(REPORT_DOC);
      for (const id of [writerId, qaId]) {
        expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
          revisionNumber: 0,
          contentHash: expectedHash,
        });
      }
      await f.t.run((ctx) =>
        ctx.db.patch(f.reportId, {
          content: "Edited report",
          revisionNumber: 3,
          contentHash: "stored-edited-hash",
        })
      );
      expect(
        await f.writer.mutation(api.reviews.submitWriterReview, {
          reportId: f.reportId,
          score: 80,
        })
      ).toBe(writerId);
      expect(
        await f.writer.mutation(api.reviews.saveQaItemFeedback, feedback)
      ).toBe(qaId);
      for (const id of [writerId, qaId]) {
        expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
          revisionNumber: 3,
          contentHash: "stored-edited-hash",
          userId: f.writerId,
        });
      }
      await f.t.run((ctx) =>
        ctx.db.patch(f.reportId, {
          content: "Edited legacy",
          revisionNumber: undefined,
          contentHash: "",
        })
      );
      await f.writer.mutation(api.reviews.submitWriterReview, {
        reportId: f.reportId,
        score: 80,
      });
      await f.writer.mutation(api.reviews.saveQaItemFeedback, feedback);
      for (const id of [writerId, qaId]) {
        expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
          revisionNumber: 0,
          contentHash: await sha256("Edited legacy"),
        });
      }
    }
  );

  test("candidate feedback retains its key after selection but pins the submitted report", async () => {
    const f = await setup();
    const { generationId, candidateId } = await f.t.run(async (ctx) => {
      const generationId = await ctx.db.insert("generations", {
        projectId: f.projectId,
        status: "awaiting_selection",
        startedAt: Date.now(),
      });
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId: f.projectId,
        generationId,
        model: "test",
        label: "A",
        content: REPORT_DOC,
        agentOutputs: "{}",
        createdAt: Date.now(),
      });
      return { generationId, candidateId };
    });
    const feedback = {
      itemKey: "risk",
      itemKind: "issue" as const,
      section: "242",
      itemText: "Risk",
      vote: 1 as const,
    };
    const qaId = await f.writer.mutation(api.reviews.saveQaItemFeedback, {
      ...feedback,
      target: { candidateId },
    });
    expect(await f.t.run((ctx) => ctx.db.get(qaId))).toMatchObject({
      revisionNumber: 0,
      contentHash: await sha256(REPORT_DOC),
    });
    await f.t.run((ctx) =>
      ctx.db.patch(candidateId, { content: "Changed candidate" })
    );
    expect(
      await f.writer.mutation(api.reviews.saveQaItemFeedback, {
        ...feedback,
        target: { candidateId },
      })
    ).toBe(qaId);
    expect(await f.t.run((ctx) => ctx.db.get(qaId))).toMatchObject({
      revisionNumber: 0,
      contentHash: await sha256("Changed candidate"),
    });
    const reportId = await f.writer.mutation(
      api.generations.selectReportCandidate,
      { generationId, candidateId }
    );
    await f.t.run((ctx) =>
      ctx.db.patch(reportId, {
        content: "Edited selected report",
        revisionNumber: 2,
        contentHash: "selected-report-hash",
      })
    );
    expect(
      await f.writer.mutation(api.reviews.saveQaItemFeedback, {
        ...feedback,
        target: { reportId },
      })
    ).toBe(qaId);
    const rows = await f.t.run((ctx) =>
      ctx.db.query("qaItemFeedback").collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      targetKey: `candidate:${candidateId}`,
      revisionNumber: 2,
      contentHash: "selected-report-hash",
    });
  });

  test("legacy writer and QA queries preserve absence until resubmission pins the same rows", async () => {
    const f = await setup();
    const { writerId, qaId } = await f.t.run(async (ctx) => {
      const writerId = await ctx.db.insert("writerReviews", {
        projectId: f.projectId,
        reportId: f.reportId,
        userId: f.writerId,
        score: 71,
        createdAt: 0,
        updatedAt: 0,
      });
      const qaId = await ctx.db.insert("qaItemFeedback", {
        projectId: f.projectId,
        reportId: f.reportId,
        targetKey: `report:${f.reportId}`,
        userId: f.writerId,
        itemKey: "risk",
        itemKind: "issue",
        section: "242",
        itemText: "Risk",
        createdAt: 0,
        updatedAt: 0,
      });
      return { writerId, qaId };
    });
    expect(
      await f.writer.query(api.reviews.getMyWriterReview, {
        reportId: f.reportId,
      })
    ).toEqual({ score: 71, comment: "" });
    expect(
      await f.writer.query(api.reviews.getMyQaItemFeedback, {
        target: { reportId: f.reportId },
      })
    ).toEqual([{ itemKey: "risk", overrideSeverity: null, vote: null }]);
    for (const row of await f.t.run(async (ctx) => [
      ...(await ctx.db.query("writerReviews").collect()),
      ...(await ctx.db.query("qaItemFeedback").collect()),
    ])) {
      expect(row).not.toHaveProperty("revisionNumber");
      expect(row).not.toHaveProperty("contentHash");
    }
    expect(
      await f.writer.mutation(api.reviews.submitWriterReview, {
        reportId: f.reportId,
        score: 78,
      })
    ).toBe(writerId);
    expect(
      await f.writer.mutation(api.reviews.saveQaItemFeedback, {
        target: { reportId: f.reportId },
        itemKey: "risk",
        itemKind: "issue",
        section: "242",
        itemText: "Risk",
        vote: 1,
      })
    ).toBe(qaId);
    for (const id of [writerId, qaId]) {
      expect(await f.t.run((ctx) => ctx.db.get(id))).toMatchObject({
        revisionNumber: 0,
        contentHash: await sha256(REPORT_DOC),
        userId: f.writerId,
      });
    }
    expect(await writerReviews(f)).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("qaItemFeedback").collect())
    ).toHaveLength(1);
  });
});
