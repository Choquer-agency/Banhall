/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("live historical consultant labels", () => {
  it("resolves historical review email snapshots from the current account name", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        authId: "live-label-admin",
        role: "admin",
      });
      const writerId = await ctx.db.insert("users", {
        authId: "live-label-writer",
        email: "demo@banhall.ca",
        firstName: "Demo",
        lastName: "Writer",
        role: "writer",
      });
      const now = Date.now();
      const projectId = await ctx.db.insert("projects", {
        title: "Historical review",
        clientName: "Client",
        writer: "demo@banhall.ca",
        status: "review",
        createdBy: writerId,
        shareToken: "live-label-review-token",
        createdAt: now,
        updatedAt: now,
      });
      const reportId = await ctx.db.insert("reports", {
        projectId,
        content: "Report",
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("writerReviews", {
        projectId,
        reportId,
        userId: writerId,
        writerName: "demo@banhall.ca",
        score: 90,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("qaItemFeedback", {
        targetKey: `report:${reportId}`,
        projectId,
        reportId,
        itemKey: "line-242-risk",
        itemKind: "issue",
        section: "242",
        itemText: "Clarify the uncertainty.",
        userId: writerId,
        writerName: "demo@banhall.ca",
        createdAt: now,
        updatedAt: now,
      });
      return { adminId, writerId };
    });

    const first = await t
      .withIdentity({ subject: "live-label-admin" })
      .query(api.reviews.listWriterReviews, {});
    expect(first.rows[0]?.writerName).toBe("Demo Writer");
    expect(first.itemRows[0]?.writerName).toBe("Demo Writer");

    await t.run(async (ctx) => {
      await ctx.db.patch(ids.writerId, {
        firstName: "Dana",
        lastName: "Writer",
        email: "new-email@banhall.ca",
      });
    });
    const updated = await t
      .withIdentity({ subject: "live-label-admin" })
      .query(api.reviews.listWriterReviews, {});
    expect(updated.rows[0]?.writerName).toBe("Dana Writer");
    expect(updated.itemRows[0]?.writerName).toBe("Dana Writer");
  });
});
