/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { sha256 } from "./lib/contracts";

const modules = import.meta.glob("./**/*.ts");
const authId = "pd-review-projection-user";

async function setup() {
  const t = convexTest(schema, modules);
  const projectId = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { authId, role: "writer" });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Review projection",
      clientName: "Client",
      status: "draft",
      mode: "review",
      createdBy: userId,
      ownerId: userId,
      shareToken: "pd-review-projection-token",
      createdAt: now,
      updatedAt: now,
    });
    const documentId = await ctx.db.insert("projectDocuments", {
      projectId,
      fileName: "source.docx",
      fileType: "docx",
      content: "Source PD",
      source: "review_pd",
      uploadedBy: authId,
      createdAt: now,
    });
    const reviewId = await ctx.db.insert("pdReviews", {
      projectId,
      documentId,
      sourceFileName: "source.docx",
      status: "failed",
      error: '{"provider":"anthropic","message":"credit balance is too low"}',
      createdBy: userId,
      createdAt: now,
      completedAt: now,
    });
    await ctx.db.insert("pdReviewEvents", {
      projectId,
      reviewId,
      actor: "system",
      action: "review_failed",
      detail: '{"provider":"anthropic","message":"credit balance is too low"}',
      at: now,
    });
    return projectId;
  });
  return { t, projectId };
}

