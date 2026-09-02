/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");

// Story 4 (CAP-4a): accepting a client's suggested edit is reversible.
// `acceptEdit` checkpoints the pre-accept report content as a
// `pre_client_edit` snapshot inside the same mutation, ahead of the report
// patch, so the ordinary restore path returns the exact pre-accept text, and a
// rejected accept (stale or ambiguous selection, no suggestion) persists
// nothing at all.

const PARAGRAPH = "The team tested the alloy at low temperature.";
const HIGHLIGHT = "tested the alloy";
const SUGGESTION = "measured the alloy";
const REMARK_HIGHLIGHT = "at low temperature";

function reportDoc(paragraph: string): string {
  return JSON.stringify({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: paragraph }],
      },
    ],
  });
}

const REPORT_DOC = reportDoc(PARAGRAPH);

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const writerId = await ctx.db.insert("users", {
      authId: "cm-writer",
      role: "writer",
      firstName: "Wren",
    });
    const projectId = await ctx.db.insert("projects", {
      title: "Alloy fatigue PD",
      clientName: "Acme Metals",
      status: "client_review",
      createdBy: writerId,
      ownerId: writerId,
      shareToken: "cm-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: REPORT_DOC,
      version: 1,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
    // A pre-existing checkpoint, so "exactly one new snapshot" and "snapshots
    // unchanged" compare against a real row rather than an empty list.
    await ctx.db.insert("reportSnapshots", {
      projectId,
      reportId,
      content: REPORT_DOC,
      reason: "manual",
      createdByRole: "writer",
      createdAt: now,
    });
    const commenterId = await ctx.db.insert("commenters", {
      projectId,
      name: "Casey Client",
      color: "#818CF8",
      createdAt: now,
    });
    const highlightFrom = PARAGRAPH.indexOf(HIGHLIGHT);
    const commentId = await ctx.db.insert("comments", {
      projectId,
      reportId,
      commenterId,
      commenterType: "client",
      highlightFrom,
      highlightTo: highlightFrom + HIGHLIGHT.length,
      highlightText: HIGHLIGHT,
      body: "We measured rather than tested here.",
      suggestedEdit: SUGGESTION,
      resolved: false,
      createdAt: now,
    });
    // Same client, a remark that carries no suggested wording.
    const remarkFrom = PARAGRAPH.indexOf(REMARK_HIGHLIGHT);
    const remarkCommentId = await ctx.db.insert("comments", {
      projectId,
      reportId,
      commenterId,
      commenterType: "client",
      highlightFrom: remarkFrom,
      highlightTo: remarkFrom + REMARK_HIGHLIGHT.length,
      highlightText: REMARK_HIGHLIGHT,
      body: "Which temperature, exactly?",
      resolved: false,
      createdAt: now,
    });
    return { writerId, projectId, reportId, commentId, remarkCommentId };
  });

  return {
    t,
    ...ids,
    writer: t.withIdentity({ subject: "cm-writer" }),
  };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

async function reportRow(f: Fixture) {
  const report = await f.t.run((ctx) => ctx.db.get(f.reportId));
  if (!report) throw new Error("report fixture is missing");
  return report;
}

async function commentRow(f: Fixture, commentId: Id<"comments">) {
  const comment = await f.t.run((ctx) => ctx.db.get(commentId));
  if (!comment) throw new Error("comment fixture is missing");
  return comment;
}

async function snapshots(f: Fixture) {
  return await f.t.run((ctx) =>
    ctx.db
      .query("reportSnapshots")
      .withIndex("by_reportId", (q) => q.eq("reportId", f.reportId))
      .collect()
  );
}

/**
 * Resolve a call to its typed domain-error code, or a readable marker when it
 * succeeded or threw an untyped error, so rejection assertions compare codes.
 */
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

/** Assert that a rejected accept left the report, comment, and snapshots as they were. */
async function expectNothingChanged(
  f: Fixture,
  commentId: Id<"comments">,
  before: {
    report: Awaited<ReturnType<typeof reportRow>>;
    comment: Awaited<ReturnType<typeof commentRow>>;
    snapshots: Awaited<ReturnType<typeof snapshots>>;
  }
) {
  expect(await reportRow(f)).toEqual(before.report);
  const comment = await commentRow(f, commentId);
  expect(comment).toEqual(before.comment);
  expect(comment.resolved).toBe(false);
  expect(await snapshots(f)).toEqual(before.snapshots);
}

