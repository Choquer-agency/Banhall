/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DomainErrorCode } from "./lib/contracts";
import { computeEditDistance } from "./lib/editDistance";
import { extractPlainText } from "./lib/reportEdits";
import { REPORT_ROW_LIMIT, WRITER_ROW_LIMIT } from "./reportEditDistance";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const ADMIN = "ped-admin";
const OWNER = "ped-owner";
const OTHER = "ped-other-writer";
const MANAGER = "ped-manager";
const ANON_ADMIN = "ped-anon-admin";

/** Minimal Tiptap document so `extractPlainText` yields real paragraphs. */
function doc(...paragraphs: string[]) {
  return JSON.stringify({
    type: "doc",
    content: paragraphs.map((text) => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  });
}

const DRAFT = doc(
  "The team designed a control rig to hold the membrane at constant tension.",
  "Repeated trials measured drift across three temperature bands."
);
const EDITED = doc(
  "Something else entirely was attempted here by nobody at all.",
  "Unrelated wording replaced every prior sentence in this revision."
);
/** A one-shot ghost draft: also `reason: "generated"`, but never the baseline. */
const GHOST = doc(
  "Something else entirely was attempted here by nobody at all.",
  "Unrelated wording replaced every prior sentence in this revision.",
  "A third paragraph only the ghost draft ever contained."
);

async function expectDomainError(run: () => Promise<unknown>, code: DomainErrorCode) {
  let thrown: unknown;
  let threw = false;
  try {
    await run();
  } catch (error) {
    thrown = error;
    threw = true;
  }
  expect(threw, `expected a ${code} rejection but the call resolved`).toBe(true);
  const data = (thrown as { data?: { code?: unknown } } | null)?.data;
  expect(data?.code).toBe(code);
}

/** Project + report + optional "generated" baseline snapshot, no generation run. */
async function setup(
  options: { withBaseline?: boolean; withOwner?: boolean; withGhost?: boolean } = {}
) {
  const withBaseline = options.withBaseline ?? true;
  const withOwner = options.withOwner ?? true;
  const withGhost = options.withGhost ?? false;
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const adminId = await ctx.db.insert("users", {
      authId: ADMIN,
      role: "admin",
      name: "PED Admin",
    });
    const ownerId = await ctx.db.insert("users", {
      authId: OWNER,
      role: "writer",
      name: "PED Owner",
    });
    const otherId = await ctx.db.insert("users", {
      authId: OTHER,
      role: "writer",
      name: "PED Other",
    });
    const managerId = await ctx.db.insert("users", {
      authId: MANAGER,
      role: "manager",
      name: "PED Manager",
    });
    // Anonymous auth record that also carries a role: never an internal
    // reader. The role field must not rescue an anonymous record.
    await ctx.db.insert("users", {
      authId: ANON_ADMIN,
      role: "admin",
      isAnonymous: true,
      name: "PED Anon",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "PED project",
      clientName: "Client",
      status: "review",
      createdBy: ownerId,
      ...(withOwner ? { ownerId } : {}),
      shareToken: "ped-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: DRAFT,
      version: 1,
      revisionNumber: 0,
      generatedAt: now,
      updatedAt: now,
    });
    if (withBaseline) {
      await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        content: DRAFT,
        reason: "generated",
        label: "AI draft (Sonnet)",
        sourceRevisionNumber: 0,
        createdByRole: "system",
        createdAt: now,
      });
    }
    if (withGhost) {
      // Iterative generations persist the ghost comparison draft as a second
      // `generated` snapshot AFTER the real baseline (generations.ts).
      await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        content: GHOST,
        reason: "generated",
        label: "One-shot ghost draft (comparison — Sonnet)",
        sourceRevisionNumber: 0,
        createdByRole: "system",
        createdAt: now,
      });
    }
    return { adminId, ownerId, otherId, managerId, projectId, reportId };
  });
  return {
    t,
    admin: t.withIdentity({ subject: ADMIN }),
    owner: t.withIdentity({ subject: OWNER }),
    other: t.withIdentity({ subject: OTHER }),
    manager: t.withIdentity({ subject: MANAGER }),
    anonAdmin: t.withIdentity({ subject: ANON_ADMIN }),
    ...ids,
  };
}

async function rows(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) =>
    await ctx.db.query("reportEditDistance").collect()
  );
}

async function editReport(
  t: ReturnType<typeof convexTest>,
  reportId: Id<"reports">,
  content: string,
  revisionNumber: number
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(reportId, {
      content,
      revisionNumber,
      updatedAt: Date.now(),
    });
  });
}

