/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { dashboardCompanyKey } from "../shared/dashboardProjection";

const modules = import.meta.glob("./**/*.ts");

const authIds = {
  owner: "auth-owner",
  writer: "auth-writer",
  manager: "auth-manager",
  admin: "auth-admin",
  // Mapped, signed in, but holds no internal role.
  roleless: "auth-roleless",
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
    const rolelessId = await ctx.db.insert("users", {
      authId: authIds.roleless,
    });
    const now = Date.now();
    // Each project starts with its creator as the accountable Owner
    // (ownerId). Authorization reads ownerId, never createdBy.
    const projectId = await ctx.db.insert("projects", {
      title: "Owner project",
      clientName: "Client",
      status: "review",
      createdBy: ownerId,
      ownerId,
      shareToken: "owner-project-token",
      createdAt: now,
      updatedAt: now,
    });
    const otherProjectId = await ctx.db.insert("projects", {
      title: "Other project",
      clientName: "Other client",
      status: "review",
      createdBy: writerId,
      ownerId: writerId,
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
      rolelessId,
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

describe("dashboard project projection", () => {
  test.each([
    ["reserved", "generating"],
    ["running", "generating"],
    ["awaiting_selection", "awaiting_selection"],
    ["awaiting_input", "awaiting_input"],
  ] as const)("scopes active generation %s as secondary activity %s", async (status, expected) => {
    const { t, projectId, ownerId } = await setup();
    await t.run(async (ctx) => {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Interview",
        createdAt: Date.now(),
      });
      const generationId = await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status,
        requestedBy: ownerId,
        startedAt: Date.now(),
      });
      await ctx.db.patch(projectId, {
        workflowStage: "on_hold",
        activeGenerationId: generationId,
      });
    });

    const listed = await asActor(t, "owner").query(api.projects.listProjects, {});
    expect(listed.find((project) => project._id === projectId)).toMatchObject({
      workflowStage: "on_hold",
      status: "review",
      generationActivity: expected,
    });
  });

  test("finds a pointerless legacy active generation through the exact status index", async () => {
    const { t, projectId, ownerId } = await setup();
    await t.run(async (ctx) => {
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId,
        content: "Interview",
        createdAt: Date.now(),
      });
      await ctx.db.insert("generations", {
        projectId,
        transcriptId,
        status: "awaiting_selection",
        requestedBy: ownerId,
        startedAt: Date.now(),
      });
      await ctx.db.patch(projectId, { workflowStage: "drafting", activeGenerationId: undefined });
    });

    const listed = await asActor(t, "owner").query(api.projects.listProjects, {});
    expect(listed.find((project) => project._id === projectId)?.generationActivity).toBe(
      "awaiting_selection"
    );
  });

  test("returns no generation activity after the active generation is complete", async () => {
    const { t, projectId } = await setup();
    const listed = await asActor(t, "owner").query(api.projects.listProjects, {});
    expect(listed.find((project) => project._id === projectId)?.generationActivity).toBeNull();
  });
});

