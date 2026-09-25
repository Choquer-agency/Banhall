/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
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

type WorkItemStatus = "open" | "completed" | "declined" | "canceled";

/**
 * A handoff: a work item on `projectId` assigned to `assigneeId`. Only an
 * OPEN item makes the assignee a collaborator for metadata/prose edits.
 */
async function insertWorkItem(
  t: Awaited<ReturnType<typeof setup>>["t"],
  args: {
    projectId: Awaited<ReturnType<typeof setup>>["projectId"];
    assigneeId: Awaited<ReturnType<typeof setup>>["writerId"];
    assignerId: Awaited<ReturnType<typeof setup>>["ownerId"];
    status: WorkItemStatus;
  }
) {
  const now = Date.now();
  await t.run(async (ctx) => {
    await ctx.db.insert("workItems", {
      projectId: args.projectId,
      kind: "revision",
      assigneeId: args.assigneeId,
      assignerId: args.assignerId,
      instructions: "Handoff",
      blocking: false,
      status: args.status,
      ...(args.status === "completed" ? { completedAt: now, completedBy: args.assigneeId } : {}),
      version: 1,
      createRequestId: `req-${args.status}-${Math.random()}`,
      createRequestFingerprint: `fp-${args.status}-${Math.random()}`,
      createdAt: now,
      updatedAt: now,
    });
  });
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
      // CAP-3: trust belongs to the content's origin, not to whoever pressed
      // duplicate. The acting copier here is a `writer`, so a source role of
      // `manager` proves the copy carried the source's role rather than being
      // re-stamped, and the roleless row proves nothing is derived from the
      // copier — that would launder a client file into internal direction.
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "Attributed notes.md",
        fileType: "txt",
        content: "Internal direction.",
        category: "writer_notes",
        source: "context_input",
        uploadedBy: "Manager",
        uploaderRole: "manager",
        createdAt: now,
      });
      await ctx.db.insert("projectDocuments", {
        projectId,
        fileName: "Unattributed notes.md",
        fileType: "txt",
        content: "Unattributed direction.",
        category: "writer_notes",
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
      for (const provenance of [
        { revisionNumber: 7, contentHash: "historical-hash" },
        { revisionNumber: 0, contentHash: "" },
        { revisionNumber: 9 },
        { contentHash: "hash-only-history" },
      ]) {
        await ctx.db.insert("pdReviews", {
          projectId,
          documentId: reviewDoc,
          sourceFileName: "Existing PD.docx",
          status: "completed",
          result: "attributed review",
          createdBy: "Owner",
          createdAt: now,
          ...provenance,
        });
      }
      return {
        destinationProjectId: destination,
        destinationTranscriptId: transcriptId,
      };
    });

    const result = await asActor(t, "owner").mutation(
      internal.projects.prepareProjectContentCopy,
      {
        fromProjectId: projectId,
        toProjectId: destinationProjectId,
        targetTranscriptId: destinationTranscriptId,
      }
    );

    expect(result.documents).toHaveLength(5);
    expect(result.evidenceCopied).toBe(1);
    expect(result.pdReviewsCopied).toBe(5);
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
    expect(copied.documents).toHaveLength(5);
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
    expect(
      copied.documents.find((doc) => doc.fileName === "Attributed notes.md")
        ?.uploaderRole
    ).toBe("manager");
    // Absent, not re-stamped with the copier's `writer` role: assert the key
    // is missing, since a written nullish value would also read as no role.
    const copiedUnattributed = copied.documents.find(
      (doc) => doc.fileName === "Unattributed notes.md"
    );
    expect(copiedUnattributed).toBeTruthy();
    expect(copiedUnattributed && "uploaderRole" in copiedUnattributed).toBe(false);
    expect(copied.evidence[0]?.projectDocumentId).toBeTruthy();
    expect(copied.reviews[0]).toMatchObject({
      sourceFileName: "Existing PD.docx",
      result: "review output",
    });
    expect(copied.reviews[0]).not.toHaveProperty("revisionNumber");
    expect(copied.reviews[0]).not.toHaveProperty("contentHash");
    expect(copied.reviews.slice(1)).toEqual([
      expect.objectContaining({ revisionNumber: 7, contentHash: "historical-hash" }),
      expect.objectContaining({ revisionNumber: 0, contentHash: "" }),
      expect.objectContaining({ revisionNumber: 9 }),
      expect.objectContaining({ contentHash: "hash-only-history" }),
    ]);
    expect(copied.reviews[3]).not.toHaveProperty("contentHash");
    expect(copied.reviews[4]).not.toHaveProperty("revisionNumber");
    expect(copied.reports[0]).toMatchObject({
      sourceTranscriptId: destinationTranscriptId,
      sourceTranscriptIds: [destinationTranscriptId],
      revisionNumber: 4,
    });
  });
});

