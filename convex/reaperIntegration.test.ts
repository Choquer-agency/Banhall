/// <reference types="vite/client" />
/**
 * Integration seams the per-module reaper tests skip:
 *  - failStalePdReviews must unblock retryPdReview (pdReviewProjection.test.ts
 *    already proves startPdReview unblocks);
 *  - after failStaleGenerations whole-fails a stale generation, the writer-
 *    facing getGenerationRecovery projection must show its candidate runs as
 *    failed with no raw error text.
 */
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const authId = "reaper-integration-user";
const MINUTES = 60 * 1000;

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
  vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("failStalePdReviews unblocks retryPdReview", () => {
  it("retry is refused while a review is stranded running, then allowed after the reap", async () => {
    const t = convexTest(schema, modules);
    const { failedReviewId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId, role: "writer" });
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Retry unblock",
        clientName: "Client",
        status: "draft",
        mode: "review",
        createdBy: userId,
        shareToken: "retry-unblock-token",
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
      // An old failed review the writer wants to retry…
      const failedReviewId = await ctx.db.insert("pdReviews", {
        projectId,
        documentId,
        sourceFileName: "source.docx",
        status: "failed",
        error: "Timed out before the review completed.",
        createdBy: userId,
        createdAt: now - 60 * MINUTES,
        completedAt: now - 59 * MINUTES,
      });
      // …blocked by a newer review stranded "running" past the cutoff.
      await ctx.db.insert("pdReviews", {
        projectId,
        documentId,
        sourceFileName: "source.docx",
        status: "running",
        createdBy: userId,
        createdAt: now - 20 * MINUTES,
      });
      return { failedReviewId };
    });
    const actor = t.withIdentity({ subject: authId });

    await expect(
      actor.mutation(api.pdReviews.retryPdReview, { reviewId: failedReviewId })
    ).rejects.toThrow(/already running/i);

    await t.mutation(internal.pdReviews.failStalePdReviews, {
      olderThanMinutes: 15,
    });

    const retriedId = await actor.mutation(api.pdReviews.retryPdReview, {
      reviewId: failedReviewId,
    });
    const retried = await t.run(async (ctx) => await ctx.db.get(retriedId));
    expect(retried?.status).toBe("running");
  });
});

describe("whole-fail feeds a clean recovery projection", () => {
  it("getGenerationRecovery shows reaped runs as failed with no raw error text", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { authId, role: "writer" });
      const now = Date.now();
      const old = now - 60 * MINUTES;
      const projectId = await ctx.db.insert("projects", {
        title: "Recovery after reap",
        clientName: "Client",
        status: "generating",
        createdBy: userId,
        shareToken: "recovery-after-reap-token",
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
        status: "running",
        candidateMode: "compare",
        previousProjectStatus: "draft",
        startedAt: old,
      });
      await ctx.db.patch(projectId, { activeGenerationId: generationId });
      // One run already failed with raw provider text on the row, one stuck
      // running, one never started.
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "claude-sonnet-5",
        label: "Sonnet 5",
        status: "failed",
        error: "unknown: RAWSECRET <!DOCTYPE html> gateway trash",
        queuedAt: old,
        completedAt: old,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "google/gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
        status: "running",
        queuedAt: old,
        startedAt: old,
      });
      await ctx.db.insert("generationCandidateRuns", {
        generationId,
        projectId,
        model: "openai/gpt-5.1",
        label: "GPT-5.1",
        status: "queued",
        queuedAt: old,
      });
      return { generationId };
    });

    await t.mutation(internal.generations.failStaleGenerations, {
      olderThanMinutes: 30,
    });

    const recovery = await t
      .withIdentity({ subject: authId })
      .query(api.generations.getGenerationRecovery, {
        generationId: ids.generationId,
      });

    expect(recovery?.status).toBe("failed");
    const statuses = (recovery?.models ?? []).map((model) => model.status);
    expect(statuses).toHaveLength(3);
    expect(new Set(statuses)).toEqual(new Set(["failed"]));
    // The projection carries model/label/status only — never the stored error
    // strings (raw provider text or otherwise).
    const serialized = JSON.stringify(recovery);
    expect(serialized).not.toContain("RAWSECRET");
    expect(serialized).not.toContain("<!DOCTYPE");
    expect(serialized).not.toContain("unknown:");
    expect(serialized).not.toContain("Timed out");
  });
});
