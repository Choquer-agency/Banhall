/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DomainErrorCode } from "./lib/contracts";
import {
  SERIES_FOR_REPORT_LIMIT,
  SERIES_FOR_WRITER_LIMIT,
} from "./reportEditDistance";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

type TestConvex = ReturnType<typeof convexTest<typeof schema.tables>>;

const doc = (...paragraphs: string[]) =>
  JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  });

const DRAFT = doc("The team ran a controlled trial.", "Results were inconclusive.");
const EDITED = doc(
  "The team ran a controlled trial.",
  "Every single word below this line is completely different now."
);

async function errorCode(promise: Promise<unknown>): Promise<DomainErrorCode> {
  try {
    await promise;
  } catch (error) {
    const data = (error as { data?: { code?: DomainErrorCode } }).data;
    if (data?.code) return data.code;
    const message = (error as Error).message ?? "";
    const match = /"code":"([A-Z_]+)"/.exec(message);
    if (match) return match[1] as DomainErrorCode;
    throw error;
  }
  throw new Error("expected the call to throw");
}

type Options = {
  /** Skip inserting the `generated` baseline snapshot. */
  noBaseline?: boolean;
  /** Insert a later ghost "generated" snapshot, as the compare paths do. */
  ghostBaseline?: boolean;
  /** Leave projects.ownerId unset (legacy project). */
  ownerless?: boolean;
};

async function setup(options: Options = {}) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", {
      authId: "ped-writer",
      role: "writer",
      name: "PED Writer",
    });
    const otherWriterId = await ctx.db.insert("users", {
      authId: "ped-other-writer",
      role: "writer",
      name: "Other Writer",
    });
    await ctx.db.insert("users", { authId: "ped-admin", role: "admin" });
    await ctx.db.insert("users", { authId: "ped-manager", role: "manager" });
    await ctx.db.insert("users", {
      authId: "ped-anon-admin",
      role: "admin",
      isAnonymous: true,
    });

    const projectId = await ctx.db.insert("projects", {
      title: "PED project",
      clientName: "Test client",
      status: "review",
      createdBy: writerId,
      ...(options.ownerless ? {} : { ownerId: writerId }),
      shareToken: "ped-token",
      createdAt: now,
      updatedAt: now,
    });
    const generationId = await ctx.db.insert("generations", {
      projectId,
      status: "completed",
      requestedBy: writerId,
      candidateMode: "single",
      startedAt: now,
      completedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId,
      content: DRAFT,
      revisionNumber: 0,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    if (!options.noBaseline) {
      await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        generationId,
        content: DRAFT,
        sourceRevisionNumber: 0,
        reason: "generated",
        label: "AI draft (single)",
        createdByRole: "system",
        createdAt: now,
      });
    }
    if (options.ghostBaseline) {
      // The compare paths insert a second "generated" row AFTER the real
      // baseline; `.first()` on by_reportId must still pick the real one.
      await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        generationId,
        content: doc("Ghost comparison draft with entirely unrelated words."),
        sourceRevisionNumber: 0,
        reason: "generated",
        label: "AI draft (comparison)",
        createdByRole: "system",
        createdAt: now + 1,
      });
    }
    return { writerId, otherWriterId, projectId, generationId, reportId };
  });
  return {
    t,
    writer: t.withIdentity({ subject: "ped-writer" }),
    otherWriter: t.withIdentity({ subject: "ped-other-writer" }),
    admin: t.withIdentity({ subject: "ped-admin" }),
    manager: t.withIdentity({ subject: "ped-manager" }),
    anonAdmin: t.withIdentity({ subject: "ped-anon-admin" }),
    ...ids,
  };
}

const rows = (t: TestConvex, reportId: Id<"reports">) =>
  t.run(async (ctx) =>
    ctx.db
      .query("reportEditDistance")
      .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
      .collect()
  );

async function editReport(
  t: TestConvex,
  reportId: Id<"reports">
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(reportId, { content: EDITED, revisionNumber: 1 });
  });
}

