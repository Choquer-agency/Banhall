/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { sha256 } from "./lib/contracts";
import { buildTiptapDocument } from "./lib/tiptapReport";

const modules = import.meta.glob("./**/*.ts");

// Fake timers keep the scheduled internal.ai.reviewAgent.runPdReview ("use
// node", real provider call) from ever executing; the tests assert the
// insert-and-schedule state, not the agent run.
beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const SOURCE_TRANSCRIPTS = [
  { label: "Kickoff A", content: "Interview notes about the robot arm." },
  { label: "Follow-up B", content: "Second sitting about the gripper." },
];

async function setup(
  transcripts: Array<{ content: string; label?: string }> = SOURCE_TRANSCRIPTS
) {
  const t = convexTest(schema, modules);
  const writerId = await t.run(async (ctx) =>
    ctx.db.insert("users", {
      authId: "review-from-writer",
      role: "writer" as const,
      firstName: "Writer",
    })
  );
  const asWriter = t.withIdentity({ subject: "review-from-writer" });
  const { projectId: sourceProjectId } = await asWriter.mutation(
    api.projects.createProject,
    {
      title: "Alpha PD",
      clientName: "Acme Robotics",
      transcripts,
    }
  );
  return { t, asWriter, writerId, sourceProjectId };
}

function projectTranscripts(
  t: Awaited<ReturnType<typeof setup>>["t"],
  projectId: Id<"projects">
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("transcripts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .collect()
  );
}

async function addSourceReport(
  t: Awaited<ReturnType<typeof setup>>["t"],
  projectId: Id<"projects">
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    await ctx.db.insert("reports", {
      projectId,
      content: JSON.stringify(
        buildTiptapDocument(
          "Alpha PD",
          "Uncertainty prose.",
          "Work performed prose.",
          "Advancement prose."
        )
      ),
      version: 2,
      generatedAt: now,
      updatedAt: now,
      revisionNumber: 0,
    });
  });
}