describe("copied running PD reviews", () => {
  // The legacy public copyProjectDocuments is gone (owner decision 35,
  // 2026-09-25); the internal prepare mutation is the one row copy.
  const copyEntries = [internal.projects.prepareProjectContentCopy];
  const copyTime = 1_800_000_000_000;

  async function fixture() {
    const f = await setup();
    const reviewIds = await f.t.run(async (ctx) => {
      await ctx.db.patch(f.projectId, { workflowStage: "internal_review" });
      await ctx.db.patch(f.otherProjectId, { workflowStage: "intake" });
      for (const projectId of [f.projectId, f.otherProjectId]) {
        for (const position of [0, 1]) {
          await ctx.db.insert("transcripts", {
            projectId, position, label: `Interview ${position + 1}`,
            content: `${projectId}: nonempty interview ${position + 1}`,
            createdAt: 100,
          });
        }
      }
      const documents = [];
      for (const label of ["First", "Second"]) {
        const fileName = `${label} review PD.txt`;
        const documentId = await ctx.db.insert("projectDocuments", {
          projectId: f.projectId, fileName, fileType: "txt",
          content: `${label} distinct active PD body`, source: "review_pd",
          uploadedBy: "Original uploader", createdAt: 100,
        });
        documents.push({ documentId, fileName });
      }
      const ids = [];
      for (const [index, status] of (["completed", "failed", "running", "running"] satisfies
        Array<"completed" | "failed" | "running">).entries()) {
        const document = documents[index % documents.length];
        const realisticRunning = index === 3;
        const reviewId = await ctx.db.insert("pdReviews", {
          projectId: f.projectId,
          documentId: document.documentId,
          sourceFileName: document.fileName,
          status,
          ...(realisticRunning ? {} : {
            result: "Historical result", model: "historical-model",
            error: "Historical error", completedAt: 200,
          }),
          revisionNumber: 0, contentHash: "",
          createdBy: `Original reviewer ${index}`, createdAt: 100,
        });
        ids.push(reviewId);
        await ctx.db.insert("pdReviewEvents", {
          projectId: f.projectId, reviewId, actor: `Original reviewer ${index}`,
          action: "review_started", detail: "Original history", at: 100,
        });
      }
      return ids;
    });
    return { ...f, reviewIds };
  }

  async function snapshot(t: Awaited<ReturnType<typeof setup>>["t"]) {
    return await t.run(async (ctx) => ({
      projects: await ctx.db.query("projects").collect(),
      documents: await ctx.db.query("projectDocuments").collect(),
      transcripts: await ctx.db.query("transcripts").collect(),
      reviews: await ctx.db.query("pdReviews").collect(),
      events: await ctx.db.query("pdReviewEvents").collect(),
      reports: await ctx.db.query("reports").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
  }

  test.each(copyEntries)("terminalizes only copied running rows through %s", async (entry) => {
    const { t, projectId, otherProjectId, reviewIds } = await fixture();
    const before = await snapshot(t);
    const clock = vi.spyOn(Date, "now").mockReturnValue(copyTime);
    try {
      const result = await asActor(t, "owner").mutation(entry, {
        fromProjectId: projectId, toProjectId: otherProjectId,
      });
      expect(result.pdReviewsCopied).toBe(4);
    } finally {
      clock.mockRestore();
    }
    const after = await snapshot(t);
    const copied = after.reviews.filter((row) => row.projectId === otherProjectId);
    expect(copied).toHaveLength(reviewIds.length);
    const events = after.events.filter((row) => row.projectId === otherProjectId);
    expect(events).toHaveLength(2);
    for (const sourceId of reviewIds) {
      const source = before.reviews.find((row) => row._id === sourceId);
      if (!source) throw new Error("Missing identified source review");
      const matches = copied.filter((row) => row.createdBy === source.createdBy);
      expect(matches).toHaveLength(1);
      const row = matches[0];
      expect(row._id).not.toBe(sourceId);
      expect(row).toMatchObject({
        sourceFileName: source.sourceFileName,
        revisionNumber: 0, contentHash: "", createdBy: source.createdBy,
        createdAt: copyTime,
      });
      expect(row.result).toBe(source.result);
      expect(row.model).toBe(source.model);
      const sourceDocument = before.documents.find((doc) => doc._id === source.documentId);
      if (!sourceDocument) throw new Error("Missing identified source document");
      expect(after.documents.find((doc) => doc._id === row.documentId)).toMatchObject({
        projectId: otherProjectId, source: "review_pd",
        fileName: sourceDocument.fileName, content: sourceDocument.content,
      });
      expect(row.documentId).not.toBe(source.documentId);
      const rowEvents = events.filter((event) => event.reviewId === row._id);
      if (source.status !== "running") {
        expect(row).toMatchObject({
          status: source.status, error: source.error, completedAt: source.completedAt,
        });
        expect(rowEvents).toHaveLength(0);
      } else {
        expect(row.status).toBe("failed");
        expect(row.error).toMatch(/source.*still running.*duplicated/i);
        expect(row.completedAt).toBe(copyTime);
        expect(rowEvents).toEqual([expect.objectContaining({
          projectId: otherProjectId, reviewId: row._id, actor: "system",
          action: "review_failed", detail: row.error, at: copyTime,
        })]);
      }
    }
    for (const key of ["reviews", "events", "documents", "reports"] as const) {
      expect(after[key].filter((row) => row.projectId === projectId)).toEqual(
        before[key].filter((row) => row.projectId === projectId)
      );
    }
    expect(before.transcripts.filter((row) => row.projectId === projectId)).toHaveLength(2);
    expect(before.transcripts.filter((row) => row.projectId === otherProjectId)).toHaveLength(2);
    expect(after.transcripts).toEqual(before.transcripts);
    const sourceProject = before.projects.find((row) => row._id === projectId);
    const destinationProject = before.projects.find((row) => row._id === otherProjectId);
    if (!sourceProject || !destinationProject) throw new Error("Missing fixture project");
    expect(sourceProject.createdBy).not.toBe(destinationProject.createdBy);
    expect(after.projects.find((row) => row._id === projectId)).toEqual(sourceProject);
    expect(after.projects.find((row) => row._id === otherProjectId)).toMatchObject({
      workflowStage: "intake", createdBy: destinationProject.createdBy,
    });
    expect(after.jobs).toEqual(before.jobs);
  });

  test.each(copyEntries)("allows immediate real retry through %s", async (entry) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");
    vi.stubEnv("OPENROUTER_API_KEY", "test-openrouter-key");
    try {
      const { t, projectId, otherProjectId } = await fixture();
      const before = await snapshot(t);
      const source = before.reviews.find((row) =>
        row.projectId === projectId && row.status === "running" && row.result === undefined);
      if (!source) throw new Error("Missing realistic running source review");
      expect(source).not.toHaveProperty("error");
      expect(source).not.toHaveProperty("completedAt");
      const actor = asActor(t, "owner");
      await actor.mutation(entry, { fromProjectId: projectId, toProjectId: otherProjectId });
      const copied = (await snapshot(t)).reviews.find((row) =>
        row.projectId === otherProjectId && row.createdBy === source.createdBy);
      if (!copied) throw new Error("Missing copied review matched to running source");
      expect(copied.status).toBe("failed");
      expect(copied.error).toMatch(/source.*still running.*duplicated/i);
      expect(copied.documentId).not.toBe(source.documentId);
      const retryId = await actor.mutation(api.pdReviews.retryPdReview, { reviewId: copied._id });
      expect(retryId).not.toBe(copied._id);
      const after = await snapshot(t);
      expect(after.reviews.find((row) => row._id === retryId)).toMatchObject({
        status: "running", projectId: otherProjectId, documentId: copied.documentId,
      });
      const originalDocument = before.documents.find((doc) => doc._id === source.documentId);
      if (!originalDocument) throw new Error("Missing source PD");
      expect(after.documents.find((doc) => doc._id === copied.documentId)).toMatchObject({
        projectId: otherProjectId, fileName: originalDocument.fileName,
        content: originalDocument.content,
      });
      expect(after.reviews.find((row) => row._id === copied._id)).toEqual(copied);
      expect(after.jobs).toEqual([expect.objectContaining({
        name: "ai/reviewAgent:runPdReview",
        args: [{ reviewId: retryId, projectId: otherProjectId }],
      })]);
      // Once this destination has a running retry, the normal guard still
      // rejects a second retry of the copied failed row without side effects.
      await expect(actor.mutation(api.pdReviews.retryPdReview, {
        reviewId: copied._id,
      })).rejects.toMatchObject({ data: {
        code: "INVALID_INPUT", message: "A review is already running for this project",
      } });
      expect(await snapshot(t)).toEqual(after);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  test.each(copyEntries)("denies restricted copies before writes through %s", async (entry) => {
    const { t, projectId, otherProjectId } = await fixture();
    const before = await snapshot(t);
    // Internal access is firm-wide. Roleless users lack both projects;
    // this proves pre-write rejection, not rollback after partial copying.
    for (const [fromProjectId, toProjectId] of [
      [projectId, otherProjectId], [otherProjectId, projectId],
    ]) {
      await expect(asActor(t, "roleless").mutation(entry, {
        fromProjectId, toProjectId,
      })).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
      expect(await snapshot(t)).toEqual(before);
    }
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

  test("an assigned collaborator is still skipped by the bulk edit (owner-only safeguard)", async () => {
    const { t, projectId, otherProjectId, writerId, ownerId } = await setup();
    // The single-project gate admits an open-work-item assignee; the mass
    // change deliberately does not (2026-09-15 amendment).
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "open" });
    const notOwned = await getProject(t, projectId);

    const result = await asActor(t, "writer").mutation(api.projects.bulkUpdateProjects, {
      projectIds: [projectId, otherProjectId],
      clientName: "Acme Manufacturing",
    });

    expect(result).toEqual({ updated: 1, skipped: 1 });
    await expect(getProject(t, projectId)).resolves.toEqual(notOwned);
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

describe("single-project client name edits", () => {
  // Owner decision 2026-09-15: descriptive metadata follows the report-prose
  // scope — Owner, assigned collaborator (open work item), Manager, Admin.
  test.each([
    ["the owner", "owner"],
    ["a manager", "manager"],
    ["an admin", "admin"],
  ] as const)("%s renames the client and resyncs the dashboard company key", async (_label, actor) => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, {
        dashboardCompanyKey: dashboardCompanyKey("Client"),
        projectNumber: "2a",
      });
    });

    await asActor(t, actor).mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "  Acme Manufacturing  ",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      dashboardCompanyKey: dashboardCompanyKey("Acme Manufacturing"),
      // Numbering travels with the project (parity with bulkUpdateProjects).
      projectNumber: "2a",
    });
  });

  test("another writer with no handoff is rejected and writes nothing", async () => {
    const { t, projectId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "writer").mutation(api.projects.updateProjectClientName, {
        projectId,
        clientName: "Acme Manufacturing",
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED", capability: "report.editProse" },
    });
    await expect(getProject(t, projectId)).resolves.toEqual(before);
  });

  test("an assigned collaborator (open work item) renames the client", async () => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "open" });

    await asActor(t, "writer").mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "Acme Manufacturing",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      clientName: "Acme Manufacturing",
      dashboardCompanyKey: dashboardCompanyKey("Acme Manufacturing"),
    });
  });

  test.each(["completed", "declined", "canceled"] as const)(
    "a writer whose only work item is %s cannot rename the client",
    async (status) => {
      const { t, projectId, writerId, ownerId } = await setup();
      await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status });
      const before = await getProject(t, projectId);

      await expect(
        asActor(t, "writer").mutation(api.projects.updateProjectClientName, {
          projectId,
          clientName: "Acme Manufacturing",
        })
      ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
      await expect(getProject(t, projectId)).resolves.toEqual(before);
    }
  );

  test("moves the counted stage bucket between company rows", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, {
        dashboardCompanyKey: dashboardCompanyKey("Client"),
        dashboardCompanyCounted: true,
      });
    });

    await asActor(t, "owner").mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "Renamed Co",
    });

    const companies = await t.run(async (ctx) => await ctx.db.query("dashboardCompanies").collect());
    const byKey = new Map(companies.map((row) => [row.companyKey, row]));
    expect(byKey.get(dashboardCompanyKey("Renamed Co"))).toMatchObject({
      clientName: "Renamed Co",
      projectCount: 1,
    });
    expect(byKey.get(dashboardCompanyKey("Client"))?.projectCount ?? 0).toBe(0);
  });

  test("a casing-only correction refreshes the company row label without moving counts", async () => {
    const { t, projectId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, {
        clientName: "acme  manufacturing",
        dashboardCompanyKey: dashboardCompanyKey("acme  manufacturing"),
        dashboardCompanyCounted: true,
      });
      await ctx.db.insert("dashboardCompanies", {
        companyKey: dashboardCompanyKey("acme  manufacturing"),
        clientName: "acme  manufacturing",
        projectCount: 1,
        updatedAt: 0,
      });
    });

    await asActor(t, "owner").mutation(api.projects.updateProjectClientName, {
      projectId,
      clientName: "Acme Manufacturing",
    });

    const companies = await t.run(async (ctx) => await ctx.db.query("dashboardCompanies").collect());
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({
      companyKey: dashboardCompanyKey("Acme Manufacturing"),
      clientName: "Acme Manufacturing",
      projectCount: 1,
    });
  });

  test("rejects a blank client name and writes nothing", async () => {
    const { t, projectId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "owner").mutation(api.projects.updateProjectClientName, {
        projectId,
        clientName: "   ",
      })
    ).rejects.toMatchObject({ data: { code: "INVALID_INPUT" } });
    await expect(getProject(t, projectId)).resolves.toEqual(before);
  });

  test("denies a mapped user without a role and an anonymous caller", async () => {
    const { t, projectId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "roleless").mutation(api.projects.updateProjectClientName, {
        projectId,
        clientName: "Nope",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(
      t.mutation(api.projects.updateProjectClientName, {
        projectId,
        clientName: "Nope",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHENTICATED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(before);
  });
});

describe("project metadata edit scope (owner decision 2026-09-15)", () => {
  test.each([
    ["the owner", "owner"],
    ["a manager", "manager"],
    ["an admin", "admin"],
  ] as const)("%s edits the titles", async (_label, actor) => {
    const { t, projectId } = await setup();

    await asActor(t, actor).mutation(api.projects.updateProjectTitles, {
      projectId,
      title: "  Renamed  ",
      sredTitle: "Formal title",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      title: "Renamed",
      sredTitle: "Formal title",
    });
  });

  test("an assigned collaborator edits the titles", async () => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "open" });

    await asActor(t, "writer").mutation(api.projects.updateProjectTitles, {
      projectId,
      title: "Collaborator rename",
    });

    await expect(getProject(t, projectId)).resolves.toMatchObject({
      title: "Collaborator rename",
    });
  });

  test("another writer cannot edit the titles, even with a closed work item", async () => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "completed" });
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "writer").mutation(api.projects.updateProjectTitles, {
        projectId,
        title: "Nope",
      })
    ).rejects.toMatchObject({
      data: { code: "NOT_AUTHORIZED", capability: "report.editProse" },
    });
    await expect(getProject(t, projectId)).resolves.toEqual(before);
  });

  // Every single-project descriptive-metadata mutation shares the one gate.
  // Real values throughout so the "accepts" case asserts the field, not a
  // timestamp tick.
  const metadataEdits = [
    ["updateProjectTitle", { title: "Nope" }, { title: "Nope" }],
    ["updateProjectIndustry", { industry: "manufacturing" }, { industry: "manufacturing" }],
    ["updateProjectScienceCode", { scienceCode: "1.02.01" }, { scienceCode: "1.02.01" }],
    ["setProjectNumber", { projectNumber: "1" }, { projectNumber: "1" }],
    ["updateProjectTags", { tagIds: [] }, { tagIds: [] }],
    [
      "updateProjectFiscalYear",
      { fiscalYearEnd: Date.UTC(2026, 11, 31) },
      { fiscalYearEnd: Date.UTC(2026, 11, 31) },
    ],
  ] as const;

  test.each(metadataEdits)("%s rejects a writer with no handoff and writes nothing", async (name, args, _expected) => {
    const { t, projectId } = await setup();
    const before = await getProject(t, projectId);

    await expect(
      asActor(t, "writer").mutation(api.projects[name], { projectId, ...args } as never)
    ).rejects.toMatchObject({ data: { code: "NOT_AUTHORIZED" } });
    await expect(getProject(t, projectId)).resolves.toEqual(before);
  });

  test.each(metadataEdits)("%s accepts an assigned collaborator", async (name, args, expected) => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "open" });
    const before = await getProject(t, projectId);

    await asActor(t, "writer").mutation(api.projects[name], { projectId, ...args } as never);

    const after = await getProject(t, projectId);
    expect(after?.updatedAt).toBeGreaterThanOrEqual(before?.updatedAt ?? 0);
    expect(after).toMatchObject(expected);
  });
});