describe("recording at the three milestones", () => {
  it("records a real candidate-selection row through selectReportCandidate", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const userId = await ctx.db.insert("users", {
        authId: "ped-select-writer",
        role: "writer",
      });
      const projectId = await ctx.db.insert("projects", {
        title: "Select project",
        clientName: "Client",
        status: "review",
        createdBy: userId,
        ownerId: userId,
        shareToken: "ped-select-token",
        createdAt: now,
        updatedAt: now,
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        status: "awaiting_selection",
        requestedBy: userId,
        candidateMode: "compare",
        startedAt: now,
      });
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        label: "A",
        model: "model-a",
        content: DRAFT,
        agentOutputs: "{}",
        createdAt: now,
      });
      return { projectId, generationId, candidateId };
    });

    const asWriter = t.withIdentity({ subject: "ped-select-writer" });
    await asWriter.mutation(api.generations.selectReportCandidate, {
      generationId: seeded.generationId,
      candidateId: seeded.candidateId,
    });

    const recorded = await t.run(async (ctx) =>
      ctx.db
        .query("reportEditDistance")
        .withIndex("by_projectId", (q) => q.eq("projectId", seeded.projectId))
        .collect()
    );
    expect(recorded).toHaveLength(1);
    expect(recorded[0].trigger).toBe("candidate_selection");
    expect(recorded[0].ped).toBe(0);
    expect(recorded[0].revisionNumber).toBe(0);

    const series = await asWriter.query(
      api.reportEditDistance.seriesForReport,
      { reportId: recorded[0].reportId }
    );
    expect(series).toHaveLength(1);
    expect(series![0].trigger).toBe("candidate_selection");
    expect(series![0].ped).toBe(0);
  });

  it("records ped > 0 at a milestone snapshot on edited content", async () => {
    const { t, writer, reportId } = await setup();
    await editReport(t, reportId);

    await writer.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId,
      label: "R1 internal review",
      expectedRevisionNumber: 1,
    });

    const recorded = await rows(t, reportId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].trigger).toBe("milestone");
    expect(recorded[0].revisionNumber).toBe(1);
    expect(recorded[0].ped).toBeGreaterThan(0);
    expect(recorded[0].ped).toBeLessThan(1);
  });

  it("uses the real baseline, not a later ghost 'generated' snapshot", async () => {
    const withGhost = await setup({ ghostBaseline: true });
    await withGhost.writer.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: withGhost.reportId,
      label: "R1 internal review",
      expectedRevisionNumber: 0,
    });
    const ghosted = await rows(withGhost.t, withGhost.reportId);
    expect(ghosted).toHaveLength(1);
    // Unedited report vs the REAL baseline => 0. Against the ghost it would be ~1.
    expect(ghosted[0].ped).toBe(0);

    // The baseline lookup is duplicated in reports.ts and lib/editDistance.ts;
    // pin BOTH surfaces on the ghost fixture so one can't be switched to
    // .order("desc") (which would pick the ghost) while the other stays put.
    const read = await withGhost.writer.query(api.reports.postEditDistance, {
      reportId: withGhost.reportId,
    });
    expect(read!.ped).toBe(0);
    expect(read!.wordSimilarity).toBe(1);
    expect(read!.draftLabel).toBe("AI draft (single)");
    expect(read!.paragraphsTotal).toBe(2);
    expect(read!.paragraphsUnchanged).toBe(2);
  });

  it("agrees with the read-time reports.postEditDistance query", async () => {
    const { t, writer, reportId } = await setup();
    await editReport(t, reportId);
    await writer.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId,
      label: "R1 internal review",
      expectedRevisionNumber: 1,
    });

    const read = await writer.query(api.reports.postEditDistance, { reportId });
    const recorded = await rows(t, reportId);
    expect(read!.ped).toBe(recorded[0].ped);
    expect(Object.keys(read!).sort()).toEqual(
      [
        "baselineAt",
        "currentWords",
        "draftLabel",
        "draftWords",
        "paragraphsTotal",
        "paragraphsUnchanged",
        "ped",
        "wordSimilarity",
      ].sort()
    );
  });
});

