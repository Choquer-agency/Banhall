/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

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