describe("getProjectEditAccess mirrors the metadata edit gate", () => {
  test.each([
    ["the owner", "owner", true],
    ["a manager", "manager", true],
    ["an admin", "admin", true],
    ["another writer with no handoff", "writer", false],
    ["a roleless user", "roleless", false],
  ] as const)("%s → canEditDetails %s", async (_label, actor, expected) => {
    const { t, projectId } = await setup();

    await expect(
      asActor(t, actor).query(api.projects.getProjectEditAccess, { projectId })
    ).resolves.toEqual({ canEditDetails: expected });
  });

  test("an assigned collaborator (open work item) may edit", async () => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "open" });

    await expect(
      asActor(t, "writer").query(api.projects.getProjectEditAccess, { projectId })
    ).resolves.toEqual({ canEditDetails: true });
  });

  test("a closed work item does not make a writer a collaborator", async () => {
    const { t, projectId, writerId, ownerId } = await setup();
    await insertWorkItem(t, { projectId, assigneeId: writerId, assignerId: ownerId, status: "completed" });

    await expect(
      asActor(t, "writer").query(api.projects.getProjectEditAccess, { projectId })
    ).resolves.toEqual({ canEditDetails: false });
  });

  test("an anonymous caller gets false, not an error", async () => {
    const { t, projectId } = await setup();

    await expect(
      t.query(api.projects.getProjectEditAccess, { projectId })
    ).resolves.toEqual({ canEditDetails: false });
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
          // Metadata edits are gated on ownerId (never createdBy).
          ownerId: base.ownerId,
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
        ownerId,
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

/** Typed domain-error code of a rejected call, or a marker for other outcomes. */
async function createErrorCode(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
  } catch (error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object" && "code" in data) {
      return String((data as { code: unknown }).code);
    }
    return `UNTYPED: ${(error as Error).message}`;
  }
  return "NO_ERROR";
}