describe("candidate-selection trigger", () => {
  it("records a ped-0 row when selecting a candidate materializes the report", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const now = Date.now();
      const ownerId = await ctx.db.insert("users", {
        authId: OWNER,
        role: "writer",
        name: "PED Owner",
      });
      await ctx.db.insert("users", { authId: ADMIN, role: "admin" });
      const projectId = await ctx.db.insert("projects", {
        title: "PED project",
        clientName: "Client",
        status: "generating",
        createdBy: ownerId,
        ownerId,
        shareToken: "ped-token-2",
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
        status: "awaiting_selection",
        requestedBy: ownerId,
        candidateMode: "compare",
        previousProjectStatus: "draft",
        totalCandidates: 1,
        candidatesDone: 1,
        candidatesFailed: 0,
        startedAt: now,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      const candidateId = await ctx.db.insert("reportCandidates", {
        projectId,
        generationId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        content: DRAFT,
        agentOutputs: "{}",
        createdAt: now,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "succeeded",
        candidateId,
        queuedAt: now,
        startedAt: now,
        completedAt: now,
      });
      return { ownerId, projectId, generationId, candidateId };
    });

    const reportId = await t
      .withIdentity({ subject: OWNER })
      .mutation(api.generations.selectReportCandidate, {
        generationId: ids.generationId,
        candidateId: ids.candidateId,
      });

    const series = await t
      .withIdentity({ subject: ADMIN })
      .query(api.reportEditDistance.seriesForReport, { reportId });
    expect(series).toHaveLength(1);
    expect(series?.[0]).toMatchObject({
      trigger: "candidate_selection",
      ped: 0,
      revisionNumber: 0,
      writerUserId: ids.ownerId,
    });
  });
});

describe("milestone trigger", () => {
  it("records the edited distance at the report's current revision", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 3);

    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 3,
    });

    const all = await rows(f.t);
    expect(all).toHaveLength(1);
    expect(all[0]?.trigger).toBe("milestone");
    expect(all[0]?.revisionNumber).toBe(3);
    const readTime = await f.admin.query(api.reports.postEditDistance, {
      reportId: f.reportId,
    });
    expect(readTime?.ped).toBeGreaterThan(0);
    expect(all[0]?.ped).toBe(readTime?.ped);
  });

  it("measures against the real baseline, not a later ghost comparison snapshot", async () => {
    const f = await setup({ withGhost: true });
    await editReport(f.t, f.reportId, EDITED, 2);

    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 2,
    });

    const all = await rows(f.t);
    expect(all).toHaveLength(1);
    const againstBaseline = computeEditDistance(
      extractPlainText(DRAFT),
      extractPlainText(EDITED)
    ).ped;
    const againstGhost = computeEditDistance(
      extractPlainText(GHOST),
      extractPlainText(EDITED)
    ).ped;
    expect(againstBaseline).not.toBe(againstGhost);
    expect(all[0]?.ped).toBe(againstBaseline);
  });

  it("writes no row and still snapshots when the report has no generated baseline", async () => {
    const f = await setup({ withBaseline: false });
    await editReport(f.t, f.reportId, EDITED, 1);

    const snapshotId = await f.owner.mutation(
      api.snapshots.createMilestoneSnapshot,
      { reportId: f.reportId, label: "R1", expectedRevisionNumber: 1 }
    );

    expect(snapshotId).toBeDefined();
    expect(await rows(f.t)).toHaveLength(0);
  });
});

describe("client-publish trigger", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("records a row attributed to the project owner once the scheduler drains", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 2);

    await f.admin.mutation(api.projects.publishForReview, {
      projectId: f.projectId,
      reportId: f.reportId,
    });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const all = await rows(f.t);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      trigger: "client_publish",
      revisionNumber: 2,
      writerUserId: f.ownerId,
      projectId: f.projectId,
    });
    expect(all[0]?.ped).toBeGreaterThan(0);
  });

  it("does not duplicate a row when publish repeats with no edit in between", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 2);

    for (let i = 0; i < 2; i += 1) {
      await f.admin.mutation(api.projects.publishForReview, {
        projectId: f.projectId,
        reportId: f.reportId,
      });
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    }

    expect(await rows(f.t)).toHaveLength(1);
  });

  it("still records a publish reading right after a milestone on the same revision", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 4);
    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 4,
    });

    // No edit in between: same revision, same ped. Only the trigger differs,
    // so the dedupe must not swallow the publish reading.
    await f.admin.mutation(api.projects.publishForReview, {
      projectId: f.projectId,
      reportId: f.reportId,
    });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    const series = await f.admin.query(
      api.reportEditDistance.seriesForReport,
      { reportId: f.reportId }
    );
    expect(series?.map((row) => row.trigger)).toEqual([
      "milestone",
      "client_publish",
    ]);
    expect(series?.[0]?.ped).toBe(series?.[1]?.ped);
    expect(series?.[1]?.revisionNumber).toBe(4);
  });

  it("writes no row when the report has no generated baseline", async () => {
    const f = await setup({ withBaseline: false });

    await f.admin.mutation(api.projects.publishForReview, {
      projectId: f.projectId,
      reportId: f.reportId,
    });
    await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());

    expect(await rows(f.t)).toHaveLength(0);
  });
});