describe("live project contributor labels", () => {
  test("resolves legacy email snapshots to current first and last names without rewriting storage", async () => {
    const { t, projectId, ownerId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(ownerId, {
        email: "demo@banhall.ca",
        firstName: "Demo",
        lastName: "Writer",
      });
      await ctx.db.patch(projectId, { writer: "DEMO@BANHALL.CA" });
    });

    const first = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    expect(first?.writer).toBe("Demo Writer");

    await t.run(async (ctx) => {
      await ctx.db.patch(ownerId, { firstName: "Dana", lastName: "Writer" });
    });
    const updated = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    const listed = await asActor(t, "owner").query(api.projects.listProjects, {});
    const stored = await t.run(async (ctx) => await ctx.db.get(projectId));

    expect(updated?.writer).toBe("Dana Writer");
    expect(listed.find((project) => project._id === projectId)?.writer).toBe(
      "Dana Writer"
    );
    expect(stored?.writer).toBe("DEMO@BANHALL.CA");
  });

  test("uses the authoritative project user when duplicate legacy emails exist or the email changes", async () => {
    const { t, projectId, ownerId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(ownerId, {
        email: "current@banhall.ca",
        firstName: "Current",
        lastName: "Writer",
      });
      await ctx.db.insert("users", {
        authId: "duplicate-email-a",
        email: "demo@banhall.ca",
        firstName: "Wrong",
        lastName: "Account",
        role: "writer",
      });
      await ctx.db.insert("users", {
        authId: "duplicate-email-b",
        email: "demo@banhall.ca",
        firstName: "Also Wrong",
        lastName: "Account",
        role: "writer",
      });
      await ctx.db.patch(projectId, { writer: "demo@banhall.ca" });
    });

    const project = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    const listed = await asActor(t, "owner").query(api.projects.listProjects, {});
    expect(project?.writer).toBe("Current Writer");
    expect(listed.find((row) => row._id === projectId)?.writer).toBe(
      "Current Writer"
    );
  });

  test("keeps non-email and nameless legacy labels unchanged", async () => {
    const { t, projectId, ownerId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(ownerId, { email: "demo@banhall.ca" });
      await ctx.db.patch(projectId, { writer: "demo@banhall.ca" });
    });
    const emailOnly = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    expect(emailOnly?.writer).toBe("demo@banhall.ca");

    await t.run(async (ctx) => {
      await ctx.db.patch(ownerId, { name: "Legacy Display Name" });
    });
    const legacyName = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    expect(legacyName?.writer).toBe("Legacy Display Name");

    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { writer: "Legacy Consultant" });
    });
    const named = await asActor(t, "owner").query(api.projects.getProject, {
      projectId,
    });
    expect(named?.writer).toBe("Legacy Consultant");
  });
});

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
    ["the current Owner", "owner"],
    ["a non-owner manager", "manager"],
    ["a non-owner admin", "admin"],
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
    ["a non-owner writer", "writer"],
    ["a mapped user without a role", "roleless"],
  ] as const)("denies %s from publishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId,
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toEqual(before);
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
    ["the current Owner", "owner"],
    ["a non-owner manager", "manager"],
    ["a non-owner admin", "admin"],
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

// Story 2 (CAP-3, decision D-2): publish-for-review is authorized by the
// caller's current role on the project (Owner via ownerId, Manager, or
// Admin), never by projects.createdBy. After an ownership transfer the
// creator keeps createdBy but loses the authority that used to ride on it.
// The internal role enum is writer | manager | admin, so "an internal role
// that is none of Owner, Manager, Admin" is exactly a writer who is not the
// current Owner: the original-creator case below.
describe("publishForReview authority", () => {
  async function setupTransferred() {
    const fixture = await setup();
    const { t, projectId, ownerId, writerId } = fixture;
    // Transfer: the "writer" actor becomes the accountable Owner while the
    // creator (the "owner" actor) remains createdBy with only the writer role.
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { ownerId: writerId });
    });
    const before = await getProject(t, projectId);
    expect(before).toMatchObject({
      createdBy: ownerId,
      ownerId: writerId,
      status: "review",
    });
    expect(before).not.toHaveProperty("sharedReportId");
    return { ...fixture, before };
  }

  test.each([
    ["the new Owner", "writer"],
    ["a manager", "manager"],
    ["an admin", "admin"],
  ] as const)("allows %s to publish after ownership transfer", async (_label, actor) => {
    const { t, projectId, reportId } = await setupTransferred();

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
    ["the original creator (a writer who is no longer Owner)", "owner"],
    ["a mapped user without a role", "roleless"],
  ] as const)("rejects %s with NOT_AUTHORIZED and writes nothing", async (_label, actor) => {
    const { t, projectId, reportId, before } = await setupTransferred();

    await expect(
      asActor(t, actor).mutation(api.projects.publishForReview, {
        projectId,
        reportId,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });

    const after = await getProject(t, projectId);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ status: "review" });
    expect(after).not.toHaveProperty("sharedReportId");
  });

  test("rejects an anonymous caller with NOT_AUTHENTICATED and writes nothing", async () => {
    const { t, projectId, reportId, before } = await setupTransferred();

    await expect(
      t.mutation(api.projects.publishForReview, { projectId, reportId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });

    const after = await getProject(t, projectId);
    expect(after).toEqual(before);
    expect(after).toMatchObject({ status: "review" });
    expect(after).not.toHaveProperty("sharedReportId");
  });

  test("never falls back to createdBy when the project has no Owner", async () => {
    // A legacy row with no ownerId: the creator holds no Owner claim, so only
    // a Manager or Admin may publish.
    const { t, projectId, reportId, ownerId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { ownerId: undefined });
    });
    const before = await getProject(t, projectId);
    expect(before).toMatchObject({ createdBy: ownerId });
    expect(before).not.toHaveProperty("ownerId");

    await expect(
      asActor(t, "owner").mutation(api.projects.publishForReview, {
        projectId,
        reportId,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(before);

    await asActor(t, "manager").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    await expect(getProject(t, projectId)).resolves.toMatchObject({
      sharedReportId: reportId,
      status: "client_review",
    });
  });

  test.each([
    ["the new Owner", "writer"],
    ["a manager", "manager"],
    ["an admin", "admin"],
  ] as const)("allows %s to unpublish after ownership transfer", async (_label, actor) => {
    const { t, projectId, reportId } = await setupTransferred();
    await asActor(t, "writer").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });

    await asActor(t, actor).mutation(api.projects.unpublishReview, { projectId });

    const project = await getProject(t, projectId);
    expect(project).toMatchObject({ status: "review" });
    expect(project).not.toHaveProperty("sharedReportId");
  });

  test.each([
    ["the original creator (a writer who is no longer Owner)", "owner"],
    ["a mapped user without a role", "roleless"],
  ] as const)("unpublishReview rejects %s and writes nothing", async (_label, actor) => {
    const { t, projectId, reportId } = await setupTransferred();
    await asActor(t, "writer").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    const published = await getProject(t, projectId);
    expect(published).toMatchObject({
      status: "client_review",
      sharedReportId: reportId,
    });

    await expect(
      asActor(t, actor).mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(published);
  });

  test("unpublishReview rejects an anonymous caller and writes nothing", async () => {
    const { t, projectId, reportId } = await setupTransferred();
    await asActor(t, "writer").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    const published = await getProject(t, projectId);

    await expect(
      t.mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(published);
  });
});

