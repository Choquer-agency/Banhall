/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { sha256 } from "./lib/contracts";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const WRITER_AUTH = "accept-edit-writer";
const CLIENT_AUTH = "accept-edit-client";

function pmDoc(text: string) {
  return JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  });
}

async function setup(
  reportText: string,
  comment?: { suggestedEdit?: string },
  options?: { withLineage?: boolean }
) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const writerId = await ctx.db.insert("users", {
      authId: WRITER_AUTH,
      role: "writer",
      name: "Writer",
    });
    // Authenticated but not an internal collaborator (no role).
    await ctx.db.insert("users", { authId: CLIENT_AUTH, name: "Client" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Client project",
      clientName: "Client",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "accept-edit-token",
      createdAt: now,
      updatedAt: now,
    });
    let generationId;
    let transcriptId;
    if (options?.withLineage) {
      transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Transcript",
        createdAt: now,
      });
      generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "completed",
        startedAt: now,
      });
    }
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: pmDoc(reportText),
      version: 1,
      revisionNumber: 3,
      generatedAt: now,
      updatedAt: now,
      generationId,
      sourceTranscriptId: transcriptId,
    });
    const commentId = await ctx.db.insert("comments", {
      projectId,
      reportId,
      commenterId: "client-1",
      commenterType: "client",
      // Offsets are intentionally not the real position of "old wording":
      // acceptEdit matches on highlightText via applyReplacements and ignores
      // highlightFrom/highlightTo.
      highlightFrom: 1,
      highlightTo: 10,
      highlightText: "old wording",
      body: "Please change this",
      suggestedEdit: comment?.suggestedEdit,
      resolved: false,
      createdAt: now,
    });
    return { projectId, reportId, commentId, generationId, transcriptId };
  });
  return {
    t,
    writer: t.withIdentity({ subject: WRITER_AUTH }),
    client: t.withIdentity({ subject: CLIENT_AUTH }),
    ...ids,
  };
}

async function snapshotsFor(
  t: ReturnType<typeof convexTest>,
  reportId: Awaited<ReturnType<typeof setup>>["reportId"]
) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", reportId))
      .collect()
  );
}