describe("createProject takes an ordered list of transcripts", () => {
  test("stores one row per content item, in list order", async () => {
    const { t } = await setup();
    const { projectId, transcriptIds } = await asActor(t, "writer").mutation(
      api.projects.createProject,
      {
        title: "Three-part interview",
        clientName: "Acme Robotics",
        transcripts: [
          { content: "Part one body", label: "Day 1.docx" },
          { content: "Part two body", label: "Day 2.docx" },
          { content: "Part three body" },
        ],
      }
    );
    expect(transcriptIds).toHaveLength(3);

    const listed = await asActor(t, "writer").query(
      api.transcripts.listTranscripts,
      { projectId }
    );
    expect(listed.map((row) => [row._id, row.label, row.position])).toEqual([
      [transcriptIds[0], "Day 1.docx", 0],
      [transcriptIds[1], "Day 2.docx", 1],
      [transcriptIds[2], "Interview transcript", 2],
    ]);
    expect(listed.every((row) => Boolean(row.contentHash))).toBe(true);

    const bodies = await t.run(async (ctx) =>
      Promise.all(transcriptIds.map(async (id) => (await ctx.db.get(id))?.content))
    );
    expect(bodies).toEqual(["Part one body", "Part two body", "Part three body"]);
  });

  test("copies a source project's transcripts by reference", async () => {
    const { t } = await setup();
    const writer = asActor(t, "writer");
    const source = await writer.mutation(api.projects.createProject, {
      title: "Source",
      clientName: "Acme Robotics",
      transcripts: [
        { content: "Alpha body", label: "Alpha.docx" },
        { content: "Beta body", label: "Beta.docx" },
      ],
    });
    const sourceRows = await t.run(async (ctx) =>
      Promise.all(source.transcriptIds.map((id) => ctx.db.get(id)))
    );

    const copy = await writer.mutation(api.projects.createProject, {
      title: "Source (copy)",
      clientName: "Acme Robotics",
      transcripts: source.transcriptIds.map((fromTranscriptId) => ({
        fromTranscriptId,
      })),
    });
    const copiedRows = await t.run(async (ctx) =>
      Promise.all(copy.transcriptIds.map((id) => ctx.db.get(id)))
    );
    expect(
      copiedRows.map((row) => [row?.content, row?.label, row?.contentHash, row?.position])
    ).toEqual([
      [sourceRows[0]?.content, "Alpha.docx", sourceRows[0]?.contentHash, 0],
      [sourceRows[1]?.content, "Beta.docx", sourceRows[1]?.contentHash, 1],
    ]);
    // Copies belong to the new project; the source keeps its own rows.
    expect(copiedRows.every((row) => row?.projectId === copy.projectId)).toBe(true);
  });

  test("rejects more than twenty transcripts", async () => {
    const { t } = await setup();
    expect(
      await createErrorCode(() =>
        asActor(t, "writer").mutation(api.projects.createProject, {
          title: "Too many parts",
          clientName: "Acme Robotics",
          transcripts: Array.from({ length: 21 }, (_, index) => ({
            content: `Part ${index}`,
          })),
        })
      )
    ).toBe("INVALID_INPUT");
  });

  test("rejects combined text over the character cap", async () => {
    const { t } = await setup();
    const half = "x".repeat(1_000_001);
    expect(
      await createErrorCode(() =>
        asActor(t, "writer").mutation(api.projects.createProject, {
          title: "Oversized",
          clientName: "Acme Robotics",
          transcripts: [{ content: half }, { content: half }],
        })
      )
    ).toBe("INVALID_INPUT");
  });

  test("skips empty entries and creates the project with the rest", async () => {
    const { t } = await setup();
    const { projectId, transcriptIds } = await asActor(t, "writer").mutation(
      api.projects.createProject,
      {
        title: "Context-only plus one",
        clientName: "Acme Robotics",
        transcripts: [{ content: "   " }, { content: "Real body" }, { content: "" }],
      }
    );
    expect(transcriptIds).toHaveLength(1);
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("Real body");
  });

  test("creates a project with no transcript rows at all", async () => {
    const { t } = await setup();
    const { projectId, transcriptIds } = await asActor(t, "writer").mutation(
      api.projects.createProject,
      { title: "Documents only", clientName: "Acme Robotics", transcripts: [] }
    );
    expect(transcriptIds).toEqual([]);
    expect(
      await asActor(t, "writer").query(api.transcripts.listTranscripts, { projectId })
    ).toEqual([]);
  });

  test("refuses a transcript whose project the caller cannot read", async () => {
    const { t } = await setup();
    // A transcript left behind by a project the caller can no longer read is
    // an authorization boundary, not a copy: nothing may be written from it.
    const orphanTranscriptId = await t.run(async (ctx) => {
      const now = Date.now();
      const strangerProjectId = await ctx.db.insert("projects", {
        title: "Unreadable",
        clientName: "Stranger",
        status: "draft",
        createdBy: (await ctx.db.query("users").first())!._id,
        shareToken: "unreadable-token",
        createdAt: now,
        updatedAt: now,
      });
      const transcriptId = await ctx.db.insert("transcripts", {
        projectId: strangerProjectId,
        content: "Confidential body",
        createdAt: now,
      });
      await ctx.db.delete(strangerProjectId);
      return transcriptId;
    });
    expect(
      await createErrorCode(() =>
        asActor(t, "writer").mutation(api.projects.createProject, {
          title: "Sneaky copy",
          clientName: "Acme Robotics",
          transcripts: [{ fromTranscriptId: orphanTranscriptId }],
        })
      )
    ).toBe("NOT_AUTHORIZED");
    const leaked = await t.run(async (ctx) =>
      ctx.db
        .query("transcripts")
        .filter((q) => q.eq(q.field("content"), "Confidential body"))
        .collect()
    );
    expect(leaked).toHaveLength(1);
  });

  test("skips a source transcript deleted between prefill and submit", async () => {
    const { t } = await setup();
    const writer = asActor(t, "writer");
    const source = await writer.mutation(api.projects.createProject, {
      title: "Source",
      clientName: "Acme Robotics",
      transcripts: [{ content: "Kept body" }, { content: "Deleted body" }],
    });
    await t.run((ctx) => ctx.db.delete(source.transcriptIds[1]));

    const copy = await writer.mutation(api.projects.createProject, {
      title: "Source (copy)",
      clientName: "Acme Robotics",
      transcripts: source.transcriptIds.map((fromTranscriptId) => ({
        fromTranscriptId,
      })),
    });
    expect(copy.transcriptIds).toHaveLength(1);
    const copied = await t.run((ctx) => ctx.db.get(copy.transcriptIds[0]));
    expect(copied?.content).toBe("Kept body");
    expect(copied?.position).toBe(0);
  });
});