describe("PD review product projections", () => {
  it("does not expose stored provider errors from the latest review", async () => {
    const { t, projectId } = await setup();
    const review = await t
      .withIdentity({ subject: authId })
      .query(api.pdReviews.getLatestPdReview, { projectId });

    expect(review?.error).toBe("The review did not complete. Try running it again.");
    expect(JSON.stringify(review)).not.toContain("anthropic");
    expect(JSON.stringify(review)).not.toContain("credit balance");
  });

  it("does not expose stored provider details in the activity feed", async () => {
    const { t, projectId } = await setup();
    const events = await t
      .withIdentity({ subject: authId })
      .query(api.pdReviews.listPdReviewEvents, { projectId });

    expect(events).toEqual([
      expect.objectContaining({
        action: "review_failed",
        detail: "The review did not complete.",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("anthropic");
    expect(JSON.stringify(events)).not.toContain("credit balance");
  });
});

// A hard action death (deploy restart, timeout, OOM) strands a review in
// "running" with no catch block left to fail it; both start and retry refuse
// while one is running, so without the reaper the UI spins forever.
describe("failStalePdReviews", () => {
  const MINUTES = 60 * 1000;

  async function setupRunning(reviewAgeMinutes: number) {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId, role: "writer" });
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Stale review",
        clientName: "Client",
        status: "draft",
        mode: "review",
        createdBy: userId,
        ownerId: userId,
        shareToken: "stale-review-token",
        createdAt: now,
        updatedAt: now,
      });
      const documentId = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "source.docx",
        fileType: "docx",
        content: "Source PD",
        source: "review_pd",
        uploadedBy: authId,
        createdAt: now,
      });
      const reviewId = await ctx.db.insert("pdReviews", {
        projectId,
        documentId,
        sourceFileName: "source.docx",
        status: "running",
        createdBy: userId,
        createdAt: now - reviewAgeMinutes * MINUTES,
      });
      return { projectId, documentId, reviewId };
    });
    return { t, ...ids };
  }

  it("fails a review stranded running past the cutoff with user-safe copy", async () => {
    const { t, projectId, reviewId } = await setupRunning(20);
    const result = await t.mutation(internal.pdReviews.failStalePdReviews, {
      olderThanMinutes: 15,
    });
    expect(result).toEqual({ failed: 1 });

    const review = await t.run(async (ctx) => await ctx.db.get(reviewId));
    expect(review?.status).toBe("failed");
    expect(review?.error).toBe("Timed out before the review completed.");
    expect(review?.completedAt).toBeTypeOf("number");

    const events = await t
      .withIdentity({ subject: authId })
      .query(api.pdReviews.listPdReviewEvents, { projectId });
    expect(events).toEqual([
      expect.objectContaining({
        action: "review_failed",
        detail: "The review did not complete.",
      }),
    ]);
  });

  it("leaves fresh running reviews and terminal reviews untouched", async () => {
    const { t, reviewId } = await setupRunning(5);
    const completedId = await t.run(async (ctx) => {
      const review = await ctx.db.get(reviewId);
      if (!review) throw new Error("review missing");
      return await ctx.db.insert("pdReviews", {
        projectId: review.projectId,
        documentId: review.documentId,
        sourceFileName: review.sourceFileName,
        status: "completed",
        result: "{}",
        createdBy: review.createdBy,
        createdAt: Date.now() - 60 * MINUTES,
        completedAt: Date.now() - 59 * MINUTES,
      });
    });

    const result = await t.mutation(internal.pdReviews.failStalePdReviews, {
      olderThanMinutes: 15,
    });
    expect(result).toEqual({ failed: 0 });
    const [fresh, completed] = await t.run(async (ctx) => [
      await ctx.db.get(reviewId),
      await ctx.db.get(completedId),
    ]);
    expect(fresh?.status).toBe("running");
    expect(completed?.status).toBe("completed");
  });

  it("unblocks startPdReview after clearing the stranded review", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    try {
      const { t, projectId, documentId } = await setupRunning(20);
      const actor = t.withIdentity({ subject: authId });
      // Stranded state: a new review is refused while one "is running".
      await expect(
        actor.mutation(api.pdReviews.startPdReview, { projectId, documentId })
      ).rejects.toThrow(/already running/i);

      await t.mutation(internal.pdReviews.failStalePdReviews, {
        olderThanMinutes: 15,
      });
      const reviewId = await actor.mutation(api.pdReviews.startPdReview, {
        projectId,
        documentId,
      });
      const review = await t.run(async (ctx) => await ctx.db.get(reviewId));
      expect(review?.status).toBe("running");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("CAP-9 PD provenance", () => {
  it("pins fresh starts and retries to document bytes and keeps provenance through completion", async () => {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    try {
      const { t, projectId } = await setup();
      const actor = t.withIdentity({ subject: authId });
      const legacy = await t.run((ctx) => ctx.db.query("pdReviews").first());
      if (!legacy) throw new Error("Missing fixture");
      expect(legacy).not.toHaveProperty("revisionNumber");
      expect(legacy).not.toHaveProperty("contentHash");
      const documentId = legacy.documentId;
      const content = "  Source PD with UTF-8 café\n";
      await t.run((ctx) => ctx.db.patch(documentId, { content }));
      const startedId = await actor.mutation(api.pdReviews.startPdReview, {
        projectId,
        documentId,
      });
      const provenance = {
        revisionNumber: 0,
        contentHash: await sha256(content),
      };
      expect(await t.run((ctx) => ctx.db.get(startedId))).toMatchObject(
        provenance
      );
      await t.mutation(internal.pdReviews.completePdReview, {
        reviewId: startedId,
        result: "{}",
        model: "test",
      });
      expect(await t.run((ctx) => ctx.db.get(startedId))).toMatchObject({
        ...provenance,
        status: "completed",
      });
      const retryContent = "New source bytes before retry";
      await t.run((ctx) => ctx.db.patch(documentId, { content: retryContent }));
      const retryProvenance = {
        revisionNumber: 0,
        contentHash: await sha256(retryContent),
      };
      expect(retryProvenance.contentHash).not.toBe(provenance.contentHash);
      // Legacy retries derive from the source, never from absent historical evidence.
      const retriedId = await actor.mutation(api.pdReviews.retryPdReview, {
        reviewId: legacy._id,
      });
      expect(retriedId).not.toBe(legacy._id);
      expect(await t.run((ctx) => ctx.db.get(retriedId))).toMatchObject(
        retryProvenance
      );
      await t.mutation(internal.pdReviews.failPdReview, {
        reviewId: retriedId,
        error: "test",
      });
      expect(await t.run((ctx) => ctx.db.get(retriedId))).toMatchObject({
        ...retryProvenance,
        status: "failed",
      });
      const retryCompletedId = await actor.mutation(
        api.pdReviews.retryPdReview,
        { reviewId: startedId }
      );
      expect(await t.run((ctx) => ctx.db.get(retryCompletedId))).toMatchObject(
        retryProvenance
      );
      expect(retryCompletedId).not.toBe(startedId);
      expect(await t.run((ctx) => ctx.db.get(startedId))).toMatchObject({
        ...provenance,
        status: "completed",
      });
      expect(await t.run((ctx) => ctx.db.get(legacy._id))).not.toHaveProperty(
        "contentHash"
      );
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});

describe("PD review leave-out lists (decision 56)", () => {
  async function reviewSetup() {
    vi.useFakeTimers();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    const { t, projectId } = await setup();
    const ids = await t.run(async (ctx) => {
      // Clear the failed fixture review so a start is allowed.
      for (const row of await ctx.db.query("pdReviews").collect()) await ctx.db.delete(row._id);
      const now = Date.now();
      const writtenPd = (await ctx.db.query("projectDocuments").first())!._id;
      const kept = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "kept.md",
        fileType: "md",
        content: "Kept notes",
        category: "writer_notes",
        source: "context_input",
        uploadedBy: authId,
        createdAt: now,
      });
      const leftOut = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "left-out.md",
        fileType: "md",
        content: "Left out notes",
        category: "background",
        source: "context_input",
        uploadedBy: authId,
        createdAt: now,
      });
      const keptTranscript = await ctx.db.insert("transcripts", {
        projectId,
        label: "Kept call",
        content: "Kept interview",
        createdAt: now,
      });
      const leftOutTranscript = await ctx.db.insert("transcripts", {
        projectId,
        label: "Left out call",
        content: "Left out interview",
        createdAt: now + 1,
      });
      return { writtenPd, kept, leftOut, keptTranscript, leftOutTranscript };
    });
    return { t, projectId, actor: t.withIdentity({ subject: authId }), ...ids };
  }

  it("stores the lists and the review input skips the left-out files", async () => {
    try {
      const f = await reviewSetup();
      const reviewId = await f.actor.mutation(api.pdReviews.startPdReview, {
        projectId: f.projectId,
        documentId: f.writtenPd,
        excludeDocumentIds: [f.leftOut],
        excludeTranscriptIds: [f.leftOutTranscript],
      });
      expect((await f.t.run((ctx) => ctx.db.get(reviewId)))?.excludedSources).toEqual({
        documentIds: [f.leftOut],
        transcriptIds: [f.leftOutTranscript],
      });
      const input = await f.t.query(internal.pdReviews.getReviewInput, { reviewId });
      expect(input?.contextDocs.map((doc) => doc.fileName)).toEqual(["kept.md"]);
      expect(input?.transcript).toContain("Kept interview");
      expect(input?.transcript).not.toContain("Left out interview");

      // A retry keeps the same selection.
      await f.t.mutation(internal.pdReviews.failPdReview, { reviewId, error: "test" });
      const retryId = await f.actor.mutation(api.pdReviews.retryPdReview, { reviewId });
      expect((await f.t.run((ctx) => ctx.db.get(retryId)))?.excludedSources).toEqual({
        documentIds: [f.leftOut],
        transcriptIds: [f.leftOutTranscript],
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("reads every context file when nothing is left out", async () => {
    try {
      const f = await reviewSetup();
      const reviewId = await f.actor.mutation(api.pdReviews.startPdReview, {
        projectId: f.projectId,
        documentId: f.writtenPd,
      });
      expect((await f.t.run((ctx) => ctx.db.get(reviewId)))?.excludedSources).toBeUndefined();
      const input = await f.t.query(internal.pdReviews.getReviewInput, { reviewId });
      expect(input?.contextDocs.map((doc) => doc.fileName).sort()).toEqual(["kept.md", "left-out.md"]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("refuses leaving out the written PD or another project's file", async () => {
    try {
      const f = await reviewSetup();
      await expect(
        f.actor.mutation(api.pdReviews.startPdReview, {
          projectId: f.projectId,
          documentId: f.writtenPd,
          excludeDocumentIds: [f.writtenPd],
        })
      ).rejects.toThrow(/always reviewed/);
      const foreign = await f.t.run(async (ctx) => {
        const user = (await ctx.db.query("users").first())!;
        const other = await ctx.db.insert("projects", {
          title: "Other",
          clientName: "Client",
          status: "draft",
          createdBy: user._id,
          ownerId: user._id,
          shareToken: "other-review-token",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return await ctx.db.insert("transcripts", {
          projectId: other,
          content: "Foreign",
          createdAt: Date.now(),
        });
      });
      await expect(
        f.actor.mutation(api.pdReviews.startPdReview, {
          projectId: f.projectId,
          documentId: f.writtenPd,
          excludeTranscriptIds: [foreign],
        })
      ).rejects.toThrow(/another project/);
      expect(await f.t.run((ctx) => ctx.db.query("pdReviews").collect())).toEqual([]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