describe("client publish trigger", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes a row via the scheduled mutation with the project owner as writer", async () => {
    const { t, writer, writerId, projectId, reportId } = await setup();
    await editReport(t, reportId);

    await writer.mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const recorded = await rows(t, reportId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].trigger).toBe("client_publish");
    expect(recorded[0].writerUserId).toBe(writerId);
    expect(recorded[0].generationId).toBeTruthy();
  });

  it("does not duplicate a repeat publish with no edit in between", async () => {
    const { t, writer, projectId, reportId } = await setup();
    await editReport(t, reportId);

    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await rows(t, reportId)).toHaveLength(1);
  });

  it("records a second publish once the report has been edited again", async () => {
    const { t, writer, projectId, reportId } = await setup();

    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    await editReport(t, reportId);
    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const recorded = await rows(t, reportId);
    expect(recorded).toHaveLength(2);
    expect(recorded.map((r) => r.trigger)).toEqual([
      "client_publish",
      "client_publish",
    ]);
    expect(recorded[0].ped).toBe(0);
    expect(recorded[1].ped).toBeGreaterThan(0);
    expect(recorded[0].ped).not.toBe(recorded[1].ped);
  });

  it("records both a milestone and a publish on the same revision", async () => {
    const { t, writer, projectId, reportId } = await setup();
    await editReport(t, reportId);

    await writer.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId,
      label: "R1 internal review",
      expectedRevisionNumber: 1,
    });
    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const recorded = await rows(t, reportId);
    expect(recorded.map((r) => r.trigger).sort()).toEqual([
      "client_publish",
      "milestone",
    ]);
  });

  it("leaves writerUserId unset on an ownerless legacy project", async () => {
    const { t, admin, projectId, reportId } = await setup({ ownerless: true });
    await admin.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const recorded = await rows(t, reportId);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].writerUserId).toBeUndefined();
  });
});

describe("no baseline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes nothing and still completes every trigger", async () => {
    const { t, writer, projectId, reportId } = await setup({ noBaseline: true });

    const snapshotId = await writer.mutation(
      api.snapshots.createMilestoneSnapshot,
      { reportId, label: "R1 internal review", expectedRevisionNumber: 0 }
    );
    expect(snapshotId).toBeTruthy();

    await writer.mutation(api.projects.publishForReview, { projectId, reportId });
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    const project = await t.run(async (ctx) => ctx.db.get(projectId));
    expect(project!.status).toBe("client_review");

    expect(await rows(t, reportId)).toHaveLength(0);
  });

  it("recordAtPublish is a no-op when the report is gone", async () => {
    const { t, reportId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(reportId);
    });
    await expect(
      t.mutation(internal.reportEditDistance.recordAtPublish, { reportId })
    ).resolves.toBeNull();
    expect(await rows(t, reportId)).toHaveLength(0);
  });
});