describe("bulk project edits", () => {
  const fyEnd = Date.parse("2025-03-31T00:00:00Z");

  test.each([
    ["a manager", "manager"],
    ["an admin", "admin"],
  ] as const)("%s sets company name and fiscal year-end across every selected project", async (_label, actor) => {
    const { t, projectId, otherProjectId } = await setup();

    const result = await asActor(t, actor).mutation(
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
      dashboardCompanyKey: dashboardCompanyKey("Acme Manufacturing"),
    });
    await expect(getProject(t, otherProjectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      fiscalYearEnd: fyEnd,
      dashboardCompanyKey: dashboardCompanyKey("Acme Manufacturing"),
    });
  });

  test("a writer updates only the projects they own and skips the rest untouched", async () => {
    const { t, projectId, otherProjectId } = await setup();
    // "writer" owns otherProjectId; projectId belongs to the "owner" actor.
    const notOwned = await getProject(t, projectId);

    const result = await asActor(t, "writer").mutation(
      api.projects.bulkUpdateProjects,
      {
        projectIds: [projectId, otherProjectId],
        clientName: "  Acme Manufacturing  ",
        fiscalYearEnd: fyEnd,
      }
    );

    expect(result).toEqual({ updated: 1, skipped: 1 });
    await expect(getProject(t, otherProjectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      fiscalYearEnd: fyEnd,
      dashboardCompanyKey: dashboardCompanyKey("Acme Manufacturing"),
    });
    await expect(getProject(t, projectId)).resolves.toEqual(notOwned);
  });

  test("rejects a mapped user without a role before any write", async () => {
    const { t, projectId, otherProjectId } = await setup();
    const before = await Promise.all([
      getProject(t, projectId),
      getProject(t, otherProjectId),
    ]);

    await expect(
      asActor(t, "roleless").mutation(api.projects.bulkUpdateProjects, {
        projectIds: [projectId, otherProjectId],
        clientName: "Nope",
        fiscalYearEnd: fyEnd,
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });

    await expect(
      Promise.all([getProject(t, projectId), getProject(t, otherProjectId)])
    ).resolves.toEqual(before);
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

describe("project numbering", () => {
  test("accepts combined number+letter identities like 2a -> 2A", async () => {
    const { t, projectId } = await setup();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: " 2a ",
    });
    let project = await asActor(t, "owner").query(api.projects.getProject, { projectId });
    expect(project?.projectNumber).toBe("2a");
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "14b",
    });
    project = await asActor(t, "owner").query(api.projects.getProject, { projectId });
    expect(project?.projectNumber).toBe("14b");
    // combined form still respects the 20 cap
    await expect(
      asActor(t, "owner").mutation(api.projects.setProjectNumber, {
        projectId,
        projectNumber: "21A",
      })
    ).rejects.toThrow();
  });

  test("sets a valid final number", async () => {
    const { t, projectId } = await setup();

    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "3",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      projectNumber: "3",
    });
  });

  test("sets a valid draft letter", async () => {
    const { t, projectId } = await setup();

    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "a",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      projectNumber: "a",
    });
  });

  test.each([["21"], ["99"]])("rejects numbers above the 20 cap (%s)", async (value) => {
    const { t, projectId } = await setup();

    await expect(
      asActor(t, "owner").mutation(api.projects.setProjectNumber, {
        projectId,
        projectNumber: value,
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    const project = await getProject(t, projectId);
    expect(project).not.toHaveProperty("projectNumber");
  });

  test.each([["0"], ["AB"], ["A1"]])("rejects malformed value %s", async (value) => {
    const { t, projectId } = await setup();

    await expect(
      asActor(t, "owner").mutation(api.projects.setProjectNumber, {
        projectId,
        projectNumber: value,
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
  });

  test("normalizes lowercase letters and surrounding whitespace", async () => {
    const { t, projectId } = await setup();

    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "  b ",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      projectNumber: "b",
    });
  });

  test("clears the number with empty or omitted input", async () => {
    const { t, projectId } = await setup();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "7",
    });

    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "",
    });
    let project = await getProject(t, projectId);
    expect(project).not.toHaveProperty("projectNumber");

    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
      projectNumber: "a",
    });
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId,
    });
    project = await getProject(t, projectId);
    expect(project).not.toHaveProperty("projectNumber");
  });

  test("denies unauthenticated callers", async () => {
    const { t, projectId } = await setup();

    await expect(
      t.mutation(api.projects.setProjectNumber, {
        projectId,
        projectNumber: "1",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    const project = await getProject(t, projectId);
    expect(project).not.toHaveProperty("projectNumber");
  });
});

describe("project review unpublishing", () => {
  test.each([
    ["the current Owner", "owner"],
    ["a non-owner manager", "manager"],
    ["a non-owner admin", "admin"],
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
    ["a non-owner writer", "writer"],
    ["a mapped user without a role", "roleless"],
  ] as const)("denies %s from unpublishing", async (_label, actor) => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    const published = await getProject(t, projectId);

    await expect(
      asActor(t, actor).mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED" },
    });
    const project = await getProject(t, projectId);
    expect(project).toEqual(published);
    expect(project).toMatchObject({
      status: "client_review",
      sharedReportId: reportId,
    });
  });

  test("denies unauthenticated callers", async () => {
    const { t, projectId, reportId } = await setup();
    await asActor(t, "owner").mutation(api.projects.publishForReview, {
      projectId,
      reportId,
    });
    const published = await getProject(t, projectId);

    await expect(
      t.mutation(api.projects.unpublishReview, { projectId })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(published);
  });
});