describe("acceptEdit", () => {
  test("accepting a client edit writes a restorable pre-edit snapshot", async () => {
    const original = "The claim uses old wording here.";
    const { t, writer, reportId, commentId, generationId, transcriptId } =
      await setup(original, { suggestedEdit: "new wording" }, { withLineage: true });
    const before = await t.run(async (ctx) => ctx.db.get(reportId));

    await writer.mutation(api.comments.acceptEdit, { commentId });

    const snapshots = await snapshotsFor(t, reportId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      reason: "pre_chat_edit",
      label: "Before client edit",
      createdByRole: "system",
      content: before!.content,
      sourceRevisionNumber: 3,
      // Audit lineage carried by snapshotAuditFields (CAP-4).
      contentHash: await sha256(before!.content),
      generationId,
      sourceTranscriptId: transcriptId,
    });

    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after!.content).toContain("new wording");
    expect(after!.content).not.toContain("old wording");
    expect(after!.revisionNumber).toBe(4);
    expect(after!.contentHash).toBe(await sha256(after!.content));
    expect(after!.provenanceId).toBeUndefined();
    const comment = await t.run(async (ctx) => ctx.db.get(commentId));
    expect(comment!.resolved).toBe(true);

    const restoredRevision = await writer.mutation(
      api.snapshots.restoreSnapshot,
      {
        snapshotId: snapshots[0]._id,
        targetReportId: reportId,
        expectedRevisionNumber: 4,
      }
    );
    expect(restoredRevision).toBe(5);
    const restored = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(restored!.content).toBe(before!.content);
    expect(restored!.revisionNumber).toBe(5);
    expect(restored!.generationId).toBe(generationId);
    expect(restored!.sourceTranscriptId).toBe(transcriptId);
    expect(restored!.contentHash).toBe(await sha256(before!.content));
    const afterRestore = await snapshotsFor(t, reportId);
    expect(afterRestore.map((s) => s.reason).sort()).toEqual([
      "pre_chat_edit",
      "pre_restore",
    ]);
  });

  test("accepting an edit thins the recovery stream like applyProposal", async () => {
    const { t, writer, projectId, reportId, commentId } = await setup(
      "The claim uses old wording here.",
      { suggestedEdit: "new wording" }
    );
    // Seed a full recovery stream (older than a day, one per day bucket) plus
    // a permanent milestone. HARD_CAP is 50; with the new checkpoint the
    // stream overflows and the oldest manual rows must go.
    const DAY = 24 * 3_600_000;
    const base = Date.now() - 400 * DAY;
    const { milestoneId, oldestId } = await t.run(async (ctx) => {
      let oldestId;
      for (let i = 0; i < 55; i++) {
        const id = await ctx.db.insert("reportSnapshots", {
          projectId,
          reportId,
          content: pmDoc(`manual ${i}`),
          reason: "manual",
          createdByRole: "writer",
          createdAt: base + i * DAY,
        });
        oldestId ??= id;
      }
      const milestoneId = await ctx.db.insert("reportSnapshots", {
        projectId,
        reportId,
        content: pmDoc("milestone"),
        reason: "milestone",
        label: "Sent to client",
        createdByRole: "writer",
        createdAt: base,
      });
      return { milestoneId, oldestId };
    });

    await writer.mutation(api.comments.acceptEdit, { commentId });

    const snapshots = await snapshotsFor(t, reportId);
    const recovery = snapshots.filter((s) => s.reason !== "milestone");
    expect(recovery).toHaveLength(50);
    expect(snapshots.some((s) => s._id === milestoneId)).toBe(true);
    expect(snapshots.some((s) => s._id === oldestId)).toBe(false);
    expect(
      snapshots.some(
        (s) => s.reason === "pre_chat_edit" && s.label === "Before client edit"
      )
    ).toBe(true);
  });

  test.each([
    ["missing", "The claim has no matching text."],
    ["ambiguous", "old wording and old wording again."],
  ])(
    "%s highlight leaves no snapshot and rejects with STALE_REVISION",
    async (_label, text) => {
      const { t, writer, reportId, commentId } = await setup(text, {
        suggestedEdit: "new wording",
      });
      const before = await t.run(async (ctx) => ctx.db.get(reportId));

      await expect(
        writer.mutation(api.comments.acceptEdit, { commentId })
      ).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });

      expect(await snapshotsFor(t, reportId)).toHaveLength(0);
      const after = await t.run(async (ctx) => ctx.db.get(reportId));
      expect(after!.content).toBe(before!.content);
      expect(after!.revisionNumber).toBe(3);
      const comment = await t.run(async (ctx) => ctx.db.get(commentId));
      expect(comment!.resolved).toBe(false);
    }
  );

  test("comment without a suggested edit is rejected with INVALID_INPUT", async () => {
    const { t, writer, reportId, commentId } = await setup(
      "The claim uses old wording here."
    );
    const before = await t.run(async (ctx) => ctx.db.get(reportId));

    await expect(
      writer.mutation(api.comments.acceptEdit, { commentId })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });

    expect(await snapshotsFor(t, reportId)).toHaveLength(0);
    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after!.content).toBe(before!.content);
    const comment = await t.run(async (ctx) => ctx.db.get(commentId));
    expect(comment!.resolved).toBe(false);
  });

  test("a user without an internal role is rejected with NOT_AUTHORIZED", async () => {
    const { t, client, reportId, commentId } = await setup(
      "The claim uses old wording here.",
      { suggestedEdit: "new wording" }
    );
    const before = await t.run(async (ctx) => ctx.db.get(reportId));

    await expect(
      client.mutation(api.comments.acceptEdit, { commentId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });

    expect(await snapshotsFor(t, reportId)).toHaveLength(0);
    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after!.content).toBe(before!.content);
    const comment = await t.run(async (ctx) => ctx.db.get(commentId));
    expect(comment!.resolved).toBe(false);
  });

  test("a comment pointing at another project's report is rejected with NOT_FOUND", async () => {
    const { t, writer, reportId, commentId } = await setup(
      "The claim uses old wording here.",
      { suggestedEdit: "new wording" }
    );
    const before = await t.run(async (ctx) => ctx.db.get(reportId));
    await t.run(async (ctx) => {
      const now = Date.now();
      const otherProjectId = await ctx.db.insert("projects", {
        title: "Other project",
        clientName: "Other",
        status: "review",
        createdBy: (await ctx.db.query("users").first())!._id,
        shareToken: "accept-edit-other",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.patch(commentId, { projectId: otherProjectId });
    });

    await expect(
      writer.mutation(api.comments.acceptEdit, { commentId })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });

    expect(await snapshotsFor(t, reportId)).toHaveLength(0);
    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after!.content).toBe(before!.content);
    const comment = await t.run(async (ctx) => ctx.db.get(commentId));
    expect(comment!.resolved).toBe(false);
  });

  test("unauthenticated accept is rejected with NOT_AUTHENTICATED", async () => {
    const { t, reportId, commentId } = await setup(
      "The claim uses old wording here.",
      { suggestedEdit: "new wording" }
    );
    const before = await t.run(async (ctx) => ctx.db.get(reportId));

    await expect(
      t.mutation(api.comments.acceptEdit, { commentId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });

    expect(await snapshotsFor(t, reportId)).toHaveLength(0);
    const after = await t.run(async (ctx) => ctx.db.get(reportId));
    expect(after!.content).toBe(before!.content);
    const comment = await t.run(async (ctx) => ctx.db.get(commentId));
    expect(comment!.resolved).toBe(false);
  });
});