describe("acceptEdit checkpoints the pre-accept content", () => {
  it("applies the suggestion and writes one pre_client_edit snapshot of the prior text", async () => {
    const f = await setup();
    const preAccept = await reportRow(f);
    const beforeSnapshots = await snapshots(f);

    await f.writer.mutation(api.comments.acceptEdit, { commentId: f.commentId });

    const report = await reportRow(f);
    expect(report.content).toContain(SUGGESTION);
    expect(report.content).not.toContain(HIGHLIGHT);
    expect(report.revisionNumber).toBe(1);
    expect(report.contentHash).toBe(await sha256(report.content));
    expect((await commentRow(f, f.commentId)).resolved).toBe(true);

    const after = await snapshots(f);
    expect(after.length).toBe(beforeSnapshots.length + 1);
    const knownIds = new Set(beforeSnapshots.map((snapshot) => snapshot._id));
    const added = after.filter((snapshot) => !knownIds.has(snapshot._id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({
      projectId: f.projectId,
      reportId: f.reportId,
      reason: "pre_client_edit",
      label: "Before client edit",
      createdByRole: "system",
      sourceRevisionNumber: 0,
      contentHash: await sha256(preAccept.content),
    });
    expect(added[0].content).toBe(preAccept.content);
    expect(added[0].content).toBe(REPORT_DOC);
    // The prior checkpoint survived retention thinning.
    expect(after.filter((snapshot) => snapshot.reason === "manual")).toHaveLength(1);
  });

  it("restores the exact pre-accept text through restoreSnapshot", async () => {
    const f = await setup();
    const preAccept = (await reportRow(f)).content;

    await f.writer.mutation(api.comments.acceptEdit, { commentId: f.commentId });
    const accepted = await reportRow(f);
    expect(accepted.content).not.toBe(preAccept);

    const checkpoint = (await snapshots(f)).find(
      (snapshot) => snapshot.reason === "pre_client_edit"
    );
    if (!checkpoint) throw new Error("pre_client_edit snapshot was not written");

    const nextRevision = await f.writer.mutation(api.snapshots.restoreSnapshot, {
      snapshotId: checkpoint._id,
      targetReportId: f.reportId,
      expectedRevisionNumber: accepted.revisionNumber ?? 0,
    });
    expect(nextRevision).toBe(2);

    const restored = await reportRow(f);
    expect(restored.content).toBe(preAccept);
    expect(restored.content).toBe(REPORT_DOC);
    expect(restored.revisionNumber).toBe(2);
    expect(restored.contentHash).toBe(await sha256(preAccept));
    // Restore is non-destructive: the accepted wording is itself checkpointed.
    const preRestore = (await snapshots(f)).find(
      (snapshot) => snapshot.reason === "pre_restore"
    );
    expect(preRestore?.content).toBe(accepted.content);
  });

  it("persists no snapshot and leaves the comment open when the selection is gone", async () => {
    const f = await setup();
    // The writer reworded the passage after the client commented on it.
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.reportId, {
        content: reportDoc("The team examined the sample at low temperature."),
        revisionNumber: 1,
      });
    });
    const before = {
      report: await reportRow(f),
      comment: await commentRow(f, f.commentId),
      snapshots: await snapshots(f),
    };

    expect(
      await errorCode(() =>
        f.writer.mutation(api.comments.acceptEdit, { commentId: f.commentId })
      )
    ).toBe("STALE_REVISION");

    await expectNothingChanged(f, f.commentId, before);
  });

  it("persists no snapshot when the selection has become ambiguous", async () => {
    const f = await setup();
    // A second occurrence appeared after the client commented.
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.reportId, {
        content: reportDoc(
          `${PARAGRAPH} Later, the team tested the alloy at room temperature.`
        ),
        revisionNumber: 1,
      });
    });
    const before = {
      report: await reportRow(f),
      comment: await commentRow(f, f.commentId),
      snapshots: await snapshots(f),
    };

    expect(
      await errorCode(() =>
        f.writer.mutation(api.comments.acceptEdit, { commentId: f.commentId })
      )
    ).toBe("STALE_REVISION");

    await expectNothingChanged(f, f.commentId, before);
  });

  it("rejects a comment without a suggested edit and writes nothing", async () => {
    const f = await setup();
    const before = {
      report: await reportRow(f),
      comment: await commentRow(f, f.remarkCommentId),
      snapshots: await snapshots(f),
    };

    expect(
      await errorCode(() =>
        f.writer.mutation(api.comments.acceptEdit, {
          commentId: f.remarkCommentId,
        })
      )
    ).toBe("INVALID_INPUT");

    await expectNothingChanged(f, f.remarkCommentId, before);
  });
});
