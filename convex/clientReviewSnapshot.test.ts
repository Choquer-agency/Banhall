/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import rateLimiterTest from "@convex-dev/rate-limiter/test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { buildTiptapDocument } from "./lib/tiptapReport";
import { snapshotIdsToDelete } from "./lib/snapshots";
import { redactReviewShareTokens } from "./errorReports";

const modules = import.meta.glob("./**/*.ts");

async function setupReviewFixture() {
  const t = convexTest(schema, modules);
  rateLimiterTest.register(t);
  const initialContent = JSON.stringify(
    buildTiptapDocument(
      "Thermal Test",
      "Line 242 uncertainty published copy.",
      "Line 244 work published copy.",
      "Line 246 advancement published copy."
    )
  );
  const undraftedContent = JSON.stringify(
    buildTiptapDocument(
      "Thermal Test",
      "Line 242 uncertainty.",
      null,
      "Line 246 advancement."
    )
  );
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      authId: "auth-owner-review",
      role: "writer",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Thermal Test",
      clientName: "Acme Thermal",
      projectNumber: "2",
      fiscalYearEnd: Date.UTC(2025, 11, 31),
      scienceCode: "2.02.09",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "initial-share-token-abc123",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: initialContent,
      version: 1,
      revisionNumber: 0,
      generatedAt: now,
      updatedAt: now,
    });
    const undraftedReportId = await ctx.db.insert("reports", {
      projectId,
      content: undraftedContent,
      version: 2,
      revisionNumber: 0,
      generatedAt: now + 10,
      updatedAt: now + 10,
    });
    return { ownerId, projectId, reportId, undraftedReportId };
  });
  return {
    t,
    owner: t.withIdentity({ subject: "auth-owner-review" }),
    initialContent,
    undraftedContent,
    ...ids,
  };
}

describe("client review frozen snapshot and revocation", () => {
  test("publishForReview freezes a snapshot isolated from later live edits and updates on republish", async () => {
    const { t, owner, projectId, reportId, initialContent } = await setupReviewFixture();

    const firstPublish = await owner.mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    expect(firstPublish).not.toBeNull();
    expect(firstPublish!.snapshotId).toBeTruthy();

    const liveEditedContent = JSON.stringify(
      buildTiptapDocument(
        "Thermal Test",
        "Line 242 internal draft note NOT for client.",
        "Line 244 internal WIP edit.",
        "Line 246 internal WIP advancement."
      )
    );
    await owner.mutation(api.reports.updateReportContent, {
      reportId,
      content: liveEditedContent,
      expectedRevisionNumber: 0,
    });

    // Anonymous client using the share token still reads the frozen published snapshot.
    const clientView = await t.query(api.reports.getLatestReport, {
      projectId,
      shareToken: "initial-share-token-abc123",
    });
    expect(clientView?.content).toBe(initialContent);
    expect(clientView?.revisionNumber).toBe(0);

    // Client share metadata and view logs also record the frozen published revision, not live edits.
    const sharedProject = await t.query(api.projects.getProjectByShareToken, {
      shareToken: "initial-share-token-abc123",
    });
    expect(sharedProject?.revisionNumber).toBe(0);

    await t.mutation(api.reportViews.logClientView, {
      projectId,
      shareToken: "initial-share-token-abc123",
      viewerName: "Client Reviewer",
    });
    const views = await owner.query(api.reportViews.listViews, { projectId });
    expect(views[0]?.revisionNumber).toBe(0);

    // Owner still reads the live edited report.
    const ownerView = await owner.query(api.reports.getLatestReport, { projectId });
    expect(ownerView?._id).not.toBe(reportId); // latest report is version 2 in fixture; verify reportId directly
    const publishedAfterEdit = await owner.mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    expect(publishedAfterEdit).not.toBeNull();
    expect(publishedAfterEdit!.snapshotId).not.toBe(firstPublish!.snapshotId);

    const updatedClientView = await t.query(api.reports.getLatestReport, {
      projectId,
      shareToken: "initial-share-token-abc123",
    });
    expect(updatedClientView?.content).toBe(liveEditedContent);
    expect(updatedClientView?.revisionNumber).toBe(1);
  });

  test("legacy shared links without sharedReportSnapshotId fail closed instead of exposing live drafts", async () => {
    const { t, projectId, reportId } = await setupReviewFixture();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, {
        status: "client_review",
        sharedReportId: reportId,
        sharedReportSnapshotId: undefined,
      });
    });

    await expect(
      t.query(api.projects.getProjectByShareToken, {
        shareToken: "initial-share-token-abc123",
      })
    ).resolves.toBeNull();

    await expect(
      t.query(api.reports.getLatestReport, {
        projectId,
        shareToken: "initial-share-token-abc123",
      })
    ).resolves.toBeNull();

    await expect(
      t.mutation(api.reportViews.logClientView, {
        projectId,
        shareToken: "initial-share-token-abc123",
        viewerName: "Legacy Reviewer",
      })
    ).rejects.toMatchObject({ data: { code: "REPORT_NOT_PUBLISHED" } });
  });

  test("unpublishReview revokes client access and optionally rotates shareToken", async () => {
    const { t, owner, projectId, reportId } = await setupReviewFixture();

    await owner.mutation(api.projects.publishForReview, { projectId, reportId });
    const active = await t.query(api.reports.getLatestReport, {
      projectId,
      shareToken: "initial-share-token-abc123",
    });
    expect(active).not.toBeNull();

    const stopped = await owner.mutation(api.projects.unpublishReview, {
      projectId,
      rotateToken: true,
    });
    expect(stopped).not.toBeNull();
    expect(stopped!.shareToken).not.toBe("initial-share-token-abc123");

    await expect(
      t.query(api.reports.getLatestReport, {
        projectId,
        shareToken: "initial-share-token-abc123",
      })
    ).resolves.toBeNull();

    await expect(
      t.query(api.reports.getLatestReport, {
        projectId,
        shareToken: stopped!.shareToken,
      })
    ).resolves.toBeNull();
  });

  test("snapshotIdsToDelete never prunes publish_review snapshots", () => {
    const now = Date.UTC(2026, 10, 21);
    const oldTime = now - 90 * 24 * 60 * 60 * 1000;
    const deletions = snapshotIdsToDelete(
      [
        { _id: "pub-1", createdAt: oldTime, reason: "publish_review" },
        { _id: "man-1", createdAt: oldTime, reason: "manual" },
        { _id: "man-2", createdAt: oldTime + 1000, reason: "manual" },
      ],
      now
    );
    expect(deletions).not.toContain("pub-1");
  });

  test("redactReviewShareTokens strips /review/<token> from URLs and logs", () => {
    expect(
      redactReviewShareTokens("https://app.banhall.test/review/secret-token-99?foo=1")
    ).toBe("https://app.banhall.test/review/[redacted]?foo=1");
    expect(
      redactReviewShareTokens("Error on /review/abc_123-XYZ while loading")
    ).toBe("Error on /review/[redacted] while loading");
  });

  test("authorizeExport rejects reports containing [NOT GENERATED]", async () => {
    const { owner, undraftedReportId } = await setupReviewFixture();
    const preflight = await owner.query(api.reports.preflightExport, {
      reportId: undraftedReportId,
    });
    expect(preflight.project.projectNumber).toBe("2");
    await expect(
      owner.mutation(api.reports.authorizeExport, {
        reportId: undraftedReportId,
        expectedRevisionNumber: preflight.revisionNumber,
        expectedContentHash: preflight.contentHash,
      })
    ).rejects.toThrow(/\[NOT GENERATED\]/);
  });
});