describe("backend readers of a project's transcripts", () => {
  const JOINED =
    "=== Transcript 1: Kickoff ===\nFirst sitting body." +
    "\n\n=== Transcript 2: Follow-up ===\nSecond sitting body.";

  async function projectWithTranscripts(
    transcripts: Array<{ content: string; label?: string }>
  ) {
    const { t } = await setup();
    const writer = asActor(t, "writer");
    const { projectId } = await writer.mutation(api.projects.createProject, {
      title: "Nutrient dosing",
      clientName: "Acme Robotics",
      transcripts,
    });
    return { t, writer, projectId };
  }

  test("getScienceCodeSuggestionContext joins every transcript", async () => {
    const { t, writer, projectId } = await projectWithTranscripts([
      { label: "Kickoff", content: "First sitting body." },
      { label: "Follow-up", content: "Second sitting body." },
    ]);
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("reports", {
        projectId,
        content: "Report body",
        version: 1,
        generatedAt: now,
        updatedAt: now,
      });
    });
    const context = await writer.query(
      internal.projects.getScienceCodeSuggestionContext,
      { projectId }
    );
    expect(context?.transcript).toBe(JOINED);
    expect(context?.report).toBe("Report body");
  });

  test("getScienceCodeSuggestionContext returns empty text with no transcripts", async () => {
    const { writer, projectId } = await projectWithTranscripts([]);
    const context = await writer.query(
      internal.projects.getScienceCodeSuggestionContext,
      { projectId }
    );
    expect(context?.transcript).toBe("");
  });

  test("generationPostmortem counts every transcript and its characters", async () => {
    const { t, projectId } = await projectWithTranscripts([
      { label: "Kickoff", content: "First sitting body." },
      { label: "Follow-up", content: "Second sitting body." },
    ]);
    const postmortem = await t.query(internal.debugTools.generationPostmortem, {
      projectId,
    });
    expect(postmortem?.transcriptCount).toBe(2);
    expect(postmortem?.transcriptChars).toBe(
      "First sitting body.".length + "Second sitting body.".length
    );
  });

  test("generationPostmortem reports zero for a project with no transcripts", async () => {
    const { t, projectId } = await projectWithTranscripts([]);
    const postmortem = await t.query(internal.debugTools.generationPostmortem, {
      projectId,
    });
    expect(postmortem?.transcriptCount).toBe(0);
    expect(postmortem?.transcriptChars).toBe(0);
  });
});