describe("legacy projects without an owner", () => {
  it("records the row unattributed and keeps it out of every writer series", async () => {
    const f = await setup({ withOwner: false });
    await editReport(f.t, f.reportId, EDITED, 1);

    await f.admin.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 1,
    });

    const all = await rows(f.t);
    expect(all).toHaveLength(1);
    expect(all[0]?.trigger).toBe("milestone");
    expect(all[0]?.writerUserId).toBeUndefined();

    const series = await f.admin.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.ownerId }
    );
    expect(series).toHaveLength(0);
  });
});

describe("read surface", () => {
  it("agrees with reports.postEditDistance on the same report state", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 2);
    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 2,
    });

    const readTime = await f.admin.query(api.reports.postEditDistance, {
      reportId: f.reportId,
    });
    const all = await rows(f.t);
    expect(readTime?.ped).toBe(all[0]?.ped);
  });

  it("postEditDistance keeps its full returned shape after the extraction", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 2);

    const readTime = await f.admin.query(api.reports.postEditDistance, {
      reportId: f.reportId,
    });
    // Block-If guard: the extraction must preserve every forwarded key, not
    // just `ped`. Dropping or renaming any of the eight fails here.
    expect(Object.keys(readTime ?? {}).sort()).toEqual(
      [
        "baselineAt",
        "currentWords",
        "draftLabel",
        "draftWords",
        "paragraphsTotal",
        "paragraphsUnchanged",
        "ped",
        "wordSimilarity",
      ]
    );
    const expected = computeEditDistance(
      extractPlainText(DRAFT),
      extractPlainText(EDITED)
    );
    expect(readTime).toMatchObject(expected);
    expect(readTime?.draftLabel).toBe("AI draft (Sonnet)");
    expect(typeof readTime?.baselineAt).toBe("number");
  });

  it("seriesForReport returns null without internal access and ascending rows with it", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 1);
    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 1,
    });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("reportEditDistance", {
        reportId: f.reportId,
        projectId: f.projectId,
        writerUserId: f.ownerId,
        revisionNumber: 0,
        ped: 0,
        computedAt: 1,
        trigger: "candidate_selection",
      });
    });

    expect(
      await f.t.query(api.reportEditDistance.seriesForReport, {
        reportId: f.reportId,
      })
    ).toBeNull();

    const series = await f.admin.query(api.reportEditDistance.seriesForReport, {
      reportId: f.reportId,
    });
    expect(series?.map((row) => row.trigger)).toEqual([
      "candidate_selection",
      "milestone",
    ]);
  });

  it("seriesForWriter serves admins and the writer, and refuses an unrelated writer", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 1);
    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 1,
    });

    const forAdmin = await f.admin.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.ownerId }
    );
    expect(forAdmin).toHaveLength(1);
    expect(forAdmin[0]?.writerUserId).toBe(f.ownerId);

    const forSelf = await f.owner.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.ownerId }
    );
    expect(forSelf).toHaveLength(1);

    await expectDomainError(
      () =>
        f.other.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.ownerId,
        }),
      "NOT_AUTHORIZED"
    );
  });

  it("seriesForWriter serves a manager reading another writer's series", async () => {
    const f = await setup();
    await editReport(f.t, f.reportId, EDITED, 1);
    await f.owner.mutation(api.snapshots.createMilestoneSnapshot, {
      reportId: f.reportId,
      label: "R1",
      expectedRevisionNumber: 1,
    });

    const forManager = await f.manager.query(
      api.reportEditDistance.seriesForWriter,
      { writerUserId: f.ownerId }
    );
    expect(forManager).toHaveLength(1);
    expect(forManager[0]?.writerUserId).toBe(f.ownerId);
  });

  it("seriesForWriter refuses an anonymous record even when it carries a role", async () => {
    const f = await setup();

    await expectDomainError(
      () =>
        f.anonAdmin.query(api.reportEditDistance.seriesForWriter, {
          writerUserId: f.ownerId,
        }),
      "NOT_AUTHENTICATED"
    );
  });

  it("seriesForWriter rejects a non-positive, non-finite or absurd sinceDays", async () => {
    const f = await setup();

    // 1e308 is finite, but `sinceDays * DAY_MS` overflows to Infinity, which
    // would send `-Infinity` to the index bound.
    for (const sinceDays of [
      0,
      -7,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      36501,
      1e308,
    ]) {
      await expectDomainError(
        () =>
          f.admin.query(api.reportEditDistance.seriesForWriter, {
            writerUserId: f.ownerId,
            sinceDays,
          }),
        "INVALID_INPUT"
      );
    }
  });

  it("seriesForWriter honours sinceDays", async () => {
    const f = await setup();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("reportEditDistance", {
        reportId: f.reportId,
        projectId: f.projectId,
        writerUserId: f.ownerId,
        revisionNumber: 0,
        ped: 0.1,
        computedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
        trigger: "candidate_selection",
      });
      await ctx.db.insert("reportEditDistance", {
        reportId: f.reportId,
        projectId: f.projectId,
        writerUserId: f.ownerId,
        revisionNumber: 1,
        ped: 0.2,
        computedAt: Date.now(),
        trigger: "milestone",
      });
    });

    const recent = await f.admin.query(api.reportEditDistance.seriesForWriter, {
      writerUserId: f.ownerId,
      sinceDays: 7,
    });
    expect(recent.map((row) => row.trigger)).toEqual(["milestone"]);
  });

  it("seriesForWriter returns in-range rows oldest first", async () => {
    const f = await setup();
    const now = Date.now();
    await f.t.run(async (ctx) => {
      // Inserted newest-first so a query that forgot to restore ascending
      // order would surface the insertion order instead.
      for (const [ped, ageDays] of [
        [0.3, 1],
        [0.2, 2],
        [0.1, 3],
      ] as const) {
        await ctx.db.insert("reportEditDistance", {
          reportId: f.reportId,
          projectId: f.projectId,
          writerUserId: f.ownerId,
          revisionNumber: 0,
          ped,
          computedAt: now - ageDays * 24 * 60 * 60 * 1000,
          trigger: "milestone",
        });
      }
    });

    const series = await f.admin.query(api.reportEditDistance.seriesForWriter, {
      writerUserId: f.ownerId,
      sinceDays: 7,
    });
    expect(series.map((row) => row.ped)).toEqual([0.1, 0.2, 0.3]);
    expect(
      series.every(
        (row, i) => i === 0 || series[i - 1].computedAt <= row.computedAt
      )
    ).toBe(true);
  });
});

