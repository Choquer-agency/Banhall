/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
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