describe("seedDemoProject writes a listable transcript row", () => {
  test("labels the row, places it at position 0 and hashes its content", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("users", { email: "demo@banhall.ca" });
    });

    const { projectId } = await t.mutation(internal.seed.seedDemoProject, {});

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("transcripts")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .collect()
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("Cascade Hydroponics interview");
    expect(rows[0].position).toBe(0);
    expect(rows[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("getProjectDetailsPanel (Details panel, 2026-09-24)", () => {
  async function panelSetup() {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const ownerId = await ctx.db.insert("users", { authId: "dp-owner", role: "writer", firstName: "Owen", lastName: "Park" });
      const viewerId = await ctx.db.insert("users", { authId: "dp-viewer", role: "writer", firstName: "Vera" });
      const reviewerId = await ctx.db.insert("users", { authId: "dp-reviewer", role: "writer", firstName: "Sam", lastName: "Chen" });
      const managerId = await ctx.db.insert("users", { authId: "dp-manager", role: "manager", firstName: "Mara" });
      await ctx.db.insert("users", { authId: "dp-roleless", firstName: "None" });
      const projectId = await ctx.db.insert("projects", {
        title: "Details project", clientName: "Client", status: "review", createdBy: ownerId, ownerId,
        shareToken: "details-project", workflowStage: "drafting", workflowVersion: 0,
        industry: "manufacturing", fiscalYearEnd: Date.UTC(2026, 5, 30), scienceCode: "2.03.01",
        projectNumber: "3", createdAt: 1_000, updatedAt: 2_000,
      });
      return { ownerId, viewerId, reviewerId, managerId, projectId };
    });
    return {
      t, ...ids,
      owner: t.withIdentity({ subject: "dp-owner" }),
      viewer: t.withIdentity({ subject: "dp-viewer" }),
      reviewer: t.withIdentity({ subject: "dp-reviewer" }),
      manager: t.withIdentity({ subject: "dp-manager" }),
      roleless: t.withIdentity({ subject: "dp-roleless" }),
    };
  }

  test("returns the contract shape for the Owner with no handoff", async () => {
    const f = await panelSetup();
    const panel = await f.owner.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(panel).toEqual({
      stage: "drafting",
      workflowVersion: 0,
      industry: "manufacturing",
      fiscalYearEnd: Date.UTC(2026, 5, 30),
      scienceCode: "2.03.01",
      projectNumber: "3",
      owner: { userId: f.ownerId, label: "Owen Park", initials: "OP", isYou: true },
      createdAt: 1_000,
      editedAt: 2_000,
      currentHandoff: null,
      permissions: { canEditDetails: true, canChangeStage: true, canHandOff: true },
    });
  });

  test("shows the current handoff and moves editedAt with a stage change", async () => {
    const f = await panelSetup();
    const { workItemId } = await f.owner.mutation(api.workItems.handOff, {
      projectId: f.projectId, assigneeId: f.reviewerId, stage: "internal_review",
      note: "Please check 242", expectedWorkflowVersion: 0, createRequestId: "dp-handoff",
    });
    const panel = await f.owner.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(panel?.stage).toBe("internal_review");
    expect(panel?.workflowVersion).toBe(1);
    expect(panel?.currentHandoff).toEqual({
      workItemId, assigneeId: f.reviewerId, assigneeLabel: "Sam Chen", initials: "SC",
      isYou: false, note: "Please check 242",
    });
    const project = await f.t.run((ctx) => ctx.db.get(f.projectId));
    expect(project?.updatedAt).toBe(2_000);
    expect(panel?.editedAt).toBe(project?.workflowUpdatedAt);
    expect(panel!.editedAt).toBeGreaterThan(2_000);

    // The reviewer holds the handoff: they may edit details and complete the
    // review, but not hand the project on.
    const asReviewer = await f.reviewer.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(asReviewer?.currentHandoff?.isYou).toBe(true);
    expect(asReviewer?.owner?.isYou).toBe(false);
    expect(asReviewer?.permissions).toEqual({ canEditDetails: true, canChangeStage: true, canHandOff: false });
  });

  test("editedAt follows a plain stage change", async () => {
    const f = await panelSetup();
    await f.owner.mutation(api.projectWorkflow.setWorkflowStage, {
      projectId: f.projectId, toStage: "client_review", expectedVersion: 0,
    });
    const panel = await f.owner.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    const project = await f.t.run((ctx) => ctx.db.get(f.projectId));
    expect(panel?.stage).toBe("client_review");
    expect(panel?.editedAt).toBe(project?.workflowUpdatedAt);
    expect(panel!.editedAt).toBeGreaterThan(project!.updatedAt);
  });

  test("gives a viewer no edit, stage or handoff permission and a Manager all three", async () => {
    const f = await panelSetup();
    const asViewer = await f.viewer.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(asViewer?.owner).toMatchObject({ userId: f.ownerId, isYou: false });
    expect(asViewer?.permissions).toEqual({ canEditDetails: false, canChangeStage: false, canHandOff: false });
    const asManager = await f.manager.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(asManager?.permissions).toEqual({ canEditDetails: true, canChangeStage: true, canHandOff: true });
  });

  test("returns null to a roleless or signed-out caller", async () => {
    const f = await panelSetup();
    expect(await f.roleless.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId })).toBeNull();
    await expect(f.t.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId })).resolves.toBeNull();
  });

  test("uses null for absent facts and a stale handoff pointer", async () => {
    const f = await panelSetup();
    await f.t.run(async (ctx) => {
      const itemId = await ctx.db.insert("workItems", {
        projectId: f.projectId, kind: "other", assigneeId: f.reviewerId, assignerId: f.ownerId,
        dueSortAt: 1, instructions: "", blocking: true, status: "canceled", version: 1,
        createRequestId: "dp-stale", createRequestFingerprint: "dp-stale", createdAt: 1, updatedAt: 1,
      });
      await ctx.db.patch(f.projectId, {
        industry: undefined, fiscalYearEnd: undefined, scienceCode: undefined, projectNumber: undefined,
        workflowStage: undefined, currentHandoffId: itemId,
      });
    });
    const panel = await f.owner.query(api.projects.getProjectDetailsPanel, { projectId: f.projectId });
    expect(panel).toMatchObject({
      stage: "intake", industry: null, fiscalYearEnd: null, scienceCode: null, projectNumber: null,
      currentHandoff: null,
    });
  });
});
