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
