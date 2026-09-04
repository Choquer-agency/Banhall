/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { DomainErrorCode } from "./lib/contracts";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const AUTH_ID = "snapshots-writer";
const CONTENT = "Report content under version history";

/** A report generated from two transcripts, so its set is longer than its id. */
async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      authId: AUTH_ID,
      role: "writer",
      name: "Snapshot Writer",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Snapshot project",
      clientName: "Test client",
      status: "review",
      createdBy: userId,
      ownerId: userId,
      shareToken: "snapshots-token",
      createdAt: now,
      updatedAt: now,
    });
    const transcriptIds: Id<"transcripts">[] = [];
    for (const [index, body] of ["Alpha body", "Bravo body"].entries()) {
      transcriptIds.push(
        await ctx.db.insert("transcripts", {
          projectId,
          label: index === 0 ? "First" : "Second",
          position: index,
          content: body,
          createdAt: now + index,
        })
      );
    }
    const generationId = await ctx.db.insert("generations", {
      projectId,
      transcriptId: transcriptIds[0],
      transcriptIds,
      status: "completed",
      requestedBy: userId,
      candidateMode: "single",
      startedAt: now,
      completedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      generationId,
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
      content: CONTENT,
      contentHash: await sha256(CONTENT),
      revisionNumber: 0,
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return { projectId, generationId, reportId, transcriptIds };
  });
  return { t: t.withIdentity({ subject: AUTH_ID }), raw: t, ...ids };
}

describe("snapshots carry the transcript set (AC5)", () => {
  it("writes the set onto a manual snapshot and skips an exact duplicate", async () => {
    const { t, raw, reportId, transcriptIds } = await setup();

    const first = await t.mutation(api.snapshots.createManualSnapshot, {
      reportId,
    });
    const second = await t.mutation(api.snapshots.createManualSnapshot, {
      reportId,
    });

    expect(second).toBe(first);
    const snapshots = await raw.run((ctx) =>
      ctx.db.query("reportSnapshots").take(10)
    );
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
  });

  it("takes a fresh checkpoint when only the stored set differs", async () => {
    const { t, raw, reportId } = await setup();

    const legacy = await t.mutation(api.snapshots.createManualSnapshot, {
      reportId,
    });
    // A row written before the set existed: same content, same single id, no
    // list. It must not be mistaken for a complete checkpoint.
    await raw.run((ctx) =>
      ctx.db.patch(legacy, { sourceTranscriptIds: undefined })
    );

    const next = await t.mutation(api.snapshots.createManualSnapshot, {
      reportId,
    });
    expect(next).not.toBe(legacy);
  });

  it("carries the set back onto the report on restore", async () => {
    const { t, raw, projectId, reportId, generationId, transcriptIds } =
      await setup();

    // A legacy snapshot: it knows its generation but was written before the
    // set existed. The rule is one-directional, so the restore derives the set
    // from that generation rather than inventing one from the single id.
    const snapshotId = await raw.run(async (ctx) => {
      await ctx.db.patch(reportId, { sourceTranscriptIds: undefined });
      return await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        generationId,
        sourceTranscriptId: transcriptIds[0],
        content: "Older content",
        contentHash: await sha256("Older content"),
        sourceRevisionNumber: 0,
        reason: "manual",
        createdByRole: "writer",
        createdAt: Date.now(),
      });
    });

    await t.mutation(api.snapshots.restoreSnapshot, {
      snapshotId,
      targetReportId: reportId,
      expectedRevisionNumber: 0,
    });

    const report = await raw.run((ctx) => ctx.db.get(reportId));
    expect(report).toMatchObject({
      content: "Older content",
      revisionNumber: 1,
      sourceTranscriptId: transcriptIds[0],
      sourceTranscriptIds: transcriptIds,
    });
  });
});

/**
 * Assert a mutation rejected with a specific `domainError` code. Matching the
 * serialized message would let a guard pass for the wrong reason —
 * `restoreSnapshot` raises NOT_AUTHORIZED from both `requireReportEditAccess`
 * and the cross-project rule — so this asserts `data.code` exactly and takes an
 * optional message pattern to pin the intended guard.
 */