describe("row caps keep the newest readings", () => {
  async function seed(
    f: Awaited<ReturnType<typeof setup>>,
    count: number
  ) {
    await f.t.run(async (ctx) => {
      for (let i = 0; i < count; i += 1) {
        await ctx.db.insert("reportEditDistance", {
          reportId: f.reportId,
          projectId: f.projectId,
          writerUserId: f.ownerId,
          revisionNumber: i,
          ped: 0,
          // Ascending by insertion, so the OLDEST row is i = 0.
          computedAt: 1_000_000 + i,
          trigger: "milestone",
        });
      }
    });
  }

  it("seriesForReport drops the oldest row past REPORT_ROW_LIMIT", async () => {
    const f = await setup();
    await seed(f, REPORT_ROW_LIMIT + 1);

    const series = await f.admin.query(api.reportEditDistance.seriesForReport, {
      reportId: f.reportId,
    });
    expect(series).toHaveLength(REPORT_ROW_LIMIT);
    expect(series?.[0]?.revisionNumber).toBe(1);
    expect(series?.at(-1)?.revisionNumber).toBe(REPORT_ROW_LIMIT);
  });

  it("seriesForWriter drops the oldest row past WRITER_ROW_LIMIT", async () => {
    const f = await setup();
    await seed(f, WRITER_ROW_LIMIT + 1);

    const series = await f.admin.query(api.reportEditDistance.seriesForWriter, {
      writerUserId: f.ownerId,
    });
    expect(series).toHaveLength(WRITER_ROW_LIMIT);
    expect(series[0]?.revisionNumber).toBe(1);
    expect(series.at(-1)?.revisionNumber).toBe(WRITER_ROW_LIMIT);
  });
});