describe("createReviewFromProject", () => {
  it("creates an associated review project with the report snapshot under review", async () => {
    const { t, asWriter, writerId, sourceProjectId } = await setup();
    await addSourceReport(t, sourceProjectId);
    // A support document with original bytes, to prove inherited content.
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(
        new Blob(["original bytes"], { type: "text/plain" })
      );
      await ctx.db.insert("projectDocuments", {
        projectId: sourceProjectId,
        fileName: "notes.txt",
        fileType: "txt",
        content: "Scoping notes",
        storageId,
        source: "context_input",
        uploadedBy: "Writer",
        createdAt: Date.now(),
      });
    });

    const { projectId: reviewProjectId } = await asWriter.action(
      api.reviewFromProject.createReviewFromProject,
      { projectId: sourceProjectId }
    );
    expect(reviewProjectId).not.toEqual(sourceProjectId);

    const state = await t.run(async (ctx) => {
      const project = await ctx.db.get(reviewProjectId);
      const docs = await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .collect();
      const reviews = await ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .collect();
      const report = await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .first();
      const sourceDocs = await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", sourceProjectId))
        .collect();
      return { project, docs, reviews, report, sourceDocs };
    });

    // Association + creation conventions (creator becomes Owner, intake).
    expect(state.project).toMatchObject({
      title: "Alpha PD",
      clientName: "Acme Robotics",
      mode: "review",
      sourceProjectId,
      ownerId: writerId,
      createdBy: writerId,
      workflowStage: "intake",
    });

    // The report snapshot became the written PD under review.
    const reviewPd = state.docs.find((d) => d.source === "review_pd");
    expect(reviewPd).toBeDefined();
    expect(reviewPd?.fileName).toBe("Alpha PD (report v2).txt");
    expect(reviewPd?.fileType).toBe("txt");
    expect(reviewPd?.content).toContain("Uncertainty prose.");
    expect(reviewPd?.content).toContain(
      "Line 244 — Work Performed"
    );
    expect(reviewPd?.processingStatus).toBe("ready");
    // CAP-3: the acting internal user authored this review PD.
    expect(reviewPd?.uploaderRole).toBe("writer");

    // The AI review is running against exactly that document.
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]).toMatchObject({
      status: "running",
      documentId: reviewPd?._id,
      sourceFileName: "Alpha PD (report v2).txt",
      createdBy: writerId,
    });

    if (!reviewPd || !state.report) throw new Error("Review artifacts missing");
    expect(state.reviews[0].revisionNumber).toBe(0);
    expect(state.reviews[0].contentHash).toBe(await sha256(reviewPd.content));
    expect(state.reviews[0].contentHash).not.toBe(await sha256(state.report.content));

    // Every transcript of the source is inherited, in order, byte-identical
    // and with the source hash reused rather than recomputed.
    const copied = await projectTranscripts(t, reviewProjectId);
    const sourceRows = await projectTranscripts(t, sourceProjectId);
    expect(copied.map((row) => row.label)).toEqual([
      "Kickoff A",
      "Follow-up B",
    ]);
    expect(copied.map((row) => row.position)).toEqual([0, 1]);
    expect(copied.map((row) => row.content)).toEqual(
      SOURCE_TRANSCRIPTS.map((row) => row.content)
    );
    expect(copied.map((row) => row.contentHash)).toEqual(
      sourceRows.map((row) => row.contentHash)
    );
    expect(copied[0]._id).not.toEqual(sourceRows[0]._id);

    // copyProjectContentBetween got the first copied id: the copied report is
    // stamped with it, which is the only observable use of targetTranscriptId.
    expect(state.report?.sourceTranscriptId).toEqual(copied[0]._id);

    // Inherited content: support doc with CLONED bytes, and the copied report
    // so the PD renders in the editor.
    const copiedNotes = state.docs.find((d) => d.fileName === "notes.txt");
    const sourceNotes = state.sourceDocs.find((d) => d.fileName === "notes.txt");
    expect(copiedNotes?.content).toBe("Scoping notes");
    expect(copiedNotes?.storageId).toBeDefined();
    expect(copiedNotes?.storageId).not.toEqual(sourceNotes?.storageId);
    expect(state.report?.content).toContain("Uncertainty prose.");
  });

  it("carries every transcript into the review agent's input", async () => {
    const { t, asWriter, sourceProjectId } = await setup();
    await addSourceReport(t, sourceProjectId);
    const { projectId: reviewProjectId } = await asWriter.action(
      api.reviewFromProject.createReviewFromProject,
      { projectId: sourceProjectId }
    );
    const reviewId = await t.run(async (ctx) => {
      const review = await ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .first();
      return review!._id;
    });
    const input = await t.query(internal.pdReviews.getReviewInput, { reviewId });
    expect(input?.transcript).toBe(
      "=== Transcript 1: Kickoff A ===\nInterview notes about the robot arm." +
        "\n\n=== Transcript 2: Follow-up B ===\nSecond sitting about the gripper."
    );
  });

  it("creates no transcript rows when the source has none", async () => {
    const { t, asWriter, sourceProjectId } = await setup([]);
    await addSourceReport(t, sourceProjectId);
    const { projectId: reviewProjectId } = await asWriter.action(
      api.reviewFromProject.createReviewFromProject,
      { projectId: sourceProjectId }
    );
    expect(await projectTranscripts(t, reviewProjectId)).toEqual([]);

    const reviews = await t.run(async (ctx) =>
      ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .collect()
    );
    expect(reviews).toHaveLength(1);
    expect(reviews[0].status).toBe("running");
    const input = await t.query(internal.pdReviews.getReviewInput, {
      reviewId: reviews[0]._id,
    });
    expect(input?.transcript).toBe("");
  });

  it("fails closed when the source project has no report", async () => {
    const { asWriter, sourceProjectId } = await setup();
    await expect(
      asWriter.action(api.reviewFromProject.createReviewFromProject, {
        projectId: sourceProjectId,
      })
    ).rejects.toThrow(/no written report to review|INVALID_INPUT/i);
  });

  it("requires authentication", async () => {
    const { t, sourceProjectId } = await setup();
    await expect(
      t.action(api.reviewFromProject.createReviewFromProject, {
        projectId: sourceProjectId,
      })
    ).rejects.toThrow(/Authentication required|NOT_AUTHENTICATED/i);
  });
});