async function expectDomainError(
  run: () => Promise<unknown>,
  code: DomainErrorCode,
  messagePattern?: RegExp
) {
  let thrown: unknown;
  let threw = false;
  try {
    await run();
  } catch (error) {
    thrown = error;
    threw = true;
  }
  expect(threw, `expected a ${code} rejection but the call resolved`).toBe(true);
  const data = (thrown as { data?: unknown } | null)?.data;
  expect(
    data !== null && typeof data === "object",
    `expected a ConvexError carrying domain-error data, got: ${String(thrown)}`
  ).toBe(true);
  const payload = data as { code?: unknown; message?: unknown };
  expect(payload.code).toBe(code);
  if (messagePattern) expect(String(payload.message)).toMatch(messagePattern);
}

describe("restoreSnapshot guards", () => {
  /** A manual snapshot of the report's current content. */
  async function seedSnapshot(
    raw: ReturnType<typeof convexTest>,
    projectId: Id<"projects">,
    reportId: Id<"reports">,
    content = "Older content"
  ) {
    return await raw.run(async (ctx) =>
      ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        content,
        contentHash: await sha256(content),
        sourceRevisionNumber: 0,
        reason: "manual",
        createdByRole: "writer",
        createdAt: Date.now(),
      })
    );
  }

  it("refuses a restore fenced to an older revision", async () => {
    const { t, raw, projectId, reportId } = await setup();
    const snapshotId = await seedSnapshot(raw, projectId, reportId);
    await raw.run((ctx) =>
      ctx.db.patch(reportId, { content: "Newer content", revisionNumber: 2 })
    );

    await expectDomainError(
      () =>
        t.mutation(api.snapshots.restoreSnapshot, {
          snapshotId,
          targetReportId: reportId,
          expectedRevisionNumber: 1,
        }),
      "STALE_REVISION"
    );

    const state = await raw.run(async (ctx) => ({
      report: await ctx.db.get(reportId),
      preRestore: (await ctx.db.query("reportSnapshots").collect()).filter(
        (row) => row.reason === "pre_restore"
      ),
    }));
    expect(state.report).toMatchObject({
      content: "Newer content",
      revisionNumber: 2,
    });
    expect(state.preRestore).toHaveLength(0);
  });

  it("refuses a restore onto a report in another project", async () => {
    const { t, raw, projectId, reportId } = await setup();
    const snapshotId = await seedSnapshot(raw, projectId, reportId);
    // A second project the same writer owns, so only the cross-project rule
    // can reject the restore.
    const foreignReportId = await raw.run(async (ctx) => {
      const user = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", AUTH_ID))
        .unique();
      const now = Date.now();
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Other project",
        clientName: "Other client",
        status: "review",
        createdBy: user!._id,
        ownerId: user!._id,
        shareToken: "snapshots-token-other",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("reports", {
        projectId: otherProjectId,
        content: "Foreign report content",
        contentHash: await sha256("Foreign report content"),
        revisionNumber: 0,
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
    });

    await expectDomainError(
      () =>
        t.mutation(api.snapshots.restoreSnapshot, {
          snapshotId,
          targetReportId: foreignReportId,
          expectedRevisionNumber: 0,
        }),
      "NOT_AUTHORIZED",
      /another project/i
    );

    const state = await raw.run(async (ctx) => ({
      report: await ctx.db.get(reportId),
      foreign: await ctx.db.get(foreignReportId),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    expect(state.report).toMatchObject({ content: CONTENT, revisionNumber: 0 });
    expect(state.foreign).toMatchObject({
      content: "Foreign report content",
      revisionNumber: 0,
    });
    expect(state.snapshots.map((row) => row.reason)).toEqual(["manual"]);
  });

  it("refuses a restore from a snapshot that no longer exists", async () => {
    const { t, raw, projectId, reportId } = await setup();
    const snapshotId = await seedSnapshot(raw, projectId, reportId);
    await raw.run((ctx) => ctx.db.delete(snapshotId));

    await expectDomainError(
      () =>
        t.mutation(api.snapshots.restoreSnapshot, {
          snapshotId,
          targetReportId: reportId,
          expectedRevisionNumber: 0,
        }),
      "NOT_FOUND"
    );

    const state = await raw.run(async (ctx) => ({
      report: await ctx.db.get(reportId),
      snapshots: await ctx.db.query("reportSnapshots").collect(),
    }));
    expect(state.report).toMatchObject({ content: CONTENT, revisionNumber: 0 });
    expect(state.snapshots).toHaveLength(0);
  });
});
