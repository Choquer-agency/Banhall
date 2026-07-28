/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

const authIds = {
  owner: "auth-owner",
  writer: "auth-writer",
  manager: "auth-manager",
  admin: "auth-admin",
} as const;

type Actor = keyof typeof authIds;

async function setup() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const ownerId = await ctx.db.insert("users", {
      authId: authIds.owner,
      role: "writer",
    });
    const writerId = await ctx.db.insert("users", {
      authId: authIds.writer,
      role: "writer",
    });
    const managerId = await ctx.db.insert("users", {
      authId: authIds.manager,
      role: "manager",
    });
    const adminId = await ctx.db.insert("users", {
      authId: authIds.admin,
      role: "admin",
    });
    const now = Date.now();
    const projectId = await ctx.db.insert("projects", {
      title: "Owner project",
      clientName: "Client",
      status: "review",
      createdBy: ownerId,
      shareToken: "owner-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project",
      clientName: "Other client",
      status: "review",
      createdBy: writerId,
      shareToken: "other-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const reportId = await ctx.db.insert("reports", {
      projectId,
      content: "Owner report",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    const otherReportId = await ctx.db.insert("reports", {
      projectId: otherProjectId,
      content: "Other report",
      version: 1,
      generatedAt: now,
      updatedAt: now,
    });
    return {
      ownerId,
      writerId,
      managerId,
      adminId,
      projectId,
      otherProjectId,
      reportId,
      otherReportId,
    };
  });
  return { t, ...ids };
}

function asActor(t: Awaited<ReturnType<typeof setup>>["t"], actor: Actor) {
  return t.withIdentity({ subject: authIds[actor] });
}

async function getProject(
  t: Awaited<ReturnType<typeof setup>>["t"],
  projectId: Awaited<ReturnType<typeof setup>>["projectId"]
) {
  return await t.run(async (ctx) => await ctx.db.get(projectId));
}

describe("project duplication", () => {
  test("copies all project documents, archived state, evidence, and PD reviews", async () => {
    const { t, projectId, reportId } = await setup();
    const { destinationProjectId, destinationTranscriptId } = await t.run(async (ctx) => {
      const owner = await ctx.db
        .query("users")
        .withIndex("by_authId", (q) => q.eq("authId", authIds.owner))
        .unique();
      if (!owner) throw new Error("owner missing");
      const now = Date.now();
      await ctx.db.patch(reportId, {
        content: JSON.stringify({ type: "doc", content: [] }),
        revisionNumber: 4,
      });
      const destination = await ctx.db.insert("projects", {
        title: "Copy",
        clientName: "Client",
        status: "draft",
        createdBy: owner._id,
        shareToken: "copy-token",
        createdAt: now,
        updatedAt: now,
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: destination,
        content: "source transcript",
        createdAt: now,
      });
      const supportDoc = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "Support.pdf",
        fileType: "pdf",
        content: "supporting evidence",
        archived: true,
        category: "background",
        source: "context_input",
        uploadedBy: "Owner",
        createdAt: now,
      });
      const reviewDoc = await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "Existing PD.docx",
        fileType: "docx",
        content: "existing PD",
        source: "review_pd",
        uploadedBy: "Owner",
        createdAt: now,
      });
      // A legacy row from before status was stored: an unreadable previous-year
      // file whose only content is the wizard's boilerplate. Duplication
      // persists a derived status, so this is where a wrong `ready` would be
      // frozen permanently.
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "Scanned 2023.pdf",
        fileType: "pdf",
        content: "[Previous-year report — fiscal 2023]\n\n",
        category: "previous_pd",
        source: "context_input",
        uploadedBy: "Owner",
        createdAt: now,
      });
      await ctx.db.insert("projectIdentityEvidence", {
        projectId,
        subjectName: "Client",
        relationship: "claimant",
        evidenceKind: "project_document",
        projectDocumentId: supportDoc,
        sourceDescription: "Support.pdf",
        status: "verified",
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("pdReviews", {
        projectId,
        documentId: reviewDoc,
        sourceFileName: "Existing PD.docx",
        status: "completed",
        result: "review output",
        createdBy: "Owner",
        createdAt: now,
        completedAt: now,
      });
      return {
        destinationProjectId: destination,
        destinationTranscriptId: transcriptId,
      };
    });

    const result = await asActor(t, "owner").mutation(
      api.projects.prepareProjectContentCopy,
      {
        fromProjectId: projectId,
        toProjectId: destinationProjectId,
        targetTranscriptId: destinationTranscriptId,
      }
    );

    expect(result.documents).toHaveLength(3);
    expect(result.evidenceCopied).toBe(1);
    expect(result.pdReviewsCopied).toBe(1);
    expect(result.reportId).toBeTruthy();
    const copied = await t.run(async (ctx) => ({
      documents: await ctx.db
        .query("projectDocuments")
        .withIndex("by_projectId", (q) => q.eq("projectId", destinationProjectId))
        .collect(),
      evidence: await ctx.db
        .query("projectIdentityEvidence")
        .withIndex("by_projectId", (q) => q.eq("projectId", destinationProjectId))
        .collect(),
      reviews: await ctx.db
        .query("pdReviews")
        .withIndex("by_projectId", (q) => q.eq("projectId", destinationProjectId))
        .collect(),
      reports: await ctx.db
        .query("reports")
        .withIndex("by_projectId", (q) => q.eq("projectId", destinationProjectId))
        .collect(),
    }));
    expect(copied.documents).toHaveLength(3);
    expect(copied.documents.find((doc) => doc.fileName === "Support.pdf")).toMatchObject({
      archived: true,
      category: "background",
    });
    expect(
      copied.documents.find((doc) => doc.fileName === "Scanned 2023.pdf")
    ).toMatchObject({
      processingStatus: "could_not_read",
      processingDetail: "no_text_extracted",
    });
    expect(copied.evidence[0]?.projectDocumentId).toBeTruthy();
    expect(copied.reviews[0]).toMatchObject({
      sourceFileName: "Existing PD.docx",
      result: "review output",
    });
    expect(copied.reports[0]).toMatchObject({
      sourceTranscriptId: destinationTranscriptId,
      revisionNumber: 4,
    });
  });
});