describe("project number auto-lettering (meeting 2026-08-18)", () => {
  async function setupSiblings() {
    const base = await setup();
    const siblings = await base.t.run(async (ctx) => {
      const now = Date.now();
      const make = (title: string) =>
        ctx.db.insert("projects", {
          title,
          clientName: "Acme",
          dashboardCompanyKey: "acme",
          dashboardFiscalYearRank: -2025,
          status: "review",
          createdBy: base.ownerId,
          shareToken: `token-${title}`,
          createdAt: now,
          updatedAt: now,
        });
      return { a: await make("Acme one"), b: await make("Acme two"), c: await make("Acme three") };
    });
    return { ...base, siblings };
  }

  test("second bare number in the same client+FY gets the next letter", async () => {
    const { t, siblings } = await setupSiblings();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.a,
      projectNumber: "1",
    });
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.b,
      projectNumber: "1",
    });
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.c,
      projectNumber: "1",
    });
    const [a, b, c] = await t.run(async (ctx) => [
      await ctx.db.get(siblings.a),
      await ctx.db.get(siblings.b),
      await ctx.db.get(siblings.c),
    ]);
    // On first collision the existing bare "1" is renamed to the explicit
    // "1a" slot; later applies letter alphabetically (lowercase).
    expect(a?.projectNumber).toBe("1a");
    expect(b?.projectNumber).toBe("1b");
    expect(c?.projectNumber).toBe("1c");
  });

  test("re-applying the same number to the same project does not self-collide", async () => {
    const { t, siblings } = await setupSiblings();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.a,
      projectNumber: "2",
    });
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.a,
      projectNumber: "2",
    });
    const a = await t.run((ctx) => ctx.db.get(siblings.a));
    expect(a?.projectNumber).toBe("2");
  });

  test("explicit lettered input is stored as typed", async () => {
    const { t, siblings } = await setupSiblings();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.a,
      projectNumber: "1",
    });
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.b,
      projectNumber: "1d",
    });
    const b = await t.run((ctx) => ctx.db.get(siblings.b));
    expect(b?.projectNumber).toBe("1d");
  });

  test("a different fiscal year keeps the bare number", async () => {
    const { t, siblings, ownerId } = await setupSiblings();
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: siblings.a,
      projectNumber: "1",
    });
    const nextYear = await t.run((ctx) =>
      ctx.db.insert("projects", {
        title: "Acme rollover",
        clientName: "Acme",
        dashboardCompanyKey: "acme",
        dashboardFiscalYearRank: -2026,
        status: "review",
        createdBy: ownerId,
        shareToken: "token-rollover",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    );
    await asActor(t, "owner").mutation(api.projects.setProjectNumber, {
      projectId: nextYear,
      projectNumber: "1",
    });
    const rollover = await t.run((ctx) => ctx.db.get(nextYear));
    expect(rollover?.projectNumber).toBe("1");
  });
});