describe("seriesForReport", () => {
  it("denies authenticated callers without internal eligibility", async () => {
    const { t, writer, anonAdmin, reportId } = await setup();
    await writer.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId,
      label: "R1 internal milestone",
      expectedRevisionNumber: 0,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { authId: "ped-no-role" });
    });

    for (const caller of [
      anonAdmin,
      t.withIdentity({ subject: "ped-no-role" }),
      t.withIdentity({ subject: "ped-unmapped" }),
    ]) {
      expect(
        await caller.query(api.reportEditDistance.seriesForReport, { reportId })
      ).toBeNull();
    }
    expect(
      await writer.query(api.reportEditDistance.seriesForReport, { reportId })
    ).toHaveLength(1);
  });

  it("excludes another project's readings from an authorized report series", async () => {
    const { t, writer, reportId, projectId, otherWriterId } = await setup();
    const expectedId = await t.run(async (ctx) => {
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Other project", clientName: "Other client", status: "review",
        createdBy: otherWriterId, ownerId: otherWriterId,
        shareToken: "ped-other-project-token",
        createdAt: 0, updatedAt: 0,
      });
      const otherReportId = await ctx.db.insert("reports", {
        projectId: otherProjectId, content: DRAFT, version: 1,
        generatedAt: 0, updatedAt: 0,
      });
      await ctx.db.insert("reportEditDistance", {
        reportId: otherReportId, projectId: otherProjectId,
        revisionNumber: 0, computedAt: 1, trigger: "milestone", ped: 1,
      });
      return await ctx.db.insert("reportEditDistance", {
        reportId, projectId, revisionNumber: 0,
        computedAt: 2, trigger: "milestone", ped: 0,
      });
    });
    const series = await writer.query(api.reportEditDistance.seriesForReport, { reportId });
    expect(series?.map((row) => row._id)).toEqual([expectedId]);
  });

  it("returns null without internal access and rows oldest-first with it", async () => {
    const { t, admin, reportId, generationId } = await setup();
    await t.run(async (ctx) => {
      const report = (await ctx.db.get(reportId))!;
      const base = {
        reportId,
        projectId: report.projectId,
        generationId: report.generationId,
        revisionNumber: 0,
        computedAt: 0,
        trigger: "milestone" as const,
        ped: 0,
      };
      await ctx.db.insert("reportEditDistance", { ...base, computedAt: 300 });
      await ctx.db.insert("reportEditDistance", { ...base, computedAt: 100 });
      await ctx.db.insert("reportEditDistance", { ...base, computedAt: 200 });
    });

    expect(
      await t.query(api.reportEditDistance.seriesForReport, { reportId })
    ).toBeNull();

    const series = await admin.query(api.reportEditDistance.seriesForReport, {
      reportId,
    });
    expect(series!.map((r) => r.computedAt)).toEqual([100, 200, 300]);
    // CAP-3 joins generations.brainProvenance through this column.
    expect(series!.map((r) => r.generationId)).toEqual([
      generationId,
      generationId,
      generationId,
    ]);
  });

  it("breaks a computedAt tie on insertion order", async () => {
    // A milestone and an immediately-drained publish can share a millisecond.
    const { t, admin, reportId, projectId } = await setup();
    await t.run(async (ctx) => {
      const base = {
        reportId,
        projectId,
        revisionNumber: 1,
        computedAt: 500,
        ped: 0,
      };
      await ctx.db.insert("reportEditDistance", {
        ...base,
        trigger: "milestone",
      });
      await ctx.db.insert("reportEditDistance", {
        ...base,
        trigger: "client_publish",
      });
    });

    const series = await admin.query(api.reportEditDistance.seriesForReport, {
      reportId,
    });
    expect(series!.map((r) => r.trigger)).toEqual([
      "milestone",
      "client_publish",
    ]);
  });

  it("returns null for a missing report", async () => {
    const { t, admin, reportId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(reportId);
    });
    expect(
      await admin.query(api.reportEditDistance.seriesForReport, { reportId })
    ).toBeNull();
  });

  it("caps at the newest readings, dropping the oldest", async () => {
    const { t, admin, reportId, projectId } = await setup();
    const total = SERIES_FOR_REPORT_LIMIT + 3;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i += 1) {
        await ctx.db.insert("reportEditDistance", {
          reportId,
          projectId,
          revisionNumber: i,
          ped: 0,
          computedAt: 1000 + i,
          trigger: "milestone",
        });
      }
    });

    const series = await admin.query(api.reportEditDistance.seriesForReport, {
      reportId,
    });
    expect(series).toHaveLength(SERIES_FOR_REPORT_LIMIT);
    expect(series![0].computedAt).toBe(1000 + 3);
    expect(series![series!.length - 1].computedAt).toBe(1000 + total - 1);
  });
});