describe("project review publishing", () => {
  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("allows %s to publish a report", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();

    await asActor(t, actor).mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      sharedReportId: reportId,
      status: "client_review",
    });
  });

  test.each([
    ["non-owner writer", "writer"],
    ["non-owner manager", "manager"],
  ] as const)("denies %s from publishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test("denies unauthenticated and unmapped identities", async () => {
    const { t, projectId, reportId } = await setup();

    await expect(
      t.mutation(api.projects.publishForReview, { projectId, reportId })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    await expect(
      t.withIdentity({ subject: "missing-auth-id" }).mutation(
        api.projects.publishForReview,
        { projectId, reportId }
      )
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHENTICATED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("rejects another project's report for %s", async (_label, actor) => {
    const { t, projectId, otherReportId } = await setup();

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId: otherReportId,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });
});

describe("bulk project edits", () => {
  const fyEnd = Date.parse("2025-03-31T00:00:00Z");

  test("sets company name and fiscal year-end across projects", async () => {
    const { t, projectId, otherProjectId } = await setup();

    const result = await asActor(t, "writer").mutation(
      api.projects.bulkUpdateProjects,
      {
        projectIds: [projectId, otherProjectId],
        clientName: "  Acme Manufacturing  ",
        fiscalYearEnd: fyEnd,
      }
    );

    expect(result).toEqual({ updated: 2, skipped: 0 });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      fiscalYearEnd: fyEnd,
    });
    await expect(getProject(t, otherProjectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      fiscalYearEnd: fyEnd,
    });
  });

  test("leaves omitted fields untouched", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { fiscalYearEnd: fyEnd });
    });

    await asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      clientName: "Renamed Co",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Renamed Co",
      fiscalYearEnd: fyEnd,
    });
  });

  test("null clears the fiscal year-end without touching the company", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { fiscalYearEnd: fyEnd });
    });

    await asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId],
      fiscalYearEnd: null,
    });

    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ clientName: "Client" });
    expect(project).not.toHaveProperty("fiscalYearEnd");
  });

  test("skips projects that no longer exist", async () => {
    const { t, projectId, otherProjectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.delete(otherProjectId);
    });

    const result = await asActor(t, "owner").mutation(
      api.projects.bulkUpdateProjects,
      {
        projectIds: [projectId, otherProjectId],
        clientName: "Survivor Co",
      }
    );

    expect(result).toEqual({ updated: 1, skipped: 1 });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Survivor Co",
    });
  });

  test("rejects a blank company name and no-op edits", async () => {
    const { t, projectId } = await setup();

    await expect(
      asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
        clientName: "   ",
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(
      asActor(t, "owner").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Client",
    });
  });

  test("denies unauthenticated callers", async () => {
    const { t, projectId } = await setup();

    await expect(
      t.mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId],
        clientName: "Nope",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Client",
    });
  });
});

describe("project review unpublishing", () => {
  test.each([
    ["creator", "owner"],
    ["non-owner admin", "admin"],
  ] as const)("allows %s to unpublish a report", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await asActor(t, actor).mutation(api.projects.unpublishReview, {
      projectId,
    });

    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test.each([
    ["non-owner writer", "writer"],
    ["non-owner manager", "manager"],
  ] as const)("denies %s from unpublishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await expect(
      asActor(t, actor).mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      status: "client_review",
      sharedReportId: reportId,
    });
  });
});
