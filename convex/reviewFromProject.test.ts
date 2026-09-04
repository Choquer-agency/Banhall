/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
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

async function setup() {
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
      transcripts: [{ content: "Interview notes about the robot arm." }],
    }
  );
  return { t, asWriter, writerId, sourceProjectId };
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
      const transcript = await ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .first();
      const report = await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", reviewProjectId))
        .first();
      const sourceDocs = await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", sourceProjectId))
        .collect();
      return { project, docs, reviews, transcript, report, sourceDocs };
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

    // The AI review is running against exactly that document.
    expect(state.reviews).toHaveLength(1);
    expect(state.reviews[0]).toMatchObject({
      status: "running",
      documentId: reviewPd?._id,
      sourceFileName: "Alpha PD (report v2).txt",
      createdBy: writerId,
    });

    // Inherited content: transcript text, support doc with CLONED bytes, and
    // the copied report so the PD renders in the editor.
    expect(state.transcript?.content).toBe(
      "Interview notes about the robot arm."
    );
    const copiedNotes = state.docs.find((d) => d.fileName === "notes.txt");
    const sourceNotes = state.sourceDocs.find((d) => d.fileName === "notes.txt");
    expect(copiedNotes?.content).toBe("Scoping notes");
    expect(copiedNotes?.storageId).toBeDefined();
    expect(copiedNotes?.storageId).not.toEqual(sourceNotes?.storageId);
    expect(state.report?.content).toContain("Uncertainty prose.");
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