describe("seriesForWriter", () => {
  async function seed(
    t: TestConvex,
    reportId: Id<"reports">,
    projectId: Id<"projects">,
    writerUserId: Id<"users">,
    stamps: number[]
  ) {
    await t.run(async (ctx) => {
      for (const computedAt of stamps) {
        await ctx.db.insert("reportEditDistance", {
          reportId,
          projectId,
          generationId: (await ctx.db.get(reportId))!.generationId,
          writerUserId,
          revisionNumber: 0,
          ped: 0.25,
          computedAt,
          trigger: "milestone",
        });
      }
    });
  }

  it("is readable by an admin, a manager, and the writer themselves", async () => {
    const f = await setup();
    await seed(f.t, f.reportId, f.projectId, f.writerId, [100, 300, 200]);

    for (const caller of [f.admin, f.manager, f.writer]) {
      const series = await caller.query(api.reportEditDistance.seriesForWriter, {
        writerUserId: f.writerId,
      });
      expect(series.map((r) => r.computedAt)).toEqual([100, 200, 300]);
      // CAP-3 joins generations.brainProvenance through this column.
      expect(series.map((r) => r.generationId)).toEqual([
        f.generationId,
        f.generationId,
        f.generationId,
      ]);
    }
  });

  it("rejects another writer, an anonymous admin, and an unauthenticated caller", async () => {
    const f = await setup();
    await seed(f.t, f.reportId, f.projectId, f.writerId, [100]);

    expect(
      await errorCode(
        f.otherWriter.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.writerId,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(
      await errorCode(
        f.anonAdmin.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.writerId,
        })
      )
    ).toBe("NOT_AUTHORIZED");
    expect(
      await errorCode(
        f.t.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.writerId,
        })
      )
    ).toBe("NOT_AUTHENTICATED");
  });

  it("rejects an invalid sinceDays before reading anything", async () => {
    const f = await setup();
    for (const sinceDays of [0, -1, 0.5, 4000, Number.NaN]) {
      expect(
        await errorCode(
          f.admin.query(api.reportEditDistance.seriesForWriter, {
            writerUserId: f.writerId,
            sinceDays,
          })
        )
      ).toBe("INVALID_INPUT");
    }
  });

  it("authenticates before it validates sinceDays", async () => {
    const f = await setup();
    expect(
      await errorCode(
        f.t.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.writerId,
          sinceDays: -1,
        })
      )
    ).toBe("NOT_AUTHENTICATED");
  });

  it("windows by sinceDays", async () => {
    const f = await setup();
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    await seed(f.t, f.reportId, f.projectId, f.writerId, [
      now - 40 * day,
      now - 2 * day,
    ]);

    const series = await f.admin.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.writerId, sinceDays: 7 }
    );
    expect(series).toHaveLength(1);
    expect(series[0].computedAt).toBe(now - 2 * day);
  });

  it("returns nothing for a writer whose project is ownerless", async () => {
    const f = await setup({ ownerless: true });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("reportEditDistance", {
        reportId: f.reportId,
        projectId: f.projectId,
        revisionNumber: 0,
        ped: 0.5,
        computedAt: Date.now(),
        trigger: "milestone",
      });
    });
    const series = await f.admin.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.writerId }
    );
    expect(series).toEqual([]);
  });

  it("caps at the newest readings, dropping the oldest", async () => {
    const f = await setup();
    const total = SERIES_FOR_WRITER_LIMIT + 3;
    const stamps = Array.from({ length: total }, (_, i) => 1000 + i);
    await seed(f.t, f.reportId, f.projectId, f.writerId, stamps);

    const series = await f.admin.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.writerId }
    );
    expect(series).toHaveLength(SERIES_FOR_WRITER_LIMIT);
    expect(series[0].computedAt).toBe(1000 + 3);
    expect(series[series.length - 1].computedAt).toBe(1000 + total - 1);
  });
});
